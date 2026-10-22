<img src="branding/logo/atsuit-wordmark.png" alt="AT-SUITE" width="200">

# Working on AT-SUITE

- Branch from `ATSUITE` (the default branch), open a pull request, and let CI go green before merging. `ATSUITE` is always releasable.
- Run the tests: `cd server && python -m pytest -q`. Set `ATSUIT_TEST_MODELS` to a folder holding the speech model to include the captions test.
- Keep each module in `server/atsuit/modules/` self-contained: its routes, its checks, and a migration in `db.py` for any table it adds. Never edit an old migration; add a new one.
- Anything a venue might change belongs in the console's Venue and Site sections, not in a config file.
- User-facing changes get a line in `CHANGELOG.md`.
- User-facing changes also update the knowledge base (below), in the same pull request.
- Releases: bump `VERSION`, add the CHANGELOG section, update the knowledge base for the release (below), merge, then `git tag vX.Y.Z && git push origin vX.Y.Z` (or publish a release `vX.Y.Z` on GitHub targeting `ATSUITE`). The release workflow checks the tag matches `VERSION`.

## The knowledge base

One set of pages, three places: the help centre on the website (`/docs`), the
manual inside the app (`/guide/manual`, works offline) and what the AI helper
answers "how do I..." questions from. The pages are Markdown in
`website/atshop/content/kb/` (the order and sections are in `index.toml`,
the format is at the top of `website/atshop/kb.py`), and their pictures are
in `website/atshop/static/kb/`. The server's Dockerfile copies both into the
image.

Every release:

1. Update the pages for what changed: new buttons, settings, screens and
   steps, with the exact names on screen. A new feature gets a how-to; a big
   one gets a step-by-step scenario too. Add the article to `index.toml`.
2. Add a section for the version to `whats-new.md`.
3. Retake the pictures: `pip install playwright pillow`, then
   `python website/tools/kb_screenshots.py` (it starts a demo server with a
   made-up venue; `KB_CHROMIUM=/path/to/chromium` if Playwright has no browser,
   and a name prefix like `console-` to retake only some). Add a shot for a
   new screen to the script.
4. Set `version` in `index.toml` to the new `VERSION`.

CI (`server/tests/test_knowledge_base.py`) fails while `index.toml` is
behind `VERSION`, while What's new has no section for it, and when an article
is missing from the index, a link between articles is broken or a picture is
missing or has no alt text.

## Logo and brand

The logo, icons, colours and font live in `branding/` with a guide in
`branding/manual/`. Don't edit the generated files by hand: change
`branding/make_brand.py` and run it (`--app-only` just refreshes the copies
in `server/atsuit/static/brand/` and `node-app/`).
