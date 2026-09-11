/**
 * The app's side of SMS capture.
 *
 * Deliberately small. Everything about reading a payment out of a message
 * already exists in `smsParse`, and everything about turning captured alerts
 * into proposals already exists in `notificationCapture` - SMS entries land in
 * the same native queue as notifications, so `drainProposals` picks them up
 * with no change at all. This file is only the three things that are new:
 * asking for the permission, the user's own switch, and the one-time sweep
 * back through the inbox.
 *
 * WHAT THIS CHANGES ABOUT THE APP, said plainly because it should be:
 *
 * MONEVA held five permissions and no READ_SMS, and that was a real position -
 * it read bank alerts through the notification shade instead. Reading the
 * inbox gives up that position in exchange for the months of history the
 * shade cannot reach, which is the single biggest reason a new user prefers a
 * rival. Distribution is from a website rather than Play, so Play's
 * restricted-permission review does not gate the choice; what it does mean is
 * that nothing external will check the obligation, so the code has to.
 *
 * It does, in three places, and none of them is this file:
 *
 *   - SmsSenderFilter rejects every numeric sender before a body is examined,
 *     which is essentially all private conversation.
 *   - Only messages that pass the same content gate as notifications are ever
 *     written to the queue.
 *   - Nothing uploads a message. The app uploads the parsed TRANSACTION, and
 *     only once the user has confirmed it in the Payment Inbox.
 *
 * And a proposal from SMS can never be written unattended: `Messages` is
 * listed in autoAdd's UNTRUSTED_CHANNELS, so it always asks.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

export interface SmsStatus {
  /** Android only; nothing to report on the web. */
  supported: boolean;
  /** Whether READ_SMS is actually held right now. */
  granted: boolean;
  /** The user's own switch. False by default, and independent of the grant. */
  capturing: boolean;
  /** Epoch ms of the oldest message a backfill has covered; 0 if never run. */
  backfilledTo: number;
}

export interface BackfillResult {
  /** How many messages were looked at. */
  scanned: number;
  /** How many were kept as possible payments. */
  kept: number;
  /** The pass hit its cap, so the inbox was not read to the end. */
  truncated: boolean;
}

interface SmsCapturePlugin {
  checkPermission(): Promise<{ granted: boolean; capturing: boolean; backfilledTo: number }>;
  requestPermission(): Promise<{ granted: boolean; permanentlyDenied?: boolean }>;
  setCapturing(options: { enabled: boolean }): Promise<{ capturing: boolean }>;
  backfill(options: { months: number }): Promise<BackfillResult>;
}

const plugin = registerPlugin<SmsCapturePlugin>('SmsCapture');

export const isSmsCaptureSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const OFF: SmsStatus = {
  supported: false,
  granted: false,
  capturing: false,
  backfilledTo: 0,
};

export const getSmsStatus = async (): Promise<SmsStatus> => {
  if (!isSmsCaptureSupported()) return OFF;
  try {
    const res = await plugin.checkPermission();
    return {
      supported: true,
      granted: !!res.granted,
      capturing: !!res.capturing,
      backfilledTo: res.backfilledTo ?? 0,
    };
  } catch {
    // A plugin that is not there is indistinguishable from one that failed,
    // and both mean the same thing to the screen: nothing to offer here.
    return OFF;
  }
};

/**
 * Ask for READ_SMS.
 *
 * `permanentlyDenied` matters to the caller: Android stops showing the dialog
 * after the second refusal, so a screen that keeps offering the same button
 * is offering something that can no longer happen. That case needs to send
 * the user to app settings instead.
 */
export const requestSmsPermission = async (): Promise<{
  granted: boolean;
  permanentlyDenied: boolean;
}> => {
  if (!isSmsCaptureSupported()) return { granted: false, permanentlyDenied: false };
  try {
    const res = await plugin.requestPermission();
    return { granted: !!res.granted, permanentlyDenied: !!res.permanentlyDenied };
  } catch {
    return { granted: false, permanentlyDenied: false };
  }
};

/**
 * The user's switch, which is not the permission.
 *
 * Turning this off stops capture immediately without sending anyone to a
 * settings screen, and the native side checks it before reading anything -
 * including in the broadcast receiver, which runs with the app closed.
 */
export const setSmsCapturing = async (enabled: boolean): Promise<boolean> => {
  if (!isSmsCaptureSupported()) return false;
  try {
    const res = await plugin.setCapturing({ enabled });
    return !!res.capturing;
  } catch {
    return false;
  }
};

/**
 * Read back through the inbox once.
 *
 * Returns counts and nothing else - the caller learns that 47 of 3,200
 * messages were kept, and nothing whatsoever about the 3,153 that were not.
 * The kept ones are in the same queue notifications use, so the Payment Inbox
 * shows them as ordinary proposals for the user to accept or reject.
 */
export const backfillFromSms = async (months = 12): Promise<BackfillResult | null> => {
  if (!isSmsCaptureSupported()) return null;
  try {
    return await plugin.backfill({ months });
  } catch {
    return null;
  }
};
