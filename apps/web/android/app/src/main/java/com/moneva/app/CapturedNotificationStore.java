package com.moneva.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * The small, bounded queue of payment alerts waiting to be read by the app.
 *
 * It has to be on disk rather than in memory: a notification listener runs
 * whether or not the app is open, so most alerts arrive with no WebView alive
 * to hand them to. They wait here until the app next starts.
 *
 * Bounded on purpose. This holds the text of somebody's bank alerts, so it
 * keeps as little as it can get away with - the newest CAPACITY entries, and
 * each one is deleted the moment the app has turned it into a proposal.
 */
final class CapturedNotificationStore {

    private static final String PREFS = "moneva_notification_capture";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_EXTRA_PACKAGES = "extra_packages";

    /* Health, kept deliberately OUTSIDE the queue.

       The queue empties as the user confirms or dismisses each alert, so its
       length says nothing about whether the listener is alive. These two do,
       and they are what makes a dead listener visible: a notification service
       that has been killed, or a bank that changed its wording, both look like
       silence, and silence is otherwise indistinguishable from a quiet week. */
    private static final String KEY_LAST_KEPT_AT = "last_kept_at";
    private static final String KEY_KEPT_COUNT = "kept_count";
    /* When capture was last switched ON. Silence is only measured from here:
       without it, turning capture off for a month and back on would report a
       month of silence the moment it was re-enabled. */
    private static final String KEY_ENABLED_AT = "enabled_at";
    private static final String KEY_SMS_ENABLED = "sms_enabled";
    private static final String KEY_SMS_BACKFILLED_TO = "sms_backfilled_to";

    /** Roughly a fortnight of alerts for a busy account; older ones fall off. */
    private static final int CAPACITY = 200;

    private final SharedPreferences prefs;

    CapturedNotificationStore(Context context) {
        this.prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The app's own switch, separate from the OS permission.
     *
     * Two switches because they mean different things: the OS one says the
     * listener MAY run, this one says the user still wants it to. Turning
     * capture off in the app must work immediately, without sending anyone to
     * a system settings screen.
     *
     * Defaults to false - granting notification access must not, by itself,
     * start collecting anything.
     */
    boolean isEnabled() {
        return prefs.getBoolean(KEY_ENABLED, false);
    }

    void setEnabled(boolean enabled) {
        prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                // Stamped only when switching ON, so the silence clock starts
                // from the moment the user asked for capture.
                .putLong(KEY_ENABLED_AT, enabled ? System.currentTimeMillis()
                                                 : prefs.getLong(KEY_ENABLED_AT, 0L))
                .apply();
        if (!enabled) clear();   // off means the queue goes too
    }

    /**
     * Whether SMS capture is wanted, separately from notification capture.
     *
     * Two switches rather than one, because they are two different grants with
     * two different costs. READ_SMS reaches an inbox that also holds one-time
     * codes and private conversation; notification access does not. Someone
     * who wants payment alerts read has not thereby agreed to have their
     * messages read, and collapsing both into a single toggle would take that
     * decision away from them.
     *
     * Defaults to false. Holding the permission is not consent to use it.
     */
    boolean isSmsEnabled() {
        return prefs.getBoolean(KEY_SMS_ENABLED, false);
    }

    void setSmsEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_SMS_ENABLED, enabled).apply();
    }

    /**
     * The oldest point the backfill has already covered, as epoch ms.
     *
     * A second backfill re-reads the same inbox, and every message it finds
     * again derives the same id, so the queue de-duplicates it. This exists so
     * the SCAN can stop early instead - re-reading years of messages to
     * discard all of them is work the phone does not need to do.
     */
    long smsBackfilledTo() {
        return prefs.getLong(KEY_SMS_BACKFILLED_TO, 0L);
    }

    void setSmsBackfilledTo(long epochMs) {
        prefs.edit().putLong(KEY_SMS_BACKFILLED_TO, epochMs).apply();
    }

    /** Epoch ms of the last alert kept, or 0 if none has ever been kept. */
    long lastKeptAt() {
        return prefs.getLong(KEY_LAST_KEPT_AT, 0L);
    }

    /** How many alerts have ever been kept. Survives the queue emptying. */
    int keptCount() {
        return prefs.getInt(KEY_KEPT_COUNT, 0);
    }

    /** Epoch ms when capture was last switched on, or 0 if never. */
    long enabledAt() {
        return prefs.getLong(KEY_ENABLED_AT, 0L);
    }

    /** Extra packages the app has added on top of the built-in list. */
    Set<String> extraPackages() {
        return new HashSet<>(prefs.getStringSet(KEY_EXTRA_PACKAGES, Collections.<String>emptySet()));
    }

    void setExtraPackages(Set<String> packages) {
        prefs.edit().putStringSet(KEY_EXTRA_PACKAGES, packages).apply();
    }

    /**
     * Adds one alert, unless an identical one is already queued.
     *
     * Android re-posts a notification when it is updated - a progress bar, a
     * group summary being rebuilt - and the same payment can arrive several
     * times. `id` is a content hash from the caller, so a re-post lands on the
     * entry already there instead of beside it.
     */
    synchronized void add(String id, String packageName, String title, String text, long postedAt) {
        try {
            JSONArray queue = readQueue();
            for (int i = 0; i < queue.length(); i++) {
                if (id.equals(queue.getJSONObject(i).optString("id"))) return;
            }

            JSONObject entry = new JSONObject();
            entry.put("id", id);
            entry.put("packageName", packageName);
            entry.put("title", title == null ? "" : title);
            entry.put("text", text == null ? "" : text);
            entry.put("postedAt", postedAt);
            queue.put(entry);

            // Drop the oldest once over capacity.
            while (queue.length() > CAPACITY) queue.remove(0);

            prefs.edit()
                    .putString(KEY_QUEUE, queue.toString())
                    // Written on every kept alert, whatever becomes of it
                    // afterwards - this is the proof the listener is running.
                    .putLong(KEY_LAST_KEPT_AT, System.currentTimeMillis())
                    .putInt(KEY_KEPT_COUNT, prefs.getInt(KEY_KEPT_COUNT, 0) + 1)
                    .apply();
        } catch (JSONException ignored) {
            // A malformed entry is not worth taking the listener down for.
        }
    }

    synchronized JSONArray all() {
        return readQueue();
    }

    /** Forget the ones the app has finished with. */
    synchronized void remove(Set<String> ids) {
        try {
            JSONArray queue = readQueue();
            JSONArray kept = new JSONArray();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject entry = queue.getJSONObject(i);
                if (!ids.contains(entry.optString("id"))) kept.put(entry);
            }
            prefs.edit().putString(KEY_QUEUE, kept.toString()).apply();
        } catch (JSONException ignored) {
        }
    }

    synchronized void clear() {
        prefs.edit().remove(KEY_QUEUE).apply();
    }

    private JSONArray readQueue() {
        String raw = prefs.getString(KEY_QUEUE, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
