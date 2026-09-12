package com.moneva.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.service.notification.NotificationListenerService;
import android.util.Log;

/**
 * Getting a dropped listener bound again, without sending anyone to Settings.
 *
 * Two attempts, because one is polite and the other works.
 *
 * `requestRebind` is the official API and is tried first. In practice the
 * system sometimes ignores it - a listener it unbound under memory or battery
 * pressure can stay unbound indefinitely, and the only thing that reliably
 * brought it back was the user switching notification access off and on.
 *
 * The second attempt does what that toggle does, from code: disabling and
 * re-enabling the listener's component makes Android re-evaluate every enabled
 * listener and bind ours afresh. DONT_KILL_APP keeps the process alive
 * through it. This is a well-known workaround rather than a documented
 * contract, which is why it is second and why it is wrapped so tightly.
 *
 * Shared by the plugin (when the app opens) and the watchdog (when it does
 * not), so the two cannot drift into doing different things.
 */
final class ListenerRebinder {

    private static final String TAG = "MonevaNotif";

    private ListenerRebinder() {}

    /** Ask for the listener to be bound. Returns whether the toggle was applied. */
    static boolean rebind(Context context) {
        ComponentName ours = new ComponentName(context, TxNotificationListener.class);

        try {
            NotificationListenerService.requestRebind(ours);
        } catch (Throwable t) {
            Log.w(TAG, "requestRebind failed: " + t.getClass().getSimpleName());
        }

        try {
            PackageManager pm = context.getPackageManager();
            pm.setComponentEnabledSetting(ours,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP);
            pm.setComponentEnabledSetting(ours,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
            Log.d(TAG, "listener component toggled to force a rebind");
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "component toggle failed: " + t.getClass().getSimpleName());
            return false;
        }
    }
}
