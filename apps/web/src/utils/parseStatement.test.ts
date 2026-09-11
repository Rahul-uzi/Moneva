import { describe, it, expect } from 'vitest';
import {
  parseStatement, parseStatementDate, parseStatementAmount, inferDateOrder,
  splitCsvLine, importMutationId, assignImportIds, MAX_ROWS,
} from './parseStatement';

/**
 * Real bank exports, in the shapes they actually arrive in.
 *
 * Import is the one feature where a wrong reading is invisible AND bulk: a
 * parser that picks the balance column instead of the amount produces a
 * hundred plausible, entirely wrong rows in one tap, and nothing on screen
 * looks broken. So the tests below care more about which COLUMN was used and
 * what the dates mean than about whether anything parsed at all.
 */

const hdfc = `
Account Statement for A/c XXXXXXXX1234
Period: 01/06/2026 to 30/06/2026

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
05/06/2026,UPI-SWIGGY-9812,000000000,05/06/2026,250.00,,45320.00
07/06/2026,SALARY JUNE,REF991,07/06/2026,,65000.00,110320.00
15/06/2026,"NETFLIX ENTERTAINMENT, MUMBAI",000000000,15/06/2026,649.00,,109671.00

*** End of Statement ***
Total Withdrawals,899.00
`.trim();

const icici = `S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )
1,05-06-2026,05-06-2026,,UPI/P2M/512345/BLINKIT,320.00,0.00,45000.00
2,09-06-2026,09-06-2026,,NEFT FROM RAJESH KUMAR,0.00,2500.00,47500.00`;

const sbi = `Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance
05-Jun-2026,05-Jun-2026,BY TRANSFER-UPI/DR/512345/ZOMATO,512345,450.00,,12000.00
20-Jun-2026,20-Jun-2026,BY TRANSFER-NEFT,998877,,1500.00,13500.00`;

/** A generic export with one signed column, as many tools produce. */
const generic = `Date,Description,Amount
2026-06-05,Netflix,-649.00
2026-06-07,Refund,120.50`;

describe('reading a CSV line', () => {
  it('keeps a comma that is inside a quoted narration', () => {
    // Every bank produces these, and a naive split turns one row into two.
    expect(splitCsvLine('05/06/2026,"NETFLIX ENTERTAINMENT, MUMBAI",649.00'))
      .toEqual(['05/06/2026', 'NETFLIX ENTERTAINMENT, MUMBAI', '649.00']);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(splitCsvLine('a,"He said ""hi""",b')).toEqual(['a', 'He said "hi"', 'b']);
  });

  it('keeps empty cells, which is how a debit/credit pair says which it is', () => {
    expect(splitCsvLine('05/06/2026,SALARY,,65000.00')).toHaveLength(4);
  });
});

describe('the banks people actually use', () => {
  it('reads an HDFC export, past the preamble and the footer', () => {
    const out = parseStatement(hdfc);
    expect(out.layout?.date).toBe('Date');
    expect(out.layout?.debit).toBe('Withdrawal Amt.');
    expect(out.layout?.credit).toBe('Deposit Amt.');
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toMatchObject({
      description: 'UPI-SWIGGY-9812', amountMinor: 25000, direction: 'debit',
    });
    expect(out.rows[1]).toMatchObject({ amountMinor: 6500000, direction: 'credit' });
  });

  it('reads ICICI, whose amount headers carry a currency in brackets', () => {
    const out = parseStatement(icici);
    expect(out.layout?.debit).toBe('Withdrawal Amount (INR )');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ amountMinor: 32000, direction: 'debit' });
    expect(out.rows[1]).toMatchObject({ amountMinor: 250000, direction: 'credit' });
  });

  it('reads SBI, whose dates name the month', () => {
    const out = parseStatement(sbi);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].date.slice(0, 10)).toBe('2026-06-05');
    expect(out.rows[0]).toMatchObject({ amountMinor: 45000, direction: 'debit' });
  });

  it('reads a single signed amount column', () => {
    const out = parseStatement(generic);
    expect(out.layout?.amount).toBe('Amount');
    expect(out.rows[0]).toMatchObject({ amountMinor: 64900, direction: 'debit' });
    expect(out.rows[1]).toMatchObject({ amountMinor: 12050, direction: 'credit' });
  });
});

/**
 * The failure that would matter most, and would look like success.
 */
describe('never reading the balance as the amount', () => {
  it('ignores the closing balance column entirely', () => {
    const out = parseStatement(hdfc);
    // 45320.00 is the balance after the first row. If it were ever read as an
    // amount the file would import as a set of enormous, plausible numbers.
    expect(out.rows.map((r) => r.amountMinor)).toEqual([25000, 6500000, 64900]);
    expect(out.rows.map((r) => r.amountMinor)).not.toContain(4532000);
  });

  it('does not fall back to a balance column when there is no amount column', () => {
    // Date and balance only. There is nothing here to import, and inventing
    // amounts from the balance is far worse than refusing the file.
    const out = parseStatement('Date,Narration,Closing Balance\n05/06/2026,SWIGGY,45320.00');
    expect(out.layout).toBeNull();
    expect(out.rows).toEqual([]);
  });
});

