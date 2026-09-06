import { describe, expect, it } from 'vitest';
import {
  alertToProposal,
  appLabel,
  mergeProposals,
  proposalsFromAlerts,
  stableMutationId,
  unreadableAlertIds,
  MERGE_WINDOW_MS,
  type PaymentAlert,
} from './paymentAlert';

/** 2026-09-06T10:00:00Z, so every time here is a real number, not a clock. */
const T0 = 1_788_688_800_000;

const alert = (over: Partial<PaymentAlert> = {}): PaymentAlert => ({
  id: 'a1',
  packageName: 'com.google.android.apps.nbu.paisa.user',
  title: 'Google Pay',
  text: 'You paid ₹250.00 to Swiggy',
  postedAt: T0,
  ...over,
});

describe('reading one alert', () => {
  it('reads a UPI app payment as an expense', () => {
    const p = alertToProposal(alert());
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('debit');
    expect(p!.amountPaise).toBe(25000);
    expect(p!.sources).toEqual(['Google Pay']);
  });

  it('reads a bank SMS arriving as a Messages notification', () => {
    const p = alertToProposal(alert({
      packageName: 'com.samsung.android.messaging',
      title: 'VM-HDFCBK',
      text: 'Rs.1,250.50 debited from a/c XX4321 on 06-09-26. UPI Ref 123456789012.',
    }));
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('debit');
    expect(p!.amountPaise).toBe(125050);      // paise, exactly - no float
    expect(p!.accountTail).toBe('4321');
    expect(p!.sources).toEqual(['Messages']);
  });

  it('reads money coming in as a credit', () => {
    const p = alertToProposal(alert({ text: '₹500 received from Rahul' }));
    expect(p!.kind).toBe('credit');
    expect(p!.amountPaise).toBe(50000);
  });

  it('returns null for anything that is not a completed payment', () => {
    // The parser's refusals matter more here than its readings: this runs
    // unattended over a live notification feed.
    for (const text of [
      'Your OTP is 123456 for a txn of Rs.500. Do not share.',
      'Rs.500 transaction failed on your card',
      'Rahul is requesting ₹500 via UPI',
      'Get a pre-approved loan up to Rs.5,00,000',
      'Rs.2000 will be debited on 10-09-26 towards your SIP',
      'Available balance in a/c XX4321 is Rs.12,345.00',
    ]) {
      expect(alertToProposal(alert({ text })), text).toBeNull();
    }
  });

  it('reads a debit alert that also quotes the balance left behind', () => {
    const p = alertToProposal(alert({
      text: 'Rs.300 debited from a/c XX1111. Available balance Rs.4,700.',
    }));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(30000);
  });
});

describe('the id sent to the server', () => {
  it('is the same for the same payment, so confirming twice is one row', () => {
    const a = alertToProposal(alert({ id: 'x' }))!;
    const b = alertToProposal(alert({ id: 'y' }))!;
    expect(a.clientMutationId).toBe(b.clientMutationId);
  });

  it('differs when the amount, the direction or the minute differs', () => {
    const base = alertToProposal(alert())!.clientMutationId;
    expect(alertToProposal(alert({ text: 'You paid ₹251.00 to Swiggy' }))!.clientMutationId).not.toBe(base);
    expect(alertToProposal(alert({ text: '₹250 received from Swiggy' }))!.clientMutationId).not.toBe(base);
    expect(alertToProposal(alert({ postedAt: T0 + 120_000 }))!.clientMutationId).not.toBe(base);
  });

  it('is a well-formed v5-shaped uuid, which is what the API accepts', () => {
    for (const basis of ['a', 'debit|25000|29811480', '', 'x'.repeat(500)]) {
      expect(stableMutationId(basis)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});

describe('one payment seen by several apps', () => {
  it('merges the app alert and the bank SMS into one proposal', () => {
    const merged = proposalsFromAlerts([
      alert({ id: 'gpay', text: 'You paid ₹250.00 to Swiggy', postedAt: T0 }),
      alert({
        id: 'sms',
        packageName: 'com.google.android.apps.messaging',
        title: 'VM-HDFCBK',
        text: 'Rs.250.00 debited from a/c XX4321. UPI Ref 99887766.',
        postedAt: T0 + 8_000,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].alertIds.sort()).toEqual(['gpay', 'sms']);
    expect(merged[0].sources.sort()).toEqual(['Google Pay', 'Messages']);
    // The richest reading survives: merchant from the app, account from the SMS.
    expect(merged[0].merchant).toBe('Swiggy');
    expect(merged[0].accountTail).toBe('4321');
    expect(merged[0].reference).toBe('99887766');
  });

  it('keeps two genuine payments of the same amount far enough apart', () => {
    const merged = proposalsFromAlerts([
      alert({ id: 'one', postedAt: T0 }),
      alert({ id: 'two', postedAt: T0 + MERGE_WINDOW_MS + 1000 }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('merges right up to the edge of the window but not past it', () => {
    expect(proposalsFromAlerts([
      alert({ id: 'a', postedAt: T0 }),
      alert({ id: 'b', postedAt: T0 + MERGE_WINDOW_MS }),
    ])).toHaveLength(1);

    expect(proposalsFromAlerts([
      alert({ id: 'a', postedAt: T0 }),
      alert({ id: 'b', postedAt: T0 + MERGE_WINDOW_MS + 1 }),
    ])).toHaveLength(2);
  });

  it('does not merge a debit with a credit of the same amount', () => {
    // A refund arriving beside a payment is two rows, not one.
    const merged = proposalsFromAlerts([
      alert({ id: 'paid', text: 'You paid ₹250.00 to Swiggy', postedAt: T0 }),
      alert({ id: 'back', text: '₹250 received from Swiggy', postedAt: T0 + 5_000 }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((p) => p.kind).sort()).toEqual(['credit', 'debit']);
  });

  it('is not confused by the order alerts arrive in', () => {
    const forwards = proposalsFromAlerts([
      alert({ id: 'a', postedAt: T0 }),
      alert({ id: 'b', postedAt: T0 + 5_000 }),
    ]);
    const backwards = proposalsFromAlerts([
      alert({ id: 'b', postedAt: T0 + 5_000 }),
      alert({ id: 'a', postedAt: T0 }),
    ]);
    expect(forwards).toHaveLength(1);
    expect(backwards).toHaveLength(1);
    expect(forwards[0].clientMutationId).toBe(backwards[0].clientMutationId);
  });

  it('puts the newest proposal first', () => {
    const merged = proposalsFromAlerts([
      alert({ id: 'old', text: 'You paid ₹100 to A', postedAt: T0 }),
      alert({ id: 'new', text: 'You paid ₹200 to B', postedAt: T0 + 600_000 }),
    ]);
    expect(merged.map((p) => p.amountPaise)).toEqual([20000, 10000]);
  });

  it('leaves the input array alone', () => {
    const input = [alertToProposal(alert({ id: 'a' }))!, alertToProposal(alert({ id: 'b' }))!];
    const before = JSON.stringify(input);
    mergeProposals(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('housekeeping', () => {
  it('names the alerts that read as nothing, so they can be cleared', () => {
    const ids = unreadableAlertIds([
      alert({ id: 'otp', text: 'Your OTP is 123456. Do not share.' }),
      alert({ id: 'real', text: 'You paid ₹250.00 to Swiggy' }),
    ]);
    expect(ids).toEqual(['otp']);
  });

  it('shows an app by name, and falls back to the package it does not know', () => {
    expect(appLabel('com.phonepe.app')).toBe('PhonePe');
    expect(appLabel('com.some.unknown.bank')).toBe('com.some.unknown.bank');
  });
});
