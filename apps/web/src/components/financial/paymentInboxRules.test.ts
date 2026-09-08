import { describe, it, expect } from 'vitest';
import {
  decideConfirm, badgeFor, needsDestinationPicker, describeProposal,
} from './paymentInboxRules';
import { alertToProposal, appLabel, isPaymentApp } from '../../utils/paymentAlert';

/**
 * What a confirmed alert actually becomes.
 *
 * This logic used to live inline in JSX, where nothing could test it, and it
 * held the single worst bug in the feature: a two-way debit/credit ternary
 * filed a TRANSFER as income. Moving Rs 50,000 from savings to current was
 * counted as Rs 50,000 earned, which inflates every "left to spend" figure in
 * the app - silently, and in the user's favour, which is the direction people
 * do not question until the month runs out early.
 */
describe('deciding what a confirmed alert becomes', () => {
  const ACC = 'acc-hdfc';
  const OTHER = 'acc-savings';

  it('files a payment as an expense', () => {
    expect(decideConfirm('debit', ACC, '')).toEqual({
      ok: true, transactionType: 'expense', toAccountId: null,
    });
  });

  it('files money arriving as income', () => {
    expect(decideConfirm('credit', ACC, '')).toEqual({
      ok: true, transactionType: 'income', toAccountId: null,
    });
  });

  it('files a move as a transfer, never as income', () => {
    const decision = decideConfirm('transfer', ACC, OTHER);
    expect(decision).toEqual({ ok: true, transactionType: 'transfer', toAccountId: OTHER });
    // Stated separately because this exact value is the bug.
    expect(decision.ok && decision.transactionType).not.toBe('income');
  });

  it('never sends a destination on anything but a transfer', () => {
    // The server stores to_account_id for transfers only; sending one on an
    // expense would credit an account that nothing was moved into.
    for (const kind of ['debit', 'credit'] as const) {
      const decision = decideConfirm(kind, ACC, OTHER);
      expect(decision.ok && decision.toAccountId).toBeNull();
    }
  });
});

describe('refusing to file something that would be wrong', () => {
  it('asks for an account before anything can be confirmed', () => {
    const decision = decideConfirm('debit', '', '');
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.message).toMatch(/account/i);
  });

  it('will not file a transfer with nowhere for the money to go', () => {
    // The server rejects this outright, but the reason has to be given in the
    // user's terms first - and the message has to say WHY it matters.
    const decision = decideConfirm('transfer', 'acc-hdfc', '');
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.message).toMatch(/not counted as spending/i);
  });

  it('will not move money from an account into itself', () => {
    const decision = decideConfirm('transfer', 'acc-hdfc', 'acc-hdfc');
    expect(decision.ok).toBe(false);
    expect(!decision.ok && decision.message).toMatch(/different account/i);
  });
});

describe('how the amount is labelled', () => {
  it('reads as neither paid nor received when it only moved', () => {
    expect(badgeFor('transfer')).toEqual({ label: 'Moved', className: 'is-moved' });
    expect(badgeFor('debit')).toEqual({ label: 'Paid', className: 'is-out' });
    expect(badgeFor('credit')).toEqual({ label: 'Received', className: 'is-in' });
  });

  it('gives each kind its own colour class', () => {
    const classes = (['debit', 'credit', 'transfer'] as const).map((k) => badgeFor(k).className);
    expect(new Set(classes).size).toBe(3);
  });
});

describe('showing the destination picker', () => {
  it('appears only when there is a transfer to place', () => {
    expect(needsDestinationPicker(['transfer'], 2)).toBe(true);
    expect(needsDestinationPicker(['debit', 'transfer'], 2)).toBe(true);
    expect(needsDestinationPicker(['debit', 'credit'], 2)).toBe(false);
  });

  it('stays hidden when there is no account to choose', () => {
    // An empty picker beside a button that cannot succeed is worse than no
    // picker: it looks like the user missed a step they cannot take.
    expect(needsDestinationPicker(['transfer'], 0)).toBe(false);
  });
});

/**
 * What the row ends up called - which also decides its icon.
 *
 * The description is not only a label: the ledger picks the row's logo out of
 * it, so a description naming nothing recognisable loses the logo too and the
 * row falls back to a bare arrow. A real Rs 45 from a friend landed as income
 * described as "view", with no name and no mark.
 */