/**
 * 01/02/2026 is 1 February to an Indian bank and 2 January to an American
 * one, and the file never says. Guessing wrong moves every row in the file
 * into a different month, silently.
 */
describe('working out what the dates mean', () => {
  it('settles day-first from a value that can only be a day', () => {
    expect(inferDateOrder(['05/06/2026', '19/06/2026', '01/07/2026'])).toBe('dmy');
  });

  it('settles month-first when the SECOND part is the one over 12', () => {
    expect(inferDateOrder(['06/19/2026', '06/05/2026'])).toBe('mdy');
  });

  it('recognises an ISO column', () => {
    expect(inferDateOrder(['2026-06-05', '2026-06-19'])).toBe('ymd');
  });

  it('falls back to day-first, which is what Indian banks write', () => {
    // Nothing here disambiguates - every part is 12 or under.
    expect(inferDateOrder(['05/06/2026', '07/08/2026'])).toBe('dmy');
  });

  it('uses the whole column, so one row cannot be read differently', () => {
    // The 19th settles it for every other row in the file, including the
    // ambiguous ones - which is the entire point of inferring per FILE.
    const out = parseStatement(
      'Date,Description,Amount\n05/06/2026,A,-100\n19/06/2026,B,-200',
    );
    expect(out.rows[0].date.slice(0, 10)).toBe('2026-06-05');
    expect(out.rows[1].date.slice(0, 10)).toBe('2026-06-19');
  });

  it('reads a named month regardless of the inferred order', () => {
    expect(parseStatementDate('05-Sep-26', 'mdy')?.slice(0, 10)).toBe('2026-09-05');
    expect(parseStatementDate('5 Sep 2026', 'dmy')?.slice(0, 10)).toBe('2026-09-05');
  });

  it('refuses a date that does not exist', () => {
    // Rolling 31 February into 3 March would be a silent, wrong answer.
    expect(parseStatementDate('31/02/2026', 'dmy')).toBeNull();
    expect(parseStatementDate('45/01/2026', 'dmy')).toBeNull();
  });

  it('reads a two-digit year on the right side of the century', () => {
    expect(parseStatementDate('05/06/26', 'dmy')?.slice(0, 4)).toBe('2026');
    expect(parseStatementDate('05/06/98', 'dmy')?.slice(0, 4)).toBe('1998');
  });
});

describe('reading an amount', () => {
  it('never goes through a float', () => {
    // parseFloat('1234.56') * 100 is 123455.99999999999, and this runs over a
    // whole file rather than one row.
    expect(parseStatementAmount('1234.56')?.minor).toBe(123456);
    expect(parseStatementAmount('0.07')?.minor).toBe(7);
  });

  it('reads the grouping and the currency banks put in the cell', () => {
    expect(parseStatementAmount('1,63,343.00')?.minor).toBe(16334300);
    expect(parseStatementAmount('INR 2,500.00')?.minor).toBe(250000);
    expect(parseStatementAmount('₹ 649')?.minor).toBe(64900);
  });

  it('reads all three ways a statement says "money out"', () => {
    expect(parseStatementAmount('-500.00')?.negative).toBe(true);
    expect(parseStatementAmount('(500.00)')?.negative).toBe(true);
    expect(parseStatementAmount('500.00 Dr')?.negative).toBe(true);
    expect(parseStatementAmount('500.00 Cr')?.negative).toBe(false);
  });

  it('refuses anything that is not an amount', () => {
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('n/a')).toBeNull();
    expect(parseStatementAmount('1.2.3')).toBeNull();
  });
});

describe('what it refuses, and says it refused', () => {
  it('reports the footer rows it skipped rather than dropping them silently', () => {
    const out = parseStatement(hdfc);
    // "*** End of Statement ***" and the totals line. A file that parsed
    // BADLY has to look different from one that merely had a footer, and the
    // only way to tell is by showing the count.
    expect(out.skipped.length).toBeGreaterThan(0);
    expect(out.skipped.every((s) => s.reason === 'no date')).toBe(true);
  });

  it('returns nothing at all when no header can be found', () => {
    const out = parseStatement('just some text\nand more text');
    expect(out.layout).toBeNull();
    expect(out.rows).toEqual([]);
  });

  it('skips a zero-amount row rather than importing it', () => {
    const out = parseStatement(
      'Date,Description,Debit,Credit\n05/06/2026,CARD CHECK,0.00,0.00',
    );
    expect(out.rows).toEqual([]);
    expect(out.skipped[0].reason).toBe('no amount');
  });
});

