/**
 * Turning a payment notification into something the app can propose.
 *
 * The reading itself is `parseTransactionSms` - a bank's notification and a
 * bank's SMS are the same sentence in a different envelope, so there is one
 * parser and this only wraps it. What is genuinely new here is everything
 * around the reading:
 *
 *   - **The same payment arrives more than once.** Pay by UPI and the phone
 *     may show a Google Pay alert, a bank alert, and a bank SMS - three
 *     notifications, one payment. Recording three would be worse than
 *     recording none, so near-identical alerts collapse into one proposal.
 *   - **Confirming twice must not spend twice.** The id sent to the server is
 *     derived from the payment itself, so a double tap, a retry after a
 *     dropped connection, or the same alert seen again after a reinstall all
 *     land on the row that already exists.
 *
 * Pure, like the parser: no Capacitor, no network, no clock of its own. Every
 * time comes in as an argument, so all of this is testable at a desk.
 */

import { parseTransactionSms, type ParsedSms } from './smsParse';

/** One notification, as the Android listener handed it over. */
export interface PaymentAlert {
  /** Stable id from the native store; used to acknowledge it afterwards. */
  id: string;
  packageName: string;
  title: string;
  text: string;
  /** Epoch milliseconds, from the notification itself. */
  postedAt: number;
}

/** A transaction the app is offering to record. Never written without a tap. */
export interface AlertProposal {
  /** Every alert this proposal came from - all of them get acknowledged. */
  alertIds: string[];
  kind: ParsedSms['kind'];
  amountPaise: number;
  merchant?: string;
  accountTail?: string;
  reference?: string;
  /** Which rule read it, so a wrong reading can be traced to one line. */
  matchedBy: string;
  /** Where it came from, for the review card: 'Google Pay', 'Messages'... */
  sources: string[];
  postedAt: number;
  /** Deterministic, so confirming the same payment twice is idempotent. */
  clientMutationId: string;
}

/** Package names as a person would recognise them. */
const APP_NAMES: Record<string, string> = {
  'com.google.android.apps.nbu.paisa.user': 'Google Pay',
  'com.phonepe.app': 'PhonePe',
  'net.one97.paytm': 'Paytm',
  'in.org.npci.upiapp': 'BHIM',
  'in.amazon.mShop.android.shopping': 'Amazon Pay',
  'com.dreamplug.androidapp': 'CRED',
  'com.mobikwik_new': 'MobiKwik',
  'com.freecharge.android': 'Freecharge',
  'com.samsung.android.spay': 'Samsung Wallet',
  'com.samsung.android.spaymini': 'Samsung Wallet',
  'in.slice.android': 'slice',
  'money.jupiter.app': 'Jupiter',
  'com.epifi.paisa': 'Fi Money',
  'com.naviapp': 'Navi',
  'com.fampay.in': 'FamPay',
  'com.myairtelapp': 'Airtel Payments Bank',
  'com.jio.myjio': 'JioPay',
  'com.hdfcbank.payzapp': 'PayZapp',
  'com.whizdm.lazypay': 'LazyPay',
  'com.olacabs.customer': 'Ola Money',
  // A chat app that also moves money. Named like any other rail, because
  // by the time a message gets here it has already cleared the receipt
  // test in PaymentNotificationFilter - see CONVERSATIONAL_PACKAGES.
  'com.whatsapp': 'WhatsApp Pay',
  'com.whatsapp.w4b': 'WhatsApp Pay',
  'com.sbi.lotusintouch': 'SBI YONO',
  'com.sbi.SBIFreedomPlus': 'SBI',
  'com.snapwork.hdfc': 'HDFC Bank',
  'com.csam.icici.bank.imobile': 'ICICI iMobile',
  'com.axis.mobile': 'Axis Bank',
  'com.msf.kbank.mobile': 'Kotak',
  'com.bankofbaroda.mconnect': 'Bank of Baroda',
  'com.infrasofttech.indianbank': 'Indian Bank',
  'com.canarabank.mobility': 'Canara Bank',
  'com.fss.pnbpsp': 'PNB',
  'com.YesBank': 'Yes Bank',
  'com.idbibank.mpassbook': 'IDBI',
  'com.bankofindia.boiapp': 'Bank of India',
  'com.unionbankofindia.vyom': 'Union Bank',
  'com.fss.indus': 'IndusInd Bank',
  'com.idfcfirstbank.optimus': 'IDFC FIRST Bank',
  'com.fss.fedmobile': 'Federal Bank',
  'com.rblbank.mobank': 'RBL Bank',
  'com.aubank.aubankapp': 'AU Small Finance Bank',
  'com.google.android.apps.messaging': 'Messages',
  'com.samsung.android.messaging': 'Messages',
  'com.android.mms': 'Messages',
  'com.textra': 'Messages',
};

