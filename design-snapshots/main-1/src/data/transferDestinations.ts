/**
 * Where money can go when it leaves an account.
 *
 * "To account" used to list only the user's own accounts, so sending money to
 * another bank or paying an app had nowhere to go and had to be typed into the
 * free-text payee field instead. This is the catalogue behind that dropdown.
 *
 * `categoryHint` is the default expense category for destinations that are not
 * your own account - matched by name against whatever categories the user
 * actually has, never assumed to exist.
 */
export type DestinationKind = 'bank' | 'wallet' | 'merchant';

export interface TransferDestination {
  /** Stable id used as the option value; prefixed so it cannot collide with an account id. */
  id: string;
  label: string;
  kind: DestinationKind;
  /** Name of the expense category this usually belongs to. */
  categoryHint?: string;
}

const bank = (label: string): TransferDestination => ({
  id: `bank:${label.toLowerCase().replace(/\s+/g, '-')}`,
  label,
  kind: 'bank',
  // Moving money to a bank is not shopping or dining; it has no natural
  // spending category, so it falls through to Other.
  categoryHint: 'Other',
});

const app = (label: string, categoryHint: string): TransferDestination => ({
  id: `app:${label.toLowerCase().replace(/\s+/g, '-')}`,
  label,
  kind: 'merchant',
  categoryHint,
});

const wallet = (label: string): TransferDestination => ({
  id: `wallet:${label.toLowerCase().replace(/\s+/g, '-')}`,
  label,
  kind: 'wallet',
  categoryHint: 'Other',
});

export const BANKS: TransferDestination[] = [
  'HDFC Bank', 'State Bank of India', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India',
  'IndusInd Bank', 'IDFC First Bank', 'Yes Bank', 'Federal Bank', 'RBL Bank',
  'Bank of India', 'Indian Bank', 'AU Small Finance Bank', 'Bandhan Bank',
].map(bank);

export const WALLETS: TransferDestination[] = [
  'Paytm', 'PhonePe', 'Google Pay', 'Amazon Pay', 'Mobikwik',
].map(wallet);

export const MERCHANTS: TransferDestination[] = [
  app('Swiggy', 'Food & Dining'),
  app('Zomato', 'Food & Dining'),
  app('Blinkit', 'Groceries'),
  app('Zepto', 'Groceries'),
  app('Swiggy Instamart', 'Groceries'),
  app('BigBasket', 'Groceries'),
  app('Dunzo', 'Groceries'),
  app('Amazon', 'Shopping'),
  app('Flipkart', 'Shopping'),
  app('Myntra', 'Shopping'),
  app('Meesho', 'Shopping'),
  app('Nykaa', 'Shopping'),
  app('Uber', 'Transport'),
  app('Ola', 'Transport'),
  app('Rapido', 'Transport'),
  app('IRCTC', 'Transport'),
  app('MakeMyTrip', 'Transport'),
  app('Netflix', 'Entertainment'),
  app('Spotify', 'Entertainment'),
  app('BookMyShow', 'Entertainment'),
  app('Jio', 'Utilities'),
  app('Airtel', 'Utilities'),
  app('Vi', 'Utilities'),
  app('Tata Play', 'Utilities'),
  app('Apollo Pharmacy', 'Health'),
  app('PharmEasy', 'Health'),
  app('Practo', 'Health'),
];

/** Chosen when nothing in the list fits; the user types the name themselves. */
export const OTHER_DESTINATION_ID = 'other:custom';

const ALL = [...BANKS, ...WALLETS, ...MERCHANTS];

export const findDestination = (id: string): TransferDestination | undefined =>
  ALL.find((d) => d.id === id);

/**
 * True when the id names somewhere outside the user's own accounts.
 *
 * The distinction decides what the entry actually is: money moved between your
 * own accounts leaves your net worth alone, money sent anywhere else does not.
 */
export const isExternalDestination = (id: string): boolean =>
  id === OTHER_DESTINATION_ID || ALL.some((d) => d.id === id);
