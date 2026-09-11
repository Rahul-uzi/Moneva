import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AlertProposal } from '../utils/paymentAlert';
import { CONFIRMATIONS_TO_TRUST, trustKey } from '../utils/autoAdd';

// The suite runs on node, which has no storage, and this feature keeps its
// trust on the device. Same in-memory stand-in the apiCache wiring test uses.
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

/**
 * The one place in the app that writes a transaction with nobody watching.
 *
 * The pure rules are proven next door in autoAdd.test.ts. What is proven here
 * is the wiring around them: that a refusal really does mean no request was
 * sent, that a written row is marked so it can be found again, and - most
 * important - that a payment which fails to file is LEFT for a human rather
 * than quietly swallowed.
 */

const post = vi.fn();
const drainProposals = vi.fn();
const acknowledgeProposal = vi.fn();
const getCaptureStatus = vi.fn();

// The store scopes its keys to the signed-in user, so the mock has to answer
// that too - and switching this is how the shared-phone case is exercised.
let currentUser: { id: string } | null = { id: 'user-aaa' };
vi.mock('./apiClient', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a) },
  getCachedUser: () => currentUser,
}));
vi.mock('./notificationCapture', () => ({
  drainProposals: () => drainProposals(),
  acknowledgeProposal: (p: unknown) => acknowledgeProposal(p),
  getCaptureStatus: () => getCaptureStatus(),
}));

const { runAutoAdd } = await import('./autoAddRunner');
const {
  saveAutoAddSettings, saveTrustLedger, loadTrustLedger, originOf,
  AUTO_ADDED_DEVICE_ID, forgetAllTrust, revokeTrustForDeletedRow,
} = await import('./autoAddStore');

const NOW = Date.UTC(2026, 8, 9, 12, 0);

const proposal = (over: Partial<AlertProposal> = {}): AlertProposal => ({
  alertIds: ['alert-1'],
  kind: 'debit',
  amountPaise: 250_00,
  merchant: 'Swiggy',
  matchedBy: 'debited',
  sources: ['Google Pay'],
  postedAt: NOW,
  clientMutationId: 'mut-1',
  ...over,
});

const ONE_ACCOUNT = [{ id: 'acc-1', is_active: true }] as never;
const TWO_ACCOUNTS = [{ id: 'acc-1', is_active: true }, { id: 'acc-2', is_active: true }] as never;

/** Give the proposal's pattern a fully earned record. */
const trust = (p: AlertProposal) => {
  const k = trustKey(p) as string;
  saveTrustLedger({ [k]: { confirmations: CONFIRMATIONS_TO_TRUST, lastConfirmedAt: NOW } });
};

beforeEach(() => {
  localStorage.clear();
  currentUser = { id: 'user-aaa' };
  post.mockReset().mockResolvedValue({ data: { id: 'tx-1' } });
  drainProposals.mockReset().mockResolvedValue([proposal()]);
  acknowledgeProposal.mockReset().mockResolvedValue(undefined);
  getCaptureStatus.mockReset().mockResolvedValue({
    granted: true, capturing: true, lastKeptAt: NOW, keptCount: 1, enabledAt: 0,
  });
  saveAutoAddSettings({ enabled: true, ceilingMinor: 5_000_00 });
});

describe('before it writes anything', () => {
  it('sends no request at all while the switch is off', async () => {
    saveAutoAddSettings({ enabled: false, ceilingMinor: 5_000_00 });
    trust(proposal());
    const out = await runAutoAdd([], NOW);
    expect(out).toEqual({ added: 0, left: 0, skipped: 'switched off' });
    expect(post).not.toHaveBeenCalled();
    // It must not even look at the queue - reading it is what acknowledges junk.
    expect(drainProposals).not.toHaveBeenCalled();
  });

  it('sends no request when capture is not actually running', async () => {
    getCaptureStatus.mockResolvedValue({
      granted: false, capturing: true, lastKeptAt: 0, keptCount: 0, enabledAt: 0,
    });
    trust(proposal());
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.skipped).toBe('not capturing');
    expect(post).not.toHaveBeenCalled();
  });

  it('sends no request when it cannot tell which account is meant', async () => {
    trust(proposal());
    const out = await runAutoAdd(TWO_ACCOUNTS, NOW);
    expect(out.skipped).toBe('more than one account');
    expect(post).not.toHaveBeenCalled();
    expect(acknowledgeProposal).not.toHaveBeenCalled();
  });

  it('leaves an untrusted payment for the inbox', async () => {
    // No trust recorded at all.
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out).toEqual({ added: 0, left: 1 });
    expect(post).not.toHaveBeenCalled();
    // Crucially NOT acknowledged - acknowledging is what removes it from the
    // queue, and removing an unfiled payment would lose it entirely.
    expect(acknowledgeProposal).not.toHaveBeenCalled();
  });
});

