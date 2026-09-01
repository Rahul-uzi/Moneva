import React from 'react';
import { ArrowUpRight, ArrowDownLeft, ArrowRightLeft } from 'lucide-react';
import type { Transaction } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './TransactionRow.css';

interface TransactionRowProps {
  transaction: Transaction;
  onClick?: () => void;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({ transaction, onClick }) => {
  const isIncome = transaction.transaction_type === 'income';
  const isExpense = transaction.transaction_type === 'expense';
  const isTransfer = transaction.transaction_type === 'transfer';

  const dateFormatted = new Date(transaction.transaction_date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className={`transaction-row${onClick ? ' is-tappable' : ''}`} onClick={onClick}>
      <div className={`tx-icon-badge tx-${transaction.transaction_type}`}>
        {isIncome && <ArrowDownLeft size={18} />}
        {isExpense && <ArrowUpRight size={18} />}
        {isTransfer && <ArrowRightLeft size={18} />}
      </div>
      <div className="tx-info">
        <span className="tx-title">{transaction.description || (isTransfer ? 'Transfer' : isIncome ? 'Income' : 'Expense')}</span>
        <span className="tx-date">{dateFormatted}</span>
      </div>
      <div className={`tx-amount ${isIncome ? 'amount-income' : isExpense ? 'amount-expense' : 'amount-transfer'}`}>
        {isIncome ? '+' : isExpense ? '-' : ''}
        {formatMonetaryValue(transaction.amount_minor, transaction.currency)}
      </div>
    </div>
  );
};
