"""A customer from sign-up to a working licence key, then renewal, plan changes, payment trouble and cancelling.
Keys are checked with the AT SUITE server's own licence code, trusting only the throwaway test key."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

from atshop.licensing import period_expiry

from conftest import invoice_data, session_data, sub_data

SERVER = Path(__file__).resolve().parents[2] / "server"


@pytest.fixture
def server_licence(vendor, monkeypatch):
    """server/atsuit/licence.py, trusting the throwaway vendor key instead of the real one."""
    monkeypatch.syspath_prepend(str(SERVER))
    from atsuit import licence
    monkeypatch.setattr(licence, "_vendor_raw", lambda: (vendor["pub"], "test"))
    return licence


def buy(h, c, plan="venue", cycle="year", hosting=False, slug=""):
    r = c.get(f"/buy?plan={plan}&cycle={cycle}&hosting={int(hosting)}")
    assert r.status_code == 200
    csrf = h.csrf(c, f"/buy?plan={plan}&cycle={cycle}")
    form = {"csrf": csrf, "kind": "subscription", "plan": plan, "cycle": cycle}
    if hosting:
        form.update(hosting="1", venue_slug=slug, venue_name="Grand Hall")
    r = c.post("/buy", data=form)
    # Straight on to Stripe's own checkout page.
    assert r.status_code == 303 and r.headers["location"].startswith("https://checkout.stripe.com/"), r.text
    order = h.shop.db.one("SELECT * FROM orders ORDER BY id DESC LIMIT 1")
    cust = h.shop.db.one("SELECT stripe_customer_id FROM accounts WHERE id=?", order["account_id"])["stripe_customer_id"]
    assert cust.startswith("cus_") and h.session_of(order)["customer"] == cust
    return order


def pay(h, order, sub_id, prices, start="2026-10-15T12:00:00Z", end="2027-10-15T12:00:00Z"):
    """What Stripe sends after a successful checkout: the subscription, the checkout, then the paid invoice."""
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])
    cust = acc["stripe_customer_id"]
    md = {"account_id": str(acc["id"]), "order_ref": order["ref"]}
    h.send(h.event("customer.subscription.created", sub_data(sub_id, cust, prices, start=start, end=end, metadata=md)))
    h.send(h.event("checkout.session.completed", session_data(order["stripe_session_id"], cust, metadata=md)))
    r = h.send(h.event("invoice.paid", invoice_data(f"in_{sub_id}", cust, prices, sub_id=sub_id, start=start, end=end,
                                                    metadata=md)))
    assert r.status_code == 200, r.text


def test_full_purchase_gives_a_key_the_server_accepts(h, server_licence):
    c = h.sign_in("ops@grandhall.example", name="Ops Team", organisation="Grand Hall")
    order = buy(h, c)
    # The server, not the browser, chose the price and recorded who it's for.
    sent = h.session_of(order)
    assert sent["mode"] == "subscription" and sent["line_items[0][price]"] == h.price[("plan", "venue", "year")]
    assert "line_items[1][price]" not in sent
    assert sent["metadata[account_id]"] == str(order["account_id"]) and sent["metadata[order_ref]"] == order["ref"]
    assert sent["subscription_data[metadata][order_ref]"] == order["ref"]
    assert sent["success_url"] == f"http://testserver/account/thanks?order={order['ref']}"
    assert sent["automatic_tax[enabled]"] == "false" and sent["tax_id_collection[enabled]"] == "true"
    assert sent["idempotency_key"] == f"checkout-{order['ref']}"

    assert c.get(f"/account/order/{order['ref']}").json() == {"status": "open", "licence": False}
    pay(h, order, "sub_1", [h.price[("plan", "venue", "year")]])
    assert c.get(f"/account/order/{order['ref']}").json() == {"status": "paid", "licence": True}

    lic = h.shop.db.one("SELECT * FROM licences WHERE account_id=?", order["account_id"])
    parsed = server_licence.parse(lic["key"])
    assert parsed.valid and parsed.state == "active"
    assert parsed.licensee == "Grand Hall"
    assert parsed.edition == "venue" and parsed.max_nodes == 30 and parsed.max_sites == 1
    assert parsed.modules == server_licence.ALL_MODULES
    assert parsed.expires == period_expiry("2027-10-15T12:00:00Z", 7)  # period end + 7 spare days
    assert parsed.checkin == h.shop.s.site_url  # the server checks in here every day
    # Shown in the portal, downloadable, and emailed.
    page = c.get("/account").text
    assert lic["serial"] in page and lic["key"] in page
    dl = c.get(f"/account/licence/{lic['serial']}.txt")
    assert dl.text.strip() == lic["key"] and "attachment" in dl.headers["content-disposition"]
    mail = h.shop.db.one("SELECT * FROM emails WHERE to_addr='ops@grandhall.example' AND kind!='login' ORDER BY id DESC")
    assert lic["key"] in mail["body"]
    # Another customer can't fetch it.
    other = h.sign_in("nosy@example.com")
    assert other.get(f"/account/licence/{lic['serial']}.txt").status_code == 404


def test_a_key_from_another_vendor_is_refused_by_the_server(server_licence):
    import json
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from atshop.licensing import b64
    raw = json.dumps({"licensee": "Fake", "edition": "venue", "max_nodes": 30, "expires": 0}).encode()
    assert not server_licence.parse(f"{b64(raw)}.{b64(Ed25519PrivateKey.generate().sign(raw))}").valid


def test_monthly_renewal_gives_a_new_key_and_replaces_the_old(h, server_licence):
    c = h.sign_in("ops@grandhall.example")
    month = h.price[("plan", "small", "month")]
    order = buy(h, c, "small", "month")
    pay(h, order, "sub_m", [month], end="2026-11-15T12:00:00Z")
    first = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_m'")
    assert first["expires"] == period_expiry("2026-11-15T12:00:00Z", 7)
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])
    # Next month: Stripe renews; the subscription moves on, then the renewal invoice is paid.
    h.send(h.event("customer.subscription.updated", sub_data("sub_m", acc["stripe_customer_id"], [month],
                                                             start="2026-11-15T12:00:00Z", end="2026-12-15T12:00:00Z")))
    h.send(h.event("invoice.paid", invoice_data("in_renew", acc["stripe_customer_id"], [month], sub_id="sub_m",
                                                start="2026-11-15T12:00:00Z", end="2026-12-15T12:00:00Z",
                                                billing_reason="subscription_cycle")))
    keys = h.shop.db.all("SELECT * FROM licences WHERE subscription_id='sub_m' ORDER BY id")
    assert len(keys) == 2
    assert keys[0]["replaced_by"] == keys[1]["serial"]
    assert keys[1]["expires"] == period_expiry("2026-12-15T12:00:00Z", 7)
    assert server_licence.parse(keys[1]["key"]).max_nodes == 10
    subjects = [r["subject"] for r in h.shop.db.all("SELECT subject FROM emails WHERE to_addr='ops@grandhall.example'")]
    assert any(s.startswith("AT SUITE renewed") for s in subjects)
    # The refresh endpoint hands a server holding the old key the new one, and nothing for the newest.
    r = h.client().post("/api/v1/licence/refresh", json={"key": keys[0]["key"]}).json()
    assert r["key"] == keys[1]["key"] and r["subscription"] == "active"
    assert h.client().post("/api/v1/licence/refresh", json={"key": keys[1]["key"]}).json()["status"] == "current"
    assert h.client().post("/api/v1/licence/refresh", json={"key": "made.up"}).status_code == 400
    # Revoking the renewal cancels the key it replaced too, so a server still on the old one hears it.
    h.shop.db.run("UPDATE licences SET revoked_at=1 WHERE id=?", keys[1]["id"])
    assert h.client().post("/api/v1/licence/refresh", json={"key": keys[0]["key"]}).json()["status"] == "revoked"


def test_upgrade_and_downgrade(h, server_licence):
    c = h.sign_in("ops@grandhall.example")
    small, large = h.price[("plan", "small", "year")], h.price[("plan", "large", "year")]
    order = buy(h, c, "small", "year")
    pay(h, order, "sub_u", [small])
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])

    h.stripe.subscriptions["sub_u"] = [small]
    r = c.post("/account/plan", data={"csrf": h.csrf(c, "/account/plan"), "plan": "large", "cycle": "year"})
    assert r.status_code == 200
    # The old item goes, the new price comes in, and the difference is charged now.
    assert h.stripe.updates[-1] == {"id": "sub_u", "items[0][id]": "si_0", "items[0][deleted]": "true",
                                    "items[1][price]": large, "items[1][quantity]": "1",
                                    "proration_behavior": "always_invoice"}
    # Stripe confirms the change: a new key with the bigger laptop limit, same end date.
    h.send(h.event("customer.subscription.updated", sub_data("sub_u", acc["stripe_customer_id"], [large])))
    cur = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_u' AND replaced_by IS NULL")
    p = server_licence.parse(cur["key"])
    assert p.max_nodes == 75 and p.edition == "large"
    assert p.expires == period_expiry("2027-10-15T12:00:00Z", 7)

    # The upgrade's invoice (a credit for the old plan, a charge for the new) doesn't undo it.
    h.send(h.event("invoice.paid", invoice_data("in_up", acc["stripe_customer_id"], [large], sub_id="sub_u",
                                                billing_reason="subscription_update", credit=small)))
    assert server_licence.parse(h.shop.db.one("SELECT key FROM licences WHERE subscription_id='sub_u' AND replaced_by IS NULL")
                                ["key"]).max_nodes == 75

    # Going down is credited at the next bill, not charged now. Hosting already on stays on.
    h.stripe.subscriptions["sub_u"] = [large]
    c.post("/account/plan", data={"csrf": h.csrf(c, "/account/plan"), "plan": "small", "cycle": "year"})
    assert h.stripe.updates[-1]["proration_behavior"] == "create_prorations"
    assert h.stripe.updates[-1]["items[1][price]"] == small


def test_payment_trouble_and_cancelling(h):
    c = h.sign_in("ops@grandhall.example")
    venue = h.price[("plan", "venue", "year")]
    order = buy(h, c)
    pay(h, order, "sub_c", [venue])
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])
    cust = acc["stripe_customer_id"]
    key_before = h.shop.db.one("SELECT * FROM licences WHERE subscription_id='sub_c'")

    h.send(h.event("invoice.payment_failed", {**invoice_data("in_f", cust, [venue], sub_id="sub_c"), "status": "open"}))
    h.send(h.event("customer.subscription.updated", sub_data("sub_c", cust, [venue], status="past_due")))
    h.send(h.event("customer.subscription.updated", sub_data("sub_c", cust, [venue], status="past_due")))  # no 2nd email
    mails = h.shop.db.all("SELECT subject FROM emails WHERE to_addr='ops@grandhall.example' AND kind!='login'")
    assert sum("payment" in m["subject"].lower() for m in mails) >= 1
    assert h.shop.db.one("SELECT status FROM subscriptions WHERE id='sub_c'")["status"] == "past_due"
    # The key they have keeps working: nothing is revoked or shortened for a late payment.
    assert h.shop.db.one("SELECT * FROM licences WHERE id=?", key_before["id"])["revoked_at"] is None

    # Cancelled in the portal: it runs to the end of the period, then Stripe deletes it.
    h.send(h.event("customer.subscription.updated", sub_data("sub_c", cust, [venue], cancel_at_period_end=True)))
    h.send(h.event("customer.subscription.updated", sub_data("sub_c", cust, [venue], cancel_at_period_end=True)))
    sub = h.shop.db.one("SELECT * FROM subscriptions WHERE id='sub_c'")
    assert '"effective_at": "2027-10-15T12:00:00Z"' in sub["scheduled_change"] and sub["next_billed_at"] is None
    h.send(h.event("customer.subscription.deleted", sub_data("sub_c", cust, [venue], status="canceled")))
    subjects = [m["subject"] for m in h.shop.db.all("SELECT subject FROM emails WHERE to_addr='ops@grandhall.example'")]
    assert subjects.count("Your AT SUITE subscription will end") == 1
    assert subjects.count("Your AT SUITE subscription has ended") == 1
    assert h.shop.db.one("SELECT * FROM licences WHERE id=?", key_before["id"])["revoked_at"] is None

    # Card update and cancel go to Stripe's own portal.
    r = c.post("/account/billing/portal", data={"csrf": h.csrf(c, "/account/billing"), "go": "card"})
    assert r.status_code == 303 and r.headers["location"].startswith("https://billing.stripe.com/")
    assert h.stripe.portal[-1] == {"customer": cust, "return_url": "http://testserver/account/billing",
                                   "flow_data[type]": "payment_method_update"}


def test_cannot_buy_twice_or_with_a_bad_cycle(h):
    c = h.sign_in("ops@grandhall.example")
    order = buy(h, c)
    pay(h, order, "sub_1", [h.price[("plan", "venue", "year")]])
    r = c.post("/buy", data={"csrf": h.csrf(c, "/account"), "kind": "subscription", "plan": "large", "cycle": "year"})
    assert r.status_code == 400 and "already have a subscription" in r.text
    assert c.get("/buy?plan=venue&cycle=fortnight").status_code == 404
    assert c.get("/buy?plan=gold&cycle=year").status_code == 404


def test_event_pass(h, server_licence):
    c = h.sign_in("hire@example.com", organisation="Hire Co")
    start = date.today().isoformat()
    r = c.post("/buy", data={"csrf": h.csrf(c, "/buy/event"), "kind": "event", "event_start": start})
    assert r.status_code == 303
    order = h.shop.db.one("SELECT * FROM orders ORDER BY id DESC")
    sent = h.session_of(order)
    assert sent["mode"] == "payment" and sent["line_items[0][price]"] == h.price[("pass", "event", "")]
    assert sent["invoice_creation[enabled]"] == "true" and sent["payment_intent_data[metadata][order_ref]"] == order["ref"]
    acc = h.shop.db.one("SELECT * FROM accounts WHERE id=?", order["account_id"])
    md = {"account_id": str(acc["id"]), "order_ref": order["ref"]}
    cust = acc["stripe_customer_id"]
    # A bank payment that hasn't cleared yet issues nothing; once it clears, the pass is issued once.
    h.send(h.event("checkout.session.completed", session_data(order["stripe_session_id"], cust, mode="payment",
                                                              metadata=md, payment_status="unpaid")))
    assert not h.shop.db.one("SELECT 1 FROM licences WHERE account_id=?", acc["id"])
    for etype in ("checkout.session.async_payment_succeeded", "checkout.session.completed"):
        h.send(h.event(etype, session_data(order["stripe_session_id"], cust, mode="payment", metadata=md,
                                           invoice="in_event")))
    h.send(h.event("invoice.paid", invoice_data("in_event", cust, [h.price[("pass", "event", "")]], metadata=md,
                                                total=14900)))
    assert h.shop.db.one("SELECT COUNT(*) n FROM licences WHERE account_id=?", acc["id"])["n"] == 1
    assert c.get(f"/account/order/{order['ref']}").json() == {"status": "paid", "licence": True}
    lic = h.shop.db.one("SELECT * FROM licences WHERE account_id=?", acc["id"])
    assert lic["transaction_id"] == "in_event"
    p = server_licence.parse(lic["key"])
    assert p.valid and p.edition == "event" and p.max_nodes == 10
    from atshop.licensing import days_expiry
    assert p.expires == days_expiry(date.today(), 7)
    # Too far ahead is refused before any payment.
    r = c.post("/buy", data={"csrf": h.csrf(c, "/buy/event"), "kind": "event", "event_start": "2099-01-01"})
    assert r.status_code == 400


def test_trial_once_per_account(h, server_licence):
    c = h.sign_in("try@example.com")
    assert c.post("/account/trial", data={"csrf": h.csrf(c)}).status_code == 303
    lic = h.shop.db.one("SELECT * FROM licences WHERE source='trial'")
    p = server_licence.parse(lic["key"])
    assert p.valid and p.edition == "trial" and p.max_nodes == 10
    assert c.post("/account/trial", data={"csrf": h.csrf(c)}).status_code == 400


def test_checkout_waits_for_prices(h):
    h.shop.cat.prices.clear()
    c = h.sign_in("ops@grandhall.example")
    r = c.post("/buy", data={"csrf": h.csrf(c), "kind": "subscription", "plan": "venue", "cycle": "year"})
    assert r.status_code == 400 and "switched on yet" in r.text
    assert not h.stripe.sessions


def test_stripe_errors_are_shown_kindly(h):
    c = h.sign_in("ops@grandhall.example")
    h.stripe.fail_next = (500, "api_error")
    r = c.post("/buy", data={"csrf": h.csrf(c), "kind": "subscription", "plan": "venue", "cycle": "year"})
    assert r.status_code == 400 and "Our payment provider said" in r.text
    assert h.shop.db.one("SELECT COUNT(*) n FROM orders")["n"] == 0


def test_existing_stripe_customer_is_reused(h):
    h.stripe.customers["ops@grandhall.example"] = "cus_existing"
    c = h.sign_in("ops@grandhall.example")
    buy(h, c)
    assert h.shop.db.one("SELECT stripe_customer_id FROM accounts")["stripe_customer_id"] == "cus_existing"
    assert not [x for x in h.stripe.calls if x[:2] == ("POST", "/v1/customers")]


def test_invoice_only_for_own_transactions(h):
    c = h.sign_in("ops@grandhall.example")
    order = buy(h, c)
    pay(h, order, "sub_1", [h.price[("plan", "venue", "year")]])
    r = c.get("/account/invoice/in_sub_1")
    assert r.status_code == 303 and r.headers["location"] == "https://invoice.stripe.com/i/in_sub_1"
    other = h.sign_in("nosy@example.com")
    assert other.get("/account/invoice/in_sub_1").status_code == 404
