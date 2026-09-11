package com.moneva.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The gate that has to hold.
 *
 * Every other mistake in this app is visible to the person it happens to: a
 * wrong amount is on screen, a wrong category is on screen, a missed payment
 * is a gap they can fill by hand. This one is not. If a private message is
 * read, nothing appears anywhere, nobody is told, and the user has no way of
 * finding out - so it cannot be checked by using the app, only by tests.
 *
 * Two directions matter and they are not equally serious:
 *
 *   - Letting a personal message through is a breach of the thing the app
 *     promises. There is no recovering from it after the fact.
 *   - Rejecting a real bank alert costs one entry the user can type in.
 *
 * So where the two conflict, this refuses. The tests below are written to the
 * same asymmetry: the "must never" cases are exhaustive, the "should catch"
 * cases are the common Indian senders and no more.
 */
public class SmsSenderFilterTest {

    /* ---------- must never be read ---------- */

    @Test
    public void aPersonTextingFromTheirPhoneIsNeverRead() {
        // The whole point. Ten digits, with and without the country code, in
        // the shapes Android actually hands over.
        assertFalse(SmsSenderFilter.isTransactionalSender("9876543210"));
        assertFalse(SmsSenderFilter.isTransactionalSender("+919876543210"));
        assertFalse(SmsSenderFilter.isTransactionalSender("+91 98765 43210"));
        assertFalse(SmsSenderFilter.isTransactionalSender("098-765-43210"));
        assertFalse(SmsSenderFilter.isTransactionalSender("(+91) 9876543210"));
    }

    @Test
    public void aPersonalMessageAboutMoneyIsStillNotRead() {
        /*
         * The dangerous case, and the reason the sender gate runs FIRST.
         * "sent you 500" from a friend contains an amount and a movement, so
         * the content gate alone would keep it - and that message is exactly
         * the kind nobody wants a finance app to have stored.
         */
        assertFalse(SmsSenderFilter.shouldCapture("9876543210",
                "I sent you Rs 500 for dinner yesterday, check when you can"));
        assertFalse(SmsSenderFilter.shouldCapture("+919876543210",
                "debited 2000 from my account for the trip, settle later"));
    }

    @Test
    public void aShortNumericSenderIsRefused() {
        /*
         * This is the case that actually exercises the numeric-sender gate,
         * and it was missing until the gate was deliberately disabled and
         * every test still passed.
         *
         * The reason is worth writing down. The header pattern accepts 4 to 9
         * characters, so a ten-digit phone number fails it anyway - which made
         * the numeric check look load-bearing when it was doing nothing the
         * next line would not have done. Anything SHORTER than ten digits is
         * different: Indian short codes are numeric and four to six digits, so
         * "56161" and "121" match the header shape exactly. Without the
         * numeric gate they are read.
         *
         * A test suite that cannot fail when a guard is removed is not
         * protecting the guard.
         */
        assertFalse(SmsSenderFilter.isTransactionalSender("56161"));
        assertFalse(SmsSenderFilter.isTransactionalSender("121"));
        assertFalse(SmsSenderFilter.isTransactionalSender("1909"));
        assertFalse(SmsSenderFilter.isTransactionalSender("987654"));
        assertFalse(SmsSenderFilter.isTransactionalSender("98765432"));
    }

    @Test
    public void aMessageFromAShortNumericSenderIsNotCaptured() {
        // The same asymmetry end to end: a body that would pass the content
        // gate on its own is still refused, because of who sent it.
        assertFalse(SmsSenderFilter.shouldCapture("56161",
                "Rs.500.00 debited from A/c XX1234. UPI Ref no 400011112222."));
    }

    @Test
    public void anEmptyOrMissingSenderIsRefused() {
        assertFalse(SmsSenderFilter.isTransactionalSender(null));
        assertFalse(SmsSenderFilter.isTransactionalSender(""));
        assertFalse(SmsSenderFilter.isTransactionalSender("   "));
    }

