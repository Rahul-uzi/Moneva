# Shrinking and obfuscation rules for the release build.
#
# minifyEnabled was false, so the release APK carried every unused library
# class and every original name. Turning it on shrinks the download and stops
# the app's own class and method names being readable in a decompiler - which
# matters more than usual for an APK handed out from a website, because that is
# exactly the kind people pull apart.
#
# The danger with R8 and Capacitor is that the failure is not a build error.
# The bridge finds plugins BY NAME at runtime, through reflection, so a plugin
# class that R8 renamed or removed still compiles, still installs, and then
# fails on the device with "plugin not implemented" the first time a screen
# needs it. Every keep rule below exists to prevent one of those.

# ---------------------------------------------------------------- Capacitor
# The bridge resolves plugins by their @CapacitorPlugin name and calls methods
# annotated @PluginMethod reflectively. Renaming either breaks the lookup.
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.PluginMethod <methods>;
}
-keep public class * extends com.getcapacitor.Plugin
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
}
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }

# Cordova plugins bridged through Capacitor, resolved the same way.
-keep class org.apache.cordova.** { *; }

# ------------------------------------------------------------ MONEVA native
# TxNotificationListener and SmsReceiver are instantiated BY ANDROID from the
# manifest, not by our code - so nothing in the app references them and R8
# would otherwise conclude they are dead. If it removes them, capture simply
# never happens: no crash, no log, just an app that silently stops noticing
# payments. That is the worst failure mode in this codebase.
-keep class com.moneva.app.** { *; }

# --------------------------------------------------------------- WebView JS
# Anything reachable from JavaScript must keep its name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --------------------------------------------------------------------- misc
# Keep annotations and signatures so reflection and generics still resolve.
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Line numbers in a stack trace, with the file name hidden.
#
# Worth the small size cost: crash records are the only crash reporting this
# app has - there is no service, and no Play vitals for a website-distributed
# build - so a stack trace with no line numbers would leave a report that says
# something broke and nothing about where.
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
