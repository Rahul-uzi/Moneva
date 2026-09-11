import { describe, it, expect } from 'vitest';
import { proposalsFromAlerts, MERGE_WINDOW_MS, type PaymentAlert } from './paymentAlert';

/**
 * Two payments, or one payment announced twice?
 *
 * Getting this wrong in one direction shows the same payment on screen twice,
 * which anybody spots. Getting it wrong in the other direction merges two real
 * payments into one row, and the only trace is a monthly total that is quietly
 * too low - nobody goes looking for money that was never written down.
 *
 * The same mistake has a second form. Even unmerged, two payments deriving the
 * same client_mutation_id make the server treat the second as a replay of the
 * first: it returns the row it already has, the client reads 200 as success,
 * and the payment is gone.
 *
 * Both are silent, and auto-add removes the person who would have noticed.
 */

const T0 = Date.UTC(2026, 8, 9, 12, 30, 10);

const alert = (over: Partial<PaymentAlert> & { id: string }): PaymentAlert => ({
  packageName: 'com.phonepe.app',
  title: 'Payment successful',
  text: 'Rs.500.00 debited from A/c XX1234',
  postedAt: T0,
  ...over,
});

describe('the same fare paid twice in one minute', () => {
  it('stays two payments when the references differ', () => {
    // 40 seconds apart, identical amount and direction - inside the merge
    // window and inside the same minute, so this used to become one row.
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.500.00 debited from A/c XX1234. UPI Ref no 400011112222', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.500.00 debited from A/c XX1234. UPI Ref no 400033334444', postedAt: T0 + 40_000 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('gives them different ids, so the server files both', () => {
    // Sharing an id is the second half of the same bug: the server answers the
    // second write with the first row and nothing says anything went wrong.
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.500.00 debited. UPI Ref no 400011112222', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.500.00 debited. UPI Ref no 400033334444', postedAt: T0 + 40_000 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].clientMutationId).not.toBe(out[1].clientMutationId);
  });

  it('keeps both amounts, so the total is right', () => {
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.500.00 debited. Ref no 111111111111', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.500.00 debited. Ref no 222222222222', postedAt: T0 + 20_000 }),
    ]);
    expect(out.reduce((sum, p) => sum + p.amountPaise, 0)).toBe(1000_00);
  });

  it('holds for a bill split into three equal parts', () => {
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.300.00 debited. Ref no 100000000001', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.300.00 debited. Ref no 100000000002', postedAt: T0 + 15_000 }),
      alert({ id: 'c', text: 'Rs.300.00 debited. Ref no 100000000003', postedAt: T0 + 30_000 }),
    ]);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((p) => p.clientMutationId)).size).toBe(3);
  });
});

