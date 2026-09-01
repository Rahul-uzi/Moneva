import { create } from 'zustand';
import type { User, AuthTokens, LoginResult } from '../types/api';
import { isTwoFactorChallenge } from '../types/api';
import {
  apiClient,
  getStoredTokens,
  setStoredTokens,
  getCachedUser,
  setCachedUser,
  hydrateSessionFromNative,
  isAccessTokenExpired,
  refreshSession,
} from '../services/apiClient';
import type { AxiosError } from 'axios';

interface AuthState {
  user: User | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  /** Resolves to a challenge token when the account needs a second factor, else null. */
  login: (email: string, password: string) => Promise<string | null>;
  /** Completes a 2FA login by exchanging the challenge for real tokens. */
  completeTwoFactorLogin: (tokens: AuthTokens) => Promise<void>;
  register: (email: string, password: string, displayName: string, currency?: string, timezone?: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: getCachedUser(),
  tokens: getStoredTokens(),
  isAuthenticated: !!getStoredTokens()?.refresh_token,
  isInitialized: false,
  isLoading: true,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.post<LoginResult>('/auth/login', { email, password });

      // Password was right but the account has TOTP on: hand the challenge to the page.
      if (isTwoFactorChallenge(response.data)) {
        set({ isLoading: false, isAuthenticated: false, isInitialized: true, error: null });
        return response.data.challenge_token;
      }

      const tokens = response.data;
      setStoredTokens(tokens);

      const userRes = await apiClient.get<User>('/auth/me');
      setCachedUser(userRes.data);
      set({
        tokens,
        user: userRes.data,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
      return null;
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Invalid email or password.';
      // Do NOT write transient UI error into global store — page handles display via local state
      set({ isLoading: false, error: null, isAuthenticated: false, isInitialized: true });
      throw new Error(msg, { cause: err });
    }
  },

  completeTwoFactorLogin: async (tokens) => {
    set({ isLoading: true, error: null });
    try {
      setStoredTokens(tokens);
      const userRes = await apiClient.get<User>('/auth/me');
      setCachedUser(userRes.data);
      set({
        tokens,
        user: userRes.data,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      setStoredTokens(null);
      set({ isLoading: false, error: null, isAuthenticated: false, isInitialized: true });
      throw new Error('Could not establish your session. Please sign in again.', { cause: err });
    }
  },

  register: async (email, password, displayName, currency = 'INR', timezone = 'Asia/Kolkata') => {
    set({ isLoading: true, error: null });
    try {
      const response = await apiClient.post<AuthTokens>('/auth/register', {
        email,
        password,
        display_name: displayName,
        currency,
        timezone,
      });
      const tokens = response.data;
      setStoredTokens(tokens);

      const userRes = await apiClient.get<User>('/auth/me');
      setCachedUser(userRes.data);
      set({
        tokens,
        user: userRes.data,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Registration failed. Please try again.';
      // Do NOT write transient UI error into global store — page handles display via local state
      set({ isLoading: false, error: null, isAuthenticated: false, isInitialized: true });
      throw new Error(msg, { cause: err });
    }
  },

  logout: async () => {
    try {
      if (get().isAuthenticated) {
        await apiClient.post('/auth/logout');
      }
    } catch {
      // Ignore network errors on logout
    } finally {
      setStoredTokens(null);
      setCachedUser(null);
      set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
    }
  },

  restoreSession: async () => {
    // A WebView data wipe can empty localStorage while native storage still
    // holds the session, so recover that first.
    await hydrateSessionFromNative();

    let tokens = getStoredTokens();
    if (!tokens?.refresh_token) {
      setStoredTokens(null);
      setCachedUser(null);
      set({ isLoading: false, isAuthenticated: false, isInitialized: true, user: null, tokens: null });
      return;
    }

    // Show the app immediately from the cached profile - the network check
    // below only ever upgrades this, it does not gate first paint.
    const cached = getCachedUser();
    if (cached) {
      set({ user: cached, tokens, isAuthenticated: true, isInitialized: true, isLoading: false });
    }

    try {
      if (isAccessTokenExpired(tokens)) {
        tokens = await refreshSession();
      }

      const userRes = await apiClient.get<User>('/auth/me');
      setCachedUser(userRes.data);
      set({
        user: userRes.data,
        tokens,
        isAuthenticated: true,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
    } catch (err: unknown) {
      const status = (err as AxiosError).response?.status;

      // Only a definitive rejection ends the session. A network failure means
      // the phone is offline, not that the user signed out.
      if (status === 401 || status === 403) {
        setStoredTokens(null);
        setCachedUser(null);
        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
          isInitialized: true,
          isLoading: false,
          error: null,
        });
        return;
      }

      set({
        tokens,
        user: cached,
        isAuthenticated: !!cached,
        isInitialized: true,
        isLoading: false,
        error: null,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
