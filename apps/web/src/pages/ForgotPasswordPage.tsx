import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '../components/ui/Logo';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { apiClient, describeApiError } from '../services/apiClient';
import { useUiStore } from '../stores/useUiStore';
import './AuthPage.css';

interface ForgotResponse {
  message: string;
  /** Whether the SERVER can send email - not whether this address exists. */
  delivery_configured: boolean;
  /**
   * Seconds the server will ignore another request for.
   *
   * The same number for every address, deliberately: a countdown that ran
   * differently for a real account than for an unknown one would give away
   * the very thing the wording above is careful not to.
   */
  retry_after_seconds?: number;
}

/**
 * Getting back in without the password.
 *
 * Both steps live on one screen rather than two routes: the second step needs
 * the email from the first, and routing it through a URL would either put an
 * address in the history or lose it on a refresh. One screen also serves the
 * person who already has a code and just wants to type it in.
 *
 * The wording never confirms whether an address has an account - the API is
 * careful about that, and it would be undone by a UI that said "no such user".
 */
export const ForgotPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [step, setStep] = React.useState<'email' | 'code'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isBusy, setIsBusy] = React.useState(false);
  /*
   * When another code may be asked for, as a moment rather than a count.
   *
   * The server enforces the gap regardless - that is what actually stops the
   * inbox filling - but without a countdown on screen there is nothing to
   * tell a person that tapping again does nothing, so they tap again. That is
   * how four permitted sends became four emails in four seconds.
   *
   * Held as a DEADLINE and recomputed from the clock, not decremented. A
   * phone screen that locks stops firing timers, so a counter that subtracts
   * one per tick would freeze at whatever it had reached and then resume from
   * there - showing "41s" a full two minutes after the wait had really ended,
   * and refusing a tap that the server would now happily accept.
   */
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(0);
  const cooldown = cooldownUntil > nowMs
    ? Math.ceil((cooldownUntil - nowMs) / 1000)
    : 0;

  React.useEffect(() => {
    if (cooldownUntil === 0) return undefined;
    setNowMs(Date.now());
    // Twice a second, so the number never appears to skip one.
    const ticker = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= cooldownUntil) clearInterval(ticker);
    }, 500);
    return () => clearInterval(ticker);
  }, [cooldownUntil]);

  /** Start the wait the server just told us about. */
  const holdFor = (seconds: number) => setCooldownUntil(Date.now() + seconds * 1000);

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
    // Belt and braces with the disabled button: a form still submits on Enter
    // in a focused field, so the guard has to sit on the handler too.
    if (cooldown > 0 || isBusy) return;
    setError(null);
    setIsBusy(true);
    try {
      const res = await apiClient.post<ForgotResponse>('/auth/forgot-password', {
        email: email.trim().toLowerCase(),
      });
      setNotice(
        res.data.delivery_configured
          ? res.data.message
          : // Said plainly rather than pretending: with no mail provider set
            // up the server logs the code instead of sending it, and a
            // "check your inbox" here would be a lie.
            'Email is not switched on for this server yet, so no message was sent. '
            + 'The code is in the server log. You can also use a two-factor '
            + 'recovery code below if you have one.',
      );
      holdFor(res.data.retry_after_seconds ?? 60);
      setStep('code');
    } catch (err) {
      setError(describeApiError(err, 'Could not start the reset. Try again.'));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Another code, without leaving this screen.
   *
   * There was no way to do this at all. Someone on the code step whose email
   * had not arrived had to press "Use a different email", which throws away
   * the step they are on and reads like starting over - so they retyped the
   * same address and sent again, and again. The absence of this button is a
   * large part of why the inbox filled.
   */
  const resendCode = async () => {
    // Belt and braces only: this button is type="button" and disabled while
    // the wait runs, so nothing can currently reach here - unlike the guard
    // in requestCode, which a form submitted by Enter really does reach. Kept
    // so that removing `disabled` later cannot quietly reopen the flood.
    if (cooldown > 0 || isBusy) return;
    setError(null);
    setIsBusy(true);
    try {
      const res = await apiClient.post<ForgotResponse>('/auth/forgot-password', {
        email: email.trim().toLowerCase(),
      });
      holdFor(res.data.retry_after_seconds ?? 60);
      // Said plainly, because the server may well have sent nothing: inside
      // the cooldown it keeps the code already in the inbox alive rather than
      // issuing a new one, and "a new code is on its way" would be a lie that
      // makes the person discard the mail that actually works.
      setNotice('If your code has not arrived, check spam. The code already sent still works.');
    } catch (err) {
      setError(describeApiError(err, 'Could not send another code. Try again.'));
    } finally {
      setIsBusy(false);
    }
  };

  const submitReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Use at least 6 characters.');
      return;
    }

    setIsBusy(true);
    try {
      await apiClient.post('/auth/reset-password', {
        email: email.trim().toLowerCase(),
        code: code.trim(),
        new_password: newPassword,
      });
      addToast('Password updated. Sign in with your new one.', 'success');
      navigate('/login');
    } catch (err) {
      setError(describeApiError(err, 'That code is not valid or has expired.'));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="auth-viewport">
      <div className="auth-card">
        <div className="auth-header">
          <Logo tile size={56} label={null} />
          <h1 className="heading-xl">
            {step === 'email' ? 'Forgot password' : 'Enter your code'}
          </h1>
          <p className="text-body">
            {step === 'email'
              ? 'We will send a six-digit code to your email.'
              : 'Type the code and choose a new password.'}
          </p>
        </div>

        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error-banner">{error}</div>}

        {step === 'email' ? (
          <form onSubmit={requestCode} className="auth-form">
            <FormField
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Button
              type="submit"
              fullWidth
              isLoading={isBusy}
              disabled={!email.trim() || cooldown > 0}
            >
              {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send reset code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitReset} className="auth-form">
            <FormField
              label="Reset code"
              type="text"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            {/* A two-factor recovery code is accepted here too - the way back
                in for somebody who cannot reach their email at all. */}
            <p className="auth-hint">
              Six digits from the email, or a two-factor recovery code.
            </p>
            <FormField
              label="New password"
              type="password"
              placeholder="At least 6 characters"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <FormField
              label="Confirm new password"
              type="password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <Button type="submit" fullWidth isLoading={isBusy}>
              Set new password
            </Button>
            <button
              type="button"
              className="auth-plain-link"
              onClick={resendCode}
              disabled={cooldown > 0 || isBusy}
            >
              {cooldown > 0 ? `Send another code in ${cooldown}s` : 'Send another code'}
            </button>
            <button
              type="button"
              className="auth-plain-link"
              onClick={() => {
                setStep('email');
                setError(null);
                setNotice(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        <div className="auth-footer">
          <span className="text-body">Remembered it?</span>{' '}
          <Link to="/login" className="auth-link">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
