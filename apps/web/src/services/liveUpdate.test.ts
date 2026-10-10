// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * When a downloaded update takes over. The rule: never while someone could be
 * in the middle of something - only on a start from closed, or on coming back
 * after 10 minutes or more away.
 */

const updater = {
  notifyAppReady: vi.fn(() => Promise.resolve()),
  list: vi.fn(),
  download: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  next: vi.fn(),
  setMultiDelay: vi.fn(),
};
let stateListener: ((s: { isActive: boolean }) => void) | null = null;

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capgo/capacitor-updater', () => ({ CapacitorUpdater: updater }));
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: () => Promise.resolve({ build: '10008' }),
    addListener: (_: string, fn: (s: { isActive: boolean }) => void) => { stateListener = fn; return Promise.resolve({ remove: () => {} }); },
  },
}));
vi.mock('./updateCheck', () => ({ currentVersionName: () => '1.0.9' }));
const fetchManifest = vi.fn();
vi.mock('../utils/liveUpdateManifest', () => ({
  fetchManifest: () => fetchManifest(),
  shouldDownload: () => true,
}));

const live = await import('./liveUpdate');

beforeEach(() => {
  localStorage.clear();
  stateListener = null;
  updater.list.mockResolvedValue({ bundles: [] });
  updater.download.mockResolvedValue({ id: 'b10', version: '1.0.10', status: 'pending' });
  fetchManifest.mockResolvedValue({
    version: '1.0.10', url: 'https://moneva.monev.workers.dev/updates/moneva-web-1.0.10.zip',
    sha256: 'a'.repeat(64), min_native_code: 10008, notes: 'Safer timing',
  });
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe('downloading', () => {
  it('fetches the bundle and remembers it, but changes nothing yet', async () => {
    await live.checkForLiveUpdate({ force: true });
    expect(updater.download).toHaveBeenCalledWith(expect.objectContaining({ version: '1.0.10', checksum: 'a'.repeat(64) }));
    expect(live.hasPendingUpdate()).toBe(true);
    // The plugin is never told: it must not reload the app on its own schedule.
    expect(updater.next).not.toHaveBeenCalled();
    expect(updater.setMultiDelay).not.toHaveBeenCalled();
    expect(updater.set).not.toHaveBeenCalled();
  });

  it('does not download the same bundle twice', async () => {
    await live.checkForLiveUpdate({ force: true });
    updater.list.mockResolvedValue({ bundles: [{ id: 'b10', version: '1.0.10', status: 'pending' }] });
    await live.checkForLiveUpdate({ force: true });
    expect(updater.download).toHaveBeenCalledTimes(1);
  });
});

describe('how often it looks', () => {
  it('always looks when the app starts from closed', async () => {
    await live.checkForLiveUpdate({ force: true });
    fetchManifest.mockClear();
    live.startLiveUpdates();
    await vi.waitFor(() => expect(fetchManifest).toHaveBeenCalledTimes(1));
  });

  it('looks again on a return only after 30 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await live.checkForLiveUpdate({ force: true });
    const f = fetchManifest;
    f.mockClear();
    await live.checkForLiveUpdate();
    expect(f).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1);
    await live.checkForLiveUpdate();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('switching over', () => {
  const waiting = async () => {
    await live.checkForLiveUpdate({ force: true });
    updater.list.mockResolvedValue({ bundles: [{ id: 'b10', version: '1.0.10', status: 'pending' }] });
  };

  it('switches at start-up, before anything is drawn', async () => {
    await waiting();
    await live.applyPendingUpdate();
    expect(updater.set).toHaveBeenCalledWith({ id: 'b10' });
  });

  // The bug this replaced: two seconds in the bank app reloaded MONEVA.
  it('never switches after a short trip to another app', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await waiting();
    live.startLiveUpdates();
    stateListener!({ isActive: false });
    vi.setSystemTime(Date.now() + 2_000);
    stateListener!({ isActive: true });
    await Promise.resolve();
    expect(updater.set).not.toHaveBeenCalled();
  });

  it('switches on coming back after ten minutes away', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await waiting();
    live.startLiveUpdates();
    stateListener!({ isActive: false });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    stateListener!({ isActive: true });
    await vi.waitFor(() => expect(updater.set).toHaveBeenCalledWith({ id: 'b10' }));
  });

  it('forgets a waiting bundle the updater no longer has', async () => {
    await live.checkForLiveUpdate({ force: true });
    updater.list.mockResolvedValue({ bundles: [] });
    expect(await live.applyPendingUpdate()).toBe(false);
    expect(live.hasPendingUpdate()).toBe(false);
    expect(updater.set).not.toHaveBeenCalled();
  });

  it('ignores a waiting bundle that is not newer than what runs', () => {
    localStorage.setItem('moneva_live_pending', JSON.stringify({ id: 'old', version: '1.0.9' }));
    expect(live.hasPendingUpdate()).toBe(false);
  });
});