describe('naming the row', () => {
  it('names the person and the rail they used', () => {
    // The owner of this app, entering one of these by hand, wrote exactly
    // "Google pay - Gautam". This is that, derived rather than typed.
    expect(describeProposal('Karan', ['Google Pay'])).toBe('Google Pay - Karan');
    expect(describeProposal('RAHUL', ['PhonePe'])).toBe('PhonePe - RAHUL');
  });

  it('lets a brand name itself, so its own logo wins', () => {
    // "Google Pay - Swiggy" would replace Swiggy's real logo with an app
    // monogram, which is a worse row than just "Swiggy".
    expect(describeProposal('Swiggy', ['Google Pay'])).toBe('Swiggy');
    expect(describeProposal('AMAZON', ['PhonePe'])).toBe('AMAZON');
  });

  it('does not credit the messaging app for a bank SMS', () => {
    // A bank alert merely ARRIVES in Messages; it did not move the money.
    expect(describeProposal('SWIGGY', ['Messages'])).toBe('SWIGGY');
    expect(describeProposal('Karan', ['Messages'])).toBe('Karan');
  });

  it('ignores a source it cannot name', () => {
    expect(describeProposal('Karan', ['com.example.unknown'])).toBe('Karan');
  });

  it('says where it was seen when nobody is named', () => {
    expect(describeProposal(undefined, ['Google Pay'])).toBe('From Google Pay');
  });

  it('never describes a row as "view"', () => {
    // The literal production bug, from "Karan paid you Rs.45 / Tap to view".
    expect(describeProposal('Karan', ['Google Pay'])).not.toBe('view');
  });
});

/**
 * The whole way through, from the notification Google Pay actually posts.
 *
 * This is the row that went wrong in a real ledger: Rs 45 from a friend,
 * filed as income described as "view". Two independent faults produced it,
 * and fixing either alone would still have left the row wrong:
 *
 *   1. The payee was read as "view", out of the words "Tap to view".
 *   2. Even with the right name, the description was `merchant ?? from`
 *      - an either/or. It could never say the app AND the person, so the
 *      best it could ever have managed was a bare "Karan", with no mark.
 *
 * So this goes through the real pipeline with the real package name rather
 * than testing the two halves separately and assuming they meet.
 */
describe('a real Google Pay alert, end to end', () => {
  const GPAY = 'com.google.android.apps.nbu.paisa.user';

  const proposalFor = (title: string, text: string) => {
    const p = alertToProposal({
      id: 'a1', packageName: GPAY, title, text, postedAt: Date.UTC(2026, 8, 8, 11, 0),
    });
    if (!p) throw new Error('the alert was refused outright');
    return p;
  };

  it('knows the money came through Google Pay', () => {
    // The package is mapped to a name a person would recognise; the raw
    // package would be useless in a description.
    expect(appLabel(GPAY)).toBe('Google Pay');
    expect(isPaymentApp('Google Pay')).toBe(true);
  });

  it('reads the friend name, not the words "Tap to view"', () => {
    const p = proposalFor('Karan paid you Rs.45', 'Tap to view');
    expect(p.kind).toBe('credit');
    expect(p.amountPaise).toBe(4500);
    expect(p.merchant).toBe('Karan');
  });

  it('describes the row the way the owner writes it by hand', () => {
    const p = proposalFor('Karan paid you Rs.45', 'Tap to view');
    expect(describeProposal(p.merchant, p.sources)).toBe('Google Pay - Karan');
  });

  it('is income, so it is added rather than subtracted', () => {
    const p = proposalFor('Karan paid you Rs.45', 'Tap to view');
    expect(decideConfirm(p.kind, 'acc-1', '')).toEqual({
      ok: true, transactionType: 'income', toAccountId: null,
    });
  });

  it('still names Swiggy rather than Google Pay when paying a brand', () => {
    const p = proposalFor('Paid Rs.250 To Swiggy', 'Tap to view');
    expect(describeProposal(p.merchant, p.sources)).toBe('Swiggy');
  });
});
