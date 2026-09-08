import { describe, it, expect } from 'vitest';
import {
  findSubscriptions, subscriptionKey, subscriptionName, isLapsed, type SubscriptionInput,
} from './subscriptions';

/**
 * A list of subscriptions is only useful if the user believes it.
 *
 * So most of what follows is about the things that must NOT appear. One wrong
 * row - the takeaway somebody orders most weeks, listed as a subscription
 * they could cancel - turns the whole feature into something to scroll past.
 * Missing a real one costs nothing by comparison: the payment is in the
 * ledger either way.
 */

const NOW = Date.UTC(2026, 8, 20);
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const spend = (description: string, rupees: number, ago: number): SubscriptionInput => ({
  description, amount_minor: rupees * 100,
  transaction_type: 'expense', transaction_date: daysAgo(ago),
});

describe('finding what repeats', () => {
  it('finds a monthly subscription and says what it costs a year', () => {
    const found = findSubscriptions([
      spend('Netflix', 649, 90), spend('Netflix', 649, 60),
      spend('Netflix', 649, 30), spend('Netflix', 649, 0),
    ], NOW);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      name: 'Netflix', cadence: 'monthly', amountMinor: 64900, yearlyMinor: 64900 * 12,
    });
  });

  it('projects the next charge from the last one', () => {
    const [sub] = findSubscriptions([
      spend('Spotify', 119, 60), spend('Spotify', 119, 30), spend('Spotify', 119, 2),
    ], NOW);
    // Two days ago plus a month.
    expect(Math.round((sub.nextExpected - NOW) / DAY)).toBe(28);
  });

  it('reads a yearly renewal, which is the easiest one to forget', () => {
    const [sub] = findSubscriptions([
      spend('Amazon Prime', 1499, 730), spend('Amazon Prime', 1499, 365),
      spend('Amazon Prime', 1499, 1),
    ], NOW);
    expect(sub.cadence).toBe('yearly');
    expect(sub.yearlyMinor).toBe(149900);
  });

  it('puts the dearest per year first, not the most recent', () => {
    const found = findSubscriptions([
      spend('Spotify', 119, 90), spend('Spotify', 119, 60), spend('Spotify', 119, 30),
      spend('Netflix', 649, 88), spend('Netflix', 649, 58), spend('Netflix', 649, 28),
    ], NOW);
    expect(found.map((s) => s.name)).toEqual(['Netflix', 'Spotify']);
  });

  it('tolerates a billing date that drifts, as real ones do', () => {
    // The 31st becomes the 28th in February; a retry lands a few days late.
    const found = findSubscriptions([
      spend('Adobe', 1675, 92), spend('Adobe', 1675, 61),
      spend('Adobe', 1675, 27), spend('Adobe', 1675, 0),
    ], NOW);
    expect(found).toHaveLength(1);
  });

  it('survives one skipped cycle, which is a declined card and a retry', () => {
    const found = findSubscriptions([
      spend('Hotstar', 299, 120), spend('Hotstar', 299, 90),
      spend('Hotstar', 299, 30), spend('Hotstar', 299, 0),
    ], NOW);
    expect(found).toHaveLength(1);
  });
});

