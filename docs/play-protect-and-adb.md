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

Google reviews apps distributed **outside** the Play Store and will clear a
false positive. Search the current Play Protect developer documentation for the
appeal form rather than following a link from here; the URL moves.

### Have these ready

| | |
|---|---|
| Package name | `com.moneva.app` |
| Version | 1.0.1 (versionCode 10001) |
| Download URL | the live site's `/downloads/moneva-1.0.1.apk` |
| SHA-256 | `03EB7EB09BF6AFFCE7279D46D4ED1317918C8DBC0F06D29F8AFD553FCECAA63F` |
| Source | https://github.com/Rahul-uzi/Moneva — public, which is unusual for an appeal and worth pointing at |

### Draft justification

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
> that behaviour in place — `aOneTimeCodeIsNeverKept` and
> `aOneTimeCodeWithAnAccountNumberIsNeverKept` — the second specifically
> covering an OTP that also carries an account number and an amount, which is
> the shape most likely to slip through a naive filter.
>
> **A message is only read if it looks machine-written.** An amount alone is
> not enough: the text must also carry a movement verb, a transaction
> reference, a masked account number or a running balance. Personal messages
> are left alone by construction — "₹500 to Karan" from a friend is refused,
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
> taken on trust.

### While you wait

The appeal does not block anything else. Publish the install guide (below) so
people can get past the warning in the meantime, and keep the fingerprint next
to the download so they can verify the file is genuinely yours.

---

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
adb install -r moneva-1.0.1.apk      # -r replaces an existing install
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
