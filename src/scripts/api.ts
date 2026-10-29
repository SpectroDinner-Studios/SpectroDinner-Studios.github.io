// The GitHub Pages copy of the site has no backend of its own, so it talks to
// the Cloudflare one (which allows that origin). Both copies then share the
// same reviews, settings and admin panel.
const API_BASE = location.hostname.endsWith(".github.io") ? "https://spectrodinner-studios.pages.dev" : "";

export const apiUrl = (path: string) => API_BASE + path;
