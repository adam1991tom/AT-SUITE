"""Passwords, sessions, node tokens, API keys and encryption at rest."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request, WebSocket

from . import config, db

SESSION_COOKIE = "atsuit_session"
# A tech laptop signed in by its own node token (the tech only types their name).
NODE_COOKIE = "atsuit_node"
ROLES = ("admin", "manager", "tech", "viewer")
# A manager runs the venue day to day (rooms, techs, laptops' rooms, the audit log)
# but can't change site settings, the licence, branding, views or add laptops.
_ROLE_RANK = {"viewer": 0, "tech": 1, "manager": 2, "admin": 3}


# Same format as AT-RoomComms and AT-Presenter, so migrated accounts keep their passwords.
# 1.20.0 raised the rounds from 200k to 300k. The stored hash doesn't say which it used, so a
# password saved before then is checked with the old rounds too, and saved again with the new
# ones at its next sign-in.
ROUNDS = 300_000
OLD_ROUNDS = (200_000,)


def hash_password(password: str, salt: str | None = None, rounds: int = ROUNDS) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), rounds).hex()
    return f"{salt}${digest}"


def password_rounds(password: str, stored: str) -> int | None:
    """The rounds the stored hash was made with, if the password matches it."""
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return None
    for rounds in (ROUNDS, *OLD_ROUNDS):
        if hmac.compare_digest(hash_password(password, salt, rounds), stored):
            return rounds
    return None


def verify_password(password: str, stored: str) -> bool:
    return password_rounds(password, stored) is not None


def token_hash(token: str, algorithm: str = "sha512") -> str:
    """Hash a token with the specified algorithm (sha256 for backward compatibility, sha512 for new tokens)."""
    if algorithm == "sha256":
        return hashlib.sha256(token.encode()).hexdigest()
    elif algorithm == "sha512":
        return hashlib.sha512(token.encode()).hexdigest()
    else:
        raise ValueError(f"Unsupported hash algorithm: {algorithm}")


def new_token(prefix: str = "") -> str:
    # Increased token length in 1.20.0 for stronger security (32 → 48 bytes)
    return prefix + secrets.token_urlsafe(48)


# ------------------------------------------------------------- encryption --
_fernet: Fernet | None = None


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key_file = config.cfg.data / "secret.key"
        if not key_file.exists():
            key_file.write_bytes(Fernet.generate_key())
            try:
                os.chmod(key_file, 0o600)
            except OSError:
                pass
        _fernet = Fernet(key_file.read_bytes().strip())
    return _fernet


def reset_keys() -> None:
    global _fernet
    _fernet = None


def encrypt(value: str) -> str:
    return fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return fernet().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError):
        return ""


# ------------------------------------------------------------- principals --
@dataclass
class Principal:
    kind: str  # account | node | apikey
    id: int
    name: str
    role: str = "viewer"
    site_id: int | None = None
    room_id: int | None = None

    def at_least(self, role: str) -> bool:
        return _ROLE_RANK.get(self.role, -1) >= _ROLE_RANK[role]

    @property
    def label(self) -> str:
        return f"{self.kind}:{self.name}"


def create_session(c, account_id: int, minutes: int | None = None) -> str:
    token = new_token()
    now = datetime.now(timezone.utc)
    life = timedelta(minutes=minutes) if minutes else timedelta(hours=config.cfg.session_hours)
    c.execute(
        "INSERT INTO sessions(token_hash,account_id,created_at,expires_at,hash_algorithm) VALUES(?,?,?,?,?)",
        (token_hash(token, "sha512"), account_id, now.isoformat(), (now + life).isoformat(), "sha512"),
    )
    return token


def _from_session(c, token: str) -> Principal | None:
    # Try sha512 first (new in 1.20.0), fall back to sha256 for backward compatibility
    r = c.execute(
        "SELECT a.id,a.username,a.display_name,a.role,a.site_id,s.expires_at FROM sessions s "
        "JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND a.active=1",
        (token_hash(token, "sha512"),),
    ).fetchone()
    if not r:
        r = c.execute(
            "SELECT a.id,a.username,a.display_name,a.role,a.site_id,s.expires_at FROM sessions s "
            "JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND a.active=1",
            (token_hash(token, "sha256"),),
        ).fetchone()
    if not r or r["expires_at"] < datetime.now(timezone.utc).isoformat():
        return None
    return Principal("account", r["id"], r["display_name"] or r["username"], r["role"], r["site_id"])


def _from_node(c, token: str) -> Principal | None:
    # Try sha512 first (new in 1.20.0), fall back to sha256 for backward compatibility
    r = c.execute("SELECT id,name,kind,operator,site_id,room_id FROM nodes WHERE token_hash=?", (token_hash(token, "sha512"),)).fetchone()
    if not r:
        r = c.execute("SELECT id,name,kind,operator,site_id,room_id FROM nodes WHERE token_hash=?", (token_hash(token, "sha256"),)).fetchone()
    return _node_principal(r)


def _node_principal(r) -> Principal | None:
    if not r:
        return None
    # On a tech laptop the person at it is who chat and help requests come from.
    name = r["operator"] if r["kind"] == "tech" and r["operator"] else r["name"]
    return Principal("node", r["id"], name, "tech", r["site_id"], r["room_id"])


def _from_apikey(c, key: str) -> Principal | None:
    # sha512 since 1.20.0; keys made before then are sha256
    r = c.execute("SELECT id,name FROM api_keys WHERE key_hash IN (?,?)", (token_hash(key, "sha512"), token_hash(key, "sha256"))).fetchone()
    return Principal("apikey", r["id"], r["name"], "tech") if r else None


def resolve(headers, cookies) -> Principal | None:
    """Who is asking, from a header or a cookie. Never from the address: a
    password, token or key in a URL ends up in browser history, proxy and
    server logs, so the query string is not read here at all."""
    auth = headers.get("authorization", "")
    with db.ro() as c:
        if auth.lower().startswith("node "):
            return _from_node(c, auth[5:].strip())
        if headers.get("x-api-key"):
            return _from_apikey(c, headers["x-api-key"])
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else cookies.get(SESSION_COOKIE)
        if token:
            p = _from_session(c, token)
            if p:
                return p
        if cookies.get(NODE_COOKIE):
            return _from_node(c, cookies[NODE_COOKIE])
    return None


def principal(request: Request) -> Principal | None:
    return resolve(request.headers, request.cookies)


def ws_principal(ws: WebSocket) -> Principal | None:
    """A browser can't put a header on a WebSocket, so a page that isn't signed in
    by cookie first swaps its header for a ticket (POST /api/auth/ws-ticket) and
    opens the socket with ?ticket=. A ticket works once, within a minute, so one
    that turns up in a log is already useless."""
    return resolve(ws.headers, ws.cookies) or redeem_ticket(ws.query_params.get("ticket", ""))


# ----------------------------------------------------------- ws tickets --
TICKET_SECONDS = 60
_TICKETS_MAX = 5000
_tickets: dict[str, tuple[float, str, int]] = {}
_tickets_lock = threading.Lock()


def issue_ticket(p: Principal) -> str:
    now = time.monotonic()
    with _tickets_lock:
        for k, (exp, *_) in list(_tickets.items()):
            if exp < now:
                del _tickets[k]
        if len(_tickets) >= _TICKETS_MAX:
            raise HTTPException(429, "Too many connections starting at once; try again in a minute")
        t = secrets.token_urlsafe(24)
        _tickets[t] = (now + TICKET_SECONDS, p.kind, p.id)
    return t


def redeem_ticket(ticket: str) -> Principal | None:
    if not ticket:
        return None
    with _tickets_lock:
        item = _tickets.pop(ticket, None)
    if not item or item[0] < time.monotonic():
        return None
    _, kind, pid = item
    # Looked up again, so a laptop removed or an account turned off in that minute gets nothing.
    with db.ro() as c:
        if kind == "node":
            return _node_principal(c.execute("SELECT id,name,kind,operator,site_id,room_id FROM nodes WHERE id=?", (pid,)).fetchone())
        if kind == "account":
            r = c.execute("SELECT id,username,display_name,role,site_id FROM accounts WHERE id=? AND active=1", (pid,)).fetchone()
            return Principal("account", r["id"], r["display_name"] or r["username"], r["role"], r["site_id"]) if r else None
        if kind == "apikey":
            r = c.execute("SELECT id,name FROM api_keys WHERE id=?", (pid,)).fetchone()
            return Principal("apikey", r["id"], r["name"], "tech") if r else None
    return None


# ------------------------------------------------- secrets out of addresses --
# Query parameters that carry a password, token, key or code. They are never
# read from the address (see resolve), wiped from logs, and a page opened with
# one is sent on to the same page without it.
SECRET_PARAMS = frozenset({
    "password", "new_password", "new_password2", "pass", "passwd", "pw", "pin",
    "username", "operator", "token", "node_token", "access_token", "ticket", "secret",
    "key", "api_key", "apikey", "code", "enrol_code", "sync_code", "setup_code", "licence_key", "admin_password",
})
# Links whose path itself is the key: a presenter's upload link, and the old
# room sync tool's room code. They have to stay links, so they're kept out of the logs.
_SECRET_PATH = re.compile(r"^(/(?:api/)?present/|/api/presenter/sync/)([^/?#]+)")


def secret_params(query: str) -> set[str]:
    from urllib.parse import parse_qsl

    return {k for k, _ in parse_qsl(query, keep_blank_values=True) if k.lower() in SECRET_PARAMS}


def strip_secrets(query: str) -> str:
    from urllib.parse import parse_qsl, urlencode

    return urlencode([(k, v) for k, v in parse_qsl(query, keep_blank_values=True) if k.lower() not in SECRET_PARAMS])


def clean_url(url: str) -> str:
    """A full address with any secret taken out of its query and fragment (for
    addresses a laptop reports, which are shown on the console)."""
    from urllib.parse import urlsplit, urlunsplit

    try:
        u = urlsplit(str(url))
    except ValueError:
        return ""
    frag = u.fragment if "=" not in u.fragment else strip_secrets(u.fragment)
    return urlunsplit((u.scheme, u.netloc, u.path, strip_secrets(u.query), frag))


def redact_url(url: str) -> str:
    """A path and query fit for a log: secret values become ***."""
    from urllib.parse import parse_qsl, quote

    path, sep, query = str(url).partition("?")
    path = _SECRET_PATH.sub(lambda m: m.group(1) + "***", path)
    if not sep:
        return path
    parts = [f"{quote(k, safe='')}={'***' if k.lower() in SECRET_PARAMS else quote(v, safe=',')}"
             for k, v in parse_qsl(query, keep_blank_values=True)]
    return f"{path}?{'&'.join(parts)}" if parts else path


class RedactSecrets(logging.Filter):
    """On uvicorn's loggers: the request line of every access and WebSocket log
    line goes through redact_url, so nothing secret reaches a log file."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and record.args:
            record.args = tuple(redact_url(a) if isinstance(a, str) and a.startswith("/") else a for a in record.args)
        return True


