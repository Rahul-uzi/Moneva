import React from 'react';
import { ArrowUpRight, ArrowDownLeft, ArrowRightLeft } from 'lucide-react';
import type { Transaction } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './TransactionRow.css';

import { parseApiDate } from '../../utils/datetime';
interface TransactionRowProps {
  transaction: Transaction;
  /** Arrived since this device last had the app open. */
  isNew?: boolean;
  onClick?: () => void;
  /** Long-press (or right-click on a pointer device). */
  onLongPress?: () => void;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  transaction,
  isNew = false,
  onClick,
  onLongPress,
}) => {
  // Held for 500ms opens the actions. The timer is cancelled if the finger
  // moves or lifts early, so a scroll is never mistaken for a long press.
  const pressTimer = React.useRef<number | null>(null);
  const didLongPress = React.useRef<boolean>(false);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const startPress = () => {
    if (!onLongPress) return;
    didLongPress.current = false;
    pressTimer.current = window.setTimeout(() => {
      didLongPress.current = true;
      onLongPress();
    }, 500);
  };

  const handleClick = () => {
    // A completed long press already acted; do not also open the detail view.
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    onClick?.();
  };

  const isIncome = transaction.transaction_type === 'income';
  const isExpense = transaction.transaction_type === 'expense';
  const isTransfer = transaction.transaction_type === 'transfer';

  const dateFormatted = parseApiDate(transaction.transaction_date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <div
      className={`transaction-row${onClick ? ' is-tappable' : ''}`}
      onClick={handleClick}
      onPointerDown={startPress}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => {
        if (!onLongPress) return;
        e.preventDefault();
        onLongPress();
      }}
    >
      <div className={`tx-icon-badge tx-${transaction.transaction_type}`}>
        {isIncome && <ArrowDownLeft size={18} />}
        {isExpense && <ArrowUpRight size={18} />}
        {isTransfer && <ArrowRightLeft size={18} />}
      </div>
      <div className="tx-info">
        <span className="tx-title">{transaction.description || (isTransfer ? 'Transfer' : isIncome ? 'Income' : 'Expense')}</span>
        <span className="tx-date">
          {isNew && <span className="tx-new">New</span>}
          {dateFormatted}
        </span>
      </div>
      <div className={`tx-amount ${isIncome ? 'amount-income' : isExpense ? 'amount-expense' : 'amount-transfer'}`}>
        {isIncome ? '+' : isExpense ? '-' : ''}
        {formatMonetaryValue(transaction.amount_minor, transaction.currency)}
      </div>
    </div>
  );
};
