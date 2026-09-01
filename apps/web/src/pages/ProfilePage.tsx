import React, { useState, useEffect } from 'react';
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
  Server,
  Camera,
  Fingerprint,
  ShieldOff,
  GraduationCap,
} from 'lucide-react';
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
import { apiClient, getApiBaseUrl, getDefaultApiBaseUrl, setApiBaseUrl } from '../services/apiClient';
import type { User } from '../types/api';
import { TwoFactorSetupModal } from '../components/settings/TwoFactorSetupModal';
import { fileToAvatarDataUrl, uploadAvatar, deleteAvatar } from '../services/avatarService';
import { disableTotp } from '../services/twoFactorService';
import {
  getBiometricStatus,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
  promptBiometric,
} from '../services/biometricService';
import type { BiometricStatus } from '../services/biometricService';
import { markOnboardingPending } from '../services/onboardingService';
import { exportJsonFile } from '../services/exportService';
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

  // Notification Preferences State
  const [notifBills, setNotifBills] = useState<boolean>(true);
  const [notifBudgets, setNotifBudgets] = useState<boolean>(true);
  const [notifGoals, setNotifGoals] = useState<boolean>(true);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  // Data Export & Account Deletion State
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState<boolean>(false);

  // Avatar
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isAvatarBusy, setIsAvatarBusy] = useState<boolean>(false);

  // Two-factor
  const [isTfaModalOpen, setIsTfaModalOpen] = useState<boolean>(false);
  const [isDisablingTfa, setIsDisablingTfa] = useState<boolean>(false);
  const [showDisableTfa, setShowDisableTfa] = useState<boolean>(false);
  const [disableTfaPassword, setDisableTfaPassword] = useState<string>('');
  const [disableTfaCode, setDisableTfaCode] = useState<string>('');

  // Biometric app-lock
  const [biometric, setBiometric] = useState<BiometricStatus>({ available: false, label: null, reason: null });
  const [biometricLock, setBiometricLock] = useState<boolean>(false);

  // API endpoint override - lets a DHCP address change be fixed in-app.
  const [apiUrlInput, setApiUrlInput] = useState<string>(getApiBaseUrl);
  const [isSavingApiUrl, setIsSavingApiUrl] = useState<boolean>(false);

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
  const handleTfaEnabled = async () => {
    try {
      await restoreSession();
      addToast('Two-factor authentication is now on.', 'success');
    } catch {
      addToast('2FA enabled, but the profile could not be refreshed.', 'warning');
    }
  };

  const handleDisableTfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDisablingTfa(true);
    try {
      await disableTotp(disableTfaPassword, disableTfaCode.trim());
      await restoreSession();
      setShowDisableTfa(false);
      setDisableTfaPassword('');
      setDisableTfaCode('');
      addToast('Two-factor authentication disabled.', 'info');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not disable two-factor authentication.', 'error');
    } finally {
      setIsDisablingTfa(false);
    }
  };

  const handleReplayTutorial = () => {
    markOnboardingPending();
    addToast('Tutorial will start now.', 'info');
    navigate('/');
  };

  const handleSaveApiUrl = async () => {
    const next = apiUrlInput.trim();
    if (!/^https?:\/\/.+/i.test(next)) {
      addToast('Enter a full URL, e.g. http://192.168.1.19:8000/api', 'error');
      return;
    }
    setIsSavingApiUrl(true);
    try {
      setApiBaseUrl(next);
      // Prove the new endpoint answers before declaring success.
      await apiClient.get('/health');
      addToast('Connected to the new server.', 'success');
      await restoreSession();
    } catch {
      addToast('Could not reach that server. The address is saved; check it is running.', 'warning');
    } finally {
      setIsSavingApiUrl(false);
    }
  };

  const handleResetApiUrl = async () => {
    setApiBaseUrl(null);
    setApiUrlInput(getDefaultApiBaseUrl());
    addToast('Reset to the built-in server address.', 'info');
    await restoreSession();
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
    setThemeMode(mode);
    persistThemeMode(mode);
    addToast(`Appearance preference set to ${mode.toUpperCase()}`, 'info');
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

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPwdError('Please complete all password fields.');
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
      await apiClient.post('/profile/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      addToast('Password changed successfully!', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
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
      const res = await apiClient.get('/profile/export');
      const result = await exportJsonFile(
        `moneva_financial_export_${new Date().toISOString().slice(0, 10)}.json`,
        res.data,
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
              <select className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
          <h2 className="heading-md">Notification Preferences</h2>
        </div>

        <div className="toggles-list">
          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Upcoming Bill Reminders</span>
              <span className="toggle-sub">Receive alerts for bills due soon.</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifBills}
              onChange={(e) => setNotifBills(e.target.checked)}
            />
          </div>

          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Budget Limit Warnings</span>
              <span className="toggle-sub">Receive alerts when approaching category budget limits.</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifBudgets}
              onChange={(e) => setNotifBudgets(e.target.checked)}
            />
          </div>

          <div className="toggle-row">
            <div className="toggle-info">
              <span className="toggle-label">Savings Goal Milestones</span>
              <span className="toggle-sub">Receive updates when achieving savings goal targets.</span>
            </div>
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={notifGoals}
              onChange={(e) => setNotifGoals(e.target.checked)}
            />
          </div>
        </div>
      </Card>

      {/* 5. Security & Change Password */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <ShieldCheck size={18} className="text-coral" />
          <h2 className="heading-md">Security & Password</h2>
        </div>

        {/* Security Status */}
        <div className="security-status-grid">
          <div className="security-card">
            <span className="sec-label">Password Protection</span>
            <span className="sec-val text-teal">Active (JWT Session)</span>
          </div>
          <div className="security-card">
            <span className="sec-label">Two-Factor (TOTP)</span>
            <span className={user?.totp_enabled ? 'sec-val text-teal' : 'sec-val text-muted'}>
              {user?.totp_enabled ? 'Enabled' : 'Not enabled'}
            </span>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">Authenticator App</span>
            <span className="text-body">
              {user?.totp_enabled
                ? 'A code from your authenticator app is required at every sign-in.'
                : 'Require a rotating 6-digit code in addition to your password.'}
            </span>
          </div>
          {user?.totp_enabled ? (
            <Button variant="danger" size="sm" onClick={() => setShowDisableTfa((v) => !v)}>
              <ShieldOff size={15} />
              Disable
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setIsTfaModalOpen(true)}>
              <ShieldCheck size={15} />
              Enable
            </Button>
          )}
        </div>

        {showDisableTfa && user?.totp_enabled && (
          <form onSubmit={handleDisableTfa} className="settings-form tfa-disable-form">
            <p className="text-body">Confirm with your password and a current code.</p>
            <div className="form-group">
              <label className="form-label">Account Password</label>
              <input
                type="password"
                className="form-input"
                value={disableTfaPassword}
                onChange={(e) => setDisableTfaPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Authenticator or Recovery Code</label>
              <input
                type="text"
                className="form-input"
                value={disableTfaCode}
                onChange={(e) => setDisableTfaCode(e.target.value)}
                autoComplete="one-time-code"
                maxLength={9}
                placeholder="123456"
              />
            </div>
            <Button type="submit" variant="danger" fullWidth isLoading={isDisablingTfa}>
              Confirm &amp; Disable 2FA
            </Button>
          </form>
        )}

        {/* Replay the walkthrough */}
        <div className="security-feature-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <GraduationCap size={14} /> App Tutorial
            </span>
            <span className="text-body">Replay the five-step walkthrough of MONEVA.</span>
          </div>
          <Button variant="secondary" size="sm" onClick={handleReplayTutorial}>
            Replay
          </Button>
        </div>

        {/* Server endpoint - avoids a rebuild when the dev machine's IP changes */}
        <div className="security-feature-row api-url-row">
          <div className="security-feature-copy">
            <span className="sec-label">
              <Server size={14} /> Server Address
            </span>
            <span className="text-body">
              Where this app sends its data. Change it if your computer's IP moves.
            </span>
            <div className="api-url-controls">
              <input
                type="url"
                inputMode="url"
                className="form-input"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                placeholder="http://192.168.1.19:8000/api"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label="API server address"
              />
              <div className="api-url-actions">
                <Button variant="primary" size="sm" onClick={handleSaveApiUrl} isLoading={isSavingApiUrl}>
                  Save &amp; Test
                </Button>
                <Button variant="ghost" size="sm" onClick={handleResetApiUrl}>
                  Reset
                </Button>
              </div>
            </div>
          </div>
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

        <form onSubmit={handleChangePassword} className="settings-form mt-3">
          <h3 className="heading-xs text-main">Change Password</h3>
          {pwdError && <div className="form-error-banner">{pwdError}</div>}

          <div className="form-group">
            <label className="form-label">Current Password</label>
            <input
              type="password"
              className="form-input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input
                type="password"
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
              />
            </div>
          </div>

          <Button type="submit" variant="secondary" isLoading={isChangingPassword}>
            <KeyRound size={14} /> Update Password
          </Button>
        </form>
      </Card>

      {/* 6. Data & Privacy */}
      <Card variant="surface" className="settings-section-card">
        <div className="section-header">
          <Download size={18} className="text-teal" />
          <h2 className="heading-md">Data & Privacy</h2>
        </div>
        <p className="text-body text-xs text-muted">
          Download a complete JSON export of your financial records including accounts, transactions, budgets, goals, and bills.
        </p>

        <Button variant="secondary" onClick={handleExportData} isLoading={isExporting}>
          <Download size={14} /> Export Financial Data (JSON)
        </Button>
      </Card>

      {/* 7. Sign Out & Account Deletion */}
      <div className="account-actions-group">
        <Button variant="secondary" fullWidth onClick={handleLogout}>
          <LogOut size={16} /> Sign Out Session
        </Button>

        <Button variant="danger" fullWidth onClick={() => setIsDeleteDialogOpen(true)}>
          <Trash2 size={16} /> Delete MONEVA Account
        </Button>
      </div>

      {/* Delete Account Confirmation Dialog */}
      {isTfaModalOpen && (
        <TwoFactorSetupModal
          onClose={() => setIsTfaModalOpen(false)}
          onEnabled={handleTfaEnabled}
        />
      )}

      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        title="Delete MONEVA Account"
        message="Are you sure you want to permanently delete your MONEVA account and all associated financial records? This action cannot be undone."
        confirmLabel="Permanently Delete"
        onConfirm={handleConfirmDeleteAccount}
        onClose={() => setIsDeleteDialogOpen(false)}
        isLoading={isDeletingAccount}
      />
    </div>
  );
};
