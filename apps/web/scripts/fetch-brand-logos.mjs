/**
 * Fetches each brand's own logo once, at build time, into src/assets/brands.
 *
 * Build time rather than runtime, deliberately: asking a logo service for
 * "hdfcbank.com" every time the accounts list paints would tell a third party
 * which banks the user holds, and would leave the list blank offline. Fetched
 * once, the images ship with the app and neither is true.
 *
 * Quality is not uniform. Some brands only have a 16px favicon indexed, which
 * upscaled to a 38px tile is a smear - worse than no logo. Anything under
 * MIN_PX is rejected and that brand keeps its monogram, so the list is a mix
 * of real logos and clean initials rather than a mix of real logos and mush.
 *
 *   node scripts/fetch-brand-logos.mjs
 *
 * Re-runnable: it overwrites what it can improve and leaves the rest.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'brands');

/** Below this, the logo is worse than the monogram it would replace. */
const MIN_PX = 48;
/** A favicon is small; anything larger is not one, and is not worth shipping. */
const MAX_BYTES = 60_000;

/** Brand name -> the company's own domain. */
const DOMAINS = {
  'HDFC Bank': 'hdfcbank.com',
  'State Bank of India': 'bank.sbi',
  'ICICI Bank': 'icicibank.com',
  'Axis Bank': 'axisbank.com',
  'Kotak Mahindra Bank': 'kotak.com',
  'Punjab National Bank': 'netpnb.com',
  'Bank of Baroda': 'bankofbaroda.in',
  'Canara Bank': 'canarabank.com',
  'Union Bank of India': 'unionbankonline.co.in',
  'IndusInd Bank': 'indusind.com',
  'IDFC First Bank': 'idfcfirstbank.com',
  // 'Yes Bank': only a 16px favicon and a wordmark vector exist - both
  // worse than the "YB" monogram, so it is deliberately not fetched.
  'Federal Bank': 'federalbank.co.in',
  'RBL Bank': 'rblbank.com',
  'Bank of India': 'bankofindia.co.in',
  'Indian Bank': 'indianbank.net.in',
  'AU Small Finance Bank': 'aubank.in',
  'Bandhan Bank': 'bandhanbank.com',

  Paytm: 'paytm.com',
  PhonePe: 'phonepe.com',
  'Google Pay': 'pay.google.com',
  'Amazon Pay': 'amazon.in',
  Mobikwik: 'www.mobikwik.com',

  Swiggy: 'swiggy.com',
  'Swiggy Instamart': 'swiggy.com',
  Zomato: 'zomato.com',
  Blinkit: 'blinkit.com',
  Zepto: 'zeptonow.com',
  BigBasket: 'www.bigbasket.com',
  Dunzo: 'www.dunzo.com',
  Amazon: 'amazon.in',
  Flipkart: 'flipkart.com',
  Myntra: 'myntra.com',
  Meesho: 'meesho.com',
  Nykaa: 'nykaa.com',
  Uber: 'uber.com',
  Ola: 'www.olacabs.com',
  Rapido: 'rapido.bike',
  IRCTC: 'www.irctc.co.in',
  MakeMyTrip: 'makemytrip.com',
  Netflix: 'netflix.com',
  Spotify: 'spotify.com',
  BookMyShow: 'bookmyshow.com',
  Jio: 'jio.com',
  Airtel: 'airtel.in',
  Vi: 'myvi.in',
  'Tata Play': 'tataplay.com',
  'Apollo Pharmacy': 'apollopharmacy.in',
  PharmEasy: 'pharmeasy.in',
  Practo: 'practo.com',

  // The long tail. These carry no curated colour in brandMark.ts - the
  // generated hue covers them - so all that is needed here is a domain.
  Dominos: 'dominos.co.in',
  'Pizza Hut': 'pizzahut.co.in',
  McDonalds: 'mcdelivery.co.in',
  KFC: 'kfc.co.in',
  'Burger King': 'burgerking.in',
  Starbucks: 'starbucks.in',
  'Barbeque Nation': 'barbequenation.com',
  Haldirams: 'haldirams.com',
  Chaayos: 'chaayos.com',
  'Third Wave Coffee': 'thirdwavecoffee.in',
  Faasos: 'faasos.com',
  Box8: 'box8.in',
  EatSure: 'eatsure.com',
  Behrouz: 'behrouzbiryani.com',
  DMart: 'dmart.in',
  JioMart: 'jiomart.com',
  Licious: 'licious.in',
  'Country Delight': 'countrydelight.in',
  Milkbasket: 'milkbasket.com',
  Spencers: 'spencers.in',
  Ajio: 'ajio.com',
  'Tata Cliq': 'tatacliq.com',
  Snapdeal: 'snapdeal.com',
  Croma: 'croma.com',
  'Reliance Digital': 'reliancedigital.in',
  Decathlon: 'decathlon.in',
  Pepperfry: 'pepperfry.com',
  'Urban Ladder': 'urbanladder.com',
  Lenskart: 'lenskart.com',
  Tanishq: 'tanishq.co.in',
  FirstCry: 'firstcry.com',
  Purplle: 'purplle.com',
  IKEA: 'ikea.com',
  Goibibo: 'goibibo.com',
  Cleartrip: 'cleartrip.com',
  Yatra: 'yatra.com',
  Ixigo: 'ixigo.com',
  EaseMyTrip: 'easemytrip.com',
  Indigo: 'goindigo.in',
  SpiceJet: 'spicejet.com',
  'Air India': 'airindia.com',
  Vistara: 'airvistara.com',
  Zoomcar: 'zoomcar.com',
  RedBus: 'redbus.in',
  Oyo: 'oyorooms.com',
  Hotstar: 'hotstar.com',
  SonyLIV: 'sonyliv.com',
  Zee5: 'zee5.com',
  JioCinema: 'jiocinema.com',
  Audible: 'audible.in',
  'Tata 1mg': '1mg.com',
  Netmeds: 'netmeds.com',
  Cultfit: 'cult.fit',
  HealthifyMe: 'healthifyme.com',
  MedPlus: 'medplusmart.com',
  Byjus: 'byjus.com',
  Vedantu: 'vedantu.com',
  Unacademy: 'unacademy.com',
  Upgrad: 'upgrad.com',
  Groww: 'groww.in',
  Zerodha: 'zerodha.com',
  Upstox: 'upstox.com',
  'Angel One': 'angelone.in',
  'Indian Oil': 'iocl.com',
  'Bharat Petroleum': 'bharatpetroleum.in',
  'Tata Power': 'tatapower.com',
  'Adani Electricity': 'adanielectricity.com',
  BSNL: 'bsnl.co.in',
};

