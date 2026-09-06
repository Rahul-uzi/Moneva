/**
 * Serialises token refresh across concurrent requests.
 *
 * When several requests 401 at once, only the first should refresh; the rest
 * wait and retry with the new token. That needs a "refresh in progress" flag,
 * and the flag is the dangerous part: it was a bare module-level boolean set
 * before an early `return`, so one path skipped the `finally` that cleared it.
 * Once stuck on, every later 401 queued behind a refresh that would never run
 * and got back a promise that never settled - which hung session restore and
 * left the login screen permanently disabled.
 *
 * Here the flag can only be raised inside `run`, whose `finally` always lowers
 * it, so no future early return can strand it again.
 */
export class RefreshGate<T> {
  private inFlight = false;
  private waiters: Array<{ resolve: (value: T) => void; reject: (err: unknown) => void }> = [];

  /** True while a refresh is actually running. */
  get isRefreshing(): boolean {
    return this.inFlight;
  }

  /** Number of callers parked behind the current refresh. Test/diagnostic aid. */
  get waiting(): number {
    return this.waiters.length;
  }

  /**
   * Waits for the refresh already under way.
   *
   * Rejects immediately when nothing is running, because parking a caller with
   * no one left to wake it is exactly the hang this class exists to prevent.
   */
  wait(): Promise<T> {
    if (!this.inFlight) {
      return Promise.reject(new Error('No refresh in progress to wait for.'));
    }
    return new Promise<T>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  /**
   * Runs `fn` as the one refresh, waking every waiter with its outcome.
   *
   * Concurrent callers get the in-flight result rather than starting a second
   * refresh.
   */
  async run(fn: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.wait();

    this.inFlight = true;
    try {
      const value = await fn();
      this.release(null, value);
      return value;
    } catch (err) {
      this.release(err, undefined);
      throw err;
    } finally {
      // The one place the flag is lowered, and it cannot be skipped.
      this.inFlight = false;
    }
  }

  private release(error: unknown, value?: T) {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((w) => (error ? w.reject(error) : w.resolve(value as T)));
  }
}
