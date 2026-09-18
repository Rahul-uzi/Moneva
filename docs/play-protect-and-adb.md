# Getting MONEVA installed

Two things, for two audiences.

**The appeal** is the one that matters: it asks Google to clear the app, which
removes the warning for everyone and changes nothing about what MONEVA does.
Start it now — it takes days to weeks and costs nothing.

**adb** is the immediate route for you and anyone technical, and it is how both
development phones were installed. It bypasses Play Protect entirely, which is
why this problem was invisible until the first real download.

---

## What is actually happening

Google blocks sideloaded apps that request `READ_SMS` / `RECEIVE_SMS` in
several countries, **India among them**. The dialog reads:

> **App blocked to protect your device**
> This app can request access to sensitive data. This can increase the risk of
> identity theft or financial fraud.

There is no "Install anyway" in that flow, and the dialog shows a generic
Android icon rather than the app's own, because the block happens before the
package is parsed for display.

Nothing is wrong with the build, the signature or the hosting. The permissions
are declared, and while they are, the warning appears. They cannot be hidden
and requested later — Android will not grant a runtime permission that is not
in the manifest.

---

## 1. Appeal to Google

**The form:** https://support.google.com/googleplay/android-developer/contact/protectappeals

Reached from Google's own developer guidance at
https://developers.google.com/android/play-protect/warning-dev-guidance,
which says plainly that apps already ON Google Play use the separate
"removed from Google Play" appeal, and that this form handles Play Protect
classification appeals **regardless of how the app is distributed**. Sideloaded
apps belong here.

### Before you open the form: upload to VirusTotal

The form does not take the APK. It takes **the SHA-256 of an APK that has been
uploaded to VirusTotal**, so that has to happen first.

1. Go to https://www.virustotal.com and upload `moneva-1.0.2.apk`
2. Let the scan finish and keep the page
3. The hash VirusTotal reports must match the file you are shipping:

   `ce57ab4ec99e1d5cdfa2b616fe86da2a030aaf9be4192cfa149410b729b530df`

   If it does not, you uploaded a different build than the one on the site.

A clean VirusTotal result is itself part of the argument, so link it in the
free-text field.

### The five fields

| Field | What to put |
|---|---|
| Email address | one you will keep — but see the warning below |
| Developer name | as it appears on the site and in the keystore: MONEVA |
| Application package name | `com.moneva.app` |
| SHA-256 hash | the VirusTotal one above |
| Additional information | the justification below |

### Expect no reply

The form states outright: **"All appeal decisions are final and you will not
receive a response."** Google also says it will not advise on how to comply in
future.

So there is no ticket to chase and no outcome to wait for. The only way to
learn whether it worked is to try installing from the site again after some
days and see whether the warning still appears. Do not submit repeatedly
hoping for an answer; there is nobody at the other end of it.

### One thing worth knowing before you spend the effort

The warning you got -

> This app can request access to sensitive data. This can increase the risk of
> identity theft or financial fraud.

- does **not** appear in Google's published Play Protect warning strings at
https://developers.google.com/android/play-protect/warning-strings. I checked.
Nothing in that table matches it, and the SMS-related entry there is about
billing fraud with entirely different wording.

That suggests this is not a malware classification at all but a blanket,
permission-based block on sideloaded apps requesting SMS access in certain
countries, India among them. If so, an appeal may not move it, because there is
no misclassification to correct - the block is doing exactly what it was built
to do.

It costs an hour to find out, and the alternative costs a feature, so it is
still worth filing. But file it with that expectation rather than treating it
as the plan.

### The justification

Every claim below is checkable against the repository. Do not soften them into
vaguer language; the specifics are what make the appeal answerable.