export const appLabel = (packageName: string): string =>
  APP_NAMES[packageName] ?? packageName;

/**
 * Whether a source label names the app the money actually moved through.
 *
 * "Google Pay" is worth saying in a description - it is the rail, and it is
 * how people describe the payment to themselves. "Messages" is not: a bank's
 * SMS merely arrives there, and "Messages - SWIGGY" would name the wrong
 * thing entirely. An unrecognised package name is never worth showing.
 */
export const isPaymentApp = (label: string): boolean =>
  label !== 'Messages' && Object.values(APP_NAMES).includes(label);

/**
 * A notification's whole text.
 *
 * The title carries the sender for an SMS ("VM-HDFCBK") and the headline for
 * an app alert ("Paid ₹250"), and either half can hold the part that decides
 * what this is - so the parser is given both.
 */
export const alertBody = (alert: PaymentAlert): string => {
  const title = (alert.title ?? '').trim();
  const text = (alert.text ?? '').trim();
  if (!title) return text;
  if (!text) return title;

  // A chat app titles the notification with the sender and then repeats the
  // name at the start of the message: title "Karan", text "Karan paid you
  // Rs.45". Joined blindly that reads "Karan Karan paid you Rs.45", and the
  // payer comes out as "Karan Karan" - which is then the description on the
  // row and the name the categoriser learns.
  if (text.toLowerCase().startsWith(title.toLowerCase())) return text;

  return `${title} ${text}`;
};

/* --------------------------------------------------------------------------
   A deterministic id

   The server treats client_mutation_id as the identity of a write, so the
   same payment must always produce the same id - that is what makes a double
   tap, a retry, or the same alert seen again harmless.

   Which rules out a random uuid, and rules out hashing the notification TEXT:
   the three alerts for one payment are worded differently. It is derived from
   what actually identifies the payment instead - direction, amount, and the
   minute it happened.

   Not a real UUID v5 (that needs SHA-1, and WebCrypto's digest is async while
   this is used during render). Four independently seeded 32-bit passes, laid
   out as a valid v5-shaped string. For the number of payments one person
   makes, the collision risk is not a real number - and a collision would mean
   one duplicate refused, not money lost.
   -------------------------------------------------------------------------- */
