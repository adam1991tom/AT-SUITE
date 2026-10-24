"""Stripe: the few API calls the shop makes, and webhook signature checks.

Docs: https://docs.stripe.com/api and https://docs.stripe.com/webhooks#verify-manually
Every request names the API version, so what Stripe sends back doesn't change when the account's
default version moves on. Webhook bodies follow the version of the endpoint, so billing.py reads
both the old and the new (2025-03-31.basil onwards) shapes.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import threading
import time

import httpx

API_VERSION = "2025-08-27.basil"
SIGNATURE_TOLERANCE_S = 300
WEBHOOK_IPS_URL = "https://stripe.com/files/ips/ips_webhooks.json"
WEBHOOK_IPS_TTL_S = 3600
# What the shop listens to. tools/stripe_setup.py makes the webhook endpoint with exactly these.
WEBHOOK_EVENTS = [
    "checkout.session.completed", "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed", "checkout.session.expired",
    "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
    "customer.subscription.paused", "customer.subscription.resumed",
    "invoice.paid", "invoice.payment_failed",
]
# Stripe's tax code for software sold as a service to businesses, so Stripe Tax can work out VAT.
TAX_CODE = "txcd_10103001"


class StripeError(RuntimeError):
    def __init__(self, message: str, status: int = 0, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code


def verify_signature(raw_body: bytes, header: str, secret: str, now: float | None = None,
                     tolerance: int = SIGNATURE_TOLERANCE_S) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">. Several v1 during a secret roll.
    Old timestamps are refused so a captured request can't be replayed later."""
    if not secret or not header:
        return False
    ts, sigs = None, []
    for part in header.split(","):
        k, _, v = part.strip().partition("=")
        if k == "t":
            ts = v
        elif k == "v1":
            sigs.append(v)
    if not ts or not ts.isdigit() or not sigs:
        return False
    if abs((now or time.time()) - int(ts)) > tolerance:
        return False
    want = hmac.new(secret.encode(), ts.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(want, s) for s in sigs)


def sign(raw_body: bytes, secret: str, ts: int | None = None) -> str:
    """A Stripe-Signature header for this body (tests and the local webhook replayer use it)."""
    ts = int(ts or time.time())
    return f"t={ts},v1=" + hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()


