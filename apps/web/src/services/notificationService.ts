import { LocalNotifications, type Channel } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { NotificationRecord } from '../types/api';

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

export interface UserNotifPreferences {
  notif_bills: boolean;
  notif_budgets: boolean;
  notif_goals: boolean;
  notif_salary: boolean;
}

// Convert string UUID or dedup_key into a deterministic positive 32-bit integer ID for native notifications
function hashStringToId(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

class NativeNotificationService {
  private isNative: boolean = Capacitor.isNativePlatform();
  private channelsCreated = false;
  private deliveredIds: Set<number> = new Set();
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

  private async initChannels() {
    if (!this.isNative || this.channelsCreated) return;

    try {
      const channels: Channel[] = [
        {
          id: 'bills',
          name: 'Bills & Obligations',
          description: 'Reminders for upcoming and overdue bill payments',
          importance: 4, // High importance
          sound: 'notification.wav',
          vibration: true,
        },
        {
          id: 'budgets',
          name: 'Budget Alerts',
          description: 'Notifications when category spending reaches or exceeds limits',
          importance: 4,
          sound: 'notification.wav',
          vibration: true,
        },
        {
          id: 'goals',
          name: 'Goal Milestones',
          description: 'Milestone achievements for savings goals',
          importance: 3, // Default importance
          sound: 'notification.wav',
        },
        {
          id: 'salary',
          name: 'Salary Reminders',
          description: 'Reminders for expected payday income',
          importance: 4,
          sound: 'notification.wav',
          vibration: true,
        },
        {
          id: 'system',
          name: 'System Notifications',
          description: 'General application updates and security alerts',
          importance: 3,
        },
      ];

      for (const ch of channels) {
        await LocalNotifications.createChannel(ch);
      }
      this.channelsCreated = true;
    } catch {
      // Channel creation fallback
    }
  }

  private initListeners() {
    if (!this.isNative) return;

    try {
      void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const extra = action.notification.extra as { route?: string } | undefined;
        const route = extra?.route || '/plan';

        if (this.onDeepLinkCallback) {
          this.onDeepLinkCallback(route);
        } else {
          window.location.href = route;
        }
      });
    } catch {
      // Listener fallback
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
      const result = await LocalNotifications.requestPermissions();
      if (result.display === 'granted') return 'granted';
      if (result.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'denied';
    }
  }

  public async deliverNativeNotification(
    notif: NotificationRecord,
    prefs?: UserNotifPreferences
  ): Promise<boolean> {
    // 1. Preference Enforcement Check
    if (prefs) {
      if (notif.notification_type.startsWith('bill_') && !prefs.notif_bills) return false;
      if (notif.notification_type.startsWith('budget_') && !prefs.notif_budgets) return false;
      if (notif.notification_type === 'goal_milestone' && !prefs.notif_goals) return false;
      if (notif.notification_type === 'salary_reminder' && !prefs.notif_salary) return false;
    }

    // 2. Deterministic Deduplication Check
    const notifId = hashStringToId(notif.id);
    if (this.deliveredIds.has(notifId)) {
      return false; // Already delivered natively
    }

    // Determine channel & route
    let channelId = 'system';
    let route = '/plan';

    if (notif.notification_type.startsWith('bill_')) {
      channelId = 'bills';
      route = '/plan';
    } else if (notif.notification_type.startsWith('budget_')) {
      channelId = 'budgets';
      route = '/plan';
    } else if (notif.notification_type === 'goal_milestone') {
      channelId = 'goals';
      route = '/plan';
    } else if (notif.notification_type === 'salary_reminder') {
      channelId = 'salary';
      route = '/activity';
    }

    if (!this.isNative) {
      this.deliveredIds.add(notifId);
      return true;
    }

    try {
      const perm = await this.checkPermission();
      if (perm !== 'granted') return false;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: notif.title,
            body: notif.message,
            channelId,
            extra: { route, notifId: notif.id },
            smallIcon: 'ic_launcher',
          },
        ],
      });

      this.deliveredIds.add(notifId);
      return true;
    } catch {
      return false;
    }
  }

  public clearDeliveredHistory() {
    this.deliveredIds.clear();
  }
}

export const nativeNotificationService = new NativeNotificationService();
