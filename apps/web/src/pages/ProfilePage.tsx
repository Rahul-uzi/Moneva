import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BellRing,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Compass,
  Download,
  FileText,
  Fingerprint,
  Globe,
  IndianRupee,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MessageSquareText,
  MonitorSmartphone,
  RotateCcw,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { UpdateRow } from '../components/settings/UpdateRow';
import { LegalSheet } from '../components/settings/LegalSheet';
import { ImportSheet } from '../components/financial/ImportSheet';
import { PaymentInbox } from '../components/financial/PaymentInbox';
import { ProfileSheet } from '../components/profile/ProfileSheet';
import { SettingsGroup, SettingsRow, SwitchRow } from '../components/profile/ProfileRows';
import { ThemePill } from '../components/profile/ThemePill';
import { EmailPanel } from '../components/profile/EmailPanel';
import { CategoriesPanel } from '../components/profile/CategoriesPanel';
import { CatchingPanel } from '../components/profile/CatchingPanel';
import { useCaptureSettings } from '../components/profile/useCaptureSettings';
import { getStoredThemeMode, setThemeMode as persistThemeMode, type ThemeMode } from '../services/themeService';
import { useAuthStore } from '../stores/useAuthStore';
import { useUiStore } from '../stores/useUiStore';
import { apiClient, describeApiError, setStoredTokens } from '../services/apiClient';
import { fileToAvatarDataUrl, uploadAvatar, deleteAvatar } from '../services/avatarService';
import {
  getBiometricStatus,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
  promptBiometric,
  type BiometricStatus,
} from '../services/biometricService';
import { markOnboardingPending } from '../services/onboardingService';
import { markTourPending } from '../services/tourService';
import { exportBinaryFile } from '../services/exportService';
import { currentVersionName } from '../services/updateCheck';
import { planRecategorise, type Proposal } from '../utils/recategorise';
import type { Account, Category, Transaction, User } from '../types/api';
import './ProfilePage.css';

type SheetId =
  | 'photo' | 'details' | 'email' | 'currency' | 'timezone' | 'categories' | 'catching'
  | 'reminders' | 'password' | 'others' | 'export' | 'recheck' | 'privacy' | 'signout' | 'delete';

const TITLES: Record<SheetId, string> = {
  photo: 'Profile picture',
  details: 'Your details',
  email: 'Your email',
  currency: 'Currency',
  timezone: 'Time zone',
  categories: 'Categories',
  catching: 'Catching payments',
  reminders: 'Remind me about',
  password: 'Change password',
  others: 'Sign out other devices?',
  export: 'Export to Excel',
  recheck: 'Re-check categories',
  privacy: 'Privacy and terms',
  signout: 'Sign out?',
  delete: 'Delete MONEVA account',
};

const CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
];

const ZONES = [
  { id: 'Asia/Kolkata', label: 'India', sub: 'Asia/Kolkata · IST' },
  { id: 'UTC', label: 'UTC', sub: 'Coordinated Universal Time' },
  { id: 'America/New_York', label: 'New York', sub: 'America/New_York · EST' },
  { id: 'Europe/London', label: 'London', sub: 'Europe/London · BST' },
];

type PrefKey = 'notif_bills' | 'notif_budgets' | 'notif_goals' | 'notif_salary';
const REMINDERS: { key: PrefKey; label: string }[] = [
  { key: 'notif_bills', label: 'Bills that are due soon' },
  { key: 'notif_budgets', label: 'A budget running out' },
  { key: 'notif_goals', label: 'Reaching a savings goal' },
  { key: 'notif_salary', label: 'Payday' },
];

const EXPORT_SHEETS = ['Transactions', 'Accounts', 'Budgets', 'Goals', 'Bills', 'Recurring income', 'Instalment plans'];

