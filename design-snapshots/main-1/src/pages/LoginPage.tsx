import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import logoMark from '../assets/logo/MONEVA_Logo_Mark_FullColor.png';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/useAuthStore';
import { verifyTotp } from '../services/twoFactorService';
import { useUiStore } from '../stores/useUiStore';
import './AuthPage.css';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, completeTwoFactorLogin } = useAuthStore();
  const { addToast } = useUiStore();

  const [loginError, setLoginError] = React.useState<string | null>(null);

  // Set once the password is accepted but the account still needs a second factor.
  const [challengeToken, setChallengeToken] = React.useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = React.useState('');
  const [isVerifying, setIsVerifying] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setLoginError(null);
    try {
      const challenge = await login(data.email, data.password);
      if (challenge) {
        setChallengeToken(challenge);
        return;
      }
      addToast('Successfully signed in!', 'success');
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Login failed';
      setLoginError(msg);
      addToast(msg, 'error');
    }
  };

  const onVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;
    setLoginError(null);
    setIsVerifying(true);
    try {
      const tokens = await verifyTotp(challengeToken, twoFactorCode.trim());
      await completeTwoFactorLogin(tokens);
      addToast('Successfully signed in!', 'success');
      navigate('/');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      const msg = detail || 'That code was not accepted. Please try again.';
      setLoginError(msg);
      addToast(msg, 'error');
      setTwoFactorCode('');
    } finally {
      setIsVerifying(false);
    }
  };

  const cancelTwoFactor = () => {
    setChallengeToken(null);
    setTwoFactorCode('');
    setLoginError(null);
  };

  return (
    <div className="auth-viewport">
      <div className="auth-card">
        <div className="auth-header">
          <img src={logoMark} alt="MONEVA" className="auth-logo" />
          <h1 className="heading-lg">{challengeToken ? 'Two-Factor Verification' : 'Welcome Back'}</h1>
          <p className="text-body">
            {challengeToken ? 'One more step to protect your account' : 'Sign in to your MONEVA account'}
          </p>
        </div>

        {loginError && <div className="auth-error-banner">{loginError}</div>}

        {challengeToken ? (
          <form onSubmit={onVerifyTwoFactor} className="auth-form" noValidate>
            <p className="text-body two-factor-hint">
              Enter the 6-digit code from your authenticator app, or one of your recovery codes.
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="totp-code">Authentication Code</label>
              <input
                id="totp-code"
                className="form-input two-factor-input"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                maxLength={9}
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
              />
            </div>
            <Button type="submit" variant="primary" fullWidth isLoading={isVerifying}>
              Verify &amp; Sign In
            </Button>
            <Button type="button" variant="ghost" fullWidth onClick={cancelTwoFactor}>
              Use a different account
            </Button>
          </form>
        ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
          <FormField
            label="Email Address"
            type="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <FormField
            label="Password"
            type="password"
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
          <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
            Sign In
          </Button>
        </form>
        )}

        {!challengeToken && (
          <div className="auth-footer">
            <span className="text-body">Don't have an account?</span>{' '}
            <Link to="/register" className="auth-link">
              Create Account
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
