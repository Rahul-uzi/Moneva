import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

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

/**
 * Matches the Android status bar to the palette.
 *
 * The Android theme is Theme.AppCompat.DayNight, which follows the SYSTEM dark
 * setting - not this app's own toggle. With the phone in light mode and the app
 * in dark, Android drew dark icons over the app's near-black bar and the clock,
 * battery and signal disappeared entirely.
 *
 * Capacitor's naming is inverted from what it looks like: Style.Dark means a
 * dark background, so it paints LIGHT content.
 */
const syncStatusBar = (theme: 'dark' | 'light') => {
  if (!Capacitor.isNativePlatform()) return;
  void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(() => {});
  // The bar sits over the app's own header colour on both themes.
  void StatusBar.setBackgroundColor({ color: theme === 'dark' ? '#0B0E14' : '#FFFFFF' }).catch(
    () => {},
  );
};

/** Stamps the resolved palette onto <html data-theme="..."> so the CSS tokens switch. */
export const applyTheme = (mode: ThemeMode) => {
  const theme = resolveTheme(mode);
  document.documentElement.setAttribute('data-theme', theme);
  syncStatusBar(theme);
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
