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

function write(relPath, html) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html, 'utf8');
}

// ---------------------------------------------------------------- the shell

/** The only place page boilerplate is defined. */
function shell({ title, currentPath, body, source = 'pages/' }) {
  const nav = SITE.nav
    .map((n) => {
      const current = n.path === currentPath ? ' class="current"' : '';
      // links off-site open in a new tab, so the site itself is never navigated away from
      const external = /^https?:\/\//.test(n.path) ? ' target="_blank" rel="noopener"' : '';
      return `      <a href="${n.path}"${current}${external}>${esc(n.label)}</a>`;
    })
    .join('\n');

  return `<!-- GENERATED FILE - DO NOT EDIT.
     Your changes here are overwritten by the next \`npm run build\`.
     Edit the source instead: ${esc(source)} -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/style.css">
<link rel="alternate" type="application/atom+xml" title="${esc(SITE.name)}" href="/feed.xml">
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

// ---------------------------------------------------------------- pages

function buildPages() {
  // Home
  write('index.html', shell({ title: SITE.name, currentPath: '/', body: inlineLogos(read('pages/index.html').trimEnd()), source: 'pages/index.html' }));

  // Section pages
  SITE.nav
    .filter((n) => n.page)
    .forEach((n) => {
      const dir = n.path.replace(/^\/|\/$/g, '');
      write(
        `${dir}/index.html`,
        shell({
          title: `${n.label} · ${SITE.name}`,
          currentPath: n.path,
          body: inlineLogos(read(`pages/${n.page}.html`).trimEnd()),
          source: `pages/${n.page}.html`,
        })
      );
    });

  return 1 + SITE.nav.filter((n) => n.page).length;
}

// ---------------------------------------------------------------- blog

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
      return {
        slug: file.replace(/\.md$/, ''),
        title: data.title || file.replace(/\.md$/, ''),
        date: data.date || null,
        draft: String(data.draft || '').toLowerCase() === 'true',
        html: marked.parse(body),
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
      p.html +
      `</article>\n<p class="more"><a href="/blog/">← All posts</a></p>`;
    write(`blog/${p.slug}/index.html`, shell({ title: `${p.title} · ${SITE.name}`, currentPath: '/blog/', body, source: `blog/posts/${p.slug}.md` }));
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

  write('blog/index.html', shell({ title: `Blog · ${SITE.name}`, currentPath: '/blog/', body: `<h1>Blog</h1>\n${list}`, source: 'blog/posts/ (generated index)' }));

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

// ---------------------------------------------------------------- run

const pageCount = buildPages();
const posts = readPosts();
const postCount = buildBlog(posts);
buildFeed(posts);

console.log(`${pageCount} pages, ${postCount} post${postCount === 1 ? '' : 's'}, feed.xml`);
