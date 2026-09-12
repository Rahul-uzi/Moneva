package com.moneva.app;

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
     * Apps that exist to move money, and post nothing else.
     *
     * Split out from the messaging apps below because the two deserve
     * different tests. Everything Google Pay puts in the shade is about a
     * payment; most of what the Messages app puts there is not. Treating them
     * the same meant one rule had to serve both, and it was tuned for the
     * dangerous one - which is why a plain Google Pay receipt was thrown away.
     */
    static final Set<String> PAYMENT_APPS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            // UPI and wallets
            "com.google.android.apps.nbu.paisa.user",  // Google Pay (India)
            "com.phonepe.app",
            "net.one97.paytm",
            "in.org.npci.upiapp",                      // BHIM
            "in.amazon.mShop.android.shopping",        // Amazon Pay
            "com.dreamplug.androidapp",                // CRED
            "com.mobikwik_new",
            "com.freecharge.android",
            "com.samsung.android.spay",                // Samsung Wallet / Samsung Pay
            "com.samsung.android.spaymini",
            "in.slice.android",                        // slice
            "money.jupiter.app",                       // Jupiter
            "com.epifi.paisa",                         // Fi Money
            "com.naviapp",                             // Navi
            "com.fampay.in",                           // FamPay
            "com.myairtelapp",                         // Airtel Payments Bank
            "com.jio.myjio",                           // JioPay
            "com.hdfcbank.payzapp",                    // PayZapp
            "com.whizdm.lazypay",                      // LazyPay
            "com.olacabs.customer",                    // Ola Money

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
            "com.fss.indus",                           // IndusInd
            "com.idfcfirstbank.optimus",               // IDFC FIRST
            "com.fss.fedmobile",                       // Federal Bank
            "com.rblbank.mobank",                      // RBL
            "com.aubank.aubankapp"                     // AU Small Finance
    )));

    /**
     * The messaging apps. A bank's SMS shows up here, which is how bank alerts
     * are read without holding READ_SMS.
     *
     * These keep the STRICT test. Their notifications carry other people's
     * conversation, so a message has to look like a receipt - an amount and a
     * verb saying money moved - before it is written down. The leniency added
     * for payment apps deliberately does not reach here: "500 to Karan" from a
     * friend must stay unread.
     */
    static final Set<String> SMS_PACKAGES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.android.mms",
            "com.textra"
    )));

    /** Everything watched at all, for isWatchedPackage. */
    static final Set<String> DEFAULT_PACKAGES;
    static {
        Set<String> all = new HashSet<>(PAYMENT_APPS);
        all.addAll(SMS_PACKAGES);
        DEFAULT_PACKAGES = Collections.unmodifiableSet(all);
    }

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
     *
     * "withdrawn" was written without its noun, so "ATM withdrawal of
     * Rs.2000" - the wording on half the cash alerts in the country - was
     * dropped here, with a parser rule waiting for it that could never run.
     * Same failure as the two above, third time on this line.
     */
    private static final Pattern MOVEMENT = Pattern.compile(
            "\\b(debited|credited|spent|paid|withdraw(?:n|al)|received|deposited|"
                    + "sent|transferred|purchase|used for|txn|transaction)\\b"
                    // "Thank you for using your HDFC Bank Card XX7781 for
                    // Rs.899.00 at NETFLIX" - one of the commonest card
                    // alerts there is, and it contains no verb from the
                    // list above. Measured: dropped outright as "not a
                    // payment". Bounded to a card or account noun so the
                    // ordinary English word "using" cannot open the gate
                    // on its own.
                    + "|\\busing\\s+(?:your\\s+)?(?:[a-z]+\\s+){0,3}(?:card|a/c|acct|account)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Loading a wallet, which no verb above covers.
     *
     * Kept separate, and required to name what was loaded, because the load
     * verbs are ordinary English. This service is handed every SMS
     * notification on the phone, so "added" beside a bare amount would mean
     * storing "I added 500 to your account" from a friend - and the promise
     * made where the SMS apps are whitelisted above is that a message which
     * is nobody business is dropped without ever being written down.
     * Requiring the account noun costs nothing and keeps that promise.
     */
    private static final Pattern WALLET_LOAD = Pattern.compile(
            "\\b(?:added|loaded|topped\\s?up)\\b[\\s\\S]{0,40}?"
                    + "\\b(?:wallet|a/c|acct|account|card|balance)\\b"
                    + "|\\b(?:wallet|a/c|acct|account|card|balance)\\b[\\s\\S]{0,40}?"
                    + "\\b(?:added|loaded|topped\\s?up)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Proof that no money moved. Always vetoes, whatever else the text says.
     *
     * Every word here describes something that has NOT happened: a code to
     * type, a request waiting, a debit scheduled for later. There is no
     * wording in which these sit beside a completed payment, so refusing
     * outright loses nothing - and one-time passwords, which are sensitive
     * and useless to this app, never reach storage.
     */
    private static final Pattern NEVER_A_PAYMENT = Pattern.compile(
            "\\b(otp|one[\\s-]?time\\s?password|verification code|do not share|"
                    + "requested money|collect request|payment request|is requesting|"
                    + "will be debited|due on|scheduled for|pre-?approved|apply now)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Marketing. Vetoes only when nothing says a payment actually happened.
     *
     * These used to sit on the list above and veto unconditionally, which
     * threw away real receipts: Google Pay staples a scratch card to ordinary
     * payments, so a genuine "You paid Rs.161.70 to McDonald's - you won a
     * scratch card offer!" was rejected on the strength of the advertisement
     * rather than read on the strength of the payment. Found from a real miss
     * on the owner's own phone.
     *
     * An advertisement that merely quotes a figure still carries no payment
     * verb and no receipt shape, so it is still refused - see looksFinancial.
     */
    private static final Pattern MARKETING = Pattern.compile(
            "\\b(cashback up to|loan up to|offer|reward points|scratch card|"
                    + "earn up to|limited time)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * Apps that exist to talk to people, and happen to move money too.
     *
     * WhatsApp Pay is a real UPI app, and leaving it out means those payments
     * silently never appear. Including it means this service is handed every
     * private message the user receives, which is a different order of thing
     * from a bank's SMS - a bank writes to a template, a friend does not.
     *
     * So these do not get the lenient test below. They get PAYMENT_RECEIPT,
     * which requires the shape of a receipt rather than merely a verb and a
     * number somewhere in the same sentence.
     */
    static final Set<String> CONVERSATIONAL_PACKAGES = Collections.unmodifiableSet(
            new HashSet<>(Arrays.asList("com.whatsapp", "com.whatsapp.w4b")));

    /**
     * A payment receipt, as opposed to somebody mentioning money.
     *
     * The difference this leans on is POSITION: a receipt puts the amount
     * immediately after the verb and marks it with a unit - "You sent Rs.500",
     * "Karan paid you Rs.45". Conversation does not - "sent you the 200 rs
     * pic", "i paid you 500 last week" - because the number is a detail in a
     * sentence rather than the subject of it.
     *
     * It is a heuristic and it will miss real payments phrased unusually. That
     * is the correct way to be wrong here: a missed WhatsApp payment costs the
     * user one manual entry, whereas a false positive means a private message
     * was written to disk and offered back as a transaction.
     */
    private static final Pattern PAYMENT_RECEIPT = Pattern.compile(
            "\\b(?:you\\s+(?:sent|paid)|(?:sent|paid|transferred)\\s+you)\\s+"
                    + "(?:rs\\.?|inr|₹)\\s?[0-9]"
                    + "|\\bpayment\\s+(?:of\\s+)?(?:rs\\.?|inr|₹)\\s?[0-9]"
                    + "|(?:rs\\.?|inr|₹)\\s?[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\s+"
                    + "(?:sent|paid|received|debited|credited)\\b",
            Pattern.CASE_INSENSITIVE);

    /**
     * True when this text is worth handing to the parser, for a given app.
     *
     * Three tiers, because what an app POSTS decides how much benefit of the
     * doubt its notifications have earned:
     *
     *   - A conversational app (WhatsApp) must look like a receipt. Almost
     *     everything it posts is nobody's business.
     *   - A messaging app carrying bank SMS must show an amount AND a verb
     *     saying money moved. "500 to Karan" from a friend stays unread.
     *   - A dedicated payment app only has to show an amount. Everything
     *     Google Pay puts in the shade is about a payment, and demanding a
     *     verb of it is what lost a real one - see below.
     */
    static boolean looksFinancial(String packageName, String title, String text) {
        if (packageName != null && CONVERSATIONAL_PACKAGES.contains(packageName)) {
            String body = ((title == null ? "" : title) + " " + (text == null ? "" : text)).trim();
            if (body.isEmpty() || body.length() > 2000) return false;
            String lower = body.toLowerCase(Locale.ROOT);
            if (NEVER_A_PAYMENT.matcher(lower).find()) return false;
            return PAYMENT_RECEIPT.matcher(lower).find();
        }
        boolean fromPaymentApp = packageName != null && PAYMENT_APPS.contains(packageName);
        return looksFinancial(title, text, fromPaymentApp);
    }

    /**
     * The strict test: an amount and a verb saying money moved.
     *
     * This is what a message from an SMS app has to pass, and it is the one
     * SmsSenderFilter uses for the inbox. It stays strict on purpose - these
     * carry other people's conversation.
     */
    static boolean looksFinancial(String title, String text) {
        return looksFinancial(title, text, false);
    }

    /**
     * @param fromPaymentApp true for an app that posts nothing but payments,
     *                       which buys leniency about PHRASING - never about
     *                       what is read.
     */
    private static boolean looksFinancial(String title, String text, boolean fromPaymentApp) {
        String body = ((title == null ? "" : title) + " " + (text == null ? "" : text)).trim();
        if (body.isEmpty()) return false;
        if (body.length() > 2000) return false;          // not a payment alert
        String lower = body.toLowerCase(Locale.ROOT);

        // Proof that nothing moved. Beats everything else in the method.
        if (NEVER_A_PAYMENT.matcher(lower).find()) return false;

        // No figure, no payment. Unchanged, and the reason an advertisement
        // with no number never gets this far.
        if (!AMOUNT.matcher(lower).find()) return false;

        /*
         * A verb saying money moved settles it - INCLUDING over marketing.
         *
         * This ordering is the fix for the second half of the McDonald's miss.
         * Google Pay attaches scratch cards to ordinary payments, and checking
         * the marketing words first meant the advertisement overrode the
         * receipt it was stapled to.
         */
        if (MOVEMENT.matcher(lower).find() || WALLET_LOAD.matcher(lower).find()) return true;

        // No verb. Now marketing language decides it is an advertisement
        // quoting a figure rather than a receipt.
        if (MARKETING.matcher(lower).find()) return false;

        /*
         * A terse receipt from a payment app: an amount, no verb, nothing
         * selling anything. "Rs.161.70 to McDonald's" is the shape Google Pay
         * uses most, and requiring a verb threw it away - a real payment on 11
         * September that had to be typed in by hand.
         *
         * Only for payment apps. An SMS app reaching this line is a message
         * with a number in it and no evidence money moved, which is exactly
         * the private text this whole filter exists to leave alone.
         */
        return fromPaymentApp;
    }

    /** True when notifications from this package may be examined at all. */
    static boolean isWatchedPackage(Set<String> extra, String packageName) {
        if (packageName == null) return false;
        if (DEFAULT_PACKAGES.contains(packageName)) return true;
        // Watched, but only ever judged by the stricter receipt test above.
        if (CONVERSATIONAL_PACKAGES.contains(packageName)) return true;
        return extra != null && extra.contains(packageName);
    }
}
