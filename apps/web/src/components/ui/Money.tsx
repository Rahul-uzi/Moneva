import React from 'react';
import { formatMonetaryValue, splitFormattedMoney } from '../../utils/money';
import { useCountUp } from '../../hooks/useCountUp';
import { useUiStore } from '../../stores/useUiStore';
import type { Paise } from '../../utils/money';
import './Money.css';

interface MoneyProps {
  /** Integer minor units, as everything else in the app carries them. */
  amount: Paise;
  currency?: string;
  /** Count up on first paint. Hero figures only - never a row in a list. */
  animate?: boolean;
  /** Drop the paise. Long figures in tight rows. */
  hideMinor?: boolean;
  /** Force a leading + on positive values, for money coming in. */
  signed?: boolean;
  /**
   * Never mask this one, whatever the privacy setting says. For a figure the
   * user is entering or confirming right now, where hiding it would only stop
   * them checking their own work.
   */
  alwaysShow?: boolean;
  className?: string;
}

/**
 * One way to set an amount, everywhere.
 *
 * A rupee figure has three parts that deserve three treatments, and setting
 * them as one undifferentiated slab of digits is what made the old balance
 * read as a wall: the symbol and the paise drop to a fraction of the size and
 * step back, and the figure keeps the full weight. Tabular throughout, so
 * digits do not jitter while a value counts up or refreshes.
 *
 * Because the small parts step back with opacity rather than a colour token,
 * this stays legible on a card, on the page, and on a voltage fill alike.
 *
 * It is also the single place a holding can be masked, which is what makes
 * hiding balances a setting rather than a rewrite.
 */
export const Money: React.FC<MoneyProps> = ({
  amount,
  currency = 'INR',
  animate = false,
  hideMinor = false,
  signed = false,
  alwaysShow = false,
  className,
}) => {
  const shown = useCountUp(animate ? amount : 0);
  const hidden = useUiStore((state) => state.balancesHidden) && !alwaysShow;

  const value = animate ? shown : amount;
  const text = formatMonetaryValue(value, currency);
  const parts = splitFormattedMoney(text);
  const cls = ['money', className].filter(Boolean).join(' ');

  // A currency this does not recognise still has to render, so fall back to
  // the formatter's own string rather than dropping the figure.
  if (!parts) {
    return <span className={cls}>{hidden ? '\u2022\u2022\u2022\u2022\u2022\u2022' : text}</span>;
  }

  if (hidden) {
    // The sign goes too. Knowing an amount is negative is most of what you
    // were hiding.
    return (
      <span className={cls} role="img" aria-label="Balance hidden">
        <span className="money-cur" aria-hidden="true">{parts.symbol}</span>
        <span className="money-mask" aria-hidden="true">&bull;&bull;&bull;&bull;&bull;&bull;</span>
      </span>
    );
  }

  const lead = parts.negative ? '\u2212' : signed && value > 0 ? '+' : '';

  return (
    <span className={cls}>
      {lead}
      <span className="money-cur">{parts.symbol}</span>
      {parts.major}
      {!hideMinor && <span className="money-minor">.{parts.minor}</span>}
    </span>
  );
};
