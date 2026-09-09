/**
 * Files the payments that have earned it, with nobody watching.
 *
 * This is the only place in the app that writes a transaction without a person
 * having looked at it, so it is written to do as little as possible: it asks
 * `decideAutoAdd` for permission, and everything it does after that is either
 * refusing or recording.
 *
 * Two rules shape the error handling. A payment that fails to file is LEFT IN
 * THE QUEUE rather than acknowledged, so it reappears in the inbox for a human
 * - the failure degrades to the old behaviour instead of disappearing. And a
 * payment is acknowledged only after the server has confirmed the write, so a
 * dropped connection costs a duplicate proposal (harmless - confirming is
 * idempotent) rather than a lost payment.
 */
import { apiClient } from './apiClient';
import {
  drainProposals, acknowledgeProposal, getCaptureStatus,
} from './notificationCapture';
import {
  loadAutoAddSettings, loadTrustLedger, rememberOrigin, AUTO_ADDED_DEVICE_ID,
} from './autoAddStore';
import { pickAutoAddable, resolveAutoAccount, trustKey } from '../utils/autoAdd';
import { describeProposal } from '../components/financial/paymentInboxRules';
import { suggestCategory } from '../utils/categorise';
import type { Account, Category, Transaction } from '../types/api';
import type { AlertProposal } from '../utils/paymentAlert';

export interface AutoAddOutcome {
  /** How many were filed without asking. */
  added: number;
  /** How many were looked at and left for the user. */
  left: number;
  /** Why nothing ran at all, when nothing did. */
  skipped?: string;
}

/**
 * Files whatever is due, and leaves the rest.
 *
 * `now` and the account list are arguments so this can be exercised without a
 * device; everything it touches beyond them is behind the two services above.
 */
export const runAutoAdd = async (
  accounts: readonly Account[],
  now: number,
  categories: readonly Category[] = [],
  history: readonly Transaction[] = [],
): Promise<AutoAddOutcome> => {
  const settings = loadAutoAddSettings();
  if (!settings.enabled) return { added: 0, left: 0, skipped: 'switched off' };

  const status = await getCaptureStatus();
  if (!status.capturing || !status.granted) {
    return { added: 0, left: 0, skipped: 'not capturing' };
  }

  // Never a guess about which account. With more than one there is no way to
  // tell from an alert, so everything keeps its tap.
  const accountId = resolveAutoAccount(accounts);
  if (!accountId) return { added: 0, left: 0, skipped: 'more than one account' };

  const proposals = await drainProposals();
  if (proposals.length === 0) return { added: 0, left: 0 };

  const ledger = loadTrustLedger();
  const { auto, ask } = pickAutoAddable(proposals, ledger, settings, now, accountId);

  let added = 0;
  for (const p of auto) {
    if (await fileOne(p, accountId, categories, history)) added += 1;
  }
  return { added, left: ask.length + (auto.length - added) };
};

/**
 * The category to file this under, or none.
 *
 * Only a suggestion drawn from the user's OWN history counts here - the case
 * where they have already put this merchant in a category themselves, so
 * repeating it is not a guess but their decision applied again. The rule-based
 * suggestions ('merchant', 'keyword') are the app's opinion, and with nobody
 * watching, the app's opinion filed silently is how a budget quietly starts
 * describing something that did not happen.
 *
 * Leaving it null is not free either, which is why this exists at all: budgets
 * sum on a category, so an uncategorised row is invisible to every one of them
 * and "left to spend" reads higher than it is - the optimistic direction, and
 * the one nobody goes looking for.
 */
const categoryFor = (
  proposal: AlertProposal,
  categories: readonly Category[],
  history: readonly Transaction[],
): string | null => {
  // A transfer has no spending category, and this never files one anyway.
  if (proposal.kind === 'transfer') return null;
  try {
    const suggestion = suggestCategory({
      merchant: proposal.merchant,
      text: proposal.merchant ?? '',
      kind: proposal.kind,
      categories: categories as never,
      history: history as never,
    });
    return suggestion.source === 'history' ? suggestion.categoryId : null;
  } catch {
    return null;
  }
};

/** One payment, filed. */
const fileOne = async (
  proposal: AlertProposal,
  accountId: string,
  categories: readonly Category[],
  history: readonly Transaction[],
): Promise<boolean> => {
  try {
    await apiClient.post<Transaction>('/transactions', {
      client_mutation_id: proposal.clientMutationId,
      account_id: accountId,
      to_account_id: null,
      category_id: categoryFor(proposal, categories, history),
      transaction_type: proposal.kind === 'debit' ? 'expense' : 'income',
      amount_minor: proposal.amountPaise,
      currency: 'INR',
      description: describeProposal(proposal.merchant, proposal.sources),
      transaction_date: new Date(proposal.postedAt).toISOString(),
      // The marker that makes this row findable and undoable later.
      device_id: AUTO_ADDED_DEVICE_ID,
    });
  } catch {
    // Left in the queue on purpose: it will be offered in the inbox instead,
    // which is the behaviour this feature replaces and a safe place to land.
    return false;
  }

  // Noted before acknowledging, so that a row this device filed can always be
  // traced back to the pattern that filed it when the user undoes it.
  const key = trustKey(proposal);
  if (key) rememberOrigin(proposal.clientMutationId, key);

  // Only after the write is confirmed. Acknowledging first would lose the
  // payment entirely if the write then failed.
  await acknowledgeProposal(proposal);
  return true;
};
