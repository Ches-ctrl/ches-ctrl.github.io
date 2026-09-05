'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toText, buildCorpus } = require('./corpus.js');

const SITE = {
  name: 'Charlie Cheesman',
  url: 'https://www.charliecheesman.net',
  jobTitle: 'AI deployment strategist',
  description: 'Charlie Cheesman is an AI deployment strategist in London.',
  address: { addressLocality: 'London', addressCountry: 'GB' },
  sameAs: ['https://github.com/Ches-ctrl'],
  worksFor: [{ name: 'Moloqo', url: 'https://moloqo.com' }],
  alumniOf: [{ name: 'University of Oxford', url: 'https://www.ox.ac.uk' }],
  knowsAbout: ['AI strategy', 'AI governance'],
};

test('toText strips tags and keeps the words', () => {
  assert.equal(toText('<p>Hello <a href="/x">there</a></p>'), 'Hello there');
});

test('toText turns list items into dashed lines', () => {
  assert.equal(toText('<ul><li>One</li><li>Two</li></ul>'), '- One\n- Two');
});

test('toText decodes the entities the build emits', () => {
  assert.equal(toText('<p>Economics &amp; Management</p>'), 'Economics & Management');
});

test('toText drops script and style content entirely', () => {
  assert.equal(toText('<p>Keep</p><script>var drop = 1;</script>'), 'Keep');
});

test('toText collapses runs of whitespace and blank lines', () => {
  assert.equal(toText('<p>a</p>\n\n\n\n<p>b</p>'), 'a\n\nb');
});

test('toText separates adjacent inline elements', () => {
  assert.equal(
    toText('<li><a href="/x">Business Insider</a><span class="meta">Consulting</span></li>'),
    '- Business Insider Consulting'
  );
});

test('toText decodes numeric entities in both forms', () => {
  assert.equal(toText('<p>Michael O&#x27;Leary and O&#39;Brien</p>'), "Michael O'Leary and O'Brien");
});

test('toText decodes the named entities the site actually uses', () => {
  assert.equal(toText('<p>Sa&iuml;d &middot; Cr&egrave;me</p>'), 'Saïd · Crème');
});

test('toText leaves no entity residue', () => {
  var out = toText('<p>&iuml; &#x27; &#39; &middot; &amp; &nbsp; &hellip;</p>');
  assert.equal(/&[a-zA-Z]+;|&#x?[0-9a-fA-F]+;/.test(out), false, 'undecoded entity in: ' + out);
});

test('toText does not decode an escaped ampersand into its following entity', () => {
  assert.equal(toText('<p>write &amp;#x27; for an apostrophe</p>'), "write &#x27; for an apostrophe");
});

test('buildCorpus opens with the name, the description and the facts', () => {
  const out = buildCorpus({ site: SITE, pages: [], posts: [] });
  assert.match(out, /^# Charlie Cheesman\n/);
  assert.match(out, /> Charlie Cheesman is an AI deployment strategist in London\./);
  assert.match(out, /- Job title: AI deployment strategist/);
  assert.match(out, /- Location: London, GB/);
  assert.match(out, /- Works for: Moloqo \(https:\/\/moloqo\.com\)/);
  assert.match(out, /- Alumnus of: University of Oxford/);
  assert.match(out, /- Knows about: AI strategy, AI governance/);
});

test('buildCorpus renders each page with an absolute source URL', () => {
  const out = buildCorpus({
    site: SITE,
    pages: [{ label: 'Work', path: '/work/', description: 'How I work.', html: '<h1>Work</h1><p>AI strategy and roadmap.</p>' }],
    posts: [],
  });
  assert.match(out, /## Work/);
  assert.match(out, /Source: https:\/\/www\.charliecheesman\.net\/work\//);
  assert.match(out, /AI strategy and roadmap\./);
});

test('buildCorpus falls back to the description when a page has no body', () => {
  const out = buildCorpus({
    site: SITE,
    pages: [{ label: 'Home', path: '/', description: 'The index.', html: '' }],
    posts: [],
  });
  assert.match(out, /The index\./);
});

test('buildCorpus renders posts with their date and URL', () => {
  const out = buildCorpus({
    site: SITE,
    pages: [],
    posts: [{ slug: 'sample-post', title: 'Sample', date: '2026-01-02', html: '<p>Body text.</p>' }],
  });
  assert.match(out, /## Blog post: Sample/);
  assert.match(out, /Source: https:\/\/www\.charliecheesman\.net\/blog\/sample-post\//);
  assert.match(out, /Published: 2026-01-02/);
  assert.match(out, /Body text\./);
});

test('buildCorpus ends with exactly one newline', () => {
  const out = buildCorpus({ site: SITE, pages: [], posts: [] });
  assert.equal(out.endsWith('\n'), true);
  assert.equal(out.endsWith('\n\n'), false);
});
