// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * The first thirty seconds.
 *
 * Registration creates a user and nothing else, so this screen is the only
 * thing standing between a new account and six correct, empty screens. What it
 * has to get right is the ORDER: a transaction needs an account to belong to,
 * so offering the import first produces a file that parses perfectly and has
 * nowhere to go.
 */

const get = vi.fn();

/**
 * Only the GET is replaced.
 *
 * Swapping the whole module out took `getStoredTokens` with it, and the auth
 * store calls that at import time to decide whether anyone is signed in - so
 * the suite failed before a single test ran. Keeping the real module and
 * overriding one method is both smaller and closer to what actually runs.
 */
vi.mock('../../services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/apiClient')>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: (...args: unknown[]) => get(...args) },
  };
});

import { FirstRunSetup } from './FirstRunSetup';

const account = (id: string, name: string) => ({
  id,
  name,
  account_type: 'asset',
  currency: 'INR',
  is_active: true,
});

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  cleanup();
});

const importButton = () => screen.getByRole('button', { name: /^import$/i });

describe('a brand-new account, with nothing in it', () => {
  beforeEach(() => {
    get.mockResolvedValue({ data: [] });
  });

  it('asks for an account first', async () => {
    render(<FirstRunSetup onFinish={() => {}} />);
    expect(await screen.findByText(/add an account/i)).toBeTruthy();
  });

  it('will not let the import run yet', async () => {
    /**
     * The order is not cosmetic. Imported rows have to belong to an account,
     * and without one the sheet can only parse the file and then refuse it -
     * so the offer is withheld rather than made and taken back.
     */
    render(<FirstRunSetup onFinish={() => {}} />);
    await waitFor(() => expect(importButton()).toBeTruthy());
    expect((importButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('names the banks it can actually read, so the offer is checkable', async () => {
    render(<FirstRunSetup onFinish={() => {}} />);
    expect(await screen.findByText(/HDFC, ICICI, SBI and Axis/i)).toBeTruthy();
  });

  it('lets someone leave without doing either', async () => {
    const onFinish = vi.fn();
    render(<FirstRunSetup onFinish={onFinish} />);
    (await screen.findByText(/skip/i)).click();
    expect(onFinish).toHaveBeenCalled();
  });
});

describe('once there is somewhere for transactions to go', () => {
  beforeEach(() => {
    get.mockResolvedValue({ data: [account('a1', 'HDFC Savings')] });
  });

  it('opens the import up', async () => {
    render(<FirstRunSetup onFinish={() => {}} />);
    await waitFor(() => expect((importButton() as HTMLButtonElement).disabled).toBe(false));
  });

  it('counts the accounts it actually found', async () => {
    // Says "1 account", not "1 accounts". Plural agreement is the kind of
    // detail that decides whether a first-run screen reads as finished.
    render(<FirstRunSetup onFinish={() => {}} />);
    expect(await screen.findByText(/1 account ready/i)).toBeTruthy();
  });

  it('agrees in the plural too', async () => {
    get.mockResolvedValue({ data: [account('a1', 'HDFC'), account('a2', 'Cash')] });
    render(<FirstRunSetup onFinish={() => {}} />);
    expect(await screen.findByText(/2 accounts ready/i)).toBeTruthy();
  });
});

describe('when the server cannot be reached', () => {
  it('still lets the person past', async () => {
    /**
     * A failed accounts fetch is not a reason to trap someone on the first
     * screen they ever see. Setup degrades to "not done yet" and the button
     * out still works - the cold start on a free-tier backend can take the
     * best part of a minute, and this screen is what is on top of it.
     */
    get.mockRejectedValue(new Error('offline'));
    const onFinish = vi.fn();
    render(<FirstRunSetup onFinish={onFinish} />);

    const later = await screen.findByRole('button', { name: /i will do this later/i });
    later.click();
    expect(onFinish).toHaveBeenCalled();
  });
});
