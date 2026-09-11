/**
 * Reading a bank's CSV export into transactions.
 *
 * The notification listener can only see the future - it cannot know about the
 * years before it was installed, and no permission exists that would let it.
 * A statement export is the only honest way to bring that history in.
 *
 * Every bank writes a different file, and none of them writes a clean one:
 *
 *   HDFC   Date, Narration, Chq./Ref.No., Value Dt, Withdrawal Amt., Deposit Amt., Closing Balance
 *   ICICI  S No., Value Date, Transaction Date, Cheque Number, Transaction Remarks,
 *          Withdrawal Amount (INR ), Deposit Amount (INR ), Balance (INR )
 *   SBI    Txn Date, Value Date, Description, Ref No./Cheque No., Debit, Credit, Balance
 *   Axis   Tran Date, CHQNO, PARTICULARS, DR, CR, BAL, SOL
 *
 * plus a dozen lines of account preamble above the header, footer totals
 * below it, and dates written four different ways. So this sniffs rather than
 * assumes - and, crucially, REPORTS what it decided. A parser that quietly
 * reads the "Closing Balance" column as the amount produces a file of
 * plausible, entirely wrong numbers, and the only defence is showing the user
 * which column it used before anything is written.
 */

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export interface ParsedRow {
  /** ISO date, midnight UTC. */
  date: string;
  description: string;
  amountMinor: number;
  direction: 'debit' | 'credit';
  /** Which line of the file this came from, for reporting. */
  line: number;
}

export interface SkippedRow {
  line: number;
  reason: 'no date' | 'no amount' | 'zero amount' | 'not a row';
  text: string;
}

export interface StatementLayout {
  /** What separated the columns - a comma, a semicolon, or a tab. */
  delimiter: string;
  date: string;
  description: string;
  /** Set when the file has separate money-out and money-in columns. */
  debit?: string;
  credit?: string;
  /** Set instead when one column carries a signed amount. */
  amount?: string;
  dateOrder: DateOrder;
  headerLine: number;
}

export interface ParsedStatement {
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Null when no header could be found at all. */
  layout: StatementLayout | null;
  /**
   * Set when the file held more rows than one import will take.
   * `rows` is the first MAX_ROWS; the rest were not read.
   */
  truncatedAt?: number;
}

/**
 * The most rows one import will take.
 *
 * This runs in a WebView on a phone. An unbounded file means an unbounded
 * array, a render of an unbounded preview, and a loop of unbounded requests -
 * and the way that fails is the app freezing with no explanation, which is
 * indistinguishable from it crashing. Ten thousand rows is roughly a decade
 * of an ordinary account; past that the honest answer is "split the file",
 * said out loud rather than by hanging.
 */
export const MAX_ROWS = 10_000;

/* ---------------------------------------------------------------------------
   CSV

   Written out rather than pulled in, because the only hard part is quoted
   fields - a narration containing a comma, which every bank produces - and
   that is a dozen lines. A dependency for this would be a dependency to keep
   up to date forever.
   --------------------------------------------------------------------------- */

export function splitCsvLine(line: string, delimiter = ','): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }

  cells.push(cell.trim());
  return cells;
}

/**
 * Which character separates the columns.
 *
 * "CSV" is not one format. A bank exporting for a European locale writes
 * semicolons, because the comma is its decimal point; an export that has been
 * through a spreadsheet often arrives tab-separated. Both were refused
 * outright - no header found, no explanation beyond "could not find the
 * columns", for a file that is perfectly well formed.
 *
 * Chosen by which candidate splits the file most CONSISTENTLY, not by which
 * appears most. A narration full of commas would win on count alone; only the
 * real delimiter produces the same number of cells on every line.
 */
export function detectDelimiter(lines: readonly string[]): string {
  const candidates = [',', ';', '\t', '|'];
  const sample = lines.filter((l) => l.trim() !== '').slice(0, 30);
  if (sample.length === 0) return ',';

  let best = ',';
  let bestScore = -1;

  for (const delimiter of candidates) {
    const counts = sample.map((l) => splitCsvLine(l, delimiter).length);
    const widest = Math.max(...counts);
    if (widest < 2) continue;                       // never actually splits

    // How many lines agree on the most common width.
    const tally = new Map<number, number>();
    for (const n of counts) tally.set(n, (tally.get(n) ?? 0) + 1);
    const agreement = Math.max(...tally.values()) / counts.length;

    // Agreement first, then width - a delimiter that splits every line into
    // the same 7 columns beats one that splits them into a ragged 2.
    const score = agreement * 100 + Math.min(widest, 20);
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }

  return best;
}

