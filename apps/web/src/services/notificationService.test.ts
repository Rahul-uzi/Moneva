// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Tap = (action: { notification: { extra?: unknown } }) => void;
const listeners: Record<string, Tap> = {};

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
const schedule = vi.fn<(options: unknown) => Promise<void>>(() => Promise.resolve());
let permission = 'granted';
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: (name: string, fn: Tap) => { listeners[name] = fn; return Promise.resolve({ remove: () => {} }); },
    createChannel: () => Promise.resolve(),
    schedule: (o: unknown) => schedule(o),
    checkPermissions: () => Promise.resolve({ display: permission }),
  },
}));
vi.mock('./appUpdate', () => ({ UPDATE_ROUTE: '/profile?update=1' }));
const markReadFromTray = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
vi.mock('./notificationRead', () => ({ markReadFromTray: (id: string) => markReadFromTray(id) }));

let service: typeof import('./notificationService').nativeNotificationService;
beforeAll(async () => { ({ nativeNotificationService: service } = await import('./notificationService')); });
afterEach(() => { vi.clearAllMocks(); service.setDeepLinkHandler(null); });

const tap = (extra: unknown) => listeners.localNotificationActionPerformed({ notification: { extra } });

describe('tapping a MONEVA notification in the tray', () => {
  it('marks a server notification read', () => {
    service.setDeepLinkHandler(() => {});
    tap({ route: '/plan', notifId: 'srv-1', source: 'moneva-server' });
    expect(markReadFromTray).toHaveBeenCalledWith('srv-1');
  });

  // Reminders planned on the phone have no row on the server to mark.
  it('leaves reminders planned on the phone alone', () => {
    service.setDeepLinkHandler(() => {});
    tap({ route: '/plan', source: 'moneva-reminder', key: 'bill:b1:due:' });
    expect(markReadFromTray).not.toHaveBeenCalled();
  });

  it('opens its page inside the app', () => {
    const open = vi.fn();
    service.setDeepLinkHandler(open);
    tap({ route: '/accounts', notifId: 'srv-2', source: 'moneva-server' });
    expect(open).toHaveBeenCalledWith('/accounts');
  });

  it('goes to Plan when the notification names no page', () => {
    const open = vi.fn();
    service.setDeepLinkHandler(open);
    tap(undefined);
    expect(open).toHaveBeenCalledWith('/plan');
    expect(markReadFromTray).not.toHaveBeenCalled();
  });
});

describe('the "new version" notification', () => {
  const V16 = { version_code: 10016, version_name: '1.0.16', notes: 'Fixes.' };
  afterEach(() => { localStorage.clear(); permission = 'granted'; });

  it('says which version is out and opens the in-app updater', async () => {
    expect(await service.postUpdateNotice(V16)).toBe(true);
    const sent = (schedule.mock.calls[0][0] as { notifications: { title: string; body: string; extra: unknown }[] }).notifications[0];
    expect(sent.title).toBe('MONEVA 1.0.16 is out');
    expect(sent.body).toBe('Fixes.');
    expect(sent.extra).toEqual({ route: '/profile?update=1', source: 'moneva-update' });
  });

  // Repeated on every launch, it is the notification people switch off.
  it('is posted once per version', async () => {
    await service.postUpdateNotice(V16);
    expect(await service.postUpdateNotice(V16)).toBe(false);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(await service.postUpdateNotice({ ...V16, version_code: 10017, version_name: '1.0.17' })).toBe(true);
  });

  it('is not posted without notification permission, and is tried again later', async () => {
    permission = 'denied';
    expect(await service.postUpdateNotice(V16)).toBe(false);
    permission = 'granted';
    expect(await service.postUpdateNotice(V16)).toBe(true);
  });

  it('opens the updater when tapped, and marks nothing read', () => {
    const open = vi.fn();
    service.setDeepLinkHandler(open);
    tap({ route: '/profile?update=1', source: 'moneva-update' });
    expect(open).toHaveBeenCalledWith('/profile?update=1');
    expect(markReadFromTray).not.toHaveBeenCalled();
  });
});
