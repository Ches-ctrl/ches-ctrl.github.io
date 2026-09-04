#!/usr/bin/env node
/**
 * Static build. One page shell, defined once, in `shell()` below.
 *
 *   pages/<name>.html      -> /<name>/index.html   (content fragments, no boilerplate)
 *   pages/index.html       -> /index.html
 *   blog/posts/<slug>.md   -> /blog/<slug>/index.html
 *
 * Output is plain HTML: no client-side rendering, no webfonts, no framework.
 * Run `npm run build` after editing anything, then commit the generated files.
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'));

marked.setOptions({ mangle: false, headerIds: false });

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SITE_URL = SITE.url.replace(/\/$/, '');
/** Absolute URL for a root-relative path. Required by Open Graph, sitemaps and JSON-LD alike. */
const abs = (p) => `${SITE_URL}${p}`;

/** Collapse to a single line and clip to a length search engines will actually show. */
function clip(text, max = 155) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, t.lastIndexOf(' ', max - 1)).replace(/[,;:.\-]$/, '') + '…';
}

function write(relPath, html) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html, 'utf8');
}

// ---------------------------------------------------------------- the shell

/**
 * The only place page boilerplate is defined.
 *
 * `currentPath` highlights the nav; `url` is the page's own canonical address -
 * they differ for blog posts, which live at /blog/<slug>/ but highlight Blog.
 *
 * The `jsonLd` block is data, not behaviour: browsers parse it and never execute
 * it, so the no-JavaScript rule still holds and nothing is added to the critical
 * path. It is emitted only where it earns its place - the home page and posts.
 */
function shell({ title, description, currentPath, url, body, source = 'pages/', ogType = 'website', jsonLd = null, noindex = false }) {
  const nav = SITE.nav
    .map((n) => {
      const current = n.path === currentPath ? ' class="current"' : '';
      // links off-site open in a new tab, so the site itself is never navigated away from
      const external = /^https?:\/\//.test(n.path) ? ' target="_blank" rel="noopener"' : '';
      return `      <a href="${n.path}"${current}${external}>${esc(n.label)}</a>`;
    })
    .join('\n');

  const desc = clip(description || SITE.description);
  const canonical = abs(url || currentPath);
  const ogImage = abs(SITE.image);
  // Twitter reads og:title/og:description when the twitter:* pair is absent, so
  // the head below emits only the two tags that have no Open Graph equivalent.
  const ld = jsonLd
    ? `\n<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  // Google Analytics. This is the one thing on the site that fetches from a third
  // party and the one script that actually executes - see the note in CLAUDE.md.
  // `async` is load-bearing: it keeps gtag.js off the critical path so first paint
  // is still the HTML and the stylesheet alone. Set `analytics` to "" to remove it
  // everywhere; there is no per-page opt-out by design, since a partial measurement
  // is worse than none.
  const ga = SITE.analytics
    ? `
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${SITE.analytics}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${SITE.analytics}');
</script>`
    : '';

  return `<!-- GENERATED FILE - DO NOT EDIT.
     Your changes here are overwritten by the next \`npm run build\`.
     Edit the source instead: ${esc(source)} -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">${noindex ? '\n<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(SITE.name)} — ${esc(SITE.jobTitle)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:creator" content="@charliecheesma1">
<link rel="stylesheet" href="/static/style.css">
<link rel="alternate" type="application/atom+xml" title="${esc(SITE.name)}" href="/feed.xml">${ld}${ga}
</head>
<body>
<div class="page">
  <aside>
    <div class="accent"></div>
    <p class="name"><a href="/">${esc(SITE.name)}</a></p>
    <nav>
${nav}
    </nav>
  </aside>
  <main>
${body}
  </main>
</div>
</body>
</html>
`;
}

/**
 * Inline logo images as data URIs.
 *
 * Each logo was a separate request that arrived after the HTML and CSS, so the
 * images popped in a beat late and shifted the layout as they did - a visible
 * flash on every load. Inlining puts them in the document itself: no extra
 * requests, nothing to arrive late. Explicit width/height is set too, so the
 * space is reserved even before decode.
 */
function inlineLogos(html) {
  return html.replace(/<img src="(\/static\/logos\/[^"]+)"([^>]*)>/g, (whole, src, rest) => {
    const file = path.join(ROOT, src.replace(/^\//, ''));
    if (!fs.existsSync(file)) return whole;
    const b64 = fs.readFileSync(file).toString('base64');
    const type = src.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const dims = /width=/.test(rest) ? '' : ' width="26" height="26"';
    return `<img src="data:${type};base64,${b64}"${rest}${dims}>`;
  });
}

/**
 * Make every off-site link open in a new tab.
 *
 * Applied at build time to page bodies and rendered posts, so it covers links
 * written in HTML fragments and links written in Markdown alike - there is no
 * per-link attribute to remember. Same-site and relative links are untouched,
 * and any link that already declares a target is left as the author wrote it.
 */
