// Cloudflare Worker that serves the static site and handles SPA routing
// for the React app at /web/*.
//
// Without this, /web/login returns 404 because there is no login.html file.
// The assets binding tries the requested path first; only on 404 does it fall
// back to /web/index.html so the React router can take over.
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith('/web/')) {
        let asset;
        try {
          asset = await env.ASSETS.fetch(request);
        } catch (e1) {
          asset = null;
        }
        if (asset && asset.status !== 404) return asset;

        const shellUrl = new URL('/web/index.html', url.origin).href;
        try {
          return await env.ASSETS.fetch(new Request(shellUrl));
        } catch (e2) {
          return new Response(`Shell fetch failed: ${e2.message} | shellUrl=${shellUrl}`, { status: 200 });
        }
      }

      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(`Worker error: ${e.message}`, { status: 200 });
    }
  },
};
