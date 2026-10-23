"""What Stripe's webhooks mean for accounts, subscriptions, licence keys and hosting.

Rules:
- An event is applied once: its id is stored with its effects in one transaction, so a retried or
  duplicated delivery does nothing the second time.
- Subscription events can arrive out of order; one older than the last one applied is skipped.
- What a customer bought comes from the Stripe price ids, mapped by the catalogue on the server.
  A price we don't recognise issues nothing and flags the subscription for the admin.
- A licence key is issued for each paid period (invoice.paid) and when the plan changes. An event
  pass is issued when its checkout is paid. A key runs to the end of the period plus the spare days,
  as tools/licence.py does, and the app's own warnings, 14-day grace and show-safe lock take it from
  there. Keys are never cut short early.
- Webhook bodies follow the API version of the endpoint, so both the older shapes and the newer
  ones (2025-03-31.basil onwards: periods on subscription items, invoice parent and line pricing)
  are read.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone

from . import hosting as hostingmod
from . import mailer, notify
from .db import audit, now
from .licensing import days_expiry, period_expiry
from .stripe import ref

log = logging.getLogger("atshop.billing")

SUBSCRIPTION_EVENTS = {
    "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
    "customer.subscription.paused", "customer.subscription.resumed",
}
CHECKOUT_PAID = {"checkout.session.completed", "checkout.session.async_payment_succeeded"}
HANDLED = SUBSCRIPTION_EVENTS | CHECKOUT_PAID | {
    "checkout.session.async_payment_failed", "checkout.session.expired", "invoice.paid", "invoice.payment_failed",
}


class Ctx:
    """What a handler needs: settings, catalogue, signer, and the open transaction."""

    def __init__(self, c, settings, cat, signer):
        self.c, self.s, self.cat, self.signer = c, settings, cat, signer


# --------------------------------------------------------------- entry point --
def handle(db, settings, cat, signer, event: dict) -> tuple[str, str]:
    """Apply one verified webhook event. Returns (status, note). Raises to make Stripe retry."""
    eid, etype = event.get("id") or "", event.get("type") or ""
    obj = (event.get("data") or {}).get("object") if isinstance(event.get("data"), dict) else None
    if not eid or not etype or not isinstance(obj, dict):
        return "ignored", "not a Stripe event"
    with db.tx() as c:
        seen = c.execute("SELECT status FROM webhook_events WHERE event_id=?", (eid,)).fetchone()
        if seen and seen["status"] != "failed":
            return "duplicate", f"already {seen['status']}"
        ctx = Ctx(c, settings, cat, signer)
        status, note = "ignored", "not an event the shop uses"
        if etype in HANDLED:
            status, note = "processed", ""
            if etype in SUBSCRIPTION_EVENTS:
                note = on_subscription(ctx, event)
            elif etype in CHECKOUT_PAID:
                note = on_checkout_paid(ctx, event)
            elif etype == "checkout.session.expired":
                note = on_checkout_expired(ctx, event)
            elif etype == "invoice.paid":
                note = on_invoice_paid(ctx, event)
            else:
                note = on_payment_failed(ctx, event)
        c.execute("INSERT OR REPLACE INTO webhook_events (event_id, event_type, occurred_at, received_at, status, note, payload)"
                  " VALUES (?,?,?,?,?,?,?)",
                  (eid, etype, iso(event.get("created")), now(), status, note or "", json.dumps(event)))
    return status, note


# ------------------------------------------------------------------- helpers --
def iso(ts) -> str | None:
    """A Stripe unix time as an ISO time (UTC), the way periods and event times are stored."""
    if ts in (None, ""):
        return None
    return datetime.fromtimestamp(int(ts), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _account(ctx, customer_id: str | None, metadata: dict | None, sub_id: str | None = None):
    c = ctx.c
    md = metadata or {}
    acc = None
    if str(md.get("account_id", "")).isdigit():
        acc = c.execute("SELECT * FROM accounts WHERE id=?", (int(md["account_id"]),)).fetchone()
        # Only trust the account id if the Stripe customer is that account's (or the account has none yet).
        if acc and acc["stripe_customer_id"] and customer_id and acc["stripe_customer_id"] != customer_id:
            acc = None
    if acc is None and customer_id:
        acc = c.execute("SELECT * FROM accounts WHERE stripe_customer_id=?", (customer_id,)).fetchone()
    if acc is None and sub_id:
        sub = c.execute("SELECT account_id FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
        if sub and sub["account_id"]:
            acc = c.execute("SELECT * FROM accounts WHERE id=?", (sub["account_id"],)).fetchone()
    if acc is not None and not acc["stripe_customer_id"] and customer_id:
        c.execute("UPDATE accounts SET stripe_customer_id=? WHERE id=?", (customer_id, acc["id"]))
    return acc


def sub_prices(sub: dict) -> list[str]:
    return [p for p in (ref(it.get("price")) for it in (sub.get("items") or {}).get("data") or []) if p]


def sub_period(sub: dict) -> tuple[str | None, str | None]:
    """The subscription's current period. Since basil it's on each item rather than the subscription."""
    items = (sub.get("items") or {}).get("data") or []
    start = sub.get("current_period_start") or min((i["current_period_start"] for i in items
                                                     if i.get("current_period_start")), default=None)
    end = sub.get("current_period_end") or max((i["current_period_end"] for i in items
                                                 if i.get("current_period_end")), default=None)
    return iso(start), iso(end)


def line_price(line: dict) -> str | None:
    pricing = line.get("pricing") or {}
    return ((pricing.get("price_details") or {}).get("price") or ref(line.get("price")) or ref(line.get("plan")))


def invoice_subscription(inv: dict) -> tuple[str | None, dict]:
    """(subscription id, the subscription's metadata as it was when invoiced)."""
    details = (inv.get("parent") or {}).get("subscription_details") or inv.get("subscription_details") or {}
    return ref(details.get("subscription")) or ref(inv.get("subscription")), details.get("metadata") or {}


def classify(cat, price_ids: list[str]) -> dict:
    """What a set of Stripe prices is: {"plan", "cycle", "hosting", "event", "unknown": [...]}."""
    out = {"plan": None, "cycle": None, "hosting": False, "event": False, "unknown": []}
    for pid in price_ids:
        p = cat.lookup(pid)
        if not p:
            out["unknown"].append(pid)
        elif p["kind"] == "plan":
            out["plan"], out["cycle"] = p["key"], p.get("cycle")
        elif p["kind"] == "addon" and p["key"] == "hosting":
            out["hosting"] = True
            out["cycle"] = out["cycle"] or p.get("cycle")
        elif p["kind"] == "pass":
            out["event"] = True
    return out


def licensee(acc) -> str:
    return acc["organisation"] or acc["name"] or acc["email"]


def fmt_day(ts: int) -> str:
    d = datetime.fromtimestamp(ts, timezone.utc)
    return f"{d.day} {d:%B %Y}"


def latest_licence(c, sub_id: str):
    return c.execute("SELECT * FROM licences WHERE subscription_id=? AND replaced_by IS NULL AND revoked_at IS NULL "
                     "ORDER BY issued DESC, id DESC LIMIT 1", (sub_id,)).fetchone()


def issue(ctx, acc, *, source: str, edition: str, max_nodes: int, expires: int, sub_id: str | None = None,
          txn_id: str | None = None, max_sites: int = 1, note: str = "", actor: str = "system",
          offline: bool = False) -> dict:
    """Sign a key, store it, and mark the key it replaces. Returns the licence row as a dict.
    Keys check in with this website every day, unless an admin makes an offline one."""
    key, body = ctx.signer.sign(licensee=licensee(acc), edition=edition, max_nodes=max_nodes, expires=expires,
                                max_sites=max_sites, checkin=None if offline else ctx.s.site_url)
    c = ctx.c
    prev = latest_licence(c, sub_id) if sub_id else None
    c.execute("INSERT INTO licences (serial, account_id, subscription_id, transaction_id, source, edition, licensee,"
              " max_nodes, max_sites, expires, issued, key, note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (body["serial"], acc["id"], sub_id, txn_id, source, edition, body["licensee"], body["max_nodes"],
               body["max_sites"], body["expires"], body["issued"], key, note))
    if prev:
        c.execute("UPDATE licences SET replaced_by=? WHERE id=?", (body["serial"], prev["id"]))
    audit(c, actor, "licence.issue", body["serial"], {"account": acc["id"], "source": source, "edition": edition,
                                                     "nodes": max_nodes, "expires": expires, "subscription": sub_id,
                                                     "offline": offline})
    return {**body, "key": key, "source": source, "subscription_id": sub_id}


