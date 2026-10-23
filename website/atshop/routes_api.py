"""Machine endpoints: Stripe's webhook, licence renewal for AT SUITE servers, health."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import auth, billing, mailer
from .app import VERSION
from .stripe import verify_signature
from .web import ip, shop

router = APIRouter()
log = logging.getLogger("atshop.api")
MAX_BODY = 512 * 1024


@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Every Stripe event comes here. Only signed, recent events are read; each is applied once."""
    sh = shop(request)
    if sh.s.stripe_webhook_ip_check:
        allowed = await run_in_threadpool(sh.stripe.is_webhook_ip, ip(request))
        if allowed is None:  # Stripe's address list couldn't be read: Stripe retries a 503 later
            log.warning("Stripe webhook held: couldn't read Stripe's address list")
            return JSONResponse({"error": "try again"}, 503)
        if not allowed:
            log.warning("Stripe webhook from %s, which isn't one of Stripe's addresses", ip(request))
            return JSONResponse({"error": "forbidden"}, 403)
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return JSONResponse({"error": "too large"}, 413)
    if not verify_signature(raw, request.headers.get("stripe-signature", ""), sh.s.stripe_webhook_secret):
        log.warning("Stripe webhook with a bad or old signature from %s", ip(request))
        return JSONResponse({"error": "bad signature"}, 400)
    try:
        event = json.loads(raw)
    except ValueError:
        return JSONResponse({"error": "not json"}, 400)
    if bool(event.get("livemode")) != (sh.s.stripe_mode == "live"):
        log.warning("Stripe event %s is from the other mode (live/test) than this shop's key; ignored", event.get("id"))
        return JSONResponse({"error": "event from the other Stripe mode"}, 400)
    try:
        status, note = billing.handle(sh.db, sh.s, sh.cat, sh.signer, event)
    except Exception as e:  # noqa: BLE001 - record it, then let Stripe retry
        log.exception("webhook %s failed", event.get("id"))
        sh.db.run("INSERT OR REPLACE INTO webhook_events (event_id, event_type, occurred_at, received_at, status, note,"
                  " payload) VALUES (?,?,?,strftime('%s','now'),'failed',?,?)",
                  event.get("id") or "?", event.get("type") or "?", billing.iso(event.get("created")),
                  f"{type(e).__name__}: {e}"[:500], raw.decode(errors="replace"))
        return JSONResponse({"error": "not processed; will retry"}, 500)
    try:
        mailer.flush(sh.db, sh.s)
    except Exception:  # noqa: BLE001 - the background loop retries
        log.exception("email after webhook")
    return {"ok": True, "status": status}


@router.post("/api/v1/licence/refresh")
async def licence_refresh(request: Request):
    """Every AT SUITE server with a key from here calls this once a day (the key's `checkin`).
    It proves it holds the key by sending it, and gets back that subscription's newest key, or
    "revoked" when an admin cancelled the key or one that replaced it. A server that hears
    "revoked" locks at its next quiet moment, never during a show."""
    sh = shop(request)
    # A hosting server sends every venue's check-in from one address, so the per-address limit is
    # generous and each key has its own.
    if auth.limited(sh.db, f"refresh:{ip(request)}", 600, 3600):
        return JSONResponse({"error": "slow down"}, 429)
    try:
        key = str((await request.json()).get("key", ""))[:4096]
    except ValueError:
        return JSONResponse({"error": "send {\"key\": \"<current licence key>\"}"}, 400)
    body = sh.signer.verify(key)
    if not body:
        return JSONResponse({"error": "not a key we issued"}, 400)
    if auth.limited(sh.db, f"refresh-key:{body.get('serial', '')}", 20, 3600):
        return JSONResponse({"error": "slow down"}, 429)
    lic = sh.db.one("SELECT * FROM licences WHERE serial=?", body.get("serial", ""))
    if not lic:
        return JSONResponse({"key": None, "status": "unknown"})
    if lic["revoked_at"]:
        return JSONResponse({"key": None, "status": "revoked"})
    newest = lic
    for _ in range(100):
        if not newest["replaced_by"]:
            break
        nxt = sh.db.one("SELECT * FROM licences WHERE serial=?", newest["replaced_by"])
        if not nxt:
            break
        if nxt["revoked_at"]:  # revoking a renewal cancels the keys it replaced too
            return JSONResponse({"key": None, "status": "revoked"})
        newest = nxt
    sub = sh.db.one("SELECT status FROM subscriptions WHERE id=?", lic["subscription_id"]) if lic["subscription_id"] else None
    if newest["serial"] == lic["serial"]:
        return {"key": None, "status": "current", "expires": lic["expires"], "subscription": sub["status"] if sub else None}
    return {"key": newest["key"], "serial": newest["serial"], "expires": newest["expires"],
            "subscription": sub["status"] if sub else None}


@router.get("/api/health")
def health(request: Request):
    sh = shop(request)
    sh.db.one("SELECT 1")
    return {"ok": True, "version": VERSION, "billing": sh.s.stripe_mode if sh.s.billing_ready else "off",
            "signing": sh.signer.ready}
