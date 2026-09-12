import { describe, expect, it } from 'vitest';
import {
  brandMarkFor,
  brandNameIn,
  initialsFor,
  inkOn,
  isKnownBrand,
  luminance,
} from './brandMark';

describe('initials', () => {
  it('skips the words that carry no identity', () => {
    // "Bank", "of" and "India" are all filler, so each of these is down to a
    // single meaningful word and takes two letters from it. Both are in the
    // curated table anyway ("SB", "BB"); this is only the raw derivation, and
    // what matters is that it is stable and never empty.
    expect(initialsFor('State Bank of India')).toBe('ST');
    expect(initialsFor('Bank of Baroda')).toBe('BA');
    // Two meaningful words: one letter from each.
    expect(initialsFor('Emergency Fund')).toBe('EF');
  });

  it('takes two letters from a single-word name', () => {
    expect(initialsFor('Swiggy')).toBe('SW');
    expect(initialsFor('Jio')).toBe('JI');
  });

  it('still returns something when every word is noise', () => {
    // "My Savings Account" is all filler; two letters of the raw name beats
    // an empty tile.
    expect(initialsFor('My Savings Account')).toBe('MY');
    expect(initialsFor('   ')).toBe('?');
    expect(initialsFor('!!!')).toBe('?');
  });

  it('handles separators other than spaces', () => {
    expect(initialsFor('Kotak-Mahindra')).toBe('KM');
    expect(initialsFor('holiday/fund')).toBe('HF');
    // "current" is filler, so only "salary" is left to work with.
    expect(initialsFor('salary/current')).toBe('SA');
  });
});

describe('legibility', () => {
  it('puts dark ink on light tiles and white on dark ones', () => {
    expect(inkOn('#F8CB46')).toBe('#10130A'); // a yellow
    expect(inkOn('#004C8F')).toBe('#FFFFFF'); // a navy
    expect(inkOn('#FFFFFF')).toBe('#10130A');
    expect(inkOn('#000000')).toBe('#FFFFFF');
  });

  it('computes luminance the WCAG way', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#fff')).toBeCloseTo(1, 5); // shorthand
  });

  // The whole point of choosing ink per tile: every curated brand has to be
  // readable, not just most of them.
  it('every curated brand reaches 4.5:1 against its own ink', () => {
    const brands = [
      'HDFC Bank', 'State Bank of India', 'ICICI Bank', 'Axis Bank',
      'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda',
      'Canara Bank', 'Union Bank of India', 'IndusInd Bank', 'IDFC First Bank',
      'Yes Bank', 'Federal Bank', 'RBL Bank', 'Bank of India', 'Indian Bank',
      'AU Small Finance Bank', 'Bandhan Bank',
      'Paytm', 'PhonePe', 'Google Pay', 'Amazon Pay', 'Mobikwik',
      'Swiggy', 'Swiggy Instamart', 'Zomato', 'Blinkit', 'Zepto', 'BigBasket',
      'Dunzo', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Nykaa', 'Uber',
      'Ola', 'Rapido', 'IRCTC', 'MakeMyTrip', 'Netflix', 'Spotify',
      'BookMyShow', 'Jio', 'Airtel', 'Vi', 'Tata Play', 'Apollo Pharmacy',
      'PharmEasy', 'Practo',
    ];

    const failures: string[] = [];
    for (const name of brands) {
      const { background, ink } = brandMarkFor(name);
      const a = luminance(background);
      const b = luminance(ink);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) failures.push(`${name} ${background} = ${ratio.toFixed(2)}:1`);
    }
    expect(failures).toEqual([]);
  });

  it('generated tiles are dark enough for white text', () => {
    // Only the hue varies, so if one hue passes the band they all do - but
    // check a spread rather than trusting the reasoning.
    for (const name of ['QA Savings', 'Emergency Fund', 'zzz', 'Wallet 7', 'Ravi']) {
      const { background, ink } = brandMarkFor(name);
      expect(ink).toBe('#FFFFFF');
      expect(background).toMatch(/^hsl\(\d+ 46% 34%\)$/);
    }
  });
});

describe('the mark itself', () => {
  it('gives a known brand its own colour and short form', () => {
    const m = brandMarkFor('PhonePe');
    expect(m.initials).toBe('Pe');
    expect(m.background).toBe('#5F259F');
    expect(isKnownBrand('PhonePe')).toBe(true);
  });

  it('does not care about case or stray spacing', () => {
    expect(brandMarkFor('  hdfc BANK ')).toEqual(brandMarkFor('HDFC Bank'));
  });

  it('gives the same unknown name the same colour every time', () => {
    expect(brandMarkFor('QA Savings')).toEqual(brandMarkFor('QA Savings'));
    expect(isKnownBrand('QA Savings')).toBe(false);
  });

  it('gives different names different colours', () => {
    const a = brandMarkFor('Emergency Fund').background;
    const b = brandMarkFor('Holiday Fund').background;
    expect(a).not.toBe(b);
  });

  it('never returns an empty label', () => {
    for (const name of ['', '   ', '###', 'x']) {
      expect(brandMarkFor(name).initials.length).toBeGreaterThan(0);
    }
  });
});