> MONEVA is a personal budgeting app for a single user. It reads the
> transaction alerts a person's own bank sends them, so that spending does not
> have to be typed in by hand. It is not a lender, it offers no credit, and it
> has no relationship with anyone but the person using it.
>
> **It explicitly discards one-time passwords.** OTP interception is what the
> SMS restriction exists to prevent, so the filter refuses them before anything
> is stored: `PaymentNotificationFilter.NEVER_A_PAYMENT` matches `otp`,
> `one-time password`, `verification code` and `do not share`, and a message
> matching any of them is dropped whatever else it contains. Two tests hold
> that behaviour in place - `aOneTimeCodeIsNeverKept` and
> `aOneTimeCodeWithAnAccountNumberIsNeverKept` - the second specifically
> covering an OTP that also carries an account number and an amount, which is
> the shape most likely to slip through a naive filter.
>
> **A message is only read if it looks machine-written.** An amount alone is
> not enough: the text must also carry a movement verb, a transaction
> reference, a masked account number or a running balance. Personal messages
> are left alone by construction - "₹500 to Karan" from a friend is refused,
> and there is a test asserting exactly that.
>
> **The app requests no other sensitive permission.** No contacts, no call log,
> no camera, no location, no storage, no microphone. The full list is fourteen
> permissions, of which the SMS pair are the only sensitive ones.
>
> **There is no advertising or analytics SDK of any kind.** No Firebase, no
> AdMob, no third-party tracker. Captured text goes only to the user's own
> account on the app's own backend, and is disclosed in the in-app privacy
> policy.
>
> **The source is public**, so every claim here can be checked rather than
> taken on trust: https://github.com/Rahul-uzi/Moneva
>
> A VirusTotal scan of the exact file being distributed is clean: <link>

### While you wait

The appeal blocks nothing else. Publish the install guide so people can get
past the warning meanwhile, and keep the fingerprint next to the download so
they can verify the file is genuinely yours.

## 2. Installing with adb

For you, for testers, and for anyone comfortable with a terminal. **This
bypasses Play Protect** — no warning, no dialog.

### On the phone, once

Settings → About phone → tap **Build number** seven times → back to Settings →
**Developer options** → enable **USB debugging**.

Connect by USB. The phone shows *"Allow USB debugging?"* — accept it. Until
that is accepted, `adb devices` reports the phone as `unauthorized` and
nothing else works.

### On the computer

Install Android platform-tools, then:

```bash
adb devices                          # confirm the phone is listed as "device"
adb install -r moneva-1.0.2.apk      # -r replaces an existing install
```

`Success` is the whole output on a good run.

### When it refuses

| Message | Cause |
|---|---|
| `unauthorized` | the prompt on the phone has not been accepted |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | an existing install was signed with a different key — uninstall first, which also erases its data |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | the installed versionCode is higher than this APK's |
| `no devices/emulators found` | USB debugging is off, or the cable is charge-only |

### Afterwards

Turn USB debugging back off. It is a development setting, and leaving it on
means anyone with physical access and a cable can read and write the device.

---

## What neither of these fixes

Even once Google clears the app, a sideloaded APK still shows the ordinary
**"install from unknown sources"** prompt the first time. That one is not a
warning about MONEVA — it appears for every app installed outside the Play
Store — and it does not go away short of publishing there.

---

## 3. Play-ready packaging: the App Bundle

Google Play has not accepted plain APKs for new apps since August 2021. It
takes an **Android App Bundle** (`.aab`), from which Play generates and signs a
tailored APK per device — smaller downloads, because a phone is not sent the
resources of three screen densities it does not have.

```bash
cd apps/web/android
./gradlew bundleRelease
# -> app/build/outputs/bundle/release/app-release.aab
```

The same `signingConfig` applies, so it comes out signed with the release
keystore. Verified:

```
jarsigner -verify app-release.aab
  Signed by "CN=MONEVA, OU=Development, O=MONEVA, L=Ludhiana, ST=Punjab, C=IN"
  jar verified.
```

### An .aab cannot be installed

This is the part that surprises people. `adb install` will not take one, and
neither will a phone — it is an upload format, not an install format. The APK
stays the thing people download from the site; the bundle exists only for Play.

