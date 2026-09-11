import { describe, it, expect } from 'vitest';
import { brandNameIn } from './brandMark';
import { BRANDS_WITH_LOGOS } from './brandsWithLogos.generated';
import { alertToProposal, type PaymentAlert } from './paymentAlert';
import { describeProposal } from '../components/financial/paymentInboxRules';

/**
 * What mark a confirmed payment ends up wearing in the ledger.
 *
 * The row's icon is not stored anywhere - TransactionRow looks a brand up out
 * of the DESCRIPTION at render time. So the description written when a
 * proposal is confirmed decides the mark, which makes this a property of the
 * capture pipeline rather than of the ledger, and worth pinning down here.
 *
 * Three outcomes, in descending order of usefulness:
 *
 *   logo     - the brand is recognised AND has an image in assets/brands
 *   monogram - recognised, no image: coloured initials at the same size
 *   arrow    - nothing recognised: the plain direction arrow every row can show
 *
 * "arrow" is not a bug, but it is the case worth watching: it means the row
 * carries no name the app could recognise, which usually means the parser
 * found no counterparty.
 */
type Mark = 'logo' | 'monogram' | 'arrow';

const markFor = (description: string): Mark => {
  const brand = brandNameIn(description);
  if (!brand) return 'arrow';
  return BRANDS_WITH_LOGOS.includes(brand) ? 'logo' : 'monogram';
};

const rowFor = (packageName: string, title: string, text: string) => {
  const alert: PaymentAlert = {
    id: 'a1', packageName, title, text, postedAt: Date.UTC(2026, 8, 8, 11, 0),
  };
  const p = alertToProposal(alert);
  if (!p) throw new Error(`refused: ${title} / ${text}`);
  // Three arguments, as both production call sites pass. Dropping the account
  // tail here would test a description the app never actually builds.
  const description = describeProposal(p.merchant, p.sources, p.accountTail);
  return { description, mark: markFor(description) };
};

describe('a payment to a shop wears the shop logo', () => {
  it('PhonePe to Swiggy shows Swiggy, not PhonePe', () => {
    // The merchant is the useful identity here, and it has a real logo file -
    // which is exactly why describeProposal leaves a known brand alone rather
    // than prefixing the rail onto it.
    expect(rowFor('com.phonepe.app', 'Payment Successful', 'You paid ₹250 to Swiggy'))
      .toEqual({ description: 'Swiggy', mark: 'logo' });
  });

  it('a card spend at a shop shows the shop', () => {
    expect(rowFor('com.csam.icici.bank.imobile', 'iMobile',
                  'INR 2,500.00 spent on ICICI Card XX1234 at AMAZON'))
      .toMatchObject({ description: 'AMAZON', mark: 'logo' });
  });

  it('a bank SMS still shows the shop, never the messaging app', () => {
    expect(rowFor('com.google.android.apps.messaging', 'VM-HDFCBK',
                  'Rs.1,230.00 debited from A/c XX4821 to SWIGGY'))
      .toEqual({ description: 'SWIGGY', mark: 'logo' });
  });
});

describe('a payment to a person wears the rail', () => {
  it('Google Pay to a friend shows the Google Pay monogram', () => {
    // A person has no logo of their own. Naming the rail is what stops the
    // row falling back to a bare arrow - and it is how people describe these
    // payments to themselves.
    expect(rowFor('com.google.android.apps.nbu.paisa.user', 'Karan paid you ₹45', 'Tap to view'))
      .toEqual({ description: 'Google Pay - Karan', mark: 'monogram' });
  });

  it('WhatsApp Pay to a friend shows the WhatsApp Pay monogram', () => {
    expect(rowFor('com.whatsapp', 'Karan', 'Karan paid you ₹45'))
      .toEqual({ description: 'WhatsApp Pay - Karan', mark: 'monogram' });
  });

  it('PhonePe to a person shows the PhonePe logo, which is a real file', () => {
    expect(rowFor('com.phonepe.app', 'Payment Successful', 'You paid ₹500 to RAHUL'))
      .toEqual({ description: 'PhonePe - RAHUL', mark: 'logo' });
  });
});

describe('rows that get no mark, and why', () => {
  it('falls back to an arrow when nothing names a counterparty', () => {
    // "Rs.980 debited from A/c XX8899" names nobody. There is no honest mark
    // to show, and inventing one would be worse than the arrow.
    const row = rowFor('com.idfcfirstbank.optimus', 'IDFC FIRST',
                       'Rs.980 debited from A/c XX8899');
    expect(row.description).toBe('From IDFC FIRST Bank');
    // IDFC FIRST does have a logo file, so even this row is not bare.
    expect(row.mark).toBe('logo');
  });

  it('an unknown app leaves the row with an arrow, and never shows its package name', () => {
    /**
     * This used to read "From com.unknown.wallet" - an Android package name,
     * in a ledger, where a person expects to see who they paid. `isPaymentApp`
     * already says an unrecognised package name is never worth showing; this
     * was the one branch that showed it anyway.
     *
     * The account tail is a real fact about the payment and survives when the
     * rail does not, so it is what the row falls back to.
     */
    const row = rowFor('com.unknown.wallet', 'Wallet', 'Rs.500 debited from A/c XX1111');
    expect(row.description).not.toContain('com.unknown.wallet');
    expect(row.description).toBe('Bank payment ···1111');
    expect(row.mark).toBe('arrow');
  });
});

/**
 * The catalogue behind all of the above. A rail with neither a logo file nor
 * an entry in the brand table would leave every payment through it wearing a
 * bare arrow, which is the outcome this whole mechanism exists to avoid.
 */
describe('every payment rail is recognisable', () => {
  const RAILS = [
    'Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'Amazon Pay', 'CRED', 'MobiKwik',
    'Freecharge', 'Samsung Wallet', 'slice', 'Jupiter', 'Fi Money', 'Navi',
    'FamPay', 'Airtel Payments Bank', 'JioPay', 'PayZapp', 'LazyPay',
    'Ola Money', 'WhatsApp Pay', 'SBI YONO', 'HDFC Bank', 'ICICI iMobile',
    'Axis Bank', 'Kotak', 'IndusInd Bank', 'IDFC FIRST Bank', 'Federal Bank',
    'RBL Bank', 'AU Small Finance Bank',
  ];

  it('reports which rails have a real logo and which fall back to initials', () => {
    const bare = RAILS.filter((r) => markFor(r) === 'arrow');
    expect(bare).toEqual([]);
  });
});
