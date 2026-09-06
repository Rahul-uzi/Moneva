import { LocalNotifications, type Channel } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { NotificationRecord } from '../types/api';
import { stableId } from './reminderScheduler';

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

export interface UserNotifPreferences {
  notif_bills: boolean;
  notif_budgets: boolean;
  notif_goals: boolean;
  notif_salary: boolean;
}

const DELIVERED_KEY = 'moneva_delivered_notifs';
const ASKED_KEY = 'moneva_notif_permission_asked';
const DELIVERED_CAP = 500;

/**
 * Delivers server-generated notifications to the system tray.
 *
 * Two things here used to stop any notification ever appearing on a real
 * phone. The permission was never requested anywhere, so on Android 13+ it
 * stayed at "prompt" and delivery bailed out silently. And the channels named
 * a sound file that does not exist in the APK, so channel creation could fail
 * before a single notification was posted.
 */
class NativeNotificationService {
  private isNative: boolean = Capacitor.isNativePlatform();
  private channelsCreated = false;
  private deliveredIds: Set<number> = this.loadDelivered();
  private onDeepLinkCallback: ((route: string) => void) | null = null;

  constructor() {
    if (this.isNative) {
      void this.initChannels();
      this.initListeners();
    }
  }

  public setDeepLinkHandler(handler: (route: string) => void) {
    this.onDeepLinkCallback = handler;
  }

  /**
   * Delivered ids used to live only in memory, so every cold start re-posted
   * every unread notification the user had already seen.
   */
  private loadDelivered(): Set<number> {
    try {
      const raw = localStorage.getItem(DELIVERED_KEY);
      const arr = raw ? (JSON.parse(raw) as number[]) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  private saveDelivered() {
    try {
      const arr = Array.from(this.deliveredIds).slice(-DELIVERED_CAP);
      localStorage.setItem(DELIVERED_KEY, JSON.stringify(arr));
    } catch {
      /* storage unavailable - memory dedup still applies for this run */
    }
  }

  private async initChannels() {
    if (!this.isNative || this.channelsCreated) return;

    try {
      // No custom sound: the file the old config named was never shipped, and
      // the system default is what people expect from a reminder anyway.
      const channels: Channel[] = [
        { id: 'bills', name: 'Bills & Obligations', description: 'Upcoming and overdue bill reminders', importance: 4, vibration: true },
        { id: 'budgets', name: 'Budget Alerts', description: 'When a category reaches or passes its limit', importance: 4, vibration: true },
        { id: 'goals', name: 'Goal Milestones', description: 'Progress on savings goals', importance: 3 },
        { id: 'salary', name: 'Salary Reminders', description: 'Payday prompts for expected income', importance: 4, vibration: true },
        { id: 'system', name: 'System', description: 'Application updates and security alerts', importance: 3 },
      ];
      for (const ch of channels) {
        await LocalNotifications.createChannel(ch);
      }
      this.channelsCreated = true;
    } catch {
      // Channel creation is best-effort; the plugin falls back to a default channel.
    }
  }

  private initListeners() {
    if (!this.isNative) return;
    try {
      void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const extra = action.notification.extra as { route?: string } | undefined;
        const route = extra?.route || '/plan';
        if (this.onDeepLinkCallback) this.onDeepLinkCallback(route);
        else window.location.href = route;
      });
    } catch {
      // Listener registration is best-effort.
    }
  }

  public async checkPermission(): Promise<PermissionStatus> {
    if (!this.isNative) return 'granted';
    try {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') return 'granted';
      if (status.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'granted';
    }
  }

  public async requestPermission(): Promise<PermissionStatus> {
    if (!this.isNative) return 'granted';
    try {
      localStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* fine */
    }
    try {
      const result = await LocalNotifications.requestPermissions();
      if (result.display === 'granted') return 'granted';
      if (result.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'denied';
    }
  }

  /**
   * Asks once, the first time the app runs signed-in. After that the answer
   * stands: a user who said no is not nagged, and can enable it in Profile.
   */
  public async ensurePermission(): Promise<PermissionStatus> {
    const current = await this.checkPermission();
    if (current !== 'prompt') return current;
    let asked = false;
    try {
      asked = localStorage.getItem(ASKED_KEY) === '1';
    } catch {
      /* treat as not asked */
    }
    if (asked) return current;
    return this.requestPermission();
  }

  public async deliverNativeNotification(
    notif: NotificationRecord,
    prefs?: UserNotifPreferences,
  ): Promise<boolean> {
    if (prefs) {
      if (notif.notification_type.startsWith('bill_') && !prefs.notif_bills) return false;
      if (notif.notification_type.startsWith('budget_') && !prefs.notif_budgets) return false;
      if (notif.notification_type === 'goal_milestone' && !prefs.notif_goals) return false;
      if (notif.notification_type === 'salary_reminder' && !prefs.notif_salary) return false;
    }

    const notifId = stableId(notif.id);
    if (this.deliveredIds.has(notifId)) return false;

    let channelId = 'system';
    let route = '/plan';
    if (notif.notification_type.startsWith('bill_')) {
      channelId = 'bills';
    } else if (notif.notification_type.startsWith('budget_')) {
      channelId = 'budgets';
    } else if (notif.notification_type === 'goal_milestone') {
      channelId = 'goals';
    } else if (notif.notification_type === 'salary_reminder') {
      channelId = 'salary';
      route = '/';
    }

    if (!this.isNative) {
      this.deliveredIds.add(notifId);
      this.saveDelivered();
      return true;
    }

    try {
      if ((await this.checkPermission()) !== 'granted') return false;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: notif.title,
            body: notif.message,
            channelId,
            extra: { route, notifId: notif.id, source: 'moneva-server' },
            // A dedicated monochrome glyph: the launcher icon renders as a
            // white square in the status bar.
            smallIcon: 'ic_stat_moneva',
            iconColor: '#CDFF4A',
          },
        ],
      });
      this.deliveredIds.add(notifId);
      this.saveDelivered();
      return true;
    } catch {
      return false;
    }
  }

  public clearDeliveredHistory() {
    this.deliveredIds.clear();
    this.saveDelivered();
  }
}

export const nativeNotificationService = new NativeNotificationService();
