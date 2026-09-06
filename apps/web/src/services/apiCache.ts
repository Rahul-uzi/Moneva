/**
 * A small read cache in front of the API's GETs.
 *
 * Measured on the device: six ordinary tab switches produced 33 requests, with
 * `/accounts` fetched five times and `/categories` - a reference list that
 * barely ever changes - four times. Every screen fetches on mount and nothing
 * remembered what had just been asked for a second earlier, so moving between
 * tabs paid full network latency each time.
 *
 * Two mechanisms, in order:
 *
 *   1. **In-flight sharing.** Identical GETs issued while one is already on the
 *      wire get that same promise instead of a second request. Always correct:
 *      it returns the response the first caller was going to get anyway.
 *   2. **A short freshness window.** A GET repeated inside its TTL is answered
 *      from memory. This is the part that makes going back to a screen instant.
 *
 * What keeps the second one honest is that ANY write through the client clears
 * the whole cache, so a stale read can only ever come from a change made
 * somewhere else - another device, or the server on its own - and the TTL
 * bounds even that. Correctness first: when in doubt this drops the entry.
 */

/** How long an ordinary financial read stays fresh. */
export const DEFAULT_TTL_MS = 20_000;

/**
 * Paths that deserve something other than the default.
 * First match wins, so put the specific ones first.
 */
const TTL_RULES: Array<{ test: RegExp; ttl: number }> = [
  // Reference data. Editing a category is a write, which clears everything
  // anyway, so this can be held for much longer than the financial reads.
  { test: /^\/categories\b/, ttl: 10 * 60_000 },
  // Anything that reports on "now" is not worth holding: by the time it is
  // read again the answer is meant to have changed.
  { test: /^\/notifications\/unread-count\b/, ttl: 0 },
  { test: /^\/auth\/me\b/, ttl: 0 },
];

export const ttlFor = (url: string): number => {
  for (const rule of TTL_RULES) {
    if (rule.test.test(url)) return rule.ttl;
  }
  return DEFAULT_TTL_MS;
};

/**
 * The identity of a request.
 *
 * Params are sorted, so `?a=1&b=2` and `?b=2&a=1` are one entry rather than
 * two. `undefined` values are dropped the way a query serialiser drops them.
 */
export const cacheKey = (url: string, params?: Record<string, unknown>): string => {
  if (!params) return url;
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (pairs.length === 0) return url;
  return `${url}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`;
};

/**
 * Writes that are known not to disturb the financial reads.
 *
 * The default for a write is to empty the whole cache, because working out
 * which reads each write affects is a table that drifts out of step with the
 * API and the cost of being wrong is showing someone a stale balance. This is
 * the deliberate exception: a write that runs on every launch, and would
 * otherwise throw away the dashboard's data the moment after it arrived.
 *
 * Add to this only for a write whose effect is genuinely confined to the paths
 * listed beside it.
 */
const NARROW_WRITES: Array<{ test: RegExp; invalidates: string[] }> = [
  // Materialises reminder rows that have come due. It cannot move money, so
  // nothing but the notification lists needs re-reading.
  { test: /\/notifications\/generate\b/, invalidates: ['/notifications'] },
];

/** The paths a write invalidates, or null to mean "everything". */
export const scopeOfWrite = (url: string): string[] | null => {
  for (const rule of NARROW_WRITES) {
    if (rule.test.test(url)) return rule.invalidates;
  }
  return null;
};

interface Entry {
  at: number;
  /** The generation this was fetched under; see `clear`. */
  gen: number;
  value: unknown;
}

export class ApiCache {
  /**
   * One clock for both reading and writing an entry's age.
   *
   * It was a `now` argument on `read` alone, with the write using `Date.now()`
   * directly - so under a fake clock an entry was stored in the real present
   * and read against a fake one, and nothing ever looked expired. Injecting
   * the whole clock is what makes the freshness window testable at all.
   */
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private entries = new Map<string, Entry>();
  private inFlight = new Map<string, Promise<unknown>>();
  /**
   * Bumped by every clear. A request that was already on the wire when a write
   * landed carries the old generation, so its result is handed to the caller
   * who asked for it but never stored - it describes the world before the
   * write.
   */
  private gen = 0;

  /** Diagnostic. */
  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
    this.gen += 1;
  }

  /** Drops one entry and any others whose key starts with the same path. */
  invalidate(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === prefix || key.startsWith(`${prefix}?`)) this.entries.delete(key);
    }
  }

  /**
   * `fetcher` runs only if the answer is not already known or on its way.
   */
  read<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    if (ttl > 0) {
      const hit = this.entries.get(key);
      if (hit && this.now() - hit.at < ttl) {
        return Promise.resolve(hit.value as T);
      }
      // Expired: take it out now so a failing refetch cannot leave a stale
      // entry sitting there looking fresh enough to serve later.
      if (hit) this.entries.delete(key);

      const pending = this.inFlight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const generation = this.gen;
    const run = fetcher()
      .then((value) => {
        // Only store it if nothing was written in the meantime, and only if
        // this key is still worth holding.
        if (ttl > 0 && generation === this.gen) {
          this.entries.set(key, { at: this.now(), gen: generation, value });
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === run) this.inFlight.delete(key);
      });

    if (ttl > 0) this.inFlight.set(key, run as Promise<unknown>);
    return run;
  }
}

export const apiCache = new ApiCache();