type Recheck = { status: 'reading' } | { status: 'none' } | { status: 'failed' } | { status: 'plan'; plan: Proposal[] };

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, restoreSession, logout } = useAuthStore();
  const { addToast } = useUiStore();

  const [sheet, setSheet] = useState<SheetId | null>(null);
  const [sheetTitle, setSheetTitle] = useState('');
  const openSheet = (id: SheetId) => { setSheet(id); setSheetTitle(TITLES[id]); };
  const closeSheet = () => setSheet(null);

  // Things that open on top of the page in their own sheets.
  const [isPayInboxOpen, setIsPayInboxOpen] = useState(false);
  const [legalTab, setLegalTab] = useState<'privacy' | 'terms' | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importAccounts, setImportAccounts] = useState<Account[]>([]);

  const capture = useCaptureSettings(isPayInboxOpen);

  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredThemeMode);

  // ---------------------------------------------------------------- reminders
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    notif_bills: true, notif_budgets: true, notif_goals: true, notif_salary: true,
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await apiClient.get<Record<PrefKey, boolean>>('/notifications/preferences');
        if (active) setPrefs((p) => ({ ...p, ...res.data }));
      } catch {
        // Keep the defaults; the next switch still writes through.
      }
    })();
    return () => { active = false; };
  }, []);
  const savePreference = async (key: PrefKey, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    try {
      await apiClient.patch('/notifications/preferences', { [key]: value });
    } catch {
      // Put the switch back so it never claims a setting that did not save.
      setPrefs((p) => ({ ...p, [key]: !value }));
      addToast('Could not save that reminder.', 'error');
    }
  };

  // --------------------------------------------------------------- categories
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
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
  useEffect(() => {
    let active = true;
    apiClient.get<Category[]>('/categories').then((res) => { if (active) setCategories(res.data); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // ------------------------------------------------------------- app lock
  const [biometric, setBiometric] = useState<BiometricStatus>({ available: false, label: null, reason: null });
  const [biometricLock, setBiometricLock] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [status, enabled] = await Promise.all([getBiometricStatus(), isBiometricLockEnabled()]);
      if (!active) return;
      setBiometric(status);
      setBiometricLock(enabled);
    })();
    return () => { active = false; };
  }, []);
  const toggleAppLock = async (next: boolean) => {
    if (next) {
      // Prove the sensor works before the app is gated behind it.
      const ok = await promptBiometric('Confirm to turn on the app lock');
      if (!ok) {
        addToast('The fingerprint check was not completed. App lock stays off.', 'warning');
        return;
      }
    }
    await setBiometricLockEnabled(next);
    setBiometricLock(next);
    addToast(next ? 'App lock is on.' : 'App lock is off.', 'info');
  };

  // --------------------------------------------------------------- details
  const [displayName, setDisplayName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setIsSavingName(true);
    try {
      await apiClient.patch<User>('/profile', { display_name: name });
      await restoreSession();
      closeSheet();
      addToast('Saved.', 'success');
    } catch (err) {
      addToast(describeApiError(err, 'Could not save your name.'), 'error');
    } finally {
      setIsSavingName(false);
    }
  };

  // ------------------------------------------------------- currency + zone
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const [isChangingCurrency, setIsChangingCurrency] = useState(false);
  const confirmCurrency = async () => {
    if (!pendingCurrency || !user) return;
    setIsChangingCurrency(true);
    try {
      // No rate is sent: the API converts at the live rate and says which one.
      const res = await apiClient.post<{ rows_updated: number; rate: number | null }>(
        '/profile/currency', { currency: pendingCurrency, convert: true },
      );
      const from = user.currency;
      await restoreSession();
      addToast(`Converted ${res.data.rows_updated} amounts at 1 ${from} = ${res.data.rate} ${pendingCurrency}.`, 'success');
      setPendingCurrency(null);
      closeSheet();
    } catch (err) {
      addToast(describeApiError(err, 'Could not change the currency.'), 'error');
    } finally {
      setIsChangingCurrency(false);
    }
  };

  const [savingZone, setSavingZone] = useState<string | null>(null);
  const chooseZone = async (zone: string) => {
    if (zone === user?.timezone) { closeSheet(); return; }
    setSavingZone(zone);
    try {
      await apiClient.patch<User>('/profile', { timezone: zone });
      await restoreSession();
      closeSheet();
      addToast('Time zone saved.', 'success');
    } catch (err) {
      addToast(describeApiError(err, 'Could not change the time zone.'), 'error');
    } finally {
      setSavingZone(null);
    }
  };

  // ---------------------------------------------------------------- photo
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAvatarBusy, setIsAvatarBusy] = useState(false);
  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset at once so picking the same file twice still fires.
    e.target.value = '';
    if (!file) return;
    setIsAvatarBusy(true);
    try {
      await uploadAvatar(await fileToAvatarDataUrl(file));
      await restoreSession();
      closeSheet();
      addToast('Profile picture updated.', 'success');
    } catch (err) {
      addToast(describeApiError(err, (err as Error).message || 'Could not update your picture.'), 'error');
    } finally {
      setIsAvatarBusy(false);
    }
  };
  const removeAvatar = async () => {
    setIsAvatarBusy(true);
    try {
      await deleteAvatar();
      await restoreSession();
      closeSheet();
      addToast('Profile picture removed.', 'info');
    } catch (err) {
      addToast(describeApiError(err, 'Could not remove your picture.'), 'error');
    } finally {
      setIsAvatarBusy(false);
    }
  };

  // ------------------------------------------------------------- password
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPassword.length < 8) { setPwdError('Use at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setPwdError('The two passwords are different. Type the same one twice.'); return; }
    setIsChangingPassword(true);
    try {
      // The session already proves this device owns the account.
      await apiClient.post('/profile/change-password', { new_password: newPassword });
      setNewPassword('');
      setConfirmPassword('');
      closeSheet();
      addToast('Password changed.', 'success');
    } catch (err) {
      setPwdError(describeApiError(err, 'Could not change the password.'));
    } finally {
      setIsChangingPassword(false);
    }
  };

  // ------------------------------------------------------------- sessions
  const [isSigningOutAll, setIsSigningOutAll] = useState(false);
  const signOutOthers = async () => {
    setIsSigningOutAll(true);
    try {
      const res = await apiClient.post<{ tokens: { access_token: string; refresh_token: string; token_type: string; expires_in: number } }>(
        '/auth/logout-all',
      );
      // A fresh pair comes back so this device is not signed out too.
      if (res.data?.tokens) setStoredTokens(res.data.tokens);
      closeSheet();
      addToast('Signed out on every other device.', 'success');
    } catch (err) {
      addToast(describeApiError(err, 'Could not sign out other devices.'), 'error');
    } finally {
      setIsSigningOutAll(false);
    }
  };

  const signOut = async () => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Signing out here still works if the server cannot be reached.
    } finally {
      await logout();
      addToast('Signed out.', 'info');
      navigate('/login');
    }
  };

  // ------------------------------------------------------------------ data
  const [isExporting, setIsExporting] = useState(false);
  const exportData = async () => {
    setIsExporting(true);
    try {
      // The workbook is built server-side, so the app ships no spreadsheet code.
      const res = await apiClient.get<ArrayBuffer>('/profile/export.xlsx', { responseType: 'arraybuffer' });
      const result = await exportBinaryFile(
        `moneva_export_${new Date().toISOString().slice(0, 10)}.xlsx`,
        res.data,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'MONEVA financial export',
      );
      closeSheet();
      addToast(result.message, 'success');
    } catch (err) {
      addToast(describeApiError(err, 'Could not export your data.'), 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const openImport = async () => {
    try {
      const res = await apiClient.get<Account[]>('/accounts');
      setImportAccounts(res.data);
      setIsImportOpen(true);
    } catch {
      addToast('Could not load your accounts. Try again in a moment.', 'error');
    }
  };

  /* Re-reading what a wrong matcher filed. It never writes without showing
     the list first: a bulk edit nobody saw is how somebody stops trusting an
     app that holds their money. */
  const [recheck, setRecheck] = useState<Recheck>({ status: 'reading' });
  const [recatSaved, setRecatSaved] = useState(0);
  const [isApplying, setIsApplying] = useState(false);
  const startRecheck = async () => {
    setRecheck({ status: 'reading' });
    openSheet('recheck');
    try {
      const [txRes, catRes] = await Promise.all([
        apiClient.get<Transaction[]>('/transactions', { params: { limit: 500 } }),
        apiClient.get<Category[]>('/categories'),
      ]);
      const plan = planRecategorise(txRes.data, catRes.data);
      setRecheck(plan.length ? { status: 'plan', plan } : { status: 'none' });
    } catch {
      setRecheck({ status: 'failed' });
    }
  };
  const applyRecheck = async (plan: Proposal[]) => {
    setIsApplying(true);
    let ok = 0;
    try {
      /* One at a time, on purpose: there is no bulk endpoint, and five hundred
         PATCHes at once at a free-tier instance turns a repair into an outage. */
      for (const p of plan) {
        try {
          await apiClient.patch(`/transactions/${p.id}`, { category_id: p.toId });
          ok += 1;
          setRecatSaved(ok);
        } catch {
          // Skip this one and keep going: a partial repair beats none.
        }
      }
      addToast(
        ok === plan.length ? `${ok} expenses re-filed.` : `${ok} of ${plan.length} re-filed. Run it again for the rest.`,
        ok > 0 ? 'success' : 'error',
      );
      closeSheet();
    } finally {
      setIsApplying(false);
      setRecatSaved(0);
    }
  };

  const [deleteWord, setDeleteWord] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const deleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await apiClient.delete('/profile');
      addToast('Your account and financial data have been deleted.', 'info');
      await logout();
      navigate('/login');
    } catch (err) {
      addToast(describeApiError(err, 'Could not delete the account.'), 'error');
      setIsDeletingAccount(false);
    }
  };

  // ------------------------------------------------------------------ help
  const replayTutorial = () => {
    markOnboardingPending();
    navigate('/');
  };
  const startTour = () => {
    markTourPending();
    navigate('/');
  };

  // --------------------------------------------------------------- summary
  const verified = !!user?.email_verified;
  const currency = CURRENCIES.find((c) => c.code === user?.currency);
  const zone = ZONES.find((z) => z.id === user?.timezone);
  const remindersOn = REMINDERS.filter((r) => prefs[r.key]).length;
  const initial = (user?.display_name || '?').trim().charAt(0).toUpperCase() || '?';

  const capturing = capture.capture.granted && capture.capture.capturing;
  const catchValue = !capture.supported ? undefined
    : !capturing ? 'Off'
      : capture.health.state === 'disconnected' ? 'Stopped'
        : capture.health.tone === 'ok' ? 'On' : 'Check';
  const catchTone = catchValue === 'On' ? 'on' : catchValue === 'Stopped' || catchValue === 'Check' ? 'warn' : undefined;
  const catchSub = !capture.supported ? 'Works in the Android app'
    : !capturing ? 'Reads bank alerts and texts for you'
      : capture.health.state === 'disconnected' ? 'New payments are being missed'
        : capture.autoAdd.enabled ? 'Small payments are added for you'
          : 'You confirm each payment';

  // Entry motion, in reading order whichever layout is showing.
  let n = 0;
  const enter = () => ({ className: 'pf-enter', style: { '--n': Math.min(n++, 8) } as React.CSSProperties });

  const openDetails = () => {
    setDisplayName(user?.display_name ?? '');
    openSheet('details');
  };

  return (
    <div className="pf-page">
      <div className="pf-cols">
        <div className="pf-col pf-col-a">
          <header {...enter()} className="pf-enter pf-top">
            <h1 className="heading-lg">Profile</h1>
            <span className="pf-ver">v{currentVersionName()}</span>
          </header>

          <div {...enter()} className="pf-enter pf-me">
            <button
              type="button"
              className="pf-avatar-btn"
              onClick={() => openSheet('photo')}
              aria-label={user?.avatar_data_url ? 'Change profile picture' : 'Add profile picture'}
            >
              <span className="pf-avatar">
                {user?.avatar_data_url ? <img src={user.avatar_data_url} alt="" /> : initial}
              </span>
              <span className="pf-cam" aria-hidden="true"><Camera size={12} /></span>
            </button>
            <button type="button" className="pf-me-text" onClick={openDetails} aria-label="Your details. Edit">
              <span className="pf-me-col">
                <span className="pf-me-name">{user?.display_name || 'Your name'}</span>
                <span className="pf-me-mail">{user?.email}</span>
                <span className={`pf-badge${verified ? '' : ' is-warn'}`}>
                  {verified ? <Check size={12} strokeWidth={2.6} /> : <CircleAlert size={12} />}
                  {verified ? 'Email verified' : 'Email not verified'}
                </span>
              </span>
              <ChevronRight className="pf-chev" size={16} aria-hidden="true" />
            </button>
          </div>

          {!verified && user && (
            <button {...enter()} type="button" className="pf-enter pf-nudge" onClick={() => openSheet('email')}>
              <span className="pf-ico" aria-hidden="true"><Mail /></span>
              <span className="pf-row-text">
                <span className="pf-row-title">Confirm your email</span>
                <span className="pf-row-sub">So you can reset your password if you forget it</span>
              </span>
              <span className="pf-nudge-go">Verify</span>
            </button>
          )}

          <section {...enter()} className="pf-enter pf-group" aria-label="Appearance">
            <h2 className="pf-group-label">Appearance</h2>
            <div className="pf-theme" data-pill-card>
              <ThemePill
                mode={themeMode}
                onChange={(m) => { setThemeModeState(m); persistThemeMode(m); }}
              />
            </div>
          </section>
        </div>

        <div className="pf-col pf-col-b">
          <div {...enter()}>
            <SettingsGroup label="Money">
              <SettingsRow
                icon={<IndianRupee />}
                title="Currency"
                value={currency ? `${currency.symbol} ${currency.code}` : user?.currency}
                onClick={() => { setPendingCurrency(null); openSheet('currency'); }}
              />
              <SettingsRow icon={<Globe />} title="Time zone" value={zone?.label ?? user?.timezone} onClick={() => openSheet('timezone')} />
              <SettingsRow
                icon={<Tags />}
                title="Categories"
                sub="Rename, add or remove"
                value={categories.length || undefined}
                onClick={() => { openSheet('categories'); void loadCategories(); }}
              />
            </SettingsGroup>
          </div>

          <div {...enter()}>
            <SettingsGroup label="Automatic">
              <SettingsRow
                icon={<MessageSquareText />}
                title="Catching payments"
                sub={catchSub}
                value={catchValue}
                valueTone={catchTone}
                onClick={() => openSheet('catching')}
              />
              <SettingsRow
                icon={<BellRing />}
                title="Reminders"
                value={remindersOn ? `${remindersOn} on` : 'Off'}
                onClick={() => openSheet('reminders')}
              />
            </SettingsGroup>
          </div>

          <div {...enter()}>
            <SettingsGroup label="Security">
              <SettingsRow
                icon={verified ? <MailCheck /> : <Mail />}
                title="Email"
                sub={user?.email}
                value={verified ? 'Verified' : 'Verify'}
                valueTone={verified ? 'on' : 'warn'}
                onClick={() => openSheet('email')}
              />
              <SwitchRow
                icon={<Fingerprint />}
                title="App lock"
                sub={biometric.available
                  ? `Require ${biometric.label ?? 'fingerprint'} each time MONEVA opens`
                  : biometric.reason || 'No fingerprint sensor on this phone'}
                checked={biometric.available && biometricLock}
                disabled={!biometric.available}
                onChange={(v) => void toggleAppLock(v)}
              />
              <SettingsRow
                icon={<KeyRound />}
                title="Password"
                sub="Set a new password for this account"
                onClick={() => { setPwdError(null); openSheet('password'); }}
              />
              <SettingsRow
                icon={<MonitorSmartphone />}
                title="Sign out other devices"
                sub="Use this if you lose a phone"
                onClick={() => openSheet('others')}
              />
            </SettingsGroup>
          </div>

          <div {...enter()}>
            <SettingsGroup label="Your data">
              <SettingsRow icon={<Download />} title="Export to Excel" sub="A sheet for each part of your records" onClick={() => openSheet('export')} />
              <SettingsRow icon={<Upload />} title="Import a statement" sub="Bring in history from before MONEVA" onClick={() => void openImport()} />
              <SettingsRow icon={<Wand2 />} title="Re-check categories" sub="Find expenses filed in the wrong place" onClick={() => void startRecheck()} />
              <SettingsRow icon={<ShieldCheck />} title="Privacy and terms" onClick={() => openSheet('privacy')} />
            </SettingsGroup>
          </div>

          <div {...enter()}>
            <SettingsGroup label="App">
              <UpdateRow />
              <SettingsRow icon={<RotateCcw />} title="Replay the walkthrough" sub="The five-step tour of MONEVA" onClick={replayTutorial} />
              <SettingsRow icon={<Compass />} title="Guided tour" sub="Mo walks you through the real screens" onClick={startTour} />
            </SettingsGroup>
          </div>
        </div>

        <div className="pf-col pf-col-c">
          <div {...enter()} className="pf-enter pf-out">
            <Button variant="secondary" fullWidth onClick={() => openSheet('signout')}>
              <LogOut size={17} /> Sign out
            </Button>
            <button type="button" className="pf-delete" onClick={() => { setDeleteWord(''); openSheet('delete'); }}>
              Delete MONEVA account
            </button>
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" className="pf-hidden-file" onChange={(e) => void pickAvatar(e)} />

      <ProfileSheet isOpen={sheet !== null} title={sheetTitle} onClose={closeSheet}>
        {sheet === 'photo' && (
          <>
            <div className="pf-photo">{user?.avatar_data_url ? <img src={user.avatar_data_url} alt="" /> : initial}</div>
            <p className="pf-lead pf-center">Shown on your Profile and beside your name.</p>
            <Button variant="primary" fullWidth isLoading={isAvatarBusy} onClick={() => fileInputRef.current?.click()} data-autofocus>
              <Upload size={17} /> {user?.avatar_data_url ? 'Choose a different photo' : 'Choose a photo'}
            </Button>
            {user?.avatar_data_url && (
              <button type="button" className="pf-delete" disabled={isAvatarBusy} onClick={() => void removeAvatar()}>Remove photo</button>
            )}
          </>
        )}

        {sheet === 'details' && (
          <form className="pf-form" onSubmit={(e) => void saveName(e)}>
            <div className="pf-field">
              <label htmlFor="pf-name">Display name</label>
              <input
                id="pf-name"
                className="pf-input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
                autoComplete="name"
                data-autofocus
              />
            </div>
            <div className="pf-field">
              <span className="pf-label">Email</span>
              <button type="button" className="pf-mail-row" onClick={() => openSheet('email')}>
                <span className="pf-ico" aria-hidden="true">{verified ? <MailCheck /> : <Mail />}</span>
                <span className="pf-row-text">
                  <span className="pf-row-title pf-ellipsis">{user?.email}</span>
                  <span className="pf-row-sub">{verified ? 'Verified' : 'Not verified yet'}</span>
                </span>
                <span className={`pf-row-val ${verified ? 'is-on' : 'is-warn'}`}>{verified ? 'Change' : 'Verify'}</span>
              </button>
            </div>
            <Button type="submit" variant="primary" fullWidth isLoading={isSavingName} disabled={!displayName.trim()}>Save</Button>
          </form>
        )}

        {sheet === 'email' && user && (
          <EmailPanel
            email={user.email}
            verified={verified}
            onUpdated={restoreSession}
            onTitle={setSheetTitle}
            onDone={closeSheet}
          />
        )}

        {sheet === 'currency' && (
          <>
            <p className="pf-lead">Every amount in MONEVA is shown in this currency.</p>
            <div className="pf-list" role="radiogroup" aria-label="Currency">
              {CURRENCIES.map((c) => {
                const checked = (pendingCurrency ?? user?.currency) === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className="pf-choice"
                    onClick={() => setPendingCurrency(c.code === user?.currency ? null : c.code)}
                  >
                    <span className="pf-choice-sym">{c.symbol}</span>
                    <span className="pf-row-text">
                      <span className="pf-row-title">{c.name}</span>
                      <span className="pf-row-sub">{c.code}</span>
                    </span>
                    <span className="pf-tick" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                  </button>
                );
              })}
            </div>
            {pendingCurrency && user && (
              <div className="pf-confirm">
                <p>
                  <strong>Change to {pendingCurrency}?</strong> Every amount you have saved is converted from {user.currency} to{' '}
                  {pendingCurrency} at today&apos;s exchange rate. This rewrites your transactions, budgets, goals and bills,
                  and cannot be undone.
                </p>
                <div className="pf-two">
                  <Button variant="secondary" onClick={() => setPendingCurrency(null)}>Keep {user.currency}</Button>
                  <Button variant="danger" isLoading={isChangingCurrency} onClick={() => void confirmCurrency()}>
                    Convert to {pendingCurrency}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {sheet === 'timezone' && (
          <>
            <p className="pf-lead">Decides when your day, week and month begin, and when reminders arrive.</p>
            <div className="pf-list" role="radiogroup" aria-label="Time zone">
              {ZONES.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  role="radio"
                  aria-checked={(savingZone ?? user?.timezone) === z.id}
                  className="pf-choice"
                  disabled={!!savingZone}
                  onClick={() => void chooseZone(z.id)}
                >
                  <span className="pf-row-text">
                    <span className="pf-row-title">{z.label}</span>
                    <span className="pf-row-sub">{z.sub}</span>
                  </span>
                  <span className="pf-tick" aria-hidden="true">
                    {savingZone === z.id ? <span className="pf-spin" /> : <Check size={12} strokeWidth={3} />}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {sheet === 'categories' && (
          <CategoriesPanel categories={categories} isLoading={isLoadingCategories} reload={loadCategories} />
        )}

        {sheet === 'catching' && (
          <CatchingPanel
            settings={capture}
            onOpenInbox={() => { closeSheet(); setIsPayInboxOpen(true); }}
            onReadPrivacy={() => { closeSheet(); setLegalTab('privacy'); }}
          />
        )}

        {sheet === 'reminders' && (
          <>
            <div className="pf-list">
              {REMINDERS.map((r) => (
                <SwitchRow key={r.key} title={r.label} checked={prefs[r.key]} onChange={(v) => void savePreference(r.key, v)} />
              ))}
            </div>
            {capture.devicePerm === 'granted' ? (
              <p className="pf-lead">Each one arrives as a notification on this phone.</p>
            ) : (
              <div className="pf-list">
                <SettingsRow
                  tone="warn"
                  icon={<BellRing />}
                  title="Notifications are off on this phone"
                  sub={capture.devicePerm === 'denied' ? 'Blocked in Android settings, so none of these can arrive.' : 'None of these can arrive until they are on.'}
                  action={(
                    <button type="button" className="pf-mini is-primary" disabled={capture.isEnablingPerm} onClick={() => void capture.enableNotifications()}>
                      Turn on
                    </button>
                  )}
                />
              </div>
            )}
          </>
        )}

        {sheet === 'password' && (
          <form className="pf-form" onSubmit={(e) => void changePassword(e)} noValidate>
            <div className="pf-field">
              <label htmlFor="pf-pwd-new">New password</label>
              <input
                id="pf-pwd-new"
                type="password"
                className="pf-input"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setPwdError(null); }}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                data-autofocus
              />
            </div>
            <div className="pf-field">
              <label htmlFor="pf-pwd-again">Confirm new password</label>
              <input
                id="pf-pwd-again"
                type="password"
                className="pf-input"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setPwdError(null); }}
                placeholder="Re-enter new password"
                autoComplete="new-password"
              />
            </div>
            {pwdError && <p className="pf-error" role="alert">{pwdError}</p>}
            <Button type="submit" variant="primary" fullWidth isLoading={isChangingPassword}>Change password</Button>
          </form>
        )}

        {sheet === 'others' && (
          <>
            <p className="pf-lead">
              Every other phone and browser signed in to your account is signed out. You stay signed in here.
              Use this if you lose a phone: sessions otherwise stay valid for 60 days.
            </p>
            <div className="pf-two">
              <Button variant="secondary" onClick={closeSheet}>Cancel</Button>
              <Button variant="primary" isLoading={isSigningOutAll} onClick={() => void signOutOthers()}>Sign out others</Button>
            </div>
          </>
        )}

        {sheet === 'export' && (
          <>
            <p className="pf-lead">Download an Excel workbook of your financial records, with a sheet for each of these:</p>
            <div className="pf-chips">{EXPORT_SHEETS.map((s) => <span key={s} className="pf-chip">{s}</span>)}</div>
            <Button variant="primary" fullWidth isLoading={isExporting} onClick={() => void exportData()} data-autofocus>
              <Download size={17} /> Export to Excel
            </Button>
          </>
        )}

        {sheet === 'recheck' && (
          recheck.status === 'reading' ? (
            <div className="pf-status">
              <span className="pf-status-mark is-quiet"><span className="pf-spin" /></span>
              <span className="pf-row-text">
                <span className="pf-status-title">Reading every expense again</span>
                <span className="pf-status-sub">Nothing changes until you say so</span>
              </span>
            </div>
          ) : recheck.status === 'failed' ? (
            <>
              <p className="pf-lead">Your transactions could not be read. Check your connection and try again.</p>
              <Button variant="primary" fullWidth onClick={() => void startRecheck()}>Try again</Button>
            </>
          ) : recheck.status === 'none' ? (
            <>
              <div className="pf-done-mark"><Check size={36} strokeWidth={2.6} /></div>
              <p className="pf-done-title">Nothing to change</p>
              <p className="pf-done-sub">Every expense is already filed correctly. Nothing was changed.</p>
              <Button variant="primary" fullWidth onClick={closeSheet} data-autofocus>Done</Button>
            </>
          ) : (
            <>
              <p className="pf-lead">
                Categories were being copied from the payment app rather than the payee, so unrelated payments could end
                up filed together. <strong>{recheck.plan.length} {recheck.plan.length === 1 ? 'expense would move' : 'expenses would move'}.</strong>{' '}
                No category is ever cleared.
              </p>
              <div className="pf-moves">
                {recheck.plan.map((p) => (
                  <div key={p.id} className="pf-move">
                    <span className="pf-move-desc">{p.description}</span>
                    <span className="pf-move-path">
                      <span className="pf-move-from">{p.fromName || 'Uncategorised'}</span>
                      <ArrowRight size={13} aria-hidden="true" />
                      <span className="pf-move-to">{p.toName}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="pf-two">
                <Button variant="secondary" onClick={closeSheet} disabled={isApplying}>Not now</Button>
                <Button variant="primary" isLoading={isApplying && recatSaved === 0} onClick={() => void applyRecheck(recheck.plan)} disabled={isApplying}>
                  {isApplying && recatSaved > 0 ? `Saving ${recatSaved}/${recheck.plan.length}` : `Apply ${recheck.plan.length} changes`}
                </Button>
              </div>
            </>
          )
        )}

        {sheet === 'privacy' && (
          <div className="pf-list">
            <SettingsRow
              icon={<ShieldCheck />}
              title="What MONEVA does with your data"
              sub="Your messages are never stored or sent anywhere. Read the detail, including the one thing that does leave your phone."
              onClick={() => { closeSheet(); setLegalTab('privacy'); }}
            />
            <SettingsRow
              icon={<FileText />}
              title="Terms of use"
              sub="What MONEVA is, and what it is not. Short."
              onClick={() => { closeSheet(); setLegalTab('terms'); }}
            />
          </div>
        )}

        {sheet === 'signout' && (
          <>
            <p className="pf-lead">Your records stay saved in your account. Sign in again to see them.</p>
            <div className="pf-two">
              <Button variant="secondary" onClick={closeSheet}>Stay signed in</Button>
              <Button variant="primary" onClick={() => void signOut()}>Sign out</Button>
            </div>
          </>
        )}

        {sheet === 'delete' && (
          <form className="pf-form" onSubmit={(e) => { e.preventDefault(); if (deleteWord.trim() === 'DELETE') void deleteAccount(); }}>
            <div className="pf-status is-danger">
              <span className="pf-status-mark"><Trash2 size={20} /></span>
              <span className="pf-row-text">
                <span className="pf-status-title">This can&apos;t be undone</span>
                <span className="pf-status-sub">Every transaction, account, budget and goal is erased, on every device.</span>
              </span>
            </div>
            <div className="pf-field">
              <label htmlFor="pf-delete-word">Type DELETE to confirm</label>
              <input
                id="pf-delete-word"
                className="pf-input"
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
            <Button type="submit" variant="danger" fullWidth isLoading={isDeletingAccount} disabled={deleteWord.trim() !== 'DELETE'}>
              Delete my account
            </Button>
            <Button type="button" variant="secondary" fullWidth onClick={closeSheet} data-autofocus>Keep my account</Button>
          </form>
        )}
      </ProfileSheet>

      {/* Mounted only while open, so each visit starts from a fresh read. */}
      {isPayInboxOpen && (
        <PaymentInbox isOpen onClose={() => setIsPayInboxOpen(false)} onSuccess={() => addToast('Payment added.', 'success')} />
      )}
      {legalTab && <LegalSheet isOpen initial={legalTab} onClose={() => setLegalTab(null)} />}
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