def form(params: dict, prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's form encoding: {"a": {"b": [{"c": 1}]}} → a[b][0][c]=1. None is left out."""
    out = []
    for k, v in params.items():
        name = f"{prefix}[{k}]" if prefix else str(k)
        if v is None:
            continue
        if isinstance(v, dict):
            out += form(v, name)
        elif isinstance(v, (list, tuple)):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    out += form(item, f"{name}[{i}]")
                else:
                    out.append((f"{name}[{i}]", _str(item)))
        else:
            out.append((name, _str(v)))
    return out


def _str(v) -> str:
    return ("true" if v else "false") if isinstance(v, bool) else str(v)


def ref(v) -> str | None:
    """An id from a field Stripe may send as an id or as the expanded object."""
    if isinstance(v, dict):
        return v.get("id")
    return v or None


class Stripe:
    def __init__(self, settings, transport: httpx.BaseTransport | None = None):
        self.s = settings
        self._client = httpx.Client(
            base_url=settings.stripe_base, timeout=20, transport=transport,
            headers={"Authorization": f"Bearer {settings.stripe_secret_key}", "Stripe-Version": API_VERSION})
        # Stripe's address list is a public file; no key is sent with it.
        self._public = httpx.Client(timeout=20, transport=transport)
        self._ips: list = []
        self._ips_at = 0.0
        self._ips_lock = threading.Lock()

    def _call(self, method: str, path: str, params: dict | None = None, idempotency_key: str = "") -> dict:
        if not self.s.stripe_secret_key:
            raise StripeError("Billing isn't set up yet (no STRIPE_SECRET_KEY)")
        kw: dict = {}
        if method == "GET":
            kw["params"] = form(params or {})
        else:
            kw["data"] = dict(form(params or {})) if params else None
            if idempotency_key:
                kw["headers"] = {"Idempotency-Key": idempotency_key}
        try:
            r = self._client.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise StripeError(f"Couldn't reach Stripe: {e}") from e
        try:
            data = r.json()
        except ValueError:
            data = {}
        if r.status_code >= 400:
            err = data.get("error") or {}
            raise StripeError(err.get("message") or f"Stripe answered {r.status_code}", r.status_code, err.get("code", ""))
        return data

    def _all(self, path: str, params: dict) -> list[dict]:
        """Every item of a list, following Stripe's pages."""
        out, params = [], {**params, "limit": 100}
        while True:
            page = self._call("GET", path, params)
            out += page.get("data") or []
            if not page.get("has_more") or not out:
                return out
            params["starting_after"] = out[-1]["id"]

    # ------------------------------------------------------------ customers --
    def find_or_create_customer(self, email: str, name: str = "", account_id: int | None = None) -> str:
        found = self._call("GET", "/v1/customers", {"email": email, "limit": 1}).get("data") or []
        if found:
            return found[0]["id"]
        return self._call("POST", "/v1/customers", {
            "email": email, "name": name or None,
            "metadata": {"account_id": str(account_id)} if account_id else None},
            idempotency_key=f"customer-{account_id or email}")["id"]

    def portal_session(self, customer_id: str, return_url: str, go: str = "", subscription_id: str = "") -> str:
        """A link into Stripe's customer portal: update card, cancel, invoices. Made fresh each time."""
        params: dict = {"customer": customer_id, "return_url": return_url}
        if go == "card":
            params["flow_data"] = {"type": "payment_method_update"}
        elif go == "cancel" and subscription_id:
            params["flow_data"] = {"type": "subscription_cancel",
                                   "subscription_cancel": {"subscription": subscription_id}}
        return self._call("POST", "/v1/billing_portal/sessions", params)["url"]

    # ------------------------------------------------------------- checkout --
    def create_checkout(self, *, customer_id: str, price_ids: list[str], mode: str, metadata: dict,
                        success_url: str, cancel_url: str, idempotency_key: str) -> dict:
        """A Stripe Checkout page for this order. Prices and what the order is for are fixed here, on
        the server, not by anything the browser sends. The order reference rides along on the
        subscription (or the payment and its invoice) so every later event can be matched to it."""
        params: dict = {
            "mode": mode, "customer": customer_id, "client_reference_id": metadata.get("account_id"),
            "line_items": [{"price": p, "quantity": 1} for p in price_ids],
            "metadata": metadata, "success_url": success_url, "cancel_url": cancel_url,
            "billing_address_collection": "required",
            # Business customers can add their VAT number; Stripe saves it and their address on the customer.
            "tax_id_collection": {"enabled": True},
            "customer_update": {"name": "auto", "address": "auto"},
            "automatic_tax": {"enabled": self.s.stripe_tax},
        }
        if mode == "subscription":
            params["subscription_data"] = {"metadata": metadata}
        else:
            params["payment_intent_data"] = {"metadata": metadata}
            # A proper invoice for one-off payments too (the event pass), like the subscription ones.
            params["invoice_creation"] = {"enabled": True, "invoice_data": {"metadata": metadata}}
        return self._call("POST", "/v1/checkout/sessions", params, idempotency_key=idempotency_key)

    # ------------------------------------------------------------- invoices --
    def invoices(self, customer_id: str, limit: int = 30) -> list[dict]:
        rows = self._call("GET", "/v1/invoices", {"customer": customer_id, "limit": limit}).get("data") or []
        return [i for i in rows if i.get("status") in ("open", "paid", "uncollectible")]

    def invoice_url(self, invoice_id: str) -> str:
        inv = self._call("GET", f"/v1/invoices/{invoice_id}")
        url = inv.get("hosted_invoice_url") or inv.get("invoice_pdf")
        if not url:
            raise StripeError("Stripe hasn't made this invoice's page yet")
        return url

    # -------------------------------------------------------- subscriptions --
    def subscription(self, sub_id: str) -> dict:
        return self._call("GET", f"/v1/subscriptions/{sub_id}")

    def change_items(self, sub_id: str, price_ids: list[str], proration: str) -> dict:
        """Change plan or add/remove hosting: keep items already on a wanted price, remove the rest and
        add what's missing. proration: always_invoice (charge now) | create_prorations (next bill)."""
        current = (self.subscription(sub_id).get("items") or {}).get("data") or []
        items, have = [], set()
        for it in current:
            pid = ref(it.get("price"))
            if pid in price_ids and pid not in have:
                have.add(pid)
                items.append({"id": it["id"]})
            else:
                items.append({"id": it["id"], "deleted": True})
        items += [{"price": p, "quantity": 1} for p in price_ids if p not in have]
        return self._call("POST", f"/v1/subscriptions/{sub_id}", {"items": items, "proration_behavior": proration})

    # ------------------------------------------------------ catalogue setup --
    def create_product(self, name: str, description: str, metadata: dict) -> str:
        return self._call("POST", "/v1/products", {"name": name, "description": description, "tax_code": TAX_CODE,
                                                   "metadata": metadata})["id"]

    def create_price(self, product_id: str, nickname: str, amount_minor: int, currency: str,
                     cycle: str = "", metadata: dict | None = None) -> str:
        body = {"product": product_id, "nickname": nickname, "unit_amount": amount_minor,
                "currency": currency.lower(),
                # Prices are before VAT; VAT is added on top when Stripe Tax is switched on.
                "tax_behavior": "exclusive", "metadata": metadata or {}}
        if cycle:
            body["recurring"] = {"interval": cycle, "interval_count": 1}
        return self._call("POST", "/v1/prices", body)["id"]

    def archive_price(self, price_id: str) -> None:
        self._call("POST", f"/v1/prices/{price_id}", {"active": False})

    def list_prices(self) -> list[dict]:
        """Every active price in the account (read only)."""
        return self._all("/v1/prices", {"active": True})

    def portal_configurations(self) -> list[dict]:
        return self._call("GET", "/v1/billing_portal/configurations", {"limit": 10}).get("data") or []

    def create_portal_configuration(self, site_url: str) -> str:
        """The customer portal: card, invoices, cancel at the end of the period, billing details.
        Plan changes stay on our own site, which issues the matching key."""
        return self._call("POST", "/v1/billing_portal/configurations", {
            "business_profile": {"headline": "AT SUITE billing", "privacy_policy_url": f"{site_url}/legal/privacy",
                                 "terms_of_service_url": f"{site_url}/legal/terms"},
            "default_return_url": f"{site_url}/account/billing",
            "features": {
                "invoice_history": {"enabled": True},
                "payment_method_update": {"enabled": True},
                "customer_update": {"enabled": True, "allowed_updates": ["name", "address", "tax_id"]},
                "subscription_cancel": {"enabled": True, "mode": "at_period_end",
                                        "proration_behavior": "none"},
                "subscription_update": {"enabled": False},
            }})["id"]

    def webhook_endpoints(self) -> list[dict]:
        return self._all("/v1/webhook_endpoints", {})

    def create_webhook_endpoint(self, url: str) -> dict:
        """Returns the endpoint with its signing secret, which Stripe shows only this once."""
        return self._call("POST", "/v1/webhook_endpoints", {
            "url": url, "enabled_events": WEBHOOK_EVENTS, "api_version": API_VERSION,
            "description": "AT SUITE shop"})

    # ------------------------------------------------------------- webhooks --
    def webhook_ips(self) -> list:
        """The addresses Stripe sends webhooks from, read from Stripe's published list and kept for an
        hour. If it can't be read the last list is kept; an empty list means we don't know yet, and the
        webhook asks Stripe to retry."""
        with self._ips_lock:
            if self._ips and time.time() - self._ips_at < WEBHOOK_IPS_TTL_S:
                return self._ips
            try:
                r = self._public.get(self.s.stripe_webhook_ips_url)
                r.raise_for_status()
                nets = [ipaddress.ip_network(a) for a in r.json()["WEBHOOKS"]]
                if nets:
                    self._ips, self._ips_at = nets, time.time()
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                pass
            return self._ips

    def is_webhook_ip(self, addr: str) -> bool | None:
        """True or False, or None when Stripe's list couldn't be read."""
        nets = self.webhook_ips()
        if not nets:
            return None
        try:
            a = ipaddress.ip_address(addr)
        except ValueError:
            return False
        return any(a in n for n in nets)
