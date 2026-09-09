import { describe, it, expect } from 'vitest';
import {
  trustKey, decideAutoAdd, pickAutoAddable, resolveAutoAccount, AUTO_ADDABLE_RULES,
  recordConfirmation, recordRejection, revokeKey, trustProgress,
  parseTrustLedger, parseSettings, isTrustworthyChannel,
  CONFIRMATIONS_TO_TRUST, DEFAULT_CEILING_MINOR, MAX_AUTO_PER_BATCH,
  TRUST_LAPSES_AFTER_DAYS, DEFAULT_SETTINGS,
  type TrustLedger, type AutoAddSettings,
} from './autoAdd';
import type { AlertProposal } from './paymentAlert';

/**
 * The one feature that writes without being asked.
 *
 * Everywhere else a wrong reading costs a glance. Here it costs a row in
 * somebody's ledger that they never saw arrive, and which stays wrong until
 * they go looking. So these are not coverage - each one is a way this could
 * take money out of a person's picture of their own finances.
 */

const NOW = Date.UTC(2026, 8, 9, 12, 0);
const DAY = 86_400_000;

const proposal = (over: Partial<AlertProposal> = {}): AlertProposal => ({
  alertIds: ['a1'],
  kind: 'debit',
  amountPaise: 250_00,
  merchant: 'Swiggy',
  matchedBy: 'debited',
  sources: ['Google Pay'],
  postedAt: NOW,
  clientMutationId: 'mut-1',
  ...over,
});

const ON: AutoAddSettings = { enabled: true, ceilingMinor: DEFAULT_CEILING_MINOR };

/** A ledger in which the given proposal's pattern has earned its trust. */
const trusted = (p: AlertProposal, at: number = NOW): TrustLedger => {
  const k = trustKey(p);
  if (!k) throw new Error('that proposal can never be trusted, so the fixture is wrong');
  return { [k]: { confirmations: CONFIRMATIONS_TO_TRUST, lastConfirmedAt: at } };
};

describe('the channel a payment arrived through', () => {
  /**
   * The rule the whole feature rests on. Android guarantees which app posted a
   * notification, so a PhonePe alert is PhonePe speaking. It does not
   * guarantee who wrote an SMS - and a forged "Rs 5,000 credited" text sent to
   * a seller, so they hand over the goods before checking, is an ordinary scam
   * here. An app that files that unasked corroborates it.
   */
  it('never files a text message, whichever way the money went', () => {
    for (const kind of ['debit', 'credit'] as const) {
      const sms = proposal({ sources: ['Messages'], kind });
      expect(trustKey(sms)).toBeNull();
      const d = decideAutoAdd(sms, { 'debited|Messages|debit': { confirmations: 99, lastConfirmedAt: NOW } }, ON, NOW);
      expect(d.auto).toBe(false);
    }
  });

  it('never files a WhatsApp payment', () => {
    // Same shape as an SMS: the app is real, the words are a stranger's.
    const wa = proposal({ sources: ['WhatsApp Pay'] });
    expect(trustKey(wa)).toBeNull();
    expect(decideAutoAdd(wa, trusted(proposal()), ON, NOW).auto).toBe(false);
  });

  it('cannot be talked into trusting an unknown source', () => {
    for (const source of ['', 'Some New Wallet', 'Messages ', 'google pay']) {
      expect(isTrustworthyChannel(source)).toBe(false);
    }
    expect(isTrustworthyChannel('Google Pay')).toBe(true);
    expect(isTrustworthyChannel('PhonePe')).toBe(true);
  });

  it('does file a payment app alert once it is trusted', () => {
    const p = proposal({ sources: ['PhonePe'] });
    expect(decideAutoAdd(p, trusted(p), ON, NOW).auto).toBe(true);
  });

  it('accepts a payment corroborated by both an app and a text', () => {
    // Grouping means the SAME payment was seen twice. The app alert is the
    // trustworthy half, and a forged text cannot invent a Google Pay alert to
    // pair with - so this stays eligible rather than being punished for the
    // extra evidence.
    const both = proposal({ sources: ['Google Pay', 'Messages'] });
    const key = trustKey(both);
    expect(key).toBe('debited|Google Pay|debit');
    expect(decideAutoAdd(both, trusted(both), ON, NOW).auto).toBe(true);
  });
});

