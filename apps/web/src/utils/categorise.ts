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
 * Normalised payee, for comparing this payment against past ones.
 *
 * Bank narrations are noisy - "UPI/SWIGGY LTD/9876", "SWIGGY*ORDER" and
 * "Swiggy" are one payee - so everything but letters and digits goes, and the
 * comparison is a containment test rather than equality.
 */
const payeeKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

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