function externalLinks(html) {
  const host = new URL(SITE.url).host;
  return html.replace(/<a ([^>]*href="(https?:\/\/[^"]+)"[^>]*)>/g, (whole, attrs, href) => {
    if (/\btarget=/.test(attrs)) return whole;
    let linkHost;
    try { linkHost = new URL(href).host; } catch { return whole; }
    if (linkHost === host) return whole;
    return `<a ${attrs} target="_blank" rel="noopener">`;
  });
}

/** Strip TODO notes from output. They are working notes in pages/, not for the published source. */
function stripNotes(html) {
  return html.replace(/\n?[ \t]*<!--\s*TODO\(charlie\)[\s\S]*?-->/g, '');
}

// ---------------------------------------------------------------- pages

/**
 * Schema.org ProfilePage for the home page.
 *
 * This is the site's one entity claim: it ties the domain to the person, and
 * `sameAs` is what lets a search engine connect it to the profiles elsewhere.
 * All of it is kept in site.json so the facts live with the rest of them.
 *
 * The Person is wrapped in ProfilePage rather than emitted bare because Google's
 * profile-page treatment only triggers on the wrapper - a top-level Person still
 * feeds entity resolution, but earns no SERP feature of its own.
 *
 * `sameAs` holds only alternate representations of the person himself. The
 * organisations he is affiliated with are a different claim and belong in
 * `worksFor`. `alumniOf` is Oxford alone, deliberately: the about page says he
 * dropped out of Durham, so listing it would be a false claim in structured data.
 */
function personLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      '@id': abs('/') + '#person',
      name: SITE.name,
      url: abs('/'),
      image: abs(SITE.image),
      jobTitle: SITE.jobTitle,
      description: SITE.description,
      sameAs: SITE.sameAs,
      worksFor: SITE.worksFor.map((o) => ({ '@type': 'Organization', name: o.name, url: o.url })),
      alumniOf: SITE.alumniOf.map((o) => ({ '@type': 'CollegeOrUniversity', name: o.name, url: o.url })),
      knowsAbout: SITE.knowsAbout,
    },
  };
}

function buildPages() {
  // Home
  write('index.html', shell({
    title: SITE.name,
    description: SITE.description,
    currentPath: '/',
    url: '/',
    body: stripNotes(externalLinks(inlineLogos(read('pages/index.html').trimEnd()))),
    source: 'pages/index.html',
    jsonLd: personLd(),
  }));

  // 404. GitHub Pages serves this for any unmatched path, with a real 404 status -
  // but /404.html fetched directly answers 200, so it is marked noindex to keep
  // the page itself out of the index.
  write('404.html', shell({
    title: `Not found · ${SITE.name}`,
    description: 'That page does not exist.',
    currentPath: '',
    url: '/404.html',
    body: stripNotes(read('pages/404.html').trimEnd()),
    source: 'pages/404.html',
    noindex: true,
  }));

  // Section pages
  SITE.nav
    .filter((n) => n.page)
    .forEach((n) => {
      const dir = n.path.replace(/^\/|\/$/g, '');
      write(
        `${dir}/index.html`,
        shell({
          title: `${n.label} · ${SITE.name}`,
          description: n.description,
          currentPath: n.path,
          url: n.path,
          body: stripNotes(externalLinks(inlineLogos(read(`pages/${n.page}.html`).trimEnd()))),
          source: `pages/${n.page}.html`,
        })
      );
    });

  return 2 + SITE.nav.filter((n) => n.page).length;
}

// ---------------------------------------------------------------- blog

/** First paragraph of a rendered post, as plain text - the description fallback. */
function firstParagraph(html) {
  const m = html.match(/<p>([\s\S]*?)<\/p>/);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
}