describe('a forged text riding on a real payment', () => {
  /**
   * Merge laundering. Proposals for one payment are merged on amount and
   * direction within ninety seconds, and the EARLIEST alert anchors the
   * cluster - its merchant, its rule and its account tail are the ones that
   * survive. An attacker picks when to send a text, so they can always be
   * earliest.
   *
   * The amount cannot be forged this way, because the two only merge if the
   * amounts already agree. What CAN be forged is everything the row says about
   * itself: who it was paid to, which account it came from, and which parser
   * rule is credited - and being credited is what earns the tap away.
   */
  it('refuses when the text got there first and supplied the words', () => {
    const laundered = proposal({
      // sources[0] is the anchor: the forged text.
      sources: ['Messages', 'PhonePe'],
      merchant: 'ATTACKER',
      matchedBy: 'debited',
    });
    expect(trustKey(laundered)).toBeNull();

    const generous: TrustLedger = {
      'debited|PhonePe|debit': { confirmations: 99, lastConfirmedAt: NOW },
      'debited|Messages|debit': { confirmations: 99, lastConfirmedAt: NOW },
    };
    expect(decideAutoAdd(laundered, generous, ON, NOW, 'acc-1').auto).toBe(false);
  });

  it('still accepts it when the payment app got there first', () => {
    // Then the words on the row are the app's, and the text only corroborated
    // an amount that already agreed. Nothing is lost by allowing this.
    const genuine = proposal({ sources: ['PhonePe', 'Messages'] });
    expect(trustKey(genuine)).toBe('debited|PhonePe|debit');
    expect(decideAutoAdd(genuine, trusted(genuine), ON, NOW, 'acc-1').auto).toBe(true);
  });

  it('refuses a proposal with no source at all', () => {
    expect(trustKey(proposal({ sources: [] }))).toBeNull();
  });
});

describe('what earns the tap away', () => {
  it('keys trust to the rule, the app and the direction together', () => {
    expect(trustKey(proposal())).toBe('debited|Google Pay|debit');
    // Change any one of the three and it is a different pattern.
    expect(trustKey(proposal({ matchedBy: 'credited', kind: 'credit' }))).toBe('credited|Google Pay|credit');
    expect(trustKey(proposal({ sources: ['PhonePe'] }))).toBe('debited|PhonePe|debit');
    expect(trustKey(proposal({ kind: 'credit' }))).toBe('debited|Google Pay|credit');
  });

  it('gives no key at all to a rule that may never file unasked', () => {
    for (const matchedBy of ['spent', 'received', 'card-used', 'refund', 'sent', 'payment-of', '']) {
      expect(trustKey(proposal({ matchedBy }))).toBeNull();
    }
  });

  it('does not let money going out authorise money coming in', () => {
    // The direction is in the key for exactly this reason: five confirmed
    // payments should not teach the app to file receipts it has never checked.
    const out = proposal({ kind: 'debit' });
    const inbound = proposal({ kind: 'credit' });
    expect(decideAutoAdd(inbound, trusted(out), ON, NOW).auto).toBe(false);
  });

  it('does not let one app authorise another', () => {
    const gpay = proposal({ sources: ['Google Pay'] });
    const phonepe = proposal({ sources: ['PhonePe'] });
    expect(decideAutoAdd(phonepe, trusted(gpay), ON, NOW).auto).toBe(false);
  });

  it('does not let one rule authorise another', () => {
    // Both allowed to try, both reading credits, different wording - so this
    // measures the key rather than the allowlist.
    const bankWording = proposal({ matchedBy: 'credited', kind: 'credit' });
    const appWording = proposal({ matchedBy: 'paid-you', kind: 'credit' });
    expect(decideAutoAdd(appWording, trusted(bankWording), ON, NOW).auto).toBe(false);
    expect(decideAutoAdd(bankWording, trusted(bankWording), ON, NOW).auto).toBe(true);
  });

  it('takes five confirmations, and files nothing on the fourth', () => {
    let ledger: TrustLedger = {};
    const p = proposal();
    for (let i = 1; i < CONFIRMATIONS_TO_TRUST; i += 1) {
      ledger = recordConfirmation(ledger, p, NOW);
      expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(false);
    }
    ledger = recordConfirmation(ledger, p, NOW);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(true);
  });

  it('shows how far along a pattern is, so it is not a surprise', () => {
    let ledger: TrustLedger = {};
    const p = proposal();
    ledger = recordConfirmation(ledger, p, NOW);
    ledger = recordConfirmation(ledger, p, NOW);
    expect(trustProgress(ledger, p)).toEqual({
      key: 'debited|Google Pay|debit', confirmations: 2,
      needed: CONFIRMATIONS_TO_TRUST, revoked: false,
    });
  });

  it('records nothing for a pattern that could never be trusted', () => {
    // Otherwise an SMS pattern quietly accrues a record that only needs one
    // rule change to become permission.
    const sms = proposal({ sources: ['Messages'] });
    expect(recordConfirmation({}, sms, NOW)).toEqual({});
    expect(trustProgress({}, sms)).toBeNull();
  });
});