/** The slug BrandMark looks a logo up by. Must match slugFor() there. */
const slugFor = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Width and height straight out of a PNG's IHDR chunk. */
const pngSize = (buf) => {
  const isPng = buf.length > 24
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (!isPng) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; MonevaAssetFetch/1.0)' };

const get = async (url, ms = 15_000) =>
  fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(ms) });

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
 * 2. The site's own declared icons.
 *
 * Where the favicon service only has a 16px thumbnail, the site itself
 * usually declares a 180px apple-touch-icon or an SVG. This reads the
 * homepage, takes the largest icon it names, and fetches that - the brand's
 * own asset, at the size the brand publishes it.
 */
const fromSiteHead = async (domain) => {
  const res = await get(`https://${domain}/`, 20_000);
  if (!res.ok) return { error: `homepage HTTP ${res.status}` };
  const html = (await res.text()).slice(0, 200_000);

  const candidates = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) ?? []) {
    const rel = (/rel=["']([^"']+)["']/i.exec(tag) ?? [])[1]?.toLowerCase() ?? '';
    if (!/icon/.test(rel)) continue;
    const href = (/href=["']([^"']+)["']/i.exec(tag) ?? [])[1];
    if (!href) continue;
    const sizes = (/sizes=["'](\d+)x\d+["']/i.exec(tag) ?? [])[1];
    // An SVG beats any raster; otherwise rank by declared size, and treat an
    // apple-touch-icon with no size as the 180px it conventionally is.
    const rank = /\.svg(\?|$)/i.test(href) ? 10_000
      : sizes ? Number(sizes)
        : /apple-touch/.test(rel) ? 180 : 0;
    candidates.push({ href, rank });
  }
  // The conventional paths, in case nothing is declared.
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
 * 3. An aggregator that often holds the brand's real vector mark.
 *
 * This is where most of the Indian banks come from: the favicon service only
 * has their 16px thumbnail, and their homepages declare nothing bigger, but
 * the proper SVG is here - HDFC's red square, Axis's burgundy polygons - in
 * under a kilobyte each.
 *
 * `fallback=false` matters: without it a miss returns a GENERATED letter
 * avatar, which would sail through every check below and quietly replace the
 * app's own monogram with a worse one.
 */
const fromAggregator = async (domain) => {
  const res = await get(`https://unavatar.io/${encodeURIComponent(domain)}?fallback=false`, 20_000);
  if (!res.ok) return { error: `aggregator HTTP ${res.status}` };
  return accept(Buffer.from(await res.arrayBuffer()), 'png');
};

/**
 * Brands where the aggregator has the WORDMARK and the favicon has the icon.
 *
 * Size is not the only thing that matters: "RBL BANK" set in type is a
 * perfectly good 4.5k vector and completely illegible in a 38px tile, while
 * the 48px favicon is the "b" monogram that actually reads. Checked by eye
 * against the rendered sheet - there is no way to tell a wordmark from an
 * icon programmatically.
 */
const PREFER_FAVICON = new Set(['rblbank.com', 'indusind.com']);

/**
 * Best available, in order of how likely it is to be both real and legible.
 * The aggregator goes first for its vectors; the favicon service is the
 * dependable 128px fallback - and goes first for the brands above.
 */
const fetchLogo = async (domain) => {
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

await mkdir(OUT, { recursive: true });

const kept = [];
const skipped = [];
// Sequential on purpose: fifty parallel requests to one service is rude, and
// this runs once.
for (const [name, domain] of Object.entries(DOMAINS)) {
  try {
    const result = await fetchLogo(domain);
    if (result.error) {
      skipped.push(`${name} (${domain}): ${result.error}`);
      continue;
    }
    // Drop any earlier file for this brand in the OTHER format first. A run
    // that upgrades a brand from a 128px PNG to a vector would otherwise
    // leave both on disk, and the component's glob would load the pair and
    // pick between them by whichever key happened to be written last.
    const slug = slugFor(name);
    for (const ext of ['png', 'svg']) {
      if (ext !== result.ext) await rm(join(OUT, `${slug}.${ext}`), { force: true });
    }
    await writeFile(join(OUT, `${slug}.${result.ext}`), result.buf);
    kept.push(`${name}: ${result.ext} ${result.size.w}${result.size.h ? 'x' + result.size.h : ''}, ${result.buf.length}b`);
  } catch (err) {
    skipped.push(`${name} (${domain}): ${err.message}`);
  }
}

console.log(`\nKEPT ${kept.length}:`);
for (const line of kept) console.log('  ' + line);
console.log(`\nMONOGRAM FALLBACK ${skipped.length}:`);
for (const line of skipped) console.log('  ' + line);
