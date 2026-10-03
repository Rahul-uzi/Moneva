import React, { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './FormField.css';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, className = '', type, ...props }, ref) => {
    /**
     * Every password field in the app can be revealed.
     *
     * None of them could, and on a phone that is the difference between a
     * strong password and a short one: a long passphrase typed blind, with
     * autocorrect in the way, fails often enough that people pick something
     * easier instead. The toggle is what makes a good password usable here.
     *
     * Starts hidden, always - it is still a password, and the field may be on
     * screen before anyone decides to look at it.
     */
    const isPassword = type === 'password';
    const [revealed, setRevealed] = useState(false);
    const id = useId();

    return (
      <div className="moneva-form-field">
        <label className="form-label" htmlFor={id}>{label}</label>

        <div className={isPassword ? 'form-input-wrap' : undefined}>
          <input
            id={id}
            ref={ref}
            type={isPassword && revealed ? 'text' : type}
            className={`form-input ${error ? 'input-error' : ''} ${isPassword ? 'has-reveal' : ''} ${className}`}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              className="form-reveal"
              /* Not in the tab order: tabbing from the password field should
                 reach the submit button, which is what someone typing a
                 password is heading for. It is still reachable by tap and by
                 screen reader. */
              tabIndex={-1}
              aria-label={revealed ? 'Hide password' : 'Show password'}
              aria-pressed={revealed}
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>

        {error && <span className="error-message">{error}</span>}
      </div>
    );
  }
);

FormField.displayName = 'FormField';