describe('how trust is lost', () => {
  it('is gone the moment the user says no', () => {
    const p = proposal();
    let ledger = trusted(p);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(true);

    ledger = recordRejection(ledger, p, NOW);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(false);
  });

  it('is gone when the user undoes something it filed', () => {
    // The strongest signal there is, and the only one that arrives after the
    // damage: this pattern already wrote a row somebody did not want.
    const p = proposal();
    const key = trustKey(p) as string;
    const ledger = revokeKey(trusted(p), key, NOW);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(false);
  });

  it('makes a revoked pattern start again from zero, not resume', () => {
    // Resuming would mean one more confirmation re-authorises the very pattern
    // that just got something wrong.
    const p = proposal();
    let ledger = recordRejection(trusted(p), p, NOW);
    ledger = recordConfirmation(ledger, p, NOW);
    expect(ledger[trustKey(p) as string].confirmations).toBe(1);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(false);

    for (let i = 1; i < CONFIRMATIONS_TO_TRUST; i += 1) ledger = recordConfirmation(ledger, p, NOW);
    expect(decideAutoAdd(p, ledger, ON, NOW).auto).toBe(true);
  });

  it('refuses a record that is revoked even if its count looks earned', () => {
    /* The writers in this module always zero the count when they revoke, so
       this state does not arise from them - it arises from a store that was
       edited, damaged, or written by a future version, and parseTrustLedger
       carries both fields through faithfully. The revocation has to be the
       thing that decides, independently of the number beside it, or a stored
       count is enough to re-authorise a pattern that was withdrawn. */
    const p = proposal();
    const key = trustKey(p) as string;
    const contradictory: TrustLedger = {
      [key]: { confirmations: 999, lastConfirmedAt: NOW, revokedAt: NOW - DAY },
    };
    expect(decideAutoAdd(p, contradictory, ON, NOW, 'acc-1').auto).toBe(false);

    // And it survives being written out and read back, which is the path such
    // a record would actually arrive by.
    const roundTripped = parseTrustLedger(JSON.stringify(contradictory));
    expect(roundTripped[key].revokedAt).toBe(NOW - DAY);
    expect(decideAutoAdd(p, roundTripped, ON, NOW, 'acc-1').auto).toBe(false);
  });

  it('restarts such a record from one, not from the count it was carrying', () => {
    // Otherwise a single confirmation after a revocation hands back trust that
    // took five to earn.
    const p = proposal();
    const key = trustKey(p) as string;
    const contradictory: TrustLedger = {
      [key]: { confirmations: 999, lastConfirmedAt: NOW, revokedAt: NOW - DAY },
    };
    const after = recordConfirmation(contradictory, p, NOW);
    expect(after[key].confirmations).toBe(1);
    expect(decideAutoAdd(p, after, ON, NOW, 'acc-1').auto).toBe(false);
  });

  it('lapses when the pattern has not been seen for a season', () => {
    // Alert wording changes. Confirmations were for the old wording.
    const p = proposal();
    const stale = trusted(p, NOW - (TRUST_LAPSES_AFTER_DAYS + 1) * DAY);
    expect(decideAutoAdd(p, stale, ON, NOW).auto).toBe(false);

    const fresh = trusted(p, NOW - (TRUST_LAPSES_AFTER_DAYS - 1) * DAY);
    expect(decideAutoAdd(p, fresh, ON, NOW).auto).toBe(true);
  });

  it('does not treat a clock that jumped backwards as fresh trust', () => {
    const p = proposal();
    const future = trusted(p, NOW + 30 * DAY);
    expect(decideAutoAdd(p, future, ON, NOW).auto).toBe(false);
  });
});

