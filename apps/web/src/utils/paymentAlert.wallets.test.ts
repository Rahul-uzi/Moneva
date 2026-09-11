import { describe, it, expect } from 'vitest';
import { alertToProposal, appLabel, isPaymentApp, type PaymentAlert } from './paymentAlert';
import { describeProposal } from '../components/financial/paymentInboxRules';

/**
 * Every rail a person in India is actually paid through, end to end.
 *
 * There are two gates in front of the parser and only one of them lives in
 * TypeScript. PaymentNotificationFilter.java decides whether an app is watched
 * at all, and its unit tests cover that; this file covers what happens once a
 * notification is through: does the app get a name a person recognises, does
 * the money go the right way, and does the row end up described usefully.
 *
 * The wordings are the shapes these apps actually post - a UPI app announces
 * "You paid X to Y", a bank announces "Rs.N debited from A/c", a card app
 * announces "spent on card". They differ enough that each one has broken the
 * parser at some point.
 */

const alertFrom = (packageName: string, title: string, text: string): PaymentAlert => ({
  id: 'a1', packageName, title, text, postedAt: Date.UTC(2026, 8, 8, 11, 0),
});

const read = (packageName: string, title: string, text: string) => {
  const p = alertToProposal(alertFrom(packageName, title, text));
  if (!p) throw new Error(`refused outright: ${title} / ${text}`);
  return {
    kind: p.kind,
    rupees: p.amountPaise / 100,
    merchant: p.merchant,
    source: p.sources[0],
    description: describeProposal(p.merchant, p.sources),
  };
};

describe('UPI apps and wallets', () => {
  it('Google Pay', () => {
    expect(read('com.google.android.apps.nbu.paisa.user', 'Karan paid you ₹45', 'Tap to view'))
      .toMatchObject({ kind: 'credit', rupees: 45, merchant: 'Karan',
                       description: 'Google Pay - Karan' });
  });

  it('PhonePe', () => {
    expect(read('com.phonepe.app', 'Payment Successful', 'You paid ₹250 to Swiggy'))
      .toMatchObject({ kind: 'debit', rupees: 250, merchant: 'Swiggy',
                       description: 'Swiggy' });  // a brand names itself
  });

  it('Paytm wallet top-up is a move, not a spend', () => {
    expect(read('net.one97.paytm', 'Paytm', 'Rs.1000 added to your Paytm Wallet'))
      .toMatchObject({ kind: 'transfer', rupees: 1000, source: 'Paytm' });
  });

  it('BHIM', () => {
    expect(read('in.org.npci.upiapp', 'BHIM', '₹500 debited from A/c XX1234 to rahul@upi'))
      .toMatchObject({ kind: 'debit', rupees: 500, source: 'BHIM' });
  });

  it('Amazon Pay', () => {
    expect(read('in.amazon.mShop.android.shopping', 'Amazon Pay', 'You paid ₹349 to Amazon'))
      .toMatchObject({ kind: 'debit', rupees: 349, source: 'Amazon Pay' });
  });

  it('CRED card bill is a move, not a second expense', () => {
    // The purchases on the card were already expenses when they happened.
    expect(read('com.dreamplug.androidapp', 'CRED',
                'Payment of Rs.18,750 towards your HDFC Credit Card received'))
      .toMatchObject({ kind: 'transfer', rupees: 18750 });
  });

  it('Samsung Wallet', () => {
    expect(read('com.samsung.android.spaymini', 'Samsung Wallet',
                'Rs.1,250.00 spent on HDFC Card XX1234 at BIG BAZAAR'))
      .toMatchObject({ kind: 'debit', rupees: 1250, merchant: 'BIG BAZAAR',
                       source: 'Samsung Wallet' });
  });

  it('slice', () => {
    expect(read('in.slice.android', 'slice', 'You spent Rs.640 at Zomato'))
      .toMatchObject({ kind: 'debit', rupees: 640, source: 'slice' });
  });

  it('Fi Money', () => {
    expect(read('com.epifi.paisa', 'Fi', 'You paid ₹180 to Chai Point'))
      .toMatchObject({ kind: 'debit', rupees: 180, source: 'Fi Money' });
  });

  it('LazyPay', () => {
    expect(read('com.whizdm.lazypay', 'LazyPay', 'Rs.899 spent at Swiggy'))
      .toMatchObject({ kind: 'debit', rupees: 899, source: 'LazyPay' });
  });
});

