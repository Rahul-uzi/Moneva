import { describe, expect, it, vi } from 'vitest';
import { ApiCache, cacheKey, scopeOfWrite, ttlFor, DEFAULT_TTL_MS } from './apiCache';

/** A clock the test moves by hand. */
const fakeClock = () => {
  let t = 0;
  const clock = () => t;
  clock.set = (v: number) => { t = v; };
  return clock;
};

describe('cacheKey', () => {
  it('is the url when there are no params', () => {
    expect(cacheKey('/accounts')).toBe('/accounts');
    expect(cacheKey('/accounts', {})).toBe('/accounts');
  });

  it('does not care what order the params were written in', () => {
    expect(cacheKey('/t', { b: 2, a: 1 })).toBe(cacheKey('/t', { a: 1, b: 2 }));
  });

  it('drops empty params, as a query serialiser would', () => {
    expect(cacheKey('/t', { a: 1, b: undefined, c: null })).toBe('/t?a=1');
  });

  it('keeps different values apart', () => {
    expect(cacheKey('/transactions', { limit: 5 })).not.toBe(cacheKey('/transactions', { limit: 50 }));
  });
});

describe('ttlFor', () => {
  it('holds reference data far longer than financial data', () => {
    expect(ttlFor('/categories')).toBeGreaterThan(ttlFor('/accounts'));
    expect(ttlFor('/accounts')).toBe(DEFAULT_TTL_MS);
  });

  it('refuses to hold anything that reports on "now"', () => {
    expect(ttlFor('/notifications/unread-count')).toBe(0);
    expect(ttlFor('/auth/me')).toBe(0);
  });
});

describe('ApiCache', () => {
  it('answers a repeat inside the window without asking again', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const fetcher = vi.fn().mockResolvedValue('one');

    expect(await (clock.set(0), cache.read('/a', 1000, fetcher))).toBe('one');
    expect(await (clock.set(500), cache.read('/a', 1000, fetcher))).toBe('one');

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('asks again once the window has passed', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const fetcher = vi.fn().mockResolvedValueOnce('one').mockResolvedValueOnce('two');

    expect(await (clock.set(0), cache.read('/a', 1000, fetcher))).toBe('one');
    expect(await (clock.set(5000), cache.read('/a', 1000, fetcher))).toBe('two');

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shares one request between callers that arrive together', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    let release: (v: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((r) => { release = r; }));

    const a = (clock.set(0), cache.read('/a', 1000, fetcher));
    const b = (clock.set(0), cache.read('/a', 1000, fetcher));
    release('shared');

    expect(await a).toBe('shared');
    expect(await b).toBe('shared');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never holds anything when the ttl is zero', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const fetcher = vi.fn().mockResolvedValue('live');

    await (clock.set(0), cache.read('/now', 0, fetcher));
    await (clock.set(1), cache.read('/now', 0, fetcher));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('forgets everything when cleared', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const fetcher = vi.fn().mockResolvedValue('one');

    await (clock.set(0), cache.read('/a', 1000, fetcher));
    cache.clear();
    await (clock.set(1), cache.read('/a', 1000, fetcher));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // The case that makes a write-through-clears-all cache safe: a read that was
  // already on the wire when the write landed describes the world before it,
  // so its answer must reach its caller but must not be kept.
  it('does not store a response that was in flight across a clear', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    let release: (v: string) => void = () => {};
    const slow = vi.fn(() => new Promise<string>((r) => { release = r; }));

    const pending = (clock.set(0), cache.read('/a', 10_000, slow));
    cache.clear();                    // a write landed
    release('from before the write');

    expect(await pending).toBe('from before the write');
    expect(cache.size).toBe(0);

    const after = vi.fn().mockResolvedValue('after the write');
    expect(await (clock.set(1), cache.read('/a', 10_000, after))).toBe('after the write');
  });

  it('does not keep a failure, and does not keep serving the stale value', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const ok = vi.fn().mockResolvedValue('one');
    await (clock.set(0), cache.read('/a', 1000, ok));

    const boom = vi.fn().mockRejectedValue(new Error('offline'));
    await expect((clock.set(5000), cache.read('/a', 1000, boom))).rejects.toThrow('offline');

    const again = vi.fn().mockResolvedValue('two');
    expect(await (clock.set(5001), cache.read('/a', 1000, again))).toBe('two');
  });

  it('invalidates a path and its parameterised variants together', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const f = vi.fn().mockResolvedValue('x');
    await (clock.set(0), cache.read('/transactions', 10_000, f));
    await (clock.set(0), cache.read('/transactions?limit=5', 10_000, f));
    await (clock.set(0), cache.read('/accounts', 10_000, f));

    cache.invalidate('/transactions');

    expect(cache.size).toBe(1);
  });

  it('keeps different keys apart', async () => {
    const clock = fakeClock();
    const cache = new ApiCache(clock);
    const f = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    expect(await (clock.set(0), cache.read('/a', 1000, f))).toBe('a');
    expect(await (clock.set(0), cache.read('/b', 1000, f))).toBe('b');
  });
});

describe('scopeOfWrite', () => {
  it('confines the launch-time notification write to the notification lists', () => {
    expect(scopeOfWrite('/notifications/generate')).toEqual(['/notifications']);
  });

  it('treats anything else as affecting everything', () => {
    expect(scopeOfWrite('/transactions')).toBeNull();
    expect(scopeOfWrite('/accounts/abc')).toBeNull();
    expect(scopeOfWrite('/bills/1/pay')).toBeNull();
  });
});
