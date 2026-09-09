/**
 * When a captured payment may be filed without asking.
 *
 * Every other feature in this app proposes; this one WRITES. A wrong row here
 * is not a wrong reading the user can decline - it is money that appears in
 * their ledger without them ever seeing it, and it stays wrong until they go
 * looking. So the whole module is built to say NO, and trust is something a
 * single narrow pattern earns slowly and loses instantly.
 *
 * The threat that shapes it is not hypothetical. A common scam in India is a
 * forged "Rs 5,000 credited to your account" SMS sent to a seller so they hand
 * over the goods before checking. An app that reads that SMS and files it
 * without asking does not merely record a wrong number - it corroborates the
 * scam, in the victim's own trusted app. That is why the channel a payment
 * arrived through matters more here than anything the parser thinks it says.
 *
 * Nothing in here reads a clock or storage of its own: `now` and the ledger
 * are arguments, so the same inputs always give the same answer and every rule
 * below is testable without a device.
 */
import type { AlertProposal } from './paymentAlert';
import { isPaymentApp } from './paymentAlert';

/**
 * The only parser rules allowed to file anything unasked.
 *
 * Not every rule can be redeemed by confirmations, because the ways these
 * misfire are not rare edge cases - they are ordinary messages:
 *
 *   spent      "You spent Rs.45,000 in August" - a monthly recap, filed as
 *              one enormous purchase.
 *   received   "Your order of Rs.1,499 has been received" - filed as income,
 *              which makes the user's position look BETTER and is therefore
 *              the error they are least likely to go looking for.
 *   card-used  "Autopay mandate of Rs.499 created using your card" - a
 *              mandate being set up, filed as the charge itself.
 *   refund     can invert direction on a fee message, and a direction error
 *              is a double-sized error on the balance.
 *   sent,
 *   payment-of looser phrasings with the same failure shapes.
 *
 * What is left is the language a bank uses about money that has actually
 * moved. Those still have to earn their trust the slow way; this list only
 * decides which rules are allowed to try.
 */
export const AUTO_ADDABLE_RULES = ['debited', 'credited', 'paid-you'] as const;

/** How many clean confirmations of one exact pattern earn it the tap. */
export const CONFIRMATIONS_TO_TRUST = 5;

/** Nothing above this is ever filed unasked, however well trusted. */
export const DEFAULT_CEILING_MINOR = 5_000_00;

/** The most that may be filed unasked in one go - see `pickAutoAddable`. */
export const MAX_AUTO_PER_BATCH = 5;

/**
 * Trust goes stale. Banks and apps reword their alerts, and a pattern that has
 * not been seen for a season is no longer a pattern this user has checked.
 */
export const TRUST_LAPSES_AFTER_DAYS = 90;

const DAY = 86_400_000;

/**
 * A channel whose CONTENT is written by whoever sent it.
 *
 * Android guarantees the package a notification came from - no app can post as
 * `com.phonepe.app` - so a PhonePe alert really is PhonePe speaking. An SMS is
 * the opposite: the messaging app is genuine, but the words are supplied by
 * any stranger who knows the number. WhatsApp is the same shape. Both stay in
 * the inbox for a human to look at; neither is ever filed unasked.
 */
export const UNTRUSTED_CHANNELS = ['Messages', 'WhatsApp Pay'] as const;

/** Whether a payment seen HERE could be filed without asking. */
export const isTrustworthyChannel = (source: string): boolean =>
  isPaymentApp(source) && !UNTRUSTED_CHANNELS.includes(source as typeof UNTRUSTED_CHANNELS[number]);

export interface AutoAddSettings {
  /** Off until the user turns it on, and off again the moment they say so. */
  enabled: boolean;
  /** Per-payment ceiling, in paise. */
  ceilingMinor: number;
}

export const DEFAULT_SETTINGS: AutoAddSettings = {
  enabled: false,
  ceilingMinor: DEFAULT_CEILING_MINOR,
};