describe('what must never be called a subscription', () => {
  it('refuses takeaway ordered most weeks', () => {
    // Irregular gaps and wildly different amounts. On an AVERAGE gap this
    // looks weekly, which is exactly why the gaps are checked individually.
    const swiggy = [
      spend('Swiggy', 250, 40), spend('Swiggy', 830, 38), spend('Swiggy', 190, 31),
      spend('Swiggy', 460, 22), spend('Swiggy', 310, 20), spend('Swiggy', 720, 9),
      spend('Swiggy', 280, 2),
    ];
    expect(findSubscriptions(swiggy, NOW)).toEqual([]);
  });

  it('refuses two payments, however neatly spaced', () => {
    // Two of anything is a coincidence.
    expect(findSubscriptions([
      spend('Netflix', 649, 30), spend('Netflix', 649, 0),
    ], NOW)).toEqual([]);
  });

  it('refuses a payee whose amount swings', () => {
    // Monthly to the day, but 3x apart - that is a shop with an account, not
    // a subscription anyone can cancel for a known saving.
    expect(findSubscriptions([
      spend('Electricity', 800, 60), spend('Electricity', 2400, 30),
      spend('Electricity', 1100, 0),
    ], NOW)).toEqual([]);
  });

  it('refuses a group whose gaps do not agree', () => {
    // 30 days, then 5. No cadence fits both.
    expect(findSubscriptions([
      spend('Gym', 999, 35), spend('Gym', 999, 5), spend('Gym', 999, 0),
    ], NOW)).toEqual([]);
  });

  it('ignores money coming in', () => {
    // A salary repeats perfectly monthly and is nobody's subscription.
    const salary: SubscriptionInput[] = [0, 30, 60].map((ago) => ({
      description: 'SALARY', amount_minor: 6500000,
      transaction_type: 'income', transaction_date: daysAgo(ago),
    }));
    expect(findSubscriptions(salary, NOW)).toEqual([]);
  });

  it('ignores money that only moved between the user own accounts', () => {
    const savings: SubscriptionInput[] = [0, 30, 60].map((ago) => ({
      description: 'To savings', amount_minor: 500000,
      transaction_type: 'transfer', transaction_date: daysAgo(ago),
    }));
    expect(findSubscriptions(savings, NOW)).toEqual([]);
  });

  it('ignores rows with nothing to group on', () => {
    expect(findSubscriptions([
      spend('', 100, 60), spend('', 100, 30), spend('', 100, 0),
    ], NOW)).toEqual([]);
  });
});

/**
 * The same service arrives spelled differently depending on which alert saw
 * it - a card alert says "NETFLIX", a UPI app says "Google Pay - Netflix".
 * Left ungrouped they are two payments each and neither is a subscription.
 */
describe('recognising the same thing written differently', () => {
  it('strips the rail prefix capture puts on a description', () => {
    expect(subscriptionKey('Google Pay - Netflix')).toBe('netflix');
    expect(subscriptionKey('PhonePe - Netflix')).toBe('netflix');
    expect(subscriptionKey('From PhonePe')).toBe('phonepe');
  });

  it('ignores case and punctuation', () => {
    expect(subscriptionKey('NETFLIX')).toBe(subscriptionKey('Netflix'));
    expect(subscriptionKey('Amazon-Prime')).toBe(subscriptionKey('amazon prime'));
  });

  it('groups the spellings together into one subscription', () => {
    const found = findSubscriptions([
      spend('NETFLIX', 649, 90),
      spend('Google Pay - Netflix', 649, 60),
      spend('Netflix', 649, 30),
    ], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].payments).toHaveLength(3);
  });
});

describe('a price that went up', () => {
  it('says how much and by what percent', () => {
    const [sub] = findSubscriptions([
      spend('Netflix', 649, 90), spend('Netflix', 649, 60),
      spend('Netflix', 649, 30), spend('Netflix', 749, 0),
    ], NOW);
    expect(sub.priceRise).toEqual({ fromMinor: 64900, toMinor: 74900, percent: 15 });
  });

  it('says nothing about a rounding or a tax tweak', () => {
    const [sub] = findSubscriptions([
      spend('Spotify', 119, 90), spend('Spotify', 119, 60),
      spend('Spotify', 119, 30), spend('Spotify', 121, 0),
    ], NOW);
    expect(sub.priceRise).toBeUndefined();
  });

  it('says nothing when the price went down', () => {
    const [sub] = findSubscriptions([
      spend('Hotstar', 299, 90), spend('Hotstar', 299, 60),
      spend('Hotstar', 299, 30), spend('Hotstar', 279, 0),
    ], NOW);
    expect(sub.priceRise).toBeUndefined();
  });
});

