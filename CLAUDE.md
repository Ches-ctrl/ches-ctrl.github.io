# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Charlie Cheesman's personal site, served by GitHub Pages from the repo root on `main` at
https://www.charliecheesman.net (see `CNAME`). `.nojekyll` disables Jekyll processing.

Deliberately modelled on paulgraham.com and patrickcollison.com: left-aligned, vertical index
in a left column, content beside it. The governing constraint is **nothing blocks the first
paint** — no webfonts, no framework, no client-side rendering. Two requests per page, the HTML
and one cached stylesheet. Check anything you add to `<head>` against that.

An earlier version used a Tailwind CDN script (407KB, render-blocking) plus three Google Font
families, hidden behind `body { visibility: hidden }` until `document.fonts.ready` resolved.
That is what caused the blank flash on every navigation. Don't reintroduce any part of it.

## Commands

```bash
npm run build     # everything: pages, posts, nav
npm run serve     # preview on :3000 (needed — /static/style.css is a root-relative path)
```

`marked` is the only dependency, build-time only. There are no tests or linters.

## Architecture

**Source and output are separate, and output is in git.** Edit `pages/*.html` (content
fragments) and `blog/posts/*.md`. Never edit `index.html`, `about/index.html`, `blog/index.html`
or `blog/<slug>/index.html` — `npm run build` overwrites all of them. Generated files are
committed because GitHub Pages serves the repo as-is.

**The page shell is defined exactly once**, in `shell()` in `scripts/build.js`. That is the only
place `<head>`, the nav, and the page chrome exist. Changing the layout means changing that one
function and rebuilding — there is no per-page boilerplate to keep in sync.

**`site.json` drives the nav and the page list.** An entry with a `"page"` key renders
`pages/<page>.html` to `<path>/index.html`. Blog has no `"page"` because it is generated from
markdown. Adding a section: create `pages/<name>.html`, add the entry, rebuild.

Every entry also carries a `description` — that is the meta description, and the text under the
link when the page is shared. It is copy, not configuration: write it for a human reading a
search result, keep it under about 155 characters, and don't leave it off a new section. The top
level of `site.json` holds `jobTitle`, `description`, `image`, `sameAs`, `worksFor`, `alumniOf`
and `knowsAbout`, which feed the home page's metadata and its structured data.

Two of those are easy to get wrong. `sameAs` is only for alternate representations of Charlie
himself — LinkedIn, X, GitHub. Organisations he is affiliated with are a different claim and go
in `worksFor`; putting them in `sameAs` asserts that moloqo.com *is* him. And `alumniOf` is
Oxford alone, deliberately — the about page says he dropped out of Durham, so listing Durham
would be a false claim in structured data. Don't "complete" it.

**Metadata is generated, never hand-written.** `shell()` emits the description, canonical URL,
and Open Graph and Twitter tags for every page from those fields. Schema.org JSON-LD goes on the
home page (`ProfilePage` wrapping a `Person`, via `personLd()`) and on posts (a `@graph` of
`BlogPosting` + `BreadcrumbList`) — and nowhere else, so the other pages carry no weight they
don't need. The `ProfilePage` wrapper is load-bearing: Google's profile-page treatment triggers
on it, and a bare top-level `Person` earns no SERP feature of its own.

Types deliberately **not** emitted, having been assessed and rejected: `WebSite`/`SearchAction`
(only ever powered the sitelinks searchbox, which needs real on-site search), `ItemList` on the
bookshelf, links and tech-stack pages (no rich result targets a curated list), `FAQPage` (Google
retired it for all sites in May 2026, and the questions page has no answers anyway), and
`Service` on the work page (valid, but no rich result attaches to it). Each would add bytes for
nothing. That `<script type="application/ld+json">` block is
data: browsers parse it and never execute it, so it is not on the critical path and the site
still runs no JavaScript. Don't add a script tag that does.

**`sitemap.xml` and `robots.txt` are built** by `buildSitemap()`, from the same page list the
site is built from, so a page cannot ship without being announced. `404.html` is generated too,
from `pages/404.html`, and is the one page marked `noindex` — GitHub Pages serves it with a real
404 status for unmatched paths, but answers 200 when it is fetched directly.

