// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RegisterPage } from './RegisterPage';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * Creating an account.
 *
 * The store's register action is replaced, so these tests are about the
 * PAGE: which inputs it refuses before anything is sent, what it passes on
 * when the form is good, what it says when the server says no, and that only
 * a brand-new account is queued for the walkthrough.
 */

vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const addToast = vi.fn();
vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({ addToast }),
}));

const markOnboardingPending = vi.fn();
vi.mock('../services/onboardingService', () => ({
  markOnboardingPending: () => markOnboardingPending(),
}));

type RegisterFn = (
  email: string, password: string, displayName: string, currency?: string, timezone?: string,
) => Promise<void>;
let registerUser: ReturnType<typeof vi.fn<RegisterFn>>;

const draw = () => render(
  <MemoryRouter initialEntries={['/register']}>
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<div>App home</div>} />
      <Route path="/login" element={<div>Sign-in screen</div>} />
    </Routes>
  </MemoryRouter>,
);

const fill = (values: { name?: string; email?: string; password?: string; confirm?: string }) => {
  if (values.name !== undefined) {
    fireEvent.change(screen.getByLabelText('Full Name / Display Name'), { target: { value: values.name } });
  }
  if (values.email !== undefined) {
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: values.email } });
  }
  if (values.password !== undefined) {
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: values.password } });
  }
  if (values.confirm !== undefined) {
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: values.confirm } });
  }
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

const GOOD = {
  name: 'Asha Rao',
  email: 'person@example.com',
  password: 'Harbour-Lantern-4417',
  confirm: 'Harbour-Lantern-4417',
};

beforeEach(() => {
  addToast.mockReset();
  markOnboardingPending.mockReset();
  registerUser = vi.fn<RegisterFn>(() => Promise.resolve());
  useAuthStore.setState({ register: registerUser });
});

afterEach(() => {
  cleanup();
});

describe('creating an account', () => {
  it('creates the account with what was typed and opens the app', async () => {
    draw();
    fill(GOOD);
    submit();
    expect(await screen.findByText('App home')).toBeTruthy();
    // Currency is not on the form; the default is what a new account starts in.
    expect(registerUser).toHaveBeenCalledWith('person@example.com', 'Harbour-Lantern-4417', 'Asha Rao', 'INR');
    expect(addToast).toHaveBeenCalledWith('Account created successfully!', 'success');
  });

  it('queues the walkthrough for a brand-new account', async () => {
    draw();
    fill(GOOD);
    submit();
    await screen.findByText('App home');
    expect(markOnboardingPending).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when the email is already registered, and stays put", async () => {
    registerUser.mockRejectedValueOnce(new Error('An account with this email already exists.'));
    draw();
    fill(GOOD);
    submit();
    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy();
    expect(screen.queryByText('App home')).toBeNull();
    // A failed signup must not leave a walkthrough waiting for someone else's sign-in.
    expect(markOnboardingPending).not.toHaveBeenCalled();
  });
});

describe('checking the form before anything is sent', () => {
  it('refuses two passwords that do not match', async () => {
    draw();
    fill({ ...GOOD, confirm: 'Harbour-Lantern-4418' });
    submit();
    expect(await screen.findByText('Passwords do not match')).toBeTruthy();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('refuses an address that is not an email', async () => {
    draw();
    fill({ ...GOOD, email: 'person-at-example' });
    submit();
    expect(await screen.findByText('Please enter a valid email address')).toBeTruthy();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('refuses a password shorter than six characters and a one-letter name', async () => {
    draw();
    fill({ name: 'A', email: GOOD.email, password: 'abc12', confirm: 'abc12' });
    submit();
    expect(await screen.findByText('Password must be at least 6 characters')).toBeTruthy();
    expect(screen.getByText('Display name must be at least 2 characters')).toBeTruthy();
    expect(registerUser).not.toHaveBeenCalled();
  });

  it('lists every missing field when the empty form is submitted', async () => {
    draw();
    submit();
    expect(await screen.findByText('Display name must be at least 2 characters')).toBeTruthy();
    expect(screen.getByText('Please enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy();
    expect(screen.getByText('Password confirmation is required')).toBeTruthy();
    expect(registerUser).not.toHaveBeenCalled();
  });
});

it('links back to signing in for someone who already has an account', async () => {
  draw();
  fireEvent.click(screen.getByRole('link', { name: 'Sign In' }));
  await waitFor(() => expect(screen.getByText('Sign-in screen')).toBeTruthy());
});
