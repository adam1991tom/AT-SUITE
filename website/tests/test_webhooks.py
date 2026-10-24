"""Stripe webhooks: signatures, duplicates, the order events arrive in, and both payload shapes."""
from __future__ import annotations

import json
import time

from atshop import stripe

from conftest import T0, WEBHOOK_SECRET, Harness, invoice_data, sub_data


def test_signature_checks():
    body = b'{"id":"evt_1"}'
    now = int(time.time())
    good = stripe.sign(body, "secret", now)
    assert stripe.verify_signature(body, good, "secret")
    assert not stripe.verify_signature(body + b" ", good, "secret")  # body changed
    assert not stripe.verify_signature(body, good, "other")  # wrong secret
    assert not stripe.verify_signature(body, stripe.sign(body, "secret", now - 3600), "secret")  # replayed later
    assert not stripe.verify_signature(body, "", "secret")
    assert not stripe.verify_signature(body, good, "")  # no secret set: nothing is trusted
    assert not stripe.verify_signature(body, "t=abc,v1=00", "secret")
    # While a secret is being rolled Stripe sends two v1 values; either may match. v0 is ignored.
    rolled = f"t={now},v1=deadbeef,v1=" + good.split("v1=")[1] + ",v0=whatever"
    assert stripe.verify_signature(body, rolled, "secret")


def test_form_encoding():
    assert stripe.form({"a": {"b": [{"c": 1}, {"d": True}]}, "e": None, "f": ["x", "y"]}) == [
        ("a[b][0][c]", "1"), ("a[b][1][d]", "true"), ("f[0]", "x"), ("f[1]", "y")]


def test_unsigned_or_stale_webhooks_are_refused(h):
    ev = h.event("invoice.paid", invoice_data("in_x", "cus_x", []))
    assert h.send(ev, secret="whsec_wrong").status_code == 400
    assert h.send(ev, ts=int(time.time()) - 600).status_code == 400
    c = h.client()
    assert c.post("/webhooks/stripe", content=b"{}").status_code == 400
    assert h.shop.db.one("SELECT COUNT(*) n FROM webhook_events")["n"] == 0


def test_live_events_are_not_applied_by_a_test_shop(h):
    ev = {**h.event("invoice.paid", invoice_data("in_x", "cus_x", [])), "livemode": True}
    assert h.send(ev).status_code == 400
    assert h.shop.db.one("SELECT COUNT(*) n FROM webhook_events")["n"] == 0


def test_webhooks_only_from_stripes_published_addresses(tmp_path, vendor):
    h = Harness(tmp_path, vendor, stripe_webhook_ip_check=True)
    c = h.client()

    def send_from(addr):
        ev = h.event("customer.updated", {"id": "cus_nobody", "email": "x@example.com"})
        raw = json.dumps(ev).encode()
        return c.post("/webhooks/stripe", content=raw, headers={
            "Stripe-Signature": stripe.sign(raw, WEBHOOK_SECRET), "X-Forwarded-For": addr})

    h.stripe.ips = None  # Stripe's list can't be read yet: hold the event so Stripe retries
    assert send_from("3.18.12.63").status_code == 503
    h.stripe.ips = ["3.18.12.63", "54.187.174.169"]
    assert send_from("3.18.12.63").status_code == 200
    assert send_from("203.0.113.9").status_code == 403  # correctly signed, but not from Stripe
    assert send_from("not-an-ip").status_code == 403
    h.stripe.ips = None  # a later outage keeps the list already read
    assert send_from("54.187.174.169").status_code == 200
    assert sum(1 for m, p, _ in h.stripe.calls if p == "/files/ips/ips_webhooks.json") == 2


def _customer(h, email="buyer@example.com"):
    c = h.sign_in(email)
    acc = h.shop.db.one("SELECT * FROM accounts WHERE email=?", email)
    h.shop.db.run("UPDATE accounts SET stripe_customer_id='cus_buyer' WHERE id=?", acc["id"])
    return c, acc


