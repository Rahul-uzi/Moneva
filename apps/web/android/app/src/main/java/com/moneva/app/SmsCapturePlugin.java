package com.moneva.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Locale;

/**
 * Reading bank SMS - the backlog, and then the live stream.
 *
 * The notification listener can only ever see the future: it starts when the
 * user grants it and knows nothing about the months before. That is the single
 * biggest reason a new user prefers a rival - they open Money View and six
 * months of their own spending is already there. The inbox is where that
 * history actually lives.
 *
 * What this does NOT do is as important as what it does:
 *
 *   - It never hands raw SMS to the web layer in bulk. Messages are filtered
 *     natively and only survivors are queued, so a message that is not a
 *     payment is never seen by anything above this file.
 *   - It never sends raw SMS anywhere. The queue is on-device; the app turns
 *     entries into proposals and uploads the parsed TRANSACTION, never the
 *     message. Google's own spyware policy requires exactly this of budgeting
 *     apps, and it is the right line regardless of who is enforcing it.
 *   - It does nothing at all until `setCapturing(true)`. Holding READ_SMS is
 *     not consent to use it; the switch defaults to off and is separate from
 *     the notification switch.
 *
 * Queued entries go into the SAME store the notification listener uses, so
 * they flow through one drain, one parser and one confirmation inbox. An SMS
 * arrives at the web layer looking like a Messages notification - sender in
 * the title, body in the text - which is the shape paymentAlert already
 * understands, and which autoAdd already treats as untrusted: a proposal from
 * SMS always asks, and can never be written unattended.
 */
@CapacitorPlugin(
        name = "SmsCapture",
        permissions = {
                @Permission(alias = SmsCapturePlugin.SMS, strings = {
                        Manifest.permission.READ_SMS,
                        Manifest.permission.RECEIVE_SMS
                })
        }
)
public class SmsCapturePlugin extends Plugin {

    static final String SMS = "sms";
    private static final String TAG = "MonevaSms";

    /** Read directly rather than via Telephony.Sms, which needs API 19+. */
    private static final Uri INBOX = Uri.parse("content://sms/inbox");

    /**
     * How far back a backfill will ever look.
     *
     * Two years is past the point of usefulness for a spending record and well
     * past the point where a phone's inbox still holds the messages. A bound
     * exists mostly so a first run on a very old handset cannot sit there
     * reading fifty thousand rows.
     */
    private static final long MAX_LOOKBACK_MS = 730L * 24 * 60 * 60 * 1000;

    /** A hard cap on one backfill, so the pass is always bounded. */
    private static final int MAX_ROWS = 5000;

    private CapturedNotificationStore store;

    @Override
    public void load() {
        store = new CapturedNotificationStore(getContext());
    }

    private boolean granted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", granted());
        out.put("capturing", store.isSmsEnabled());
        out.put("backfilledTo", store.smsBackfilledTo());
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (granted()) {
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        requestPermissionForAlias(SMS, call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) {
        JSObject out = new JSObject();
        // Read the real state rather than trusting the callback's argument:
        // a user can grant one of the two aliases, or revoke between the
        // dialog closing and this running.
        out.put("granted", granted());
        out.put("permanentlyDenied",
                !granted() && getPermissionState(SMS) == PermissionState.DENIED);
        call.resolve(out);
    }

    /**
     * The user's own switch, independent of the system permission.
     *
     * Turning capture off has to work immediately and without sending anyone
     * to a settings screen - so this is checked before the permission on every
     * path that reads anything.
     */
    @PluginMethod
    public void setCapturing(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        store.setSmsEnabled(enabled);
        JSObject out = new JSObject();
        out.put("capturing", store.isSmsEnabled());
        call.resolve(out);
    }

    /**
     * Read the inbox once and queue whatever looks like a payment.
     *
     * Returns counts, never content. The web layer learns that 47 of 3,200
     * messages were kept; it does not learn anything about the 3,153 that were
     * not, and neither does anything else.
     */
    @PluginMethod
    public void backfill(PluginCall call) {
        if (!store.isSmsEnabled()) {
            call.reject("SMS capture is off");
            return;
        }
        if (!granted()) {
            call.reject("READ_SMS not granted");
            return;
        }

        Integer months = call.getInt("months", 12);
        long window = Math.min(
                (long) Math.max(1, months == null ? 12 : months) * 30L * 24 * 60 * 60 * 1000,
                MAX_LOOKBACK_MS);
        long since = System.currentTimeMillis() - window;

        int scanned = 0;
        int kept = 0;
        long oldestSeen = Long.MAX_VALUE;

        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(
                    INBOX,
                    new String[]{"address", "body", "date"},
                    "date >= ?",
                    new String[]{String.valueOf(since)},
                    "date DESC");

            if (cursor == null) {
                call.reject("The inbox could not be read");
                return;
            }

            int addressCol = cursor.getColumnIndex("address");
            int bodyCol = cursor.getColumnIndex("body");
            int dateCol = cursor.getColumnIndex("date");
            if (addressCol < 0 || bodyCol < 0 || dateCol < 0) {
                call.reject("The inbox is not in the expected shape");
                return;
            }

            while (cursor.moveToNext() && scanned < MAX_ROWS) {
                scanned++;
                String address = cursor.getString(addressCol);
                String body = cursor.getString(bodyCol);
                long sentAt = cursor.getLong(dateCol);
                if (sentAt < oldestSeen) oldestSeen = sentAt;

                // Both gates, native, before anything is written down.
                if (!SmsSenderFilter.shouldCapture(address, body)) continue;

                store.add(contentId(address, body, sentAt), "com.android.mms",
                        address, body, sentAt);
                kept++;
            }
        } catch (SecurityException e) {
            // Revoked between the check above and here, or a vendor ROM
            // refusing despite the grant.
            call.reject("The inbox could not be read");
            return;
        } catch (Throwable t) {
            Log.w(TAG, "backfill failed: " + t.getClass().getSimpleName());
            call.reject("The inbox could not be read");
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        if (oldestSeen != Long.MAX_VALUE) store.setSmsBackfilledTo(oldestSeen);

        Log.d(TAG, "backfill kept " + kept + " of " + scanned);

        JSObject out = new JSObject();
        out.put("scanned", scanned);
        out.put("kept", kept);
        // True when the cap stopped the pass, so the screen can say the run
        // was bounded rather than implying the inbox is exhausted.
        out.put("truncated", scanned >= MAX_ROWS);
        call.resolve(out);
    }

    /**
     * The same id scheme the notification path uses.
     *
     * Content plus the minute, so the same message read live and then again by
     * a later backfill collapses onto one queue entry instead of becoming two
     * proposals for one payment.
     */
    static String contentId(String address, String body, long sentAt) {
        String basis = "com.android.mms|" + (address == null ? "" : address)
                + "|" + (body == null ? "" : body)
                + "|" + (sentAt / 60000L);
        return String.format(Locale.ROOT, "%08x", basis.hashCode()) + "-" + basis.length();
    }
}