def _hosting_for(c, sub_id: str):
    return c.execute("SELECT * FROM hosting WHERE subscription_id=? AND status!='ended' ORDER BY id DESC LIMIT 1",
                     (sub_id,)).fetchone()


def _push_key_to_hosting(ctx, sub_id: str, serial: str) -> None:
    h = _hosting_for(ctx.c, sub_id)
    if h and h["status"] in ("active", "pending", "suspended"):
        # A venue still being made gets its key with the "new" job.
        pending_new = ctx.c.execute("SELECT 1 FROM hosting_jobs WHERE hosting_id=? AND action='new' AND status='todo'",
                                    (h["id"],)).fetchone()
        if pending_new:
            ctx.c.execute("UPDATE hosting_jobs SET licence_serial=? WHERE hosting_id=? AND action='new' AND status='todo'",
                          (serial, h["id"]))
        else:
            hostingmod.queue(ctx.c, h["id"], "licence", serial)


# --------------------------------------------------------------- subscription --
def on_subscription(ctx, event: dict) -> str:
    c, d = ctx.c, event["data"]["object"]
    sub_id = d.get("id")
    if not sub_id:
        return "no subscription id"
    occurred = iso(event.get("created")) or ""
    row = c.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
    if row and occurred and row["event_at"] and occurred < row["event_at"]:
        return f"older than the last update applied ({row['event_at']})"
    customer = ref(d.get("customer"))
    acc = _account(ctx, customer, d.get("metadata"), sub_id)
    prices = sub_prices(d)
    kind = classify(ctx.cat, prices)
    start, end = sub_period(d)
    problem = f"Unknown Stripe price(s): {', '.join(kind['unknown'])}" if kind["unknown"] else None
    if not kind["plan"]:
        problem = problem or "No AT SUITE plan in this subscription"
    status = d.get("status") or "active"
    # Cancelled from the portal: it runs to the end of the period, then Stripe ends it.
    sched = None
    if d.get("cancel_at_period_end") or d.get("cancel_at"):
        sched = {"action": "cancel", "effective_at": iso(d.get("cancel_at")) or end}
    next_bill = end if status in ("active", "trialing", "past_due") and not sched else None
    values = (acc["id"] if acc else None, customer, status, kind["plan"], kind["cycle"], int(kind["hosting"]),
              json.dumps(prices), start, end, next_bill, json.dumps(sched) if sched else None, problem,
              occurred or (row["event_at"] if row else ""), now())
    if row:
        c.execute("UPDATE subscriptions SET account_id=COALESCE(?, account_id), stripe_customer_id=?, status=?, plan=?, cycle=?,"
                  " hosting=?, items=?, period_start=?, period_end=?, next_billed_at=?, scheduled_change=?, problem=?,"
                  " event_at=?, updated_at=? WHERE id=?", (*values, sub_id))
    else:
        c.execute("INSERT INTO subscriptions (account_id, stripe_customer_id, status, plan, cycle, hosting, items, period_start,"
                  " period_end, next_billed_at, scheduled_change, problem, event_at, updated_at, id, created_at)"
                  " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (*values, sub_id, now()))
    if problem and status not in ("incomplete", "incomplete_expired"):
        notify.admins(ctx, f"Subscription needs a look: {sub_id}", f"{problem}\n\nAccount: {acc['email'] if acc else 'unknown'}")
        audit(c, "stripe", "subscription.problem", sub_id, {"problem": problem})
    if acc is None:
        return "subscription saved; no account matched yet"
    notes = []
    was = row["status"] if row else None
    # Plan changed while active: a new key for the rest of this period, with the new laptop limit.
    if status in ("active", "trialing") and kind["plan"] and end:
        plan = ctx.cat.plans[kind["plan"]]
        cur = latest_licence(c, sub_id)
        if cur and (cur["max_nodes"] != plan.laptops or cur["edition"] != plan.licence_plan):
            lic = issue(ctx, acc, source="subscription", edition=plan.licence_plan, max_nodes=plan.laptops,
                        expires=max(period_expiry(end, ctx.cat.spare_days), cur["expires"]),
                        sub_id=sub_id, note=f"plan changed to {plan.name}")
            _push_key_to_hosting(ctx, sub_id, lic["serial"])
            notify.key_email(ctx, acc, lic, f"Your AT SUITE plan is now {plan.name}", reason="plan_change")
            notes.append("plan change: new key")
    # Payment trouble, cancellation and endings: tell the customer once each.
    if status in ("past_due", "unpaid") and was not in ("past_due", "unpaid"):
        notify.payment_failed(ctx, acc, sub_id)
        notes.append(status.replace("_", " "))
    if sched and not (row and row["scheduled_change"]):
        notify.once(ctx, acc, "cancel_scheduled", sub_id, "Your AT SUITE subscription will end",
                    notify.cancel_scheduled_body(ctx, acc, sub_id, sched["effective_at"]))
        notes.append("cancel scheduled")
    if status == "canceled" and was != "canceled":
        lic = latest_licence(c, sub_id)
        notify.once(ctx, acc, "canceled", sub_id, "Your AT SUITE subscription has ended",
                    notify.canceled_body(ctx, acc, lic))
        h = _hosting_for(c, sub_id)
        if h:
            notify.admins(ctx, f"Hosted venue {h['slug']} subscription ended",
                          f"{acc['email']}'s subscription {sub_id} ended. The venue keeps working until its key's grace "
                          f"runs out. Suspend it from Admin → Hosting when you're ready; nothing is removed automatically.")
        notes.append("canceled")
    audit(c, "stripe", f"subscription.{status}", sub_id, {"plan": kind["plan"], "cycle": kind["cycle"],
                                                          "hosting": kind["hosting"]})
    return "; ".join(notes) or "saved"


# ------------------------------------------------------------------- checkout --
def _order(c, metadata: dict | None, session_id: str | None = None):
    md = metadata or {}
    o = None
    if md.get("order_ref"):
        o = c.execute("SELECT * FROM orders WHERE ref=?", (str(md["order_ref"]),)).fetchone()
    if o is None and session_id:
        o = c.execute("SELECT * FROM orders WHERE stripe_session_id=?", (session_id,)).fetchone()
    return o


def on_checkout_paid(ctx, event: dict) -> str:
    """A finished Checkout. Subscriptions get their key from the invoice; an event pass is issued here."""
    c, d = ctx.c, event["data"]["object"]
    order = _order(c, d.get("metadata"), d.get("id"))
    acc = _account(ctx, ref(d.get("customer")), d.get("metadata"))
    if d.get("payment_status") not in ("paid", "no_payment_required"):
        return "waiting for the payment to clear"
    if order is None:
        return "no order matched"
    if acc is None or acc["id"] != order["account_id"]:
        notify.admins(ctx, f"Checkout doesn't match its order: {d.get('id')}",
                      f"Order {order['ref']} was paid by Stripe customer {ref(d.get('customer'))}, which isn't the "
                      f"order's account. Nothing was issued; check it in Stripe.")
        return "customer doesn't match the order; admin told"
    was_paid = order["status"] == "paid"
    c.execute("UPDATE orders SET status='paid' WHERE id=?", (order["id"],))
    if order["kind"] != "event":
        return "order paid; the key comes with the invoice"
    if was_paid:
        return "event pass already issued"
    start = date.today()
    if order["event_start"]:
        try:
            start = max(date.fromisoformat(order["event_start"]), date.today())
        except ValueError:
            pass
    ev = ctx.cat.event
    lic = issue(ctx, acc, source="event", edition=ev["licence_plan"], max_nodes=int(ev["laptops"]),
                expires=days_expiry(start, int(ev["days"])), txn_id=ref(d.get("invoice")) or d.get("id"),
                note=f"event from {start}")
    notify.key_email(ctx, acc, lic, "Your AT SUITE event pass", reason="event")
    return "event pass issued"


def on_checkout_expired(ctx, event: dict) -> str:
    d = event["data"]["object"]
    order = _order(ctx.c, d.get("metadata"), d.get("id"))
    if order and order["status"] == "open":
        ctx.c.execute("UPDATE orders SET status='abandoned' WHERE id=?", (order["id"],))
        return "order abandoned"
    return "nothing open"


# -------------------------------------------------------------------- invoice --
def on_invoice_paid(ctx, event: dict) -> str:
    c, d = ctx.c, event["data"]["object"]
    inv_id = d.get("id")
    sub_id, sub_md = invoice_subscription(d)
    md = {**(d.get("metadata") or {}), **sub_md}
    customer = ref(d.get("customer"))
    acc = _account(ctx, customer, md, sub_id)
    # Credits for unused time on an old plan are left out, so a plan change reads as the new plan.
    lines = [ln for ln in (d.get("lines") or {}).get("data") or [] if line_price(ln) and (ln.get("amount") or 0) >= 0]
    prices = list(dict.fromkeys(line_price(ln) for ln in lines))
    periods = [ln.get("period") or {} for ln in lines]
    start = iso(min((p["start"] for p in periods if p.get("start")), default=None))
    end = iso(max((p["end"] for p in periods if p.get("end")), default=None))
    paid_at = (d.get("status_transitions") or {}).get("paid_at") or d.get("created")
    c.execute("INSERT OR REPLACE INTO transactions (id, account_id, subscription_id, status, origin, total, currency,"
              " period_start, period_end, billed_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              (inv_id, acc["id"] if acc else None, sub_id, d.get("status") or "paid", d.get("billing_reason"),
               str(d.get("total") if d.get("total") is not None else d.get("amount_paid", "")),
               (d.get("currency") or "").upper(), start if sub_id else None, end if sub_id else None, iso(paid_at), now()))
    order = _order(c, md)
    if order and sub_id:
        c.execute("UPDATE orders SET status='paid' WHERE id=?", (order["id"],))
    if acc is None:
        notify.admins(ctx, f"Payment with no account: {inv_id}",
                      f"Stripe customer {customer} paid ({inv_id}) but no account matches. "
                      f"Issue their key from Admin → Licences once you know who it is.")
        return "no account matched; admin told"
    if not sub_id:
        return "one-off invoice recorded"  # an event pass: issued when its checkout was paid
    kind = classify(ctx.cat, prices)
    if kind["unknown"]:
        notify.admins(ctx, f"Payment for an unknown price: {inv_id}",
                      f"{acc['email']} paid for {', '.join(kind['unknown'])}, which isn't in the catalogue. No key was issued.")
    return _subscription_payment(ctx, acc, inv_id, sub_id, customer, prices, kind, order, start, end)


