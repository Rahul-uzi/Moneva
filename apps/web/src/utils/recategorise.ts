import { suggestCategory } from './categorise';
import { subscriptionName } from './subscriptions';
import type { Category, Transaction } from '../types/api';

/**
 * Re-reading categories that were filed by a matcher that was wrong.
 *
 * WHY HISTORY IS NOT USED HERE. The categoriser's first and strongest signal
 * is what this person filed the same payee under last time. That signal is
 * exactly what broke: a bare "Google Pay" row matched every payment made
 * through that app, so its category spread everywhere. Re-running with
 * history on would read those wrong rows back and faithfully reproduce them.
 * This pass is the merchant table and the keyword table only - the two
 * signals that never learned anything from the mistake.
 *
 * WHAT IT WILL NOT DO. It never clears a category. A row it cannot place is a
 * row it leaves exactly as it is, because "I don't know" is not a reason to
 * throw away something the person may have chosen by hand. It only proposes a
 * change where it has a positive answer AND that answer differs from what is
 * stored.
 *
 * It also proposes rather than writes. Every change is listed before anything
 * is sent, because this edits a ledger in bulk and a bulk edit nobody saw is
 * how you lose trust in an app that holds your money.
 */

export interface Proposal {
  id: string;
  description: string;
  /** Null when the row has no category at all today. */
  fromName: string | null;
  toId: string;
  toName: string;
  /** Short sentence for the preview, straight from the categoriser. */
  reason: string;
}

export const planRecategorise = (
  transactions: readonly Transaction[],
  categories: readonly Category[],
): Proposal[] => {
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const out: Proposal[] = [];

  for (const tx of transactions) {
    // Transfers have no spending category by design, and an income row's
    // category is Salary or Other Income - neither was touched by the bug.
    if (tx.transaction_type !== 'expense') continue;

    const raw = tx.description || '';
    if (!raw.trim()) continue;

    const s = suggestCategory({
      merchant: subscriptionName(raw) || raw,
      text: raw,
      kind: 'debit',
      categories: categories as Category[],
      history: [],            // deliberately empty - see the note above
    });

    if (!s.categoryId) continue;              // nothing confident to say
    if (s.categoryId === tx.category_id) continue;  // already right

    out.push({
      id: tx.id,
      description: raw,
      fromName: tx.category_id ? nameById.get(tx.category_id) ?? null : null,
      toId: s.categoryId,
      toName: s.categoryName || '',
      reason: s.reason || '',
    });
  }

  return out;
};
