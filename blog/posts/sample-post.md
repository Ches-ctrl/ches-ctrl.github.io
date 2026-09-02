---
title: Sample post
date: 2026-09-02
---

This is a sample post so you can see how the format renders. Delete the file and run
`npm run build` when you want it gone.

Everything above the second `---` is frontmatter. `title` sets the heading and the browser
tab, `date` sets the byline and the sort order on the blog index. Add `draft: true` to keep
a post out of the build while you work on it.

## Headings become sections

Body text is ordinary Markdown. You get **bold**, *italic*, `inline code`, and
[links](https://patrickcollison.com) without thinking about it.

Lists work as expected:

- One item
- Another item
- A third

And numbered ones:

1. First
2. Second

> Block quotes look like this — useful for pulling out a line from something you're
> responding to.

Code blocks keep their whitespace:

```bash
npm run build
git add -A && git commit -m "post: sample" && git push
```

---

A horizontal rule gives you a section break when a heading would be too heavy.

The filename becomes the URL. This file is `blog/posts/sample-post.md`, so it is served at
`/blog/sample-post/` — a real page, linkable and indexable, with the text in the HTML.
