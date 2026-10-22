"""The help centre at /docs: sections, every article, search, and what the pages are made of."""
from __future__ import annotations

import re

from atshop import kb


def test_the_help_centre_lists_every_section(h):
    k = kb.load()
    page = h.client().get("/docs").text
    assert f"AT SUITE {k.version}" in page
    for s in k.sections:
        assert s.title.replace("'", "&#39;") in page, s.title
        for a in s.articles:
            assert f'href="/docs/{a.slug}"' in page, a.slug


def test_every_article_opens_with_its_title_pictures_and_neighbours(h):
    c, k = h.client(), kb.load()
    for a in k.articles.values():
        page = c.get(f"/docs/{a.slug}").text
        assert len(re.findall(r"<h1[ >]", page)) == 1, a.slug
        assert f'aria-current="page"' in page and f'href="/docs/{a.slug}"' in page, a.slug
        for img in re.findall(r"<img [^>]*>", page):
            assert re.search(r'alt="[^"]+"', img) or 'alt=""' in img and "brand" in img, (a.slug, img)
        before, after = k.neighbours(a)
        if after:
            assert f'href="/docs/{after.slug}"' in page, a.slug
    assert c.get("/docs/not-an-article").status_code == 404


def test_pictures_become_figures_and_tips_stand_out():
    html, toc = kb.to_html('# T\n\n## One\n\n![A screen](/static/kb/x.jpg "Caption")\n\n> **Tip:** Do this.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    assert '<figure><a href="/static/kb/x.jpg" class="shot"><img src="/static/kb/x.jpg" alt="A screen" loading="lazy"></a><figcaption>Caption</figcaption></figure>' in html
    assert '<blockquote class="callout tip">' in html and '<div class="table-wrap" data-scrolls><table>' in html
    assert toc == [("one", "One")]


def test_search_finds_how_to_pages(h):
    k = kb.load()
    assert kb.search(k, "how do I add a stage screen")[0][0].slug == "pair-a-screen"
    assert kb.search(k, "export transcript srt")[0][0].slug == "transcripts"
    assert kb.search(k, "") == [] and kb.search(k, "zorblatt") == []
    page = h.client().get("/docs/search", params={"q": "caption keynote"}).text
    assert 'href="/docs/scenario-caption-keynote"' in page and 'role="status"' in page


def test_the_sitemap_has_every_article(h):
    xml = h.client().get("/sitemap.xml").text
    for slug in kb.load().articles:
        assert f"/docs/{slug}</loc>" in xml, slug