/** Strip surrounding quotes only when they actually pair up. */
function stripQuotes(v) {
  const m = v.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : v;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  m[1].split('\n').forEach((line) => {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) data[kv[1]] = stripQuotes(kv[2].trim());
  });
  return { data, body: raw.slice(m[0].length) };
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function readPosts() {
  const dir = path.join(ROOT, 'blog', 'posts');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
      const html = marked.parse(body);
      return {
        slug: file.replace(/\.md$/, ''),
        title: data.title || file.replace(/\.md$/, ''),
        date: data.date || null,
        draft: String(data.draft || '').toLowerCase() === 'true',
        // `description` in the frontmatter wins; otherwise the opening paragraph,
        // which is what a reader would have seen as the summary anyway.
        description: data.description || firstParagraph(html),
        html,
      };
    })
    .filter((p) => !p.draft)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function buildBlog(posts) {
  const blogDir = path.join(ROOT, 'blog');
  const keep = new Set(posts.map((p) => p.slug).concat(['posts']));

  // Drop pages for posts that no longer exist (renamed, deleted, or newly drafted).
  fs.readdirSync(blogDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !keep.has(e.name))
    .forEach((e) => fs.rmSync(path.join(blogDir, e.name), { recursive: true, force: true }));

  posts.forEach((p) => {
    const body =
      `<article>\n<h1>${esc(p.title)}</h1>\n` +
      (p.date ? `<p class="byline">${esc(formatDate(p.date))}</p>\n` : '') +
      externalLinks(p.html) +
      `</article>\n<p class="more"><a href="/blog/">← All posts</a></p>`;
    const url = `/blog/${p.slug}/`;
    write(`blog/${p.slug}/index.html`, shell({
      title: `${p.title} · ${SITE.name}`,
      description: p.description,
      currentPath: '/blog/',
      url,
      body,
      source: `blog/posts/${p.slug}.md`,
      ogType: 'article',
      // Two nodes, so a @graph. The breadcrumb is one of the few remaining types
      // that visibly changes the result - a path trail in place of a raw URL.
      // The author Person stays inline rather than referencing the home page's
      // #person @id: Google does not reliably stitch @id across separate pages.
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'BlogPosting',
            headline: p.title,
            description: clip(p.description),
            image: abs(SITE.image),
            url: abs(url),
            mainEntityOfPage: abs(url),
            ...(p.date ? { datePublished: p.date, dateModified: p.date } : {}),
            author: { '@type': 'Person', name: SITE.name, url: abs('/') },
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: SITE.name, item: abs('/') },
              { '@type': 'ListItem', position: 2, name: 'Blog', item: abs('/blog/') },
              { '@type': 'ListItem', position: 3, name: p.title, item: abs(url) },
            ],
          },
        ],
      },
    }));
  });

  const list = posts.length
    ? '<ul class="entries">\n' +
      posts
        .map(
          (p) =>
            `  <li><a href="/blog/${p.slug}/">${esc(p.title)}</a>` +
            (p.date ? `<span class="meta">${esc(formatDate(p.date))}</span>` : '') +
            '</li>'
        )
        .join('\n') +
      '\n</ul>'
    : '<p class="lede">Nothing published yet.</p>';

  // The feed is declared in every page's <head> for readers that autodiscover it;
  // this is the visible link, for people who subscribe by hand.
  const feed = '<p>You can find an RSS / Atom feed of my blogs <a href="/feed.xml">here</a>.</p>';

  write('blog/index.html', shell({
    title: `Blog · ${SITE.name}`,
    description: SITE.nav.find((n) => n.path === '/blog/').description,
    currentPath: '/blog/',
    url: '/blog/',
    body: `<h1>Blog</h1>\n${feed}\n${list}`,
    source: 'blog/posts/ (generated index)',
  }));

  return posts.length;
}

// ---------------------------------------------------------------- feed

/** Atom 1.0. Absolute URLs throughout, as the spec requires. */
function buildFeed(posts) {
  const site = SITE.url.replace(/\/$/, '');
  const stamp = (iso) => new Date((iso || '1970-01-01') + 'T00:00:00Z').toISOString();
  const updated = posts.length ? stamp(posts[0].date) : new Date().toISOString();

  const entries = posts
    .map((p) => {
      const url = `${site}/blog/${p.slug}/`;
      return `  <entry>
    <title>${esc(p.title)}</title>
    <link href="${url}"/>
    <id>${url}</id>
    <updated>${stamp(p.date)}</updated>
    <content type="html">${esc(p.html)}</content>
  </entry>`;
    })
    .join('\n');

  write(
    'feed.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(SITE.name)}</title>
  <subtitle>Writing by ${esc(SITE.name)}</subtitle>
  <link href="${site}/"/>
  <link rel="self" type="application/atom+xml" href="${site}/feed.xml"/>
  <id>${site}/</id>
  <updated>${updated}</updated>
  <author><name>${esc(SITE.name)}</name></author>
${entries}
</feed>
`
  );
  return posts.length;
}

// ---------------------------------------------------------------- sitemap

/**
 * sitemap.xml and robots.txt, from the same page list the site is built from,
 * so a page can never be published without also being announced. The 404 is the
 * one generated page left out - it is marked noindex.
 */
function buildSitemap(posts) {
  const urls = [
    { loc: '/' },
    ...SITE.nav.filter((n) => n.page).map((n) => ({ loc: n.path })),
    { loc: '/blog/', lastmod: posts.length ? posts[0].date : null },
    ...posts.map((p) => ({ loc: `/blog/${p.slug}/`, lastmod: p.date })),
  ];

  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url>\n    <loc>${abs(u.loc)}</loc>` +
      (u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '') +
      '\n  </url>'
  )
  .join('\n')}
</urlset>
`
  );

  // No Disallow for /404.html: robots.txt and noindex do not stack. Blocking the
  // crawl would stop Google ever reading the noindex, leaving the URL eligible to
  // appear bare and snippet-less. The meta tag alone is what actually excludes it.
  write('robots.txt', `User-agent: *
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`);

  return urls.length;
}

// ---------------------------------------------------------------- run

const pageCount = buildPages();
const posts = readPosts();
const postCount = buildBlog(posts);
buildFeed(posts);
const urlCount = buildSitemap(posts);

console.log(
  `${pageCount} pages, ${postCount} post${postCount === 1 ? '' : 's'}, feed.xml, sitemap.xml (${urlCount} urls), robots.txt`
);
