/**
 * The app's side of the notification listener.
 *
 * Talks to the native plugin, turns what it hands back into proposals, and
 * keeps the native queue tidy. Everything it knows about reading a payment
 * comes from `paymentAlert`; everything it knows about Android comes from the
 * plugin. This file is the seam between them and holds no rules of its own.
 *
 * Nothing here writes a transaction. A proposal is an offer, and the user taps
 * to accept it - see PaymentInbox. That line matters: the parser is good, but
 * it has never been run against a real Indian inbox, and a wrong figure
 * written silently into someone's ledger is worse than no figure at all.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  proposalsFromAlerts,
  unreadableAlertIds,
  type AlertProposal,
  type PaymentAlert,
} from '../utils/paymentAlert';

export interface CaptureStatus {
  /** The OS has granted notification access. Only the user can change this. */
  granted: boolean;
  /** The app's own switch. Off by default, even once access is granted. */
  capturing: boolean;
}

interface NotificationCapturePlugin {
  checkPermission(): Promise<CaptureStatus>;
  openSettings(): Promise<void>;
  setCapturing(options: { enabled: boolean }): Promise<CaptureStatus>;
  getCaptured(): Promise<{ items: PaymentAlert[] }>;
  acknowledge(options: { ids: string[] }): Promise<void>;
  setExtraPackages(options: { packages: string[] }): Promise<void>;
  addListener(
    event: 'paymentNotification',
    handler: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const plugin = registerPlugin<NotificationCapturePlugin>('NotificationCapture');

/** There is no notification shade in a browser. */
export const isCaptureSupported = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const OFF: CaptureStatus = { granted: false, capturing: false };

export const getCaptureStatus = async (): Promise<CaptureStatus> => {
  if (!isCaptureSupported()) return OFF;
  try {
    return await plugin.checkPermission();
  } catch {
    return OFF;
  }
};

/**
 * Sends the user to the system screen that grants notification access.
 *
 * There is no dialog for this one - it is not a runtime permission, so it
 * cannot be requested from inside the app. The most any app can do is open
 * the right settings page and explain what to look for.
 */
export const openNotificationAccessSettings = async (): Promise<void> => {
  if (!isCaptureSupported()) return;
  try {
    await plugin.openSettings();
  } catch {
    /* the settings screen is missing on some builds - the UI says so */
  }
};

/** The app's own switch. Turning it off also empties the native queue. */
export const setCapturing = async (enabled: boolean): Promise<CaptureStatus> => {
  if (!isCaptureSupported()) return OFF;
  try {
    return await plugin.setCapturing({ enabled });
  } catch {
    return OFF;
  }
};

/**
 * Everything waiting to be reviewed.
 *
 * Alerts that read as nothing - an OTP, an offer, a balance reply - are
 * acknowledged here rather than shown. They are not the user's problem, and
 * leaving them in the queue would mean the app holds the text of somebody's
 * messages for no reason at all.
 */
export const drainProposals = async (): Promise<AlertProposal[]> => {
  if (!isCaptureSupported()) return [];

  let items: PaymentAlert[];
  try {
    const result = await plugin.getCaptured();
    items = result.items ?? [];
  } catch {
    return [];
  }

  const junk = unreadableAlertIds(items);
  if (junk.length > 0) {
    try {
      await plugin.acknowledge({ ids: junk });
    } catch {
      /* it stays queued and is dropped again next time - harmless */
    }
  }

  return proposalsFromAlerts(items);
};

/**
 * Forget a proposal, whether it became a transaction or was waved away.
 *
 * Takes every alert the proposal was merged from, so a payment that produced
 * three notifications is gone for good rather than returning as two.
 */
export const acknowledgeProposal = async (proposal: AlertProposal): Promise<void> => {
  if (!isCaptureSupported() || proposal.alertIds.length === 0) return;
  try {
    await plugin.acknowledge({ ids: proposal.alertIds });
  } catch {
    /* worst case it is offered again; confirming twice is idempotent */
  }
};

/** Banking apps the built-in list does not know about. */
export const setExtraPackages = async (packages: string[]): Promise<void> => {
  if (!isCaptureSupported()) return;
  try {
    await plugin.setExtraPackages({ packages });
  } catch {
    /* the built-in list still applies */
  }
};

/**
 * Calls back while the app is open and an alert arrives.
 *
 * Only a nudge to re-read the queue - the queue itself is the source of
 * truth, because most alerts arrive with the app closed and are never
 * announced to anyone.
 */
export const onPaymentNotification = async (
  handler: () => void,
): Promise<() => void> => {
  if (!isCaptureSupported()) return () => {};
  try {
    const subscription = await plugin.addListener('paymentNotification', handler);
    return () => {
      void subscription.remove();
    };
  } catch {
    return () => {};
  }
};
