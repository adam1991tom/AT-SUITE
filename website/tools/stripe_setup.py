#!/usr/bin/env python3
"""Create the AT SUITE products and prices in Stripe from catalogue.toml.

    python tools/stripe_setup.py            # show what would be created (changes nothing)
    python tools/stripe_setup.py --apply    # create what's missing and save data/stripe-prices.<mode>.json
    python tools/stripe_setup.py --apply --webhook https://www.atsuite.tech/webhooks/stripe

Run it once when the Stripe account is new, and again after changing a price in catalogue.toml.
It reads the account first: prices that already exist at today's amount are left alone, including ones
made earlier on another computer (they carry kind/key/cycle in their metadata and are just recorded).
It only ever adds: it never edits or deletes a product or price unless you ask with --archive-old.
A changed price gets a new Stripe price; the old one stays in the prices file, mapped to its plan, so
customers already on it keep getting keys. Add --archive-old to also archive the old prices in Stripe so
nobody new can buy them (subscribers on them carry on).

With --apply it also makes the customer portal settings (card, invoices, cancel at period end) if the
account has none yet. --webhook URL makes the webhook endpoint with the events the shop reads, unless
one for that URL exists, and prints its signing secret for STRIPE_WEBHOOK_SECRET (Stripe shows it once).

It reads the same environment as the shop (STRIPE_SECRET_KEY, SHOP_DATA). It refuses to touch a live
account unless SHOP_ALLOW_LIVE=yes, like the shop itself. When both price files exist it prints the
test → live price id mapping.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from atshop import catalogue as catmod  # noqa: E402
from atshop import config  # noqa: E402
from atshop.stripe import Stripe  # noqa: E402

PRODUCT_TEXT = {
    "plan": "{name} licence: the show-room toolkit for event technicians.",
    "addon": "We run your AT SUITE server for you: sealed off from other venues, in the UK, with backups and updates.",
    "pass": "A one-off AT SUITE licence for a single show or hire.",
}


def product_key(kind: str, key: str) -> str:
    return f"{kind}:{key}"


def plan_changes(cat: catmod.Catalogue) -> list[tuple]:
    """(kind, key, cycle, name, amount) for every item that has no Stripe price at today's amount."""
    return [it for it in cat.items() if not cat.price_id(it[0], it[1], it[2])]


def stale_prices(cat: catmod.Catalogue) -> list[str]:
    """Active Stripe prices that are no longer the price on sale."""
    selling = {cat.price_id(k, key, c) for k, key, c, _, _ in cat.items()}
    return [pid for pid, p in cat.prices.items() if p.get("active", True) and pid not in selling]


def adopt_existing(cat: catmod.Catalogue, in_stripe: list[dict]) -> tuple[list[str], list[dict]]:
    """Record prices Stripe already has for a catalogue item at today's amount instead of making them again.
    Returns (adopted price ids, active prices that match nothing in the catalogue, which are left alone)."""
    wanted = {(k, key, c): amount * 100 for k, key, c, _, amount in cat.items()}
    adopted, other = [], []
    for p in in_stripe:
        if p["id"] in cat.prices:
            continue
        md = p.get("metadata") or {}
        ident = (md.get("kind"), md.get("key"), md.get("cycle") or "")
        interval = (p.get("recurring") or {}).get("interval") or ""
        if (ident in wanted and p.get("unit_amount") == wanted[ident] and interval == ident[2]
                and (p.get("currency") or "").upper() == cat.currency and not cat.price_id(*ident)):
            kind, key, cycle = ident
            cat.prices[p["id"]] = {"kind": kind, "key": key, "cycle": cycle, "amount": wanted[ident],
                                   "currency": cat.currency, "active": True}
            cat.products.setdefault(product_key(kind, key), p["product"])
            adopted.append(p["id"])
        else:
            other.append(p)
    return adopted, other


def print_mapping(s: config.Settings, cat: catmod.Catalogue) -> None:
    """Test and live price ids side by side, matched by plan and billing period."""
    if s.stripe_mode == "live":
        test = catmod.load(s.catalogue_file, s.data_dir / "stripe-prices.test.json")
        live = cat
    else:
        test = cat
        live = catmod.load(s.catalogue_file, s.data_dir / "stripe-prices.live.json")
    if not (test.prices and live.prices):
        return
    print("\nTest → live price ids:")
    for kind, key, cycle, name, _ in cat.items():
        print(f"  {name:<28} {cycle or 'one-off':<8} {test.price_id(kind, key, cycle) or '-':<32} → "
              f"{live.price_id(kind, key, cycle) or 'not made yet'}")


