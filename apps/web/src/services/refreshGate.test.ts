import { describe, it, expect } from 'vitest';
import { RefreshGate } from './refreshGate';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('RefreshGate', () => {
  it('starts idle', () => {
    const gate = new RefreshGate<string>();
    expect(gate.isRefreshing).toBe(false);
    expect(gate.waiting).toBe(0);
  });

  it('lowers the flag after a successful refresh', async () => {
    const gate = new RefreshGate<string>();
    await gate.run(async () => 'token-1');
    expect(gate.isRefreshing).toBe(false);
  });

  it('lowers the flag after a FAILED refresh', async () => {
    // The original bug in one line: a path that raised the flag and returned
    // without lowering it left every later 401 waiting on nothing.
    const gate = new RefreshGate<string>();
    await expect(gate.run(async () => { throw new Error('401'); })).rejects.toThrow('401');
    expect(gate.isRefreshing).toBe(false);
  });

  it('is usable again after a failure', async () => {
    const gate = new RefreshGate<string>();
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow();
    await expect(gate.run(async () => 'token-2')).resolves.toBe('token-2');
  });

  it('runs the refresh only once for concurrent callers', async () => {
    const gate = new RefreshGate<string>();
    let calls = 0;
    const refresh = async () => { calls += 1; await tick(); return 'shared'; };

    const results = await Promise.all([gate.run(refresh), gate.run(refresh), gate.run(refresh)]);
    expect(calls).toBe(1);
    expect(results).toEqual(['shared', 'shared', 'shared']);
    expect(gate.isRefreshing).toBe(false);
  });

  it('wakes every waiter when the refresh succeeds', async () => {
    const gate = new RefreshGate<string>();
    let release: (v: string) => void = () => {};
    const pending = gate.run(() => new Promise<string>((r) => { release = r; }));
    await tick();

    const waiters = [gate.wait(), gate.wait()];
    expect(gate.waiting).toBe(2);

    release('fresh');
    await expect(pending).resolves.toBe('fresh');
    await expect(Promise.all(waiters)).resolves.toEqual(['fresh', 'fresh']);
    expect(gate.waiting).toBe(0);
  });

  it('rejects every waiter when the refresh fails, instead of hanging them', async () => {
    // This is the exact failure mode: waiters that are never settled turn into
    // promises that never resolve, hanging whatever awaited them.
    const gate = new RefreshGate<string>();
    let fail: (e: unknown) => void = () => {};
    const pending = gate.run(() => new Promise<string>((_, rej) => { fail = rej; }));
    await tick();

    const waiter = gate.wait();
    fail(new Error('refresh rejected'));

    await expect(pending).rejects.toThrow('refresh rejected');
    await expect(waiter).rejects.toThrow('refresh rejected');
    expect(gate.isRefreshing).toBe(false);
    expect(gate.waiting).toBe(0);
  });

  it('refuses to park a caller when nothing is refreshing', async () => {
    // Parking with no one left to wake it is the hang; it must fail loudly.
    const gate = new RefreshGate<string>();
    await expect(gate.wait()).rejects.toThrow(/no refresh in progress/i);
  });

  it('does not leak waiters between refreshes', async () => {
    const gate = new RefreshGate<string>();
    let release: (v: string) => void = () => {};
    const first = gate.run(() => new Promise<string>((r) => { release = r; }));
    await tick();
    const waiter = gate.wait();
    release('one');
    await Promise.all([first, waiter]);

    expect(gate.waiting).toBe(0);
    await expect(gate.run(async () => 'two')).resolves.toBe('two');
    expect(gate.waiting).toBe(0);
  });

  it('survives many failed refreshes in a row', async () => {
    // The real-world sequence: several parallel requests all 401, the refresh
    // keeps failing, and the app must still be usable afterwards.
    const gate = new RefreshGate<string>();
    for (let i = 0; i < 5; i += 1) {
      await expect(gate.run(async () => { throw new Error(`fail ${i}`); })).rejects.toThrow();
      expect(gate.isRefreshing).toBe(false);
    }
    await expect(gate.run(async () => 'recovered')).resolves.toBe('recovered');
  });
});
