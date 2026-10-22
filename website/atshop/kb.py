"""The knowledge base: AT SUITE's help centre at /docs, written once as Markdown in content/kb/.

content/kb/index.toml lists the sections and their articles in reading order, and the AT SUITE
release the pages were written for. Each article is content/kb/<slug>.md: a few "key: value" lines
between --- lines (summary, audience, keywords), then the page itself, starting "# Title". Pictures
are in static/kb/ (website/tools/kb_screenshots.py takes them) and linked as /static/kb/<name>.jpg.

The same files ship inside the AT SUITE server (the Dockerfile copies them): the AI helper answers
from them, and techs read them offline at /guide/manual. So write for both: plain steps, the exact
names of pages and buttons, and words in every picture's alt text.
"""
from __future__ import annotations

import html
import math
import re
import tomllib
from collections import Counter
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import markdown as md

DIR = Path(__file__).resolve().parent / "content" / "kb"
STOP = set("""a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or
our so that the their them then there these this to too up us was we what when where which who why will with you your
get got just need now any all some please help im ive dont cant wont isnt""".split())


@dataclass
class Article:
    slug: str
    title: str
    summary: str
    audience: str
    keywords: str
    section: str
    markdown: str
    html: str
    text: str  # the words, for search
    toc: list[tuple[str, str]] = field(default_factory=list)  # (id, heading) of each "## "


@dataclass
class Section:
    slug: str
    title: str
    summary: str
    articles: list[Article]


@dataclass
class KnowledgeBase:
    version: str
    sections: list[Section]
    articles: dict[str, Article]

    def section_of(self, a: Article) -> Section:
        return next(s for s in self.sections if s.slug == a.section)

    def neighbours(self, a: Article) -> tuple[Article | None, Article | None]:
        order = [x for s in self.sections for x in s.articles]
        i = order.index(a)
        return (order[i - 1] if i else None), (order[i + 1] if i + 1 < len(order) else None)


def split_meta(text: str) -> tuple[dict, str]:
    """The "key: value" lines between the --- lines at the top, and the rest."""
    meta: dict[str, str] = {}
    if text.startswith("---\n"):
        head, _, text = text[4:].partition("\n---\n")
        for line in head.splitlines():
            k, _, v = line.partition(":")
            if k.strip():
                meta[k.strip().lower()] = v.strip()
    return meta, text.lstrip("\n")


def _stem(w: str) -> str:
    for end in ("ing", "ed", "es", "s"):
        if w.endswith(end) and len(w) - len(end) >= 3 and not w.endswith("ss"):
            return w[: -len(end)]
    return w


def words(text: str) -> list[str]:
    return [_stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]


CALLOUT = re.compile(r"<blockquote>\s*<p><strong>(Tip|Note|Important|Safety):</strong>", re.I)
FIGURE = re.compile(r'<p><img alt="([^"]*)" src="([^"]+)"(?: title="([^"]*)")? ?/?></p>')


def to_html(text: str) -> tuple[str, list[tuple[str, str]]]:
    m = md.Markdown(extensions=["tables", "fenced_code", "toc", "sane_lists"], output_format="html",
                    extension_configs={"toc": {"toc_depth": "2-3"}})
    out = m.convert(text)
    toc = [(t["id"], t["name"]) for h1 in m.toc_tokens for t in h1.get("children", [])] or \
          [(t["id"], t["name"]) for t in m.toc_tokens if t["level"] == 2]
    # A picture on its own line is a figure: its title (the "..." after the address) is the caption,
    # and it opens full size in a new view. Every picture has alt text (the tests check).
    out = FIGURE.sub(lambda f: f'<figure><a href="{f[2]}" class="shot"><img src="{f[2]}" alt="{f[1]}" loading="lazy"></a>'
                               + (f"<figcaption>{f[3]}</figcaption>" if f[3] else "") + "</figure>", out)
    out = CALLOUT.sub(lambda c: f'<blockquote class="callout {c[1].lower()}"><p><strong>{c[1].capitalize()}:</strong>', out)
    # Tables scroll sideways on a phone instead of widening the page.
    out = out.replace("<table>", '<div class="table-wrap" data-scrolls><table>').replace("</table>", "</table></div>")
    return out, toc


def plain(markdown_text: str) -> str:
    """The words of a page, without Markdown: for search and snippets."""
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", markdown_text)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"```.*?```", " ", t, flags=re.S)
    t = re.sub(r"[#*`>|]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def load(folder: Path = DIR) -> KnowledgeBase:
    return _load(str(folder), _stamp(folder))


def _stamp(folder: Path) -> float:
    return max((f.stat().st_mtime for f in folder.glob("*")), default=0)


@lru_cache(maxsize=2)
def _load(folder: str, _stamp: float) -> KnowledgeBase:
    d = Path(folder)
    index = tomllib.loads((d / "index.toml").read_text(encoding="utf-8"))
    sections, articles = [], {}
    for s in index["section"]:
        listed = []
        for slug in s["articles"]:
            meta, body = split_meta((d / f"{slug}.md").read_text(encoding="utf-8"))
            first = body.splitlines()[0] if body else ""
            title = first[2:].strip() if first.startswith("# ") else slug
            page, toc = to_html(body)
            a = Article(slug=slug, title=title, summary=meta.get("summary", ""), audience=meta.get("audience", ""),
                        keywords=meta.get("keywords", ""), section=s["slug"], markdown=body, html=page,
                        text=plain(body), toc=toc)
            articles[slug] = a
            listed.append(a)
        sections.append(Section(slug=s["slug"], title=s["title"], summary=s.get("summary", ""), articles=listed))
    return KnowledgeBase(version=index["version"], sections=sections, articles=articles)


def search(kb: KnowledgeBase, query: str, limit: int = 20) -> list[tuple[Article, str]]:
    """The articles that best match a question, with a sentence from each that matches."""
    q = set(words(query))
    if not q:
        return []
    docs = {a.slug: Counter(words(f"{a.title} " * 3 + f"{a.summary} {a.keywords} " * 2 + a.text)) for a in kb.articles.values()}
    df = Counter(w for c in docs.values() for w in set(c))
    n = len(docs)
    scored = []
    for a in kb.articles.values():
        c = docs[a.slug]
        hit = [w for w in q if c.get(w)]
        if not hit:
            continue
        title = set(words(a.title))
        s = sum(math.log(1 + n / df[w]) * (1 + math.log(c[w])) * (2 if w in title else 1) for w in hit)
        s *= (len(hit) / len(q)) ** 2  # pages with every word first
        scored.append((s / math.sqrt(1 + sum(c.values()) / 300), a))
    scored.sort(key=lambda x: -x[0])
    return [(a, snippet(a, q)) for _, a in scored[:limit]]


def snippet(a: Article, q: set[str]) -> str:
    for sentence in re.split(r"(?<=[.!?])\s+", a.text):
        if q & set(words(sentence)) and len(sentence) > 30:
            return html.escape(sentence[:240] + ("…" if len(sentence) > 240 else ""))
    return html.escape(a.summary)
