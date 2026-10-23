# AT SUITE website and shop

The public website, the shop (Stripe subscriptions), the customer portal and the admin pages for selling
AT SUITE. It is one small Python app (FastAPI, SQLite) that runs on its own server, separate from the
AT SUITE server venues use.

What it does:

- **Website**: home, features, how it works, pricing (monthly or yearly), self-hosted vs managed hosting,
  FAQ, downloads, docs, support and contact, and the legal pages (marked as drafts).
- **Accounts**: sign-in by emailed link (no passwords to leak), one free 30-day trial per account.
- **Checkout**: Stripe Checkout and Stripe Billing (card details never touch the shop; Stripe sends the
  invoices). Stripe is the payment processor, not a reseller: you are the seller, so VAT is yours (see below).
  Monthly or yearly plans, managed hosting as an add-on, and a one-off event pass.
- **Licence keys**: issued automatically when Stripe confirms a payment, in exactly the signed format
  `tools/licence.py` makes, so the AT SUITE server checks them offline as it does today. Renewals,
  upgrades and downgrades issue a new key; the app's own warnings, 14-day grace and show-safe lock are
  unchanged.
- **Customer portal**: keys (copy or download), plan changes, billing and invoices (via Stripe's customer portal),
  hosted venue status, details and support messages.
- **Admin** (`/admin`, a 6-digit authenticator code on top of sign-in): customers, keys (issue by hand
  for enterprise deals, revoke), plans and Stripe prices, hosted venues and their jobs, support
  messages, webhook events (with retry), the email outbox and an audit log of every change.

## Prices

Prices live in [`catalogue.toml`](catalogue.toml) and nowhere else. To change one, edit it, then run
`python tools/stripe_setup.py --apply` so Stripe has a matching price. Customers already subscribed
stay on the price they bought at.

| Plan | Laptops | Monthly | Yearly |
|---|---|---|---|
| Small | 10 | £99 | £990 |
| Venue | 30 | £229 | £2,290 |
| Large | 75 | £429 | £4,290 |
| Managed hosting (add-on) | | £39 | £390 |
| Event pass (7 days, 10 laptops) | | £149 one-off | |

Enterprise (more than 75 laptops or several sites) is "contact sales"; its keys are made in
Admin → Licences. Prices exclude VAT.

**VAT.** Paddle was a reseller and dealt with VAT for every country. With Stripe, the business selling
AT SUITE is the seller, so VAT is the business's job. Below the UK registration threshold and not
registered, no VAT is charged: leave `STRIPE_TAX` off. Once registered, add the registration in
Stripe → Tax and set `STRIPE_TAX=yes`; Stripe Tax then adds UK VAT, reverse charge for EU/UK
business customers who give a VAT number (they can at checkout), and tracks other countries'
thresholds. Stripe Tax has its own fee. Ask an accountant before selling to consumers abroad.

## Try it on your computer

```sh
cd website
python3 -m pip install -r requirements-dev.txt
python3 -m pytest -q                       # the tests use a throwaway signing key and a fake Stripe

# a throwaway signing key, only for trying it out
python3 -c "from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey as K; \
from cryptography.hazmat.primitives import serialization as s; \
open('dev-key.pem','wb').write(K.generate().private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()))"
chmod 600 dev-key.pem

SHOP_DEV=1 LICENCE_SIGNING_KEY_FILE=dev-key.pem ADMIN_EMAILS=you@example.com \
  python3 -m uvicorn atshop.app:app --port 8090
```

Open http://localhost:8090. With `SHOP_DEV=1` and no email server, emails (sign-in links included)
are printed in the terminal instead of sent. Keys made with the throwaway key won't open a real AT SUITE server,
which is what you want while testing.

## Going live, step by step

Everything below uses Stripe's **test mode** (test cards, no real money) until live billing is approved.

1. **Stripe account** (test mode): https://dashboard.stripe.com. Developers → API keys: copy the
   **secret key** (`sk_test_...`). A restricted key (`rk_test_...`) works too if it can write
   Customers, Checkout Sessions, Subscriptions, Customer portal, Products, Prices and Webhook endpoints,
   and read Invoices.
2. **Settings**: `cp .env.example .env` and fill it in (`SHOP_SECRET`, `STRIPE_SECRET_KEY`, `ADMIN_EMAILS`,
   `SITE_URL`).
3. **Prices, portal and webhook in Stripe**:
   `python3 tools/stripe_setup.py --webhook https://<your domain>/webhooks/stripe` shows what it would
   make; add `--apply` to make it. It makes the products and prices from `catalogue.toml` (saved to
   `data/stripe-prices.test.json`), the customer portal settings (card, invoices, cancel at the end of the
   period, billing details) and the webhook endpoint with exactly the events the shop reads, and prints the
   endpoint's signing secret: put it in `STRIPE_WEBHOOK_SECRET`. Prices it finds already there (made by it
   earlier, from any computer) are recorded, not made twice.
   - Testing on your own computer with no public address: `stripe listen --forward-to
     localhost:8090/webhooks/stripe` (the Stripe CLI) prints a `whsec_...` for `STRIPE_WEBHOOK_SECRET`; set
     `STRIPE_WEBHOOK_IP_CHECK=no` for that.
   - The events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`,
     `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
