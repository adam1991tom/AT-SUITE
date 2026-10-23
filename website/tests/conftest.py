"""Test set-up: a throwaway signing key (never the real one), a fake Stripe and a fake hosting server."""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import time
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from urllib.parse import parse_qsl  # noqa: E402

from atshop import config, stripe  # noqa: E402
from atshop.app import create_app  # noqa: E402
from atshop.licensing import b64  # noqa: E402

WEBHOOK_SECRET = "whsec_test_" + "x" * 32
ADMIN = "boss@example.com"


@pytest.fixture
def vendor(tmp_path):
    """A throwaway vendor key pair, written the way the real one is kept (mode 600)."""
    priv = Ed25519PrivateKey.generate()
    f = tmp_path / "vendor-test.pem"
    f.write_bytes(priv.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption()))
    os.chmod(f, 0o600)
    pub = b64(priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    return {"file": f, "pub": pub}


class FakeStripe:
    """Enough of Stripe's API for the shop, kept in memory. Bodies are form-encoded, as Stripe's are."""

    def __init__(self, key: str = "sk_test_fake"):
        self.key = key
        self.calls: list[tuple[str, str, dict]] = []
        self.customers: dict[str, str] = {}
        self.sessions: dict[str, dict] = {}
        self.products: dict[str, dict] = {}
        self.prices: dict[str, dict] = {}
        self.subscriptions: dict[str, list[str]] = {}  # sub id → price ids on it
        self.updates: list[dict] = []
        self.portal: list[dict] = []
        self.portal_configs: list[str] = []
        self.webhooks: list[dict] = []
        self.fail_next: tuple[int, str] | None = None
        self.ips: list[str] | None = ["3.18.12.63", "54.187.174.169"]  # None: the list is down

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path, m = request.url.path, request.method
        if request.url.host == "stripe.com":
            self.calls.append((m, path, {}))
            assert "authorization" not in request.headers  # no key sent with the public list
            if self.ips is None:
                return httpx.Response(502, text="bad gateway")
            return httpx.Response(200, json={"WEBHOOKS": self.ips})
        body = dict(parse_qsl(request.content.decode())) if request.content else dict(request.url.params)
        self.calls.append((m, path, body))
        assert request.headers["authorization"] == f"Bearer {self.key}"
        assert request.headers["stripe-version"] == stripe.API_VERSION
        if self.fail_next:
            status, code = self.fail_next
            self.fail_next = None
            return httpx.Response(status, json={"error": {"code": code, "message": "nope"}})
        if m == "GET" and path == "/v1/customers":
            e = body["email"]
            return httpx.Response(200, json={"data": [{"id": self.customers[e]}] if e in self.customers else []})
        if m == "POST" and path == "/v1/customers":
            cid = "cus_" + secrets.token_hex(7)
            self.customers[body["email"]] = cid
            return httpx.Response(200, json={"id": cid})
        if m == "POST" and path == "/v1/checkout/sessions":
            sid = "cs_test_" + secrets.token_hex(8)
            self.sessions[sid] = {**body, "idempotency_key": request.headers.get("idempotency-key")}
            return httpx.Response(200, json={"id": sid, "url": f"https://checkout.stripe.com/c/pay/{sid}"})
        if m == "GET" and path == "/v1/invoices":
            return httpx.Response(200, json={"data": []})
        if m == "GET" and re.fullmatch(r"/v1/invoices/in_\w+", path):
            iid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"id": iid, "hosted_invoice_url": f"https://invoice.stripe.com/i/{iid}"})
        if m == "GET" and re.fullmatch(r"/v1/subscriptions/sub_\w+", path):
            sid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"id": sid, "items": {"data": [
                {"id": f"si_{n}", "price": {"id": p}} for n, p in enumerate(self.subscriptions.get(sid, []))]}})
        if m == "POST" and re.fullmatch(r"/v1/subscriptions/sub_\w+", path):
            self.updates.append({"id": path.rsplit("/", 1)[1], **body})
            return httpx.Response(200, json={"id": path.rsplit("/", 1)[1]})
        if m == "POST" and path == "/v1/billing_portal/sessions":
            self.portal.append(body)
            return httpx.Response(200, json={"url": "https://billing.stripe.com/p/session/test_abc"})
        if m == "GET" and path == "/v1/billing_portal/configurations":
            return httpx.Response(200, json={"data": [{"id": c} for c in self.portal_configs]})
        if m == "POST" and path == "/v1/billing_portal/configurations":
            self.portal_configs.append("bpc_" + secrets.token_hex(6))
            return httpx.Response(200, json={"id": self.portal_configs[-1]})
        if m == "GET" and path == "/v1/webhook_endpoints":
            return httpx.Response(200, json={"data": self.webhooks, "has_more": False})
        if m == "POST" and path == "/v1/webhook_endpoints":
            self.webhooks.append({"id": "we_" + secrets.token_hex(6), "url": body["url"], "body": body})
            return httpx.Response(200, json={**self.webhooks[-1], "secret": "whsec_new"})
        if m == "POST" and path == "/v1/products":
            pid = "prod_" + secrets.token_hex(7)
            self.products[pid] = body
            return httpx.Response(200, json={"id": pid})
        if m == "POST" and path == "/v1/prices":
            pid = "price_" + secrets.token_hex(8)
            self.prices[pid] = {**body, "active": "true"}
            return httpx.Response(200, json={"id": pid})
        if m == "GET" and path == "/v1/prices":
            rows = [{"id": pid, "product": b["product"], "nickname": b.get("nickname"), "active": True,
                     "unit_amount": int(b["unit_amount"]), "currency": b["currency"],
                     "recurring": {"interval": b["recurring[interval]"]} if "recurring[interval]" in b else None,
                     "metadata": {k[9:-1]: v for k, v in b.items() if k.startswith("metadata[")}}
                    for pid, b in self.prices.items() if b.get("active") == "true"]
            after = body.get("starting_after")
            if after:
                rows = rows[[r["id"] for r in rows].index(after) + 1:]
            return httpx.Response(200, json={"data": rows[:3], "has_more": len(rows) > 3})  # small pages, to test paging
        if m == "POST" and re.fullmatch(r"/v1/prices/price_\w+", path):
            self.prices[path.rsplit("/", 1)[1]]["active"] = body["active"]
            return httpx.Response(200, json={})
        return httpx.Response(404, json={"error": {"code": "resource_missing", "message": f"{m} {path}"}})


