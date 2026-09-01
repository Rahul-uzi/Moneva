import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import logoMark from '../assets/logo/MONEVA_Logo_Mark_FullColor.png';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/useAuthStore';
import { markOnboardingPending } from '../services/onboardingService';
import { useUiStore } from '../stores/useUiStore';
import './AuthPage.css';

const registerSchema = z
  .object({
    display_name: z.string().min(2, 'Display name must be at least 2 characters'),
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirm_password: z.string().min(6, 'Password confirmation is required'),
    currency: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { register: registerUser, isLoading } = useAuthStore();
  const { addToast } = useUiStore();

  const [registerError, setRegisterError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      currency: 'INR',
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    setRegisterError(null);
    try {
      await registerUser(data.email, data.password, data.display_name, data.currency);
      // Brand-new account: queue the walkthrough for first entry to the app.
      markOnboardingPending();
      addToast('Account created successfully!', 'success');
      navigate('/');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Registration failed';
      setRegisterError(msg);
      addToast(msg, 'error');
    }
  };

  return (
    <div className="auth-viewport">
      <div className="auth-card">
        <div className="auth-header">
          <img src={logoMark} alt="MONEVA" className="auth-logo" />
          <h1 className="heading-lg">Create Account</h1>
          <p className="text-body">Join MONEVA Personal Finance</p>
        </div>

        {registerError && <div className="auth-error-banner">{registerError}</div>}

        <form onSubmit={handleSubmit(onSubmit)} className="auth-form" noValidate>
          <FormField
            label="Full Name / Display Name"
            type="text"
            placeholder="John Doe"
            error={errors.display_name?.message}
            {...register('display_name')}
          />
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
          <FormField
            label="Confirm Password"
            type="password"
            placeholder="••••••••"
            error={errors.confirm_password?.message}
            {...register('confirm_password')}
          />
          <Button type="submit" variant="primary" fullWidth isLoading={isLoading || isSubmitting}>
            Create Account
          </Button>
        </form>

        <div className="auth-footer">
          <span className="text-body">Already have an account?</span>{' '}
          <Link to="/login" className="auth-link">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};
