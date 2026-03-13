/**
 * Site config and feature flags.
 * Set any section to false to hide it from the nav and page.
 */
const SITE_CONFIG = {
  siteName: "Your Name",
  siteTitle: "Your Name",

  // Feature flags: set to false to hide a section
  features: {
    about: true,
    blog: true,
    ideas: true,
    contact: true,
    bookshelf: true,
    techStack: true,
    links: true,
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
