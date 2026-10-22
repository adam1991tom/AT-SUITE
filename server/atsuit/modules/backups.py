"""Backups of the whole server, and putting one back.

A backup is one zip of everything the server keeps in its data folder: the database (a
consistent copy, taken while the server runs), the encryption key, chat files, presenter
files, timer views and logos, kept show reports, the agents' files and the fleet SSH key.
Left out: speech models (they download again), caption transcripts (private, deleted after
the venue's hours and never kept in a backup), the Windows app (fetched again with the next
release, or uploaded again in Laptops & screens) and the backups themselves.

Every night (02:00 venue time unless an admin changes it) the server makes one and keeps it
in backups/ in its data folder, the newest 14 unless an admin changes that. A hosted venue's
provider takes its own nightly backup as well (cloud/atcloud). Admins can make one now,
download any of them, delete them, or restore one, kept here or uploaded.

Restoring replaces everything with the backup. The server checks the file first and saves a
backup of what's there now; then it restarts (Docker starts it again) and puts the backup in
place before anything opens the database. The database is then brought up to this version."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import signal
import socket
import sqlite3
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timedelta
from pathlib import Path, PurePosixPath

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from .. import VERSION, config, db
from ..security import Principal, require_admin

router = APIRouter()

FOLDER = "backups"
PENDING = ".restore-pending"  # in the data folder: the backup to put in place at the next start
# Never in a backup, and left alone by a restore. Top-level names in the data folder.
LEFT_OUT = {"models", "transcripts", "app", FOLDER, ".snapshot", ".restore", ".restore-old", PENDING,
            "update-now", "helper.json", ".backup.db", "atsuit.db", "atsuit.db-wal", "atsuit.db-shm", "atsuit.db-journal"}
KINDS = ("nightly", "manual", "before-restore", "upload")
NAME = re.compile(r"^atsuite-(nightly|manual|before-restore|upload)-\d{8}-\d{6}(-\d+)?\.zip$")
DEFAULTS = {"nightly": True, "time": "02:00", "keep": 14}
WINDOW_H = 6  # a nightly backup missed at its time (server off) is still made within this many hours
MAX_UPLOAD = 8 * 1024 ** 3
_lock = threading.Lock()  # one backup or restore at a time


# --------------------------------------------------------------- settings --
def settings(c) -> dict:
    s = db.get_setting(c, "backups", {}) or {}
    return {k: s.get(k, v) for k, v in DEFAULTS.items()}


def folder() -> Path:
    d = config.cfg.data / FOLDER
    d.mkdir(parents=True, exist_ok=True)
    return d


def venue_zone(c):
    from .reports import site_zone

    first = c.execute("SELECT id FROM sites ORDER BY id LIMIT 1").fetchone()
    return site_zone(c, first["id"] if first else None)


# ------------------------------------------------------------------ make --
def _included() -> list[tuple[Path, str]]:
    data = config.cfg.data
    out = []
    for top in sorted(data.iterdir()) if data.is_dir() else []:
        if top.name in LEFT_OUT or top.name.endswith(".part"):
            continue
        files = [top] if top.is_file() else sorted(f for f in top.rglob("*") if f.is_file())
        out += [(f, f.relative_to(data).as_posix()) for f in files if not f.is_symlink() and not f.name.endswith(".part")]
    return out


def make(kind: str, actor: str) -> dict:
    """Make a backup of the whole server in the backups folder and return what it is."""
    if kind not in KINDS:
        raise ValueError(kind)
    from ..security import fernet

    fernet()  # the key is made when first needed: make sure the backup has it
    with _lock:
        files = _included()
        need = sum(f.stat().st_size for f, _ in files) + config.cfg.db_path.stat().st_size
        free = shutil.disk_usage(config.cfg.data).free
        if free < need * 2 + 50 * 1024 ** 2:
            raise RuntimeError(f"Not enough disk space for a backup ({free // 1024 ** 2} MB free, about {need // 1024 ** 2} MB needed)")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        name, n = f"atsuite-{kind}-{stamp}.zip", 1
        while (folder() / name).exists():
            n += 1
            name = f"atsuite-{kind}-{stamp}-{n}.zip"
        part = folder() / f".{name}.part"
        snap = folder() / f".{name}.db"
        try:
            src, dst = db.connect(), sqlite3.connect(snap)
            try:
                src.backup(dst)
                schema = dst.execute("SELECT version FROM schema_version").fetchone()[0]
            finally:
                dst.close()
                src.close()
            with db.ro() as c:
                from .core import get_branding

                org = get_branding(c).get("organisation") or ""
            manifest = {"product": "AT SUITE", "version": VERSION, "schema": schema, "kind": kind, "made_at": db.now_iso(),
                        "made_by": actor, "hostname": socket.gethostname(), "organisation": org, "files": len(files) + 1}
            with zipfile.ZipFile(part, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
                z.writestr("manifest.json", json.dumps(manifest, indent=2))
                z.writestr("VERSION", VERSION)
                z.write(snap, "atsuit.db")
                for f, arc in files:
                    try:
                        z.write(f, arc)
                    except FileNotFoundError:  # deleted while we were going
                        pass
            part.replace(folder() / name)
        finally:
            part.unlink(missing_ok=True)
            snap.unlink(missing_ok=True)
    with db.tx() as c:
        db.audit(c, actor, "backup.made", f"{kind}: {name}")
    return describe(folder() / name)


def describe(f: Path) -> dict:
    m = NAME.match(f.name)
    st = f.stat()
    return {"name": f.name, "kind": m.group(1) if m else "", "size": st.st_size,
            "made_at": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="seconds")}


def kept() -> list[dict]:
    return sorted((describe(f) for f in folder().iterdir() if f.is_file() and NAME.match(f.name)),
                  key=lambda b: b["made_at"], reverse=True)


def prune(keep: int) -> list[str]:
    """Only nightly backups go by themselves; ones made by hand or before a restore stay until an admin deletes them."""
    gone = []
    for b in [b for b in kept() if b["kind"] == "nightly"][max(1, keep):]:
        (folder() / b["name"]).unlink(missing_ok=True)
        gone.append(b["name"])
    return gone


def nightly_due(now: datetime | None = None) -> dict | None:
    """Make tonight's backup if it's time and it hasn't been made yet."""
    with db.ro() as c:
        s, zone = settings(c), venue_zone(c)
        last = db.get_setting(c, "backups.last_nightly", "")
    if not s["nightly"]:
        return None
    now = (now or datetime.now(zone)).astimezone(zone)
    hh, mm = (int(x) for x in s["time"].split(":"))
    start = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if now < start:
        start -= timedelta(days=1)
    if now >= start + timedelta(hours=WINDOW_H) or last == start.isoformat(timespec="minutes"):
        return None
    try:
        out = make("nightly", "server")
        error = ""
    except Exception as exc:  # noqa: BLE001 - shown on the Backups page, tried again next night
        out, error = None, str(exc)[:300] or exc.__class__.__name__
        with db.tx() as c:
            db.audit(c, "server", "backup.failed", error)
    with db.tx() as c:
        db.set_setting(c, "backups.last_nightly", start.isoformat(timespec="minutes"))
        db.set_setting(c, "backups.last_error", error)
    if out:
        prune(s["keep"])
    return out


