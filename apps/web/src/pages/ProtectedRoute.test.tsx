// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { useAuthStore } from '../stores/useAuthStore';
import type { User } from '../types/api';

/**
 * The gate in front of every signed-in screen: who gets through, who is sent
 * to sign in, and what shows while a saved session is being restored.
 */

vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const USER: User = {
  id: 'u', email: 'person@example.com', display_name: 'Asha Rao', currency: 'INR', timezone: 'Asia/Kolkata',
  is_active: true, email_verified: true, avatar_data_url: null, totp_enabled: false, created_at: '', updated_at: '',
};

let restoreSession: ReturnType<typeof vi.fn<() => Promise<void>>>;
beforeEach(() => {
  restoreSession = vi.fn<() => Promise<void>>(() => Promise.resolve());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

type Gate = { isAuthenticated: boolean; isInitialized: boolean; isLoading: boolean };

const visit = async (gate: Gate, path = '/accounts') => {
  useAuthStore.setState({ ...gate, user: gate.isAuthenticated ? USER : null, restoreSession });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Sign in page</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/accounts" element={<div>Accounts screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe('ProtectedRoute', () => {
  it('lets a signed-in person through to the screen they asked for', async () => {
    await visit({ isAuthenticated: true, isInitialized: true, isLoading: false });
    expect(screen.getByText('Accounts screen')).toBeTruthy();
    expect(screen.queryByText('Sign in page')).toBeNull();
  });

  it('sends a signed-out visitor to login', async () => {
    await visit({ isAuthenticated: false, isInitialized: true, isLoading: false });
    expect(screen.getByText('Sign in page')).toBeTruthy();
    expect(screen.queryByText('Accounts screen')).toBeNull();
  });

  // A session already checked is not checked again on every navigation.
  it('does not restore the session again once it has been checked', async () => {
    await visit({ isAuthenticated: true, isInitialized: true, isLoading: false });
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it('shows a loading screen, not the login page, while a saved session is restored', async () => {
    // Never resolves: the restore is still in flight when we look.
    restoreSession.mockImplementation(() => new Promise<void>(() => {}));
    await visit({ isAuthenticated: false, isInitialized: false, isLoading: true });
    expect(restoreSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByText('Sign in page')).toBeNull();
    expect(screen.queryByText('Accounts screen')).toBeNull();
  });

  it('opens the screen once the saved session comes back', async () => {
    restoreSession.mockImplementation(() => {
      useAuthStore.setState({ user: USER, isAuthenticated: true, isInitialized: true, isLoading: false });
      return Promise.resolve();
    });
    await visit({ isAuthenticated: false, isInitialized: false, isLoading: true });
    expect(screen.getByText('Accounts screen')).toBeTruthy();
  });

  it('sends the visitor to login when the saved session has expired', async () => {
    restoreSession.mockImplementation(() => {
      useAuthStore.setState({ user: null, isAuthenticated: false, isInitialized: true, isLoading: false });
      return Promise.resolve();
    });
    await visit({ isAuthenticated: false, isInitialized: false, isLoading: true });
    expect(screen.getByText('Sign in page')).toBeTruthy();
    expect(screen.queryByText('Accounts screen')).toBeNull();
  });
});
