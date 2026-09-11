import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  ShieldCheck,
  Bell,
  Moon,
  Sun,
  Laptop,
  Download,
  KeyRound,
  LogOut,
  Trash2,
  CheckCircle2,
  Globe,
  DollarSign,
  Camera,
  Fingerprint,
  GraduationCap,
  X,
  Tags,
  Plus,
  Pencil,
  Search,
  MonitorSmartphone,
  Upload,
  FileText,
} from 'lucide-react';
import { categoryIcon } from '../utils/categoryIcons';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog';
import {
  getStoredThemeMode,
  setThemeMode as persistThemeMode,
} from '../services/themeService';
import type { ThemeMode } from '../services/themeService';
import { useAuthStore } from '../stores/useAuthStore';
import { useUiStore } from '../stores/useUiStore';
import { apiClient, setStoredTokens } from '../services/apiClient';
import { nativeNotificationService, type PermissionStatus } from '../services/notificationService';
import { runNotificationSync } from '../services/notificationSync';
import {
  loadAutoAddSettings, saveAutoAddSettings, forgetAllTrust,
} from '../services/autoAddStore';
import type { User, Category } from '../types/api';
import { fileToAvatarDataUrl, uploadAvatar, deleteAvatar } from '../services/avatarService';
import {
  getBiometricStatus,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
  promptBiometric,
} from '../services/biometricService';
import type { BiometricStatus } from '../services/biometricService';
import { markOnboardingPending } from '../services/onboardingService';
import { PaymentInbox } from '../components/financial/PaymentInbox';
import {
  getCaptureStatus,
  isCaptureSupported,
  type CaptureStatus,
} from '../services/notificationCapture';
import { captureHealth } from '../utils/captureHealth';
import { markTourPending } from '../services/tourService';
import { exportBinaryFile } from '../services/exportService';
import { ImportSheet } from '../components/financial/ImportSheet';
import { SmsCaptureSection } from '../components/settings/SmsCaptureSection';
import { LegalSheet } from '../components/settings/LegalSheet';
import type { Account } from '../types/api';
import './ProfilePage.css';

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, restoreSession, logout } = useAuthStore();
  const { addToast } = useUiStore();

  // Profile Edit State
  const [displayName, setDisplayName] = useState<string>('');
  const [currency, setCurrency] = useState<string>('INR');
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);

  // Appearance State
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredThemeMode);

  // Whether this phone will actually show notifications. The server-side
  // Read once from this device rather than from the server: see autoAddStore
  // for why trust that fails towards "ask" has to be local.
  const [autoAdd, setAutoAdd] = useState(() => loadAutoAddSettings());

  // toggles below meant nothing while the OS permission had never been asked.
  const [devicePerm, setDevicePerm] = useState<PermissionStatus>('prompt');
  const [isEnablingPerm, setIsEnablingPerm] = useState<boolean>(false);

  // Reading payment alerts. Two states worth telling apart in the copy below:
  // Android has granted access, and the user still wants it used.
  const [capture, setCapture] = useState<CaptureStatus>({
    granted: false, capturing: false, lastKeptAt: 0, keptCount: 0, enabledAt: 0,
  });
  const [isPayInboxOpen, setIsPayInboxOpen] = useState<boolean>(false);

  // Derived on render rather than stored: this is a reading of the clock
  // as much as of the switch, and a stored copy would quietly go stale.
  const captureState = captureHealth({
    supported: isCaptureSupported(),
    granted: capture.granted,
    capturing: capture.capturing,
    lastKeptAt: capture.lastKeptAt,
    keptCount: capture.keptCount,
    enabledAt: capture.enabledAt,
    now: Date.now(),
  });
  useEffect(() => {
    // Re-read when the inbox closes: the user may have granted access, or
    // turned the whole thing off, while it was open.
    if (isPayInboxOpen) return;
    void getCaptureStatus().then(setCapture);
  }, [isPayInboxOpen]);
  useEffect(() => {
    const timer = setTimeout(() => {
      void nativeNotificationService.checkPermission().then(setDevicePerm);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const handleEnableDeviceNotifications = async () => {
    setIsEnablingPerm(true);
    try {
      const status = await nativeNotificationService.requestPermission();
      setDevicePerm(status);
      if (status === 'granted') {
        await runNotificationSync({ force: true });
        addToast('Reminders are on. You will be told before bills are due.', 'success');
      } else {
        addToast('Notifications are blocked for MONEVA in Android settings.', 'warning');
      }
    } finally {
      setIsEnablingPerm(false);
    }
  };

  // Notification Preferences State
  const [notifBills, setNotifBills] = useState<boolean>(true);
  const [notifSalary, setNotifSalary] = useState<boolean>(true);
  const [isSavingPrefs, setIsSavingPrefs] = useState<boolean>(false);

  // Currency change is destructive to the meaning of every stored amount, so it
  // gets its own confirmed flow rather than riding along with Save Profile.
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [isChangingCurrency, setIsChangingCurrency] = useState<boolean>(false);

  // Categories
  const [isCategoriesOpen, setIsCategoriesOpen] = useState<boolean>(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [categoryQuery, setCategoryQuery] = useState<string>('');
  const [categorySort, setCategorySort] = useState<'custom' | 'az' | 'newest'>('custom');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'expense' | 'income'>('all');
  const [pendingDeleteCategory, setPendingDeleteCategory] = useState<{ id: string; name: string } | null>(null);
  const [newCategoryType, setNewCategoryType] = useState<'expense' | 'income'>('expense');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState<string>('');
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false);

  // Sessions
  const [isSigningOutAll, setIsSigningOutAll] = useState<boolean>(false);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState<boolean>(false);
  const [notifBudgets, setNotifBudgets] = useState<boolean>(true);
  const [notifGoals, setNotifGoals] = useState<boolean>(true);

  // Password Change State
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);

  // Data Export & Account Deletion State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  // Bringing history in. The accounts list is fetched when the sheet is
  // opened rather than on page load: nothing else on this screen needs it,
  // and a settings page should not pay for a feature nobody opened.
  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);
  // null when closed, so the sheet is unmounted and always reopens on the
  // tab that was asked for rather than the one last looked at.
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms' | null>(null);
  const [importAccounts, setImportAccounts] = useState<Account[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);

  // Avatar
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isAvatarBusy, setIsAvatarBusy] = useState<boolean>(false);

  // Two-factor

  // Biometric app-lock
  const [biometric, setBiometric] = useState<BiometricStatus>({ available: false, label: null, reason: null });
  const [biometricLock, setBiometricLock] = useState<boolean>(false);

  // API endpoint override - lets a DHCP address change be fixed in-app.

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (user && isMounted) {
        setDisplayName(user.display_name);
        setCurrency(user.currency);
        setTimezone(user.timezone);
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [user]);

  // Load biometric capability + saved app-lock preference once.
  useEffect(() => {
    let active = true;
    void (async () => {
      const [status, enabled] = await Promise.all([getBiometricStatus(), isBiometricLockEnabled()]);
      if (!active) return;
      setBiometric(status);
      setBiometricLock(enabled);
    })();
    return () => {
      active = false;
    };
  }, []);

  // The toggles previously held local state only - nothing was ever loaded or
  // saved, so flipping one did nothing at all.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await apiClient.get<{
          notif_bills: boolean;
          notif_budgets: boolean;
          notif_goals: boolean;
          notif_salary: boolean;
        }>('/notifications/preferences');
        if (!active) return;
        setNotifBills(res.data.notif_bills);
        setNotifBudgets(res.data.notif_budgets);
        setNotifGoals(res.data.notif_goals);
        setNotifSalary(res.data.notif_salary);
      } catch {
        // Keep the defaults; the next toggle will still write through.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const savePreference = async (
    key: 'notif_bills' | 'notif_budgets' | 'notif_goals' | 'notif_salary',
    value: boolean,
    revert: (v: boolean) => void,
  ) => {
    setIsSavingPrefs(true);
    try {
      await apiClient.patch('/notifications/preferences', { [key]: value });
    } catch {
      // Put the switch back so it never claims a setting that did not save.
      revert(!value);
      addToast('Could not save that preference.', 'error');
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleConfirmCurrency = async () => {
    if (!pendingCurrency) return;
    setIsChangingCurrency(true);
    try {
      // No rate is sent: the API converts at the live rate and tells us which
      // one it used, so the confirmation can state it rather than guess.
      const res = await apiClient.post<{
        rows_updated: number;
        rate: number | null;
        rate_as_of: string | null;
      }>('/profile/currency', { currency: pendingCurrency, convert: true });

      setCurrency(pendingCurrency);
      await restoreSession();
      addToast(
        `Converted ${res.data.rows_updated} amounts at 1 ${currency} = ${res.data.rate} ${pendingCurrency}.`,
        'success',
      );
      setPendingCurrency(null);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not change the currency.', 'error');
    } finally {
      setIsChangingCurrency(false);
    }
  };

  const loadCategories = async () => {
    setIsLoadingCategories(true);
    try {
      const res = await apiClient.get<Category[]>('/categories');
      setCategories(res.data);
    } catch {
      addToast('Could not load categories.', 'error');
    } finally {
      setIsLoadingCategories(false);
    }
  };

  // Expense and income categories are separate sets — the transaction form only
  // ever offers the ones matching the type being added. Grouping them here makes
  // that split visible instead of leaving one flat list of look-alike rows.
  const categoryGroups = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    const match = (c: Category) => !q || c.name.toLowerCase().includes(q);

    // 'custom' keeps whatever order the API returned — insertion order, which
    // holds the seeded defaults in their curated sequence.
    const sort = (items: Category[]) => {
      if (categorySort === 'az') {
        return [...items].sort((a, b) => a.name.localeCompare(b.name));
      }
      if (categorySort === 'newest') {
        return [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
      }
      return items;
    };

    const of = (type: 'expense' | 'income') =>
      sort(categories.filter((c) => c.type === type && match(c)));

    const all = [
      { type: 'expense' as const, label: 'Expense', items: of('expense') },
      { type: 'income' as const, label: 'Income', items: of('income') },
    ];
    return categoryFilter === 'all' ? all : all.filter((g) => g.type === categoryFilter);
  }, [categories, categoryQuery, categorySort, categoryFilter]);

  const expenseCount = useMemo(() => categories.filter((c) => c.type === 'expense').length, [categories]);
  const incomeCount = useMemo(() => categories.filter((c) => c.type === 'income').length, [categories]);

  const handleOpenCategories = () => {
    setCategoryFilter('all');
    setCategoryQuery('');
    setIsCategoriesOpen(true);
    void loadCategories();
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setIsSavingCategory(true);
    try {
      await apiClient.post('/categories', { name, type: newCategoryType });
      setNewCategoryName('');
      await loadCategories();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not add that category.', 'error');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleRenameCategory = async (id: string) => {
    const name = editingCategoryName.trim();
    if (!name) return;
    setIsSavingCategory(true);
    try {
      await apiClient.patch(`/categories/${id}`, { name });
      setEditingCategoryId(null);
      setEditingCategoryName('');
      await loadCategories();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not rename that category.', 'error');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    setIsSavingCategory(true);
    try {
      await apiClient.delete(`/categories/${id}`);
      // Transactions keep their history; the API nulls their category link.
      setPendingDeleteCategory(null);
      addToast(`Deleted "${name}". Past transactions kept, now uncategorised.`, 'info');
      await loadCategories();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not delete that category.', 'error');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleSignOutAllDevices = async () => {
    setIsSigningOutAll(true);
    try {
      const res = await apiClient.post<{ tokens: { access_token: string; refresh_token: string; token_type: string; expires_in: number } }>(
        '/auth/logout-all',
      );
      // The server hands back a fresh pair so this device is not signed out too.
      if (res.data?.tokens) setStoredTokens(res.data.tokens);
      setConfirmSignOutAll(false);
      addToast('Done. Every other device has been signed out.', 'success');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not sign out other devices.', 'error');
    } finally {
      setIsSigningOutAll(false);
    }
  };

  // ---------- Profile picture ----------
  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file) return;

    setIsAvatarBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await uploadAvatar(dataUrl);
      await restoreSession();
      addToast('Profile picture updated.', 'success');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || (err as Error).message || 'Could not update your picture.', 'error');
    } finally {
      setIsAvatarBusy(false);
    }
  };

  const handleAvatarRemove = async () => {
    setIsAvatarBusy(true);
    try {
      await deleteAvatar();
      await restoreSession();
      addToast('Profile picture removed.', 'info');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not remove your picture.', 'error');
    } finally {
      setIsAvatarBusy(false);
    }
  };

  // ---------- Two-factor ----------


  const handleReplayTutorial = () => {
    markOnboardingPending();
    addToast('Tutorial will start now.', 'info');
    navigate('/');
  };

  const handleStartTour = () => {
    markTourPending();
    navigate('/');
  };

  // ---------- Biometric app-lock ----------
  const handleBiometricToggle = async (nextEnabled: boolean) => {
    if (nextEnabled) {
      // Prove the sensor works before we start gating the app behind it.
      const ok = await promptBiometric('Confirm to turn on the app lock');
      if (!ok) {
        addToast('Biometric check was not completed. App lock stays off.', 'warning');
        return;
      }
    }
    await setBiometricLockEnabled(nextEnabled);
    setBiometricLock(nextEnabled);
    addToast(nextEnabled ? 'App lock enabled.' : 'App lock disabled.', 'info');
  };

  // Handle Theme Preference
  const handleThemeChange = (mode: ThemeMode) => {
    // No toast: the screen repainting is the confirmation.
    setThemeMode(mode);
    persistThemeMode(mode);
  };

  // Handle Profile Update
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      addToast('Display name cannot be empty.', 'error');
      return;
    }

    setIsSavingProfile(true);
    try {
      await apiClient.patch<User>('/profile', {
        display_name: displayName.trim(),
        currency,
        timezone,
      });
      await restoreSession();
      addToast('Profile updated successfully!', 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to update profile.';
      addToast(msg, 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Handle Password Change
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);

    if (!newPassword || !confirmPassword) {
      setPwdError('Please fill in both fields.');
      return;
    }

    if (newPassword.length < 8) {
      setPwdError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPwdError('New password and confirmation password do not match.');
      return;
    }

    setIsChangingPassword(true);
    try {
      // The access token already proves this session owns the account, so the
      // current password is not required.
      await apiClient.post('/profile/change-password', {
        new_password: newPassword,
      });
      addToast('Password changed successfully!', 'success');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordModalOpen(false);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to change password.';
      setPwdError(msg);
    } finally {
      setIsChangingPassword(false);
    }
  };

  // Handle Data Export
  const handleExportData = async () => {
    setIsExporting(true);
    try {
      // The workbook is built server-side, so the app ships no spreadsheet code.
      const res = await apiClient.get<ArrayBuffer>('/profile/export.xlsx', {
        responseType: 'arraybuffer',
      });
      const result = await exportBinaryFile(
        `moneva_export_${new Date().toISOString().slice(0, 10)}.xlsx`,
        res.data,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'MONEVA financial export',
      );
      addToast(result.message, 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to export data.';
      addToast(msg, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Handle Account Deletion
  const handleConfirmDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await apiClient.delete('/profile');
      addToast('Your account and financial data have been deleted.', 'info');
      await logout();
      navigate('/login');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to delete account.';
      addToast(msg, 'error');
      setIsDeletingAccount(false);
      setIsDeleteDialogOpen(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network logout errors
    } finally {
      await logout();
      addToast('Logged out successfully', 'info');
      navigate('/login');
    }
  };

  return (
    <div className="profile-page-container">
      {/* 1. Header Profile Banner */}
      <div className="profile-header-card">
        <div className="profile-avatar-wrap">
          <button
            type="button"
            className="profile-avatar-lg"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAvatarBusy}
            aria-label={user?.avatar_data_url ? 'Change profile picture' : 'Add profile picture'}
          >
            {user?.avatar_data_url ? (
              <img src={user.avatar_data_url} alt="" className="profile-avatar-img" />
            ) : user?.display_name ? (
              user.display_name.charAt(0).toUpperCase()
            ) : (
              <UserIcon size={32} />
            )}
            <span className="profile-avatar-badge">
              <Camera size={13} />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="visually-hidden-input"
            onChange={handleAvatarPick}
          />
          {user?.avatar_data_url && (
            <button
              type="button"
              className="profile-avatar-remove"
              onClick={handleAvatarRemove}
              disabled={isAvatarBusy}
            >
              Remove
            </button>
          )}
        </div>
        <div className="profile-identity">
          <h1 className="heading-lg text-main">{user?.display_name || 'User Profile'}</h1>
          <span className="text-body text-muted">{user?.email}</span>
          <div className="profile-status-pill">
            <CheckCircle2 size={12} className="text-teal" />
            <span>Authenticated Account</span>
          </div>
        </div>
      </div>

      {/* 2. Personal Information & Preferences */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <UserIcon size={18} className="text-blue" />
          <h2 className="heading-md">Personal Information</h2>
        </div>

        <form onSubmit={handleSaveProfile} className="settings-form">
          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">
                <DollarSign size={14} /> Currency
              </label>
              <select
                className="form-select"
                value={currency}
                onChange={(e) => {
                  if (e.target.value !== currency) {
                    setPendingCurrency(e.target.value);
                  }
                }}
              >
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                <Globe size={14} /> Timezone
              </label>
              <select className="form-select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="UTC">UTC (GMT)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="Europe/London">Europe/London (BST)</option>
              </select>
            </div>
          </div>

          <Button type="submit" variant="primary" isLoading={isSavingProfile}>
            Save Profile Changes
          </Button>
        </form>
      </Card>

      {/* 3. Appearance Preference */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <Moon size={18} className="text-violet" />
          <h2 className="heading-md">Appearance</h2>
        </div>

        <div className="appearance-selector">
          <button
            type="button"
            className={`theme-option-btn ${themeMode === 'dark' ? 'active-theme' : ''}`}
            onClick={() => handleThemeChange('dark')}
          >
            <Moon size={20} />
            <span>Dark Mode</span>
          </button>
          <button
            type="button"
            className={`theme-option-btn ${themeMode === 'light' ? 'active-theme' : ''}`}
            onClick={() => handleThemeChange('light')}
          >
            <Sun size={20} />
            <span>Light Mode</span>
          </button>
          <button
            type="button"
            className={`theme-option-btn ${themeMode === 'system' ? 'active-theme' : ''}`}
            onClick={() => handleThemeChange('system')}
          >
            <Laptop size={20} />
            <span>System</span>
          </button>
        </div>
      </Card>

      {/* 4. Notification Preferences */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <Bell size={18} className="text-teal" />
          <h2 className="heading-md">Catching your payments</h2>
        </div>

        <div className="toggles-list">
          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Notifications on this phone</span>
              <span className="toggle-sub">
                {devicePerm === 'granted'
                  ? 'On, even when the app is closed.'
                  : devicePerm === 'denied'
                    ? 'Blocked in Android settings.'
                    : 'Off. Nothing will remind you.'}
              </span>
            </div>
            {devicePerm !== 'granted' && (
              <Button
                variant="primary"
                size="sm"
                className="row-action-btn"
                onClick={() => void handleEnableDeviceNotifications()}
                isLoading={isEnablingPerm}
              >
                Turn on
              </Button>
            )}
          </div>

          {/* Reading payment alerts. Only on Android - there is no
              notification shade to read in a browser. */}
          {isCaptureSupported() && (
            <div className={`toggle-row${captureState.tone === 'ok' ? '' : ` is-${captureState.tone}`}`}>
              <div className="toggle-info">
                <span className="toggle-label">{captureState.headline}</span>
                {/* The subtitle is the health verdict, not a restatement of
                    the switch. A listener the system has killed still reports
                    "capturing", so "On." would be a lie in exactly the case
                    the user most needs to be told about. */}
                <span className="toggle-sub">{captureState.detail}</span>
              </div>
              <Button
                variant={capture.capturing && capture.granted ? 'secondary' : 'primary'}
                size="sm"
                className="row-action-btn"
                onClick={() => setIsPayInboxOpen(true)}
              >
                {capture.capturing && capture.granted ? 'Manage' : 'Set up'}
              </Button>
            </div>
          )}

          {/* The other half of capture. Notification access sees what the
              phone displays; this sees the banks that text and display
              nothing. Adjacent because they are one job, not two features. */}
          <SmsCaptureSection
            onCaptured={() => setIsPayInboxOpen(true)}
            onReadPrivacy={() => setLegalTab('privacy')}
          />

          {/* Only offered once capture is actually working. Offering it while
              nothing is being captured would be a switch with no effect, and a
              user who flips it would reasonably believe payments were being
              handled when none were being seen at all. */}
          {isCaptureSupported() && capture.capturing && capture.granted && (
            <label className="toggle-row">
              <div className="toggle-info">
                <span className="toggle-label">Add payments without asking</span>
                {/* When capture has quietly died, "no payments lately" stops
                    meaning a quiet week and starts meaning nothing is being
                    recorded at all - and somebody who has been told the app
                    handles it is exactly the person who will not check. So the
                    warning is repeated here rather than left to the row above. */}
                <span className="toggle-sub">
                  {autoAdd.enabled && captureState.tone !== 'ok'
                    ? `On, but nothing is reaching MONEVA - so nothing is being added.`
                    : autoAdd.enabled
                      ? `On, up to ₹${(autoAdd.ceilingMinor / 100).toLocaleString('en-IN')} from payment apps. Texts, transfers and bigger amounts still ask.`
                      : `Off. Everything waits for you to tap.`}
                </span>
              </div>
              <input
                type="checkbox"
                className="toggle-checkbox"
                checked={autoAdd.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  const next = { ...autoAdd, enabled };
                  setAutoAdd(next);
                  saveAutoAddSettings(next);
                  /* Turning it off forgets what was learned. Somebody switching
                     this off after it got something wrong means "stop, and do
                     not resume where you left off" - so trust is not merely
                     paused, it is discarded and has to be earned again. */
                  if (!enabled) forgetAllTrust();
                }}
              />
            </label>
          )}

        </div>
      </Card>

      {/* 4b. Reminders - a separate card, because nudging you is a different
          job from noticing your payments, and one heading over both made a
          nine-row wall that nobody reads to the bottom of. */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <Bell size={18} className="text-teal" />
          <h2 className="heading-md">Remind me about</h2>
        </div>

        {/* No subtitles here on purpose. The heading is "Remind me about" and
            each label finishes the sentence, so a line underneath repeating it
            in longer words is noise - which is exactly what "Receive updates
            when achieving savings goal targets" was. */}
        <div className="toggles-list">
          <label className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Bills that are due soon</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifBills}
              disabled={isSavingPrefs}
              onChange={(e) => { setNotifBills(e.target.checked); void savePreference('notif_bills', e.target.checked, setNotifBills); }}
            />
          </label>

          <label className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">A budget running out</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifBudgets}
              disabled={isSavingPrefs}
              onChange={(e) => { setNotifBudgets(e.target.checked); void savePreference('notif_budgets', e.target.checked, setNotifBudgets); }}
            />
          </label>

          <label className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Reaching a savings goal</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifGoals}
              disabled={isSavingPrefs}
              onChange={(e) => { setNotifGoals(e.target.checked); void savePreference('notif_goals', e.target.checked, setNotifGoals); }}
            />
          </label>

          <label className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Payday</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifSalary}
              disabled={isSavingPrefs}
              onChange={(e) => { setNotifSalary(e.target.checked); void savePreference('notif_salary', e.target.checked, setNotifSalary); }}
            />
          </label>
        </div>
      </Card>

      {/* 5. Security */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <ShieldCheck size={18} className="text-coral" />
          <h2 className="heading-md">Security</h2>
        </div>

        <div className="security-status-grid">
          <div className="security-card">
            <span className="sec-label">Password Protection</span>
            <span className="sec-val text-teal">Active (JWT Session)</span>
          </div>
          <div className="security-card">
            <span className="sec-label">App Lock</span>
            <span className={biometricLock ? 'sec-val text-teal' : 'sec-val text-muted'}>
              {biometricLock ? 'On' : 'Off'}
            </span>
          </div>
        </div>

        {/* Change password */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <KeyRound size={14} /> Password
            </span>
            <span className="text-body">Set a new password for this account.</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="row-action-btn"
            onClick={() => { setPwdError(null); setIsPasswordModalOpen(true); }}
          >
            Change
          </Button>
        </div>

        {/* Biometric App Lock */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <Fingerprint size={14} /> Biometric App Lock
            </span>
            <span className="text-body">
              {biometric.available
                ? `Require ${biometric.label} each time MONEVA opens.`
                : biometric.reason || 'No biometric sensor available on this device.'}
            </span>
          </div>
          <input
            type="checkbox"
            className="toggle-checkbox"
            checked={biometricLock}
            disabled={!biometric.available}
            onChange={(e) => void handleBiometricToggle(e.target.checked)}
            aria-label="Biometric app lock"
          />
        </div>
      </Card>

      {/* 6. Your Data */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <Download size={18} className="text-teal" />
          <h2 className="heading-md">Your Data</h2>
        </div>

        {/* Manage categories */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <Tags size={14} /> Categories
            </span>
            <span className="text-body">Rename, add or remove your spending categories.</span>
          </div>
          <Button variant="secondary" size="sm" className="row-action-btn" onClick={handleOpenCategories}>
            Manage
          </Button>
        </div>

        <p className="text-body text-xs text-muted">
          Download an Excel workbook of your financial records &mdash; a sheet each for
          transactions, accounts, budgets, goals, bills, recurring income and
          instalment plans.
        </p>

        <Button variant="secondary" onClick={handleExportData} isLoading={isExporting}>
          <Download size={14} /> Export to Excel
        </Button>

        <p className="text-body text-xs text-muted" style={{ marginTop: 16 }}>
          Bring in history from before you installed MONEVA. Payment alerts can
          only see what happens from now on, so a CSV from your bank is the only
          way to fill in what came before.
        </p>

        <Button
          variant="secondary"
          onClick={async () => {
            try {
              const res = await apiClient.get<Account[]>('/accounts');
              setImportAccounts(res.data);
              setIsImportOpen(true);
            } catch {
              addToast('Could not load your accounts. Try again in a moment.', 'error');
            }
          }}
        >
          <Upload size={14} /> Import a statement
        </Button>
      </Card>

      {/* 6b. Privacy and terms.

          Above Devices & Advanced rather than buried at the very bottom: this
          app asks to read the notification shade and the SMS inbox, and the
          page explaining what happens to that should not be the last thing
          under a fold. It is also linked from the SMS section itself, so it
          can be read BEFORE the permission is granted rather than after. */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <ShieldCheck size={18} className="text-teal" />
          <h2 className="heading-md">Privacy &amp; terms</h2>
        </div>

        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <ShieldCheck size={14} /> What MONEVA does with your data
            </span>
            <span className="text-body">
              Your messages are never stored or sent anywhere. Read the detail,
              including the one thing that does leave your phone.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="row-action-btn"
            onClick={() => setLegalTab('privacy')}
          >
            Read
          </Button>
        </div>

        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <FileText size={14} /> Terms of use
            </span>
            <span className="text-body">
              What MONEVA is, and what it is not. Short.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="row-action-btn"
            onClick={() => setLegalTab('terms')}
          >
            Read
          </Button>
        </div>
      </Card>

      {/* 7. Devices & Advanced */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <MonitorSmartphone size={18} className="text-violet" />
          <h2 className="heading-md">Devices &amp; Advanced</h2>
        </div>

        {/* Revoke every other session */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <MonitorSmartphone size={14} /> Other Devices
            </span>
            <span className="text-body">
              Sign out everywhere else. Use this if you lose a phone &mdash; sessions
              otherwise stay valid for 60 days.
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="row-action-btn"
            isLoading={isSigningOutAll}
            onClick={() => setConfirmSignOutAll(true)}
          >
            {/* "Sign out others", not "Sign out". This button revokes every
                OTHER session and is the more drastic of the two on this page;
                labelling it with the words people look for when they simply
                want to leave made it the one they would reach for first. It
                now matches the wording of its own confirmation dialog. */}
            <LogOut size={14} /> Sign out others
          </Button>
        </div>

        {/* Replay the walkthrough */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <GraduationCap size={14} /> App Tutorial
            </span>
            <span className="text-body">Replay the five-step walkthrough of MONEVA.</span>
          </div>
          <Button variant="secondary" size="sm" className="row-action-btn" onClick={handleReplayTutorial}>
            Replay
          </Button>
        </div>

        {/* The slideshow describes the app; the tour points at it. */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <GraduationCap size={14} /> Guided Tour
            </span>
            <span className="text-body">Let Mo walk you through the real screens, one highlight at a time.</span>
          </div>
          <Button variant="secondary" size="sm" className="row-action-btn" onClick={handleStartTour}>
            Start
          </Button>
        </div>

      </Card>

      {/* 8. Danger Zone */}
      <div className="account-actions-group danger-zone">
        {/* The ordinary one: leave, on this device. Plainly "Sign out" -
            "Sign Out Session" reads like a technical variant of something
            else, which is how it ended up as the harder of the two to find. */}
        <Button variant="secondary" fullWidth onClick={handleLogout}>
          <LogOut size={16} /> Sign out
        </Button>

        <Button variant="danger" fullWidth onClick={() => setIsDeleteDialogOpen(true)}>
          <Trash2 size={16} /> Delete MONEVA Account
        </Button>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {isCategoriesOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Manage categories"
          onClick={() => setIsCategoriesOpen(false)}
        >
          <div className="modal-container categories-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <Tags size={18} className="text-blue" />
                <h2 className="heading-md">Categories</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsCategoriesOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body categories-body">
              <form onSubmit={handleAddCategory} className="category-add-row">
                <input
                  type="text"
                  className="form-input"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  aria-label="New category name"
                />
                <select
                  className="form-select category-type-select"
                  value={newCategoryType}
                  onChange={(e) => setNewCategoryType(e.target.value as 'expense' | 'income')}
                  aria-label="Category type"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
                <Button type="submit" variant="primary" size="sm" isLoading={isSavingCategory}>
                  <Plus size={16} /> Add
                </Button>
              </form>

              <div className="category-filter-tabs">
                <button
                  type="button"
                  className={`filter-tab ${categoryFilter === 'all' ? 'tab-active-all' : ''}`}
                  onClick={() => setCategoryFilter('all')}
                >
                  All ({categories.length})
                </button>
                <button
                  type="button"
                  className={`filter-tab ${categoryFilter === 'expense' ? 'tab-active-expense' : ''}`}
                  onClick={() => setCategoryFilter('expense')}
                >
                  Expense ({expenseCount})
                </button>
                <button
                  type="button"
                  className={`filter-tab ${categoryFilter === 'income' ? 'tab-active-income' : ''}`}
                  onClick={() => setCategoryFilter('income')}
                >
                  Income ({incomeCount})
                </button>
              </div>

              {categories.length > 8 && (
                <div className="category-tools">
                  <div className="category-search">
                    <Search size={15} className="category-search-icon" />
                    <input
                      type="search"
                      className="form-input"
                      value={categoryQuery}
                      onChange={(e) => setCategoryQuery(e.target.value)}
                      placeholder="Search"
                      aria-label="Search categories"
                    />
                  </div>
                  <select
                    className="form-select category-sort-select"
                    value={categorySort}
                    onChange={(e) => setCategorySort(e.target.value as 'custom' | 'az' | 'newest')}
                    aria-label="Sort categories"
                  >
                    <option value="custom">Default</option>
                    <option value="az">A – Z</option>
                    <option value="newest">Newest</option>
                  </select>
                </div>
              )}

              {isLoadingCategories ? (
                <p className="text-body">Loading categories...</p>
              ) : categories.length === 0 ? (
                <p className="text-body">No categories yet. Add your first one above.</p>
              ) : (
                categoryGroups.map((group) => (
                  <section key={group.type} className="category-group">
                    <header className={`category-group-head group-${group.type}`}>
                      <h3 className="category-group-title">{group.label}</h3>
                      <span className="category-group-count">{group.items.length}</span>
                    </header>

                    {group.items.length === 0 ? (
                      <p className="category-group-empty">
                        {categoryQuery
                          ? `No ${group.label.toLowerCase()} category matches "${categoryQuery}".`
                          : `No ${group.label.toLowerCase()} categories yet.`}
                      </p>
                    ) : (
                      <ul className="category-list">
                        {group.items.map((c) => {
                          const Icon = categoryIcon(c.icon);
                          return (
                            <li key={c.id} className="category-item">
                              {editingCategoryId === c.id ? (
                                <>
                                  <input
                                    type="text"
                                    className="form-input"
                                    value={editingCategoryName}
                                    onChange={(e) => setEditingCategoryName(e.target.value)}
                                    aria-label={`Rename ${c.name}`}
                                    autoFocus
                                  />
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    isLoading={isSavingCategory}
                                    onClick={() => void handleRenameCategory(c.id)}
                                  >
                                    Save
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => setEditingCategoryId(null)}>
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <span
                                    className="category-icon"
                                    style={{
                                      color: c.color || 'var(--moneva-text-secondary)',
                                      backgroundColor: c.color ? `${c.color}22` : 'var(--moneva-bg)',
                                    }}
                                    aria-hidden="true"
                                  >
                                    <Icon size={15} />
                                  </span>
                                  <span className="category-name">{c.name}</span>
                                  <button
                                    type="button"
                                    className="card-action-btn"
                                    onClick={() => { setEditingCategoryId(c.id); setEditingCategoryName(c.name); }}
                                    aria-label={`Rename ${c.name}`}
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    className="card-action-btn btn-danger"
                                    onClick={() => setPendingDeleteCategory({ id: c.id, name: c.name })}
                                    aria-label={`Delete ${c.name}`}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {pendingCurrency && (
        <div
          className="modal-overlay pwd-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Change currency"
          onClick={() => setPendingCurrency(null)}
        >
          <div className="modal-container pwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <DollarSign size={18} className="text-orange" />
                <h2 className="heading-md">Change to {pendingCurrency}?</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPendingCurrency(null)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <div className="settings-form pwd-modal-body">
              <div className="currency-warning">
                Every amount you have saved will be converted from {currency} to
                {' '}{pendingCurrency} at today&apos;s exchange rate. This rewrites your
                transactions, budgets, goals and bills, and cannot be undone.
              </div>

              <Button
                variant="danger"
                fullWidth
                isLoading={isChangingCurrency}
                onClick={() => void handleConfirmCurrency()}
              >
                Yes, convert to {pendingCurrency}
              </Button>
              <Button variant="ghost" fullWidth onClick={() => setPendingCurrency(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {isPasswordModalOpen && (
        <div
          className="modal-overlay pwd-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Change password"
          onClick={() => setIsPasswordModalOpen(false)}
        >
          <div className="modal-container pwd-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <KeyRound size={18} className="text-blue" />
                <h2 className="heading-md">Change Password</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsPasswordModalOpen(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleChangePassword} className="settings-form pwd-modal-body">
              {pwdError && <div className="form-error-banner">{pwdError}</div>}

              <div className="form-group">
                <label className="form-label" htmlFor="pwd-new">New Password</label>
                <input
                  id="pwd-new"
                  type="password"
                  className="form-input"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="pwd-confirm">Confirm New Password</label>
                <input
                  id="pwd-confirm"
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" variant="primary" fullWidth isLoading={isChangingPassword}>
                <KeyRound size={16} /> Update Password
              </Button>
            </form>
          </div>
        </div>
      )}

      <ConfirmationDialog
        isOpen={!!pendingDeleteCategory}
        title="Delete this category?"
        message={`"${pendingDeleteCategory?.name ?? ''}" will be removed. Transactions already filed under it are kept, but they become uncategorised.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDeleteCategory) {
            void handleDeleteCategory(pendingDeleteCategory.id, pendingDeleteCategory.name);
          }
        }}
        onClose={() => setPendingDeleteCategory(null)}
        isLoading={isSavingCategory}
      />

      <ConfirmationDialog
        isOpen={confirmSignOutAll}
        title="Sign out other devices?"
        message="Every other phone or browser signed in to this account will be signed out immediately. This device stays signed in."
        confirmLabel="Sign out others"
        onConfirm={() => void handleSignOutAllDevices()}
        onClose={() => setConfirmSignOutAll(false)}
        isLoading={isSigningOutAll}
      />

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete MONEVA Account"
        message="Are you sure you want to permanently delete your MONEVA account and all associated financial records? This action cannot be undone."
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmDeleteAccount}
        onClose={() => setIsDeleteDialogOpen(false)}
        isLoading={isDeletingAccount}
      />

      {/* Mounted only while open, so each visit starts from a fresh read of
          the permission state and the queue rather than whatever was on
          screen last time. */}
      {isPayInboxOpen && (
        <PaymentInbox
          isOpen
          onClose={() => setIsPayInboxOpen(false)}
          onSuccess={() => addToast('Payment added.', 'success')}
        />
      )}

      {/* Same reason as above: it holds a parsed file and the outcome of the
          last run, and neither should still be on screen the next time it is
          opened. */}
      {legalTab && (
        <LegalSheet
          isOpen
          initial={legalTab}
          onClose={() => setLegalTab(null)}
        />
      )}

      {isImportOpen && (
        <ImportSheet
          isOpen
          onClose={() => setIsImportOpen(false)}
          onImported={() => { void restoreSession(); }}
          accounts={importAccounts}
        />
      )}
    </div>
  );
};
