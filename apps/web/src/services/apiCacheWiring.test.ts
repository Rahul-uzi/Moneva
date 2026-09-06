import { describe, it, expect, beforeEach, vi } from 'vitest';

// These exercise the real client, which reads stored tokens on every request.
// The suite runs on node, which has no storage; an empty one is all that is
// needed - the point here is the caching, not the auth header.
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
};
vi.stubGlobal('localStorage', memoryStorage());
import axios from 'axios';
import type { AxiosAdapter } from 'axios';
import { apiClient } from './apiClient';
import { apiCache } from './apiCache';

/**
 * The class in apiCache.test.ts is tested on its own. These check the part that
 * actually ships: that `apiClient.get` really is routed through it, and - the
 * property the whole design rests on - that a write empties it. If the second
 * one ever stops holding, the app shows people stale balances after they add a
 * transaction, which is worse than the duplicate requests this replaced.
 */

/** Answers every request, and counts what it was asked. */
const stubTransport = () => {
  const seen: string[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push(`${(config.method ?? 'get').toUpperCase()} ${config.url}`);
    return {
      data: [{ id: seen.length }],
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  return { seen, adapter };
};

describe('apiClient GET caching', () => {
  beforeEach(() => {
    apiCache.clear();
    vi.restoreAllMocks();
  });

  it('asks the network once for a repeated read', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/accounts');
    await apiClient.get('/accounts');

    expect(seen.filter((s) => s === 'GET /accounts')).toHaveLength(1);
  });

  it('treats different params as different reads', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/transactions', { params: { limit: 5 } });
    await apiClient.get('/transactions', { params: { limit: 50 } });

    expect(seen.filter((s) => s.startsWith('GET /transactions'))).toHaveLength(2);
  });

  it('does not cache what reports on "now"', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/notifications/unread-count');
    await apiClient.get('/notifications/unread-count');

    expect(seen.filter((s) => s.includes('unread-count'))).toHaveLength(2);
  });

  // The safety property.
  it('goes back to the network after any write', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/accounts');
    await apiClient.post('/transactions', { amount_minor: 100 });
    await apiClient.get('/accounts');

    expect(seen.filter((s) => s === 'GET /accounts')).toHaveLength(2);
  });

  // This write runs 1500ms after every launch. If it emptied the cache it
  // would throw away the dashboard's data at the one moment it is worth most.
  it('lets the launch-time notification write keep the financial reads', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/accounts');
    await apiClient.post('/notifications/generate');
    await apiClient.get('/accounts');

    expect(seen.filter((s) => s === 'GET /accounts')).toHaveLength(1);
  });

  it('but that write does re-read the notifications it just created', async () => {
    const { seen, adapter } = stubTransport();
    apiClient.defaults.adapter = adapter;

    await apiClient.get('/notifications');
    await apiClient.post('/notifications/generate');
    await apiClient.get('/notifications');

    expect(seen.filter((s) => s === 'GET /notifications')).toHaveLength(2);
  });

  it('hands each caller its own array, so one screen cannot reorder another', async () => {
    const adapter: AxiosAdapter = async (config) => ({
      data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      status: 200, statusText: 'OK', headers: {}, config,
    });
    apiClient.defaults.adapter = adapter;

    const first = await apiClient.get<Array<{ id: number }>>('/accounts');
    first.data.reverse();
    const second = await apiClient.get<Array<{ id: number }>>('/accounts');

    expect(second.data.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe('session refresh', () => {
  // The bug the server log exposed: the auth store called the unguarded
  // `refreshSession` while restoring a session, at the same moment the request
  // interceptor renewed the same token through the gate. Two `POST
  // /auth/refresh` a millisecond apart, on every launch with an expired token.
  it('renews once when several callers ask at the same moment', async () => {
    const tokens = {
      access_token: 'a',
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 900,
    };
    localStorage.setItem('moneva_auth_tokens', JSON.stringify(tokens));

    let calls = 0;
    const post = vi.spyOn(axios, 'post').mockImplementation(async () => {
      calls += 1;
      // Resolve on a later turn, so the second caller really does arrive while
      // the first is still in flight - which is the whole point.
      await new Promise((r) => setTimeout(r, 10));
      return { data: tokens } as never;
    });

    const { refreshSessionShared } = await import('./apiClient');
    await Promise.all([refreshSessionShared(), refreshSessionShared(), refreshSessionShared()]);

    expect(calls).toBe(1);
    post.mockRestore();
  });
});
