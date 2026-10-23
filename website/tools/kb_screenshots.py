"""Takes the knowledge base's screenshots from a demo AT SUITE server, so every release can retake them.

    pip install -r server/requirements.txt playwright && python -m playwright install chromium
    python website/tools/kb_screenshots.py                 # every picture
    python website/tools/kb_screenshots.py timer-designer  # only the ones whose names start with this

It starts AT SUITE from this checkout with a throwaway licence (server/tests/licensed_server.py) in a
temporary folder, fills it with a made-up venue (Riverside Centre: four rooms, a few techs, laptops,
screens, a running timer, chat, help calls, notes, a presenters event and captions), then opens each
page in Chromium and saves it to website/atshop/static/kb/<name>.jpg. Nothing touches a real server.

Set KB_CHROMIUM to a Chromium to use instead of Playwright's own (e.g. /opt/pw-browsers/chromium).
"""
from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "website" / "atshop" / "static" / "kb"
W, H = 1440, 900
ADMIN = ("admin", "riverside-demo-1")
PEOPLE = [("mia", "Mia Patel", "manager"), ("amy", "Amy Clarke", "tech"), ("ben", "Ben Okafor", "tech"),
          ("priya", "Priya Shah", "tech")]
PASSWORD = "show-day-demo-1"
ROOMS = ["Main Hall", "Studio 1", "Studio 2", "Boardroom"]
SYS = {"cpu": 23, "mem_total": 16_000_000_000, "mem_free": 7_100_000_000, "app_mem": 310_000_000,
       "disk": {"drive": "C:\\", "total": 500_000_000_000, "free": 212_000_000_000},
       "net": [{"name": "Ethernet", "ip": "10.0.0.21"}], "online": True, "power": "mains",
       "displays": [{"w": 1920, "h": 1080, "primary": True}, {"w": 1920, "h": 1080, "primary": False}]}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Demo:
    """A demo server and API sessions on it."""

    def __init__(self, data: Path):
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        env = {**os.environ, "ATSUIT_DATA": str(data), "ATSUIT_ASR": "0", "ATSUIT_LAPTOP_MODELS": "0"}
        env["ATSUIT_PUBLIC_URL"] = "http://10.0.0.10:8080"
        # licensed_server.py with the demo venue's own licence: a Venue plan with most of a year left.
        boot = ("import sys, time; sys.path.insert(0, 'tests'); import licensed_server as L; k = L.licence_key; "
                "L.licence_key = lambda **p: k(**{'licensee': 'Grand Hall Events', 'edition': 'venue', 'max_nodes': 30, "
                "'serial': 'AT-2026-0142', 'expires': int(time.time()) + 290 * 86400, **p}); "
                f"L.main(['--port', '{self.port}'])")
        self.proc = subprocess.Popen([sys.executable, "-c", boot], cwd=ROOT / "server", env=env)
        self.data = data
        for _ in range(100):
            try:
                if httpx.get(f"{self.url}/api/health", timeout=1).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(0.2)
        else:
            raise SystemExit("The demo server didn't start")
        self.licence = (data / "test-licence.txt").read_text().strip()
        self.admin = httpx.Client(base_url=self.url, timeout=20)
        self.nodes: dict[str, dict] = {}

    def keep_alive(self) -> None:
        """Every laptop and screen checks in every few seconds, as the real ones do, so none goes offline."""
        import threading

        def beat():
            with httpx.Client(base_url=self.url, timeout=10) as c:
                while self.proc.poll() is None:
                    for name, n in list(self.nodes.items()):
                        tech = n.get("kind", "tech") == "tech"
                        try:
                            c.post("/api/nodes/heartbeat", headers={"Authorization": f"Node {n['token']}"},
                                   json={"version": "app-1.23.0" if tech else "screen-agent 0.4.0", "info": {"system": SYS} if tech else {}})
                        except httpx.HTTPError:
                            pass
                    time.sleep(5)
        threading.Thread(target=beat, daemon=True).start()

    def stop(self) -> None:
        self.proc.terminate()
        self.proc.wait(10)

    def ok(self, r: httpx.Response) -> dict:
        if r.status_code >= 400:
            raise SystemExit(f"{r.request.method} {r.request.url.path}: {r.status_code} {r.text[:300]}")
        return r.json() if r.content else {}

    def session(self, username: str, password: str) -> httpx.Client:
        c = httpx.Client(base_url=self.url, timeout=20)
        r = c.post("/api/auth/login", json={"username": username, "password": password})
        if r.status_code == 428:  # first sign-in: choose a password (the same one again isn't allowed, so add a !)
            r = c.post("/api/auth/login", json={"username": username, "password": password, "new_password": password + "!"})
        self.ok(r)
        return c

    def node(self, name: str, kind: str = "tech") -> dict:
        code = self.ok(self.admin.get("/api/fleet/enrolment"))[0]["enrol_code"]
        c = httpx.Client(base_url=self.url, timeout=20)
        n = self.ok(c.post("/api/nodes/enrol", json={"code": code, "name": name, "kind": kind}))
        c.headers["Authorization"] = f"Node {n['token']}"
        self.nodes[name] = {**n, "client": c, "kind": kind}
        return self.nodes[name]

    # ---------------------------------------------------------------- seeding --
    def setup(self) -> None:
        self.ok(self.admin.post("/api/setup", json={
            "organisation": "Grand Hall Events", "site_name": "Riverside Centre", "timezone": "Europe/London",
            "admin_username": ADMIN[0], "admin_password": ADMIN[1], "admin_display_name": "Sam (admin)",
            "rooms": ROOMS, "licence_key": self.licence}))
        boot = self.ok(self.admin.get("/api/bootstrap"))
        self.rooms = {r["name"]: r["id"] for r in boot["rooms"]}
        self.site = boot["sites"][0]["id"]

    def seed(self) -> None:
        a, R = self.admin, self.rooms
        for user, name, role in PEOPLE:
            self.ok(a.post("/api/admin/accounts", json={"username": user, "password": PASSWORD, "display_name": name, "role": role}))
        self.people = {u: self.session(u, PASSWORD) for u, _, _ in PEOPLE}
        # Laptops and screens, with the health numbers the Windows app sends.
        for name, room, who, mode in (("MAIN-HALL-1", "Main Hall", "amy", "main"), ("MAIN-HALL-2", "Main Hall", "ben", "backup"),
                                      ("STUDIO-1", "Studio 1", "priya", "main"), ("STUDIO-2", "Studio 2", "", "")):
            n = self.node(name)
            if who:
                self.ok(n["client"].post("/api/nodes/me/start", json={"username": who, "password": PASSWORD + "!",
                                                                                "room_id": R[room], "mode": mode}))
            else:
                self.ok(a.put(f"/api/fleet/nodes/{n['node_id']}", json={"room_id": R[room]}))
            self.ok(n["client"].post("/api/nodes/heartbeat", json={"version": "app-1.23.0", "ip": f"10.0.0.{21 + len(self.nodes)}",
                                                                   "info": {"system": SYS}}))
        for name, room, view in (("MAIN-HALL-STAGE", "Main Hall", "hcc"), ("MAIN-HALL-BACKSTAGE", "Main Hall", "backstage"),
                                 ("STUDIO-1-STAGE", "Studio 1", "hcc")):
            n = self.node(name, "kiosk")
            self.ok(a.put(f"/api/fleet/nodes/{n['node_id']}/screen", json={"room_id": R[room], "view": view}))
            self.ok(n["client"].post("/api/nodes/heartbeat", json={"version": "screen-agent 0.4.0", "ip": f"10.0.0.{60 + len(self.nodes)}"}))
        lap = self.nodes["MAIN-HALL-1"]["client"]
        # The Main Hall running order, with the keynote running.
        for cue, title, mins in (("1", "Doors and walk-in", 15), ("2", "Welcome", 10), ("3", "Keynote: The Next Ten Years", 30),
                                 ("4", "Panel: Building for Everyone", 25), ("5", "Audience Q&A", 15), ("6", "Lunch", 60)):
            self.ok(lap.post(f"/api/timers/{R['Main Hall']}/cues", json={"cue": cue, "title": title, "duration_ms": mins * 60000}))
        for _ in range(3):
            self.ok(lap.post(f"/api/timers/{R['Main Hall']}/go"))
        self.ok(lap.post(f"/api/timers/{R['Main Hall']}/add", json={"delta_ms": -11 * 60000 - 23000}))
        studio = self.nodes["STUDIO-1"]["client"]
        self.ok(studio.post(f"/api/timers/{R['Studio 1']}/preset/20"))
        # Chat.
        chans = self.ok(lap.get("/api/comms/channels"))
        room_ch = {c["room_id"]: c["id"] for c in chans if c["kind"] == "room"}
        crew = next(c["id"] for c in chans if c["kind"] == "site")
        mh = room_ch[R["Main Hall"]]
        self.ok(self.people["mia"].post(f"/api/comms/channels/{crew}/messages", json={"body": "Doors at 09:30. Lunch for crew is in the green room from 12:15.", "priority": "important"}))
        self.ok(lap.post(f"/api/comms/channels/{mh}/messages", json={"body": "Keynote is up. Lectern mic and the clicker both good."}))
        self.ok(self.people["mia"].post(f"/api/comms/channels/{mh}/messages", json={"body": "Thanks Amy. Client asks for house lights at 50% for the Q&A."}))
        self.ok(self.nodes["MAIN-HALL-2"]["client"].post(f"/api/comms/channels/{mh}/messages", json={"body": "Noted, I'll cue it with lighting."}))
        self.ok(studio.post(f"/api/comms/channels/{room_ch[R['Studio 1']]}/messages", json={"body": "Studio 1 is ready for the 10:00 workshop."}))
        # Help calls: one open, one fixed (the AI helper learns from how it was fixed).
        h = self.ok(studio.post("/api/comms/help", json={"room_id": R["Studio 1"], "category": "video",
                                                          "description": "Projector says no signal from the lectern laptop", "priority": "urgent"}))
        old = self.ok(lap.post("/api/comms/help", json={"room_id": R["Main Hall"], "category": "audio",
                                                         "description": "Radio mic 3 dropping out", "priority": "normal"}))
        self.ok(a.put(f"/api/comms/help/{old['id']}", json={"status": "acknowledged"}))
        self.ok(a.put(f"/api/comms/help/{old['id']}", json={"status": "resolved", "resolution": "Fresh batteries, and moved the receiver aerials clear of the LED wall."}))
        self.help_open = h["id"]
        # Handover notes.
        self.ok(lap.post(f"/api/rooms/{R['Main Hall']}/notes", json={"body": "Clicker 2 needs new batteries (AAA in the blue case).", "pinned": False}))
        self.ok(self.people["mia"].post(f"/api/rooms/{R['Main Hall']}/notes", json={"body": "Client wants house lights at 50% for every Q&A.", "pinned": True}))
        # Links.
        for label, url, room in (("Companion buttons", "http://10.0.0.5:8000/tablet", "Main Hall"), ("Lighting desk notes", "http://10.0.0.5/lx", "Main Hall"),
                                 ("Venue floor plan", "http://10.0.0.5/plan.pdf", None)):
            self.ok(a.post("/api/dashboard/links", json={"label": label, "url": url, "board": "public", "site_id": self.site,
                                                         "room_id": R[room] if room else None}))
        # Captions in the Main Hall only, with a few lines on the screens.
        for room in ROOMS[1:]:
            self.ok(a.put(f"/api/captions/rooms/{R[room]}", json={"enabled": False}))
        self.ok(a.put(f"/api/captions/rooms/{R['Main Hall']}", json={"enabled": True, "vocabulary": "Riverside\nGrand Hall Events\nPriya Shah\nOkafor"}))
        for line in ("Good morning everyone and welcome to Riverside.", "Over the next ten years the way we build events will change more than in the last fifty."):
            self.ok(lap.post(f"/api/captions/{R['Main Hall']}/test", json={"text": line}))
        # A presenters event.
        today = time.strftime("%Y-%m-%d")
        ev = self.ok(a.post("/api/presenter/events", json={"name": "Future of Events Summit", "client": "Grand Hall Events", "colour": "#2563eb",
                                                           "starts_on": today, "ends_on": today, "status": "live", "site_id": self.site}))
        for room, title, start, end, who in (("Main Hall", "Keynote: The Next Ten Years", "10:00", "10:30", "Dr Hannah Lee"),
                                             ("Main Hall", "Panel: Building for Everyone", "10:30", "10:55", "Marcus Webb"),
                                             ("Studio 1", "Workshop: Accessible Shows", "10:00", "11:00", "Priya Shah")):
            s = self.ok(a.post("/api/presenter/sessions", json={"event_id": ev["id"], "room_id": R[room], "title": title,
                                                                "starts_at": f"{today} {start}", "ends_at": f"{today} {end}"}))
            self.ok(a.post("/api/presenter/presenters", json={"event_id": ev["id"], "session_id": s["id"], "full_name": who,
                                                              "email": who.split()[-1].lower() + "@example.com"}))
        self.event = ev["id"]
        import sqlite3
        with sqlite3.connect(self.data / "atsuit.db") as db:
            self.tokens = dict(db.execute("SELECT full_name, token FROM pr_presenters"))
        pres = httpx.Client(base_url=self.url, timeout=20)
        self.ok(pres.post(f"/api/present/{self.tokens['Dr Hannah Lee']}/upload",
                          files={"file": ("Next-Ten-Years-v3.pptx", b"PK demo slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation")}))
        self.ok(pres.post(f"/api/present/{self.tokens['Dr Hannah Lee']}/checkin"))
        self.ok(pres.post(f"/api/present/{self.tokens['Marcus Webb']}/upload", files={"file": ("Panel-intro.pdf", b"%PDF-1.4 demo", "application/pdf")}))
        # AI helper venue notes.
        self.ok(a.put("/api/admin/ai", json={"enabled": True, "venue_notes": "Main Hall projector\nUse input HDMI 2. The remote is on the lectern shelf.\n\n"
                                                                            "Radio mics\nSpare AA batteries are in the blue case under the tech desk."}))