export interface TrustRecord {
  /** Confirmations since the last rejection. Reset to 0, never decremented. */
  confirmations: number;
  /** When this pattern was last confirmed, for the staleness rule. */
  lastConfirmedAt: number;
  /**
   * Set when the user rejected or undid something this pattern produced.
   * A revoked pattern must earn its trust again from zero - it is not a
   * pause, because the thing that went wrong was the pattern itself.
   */
  revokedAt?: number;
}

/** Every pattern this device has an opinion about, keyed by `trustKey`. */
export type TrustLedger = Record<string, TrustRecord>;

/**
 * The exact pattern that earns trust.
 *
 * Narrow on purpose - the parser rule, the app it was seen in, and the
 * direction, all three. Keyed on the rule alone, five confirmed Google Pay
 * payments would silently authorise the same rule reading a bank's differently
 * worded alert; keyed without the direction, trust earned on money going out
 * would file money coming in.
 *
 * Null when the proposal could never be auto-filed at all, so callers cannot
 * accidentally record trust for something ineligible.
 */
export function trustKey(proposal: AlertProposal): string | null {
  /* The FIRST source, not merely any of them.
     Proposals for one payment are merged, and the earliest alert anchors the
     cluster: its merchant, its rule and its account tail are the ones that
     survive, while every later source is only appended to this list. An
     attacker choosing when to send a text can always be earliest. So reading
     "any trustworthy source present" would let a forged SMS supply the words
     on a row while a genuine payment-app push, arriving seconds later, supplies
     the permission to file it unasked - the amount would be the real one, but
     the payee, the rule and the account named on it would be a stranger's. */
  const channel = proposal.sources[0];
  if (!channel || !isTrustworthyChannel(channel)) return null;
  if (!proposal.matchedBy) return null;
  if (!AUTO_ADDABLE_RULES.includes(proposal.matchedBy as typeof AUTO_ADDABLE_RULES[number])) return null;
  if (proposal.kind !== 'debit' && proposal.kind !== 'credit') return null;
  return `${proposal.matchedBy}|${channel}|${proposal.kind}`;
}

/**
 * Which account an unattended payment may be filed against.
 *
 * A payment alert names the account it came from - "A/c XX1234" - but nothing
 * in this app records an account's number, so that tail cannot be matched to
 * anything. With a person present that gap is invisible: they see the account
 * picker and choose. With nobody present it becomes a guess, and today the
 * guess is "the first asset account", which for anyone holding two accounts is
 * systematically wrong and shows nothing on the row to say so.
 *
 * So the rule is to only file unasked when there is no choice to get wrong.
 * One active account has exactly one right answer; two have no answer at all,
 * and those payments keep their tap.
 *
 * Storing an account's last four digits would lift this, and is the change
 * that would let this feature help somebody with several accounts.
 */
export function resolveAutoAccount(
  accounts: readonly { id: string; is_active?: boolean }[],
): string | null {
  const live = accounts.filter((a) => a.is_active !== false);
  return live.length === 1 ? live[0].id : null;
}

export type AutoDecision =
  | { auto: true; key: string }
  | { auto: false; reason: string };

/**
 * Whether this one payment may be filed without asking.
 *
 * Written as a wall of refusals with a single `true` at the end, because that
 * is the shape of the risk: every unhandled case, unreadable value and unknown
 * pattern has to land on "ask", and the only way to be sure of that is for the
 * permission to be the last line rather than the first.
 */
