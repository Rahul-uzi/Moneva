/**
 * Guessing which category an imported payment belongs to.
 *
 * A payment alert names a merchant and an amount; it never names a category.
 * So the category is inferred, and the order the sources are tried in matters
 * more than any single rule:
 *
 *   1. **What this person did last time.** If a transaction to the same payee
 *      is already filed under Groceries, this one is Groceries. Not a guess -
 *      it is their own decision, reapplied - so it beats every table below and
 *      quietly gets better the more the app is used.
 *   2. **The merchant table the app already carries.** transferDestinations
 *      maps Swiggy to Food & Dining, Uber to Transport, and so on for 27
 *      names, and all of its hints match real category names.
 *   3. **Words in the message.** Catches the long tail the table cannot -
 *      petrol pumps, hospitals, landlords, an unlisted restaurant.
 *   4. **Nothing.** Better an uncategorised row than a wrong one; a wrong
 *      category quietly corrupts a budget, and nobody audits a figure that
 *      looks plausible.
 *
 * Every suggestion is shown before it is saved, and it carries `source` so the
 * UI can say WHY - "because you filed Swiggy under Food & Dining before" is a
 * far easier thing to trust, or correct, than a category that simply appeared.
 *
 * Pure: categories and history are passed in, nothing is fetched here.
 */

import { MERCHANTS, WALLETS } from '../data/transferDestinations';

export type CategorySource = 'history' | 'merchant' | 'keyword' | 'none';

export interface CategorySuggestion {
  categoryId: string | null;
  categoryName: string | null;
  source: CategorySource;
  /** Short, human sentence for the review card. Null when nothing matched. */
  reason: string | null;
}

interface CategoryLike {
  id: string;
  name: string;
  type: string;
}

interface PastTransaction {
  description?: string | null;
  category_id?: string | null;
}

/**
 * Words that place a payment, for the long tail no table covers.
 *
 * Ordered: the first category with a hit wins, so the specific ones come
 * first. "Fuel" before "Transport" because a petrol pump is fuel, not a taxi.
 */
const KEYWORDS: Array<{ category: string; words: string[] }> = [
  { category: 'Fuel', words: ['petrol', 'diesel', 'fuel', 'iocl', 'indian oil', 'bharat petroleum', 'bpcl', 'hpcl', 'hp petrol', 'shell', 'nayara'] },
  { category: 'Groceries', words: ['bigbasket', 'blinkit', 'zepto', 'instamart', 'dmart', 'd mart', 'grocery', 'kirana', 'reliance fresh', 'more retail', 'jiomart', 'supermarket'] },
  { category: 'Food & Dining', words: ['swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'dominos', 'pizza', 'mcdonald', 'kfc', 'starbucks', 'burger', 'biryani', 'dhaba', 'bakery', 'eatery'] },
  { category: 'Health', words: ['apollo', 'pharmeasy', 'practo', 'hospital', 'clinic', 'medical', 'pharmacy', 'chemist', 'netmeds', '1mg', 'diagnostic', 'lab test', 'doctor'] },
  { category: 'Entertainment', words: ['netflix', 'spotify', 'hotstar', 'prime video', 'bookmyshow', 'pvr', 'inox', 'cinema', 'gaming', 'youtube premium', 'jiocinema'] },
  // Transport before Utilities: "FASTAG recharge" is a toll payment, and
  // "recharge" alone would otherwise file it under Utilities. The reverse
  // does no harm - "Airtel recharge" holds no transport word.
  { category: 'Transport', words: ['uber', 'ola', 'rapido', 'irctc', 'metro', 'redbus', 'makemytrip', 'indigo', 'railway', 'toll', 'fastag', 'parking', 'cab'] },
  { category: 'Utilities', words: ['airtel', 'jio', 'vodafone', 'bsnl', 'electricity', 'tata play', 'broadband', 'gas bill', 'water bill', 'recharge', 'postpaid', 'dth', 'wifi'] },
  { category: 'Shopping', words: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'nykaa', 'lifestyle', 'pantaloons', 'decathlon', 'croma', 'reliance digital'] },
  { category: 'Rent & Housing', words: ['rent', 'landlord', 'society maintenance', 'housing', 'maintenance charge'] },
  { category: 'Education', words: ['school', 'college', 'tuition', 'udemy', 'coursera', 'byju', 'unacademy', 'exam fee', 'course fee'] },
];

/** Everything the merchant table already knows, as name -> category. */
const MERCHANT_CATEGORY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const d of [...MERCHANTS, ...WALLETS]) {
    if (d.categoryHint) map[d.label.toLowerCase()] = d.categoryHint;
  }
  return map;
})();

