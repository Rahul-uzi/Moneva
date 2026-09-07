package com.moneva.app;

import android.text.TextUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Decides whether a notification is worth looking at, before anything is kept.
 *
 * A notification listener can see EVERY notification on the phone - chats,
 * mail, everything. Almost none of it is this app's business, so the filtering
 * happens here, in front of the store, rather than in the app where it would
 * mean personal messages had already been written to disk.
 *
 * Two gates, and a notification must pass both:
 *
 *   1. The posting app is one that talks about money (a bank, a UPI app, or -
 *      see below - the SMS app).
 *   2. The text itself reads like a completed payment.
 *
 * The second gate is what makes including a messaging app defensible. A bank
 * SMS arrives as a notification from the Messages app, which is how this reads
 * bank alerts WITHOUT holding the READ_SMS permission - a permission Google
 * Play grants only by written exception. The cost is that the service is
 * handed every SMS notification, so the money test below runs before anything
 * is stored, and a message that does not pass is dropped without ever being
 * written down.
 */
final class PaymentNotificationFilter {

    private PaymentNotificationFilter() {}

    /**
     * Apps whose notifications may be examined. Anything not on this list is
     * dropped without being read.
     */
    static final Set<String> DEFAULT_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            // UPI and wallets
            "com.google.android.apps.nbu.paisa.user",  // Google Pay (India)
            "com.phonepe.app",
            "net.one97.paytm",
            "in.org.npci.upiapp",                      // BHIM
            "in.amazon.mShop.android.shopping",        // Amazon Pay
            "com.dreamplug.androidapp",                // CRED
            "com.mobikwik_new",
            "com.freecharge.android",

            // Banks
            "com.sbi.lotusintouch",                    // SBI YONO
            "com.sbi.SBIFreedomPlus",
            "com.snapwork.hdfc",                       // HDFC
            "com.csam.icici.bank.imobile",             // ICICI iMobile
            "com.axis.mobile",                         // Axis
            "com.msf.kbank.mobile",                    // Kotak
            "com.bankofbaroda.mconnect",
            "com.infrasofttech.indianbank",
            "com.canarabank.mobility",
            "com.fss.pnbpsp",                          // PNB
            "com.YesBank",
            "com.idbibank.mpassbook",
            "com.bankofindia.boiapp",
            "com.unionbankofindia.vyom",

            // The SMS apps. A bank's SMS shows up here, which is how bank
            // alerts are read without the READ_SMS permission. Everything from
            // these packages still has to pass looksFinancial().
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.textra"
    )));

    /**
     * An amount, in any of the ways money is written here.
     *
     * This gate runs BEFORE the parser, so anything it rejects is dropped and
     * never read. It therefore has to recognise at least everything the parser
     * does. It used to require the unit to LEAD ("Rs.250"), which silently
     * threw away SBI's UPI alert - "A/C X1234 debited by 250.0" - the most
     * common debit SMS in the country. The parser had been taught to read it;
     * the notification never reached the parser.
     *
     * Three shapes, matching smsParse.ts: unit first, unit last, or no unit at
     * all but anchored to the verb so a date can never look like an amount.
     */
    private static final Pattern AMOUNT = Pattern.compile(
            "(?:rs\\.?|inr|₹)\\s?[0-9][0-9,]*(?:\\.[0-9]{1,2})?"
                    + "|\\b[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\s?(?:rs\\b|inr\\b|₹)"
                    + "|\\b(?:debited|credited|withdrawn|deposited)\\s+(?:by|with|for)?\\s*"
                    + "[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Something actually moved.
     *
     * "sent", not "sent to": HDFC writes "Sent Rs.250.00 From A/C x1234 To
     * SWIGGY", where the amount sits between the verb and its preposition, so
     * the two-word phrase never matched and the alert was dropped here.
     * "used for" is how a card alert says it was spent.
     */
    private static final Pattern MOVEMENT = Pattern.compile(
            "\\b(debited|credited|spent|paid|withdrawn|received|deposited|"
                    + "sent|transferred|purchase|used for|txn|transaction)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Things that quote an amount but are not a payment. Cheap to check here,
     * and it keeps one-time passwords - which are sensitive and useless to
     * this app - from ever being stored.
     */
    private static final Pattern NOT_A_PAYMENT = Pattern.compile(
            "\\b(otp|one[\\s-]?time\\s?password|verification code|do not share|"
                    + "requested money|collect request|payment request|is requesting|"
                    + "will be debited|due on|scheduled for|pre-?approved|apply now|"
                    + "cashback up to|loan up to|offer|reward points)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * True when this text is worth handing to the parser.
     *
     * Deliberately lenient about WHICH transaction it is - that is the parser's
     * job, and it refuses far more than this does. This only has to be strict
     * about one thing: text that is nobody's business does not get stored.
     */
    static boolean looksFinancial(String title, String text) {
        String body = ((title == null ? "" : title) + " " + (text == null ? "" : text)).trim();
        if (TextUtils.isEmpty(body)) return false;
        if (body.length() > 2000) return false;          // not a payment alert
        String lower = body.toLowerCase(Locale.ROOT);
        if (NOT_A_PAYMENT.matcher(lower).find()) return false;
        return AMOUNT.matcher(lower).find() && MOVEMENT.matcher(lower).find();
    }

    /** True when notifications from this package may be examined at all. */
    static boolean isWatchedPackage(Set<String> extra, String packageName) {
        if (packageName == null) return false;
        if (DEFAULT_PACKAGES.contains(packageName)) return true;
        return extra != null && extra.contains(packageName);
    }
}