export function decideAutoAdd(
  proposal: AlertProposal,
  ledger: TrustLedger,
  settings: AutoAddSettings,
  now: number,
  accountId?: string | null,
): AutoDecision {
  if (!settings.enabled) return { auto: false, reason: 'Adding without asking is switched off.' };

  // Never a guess. See resolveAutoAccount - with more than one account there
  // is no way to tell which one an alert belongs to, so the tap stays.
  if (accountId !== undefined && !accountId) {
    return { auto: false, reason: 'With more than one account, choose where this belongs.' };
  }

  // A transfer needs to know which of your own accounts the money reached, and
  // no alert says. Filed as a guess it becomes spending you did not do.
  if (proposal.kind === 'transfer') {
    return { auto: false, reason: 'A transfer needs you to say where the money went.' };
  }

  const key = trustKey(proposal);
  if (!key) {
    return { auto: false, reason: 'Only alerts from a payment or banking app are added for you.' };
  }

  // Belt and braces: trustKey already refuses these, but the channel rule is
  // the one that must never quietly stop applying, so it is asserted here too.
  if (proposal.sources.some((s) => !isTrustworthyChannel(s) && s === 'Messages')) {
    if (!proposal.sources.some(isTrustworthyChannel)) {
      return { auto: false, reason: 'A text message can be sent by anyone, so it is never added for you.' };
    }
  }

  if (!Number.isFinite(proposal.amountPaise) || proposal.amountPaise <= 0) {
    return { auto: false, reason: 'That amount could not be read confidently.' };
  }

  const ceiling = Number.isFinite(settings.ceilingMinor) && settings.ceilingMinor > 0
    ? settings.ceilingMinor
    : DEFAULT_CEILING_MINOR;
  if (proposal.amountPaise > ceiling) {
    return { auto: false, reason: 'Larger than the amount you set for adding without asking.' };
  }

  const record = ledger[key];
  if (!record) return { auto: false, reason: 'This kind of alert has not been confirmed enough times yet.' };
  if (record.revokedAt) return { auto: false, reason: 'This pattern got something wrong before.' };
  if (!Number.isFinite(record.confirmations) || record.confirmations < CONFIRMATIONS_TO_TRUST) {
    return { auto: false, reason: 'This kind of alert has not been confirmed enough times yet.' };
  }

  // A pattern nobody has checked in a season is not a checked pattern - alert
  // wording changes, and the confirmations were for the old wording.
  const lastSeen = record.lastConfirmedAt;
  if (!Number.isFinite(lastSeen) || now - lastSeen > TRUST_LAPSES_AFTER_DAYS * DAY) {
    return { auto: false, reason: 'It has been a while, so this one is worth a look.' };
  }
  // A confirmation dated in the future is a clock that moved, not a fact.
  if (lastSeen > now + DAY) {
    return { auto: false, reason: 'It has been a while, so this one is worth a look.' };
  }

  return { auto: true, key };
}

/**
 * The payments to file, and the ones to leave for the user.
 *
 * Capped per batch. A phone that has been off for a day, or an app that
 * replays its notifications, can deliver a burst - and a burst is exactly when
 * a mistake multiplies before anyone sees it. Whatever is over the cap stays
 * in the inbox, which is the safe place for it.
 */
export function pickAutoAddable(
  proposals: readonly AlertProposal[],
  ledger: TrustLedger,
  settings: AutoAddSettings,
  now: number,
  accountId?: string | null,
  limit: number = MAX_AUTO_PER_BATCH,
): { auto: AlertProposal[]; ask: AlertProposal[] } {
  const auto: AlertProposal[] = [];
  const ask: AlertProposal[] = [];

  for (const p of proposals) {
    if (auto.length >= limit) { ask.push(p); continue; }
    if (decideAutoAdd(p, ledger, settings, now, accountId).auto) auto.push(p);
    else ask.push(p);
  }
  return { auto, ask };
}

/* ---------------------------------------------------------------------------
   Earning and losing trust.

   Every function here returns a new ledger rather than mutating one, so a
   caller cannot half-apply a change and leave a pattern trusted on the
   strength of an update that failed part way.
   --------------------------------------------------------------------------- */

/** The user confirmed this reading by hand. One step towards the tap going away. */
export function recordConfirmation(
  ledger: TrustLedger,
  proposal: AlertProposal,
  now: number,
): TrustLedger {
  const key = trustKey(proposal);
  if (!key) return ledger;

  const prev = ledger[key];
  // A revoked pattern starts again from zero rather than resuming: what was
  // wrong was the pattern, and the confirmations before it prove nothing.
  const base = prev && !prev.revokedAt && Number.isFinite(prev.confirmations)
    ? Math.max(0, prev.confirmations)
    : 0;

  return {
    ...ledger,
    [key]: { confirmations: base + 1, lastConfirmedAt: now },
  };
}