def _subscription_payment(ctx, acc, txn_id, sub_id, customer, prices, kind, order, start, end) -> str:
    c = ctx.c
    sub = c.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
    plan_key = None if kind["unknown"] and not kind["plan"] else (kind["plan"] or (sub["plan"] if sub else None))
    if not plan_key or not end:
        notify.admins(ctx, f"Couldn't issue a key for {txn_id}",
                      f"{acc['email']} paid ({txn_id}, subscription {sub_id}) but the plan or period is missing.")
        return "no plan or period; admin told"
    if sub is None:
        # The subscription's own event hasn't arrived yet; start a record so the key and hosting have a home.
        c.execute("INSERT INTO subscriptions (id, account_id, stripe_customer_id, status, plan, cycle, hosting, items,"
                  " period_start, period_end, event_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (sub_id, acc["id"], customer, "active", plan_key, kind["cycle"], int(kind["hosting"]),
                   json.dumps(prices), start, end, "", now(), now()))
    plan = ctx.cat.plans[plan_key]
    expires = period_expiry(end, ctx.cat.spare_days)
    cur = latest_licence(c, sub_id)
    first = cur is None and c.execute("SELECT 1 FROM licences WHERE subscription_id=?", (sub_id,)).fetchone() is None
    out = []
    if cur and cur["max_nodes"] == plan.laptops and cur["edition"] == plan.licence_plan and cur["expires"] >= expires:
        out.append("key already covers this period")
        lic = None
    else:
        lic = issue(ctx, acc, source="subscription", edition=plan.licence_plan, max_nodes=plan.laptops,
                    expires=max(expires, cur["expires"] if cur else 0), sub_id=sub_id, txn_id=txn_id)
        out.append("key issued")
    # Hosting: the first payment that includes it makes the venue; later keys go to the venue.
    wants_hosting = kind["hosting"] or (sub and sub["hosting"])
    h = _hosting_for(c, sub_id)
    if wants_hosting and h is None:
        slug = order["venue_slug"] if order and order["venue_slug"] else None
        if slug and not c.execute("SELECT 1 FROM hosting WHERE slug=?", (slug,)).fetchone():
            hid = c.execute("INSERT INTO hosting (account_id, subscription_id, slug, name, status, created_at)"
                            " VALUES (?,?,?,?,?,?)", (acc["id"], sub_id, slug, order["venue_name"] or licensee(acc),
                                                      "pending", now())).lastrowid
            hostingmod.queue(c, hid, "new", (lic or dict(cur))["serial"] if (lic or cur) else None)
            notify.admins(ctx, f"New hosted venue: {slug}",
                          f"{acc['email']} bought managed hosting. The venue job is in Admin → Hosting.")
            out.append("hosting queued")
        else:
            notify.admins(ctx, f"Hosting paid but no venue address: {sub_id}",
                          f"{acc['email']} pays for hosting but no free venue address was chosen. Set one in Admin → Hosting.")
            out.append("hosting needs an address")
    elif lic and h:
        _push_key_to_hosting(ctx, sub_id, lic["serial"])
    if lic:
        if first:
            notify.key_email(ctx, acc, lic, "Welcome to AT SUITE: your licence key", reason="welcome")
        else:
            notify.key_email(ctx, acc, lic, "AT SUITE renewed: your new licence key", reason="renewal")
    return "; ".join(out)


def on_payment_failed(ctx, event: dict) -> str:
    d = event["data"]["object"]
    if d.get("object") == "checkout.session":
        sub_id, md = None, d.get("metadata") or {}
    else:
        sub_id, sub_md = invoice_subscription(d)
        md = {**(d.get("metadata") or {}), **sub_md}
    acc = _account(ctx, ref(d.get("customer")), md, sub_id)
    if not acc:
        return "no account matched"
    notify.payment_failed(ctx, acc, sub_id or d.get("id"))
    return "customer told"


__all__ = ["handle", "classify", "issue", "latest_licence", "mailer"]