describe('what is never filed, however trusted', () => {
  it('never files a transfer', () => {
    // No alert says which of YOUR accounts the money reached, and a guess
    // turns money you moved into money you spent.
    const t = proposal({ kind: 'transfer' });
    expect(trustKey(t)).toBeNull();
    expect(decideAutoAdd(t, { 'debited|Google Pay|transfer': { confirmations: 99, lastConfirmedAt: NOW } }, ON, NOW).auto)
      .toBe(false);
  });

  it('never files more than the ceiling', () => {
    const p = proposal({ amountPaise: DEFAULT_CEILING_MINOR + 1 });
    expect(decideAutoAdd(p, trusted(p), ON, NOW).auto).toBe(false);
    // Trust earned on small everyday payments is not permission for a big one.
    const atLimit = proposal({ amountPaise: DEFAULT_CEILING_MINOR });
    expect(decideAutoAdd(atLimit, trusted(atLimit), ON, NOW).auto).toBe(true);
  });

  it('never files an amount that did not read as a number', () => {
    for (const amountPaise of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = proposal({ amountPaise });
      expect(decideAutoAdd(p, trusted(proposal()), ON, NOW).auto).toBe(false);
    }
  });

  it('files nothing at all while the switch is off', () => {
    const p = proposal();
    expect(decideAutoAdd(p, trusted(p), { enabled: false, ceilingMinor: DEFAULT_CEILING_MINOR }, NOW).auto)
      .toBe(false);
  });

  it('starts switched off', () => {
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
  });
});

describe('a burst of alerts', () => {
  it('files a few and leaves the rest to be looked at', () => {
    // A phone that was off for a day, or an app replaying its notifications,
    // delivers a pile at once - which is exactly when a mistake multiplies
    // before anybody sees it.
    const many = Array.from({ length: MAX_AUTO_PER_BATCH + 4 }, (_, i) =>
      proposal({ clientMutationId: `m${i}`, alertIds: [`a${i}`] }));
    const { auto, ask } = pickAutoAddable(many, trusted(proposal()), ON, NOW);
    expect(auto).toHaveLength(MAX_AUTO_PER_BATCH);
    expect(ask).toHaveLength(4);
  });

  it('loses nothing - every proposal lands in one pile or the other', () => {
    const mixed = [
      proposal({ clientMutationId: 'a' }),
      proposal({ clientMutationId: 'b', sources: ['Messages'] }),
      proposal({ clientMutationId: 'c', kind: 'transfer' }),
      proposal({ clientMutationId: 'd', amountPaise: 99_999_00 }),
    ];
    const { auto, ask } = pickAutoAddable(mixed, trusted(proposal()), ON, NOW);
    expect(auto.length + ask.length).toBe(mixed.length);
    expect(auto.map((p) => p.clientMutationId)).toEqual(['a']);
    expect(ask.map((p) => p.clientMutationId)).toEqual(['b', 'c', 'd']);
  });
});