/**
 * Import is the operation people repeat - the same file twice, or an export
 * that overlaps the last one. The id is derived from the payment so the
 * server's uniqueness constraint absorbs the overlap.
 */
describe('importing the same thing twice', () => {
  const row = {
    date: '2026-06-05T00:00:00.000Z', description: 'Netflix',
    amountMinor: 64900, direction: 'debit' as const, line: 4,
  };

  it('gives the same payment the same id every time', () => {
    expect(importMutationId(row)).toBe(importMutationId({ ...row }));
  });

  it('ignores the line number, since an export moves rows around', () => {
    expect(importMutationId(row)).toBe(importMutationId({ ...row, line: 91 }));
  });

  it('ignores the spelling of the description', () => {
    expect(importMutationId(row)).toBe(importMutationId({ ...row, description: 'NETFLIX' }));
  });

  it('gives different payments different ids', () => {
    expect(importMutationId(row)).not.toBe(importMutationId({ ...row, amountMinor: 64901 }));
    expect(importMutationId(row)).not.toBe(
      importMutationId({ ...row, date: '2026-06-06T00:00:00.000Z' }));
    expect(importMutationId(row)).not.toBe(importMutationId({ ...row, direction: 'credit' }));
  });

  it('is a well-formed uuid, because the server stores it as one', () => {
    expect(importMutationId(row)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

/**
 * Two genuine payments that are identical in every recorded field.
 *
 * Coffee twice in a day at the same price. A second identical bus fare. Two
 * Rs 100 top-ups. These are ordinary, and every field this hashes - date,
 * direction, amount, description - is the same for both.
 *
 * Found by probing rather than by reasoning: the id function looked correct,
 * and quietly gave both rows the same id, so the server did exactly as asked
 * and dropped the second as a duplicate. Silently. It is the worst failure
 * this feature could have, because there is nothing on screen to notice.
 */
describe('two identical payments on the same day', () => {
  const twice = `Date,Description,Amount
02/06/2026,THIRD WAVE COFFEE,-250.00
02/06/2026,THIRD WAVE COFFEE,-250.00
02/06/2026,SWIGGY,-480.00`;

  it('gives them different ids, so neither is swallowed', () => {
    const { rows } = parseStatement(twice);
    expect(rows).toHaveLength(3);
    const ids = assignImportIds(rows);
    expect(new Set(ids).size).toBe(3);
  });

  it('still gives the same file the same ids on a second run', () => {
    // The whole point of deriving the id: importing twice must change nothing.
    const first = assignImportIds(parseStatement(twice).rows);
    const second = assignImportIds(parseStatement(twice).rows);
    expect(first).toEqual(second);
  });

  it('numbers repeats in file order, so an overlap still de-duplicates', () => {
    // The same two coffees, arriving inside a longer export.
    const longer = `Date,Description,Amount
01/06/2026,EARLIER ROW,-100.00
02/06/2026,THIRD WAVE COFFEE,-250.00
02/06/2026,THIRD WAVE COFFEE,-250.00`;
    const short = assignImportIds(parseStatement(twice).rows).slice(0, 2);
    const long = assignImportIds(parseStatement(longer).rows).slice(1);
    expect(long).toEqual(short);
  });

  it('keeps different payments apart even when they share a day', () => {
    const { rows } = parseStatement(twice);
    const ids = assignImportIds(rows);
    expect(ids[0]).not.toBe(ids[2]);
  });
});

describe('a file longer than one import can take', () => {
  const huge = () => {
    const lines = ['Date,Description,Amount'];
    for (let i = 0; i < MAX_ROWS + 50; i += 1) {
      lines.push(`02/06/2026,ROW ${i},-10.00`);
    }
    return lines.join('\n');
  };

  it('stops at the cap rather than building an unbounded array', () => {
    // This runs in a WebView on a phone. An unbounded file means an unbounded
    // array, an unbounded render and an unbounded loop of requests, and the
    // way that fails is the app freezing with no explanation.
    const out = parseStatement(huge());
    expect(out.rows).toHaveLength(MAX_ROWS);
  });

  it('says it truncated, rather than importing a prefix and reporting success', () => {
    expect(parseStatement(huge()).truncatedAt).toBe(MAX_ROWS);
  });

  it('says nothing about truncation for an ordinary file', () => {
    expect(parseStatement(hdfc).truncatedAt).toBeUndefined();
  });
});

describe('the id has the entropy it appears to have', () => {
  it('does not derive half of itself from the other half', () => {
    // The first version built the second 64 bits with imul(h1, 31) and
    // imul(h2, 17) - which looks like 128 bits of id and is really 64. A
    // collision here does not corrupt a row, it silently discards one.
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) {
      seen.add(importMutationId({
        date: '2026-06-02T00:00:00.000Z', description: `PAYEE ${i}`,
        amountMinor: 1000 + i, direction: 'debit', line: i,
      }));
    }
    expect(seen.size).toBe(4000);
  });

  it('varies every half of the id when the input changes', () => {
    const base = {
      date: '2026-06-02T00:00:00.000Z', description: 'A',
      amountMinor: 1000, direction: 'debit' as const, line: 1,
    };
    const a = importMutationId(base).replace(/-/g, '');
    const b = importMutationId({ ...base, description: 'B' }).replace(/-/g, '');
    expect(a.slice(0, 16)).not.toBe(b.slice(0, 16));
    expect(a.slice(16)).not.toBe(b.slice(16));
  });
});

/**
 * "CSV" is not one format.
 *
 * A bank exporting for a European locale writes semicolons, because the comma
 * is its decimal point. An export that has been through a spreadsheet often
 * arrives tab-separated. Both were refused outright - "could not find the
 * columns" - for files that are perfectly well formed.
 */
describe('files that are not comma-separated', () => {
  it('reads a semicolon-separated export', () => {
    const out = parseStatement(
      'Date;Narration;Withdrawal Amt.;Deposit Amt.;Closing Balance\n'
      + '05/06/2026;UPI-SWIGGY-9812;250.00;;45320.00\n'
      + '07/06/2026;SALARY JUNE;;65000.00;110320.00',
    );
    expect(out.layout?.delimiter).toBe(';');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ amountMinor: 25000, direction: 'debit' });
    expect(out.rows[1]).toMatchObject({ amountMinor: 6500000, direction: 'credit' });
  });

  it('reads a tab-separated export', () => {
    const out = parseStatement(
      'Date\tDescription\tAmount\n2026-06-05\tNetflix\t-649.00\n2026-06-07\tRefund\t120.50',
    );
    expect(out.layout?.delimiter).toBe('\t');
    expect(out.rows).toHaveLength(2);
  });

  it('is not fooled by a narration full of commas', () => {
    // Chosen by which delimiter splits the file CONSISTENTLY, not by which
    // appears most - the commas here are inside one field.
    const out = parseStatement(
      'Date;Narration;Amount\n'
      + '05/06/2026;PAID TO A, B, C AND D;-250.00\n'
      + '07/06/2026;ANOTHER, LONGER, NARRATION;-100.00',
    );
    expect(out.layout?.delimiter).toBe(';');
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].description).toBe('PAID TO A, B, C AND D');
  });

  it('still reads an ordinary comma file', () => {
    expect(parseStatement(hdfc).layout?.delimiter).toBe(',');
  });
});