class FakeHosting:
    """Stands in for `ssh host atcloud ...`: records the commands and answers like atcloud."""

    def __init__(self):
        self.runs: list[tuple[list[str], str | None]] = []
        self.fail = False

    def __call__(self, argv, stdin):
        self.runs.append((argv, stdin))
        if self.fail:
            return 1, "atcloud: something broke"
        if argv[1] == "new":
            return 0, f"Venue ready.\nOpen https://{argv[2]}.venues.example/setup#code=ABC123 to finish set-up.\n"
        return 0, "ok"


def make_settings(tmp_path, vendor, **over) -> config.Settings:
    s = config.Settings(
        site_url="http://testserver", data_dir=tmp_path / "data", secret="s" * 40, dev=False,
        stripe_secret_key="sk_test_fake", stripe_webhook_secret=WEBHOOK_SECRET, signing_key_file=str(vendor["file"]),
        admin_emails={ADMIN}, hosting_domain="venues.example",
        stripe_webhook_ip_check=False)  # TestClient isn't one of Stripe's addresses; test_webhooks turns it on
    for k, v in over.items():
        setattr(s, k, v)
    return s


def seed_prices(s: config.Settings) -> dict:
    """Stripe price ids for every catalogue item, as tools/stripe_setup.py would save them."""
    from atshop import catalogue
    cat = catalogue.load(s.catalogue_file, s.prices_file)
    ids = {}
    for kind, key, cycle, _, amount in cat.items():
        pid = f"price_{kind}_{key}_{cycle or 'once'}"
        cat.prices[pid] = {"kind": kind, "key": key, "cycle": cycle, "amount": amount * 100, "currency": "GBP",
                           "active": True}
        ids[(kind, key, cycle)] = pid
    cat.save_prices()
    return ids


