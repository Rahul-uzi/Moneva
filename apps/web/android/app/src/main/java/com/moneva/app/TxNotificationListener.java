package com.moneva.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.Locale;

/**
 * Watches the notification shade for payment alerts.
 *
 * This is how the app learns about a payment it was not told about: a UPI app
 * or a bank posts an alert, this reads it, and the app turns it into a
 * proposed transaction for the user to confirm. It is the only way to see a
 * Google Pay or PhonePe payment at all - neither has an API for it.
 *
 * The service is started by Android, not by the app, and keeps running with
 * the app closed. Three things follow from that, and each one matters:
 *
 *   - Nothing may be assumed about the WebView. Alerts go to a small on-disk
 *     queue (CapturedNotificationStore) and the app drains it when it next
 *     starts. Handing them straight to a bridge that is usually not there
 *     would simply lose them.
 *   - This runs on the main thread, on every notification the phone shows.
 *     The work here is a couple of regex matches and, rarely, a small write.
 *   - It can see everything. So it stores almost nothing: two gates in
 *     PaymentNotificationFilter run BEFORE anything is written down, and the
 *     user's own switch (store.isEnabled) is checked first of all.
 *
 * Granting notification access is not consent to collect. The app's own switch
 * defaults to off, and until it is on this returns immediately.
 */
public class TxNotificationListener extends NotificationListenerService {

    private static final String TAG = "MonevaNotif";

    private CapturedNotificationStore store;

    @Override
    public void onCreate() {
        super.onCreate();
        store = new CapturedNotificationStore(this);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (store == null || !store.isEnabled()) return;
            if (sbn == null) return;

            String packageName = sbn.getPackageName();
            if (!PaymentNotificationFilter.isWatchedPackage(store.extraPackages(), packageName)) {
                return;
            }

            // From here on the package is one we watch, so it is worth saying
            // WHY an alert was dropped - silence at this point is impossible
            // to tell apart from the service not running at all.
            //
            // Reasons only, never the text: this runs over somebody's whole
            // notification feed, and logcat is readable by adb.
            Notification notification = sbn.getNotification();
            if (notification == null) {
                Log.d(TAG, "drop " + packageName + ": no notification");
                return;
            }

            // A group summary repeats what its children already said.
            if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
                Log.d(TAG, "drop " + packageName + ": group summary");
                return;
            }

            Bundle extras = notification.extras;
            if (extras == null) {
                Log.d(TAG, "drop " + packageName + ": no extras");
                return;
            }

            String title = charSequence(extras, Notification.EXTRA_TITLE);

            // The FULLEST of the text fields, not the first one that exists.
            //
            // A long alert is posted with BigTextStyle: EXTRA_TEXT holds a
            // short collapsed line and EXTRA_BIG_TEXT holds the real message.
            // Preferring EXTRA_TEXT and only falling back when it was empty
            // meant a bank SMS - which is exactly this shape - was read as a
            // 9-character stub and thrown away as "not a payment".
            String text = longest(
                    charSequence(extras, Notification.EXTRA_BIG_TEXT),
                    charSequence(extras, Notification.EXTRA_TEXT),
                    charSequence(extras, Notification.EXTRA_SUMMARY_TEXT));

            if (!PaymentNotificationFilter.looksFinancial(title, text)) {
                Log.d(TAG, "drop " + packageName + ": not a payment"
                        + " (title=" + (title == null ? 0 : title.length())
                        + " text=" + (text == null ? 0 : text.length()) + " chars)");
                return;
            }

            store.add(
                    contentId(packageName, title, text, sbn.getPostTime()),
                    packageName,
                    title,
                    text,
                    sbn.getPostTime());

            Log.d(TAG, "kept " + packageName);

            // If the app happens to be open, let it react now rather than at
            // next launch. Usually there is no listener and this does nothing.
            NotificationCapturePlugin.emitCaptured();
        } catch (Throwable t) {
            // A listener that throws gets killed by the system and silently
            // stops delivering. Never let one malformed notification do that.
            Log.w(TAG, "capture failed: " + t.getClass().getSimpleName());
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // Dismissing an alert does not un-spend the money.
    }

    private static String charSequence(Bundle extras, String key) {
        CharSequence value = extras.getCharSequence(key);
        return value == null ? null : value.toString();
    }

    /** The longest of several candidates, or null if they are all empty. */
    private static String longest(String... candidates) {
        String best = null;
        for (String candidate : candidates) {
            if (candidate == null || candidate.trim().isEmpty()) continue;
            if (best == null || candidate.length() > best.length()) best = candidate;
        }
        return best;
    }

    /**
     * A stable id for one alert.
     *
     * Content plus the minute it arrived, so Android re-posting the same
     * notification (an update, a rebuilt group) lands on the entry already in
     * the queue instead of adding another. The minute bucket is deliberate:
     * exact post time changes on re-post, the content does not.
     */
    private static String contentId(String packageName, String title, String text, long postedAt) {
        String basis = packageName + "|" + (title == null ? "" : title)
                + "|" + (text == null ? "" : text)
                + "|" + (postedAt / 60000L);
        return String.format(Locale.ROOT, "%08x", basis.hashCode()) + "-" + basis.length();
    }
}
