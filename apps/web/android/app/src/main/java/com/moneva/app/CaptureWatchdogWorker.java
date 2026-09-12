package com.moneva.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * Notices a dead listener when nobody has opened the app.
 *
 * THE GAP THIS CLOSES. Everything else that could revive the listener needed
 * the app to be running: the plugin checks on launch, the listener asks for a
 * rebind on disconnect. But the complaint was precisely "I did not open it
 * all day" - and a listener that Samsung killed at 9am stayed dead until the
 * next launch, missing every payment in between, with nothing anywhere able
 * to notice.
 *
 * This runs on its own, every fifteen minutes, whether the app is open or
 * not. It does one cheap thing: if capture is wanted and permitted and the
 * listener is NOT alive, it asks for a rebind. Everything else returns
 * immediately.
 *
 * WHAT IT CANNOT DO. WorkManager runs in Doze's maintenance windows and
 * survives ordinary memory kills, but a Samsung "deep sleeping" app has its
 * workers blocked too. That state is prevented by the battery-optimisation
 * exemption, not by this - the two are complements, and the exemption is the
 * more important of the pair.
 */
public class CaptureWatchdogWorker extends Worker {

    private static final String TAG = "MonevaNotif";
    static final String NAME = "moneva-capture-watchdog";

    /**
     * Fifteen is WorkManager's floor for periodic work. It is also about
     * right: a listener dead for a quarter of an hour misses at most a
     * payment or two, and those still arrive by SMS if that switch is on.
     */
    private static final long EVERY_MINUTES = 15;

    public CaptureWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        CapturedNotificationStore store = new CapturedNotificationStore(context);

        // Not wanted: the user turned capture off. Nothing to guard.
        if (!store.isEnabled()) return Result.success();

        // Not permitted: notification access was revoked. A rebind cannot
        // help, and the health screen already says so in words.
        if (!NotificationCapturePlugin.isListenerEnabled(context)) return Result.success();

        // Wanted, permitted, and running. The normal case.
        if (TxNotificationListener.isAlive()) return Result.success();

        // Wanted, permitted, and dead. This is the failure the worker exists for.
        Log.w(TAG, "watchdog: listener is not bound; asking for a rebind");
        ListenerRebinder.rebind(context);
        return Result.success();
    }

    /**
     * Idempotent. KEEP means a second call while one is already scheduled
     * does nothing, so this can be invoked from every place that might be the
     * first - app launch, capture switched on - without stacking workers.
     */
    static void schedule(Context context) {
        try {
            PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                    CaptureWatchdogWorker.class, EVERY_MINUTES, TimeUnit.MINUTES).build();
            WorkManager.getInstance(context.getApplicationContext())
                    .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request);
        } catch (Throwable t) {
            // A failed schedule must never take the caller down with it.
            Log.w(TAG, "could not schedule watchdog: " + t.getClass().getSimpleName());
        }
    }
}
