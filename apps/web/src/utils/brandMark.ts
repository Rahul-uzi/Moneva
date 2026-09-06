/**
 * A recognisable mark for a bank, wallet or merchant - without shipping
 * anyone's logo.
 *
 * Real bank and brand logos are trademarks. Bundling HDFC's or Google Pay's
 * mark into a distributed app is a licensing question rather than a design
 * one, and it is not one worth answering to make a list look nicer. A brand's
 * COLOUR is not its logo, though, and colour plus initials is most of what
 * makes a row scannable: at a glance you are picking out a blue tile from an
 * orange one, not reading either.
 *
 * So: a coloured tile with one or two letters. Known brands get their actual
 * colour and a sensible short form; anything else - a user's own account name,
 * a bank not on the list - gets a stable colour derived from its name, so the
 * same name always looks the same without anybody curating it.
 */

import { BRANDS_WITH_LOGOS } from './brandsWithLogos.generated';

export interface BrandMarkStyle {
  /** One or two characters. More than that is unreadable at tile size. */
  initials: string;
  /** Tile background. */
  background: string;
  /** Text on the tile: black or white, whichever is legible. */
  ink: string;
}

/**
 * Curated brands. `short` where initials alone would be wrong or unhelpful -
 * "PhonePe" reads as "Pe", not "Ph"; "State Bank of India" is "SBI" to
 * everyone, never "SB".
 */
const BRANDS: Record<string, { short: string; color: string }> = {
  // Banks
  'hdfc bank': { short: 'HD', color: '#004C8F' },
  'state bank of india': { short: 'SB', color: '#22409A' },
  'icici bank': { short: 'IC', color: '#AE275F' },
  'axis bank': { short: 'AX', color: '#97144D' },
  'kotak mahindra bank': { short: 'KO', color: '#E42228' },
  'punjab national bank': { short: 'PN', color: '#4B2E83' },
  'bank of baroda': { short: 'BB', color: '#CA4C1D' },
  'canara bank': { short: 'CA', color: '#00539F' },
  'union bank of india': { short: 'UB', color: '#1F4E9C' },
  'indusind bank': { short: 'IN', color: '#9E1B32' },
  'idfc first bank': { short: 'ID', color: '#9C1D26' },
  'yes bank': { short: 'YB', color: '#00518F' },
  'federal bank': { short: 'FB', color: '#9B6C0E' },
  'rbl bank': { short: 'RB', color: '#C8102E' },
  'bank of india': { short: 'BI', color: '#BC590D' },
  'indian bank': { short: 'IB', color: '#1B4F9C' },
  'au small finance bank': { short: 'AU', color: '#6D2077' },
  'bandhan bank': { short: 'BA', color: '#A2238D' },

  // Wallets and UPI
  paytm: { short: 'Pt', color: '#00778F' },
  phonepe: { short: 'Pe', color: '#5F259F' },
  'google pay': { short: 'GP', color: '#1A63C4' },
  'amazon pay': { short: 'AP', color: '#AA6600' },
  mobikwik: { short: 'MK', color: '#2B3990' },

  // Merchants
  swiggy: { short: 'Sw', color: '#BA5B0E' },
  'swiggy instamart': { short: 'SI', color: '#BA5B0E' },
  zomato: { short: 'Zo', color: '#DB3542' },
  blinkit: { short: 'Bl', color: '#8A6D00' },
  zepto: { short: 'Ze', color: '#5C31A0' },
  bigbasket: { short: 'BB', color: '#568218' },
  dunzo: { short: 'Du', color: '#00786C' },
  amazon: { short: 'Az', color: '#AA6600' },
  flipkart: { short: 'Fk', color: '#2771E9' },
  myntra: { short: 'My', color: '#D62E58' },
  meesho: { short: 'Me', color: '#C42A79' },
  nykaa: { short: 'Ny', color: '#C41F60' },
  uber: { short: 'Ub', color: '#111111' },
  ola: { short: 'Ol', color: '#3C7A12' },
  rapido: { short: 'Ra', color: '#8A7300' },
  irctc: { short: 'IR', color: '#213A8F' },
  makemytrip: { short: 'MM', color: '#D01A20' },
  netflix: { short: 'Nf', color: '#E50914' },
  spotify: { short: 'Sp', color: '#12813A' },
  bookmyshow: { short: 'BM', color: '#C4242B' },
  jio: { short: 'Ji', color: '#0F3CC9' },
  airtel: { short: 'Ai', color: '#E40000' },
  vi: { short: 'Vi', color: '#C00000' },
  'tata play': { short: 'TP', color: '#C4181E' },
  'apollo pharmacy': { short: 'Ap', color: '#0E7C38' },
  pharmeasy: { short: 'Ph', color: '#10847E' },
  practo: { short: 'Pr', color: '#166F96' },
};

