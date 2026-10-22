"""Offline licence check, and what happens as a subscription runs out.

A licence key is `<base64url(json)>.<base64url(ed25519 signature)>`, signed with
the vendor's private key (see tools/licence.py). The matching public key ships
in `vendor_pubkey.txt` inside the image and is the only key trusted. The key is
checked here, offline.

A key from the website also names the website it checks in with (`checkin`). Once
a day the server sends its key there: it gets back a renewed key when there is one,
or hears that the key was cancelled. A key that hasn't reached the website for
CHECKIN_GRACE_DAYS stops counting, and so does a cancelled one; both then lock the
same way a lapsed key does (never during a show). Keys made without `checkin`
("offline" keys, for venues with no internet) never check in.

AT-SUITE doesn't work until a valid key is installed. A subscription key carries
its end date:
  - WARN_ADMIN_DAYS before it ends admins see a warning; WARN_ALL_DAYS before, everyone does;
  - when it ends there are GRACE_DAYS of grace, with everything still working;
  - after that it locks (only the Licence page works), but never during a show:
    the lock waits for a restart or the small hours, with no timer running and
    no captions live. Nothing is deleted, and a new key unlocks it at once.
The server remembers the latest time it has seen, so winding the clock back
doesn't bring an expired key back to life.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import math
import random
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import db

ALL_MODULES = ["comms", "timers", "fleet", "captions", "overlays", "dashboard", "presenter"]
# The modules of the first release. A licence issued then that lists all of
# them was a full-suite licence, so it covers modules added since.
FIRST_MODULES = {"comms", "timers", "fleet", "captions", "overlays", "dashboard"}

DAY = 86400
WARN_ADMIN_DAYS = 30
WARN_ALL_DAYS = 7
GRACE_DAYS = 14
# Installs set up before keys were required get this long to add one.
UPGRADE_GRACE_DAYS = 14
# A due lock waits for these hours (site time), or a restart, and for no show to be on.
LOCK_HOURS = range(2, 5)
CHECK_EVERY_S = 300
# Keys that check in with the website: once a day, again sooner after a failure, and
# they keep working this long without reaching it.
CHECKIN_EVERY_S = DAY
CHECKIN_RETRY_S = 3 * 3600
CHECKIN_GRACE_DAYS = 14
CHECKIN_WARN_DAYS = 2  # admins hear about missed check-ins after this long
CHECKIN_PATH = "/api/v1/licence/refresh"
TRANSPORT: httpx.BaseTransport | None = None  # tests swap in a stand-in website


@dataclass
class Licence:
    licensee: str = "Not licensed"
    edition: str = "none"
    expires: int = 0  # unix time, 0 = never
    max_nodes: int = 5
    max_sites: int = 1
    modules: list[str] = field(default_factory=lambda: list(ALL_MODULES))
    valid: bool = False
    reason: str = "No licence installed"
    serial: str = ""
    issued: int = 0  # unix time, 0 = not recorded
    # none: no key; invalid: a bad key; active; expiring: ends within WARN_ADMIN_DAYS;
    # grace: ended (or never had a key, on an upgraded install) but still working; lapsed: grace is over;
    # revoked: the website cancelled it; unchecked: it hasn't reached the website for CHECKIN_GRACE_DAYS
    state: str = "none"
    grace_until: int = 0  # unix time the grace ends, when in grace or lapsed
    checkin: str = ""  # the website this key checks in with every day; "" for an offline key

    def allows(self, module: str) -> bool:
        return module in self.modules

    def public(self) -> dict:
        return asdict(self)


NONE = Licence()


def _now() -> float:
    return time.time()


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _vendor_raw() -> tuple[str, str]:
    """The vendor public key and where it came from. Only the file in the image counts:
    there's no setting or variable to swap it, so nobody can sign keys of their own."""
    f = Path(__file__).with_name("vendor_pubkey.txt")
    return (f.read_text().strip() if f.exists() else ""), "vendor_pubkey.txt"


def vendor_key_id() -> str:
    """A short fingerprint of the vendor public key, to tell builds apart."""
    raw = _vendor_raw()[0]
    try:
        return hashlib.sha256(_b64d(raw)).hexdigest()[:16] if raw else ""
    except ValueError:
        return ""


def vendor_public_key() -> Ed25519PublicKey | None:
    raw = _vendor_raw()[0]
    if not raw:
        return None
    try:
        return Ed25519PublicKey.from_public_bytes(_b64d(raw))
    except ValueError:
        return None