# ------------------------------------------------------------------ pictures --
SHOTS = []


def shot(name: str):
    def wrap(fn):
        SHOTS.append((name, fn))
        return fn
    return wrap


async def save(page, name: str, *, clip: dict | None = None, full: bool = False) -> None:
    await page.wait_for_timeout(600)
    OUT.mkdir(parents=True, exist_ok=True)
    await page.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=82, clip=clip, full_page=full)
    print("saved", name)


async def main(only: str = "") -> None:
    from playwright.async_api import async_playwright

    with tempfile.TemporaryDirectory() as tmp:
        demo = Demo(Path(tmp))
        try:
            async with async_playwright() as p:
                exe = os.getenv("KB_CHROMIUM")
                browser = await p.chromium.launch(**({"executable_path": exe} if exe else {}))
                demo.browser = browser
                # The setup wizard comes first, before the venue exists.
                for name, fn in SHOTS:
                    if name.startswith("setup") and name.startswith(only or ""):
                        await fn(demo)
                demo.setup()
                demo.seed()
                demo.keep_alive()
                failed = []
                for name, fn in SHOTS:
                    if not name.startswith("setup") and name.startswith(only or ""):
                        try:
                            await fn(demo)
                        except Exception as e:  # one picture failing shouldn't stop the rest
                            failed.append(name)
                            print(f"FAILED {name}: {str(e).splitlines()[0]}")
                if failed:
                    raise SystemExit(f"{len(failed)} pictures failed: {', '.join(failed)}")
                await browser.close()
        finally:
            demo.stop()


