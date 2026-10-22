"""The knowledge base: the website's help centre (website/atshop/content/kb) is also the AT SUITE
manual in the app, at /guide/manual and in the AI helper's answers. It must describe the release
it ships with, and every page, link and picture in it must be there."""
import re
import tomllib
from pathlib import Path

from atsuit.modules import aihelper

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / "website" / "atshop" / "content" / "kb"
PICTURES = ROOT / "website" / "atshop" / "static" / "kb"
INDEX = tomllib.loads((KB / "index.toml").read_text(encoding="utf-8"))
LISTED = [a for s in INDEX["section"] for a in s["articles"]]


def test_the_knowledge_base_is_written_for_this_release():
    version = (ROOT / "VERSION").read_text().strip()
    assert INDEX["version"] == version, (
        f"The knowledge base says it's for {INDEX['version']} but this is {version}. Update the help pages for "
        "what changed in this release (and What's new), retake the pictures with website/tools/kb_screenshots.py, "
        "then set version in website/atshop/content/kb/index.toml. See CONTRIBUTING.md.")
    assert f"## {version}" in (KB / "whats-new.md").read_text(encoding="utf-8"), f"What's new has no section for {version}"


def test_every_article_is_listed_once_and_has_its_details():
    on_disk = {f.stem for f in KB.glob("*.md")}
    assert len(LISTED) == len(set(LISTED)), "an article is listed twice in index.toml"
    assert set(LISTED) == on_disk, f"not listed: {on_disk - set(LISTED)}; missing: {set(LISTED) - on_disk}"
    for name in LISTED:
        meta, body = aihelper.split_meta((KB / f"{name}.md").read_text(encoding="utf-8"))
        assert body.startswith("# "), f"{name}.md must start with its title"
        assert meta.get("summary") and meta.get("keywords") and meta.get("audience"), f"{name}.md needs summary, audience and keywords"


def test_links_and_pictures_all_work():
    for name in LISTED:
        text = (KB / f"{name}.md").read_text(encoding="utf-8")
        for target in re.findall(r"\]\(/docs/([^)#\s]+)", text):
            assert target in LISTED, f"{name}.md links to /docs/{target}, which isn't an article"
        for alt, src in re.findall(r"!\[([^\]]*)\]\(([^)\s]+)", text):
            assert alt.strip(), f"{name}.md has a picture with no alt text: {src}"
            assert src.startswith("/static/kb/") and (PICTURES / src[11:]).is_file(), f"{name}.md: no picture {src}"


def test_the_manual_is_served_offline(client):
    # No sign-in needed (it's public on the website too), and it works while the licence is locked.
    d = client.get("/api/guide/manual").json()
    assert d["version"] == INDEX["version"]
    assert [s["slug"] for s in d["sections"]] == [s["slug"] for s in INDEX["section"]]
    first = d["sections"][0]["articles"][0]
    assert first["slug"] == LISTED[0] and first["title"] and first["markdown"].startswith("# ")
    assert client.get("/guide/manual").status_code == 200
    r = client.get("/guide/manual/img/console-dashboard.jpg")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    for bad in ("../VERSION", "..%2Findex.toml", "index.toml", "nothing.jpg"):
        assert client.get(f"/guide/manual/img/{bad}").status_code == 404


def _tech(admin):
    admin.post("/api/admin/accounts", json={"username": "ben", "password": "ben-password-1", "display_name": "Ben", "role": "tech"})
    t = admin.__class__(admin.app)
    t.post("/api/auth/login", json={"username": "ben", "password": "ben-password-1"})
    return t


def test_the_ai_helper_answers_how_to_questions_from_the_manual(admin, monkeypatch):
    monkeypatch.setattr(aihelper.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no web")))
    tech = _tech(admin)
    room = admin.get("/api/bootstrap").json()["rooms"][0]["id"]

    def ask(text):
        return tech.post("/api/ai/chat", json={"messages": [{"role": "tech", "text": text}], "room_id": room}).json()

    r = ask("how do I add a stage screen?")
    assert r["sources"][0] == {"kind": "AT SUITE manual", "title": "Add a stage screen", "url": "/guide/manual#pair-a-screen"}
    assert "From the AT SUITE manual" in r["answer"] and "Add a screen" in r["answer"] and "Did that answer it?" in r["answer"]
    assert ask("how do I export the transcript")["sources"][0]["url"] == "/guide/manual#transcripts"
    # A fault still gets the tech guide's questions first
    r = ask("the lectern mic is dead")
    assert r["sources"][0]["kind"] == "tech guide" and r["choices"]

    # Admins can leave the manual out
    admin.put("/api/admin/ai", json={"manual": False})
    assert all(s["kind"] != "AT SUITE manual" for s in ask("how do I add a stage screen?")["sources"])

    # With a model, the manual's steps are in what it's given
    seen = {}

    def fake_model(url, model, messages):
        seen["system"] = messages[0]["content"]
        return "Open Add a screen and type the code."
    monkeypatch.setattr(aihelper, "chat_model", fake_model)
    admin.put("/api/admin/ai", json={"ai_url": "http://10.0.0.5:11434"})
    r = ask("how do I add a stage screen?")
    assert r["model"] is True and "[AT SUITE manual] Add a stage screen" in seen["system"]
