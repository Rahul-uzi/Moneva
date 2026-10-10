import React from 'react';
import './CodeInput.css';

interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  state?: 'idle' | 'busy' | 'error' | 'done';
  disabled?: boolean;
  describedBy?: string;
}

const LENGTH = 6;

/**
 * Six boxes over one real input.
 *
 * One input, not six, so paste works, the keyboard's one-time-code
 * suggestion fills the whole code in one go, and Backspace needs no
 * box-to-box bookkeeping. The boxes only draw what the input holds.
 */
export const CodeInput: React.FC<CodeInputProps> = ({ value, onChange, state = 'idle', disabled, describedBy }) => {
  const active = Math.min(value.length, LENGTH - 1);
  const ref = React.useRef<HTMLInputElement>(null);

  // Focused the moment it appears, so the keyboard is already up when the
  // email arrives - and back in focus after a wrong code clears the boxes.
  React.useEffect(() => {
    if (!disabled && value === '') ref.current?.focus({ preventScroll: true });
  }, [disabled, value]);
  return (
    <div className={`pf-otp is-${state}`} aria-busy={state === 'busy' || undefined}>
      <input
        ref={ref}
        data-autofocus
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, LENGTH))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={LENGTH}
        aria-label="6-digit code"
        aria-describedby={describedBy}
        disabled={disabled}
      />
      {Array.from({ length: LENGTH }, (_, i) => (
        <span
          key={i}
          className={`pf-otp-box${value[i] ? ' is-filled' : ''}${i === active ? ' is-active' : ''}`}
          aria-hidden="true"
        >
          {value[i] ?? ''}
        </span>
      ))}
    </div>
  );
};
