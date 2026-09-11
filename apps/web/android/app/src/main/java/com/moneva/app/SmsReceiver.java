package com.moneva.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * The live half of SMS capture.
 *
 * The backfill covers what already arrived; this covers what arrives next, and
 * it matters for a reason the notification listener cannot cover: plenty of
 * Indian banks send a transaction SMS and post no notification at all, and
 * some post one that says only "You have a new message".
 *
 * Runs with the app closed, on the main thread, for every message the phone
 * receives. So it does the least possible: two native gates, and at most one
 * small write. Everything it knows about what counts as a payment comes from
 * SmsSenderFilter, which is the same pair of gates the backfill applies - a
 * message must be treated identically whether it was read as it arrived or
 * found later, or the app's behaviour depends on when it was installed.
 *
 * It never aborts the broadcast and never touches the message. Other apps -
 * the user's actual messaging app above all - see everything exactly as they
 * would if this were not installed.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "MonevaSms";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) {
                return;
            }

            CapturedNotificationStore store = new CapturedNotificationStore(context);
            // The user's switch first, before the message is even assembled.
            // Holding the permission is not consent to use it.
            if (!store.isSmsEnabled()) return;

            Bundle extras = intent.getExtras();
            if (extras == null) return;

            Object[] pdus = (Object[]) extras.get("pdus");
            if (pdus == null || pdus.length == 0) return;
            String format = extras.getString("format");

            /*
             * A long SMS arrives as several PDUs that are one message. Joining
             * the bodies matters here rather than being tidy: a bank alert
             * split across the 160-character boundary usually puts the amount
             * in the first part and the reference in the second, and parsing
             * the halves separately yields either a payment with no reference
             * or a fragment that looks like nothing at all.
             */
            StringBuilder body = new StringBuilder();
            String address = null;
            long sentAt = System.currentTimeMillis();

            for (Object pdu : pdus) {
                SmsMessage part = format != null
                        ? SmsMessage.createFromPdu((byte[]) pdu, format)
                        : SmsMessage.createFromPdu((byte[]) pdu);
                if (part == null) continue;
                if (address == null) address = part.getOriginatingAddress();
                String text = part.getMessageBody();
                if (text != null) body.append(text);
                long ts = part.getTimestampMillis();
                if (ts > 0) sentAt = ts;
            }

            String text = body.toString();
            if (!SmsSenderFilter.shouldCapture(address, text)) return;

            store.add(SmsCapturePlugin.contentId(address, text, sentAt),
                    "com.android.mms", address, text, sentAt);

            Log.d(TAG, "kept a live message");

            // If the app happens to be open, let it react now rather than at
            // next launch. Usually there is no listener and this does nothing.
            NotificationCapturePlugin.emitCaptured();
        } catch (Throwable t) {
            // A receiver that throws can be disabled by the system, which
            // would stop capture silently. Never let one malformed message
            // do that.
            Log.w(TAG, "receive failed: " + t.getClass().getSimpleName());
        }
    }
}