To test what Play *would* generate, use Google's `bundletool`:

```bash
bundletool build-apks --bundle=app-release.aab --output=moneva.apks \
  --ks=moneva-release.jks --ks-key-alias=<alias>
bundletool install-apks --apks=moneva.apks
```

### If you do go to Play

The bundle is ready, but the SMS permissions are the obstacle there too, and a
harder one than Play Protect: Play's policy restricts `READ_SMS` to apps whose
**core function** requires it, with a declaration form and review. A budgeting
app that reads transaction alerts is a plausible case and not a certain one.

Worth knowing before that effort: Play publication would also **replace the
in-app updater**, since Play handles updates itself — so the update button, the
`/app/version` endpoint and `APK_DOWNLOAD_URL` all become redundant for anyone
who installed from the store, while still being needed for anyone who installed
from the site. Two update paths for one app is a real maintenance cost.

### Sizes, for reference

| Artifact | Size | Purpose |
|---|---|---|
| `app-release.apk` | 2.78 MB | what the site serves, what people install |
| `app-release.aab` | 3.75 MB | Play upload only; Play splits it per device |

The bundle is larger because it carries every density and architecture
together. What a phone actually downloads from Play would be smaller than the
APK, not bigger.

### Verified with bundletool

The bundle was not just built, it was put through Google's own `bundletool`
(1.18.3) to confirm Play could actually split it - because "it built and it is
signed" and "Play can use it" are different claims, and the second is the one
that matters.

```bash
java -jar bundletool.jar build-apks --bundle=app-release.aab \
  --output=moneva.apks --ks=<keystore> --ks-key-alias=<alias>
```

**83 split APKs.** Every split carries the real release certificate -
`CN=MONEVA, OU=Development, O=MONEVA, L=Ludhiana` - checked with `apksigner`,
the same certificate as the APK the site serves.

A note that cost half an hour: **`jarsigner` reports the release APK as "jar is
unsigned", and that is correct and fine.** jarsigner reads v1 (JAR) signatures
only, and `build.gradle` sets `enableV1Signing false` deliberately, because v1
is needed below API 24 and this app requires 24. Use `apksigner` for an APK; it
reads v2/v3/v4. An AAB genuinely is jar-signed, so that one goes to jarsigner.
The release script had this backwards at first and would have failed every
release for a reason that was not real.

### What the bundle costs here: 25% MORE, measured on a real phone

Corrected. An earlier figure here claimed a 14% saving, taken from
`base-master.apk` in a universal build. That was the wrong split: a bundle
contains **two** master variants for different SDK levels, and a modern phone
gets the larger one.

Asked with `--connected-device`, which queries the phone rather than guessing:

```bash
bundletool build-apks --bundle=app-release.aab --connected-device ...
```

| What the Samsung A33 receives | |
|---|---|
| `base-master_2.apk` | 3,432 KB |
| `base-xxhdpi.apk` | 81 KB |
| `base-en.apk` | 40 KB |
| **total** | **3.47 MB** |
| the single APK the site serves | **2.78 MB** |

So on this device the split delivery is **larger**, not smaller. Play applies
further compression on its own servers, so what a user actually downloads is
not exactly this number - but nothing here supports the claim that a bundle
makes MONEVA smaller.

The reason is the same one that made the earlier estimate wrong to begin with:
most of MONEVA's weight is the compiled web bundle in `assets/`, identical on
every device and impossible to split. Bundles pay off for native libraries per
architecture and large per-density image sets. MONEVA has neither.

**The bundle is worth having ready for Play. It is not a size argument.**

### Proven on the device

Not just built - installed:

```bash
bundletool install-apks --apks=device.apks
```

The phone then reports:

```
splits=[base, config.en, config.xxhdpi]
```

Which is the point. The app is no longer a single APK on that device; it is
the split set Play delivers, and it launches clean with no missing-split
error. That is the difference between "the bundle builds" and "Play could
actually ship this".

