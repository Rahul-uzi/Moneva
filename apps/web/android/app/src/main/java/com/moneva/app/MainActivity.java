package com.moneva.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "MonevaZoom";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate: the bridge builds its plugin list
        // there, and anything added afterwards is not in it.
        registerPlugin(NotificationCapturePlugin.class);
        registerPlugin(SmsCapturePlugin.class);
        super.onCreate(savedInstanceState);
        disablePageZoom();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Again on every resume. The call is idempotent and costs nothing, and
        // it means the setting cannot be left off by a WebView that was built
        // or replaced after onCreate - a failure that would otherwise be
        // silent and would only show up as the app zooming in someone's hand.
        disablePageZoom();
    }

    /**
     * Stops the screen behaving like a web page.
     *
     * A WebView allows pinch-zoom and double-tap-zoom by default, which is
     * right for a document and wrong for an app: a stray pinch leaves the
     * whole interface scaled, the tab bar half off-screen, and no obvious way
     * back - the app looks broken and the user did not ask for it. No native
     * app does this, which is exactly why it reads as "this is a website".
     *
     * Done here rather than with `user-scalable=no` in the viewport meta tag
     * on purpose: the same index.html is also served as a web app, where
     * pinch-zoom is a genuine accessibility affordance and taking it away
     * would be wrong. This applies to the packaged Android app alone.
     *
     * A second, independent layer does the same job from the stylesheet -
     * `touch-action` under the `is-native-app` class, set in main.tsx. Two,
     * because this one depends on the bridge having built its WebView by the
     * time it runs, and if that ever stops being true the failure is silent.
     *
     * Text zoom IS pinned, and that is the change people actually notice.
     *
     * Measured on the owner's phone, which has the system font at 110%: a CSS
     * rule declaring `font-size: 100px` was computing to 110px. The WebView
     * passes the system font scale through to text and to text ALONE - every
     * box, icon, row height and padding in this app is specified in px and
     * does not move. So the type grows inside furniture that did not, labels
     * wrap, values collide with their headings, and the app reads as though
     * it has been zoomed in and left that way. That is the complaint.
     *
     * Pinning it to 100 makes the app render at the proportions it was drawn
     * at. The cost is real and worth stating: someone who has enlarged system
     * text no longer gets larger text here. The honest fix for them is to
     * scale the WHOLE interface - type and furniture together - which needs
     * this stylesheet to stop measuring in px, and is a bigger change than
     * this one.
     */
    private void disablePageZoom() {
        if (getBridge() == null) {
            Log.w(TAG, "no bridge yet; the stylesheet layer still applies");
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            Log.w(TAG, "no webview yet; the stylesheet layer still applies");
            return;
        }

        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);          // pinch, and double-tap
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // The one that was actually scaling this app. 100 means "render the
        // sizes the stylesheet asked for".
        settings.setTextZoom(100);
    }
}