def _modules(listed) -> list[str]:
    listed = set(listed) if isinstance(listed, list) else {listed}
    if "*" in listed or FIRST_MODULES <= listed:
        return list(ALL_MODULES)
    return [m for m in ALL_MODULES if m in listed]


def _checkin_url(v) -> str:
    v = str(v or "").strip().rstrip("/")
    return v if v.startswith(("https://", "http://")) and len(v) < 300 else ""


def _day(ts: float, tz: str = "UTC") -> str:
    d = datetime.fromtimestamp(ts, ZoneInfo(tz))
    return f"{d.day} {d:%b %Y}"


def parse(key: str, now: float | None = None) -> Licence:
    key = (key or "").strip()
    if not key:
        return NONE
    pub = vendor_public_key()
    if pub is None:
        return Licence(state="invalid", reason="This build has no vendor key, so licences can't be checked")
    try:
        body_b64, sig_b64 = key.split(".", 1)
        body = _b64d(body_b64)
        pub.verify(_b64d(sig_b64), body)
        data = json.loads(body)
    except (ValueError, InvalidSignature):
        return Licence(state="invalid", reason="Licence key is not valid")
    lic = Licence(
        licensee=str(data.get("licensee", "")),
        edition=str(data.get("edition", "standard")),
        expires=int(data.get("expires", 0)),
        max_nodes=int(data.get("max_nodes", 0)),
        max_sites=int(data.get("max_sites", 1)),
        modules=_modules(data.get("modules", ALL_MODULES)),
        valid=True,
        reason="",
        serial=str(data.get("serial") or data.get("id") or hashlib.sha256(body).hexdigest()[:12].upper()),
        issued=int(data.get("issued", 0) or 0),
        state="active",
        checkin=_checkin_url(data.get("checkin")),
    )
    if lic.expires:
        # The clock can't be earlier than the day the key was made.
        now = max(_now() if now is None else now, lic.issued)
        if now >= lic.expires:
            lic.grace_until = lic.expires + GRACE_DAYS * DAY
            if now < lic.grace_until:
                lic.state, lic.reason = "grace", f"Ended on {_day(lic.expires)}; works until {_day(lic.grace_until)}"
            else:
                lic.valid, lic.state, lic.reason = False, "lapsed", f"Licence for {lic.licensee} expired on {_day(lic.expires)}"
        elif lic.expires - now <= WARN_ADMIN_DAYS * DAY:
            lic.state = "expiring"
    return lic


def details(key: str) -> dict:
    """Everything about an installed key for Licence, including what
    an expired licence said. Admins only: it holds the raw key."""
    key = (key or "").strip()
    raw, source = _vendor_raw()
    out = {"installed": bool(key), "raw": key, "signature_valid": False, "payload": {},
           "vendor_key_id": vendor_key_id(), "vendor_key_source": source if raw else ""}
    pub = vendor_public_key()
    if not key or pub is None:
        return out
    try:
        body_b64, sig_b64 = key.split(".", 1)
        body = _b64d(body_b64)
        out["payload"] = json.loads(body)
        pub.verify(_b64d(sig_b64), body)
        out["signature_valid"] = True
    except (ValueError, InvalidSignature):
        pass
    return out


# ----------------------------------------------------------------- the clock --
def clock(c) -> float:
    """Now, or the latest time this server has seen if the clock has gone back since."""
    s = db.get_setting(c, "licence_clock", {}) or {}
    return max(_now(), float(s.get("max") or 0))


def tick(c, issued: int = 0) -> None:
    """Remember the latest time seen. A key issued later than any before it resets the
    remembered time, in case the clock once ran ahead: the vendor's date is the truth."""
    s = db.get_setting(c, "licence_clock", {}) or {}
    now = _now()
    if issued and issued > int(s.get("issued_max") or 0):
        s = {"max": max(now, issued), "issued_max": issued}
    else:
        s["max"] = max(now, float(s.get("max") or 0))
    db.set_setting(c, "licence_clock", s)


def check_new(c, key: str) -> Licence:
    """A key about to be installed, judged by the time it will see once installed:
    a key issued later than any before resets a clock that ran ahead (see tick)."""
    lic = parse(key, now=clock(c))
    s = db.get_setting(c, "licence_clock", {}) or {}
    if lic.issued and lic.issued > int(s.get("issued_max") or 0):
        lic = parse(key, now=max(_now(), lic.issued))
    return lic