def setup_portal(stripe: Stripe, s: config.Settings, apply: bool) -> None:
    if stripe.portal_configurations():
        print("Customer portal: already set up (change it in Stripe → Settings → Billing → Customer portal).")
    elif apply:
        print(f"Customer portal: made {stripe.create_portal_configuration(s.site_url)}")
    else:
        print("Customer portal: not set up yet; --apply makes it (card, invoices, cancel at period end).")


def setup_webhook(stripe: Stripe, url: str, apply: bool) -> None:
    if any(w.get("url") == url for w in stripe.webhook_endpoints()):
        print(f"Webhook: {url} already exists. Its signing secret is in Stripe → Developers → Webhooks.")
    elif apply:
        w = stripe.create_webhook_endpoint(url)
        print(f"Webhook: made {w['id']} for {url}.\n  Put this in STRIPE_WEBHOOK_SECRET now; Stripe won't show it "
              f"again here:\n  {w['secret']}")
    else:
        print(f"Webhook: would make {url}")


def main(argv=None, settings: config.Settings | None = None, transport=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="create the missing products and prices")
    ap.add_argument("--archive-old", action="store_true", help="archive prices that are no longer on sale")
    ap.add_argument("--webhook", metavar="URL", help="make the webhook endpoint for https://<domain>/webhooks/stripe")
    a = ap.parse_args(argv)

    s = settings or config.load()
    s.dev = True  # this tool doesn't need SHOP_SECRET
    s.check()
    if not s.stripe_secret_key:
        print("STRIPE_SECRET_KEY isn't set. Copy the secret key from Stripe → Developers → API keys (test mode).")
        return 2
    cat = catmod.load(s.catalogue_file, s.prices_file)
    print(f"Stripe {s.stripe_mode} mode; prices file {s.prices_file}")

    stripe = Stripe(s, transport=transport)
    adopted, other = adopt_existing(cat, stripe.list_prices())
    for pid in adopted:
        p = cat.prices[pid]
        print(f"  in Stripe  {pid}  {p['kind']}:{p['key']} {p['cycle'] or 'one-off'} (recorded, not made again)")
    for p in other:
        print(f"  left alone {p['id']}  {p.get('nickname') or ''} (in Stripe, not a catalogue price)")
    if adopted and a.apply:
        cat.save_prices()
    setup_portal(stripe, s, a.apply)
    if a.webhook:
        setup_webhook(stripe, a.webhook, a.apply)

    todo = plan_changes(cat)
    old = stale_prices(cat)
    for kind, key, cycle, name, amount in todo:
        print(f"  new price  {name:<28} {catmod.money(amount, cat.currency):>8} {('per ' + cycle) if cycle else 'one-off'}")
    if a.archive_old:
        for pid in old:
            p = cat.prices[pid]
            print(f"  archive    {pid}  {p['kind']}:{p['key']} {p.get('cycle', '')} {p['amount'] / 100:.2f}")
    if not todo and not (a.archive_old and old):
        print("Stripe already matches catalogue.toml. Nothing to do.")
        print_mapping(s, cat)
        return 0
    if not a.apply:
        print("\nNothing changed. Run again with --apply to create these.")
        return 0

    for kind, key, cycle, name, amount in todo:
        pk = product_key(kind, key)
        if pk not in cat.products:
            cat.products[pk] = stripe.create_product(name, PRODUCT_TEXT[kind].format(name=name),
                                                     {"kind": kind, "key": key})
            cat.save_prices()
        label = f"{name} ({'monthly' if cycle == 'month' else 'yearly' if cycle == 'year' else 'one-off'})"
        info = {"kind": kind, "key": key, "cycle": cycle}
        pid = stripe.create_price(cat.products[pk], label, amount * 100, cat.currency, cycle, metadata=info)
        cat.prices[pid] = {**info, "amount": amount * 100, "currency": cat.currency, "active": True}
        cat.save_prices()  # after each one, so a failure halfway loses nothing
        print(f"  created {pid} for {label}")
    if a.archive_old:
        for pid in old:
            stripe.archive_price(pid)
            cat.prices[pid]["active"] = False
            cat.save_prices()
            print(f"  archived {pid}")
    print(f"\nSaved {s.prices_file}. The shop picks it up when Admin → Plans is opened, or on restart.")
    print_mapping(s, cat)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
