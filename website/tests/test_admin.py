"""Admin: who can get in, the second factor, hand-issued keys, hosting jobs and the audit log."""
from __future__ import annotations

import re
import time
from datetime import date, timedelta

from atshop import auth, hosting

from conftest import ADMIN, Harness, invoice_data, session_data, sub_data
from test_journey import server_licence  # noqa: F401 (a fixture)


def admin_client(h):
    c = h.sign_in(ADMIN, name="Adam", organisation="AT SUITE")
    r = c.get("/admin")
    assert r.status_code == 303 and r.headers["location"] == "/admin/2fa"
    page = c.get("/admin/2fa").text
    secret = re.search(r'id="secret">([A-Z2-7]+)<', page).group(1)
    csrf = re.search(r'name="csrf" value="([^"]+)"', page).group(1)
    assert c.post("/admin/2fa", data={"csrf": csrf, "code": "000000" if auth.totp(secret) != "000000" else "111111"}
                  ).status_code == 400
    r = c.post("/admin/2fa", data={"csrf": csrf, "code": auth.totp(secret)})
    assert r.status_code == 303 and r.headers["location"] == "/admin"
    return c, secret


def test_customers_cannot_open_admin(h):
    c = h.sign_in("customer@example.com")
    assert c.get("/admin").status_code == 403
    assert c.get("/admin/licences").status_code == 403
    assert c.post("/admin/licences/issue", data={"csrf": h.csrf(c)}).status_code == 403
    assert h.client().get("/admin").status_code == 303  # signed out: to the sign-in page


def test_admin_needs_the_second_factor_every_session(h):
    c, secret = admin_client(h)
    assert c.get("/admin").status_code == 200
    for page in ("/admin/customers", "/admin/licences", "/admin/plans", "/admin/hosting", "/admin/tickets",
                 "/admin/events", "/admin/emails", "/admin/audit"):
        assert c.get(page).status_code == 200, page
    # A fresh sign-in asks for the code again; the secret is kept, not shown again.
    c2 = h.sign_in(ADMIN)
    assert c2.get("/admin").headers["location"] == "/admin/2fa"
    assert secret not in c2.get("/admin/2fa").text
    stored = h.shop.db.one("SELECT totp_secret FROM accounts WHERE email=?", ADMIN)["totp_secret"]
    assert stored == secret


def test_an_admins_other_address_signs_in_to_the_same_account(tmp_path, vendor):
    h = Harness(tmp_path, vendor, email_aliases={"me@other.example": ADMIN})
    c, _ = admin_client(h)
    first = h.shop.db.one("SELECT id FROM accounts WHERE email=?", ADMIN)["id"]
    c2 = h.client()
    assert c2.post("/login", data={"email": "Me@Other.example"}).status_code == 200
    link = h.last_link("me@other.example")  # the link goes to the address typed
    token = re.search(r"token=([\w-]+)", link).group(1)
    assert c2.post("/login/confirm", data={"token": token, "next": "/account"}).status_code == 303
    assert c2.get("/admin").headers["location"] == "/admin/2fa"  # an admin, still with the second factor
    assert h.shop.db.one("SELECT COUNT(*) n FROM accounts")["n"] == 1
    assert h.shop.db.one("SELECT id FROM accounts WHERE email=?", ADMIN)["id"] == first


def test_totp_matches_rfc6238():
    # RFC 6238 test vector (SHA-1, 8 digits at T=59 → 94287082); our 6-digit code is its last 6 digits.
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # base32 of "12345678901234567890"
    assert auth.totp(secret, at=59) == "287082"
    assert auth.totp_ok(secret, auth.totp(secret, at=time.time() - 30))
    assert not auth.totp_ok(secret, "12345")


def test_manual_key_is_audited_and_needs_a_reason(h):
    c, _ = admin_client(h)
    csrf = h.csrf(c, "/admin/licences")
    until = (date.today() + timedelta(days=365)).isoformat()
    base = {"csrf": csrf, "email": "bigco@example.com", "licensee": "Big Co", "edition": "enterprise", "nodes": "200",
            "sites": "3", "until": until}
    assert c.post("/admin/licences/issue", data=base).status_code == 400  # no note
    r = c.post("/admin/licences/issue", data={**base, "note": "Enterprise deal, signed PO 1234", "send": "1"})
    assert r.status_code == 303
    lic = h.shop.db.one("SELECT * FROM licences WHERE source='manual'")
    assert lic["max_nodes"] == 200 and lic["max_sites"] == 3 and lic["licensee"] == "Big Co"
    assert h.shop.signer.verify(lic["key"])["edition"] == "enterprise"
    rows = h.shop.db.all("SELECT * FROM audit WHERE target=?", lic["serial"])
    assert {r["action"] for r in rows} >= {"licence.issue", "admin.licence_issue"}
    assert all(r["actor"] == ADMIN for r in rows)
    # It checks in with this website every day, like every key made here...
    assert h.shop.signer.verify(lic["key"])["checkin"] == h.shop.s.site_url
    # ...and revoking it tells the server at its next check-in, and is logged too.
    c.post(f"/admin/licences/{lic['serial']}/revoke", data={"csrf": csrf, "reason": "test"})
    assert h.shop.db.one("SELECT revoked_at FROM licences WHERE id=?", lic["id"])["revoked_at"]
    assert h.client().post("/api/v1/licence/refresh", json={"key": lic["key"]}).json()["status"] == "revoked"