def test_duplicate_delivery_issues_one_key(h):
    _, acc = _customer(h)
    venue = h.price[("plan", "venue", "year")]
    ev = h.event("invoice.paid", invoice_data("in_1", "cus_buyer", [venue], sub_id="sub_1"))
    r1, r2 = h.send(ev), h.send(ev)
    assert r1.json()["status"] == "processed"
    assert r2.json()["status"] == "duplicate"
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences WHERE account_id=?", acc["id"])["n"] == 1
    # The same payment again under a new event id still makes no second key.
    again = h.event("invoice.paid", invoice_data("in_1", "cus_buyer", [venue], sub_id="sub_1"))
    assert h.send(again).json()["status"] == "processed"
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences WHERE account_id=?", acc["id"])["n"] == 1


def test_older_subscription_event_is_skipped(h):
    _, acc = _customer(h)
    small, venue = h.price[("plan", "small", "year")], h.price[("plan", "venue", "year")]
    newer = h.event("customer.subscription.updated", sub_data("sub_1", "cus_buyer", [venue]), created=T0 + 3600)
    older = h.event("customer.subscription.created", sub_data("sub_1", "cus_buyer", [small]), created=T0)
    h.send(newer)
    h.send(older)
    assert h.shop.db.one("SELECT plan FROM subscriptions WHERE id='sub_1'")["plan"] == "venue"
    ev = h.shop.db.one("SELECT note FROM webhook_events WHERE event_id=?", older["id"])
    assert "older" in ev["note"]


def test_older_payload_shapes_are_read_too(h):
    """An endpoint left on the account's older API version sends periods on the subscription and
    prices on invoice lines; the same key comes out."""
    _, acc = _customer(h)
    venue = h.price[("plan", "venue", "year")]
    h.send(h.event("customer.subscription.created", sub_data("sub_o", "cus_buyer", [venue], basil=False)))
    sub = h.shop.db.one("SELECT * FROM subscriptions WHERE id='sub_o'")
    assert sub["plan"] == "venue" and sub["period_end"] == "2027-10-15T12:00:00Z"
    h.send(h.event("invoice.paid", invoice_data("in_o", "cus_buyer", [venue], sub_id="sub_o", basil=False)))
    lic = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_o'")
    assert lic and lic["max_nodes"] == 30 and lic["transaction_id"] == "in_o"


def test_unknown_price_issues_nothing_and_flags_it(h):
    _, acc = _customer(h)
    h.send(h.event("customer.subscription.created", sub_data("sub_9", "cus_buyer", ["price_someone_else"])))
    h.send(h.event("invoice.paid", invoice_data("in_9", "cus_buyer", ["price_someone_else"], sub_id="sub_9")))
    sub = h.shop.db.one("SELECT * FROM subscriptions WHERE id='sub_9'")
    assert "Unknown Stripe price" in sub["problem"]
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences")["n"] == 0
    assert h.shop.db.one("SELECT COUNT(*) n FROM emails WHERE to_addr='boss@example.com'")["n"] >= 1


def test_payment_from_unknown_customer_tells_admin(h):
    venue = h.price[("plan", "venue", "year")]
    r = h.send(h.event("invoice.paid", invoice_data("in_7", "cus_nobody", [venue], sub_id="sub_7")))
    assert r.status_code == 200
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences")["n"] == 0
    assert "Payment with no account" in h.shop.db.one(
        "SELECT subject FROM emails WHERE to_addr='boss@example.com' ORDER BY id DESC")["subject"]


def test_a_failing_event_is_recorded_and_retried(h, monkeypatch):
    _, acc = _customer(h)
    venue = h.price[("plan", "venue", "year")]
    ev = h.event("invoice.paid", invoice_data("in_1", "cus_buyer", [venue], sub_id="sub_1"))
    from atshop import billing
    real = billing.on_invoice_paid
    monkeypatch.setattr(billing, "on_invoice_paid", lambda ctx, e: 1 / 0)
    r = h.send(ev)
    assert r.status_code == 500  # Stripe retries a non-2xx
    assert h.shop.db.one("SELECT status FROM webhook_events WHERE event_id=?", ev["id"])["status"] == "failed"
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences")["n"] == 0  # nothing half-done
    monkeypatch.setattr(billing, "on_invoice_paid", real)
    assert h.send(ev).json()["status"] == "processed"
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences")["n"] == 1


def test_secret_is_needed(h):
    h.s.stripe_webhook_secret = ""
    ev = h.event("invoice.paid", invoice_data("in_x", "cus_x", []))
    assert h.send(ev, secret="").status_code == 400
    h.s.stripe_webhook_secret = WEBHOOK_SECRET
