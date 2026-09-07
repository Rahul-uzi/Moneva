import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Preferences } from '@capacitor/preferences';
import { RefreshGate } from './refreshGate';
import { apiCache, cacheKey, scopeOfWrite, ttlFor } from './apiCache';
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

/**
 * The one endpoint, fixed at build time.
 *
 * This used to be overridable at runtime through a "Server Address" field in
 * Profile, which existed so a developer's changing LAN IP did not force a
 * rebuild. Shipping it meant the app could be pointed at anything - including
 * a machine that is not there - and a stale override silently stranded the
 * app on a server that never answers. The address is now permanent.
 */
export const getApiBaseUrl = (): string => BUILD_TIME_API_URL;

/**
 * Deletes any endpoint override left behind by an older install.
 *
 * Without this, an app that upgrades from a version where the address was
 * editable would keep using whatever was saved there and never reach
 * production again.
 */
export const clearStoredApiUrl = (): void => {
  try {
    localStorage.removeItem(API_URL_KEY);
  } catch {
    /* storage unavailable - the axios default below is what actually matters */
  }
  void Preferences.remove({ key: API_URL_KEY }).catch(() => {});
  apiClient.defaults.baseURL = BUILD_TIME_API_URL;
};

const API_BASE_URL = getApiBaseUrl();

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
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
  // Whoever is next to use this app must not be shown the last person's
  // balances out of memory. Logout, an expired session and a switched account
  // all pass through here.
  apiCache.clear();
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
    // The endpoint is fixed, so nothing is restored here any more - but an
    // override saved by an older version has to be cleared, or it would sit in
    // storage forever pointing at a machine that is long gone.
    clearStoredApiUrl();
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

/**
 * How long to wait for a server that has gone to sleep.
 *
 * The API is hosted on a plan that suspends the instance after a spell of
 * inactivity, and waking it takes tens of seconds while the container starts
 * and the database pool reconnects. The first request of the day therefore
 * fails on a timeout that is perfectly correct for a running server. Rather
 * than raise the ceiling for every request - which would leave a genuinely
 * unreachable server hanging for a minute before admitting it - a request that
 * fails this way is sent again with much more patience.
 */
const COLD_START_TIMEOUT_MS = 45000;
const MAX_TRANSIENT_RETRIES = 2;
const RETRY_BACKOFF_MS = [1200, 3500];

/** Sending these again is safe: they change nothing on the server. */
const REPEATABLE_METHODS = new Set(['get', 'head', 'options']);

/**
 * The two POSTs that are also safe to send again.
 *
 * Writes are excluded above because repeating one can double it. These two are
 * the exception, and they matter: they are the FIRST requests anybody makes,
 * so they are the ones that meet a server which has gone to sleep - and until
 * now they were the only ones that could not wait for it. A person tapping
 * "Send reset code" on a cold instance was told the server could not be
 * reached, thirty seconds before it finished waking.
 *
 * Neither is spoiled by a second send: a login is a login, and asking for a
 * reset code again simply replaces the code.
 *
 * /auth/reset-password is deliberately NOT here. A request that timed out may
 * already have been counted against the five-guess budget, and sending it
 * again would spend another one.
 */
const REPEATABLE_POSTS = ['/auth/login', '/auth/forgot-password'];

/**
 * One retry for a write, against two for a read.
 *
 * A read costs nothing to repeat. `forgot-password` is rationed to four an
 * hour per account, so a storm of retries could lock somebody out of the very
 * thing they are trying to use.
 */
const MAX_WRITE_RETRIES = 1;

/**
 * Should a request that came back with nothing be sent again?
 *
 * Pulled out of the interceptor so it can be tested. Inside a closure it was
 * reachable only by making a real request time out, which is why the rule that
 * excluded every POST went unnoticed until somebody watched a reset code fail
 * on a sleeping server.
 */