describe('when it does write', () => {
  it('files the payment with the marker that makes it findable', async () => {
    const p = proposal();
    trust(p);
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);

    expect(out.added).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/transactions');
    expect(body).toMatchObject({
      client_mutation_id: 'mut-1',
      account_id: 'acc-1',
      to_account_id: null,
      transaction_type: 'expense',
      amount_minor: 250_00,
      // The provenance marker. Without it, "show me what was added without me"
      // has no query behind it.
      device_id: AUTO_ADDED_DEVICE_ID,
    });
  });

  it('leaves the category blank when nothing but a guess is available', async () => {
    // With a person present the suggestion is shown before it is applied. With
    // nobody present, the app's own opinion filed silently is how a budget
    // starts describing something that did not happen.
    trust(proposal());
    await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(post.mock.calls[0][1].category_id).toBeNull();
  });

  it('repeats a category the user already chose for that merchant', async () => {
    /* Not a guess - their own decision, applied again. It matters because
       budgets sum on a category, so a blank one is invisible to every budget
       and "left to spend" reads higher than it really is. */
    const categories = [{ id: 'cat-food', name: 'Food & Dining', type: 'expense' }] as never;
    const history = [
      { id: 't1', description: 'Swiggy', category_id: 'cat-food', transaction_type: 'expense' },
      { id: 't2', description: 'Swiggy', category_id: 'cat-food', transaction_type: 'expense' },
      { id: 't3', description: 'Swiggy', category_id: 'cat-food', transaction_type: 'expense' },
    ] as never;

    trust(proposal());
    await runAutoAdd(ONE_ACCOUNT, NOW, categories, history);
    expect(post.mock.calls[0][1].category_id).toBe('cat-food');
  });

  it('does not invent a category from the app rules alone', async () => {
    // A merchant the user has never filed themselves. The rule engine may well
    // have an opinion; with nobody watching, it is not applied.
    const categories = [{ id: 'cat-food', name: 'Food & Dining', type: 'expense' }] as never;
    const p = proposal({ merchant: 'ZOMATO' });
    drainProposals.mockResolvedValue([p]);
    trust(p);
    await runAutoAdd(ONE_ACCOUNT, NOW, categories, [] as never);
    expect(post.mock.calls[0][1].category_id).toBeNull();
  });

  it('files without a category rather than failing when categories cannot load', async () => {
    // The fetch is best-effort; an empty list must degrade to "no category",
    // never to a crash that loses the payment.
    trust(proposal());
    const out = await runAutoAdd(ONE_ACCOUNT, NOW, [] as never, [] as never);
    expect(out.added).toBe(1);
    expect(post.mock.calls[0][1].category_id).toBeNull();
  });

  it('files a credit as income, not as spending', async () => {
    const p = proposal({ kind: 'credit', matchedBy: 'credited', clientMutationId: 'mut-c' });
    drainProposals.mockResolvedValue([p]);
    trust(p);
    await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(post.mock.calls[0][1].transaction_type).toBe('income');
  });

  it('remembers which pattern filed it, so it can be undone', async () => {
    const p = proposal();
    trust(p);
    await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(originOf('mut-1')).toBe(trustKey(p));
  });

  it('forgets the payment only after the server has taken it', async () => {
    trust(proposal());
    await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(acknowledgeProposal).toHaveBeenCalledTimes(1);
    // Order matters: acknowledging first would lose the payment if the write
    // then failed.
    expect(post.mock.invocationCallOrder[0])
      .toBeLessThan(acknowledgeProposal.mock.invocationCallOrder[0]);
  });
});

describe('when the write fails', () => {
  it('leaves the payment in the queue for a human', async () => {
    // The behaviour this feature replaces is the safe place to land.
    post.mockRejectedValue(new Error('offline'));
    trust(proposal());
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);

    expect(out.added).toBe(0);
    expect(out.left).toBe(1);
    expect(acknowledgeProposal).not.toHaveBeenCalled();
  });

  it('does not let one failure stop the others', async () => {
    const a = proposal({ clientMutationId: 'a', alertIds: ['a'] });
    const b = proposal({ clientMutationId: 'b', alertIds: ['b'] });
    drainProposals.mockResolvedValue([a, b]);
    trust(a);
    post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: {} });

    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(1);
    expect(out.left).toBe(1);
  });
});