describe('one that has gone quiet', () => {
  it('is flagged once a cycle has clearly been missed', () => {
    const [sub] = findSubscriptions([
      spend('Gym', 999, 150), spend('Gym', 999, 120), spend('Gym', 999, 90),
    ], NOW);
    // Ninety days since the last of a monthly charge.
    expect(isLapsed(sub, NOW)).toBe(true);
  });

  it('is not flagged while it is merely a few days late', () => {
    const [sub] = findSubscriptions([
      spend('Gym', 999, 66), spend('Gym', 999, 35), spend('Gym', 999, 3),
    ], NOW);
    expect(isLapsed(sub, NOW)).toBe(false);
  });
});

/**
 * Isolating the guard that does the real work.
 *
 * The takeaway case above has BOTH irregular gaps and swinging amounts, so it
 * would be rejected even if the gap check did nothing. These two remove that
 * ambiguity: identical amounts every time, and only the rhythm wrong.
 */
describe('the gap check, on its own', () => {
  it('refuses identical charges at irregular intervals', () => {
    // A fixed-price coffee card, bought whenever. Same amount to the rupee,
    // so only the gaps can reject this.
    expect(findSubscriptions([
      spend('Third Wave Coffee', 250, 47), spend('Third Wave Coffee', 250, 41),
      spend('Third Wave Coffee', 250, 26), spend('Third Wave Coffee', 250, 25),
      spend('Third Wave Coffee', 250, 4),
    ], NOW)).toEqual([]);
  });

  it('refuses a pattern that is only monthly on average', () => {
    // Gaps of 5, 55, 5, 55 days. The mean is 30, so anything averaging the
    // intervals would call this a monthly subscription. Every gap is checked
    // individually precisely so this cannot happen.
    expect(findSubscriptions([
      spend('Croma', 1200, 120), spend('Croma', 1200, 115),
      spend('Croma', 1200, 60), spend('Croma', 1200, 55),
      spend('Croma', 1200, 0),
    ], NOW)).toEqual([]);
  });

  it('still accepts a genuine one with identical amounts', () => {
    // The control: same shape as the first case, correct rhythm.
    expect(findSubscriptions([
      spend('Third Wave Coffee', 250, 60), spend('Third Wave Coffee', 250, 30),
      spend('Third Wave Coffee', 250, 0),
    ], NOW)).toHaveLength(1);
  });
});

describe('forgetting the long dead', () => {
  it('drops one whose last payment was well over a year ago', () => {
    // A perfectly regular monthly subscription, cancelled two years back. Real
    // pattern, but not a decision anyone can still make.
    expect(findSubscriptions([
      spend('Old Gym', 999, 800), spend('Old Gym', 999, 770), spend('Old Gym', 999, 740),
    ], NOW)).toEqual([]);
  });

  it('keeps a yearly renewal that has been missed once', () => {
    // Fourteen months since the last of a yearly charge: overdue, and exactly
    // the case worth surfacing rather than forgetting.
    const found = findSubscriptions([
      spend('Domain renewal', 1200, 1155), spend('Domain renewal', 1200, 790),
      spend('Domain renewal', 1200, 425),
    ], NOW);
    expect(found).toHaveLength(1);
    expect(isLapsed(found[0], NOW)).toBe(true);
  });
});

/**
 * The flaw the unit tests above missed.
 *
 * Requiring every charge to sit near one median seemed obvious, and it
 * silently cancelled the price-rise feature: a rise from Rs 299 to Rs 399 is
 * 33% off the median, so the whole subscription was rejected as inconsistent
 * and never appeared at all. The price-rise flag could therefore only fire for
 * rises SMALLER than the tolerance hiding them.
 *
 * It survived because the test above used a 15% rise, which fits under the
 * 20% tolerance by luck. Only a realistic rise, seeded into a running app,
 * showed it.
 */