/**
 * Brands recognised for matching, but with no curated colour.
 *
 * The list above carries a hand-picked colour because those are the fifty that
 * appear constantly. These are the long tail: recognised so a row gets a mark
 * at all, and coloured by the generated-hue path in brandMarkFor - which needs
 * no curation and cannot fail the contrast check, because only the hue varies.
 * Where a logo was fetched for one, the colour is never seen anyway.
 *
 * Deliberately no ordinary English words. "Shell", "Titan", "Slice" and
 * "Jupiter" are all real brands and all things a person might write for some
 * other reason, and a wrong logo is more confusing than none.
 */
const EXTRA_BRANDS: string[] = [
  // Eating
  'dominos', 'pizza hut', 'mcdonalds', 'kfc', 'burger king', 'starbucks',
  'barbeque nation', 'haldirams', 'chaayos', 'third wave coffee', 'faasos',
  'box8', 'eatsure', 'behrouz',
  // Groceries
  'dmart', 'jiomart', 'licious', 'country delight', 'milkbasket', 'spencers',
  // Shopping
  'ajio', 'tata cliq', 'snapdeal', 'croma', 'reliance digital', 'decathlon',
  'pepperfry', 'urban ladder', 'lenskart', 'tanishq', 'firstcry', 'purplle',
  'ikea',
  // Getting about
  'goibibo', 'cleartrip', 'yatra', 'ixigo', 'easemytrip', 'indigo',
  'spicejet', 'air india', 'vistara', 'zoomcar', 'redbus', 'oyo',
  // Watching and listening
  'hotstar', 'sonyliv', 'zee5', 'jiocinema', 'audible',
  // Health
  'tata 1mg', 'netmeds', 'cultfit', 'healthifyme', 'medplus',
  // Learning
  'byjus', 'vedantu', 'unacademy', 'upgrad',
  // Money
  'groww', 'zerodha', 'upstox', 'angel one',
  // Fuel and power
  'indian oil', 'bharat petroleum', 'tata power', 'adani electricity', 'bsnl',
];

/**
 * The distinctive half of a name, for the way people actually label accounts.
 *
 * Nobody calls an account "HDFC Bank" - it is "HDFC Savings", "ICICI Salary",
 * "Axis Current". Matching only the full brand name found none of them.
 *
 * Only tokens that mean one company and nothing else. Deliberately absent:
 * "yes", "union", "indian", "first" and anything else that is an ordinary
 * English word, because a bank logo on an account called "Yes Fund" is worse
 * than no logo at all.
 */
const ALIASES: Record<string, string> = {
  hdfc: 'hdfc bank',
  sbi: 'state bank of india',
  yono: 'state bank of india',
  icici: 'icici bank',
  imobile: 'icici bank',
  axis: 'axis bank',
  kotak: 'kotak mahindra bank',
  pnb: 'punjab national bank',
  baroda: 'bank of baroda',
  canara: 'canara bank',
  indusind: 'indusind bank',
  idfc: 'idfc first bank',
  federal: 'federal bank',
  rbl: 'rbl bank',
  bandhan: 'bandhan bank',
  aubank: 'au small finance bank',
};

/** Words that carry no identity and only get in the way of initials. */
const NOISE = new Set([
  'bank', 'of', 'the', 'and', 'ltd', 'limited', 'india', 'account',
  'savings', 'current', 'card', 'credit', 'debit', 'my', 'a', 'an',
]);

