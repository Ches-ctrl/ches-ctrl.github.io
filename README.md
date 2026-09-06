# charliecheesman.net

Static HTML, one stylesheet, no webfonts. Nothing blocks the first paint: the only
script that runs is an async Google Analytics tag, plus a voice client on `/ask/`
that isn't fetched until someone clicks it — every other page still loads exactly
what it always has. Served by GitHub Pages from the repo root on `main`.

Modelled on [paulgraham.com](https://www.paulgraham.com) and
[patrickcollison.com](https://patrickcollison.com): left-aligned, vertical index, the HTML
contains the text, and every piece of writing has a real URL.

## Add a blog post

1. Create `blog/posts/<slug>.md`. The filename becomes the URL.

   ```markdown
   ---
   title: How to do great work
   date: 2026-08-14
   ---

   Body text in Markdown.
   ```

   Add `draft: true` to keep it out of the build.

2. Build, check it, ship it:

   ```bash
   npm run build
   npm run serve      # http://localhost:3000
   node --test        # runs scripts/corpus.test.js and scripts/voice-codec.test.js
   git add -A && git commit -m "post: how to do great work" && git push
   ```

   New writing changes what the voice agent at `/ask/` knows, since its knowledge base
   is generated from the same pages and posts. Push it with `npm run agent:sync`
   (needs `ELEVENLABS_API_KEY`) once you're happy with what you published.

`blog/posts/how-to-do-great-work.md` is served at `/blog/how-to-do-great-work/`.
Renaming, deleting or drafting a post removes its old page on the next build.

## Edit a page

Content lives in `pages/<name>.html` as a fragment — no `<head>`, no nav, no boilerplate,
just the content of that page. `npm run build` wraps it in the shared shell.

To add or rename a nav entry, edit `site.json`. To add a whole section, create
`pages/<name>.html` and add an entry with a matching `"page"` key.

## Layout

```
pages/*.html          page content (fragments) — edit these
blog/posts/*.md       post sources — edit these
agent/prompt.md       the voice agent's system prompt — edit this
site.json             site name + nav

index.html            generated
about/ ideas/ ...     generated
blog/<slug>/          generated
llms.txt              generated — the voice agent's knowledge base, from corpus.js
static/style.css      the only stylesheet
static/voice.js       the voice client for /ask/, fetched only on click
scripts/build.js      the build; the page shell is defined once, in shell()
scripts/corpus.js     builds llms.txt from the same pages and posts as the site
scripts/sync-agent.js pushes the corpus, prompt and guardrails to ElevenLabs — not part of the build
```

Anything marked generated is overwritten by `npm run build` — edit the source, not the output.

`marked` is the only dependency and runs at build time to turn Markdown into HTML;
none of it ships to the browser.