const hash32 = (input: string, seed: number): number => {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    // FNV-1a's prime, as shifts - Math.imul keeps it 32-bit.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

export const stableMutationId = (basis: string): string => {
  const a = hex8(hash32(basis, 0x811c9dc5));
  const b = hex8(hash32(basis, 0x1b873593));
  const c = hex8(hash32(basis, 0xcc9e2d51));
  const d = hex8(hash32(basis, 0x85ebca6b));
  const raw = a + b + c + d; // 32 hex chars

  // Stamp the version and variant nibbles so this is a well-formed UUID and
  // not merely 32 hex characters with dashes in it.
  const v = `5${raw.slice(13, 16)}`;                               // version 5
  const variant = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16); // 10xx
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${v}-${variant}${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
};

/** The minute a payment happened, which is as precise as alerts agree on. */
const minuteOf = (ms: number): number => Math.floor(ms / 60000);

/**
 * What makes two alerts the same payment.
 *
 * Direction and amount, plus the minute - not the merchant, which the three
 * alerts for one payment often spell differently ("SWIGGY", "Swiggy Ltd",
 * "UPI/SWIGGY/..."), and not the source app, which is exactly what differs.
 */
const identityOf = (
  kind: string,
  amountPaise: number,
  postedAt: number,
  reference?: string,
  owner = '',
): string =>
  // The bank's own reference when there is one. Without it, two genuinely
  // separate payments of the same amount in the same minute - the same fare
  // twice, a bill split into equal halves - derive the SAME id, and the server
  // treats the second as a replay of the first and returns the row it already
  // has. The client reads that as success. Half the money is simply never
  // recorded, and the only clue is a total that is quietly too low.
  //
  // A reference is unique per payment and shared by every alert describing it,
  // which is exactly the property this key needs. The minute stays as the
  // fallback for alerts that quote no reference, where the ambiguity is real
  // and nothing in the text can settle it.
  //
  // `owner` is here for the same reason the import path puts it in its own
  // basis. client_mutation_id is unique across the WHOLE table, so without an
  // owner two different people paying the same amount in the same minute
  // derive the same id - and the second one is answered with a permanent 403
  // that no retry can clear, so their payment can never be recorded at all.
  // It also closes an oracle: the id is derived from the payment, so anyone
  // could construct one for a GUESSED payment and learn from 403-versus-201
  // whether a stranger had recorded it.
  `${kind}|${amountPaise}|${minuteOf(postedAt)}|${reference ?? ''}|${owner}`;

/** Reads one alert, or returns null when it is not a completed payment. */
export const alertToProposal = (
  alert: PaymentAlert,
  owner = '',
): AlertProposal | null => {
  const parsed = parseTransactionSms(alertBody(alert));
  if (!parsed) return null;

  return {
    alertIds: [alert.id],
    kind: parsed.kind,
    amountPaise: parsed.amountPaise,
    merchant: parsed.merchant,
    accountTail: parsed.accountTail,
    reference: parsed.reference,
    matchedBy: parsed.matchedBy,
    sources: [appLabel(alert.packageName)],
    postedAt: alert.postedAt,
    clientMutationId: stableMutationId(
      identityOf(parsed.kind, parsed.amountPaise, alert.postedAt, parsed.reference, owner),
    ),
  };
};

/**
 * How far apart two alerts for one payment can be.
 *
 * A bank's SMS often trails its app's push by a few seconds, and occasionally
 * by a minute or two. Too narrow and the same payment is offered twice; too
 * wide and two genuine identical payments - the same fare twice, a split bill
 * paid in equal halves - get silently merged into one. Ninety seconds is the
 * point where the first risk is largely gone and the second is still remote.
 */
export const MERGE_WINDOW_MS = 90_000;

/**
 * Whether two same-amount alerts really describe one payment.
 *
 * The window alone cannot tell "one payment announced twice" from "the same
 * amount paid twice in a minute", and it guesses the first - which merges two
 * real payments into one row and loses half the money before anything reaches
 * the server. Where both alerts quote the bank's reference, that guess is not
 * needed: two references that differ are two payments, whatever the clock says.
 *
 * Only a DISAGREEMENT separates them. One alert quoting a reference and
 * another staying silent is the ordinary case - an app push and a bank SMS for
 * one payment - and must still merge.
 */
const samePayment = (a: AlertProposal, b: AlertProposal): boolean =>
  !a.reference || !b.reference || a.reference === b.reference;

/**
 * Collapses the several alerts one payment produces into a single proposal.
 *
 * Merged proposals keep every alert id, so acknowledging one clears all of
 * them from the native queue and the payment cannot come back tomorrow. The
 * richest reading wins the details: a bank SMS usually names the account, an
 * app alert usually names the merchant, and taking the best of each gives a
 * fuller row than either did.
 */
export const mergeProposals = (proposals: AlertProposal[]): AlertProposal[] => {
  // A LIST per amount-and-direction, not a single entry. The same amount can
  // legitimately be paid twice in a day, and holding only the latest quietly
  // dropped the earlier payment instead of keeping both.
  const groups = new Map<string, AlertProposal[]>();

  // Oldest first, so the earliest alert anchors each cluster.
  const ordered = [...proposals].sort((a, b) => a.postedAt - b.postedAt);

  for (const p of ordered) {
    const key = `${p.kind}|${p.amountPaise}`;
    const bucket = groups.get(key);
    if (!bucket) {
      groups.set(key, [{ ...p, alertIds: [...p.alertIds], sources: [...p.sources] }]);
      continue;
    }

    // Measured against the cluster's FIRST alert, not its most recent one.
    // Chaining off the latest would let a run of same-amount payments each
    // within the window of the one before it merge into a single row without
    // limit; anchoring bounds a cluster to the window's width.
    const anchor = bucket[bucket.length - 1];
    if (p.postedAt - anchor.postedAt <= MERGE_WINDOW_MS && samePayment(anchor, p)) {
      anchor.alertIds.push(...p.alertIds);
      if (!anchor.sources.includes(p.sources[0])) anchor.sources.push(p.sources[0]);
      // Fill the gaps rather than overwrite: whichever alert knew a thing keeps it.
      anchor.merchant = anchor.merchant ?? p.merchant;
      anchor.accountTail = anchor.accountTail ?? p.accountTail;
      anchor.reference = anchor.reference ?? p.reference;
      continue;
    }

    // Same amount and direction, but too far apart to be one payment.
    bucket.push({ ...p, alertIds: [...p.alertIds], sources: [...p.sources] });
  }

  return [...groups.values()].flat().sort((a, b) => b.postedAt - a.postedAt);
};

/** The whole pipeline: raw alerts in, proposals to review out. */
export const proposalsFromAlerts = (
  alerts: PaymentAlert[],
  owner = '',
): AlertProposal[] =>
  // Called with an arrow rather than passed by reference: `map` hands its
  // callback the INDEX as a second argument, so `map(alertToProposal)` would
  // quietly make every proposal's owner its position in the list.
  mergeProposals(
    alerts
      .map((alert) => alertToProposal(alert, owner))
      .filter((p): p is AlertProposal => p !== null),
  );

/** Alerts that read as nothing. Cleared without ever becoming a proposal. */
export const unreadableAlertIds = (alerts: PaymentAlert[]): string[] =>
  alerts.filter((a) => alertToProposal(a) === null).map((a) => a.id);
