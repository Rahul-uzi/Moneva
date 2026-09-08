package com.moneva.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The gate that runs BEFORE anything is stored or parsed.
 *
 * Everything here is a real wording from an Indian bank or UPI app. The reason
 * this file exists: the same line has silently thrown away real payment alerts
 * three separate times, and each time a rule was waiting in the parser that
 * could never run, because the notification never got that far. Nothing caught
 * it, because nothing tested this class at all.
 *
 *   1. The amount had to LEAD ("Rs.250"), so SBI's "debited by 250.0" - the
 *      most common debit alert in the country - was dropped.
 *   2. "sent to" was one phrase, so HDFC's "Sent Rs.250.00 From A/C To SWIGGY",
 *      where the amount splits the verb from its preposition, was dropped.
 *   3. "withdrawn" was written without its noun, so "ATM withdrawal of Rs.2000"
 *      was dropped.
 *
 * The two directions matter for different reasons. A false DROP is invisible -
 * the transaction simply never appears, and the balance is quietly wrong. A
 * false PASS means a message that is nobody business gets written to disk,
 * which is the promise made where the SMS apps are whitelisted.
 */
public class PaymentNotificationFilterTest {

    private static boolean gate(String body) {
        return PaymentNotificationFilter.looksFinancial(null, body);
    }

    // ---- must reach the parser -------------------------------------------

    @Test
    public void readsAnOrdinaryDebit() {
        assertTrue(gate("Rs.1,230.00 debited from A/c XX4821 on 05-Sep-26 to SWIGGY"));
        assertTrue(gate("Paid Rs.250 to Swiggy on 08-09-26"));
        assertTrue(gate("INR 2,500.00 spent on ICICI Bank Card XX1234 at AMAZON"));
    }

    @Test
    public void readsAnAmountWithNoUnitAtAll() {
        // Regression 1. The unit is absent; only the verb marks the number.
        assertTrue(gate("Dear UPI user A/C X1234 debited by 250.0 on date 08Sep26 trf to SWIGGY"));
    }

    @Test
    public void readsAVerbSeparatedFromItsPreposition() {
        // Regression 2. The amount sits between "Sent" and "To".
        assertTrue(gate("Sent Rs.500.00 From HDFC Bank A/C x1234 To RAHUL On 08-09-26"));
    }

    @Test
    public void readsCashWithdrawalWrittenAsANoun() {
        // Regression 3. Both spellings, and both orders.
        assertTrue(gate("Rs.5000 withdrawn from A/c XX1234 at HDFC ATM on 08-09-26"));
        assertTrue(gate("ATM withdrawal of Rs.2000 from A/c XX1234 on 08-09-26"));
    }

    @Test
    public void readsAWalletBeingLoaded() {
        // No verb in the movement list covers this, so it has its own gate.
        assertTrue(gate("Rs.1000 added to your Paytm wallet from HDFC Bank A/c XX1234"));
        assertTrue(gate("Your Paytm wallet balance was topped up by Rs.1000"));
    }

    @Test
    public void readsMoneyArriving() {
        assertTrue(gate("Rahul Dhiman paid you Rs.80"));
        assertTrue(gate("Your A/c XX1234 is credited with INR 65,000.00 by SALARY"));
    }

    @Test
    public void readsMoneyThatOnlyMoved() {
        assertTrue(gate("Rs.5000.00 transferred from your A/c XX1234 to your A/c XX5678"));
        assertTrue(gate("Payment of Rs.18,750 towards your HDFC Credit Card XX1234 received"));
    }

    // ---- must never be stored --------------------------------------------

    @Test
    public void refusesAnOtpEvenWhenItQuotesAnAmount() {
        // Sensitive, useless to this app, and it names a real figure.
        assertFalse(gate("Your OTP for a transaction of Rs.5000 is 448213. Do not share it."));
    }

    @Test
    public void refusesMoneyThatHasNotMovedYet() {
        assertFalse(gate("RAHUL has requested money Rs.500.00 via UPI. Approve in your app."));
        assertFalse(gate("Your EMI of Rs.12,500.00 will be debited on 10-Sep-2026."));
    }

    @Test
    public void refusesMarketing() {
        assertFalse(gate("You are eligible for a pre-approved loan up to Rs.5,00,000. Apply now."));
    }

    @Test
    public void refusesAnOrdinaryMessage() {
        assertFalse(gate("hey are we still on for 8"));
        assertFalse(gate(""));
        assertFalse(gate(null));
    }

    @Test
    public void doesNotStoreAFriendTalkingAboutMoney() {
        // The load gate names an account on purpose. Without that, every "I
        // added 500" in a text message would be written to disk.
        assertFalse(gate("hey i added 500 for the trip, settle later"));
    }

    @Test
    public void refusesTextWithNoAmountAtAll() {
        assertFalse(gate("Your account statement is ready to view."));
    }

    // ---- which apps may be looked at -------------------------------------