async def page_as(demo: Demo, who: str | None = None, *, w: int = W, h: int = H, node: str | None = None, scheme: str = "dark"):
    """A browser page signed in as `who` (an account), or as a tech laptop (`node`), or not signed in."""
    ctx = await demo.browser.new_context(viewport={"width": w, "height": h}, color_scheme=scheme)
    page = await ctx.new_page()
    if who:  # the seeding sessions' cookies, so the sign-in rate limit is never hit
        c = demo.admin if who == ADMIN[0] else demo.people[who]
        await ctx.add_cookies([{"name": k, "value": v, "url": demo.url} for k, v in c.cookies.items()])
    if node:
        n = demo.nodes[node]
        await page.goto(f"{demo.url}/static/brand/favicon.svg")
        await page.evaluate("t => localStorage.setItem('atsuit_node_token', t)", n["token"])
        cookies = n["client"].cookies
        await ctx.add_cookies([{"name": k, "value": v, "url": demo.url} for k, v in cookies.items()])
    return page


async def console(demo: Demo, hash_: str, name: str, who: str = ADMIN[0], wait: int = 900, **kw) -> None:
    page = await page_as(demo, who, **kw)
    await page.goto(f"{demo.url}/#/{hash_}")
    await page.wait_for_timeout(wait)
    await save(page, name)
    await page.context.close()


