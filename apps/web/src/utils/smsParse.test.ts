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
