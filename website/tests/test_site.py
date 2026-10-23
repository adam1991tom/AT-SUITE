"""The public site, settings guards, the catalogue, the signing key, reminders and the Stripe setup tool."""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import time
from pathlib import Path

import httpx
import pytest

from atshop import catalogue, config, jobs
from atshop.licensing import Signer, SigningError

from conftest import FakeStripe, make_settings

ROOT = Path(__file__).resolve().parents[2]
PAGES = ["/", "/features", "/how-it-works", "/pricing", "/hosting", "/faq", "/support", "/downloads", "/contact",
         "/login", "/register", "/docs", "/sitemap.xml", "/robots.txt"]
DOCS = ["getting-started", "self-hosted-install", "managed-hosting", "licence-keys", "laptop-app", "billing"]
LEGAL = ["terms", "privacy", "dpa", "billing", "acceptable-use"]


def test_every_public_page_opens(h):
    c = h.client()
    for p in PAGES + [f"/docs/{d}" for d in DOCS] + [f"/legal/{k}" for k in LEGAL]:
        r = c.get(p)
        assert r.status_code == 200, p
    assert c.get("/docs/../../config").status_code == 404
    assert c.get("/legal/nope").status_code == 404
    assert c.get("/nope").status_code == 404


def test_legal_pages_are_marked_as_drafts(h):
    c = h.client()
    for k in LEGAL:
        assert "Draft" in c.get(f"/legal/{k}").text, k


def test_pricing_shows_the_catalogue(h):
    page = h.client().get("/pricing").text
    for amount in ("£99", "£229", "£429", "£990", "£2,290", "£4,290", "£39", "£149"):
        assert amount in page, amount
    assert "Prices exclude VAT" in page


def test_price_change_in_the_catalogue_shows_on_the_site(tmp_path, vendor):
    toml = (ROOT / "website" / "catalogue.toml").read_text().replace("monthly = 229", "monthly = 249")
    f = tmp_path / "catalogue.toml"
    f.write_text(toml)
    from conftest import Harness
    h = Harness(tmp_path, vendor, catalogue_file=f)
    assert "£249" in h.client().get("/pricing").text
    # A Stripe price at the old amount no longer sells; stripe_setup makes the new one.
    h.shop.cat.prices[h.price[("plan", "venue", "month")]]["amount"] = 22900
    assert h.shop.cat.price_id("plan", "venue", "month") is None
    assert "plan:venue/month" in h.shop.cat.missing_prices()


def test_security_headers(h):
    r = h.client().get("/")
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp and "'unsafe-eval'" not in csp
    assert "script-src 'self';" in csp  # no inline scripts, nothing from elsewhere
    assert "form-action 'self' https://checkout.stripe.com https://billing.stripe.com;" in csp
    assert r.headers["x-frame-options"] == "DENY"
    assert h.client().get("/login").headers["cache-control"] == "no-store"
    # No inline <script> anywhere (they'd be blocked by the CSP anyway).
    for p in PAGES[:-2]:
        assert not re.search(r"<script(?![^>]*\bsrc=)[^>]*>", h.client().get(p).text), p


def test_contact_form(h):
    c = h.client()
    r = c.post("/contact", data={"email": "lead@example.com", "name": "Lee", "kind": "sales", "subject": "Quote",
                                 "message": "We have 120 laptops across 3 sites."})
    assert r.status_code == 303
    t = h.shop.db.one("SELECT * FROM tickets")
    assert t["kind"] == "sales" and t["email"] == "lead@example.com"
    assert c.post("/contact", data={"email": "x@example.com", "subject": "", "message": "short"}).status_code == 400
    # A bot that fills the hidden field is thanked and ignored.
    c.post("/contact", data={"website": "spam", "email": "b@example.com", "subject": "Hi", "message": "Buy my stuff now"})
    assert h.shop.db.one("SELECT COUNT(*) n FROM tickets")["n"] == 1


