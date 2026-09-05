'use strict';
/**
 * The site as plain text, for the voice agent's knowledge base.
 *
 * Pure functions, no I/O: the build passes in what it has already read, which is
 * what makes this testable without running a build. The output ships as /llms.txt
 * and is pushed to the platform by scripts/sync-agent.js.
 */

/**
 * Named HTML entities the site's markdown and hand-written fragments actually produce
 * - accented names (Saïd, Crème), punctuation (·, –, —, …, curly quotes) and the ASCII
 * entities markdown escapes by habit. Deliberately excludes `amp`: that one is decoded
 * separately, and last - see the ordering note on `toText` below. An entity outside
 * this list is left exactly as written rather than guessed at.
 */
const NAMED_ENTITIES = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  middot: '·',
  iuml: 'ï',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  ccedil: 'ç',
  ntilde: 'ñ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

/**
 * An HTML fragment as readable prose. Block tags become line breaks; list items keep
 * their bullet.
 *
 * The tag-boundary pass matters more than it looks: an <a> immediately followed by a
 * <span> with no whitespace between them in the source (as every `.entries` list on
 * the site is written) collapses to one run-together word once the tags are gone -
 * "Business InsiderConsulting" instead of two. It only inserts a space where two tags
 * are adjacent, so it never touches real prose; the whitespace-collapsing passes below
 * absorb the extra space anywhere it isn't needed.
 *
 * Entity decoding happens after tags are stripped, not before - decoding first would
 * let a literal "&lt;p&gt;" turn into a real tag and get stripped along with the rest.
 * Within the decode itself, numeric entities go first and `&amp;` goes last: a source
 * that contains the literal six characters "&amp;#x27;" means the text "&#x27;", not
 * an apostrophe. Decoding `&amp;` before the numeric pass would unescape it to
 * "&#x27;" and then that would decode again to "'" - silently turning quoted-out
 * markup into real punctuation. Numeric-first, amp-last means it only ever unescapes
 * once.
 */
function toText(html) {
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/>(?=<)/g, '> ')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|h4|li|div|article|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] || whole)
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The whole site as one document.
 *
 * The facts block up front repeats what site.json already asserts in JSON-LD, so the
 * agent has them stated plainly rather than having to infer them from prose. The pages
 * are written in Charlie's first person; agent/prompt.md is what converts that to the
 * third person the agent speaks in.
 */
function buildCorpus({ site, pages, posts }) {
  const url = String(site.url).replace(/\/$/, '');
  const out = [];

  out.push(`# ${site.name}`, '');
  out.push(`> ${site.description}`, '');
  out.push(`The full text of ${url}, the personal site of ${site.name}.`);
  out.push('It is written in the first person, by him.', '');

  out.push('## Facts', '');
  out.push(`- Job title: ${site.jobTitle}`);
  out.push(`- Location: ${site.address.addressLocality}, ${site.address.addressCountry}`);
  out.push(`- Works for: ${site.worksFor.map((o) => `${o.name} (${o.url})`).join(', ')}`);
  out.push(`- Alumnus of: ${site.alumniOf.map((o) => o.name).join(', ')}`);
  out.push(`- Knows about: ${site.knowsAbout.join(', ')}`);
  out.push(`- Elsewhere: ${site.sameAs.join(', ')}`, '');

  pages.forEach((p) => {
    out.push(`## ${p.label}`, '');
    out.push(`Source: ${url}${p.path}`, '');
    out.push(toText(p.html) || p.description, '');
  });

  posts.forEach((p) => {
    out.push(`## Blog post: ${p.title}`, '');
    out.push(`Source: ${url}/blog/${p.slug}/`);
    if (p.date) out.push(`Published: ${p.date}`);
    out.push('', toText(p.html), '');
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { toText, buildCorpus };
