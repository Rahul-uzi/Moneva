/**
 * The decisions the payment inbox makes, separated from how it draws them.
 *
 * These three rules are the difference between a captured alert becoming the
 * right row and the wrong one, and every one of them was previously written
 * inline in JSX where nothing could reach it. The direction of a transaction
 * and the account it lands in are not presentation, so they are tested here
 * rather than inferred from a rendered screen.
 */
import type { SmsKind } from '../../utils/smsParse';
import { isPaymentApp } from '../../utils/paymentAlert';
import { brandNameIn } from '../../utils/brandMark';

/** What the server should be told to create, or why we cannot yet say. */
export type ConfirmDecision =
  | {
      ok: true;
      transactionType: 'expense' | 'income' | 'transfer';
      /** Only a transfer has a far side; anything else must send null. */
      toAccountId: string | null;
    }
  | { ok: false; message: string };

/**
 * Whether this proposal can be filed, and as what.
 *
 * The three-way mapping is the point. A two-way debit/credit ternary - which
 * is what this was - files a transfer as INCOME, so moving your own money
 * between your own accounts is counted as money you earned, and every
 * "left to spend" figure in the app grows by the amount you moved.
 */
export function decideConfirm(
  kind: SmsKind,
  accountId: string | null | undefined,
  toAccountId: string | null | undefined,
): ConfirmDecision {
  if (!accountId) {
    return { ok: false, message: 'Add an account first, then confirm this payment.' };
  }

  if (kind === 'transfer') {
    // The backend rejects a transfer with no destination, but the reason has
    // to be said in the user's terms before it gets that far.
    if (!toAccountId) {
      return {
        ok: false,
        message: 'Choose where the money went, so this is not counted as spending.',
      };
    }
    if (toAccountId === accountId) {
      return {
        ok: false,
        message: 'Pick a different account for the other side of the transfer.',
      };
    }
    return { ok: true, transactionType: 'transfer', toAccountId };
  }

  return {
    ok: true,
    transactionType: kind === 'debit' ? 'expense' : 'income',
    toAccountId: null,
  };
}

/**
 * How the amount is labelled.
 *
 * "Moved" is deliberately neither "Paid" nor "Received": the money is still
 * the user's, and reading it as either is the mistake the transfer kind
 * exists to prevent.
 */
export function badgeFor(kind: SmsKind): { label: string; className: string } {
  if (kind === 'debit') return { label: 'Paid', className: 'is-out' };
  if (kind === 'transfer') return { label: 'Moved', className: 'is-moved' };
  return { label: 'Received', className: 'is-in' };
}

/**
 * What the row should be called in the ledger.
 *
 * The description is not just a label - the row's icon is chosen from it, so a
 * description that names nothing recognisable also loses the logo and falls
 * back to a bare direction arrow.
 *
 * A person's name has no logo of its own, and on its own it also loses which
 * rail the money came through. Naming the app as well restores both: the
 * monogram appears, and the row reads the way people describe these payments
 * to themselves - which is why an owner of this app, entering one by hand,
 * wrote exactly "Google pay - Gautam".
 *
 * A merchant that IS a known brand is left alone, so its own logo wins over
 * the app's monogram: "Swiggy" is more useful than "Google Pay - Swiggy".
 */
export function describeProposal(
  merchant: string | undefined,
  sources: readonly string[],
): string {
  const app = sources.find(isPaymentApp);

  if (!merchant) {
    // Unchanged: with no counterparty, where it was seen is all there is.
    return `From ${sources.join(', ')}`;
  }
  // A brand names itself, and brings a real logo rather than initials.
  if (brandNameIn(merchant)) return merchant;

  return app ? `${app} - ${merchant}` : merchant;
}

/**
 * Whether the "where did it go" picker needs to be on screen at all.
 *
 * Shown for the whole list rather than per row, because one destination is
 * chosen once and applied to whichever transfer is confirmed next.
 */
export function needsDestinationPicker(
  kinds: readonly SmsKind[],
  accountCount: number,
): boolean {
  return kinds.includes('transfer') && accountCount > 0;
}
