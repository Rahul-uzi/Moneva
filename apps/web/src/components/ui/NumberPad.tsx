import React, { useEffect } from 'react';
import { Delete } from 'lucide-react';
import { keyFromKeyboard, padDisplay, pressKey, type PadKey } from '../../utils/numberPad';
import './NumberPad.css';

const KEYS: PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

interface NumberPadProps {
  value: string;
  onChange: (next: string) => void;
  /** Also take digits from a physical keyboard while this pad is on screen. */
  listenToKeyboard?: boolean;
}

/**
 * MONEVA's own keypad for amounts.
 *
 * The phone keyboard covered half of every money sheet the moment an amount
 * was tapped, and offered letters an amount can never contain. This sits in
 * the sheet itself, so the amount, where the money is going and the Save
 * button are all on screen while the figure is typed.
 */
export const NumberPad: React.FC<NumberPadProps> = ({ value, onChange, listenToKeyboard = true }) => {
  useEffect(() => {
    if (!listenToKeyboard) return;
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from a field the user is actually typing in.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = keyFromKeyboard(e.key);
      if (!key) return;
      e.preventDefault();
      onChange(pressKey(value, key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listenToKeyboard, onChange, value]);

  return (
    <div className="np" role="group" aria-label="Number pad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`np-key ${k === 'back' ? 'np-key-back' : ''}`}
          aria-label={k === 'back' ? 'Delete' : k === '.' ? 'Decimal point' : k}
          onClick={() => onChange(pressKey(value, k))}
        >
          {k === 'back' ? <Delete size={20} aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  );
};

interface PadAmountProps {
  value: string;
  /** What the amount is, for screen readers: "Amount taken out". */
  label: string;
  /** One line under the figure - a balance, a warning, a hint. */
  note?: React.ReactNode;
  noteTone?: 'normal' | 'warn';
}

/**
 * The big figure the pad types into.
 *
 * Not an input: nothing here can summon the system keyboard. It is announced
 * to screen readers as it changes, so the pad is usable without sight.
 */
export const PadAmount: React.FC<PadAmountProps> = ({ value, label, note, noteTone = 'normal' }) => (
  <div className="np-amount-wrap">
    <div className="np-amount" role="status" aria-live="polite" aria-label={`${label}: ₹${padDisplay(value)}`}>
      <span className="np-currency" aria-hidden="true">₹</span>
      <span className={`np-figure ${value ? '' : 'is-empty'}`} key={value.length} aria-hidden="true">
        {padDisplay(value)}
      </span>
      <span className="np-caret" aria-hidden="true" />
    </div>
    {note && <p className={`np-note ${noteTone === 'warn' ? 'is-warn' : ''}`}>{note}</p>}
  </div>
);