4. **Stripe settings worth a look** (Dashboard → Settings):
   - Business → Public details: the name and support email customers see on checkout and card statements.
   - Billing → Subscriptions and emails: Smart Retries on (Stripe retries failed renewals), and the
     emails for failed payments and expiring cards. The shop also emails about failed payments.
   - Billing → Invoices: invoice numbering and footer (company number, VAT number once registered).
   - Payments → Payment methods: card is enough to start; others can be switched on.
5. **The signing key**: the vendor private key (the pair of `server/atsuit/vendor_pubkey.txt`) goes on the
   shop server only, as `secrets/vendor-private-key.pem`:
   `chmod 400 secrets/vendor-private-key.pem && sudo chown 10001 secrets/vendor-private-key.pem`
   (10001 is the shop's user in the container). It is never committed, never in a page, and no
   endpoint signs on request: keys are only made for a verified payment, a trial or an admin.
6. **Email**: any SMTP service (`SMTP_*`). Sign-in links go by email, so this is needed before launch.
7. **Run it**: `docker compose up -d --build`, with Caddy in front ([deploy/Caddyfile](deploy/Caddyfile))
   and Cloudflare in front of that. Nightly database copies: [deploy/backup.sh](deploy/backup.sh).
8. **Admin**: sign in with an `ADMIN_EMAILS` address, open `/admin`, and scan the code into an
   authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...).
9. **Test a purchase** in test mode with Stripe's test card `4242 4242 4242 4242`, any future date, any CVC.
   `4000 0000 0000 0341` attaches but fails at renewal, to try the failed-payment path.
10. **Live**. This changes settings only; the code is the same in both. Nothing below deletes or
    replaces anything already in the live account.
    - Activate the Stripe account (business details, bank account for payouts).
    - Developers → API keys in live mode: the live secret key (`sk_live_...`) in `STRIPE_SECRET_KEY`, and
      `SHOP_ALLOW_LIVE=yes` (the shop refuses a live key without it). Events from the other mode are refused.
    - `python3 tools/stripe_setup.py --webhook https://<your domain>/webhooks/stripe` reads the live account
      first and shows what it would make; then `--apply`. It prints the test → live price id list. The live
      list is `data/stripe-prices.live.json`; the test one stays beside it. There are no price ids in the
      code to change. Put the live endpoint's signing secret in `STRIPE_WEBHOOK_SECRET`.
    - Webhooks are only accepted from the addresses Stripe publishes at
      `https://stripe.com/files/ips/ips_webhooks.json`, read by the shop and refreshed hourly, and only
      with a good signature. Behind Cloudflare the visitor address comes from `CF-Connecting-IP`,
      otherwise from Caddy's `X-Forwarded-For`, so keep the shop's port bound to 127.0.0.1.
    - VAT: see above before switching `STRIPE_TAX` on.

