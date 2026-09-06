/**
 * Finding and saving one brand's logo. Shared by the two scripts that need it:
 * `fetch-brand-logos.mjs` (the curated list) and `discover-brands.mjs` (the
 * list Gemini proposes).
 *
 * Three sources, tried in order of how likely each is to hold a real, legible
 * mark rather than a wordmark or a 16px thumbnail. A brand that comes back
 * with nothing usable gets no file, and the caller decides what that means.
 */
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Below this a logo is worse than the monogram it would replace. */
export const MIN_PX = 48;
/** A favicon is small; anything bigger is not one and is not worth shipping. */
export const MAX_BYTES = 60_000;

/** Must match slugFor() in BrandMark.tsx. */
export const slugFor = (name) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; MonevaAssetFetch/1.0)' };

const get = (url, ms = 15_000) =>
  fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(ms) });

/** Width and height straight out of a PNG's IHDR chunk. */
const pngSize = (buf) => {
  const isPng = buf.length > 24
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

/** An SVG is perfect at any size, so it needs no dimension test. */
const isSvg = (buf) => buf.slice(0, 400).toString('utf8').toLowerCase().includes('<svg');

const accept = (buf, ext) => {
  if (buf.length > MAX_BYTES) return { error: `${buf.length} bytes, too large` };
  if (ext === 'svg' || isSvg(buf)) return { buf, ext: 'svg', size: { w: 'vector', h: '' } };
  const size = pngSize(buf);
  if (!size) return { error: 'not a PNG or SVG' };
  if (size.w < MIN_PX) return { error: `only ${size.w}px` };
  return { buf, ext: 'png', size };
};

/** 1. The favicon service. Fast, and often enough. */
const fromFaviconService = async (domain) => {
  const res = await get(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  if (!res.ok) return { error: `HTTP ${res.status}` };
  return accept(Buffer.from(await res.arrayBuffer()), 'png');
};

/**
 * 2. An aggregator that often holds the brand's real vector mark.
 *
 * `fallback=false` matters: without it a miss returns a GENERATED letter
 * avatar, which would pass every check below and quietly replace the app's own
 * monogram with a worse one.
 */
const fromAggregator = async (domain) => {
  const res = await get(`https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`, 20_000);
  if (!res.ok) return { error: `aggregator HTTP ${res.status}` };
  return accept(Buffer.from(await res.arrayBuffer()), 'png');
};

/**
 * 3. The site's own declared icons - usually a 180px apple-touch-icon or an
 * SVG, published by the brand itself at the size the brand publishes it.
 */
const fromSiteHead = async (domain) => {
  const res = await get(`https://${domain}/`, 20_000);
  if (!res.ok) return { error: `homepage HTTP ${res.status}` };
  const html = (await res.text()).slice(0, 200_000);

  const candidates = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (/rel=["']([^"']+)["']/i.exec(tag) ?? [])[1]?.toLowerCase() ?? '';
    if (!/icon/.test(rel)) continue;
    const href = (/href=["']([^"']+)["']/i.exec(tag) ?? [])[1];
    if (!href) continue;
    const sizes = (/sizes=["'](\d+)x\d+["']/i.exec(tag) ?? [])[1];
    const rank = /\.svg(\?|$)/i.test(href) ? 10_000
      : sizes ? Number(sizes)
        : /apple-touch/.test(rel) ? 180 : 0;
    candidates.push({ href, rank });
  }
  candidates.push({ href: '/apple-touch-icon.png', rank: 1 });
  candidates.push({ href: '/apple-touch-icon-precomposed.png', rank: 0 });
  candidates.sort((a, b) => b.rank - a.rank);

  for (const { href } of candidates.slice(0, 5)) {
    try {
      const url = new URL(href, `https://${domain}/`).href;
      const iconRes = await get(url);
      if (!iconRes.ok) continue;
      const buf = Buffer.from(await iconRes.arrayBuffer());
      const ok = accept(buf, /\.svg(\?|$)/i.test(url) ? 'svg' : 'png');
      if (!ok.error) return ok;
    } catch {
      /* try the next candidate */
    }
  }
  return { error: 'no icon big enough on the site' };
};

/**
 * Brands where the aggregator has the WORDMARK and the favicon has the icon.
 * Size is not the only thing that matters: "RBL BANK" set in type is a fine
 * vector and completely illegible in a 40px tile.
 */
const PREFER_FAVICON = new Set(['rblbank.com', 'indusind.com']);

/** The best logo available for a domain, or `{error}` if there is none. */
export const fetchLogo = async (domain) => {
  const errors = [];
  const order = PREFER_FAVICON.has(domain)
    ? [fromFaviconService, fromAggregator, fromSiteHead]
    : [fromAggregator, fromFaviconService, fromSiteHead];
  for (const source of order) {
    const result = await source(domain).catch((e) => ({ error: e.message }));
    if (!result.error) return result;
    errors.push(result.error);
  }
  return { error: errors.join('; ') };
};

/**
 * Write a logo, removing any earlier file for the same brand in the other
 * format. Without that, a run upgrading a brand from PNG to vector leaves both
 * on disk and the component's glob loads the pair.
 */
export const saveLogo = async (outDir, name, result) => {
  const slug = slugFor(name);
  for (const ext of ['png', 'svg']) {
    if (ext !== result.ext) await rm(join(outDir, `${slug}.${ext}`), { force: true });
  }
  await writeFile(join(outDir, `${slug}.${result.ext}`), result.buf);
  return slug;
};