export const shouldRetryTransient = (
  method: string,
  url: string | undefined,
  attempt: number,
): boolean => {
  const verb = (method || 'get').toLowerCase();
  const isRead = REPEATABLE_METHODS.has(verb);
  const isRepeatableWrite = !isRead
    && REPEATABLE_POSTS.some((path) => (url ?? '').includes(path));
  if (!isRead && !isRepeatableWrite) return false;
  return attempt < (isRead ? MAX_TRANSIENT_RETRIES : MAX_WRITE_RETRIES);
};

export const API_WAKING_EVENT = 'moneva:api-waking';
export const API_AWAKE_EVENT = 'moneva:api-awake';

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const announce = (name: string) => {
  try {
    window.dispatchEvent(new Event(name));
  } catch {
    /* no window (tests) - the retry itself is what matters */
  }
};

let waking = false;

/** True while a request is waiting on a server that has not answered yet. */
export const isApiWaking = (): boolean => waking;

const announceWaking = () => {
  if (waking) return;
  waking = true;
  announce(API_WAKING_EVENT);
};

const announceAwake = () => {
  if (!waking) return;
  waking = false;
  announce(API_AWAKE_EVENT);
};

/**
 * Start the server waking while the first screen is still painting.
 *
 * The instance suspends after a spell of inactivity and takes around half a
 * minute to come back - the deploy log shows roughly 28 seconds from process
 * start to "Application startup complete". Nothing on the sign-in or reset
 * screens talks to the API until the person presses a button, so the wake-up
 * only began at the exact moment they were waiting on it.
 *
 * This moves that wait to app launch, where it costs nobody anything: by the
 * time an email address has been typed, the server is usually up. It is a GET,
 * so the retry logic above already covers it, and it is fire-and-forget -
 * failure here is not worth reporting, because the real request will report it.
 */
export const warmUpApi = (): void => {
  void apiClient
    .get('/health', { timeout: COLD_START_TIMEOUT_MS })
    .catch(() => {
      /* the server is unreachable or asleep; the next real request will say so */
    });
};

/**
 * Did this request fail in a way that says "ask again", rather than
 * "the answer is no"?
 *
 * A timeout, an unreachable host, or a gateway error from the host while it
 * boots the container are all worth another attempt. A 4xx is the server
 * telling us something, and repeating the question will not change the answer.
 */
export const isTransientError = (error: unknown): boolean => {
  if (axios.isCancel(error)) return false;
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  // No response at all: timed out, refused, offline, DNS failure.
  if (status === undefined) return true;
  return status === 502 || status === 503 || status === 504;
};

/**
 * Turns a failed request into something worth showing a person.
 *
 * The server's own message wins when it sent one. Otherwise a request that
 * never arrived is described as such, because "Failed to load" beside a Retry
 * button says nothing about why, or whether retrying is even worth it.
 */
export const describeApiError = (error: unknown, fallback: string): string => {
  const detail = axios.isAxiosError<{ detail?: unknown }>(error)
    ? error.response?.data?.detail
    : undefined;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (isTransientError(error)) {
    return 'Could not reach the server. It may still be starting up - check your connection and try again.';
  }
  return fallback;
};

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

/**
 * The only way anything outside this file should renew a session.
 *
 * `refreshSession` itself is unguarded, so calling it directly starts a
 * refresh whatever else is already happening. The auth store did exactly that
 * while restoring a session, at the same moment the request interceptor was
 * renewing the same expired token through the gate - and the server log shows
 * the result: two preflights and two `POST /auth/refresh`, a millisecond
 * apart, on launch.
 *
 * Both currently succeed, because the endpoint validates the refresh token
 * rather than consuming it. That is the only reason this was invisible: the
 * day refresh tokens are rotated - the ordinary hardening - the second call
 * would present one the first had just retired, and the user would be signed
 * out at random on launch.
 */
