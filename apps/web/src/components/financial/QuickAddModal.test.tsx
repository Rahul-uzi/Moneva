// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickAddModal } from './QuickAddModal';

/**
 * The redesigned add sheet: fewer things on screen, nothing taken away.
 *
 * These pin the behaviours that moved rather than the markup - that the
 * category still follows the payee, that a choice the user made is never
 * overwritten by a guess, and that what gets saved is exactly what the old
 * form saved.
 */

const get = vi.fn();
const post = vi.fn();
vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
  },
}));

const ACCOUNTS = [
  { id: 'acc-hdfc', name: 'HDFC', account_type: 'asset', is_active: true },
  { id: 'acc-old', name: 'Closed one', account_type: 'asset', is_active: false },
];
const CATEGORIES = [
  { id: 'cat-other', name: 'Other', type: 'expense', is_default: true },
  { id: 'cat-food', name: 'Food & Dining', type: 'expense', is_default: true },
  { id: 'cat-travel', name: 'Transport', type: 'expense', is_default: true },
  { id: 'cat-salary', name: 'Salary', type: 'income', is_default: true },
];

beforeEach(() => {
  get.mockImplementation((url: string) => {
    if (url === '/accounts') return Promise.resolve({ data: ACCOUNTS });
    if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
    if (url === '/transactions') return Promise.resolve({ data: [] });
    if (url === '/income/recurring') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  post.mockResolvedValue({
    // Shaped like the real response: the receipt that follows a save reads
    // the date and type, and a mock without them fails for its own reasons.
    data: {
      id: 'tx-1',
      category_id: 'cat-food',
      account_id: 'acc-hdfc',
      amount_minor: 45000,
      transaction_type: 'expense',
      description: 'Swiggy - dinner',
      transaction_date: '2026-10-09T15:10:00Z',
      currency: 'INR',
    },
  });
});

afterEach(() => {
  cleanup();
  get.mockReset();
  post.mockReset();
});

const openSheet = async () => {
  render(
    <MemoryRouter>
      <QuickAddModal isOpen onClose={() => {}} onSuccess={() => {}} />
    </MemoryRouter>,
  );
  // Options load after a tick; the account pill naming HDFC means they landed.
  await screen.findByText('HDFC');
};

const typeAmount = (value: string) =>
  fireEvent.change(screen.getByLabelText('Amount spent'), { target: { value } });

const typePayee = (value: string) =>
  fireEvent.change(screen.getByLabelText('Paid to'), { target: { value } });

describe('the add sheet', () => {
  it('leads with the amount and who, and folds the rest', async () => {
    await openSheet();
    expect(screen.getByLabelText('Amount spent')).toBeTruthy();
    expect(screen.getByLabelText('Paid to')).toBeTruthy();
    // Account, date and note are pills, closed until asked for.
    for (const pill of screen.getAllByRole('button', { expanded: false })) {
      expect(pill.getAttribute('aria-expanded')).toBe('false');
    }
    expect(screen.getByText('Now')).toBeTruthy();
  });

  it('never offers a closed account', async () => {
    await openSheet();
    fireEvent.click(screen.getByText('HDFC'));
    expect(screen.queryByText('Closed one')).toBeNull();
  });

  it('picks the category from the payee and says why', async () => {
    await openSheet();
    typePayee('Swiggy');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Food & Dining/ }).getAttribute('aria-checked')).toBe('true'),
    );
    expect(screen.getByText(/Picked for you/)).toBeTruthy();
  });

  // The rule the whole auto-pick rests on: a guess may fill an empty choice,
  // never replace one the user made.
  it('never overrides a category the user chose', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: /Transport/ }));
    typePayee('Swiggy');
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByRole('radio', { name: /Transport/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText(/Picked for you/)).toBeNull();
  });

  // Seen on screen: "Gop" matched Gopal's history and the sheet announced
  // "you filed Gop under Food before". Gop might be Gopika.
  it('does not guess from half a name, and does from a chosen one', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/accounts') return Promise.resolve({ data: ACCOUNTS });
      if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
      if (url === '/transactions') {
        return Promise.resolve({ data: [{
          description: 'Gopal', category_id: 'cat-travel',
          transaction_type: 'expense', transaction_date: '2026-10-09T09:00:00Z',
        }] });
      }
      return Promise.resolve({ data: [] });
    });
    await openSheet();
    const field = screen.getByLabelText('Paid to');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Gop' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByText(/Picked for you/)).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: /Gopal/ }));
    expect(await screen.findByText(/Picked for you/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Transport/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('saves exactly what the old form saved', async () => {
    await openSheet();
    typeAmount('450');
    typePayee('Swiggy');
    fireEvent.click(screen.getByRole('button', { name: /^Note/ }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'dinner' } });

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Food & Dining/ }).getAttribute('aria-checked')).toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Save expense/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/transactions');
    expect(body).toMatchObject({
      account_id: 'acc-hdfc',
      category_id: 'cat-food',
      transaction_type: 'expense',
      amount_minor: 45000,
      description: 'Swiggy - dinner',
      to_account_id: null,
    });
  });

  it('shows the amount on the save button once there is one', async () => {
    await openSheet();
    expect(screen.getByRole('button', { name: 'Save expense' })).toBeTruthy();
    typeAmount('450');
    expect(screen.getByRole('button', { name: /Save expense · ₹/ })).toBeTruthy();
  });

  it('refuses to save nothing, and says so', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: /Save expense/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/amount/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('swaps the shortcuts with the type, and keeps all three', async () => {
    await openSheet();
    expect(screen.getByText(/Took cash from an ATM/)).toBeTruthy();
    expect(screen.queryByText('Salary received')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Income' }));
    expect(screen.getByText('Salary received')).toBeTruthy();
    expect(screen.getByText('Salary schedule')).toBeTruthy();
    expect(screen.queryByText(/Took cash from an ATM/)).toBeNull();
  });

  it('shows only the categories of the chosen type', async () => {
    await openSheet();
    expect(screen.queryByRole('radio', { name: /^Salary/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Income' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Salary/ })).toBeTruthy());
    expect(screen.queryByRole('radio', { name: /Food & Dining/ })).toBeNull();
  });

  // Seen on the phone: while the request was in flight the sheet offered to
  // "Add an account" to someone with two, which would have made a duplicate.
  it('never offers to create an account or category while still loading', async () => {
    let release: (v: unknown) => void = () => {};
    get.mockImplementation((url: string) => {
      if (url === '/accounts') return new Promise((r) => { release = r; });
      if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
      return Promise.resolve({ data: [] });
    });
    render(
      <MemoryRouter>
        <QuickAddModal isOpen onClose={() => {}} onSuccess={() => {}} />
      </MemoryRouter>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(screen.queryByText('Add an account')).toBeNull();
    expect(screen.queryByText('Add a category')).toBeNull();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Save expense/ }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => { release({ data: ACCOUNTS }); });
    expect(await screen.findByText('HDFC')).toBeTruthy();
  });

  it('says it could not load, and offers to try again', async () => {
    let attempt = 0;
    get.mockImplementation((url: string) => {
      if (url === '/accounts') {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ data: ACCOUNTS });
      }
      if (url === '/categories') return Promise.resolve({ data: CATEGORIES });
      return Promise.resolve({ data: [] });
    });
    render(
      <MemoryRouter>
        <QuickAddModal isOpen onClose={() => {}} onSuccess={() => {}} />
      </MemoryRouter>,
    );
    const retry = await screen.findByRole('button', { name: 'Try again' });
    // Failed is not empty: still no offer to create what may already exist.
    expect(screen.queryByText('Add an account')).toBeNull();

    fireEvent.click(retry);
    expect(await screen.findByText('HDFC')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('opens one detail at a time', async () => {
    await openSheet();
    const when = screen.getByRole('button', { name: /^Now/ });
    fireEvent.click(when);
    expect(when.getAttribute('aria-expanded')).toBe('true');

    const note = screen.getByRole('button', { name: /^Note/ });
    fireEvent.click(note);
    expect(note.getAttribute('aria-expanded')).toBe('true');
    expect(when.getAttribute('aria-expanded')).toBe('false');
  });
});