class Harness:
    def __init__(self, tmp_path, vendor, **over):
        self.stripe = FakeStripe()
        self.hosting = FakeHosting()
        self.health = httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True, "version": "1.8.0"}))
        self.s = make_settings(tmp_path, vendor, **over)
        self.s.data_dir.mkdir(parents=True, exist_ok=True)
        self.price = seed_prices(self.s)
        self.app = create_app(self.s, stripe_transport=httpx.MockTransport(self.stripe),
                              hosting_runner=self.hosting, health_transport=self.health, background=False)
        self.shop = self.app.state.shop
        self.vendor = vendor
        self.n = 0

    def client(self) -> TestClient:
        return TestClient(self.app, follow_redirects=False)

    # -- sign-in through the emailed link, like a customer would --
    def last_link(self, email: str) -> str:
        row = self.shop.db.one("SELECT body FROM emails WHERE to_addr=? AND kind='login' ORDER BY id DESC LIMIT 1", email)
        m = re.search(r"http://testserver(/login/confirm\S*#token=[\w-]+)", row["body"])
        return m.group(1)

    def sign_in(self, email: str, name: str = "Sam Tech", organisation: str = "Grand Hall") -> TestClient:
        c = self.client()
        exists = self.shop.db.one("SELECT 1 FROM accounts WHERE email=?", email)
        if exists:
            r = c.post("/login", data={"email": email})
        else:
            r = c.post("/register", data={"email": email, "name": name, "organisation": organisation, "terms": "1"})
        assert r.status_code == 200, r.text
        link = self.last_link(email)
        token = re.search(r"token=([\w-]+)", link).group(1)
        r = c.post("/login/confirm", data={"token": token, "next": "/account"})
        assert r.status_code == 303, r.text
        return c

    def csrf(self, c: TestClient, page: str = "/account") -> str:
        r = c.get(page)
        m = re.search(r'name="csrf" value="([^"]+)"', r.text)
        assert m, f"no csrf on {page}"
        return m.group(1)

    # -- Stripe webhooks, signed with the test secret --
    def event(self, etype: str, obj: dict, *, event_id: str | None = None, created: int | None = None) -> dict:
        self.n += 1
        return {"id": event_id or f"evt_{self.n:04d}{secrets.token_hex(4)}", "object": "event", "type": etype,
                "created": created or T0 + self.n, "livemode": False, "api_version": stripe.API_VERSION,
                "data": {"object": obj}}

    def send(self, event: dict, *, secret: str = WEBHOOK_SECRET, ts: int | None = None, client=None):
        raw = json.dumps(event).encode()
        c = client or self.client()
        return c.post("/webhooks/stripe", content=raw, headers={
            "Stripe-Signature": stripe.sign(raw, secret, ts or int(time.time())), "Content-Type": "application/json"})

    def session_of(self, order) -> dict:
        """What the shop asked Stripe Checkout for, for this order."""
        return self.stripe.sessions[order["stripe_session_id"]]


@pytest.fixture
def h(tmp_path, vendor) -> Harness:
    return Harness(tmp_path, vendor)


T0 = 1792065600  # 2026-10-15T12:00:00Z
YEAR = 1823601600  # 2027-10-15T12:00:00Z


def ts(iso: str) -> int:
    from datetime import datetime
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())


def sub_data(sub_id, customer, prices, *, status="active", start="2026-10-15T12:00:00Z", end="2027-10-15T12:00:00Z",
             account_id=None, cancel_at_period_end=False, metadata=None, basil=True):
    """A Stripe subscription. basil=True puts the period on the items, as API 2025-03-31.basil onwards does."""
    period = {"current_period_start": ts(start), "current_period_end": ts(end)}
    d = {"id": sub_id, "object": "subscription", "status": status, "customer": customer,
         "items": {"object": "list", "data": [{"id": f"si_{n}", "price": {"id": p}, "quantity": 1,
                                               **(period if basil else {})} for n, p in enumerate(prices)]},
         "cancel_at_period_end": cancel_at_period_end, "cancel_at": ts(end) if cancel_at_period_end else None,
         "metadata": metadata or ({"account_id": str(account_id)} if account_id else {})}
    if not basil:
        d.update(period)
    return d


def invoice_data(inv_id, customer, prices, *, sub_id=None, start="2026-10-15T12:00:00Z", end="2027-10-15T12:00:00Z",
                 metadata=None, billing_reason="subscription_create", total=229000, basil=True, credit=None):
    """A paid Stripe invoice. basil=True uses the newer shape (parent, line pricing); otherwise the older one.
    credit: a price refunded for unused time (a negative line), as on a plan change."""
    def line(p, amount):
        ln = {"id": f"il_{p}", "amount": amount, "description": f"1 × {p}",
              "period": {"start": ts(start), "end": ts(end)}}
        if basil:
            ln["pricing"] = {"type": "price_details", "price_details": {"price": p, "product": "prod_x"}}
        else:
            ln["price"] = {"id": p}
        return ln
    lines = ([line(credit, -1000)] if credit else []) + [line(p, total // max(len(prices), 1)) for p in prices]
    d = {"id": inv_id, "object": "invoice", "status": "paid", "customer": customer, "currency": "gbp", "total": total,
         "billing_reason": billing_reason if sub_id else "manual", "created": ts(start),
         "status_transitions": {"paid_at": ts(start)}, "lines": {"object": "list", "data": lines},
         "metadata": {} if sub_id else (metadata or {})}
    if sub_id:
        if basil:
            d["parent"] = {"type": "subscription_details",
                           "subscription_details": {"subscription": sub_id, "metadata": metadata or {}}}
        else:
            d["subscription"] = sub_id
            d["subscription_details"] = {"metadata": metadata or {}}
    return d


def session_data(session_id, customer, *, mode="subscription", metadata=None, payment_status="paid", invoice=None):
    return {"id": session_id, "object": "checkout.session", "mode": mode, "customer": customer,
            "payment_status": payment_status, "status": "complete", "metadata": metadata or {}, "invoice": invoice,
            "subscription": None}
