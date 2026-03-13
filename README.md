# Personal site (GitHub Pages)

Minimal single-page site with Tailwind, feature flags, and a markdown blog. Inspired by Patrick Collison and Paul Graham.

## Setup

1. **Edit `config.js`**  
   Set `siteName` and toggle `features` to show/hide sections (About, Blog, Ideas, Contact, Bookshelf, Tech Stack, Links).

2. **Edit `index.html`**  
   Update the content in each `<section>` (About, Ideas, Contact, Bookshelf, Tech Stack, Links). Replace placeholder links and text.

3. **Local preview**  
   Open `index.html` in a browser, or use a static server (e.g. `npx serve .`) so the blog list and posts load correctly.

## Blog

- **Add a post:** Create a file in `blog/posts/`, e.g. `blog/posts/2025-03-13-hello.md`.
- **Frontmatter (optional):**
  ```yaml
  ---
  title: My post title
  date: 2025-03-13
  ---
  ```
- **Refresh the blog list:**  
  Run:
  ```bash
  node scripts/generate-blog-list.js
  ```
  This overwrites `blog/list.json` from all `.md` files in `blog/posts/`. Commit the updated `blog/list.json` and new post.

## GitHub Pages

- **User/org site:** Repo name must be `username.github.io`. Push to `main`; the site is at `https://username.github.io`.
- **Project site:** In the repo **Settings → Pages**, set source to the default branch and root (or `/docs` if you put the site there).

Use relative paths (already in the project); the site works at the repo root.

## Feature flags

In `config.js`, set any of these to `false` to hide that section and its nav link:

- `about`, `blog`, `ideas`, `contact`, `bookshelf`, `techStack`, `links`

## Tech

- Static HTML + Tailwind (CDN) + vanilla JS
- Blog: markdown in `blog/posts/`, list in `blog/list.json`, client-side render with [marked](https://marked.js.org/)