def test_live_billing_needs_approval(tmp_path, vendor):
    s = make_settings(tmp_path, vendor, stripe_secret_key="sk_live_abc")
    assert s.stripe_mode == "live" and s.prices_file.name == "stripe-prices.live.json"
    with pytest.raises(config.ConfigError, match="SHOP_ALLOW_LIVE"):
        s.check()
    s.allow_live = True
    s.check()
    with pytest.raises(config.ConfigError, match="SHOP_ALLOW_LIVE"):
        make_settings(tmp_path, vendor, stripe_secret_key="rk_live_abc").check()  # restricted keys too
    t = make_settings(tmp_path, vendor)
    assert t.stripe_mode == "test" and t.prices_file.name == "stripe-prices.test.json"
    assert t.stripe_base == "https://api.stripe.com"
    with pytest.raises(config.ConfigError, match="SHOP_SECRET"):
        make_settings(tmp_path, vendor, secret="short").check()


def test_keys_are_checked(tmp_path, vendor):
    for over, msg in (({"stripe_secret_key": "pk_test_abc"}, "publishable"),
                      ({"stripe_webhook_secret": "abc"}, "whsec_")):
        with pytest.raises(config.ConfigError, match=msg):
            make_settings(tmp_path, vendor, **over).check()
    make_settings(tmp_path, vendor, stripe_secret_key="rk_test_abc").check()
    make_settings(tmp_path, vendor, stripe_secret_key="").check()  # billing simply off


def test_settings_from_environment(monkeypatch, tmp_path):
    (tmp_path / "api").write_text("sk_test_from_file\n")
    monkeypatch.setenv("STRIPE_SECRET_KEY_FILE", str(tmp_path / "api"))
    monkeypatch.setenv("ADMIN_EMAILS", "A@Example.com, b@example.com")
    monkeypatch.setenv("SITE_URL", "https://www.example.com/")
    monkeypatch.setenv("STRIPE_TAX", "yes")
    s = config.load()
    assert s.stripe_secret_key == "sk_test_from_file"
    assert s.admin_emails == {"a@example.com", "b@example.com"}
    assert s.site_url == "https://www.example.com" and s.secure_cookies and s.stripe_mode == "test"
    assert s.stripe_tax and s.stripe_webhook_ip_check


def test_signing_key_must_be_private(tmp_path, vendor):
    open_key = tmp_path / "open.pem"
    open_key.write_bytes(vendor["file"].read_bytes())
    os.chmod(open_key, 0o644)
    with pytest.raises(SigningError, match="chmod 600"):
        Signer(str(open_key)).sign(licensee="X", edition="venue", max_nodes=1, expires=0)
    with pytest.raises(SigningError, match="not set"):
        Signer("").sign(licensee="X", edition="venue", max_nodes=1, expires=0)
    assert not Signer("").ready and Signer(str(vendor["file"])).ready


def test_no_private_keys_in_the_website_folder():
    for f in (ROOT / "website").rglob("*"):
        if f.is_file() and f.suffix not in (".png", ".jpg", ".ico", ".ttf", ".pyc"):
            assert "PRIVATE KEY-----" not in f.read_text(errors="ignore") or f.name.startswith("test_"), f


def test_catalogue_matches_the_licence_tool():
    """Plans sold here sign keys with the same laptop limits tools/licence.py uses."""
    spec = importlib.util.spec_from_file_location("licence_tool", ROOT / "tools" / "licence.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    cat = catalogue.load(ROOT / "website" / "catalogue.toml")
    for p in cat.plan_list:
        assert tool.PLANS[p.licence_plan]["nodes"] == p.laptops, p.key
        assert p.yearly < p.monthly * 12, f"{p.key}: yearly should cost less than 12 months"
    assert tool.PLANS[cat.event["licence_plan"]] == {"nodes": cat.event["laptops"], "days": cat.event["days"]}
    assert tool.PLANS[cat.trial["licence_plan"]] == {"nodes": cat.trial["laptops"], "days": cat.trial["days"]}
    assert cat.spare_days == tool.SPARE_DAYS


def test_reminders_for_keys_that_will_not_renew(h):
    c = h.sign_in("try@example.com")
    c.post("/account/trial", data={"csrf": h.csrf(c)})
    lic = h.shop.db.one("SELECT * FROM licences")
    h.shop.db.run("UPDATE licences SET expires=? WHERE id=?", int(time.time()) + 5 * 86400, lic["id"])
    assert jobs.reminders(h.shop) == 1
    jobs.reminders(h.shop)  # once only
    subjects = [r["subject"] for r in h.shop.db.all("SELECT subject FROM emails WHERE to_addr='try@example.com'")]
    assert subjects.count("AT SUITE: your licence ends in 7 days") == 1


def _setup_tool():
    spec = importlib.util.spec_from_file_location("stripe_setup", ROOT / "website" / "tools" / "stripe_setup.py")
    tool = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tool)
    return tool


