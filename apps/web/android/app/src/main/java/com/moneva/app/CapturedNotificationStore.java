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
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
        if (!enabled) clear();   // off means the queue goes too
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

            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
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
