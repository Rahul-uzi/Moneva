import { BANKS, MERCHANTS, WALLETS, type TransferDestination } from '../data/transferDestinations';

/**
 * The thinking behind the add sheet, kept out of the component so it can be
 * tested without rendering anything.
 */

export type EntryType = 'expense' | 'income';

interface PastRow {
  description?: string | null;
  transaction_type?: string;
  transaction_date?: string;
}

/**
 * The payee half of a stored description.
 *
 * The sheet has always saved "Payee - note", so the name is everything before
 * the first " - ". Rows the SMS reader wrote look nothing like a name
 * ("UPI/DR/412345678901/GOPAL K/SBIN/..."), and offering one back as a
 * suggestion would be noise, so anything carrying a long run of digits or
 * running past a sensible name length is left out.
 */
export const payeeFromDescription = (description?: string | null): string | null => {
  const head = String(description || '').split(' - ')[0].trim();
  if (head.length < 2 || head.length > 28) return null;
  if (/\d{5,}/.test(head)) return null;
  if (/[/|]/.test(head)) return null;
  return head;
};

/** "Payee - note", or whichever half exists. Null when neither does. */
export const buildDescription = (payee: string, note: string): string | null => {
  const p = payee.trim();
  const n = note.trim();
  if (p && n) return `${p} - ${n}`;
  return p || n || null;
};

export interface PayeeSuggestion {
  label: string;
  /** Where it came from - a name you have used beats a catalogue entry. */
  source: 'recent' | 'catalogue';
  destination?: TransferDestination;
}

/** The catalogue, in the order someone is most likely to want it. */
const CATALOGUE: TransferDestination[] = [...MERCHANTS, ...WALLETS, ...BANKS];

/**
 * Who this entry is probably for, as the user types.
 *
 * With nothing typed: the people and places they have actually used, newest
 * first - the most likely next entry is a repeat. With something typed:
 * anything containing it, names that START with it ranked first, because
 * "sw" should offer Swiggy before Instamart.
 *
 * Income has no catalogue. Nobody's salary comes from "Zomato", so offering
 * shops as income sources is the kind of help that makes a form feel dumb.
 */
export const payeeSuggestions = (input: {
  query: string;
  type: EntryType;
  history: PastRow[];
  limit?: number;
}): PayeeSuggestion[] => {
  const { query, type, history, limit = 6 } = input;
  const q = query.trim().toLowerCase();

  const recent: PayeeSuggestion[] = [];
  const seen = new Set<string>();
  const ordered = [...history].sort((a, b) =>
    String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')),
  );
  for (const row of ordered) {
    if (row.transaction_type && row.transaction_type !== type) continue;
    const name = payeeFromDescription(row.description);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({ label: name, source: 'recent' });
  }

  const catalogue: PayeeSuggestion[] =
    type === 'expense'
      ? CATALOGUE.filter((d) => !seen.has(d.label.toLowerCase())).map((d) => ({
          label: d.label,
          source: 'catalogue' as const,
          destination: d,
        }))
      : [];

  if (!q) {
    // Nothing typed: what they have used, then - only for a new user with no
    // history yet - the apps people use most.
    const pool = recent.length > 0 ? recent : catalogue.filter((c) => c.destination?.kind === 'merchant');
    return pool.slice(0, limit);
  }

  const all = [...recent, ...catalogue];
  // The exact name already typed is not a suggestion - it is the answer.
  const hits = all.filter((s) => {
    const l = s.label.toLowerCase();
    return l.includes(q) && l !== q;
  });
  const starts = hits.filter((s) => s.label.toLowerCase().startsWith(q));
  const inside = hits.filter((s) => !s.label.toLowerCase().startsWith(q));
  return [...starts, ...inside].slice(0, limit);
};

/** A datetime-local value ("2026-10-09T20:40") as a Date in local time. */
const parseLocal = (value: string): Date | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * The date pill's label - what a person would say, not what the field holds.
 *
 * "Now" only while the user has not touched it: the field is stamped when
 * the sheet opens, and a figure that ticks out of date while somebody types
 * an amount would look like a bug. Once they choose a time, it says the time.
 */
export const describeWhen = (value: string, touched: boolean, now: Date = new Date()): string => {
  if (!touched) return 'Now';
  const d = parseLocal(value);
  if (!d) return 'Now';

  const time = d
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, ' ')
    .toLowerCase();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay(d, now)) return `Today, ${time}`;
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`;
  const day = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${day}, ${time}`;
};