    @Test
    public void looksOnlyAtAppsThatTalkAboutMoney() {
        assertTrue(PaymentNotificationFilter.isWatchedPackage(null, "com.phonepe.app"));
        assertTrue(PaymentNotificationFilter.isWatchedPackage(null, "com.google.android.apps.messaging"));
        assertFalse(PaymentNotificationFilter.isWatchedPackage(null, null));

        // WhatsApp used to be asserted here as NOT watched, on the reasoning
        // that a chat app has no business being read. WhatsApp Pay is a real
        // UPI rail, though, and excluding it meant those payments silently
        // never appeared. It is watched now - but judged by the receipt test,
        // never by the lenient one, which is what keeps conversation out.
        assertTrue(PaymentNotificationFilter.isWatchedPackage(null, "com.whatsapp"));
        assertFalse(PaymentNotificationFilter.looksFinancial(
                "com.whatsapp", null, "i paid you 500 last week remember"));
    }

    // ---- which apps a payment can arrive from ---------------------------

    /**
     * The rails people are actually paid through.
     *
     * An app missing from this list fails INVISIBLY: its notification is
     * dropped before anything reads it, so the transaction simply never
     * appears and there is nothing to notice. An audit of the major Indian
     * wallets found 17 of 31 unwatched - every one of their wordings parsed
     * correctly, and not one of them could ever arrive.
     */
    @Test
    public void watchesTheWalletsPeopleActuallyUse() {
        String[] rails = {
            "com.google.android.apps.nbu.paisa.user",  // Google Pay
            "com.phonepe.app", "net.one97.paytm", "in.org.npci.upiapp",
            "in.amazon.mShop.android.shopping", "com.dreamplug.androidapp",
            "com.mobikwik_new", "com.freecharge.android",
            "com.samsung.android.spay", "com.samsung.android.spaymini",
            "in.slice.android", "money.jupiter.app", "com.epifi.paisa",
            "com.naviapp", "com.fampay.in", "com.myairtelapp", "com.jio.myjio",
            "com.hdfcbank.payzapp", "com.whizdm.lazypay", "com.olacabs.customer",
        };
        for (String pkg : rails) {
            assertTrue(pkg + " is not watched", PaymentNotificationFilter.isWatchedPackage(null, pkg));
        }
    }

    @Test
    public void watchesTheBanksPeopleActuallyHold() {
        String[] banks = {
            "com.sbi.lotusintouch", "com.snapwork.hdfc", "com.csam.icici.bank.imobile",
            "com.axis.mobile", "com.msf.kbank.mobile", "com.bankofbaroda.mconnect",
            "com.fss.indus", "com.idfcfirstbank.optimus", "com.fss.fedmobile",
            "com.rblbank.mobank", "com.aubank.aubankapp",
        };
        for (String pkg : banks) {
            assertTrue(pkg + " is not watched", PaymentNotificationFilter.isWatchedPackage(null, pkg));
        }
    }

    @Test
    public void doesNotWatchAppsThatHaveNoBusinessHere() {
        for (String pkg : new String[] { "com.instagram.android", "com.spotify.music",
                                         "com.netflix.mediaclient", null }) {
            assertFalse(PaymentNotificationFilter.isWatchedPackage(null, pkg));
        }
    }

    // ---- the chat app that also moves money -----------------------------

    /**
     * WhatsApp Pay is real, and so is every other message WhatsApp posts.
     *
     * Watching it the way a bank is watched would mean this service writes
     * private conversation to disk the moment somebody mentions money. So it
     * is judged by a receipt test instead, which leans on POSITION: a receipt
     * puts the amount immediately after the verb and marks it with a unit;
     * conversation mentions a number in passing.
     *
     * The second half of this matters more than the first. A missed payment
     * costs one manual entry; a false positive is a private message stored.
     */
    @Test
    public void readsARealWhatsAppPayment() {
        assertTrue(chat("You sent ₹500 to Karan"));
        assertTrue(chat("Karan paid you ₹45"));
        assertTrue(chat("You paid Rs.250 to Swiggy"));
        assertTrue(chat("Payment of ₹1,200 received"));
        assertTrue(chat("Karan sent you Rs.80"));
    }

    @Test
    public void neverStoresPrivateConversation() {
        assertFalse(chat("sent you the 200 rs pic yesterday lol"));
        assertFalse(chat("i paid you 500 last week remember"));
        assertFalse(chat("can you send 300 when free"));
        assertFalse(chat("the bill was 1250 rs split 3 ways"));
        assertFalse(chat("I'll pay you ₹500 tomorrow"));
        assertFalse(chat("did you get the 45 i sent"));
        assertFalse(chat("he owes me like 2000 rupees"));
        assertFalse(chat("200 rs for the cab, ill send it"));
        assertFalse(chat("hey are we still on for 8"));
    }

    @Test
    public void aBankIsStillJudgedLeniently() {
        // The stricter test applies to conversational apps ONLY - a bank alert
        // would fail it, and must not be held to it.
        String sbi = "Dear UPI user A/C X1234 debited by 250.0 on date 08Sep26 trf to SWIGGY";
        assertTrue(PaymentNotificationFilter.looksFinancial("com.sbi.lotusintouch", null, sbi));
        assertFalse(PaymentNotificationFilter.looksFinancial("com.whatsapp", null, sbi));
    }

    private static boolean chat(String body) {
        return PaymentNotificationFilter.looksFinancial("com.whatsapp", null, body);
    }
}