export const refreshSessionShared = (): Promise<AuthTokens> => refreshGate.run(() => refreshSession());

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _transientAttempt?: number;
}

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const url = config.url ?? '';
    const isAuthCall =
      url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/refresh');

    let tokens = getStoredTokens();

    // Renew a token we can already see has expired, rather than spending a
    // round trip discovering it. After the app has sat unused overnight this
    // is the difference between the dashboard loading and the dashboard
    // showing an error until the user presses Retry.
    if (!isAuthCall && tokens?.refresh_token && isAccessTokenExpired(tokens)) {
      try {
        tokens = await refreshSessionShared();
      } catch (err) {
        // A refused refresh token means the session really is over. A refresh
        // that could not reach the server does not, so keep the session and
        // let the request below fail on its own terms.
        const status = (err as AxiosError).response?.status;
        if (status === 401 || status === 403) {
          endSession();
          throw err;
        }
        tokens = getStoredTokens();
      }
    }

    if (tokens?.access_token && config.headers) {
      config.headers.Authorization = `Bearer ${tokens.access_token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => {
    announceAwake();
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    // 1. Nothing came back. Wait a moment and ask again with a longer fuse -
    //    the server is most likely still starting up.
    if (originalRequest && isTransientError(error)) {
      const method = (originalRequest.method ?? 'get').toLowerCase();
      const attempt = originalRequest._transientAttempt ?? 0;
      if (shouldRetryTransient(method, originalRequest.url, attempt)) {
        originalRequest._transientAttempt = attempt + 1;
        announceWaking();
        originalRequest.timeout = COLD_START_TIMEOUT_MS;
        await pause(RETRY_BACKOFF_MS[attempt] ?? 3500);
        return apiClient(originalRequest);
      }
      announceAwake();
      return Promise.reject(error);
    }

    // 2. The server rejected the token. The request interceptor renews tokens
    //    it can see have expired, so arriving here means the server disagreed
    //    with us - refresh once, then repeat the request.
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/register')) {
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      const tokens = getStoredTokens();
      if (!tokens?.refresh_token) {
        endSession();
        return Promise.reject(error);
      }

      try {
        // `run` hands back the refresh already in flight, so several requests
        // failing at once still produce exactly one refresh.
        const newTokens = await refreshSessionShared();
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

/* --------------------------------------------------------------------------
   Reads go through the cache; writes empty it.

   Wrapping the instance's own `get` rather than changing call sites: there are
   twenty-odd of them across the pages, they all want the same behaviour, and
   one of them quietly not getting it is exactly the sort of difference that is
   invisible until it is a bug.
   -------------------------------------------------------------------------- */

type GetSignature = typeof apiClient.get;
const uncachedGet = apiClient.get.bind(apiClient) as GetSignature;

/**
 * A response the caller may treat as its own.
 *
 * The cached copy is shared by everyone who asks for that key, so handing out
 * the same array would let one screen's `sort()` reorder another's data - and
 * the cache's. The containers are copied; the records inside are not, since
 * nothing here rewrites a record in place.
 */
const detach = <T,>(res: { data: T }): { data: T } => {
  const { data } = res;
  if (Array.isArray(data)) return { ...res, data: [...data] as unknown as T };
  if (data && typeof data === 'object') return { ...res, data: { ...data } };
  return { ...res };
};

apiClient.get = ((url: string, config?: Parameters<GetSignature>[1]) => {
  const ttl = ttlFor(url);
  if (ttl <= 0) return uncachedGet(url, config);

  // A caller that brings its own signal or response type wants that exact
  // request, not one shared with somebody else.
  if (config?.signal || (config?.responseType && config.responseType !== 'json')) {
    return uncachedGet(url, config);
  }

  const key = cacheKey(url, config?.params as Record<string, unknown> | undefined);
  return apiCache
    .read(key, ttl, () => uncachedGet(url, config))
    .then((res) => detach(res as { data: unknown }));
}) as GetSignature;

// A write invalidates the lot, unless it is one of the few declared as having
// a confined effect. Coarse by default on purpose: the cost of guessing wrong
// is showing someone a stale balance.
apiClient.interceptors.request.use((config) => {
  if ((config.method ?? 'get').toLowerCase() === 'get') return config;
  const scope = scopeOfWrite(config.url ?? '');
  if (scope) scope.forEach((path) => apiCache.invalidate(path));
  else apiCache.clear();
  return config;
});