describe('reading back what was stored', () => {
  /**
   * The whole module fails in one direction: towards asking. A cleared cache,
   * a half-written value, or something from a newer version of the app should
   * all cost taps, never a wrong row.
   */
  it('treats anything unreadable as trusting nothing', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"a string"', '42', '{']) {
      expect(parseTrustLedger(raw)).toEqual({});
    }
  });

  it('drops damaged entries rather than guessing at them', () => {
    const ledger = parseTrustLedger(JSON.stringify({
      good: { confirmations: 7, lastConfirmedAt: NOW },
      notAnObject: 'nope',
      nullish: null,
      badCounts: { confirmations: 'lots', lastConfirmedAt: 'yesterday' },
    }));
    expect(ledger.good).toEqual({ confirmations: 7, lastConfirmedAt: NOW });
    expect(ledger.notAnObject).toBeUndefined();
    expect(ledger.nullish).toBeUndefined();
    // Present but with nothing usable in it, which reads as no trust at all.
    expect(ledger.badCounts).toEqual({ confirmations: 0, lastConfirmedAt: 0 });
  });

  it('keeps a revocation across a restart', () => {
    // If a revocation could be lost by a reload, the fix for a bad pattern
    // would last until the app next started.
    const stored = JSON.stringify({ k: { confirmations: 0, lastConfirmedAt: NOW, revokedAt: NOW } });
    expect(parseTrustLedger(stored).k.revokedAt).toBe(NOW);
  });

  it('never reads a damaged setting as permission to write', () => {
    for (const raw of [null, '', 'not json', '{}', '{"enabled":"true"}', '{"enabled":1}', '[]']) {
      expect(parseSettings(raw).enabled).toBe(false);
    }
    expect(parseSettings('{"enabled":true}').enabled).toBe(true);
  });

  it('falls back to the default ceiling rather than an absent one', () => {
    // A missing or nonsensical ceiling must not read as "no limit".
    for (const raw of ['{"enabled":true}', '{"enabled":true,"ceilingMinor":0}',
                       '{"enabled":true,"ceilingMinor":-5}', '{"enabled":true,"ceilingMinor":"lots"}']) {
      expect(parseSettings(raw).ceilingMinor).toBe(DEFAULT_CEILING_MINOR);
    }
    expect(parseSettings('{"enabled":true,"ceilingMinor":100000}').ceilingMinor).toBe(100000);
  });

  it('survives a round trip through storage with its trust intact', () => {
    const p = proposal();
    const ledger = recordConfirmation(trusted(p), p, NOW);
    const back = parseTrustLedger(JSON.stringify(ledger));
    expect(decideAutoAdd(p, back, ON, NOW).auto).toBe(true);
  });
});


/**
 * The messages that actually arrive.
 *
 * Every case below was drawn from a review of what the parser does with real
 * Indian alert wording, and each one would have written a wrong row. They are
 * kept as tests rather than as a note, because the guards that stop them are
 * cheap to remove by accident.
 */
