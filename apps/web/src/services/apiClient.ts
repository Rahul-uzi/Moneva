import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Preferences } from '@capacitor/preferences';
import { RefreshGate } from './refreshGate';
import type { AuthTokens, User } from '../types/api';

/**
 * The build-time default. Vite inlines this, so it is baked into the APK.
 * It is only a DEFAULT: the value below can be overridden at runtime, which
 * is what stops a DHCP lease change from requiring a rebuild.
 *
 * The fallback is production, not localhost. A build with no VITE_API_BASE_URL
 * used to ship pointing at the developer's own machine, which on a phone is
 * the phone itself - so nothing answered and the app looked broken.
 */
const BUILD_TIME_API_URL =
  import.meta.env.VITE_API_BASE_URL || 'https://moneva.onrender.com/api';

const API_URL_KEY = 'moneva_api_base_url';

const readStoredApiUrl = (): string | null => {
  try {
    const v = localStorage.getItem(API_URL_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
};

/** Current endpoint: the user's override if set, otherwise the build default. */
export const getApiBaseUrl = (): string => readStoredApiUrl() ?? BUILD_TIME_API_URL;

export const getDefaultApiBaseUrl = (): string => BUILD_TIME_API_URL;

/**
 * Points the app at a different API without rebuilding.
 * Pass null to fall back to the build-time default.
 */
export const setApiBaseUrl = (url: string | null): void => {
  const next = url && url.trim() ? url.trim().replace(/\/+$/, '') : null;
  try {
    if (next) localStorage.setItem(API_URL_KEY, next);
    else localStorage.removeItem(API_URL_KEY);
  } catch {
    /* storage unavailable - the axios default below still updates */
  }
  if (next) void Preferences.set({ key: API_URL_KEY, value: next }).catch(() => {});
  else void Preferences.remove({ key: API_URL_KEY }).catch(() => {});
  apiClient.defaults.baseURL = next ?? BUILD_TIME_API_URL;
};

const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

const TOKENS_KEY = 'moneva_auth_tokens';
const USER_KEY = 'moneva_auth_user';

export const getStoredTokens = (): AuthTokens | null => {
  const raw = localStorage.getItem(TOKENS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setStoredTokens = (tokens: AuthTokens | null) => {
  if (tokens) {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    // Mirror into native storage so the session survives a WebView data wipe.
    void Preferences.set({ key: TOKENS_KEY, value: JSON.stringify(tokens) }).catch(() => {});
  } else {
    localStorage.removeItem(TOKENS_KEY);
    void Preferences.remove({ key: TOKENS_KEY }).catch(() => {});
  }
};

/** Last known profile, so a cold start can render the app before the network answers. */
export const getCachedUser = (): User | null => {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const setCachedUser = (user: User | null) => {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    void Preferences.set({ key: USER_KEY, value: JSON.stringify(user) }).catch(() => {});
  } else {
    localStorage.removeItem(USER_KEY);
    void Preferences.remove({ key: USER_KEY }).catch(() => {});
  }
};

/**
 * Copies the native-storage copy back into localStorage when the WebView has
 * been cleared but the app data survived. Runs once, before session restore.
 */
export const hydrateSessionFromNative = async (): Promise<void> => {
  try {
    // Recover a saved API endpoint override before any request goes out.
    if (!localStorage.getItem(API_URL_KEY)) {
      const { value } = await Preferences.get({ key: API_URL_KEY });
      if (value) localStorage.setItem(API_URL_KEY, value);
    }
    apiClient.defaults.baseURL = getApiBaseUrl();
    if (!localStorage.getItem(TOKENS_KEY)) {
      const { value } = await Preferences.get({ key: TOKENS_KEY });
      if (value) localStorage.setItem(TOKENS_KEY, value);
    }
    if (!localStorage.getItem(USER_KEY)) {
      const { value } = await Preferences.get({ key: USER_KEY });
      if (value) localStorage.setItem(USER_KEY, value);
    }
  } catch {
    // Native storage unavailable (web build) - localStorage alone is fine.
  }
};

/**
 * If a saved endpoint override has gone stale (e.g. a USB tunnel that is no
 * longer up) but the build-time address answers, drop back to the default.
 *
 * Without this, an override saved for one setup silently strands the app when
 * the environment changes, and the only way out is the Server Address screen.
 */
export const reconcileApiBaseUrl = async (timeoutMs = 2500): Promise<void> => {
  const override = readStoredApiUrl();
  if (!override || override === BUILD_TIME_API_URL) return;

  const reachable = async (base: string) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${base}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  };

  if (await reachable(override)) return;
  if (await reachable(BUILD_TIME_API_URL)) {
    setApiBaseUrl(null);
  }
};

/** True when the access token is missing or within `skewSeconds` of expiring. */
export const isAccessTokenExpired = (tokens: AuthTokens | null, skewSeconds = 30): boolean => {
  if (!tokens?.access_token) return true;
  try {
    const payload = JSON.parse(atob(tokens.access_token.split('.')[1]));
    if (typeof payload.exp !== 'number') return true;
    return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
  } catch {
    return true;
  }
};

/** Exchanges the refresh token for a fresh pair. Throws if the refresh is rejected. */
export const refreshSession = async (): Promise<AuthTokens> => {
  const tokens = getStoredTokens();
  if (!tokens?.refresh_token) throw new Error('No refresh token stored.');
  const res = await axios.post<AuthTokens>(`${getApiBaseUrl()}/auth/refresh`, {
    refresh_token: tokens.refresh_token,
  });
  setStoredTokens(res.data);
  return res.data;
};

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const tokens = getStoredTokens();
    if (tokens?.access_token && config.headers) {
      config.headers.Authorization = `Bearer ${tokens.access_token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/** Clears the stored session and returns the user to the sign-in screen. */
const endSession = () => {
  setStoredTokens(null);
  setCachedUser(null);
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
};

/**
 * Only one refresh runs at a time; the rest wait for it.
 *
 * This was a loose boolean plus a queue array, and the flag was raised before
 * an early `return` that skipped the `finally` clearing it. See RefreshGate for
 * what that cost.
 */
const refreshGate = new RefreshGate<AuthTokens>();

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register')) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      // Someone else is already refreshing: wait for their result, then retry.
      if (refreshGate.isRefreshing) {
        const newTokens = await refreshGate.wait();
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newTokens.access_token}`;
        }
        return apiClient(originalRequest);
      }

      // Checked before anything is latched. Nothing below this point can leave
      // the gate stuck: raising it is confined to `refreshGate.run`.
      const tokens = getStoredTokens();
      if (!tokens?.refresh_token) {
        endSession();
        return Promise.reject(error);
      }

      try {
        const newTokens = await refreshGate.run(() => refreshSession());
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newTokens.access_token}`;
        }
        return apiClient(originalRequest);
      } catch (refreshErr) {
        // Only a rejected refresh token ends the session. If the refresh call
        // simply could not reach the server, keep the session so the user stays
        // signed in once connectivity returns.
        const refreshStatus = (refreshErr as AxiosError).response?.status;
        if (refreshStatus === 401 || refreshStatus === 403) {
          endSession();
        }
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);