describe('finding a brand inside real text', () => {
  it('matches an account named after a bank without the word "Bank"', () => {
    expect(brandNameIn('HDFC Savings')).toBe('hdfc bank');
    expect(brandNameIn('HDFC Bank')).toBe('hdfc bank');
    expect(brandNameIn('Axis Bank')).toBe('axis bank');
  });

  it('matches a merchant inside a bank narration', () => {
    expect(brandNameIn('UPI/ZOMATO ONLINE/9812')).toBe('zomato');
    expect(brandNameIn('Paid to SWIGGY*ORDER')).toBe('swiggy');
    expect(brandNameIn('NETFLIX.COM subscription')).toBe('netflix');
  });

  it('prefers the more specific name', () => {
    // Contains both "amazon" and "amazon pay"; the longer one is the reading.
    expect(brandNameIn('Amazon Pay ICICI Card')).toBe('amazon pay');
    expect(brandNameIn('Swiggy Instamart order')).toBe('swiggy instamart');
  });

  it('respects word boundaries, so short names cannot run wild', () => {
    // The table holds "Ola" and "Vi" - substring matching would put a taxi
    // logo on a Motorola repair and a phone-network logo on "Vietnam".
    expect(brandNameIn('MOTOROLA service centre')).toBeNull();
    expect(brandNameIn('Vietnam holiday')).toBeNull();
    expect(brandNameIn('Nykaaa')).toBeNull();
    // But the real thing still matches.
    expect(brandNameIn('OLA ride')).toBe('ola');
    expect(brandNameIn('VI recharge')).toBe('vi');
  });

  it('returns null when there is no brand at all', () => {
    for (const text of ['Cash', 'Credit Card', 'Chai', 'Lunch', 'Petrol', '', 'Salary Received: Acme Corp']) {
      expect(brandNameIn(text), text).toBeNull();
    }
  });
});

describe('the way people actually name accounts', () => {
  it('recognises the distinctive half of a bank name', () => {
    expect(brandNameIn('HDFC Savings')).toBe('hdfc bank');
    expect(brandNameIn('ICICI Salary Account')).toBe('icici bank');
    expect(brandNameIn('Axis Current')).toBe('axis bank');
    expect(brandNameIn('SBI Joint')).toBe('state bank of india');
    expect(brandNameIn('Kotak 811')).toBe('kotak mahindra bank');
  });

  it('does not let an ordinary English word stand in for a bank', () => {
    // "Yes", "Union", "Indian" and "First" are all real bank names and all
    // ordinary words - so none of them is an alias.
    expect(brandNameIn('Yes Fund')).toBeNull();
    expect(brandNameIn('Union dues')).toBeNull();
    expect(brandNameIn('Indian groceries')).toBeNull();
    expect(brandNameIn('First home fund')).toBeNull();
  });
});

describe('brands discovered by the logo script', () => {
  it('recognises a name only because a logo was fetched for it', () => {
    // These came from scripts/discover-brands.mjs and are in the generated
    // list purely because an image exists. None is hand-written above.
    expect(brandNameIn('Wow Momo order')).toBe('wow momo');
    expect(brandNameIn('CHAI POINT')).toBe('chai point');
    expect(brandNameIn('Paid Mamaearth')).toBe('mamaearth');
  });

  it('still refuses a name with no logo and no curated entry', () => {
    expect(brandNameIn('Sri Balaji Stores')).toBeNull();
    expect(brandNameIn('Ramesh Kumar')).toBeNull();
  });
});

describe('brands with an apostrophe in the name', () => {
  /*
   * A payment of Rs 161.70 to McDonald's showed a monogram, and the logo file
   * had been sitting in src/assets/brands the whole time.
   *
   * Every non-alphanumeric character used to become a space, which is right
   * for a slash and wrong for an apostrophe: "McDonald's" turned into the two
   * words "mcdonald s", and the catalogue entry "mcdonalds" was never found.
   * A bank's SMS shouting "MCDONALDS" matched, so the brand looked like it
   * worked - it only failed in the form a person or a payment app writes.
   */

  it('matches the possessive form a payment app actually posts', () => {
    expect(brandNameIn("₹161.70 to McDonald's")).toBe('mcdonalds');
    expect(brandNameIn("McDonald's")).toBe('mcdonalds');
  });

  it('matches the typographic apostrophe a phone inserts', () => {
    // U+2019, not U+0027. Android, iOS and Google Pay all substitute it, so
    // this is the form that arrives far more often than the straight quote.
    expect(brandNameIn('’')).toBeNull(); // sanity: the character alone is nothing
    expect(brandNameIn('Paid ‘McDonald’s’ today')).toBe('mcdonalds');
  });

  it('was never only about one brand', () => {
    // Same shape, same silent failure. These are the rest of the catalogue's
    // possessives, and all of them were missed.
    expect(brandNameIn("Domino's Pizza")).toBe('dominos');
    expect(brandNameIn("Haldiram's")).toBe('haldirams');
    expect(brandNameIn("BYJU'S renewal")).toBe('byjus');
  });

  it('still reads the shouted form a bank sends', () => {
    // The form that always worked has to keep working: removing the
    // apostrophe must not disturb text that never had one.
    expect(brandNameIn('Rs.161.70 at MCDONALDS on ****4471')).toBe('mcdonalds');
  });

  it('still reads a possessive on a brand that has no apostrophe', () => {
    /*
     * The other half, and the reason both readings are tried rather than one
     * being chosen. Here the apostrophe is a possessive suffix, not part of
     * the name, so the word to find is "swiggy" and not "swiggys".
     *
     * Simply deleting the apostrophe - the obvious fix for McDonald's - broke
     * every one of these. The two cases want opposite things from the same
     * character, which is why neither reading can be the only one.
     */
    expect(brandNameIn("Swiggy's order")).toBe('swiggy');
    expect(brandNameIn("Zomato's delivery")).toBe('zomato');
    expect(brandNameIn("Ola's driver")).toBe('ola');
  });

  it('does not manufacture a brand out of ordinary text', () => {
    // Removing a character rather than splitting on it joins what was either
    // side of it. Neither reading may invent a name that was never written.
    expect(brandNameIn("that'll be fine")).toBeNull();
    expect(brandNameIn("Ramesh's shop")).toBeNull();
    expect(brandNameIn("Mum's groceries")).toBeNull();
  });
});
