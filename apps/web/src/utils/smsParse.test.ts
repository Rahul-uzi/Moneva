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


/**
 * Money that MOVED but was not SPENT.
 *
 * Own-account transfers, ATM cash, wallet top-ups and credit-card bill
 * payments were all booked as spending. It is the third-loudest complaint
 * across every app in this category, it lands on the largest amounts a person
 * moves, and it corrupts every budget and category percentage. Cash out of an
 * ATM is in your pocket, not gone. A card bill is not a second expense.
 */
describe('money that moved without being spent', () => {
  const kindOf = (body: string) => parseTransactionSms(body)?.kind;

  it('reads a move between your own accounts as a transfer', () => {
    expect(kindOf('Rs.5000.00 transferred from your A/c XX1234 to your A/c XX5678 on 08-09-26'))
      .toBe('transfer');
    expect(kindOf('INR 25000 debited from your Acct XX1234 and credited to your Acct XX9999'))
      .toBe('transfer');
  });

  it('reads an ATM withdrawal as a transfer, not a purchase', () => {
    expect(kindOf('Rs.5000 withdrawn from A/c XX1234 at HDFC ATM on 08-09-26')).toBe('transfer');
    expect(kindOf('ATM withdrawal of Rs.2000 from A/c XX1234 on 08-09-26')).toBe('transfer');
  });

  it('reads a wallet top-up as a transfer', () => {
    expect(kindOf('Rs.1000 added to your Paytm wallet from HDFC Bank A/c XX1234')).toBe('transfer');
  });

  it('reads a credit-card bill payment as a transfer', () => {
    // The purchases on the card were already expenses. Paying the bill is not
    // a second one - counting it double-charges the month.
    expect(kindOf('Payment of Rs.18,750 towards your HDFC Credit Card XX1234 received'))
      .toBe('transfer');
  });
});

/**
 * WHO the money went to, or came from.
 *
 * This was broken in the quietest possible way: the pattern had no `i` flag,
 * so it only matched a lowercase "to"/"at"/"from". Banks capitalise them
 * constantly, and every one of those messages produced a transaction with no
 * name on it - just an amount, uncategorised, indistinguishable from the next.
 *
 * The second half is the trap. Simply adding `i` makes the first match on a
 * real HDFC alert "From HDFC Bank" - the user's OWN bank rather than the person
 * they paid. That is worse than the blank it replaces, because a wrong name
 * gets written into the description and categorised, and every payment starts
 * looking like it went to the same merchant.
 */
describe('who the other party was', () => {
  const who = (body: string) => parseTransactionSms(body)?.merchant;

  it('reads a capitalised preposition, which used to yield nothing', () => {
    expect(who('Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL On 08-09-26')).toBe('RAHUL');
    expect(who('Paid Rs.250 To Swiggy On 08-09-26')).toBe('Swiggy');
  });

  it('does not name the user own bank as the payee', () => {
    // The whole point. "From HDFC Bank" comes FIRST in the message.
    expect(who('Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL On 08-09-26'))
      .not.toBe('HDFC Bank');
    expect(who('INR 2,500.00 debited from ICICI Bank Card XX1234 at AMAZON on 08-09-26'))
      .toBe('AMAZON');
  });

  it('still reads the lowercase forms it always did', () => {
    expect(who('Rs.1,230.00 debited from A/c XX4821 on 05-Sep-26 to SWIGGY. UPI Ref no 412233445566.'))
      .toBe('SWIGGY');
    expect(who('Rs 2,450.75 spent on card ending 7781 at BIG BAZAAR on 04-Sep.'))
      .toBe('BIG BAZAAR');
  });

  it('takes the payer, not the payee, when money arrives', () => {
    // On a credit "from"/"by" name the other party - the reverse of a payment.
    expect(who('Your A/c XX1234 is credited with INR 65,000.00 by SALARY on 01-09-26'))
      .toBe('SALARY');
  });

  it('gives no name rather than a wrong one', () => {
    // Nothing here names a counterparty. A blank is the correct answer, and
    // it must not fall back to the account or the bank.
    expect(who('Rs.500 debited.')).toBeUndefined();
    expect(who('Rs.1,230.00 debited from A/c XX4821. Available balance Rs.1,58,923.00.'))
      .toBeUndefined();
  });

  /**
   * From a real ledger: Rs 45 arrived from a friend through Google Pay and was
   * filed as income from "view".
   *
   * The alert reads "Karan paid you Rs.45 / Tap to view". Two things went
   * wrong at once - the phrase "Tap to view" contains "to", so the counterparty
   * search read it as a payment to somebody called "view"; and the payer's real
   * name sits BEFORE the verb, where a preposition search can never see it.
   * The row that resulted had the wrong name AND was missing the right one.
   */
  it('reads the payer whose name comes before the verb', () => {
    expect(who('Karan paid you ₹45')).toBe('Karan');
    expect(who('Rahul Dhiman sent you Rs.80')).toBe('Rahul Dhiman');
  });

  it('never mistakes "Tap to view" for a payee', () => {
    expect(who('Karan paid you ₹45 Tap to view')).toBe('Karan');
    expect(who('Karan paid you ₹45.00 View details')).toBe('Karan');
    // The exact row this produced in production.
    expect(who('Karan paid you ₹45 Tap to view')).not.toBe('view');
  });

  it('does not let chrome run onto the end of a real name', () => {
    // Names may contain spaces, so "from Karan Tap to view" used to be read
    // as one name: "Karan Tap".
    expect(who('₹45 received from Karan Tap to view')).toBe('Karan');
    expect(who('You received ₹45 from Karan Tap to view')).toBe('Karan');
  });

  it('names the machine on a cash withdrawal', () => {
    // Not a merchant, but it is the useful answer to "where did that cash go":
    // this is the one place the bank's own name IS the counterparty.
    expect(who('Rs.5000 withdrawn from A/c XX1234 at HDFC ATM on 08-09-26')).toBe('HDFC ATM');
  });
});