describe('the ordinary messages that would have gone wrong', () => {
  const attempt = (over: Partial<AlertProposal>) =>
    decideAutoAdd(proposal(over), {
      // Maximally trusting ledger: every pattern already earned. Only the
      // categorical guards can save these.
      'debited|Google Pay|debit': { confirmations: 99, lastConfirmedAt: NOW },
      'credited|Google Pay|credit': { confirmations: 99, lastConfirmedAt: NOW },
      'spent|Google Pay|debit': { confirmations: 99, lastConfirmedAt: NOW },
      'received|Google Pay|credit': { confirmations: 99, lastConfirmedAt: NOW },
      'card-used|Google Pay|debit': { confirmations: 99, lastConfirmedAt: NOW },
      'refund|Google Pay|credit': { confirmations: 99, lastConfirmedAt: NOW },
      'paid-you|Google Pay|credit': { confirmations: 99, lastConfirmedAt: NOW },
    }, ON, NOW, 'acc-1');

  it('does not file a monthly spending recap as one huge purchase', () => {
    // "You spent Rs.45,000 in August" - arrives on a schedule, from exactly
    // the apps most likely to have earned trust.
    expect(attempt({ matchedBy: 'spent', amountPaise: 45_000_00 }).auto).toBe(false);
    // Even under the ceiling, the rule itself is not allowed to try.
    expect(attempt({ matchedBy: 'spent', amountPaise: 300_00 }).auto).toBe(false);
  });

  it('does not file "your order has been received" as income', () => {
    // The error a user is least likely to hunt for, because it makes their
    // position look better than it is.
    expect(attempt({ matchedBy: 'received', kind: 'credit', amountPaise: 1_499_00 }).auto).toBe(false);
  });

  it('does not file a mandate being set up as the charge itself', () => {
    // "Autopay mandate of Rs.499 created using your card" - the charge comes
    // later, and filing both bills the user twice.
    expect(attempt({ matchedBy: 'card-used', amountPaise: 499_00 }).auto).toBe(false);
  });

  it('does not file a refund-fee message that inverted the direction', () => {
    // A direction error is a double-sized error on the balance.
    expect(attempt({ matchedBy: 'refund', kind: 'credit', amountPaise: 500_00 }).auto).toBe(false);
  });

  it('does file the plain bank wording it was built for', () => {
    expect(attempt({ matchedBy: 'debited', amountPaise: 320_00 }).auto).toBe(true);
    expect(attempt({ matchedBy: 'credited', kind: 'credit', amountPaise: 320_00 }).auto).toBe(true);
    expect(attempt({ matchedBy: 'paid-you', kind: 'credit', amountPaise: 45_00 }).auto).toBe(true);
  });

  it('keeps the allowlist to rules whose wording is the bank speaking', () => {
    expect([...AUTO_ADDABLE_RULES].sort()).toEqual(['credited', 'debited', 'paid-you']);
  });

  it('leans on the ceiling when a balance is misread as the amount', () => {
    // "Avl Bal Rs.45,320.00. INR 320.00 debited to BLINKIT" can read the
    // balance as the payment. The rule is allowed, so the ceiling is what
    // catches it - which is the second reason the ceiling exists.
    expect(attempt({ matchedBy: 'debited', amountPaise: 45_320_00 }).auto).toBe(false);
  });
});

describe('which account an unattended payment lands in', () => {
  /**
   * Nothing stores an account's number, so the tail in an alert - "A/c XX1234"
   * - matches nothing. With somebody watching, they pick. With nobody
   * watching it is a guess, and a guess repeated on every payment gives a
   * multi-account user a systematically wrong ledger.
   */
  it('files unasked only when there is one account and so no choice', () => {
    expect(resolveAutoAccount([{ id: 'a', is_active: true }])).toBe('a');
  });

  it('refuses to choose between two accounts', () => {
    expect(resolveAutoAccount([{ id: 'a' }, { id: 'b' }])).toBeNull();
  });

  it('ignores closed accounts when counting', () => {
    expect(resolveAutoAccount([{ id: 'a', is_active: true }, { id: 'b', is_active: false }])).toBe('a');
  });

  it('refuses when there are no accounts at all', () => {
    expect(resolveAutoAccount([])).toBeNull();
  });

  it('does not file anything when the account could not be settled', () => {
    const p = proposal();
    expect(decideAutoAdd(p, trusted(p), ON, NOW, null).auto).toBe(false);
    expect(decideAutoAdd(p, trusted(p), ON, NOW, 'acc-1').auto).toBe(true);
  });

  it('leaves the whole batch to be looked at when the account is unsettled', () => {
    const many = [proposal({ clientMutationId: 'a' }), proposal({ clientMutationId: 'b' })];
    const { auto, ask } = pickAutoAddable(many, trusted(proposal()), ON, NOW, null);
    expect(auto).toHaveLength(0);
    expect(ask).toHaveLength(2);
  });
});
