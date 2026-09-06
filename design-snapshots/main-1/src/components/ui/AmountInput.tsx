import React, { useEffect, useState } from 'react';
import { rupeesToPaise, paiseToRupeesString } from '../../utils/money';
import './AmountInput.css';

interface AmountInputProps {
  valuePaise: number;
  onChangePaise: (paise: number) => void;
  currencySymbol?: string;
  label?: string;
  error?: string;
}

export const AmountInput: React.FC<AmountInputProps> = ({
  valuePaise,
  onChangePaise,
  currencySymbol = '₹',
  label = 'Amount',
  error,
}) => {
  const [displayVal, setDisplayVal] = useState<string>(() => {
    try {
      return valuePaise ? paiseToRupeesString(valuePaise) : '';
    } catch {
      return '';
    }
  });

  const [localError, setLocalError] = useState<string | null>(null);

  /**
   * Follows the prop when it is changed from outside.
   *
   * The display text was seeded once and never updated, so a parent setting the
   * amount programmatically - prefilling from a saved salary stream, say -
   * changed the value while the field still showed the old text.
   *
   * Compared by parsed value, not by string, so it does not fight the user
   * mid-typing: "12." and "12" are the same number and leave the text alone.
   */
  useEffect(() => {
    let current: number;
    try {
      current = displayVal.trim() ? rupeesToPaise(displayVal) : 0;
    } catch {
      return; // Half-typed and unparseable: leave it be.
    }
    if (current === valuePaise) return;
    // Deferred so the update lands after this render rather than cascading
    // within it, matching how the rest of the app defers effect state.
    const timer = setTimeout(() => {
      try {
        setDisplayVal(valuePaise ? paiseToRupeesString(valuePaise) : '');
        setLocalError(null);
      } catch {
        // An unrepresentable value keeps whatever is on screen.
      }
    }, 0);
    return () => clearTimeout(timer);
    // displayVal is read, not tracked: this reacts to the incoming prop only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuePaise]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDisplayVal(val);

    if (!val.trim()) {
      setLocalError(null);
      onChangePaise(0);
      return;
    }

    try {
      const paise = rupeesToPaise(val);
      if (paise < 0) {
        setLocalError('Amount cannot be negative');
      } else {
        setLocalError(null);
        onChangePaise(paise);
      }
    } catch {
      setLocalError('Invalid amount format');
    }
  };

  const activeError = error || localError;

  return (
    <div className="amount-input-wrapper">
      {label && <label className="form-label">{label}</label>}
      <div className={`amount-input-box ${activeError ? 'input-box-error' : ''}`}>
        <span className="currency-symbol">{currencySymbol}</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          className="amount-field"
          value={displayVal}
          onChange={handleChange}
        />
      </div>
      {activeError && <span className="error-message">{activeError}</span>}
    </div>
  );
};