describe('a subscription whose price actually changed', () => {
  it('survives a rise far bigger than the amount tolerance', () => {
    const found = findSubscriptions([
      spend('Hotstar', 299, 95), spend('Hotstar', 299, 65),
      spend('Hotstar', 299, 35), spend('Hotstar', 399, 3),
    ], NOW);

    expect(found).toHaveLength(1);
    expect(found[0].priceRise).toEqual({ fromMinor: 29900, toMinor: 39900, percent: 33 });
  });

  it('bases the yearly figure on what it costs NOW, not the average', () => {
    // Averaging would understate the year ahead, which is the number the user
    // is actually deciding on.
    const [sub] = findSubscriptions([
      spend('Hotstar', 299, 95), spend('Hotstar', 299, 65),
      spend('Hotstar', 299, 35), spend('Hotstar', 399, 3),
    ], NOW);
    expect(sub.amountMinor).toBe(39900);
    expect(sub.yearlyMinor).toBe(39900 * 12);
  });

  it('handles several charges at the new price', () => {
    const [sub] = findSubscriptions([
      spend('Adobe', 1499, 150), spend('Adobe', 1499, 120),
      spend('Adobe', 1999, 90), spend('Adobe', 1999, 60), spend('Adobe', 1999, 30),
    ], NOW);
    expect(sub.amountMinor).toBe(199900);
    expect(sub.priceRise?.percent).toBe(33);
  });

  it('still refuses a bill that swings both ways', () => {
    // The guard that must survive the loosening: one STEP is a price change,
    // up-and-down is a utility bill and nobody can cancel it for a fixed sum.
    expect(findSubscriptions([
      spend('Electricity', 800, 90), spend('Electricity', 2400, 60),
      spend('Electricity', 1100, 30), spend('Electricity', 2600, 0),
    ], NOW)).toEqual([]);
  });

  it('still refuses two separate price changes', () => {
    // Two steps is not a subscription changing price, it is a shop.
    expect(findSubscriptions([
      spend('Corner Shop', 200, 120), spend('Corner Shop', 200, 90),
      spend('Corner Shop', 500, 60), spend('Corner Shop', 900, 30),
      spend('Corner Shop', 1400, 0),
    ], NOW)).toEqual([]);
  });
});

/**
 * Which prefixes may be stripped, and which are the merchant itself.
 *
 * The strip existed so "Google Pay - Karan" and "Karan" could meet. Written as
 * "any <something> - ", it ate the merchant instead: "Third Wave Coffee -
 * Mumbai" reduced to "mumbai", so two unrelated shops in the same city grouped
 * into one row and were offered as a single subscription to cancel.
 *
 * A description is just as often "Payee - Branch" as "Rail - Payee", and
 * nothing in the text distinguishes them - only the list of real payment rails
 * can.
 */
describe('telling a rail prefix from the merchant name', () => {
  it('strips a real payment rail', () => {
    expect(subscriptionKey('Google Pay - Netflix')).toBe('netflix');
    expect(subscriptionKey('PhonePe - Netflix')).toBe('netflix');
    expect(subscriptionKey('WhatsApp Pay - Karan')).toBe('karan');
  });

  it('leaves a merchant whose own name carries a dash', () => {
    expect(subscriptionKey('Third Wave Coffee - Mumbai')).toBe('third wave coffee mumbai');
    expect(subscriptionKey('Cafe Xyz - Bandra')).toBe('cafe xyz bandra');
  });

  it('keeps two branches of different shops apart', () => {
    // Both reduced to their location before the fix, so they merged.
    expect(subscriptionKey('Cafe Alpha - Mumbai'))
      .not.toBe(subscriptionKey('Cafe Beta - Mumbai'));
  });

  it('still groups the same shop written with and without a rail', () => {
    expect(subscriptionKey('Google Pay - Third Wave Coffee'))
      .toBe(subscriptionKey('THIRD WAVE COFFEE'));
  });
});

/**
 * Subscriptions inside an IMPORTED statement.
 *
 * This is where the two features have to meet, and where they did not. A bank
 * stamps a different reference on every line - "UPI-NETFLIX-9812", then
 * "UPI-NETFLIX-4471" - so a year of a monthly subscription arrived as twelve
 * groups of one and nothing was ever found. Import exists precisely to bring
 * that history in, so this was the worst possible place for it to be blind.
 */