/**
 * WhatsApp Pay is a real UPI rail, and its notifications are indistinguishable
 * in shape from chat - which is why the Java filter judges it by a stricter
 * test before anything reaches here. By this point it has already passed.
 */
describe('WhatsApp Pay', () => {
  it('reads money leaving', () => {
    expect(read('com.whatsapp', 'Karan', 'You sent ₹500 to Karan'))
      .toMatchObject({ kind: 'debit', rupees: 500, source: 'WhatsApp Pay' });
  });

  it('reads money arriving, and names the payer', () => {
    expect(read('com.whatsapp', 'Karan', 'Karan paid you ₹45'))
      .toMatchObject({ kind: 'credit', rupees: 45, merchant: 'Karan',
                       description: 'WhatsApp Pay - Karan' });
  });
});

describe('banks', () => {
  it('SBI cash withdrawal is a move, not a spend', () => {
    // Cash out of an ATM is in your pocket, not gone.
    expect(read('com.sbi.lotusintouch', 'YONO SBI',
                'Rs.5000 withdrawn from A/c XX1234 at SBI ATM'))
      .toMatchObject({ kind: 'transfer', rupees: 5000 });
  });

  it('HDFC, where the amount splits the verb from its preposition', () => {
    expect(read('com.snapwork.hdfc', 'HDFC Bank',
                'Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL'))
      .toMatchObject({ kind: 'debit', rupees: 500, merchant: 'RAHUL' });
  });

  it('ICICI card spend names the shop, not the bank', () => {
    expect(read('com.csam.icici.bank.imobile', 'iMobile',
                'INR 2,500.00 spent on ICICI Card XX1234 at AMAZON'))
      .toMatchObject({ kind: 'debit', rupees: 2500, merchant: 'AMAZON' });
  });

  it('IDFC FIRST', () => {
    expect(read('com.idfcfirstbank.optimus', 'IDFC FIRST', 'Rs.980 debited from A/c XX8899'))
      .toMatchObject({ kind: 'debit', rupees: 980, source: 'IDFC FIRST Bank' });
  });

  it('a bank SMS arriving in the messages app', () => {
    const row = read('com.google.android.apps.messaging', 'VM-HDFCBK',
                     'Rs.1,230.00 debited from A/c XX4821 to SWIGGY');
    expect(row).toMatchObject({ kind: 'debit', rupees: 1230, merchant: 'SWIGGY' });
    // The SMS app did not move the money; it must not be named as the rail.
    expect(row.description).toBe('SWIGGY');
  });
});

describe('naming the rail', () => {
  it('every watched app has a name a person would recognise', () => {
    const packages = [
      'com.google.android.apps.nbu.paisa.user', 'com.phonepe.app', 'net.one97.paytm',
      'in.org.npci.upiapp', 'in.amazon.mShop.android.shopping', 'com.dreamplug.androidapp',
      'com.mobikwik_new', 'com.freecharge.android', 'com.samsung.android.spay',
      'com.samsung.android.spaymini', 'in.slice.android', 'money.jupiter.app',
      'com.epifi.paisa', 'com.naviapp', 'com.fampay.in', 'com.myairtelapp',
      'com.jio.myjio', 'com.hdfcbank.payzapp', 'com.whizdm.lazypay',
      'com.olacabs.customer', 'com.whatsapp', 'com.sbi.lotusintouch',
      'com.snapwork.hdfc', 'com.csam.icici.bank.imobile', 'com.axis.mobile',
      'com.msf.kbank.mobile', 'com.fss.indus', 'com.idfcfirstbank.optimus',
      'com.fss.fedmobile', 'com.rblbank.mobank', 'com.aubank.aubankapp',
    ];
    // A package with no label falls through as the raw package name, which
    // would end up in a transaction description as "com.epifi.paisa".
    const unnamed = packages.filter((p) => appLabel(p) === p);
    expect(unnamed).toEqual([]);
  });

  it('counts every payment rail as one, and the SMS app as not', () => {
    expect(isPaymentApp('PhonePe')).toBe(true);
    expect(isPaymentApp('WhatsApp Pay')).toBe(true);
    expect(isPaymentApp('Samsung Wallet')).toBe(true);
    // A bank alert merely ARRIVES in Messages; it did not move the money.
    expect(isPaymentApp('Messages')).toBe(false);
  });
});
