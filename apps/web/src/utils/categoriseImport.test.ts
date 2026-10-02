import { describe, expect, it } from 'vitest';
import { suggestImportCategory } from './categorise';

/**
 * Categorising a statement, which is where this used to not happen at all.
 *
 * The import posted no category. It was the one route into the ledger that
 * brings in hundreds of rows at once, and every one of them arrived blank -
 * so the breakdowns and budgets that are the reason to open the app had
 * nothing to read after the single biggest act of data entry. A real restore
 * of 32 rows landed 32 uncategorised.
 *
 * The narrations below are the shapes banks actually write, including the
 * ones from that restore.
 */
const CATEGORIES = [
  'Education', 'Entertainment', 'Food & Dining', 'Fuel', 'Groceries', 'Health',
  'Other', 'Rent & Housing', 'Shopping', 'Transport', 'Utilities',
].map((name) => ({ id: `exp-${name}`, name, type: 'expense' }))
  .concat(['Business', 'Investments', 'Other Income', 'Salary']
    .map((name) => ({ id: `inc-${name}`, name, type: 'income' })));

const file = (over: Partial<Parameters<typeof suggestImportCategory>[0]> = {}) =>
  suggestImportCategory({
    raw: '', cleaned: '', direction: 'debit', categories: CATEGORIES, ...over,
  });

describe('a statement row gets a category', () => {
  it('reads the keyword out of a raw bank narration', () => {
    const s = file({ raw: 'BY TRANSFER-UPI/DR/512345/INDIANOIL/HDFC', cleaned: 'Indian oil' });
    expect(s.categoryId).toBe('exp-Fuel');
  });

  it('places the rows from a real restored statement', () => {
    expect(file({ raw: 'Indian oil Petrol Pump', cleaned: 'Indian oil Petrol Pump' }).categoryId)
      .toBe('exp-Fuel');
    expect(file({ raw: 'DMART - Return', cleaned: 'DMART' }).categoryId)
      .toBe('exp-Groceries');
  });

  it('files money in, always - there is no unlabelled credit', () => {
    // Credits have no merchant table, so the fallback matters more here: a
    // statement is mostly transfers from people, and "Other Income" is a true
    // answer where blank is merely an empty one.
    expect(file({ raw: 'Google Pay - KARAN SHARMA', cleaned: 'Google Pay', direction: 'credit' })
      .categoryId).toBe('inc-Other Income');
  });

  it('recognises a salary credit by its wording', () => {
    expect(file({ raw: 'NEFT SALARY SEP 2026 ACME LTD', cleaned: 'Acme Ltd', direction: 'credit' })
      .categoryId).toBe('inc-Salary');
  });
});

describe('the clean name and the raw line do different jobs', () => {
  it('matches history on the CLEAN name, so a payee survives its reference number', () => {
    /* The reference changes every month. Comparing history on the raw line
       would make October's Swiggy a different payee from September's, and the
       user's own past decision - the best signal there is - would never be
       found again. */
    const s = file({
      raw: 'UPI/SWIGGY LTD/778899/PAYMENT',
      cleaned: 'Swiggy',
      history: [{ description: 'Swiggy', category_id: 'exp-Groceries' }],
    });
    expect(s.source).toBe('history');
    expect(s.categoryId).toBe('exp-Groceries');
  });

  it('still finds a keyword the cleaner dropped from the label', () => {
    /* The reverse: the clean label is readable but says nothing, while the
       raw line holds the word that places the payment. Matching only on the
       clean name would file this blank. */
    const s = file({ raw: 'POS 4412 BHARAT PETROLEUM 8821', cleaned: 'POS 4412' });
    expect(s.categoryId).toBe('exp-Fuel');
  });

  it('falls back to the raw line when cleaning produced nothing', () => {
    expect(file({ raw: 'ZOMATO ONLINE ORDER', cleaned: '' }).categoryId)
      .toBe('exp-Food & Dining');
  });
});

describe('it stays quiet rather than guessing', () => {
  it('leaves a narration it cannot place alone', () => {
    // Blank is recoverable; wrong is not, because nobody re-checks a row that
    // already has a category on it.
    expect(file({ raw: 'ATM WDL 4412 S V ROAD', cleaned: 'ATM WDL' }).categoryId).toBeNull();
  });

  it('does not invent a category that this account does not have', () => {
    const s = suggestImportCategory({
      raw: 'SWIGGY ORDER', cleaned: 'Swiggy', direction: 'debit',
      categories: [{ id: 'exp-Other', name: 'Other', type: 'expense' }],
    });
    expect(s.categoryId).toBeNull();
  });
});
