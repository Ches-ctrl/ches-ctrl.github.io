/**
 * Site config and feature flags.
 * Set any section to false to hide it from the nav and page.
 */
const SITE_CONFIG = {
  siteName: "Charlie Cheesman",
  siteTitle: "Charlie Cheesman",

  // Feature flags: set to false to hide a section
  features: {
    about: true,
    blog: false,
    ideas: false,
    contact: false,
    bookshelf: false,
    techStack: false,
    links: false,
  },

  // Optional: link labels (defaults to section key)
  navLabels: {
    about: "About",
    blog: "Blog",
    ideas: "Ideas",
    contact: "Contact",
    bookshelf: "Bookshelf",
    techStack: "Tech Stack",
    links: "Links",
  },
};
