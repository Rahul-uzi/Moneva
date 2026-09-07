package com.moneva.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate: the bridge builds its plugin list
        // there, and anything added afterwards is not in it.
        registerPlugin(NotificationCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
