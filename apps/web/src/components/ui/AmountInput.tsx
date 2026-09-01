import React, { useState } from 'react';
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