/**
 * The other half, and the more important one.
 *
 * Calling a real expense a transfer understates spending and quietly leaves
 * room in a budget that should not be there. That is invisible, and therefore
 * worse than the over-counting it replaces. Each of these contains a word one
 * of the transfer rules hunts for.
 */
describe('what the transfer rules must NOT steal', () => {
  const kindOf = (body: string) => parseTransactionSms(body)?.kind;

  it('leaves an ordinary payment alone', () => {
    expect(kindOf('Paid Rs.250 to Swiggy on 08-09-26')).toBe('debit');
    expect(kindOf('INR 2,500.00 spent on ICICI Bank Card XX1234 at AMAZON')).toBe('debit');
  });

  it('does not treat a shop whose name contains ATM as a cash withdrawal', () => {
    expect(kindOf('Rs.450 spent at ATM ROAD CAFE using Card XX1234 on 08-09-26')).toBe('debit');
  });

  it('does not treat paying another person as a self-transfer', () => {
    // "from your A/c ... To RAHUL" - the destination is not yours.
    expect(kindOf('Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL On 08-09-26')).toBe('debit');
  });

  it('does not treat a merchant with "wallet" in its name as a top-up', () => {
    expect(kindOf('Paid Rs.999 to WALLET STORE on 08-09-26')).toBe('debit');
  });

  it('still reads incoming money as income', () => {
    expect(kindOf('Rahul Dhiman paid you Rs.80')).toBe('credit');
    expect(kindOf('Your A/c XX1234 is credited with INR 65,000.00 by SALARY')).toBe('credit');
    expect(kindOf('Your A/c XX1234 is credited with Rs.80.00 by a/c linked to VPA rahul@okhdfc'))
      .toBe('credit');
  });

  /* The bug that made the refund rule silently dead: an amount is written
     "Rs.18,750", so a gap that refuses to cross a full stop can never reach
     past one. Every transfer rule bounds its gap by distance instead. */
  it('reaches across an amount, which contains a full stop', () => {
    expect(kindOf('Payment of Rs.18,750.00 towards your HDFC Credit Card received'))
      .toBe('transfer');
  });
});

/**
 * Legacy bank wordings, from an audit of older SMS formats.
 *
 * Modern app pushes are tidy ("You paid Rs.250 to Swiggy"). Bank SMS is not,
 * and the older the template the less it looks like a sentence. These are the
 * shapes that were still arriving on a real phone, and one of them was being
 * dropped outright.
 */
describe('older, messier bank formats', () => {
  const read = (body: string) => {
    const p = parseTransactionSms(body);
    return p ? { kind: p.kind, rupees: p.amountPaise / 100, merchant: p.merchant } : null;
  };

  it('reads a card alert that only says the card was USED', () => {
    // No debit, no spent, no paid - the sentence contains no movement verb at
    // all. It was dropped before the parser ever saw it, and the parser would
    // have refused it anyway. One of the commonest card alerts in the country.
    expect(read('Thank you for using your HDFC Bank Card XX7781 for Rs.899.00 at NETFLIX on 05-09-26'))
      .toMatchObject({ kind: 'debit', rupees: 899, merchant: 'NETFLIX' });
  });

  it('does not treat any sentence with "using" in it as a payment', () => {
    // The guard on the rule above: "using" must be followed by a card or an
    // account, not by a word that merely happens to be next.
    expect(parseTransactionSms('Using the Rs.500 you sent for the trip')).toBeNull();
  });

  it('reads the old SBI "has been debited towards" form', () => {
    expect(read('Dear Customer, Rs.450.00 has been debited from A/c XX1234 on 05-SEP-26 towards VPS*BIGBAZAAR. -SBI'))
      .toMatchObject({ kind: 'debit', rupees: 450 });
  });

  it('reads a semicolon-separated ICICI alert', () => {
    expect(read('ICICI Bank Acct XX123 debited for Rs 1,250.00 on 05-Sep-26; ZOMATO credited. UPI:512345678901'))
      .toMatchObject({ kind: 'debit', rupees: 1250 });
  });

  it('reads an Axis alert that ends with the balance', () => {
    // "Avl Bal" would refuse this as a balance enquiry if the movement in the
    // same message did not overrule it.
    expect(read('INR 320.00 debited from A/c no. XX4821 on 05-09-26. Info: UPI/P2M/512345/BLINKIT. Avl Bal INR 45,320.00'))
      .toMatchObject({ kind: 'debit', rupees: 320 });
  });

  it('reads "credited by transfer from" as money arriving, and names the payer', () => {
    expect(read('Your a/c XX4821 has been credited with Rs.2,500.00 on 05-Sep-26 by transfer from RAJESH KUMAR'))
      .toMatchObject({ kind: 'credit', rupees: 2500 });
  });

  it('reads a terse PNB line with no spaces around the amount', () => {
    expect(read('Ac XX1234 Debited for Rs.75.00 Dt 05-Sep-26 Avbl Bal Rs.12,000.00-PNB'))
      .toMatchObject({ kind: 'debit', rupees: 75 });
  });

  it('reads a debit-card spend written without a full stop after Rs', () => {
    expect(read('Rs 1200 spent using SBI Debit Card XX1234 at AMAZON PAY INDIA on 05Sep26'))
      .toMatchObject({ kind: 'debit', rupees: 1200 });
  });
});

