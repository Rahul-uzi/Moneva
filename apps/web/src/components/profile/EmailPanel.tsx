import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Mail, MailCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { apiClient, describeApiError } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { User } from '../../types/api';
import { CodeInput } from './CodeInput';

type Step = 'status' | 'change' | 'code' | 'done';

interface SendResponse {
  message: string;
  delivery_configured: boolean;
  retry_after_seconds: number;
  pending_email?: string;
}

interface EmailPanelProps {
  email: string;
  verified: boolean;
  /** Called after the account changed on the server, so the page can re-read it. */
  onUpdated: () => Promise<void>;
  onTitle: (title: string) => void;
  onDone: () => void;
}

const TITLES: Record<Step, string> = {
  status: 'Your email',
  change: 'Change email',
  code: 'Enter the code',
  done: 'Your email',
};
const RESEND_FALLBACK = 60;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const mask = (email: string) => {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(3, user.length - 2))}@${domain}`;
};

/**
 * Confirming the sign-in email, and moving the account to a new one.
 *
 * Both end in the same six-digit step. A change only happens once the NEW
 * address has sent its code back, so a typo can never point future reset
 * codes at someone else's inbox; until then the old address keeps working.
 */
export const EmailPanel: React.FC<EmailPanelProps> = ({ email, verified, onUpdated, onTitle, onDone }) => {
  const { addToast } = useUiStore();
  const errId = useId();
  const [step, setStep] = useState<Step>('status');
  const [target, setTarget] = useState<'current' | 'new'>('current');
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<'idle' | 'busy' | 'error' | 'done'>('idle');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [left, setLeft] = useState(0);
  const [noDelivery, setNoDelivery] = useState(false);
  const [doneText, setDoneText] = useState<{ title: string; body: string } | null>(null);

  const go = (next: Step) => {
    setStep(next);
    onTitle(TITLES[next]);
  };

  // The resend countdown. Ticks only while there is something to count.
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const startCode = (res: SendResponse, to: 'current' | 'new') => {
    setTarget(to);
    setCode('');
    setCodeState('idle');
    setCodeError(null);
    setLocked(false);
    setNoDelivery(!res.delivery_configured);
    setLeft(res.retry_after_seconds > 0 ? res.retry_after_seconds : RESEND_FALLBACK);
    go('code');
  };

  const sendToCurrent = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<SendResponse>('/auth/send-verification');
      startCode(res.data, 'current');
    } catch (err) {
      addToast(describeApiError(err, 'The code could not be sent. Try again in a moment.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendToNew = async () => {
    const v = newEmail.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(v)) { setFormError('That does not look like an email address. Check for a typo.'); return; }
    if (v === email.toLowerCase()) { setFormError('That is already your email.'); return; }
    if (!password) { setFormError('Enter your password to continue.'); return; }
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiClient.post<SendResponse>('/auth/change-email/start', { new_email: v, password });
      setNewEmail(res.data.pending_email ?? v);
      startCode(res.data, 'new');
    } catch (err) {
      setFormError(describeApiError(err, 'The code could not be sent. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setLeft(RESEND_FALLBACK);
    try {
      const res = target === 'new'
        ? await apiClient.post<SendResponse>('/auth/change-email/start', { new_email: newEmail, password })
        : await apiClient.post<SendResponse>('/auth/send-verification');
      setLeft(res.data.retry_after_seconds > 0 ? res.data.retry_after_seconds : RESEND_FALLBACK);
      setLocked(false);
      setCode('');
      setCodeError(null);
      setCodeState('idle');
      addToast(`A new code is on its way to ${mask(target === 'new' ? newEmail : email)}.`, 'info');
    } catch (err) {
      setLeft(0);
      addToast(describeApiError(err, 'The code could not be sent. Try again in a moment.'), 'error');
    }
  };

  const submitting = useRef(false);
  const onCode = async (value: string) => {
    setCode(value);
    setCodeError(null);
    if (codeState === 'error') setCodeState('idle');
    if (value.length < 6 || submitting.current) return;
    submitting.current = true;
    setCodeState('busy');
    try {
      if (target === 'new') {
        await apiClient.post<User>('/auth/change-email/confirm', { code: value });
      } else {
        await apiClient.post<User>('/auth/verify-email', { code: value });
      }
      setCodeState('done');
      const oldEmail = email;
      await onUpdated();
      setPassword('');
      setDoneText(target === 'new'
        ? { title: 'Email changed', body: `You now sign in with ${newEmail}. We told ${mask(oldEmail)} about the change, in case it wasn't you.` }
        : { title: 'Email verified', body: `Password reset codes will reach ${oldEmail}.` });
      setTimeout(() => go('done'), 600);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      setCodeState('error');
      setCode('');
      setCodeError(describeApiError(err, 'That code could not be checked. Try again.'));
      if (status === 429) setLocked(true);
    } finally {
      submitting.current = false;
    }
  };

  if (step === 'status') {
    return (
      <>
        <div className={`pf-status${verified ? '' : ' is-warn'}`}>
          <span className="pf-status-mark">{verified ? <MailCheck size={20} /> : <Mail size={20} />}</span>
          <span className="pf-row-text">
            <span className="pf-status-title pf-break">{email}</span>
            <span className="pf-status-sub">
              {verified
                ? 'Verified. Password reset codes are sent here.'
                : 'Not verified yet. Confirm it so a password reset code can reach you if you ever forget your password.'}
            </span>
          </span>
        </div>
        {!verified && (
          <Button variant="primary" fullWidth isLoading={busy} onClick={() => void sendToCurrent()} data-autofocus>
            Send a code to this email
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={() => { setFormError(null); go('change'); }}>
          Change email
        </Button>
        <p className="pf-lead">
          You sign in with this email. MONEVA only writes to it for sign-in codes, never for marketing.
        </p>
      </>
    );
  }

  if (step === 'change') {
    return (
      <form
        className="pf-form"
        onSubmit={(e) => { e.preventDefault(); void sendToNew(); }}
        noValidate
      >
        <p className="pf-lead">
          We send a code to the new address. Until you enter it, you keep signing in with <strong>{email}</strong>.
        </p>
        <div className="pf-field">
          <label htmlFor="pf-new-email">New email</label>
          <input
            id="pf-new-email"
            className="pf-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={newEmail}
            onChange={(e) => { setNewEmail(e.target.value); setFormError(null); }}
            data-autofocus
          />
        </div>
        <div className="pf-field">
          <label htmlFor="pf-email-pwd">Your password</label>
          <input
            id="pf-email-pwd"
            className="pf-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFormError(null); }}
          />
          <span className="pf-hint">Asked so nobody holding your unlocked phone can move your account to their own email.</span>
        </div>
        {formError && <p className="pf-error" role="alert">{formError}</p>}
        <div className="pf-two">
          <Button type="button" variant="secondary" onClick={() => go('status')}>Back</Button>
          <Button type="submit" variant="primary" isLoading={busy}>Send code</Button>
        </div>
      </form>
    );
  }

  if (step === 'code') {
    const to = target === 'new' ? newEmail : email;
    return (
      <>
        <p className="pf-lead">
          We sent a 6-digit code to <strong>{mask(to)}</strong>. It works for 30 minutes.
        </p>
        {noDelivery && (
          <p className="pf-hint is-warn">
            Email sending is not set up on this server, so the code is only written to the server log.
          </p>
        )}
        <CodeInput
          value={code}
          onChange={(v) => void onCode(v)}
          state={codeState}
          disabled={locked || codeState === 'busy' || codeState === 'done'}
          describedBy={codeError ? errId : undefined}
        />
        <p className="pf-error" id={errId} role="alert">{codeError ?? ''}</p>
        <div className="pf-resend">
          <span>No email? Check your spam folder.</span>
          <button type="button" disabled={left > 0} onClick={() => void resend()}>
            {left > 0 ? `Send again in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Send a new code'}
          </button>
        </div>
        {target === 'new' && (
          <button type="button" className="pf-link" onClick={() => go('change')}>
            Use a different address
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <div className="pf-done-mark"><Check size={36} strokeWidth={2.6} /></div>
      <p className="pf-done-title">{doneText?.title}</p>
      <p className="pf-done-sub pf-break">{doneText?.body}</p>
      <Button variant="primary" fullWidth onClick={onDone} data-autofocus>Done</Button>
    </>
  );
};