/**
 * The id must not be a way to ask questions about other people's money.
 *
 * client_mutation_id is unique across the whole table, and these ids are
 * DERIVED from the payment - so without an owner in the basis, anyone could
 * construct the id for a guessed payment ("Rs 50,000 to X on the 3rd"),
 * import it, and read the answer off the response. The endpoint distinguished
 * "already used by another account" from "created", which is a definitive yes
 * or no about a stranger's ledger.
 *
 * Scoping the id to the user removes the question rather than declining to
 * answer it.
 */
describe('ids are scoped to the person importing', () => {
  const row = {
    date: '2026-06-05T00:00:00.000Z', description: 'Netflix',
    amountMinor: 64900, direction: 'debit' as const, line: 4,
  };

  it('gives two people different ids for the same payment', () => {
    const mine = importMutationId(row, 0, 'user-aaaa');
    const theirs = importMutationId(row, 0, 'user-bbbb');
    expect(mine).not.toBe(theirs);
  });

  it('is still stable for the same person, so re-importing is harmless', () => {
    expect(importMutationId(row, 0, 'user-aaaa')).toBe(importMutationId(row, 0, 'user-aaaa'));
  });

  it('carries the owner through a whole file', () => {
    const rows = parseStatement(
      'Date,Description,Amount\n05/06/2026,Netflix,-649.00\n06/06/2026,Spotify,-119.00',
    ).rows;
    const mine = assignImportIds(rows, 'user-aaaa');
    const theirs = assignImportIds(rows, 'user-bbbb');
    expect(mine).toHaveLength(2);
    // Not one id in common - so no crafted row can ever collide with another
    // account's, and the question cannot be asked.
    expect(mine.filter((id) => theirs.includes(id))).toEqual([]);
  });

  it('still keeps two identical payments apart within one person file', () => {
    const rows = parseStatement(
      'Date,Description,Amount\n05/06/2026,Coffee,-250.00\n05/06/2026,Coffee,-250.00',
    ).rows;
    expect(new Set(assignImportIds(rows, 'user-aaaa')).size).toBe(2);
  });
});