describe('finding subscriptions in a bank statement', () => {
  it('groups a monthly charge despite a new reference every month', () => {
    const found = findSubscriptions([
      spend('UPI-NETFLIX-9812', 649, 92),
      spend('UPI-NETFLIX-4471', 649, 61),
      spend('UPI-NETFLIX-2298', 649, 30),
      spend('UPI-NETFLIX-7734', 649, 0),
    ], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].payments).toHaveLength(4);
  });

  it('reads an SBI narration with a slash-separated reference', () => {
    const found = findSubscriptions([
      spend('BY TRANSFER-UPI/DR/512345/ZOMATO', 450, 90),
      spend('BY TRANSFER-UPI/DR/667788/ZOMATO', 450, 60),
      spend('BY TRANSFER-UPI/DR/991122/ZOMATO', 450, 30),
    ], NOW);
    expect(found).toHaveLength(1);
  });

  it('lets an imported row and a captured one be the same subscription', () => {
    // Two months from a statement, one from the notification listener. Kept
    // apart, neither side reaches the three payments a subscription needs.
    const found = findSubscriptions([
      spend('UPI-SWIGGY-9812', 299, 90),
      spend('UPI-SWIGGY-3321', 299, 60),
      spend('Swiggy', 299, 30),
    ], NOW);
    expect(found).toHaveLength(1);
    expect(found[0].payments).toHaveLength(3);
  });

  it('keeps a short number that is part of a brand name', () => {
    // "Box8" and "1MG" are merchants, not references. Only a run of four or
    // more digits is treated as a reference.
    expect(subscriptionKey('BOX8')).toBe('box8');
    expect(subscriptionKey('TATA 1MG')).toBe('tata 1mg');
  });

  it('still keeps two different merchants apart', () => {
    // The stripping must not be so eager that everything collides.
    expect(subscriptionKey('UPI-NETFLIX-9812'))
      .not.toBe(subscriptionKey('UPI-SPOTIFY-9812'));
  });

  it('falls back rather than producing an empty key', () => {
    // A description made entirely of words this strips would otherwise reduce
    // to nothing, and every such row would group together.
    expect(subscriptionKey('UPI TRANSFER REF')).not.toBe('');
  });
});

/**
 * What the row is CALLED, as opposed to how it is grouped.
 *
 * Grouping and naming were the same string, so a subscription found inside an
 * imported statement was labelled "UPI-NETFLIX-4078" - unrecognisable, and
 * carrying the reference of whichever single payment happened to be seen
 * first. The grouping was right and the label was useless.
 */
describe('naming a subscription found in a statement', () => {
  it('drops the scheme words and the reference', () => {
    expect(subscriptionName('UPI-NETFLIX-4078')).toBe('NETFLIX');
    expect(subscriptionName('BY TRANSFER-UPI/DR/202163/CULTFIT')).toBe('CULTFIT');
  });

  it('keeps the bank own spelling rather than lowercasing it', () => {
    // The key is a slug; the name is what the user reads.
    expect(subscriptionName('UPI-SPOTIFY-7101')).toBe('SPOTIFY');
    expect(subscriptionName('Third Wave Coffee')).toBe('Third Wave Coffee');
  });

  it('drops a payment rail prefix, keeping the person', () => {
    expect(subscriptionName('Google Pay - Karan')).toBe('Karan');
  });

  it('never returns an empty name', () => {
    expect(subscriptionName('UPI TRANSFER REF')).not.toBe('');
    expect(subscriptionName('12345678')).not.toBe('');
  });

  it('shows the cleaned name on the subscription itself', () => {
    const [sub] = findSubscriptions([
      spend('UPI-NETFLIX-9812', 649, 92),
      spend('UPI-NETFLIX-4471', 649, 61),
      spend('UPI-NETFLIX-2298', 649, 30),
    ], NOW);
    expect(sub.name).toBe('NETFLIX');
  });
});