# The setup wizard.
@shot("setup-wizard")
async def _setup(demo: Demo):
    page = await page_as(demo)
    await page.goto(demo.url + "/")
    await page.fill("[name=organisation]", "Grand Hall Events")
    await page.fill("[name=site_name]", "Riverside Centre")
    await save(page, "setup-wizard")
    await page.context.close()


# Console pages that need nothing but opening: (picture, page, who).
CONSOLE = [
    ("console-dashboard", "dashboard", ADMIN[0]), ("console-chat", "chat", ADMIN[0]), ("console-help", "help", ADMIN[0]),
    ("timers-live", "timers/live", ADMIN[0]), ("timers-screens", "timers/screens", ADMIN[0]),
    ("timers-messages", "timers/messages", ADMIN[0]), ("timers-views", "timers/views", ADMIN[0]),
    ("timers-designer", "timers/designer", ADMIN[0]), ("console-presenters", "presenter", ADMIN[0]),
    ("console-captions", "captions", ADMIN[0]), ("console-reports", "reports", ADMIN[0]), ("console-rooms", "rooms", ADMIN[0]),
    ("laptops-list", "laptops/list", ADMIN[0]), ("laptops-add", "laptops/setup", ADMIN[0]), ("laptops-overlays", "laptops/overlays", ADMIN[0]),
    ("console-people", "people", ADMIN[0]), ("console-links", "links", ADMIN[0]),
    ("settings-general", "settings/general", ADMIN[0]), ("settings-look", "settings/appearance", ADMIN[0]),
    ("settings-chat", "settings/chat", ADMIN[0]), ("settings-ai", "settings/ai", ADMIN[0]), ("settings-keys", "settings/keys", ADMIN[0]),
    ("settings-updates", "settings/updates", ADMIN[0]), ("settings-about", "settings/info", ADMIN[0]),
    ("console-bugs", "bugs", ADMIN[0]), ("console-licence", "licence", ADMIN[0]), ("console-backups", "backups", ADMIN[0]),
    ("console-audit", "audit", ADMIN[0]), ("console-manager-sidebar", "dashboard", "mia"),
]
for _name, _hash, _who in CONSOLE:
    shot(_name)(lambda demo, n=_name, h=_hash, w=_who: console(demo, h, n, w, wait=1500))


