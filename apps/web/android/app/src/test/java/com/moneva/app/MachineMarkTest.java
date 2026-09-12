package com.moneva.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Catching payments written in words nobody added to a list.
 *
 * THE PROBLEM WITH VOCABULARY. Before this, a payment was recognised by its
 * verb - debited, paid, sent, spent. Every bank writes differently, every
 * wallet invents its own phrasing, and each time one says something new a real
 * payment is discarded until a human notices and edits a regex. That is a game
 * that is always being lost somewhere, and the McDonald's miss was one round
 * of it.
 *
 * THE DIFFERENT GAME. A payment message contains things a COMPUTER wrote: a
 * transaction reference, a masked account number, a running balance. Those do
 * not depend on the bank's choice of words, and - the part that makes them
 * safe as well as strong - a person texting a friend never writes them. Nobody
 * types "UPI Ref 528417003921" to their mother.
 *
 * So a machine mark can stand in for a verb even on a messaging app, where the
 * verb requirement exists to keep private conversation out. The tests below
 * are in two halves: unknown phrasings that must now be caught, and the
 * conversation that must still be left alone.
 */
public class MachineMarkTest {

    private static final String MESSAGES = "com.google.android.apps.messaging";
    private static final String GPAY = "com.google.android.apps.nbu.paisa.user";
    private static final String UNKNOWN_WALLET = "com.some.newwallet";

    private static boolean kept(String pkg, String title, String text) {
        return PaymentNotificationFilter.looksFinancial(pkg, title, text);
    }

    /* ---------- phrasings no vocabulary list would have had ---------- */

    @Test
    public void aBankUsingAnUnknownVerbIsStillRead() {
        /*
         * "utilised" is not on any verb list and never will be. The reference
         * and the masked account say what it is regardless.
         */
        assertTrue(kept(MESSAGES, "VM-SOMEBK",
                "INR 161.70 utilised on A/c XX4471. UPI Ref 528417003921"));
    }

    @Test
    public void aWalletWithOnlyAReferenceIsRead() {
        // No verb, no account number - just an amount and a txn id. Common on
        // wallet alerts, and previously dropped outright.
        assertTrue(kept(UNKNOWN_WALLET, "Payment complete",
                "₹161.70 · Transaction ID 9A7F2C41B8"));
    }

    @Test
    public void aBalanceLineIsEnough() {
        // A statement quotes a running balance. Conversation does not.
        assertTrue(kept(MESSAGES, "AD-NEWBNK",
                "Rs 161.70 on card ending 4471. Avl Bal Rs 12,650.00"));
    }

    @Test
    public void aMaskedCardNumberIsEnough() {
        assertTrue(kept(MESSAGES, "VK-CARDCO",
                "Rs.161.70 at MCDONALDS on ****4471"));
    }

    @Test
    public void anRrnIsEnough() {
        // The interbank reference. Twelve digits, machine-written, unmistakable.
        assertTrue(kept(UNKNOWN_WALLET, "Transfer complete",
                "₹161.70 RRN 528417003921"));
    }

    @Test
    public void aReferenceBeatsAScratchCard() {
        /*
         * Marketing is checked after this on purpose. An advertisement does
         * not carry a transaction reference, so text that has one is a receipt
         * whatever else has been stapled to it.
         */
        assertTrue(kept(GPAY, "₹161.70 to McDonald's",
                "UPI Ref 528417003921. You won a scratch card offer!"));
    }

    /* ---------- and the conversation that must stay unread ---------- */

    @Test
    public void aPersonalMessageWithAnAmountIsStillRefused() {
        // The whole reason the verb requirement existed. A machine mark is
        // what lifts it, and this has none.
        assertFalse(kept(MESSAGES, "Karan", "₹500 to Karan"));
        assertFalse(kept(MESSAGES, "Mum", "send me 161.70 when you can"));
        assertFalse(kept(MESSAGES, "Anita", "the McDonald's bill was ₹161.70"));
    }

    @Test
    public void aBareLongNumberIsNotAReference() {
        /*
         * The mark has to be LABELLED. A phone number, an order quantity or a
         * pin quoted in a message is a long number and nothing more - keying
         * on digits alone would read half the inbox.
         */
        assertFalse(kept(MESSAGES, "Karan", "₹500 - call me on 9876543210"));
        assertFalse(kept(MESSAGES, "Mum", "₹161.70 for 528417003921 pieces"));
    }

    @Test
    public void aLabelWithNoNumberIsNotAReference() {
        // "reference" turns up in ordinary prose. The value has to look like one.
        assertFalse(kept(MESSAGES, "Boss",
                "₹500 for the reference material you asked about"));
    }

    @Test
    public void anAdvertisementWithNoReferenceIsStillRefused() {
        assertFalse(kept(GPAY, "Offer just for you",
                "Get ₹100 cashback up to 5 times this week"));
    }

    @Test
    public void aRequestIsStillNotAPayment() {
        // Proof nothing moved outranks every mark in this class.
        assertFalse(kept(MESSAGES, "VM-SOMEBK",
                "Payment request for Rs 161.70 on A/c XX4471. UPI Ref 528417003921"));
    }

    @Test
    public void aOneTimeCodeWithAnAccountNumberIsNeverKept() {
        // An OTP message is full of machine marks. It must still be refused -
        // it is the single most sensitive thing in an inbox.
        assertFalse(kept(MESSAGES, "VM-SOMEBK",
                "123456 is your OTP for Rs 161.70 on A/c XX4471. Do not share"));
    }
}
