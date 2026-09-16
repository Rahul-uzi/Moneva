package com.moneva.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * Fetching and installing a new build of MONEVA.
 *
 * WHY THIS EXISTS. The app is installed from a website, so nothing updates it.
 * Until now the app could only NOTICE a new version and hand the user a link,
 * which drops them into a browser, then a downloads folder, then a file
 * manager - and most people stop somewhere in the middle. Every fix shipped
 * after they installed stays invisible to them.
 *
 * WHAT CANNOT BE DONE, AND IS NOT ATTEMPTED. Android does not let an ordinary
 * app install a package silently. That is reserved for the system and for
 * device-owner apps in a managed fleet, and it is the right rule - an app that
 * could replace itself without asking could replace itself with anything. So
 * the OS shows its own confirmation, and the user taps Install once. This
 * plugin removes every OTHER step: no browser, no downloads folder, no file
 * manager, no hunting for the file.
 *
 * WHAT PROTECTS THE USER. Three things, and the third is the one that matters
 * most:
 *
 *   1. HTTPS only. An APK fetched over plain HTTP can be swapped in transit
 *      for anything at all, and the user would be tapping Install on it.
 *   2. The downloaded file is checked before the installer is ever opened -
 *      that it parses as a package at all, that it IS MONEVA, and that it is
 *      genuinely newer. A truncated download or a wrong file is refused here
 *      rather than becoming a confusing system error.
 *   3. Android itself refuses to replace an installed app with one signed by
 *      a different key. That is what makes this safe even if the download URL
 *      were ever tampered with: an APK that is not signed with our key cannot
 *      install over ours, whatever it claims to be. It is enforced by the OS,
 *      not by anything here that could be got around.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** Where a downloaded build waits. Inside the cache, so Android may
        reclaim it, which is correct: an APK that was never installed is
        rubbish, and one that was installed is no longer needed. */
    private static final String DIR = "updates";

    /** Generous, but not unbounded: a stalled socket must not hang forever. */
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;

    /** An APK is a zip. Anything that does not start "PK\3\4" is not one -
        usually an HTML error page served with a 200. */
    private static final byte[] ZIP_MAGIC = {0x50, 0x4B, 0x03, 0x04};

    /** A ceiling on what will be written to disk. The real APK is ~3 MB. */
    private static final long MAX_BYTES = 200L * 1024 * 1024;

    // ------------------------------------------------------------- status ---

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject out = new JSObject();
        out.put("canInstall", canInstallPackages());
        out.put("needsPermission", !canInstallPackages());
        try {
            PackageInfo me = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            out.put("versionName", me.versionName == null ? "" : me.versionName);
            out.put("versionCode", versionCodeOf(me));
        } catch (Throwable t) {
            out.put("versionName", "");
            out.put("versionCode", 0);
        }
        call.resolve(out);
    }

    /**
     * Whether this app may ask to install packages.
     *
     * From Android 8 this is granted per app and only by the user, on a
     * settings screen we can open but cannot tick. Below 8 the manifest
     * permission is enough.
     */
    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Throwable t) {
            return false;
        }
    }

    /** Opens the one screen where the user can grant it. */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (canInstallPackages()) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            // Resolves as "asked", not "granted". Whether they actually
            // granted it is answered by the next getStatus, after they come
            // back - there is no result to wait for here.
            call.resolve(new JSObject().put("granted", false).put("opened", true));
        } catch (Throwable t) {
            call.reject("Could not open the install-permission screen.");
        }
    }

    // ----------------------------------------------------------- download ---

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("No download address was given.");
            return;
        }
        if (!url.toLowerCase(Locale.ROOT).startsWith("https://")) {
            // Not a style preference. Over plain HTTP anything on the path can
            // replace the file with another APK, and the user would then be
            // tapping Install on whatever arrived.
            call.reject("An update may only be downloaded over a secure (https) connection.");
            return;
        }

        // Off the main thread: this writes several megabytes and the UI has a
        // progress bar to keep drawing.
        new Thread(() -> {
            HttpURLConnection conn = null;
            File target = null;
            try {
                File dir = new File(getContext().getCacheDir(), DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    rejectOnMain(call, "Could not make room for the download.");
                    return;
                }
                // One file, replaced each time. Keeping old builds would fill
                // the cache with APKs nobody will ever install again.
                target = new File(dir, "moneva-update.apk");
                if (target.exists() && !target.delete()) {
                    rejectOnMain(call, "A previous download is in the way.");
                    return;
                }

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(READ_TIMEOUT_MS);
                conn.setInstanceFollowRedirects(true);
                conn.connect();

                int status = conn.getResponseCode();
                if (status < 200 || status >= 300) {
                    rejectOnMain(call, "The server did not send the update (HTTP " + status + ").");
                    return;
                }

                long expected = conn.getContentLengthLong();
                long written = 0;
                byte[] head = new byte[4];
                int headSeen = 0;

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    long lastReported = -1;
                    while ((n = in.read(buf)) != -1) {
                        if (written + n > MAX_BYTES) {
                            rejectOnMain(call, "That download is far larger than an update should be.");
                            return;
                        }
                        // Keep the first four bytes to check what this is.
                        for (int i = 0; i < n && headSeen < 4; i += 1, headSeen += 1) {
                            head[headSeen] = buf[i];
                        }
                        out.write(buf, 0, n);
                        written += n;

                        if (expected > 0) {
                            long pct = (written * 100) / expected;
                            // Only on change, or a 3 MB file fires hundreds of
                            // identical events at the WebView.
                            if (pct != lastReported) {
                                lastReported = pct;
                                JSObject ev = new JSObject();
                                ev.put("percent", (int) pct);
                                ev.put("bytes", written);
                                ev.put("total", expected);
                                notifyListeners("downloadProgress", ev);
                            }
                        }
                    }
                }

                if (headSeen < 4 || !startsWithZipMagic(head)) {
                    // Overwhelmingly this is an HTML error page served with a
                    // 200 - a login wall, a "not found" page from a CDN. Left
                    // on disk it would reach the installer and fail there with
                    // something unreadable.
                    target.delete();
                    rejectOnMain(call, "What arrived was not an app file.");
                    return;
                }
                if (expected > 0 && written != expected) {
                    target.delete();
                    rejectOnMain(call, "The download was cut short. Try again.");
                    return;
                }

                JSObject verdict = inspect(target);
                if (verdict.getString("error") != null) {
                    target.delete();
                    rejectOnMain(call, verdict.getString("error"));
                    return;
                }

                JSObject out = new JSObject();
                out.put("path", target.getAbsolutePath());
                out.put("bytes", written);
                out.put("versionName", verdict.getString("versionName"));
                out.put("versionCode", verdict.getInteger("versionCode"));
                resolveOnMain(call, out);
            } catch (Throwable t) {
                if (target != null) target.delete();
                rejectOnMain(call, "The update could not be downloaded. Check your connection.");
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "moneva-update-download").start();
    }

    private static boolean startsWithZipMagic(byte[] head) {
        for (int i = 0; i < ZIP_MAGIC.length; i += 1) {
            if (head[i] != ZIP_MAGIC[i]) return false;
        }
        return true;
    }

    /**
     * Read the downloaded file as a package and decide whether to offer it.
     *
     * Done here rather than left to the installer so a wrong file produces a
     * sentence the user can act on, instead of a system dialog that says
     * "There was a problem parsing the package".
     */
    private JSObject inspect(File apk) {
        JSObject out = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null) {
            out.put("error", "That file is not a readable app.");
            return out;
        }
        if (!getContext().getPackageName().equals(info.packageName)) {
            // It parsed, and it is some other app. Nothing good comes of
            // opening the installer on it.
            out.put("error", "That download is a different app, not MONEVA.");
            return out;
        }
        long incoming = versionCodeOf(info);
        long mine = 0;
        try {
            mine = versionCodeOf(pm.getPackageInfo(getContext().getPackageName(), 0));
        } catch (Throwable ignored) { }
        if (incoming <= mine) {
            // Android would refuse a downgrade anyway, with a message that
            // explains nothing.
            out.put("error", "That build is not newer than the one installed.");
            return out;
        }
        out.put("versionName", info.versionName == null ? "" : info.versionName);
        out.put("versionCode", incoming);
        return out;
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return info.getLongVersionCode();
        return info.versionCode;
    }

    // ------------------------------------------------------------ install ---

    /**
     * Hand the file to Android's installer.
     *
     * The app does not install anything and cannot: it asks the system to, and
     * the system asks the user. After they accept, Android stops this process
     * and the new build starts when they open it - which is why there is no
     * "restart" call here. There is nothing left to restart.
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.trim().isEmpty()) {
            call.reject("No downloaded update to install.");
            return;
        }
        File apk = new File(path);
        if (!apk.exists()) {
            call.reject("The downloaded update is no longer there. Download it again.");
            return;
        }
        if (!canInstallPackages()) {
            call.reject("MONEVA has not been allowed to install updates yet.");
            return;
        }
        // Checked again at the point of use. The file has been on disk since
        // the download, and this is cheap next to opening an installer on
        // something unverified.
        JSObject verdict = inspect(apk);
        if (verdict.getString("error") != null) {
            call.reject(verdict.getString("error"));
            return;
        }

        try {
            Context ctx = getContext();
            Uri uri = FileProvider.getUriForFile(
                    ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            // The installer is a different app and cannot read our cache
            // without being handed permission for this one file.
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            Activity activity = getActivity();
            if (activity != null) activity.startActivity(intent);
            else ctx.startActivity(intent);

            call.resolve(new JSObject().put("opened", true));
        } catch (Throwable t) {
            call.reject("Android would not open the installer for that file.");
        }
    }

    // ------------------------------------------------------------ helpers ---

    private void resolveOnMain(PluginCall call, JSObject data) {
        getBridge().executeOnMainThread(() -> call.resolve(data));
    }

    private void rejectOnMain(PluginCall call, String message) {
        getBridge().executeOnMainThread(() -> call.reject(message));
    }
}
