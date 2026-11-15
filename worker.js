// Cloudflare Worker that serves the static site and handles SPA routing
// for the React app at /web/*.
//
// Without this, /web/login returns 404 because there is no login.html file.
// The assets binding tries the requested path first; only on 404 does it fall
// back to /web/index.html so the React router can take over.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/web/')) {
      // Try the real asset (index.html, assets/*, favicon.svg, …).
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;

      // No file found — hand off to the React app shell.
      const shell = new URL('/web/index.html', url.origin);
      return env.ASSETS.fetch(new Request(shell.href, { method: 'GET' }));
    }

    return env.ASSETS.fetch(request);
  },
};
