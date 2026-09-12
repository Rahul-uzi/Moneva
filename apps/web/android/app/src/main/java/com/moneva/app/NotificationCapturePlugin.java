package com.moneva.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * The bridge between the notification listener and the app.
 *
 * Deliberately thin. It hands over raw alert text and answers questions about
 * permission; it does not decide what a payment is. All of that - what parses,
 * what is a duplicate, what becomes a transaction - lives in TypeScript, where
 * it can be tested without a phone.
 */
@CapacitorPlugin(name = "NotificationCapture")
public class NotificationCapturePlugin extends Plugin {

    /**
     * The live instance, so the listener - which Android constructs on its own
     * and hands no references to - can wake the app when it is open.
     * Null whenever the WebView is not running, which is most of the time.
     */
    private static NotificationCapturePlugin instance;

    private CapturedNotificationStore store;

    @Override
    public void load() {
        store = new CapturedNotificationStore(getContext());
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        instance = null;
        super.handleOnDestroy();
    }

    /** Called by the listener. No-op unless the app is actually open. */
    static void emitCaptured() {
        NotificationCapturePlugin plugin = instance;
        if (plugin != null) {
            plugin.notifyListeners("paymentNotification", new JSObject());
        }
    }

    /**
     * Whether the OS has granted notification access.
     *
     * Read from the settings string rather than a permission check: notifi-
     * cation access is not a runtime permission and cannot be requested with
     * a dialog. The user has to switch it on in a system settings screen, so
     * all the app can do is look, and offer to take them there.
     */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isListenerEnabled(getContext()));
        result.put("capturing", store.isEnabled());
        // Health travels with status because they are read together and mean
        // nothing apart: "capturing = true" is not reassurance on its own,
        // since a listener the system has killed still reports true here.
        result.put("lastKeptAt", store.lastKeptAt());
        result.put("keptCount", store.keptCount());
        result.put("enabledAt", store.enabledAt());

        // Whether Android has the listener BOUND right now - a fact, not an
        // inference. Read live from the service's own flag; see the note on
        // TxNotificationListener.alive for why disk would lie here.
        boolean granted = isListenerEnabled(getContext());
        boolean alive = TxNotificationListener.isAlive();
        result.put("connected", alive);
        result.put("connectedAt", store.listenerStateAt());

        // Permitted and wanted but not bound: fix it now, while the app is
        // open and can. The result reports the state BEFORE the attempt, so
        // the screen can say what it found; a re-check a moment later shows
        // whether it worked.
        if (granted && store.isEnabled() && !alive) {
            ListenerRebinder.rebind(getContext());
        }

        result.put("batteryExempt", isBatteryExempt(getContext()));
        result.put("manufacturer", Build.MANUFACTURER == null
                ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT));
        call.resolve(result);
    }

    /**
     * Ask Android to leave MONEVA out of battery optimisation.
     *
     * This is the single most effective thing against a listener that dies
     * while the app is unopened. Samsung's "sleeping apps" policy - the usual
     * culprit - does not touch an app that is on this list, and Doze stops
     * deferring its work. It is the standard, sanctioned request for an app
     * whose whole purpose is to keep listening; the dialog it opens is the
     * system's own, and the user can refuse.
     */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        JSObject result = new JSObject();
        if (isBatteryExempt(getContext())) {
            result.put("exempt", true);
            call.resolve(result);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            result.put("exempt", false);
            result.put("opened", true);
            call.resolve(result);
        } catch (Throwable t) {
            // Some builds hide the direct dialog; fall back to the list screen
            // where the user can find MONEVA by hand.
            try {
                Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                list.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(list);
                result.put("exempt", false);
                result.put("opened", true);
                call.resolve(result);
            } catch (Throwable t2) {
                call.reject("Could not open battery settings.");
            }
        }
    }

    /** Try to get a dropped listener bound again, on demand from the screen. */
    @PluginMethod
    public void reconnect(PluginCall call) {
        boolean toggled = ListenerRebinder.rebind(getContext());
        JSObject result = new JSObject();
        result.put("requested", toggled);
        call.resolve(result);
    }

    private static boolean isBatteryExempt(Context context) {
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        } catch (Throwable t) {
            return false;
        }
    }

    /** Opens the system screen where notification access is granted. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            call.reject("Could not open notification access settings.");
        }
    }

    /**
     * The app's own switch. Separate from the OS permission on purpose: the
     * user can stop capture from inside the app, immediately, without being
     * sent to a settings screen. Turning it off also empties the queue.
     */
    @PluginMethod
    public void setCapturing(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }
        store.setEnabled(enabled);
        // The watchdog only matters while capture is wanted. Scheduling it
        // here, at the moment of switching on, means it exists even for a
        // user who never opens the app again after this - which is the exact
        // person it protects. KEEP makes a repeat call harmless.
        if (enabled) CaptureWatchdogWorker.schedule(getContext());
        JSObject result = new JSObject();
        result.put("capturing", store.isEnabled());
        result.put("granted", isListenerEnabled(getContext()));
        call.resolve(result);
    }

    /** Everything captured and not yet dealt with. */
    @PluginMethod
    public void getCaptured(PluginCall call) {
        JSObject result = new JSObject();
        try {
            JSONArray queue = store.all();
            JSArray items = new JSArray();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject entry = queue.getJSONObject(i);
                JSObject item = new JSObject();
                item.put("id", entry.optString("id"));
                item.put("packageName", entry.optString("packageName"));
                item.put("title", entry.optString("title"));
                item.put("text", entry.optString("text"));
                item.put("postedAt", entry.optLong("postedAt"));
                items.put(item);
            }
            result.put("items", items);
        } catch (JSONException e) {
            result.put("items", new JSArray());
        }
        call.resolve(result);
    }

    /**
     * Forget alerts the app has finished with - whether it made a transaction
     * from one or the user dismissed it. Nothing is kept "just in case".
     */
    @PluginMethod
    public void acknowledge(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("ids is required");
            return;
        }
        Set<String> toRemove = new HashSet<>();
        try {
            List<String> list = ids.toList();
            for (Object id : list) {
                if (id != null) toRemove.add(id.toString());
            }
        } catch (JSONException e) {
            call.reject("ids must be an array of strings");
            return;
        }
        store.remove(toRemove);
        call.resolve();
    }

    /** Add banking apps the built-in list does not know about. */
    @PluginMethod
    public void setExtraPackages(PluginCall call) {
        JSArray packages = call.getArray("packages");
        Set<String> extra = new HashSet<>();
        if (packages != null) {
            try {
                for (Object p : packages.toList()) {
                    if (p != null && !TextUtils.isEmpty(p.toString())) extra.add(p.toString());
                }
            } catch (JSONException e) {
                call.reject("packages must be an array of strings");
                return;
            }
        }
        store.setExtraPackages(extra);
        call.resolve();
    }

    static boolean isListenerEnabled(Context context) {
        String enabled = Settings.Secure.getString(
                context.getContentResolver(), "enabled_notification_listeners");
        if (TextUtils.isEmpty(enabled)) return false;

        // A flat string of ComponentNames. Compare properly rather than by
        // substring: another app's package can contain ours as a prefix.
        ComponentName ours = new ComponentName(context, TxNotificationListener.class);
        for (String part : enabled.split(":")) {
            ComponentName parsed = ComponentName.unflattenFromString(part);
            if (parsed != null && parsed.equals(ours)) return true;
        }
        return false;
    }
}
