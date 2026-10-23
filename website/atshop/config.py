"""Settings, all from environment variables (see .env.example). Nothing secret lives in the repo."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _bool(v: str | None, default: bool = False) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "yes", "true", "on")


def _secret(name: str) -> str:
    """NAME, or the contents of the file in NAME_FILE (Docker secrets)."""
    f = os.environ.get(f"{name}_FILE")
    if f:
        return Path(f).read_text().strip()
    return os.environ.get(name, "").strip()


class ConfigError(RuntimeError):
    pass


@dataclass
class Settings:
    site_url: str = "http://localhost:8090"
    data_dir: Path = Path("./data")
    secret: str = ""
    dev: bool = False
    # Stripe. A test key (sk_test_/rk_test_) until adam says otherwise; a live key also needs allow_live.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_api_url: str = ""
    # Stripe Tax works out and adds VAT at checkout. Only switch it on once registered for VAT.
    stripe_tax: bool = False
    # Only accept webhooks from the addresses Stripe publishes (as well as checking the signature).
    stripe_webhook_ip_check: bool = True
    stripe_webhook_ips_url: str = "https://stripe.com/files/ips/ips_webhooks.json"
    allow_live: bool = False
    # The vendor private key that signs AT SUITE licence keys (a file, mode 600, never in git).
    signing_key_file: str = ""
    admin_emails: set[str] = field(default_factory=set)
    # Email. With no SMTP_HOST, mail is kept in the outbox (admin → Emails) and logged, not sent.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_tls: bool = True
    mail_from: str = "AT SUITE <noreply@atsuite.tech>"
    support_email: str = "support@atsuite.tech"
    sales_email: str = "hello@atsuite.tech"
    company_name: str = "[COMPANY NAME] Ltd"
    # Managed hosting: "manual" (jobs wait in admin → Hosting for you to run) or "ssh" (runs atcloud).
    hosting_mode: str = "manual"
    hosting_domain: str = ""
    hosting_ssh: str = ""  # user@host for ssh mode
    hosting_ssh_key: str = ""
    hosting_atcloud: str = "atcloud"
    releases_repo: str = "adam1991tom/AT-SUITE-releases"
    catalogue_file: Path = HERE.parent / "catalogue.toml"

    @property
    def secure_cookies(self) -> bool:
        return self.site_url.startswith("https://")

    @property
    def stripe_base(self) -> str:
        return (self.stripe_api_url or "https://api.stripe.com").rstrip("/")

    @property
    def stripe_mode(self) -> str:
        """test or live, from the key itself: Stripe keys say which mode they belong to."""
        return "live" if self.stripe_secret_key.startswith(("sk_live_", "rk_live_")) else "test"

    @property
    def billing_ready(self) -> bool:
        return bool(self.stripe_secret_key)

    @property
    def prices_file(self) -> Path:
        return self.data_dir / f"stripe-prices.{self.stripe_mode}.json"

    def check(self) -> None:
        if self.stripe_secret_key and not self.stripe_secret_key.startswith(("sk_test_", "sk_live_", "rk_test_", "rk_live_")):
            raise ConfigError("STRIPE_SECRET_KEY should start sk_test_ or rk_test_ (or sk_live_/rk_live_ once live). "
                              "The publishable key (pk_...) isn't needed.")
        if self.stripe_mode == "live" and not self.allow_live:
            raise ConfigError("STRIPE_SECRET_KEY is a live key, which takes real money. Set SHOP_ALLOW_LIVE=yes only "
                              "once live billing has been approved.")
        if self.stripe_webhook_secret and not self.stripe_webhook_secret.startswith("whsec_"):
            raise ConfigError("STRIPE_WEBHOOK_SECRET is the endpoint's signing secret, which starts whsec_")
        if not self.dev and len(self.secret) < 32:
            raise ConfigError("SHOP_SECRET must be at least 32 random characters (python -c \"import secrets; "
                              "print(secrets.token_urlsafe(48))\")")
        if self.hosting_mode not in ("manual", "ssh"):
            raise ConfigError("HOSTING_MODE must be manual or ssh")
        if self.hosting_mode == "ssh" and not self.hosting_ssh:
            raise ConfigError("HOSTING_MODE=ssh needs HOSTING_SSH (user@host)")


def load() -> Settings:
    e = os.environ.get
    s = Settings(
        site_url=e("SITE_URL", "http://localhost:8090").rstrip("/"),
        data_dir=Path(e("SHOP_DATA", "./data")),
        secret=_secret("SHOP_SECRET"),
        dev=_bool(e("SHOP_DEV")),
        stripe_secret_key=_secret("STRIPE_SECRET_KEY"),
        stripe_webhook_secret=_secret("STRIPE_WEBHOOK_SECRET"),
        stripe_api_url=e("STRIPE_API_URL", ""),
        stripe_tax=_bool(e("STRIPE_TAX")),
        stripe_webhook_ip_check=_bool(e("STRIPE_WEBHOOK_IP_CHECK"), True),
        allow_live=_bool(e("SHOP_ALLOW_LIVE")),
        signing_key_file=e("LICENCE_SIGNING_KEY_FILE", ""),
        admin_emails={a.strip().lower() for a in e("ADMIN_EMAILS", "").split(",") if a.strip()},
        smtp_host=e("SMTP_HOST", ""),
        smtp_port=int(e("SMTP_PORT", "587") or 587),
        smtp_user=e("SMTP_USER", ""),
        smtp_password=_secret("SMTP_PASSWORD"),
        smtp_tls=_bool(e("SMTP_TLS"), True),
        mail_from=e("MAIL_FROM", "AT SUITE <noreply@atsuite.tech>"),
        support_email=e("SUPPORT_EMAIL", "support@atsuite.tech"),
        sales_email=e("SALES_EMAIL", "hello@atsuite.tech"),
        company_name=e("COMPANY_NAME", "[COMPANY NAME] Ltd"),
        hosting_mode=e("HOSTING_MODE", "manual").strip().lower(),
        hosting_domain=e("HOSTING_DOMAIN", "").strip().lower(),
        hosting_ssh=e("HOSTING_SSH", ""),
        hosting_ssh_key=e("HOSTING_SSH_KEY", ""),
        hosting_atcloud=e("HOSTING_ATCLOUD", "atcloud"),
        releases_repo=e("RELEASES_REPO", "adam1991tom/AT-SUITE-releases"),
    )
    if e("CATALOGUE_FILE"):
        s.catalogue_file = Path(e("CATALOGUE_FILE"))
    return s
