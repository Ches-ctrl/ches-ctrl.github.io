#!/usr/bin/env node
/**
 * Scans blog/posts/*.md and writes blog/list.json.
 * Reads YAML frontmatter for title and date; filename is used as slug/file.
 */

const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.join(__dirname, '..', 'blog', 'posts');
const LIST_PATH = path.join(__dirname, '..', 'blog', 'list.json');

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const front = match[1];
  const out = {};
  front.split('\n').forEach((line) => {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
  });
  return out;
}

let files = [];
try {
  files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
} catch (e) {
  console.error('No blog/posts directory or no .md files.');
  process.exit(1);
}

const posts = files
  .map((file) => {
    const filePath = path.join(POSTS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const front = parseFrontmatter(content);
    const slug = file.replace(/\.md$/, '');
    return {
      title: front.title || slug,
      slug,
      file,
      date: front.date || null,
    };
  })
  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

fs.writeFileSync(LIST_PATH, JSON.stringify(posts, null, 2), 'utf8');
console.log('Wrote', LIST_PATH, 'with', posts.length, 'posts.');