async def nightly_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            await asyncio.to_thread(nightly_due)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never let it stop the server
            print("backups.nightly:", exc)


# --------------------------------------------------------------- restore --
def _safe(name: str) -> bool:
    p = PurePosixPath(name)
    return bool(name) and not p.is_absolute() and ".." not in p.parts and "\\" not in name and p.parts[0] not in LEFT_OUT - {"atsuit.db"}


def check(path: Path) -> dict:
    """What a backup file holds, or ValueError saying why it can't be restored."""
    from .. import updates

    try:
        z = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise ValueError("That isn't an AT SUITE backup (not a zip file)") from None
    with z:
        names = z.namelist()
        if "atsuit.db" not in names:
            raise ValueError("That isn't an AT SUITE backup: it has no database in it")
        bad = [n for n in names if not n.endswith("/") and n not in ("manifest.json", "VERSION") and not _safe(n)]
        if bad:
            raise ValueError(f"The backup has a file that can't be put back: {bad[0][:80]}")
        if z.testzip() is not None:
            raise ValueError("The backup is damaged (a file in it doesn't check out)")
        manifest = {}
        if "manifest.json" in names:
            try:
                manifest = json.loads(z.read("manifest.json"))
            except ValueError:
                manifest = {}
        version = (manifest.get("version") or (z.read("VERSION").decode(errors="replace").strip() if "VERSION" in names else "")) or "unknown"
        if updates.newer(version, VERSION):
            raise ValueError(f"The backup was made by AT SUITE {version}, newer than this server ({VERSION}). Update this server first.")
        with tempfile.TemporaryDirectory(dir=folder()) as tmp:
            dbf = Path(tmp) / "atsuit.db"
            with z.open("atsuit.db") as src, dbf.open("wb") as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            try:
                c = sqlite3.connect(dbf)
                try:
                    ok = c.execute("PRAGMA integrity_check").fetchone()[0]
                    schema = c.execute("SELECT version FROM schema_version").fetchone()[0]
                    accounts = c.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
                    rooms = c.execute("SELECT COUNT(*) FROM rooms").fetchone()[0]
                finally:
                    c.close()
            except sqlite3.Error:
                raise ValueError("The backup's database can't be read") from None
        if ok != "ok":
            raise ValueError("The backup's database is damaged")
        if schema > len(db.MIGRATIONS):
            raise ValueError("The backup was made by a newer AT SUITE. Update this server first.")
        return {"version": version, "schema": schema, "made_at": manifest.get("made_at"), "organisation": manifest.get("organisation", ""),
                "accounts": accounts, "rooms": rooms, "has_key": "secret.key" in names, "files": len(names)}


