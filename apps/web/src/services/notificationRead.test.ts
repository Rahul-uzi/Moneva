// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
vi.mock('./apiClient', () => ({ apiClient: { patch: (...a: unknown[]) => patch(...a) } }));

import { flushPendingReads, markReadFromTray, NOTIFICATIONS_CHANGED } from './notificationRead';

const pending = () => JSON.parse(localStorage.getItem('moneva_pending_notif_reads') || '[]') as string[];

beforeEach(() => { localStorage.clear(); patch.mockResolvedValue({ data: {} }); });
afterEach(() => { vi.clearAllMocks(); });

describe('marking a notification read from the tray', () => {
  it('tells the server, and has nothing left to send', async () => {
    await markReadFromTray('n-1');
    expect(patch).toHaveBeenCalledWith('/notifications/n-1/read');
    expect(pending()).toEqual([]);
  });

  it('lets the bell recount once the server has it', async () => {
    const recount = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED, recount);
    await markReadFromTray('n-1');
    window.removeEventListener(NOTIFICATIONS_CHANGED, recount);
    expect(recount).toHaveBeenCalledTimes(1);
  });

  // A tap often starts the app from cold, or arrives with no signal.
  it('keeps it when the request fails, and sends it on the next try', async () => {
    patch.mockRejectedValueOnce(new Error('offline'));
    await markReadFromTray('n-1');
    expect(pending()).toEqual(['n-1']);

    await flushPendingReads();
    expect(patch).toHaveBeenLastCalledWith('/notifications/n-1/read');
    expect(pending()).toEqual([]);
  });

  it('gives up on one the server no longer has', async () => {
    patch.mockRejectedValueOnce({ response: { status: 404 } });
    await markReadFromTray('gone');
    expect(pending()).toEqual([]);
  });

  it('is written down before the request goes out', async () => {
    let seen: string[] = [];
    patch.mockImplementationOnce(() => { seen = pending(); return Promise.resolve({ data: {} }); });
    await markReadFromTray('n-1');
    expect(seen).toEqual(['n-1']);
  });

  it('does not lose a second tap made while the first is being sent', async () => {
    let release: () => void = () => {};
    patch.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: {} }); }));
    const first = markReadFromTray('n-1');
    void markReadFromTray('n-2');
    release();
    await first;
    expect(pending()).toEqual(['n-2']);
    await flushPendingReads();
    expect(pending()).toEqual([]);
  });

  it('does nothing when nothing is waiting', async () => {
    await flushPendingReads();
    expect(patch).not.toHaveBeenCalled();
  });
});