def demo_pictures(folder: Path) -> dict[str, Path]:
    """Made-up pictures for the layout designer: a client's logo, a background and a sponsor's logo."""
    from PIL import Image, ImageDraw, ImageFont

    def words(img, text, size, fill, xy=None):
        d = ImageDraw.Draw(img)
        font = ImageFont.load_default(size=size)  # Pillow 10.1 or newer
        box = d.textbbox((0, 0), text, font=font)
        x, y = xy or ((img.width - box[2]) // 2, (img.height - box[3]) // 2)
        d.text((x, y), text, font=font, fill=fill)
    logo = Image.new("RGBA", (600, 200), (0, 0, 0, 0))
    ImageDraw.Draw(logo).ellipse((10, 30, 150, 170), fill=(56, 189, 248, 255))
    words(logo, "RIVERSIDE", 72, (255, 255, 255, 255), (175, 55))
    bg = Image.new("RGB", (1920, 1080))
    for y in range(1080):  # deep blue at the top to near black
        ImageDraw.Draw(bg).line([(0, y), (1920, y)], fill=(8, 22 + int(40 * (1 - y / 1080)), 48 + int(70 * (1 - y / 1080))))
    sponsor = Image.new("RGBA", (680, 240), (0, 0, 0, 0))
    words(sponsor, "Sponsored by", 40, (203, 213, 225, 255), (30, 20))
    words(sponsor, "NORTHLIGHT", 92, (250, 204, 21, 255), (24, 80))
    out = {}
    for name, img in (("logo", logo), ("background", bg), ("sponsor", sponsor)):
        out[name] = folder / f"{name}.png"
        img.save(out[name])
    return out


@shot("timers-designer-pictures")
async def _designer_pictures(demo: Demo):
    """A new layout getting its logo, a background picture and a sponsor's Picture part."""
    pics = demo_pictures(demo.data)
    page = await page_as(demo, ADMIN[0])
    await page.goto(f"{demo.url}/#/timers/designer")
    await page.locator("[data-d=name]").fill("Client blue")
    await page.locator("[data-up=logo]").set_input_files(str(pics["logo"]))  # saves the new layout, then uploads
    await page.locator(".ld-thumb").first.wait_for()
    await page.locator("[data-up=bg]").set_input_files(str(pics["background"]))
    await page.wait_for_timeout(800)
    async with page.expect_file_chooser() as fc:
        await page.click("[data-add=image]")
    await (await fc.value).set_files(str(pics["sponsor"]))
    await page.locator(".ld-right .ld-thumb").first.wait_for()
    for k, v in (("w", 20), ("h", 14), ("x", 77), ("y", 3)):
        await page.locator(f"[data-props] [data-k={k}]").fill(str(v))
    await page.click("[data-save]")
    await page.wait_for_timeout(1200)
    await page.locator("[data-layers] [data-pick-el^=image]").first.click()
    await page.evaluate("document.getElementById('toasts')?.replaceChildren()")
    await save(page, "timers-designer-pictures")
    await page.context.close()


@shot("workspace-start")
async def _start(demo: Demo):
    page = await page_as(demo, node="STUDIO-2")
    await page.goto(f"{demo.url}/node")
    await page.wait_for_timeout(1500)
    await save(page, "workspace-start")
    await page.context.close()


@shot("workspace-main")
async def _ws(demo: Demo):
    page = await page_as(demo, node="MAIN-HALL-1")
    await page.goto(f"{demo.url}/node")
    await page.wait_for_timeout(2500)
    await save(page, "workspace-main")
    await page.context.close()


async def workspace(demo: Demo, name: str, node: str = "MAIN-HALL-1", steps=None, wait: int = 2500, **kw) -> None:
    """The tech workspace on a laptop, after `steps(page)` (open a window, a menu...)."""
    page = await page_as(demo, node=node, **kw)
    await page.goto(f"{demo.url}/node")
    await page.wait_for_timeout(wait)
    if steps:
        await steps(page)
    await save(page, name)
    await page.context.close()


def desk_open(*ids: str):
    async def steps(page):
        for i in ids:
            await page.evaluate("id => ATDesk.open(id)", i)
            await page.wait_for_timeout(400)
    return steps


def click(*selectors: str):
    async def steps(page):
        for sel in selectors:
            await page.locator(sel).first.click(timeout=8000)
            await page.wait_for_timeout(500)
    return steps


async def ai_chat(page):
    await page.evaluate("ATDesk.open('ai')")
    for text in ("The lectern mic is dead", "No"):
        await page.fill("#aiInput", text)
        await page.click("#aiSend")
        await page.wait_for_timeout(1200)


async def ai_manual(page):
    """A "how do I" question, answered from the AT SUITE manual."""
    await page.evaluate("ATDesk.open('ai')")
    await page.fill("#aiInput", "How do I add a stage screen?")
    await page.click("#aiSend")
    await page.wait_for_timeout(1500)


async def bug_report(page):
    await page.click("#helpTop")
    await page.wait_for_timeout(400)
    await page.click("#bugBtn")
    await page.wait_for_timeout(600)
    await page.fill("#bugForm [name=title]", "The stage timer froze in Main Hall")
    await page.fill("#bugForm [name=description]", "Pressed GO for cue 3 at 10:02. The stage screen stayed on 30:00 while the workspace counted down.")


async def cue_edit(page):
    await page.locator("text=Panel: Building for Everyone").first.wait_for()
    row = page.locator("button:has-text('Edit')").nth(3)
    await row.click()
    await page.wait_for_timeout(500)


WORKSPACE = [
    ("workspace-help-menu", click("#helpTop")), ("workspace-bell", click("#bellBtn"), "MAIN-HALL-2"),
    ("workspace-layout-menu", click("#layoutMenu button")), ("workspace-ai", ai_chat),
    ("workspace-notes", desk_open("notes")), ("workspace-add-screen", desk_open("pair")),
    ("workspace-messages", desk_open("messages")), ("workspace-second-line", desk_open("second")),
    ("workspace-links", desk_open("links")), ("workspace-captions", desk_open("captions")),
    ("workspace-sessions", desk_open("sessions")), ("workspace-screens", desk_open("screens")),
    ("workspace-cue-edit", cue_edit), ("workspace-ai-manual", ai_manual), ("workspace-bug-report", bug_report),
]
for _name, _steps, *_node in WORKSPACE:  # on the Main PC, unless another laptop is named
    shot(_name)(lambda demo, n=_name, st=_steps, nd=(_node or ["MAIN-HALL-1"])[0]: workspace(demo, n, node=nd, steps=st))


async def caption_settings(demo: Demo, name: str, tab: str, before=None) -> None:
    """One tab of a room's caption settings, as a tech sees it in the Captions window."""
    mh = demo.rooms["Main Hall"]
    page = await page_as(demo, node="MAIN-HALL-1", w=1100, h=860)
    await page.goto(f"{demo.url}/static/captions-control.html?room={mh}")
    await page.wait_for_timeout(1500)
    if before:
        await before(page)
    await page.locator(f".capset [data-tab]:has-text('{tab}')").first.click()
    await page.wait_for_timeout(1200)
    await save(page, name)
    await page.context.close()


@shot("workspace-caption-settings")
async def _capset(demo: Demo):
    await caption_settings(demo, "workspace-caption-settings", "Audio & EQ")


@shot("workspace-caption-transcripts")
async def _captx(demo: Demo):
    async def record(page):  # one finished transcript and one recording now
        mh, lap = demo.rooms["Main Hall"], demo.nodes["MAIN-HALL-1"]["client"]
        demo.ok(lap.post(f"/api/captions/{mh}/transcript/start"))
        demo.ok(lap.post(f"/api/captions/{mh}/transcript/stop"))
        demo.ok(lap.post(f"/api/captions/{mh}/transcript/start"))
    await caption_settings(demo, "workspace-caption-transcripts", "Transcripts", record)


@shot("workspace-phone")
async def _phone(demo: Demo):
    await workspace(demo, "workspace-phone", w=390, h=844)


@shot("manager-view")
async def _manager(demo: Demo):
    page = await page_as(demo, "mia")
    await page.goto(f"{demo.url}/manage")
    await page.wait_for_timeout(2500)
    await save(page, "manager-view")
    await page.context.close()


@shot("manager-phone")
async def _manager_phone(demo: Demo):
    page = await page_as(demo, "mia", w=390, h=844)
    await page.goto(f"{demo.url}/manage")
    await page.wait_for_timeout(2500)
    await save(page, "manager-phone")
    await page.context.close()


@shot("laptop-details")
async def _details(demo: Demo):
    page = await page_as(demo, ADMIN[0])
    await page.goto(f"{demo.url}/#/laptops/list")
    await page.wait_for_timeout(1200)
    await page.locator("button:has-text('Details')").first.click()
    await page.wait_for_timeout(1500)
    await save(page, "laptop-details")
    await page.context.close()


@shot("presenters-review")
async def _review(demo: Demo):
    page = await page_as(demo, ADMIN[0])
    await page.goto(f"{demo.url}/#/presenter")
    await page.wait_for_timeout(1200)
    await page.locator("button:has-text('File review')").first.click()
    await page.wait_for_timeout(1000)
    await save(page, "presenters-review")
    await page.context.close()


@shot("presenters-session")
async def _session(demo: Demo):
    page = await page_as(demo, ADMIN[0])
    await page.goto(f"{demo.url}/#/presenter")
    await page.wait_for_timeout(1200)
    await page.locator("text=Keynote: The Next Ten Years").first.click()
    await page.wait_for_timeout(1000)
    await save(page, "presenters-session")
    await page.context.close()


@shot("presenter-portal")
async def _portal(demo: Demo):
    page = await page_as(demo, w=390, h=844, scheme="light")
    await page.goto(f"{demo.url}/present/{demo.tokens['Dr Hannah Lee']}")
    await page.wait_for_timeout(1500)
    await save(page, "presenter-portal")
    await page.context.close()


# Screens anyone can open: (picture, address, width, height).
def screens(demo: Demo):
    mh = demo.rooms["Main Hall"]
    return [("screen-standard", f"/timer/{mh}", 1920, 1080), ("screen-backstage", f"/timer/{mh}?view=backstage", 1920, 1080),
            ("screen-preview", f"/timer/{mh}?view=preview", 1920, 1080), ("screen-clock", f"/timer/{mh}?view=clock", 1920, 1080),
            ("screen-minimal", f"/timer/{mh}?view=minimal", 1920, 1080),
            ("screen-captions", f"/captions/{mh}", 1920, 1080), ("screen-pairing", "/screen", 1920, 1080),
            ("screen-testpattern", "/screentest", 1920, 1080), ("guide-tech-card", "/guide/tech", 1100, 1400),
            ("guide-help", "/guide/help", W, H), ("guide-manual", "/guide/manual#pair-a-screen", W, H)]


@shot("screen")
async def _screens(demo: Demo):
    mh, lap = demo.rooms["Main Hall"], demo.nodes["MAIN-HALL-1"]["client"]
    for name, path, w, h in screens(demo):
        page = await page_as(demo, w=w, h=h)
        await page.goto(demo.url + path)
        await page.wait_for_timeout(1500)
        if name == "screen-captions":  # caption screens fade old lines: say something new
            for line in ("Good morning everyone and welcome to Riverside.", "Over the next ten years the way we build events will change."):
                demo.ok(lap.post(f"/api/captions/{mh}/test", json={"text": line}))
                await page.wait_for_timeout(700)
        await save(page, name)
        await page.context.close()
    # The Standard view with a message on stage.
    page = await page_as(demo, w=1920, h=1080)
    await page.goto(f"{demo.url}/timer/{mh}")
    demo.ok(lap.post(f"/api/timers/{mh}/message/show", json={"text": "5 minutes"}))
    await page.wait_for_timeout(1500)
    await save(page, "screen-message")
    demo.ok(lap.post(f"/api/timers/{mh}/message/hide"))
    await page.context.close()


@shot("guide")
async def _guides(demo: Demo):
    for name, path, w, h in screens(demo):
        if name.startswith("guide"):
            page = await page_as(demo, w=w, h=h)
            await page.goto(demo.url + path)
            await page.wait_for_timeout(1500)
            await save(page, name)
            await page.context.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else ""))