def restart() -> None:
    """Stop the server so Docker starts it again (restart: unless-stopped), as an update does."""
    def go():
        os.kill(os.getpid(), signal.SIGTERM)
        threading.Timer(20, lambda: os._exit(0)).start()  # if a connection holds the shutdown up
    threading.Timer(1.5, go).start()


def ask_restore(path: Path, actor: str) -> dict:
    """Check the backup, save one of what's here now, and restart to put it in place."""
    info = check(path)
    before = make("before-restore", actor)
    (config.cfg.data / PENDING).write_text(json.dumps({"file": path.name, "by": actor, "at": db.now_iso(), "before": before["name"]}))
    with db.tx() as c:
        db.audit(c, actor, "backup.restore_asked", f"{path.name} (what was here is in {before['name']})")
    restart()
    return {"ok": True, "backup": info, "before": before["name"]}


def apply_pending() -> str | None:
    """At start-up, before the database opens: put an asked-for backup in place."""
    data = config.cfg.data
    marker = data / PENDING
    if not marker.is_file():
        return None
    try:
        ask = json.loads(marker.read_text())
    except ValueError:
        ask = {}
    marker.unlink()  # whatever happens, never try again at every start
    src = data / FOLDER / str(ask.get("file") or "")
    if not NAME.match(src.name) or not src.is_file():
        print("backups: the backup to restore isn't there any more:", src.name)
        return None
    new, old = data / ".restore", data / ".restore-old"
    for d in (new, old):
        shutil.rmtree(d, ignore_errors=True)
    try:
        with zipfile.ZipFile(src) as z:
            for n in z.namelist():
                if n.endswith("/") or n in ("manifest.json", "VERSION"):
                    continue
                if not _safe(n):
                    raise ValueError(f"unsafe name {n}")
                dest = new / n
                dest.parent.mkdir(parents=True, exist_ok=True)
                with z.open(n) as fsrc, dest.open("wb") as fdst:
                    shutil.copyfileobj(fsrc, fdst, 1024 * 1024)
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        shutil.rmtree(new, ignore_errors=True)
        print("backups: couldn't unpack", src.name, exc)
        return None
    old.mkdir()
    stays = {"models", "transcripts", "app", FOLDER, ".snapshot", new.name, old.name}
    moved, placed = [], []
    try:
        for top in list(data.iterdir()):
            if top.name not in stays:
                top.replace(old / top.name)
                moved.append(top.name)
        for top in list(new.iterdir()):
            top.replace(data / top.name)
            placed.append(top.name)
    except OSError as exc:  # put back what was here
        print("backups: restore failed, putting the old data back:", exc)
        for name in placed:
            f = data / name
            shutil.rmtree(f, ignore_errors=True) if f.is_dir() else f.unlink(missing_ok=True)
        for name in moved:
            (old / name).replace(data / name)
        shutil.rmtree(new, ignore_errors=True)
        shutil.rmtree(old, ignore_errors=True)
        return None
    shutil.rmtree(new, ignore_errors=True)
    shutil.rmtree(old, ignore_errors=True)
    # Transcripts belong to what was here; they never go in a backup.
    shutil.rmtree(data / "transcripts", ignore_errors=True)
    db.migrate()
    with db.tx() as c:
        c.execute("DELETE FROM transcripts")
        db.audit(c, str(ask.get("by") or "admin"), "backup.restore",
                 f"{src.name}; what was here before is in {ask.get('before') or 'no backup'}")
    return src.name