**The social preview image** is `static/og.png`, 1200×630, built from `static/og.svg` with
`rsvg-convert -w 1200 -h 630 static/og.svg -o static/og.png`. Edit the SVG and re-run that; don't
edit the PNG. It is the site's own furniture — white ground, the cyan accent, the display stack —
and no browser ever requests it, only a social scraper does, so the two-request rule still holds.

**One post per directory.** `blog/posts/<slug>.md` → `blog/<slug>/index.html`, so every post has
a real URL. Frontmatter takes `title`, `date` (ISO) and `draft: true`. The build deletes
directories under `blog/` that no longer match a published post, so renaming or drafting removes
the stale page — this is why it deletes, and why `posts` is on its keep-list.

**The blog has an Atom feed** at `/feed.xml`, generated by `buildFeed()` from the same posts as
the blog index, with autodiscovery declared in every page's `<head>` and a visible "Atom feed"
link under the post list, emitted by `buildBlog()`. Absolute URLs are required by the spec, so
it reads `SITE.url` - keep that field correct.

**Off-site links open in a new tab automatically.** `externalLinks()` adds
`target="_blank" rel="noopener"` at build time to page bodies and rendered posts, so it covers
HTML fragments and Markdown alike. Same-site and relative links are left alone, as is any link
that already declares a target. Don't add the attributes by hand.

**Company logos are stored locally** in `static/logos/`, fetched once rather than hotlinked, so
the zero-external-requests rule still holds on the career page. Organisations with no logo get a
CSS monogram circle instead; don't add a remote `<img>` src to fill a gap.

**Styling is one ~2.6KB file** at `static/style.css`, linked root-relative. Tokens are custom
properties on `:root`; `--sidebar`, `--size` and `--measure` are the ones worth touching. No
utility classes — add rules to the stylesheet rather than inline styles. The layout is flex and
collapses to a stacked nav under 640px, which is where both reference sites break and this one
shouldn't.

## The look is deliberate

Type and spacing are **Patrick Collison's exact values**, lifted from
patrickcollison.com/static/style.css, with his right-hand menu moved to the left at Charlie's
request. Don't "improve" them:

| | Value |
|---|---|
| Body | `Helvetica`, 13px |
| Body copy | `#333`, `line-height: 18px` (a length, not a ratio — deliberate) |
| Headings | `"Myriad Pro", "Helvetica Neue", Helvetica`, `margin: 0`, h2 `margin-top: 2em` |
| Links | `#0864c7`, with `a:visited` pinned to the same blue — deliberate, not an oversight |
| Byline / meta | 10px `#aaa` |
| List items | `margin-bottom: 0.7em` |
| Measure | 500px; index column 150px |

Paragraph margins are browser default, because his are. No rounded corners, no shadows, no
`font-smoothing`. Code blocks have no equivalent on his site, so they are kept minimal.

Bumping the type size, opening the leading or adding polish reverses a decision Charlie made
deliberately after three rounds of iteration. `--size` equivalents live in `:root` if he asks
to move off exact.

The cyan `.accent` line above the name goes on **every** page — his one addition to Collison's
design. It is a plain `<div class="accent">` emitted by `shell()` plus one CSS gradient rule.
There is no JS on this site at all; if it looks missing on a page, that is browser cache.

**The home page carries only his name and the index — no tagline, no intro line.** Its content
source is `pages/index.html`, which is intentionally empty. He flagged this as a state he may
want to return to, so if he later asks for text there, don't lose the empty version.

## Content status

Every section page now has real content. `contact/` deliberately lists no email address —
Charlie has decided against a public one; the links there are the way to reach him. Don't
invent content for any of these pages; books, tools, links and opinions have to come from him.

`blog/posts/sample-post.md` stays. It is the formatting demo and, for now, the only post, so it
is what the blog index, the feed and the post layout are exercised against. Charlie asked for it
back after a round of deleting it — don't delete it again until there is real writing to replace
it.

There are no `TODO(charlie)` comments left in `pages/`. `stripNotes()` in `scripts/build.js`
still removes them from output, so the convention is available if he wants to leave a working
note in a fragment — it just isn't in use.