/**
 * The user said no to this reading.
 *
 * Counted as a revocation rather than a missed step. Somebody dismissing a
 * proposal is telling us the reading was wrong, and a pattern that produces
 * wrong readings is precisely the pattern that must not be filing anything
 * unasked.
 */
export function recordRejection(
  ledger: TrustLedger,
  proposal: AlertProposal,
  now: number,
): TrustLedger {
  const key = trustKey(proposal);
  if (!key) return ledger;
  return { ...ledger, [key]: { confirmations: 0, lastConfirmedAt: now, revokedAt: now } };
}

/**
 * The user undid something that was filed for them.
 *
 * The strongest signal available, and the only one that arrives after the
 * damage: this pattern already wrote a row somebody did not want.
 */
export function revokeKey(ledger: TrustLedger, key: string, now: number): TrustLedger {
  if (!key) return ledger;
  const prev = ledger[key];
  return {
    ...ledger,
    [key]: { confirmations: 0, lastConfirmedAt: prev?.lastConfirmedAt ?? now, revokedAt: now },
  };
}

/** Forget every opinion. What "start again" in settings does. */
export function clearTrust(): TrustLedger {
  return {};
}

/**
 * How close a pattern is to being trusted, for showing the user.
 *
 * Progress is worth surfacing: it is the only way somebody can tell that this
 * feature is going to start writing before it does.
 */
export function trustProgress(
  ledger: TrustLedger,
  proposal: AlertProposal,
): { key: string; confirmations: number; needed: number; revoked: boolean } | null {
  const key = trustKey(proposal);
  if (!key) return null;
  const record = ledger[key];
  return {
    key,
    confirmations: Math.max(0, Number.isFinite(record?.confirmations) ? (record?.confirmations ?? 0) : 0),
    needed: CONFIRMATIONS_TO_TRUST,
    revoked: Boolean(record?.revokedAt),
  };
}

/* ---------------------------------------------------------------------------
   Reading the ledger back off a device.
   --------------------------------------------------------------------------- */

/**
 * Whatever was stored, made safe to use.
 *
 * Anything unrecognisable becomes an empty ledger, which means "nothing is
 * trusted" and therefore "ask about everything". That is the correct way for
 * this to fail: a cleared cache, a truncated write or a value from a future
 * version of the app all cost the user some taps, and none of them can cost
 * them a wrong row.
 */
export function parseTrustLedger(raw: string | null | undefined): TrustLedger {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: TrustLedger = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!key || typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const confirmations = typeof v.confirmations === 'number' && Number.isFinite(v.confirmations)
      ? Math.max(0, Math.floor(v.confirmations))
      : 0;
    const lastConfirmedAt = typeof v.lastConfirmedAt === 'number' && Number.isFinite(v.lastConfirmedAt)
      ? v.lastConfirmedAt
      : 0;
    const revokedAt = typeof v.revokedAt === 'number' && Number.isFinite(v.revokedAt)
      ? v.revokedAt
      : undefined;
    out[key] = revokedAt === undefined
      ? { confirmations, lastConfirmedAt }
      : { confirmations, lastConfirmedAt, revokedAt };
  }
  return out;
}

/** Settings as stored, made safe. Unknown or damaged means switched off. */
export function parseSettings(raw: string | null | undefined): AutoAddSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
  const v = parsed as Record<string, unknown>;

  // Only an explicit `true` turns this on. Anything else - missing, a string,
  // a number - means off, because the failure that matters is a damaged value
  // being read as permission to write.
  const enabled = v.enabled === true;
  const ceiling = typeof v.ceilingMinor === 'number'
    && Number.isFinite(v.ceilingMinor)
    && v.ceilingMinor > 0
    ? Math.floor(v.ceilingMinor)
    : DEFAULT_CEILING_MINOR;

  return { enabled, ceilingMinor: ceiling };
}