/* ---------------------------------------------------------------------------
   Finding the header

   Banks put the account holder, the address, the period and a blank line or
   three above the actual column names. The header is found by looking for the
   line that names a date AND either a description or an amount - not by
   assuming it is first.
   --------------------------------------------------------------------------- */

const DATE_HEADER = /^(txn|tran|transaction|value|posting)?\s*(date|dt)\.?$/i;
const DESC_HEADER = /^(narration|description|particulars|remarks|details|transaction remarks|narrative)$/i;
const DEBIT_HEADER = /^(withdrawal|debit|dr|withdrawal amt|withdrawal amount|debit amount|paid out)\b/i;
const CREDIT_HEADER = /^(deposit|credit|cr|deposit amt|deposit amount|credit amount|paid in)\b/i;
const AMOUNT_HEADER = /^(amount|amt|transaction amount|value)\b/i;

/**
 * Columns that must never be read as the transaction amount.
 *
 * A running balance sits in every statement, is the same shape as an amount,
 * and is usually the LAST numeric column - so a parser that takes "the number
 * column" lands on it and produces a file of plausible, wholly wrong figures.
 * Rejected by name before anything else is considered.
 */
const BALANCE_HEADER = /balance|bal\b|closing|opening/i;

const cleanHeader = (h: string) =>
  h.replace(/\(.*?\)/g, '').replace(/[^a-zA-Z ]/g, ' ').replace(/\s+/g, ' ').trim();