def test_offline_key_never_checks_in(h, server_licence):
    c, _ = admin_client(h)
    csrf = h.csrf(c, "/admin/licences")
    until = (date.today() + timedelta(days=365)).isoformat()
    r = c.post("/admin/licences/issue", data={"csrf": csrf, "email": "nda@example.com", "licensee": "NDA Venue",
                                              "edition": "venue", "nodes": "30", "sites": "1", "until": until,
                                              "note": "No internet at this venue", "offline": "1"})
    assert r.status_code == 303
    lic = h.shop.db.one("SELECT * FROM licences WHERE source='manual'")
    assert "checkin" not in h.shop.signer.verify(lic["key"]) and "offline" in lic["note"]
    parsed = server_licence.parse(lic["key"])
    assert parsed.valid and parsed.checkin == ""


def test_forms_without_the_right_csrf_token_are_refused(h):
    c = h.sign_in("customer@example.com")
    assert c.post("/account/details", data={"name": "X"}).status_code == 403
    assert c.post("/account/details", data={"name": "X", "csrf": "wrong"}).status_code == 403
    assert c.post("/account/trial", data={}).status_code == 403
    assert c.post("/logout", data={}).status_code == 403
    assert c.post("/account/details", data={"name": "Sam", "csrf": h.csrf(c)}).status_code == 303


def test_sign_in_links_work_once_and_expire(h):
    c = h.client()
    c.post("/register", data={"email": "new@example.com", "name": "New", "terms": "1"})
    token = re.search(r"token=([\w-]+)", h.last_link("new@example.com")).group(1)
    link = h.last_link("new@example.com")
    assert link.split("#")[0] == "/login/confirm" and "?token" not in link  # the token stays out of the address
    page = c.get("/login/confirm")  # what an email scanner or the browser fetches: uses nothing up
    assert page.status_code == 200 and token not in page.text and 'id="link-token"' in page.text
    assert c.post("/login/confirm", data={"token": token}).status_code == 303
    assert h.client().post("/login/confirm", data={"token": token}).status_code == 400  # used
    c.post("/login", data={"email": "new@example.com"})
    token = re.search(r"token=([\w-]+)", h.last_link("new@example.com")).group(1)
    h.shop.db.run("UPDATE login_tokens SET expires_at=?", int(time.time()) - 1)
    assert h.client().post("/login/confirm", data={"token": token}).status_code == 400  # expired
    # Unknown addresses get the same answer and no email; links can't bounce to another site.
    r = h.client().post("/login", data={"email": "stranger@example.com"})
    assert r.status_code == 200 and "Check your email" in r.text
    assert not h.shop.db.one("SELECT 1 FROM emails WHERE to_addr='stranger@example.com'")
    from atshop.web import safe_next
    assert safe_next("//evil.example") == "/account" and safe_next("https://evil.example") == "/account"


def _hosted_customer(h):
    c = h.sign_in("ops@grandhall.example")
    csrf = h.csrf(c, "/buy?plan=venue&cycle=year&hosting=1")
    assert c.post("/buy", data={"csrf": csrf, "kind": "subscription", "plan": "venue", "cycle": "year", "hosting": "1",
                                "venue_slug": "admin", "venue_name": "Grand Hall"}).status_code == 400  # reserved
    r = c.post("/buy", data={"csrf": csrf, "kind": "subscription", "plan": "venue", "cycle": "year", "hosting": "1",
                             "venue_slug": "grand-hall", "venue_name": "Grand Hall"})
    assert r.status_code == 303
    order = h.shop.db.one("SELECT * FROM orders ORDER BY id DESC")
    prices = [h.price[("plan", "venue", "year")], h.price[("addon", "hosting", "year")]]
    sent = h.session_of(order)
    assert [sent["line_items[0][price]"], sent["line_items[1][price]"]] == prices
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])
    md = {"account_id": str(acc["id"]), "order_ref": order["ref"]}
    h.send(h.event("customer.subscription.created", sub_data("sub_h", acc["stripe_customer_id"], prices, metadata=md)))
    h.send(h.event("checkout.session.completed", session_data(order["stripe_session_id"], acc["stripe_customer_id"],
                                                              metadata=md)))
    h.send(h.event("invoice.paid", invoice_data("in_1", acc["stripe_customer_id"], prices, sub_id="sub_h", metadata=md)))
    return c, acc, prices


