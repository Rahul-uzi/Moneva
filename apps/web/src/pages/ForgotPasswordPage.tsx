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

  const requestCode = async (event: React.FormEvent) => {
    event.preventDefault();
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
      setStep('code');
    } catch (err) {
      setError(describeApiError(err, 'Could not start the reset. Try again.'));
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
            <Button type="submit" fullWidth isLoading={isBusy} disabled={!email.trim()}>
              Send reset code
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