describe('the categorical refusals still hold through the wiring', () => {
  it('will not file a text message however trusted the pattern looks', async () => {
    const sms = proposal({ sources: ['Messages'] });
    drainProposals.mockResolvedValue([sms]);
    // Deliberately plant a record under every key it could conceivably use.
    saveTrustLedger({
      'debited|Messages|debit': { confirmations: 99, lastConfirmedAt: NOW },
      'debited|Google Pay|debit': { confirmations: 99, lastConfirmedAt: NOW },
    });
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('will not file a transfer', async () => {
    drainProposals.mockResolvedValue([proposal({ kind: 'transfer' })]);
    saveTrustLedger({ 'debited|Google Pay|transfer': { confirmations: 99, lastConfirmedAt: NOW } });
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('will not file above the ceiling', async () => {
    const big = proposal({ amountPaise: 50_000_00 });
    drainProposals.mockResolvedValue([big]);
    trust(big);
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('turning it off', () => {
  it('discards what was learned rather than pausing it', async () => {
    // Somebody switching this off after it got something wrong means "stop,
    // and do not pick up where you left off".
    const p = proposal();
    trust(p);
    expect(Object.keys(loadTrustLedger())).toHaveLength(1);

    forgetAllTrust();
    expect(loadTrustLedger()).toEqual({});
    expect(originOf('mut-1')).toBeNull();

    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });
});


describe('a phone that changes hands', () => {
  /**
   * Signing out clears the tokens and the cached user and nothing else. With
   * unscoped keys this feature would outlive the person who switched it on:
   * the next account to sign in on a family phone, or a resold one, would find
   * it already running, carrying trust it never earned, writing rows into a
   * ledger whose owner never consented.
   */
  it('does not carry the switch over to the next account', async () => {
    saveAutoAddSettings({ enabled: true, ceilingMinor: 5_000_00 });
    trust(proposal());
    expect((await runAutoAdd(ONE_ACCOUNT, NOW)).added).toBe(1);

    // Somebody else signs in on the same phone.
    post.mockClear();
    currentUser = { id: 'user-bbb' };

    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.skipped).toBe('switched off');
    expect(post).not.toHaveBeenCalled();
  });

  it('does not lend earned trust to the next account', async () => {
    // Even with the switch on for both, the patterns are not shared.
    saveAutoAddSettings({ enabled: true, ceilingMinor: 5_000_00 });
    trust(proposal());

    currentUser = { id: 'user-bbb' };
    saveAutoAddSettings({ enabled: true, ceilingMinor: 5_000_00 });
    expect(loadTrustLedger()).toEqual({});

    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('gives the first person their own state back when they return', async () => {
    saveAutoAddSettings({ enabled: true, ceilingMinor: 5_000_00 });
    trust(proposal());

    currentUser = { id: 'user-bbb' };
    expect(loadTrustLedger()).toEqual({});

    currentUser = { id: 'user-aaa' };
    expect(Object.keys(loadTrustLedger())).toHaveLength(1);
    expect((await runAutoAdd(ONE_ACCOUNT, NOW)).added).toBe(1);
  });
});


describe('undoing something that was filed for you', () => {
  /**
   * The strongest signal this feature can get, and the only one that arrives
   * AFTER a wrong row already exists: the user removed something it wrote.
   * A transaction carries no rule name, only the device_id marker, so the
   * pattern is recovered through the origins map - and if that lookup ever
   * stops working, a bad pattern keeps its trust and keeps writing.
   */
  const KEY = 'debited|Google Pay|debit';

  const autoRow = { client_mutation_id: 'mut-1', device_id: AUTO_ADDED_DEVICE_ID };
  const handRow = { client_mutation_id: 'mut-1', device_id: 'android-notification' };

  const armed = async () => {
    trust(proposal());
    await runAutoAdd(ONE_ACCOUNT, NOW);   // files it, and remembers the origin
  };

  it('stops trusting the pattern that wrote the deleted row', async () => {
    await armed();
    expect(loadTrustLedger()[KEY].revokedAt).toBeUndefined();

    expect(revokeTrustForDeletedRow(autoRow, NOW)).toBe(true);
    expect(loadTrustLedger()[KEY].revokedAt).toBe(NOW);
  });

  it('makes that pattern stop filing immediately', async () => {
    await armed();
    revokeTrustForDeletedRow(autoRow, NOW);

    post.mockClear();
    drainProposals.mockResolvedValue([proposal({ clientMutationId: 'mut-2', alertIds: ['a2'] })]);
    const out = await runAutoAdd(ONE_ACCOUNT, NOW);
    expect(out.added).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('leaves trust alone when the user deletes a row they entered themselves', async () => {
    // Deleting your own typo says nothing about a parser rule.
    await armed();
    expect(revokeTrustForDeletedRow(handRow, NOW)).toBe(false);
    expect(loadTrustLedger()[KEY].revokedAt).toBeUndefined();
  });

  it('does nothing for an auto-added row this device did not file', async () => {
    // A row filed on another phone. Nothing is known about which pattern wrote
    // it, and revoking a guessed one would punish an innocent pattern.
    await armed();
    const stranger = { client_mutation_id: 'never-seen', device_id: AUTO_ADDED_DEVICE_ID };
    expect(revokeTrustForDeletedRow(stranger, NOW)).toBe(false);
    expect(loadTrustLedger()[KEY].revokedAt).toBeUndefined();
  });

  it('survives a row with no mutation id at all', async () => {
    await armed();
    expect(revokeTrustForDeletedRow({ device_id: AUTO_ADDED_DEVICE_ID }, NOW)).toBe(false);
    expect(() => revokeTrustForDeletedRow({}, NOW)).not.toThrow();
  });

  it('does not reach across to another account holder', async () => {
    // The origins map is scoped like everything else here.
    await armed();
    currentUser = { id: 'user-bbb' };
    expect(revokeTrustForDeletedRow(autoRow, NOW)).toBe(false);

    currentUser = { id: 'user-aaa' };
    expect(revokeTrustForDeletedRow(autoRow, NOW)).toBe(true);
  });
});