def test_hosting_manual_mode(h):
    c, acc, prices = _hosted_customer(h)
    venue = h.shop.db.one("SELECT * FROM hosting WHERE slug='grand-hall'")
    assert venue["status"] == "pending"
    job = h.shop.db.one("SELECT * FROM hosting_jobs WHERE hosting_id=?", venue["id"])
    lic = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_h'")
    assert job["action"] == "new" and job["licence_serial"] == lic["serial"]
    assert hosting.run_pending(h.shop.db, h.s, h.hosting) == 0  # manual: the shop runs nothing itself
    admin, _ = admin_client(h)
    page = admin.get("/admin/hosting").text
    assert "atcloud new grand-hall --name &#39;Grand Hall&#39; --licence grand-hall-key.txt" in page \
        or "atcloud new grand-hall --name 'Grand Hall' --licence grand-hall-key.txt" in page
    assert admin.get(f"/admin/hosting/jobs/{job['id']}/key.txt").text.strip() == lic["key"]
    out = "Grand Hall is ready\n  https://grand-hall.venues.example/setup?code=XYZ\n"
    admin.post(f"/admin/hosting/jobs/{job['id']}/done", data={"csrf": h.csrf(admin, "/admin/hosting"), "output": out})
    venue = h.shop.db.one("SELECT * FROM hosting WHERE id=?", venue["id"])
    assert venue["status"] == "active" and venue["setup_link"].endswith("/setup?code=XYZ")
    # The customer sees their venue and whether it's up.
    page = c.get("/account").text
    assert "grand-hall.venues.example" in page


def test_hosting_ssh_mode_runs_atcloud_with_the_key_on_stdin(tmp_path, vendor):
    h = Harness(tmp_path, vendor, hosting_mode="ssh", hosting_ssh="atcloud@hosting.example")
    c, acc, prices = _hosted_customer(h)
    assert hosting.run_pending(h.shop.db, h.s, h.hosting) == 1
    argv, stdin = h.hosting.runs[0]
    lic = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_h'")
    assert argv == ["atcloud", "new", "grand-hall", "--name", "Grand Hall", "--licence", "/dev/stdin"]
    assert stdin == lic["key"]  # never on the command line
    venue = h.shop.db.one("SELECT * FROM hosting WHERE slug='grand-hall'")
    assert venue["status"] == "active" and "setup#code=ABC123" in venue["setup_link"]
    # A renewal sends the new key to the venue.
    h.send(h.event("invoice.paid", invoice_data("in_2", acc["stripe_customer_id"], prices, sub_id="sub_h",
                                                start="2027-10-15T12:00:00Z", end="2028-10-15T12:00:00Z",
                                                billing_reason="subscription_cycle")))
    assert hosting.run_pending(h.shop.db, h.s, h.hosting) == 1
    argv, stdin = h.hosting.runs[1]
    new = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_h' AND replaced_by IS NULL")
    assert argv == ["atcloud", "licence", "grand-hall", "/dev/stdin"] and stdin == new["key"]
    # A failed run is kept for a retry, not lost.
    h.hosting.fail = True
    admin, _ = admin_client(h)
    admin.post(f"/admin/hosting/{venue['id']}/suspend", data={"csrf": h.csrf(admin, "/admin/hosting")})
    hosting.run_pending(h.shop.db, h.s, h.hosting)
    assert h.shop.db.one("SELECT status FROM hosting_jobs ORDER BY id DESC")["status"] == "failed"
    assert h.shop.db.one("SELECT status FROM hosting WHERE id=?", venue["id"])["status"] == "active"


def test_cancelled_hosted_venue_is_not_removed(h):
    c, acc, prices = _hosted_customer(h)
    h.send(h.event("customer.subscription.deleted", sub_data("sub_h", acc["stripe_customer_id"], prices, status="canceled")))
    assert h.shop.db.one("SELECT status FROM hosting WHERE slug='grand-hall'")["status"] == "pending"
    assert not h.shop.db.one("SELECT 1 FROM hosting_jobs WHERE action IN ('suspend')")
    subjects = [r["subject"] for r in h.shop.db.all("SELECT subject FROM emails WHERE to_addr=?", ADMIN)]
    assert any("grand-hall" in s and "ended" in s for s in subjects)


def test_slug_rules():
    assert hosting.check_slug("Grand-Hall") == "grand-hall"
    for bad in ("www", "-x", "x-", "a--b", "has space", "x" * 40, "admin"):
        try:
            hosting.check_slug(bad)
        except ValueError:
            continue
        raise AssertionError(bad)