def site_tz(c) -> str:
    r = c.execute("SELECT timezone FROM sites ORDER BY id LIMIT 1").fetchone()
    return (r["timezone"] if r else "") or "UTC"


# ---------------------------------------------------------------- the licence --
def current(c) -> Licence:
    lic = parse(db.get_setting(c, "licence_key", ""), now=clock(c))
    if lic.valid and lic.checkin:
        st = checkin_state(c)
        if st.get("revoked") and st["revoked"] == lic.serial:
            lic.valid, lic.state, lic.reason = False, "revoked", "AT SUITE cancelled this licence"
        elif clock(c) >= checkin_deadline(st, lic):
            lic.valid, lic.state = False, "unchecked"
            lic.reason = f"Hasn't reached the licence server since {_day(checkin_last(st, lic), site_tz(c))}"
    if not lic.valid:  # an upgraded install with no working key may still be in its grace (see prepare)
        until = int(db.get_setting(c, "licence_grace_until", 0) or 0)
        if until and clock(c) < until:
            if lic.state != "lapsed":
                lic = Licence()
            lic.state, lic.grace_until, lic.reason = "grace", until, f"Needs a licence key by {_day(until, site_tz(c))}"
    return lic


def locked(c) -> bool:
    """Whether only the Licence page works. A server that has never had a key (and isn't an
    upgraded install in its grace) is locked straight away; one that had a licence locks only
    once enforce() has found a quiet moment."""
    lic = current(c)
    if lic.valid or lic.state == "grace":
        return False
    return not db.get_setting(c, "licence_in_use", False) or bool(db.get_setting(c, "licence_locked", False))


_cache: tuple[float, bool] = (0.0, False)


def locked_cached() -> bool:
    """locked(), looked up at most every few seconds: every request asks."""
    global _cache
    if time.monotonic() - _cache[0] > 5:
        with db.ro() as c:
            _cache = (time.monotonic(), locked(c))
    return _cache[1]


def forget() -> None:
    global _cache
    _cache = (0.0, False)


def installed(c, lic: Licence, actor: str) -> None:
    """A valid key went in (setup or Licence): the server is in use and unlocked."""
    tick(c, lic.issued)
    db.set_setting(c, "licence_in_use", True)
    db.set_setting(c, "licence_locked", False)
    db.set_setting(c, "licence_grace_until", 0)
    st = checkin_state(c)
    st.update(last_try=0, error="")  # check in soon
    if st.get("serial") != lic.serial:  # a new key gets its full time to check in; the same key again doesn't
        st.update(serial=lic.serial, since=int(_now()))
    db.set_setting(c, "licence_checkin", st)
    db.audit(c, actor, "licence.update", f"{lic.licensee} {lic.serial}".strip())
    forget()


def prepare(c) -> None:
    """Once, on the first start of a version that needs keys. An install that was already set
    up keeps working: with a valid key it carries on as before; without one (or with one that
    has run out) it gets UPGRADE_GRACE_DAYS to add one."""
    if db.get_setting(c, "licence_checked", False):
        return
    db.set_setting(c, "licence_checked", True)
    if not db.get_setting(c, "setup_complete", False):
        return
    db.set_setting(c, "licence_in_use", True)
    if not parse(db.get_setting(c, "licence_key", ""), now=clock(c)).valid:
        db.set_setting(c, "licence_grace_until", int(_now()) + UPGRADE_GRACE_DAYS * DAY)


# ------------------------------------------------------------- the check-in --
def checkin_state(c) -> dict:
    """{"last_ok", "last_try", "error", "revoked", "serial", "since"}: when the website last
    answered, when we last tried, what went wrong, the serial the website said was cancelled,
    and which key was installed when."""
    return dict(db.get_setting(c, "licence_checkin", {}) or {})


def checkin_last(st: dict, lic: Licence) -> int:
    """When this key last reached the website, or when it was first installed here if that's
    later. Pasting the same key again doesn't buy more time offline."""
    since = int(st.get("since") or 0) if st.get("serial") == lic.serial else 0
    return max(int(st.get("last_ok") or 0), lic.issued, since)


def checkin_deadline(st: dict, lic: Licence) -> int:
    return checkin_last(st, lic) + CHECKIN_GRACE_DAYS * DAY


