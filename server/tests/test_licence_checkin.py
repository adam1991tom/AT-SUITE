"""Keys from the website check in with it every day: they renew themselves, a cancelled
one locks, and one that can't reach the website for CHECKIN_GRACE_DAYS locks too, always
at a quiet moment. Offline keys never check in."""
import json
import time

import httpx
import pytest
from licensed_server import licence_key

DAY = 86400
SITE = "https://shop.example"


@pytest.fixture()
def clock(monkeypatch):
    from atsuit import licence

    class Clock:
        t = time.time()

    monkeypatch.setattr(licence, "_now", lambda: Clock.t)
    return Clock


@pytest.fixture()
def website(monkeypatch):
    """A stand-in licence server: .answer is what it says next (None = unreachable)."""
    from atsuit import licence

    class Site:
        answer: dict | None = {"key": None, "status": "current"}
        seen: list = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == SITE + "/api/v1/licence/refresh"
        Site.seen.append(json.loads(request.content)["key"])
        if Site.answer is None:
            raise httpx.ConnectError("no route", request=request)
        return httpx.Response(200, json=Site.answer)

    monkeypatch.setattr(licence, "TRANSPORT", httpx.MockTransport(handler))
    return Site


def _key(clock, **kw):
    return licence_key(**{"checkin": SITE, "issued": int(clock.t), "expires": int(clock.t + 37 * DAY), **kw})


def _checkin(force=False):
    from atsuit import licence

    return licence.checkin(force)


def _enforce(**kw):
    from atsuit import licence

    return licence.enforce(**kw)


def test_offline_keys_never_check_in(admin, website):
    assert _checkin(force=True) is None and website.seen == []
    assert admin.get("/api/admin/licence").json()["checkin"] is None
    assert admin.post("/api/admin/licence/checkin").status_code == 400


def test_a_renewal_installs_itself(admin, clock, website):
    old = _key(clock, serial="AT-OLD")
    assert admin.put("/api/admin/licence", json={"key": old}).status_code == 200
    info = admin.post("/api/admin/licence/checkin").json()
    assert website.seen == [old, old] and info["last_ok"] and not info["error"]  # on install, then Check now
    # A monthly key always has under 30 days left; it renews itself, so nobody is told.
    for _ in range(20):  # checking in every day
        clock.t += DAY
        _checkin()
    assert admin.get("/api/bootstrap").json()["licence_notice"] is None
    new = _key(clock, serial="AT-NEW", expires=int(clock.t + 40 * DAY))
    website.answer = {"key": new, "status": None}
    _checkin()  # checked in today already: not due
    assert admin.get("/api/admin/licence").json()["serial"] == "AT-OLD"
    clock.t += DAY
    assert _checkin() is not None
    lic = admin.get("/api/admin/licence").json()
    assert lic["serial"] == "AT-NEW" and lic["raw"] == new and lic["state"] == "active"
    # Not due again until tomorrow.
    website.seen.clear()
    _checkin()
    assert website.seen == []


def test_a_cancelled_key_locks_at_a_quiet_moment_and_lifts(admin, clock, website):
    admin.put("/api/admin/licence", json={"key": _key(clock, serial="AT-GONE")})
    website.answer = {"key": None, "status": "revoked"}
    _checkin(force=True)
    lic = admin.get("/api/admin/licence").json()
    assert lic["state"] == "revoked" and lic["checkin"]["revoked"]
    n = admin.get("/api/bootstrap").json()["licence_notice"]
    assert n["level"] == "bad" and "cancelled" in n["text"] and "locks tonight" in n["text"]
    assert admin.get("/api/admin/accounts").status_code == 200  # not mid-afternoon
    assert not _enforce(hour=14)
    assert _enforce(hour=3)
    assert admin.get("/api/admin/accounts").status_code == 402
    # Reinstated on the website: the next check-in unlocks it.
    website.answer = {"key": None, "status": "current"}
    assert admin.post("/api/admin/licence/checkin").status_code == 200
    assert admin.get("/api/admin/accounts").status_code == 200
    assert admin.get("/api/admin/licence").json()["state"] == "active"


def test_no_internet_for_two_weeks_locks_until_it_checks_in(admin, clock, website):
    from atsuit import licence

    admin.post("/api/admin/accounts", json={"username": "tech1", "password": "password1", "role": "tech"})
    admin.put("/api/admin/licence", json={"key": _key(clock, expires=int(clock.t + 365 * DAY))})
    _checkin(force=True)
    website.answer = None
    clock.t += 1 * DAY
    _checkin()
    assert admin.get("/api/admin/licence").json()["checkin"]["error"]
    assert admin.get("/api/bootstrap").json()["licence_notice"] is None  # a day off the internet is fine
    clock.t += 3 * DAY
    _checkin()
    n = admin.get("/api/bootstrap").json()["licence_notice"]
    assert n["admin"] and "hasn't reached the licence server" in n["text"]
    clock.t += 8 * DAY  # under a week to go: everyone hears
    admin.post("/api/auth/logout")
    admin.post("/api/auth/login", json={"username": "tech1", "password": "password1"})
    assert "needs to reach the internet" in admin.get("/api/bootstrap").json()["licence_notice"]["text"]
    admin.post("/api/auth/logout")
    admin.post("/api/auth/login", json={"username": "admin", "password": "correct-horse"})
    clock.t += 3 * DAY  # 15 days without a check-in
    licence.forget()
    assert admin.get("/api/admin/licence").json()["state"] == "unchecked"
    assert admin.get("/api/admin/accounts").status_code == 200
    assert _enforce(hour=3)
    assert admin.get("/api/admin/accounts").status_code == 402
    # Pasting the same key again doesn't buy more time; reaching the website does.
    assert admin.put("/api/admin/licence", json={"key": admin.get("/api/admin/licence").json()["raw"]}).status_code == 200
    licence.forget()
    assert admin.get("/api/admin/licence").json()["state"] == "unchecked"
    website.answer = {"key": None, "status": "current"}
    assert admin.post("/api/admin/licence/checkin").json()["error"] == ""
    assert admin.get("/api/admin/accounts").status_code == 200


def test_a_bad_answer_is_not_a_check_in(admin, clock, monkeypatch):
    from atsuit import licence

    monkeypatch.setattr(licence, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(500, text="oops")))
    admin.put("/api/admin/licence", json={"key": _key(clock)})
    info = _checkin(force=True)
    assert info["last_ok"] == 0 and "500" in info["error"]
    # A forged key in the answer is ignored: only the vendor's signature counts.
    monkeypatch.setattr(licence, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, json={"key": "forged.key"})))
    before = admin.get("/api/admin/licence").json()["raw"]
    _checkin(force=True)
    assert admin.get("/api/admin/licence").json()["raw"] == before


def test_a_new_key_gets_two_weeks_even_if_it_was_made_long_ago(admin, clock, website):
    website.answer = None  # no internet yet
    old = _key(clock, issued=int(clock.t - 60 * DAY), expires=int(clock.t + 300 * DAY))
    assert admin.put("/api/admin/licence", json={"key": old}).status_code == 200
    assert admin.get("/api/admin/licence").json()["state"] == "active"
    clock.t += 13 * DAY
    assert admin.get("/api/admin/licence").json()["state"] == "active"
    clock.t += 2 * DAY
    assert admin.get("/api/admin/licence").json()["state"] == "unchecked"
