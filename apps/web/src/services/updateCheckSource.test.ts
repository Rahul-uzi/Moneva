// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Where the Update button learns about a new APK. Since 1.0.12 it is the
 * signed manifest on the website, so a release needs nothing set on Render;
 * Render stays only as the fallback when the website cannot be read.
 */

const get = vi.fn();
const fetchManifest = vi.fn();
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('./apiClient', () => ({ apiClient: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('../utils/liveUpdateManifest', () => ({ fetchManifest: () => fetchManifest() }));

const { checkForUpdate } = await import('./updateCheck');

const APK = {
  version_code: 99999, version_name: '9.99.99',
  url: 'https://moneva.monev.workers.dev/downloads/moneva-9.99.99.apk', notes: 'From the website', mandatory: false,
};

beforeEach(() => {
  get.mockResolvedValue({ data: { version_code: 99998, version_name: '9.99.98', download_url: 'https://x/render.apk', notes: 'From Render', mandatory: false } });
});
afterEach(() => vi.clearAllMocks());

describe('checkForUpdate', () => {
  it('takes the APK from the signed manifest and never asks Render', async () => {
    fetchManifest.mockResolvedValue({ version: '1.0.11', apk: APK });
    const news = await checkForUpdate();
    expect(news?.latest).toMatchObject({ version_code: 99999, download_url: APK.url, notes: 'From the website' });
    expect(get).not.toHaveBeenCalled();
  });

  it('falls back to Render when the website cannot be read', async () => {
    fetchManifest.mockResolvedValue(null);
    const news = await checkForUpdate();
    expect(news?.latest.notes).toBe('From Render');
  });

  it('falls back to Render when the manifest carries no APK yet', async () => {
    fetchManifest.mockResolvedValue({ version: '1.0.11' });
    expect((await checkForUpdate())?.latest.notes).toBe('From Render');
  });
});