/**
 * Payees that are not written as "<preposition> <name>".
 *
 * From the same audit: five of eight legacy messages produced a row with no
 * name on it, and four of those five had the payee sitting in plain sight -
 * just in a shape the preposition search could not reach. A row with an
 * amount and no name is the difference between a ledger you can read back and
 * a list of numbers.
 */
describe('payees in the shapes banks actually write them', () => {
  const who = (body: string) => parseTransactionSms(body)?.merchant;

  it('reads a UPI handle, and keeps the name rather than the bank', () => {
    // The old pattern stopped dead at the "@", which is not in its character
    // class, so the whole handle was skipped.
    expect(who('Sent Rs.150.00 from Kotak Bank AC X1234 to swiggy@ybl on 05-09-26')).toBe('swiggy');
    expect(who('Your A/c XX1234 is credited with Rs.80.00 by a/c linked to VPA rahul@okhdfc'))
      .toBe('rahul');
  });

  it('reads the merchant out of a UPI reference string', () => {
    expect(who('INR 320.00 debited from A/c no. XX4821 on 05-09-26. Info: UPI/P2M/512345/BLINKIT. Avl Bal INR 45,320.00'))
      .toBe('BLINKIT');
  });

  it('reads the side that was credited on a semicolon-separated debit', () => {
    // On a debit, whoever was credited is exactly who was paid.
    expect(who('ICICI Bank Acct XX123 debited for Rs 1,250.00 on 05-Sep-26; ZOMATO credited. UPI:512345678901'))
      .toBe('ZOMATO');
  });

  it('reads "towards", and drops the card network prefix in front of the shop', () => {
    expect(who('Dear Customer, Rs.450.00 has been debited from A/c XX1234 on 05-SEP-26 towards VPS*BIGBAZAAR. -SBI'))
      .toBe('BIGBAZAAR');
  });

  it('still gives no name when the message genuinely names nobody', () => {
    // The fifth of those five. There is nothing here to find, and inventing
    // something would be worse than the blank.
    expect(who('Ac XX1234 Debited for Rs.75.00 Dt 05-Sep-26 Avbl Bal Rs.12,000.00-PNB'))
      .toBeUndefined();
  });
});

describe('what the new payee rules must not drag in', () => {
  const who = (body: string) => parseTransactionSms(body)?.merchant;

  it('never names the user own account as the payee', () => {
    // "towards your HDFC Credit Card XX1234" describes the account being paid
    // OFF, not a shop. A possessive opener is never a counterparty.
    expect(who('Payment of Rs.18,750 towards your HDFC Credit Card XX1234 received'))
      .toBeUndefined();
  });

  it('never reads an amount as a merchant', () => {
    // The name pattern allows digits, dots and commas, so "Rs.899.00" fits the
    // shape of a name exactly - and "for" sits right in front of it.
    const parsed = parseTransactionSms(
      'Thank you for using your HDFC Bank Card XX7781 for Rs.899.00 at NETFLIX on 05-09-26');
    expect(parsed?.merchant).toBe('NETFLIX');
    expect(parsed?.merchant).not.toMatch(/899/);
  });

  it('leaves the ordinary preposition forms exactly as they were', () => {
    expect(who('Rs.1,230.00 debited from A/c XX4821 on 05-Sep-26 to SWIGGY. UPI Ref no 412233445566.'))
      .toBe('SWIGGY');
    expect(who('Rs 2,450.75 spent on card ending 7781 at BIG BAZAAR on 04-Sep.')).toBe('BIG BAZAAR');
    expect(who('Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL On 08-09-26')).toBe('RAHUL');
  });
});