describe('one payment announced twice', () => {
  it('still merges when both alerts quote the same reference', () => {
    // The bank SMS trailing the app push. This is the case the merge exists
    // for, and it must survive the fix.
    const out = proposalsFromAlerts([
      alert({ id: 'app', packageName: 'com.phonepe.app',
              text: 'Paid Rs.500.00 to CHAI STALL. UPI Ref no 400011112222', postedAt: T0 }),
      alert({ id: 'sms', packageName: 'com.google.android.apps.messaging',
              text: 'Rs.500.00 debited from A/c XX1234. UPI Ref no 400011112222', postedAt: T0 + 8_000 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].alertIds).toHaveLength(2);
  });

  it('still merges when only one of them quotes a reference', () => {
    // The ordinary case: an app push names the shop and says nothing about a
    // reference, the bank SMS carries one. Silence is not disagreement.
    const out = proposalsFromAlerts([
      alert({ id: 'app', packageName: 'com.phonepe.app',
              text: 'Paid Rs.500.00 to CHAI STALL', postedAt: T0 }),
      alert({ id: 'sms', packageName: 'com.google.android.apps.messaging',
              text: 'Rs.500.00 debited from A/c XX1234. UPI Ref no 400011112222', postedAt: T0 + 8_000 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('still merges when neither quotes a reference', () => {
    // Nothing in the text can settle it, so the window keeps its old judgement
    // - which is the right way round: showing one payment is recoverable by a
    // person, and this is the case that cannot be resolved from the data.
    const out = proposalsFromAlerts([
      alert({ id: 'app', packageName: 'com.phonepe.app',
              text: 'Paid Rs.500.00 to CHAI STALL', postedAt: T0 }),
      alert({ id: 'sms', packageName: 'com.google.android.apps.messaging',
              text: 'Rs.500.00 debited from A/c XX1234', postedAt: T0 + 8_000 }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe('the window still does its job', () => {
  it('keeps two payments far apart separate, reference or not', () => {
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.500.00 debited from A/c XX1234', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.500.00 debited from A/c XX1234', postedAt: T0 + MERGE_WINDOW_MS + 1000 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].clientMutationId).not.toBe(out[1].clientMutationId);
  });

  it('does not confuse a debit with a credit of the same amount', () => {
    const out = proposalsFromAlerts([
      alert({ id: 'a', text: 'Rs.500.00 debited from A/c XX1234', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.500.00 credited to A/c XX1234', postedAt: T0 + 5_000 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('reads the same alert twice as one payment, not two', () => {
    // Idempotency in the other direction: a queue replayed after a restart
    // must not become a second row.
    const one = alert({ id: 'a', text: 'Rs.500.00 debited. UPI Ref no 400011112222', postedAt: T0 });
    const first = proposalsFromAlerts([one]);
    const again = proposalsFromAlerts([one]);
    expect(first[0].clientMutationId).toBe(again[0].clientMutationId);
  });

  it('gives the same payment the same id even across a minute boundary', () => {
    // 12:30:58 and 12:31:02 are one payment seen twice. Bucketed by minute
    // alone their ids differed; the shared reference now settles it, and the
    // merge keeps them together regardless.
    const edge = Date.UTC(2026, 8, 9, 12, 30, 58);
    const out = proposalsFromAlerts([
      alert({ id: 'app', packageName: 'com.phonepe.app',
              text: 'Paid Rs.500.00. UPI Ref no 400011112222', postedAt: edge }),
      alert({ id: 'sms', packageName: 'com.google.android.apps.messaging',
              text: 'Rs.500.00 debited. UPI Ref no 400011112222', postedAt: edge + 4_000 }),
    ]);
    expect(out).toHaveLength(1);
  });
});


describe('two different people, one amount, one minute', () => {
  /**
   * client_mutation_id is unique across the WHOLE table, not per person. So
   * without the owner in its basis, two strangers paying Rs 500 in the same
   * minute derive the same id - and the second is answered with a permanent
   * 403 that no retry can clear. Their payment can never be recorded at all,
   * which is worse than the same-user case: that one at least resolves to a
   * row, even if the wrong one.
   *
   * It is also an oracle. The id is derived from the payment alone, so anyone
   * could construct one for a GUESSED payment and read the difference between
   * 403 and 201 as a definitive answer about a stranger's ledger. The import
   * path closed exactly this; the notification path had not.
   */
  const samePayment = { id: 'x', text: 'Rs.500.00 debited from A/c XX1234', postedAt: T0 };

  it('gives the two of them different ids', () => {
    const mine = proposalsFromAlerts([alert(samePayment)], 'user-aaa');
    const theirs = proposalsFromAlerts([alert(samePayment)], 'user-bbb');
    expect(mine[0].clientMutationId).not.toBe(theirs[0].clientMutationId);
  });

  it('still gives one person the same id every time', () => {
    // Idempotency within a ledger has to survive the scoping, or a replayed
    // queue becomes a duplicate row.
    const first = proposalsFromAlerts([alert(samePayment)], 'user-aaa');
    const again = proposalsFromAlerts([alert(samePayment)], 'user-aaa');
    expect(first[0].clientMutationId).toBe(again[0].clientMutationId);
  });

  it('does not take the list position as the owner', () => {
    /* `map` hands its callback the index as a second argument, so passing the
       reader by reference would have made each proposal's owner its position
       in the list - ids that change whenever an unrelated alert arrives
       first, and idempotency quietly gone. */
    const two = [
      alert({ id: 'a', text: 'Rs.500.00 debited. Ref no 111111111111', postedAt: T0 }),
      alert({ id: 'b', text: 'Rs.700.00 debited. Ref no 222222222222', postedAt: T0 + 5_000 }),
    ];
    const inOrder = proposalsFromAlerts(two, 'user-aaa');
    const reversed = proposalsFromAlerts([two[1], two[0]], 'user-aaa');

    const idOf = (list: ReturnType<typeof proposalsFromAlerts>, paise: number) =>
      list.find((p) => p.amountPaise === paise)?.clientMutationId;

    expect(idOf(inOrder, 500_00)).toBe(idOf(reversed, 500_00));
    expect(idOf(inOrder, 700_00)).toBe(idOf(reversed, 700_00));
  });
});


describe('the wording banks actually use for a reference', () => {
  /**
   * The merge now refuses when two references DISAGREE, so everything rests on
   * the reference being the reference. Measured, not assumed: the label may end
   * in the word "number", and the pattern used to stop at "no" - so
   * "UPI Reference Number 512345678901" captured the literal word "Number".
   *
   * That is worse than capturing nothing. Every alert phrased that way carried
   * an identical reference, identical references read as agreement, and two
   * genuinely different payments merged into one row anyway - the exact bug the
   * reference was introduced to fix, hiding inside its own fix.
   */
  const twoPaymentsPhrased = (label: string) => proposalsFromAlerts([
    alert({ id: 'p1', text: `Rs.500.00 debited from A/c XX1234. ${label} 512345678901`, postedAt: T0 }),
    alert({ id: 'p2', text: `Rs.500.00 debited from A/c XX1234. ${label} 698765432109`, postedAt: T0 + 40_000 }),
  ], 'user-aaa');

  const LABELS = [
    'UPI Ref no',
    'UPI Reference Number',
    'Reference number:',
    'Ref No.',
    'Txn ID',
    'UPI Ref',
    'Reference No',
  ];

  it('keeps two payments apart however the reference is introduced', () => {
    for (const label of LABELS) {
      const out = twoPaymentsPhrased(label);
      expect(out, `"${label}" merged two real payments into one`).toHaveLength(2);
      expect(out[0].clientMutationId).not.toBe(out[1].clientMutationId);
    }
  });

  it('never mistakes an English word for a reference', () => {
    for (const label of LABELS) {
      const out = twoPaymentsPhrased(label);
      for (const p of out) {
        expect(p.reference, `"${label}" captured a word, not a reference`)
          .toMatch(/[0-9]/);
      }
    }
  });

  it('keeps the whole amount when a fare is paid twice', () => {
    for (const label of LABELS) {
      const out = twoPaymentsPhrased(label);
      expect(out.reduce((sum, p) => sum + p.amountPaise, 0),
        `"${label}" lost half the money`).toBe(1000_00);
    }
  });
});