How the pieces fit: **Buy** makes the order and a Stripe Checkout Session on the server (the prices and
the order reference are set there, never by the browser) and sends the customer to Stripe's page.
`invoice.paid` issues each period's key (first payment, renewals, upgrades); `checkout.session.completed`
issues an event pass; `customer.subscription.*` keeps the plan, period and cancel date and issues a new
key when the plan changes. Plan changes are made on our site (Stripe's portal only does card, invoices,
billing details and cancel), so a new key always comes with them. Every request pins Stripe API
version `2025-08-27.basil`; the webhook handler reads both older and newer payload shapes, so an
endpoint left on the account's default version still works.

The shop holds the key that makes licences, so keep it away from anything customers run. Its own small
server is safest. Starting out, it can share the hosting server behind the atcloud front door, where the
venues can't reach it: see "Other sites on the same server" in docs/HOSTING.md and
[deploy/atcloud-edge.caddy](deploy/atcloud-edge.caddy). Never put it on a venue's own server.

## Managed hosting

The shop talks to the hosting server only through the `atcloud` tool (`cloud/atcloud`). When a customer
buys hosting, the shop records the venue and queues a job:

- `HOSTING_MODE=manual` (the default): jobs wait in Admin → Hosting with the exact command to paste on the
  hosting server and the key file to download. Mark each job done (paste atcloud's output so the setup
  link is saved).
- `HOSTING_MODE=ssh`: the shop runs the same commands itself over SSH (`HOSTING_SSH=user@host`,
  `HOSTING_SSH_KEY`). Keys go to atcloud on stdin, never on the command line.

Commands used: `atcloud new`, `atcloud licence`, `atcloud suspend`, `atcloud resume`. Nothing removes a
venue or its data automatically; when a hosted subscription ends, admins get an email and decide.

## Licence key renewal and the daily check-in

A yearly key runs to the end of the paid year plus 7 spare days; a monthly key to the end of the month
plus 7. Each renewal emails the new key and shows it in the portal.

Every key the shop makes names the shop (`checkin`, from `SITE_URL`, so set that before selling). The
AT SUITE server posts its key to `POST /api/v1/licence/refresh` once a day and gets back that
subscription's newest key (it installs it by itself), `"status": "current"`, or `"status": "revoked"`
when an admin revoked the key or a renewal of it. A revoked key locks at the server's next quiet
moment; a server that can't reach the shop for 14 days locks the same way until it does. Never
during a show. Admin → Licences → "Offline key" makes a key with no `checkin`, for venues with no
internet: it never checks in, so it can't be revoked early or renew itself.

## What's done and what isn't

Done and tested (`pytest`, 59 tests, a fake Stripe and a throwaway key):

- signed webhooks (bad, missing or old signatures refused), duplicates applied once, out-of-order
  subscription events skipped, a failed event recorded and retried
- the full journey: sign up, checkout, payment, a key the AT SUITE server's own licence code accepts
- monthly renewal, upgrade and downgrade (charged now / credited at the next bill), past due, cancel at
  period end,
  cancelled; keys never cut short; unknown prices flagged and nothing issued
- event pass (including a payment that clears later), trial (once per account), key refresh, invoices
  only for your own payments, both Stripe payload shapes, the database move from the Paddle columns
- admin: 403 for customers, the authenticator code, hand-issued keys need a reason and are audited,
  revoking; CSRF on every form; sign-in links single use and time-limited
- managed hosting in manual and ssh modes; the Stripe setup tool, including a price change and the webhook
- the catalogue's laptop limits match `tools/licence.py`

Not done yet, needs a person:

- the live Stripe switch-on, VAT registration when needed, and an SMTP service
- the domain and the shop server
- a solicitor's review of the legal pages (they are drafts with placeholders)
- a purchase run end to end against Stripe's real test mode: the tests use a stand-in that follows
  Stripe's documented API
