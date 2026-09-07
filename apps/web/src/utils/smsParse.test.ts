import { describe, it, expect } from 'vitest';
import { parseTransactionSms, refusalReason, rupeesToPaise } from './smsParse';

/**
 * The parser's job is to be RIGHT or SILENT. A missed transaction costs one
 * tap; an invented one puts a wrong number in the balance and the user has to
 * find it. So most of what follows is about refusing.
 */

describe('rupeesToPaise', () => {
  it('never goes through a float', () => {
    // parseFloat('1234.56') * 100 is 123455.99999999999.
    expect(rupeesToPaise('1234.56')).toBe(123456);
    expect(rupeesToPaise('0.07')).toBe(7);
    expect(rupeesToPaise('8.29')).toBe(829);
  });

  it('reads the grouping banks actually write', () => {
    expect(rupeesToPaise('1,63,343.00')).toBe(16334300);
    expect(rupeesToPaise('75,000')).toBe(7500000);
  });

  it('pads a single decimal place rather than misreading it', () => {
    expect(rupeesToPaise('12.5')).toBe(1250);
  });

  it('refuses anything that is not a plain amount', () => {
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('12.345')).toBeNull();
    expect(rupeesToPaise('1.2.3')).toBeNull();
    expect(rupeesToPaise('twelve')).toBeNull();
    expect(rupeesToPaise('-50')).toBeNull();
  });
});

describe('refusing what is not a transaction', () => {
  const refused: Array<[string, string]> = [
    ['otp', 'Your OTP for a transaction of Rs.5000 is 448213. Do not share it with anyone.'],
    ['otp', '448213 is your one-time password for INR 2,500.00. Valid 10 minutes.'],
    ['failed', 'Your payment of Rs.1,200.00 to SWIGGY has failed. No amount was debited.'],
    ['failed', 'Transaction of INR 900 was declined due to insufficient balance.'],
    ['request', 'RAHUL has requested money Rs.500.00 via UPI. Approve in your app.'],
    ['balance-enquiry', 'Available balance in A/c XX4821 is Rs.1,60,153.00 as on 05-Sep.'],
    ['promotional', 'You are eligible for a pre-approved loan up to Rs.5,00,000. Apply now.'],
    ['reversal', 'Your debit of Rs.1,230.00 has been reversed and credited back.'],
    ['upcoming', 'Your EMI of Rs.12,500.00 will be debited on 10-Sep-2026.'],
  ];

  it.each(refused)('refuses a %s message', (reason, body) => {
    expect(refusalReason(body)).toBe(reason);
    expect(parseTransactionSms(body)).toBeNull();
  });

  /* The dangerous one: an OTP message that also quotes a real amount and the
     word "debited". Refusal runs first precisely for this. */
  it('refuses an OTP even when it names an amount and a direction', () => {
    const body = 'OTP 993211 to authorise Rs.4,999.00 being debited from A/c XX4821.';
    expect(parseTransactionSms(body)).toBeNull();
  });

  /* A balance line inside a real debit alert must not suppress it. */
  it('still reads a debit that happens to quote the balance afterwards', () => {
    const body =
      'Rs.1,230.00 debited from A/c XX4821 on 05-Sep-26. Available balance is Rs.1,58,923.00.';
    expect(parseTransactionSms(body)?.amountPaise).toBe(123000);
  });
});

describe('reading a completed transaction', () => {
  it('reads a debit, with the account and the reference', () => {
    const parsed = parseTransactionSms(
      'Rs.1,230.00 debited from A/c XX4821 on 05-Sep-26 to SWIGGY. UPI Ref no 412233445566.',
    );
    expect(parsed).toMatchObject({
      kind: 'debit',
      amountPaise: 123000,
      accountTail: '4821',
      reference: '412233445566',
      merchant: 'SWIGGY',
    });
  });

  it('reads a credit', () => {
    const parsed = parseTransactionSms(
      'INR 75,000.00 credited to A/c XX4821 on 01-Sep-26. Ref No SAL0925.',
    );
    expect(parsed?.kind).toBe('credit');
    expect(parsed?.amountPaise).toBe(7500000);
  });

  it('reads the rupee symbol as readily as the words', () => {
    expect(parseTransactionSms('₹842 debited from A/c XX4821 at BLINKIT.')?.amountPaise).toBe(84200);
  });

  it('reads a card spend', () => {
    const parsed = parseTransactionSms(
      'Rs 2,450.75 spent on card ending 7781 at BIG BAZAAR on 04-Sep.',
    );
    expect(parsed).toMatchObject({ kind: 'debit', amountPaise: 245075, accountTail: '7781' });
  });

  it('reads a UPI send as a debit', () => {
    const parsed = parseTransactionSms('Payment of Rs.180 sent to CHAI POINT via UPI. Txn 9911223344.');
    expect(parsed?.kind).toBe('debit');
    expect(parsed?.amountPaise).toBe(18000);
  });

  /* Every reading names the rule that produced it, so a wrong one can be
     traced to a single line rather than hunted through a regex soup. */
  it('says which rule read it', () => {
    expect(parseTransactionSms('Rs.100 debited from A/c XX1234.')?.matchedBy).toBe('debited');
    expect(parseTransactionSms('Rs.100 credited to A/c XX1234.')?.matchedBy).toBe('credited');
  });
});

