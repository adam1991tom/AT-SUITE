"""Backups of the whole server: made by hand or every night, kept on the server,
downloaded, and restored (from the list or uploaded) at the next start."""
import io
import json
import sqlite3
import zipfile
from datetime import datetime


def _data(tmp_path):
    """Files around the data folder, as a server that has been in use has them."""
    for rel, body in {"uploads/ab/photo.png": b"png", "views/standard.json": b"{}", "presenter-files/1/deck.pdf": b"pdf",
                      "ssh/fleet_key": b"key", "models/big.onnx": b"model", "transcripts/1.txt": b"words",
                      "app/latest.yml": b"version: 1", "update-now": b"1.0"}.items():
        f = tmp_path / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(body)


def _restart(monkeypatch):
    from atsuit.modules import backups

    asked = []
    monkeypatch.setattr(backups, "restart", lambda: asked.append(True))
    return asked


def test_a_backup_is_the_whole_server(admin, tmp_path):
    _data(tmp_path)
    b = admin.post("/api/admin/backups").json()
    assert b["kind"] == "manual" and b["name"].startswith("atsuite-manual-")
    z = zipfile.ZipFile(tmp_path / "backups" / b["name"])
    names = set(z.namelist())
    assert {"manifest.json", "VERSION", "atsuit.db", "secret.key", "uploads/ab/photo.png", "views/standard.json",
            "presenter-files/1/deck.pdf", "ssh/fleet_key"} <= names
    # Speech models, transcripts, the Windows app and the backups themselves stay out.
    assert not [n for n in names if n.split("/")[0] in ("models", "transcripts", "app", "backups", "update-now")]
    m = json.loads(z.read("manifest.json"))
    assert m["kind"] == "manual" and m["made_by"] == "admin" and m["schema"] > 10
    db = tmp_path / "check.db"
    db.write_bytes(z.read("atsuit.db"))
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT username FROM accounts").fetchone()[0] == "admin"

    lst = admin.get("/api/admin/backups").json()
    assert [x["name"] for x in lst["backups"]] == [b["name"]]
    assert lst["settings"] == {"nightly": True, "time": "02:00", "keep": 14} and lst["zone"] == "Europe/London"
    r = admin.get(f"/api/admin/backups/{b['name']}")
    assert r.status_code == 200 and r.content[:2] == b"PK"
    assert admin.get("/api/admin/backups/..%2Fatsuit.db").status_code == 404
    assert admin.get("/api/admin/backups/atsuite-manual-20260101-000000.zip").status_code == 404
    assert admin.delete(f"/api/admin/backups/{b['name']}").status_code == 200
    assert admin.get("/api/admin/backups").json()["backups"] == []

    # The console's Download backup makes a fresh one and doesn't keep it.
    r = admin.get("/api/admin/backup")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "atsuit.db" in zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert admin.get("/api/admin/backups").json()["backups"] == []
    actions = [x["action"] for x in admin.get("/api/admin/audit").json()]
    assert {"backup.made", "backup.download", "backup.delete"} <= set(actions)


def test_only_admins(admin, client):
    from fastapi.testclient import TestClient

    admin.post("/api/admin/accounts", json={"username": "mia", "password": "mia-password", "display_name": "Mia", "role": "manager"})
    mia = TestClient(client.app)
    mia.post("/api/auth/login", json={"username": "mia", "password": "mia-password"})
    for method, url in (("get", "/api/admin/backups"), ("post", "/api/admin/backups"), ("get", "/api/admin/backup"),
                        ("put", "/api/admin/backups/settings"), ("post", "/api/admin/restore")):
        assert getattr(mia, method)(url).status_code == 403, url


def test_nightly(admin, tmp_path):
    from zoneinfo import ZoneInfo

    from atsuit.modules import backups

    london = ZoneInfo("Europe/London")
    at = lambda d, h, m=0: datetime(2026, 11, d, h, m, tzinfo=london)  # noqa: E731
    assert backups.nightly_due(at(3, 1, 59)) is None  # not yet
    first = backups.nightly_due(at(3, 2, 0))
    assert first["kind"] == "nightly"
    assert backups.nightly_due(at(3, 2, 30)) is None  # once a night
    assert backups.nightly_due(at(4, 9, 0)) is None  # missed (the server was off): wait for tonight
    assert backups.nightly_due(at(4, 7, 59))["kind"] == "nightly"  # still in time
    assert admin.put("/api/admin/backups/settings", json={"nightly": True, "time": "23:30", "keep": 2}).status_code == 200
    assert admin.put("/api/admin/backups/settings", json={"nightly": True, "time": "25:00", "keep": 2}).status_code == 422
    assert admin.put("/api/admin/backups/settings", json={"nightly": True, "time": "02:00", "keep": 0}).status_code == 422
    assert backups.nightly_due(at(5, 0, 10))["kind"] == "nightly"  # 23:30 last night, still in time
    manual = admin.post("/api/admin/backups").json()
    assert backups.nightly_due(at(5, 23, 45))["kind"] == "nightly"
    kept = admin.get("/api/admin/backups").json()["backups"]
    assert [b["kind"] for b in kept].count("nightly") == 2  # the oldest nightly went; the one made by hand stays
    assert manual["name"] in [b["name"] for b in kept]
    admin.put("/api/admin/backups/settings", json={"nightly": False, "time": "02:00", "keep": 14})
    assert backups.nightly_due(at(7, 2, 30)) is None
    assert any(x["action"] == "backup.made" and x["actor"] == "server" for x in admin.get("/api/admin/audit").json())