def test_stripe_setup_creates_prices_once_and_keeps_old_ones(tmp_path, vendor, capsys):
    tool = _setup_tool()
    s = make_settings(tmp_path, vendor)
    fake = FakeStripe()
    t = httpx.MockTransport(fake)
    assert tool.main([], settings=s, transport=t) == 0  # a dry run changes nothing
    assert not fake.prices and not s.prices_file.exists() and not fake.portal_configs
    assert tool.main(["--apply"], settings=s, transport=t) == 0
    assert len(fake.products) == 5 and len(fake.prices) == 9 and len(fake.portal_configs) == 1
    assert all(p["tax_code"] == "txcd_10103001" for p in fake.products.values())
    venue_year = next(b for b in fake.prices.values() if b["nickname"] == "AT SUITE Venue (yearly)")
    assert venue_year["unit_amount"] == "229000" and venue_year["currency"] == "gbp"
    assert venue_year["recurring[interval]"] == "year" and venue_year["tax_behavior"] == "exclusive"
    assert venue_year["metadata[kind]"] == "plan" and venue_year["metadata[key]"] == "venue"
    event = next(b for b in fake.prices.values() if "Event" in b["nickname"])
    assert "recurring[interval]" not in event
    cat = catalogue.load(s.catalogue_file, s.prices_file)
    assert cat.missing_prices() == []
    assert tool.main(["--apply"], settings=s, transport=t) == 0 and len(fake.prices) == 9  # nothing new
    assert len(fake.portal_configs) == 1

    # A price rise makes one new price and keeps the old one mapped (existing subscribers renew on it).
    f = tmp_path / "catalogue.toml"
    f.write_text((ROOT / "website" / "catalogue.toml").read_text().replace("yearly = 2290", "yearly = 2490"))
    s.catalogue_file = f
    old_id = cat.price_id("plan", "venue", "year")
    assert tool.main(["--apply", "--archive-old"], settings=s, transport=t) == 0
    cat = catalogue.load(s.catalogue_file, s.prices_file)
    assert len(fake.prices) == 10 and fake.prices[old_id]["active"] == "false"
    assert cat.lookup(old_id)["key"] == "venue" and cat.lookup(old_id)["active"] is False
    assert cat.price_id("plan", "venue", "year") != old_id


def test_stripe_setup_reads_the_account_first_and_maps_test_to_live(tmp_path, vendor, capsys):
    tool = _setup_tool()
    test, live = FakeStripe(), FakeStripe("sk_live_fake")
    s = make_settings(tmp_path, vendor)
    assert tool.main(["--apply"], settings=s, transport=httpx.MockTransport(test)) == 0
    s_live = make_settings(tmp_path, vendor, stripe_secret_key="sk_live_fake", allow_live=True)
    assert tool.main(["--apply"], settings=s_live, transport=httpx.MockTransport(live)) == 0
    assert len(live.prices) == 9
    out = capsys.readouterr().out
    venue_year_test = catalogue.load(s.catalogue_file, s.prices_file).price_id("plan", "venue", "year")
    venue_year_live = catalogue.load(s.catalogue_file, s_live.prices_file).price_id("plan", "venue", "year")
    assert venue_year_test != venue_year_live and f"{venue_year_test}" in out and f"→ {venue_year_live}" in out

    # Run again from another computer (no prices file): what's in Stripe is recorded, nothing is made twice.
    s_live.prices_file.unlink()
    live.prices["price_byhand"] = {"product": "prod_x", "nickname": "Made by hand", "unit_amount": "500",
                                   "currency": "gbp", "active": "true"}
    assert tool.main([], settings=s_live, transport=httpx.MockTransport(live)) == 0
    assert not s_live.prices_file.exists()  # a dry run still saves nothing
    assert tool.main(["--apply"], settings=s_live, transport=httpx.MockTransport(live)) == 0
    assert len(live.prices) == 10 and len(live.products) == 5
    out = capsys.readouterr().out
    assert "left alone price_byhand" in out and "Stripe already matches catalogue.toml" in out
    assert catalogue.load(s.catalogue_file, s_live.prices_file).price_id("plan", "venue", "year") == venue_year_live