describe('staying silent when it cannot be sure', () => {
  it('returns null for an empty or non-string body', () => {
    expect(parseTransactionSms('')).toBeNull();
    expect(parseTransactionSms('   ')).toBeNull();
    expect(parseTransactionSms(undefined as unknown as string)).toBeNull();
  });

  it('returns null when there is a direction but no amount', () => {
    expect(parseTransactionSms('Your account has been debited. Check the app.')).toBeNull();
  });

  it('returns null when there is an amount but no direction', () => {
    expect(parseTransactionSms('Statement for Rs.1,230.00 is ready to view.')).toBeNull();
  });

  /* A zero-rupee authorisation is a card check, not a purchase. */
  it('returns null for a zero amount', () => {
    expect(parseTransactionSms('Rs.0.00 debited from A/c XX4821 for verification.')).toBeNull();
  });

  it('leaves optional parts undefined rather than guessing them', () => {
    const parsed = parseTransactionSms('Rs.500 debited.');
    expect(parsed?.amountPaise).toBe(50000);
    expect(parsed?.accountTail).toBeUndefined();
    expect(parsed?.reference).toBeUndefined();
  });
});

/**
 * Money ARRIVING, in the words the phone actually uses.
 *
 * Reported from a real phone: someone sent Rs.80 and the app offered it as an
 * expense, showing -80.00. The cause was one word - "Rahul paid you Rs.80"
 * contains "paid", and the rule that owns "paid" means money leaving. Nothing
 * in the table looked at who the recipient was.
 *
 * A miss costs a tap. This costs twice the amount in the wrong direction, and
 * it is the person's own balance that ends up wrong, so each phrasing gets its
 * own line rather than a loop.
 */
describe('someone sending money TO you', () => {
  const incomeFrom = (body: string) => parseTransactionSms(body)?.kind;

  it('reads "paid you" as income, not as a payment you made', () => {
    expect(incomeFrom('Rahul Dhiman paid you Rs.80')).toBe('credit');
    expect(incomeFrom('Rahul paid you Rs.80.00 via UPI')).toBe('credit');
  });

  it('reads "sent you", which used to be read as nothing at all', () => {
    expect(incomeFrom('Rahul Dhiman sent you Rs.80')).toBe('credit');
  });

  it('still reads a payment YOU made as a debit', () => {
    // The guard on the rule above: "paid" only flips when "you" follows it.
    expect(incomeFrom('Paid Rs.250 to Swiggy')).toBe('debit');
    expect(incomeFrom('Payment of Rs.499 to Jio Recharge successful')).toBe('debit');
  });

  it('reads the bank wordings for an incoming UPI transfer', () => {
    expect(incomeFrom('Your A/c XX1234 is credited with Rs.80.00 by a/c linked to VPA rahul@okhdfc')).toBe('credit');
    expect(incomeFrom('INR 80.00 credited to A/c no. XX1234 on 07-09-26, info UPI/P2A/523456/RAHUL')).toBe('credit');
    expect(incomeFrom('Received Rs.80.00 in your Kotak Bank A/c XX1234 from RAHUL')).toBe('credit');
  });

  /* A refund names the debit it reverses, and "debited" outranks "credited".
     Without a rule of its own, money coming back was filed as money going. */
  it('reads a refund as income even though it mentions the original debit', () => {
    expect(incomeFrom('Refund of Rs.999 credited to A/c XX1234 for the amount debited on 01-09-26')).toBe('credit');
  });
});

/**
 * Formats that were silently dropped - direction read fine, then the amount
 * pattern did not recognise how the bank had written the number.
 */
describe('amounts as banks really write them', () => {
  it('reads an amount with no currency unit at all', () => {
    // SBI's UPI alert, and the most common debit SMS in the country.
    const parsed = parseTransactionSms(
      'Dear UPI user A/C X1234 debited by 250.0 on date 06Sep26 trf to SWIGGY Refno 523456789012',
    );
    expect(parsed).toMatchObject({ kind: 'debit', amountPaise: 25000 });
  });

  it('reads an amount with the unit written after it', () => {
    expect(parseTransactionSms('Your A/c XX1234 debited 250.00 INR on 06-09-26')?.amountPaise).toBe(25000);
  });

  it('reads the verb and its preposition when the amount sits between them', () => {
    // "Sent ... From ... To ..." - "sent to" as one phrase never matched.
    const parsed = parseTransactionSms('Sent Rs.250.00 From HDFC Bank A/C x1234 To SWIGGY On 06-09-26');
    expect(parsed).toMatchObject({ kind: 'debit', amountPaise: 25000 });
  });

  it('reads a card alert that says "used for"', () => {
    expect(parseTransactionSms('Your Credit Card XX1234 has been used for Rs.2,500.00 at AMAZON')?.kind)
      .toBe('debit');
  });

  /* The looser amount patterns must not start reading dates or reference
     numbers as money. Both of these have digits and no real amount. */
  it('does not mistake a date or a reference for an amount', () => {
    expect(parseTransactionSms('Your account has been debited on 06-09-26. Check the app.')).toBeNull();
    expect(parseTransactionSms('Transaction 523456789012 debited. See statement.')).toBeNull();
  });
});