/**
 * Initials for a name nobody curated.
 *
 * Meaningful words only, so "My Savings Account" does not become "MS" - it
 * has no meaningful word at all, and falls back to the first two characters
 * of the raw name rather than returning nothing.
 */
export const initialsFor = (name: string): string => {
  const words = name
    .trim()
    .split(/[\s\-_/]+/)
    // Must contain a letter or digit: a token of pure punctuation is not a
    // word, and letting one through produced initials like "!!".
    .filter((w) => /[A-Za-z0-9]/.test(w) && !NOISE.has(w.toLowerCase()));

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  const bare = name.replace(/[^A-Za-z0-9]/g, '');
  return (bare.slice(0, 2) || '?').toUpperCase();
};

/** Stable 32-bit hash, so a name always gets the same colour. */
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

/**
 * Relative luminance, per WCAG, so the letters on a tile are legible whatever
 * colour it is. Guessing white-on-everything puts white on Blinkit's yellow.
 */
export const luminance = (hex: string): number => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(full.slice(0, 2), 16));
  const g = channel(parseInt(full.slice(2, 4), 16));
  const b = channel(parseInt(full.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever the tile can actually be read against. */
export const inkOn = (background: string): string =>
  luminance(background) > 0.4 ? '#10130A' : '#FFFFFF';

/**
 * The mark for any name.
 *
 * Unknown names get a generated colour rather than one flat grey, so a list of
 * five accounts is still scannable. Lightness and saturation are fixed and
 * only the hue varies, which keeps every generated tile in the same contrast
 * band instead of leaving some unreadable.
 */
export const brandMarkFor = (name: string): BrandMarkStyle => {
  const key = name.trim().toLowerCase();
  const known = BRANDS[key];

  if (known) {
    return { initials: known.short, background: known.color, ink: inkOn(known.color) };
  }

  const hue = hash(key) % 360;
  const background = `hsl(${hue} 46% 34%)`;
  return {
    initials: initialsFor(name),
    // Fixed 34% lightness: dark enough that white always reads on it, so this
    // branch needs no contrast test of its own.
    background,
    ink: '#FFFFFF',
  };
};

/** Whether this name is one of the brands with a real colour. */
export const isKnownBrand = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(BRANDS, name.trim().toLowerCase());

/**
 * The brand named ANYWHERE inside a piece of text, or null.
 *
 * Exact matching on the whole string is close to useless against real data:
 * an account is called "HDFC Savings", not "HDFC Bank", and a transaction
 * arrives as "UPI/ZOMATO ONLINE/9812". This looks for a brand inside the text
 * instead.
 *
 * Two rules keep it honest:
 *
 *   - **Word boundaries.** Everything but letters and digits becomes a space
 *     and the search is padded, so "Motorola" is not Ola and "Nykaa" is not
 *     "Nyka". Substring matching on a table containing "Vi" and "Ola" would
 *     otherwise put a phone-network logo on half the ledger.
 *   - **Longest wins.** "Amazon Pay ICICI Card" contains both "amazon" and
 *     "amazon pay"; the longer name is the more specific reading.
 */
export const brandNameIn = (text: string): string | null => {
  if (!text) return null;
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  let best: string | null = null;
  let bestLen = 0;

  const consider = (needle: string, brand: string) => {
    if (!hay.includes(` ${needle} `)) return;
    if (needle.length > bestLen) {
      best = brand;
      bestLen = needle.length;
    }
  };

  for (const key of Object.keys(BRANDS)) consider(key.replace(/[^a-z0-9]+/g, ' '), key);
  for (const name of EXTRA_BRANDS) consider(name, name);
  // Everything that has a logo file, generated from the files themselves. A
  // brand discovered by scripts/discover-brands.mjs is only recognised
  // because there is an image to show for it - recognising a name in order to
  // draw its initials buys nothing the app cannot already do for any text.
  for (const name of BRANDS_WITH_LOGOS) consider(name, name);
  for (const [alias, brand] of Object.entries(ALIASES)) consider(alias, brand);

  return best;
};