function findHeader(lines: string[][]): { index: number; cells: string[] } | null {
  for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
    const cells = lines[i].map(cleanHeader);
    const hasDate = cells.some((c) => DATE_HEADER.test(c));
    if (!hasDate) continue;

    const hasText = cells.some((c) => DESC_HEADER.test(c));
    const hasMoney = cells.some(
      (c) => !BALANCE_HEADER.test(c)
        && (DEBIT_HEADER.test(c) || CREDIT_HEADER.test(c) || AMOUNT_HEADER.test(c)),
    );
    if (hasText || hasMoney) return { index: i, cells: lines[i] };
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Dates

   01/02/2026 is the 1st of February to an Indian bank and the 2nd of January
   to an American one, and the file never says which. Guessing wrong moves
   every transaction in the file to a different month, silently.

   So the order is INFERRED from the whole column: any value with a first part
   above 12 can only be a day, and settles it for every other row. Only when
   nothing in the file disambiguates does it fall back - to day-first, which
   is what Indian banks write.
   --------------------------------------------------------------------------- */

const DATE_PARTS = /^(\d{1,4})[/\-. ](\d{1,2})[/\-. ](\d{2,4})$/;
const MONTH_NAMES = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
const TEXT_DATE = /^(\d{1,2})[\-/ ]([a-z]{3})[a-z]*[\-/ ](\d{2,4})$/i;

export function inferDateOrder(samples: readonly string[]): DateOrder {
  let firstOver12 = 0;
  let secondOver12 = 0;
  let isoLike = 0;

  for (const raw of samples) {
    const m = DATE_PARTS.exec(raw.trim());
    if (!m) continue;
    const [, a, b] = m;
    if (a.length === 4) { isoLike += 1; continue; }
    if (Number(a) > 12) firstOver12 += 1;
    if (Number(b) > 12) secondOver12 += 1;
  }

  if (isoLike > 0 && firstOver12 === 0 && secondOver12 === 0) return 'ymd';
  if (secondOver12 > 0 && firstOver12 === 0) return 'mdy';
  // Day-first by default: it is what Indian banks write, and it is also the
  // safer wrong answer here, because a wrong month-first reading of an Indian
  // file mangles every row while the reverse merely mangles some.
  return 'dmy';
}

const TWO_DIGIT_PIVOT = 70;   // 70 -> 1970, 69 -> 2069

const fourDigitYear = (year: number): number => {
  if (year >= 1000) return year;
  return year >= TWO_DIGIT_PIVOT ? 1900 + year : 2000 + year;
};

export function parseStatementDate(raw: string, order: DateOrder): string | null {
  const text = raw.trim();
  if (!text) return null;

  // "05-Sep-26", "5 Sep 2026" - unambiguous, so the inferred order is ignored.
  const named = TEXT_DATE.exec(text);
  if (named) {
    const month = MONTH_NAMES.indexOf(named[2].toLowerCase());
    if (month < 0) return null;
    return iso(fourDigitYear(Number(named[3])), month + 1, Number(named[1]));
  }

  const m = DATE_PARTS.exec(text);
  if (!m) return null;
  const [, a, b, c] = m;

  let year: number;
  let month: number;
  let day: number;

  if (order === 'ymd' || a.length === 4) {
    year = Number(a); month = Number(b); day = Number(c);
  } else if (order === 'mdy') {
    month = Number(a); day = Number(b); year = fourDigitYear(Number(c));
  } else {
    day = Number(a); month = Number(b); year = fourDigitYear(Number(c));
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return iso(year, month, day);
}

const iso = (year: number, month: number, day: number): string | null => {
  const at = Date.UTC(year, month - 1, day);
  const d = new Date(at);
  // Rejects the 31st of February rather than letting it roll into March.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d.toISOString();
};

/* ---------------------------------------------------------------------------
   Amounts
   --------------------------------------------------------------------------- */

/**
 * A statement amount into integer paise, or null.
 *
 * Never via a float: parseFloat('1234.56') * 100 is 123455.99999999999, and
 * this runs over a whole file, so the error is not theoretical.
 */
export function parseStatementAmount(raw: string): { minor: number; negative: boolean } | null {
  let text = raw.trim();
  if (!text) return null;

  // "1,234.56 Dr", "(1,234.56)", "-1234.56" all mean money out.
  let negative = /^\(.*\)$/.test(text) || /(^-)|(\bdr\b)/i.test(text);
  text = text
    .replace(/[()]/g, '')
    .replace(/\b[dc]r\b/gi, '')
    .replace(/(inr|rs\.?|₹)/gi, '')
    .replace(/[,\s]/g, '')
    .replace(/^[+-]/, (sign) => { if (sign === '-') negative = true; return ''; });

  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;

  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? { minor, negative } : null;
}

/* ---------------------------------------------------------------------------
   The whole file
   --------------------------------------------------------------------------- */

const findColumn = (cells: string[], test: RegExp, reject?: RegExp): number =>
  cells.findIndex((c) => {
    const clean = cleanHeader(c);
    if (reject && reject.test(clean)) return false;
    return test.test(clean);
  });

export function parseStatement(text: string): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l)
    .filter((l, i, all) => l.trim() !== '' || i < all.length);

  // "CSV" is not one format - see detectDelimiter. Decided once, from the
  // whole file, so a comma inside one narration cannot change how the rest is
  // read.
  const delimiter = detectDelimiter(lines);
  const grid = lines.map((l) => splitCsvLine(l, delimiter));
  const header = findHeader(grid);
  if (!header) return { rows: [], skipped: [], layout: null };

  const cells = header.cells;
  const dateAt = findColumn(cells, DATE_HEADER);
  const descAt = findColumn(cells, DESC_HEADER);
  const debitAt = findColumn(cells, DEBIT_HEADER, BALANCE_HEADER);
  const creditAt = findColumn(cells, CREDIT_HEADER, BALANCE_HEADER);
  const amountAt = findColumn(cells, AMOUNT_HEADER, BALANCE_HEADER);

  const hasPair = debitAt >= 0 && creditAt >= 0;
  if (dateAt < 0 || (!hasPair && amountAt < 0)) {
    return { rows: [], skipped: [], layout: null };
  }

  const body = grid.slice(header.index + 1);

  const order = inferDateOrder(
    body.map((r) => r[dateAt] ?? '').filter(Boolean),
  );

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  let truncatedAt: number | undefined;

  body.forEach((row, i) => {
    if (rows.length >= MAX_ROWS) {
      // Recorded once, so the sheet can say so rather than silently importing
      // a prefix of the file and reporting success.
      if (truncatedAt === undefined) truncatedAt = MAX_ROWS;
      return;
    }

    const line = header.index + 2 + i;   // 1-based, and past the header
    const joined = row.join(',').trim();
    if (!joined) return;                 // blank lines are not worth reporting

    const date = parseStatementDate(row[dateAt] ?? '', order);
    if (!date) {
      // Footer totals and page breaks land here. They are not errors, but the
      // count is worth showing so a file that parsed BADLY looks different
      // from one that merely had a footer.
      skipped.push({ line, reason: 'no date', text: joined.slice(0, 80) });
      return;
    }

    let amountMinor: number | null = null;
    let direction: 'debit' | 'credit' | null = null;

    if (hasPair) {
      const out = parseStatementAmount(row[debitAt] ?? '');
      const inn = parseStatementAmount(row[creditAt] ?? '');
      if (out && out.minor > 0) { amountMinor = out.minor; direction = 'debit'; }
      else if (inn && inn.minor > 0) { amountMinor = inn.minor; direction = 'credit'; }
    } else {
      const value = parseStatementAmount(row[amountAt] ?? '');
      if (value) {
        amountMinor = value.minor;
        direction = value.negative ? 'debit' : 'credit';
      }
    }

    if (amountMinor === null || direction === null) {
      skipped.push({ line, reason: 'no amount', text: joined.slice(0, 80) });
      return;
    }
    if (amountMinor === 0) {
      skipped.push({ line, reason: 'zero amount', text: joined.slice(0, 80) });
      return;
    }

    rows.push({
      date,
      description: (descAt >= 0 ? row[descAt] ?? '' : '').trim(),
      amountMinor,
      direction,
      line,
    });
  });

  return {
    rows,
    skipped,
    truncatedAt,
    layout: {
      delimiter,
      date: cells[dateAt],
      description: descAt >= 0 ? cells[descAt] : '',
      debit: hasPair ? cells[debitAt] : undefined,
      credit: hasPair ? cells[creditAt] : undefined,
      amount: hasPair ? undefined : cells[amountAt],
      dateOrder: order,
      headerLine: header.index + 1,
    },
  };
}