def checkin_info(c) -> dict | None:
    """For Licence: where and when this key checks in. None for an offline key."""
    lic = parse(db.get_setting(c, "licence_key", ""), now=clock(c))
    if not lic.checkin:
        return None
    st = checkin_state(c)
    return {"url": lic.checkin, "last_ok": int(st.get("last_ok") or 0), "last_try": int(st.get("last_try") or 0),
            "error": st.get("error") or "", "deadline": checkin_deadline(st, lic),
            "revoked": bool(st.get("revoked")) and st.get("revoked") == lic.serial}


def checkin(force: bool = False, transport: httpx.BaseTransport | None = None) -> dict | None:
    """Send the key to the website it names: install a renewed key, note a cancelled one,
    and record that the website answered. Returns checkin_info, or None for an offline key."""
    with db.ro() as c:
        key = db.get_setting(c, "licence_key", "")
        lic = parse(key, now=clock(c))
        st = checkin_state(c)
    if not lic.checkin or lic.state == "invalid":
        return None
    now = _now()
    wait = CHECKIN_RETRY_S if st.get("error") else CHECKIN_EVERY_S
    if not force and now - float(st.get("last_try") or 0) < wait:
        with db.ro() as c:
            return checkin_info(c)
    answer, error = None, ""
    try:
        with httpx.Client(timeout=20, transport=transport or TRANSPORT, follow_redirects=False) as cl:
            r = cl.post(lic.checkin + CHECKIN_PATH, json={"key": key})
        if r.status_code == 200:
            answer = r.json()
            if not isinstance(answer, dict):
                answer, error = None, "The licence server sent something unexpected"
        else:
            error = f"The licence server answered {r.status_code}"
    except (httpx.HTTPError, ValueError) as e:
        error = f"Couldn't reach the licence server ({type(e).__name__})"
    with db.tx() as c:
        if db.get_setting(c, "licence_key", "") != key:  # someone installed another key meanwhile
            return checkin_info(c)
        st = checkin_state(c)
        st.update(last_try=int(now), error=error)
        if answer is not None:
            st["last_ok"] = int(now)
            if answer.get("status") == "revoked":
                if st.get("revoked") != lic.serial:
                    db.audit(c, "licence", "licence.revoked", lic.serial)
                st["revoked"] = lic.serial
            else:
                st["revoked"] = ""
        db.set_setting(c, "licence_checkin", st)
        new = str(answer.get("key") or "") if answer else ""
        if new and new.strip() != key:
            nl = check_new(c, new)
            if nl.valid and nl.serial != lic.serial:
                db.set_setting(c, "licence_key", new.strip())
                installed(c, nl, "licence check-in")
                st = checkin_state(c)
                st.update(last_try=int(now), last_ok=int(now), error="")
                db.set_setting(c, "licence_checkin", st)
        if current(c).valid:  # back in touch: a lock from missed check-ins lifts at once
            db.set_setting(c, "licence_locked", False)
        forget()
        return checkin_info(c)


def show_on(c) -> list[str]:
    """Rooms with a show on: a timer running or paused, or captions live."""
    from .modules import captions
    from .updates import live_rooms

    names = live_rooms(c)
    live = [rid for rid, st in captions.rooms.items() if st.ws]
    if live:
        q = ",".join("?" * len(live))
        names += [r["name"] for r in c.execute(f"SELECT name FROM rooms WHERE id IN ({q})", live)]
    return sorted(set(names))


def enforce(at_start: bool = False, hour: int | None = None) -> bool:
    """Lock a lapsed licence, but only at a restart or in the small hours, and never with a
    show on. Returns whether it locked."""
    with db.tx() as c:
        tick(c)
        lic = current(c)
        if lic.valid or lic.state == "grace" or not db.get_setting(c, "licence_in_use", False):
            return False
        if db.get_setting(c, "licence_locked", False):
            return False
        if hour is None:
            hour = datetime.now(ZoneInfo(site_tz(c))).hour
        if not at_start and hour not in LOCK_HOURS:
            return False
        if show_on(c):
            return False
        db.set_setting(c, "licence_locked", True)
        db.audit(c, "licence", "licence.locked", lic.reason or "no licence key")
    forget()
    return True


async def watch() -> None:
    at_start = True
    # Servers that start together (a hosting server after an update) don't all check in at once.
    first_checkin = time.monotonic() + random.uniform(30, 600)
    while True:
        try:
            if time.monotonic() >= first_checkin:
                await asyncio.to_thread(checkin)
            await asyncio.to_thread(enforce, at_start)
            at_start = False
        except Exception as exc:  # never let the check kill the server
            print("licence:", exc)
        await asyncio.sleep(CHECK_EVERY_S)


