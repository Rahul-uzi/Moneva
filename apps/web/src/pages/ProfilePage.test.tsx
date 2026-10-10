// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from './ProfilePage';
import { useAuthStore } from '../stores/useAuthStore';
import type { Category, User } from '../types/api';

/**
 * The Profile page as a grouped list: every setting is a row, and every row
 * opens what it changes.
 */

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    delete: vi.fn(),
  },
  describeApiError: (_e: unknown, fallback: string) => fallback,
  setStoredTokens: vi.fn(),
}));
vi.mock('../services/biometricService', () => ({
  getBiometricStatus: () => Promise.resolve({ available: true, label: 'fingerprint', reason: null }),
  isBiometricLockEnabled: () => Promise.resolve(true),
  setBiometricLockEnabled: vi.fn(() => Promise.resolve()),
  promptBiometric: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('../services/notificationCapture', () => ({
  getCaptureStatus: () => Promise.resolve({
    granted: true, capturing: true, lastKeptAt: Date.now(), keptCount: 5, enabledAt: 1,
    connected: true, connectedAt: 1, batteryExempt: true, manufacturer: 'google',
  }),
  isCaptureSupported: () => true,
  reconnectListener: vi.fn(),
  requestBatteryExemption: vi.fn(),
}));
vi.mock('../services/notificationService', () => ({
  nativeNotificationService: {
    checkPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
  },
}));
vi.mock('../services/notificationSync', () => ({ runNotificationSync: vi.fn() }));
vi.mock('../services/updateCheck', () => ({ currentVersionName: () => '1.0.7' }));
vi.mock('../components/settings/UpdateRow', () => ({ UpdateRow: () => <div>Version row</div> }));
vi.mock('../components/settings/SmsCaptureSection', () => ({ SmsCaptureSection: () => null }));
vi.mock('../components/financial/PaymentInbox', () => ({ PaymentInbox: () => <div>Payment inbox</div> }));
vi.mock('../components/financial/ImportSheet', () => ({ ImportSheet: () => <div>Import sheet</div> }));
vi.mock('../components/settings/LegalSheet', () => ({ LegalSheet: () => <div>Legal sheet</div> }));

const USER: User = {
  id: 'u', email: 'person@example.com', display_name: 'Asha Rao', currency: 'INR', timezone: 'Asia/Kolkata',
  is_active: true, email_verified: false, avatar_data_url: null, totp_enabled: false, created_at: '', updated_at: '',
};
const CATS: Category[] = [
  { id: 'c1', name: 'Groceries', type: 'expense', is_default: true, created_at: '2026-01-01', updated_at: '' },
  { id: 'c2', name: 'Salary', type: 'income', is_default: true, created_at: '2026-01-01', updated_at: '' },
];

let restoreSession: ReturnType<typeof vi.fn<() => Promise<void>>>;
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  restoreSession = vi.fn<() => Promise<void>>(() => Promise.resolve());
  get.mockImplementation((url: string) => {
    if (url === '/categories') return Promise.resolve({ data: CATS });
    if (url === '/notifications/preferences') {
      return Promise.resolve({ data: { notif_bills: true, notif_budgets: false, notif_goals: true, notif_salary: true } });
    }
    if (url === '/transactions') return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  post.mockResolvedValue({ data: {} });
  patch.mockResolvedValue({ data: {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const show = async (user: Partial<User> = {}) => {
  useAuthStore.setState({ user: { ...USER, ...user }, restoreSession, logout: vi.fn(() => Promise.resolve()) });
  render(<MemoryRouter><ProfilePage /></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
};

const row = (name: RegExp) => screen.getByRole('button', { name });
const sheet = () => screen.getByRole('dialog');

describe('the Profile list', () => {
  it('asks an unverified person to confirm their email, twice over', async () => {
    await show();
    expect(screen.getByText('Email not verified')).toBeTruthy();
    expect(row(/Confirm your email/)).toBeTruthy();
  });

  it('stops asking once the email is verified', async () => {
    await show({ email_verified: true });
    expect(screen.getByText('Email verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Confirm your email/ })).toBeNull();
  });

  it('shows each setting with its current value', async () => {
    await show();
    expect(row(/^Currency/).textContent).toContain('₹ INR');
    expect(row(/^Time zone/).textContent).toContain('India');
    expect(row(/^Categories/).textContent).toContain('2');
    // Budgets are off in the saved preferences.
    expect(row(/^Reminders/).textContent).toContain('3 on');
    expect(row(/^Catching payments/).textContent).toContain('On');
  });

  it('keeps every setting that was on the old page', async () => {
    await show();
    for (const name of [
      /^Currency/, /^Time zone/, /^Categories/, /^Catching payments/, /^Reminders/, /^Email/,
      /^Password/, /^Sign out other devices/, /^Export to Excel/, /^Import a statement/,
      /^Re-check categories/, /^Privacy and terms/, /^Replay the walkthrough/, /^Guided tour/,
      /^Sign out$/, /Delete MONEVA account/, /profile picture/,
    ]) {
      expect(row(name)).toBeTruthy();
    }
    expect(screen.getByRole('switch', { name: /App lock/ })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByText('Version row')).toBeTruthy();
  });
});

describe('the sheets', () => {
  it('saves a new time zone in one tap', async () => {
    await show();
    fireEvent.click(row(/^Time zone/));
    fireEvent.click(within(sheet()).getByRole('radio', { name: /London/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/profile', { timezone: 'Europe/London' }));
    expect(restoreSession).toHaveBeenCalled();
  });

  it('asks before converting every amount to a new currency', async () => {
    await show();
    fireEvent.click(row(/^Currency/));
    fireEvent.click(within(sheet()).getByRole('radio', { name: /US Dollar/ }));
    expect(within(sheet()).getByText(/cannot be undone/)).toBeTruthy();

    fireEvent.click(within(sheet()).getByRole('button', { name: 'Keep INR' }));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(within(sheet()).getByRole('radio', { name: /US Dollar/ }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Convert to USD' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/profile/currency', { currency: 'USD', convert: true }));
  });

  it('saves a reminder the moment it is switched', async () => {
    await show();
    fireEvent.click(row(/^Reminders/));
    fireEvent.click(within(sheet()).getByRole('switch', { name: /A budget running out/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/notifications/preferences', { notif_budgets: true }));
  });

  it('puts a reminder back if it could not be saved', async () => {
    patch.mockRejectedValueOnce(new Error('offline'));
    await show();
    fireEvent.click(row(/^Reminders/));
    const bills = within(sheet()).getByRole('switch', { name: /Bills that are due soon/ });
    fireEvent.click(bills);
    await waitFor(() => expect(bills.getAttribute('aria-checked')).toBe('true'));
  });

  it('checks the two passwords match before sending', async () => {
    await show();
    fireEvent.click(row(/^Password/));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'long-enough-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'long-enough-2' } });
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Change password' }));
    expect(within(sheet()).getByRole('alert').textContent).toMatch(/different/);
    expect(post).not.toHaveBeenCalled();
  });

  it('will not delete the account until DELETE is typed', async () => {
    await show();
    fireEvent.click(row(/Delete MONEVA account/));
    const go = within(sheet()).getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } });
    expect(go.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } });
    expect(go.disabled).toBe(false);
  });

  it('says so when re-checking finds nothing to move', async () => {
    await show();
    fireEvent.click(row(/^Re-check categories/));
    expect(await within(sheet()).findByText('Nothing to change')).toBeTruthy();
  });

  it('opens the email sheet from the nudge', async () => {
    await show();
    fireEvent.click(row(/Confirm your email/));
    expect(within(sheet()).getByRole('button', { name: /Send a code to this email/ })).toBeTruthy();
  });
});
