import React from 'react';
import { ShieldCheck, Copy, Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { setupTotp, enableTotp } from '../../services/twoFactorService';
import type { TotpSetup } from '../../types/api';
import './TwoFactorSetupModal.css';

interface Props {
  onClose: () => void;
  onEnabled: () => void;
}

type Step = 'loading' | 'scan' | 'recovery' | 'error';

export const TwoFactorSetupModal: React.FC<Props> = ({ onClose, onEnabled }) => {
  const [step, setStep] = React.useState<Step>('loading');
  const [setup, setSetup] = React.useState<TotpSetup | null>(null);
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    setupTotp()
      .then((data) => {
        if (!active) return;
        setSetup(data);
        setStep('scan');
      })
      .catch((err) => {
        if (!active) return;
        const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
        setError(detail || 'Could not start two-factor setup.');
        setStep('error');
      });
    return () => {
      active = false;
    };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await enableTotp(code.trim());
      setRecoveryCodes(result.recovery_codes);
      setStep('recovery');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || 'That code was not accepted.');
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Please write the codes down instead.');
    }
  };

  return (
    <div className="tfa-overlay" role="dialog" aria-modal="true" aria-label="Two-factor setup">
      <div className="tfa-modal">
        <div className="tfa-header">
          <ShieldCheck size={18} className="text-teal" />
          <h2 className="heading-md">Two-Factor Authentication</h2>
          {step !== 'recovery' && (
            <button className="tfa-close" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>

        {error && <div className="form-error-banner">{error}</div>}

        {step === 'loading' && <p className="text-body">Preparing your secure key…</p>}

        {step === 'error' && (
          <Button variant="secondary" fullWidth onClick={onClose}>
            Close
          </Button>
        )}

        {step === 'scan' && setup && (
          <form onSubmit={handleVerify} className="tfa-body">
            <p className="text-body">
              Scan this with Google Authenticator, Authy, or any TOTP app.
            </p>
            <div
              className="tfa-qr"
              /* QR is a server-rendered SVG of the otpauth URI - no external image host. */
              dangerouslySetInnerHTML={{ __html: setup.qr_svg }}
            />
            <p className="text-label">Or enter this key manually</p>
            <code className="tfa-secret">{setup.secret}</code>

            <div className="form-group">
              <label className="form-label" htmlFor="tfa-verify-code">
                Enter the 6-digit code to confirm
              </label>
              <input
                id="tfa-verify-code"
                className="form-input tfa-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
              Verify &amp; Enable
            </Button>
          </form>
        )}

        {step === 'recovery' && (
          <div className="tfa-body">
            <p className="text-body tfa-warning">
              Save these recovery codes now. Each one works once if you lose your
              phone &mdash; <strong>they will not be shown again.</strong>
            </p>
            <ul className="tfa-recovery-list">
              {recoveryCodes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
            <Button variant="secondary" fullWidth onClick={copyRecoveryCodes}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy all codes'}
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                onEnabled();
                onClose();
              }}
            >
              I&apos;ve saved them &mdash; Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