const findCategory = (categories: CategoryLike[], name: string, type: string) =>
  categories.find((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase());

const none: CategorySuggestion = {
  categoryId: null, categoryName: null, source: 'none', reason: null,
};

/**
 * How the money travelled, which is not who was paid.
 *
 * "Google Pay - Vishal" is a payment to VISHAL. Leaving the rail in the key
 * was the single worst bug in this file: the comparison below is containment,
 * so "googlepay" sits inside "googlepayvishal", "googlepaydmart" and every
 * other row that went through the same app - and one bare "Google Pay" row
 * then matched all of them. Whatever that one row was filed under spread to
 * every payment the person ever made through that app. In real data it was
 * Food & Dining, and a petrol pump, a supermarket and a transfer to a friend
 * all came back as Food & Dining.
 */
/* A literal, not new RegExp(...). Built from a string it read '\b' as the
   backspace character and '\s' as the letter s, so it matched nothing at all
   and every rail stayed in the key - the bug this constant exists to fix,
   silently reintroduced by the quoting. A literal cannot do that. */
const RAIL =
  /^(?:google ?pay|g ?pay|phonepe|phone ?pe|paytm|amazon ?pay|mobikwik|bhim|cred|upi|neft|imps|rtgs|ach|ecs|bank ?payment|net ?banking|debit card|credit card|card payment|paid to|sent to|payment to|received from|transfer(?:red)? (?:to|from)|to|from)\b[\s:/*,.|-]*/i;

/**
 * Normalised payee, for comparing this payment against past ones.
 *
 * Bank narrations are noisy - "UPI/SWIGGY LTD/9876", "SWIGGY*ORDER" and
 * "Swiggy" are one payee - so everything but letters and digits goes, and the
 * comparison is containment rather than equality.
 *
 * The rail comes off first, repeatedly, because narrations stack them:
 * "UPI/Google Pay/VISHAL" carries two before the name. What is left is the
 * payee, or nothing at all - and nothing is the right answer for a row that
 * only ever said "Google Pay", because that names no payee to learn from.
 */
const payeeKey = (s: string): string => {
  let text = String(s || '').trim();
  for (let i = 0; i < 4 && RAIL.test(text); i += 1) text = text.replace(RAIL, '').trim();
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Does this keyword appear in the text?
 *
 * A short keyword has to fall on a word boundary. Plain containment is fine
 * for "makemytrip", but "ola" as a substring also matches Motorola, Sholapur
 * and chocolate - and a category that is wrong for a reason nobody can see is
 * worse than no category at all.
 */
const matches = (haystack: string, word: string): boolean => {
  if (word.length > 4) return haystack.includes(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
};

export const suggestCategory = (input: {
  merchant?: string;
  text: string;
  kind: 'debit' | 'credit';
  categories: CategoryLike[];
  history?: PastTransaction[];
}): CategorySuggestion => {
  const { merchant, text, kind, categories, history = [] } = input;
  const type = kind === 'debit' ? 'expense' : 'income';
  const haystack = `${merchant ?? ''} ${text ?? ''}`.toLowerCase();

  // ---- money coming in -------------------------------------------------
  // Income has no merchant table and one dominant case worth catching.
  if (kind === 'credit') {
    if (/\b(salary|payroll|wages|stipend)\b/.test(haystack)) {
      const salary = findCategory(categories, 'Salary', 'income');
      if (salary) {
        return {
          categoryId: salary.id, categoryName: salary.name, source: 'keyword',
          reason: 'the message mentions salary',
        };
      }
    }
    const other = findCategory(categories, 'Other Income', 'income');
    return other
      ? { categoryId: other.id, categoryName: other.name, source: 'none',
          reason: 'money in, but nothing said what kind' }
      : none;
  }

  // ---- 1. what they did last time --------------------------------------
  if (merchant) {
    const key = payeeKey(merchant);
    if (key.length >= 3) {
      for (const past of history) {
        if (!past.category_id || !past.description) continue;
        const pastKey = payeeKey(past.description);
        // BOTH sides need something left after the rail comes off. A row that
        // only ever said "Google Pay" reduces to nothing, and "" is contained
        // in every string - so without this it stops being a universal donor
        // by prefix and becomes one by emptiness instead, which is the same
        // bug wearing a different coat.
        if (pastKey.length < 3) continue;
        if (!pastKey.includes(key) && !key.includes(pastKey)) continue;
        const cat = categories.find((c) => c.id === past.category_id && c.type === type);
        if (cat) {
          return {
            categoryId: cat.id, categoryName: cat.name, source: 'history',
            reason: `you filed ${merchant} under ${cat.name} before`,
          };
        }
      }
    }
  }

  // ---- 2. the merchant table -------------------------------------------
  for (const [name, hint] of Object.entries(MERCHANT_CATEGORY)) {
    if (hint === 'Other') continue;            // a hint that says nothing
    // Same boundary rule as the keywords below - the table holds short names
    // like "Ola" and "Vi", and plain containment read "Motorola" as a taxi.
    if (!matches(haystack, name)) continue;
    const cat = findCategory(categories, hint, 'expense');
    if (cat) {
      return {
        categoryId: cat.id, categoryName: cat.name, source: 'merchant',
        reason: `${name} is usually ${cat.name}`,
      };
    }
  }

  // ---- 3. words in the message -----------------------------------------
  for (const rule of KEYWORDS) {
    const hit = rule.words.find((w) => matches(haystack, w));
    if (!hit) continue;
    const cat = findCategory(categories, rule.category, 'expense');
    if (cat) {
      return {
        categoryId: cat.id, categoryName: cat.name, source: 'keyword',
        reason: `"${hit}" usually means ${cat.name}`,
      };
    }
  }

  // ---- 4. say nothing ---------------------------------------------------
  return none;
};

/**
 * The same question, asked about a line of a bank statement.
 *
 * Statement rows differ from a payment alert in one way that matters here, so
 * the two arguments are deliberately NOT the same string:
 *
 *   merchant - the CLEANED name, because that is what the row will be stored
 *              as and therefore what a future import will compare its history
 *              against. Matching on the raw narration would file the same
 *              payee differently every month, since the reference number in
 *              it changes with every payment.
 *   text     - the RAW narration, because the cleaner's job is to produce a
 *              readable label and it can drop the very word that places the
 *              payment. "BY TRANSFER-UPI/DR/512345/INDIANOIL" cleans to
 *              something a person can read; "indianoil" is what says Fuel.
 *
 * More haystack, same needle - so the clean name is used where identity
 * matters and the full line where recognition does.
 */
export const suggestImportCategory = (input: {
  /** The narration as the bank wrote it. */
  raw: string;
  /** The same narration after `subscriptionName`, if it produced anything. */
  cleaned: string;
  direction: 'debit' | 'credit';
  categories: CategoryLike[];
  history?: PastTransaction[];
}): CategorySuggestion =>
  suggestCategory({
    merchant: input.cleaned || input.raw,
    text: input.raw,
    kind: input.direction,
    categories: input.categories,
    history: input.history,
  });