/**
 * A stable identity for an imported row.
 *
 * Import is the operation people repeat: the same file twice, or this month's
 * export which overlaps last month's. Deriving the id from the payment itself
 * means the server's uniqueness constraint absorbs the overlap, so re-importing
 * is harmless rather than a second copy of everything.
 *
 * Deliberately NOT random, and deliberately not including the line number -
 * the same payment sits on a different line in a different export.
 *
 * `occurrence` is what stops the whole idea eating data. Buying coffee twice
 * in one day at the same price is completely ordinary, and those two rows are
 * identical in every field this hashes - so without a counter they collapse
 * to one id and the server, doing exactly what it was asked, treats the
 * second as a duplicate and drops it. Silently. Use `assignImportIds` rather
 * than calling this directly; it does the counting.
 */
export function importMutationId(row: ParsedRow, occurrence = 0, owner = ''): string {
  /* `owner` is what keeps this from being a way to ask questions about other
     people's money.

     The id is derived from the payment, and client_mutation_id is unique
     across the whole table - so without the owner in the basis, anyone could
     construct the id for a GUESSED payment ("Rs 50,000 to X on the 3rd") and
     import it. If the response differed between "already used" and "created",
     and it did, that is a definitive answer about a stranger's ledger.

     Scoping the id to the user removes the question rather than refusing to
     answer it: two people importing the same statement now produce different
     ids, which is also simply more correct - they are different transactions
     in different ledgers. */
  const basis = `import|${owner}|${row.date.slice(0, 10)}|${row.direction}|${row.amountMinor}|`
    + row.description.toLowerCase().replace(/[^a-z0-9]+/g, '')
    + `|${occurrence}`;

  // Four independent seeds. The previous version derived the second half of
  // the id from the first (`imul(h1, 31)`), which looks like 128 bits and is
  // really 64 - and a collision here does not corrupt a row, it silently
  // discards one, which is the failure that is hardest to notice.
  const hash = (seed: number): number => {
    let h = seed >>> 0;
    for (let i = 0; i < basis.length; i += 1) {
      h = Math.imul(h ^ basis.charCodeAt(i), 0x01000193) >>> 0;
    }
    return h >>> 0;
  };

  const hex = (n: number) => n.toString(16).padStart(8, '0');
  const raw = hex(hash(0x811c9dc5)) + hex(hash(0x1b873593))
    + hex(hash(0xcc9e2d51)) + hex(hash(0x85ebca6b));

  const variant = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-5${raw.slice(13, 16)}-`
    + `${variant}${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
}

/**
 * Ids for a whole file, with genuine repeats kept apart.
 *
 * Rows identical in date, direction, amount and description are numbered in
 * the order the file lists them. A bank export lists a given day in a
 * consistent order, so the same payment keeps the same number across two
 * exports and the overlap still de-duplicates.
 *
 * Where that assumption fails - an export that reorders one day's rows - the
 * result is a visible duplicate the user can delete, rather than a payment
 * that quietly never arrived. That is the right way round: one of these can
 * be seen and fixed, the other cannot.
 */
export function assignImportIds(rows: readonly ParsedRow[], owner = ''): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = `${row.date.slice(0, 10)}|${row.direction}|${row.amountMinor}|`
      + row.description.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return importMutationId(row, occurrence, owner);
  });
}
