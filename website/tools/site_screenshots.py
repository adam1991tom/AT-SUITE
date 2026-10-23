"""Takes the website's own feature pictures from the same demo AT SUITE server as the knowledge base.

    python website/tools/site_screenshots.py

It reuses kb_screenshots.py's demo venue (Riverside Centre, the Main Hall keynote running) and saves
the stage timer at each stage of a session to website/atshop/static/img/timer-<stage>.jpg, for the
slider on /features. Nothing touches a real server. KB_CHROMIUM works the same as for kb_screenshots.py.
"""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kb_screenshots as kb  # noqa: E402

OUT = kb.ROOT / "website" / "atshop" / "static" / "img"
W, H = 1280, 720

# (picture, minutes and seconds left when it's taken, what else is on). Warning starts at 5:00, danger at 1:00.
STAGES = [
    ("timer-running", 18 * 60 + 32, {}),
    ("timer-warning", 4 * 60 + 48, {}),
    ("timer-danger", 42, {}),
    ("timer-overtime", -75, {}),
    ("timer-message", 3 * 60 + 10, {"message": "Please wrap up"}),
    ("timer-clock", 0, {"clock": True}),
]


def daytime(demo: kb.Demo) -> None:
    """Moves the demo venue to a time zone where it's mid-morning now, so the clocks on screen look like a show day."""
    for zone in ("Europe/London", "Europe/Athens", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore",
                 "Asia/Tokyo", "Australia/Brisbane", "Pacific/Noumea", "Pacific/Auckland", "Pacific/Tongatapu", "Pacific/Honolulu",
                 "America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York",
                 "America/Halifax", "America/Sao_Paulo", "Atlantic/South_Georgia", "Atlantic/Azores"):
        if 9 <= datetime.now(ZoneInfo(zone)).hour < 12:
            demo.ok(demo.admin.put(f"/api/admin/sites/{demo.site}", json={"name": "Riverside Centre", "timezone": zone}))
            return


async def stages(demo: kb.Demo) -> None:
    mh, lap = demo.rooms["Main Hall"], demo.nodes["MAIN-HALL-1"]["client"]
    daytime(demo)
    page = await kb.page_as(demo, w=W, h=H)
    await page.goto(f"{demo.url}/timer/{mh}")
    await page.wait_for_timeout(1500)
    for name, left, extra in STAGES:
        if extra.get("clock"):
            demo.ok(lap.post(f"/api/timers/{mh}/clock", json={"on": True}))
        else:
            now = demo.ok(lap.get(f"/api/timers/{mh}"))["remaining_ms"]
            # A second and a half over, for the time the screen takes to catch up.
            demo.ok(lap.post(f"/api/timers/{mh}/add", json={"delta_ms": (left * 1000 + 1500) - now}))
        if extra.get("message"):
            demo.ok(lap.post(f"/api/timers/{mh}/message/show", json={"text": extra["message"]}))
        await page.wait_for_timeout(1200)
        if left < 0:  # overtime flashes: hold it at the start, where it's brightest
            await page.evaluate("document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; })")
        OUT.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=82)
        print("saved", name)
        if extra.get("message"):
            demo.ok(lap.post(f"/api/timers/{mh}/message/hide"))
        if extra.get("clock"):
            demo.ok(lap.post(f"/api/timers/{mh}/clock", json={"on": False}))
    await page.context.close()


async def main() -> None:
    from playwright.async_api import async_playwright

    with tempfile.TemporaryDirectory() as tmp:
        demo = kb.Demo(Path(tmp))
        try:
            async with async_playwright() as p:
                exe = os.getenv("KB_CHROMIUM")
                demo.browser = await p.chromium.launch(**({"executable_path": exe} if exe else {}))
                demo.setup()
                demo.seed()
                demo.keep_alive()
                await stages(demo)
                await demo.browser.close()
        finally:
            demo.stop()


if __name__ == "__main__":
    asyncio.run(main())
