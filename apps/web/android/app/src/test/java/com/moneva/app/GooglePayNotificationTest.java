package com.moneva.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The McDonald's miss.
 *
 * A real payment - Rs 161.70 to McDonald's through Google Pay, 11 September
 * 2026 - was never noticed, and had to be typed in by hand. The app was
 * installed, capture was on, and Google Pay is on the watched list, so the
 * alert reached the filter and the filter threw it away.
 *
 * This class exists to find out which shapes it throws away. Every string
 * below is a form Google Pay actually posts; the ones marked as the bug are
 * the ones that were being dropped.
 *
 * The asymmetry that governs the fix: a dropped payment costs one manual
 * entry, while a false positive writes somebody's private notification to
 * disk. So the gate stays strict about WHAT it reads, and becomes lenient
 * only about how a payment is PHRASED.
 */
public class GooglePayNotificationTest {

    private static final String GPAY = "com.google.android.apps.nbu.paisa.user";

    private static boolean kept(String title, String text) {
        return PaymentNotificationFilter.looksFinancial(GPAY, title, text);
    }

    /* ---------------- the shapes that always worked ---------------- */

    @Test
    public void aVerboseReceiptIsKept() {
        assertTrue(kept("Payment successful", "You paid ₹161.70 to McDonald's"));
    }

    @Test
    public void aTitleCarryingTheWholeReceiptIsKept() {
        assertTrue(kept("₹161.70 paid to McDonald's", "Tap to view details"));
    }

    @Test
    public void theWordTransactionIsEnough() {
        assertTrue(kept("Transaction successful", "₹161.70 · McDonald's"));
    }

    /* ---------------- THE BUG: terse, verbless receipts ---------------- */

    @Test
    public void amountToMerchantIsKept() {
        /*
         * The shape Google Pay uses most often now, and the one that was being
         * dropped. There is no verb anywhere in it: "to" is a preposition, and
         * MOVEMENT wanted "paid", "sent", "debited" or a sibling.
         *
         * It is unmistakably a payment to a person reading it, which is why
         * the miss was so surprising - the notification said exactly what had
         * happened and the app still discarded it.
         */
        assertTrue(kept("₹161.70 to McDonald's", "Tap to view details"));
    }

    @Test
    public void merchantThenAmountIsKept() {
        assertTrue(kept("McDonald's", "₹161.70 · Google Pay"));
    }

    @Test
    public void completedWithAnAmountIsKept() {
        assertTrue(kept("Completed", "₹161.70 to McDonald's"));
    }

    @Test
    public void anAmountWithAUpiReferenceIsKept() {
        assertTrue(kept("₹161.70", "McDonald's · UPI transaction ID 528417003921"));
    }

    /* ---------------- THE OTHER BUG: reward text on a real payment ------- */

    @Test
    public void aScratchCardDoesNotCancelThePaymentItCameWith() {
        /*
         * Google Pay attaches rewards to ordinary payments constantly. The
         * words that announce them - "offer", "reward points" - were on the
         * NOT_A_PAYMENT list to keep marketing out, and that list is checked
         * FIRST, so a genuine receipt with a scratch card stapled to it was
         * rejected on the strength of the advertisement rather than read on
         * the strength of the payment.
         */
        assertTrue(kept("Payment successful",
                "You paid ₹161.70 to McDonald's. You won a scratch card offer!"));
        assertTrue(kept("₹161.70 paid to McDonald's",
                "You earned reward points on this payment"));
    }

    /* ------- the boundary: leniency must NOT reach the messaging apps ------ */

    /**
     * The dangerous half of the McDonald's fix.
     *
     * Letting a payment app past without a verb is safe because Google Pay
     * posts nothing but payments. The Messages app posts whatever anybody
     * sends you. If the same leniency reached it, "500 to Karan" from a friend
     * would be an amount, with no verb and no marketing - and would be written
     * to disk and offered back as a transaction.
     *
     * These tests exist because the boundary was, for a while, unguarded:
     * removing it deliberately left all 47 other tests passing.
     */
    private static final String MESSAGES = "com.google.android.apps.messaging";

    private static boolean keptFromMessages(String title, String text) {
        return PaymentNotificationFilter.looksFinancial(MESSAGES, title, text);
    }

    @Test
    public void aPersonalMessageWithAnAmountIsNotReadFromTheMessagingApp() {
        // The exact shape the payment-app leniency now accepts - and the exact
        // shape a friend's message takes. The package is the only difference,
        // and it has to be the whole difference.
        assertFalse(keptFromMessages("Karan", "₹500 to Karan"));
        assertFalse(keptFromMessages("Mum", "161.70 for the groceries"));
        assertFalse(keptFromMessages("Anita", "₹161.70 McDonald's"));
    }

    @Test
    public void aBankSmsStillGetsThroughTheMessagingApp() {
        // The leniency being withheld must not cost the thing SMS capture is
        // for: a bank's own alert carries a verb, and always has.
        assertTrue(keptFromMessages("VM-HDFCBK",
                "Rs.161.70 debited from A/c XX1234 to MCDONALDS. UPI Ref 528417003921"));
    }

    @Test
    public void anUnknownPackageGetsNoLeniencyEither() {
        // Extra packages a user adds by hand are watched, but they are not
        // known to post only payments, so they get the strict test.
        assertFalse(PaymentNotificationFilter.looksFinancial(
                "com.unknown.wallet", "₹161.70", "McDonald's"));
    }

    /* ---------------- still refused, and must stay refused ---------------- */

    @Test
    public void pureMarketingIsStillRefused() {
        // No payment happened. An amount and an advertisement is not a receipt.
        assertFalse(kept("Offer just for you", "Get ₹100 cashback up to 5 times this week"));
        assertFalse(kept("Scratch card", "You have an offer worth ₹500 waiting"));
    }

    @Test
    public void aRequestForMoneyIsNotAPayment() {
        // Nothing has moved yet. Storing this would invent a transaction.
        assertFalse(kept("Karan is requesting ₹500", "Tap to pay"));
        assertFalse(kept("Payment request", "Anita requested ₹161.70"));
    }

    @Test
    public void aOneTimeCodeIsNeverKept() {
        assertFalse(kept("123456 is your OTP", "Do not share this code with anyone"));
    }

    @Test
    public void textWithNoAmountIsRefused() {
        // The amount is the thing that makes it a payment worth reading.
        assertFalse(kept("McDonald's", "Tap to view details"));
        assertFalse(kept("Payment successful", "Your payment went through"));
    }

    @Test
    public void aScheduledPaymentHasNotHappenedYet() {
        assertFalse(kept("Autopay", "₹161.70 will be debited on 15 Sept"));
    }
}