def notice(c, role: str) -> dict | None:
    """The banner the console and the workspace show while a licence is running out:
    {"level": "warn" | "bad", "text", "admin"}. Admins hear first; everyone else in the last week."""
    lic, now, tz = current(c), clock(c), site_tz(c)
    admin = role == "admin"
    what = "trial" if lic.edition == "trial" else "subscription"
    if lic.state in ("active", "expiring") and lic.checkin:
        st = checkin_state(c)
        last, deadline = checkin_last(st, lic), checkin_deadline(st, lic)
        if now - last > CHECKIN_WARN_DAYS * DAY:
            if admin:
                return {"level": "warn", "admin": True, "text": f"AT-SUITE hasn't reached the licence server since "
                        f"{_day(last, tz)}. Let this server reach the internet by {_day(deadline, tz)}, or it locks "
                        "(never during a show)."}
            if deadline - now <= WARN_ALL_DAYS * DAY:
                return {"level": "warn", "admin": False, "text": f"AT-SUITE on this server needs to reach the internet by "
                        f"{_day(deadline, tz)}. Ask your admin."}
    if lic.state == "expiring":
        days = math.ceil((lic.expires - now) / DAY)
        if lic.checkin and days > WARN_ALL_DAYS:
            return None  # it renews by itself at its daily check-in, so nobody needs telling yet
        if admin and lic.checkin:
            return {"level": "warn", "admin": True, "text": f"Your AT-SUITE {what} ends on {_day(lic.expires, tz)} "
                    f"({days} day{'s' if days != 1 else ''}). It renews by itself once the payment goes through; "
                    "check your account on the AT SUITE website if it doesn't."}
        if admin:
            return {"level": "warn", "admin": True, "text": f"Your AT-SUITE {what} ends on {_day(lic.expires, tz)} "
                    f"({days} day{'s' if days != 1 else ''}). Paste the renewal key in Licence."}
        if days <= WARN_ALL_DAYS:
            return {"level": "warn", "admin": False, "text": f"This venue's AT-SUITE {what} ends on {_day(lic.expires, tz)}. "
                    "Ask your admin to renew it."}
        return None
    if lic.state == "grace" and not lic.expires:  # an upgraded install that has never had a key
        if admin:
            return {"level": "warn", "admin": True, "text": f"AT-SUITE now needs a licence key. Add one in Licence by "
                    f"{_day(lic.grace_until, tz)}; after that it locks (never during a show)."}
        if lic.grace_until - now <= WARN_ALL_DAYS * DAY:
            return {"level": "warn", "admin": False, "text": f"AT-SUITE on this server needs a licence key by "
                    f"{_day(lic.grace_until, tz)}. Ask your admin."}
        return None
    if lic.state == "grace":
        if admin:
            return {"level": "bad", "admin": True, "text": f"Your AT-SUITE {what} ended on {_day(lic.expires, tz)}. It keeps "
                    f"working until {_day(lic.grace_until, tz)}, then locks. Paste the renewal key in Licence."}
        return {"level": "bad", "admin": False, "text": f"This venue's AT-SUITE {what} has ended. It keeps working until "
                f"{_day(lic.grace_until, tz)}. Ask your admin to renew it."}
    if lic.state in ("revoked", "unchecked") and not locked(c):
        why = ("AT SUITE has cancelled this licence" if lic.state == "revoked"
               else "AT-SUITE couldn't reach the licence server for {} days".format(CHECKIN_GRACE_DAYS))
        if admin:
            fix = ("Paste a new key in Licence, or contact AT SUITE." if lic.state == "revoked"
                   else "Let this server reach the internet, then press Check now in Licence.")
            return {"level": "bad", "admin": True, "text": f"{why}. It locks tonight, once no show is on. {fix}"}
        return {"level": "bad", "admin": False, "text": f"{why}. Ask your admin."}
    if not lic.valid and not locked(c):  # due to lock at the next quiet moment
        if admin:
            return {"level": "bad", "admin": True, "text": "Your AT-SUITE licence has run out. It locks tonight, once no show "
                    "is on. Paste a new key in Licence."}
        return {"level": "bad", "admin": False, "text": "This venue's AT-SUITE licence has run out. Ask your admin to renew it."}
    return None
