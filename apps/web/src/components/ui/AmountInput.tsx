import React, { useEffect, useState } from 'react';
import {
  rupeesToPaise, paiseToRupeesString, groupIndianDigits, ungroupDigits,
} from '../../utils/money';
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
      return valuePaise ? groupIndianDigits(paiseToRupeesString(valuePaise)) : '';
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
      current = displayVal.trim() ? rupeesToPaise(ungroupDigits(displayVal)) : 0;
    } catch {
      return; // Half-typed and unparseable: leave it be.
    }
    if (current === valuePaise) return;
    // Deferred so the update lands after this render rather than cascading
    // within it, matching how the rest of the app defers effect state.
    const timer = setTimeout(() => {
      try {
        setDisplayVal(valuePaise ? groupIndianDigits(paiseToRupeesString(valuePaise)) : '');
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
    // Kept exactly as typed. Regrouping mid-entry would move the caret out
    // from under the cursor on every third digit, which is worse than not
    // formatting at all - the tidying happens on the way out instead.
    const val = e.target.value;
    setDisplayVal(val);

    if (!val.trim()) {
      setLocalError(null);
      onChangePaise(0);
      return;
    }

    try {
      const paise = rupeesToPaise(ungroupDigits(val));
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

  /* Grouped when the field is at rest, plain while it is being edited.
     Left ungrouped, "6500" reads as ambiguous - six thousand five hundred
     rupees, or sixty-five rupees entered in paise? - and the answer only
     appeared once the row had been saved. */
  const handleFocus = () => setDisplayVal(ungroupDigits(displayVal));

  const handleBlur = () => {
    if (!displayVal.trim()) return;
    try {
      setDisplayVal(groupIndianDigits(paiseToRupeesString(rupeesToPaise(ungroupDigits(displayVal)))));
    } catch {
      // Half-typed or unparseable: leave it alone and let the error show.
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
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
      </div>
      {activeError && <span className="error-message">{activeError}</span>}
    </div>
  );
};
