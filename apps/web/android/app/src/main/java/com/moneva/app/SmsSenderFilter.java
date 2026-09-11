package com.moneva.app;

import java.util.regex.Pattern;

/**
 * Which messages are even looked at.
 *
 * READ_SMS is not a permission to read payment messages. It is a permission to
 * read the inbox - one-time codes, medical results, messages from family, the
 * lot - and the app is trusted not to. That trust has to be enforced by code
 * that runs before anything is stored, not by a promise in a privacy policy,
 * because nothing a user can see from outside distinguishes the two.
 *
 * So this is the first gate, and it works on the SENDER alone, before the body
 * is examined at all:
 *
 *   Transactional SMS in India is sent from an alphanumeric header - VM-HDFCBK,
 *   AD-SBIINB, JD-ICICIB, AX-AXISBK - because TRAI requires registered headers
 *   for commercial traffic and forbids sending it from an ordinary number.
 *   People, meanwhile, message from numbers.
 *
 * That asymmetry does most of the work. Rejecting every numeric sender drops
 * essentially all private conversation without reading a word of it, and it
 * fails in the safe direction: a bank that somehow texts from a plain number
 * is missed, and missing a payment costs an entry the user can add by hand.
 *
 * The second gate is PaymentNotificationFilter.looksFinancial, which is the
 * same content test the notification path already uses. Two independent gates,
 * because this is the one place in the app where a mistake is not recoverable
 * by the user - they cannot un-see what was collected.
 */
final class SmsSenderFilter {

    private SmsSenderFilter() {}

    /**
     * A sender made only of digits, punctuation and an optional country code.
     *
     * Covers +919876543210, 9876543210, 098-765-43210 and the short numeric
     * codes some services use. Anything matching this is a number, and a
     * number is a person until proven otherwise.
     */
    private static final Pattern NUMERIC_SENDER =
            Pattern.compile("^[+\\-() 0-9]+$");

    /**
     * The shape of a registered Indian sender header.
     *
     * Two characters for the operator circle, a hyphen, then the principal
     * entity's six-character header: VM-HDFCBK. Newer DLT headers append a
     * one-character content type - AX-HDFCBK-S - and some carriers drop the
     * prefix entirely, leaving just HDFCBK. All three are accepted.
     */
    private static final Pattern HEADER =
            Pattern.compile("^(?:[A-Z]{2}-)?[A-Z0-9]{4,9}(?:-[A-Z])?$", Pattern.CASE_INSENSITIVE);

    /**
     * Senders whose traffic is transactional in form but never a payment.
     *
     * These pass the header test and would then lean on the content gate
     * alone. Naming them here means their messages are dropped a step earlier,
     * without their text being examined.
     */
    private static final Pattern NEVER_A_PAYMENT = Pattern.compile(
            "(?i)(?:^|[-])(?:"
                    + "SWIGGY|ZOMATO|AMAZON|FLIPKRT|MYNTRA|BLINKIT|ZEPTO|"   // order updates
                    + "OLACAB|UBERIN|RAPIDO|IRCTC|MAKEMY|"                    // travel updates
                    + "JIOIND|AIRTEL|VODAFN|BSNLIN|"                          // telco notices
                    + "TRUCAL|WHATSA|FBOOKI|INSTAG"                           // app notices
                    + ")");

    /**
     * Whether this sender's messages may be read at all.
     *
     * Deliberately strict, and deliberately checked before the body. If this
     * returns false the message is never parsed, never queued and never
     * counted - the app behaves as though it had not arrived.
     */
    static boolean isTransactionalSender(String address) {
        if (address == null || address.trim().isEmpty()) return false;

        String sender = address.trim();

        // A person. Nothing further is looked at.
        if (NUMERIC_SENDER.matcher(sender).matches()) return false;

        // Not the shape of a registered header either - an email-to-SMS
        // gateway, a foreign short code, something unrecognised. Refuse.
        if (!HEADER.matcher(sender).matches()) return false;

        return !NEVER_A_PAYMENT.matcher(sender).find();
    }

    /**
     * Both gates, in order, as the callers should apply them.
     *
     * Kept as one call so the receiver and the backfill cannot drift apart -
     * a live message and the same message re-read later must be treated
     * identically, or the app's behaviour depends on when it was installed.
     */
    static boolean shouldCapture(String address, String body) {
        if (!isTransactionalSender(address)) return false;
        if (body == null || body.trim().isEmpty()) return false;
        return PaymentNotificationFilter.looksFinancial(address, body);
    }
}