# ------------------------------------------------------------------- API --
class SettingsIn(BaseModel):
    nightly: bool = True
    time: str = Field("02:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    keep: int = Field(14, ge=1, le=365)


def _file(name: str) -> Path:
    f = folder() / name
    if not NAME.match(name) or not f.is_file():
        raise HTTPException(404, "Backup not found")
    return f


@router.get("/api/admin/backups")
def list_backups(p: Principal = Depends(require_admin)):
    with db.ro() as c:
        s, zone = settings(c), venue_zone(c)
        err = db.get_setting(c, "backups.last_error", "")
    try:
        free = shutil.disk_usage(config.cfg.data).free
    except OSError:
        free = None
    return {"settings": s, "zone": zone.key, "backups": kept(), "error": err, "disk_free": free,
            "hosted": config.cfg.hosted, "folder": str(folder())}


@router.put("/api/admin/backups/settings")
def save_settings(body: SettingsIn, p: Principal = Depends(require_admin)):
    with db.tx() as c:
        db.set_setting(c, "backups", body.model_dump())
        db.audit(c, p.name, "backup.settings", f"nightly {'on at ' + body.time if body.nightly else 'off'}, keep {body.keep}")
    return body.model_dump()


@router.post("/api/admin/backups")
async def backup_now(p: Principal = Depends(require_admin)):
    try:
        return await asyncio.to_thread(make, "manual", p.name)
    except RuntimeError as exc:
        raise HTTPException(507, str(exc)) from None


@router.get("/api/admin/backups/{name}")
def download_backup(name: str, p: Principal = Depends(require_admin)):
    f = _file(name)
    with db.tx() as c:
        db.audit(c, p.name, "backup.download", name)
    return FileResponse(f, media_type="application/zip", filename=name)


@router.delete("/api/admin/backups/{name}")
def delete_backup(name: str, p: Principal = Depends(require_admin)):
    _file(name).unlink()
    with db.tx() as c:
        db.audit(c, p.name, "backup.delete", name)
    return {"ok": True}


@router.post("/api/admin/backups/{name}/restore")
async def restore_kept(name: str, p: Principal = Depends(require_admin)):
    f = _file(name)
    try:
        return await asyncio.to_thread(ask_restore, f, p.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(507, str(exc)) from None


@router.post("/api/admin/restore")
async def restore_upload(file: UploadFile, p: Principal = Depends(require_admin)):
    """Restore a backup downloaded from this or another AT SUITE server. It's kept in the backups list too."""
    name = f"atsuite-upload-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    dest, part = folder() / name, folder() / f".{name}.part"
    size = 0
    try:
        with part.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise HTTPException(413, "That file is too big to be a backup")
                out.write(chunk)
        try:
            await asyncio.to_thread(check, part)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        part.replace(dest)
    finally:
        part.unlink(missing_ok=True)
    try:
        return await asyncio.to_thread(ask_restore, dest, p.name)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except RuntimeError as exc:
        raise HTTPException(507, str(exc)) from None


@router.get("/api/admin/backup")
def backup_download(p: Principal = Depends(require_admin)):
    """Download a backup of the whole server made just now (it isn't kept on the server)."""
    try:
        b = make("manual", p.name)
    except RuntimeError as exc:
        raise HTTPException(507, str(exc)) from None
    f = folder() / b["name"]
    tmp = Path(tempfile.mkdtemp(dir=config.cfg.data / FOLDER)) / b["name"]
    f.replace(tmp)
    with db.tx() as c:
        db.audit(c, p.name, "backup.download", b["name"])
    return FileResponse(tmp, media_type="application/zip", filename=b["name"],
                        background=BackgroundTask(shutil.rmtree, tmp.parent, ignore_errors=True))