def test_stripe_setup_makes_the_webhook_once(tmp_path, vendor, capsys):
    tool = _setup_tool()
    fake = FakeStripe()
    s = make_settings(tmp_path, vendor)
    url = "https://www.example.com/webhooks/stripe"
    assert tool.main(["--webhook", url], settings=s, transport=httpx.MockTransport(fake)) == 0
    assert not fake.webhooks and "would make" in capsys.readouterr().out
    assert tool.main(["--apply", "--webhook", url], settings=s, transport=httpx.MockTransport(fake)) == 0
    assert len(fake.webhooks) == 1 and "whsec_new" in capsys.readouterr().out
    body = fake.webhooks[0]["body"]
    from atshop import stripe
    assert body["api_version"] == stripe.API_VERSION
    assert sorted(v for k, v in body.items() if k.startswith("enabled_events[")) == sorted(stripe.WEBHOOK_EVENTS)
    assert tool.main(["--apply", "--webhook", url], settings=s, transport=httpx.MockTransport(fake)) == 0
    assert len(fake.webhooks) == 1 and "already exists" in capsys.readouterr().out


def test_stripe_setup_refuses_live_without_approval(tmp_path, vendor):
    tool = _setup_tool()
    s = make_settings(tmp_path, vendor, stripe_secret_key="sk_live_x")
    with pytest.raises(config.ConfigError):
        tool.main(["--apply"], settings=s, transport=httpx.MockTransport(FakeStripe()))


def test_the_app_starts_from_the_environment(tmp_path, vendor):
    """`uvicorn atshop.app:app` with the variables from .env.example."""
    env = {**os.environ, "SHOP_SECRET": "x" * 40, "SHOP_DATA": str(tmp_path / "d"),
           "LICENCE_SIGNING_KEY_FILE": str(vendor["file"]), "PYTHONPATH": str(ROOT / "website")}
    code = ("from fastapi.testclient import TestClient; from atshop.app import app; "
            "r = TestClient(app).get('/api/health'); print(r.json())")
    out = subprocess.run(["python3", "-c", code], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "'signing': True" in out.stdout and "'billing': 'off'" in out.stdout


def test_paddle_era_database_moves_to_stripe(tmp_path):
    """A shop database made before the switch keeps its accounts and keys; the Paddle sandbox ids go."""
    import sqlite3
    from atshop import db as dbmod
    f = tmp_path / "shop.db"
    old = sqlite3.connect(f)
    for stmt in dbmod.MIGRATIONS[0].split(";"):
        if stmt.strip():
            old.execute(stmt)
    old.execute("INSERT INTO accounts (email, paddle_customer_id, created_at) VALUES ('a@example.com', 'ctm_1', 1)")
    old.execute("INSERT INTO orders (ref, account_id, kind, paddle_transaction_id, created_at) VALUES ('r1', 1, 'event', 'txn_1', 1)")
    old.execute("PRAGMA user_version=1")
    old.commit()
    old.close()
    d = dbmod.DB(f)
    acc = d.one("SELECT * FROM accounts")
    assert acc["email"] == "a@example.com" and acc["stripe_customer_id"] is None
    assert d.one("SELECT stripe_session_id FROM orders")["stripe_session_id"] == "txn_1"
    assert "stripe_customer_id" in [r["name"] for r in d.all("PRAGMA table_info(subscriptions)")]
    assert d.one("PRAGMA user_version")[0] == len(dbmod.MIGRATIONS)
