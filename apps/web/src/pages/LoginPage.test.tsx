// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { useAuthStore } from '../stores/useAuthStore';
import type { AuthTokens } from '../types/api';

/**
 * The sign-in screen.
 *
 * The store's login actions are replaced, so these tests are about what the
 * PAGE does with each outcome: where it sends you, what it says when the
 * password is wrong, and how it hands over to the second-factor step. The one
 * network call the page makes itself - exchanging the challenge for tokens -
 * goes through the mocked API client.
 */

const post = vi.fn();
const get = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const addToast = vi.fn();
vi.mock('../stores/useUiStore', () => ({
  useUiStore: () => ({ addToast }),
}));

const TOKENS: AuthTokens = {
  access_token: 'example-access',
  refresh_token: 'example-refresh',
  token_type: 'bearer',
  expires_in: 900,
};

const EMAIL = 'person@example.com';
const PASSWORD = 'Harbour-Lantern-4417';

let login: ReturnType<typeof vi.fn<(email: string, password: string) => Promise<string | null>>>;
let completeTwoFactorLogin: ReturnType<typeof vi.fn<(tokens: AuthTokens) => Promise<void>>>;

const draw = () => render(
  <MemoryRouter initialEntries={['/login']}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<div>App home</div>} />
      <Route path="/forgot-password" element={<div>Forgot password screen</div>} />
      <Route path="/register" element={<div>Register screen</div>} />
    </Routes>
  </MemoryRouter>,
);

const fillAndSubmit = (email: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
};

beforeEach(() => {
  post.mockReset();
  get.mockReset();
  addToast.mockReset();
  login = vi.fn<(email: string, password: string) => Promise<string | null>>(() => Promise.resolve(null));
  completeTwoFactorLogin = vi.fn<(tokens: AuthTokens) => Promise<void>>(() => Promise.resolve());
  useAuthStore.setState({ login, completeTwoFactorLogin });
});

afterEach(() => {
  cleanup();
});

describe('signing in with a password', () => {
  it('signs in with the email and password typed and opens the app', async () => {
    draw();
    fillAndSubmit(EMAIL, PASSWORD);
    expect(await screen.findByText('App home')).toBeTruthy();
    expect(login).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(addToast).toHaveBeenCalledWith('Successfully signed in!', 'success');
  });

  it("shows the server's reason when the password is wrong, and stays on the page", async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password.'));
    draw();
    fillAndSubmit(EMAIL, 'Wrong-Guess-0000');
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(screen.queryByText('App home')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
  });

  it('does not ask the server anything until both fields are filled in properly', async () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Please enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('rejects an address that is not an email and a password that is too short', async () => {
    draw();
    fillAndSubmit('person-at-example', '12345');
    expect(await screen.findByText('Please enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Password must be at least 6 characters')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });
});

describe('two-factor sign-in', () => {
  // A challenge token from login means the password was right but the account
  // has an authenticator app on: the page must ask for the code, not open the app.
  const reachCodeStep = async () => {
    login.mockResolvedValueOnce('challenge-example-1');
    draw();
    fillAndSubmit(EMAIL, PASSWORD);
    await screen.findByRole('heading', { name: 'Two-Factor Verification' });
  };

  it('asks for the authenticator code instead of opening the app', async () => {
    await reachCodeStep();
    expect(screen.getByLabelText('Authentication Code')).toBeTruthy();
    expect(screen.queryByText('App home')).toBeNull();
    // The password form and its links are gone while the code is asked for.
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).toBeNull();
  });

  it('exchanges the challenge and the trimmed code for a session, then opens the app', async () => {
    post.mockResolvedValueOnce({ data: TOKENS });
    await reachCodeStep();
    fireEvent.change(screen.getByLabelText('Authentication Code'), { target: { value: ' 482913 ' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }));

    expect(await screen.findByText('App home')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/auth/2fa/verify', {
      challenge_token: 'challenge-example-1',
      code: '482913',
    });
    expect(completeTwoFactorLogin).toHaveBeenCalledWith(TOKENS);
  });

  it("shows why a code was refused and clears it for another try", async () => {
    post.mockRejectedValueOnce({ response: { data: { detail: 'That code has expired.' } } });
    await reachCodeStep();
    const field = screen.getByLabelText('Authentication Code') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }));

    expect(await screen.findByText('That code has expired.')).toBeTruthy();
    expect((screen.getByLabelText('Authentication Code') as HTMLInputElement).value).toBe('');
    expect(completeTwoFactorLogin).not.toHaveBeenCalled();
    expect(screen.queryByText('App home')).toBeNull();
  });

  it('goes back to the password form when another account is wanted', async () => {
    await reachCodeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Use a different account' }));
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeTruthy();
    expect(screen.getByLabelText('Email Address')).toBeTruthy();
  });
});

describe('ways out of the sign-in screen', () => {
  it('links to resetting a forgotten password', async () => {
    draw();
    fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    await waitFor(() => expect(screen.getByText('Forgot password screen')).toBeTruthy());
  });

  it('links to creating an account', async () => {
    draw();
    fireEvent.click(screen.getByRole('link', { name: 'Create Account' }));
    await waitFor(() => expect(screen.getByText('Register screen')).toBeTruthy());
  });
});