def test_restore_puts_the_whole_server_back(admin, tmp_path, monkeypatch):
    from atsuit.modules import backups

    asked = _restart(monkeypatch)
    _data(tmp_path)
    b = admin.post("/api/admin/backups").json()
    # Things change after the backup.
    assert admin.post("/api/admin/accounts", json={"username": "late", "password": "late-password", "display_name": "Late", "role": "tech"}).status_code == 200
    (tmp_path / "uploads" / "ab" / "photo.png").unlink()
    (tmp_path / "views" / "new.json").write_bytes(b"{}")

    r = admin.post(f"/api/admin/backups/{b['name']}/restore")
    assert r.status_code == 200 and asked == [True]
    before = r.json()["before"]
    assert before.startswith("atsuite-before-restore-") and r.json()["backup"]["accounts"] == 1
    assert (tmp_path / backups.PENDING).is_file()

    # What the server does at its next start, before anything opens the database.
    assert backups.apply_pending() == b["name"]
    assert not (tmp_path / backups.PENDING).exists()
    names = [a["username"] for a in admin.get("/api/admin/accounts").json()]
    assert names == ["admin"]
    assert (tmp_path / "uploads" / "ab" / "photo.png").read_bytes() == b"png"
    assert not (tmp_path / "views" / "new.json").exists()
    assert (tmp_path / "models" / "big.onnx").exists() and (tmp_path / "app" / "latest.yml").exists()  # left alone
    assert not (tmp_path / "transcripts" / "1.txt").exists()  # they belonged to what was here
    assert {x["name"] for x in admin.get("/api/admin/backups").json()["backups"]} == {b["name"], before}
    log = admin.get("/api/admin/audit").json()
    assert log[0]["action"] == "backup.restore" and before in log[0]["detail"]
    assert backups.apply_pending() is None  # nothing asked for any more


def test_restore_an_uploaded_backup(admin, tmp_path, monkeypatch):
    from atsuit.modules import backups

    asked = _restart(monkeypatch)
    good = admin.get("/api/admin/backup").content

    def up(data, name="backup.zip"):
        return admin.post("/api/admin/restore", files={"file": (name, data, "application/zip")})

    assert up(b"not a zip").json()["detail"].startswith("That isn't an AT SUITE backup")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "hi")
    assert "no database" in up(buf.getvalue()).json()["detail"]
    for evil in ("../../etc/passwd", "/abs.txt", "models/x"):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z, zipfile.ZipFile(io.BytesIO(good)) as g:
            for n in g.namelist():
                z.writestr(n, g.read(n))
            z.writestr(evil, "x")
        assert up(buf.getvalue()).status_code == 400, evil
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z, zipfile.ZipFile(io.BytesIO(good)) as g:
        for n in g.namelist():
            if n != "manifest.json":
                z.writestr(n, g.read(n) if n != "VERSION" else b"99.0.0")
    assert "newer" in up(buf.getvalue()).json()["detail"]
    assert asked == [] and not (tmp_path / backups.PENDING).exists()
    assert [b["kind"] for b in admin.get("/api/admin/backups").json()["backups"]] == []  # nothing bad is kept

    r = up(good)
    assert r.status_code == 200 and asked == [True]
    kinds = sorted(b["kind"] for b in admin.get("/api/admin/backups").json()["backups"])
    assert kinds == ["before-restore", "upload"]
    assert backups.apply_pending().startswith("atsuite-upload-")


def test_a_backup_from_before_1_23_restores(admin, tmp_path, monkeypatch):
    """The console's backups before 1.23 held just the database, the key, uploads and VERSION."""
    from atsuit import config
    from atsuit.modules import backups

    _restart(monkeypatch)
    full = zipfile.ZipFile(io.BytesIO(admin.get("/api/admin/backup").content))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for n in ("atsuit.db", "secret.key"):
            z.writestr(n, full.read(n))
        z.writestr("VERSION", "1.10.3")
    assert admin.post("/api/admin/restore", files={"file": ("atsuit-backup.zip", buf.getvalue())}).status_code == 200
    assert backups.apply_pending()
    assert (config.cfg.data / "secret.key").read_bytes() == full.read("secret.key")
