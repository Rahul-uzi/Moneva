export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'moneva_theme_preference';
const DEFAULT_MODE: ThemeMode = 'dark';

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

export const getStoredThemeMode = (): ThemeMode => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
};

/** Resolves 'system' to the concrete palette the OS is currently asking for. */
export const resolveTheme = (mode: ThemeMode): 'dark' | 'light' =>
  mode === 'system' ? (prefersDark().matches ? 'dark' : 'light') : mode;

/** Stamps the resolved palette onto <html data-theme="..."> so the CSS tokens switch. */
export const applyTheme = (mode: ThemeMode) => {
  document.documentElement.setAttribute('data-theme', resolveTheme(mode));
};

/** Persists the user's choice and applies it immediately. */
export const setThemeMode = (mode: ThemeMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage unavailable (private mode / cleared site data) — still apply for this session.
  }
  applyTheme(mode);
};

/**
 * Applies the saved preference at startup and keeps 'system' in sync with the OS.
 * Called once from main.tsx before the app renders.
 */
export const initTheme = () => {
  applyTheme(getStoredThemeMode());
  prefersDark().addEventListener('change', () => {
    if (getStoredThemeMode() === 'system') applyTheme('system');
  });
};