_redacting = RedactSecrets()


def redact_logs() -> None:
    for name in ("uvicorn.access", "uvicorn.error", "uvicorn"):
        log = logging.getLogger(name)
        if _redacting not in log.filters:
            log.addFilter(_redacting)


# ------------------------------------------------------------- rate limiting --
# Simple in-memory rate limiter for API endpoints. Not persistent across restarts,
# but sufficient for brute force protection. For production with multiple workers,
# consider Redis or a database-backed implementation.
_RATE_LIMITS: dict[str, list[float]] = defaultdict(list)
_RATE_LIMIT_LOCK = threading.Lock()


def check_rate_limit(identifier: str, limit: int, window_seconds: int = 60) -> bool:
    """Return True if the identifier is within limits, False if rate limited."""
    now = time.monotonic()
    with _RATE_LIMIT_LOCK:
        requests = _RATE_LIMITS[identifier]
        # Remove requests outside the time window
        requests[:] = [t for t in requests if t > now - window_seconds]
        if len(requests) >= limit:
            return False
        requests.append(now)
        return True


def rate_limit_by_ip(limit: int = 100, window_seconds: int = 60):
    """FastAPI dependency that rate limits by client IP address."""
    def dep(request: Request) -> None:
        # Get IP from X-Forwarded-For if behind proxy, otherwise from direct connection
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        else:
            ip = request.client.host if request.client else "unknown"
        if not check_rate_limit(f"ip:{ip}", limit, window_seconds):
            raise HTTPException(429, "Too many requests. Please try again later.")
    return dep


def rate_limit_by_account(limit: int = 200, window_seconds: int = 60):
    """FastAPI dependency that rate limits by authenticated account."""
    def dep(request: Request) -> None:
        p = principal(request)
        if not p:
            # Fall back to IP rate limiting for unauthenticated requests
            return rate_limit_by_ip(limit, window_seconds)(request)
        if not check_rate_limit(f"account:{p.id}", limit, window_seconds):
            raise HTTPException(429, "Too many requests. Please try again later.")
    return dep


def require(role: str = "viewer", kinds: tuple[str, ...] = ("account", "node", "apikey")):
    def dep(request: Request) -> Principal:
        p = principal(request)
        if not p:
            raise HTTPException(401, "Sign in required")
        if p.kind not in kinds or not p.at_least(role):
            raise HTTPException(403, "Not allowed")
        return p

    return dep


require_admin = require("admin", ("account",))
require_manager = require("manager", ("account",))
require_tech = require("tech")
require_user = require("viewer")
require_node = require("tech", ("node",))