    @Test
    public void anEmailGatewayIsRefused() {
        // Not a registered header, so not something to read. Refusing an
        // unrecognised shape is the safe direction.
        assertFalse(SmsSenderFilter.isTransactionalSender("alerts@hdfcbank.net"));
        assertFalse(SmsSenderFilter.isTransactionalSender("noreply@bank.com"));
    }

    @Test
    public void aBodyWithNoMoneyInItIsRefusedEvenFromABank() {
        // A real bank header, a real message, and nothing that moved. Branch
        // timings and product offers are not transactions.
        assertFalse(SmsSenderFilter.shouldCapture("VM-HDFCBK",
                "Dear customer, our branches will be closed on 15 August."));
        assertFalse(SmsSenderFilter.shouldCapture("AD-SBIINB",
                "Get a pre-approved personal loan. Reply STOP to opt out."));
    }

    @Test
    public void anOtpIsNeverKept() {
        /*
         * Worth its own test rather than folding into the case above. An OTP
         * carries a number that looks like an amount, arrives from a genuine
         * bank header, and is the single most sensitive thing in the inbox.
         */
        assertFalse(SmsSenderFilter.shouldCapture("VM-HDFCBK",
                "123456 is your OTP for a transaction of Rs 2500. Do not share it."));
        assertFalse(SmsSenderFilter.shouldCapture("AX-ICICIB",
                "OTP 998877 for Rs.1,200.00 txn. Valid 10 min. Never share."));
    }

    @Test
    public void deliveryAndOrderUpdatesAreDroppedAtTheSender() {
        // These have registered headers and often quote an amount, so they
        // would lean on the content gate alone. Named here so their text is
        // never examined at all.
        assertFalse(SmsSenderFilter.isTransactionalSender("VM-SWIGGY"));
        assertFalse(SmsSenderFilter.isTransactionalSender("AD-ZOMATO"));
        assertFalse(SmsSenderFilter.isTransactionalSender("JD-AMAZON"));
        assertFalse(SmsSenderFilter.isTransactionalSender("VK-IRCTC"));
    }

    /* ---------- should be read ---------- */

    @Test
    public void theCommonIndianBankHeadersAreAccepted() {
        assertTrue(SmsSenderFilter.isTransactionalSender("VM-HDFCBK"));
        assertTrue(SmsSenderFilter.isTransactionalSender("AD-SBIINB"));
        assertTrue(SmsSenderFilter.isTransactionalSender("JD-ICICIB"));
        assertTrue(SmsSenderFilter.isTransactionalSender("VK-AXISBK"));
        assertTrue(SmsSenderFilter.isTransactionalSender("AX-KOTAKB"));
    }

    @Test
    public void headerVariantsAreAccepted() {
        // DLT headers carry a trailing content-type character, and some
        // carriers deliver the header with no circle prefix at all. Both are
        // the same bank.
        assertTrue(SmsSenderFilter.isTransactionalSender("AX-HDFCBK-S"));
        assertTrue(SmsSenderFilter.isTransactionalSender("HDFCBK"));
        assertTrue(SmsSenderFilter.isTransactionalSender("SBIINB"));
    }

    @Test
    public void aRealDebitAlertIsKept() {
        assertTrue(SmsSenderFilter.shouldCapture("VM-HDFCBK",
                "Rs.500.00 debited from A/c XX1234 on 09-09-26 to SWIGGY. UPI Ref no 400011112222."));
    }

    @Test
    public void aRealCreditAlertIsKept() {
        assertTrue(SmsSenderFilter.shouldCapture("AD-SBIINB",
                "Your A/c XX9876 is credited with Rs 45,000.00 on 01-09-26 by SALARY. Bal Rs 52,310.00"));
    }

    @Test
    public void theSenderIsCheckedBeforeTheBody() {
        /*
         * The ordering is the privacy guarantee, so it is asserted directly
         * rather than inferred. Identical text; the only difference is who
         * sent it, and that alone decides the outcome.
         */
        String debit = "Rs.500.00 debited from A/c XX1234. UPI Ref no 400011112222.";
        assertTrue(SmsSenderFilter.shouldCapture("VM-HDFCBK", debit));
        assertFalse(SmsSenderFilter.shouldCapture("9876543210", debit));
    }
}
