import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Illustration } from '../ui/Illustration';
import { Button } from '../ui/Button';
import { formatMonetaryValue } from '../../utils/money';
import type { Transaction } from '../../types/api';
import './ExpenseSuccessModal.css';

import { parseApiDate } from '../../utils/datetime';
interface ExpenseSuccessModalProps {
  transaction: Transaction | null;
  categoryName?: string;
  accountName?: string;
  onClose: () => void;
}

export const ExpenseSuccessModal: React.FC<ExpenseSuccessModalProps> = ({
  transaction,
  categoryName = 'Expense',
  accountName = 'Account',
  onClose,
}) => {
  const navigate = useNavigate();

  if (!transaction) return null;

  const formattedDate = parseApiDate(transaction.transaction_date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Only QuickAddModal shows this, and it now records expenses and income and
  // nothing else. Goal contributions and captured ATM withdrawals are still
  // transfers, but neither of them comes through this screen.
  const kind = transaction.transaction_type;
  const copy =
    kind === 'income'
      ? { title: 'Income Saved', label: 'Income Recorded', sign: '+', tone: 'text-teal', accountLabel: 'Received Into' }
      : { title: 'Expense Saved', label: 'Expense Recorded', sign: '-', tone: 'text-coral', accountLabel: 'Paid From Account' };

  return (
    <Modal isOpen={!!transaction} onClose={onClose} title={copy.title}>
      <div className="expense-success-body">
        <Illustration name="success" size={186} />

        <div className="success-amount-card">
          <span className={`text-label ${copy.tone} font-bold uppercase`}>{copy.label}</span>
          <span className={`number-xl ${copy.tone}`}>
            {copy.sign}
            {formatMonetaryValue(transaction.amount_minor, transaction.currency)}
          </span>
          <span className="text-body text-sm font-semibold">
            {transaction.description || copy.title}
          </span>
        </div>

        <div className="success-details-list">
          <div className="detail-row">
            <span className="detail-label">Category</span>
            <span className="detail-val">{categoryName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{copy.accountLabel}</span>
            <span className="detail-val">{accountName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Date & Time</span>
            <span className="detail-val">{formattedDate}</span>
          </div>
        </div>

        <div className="success-actions">
          <Button variant="secondary" fullWidth onClick={onClose}>
            Done
          </Button>
          <Button
            variant="primary"
            fullWidth
            onClick={() => {
              onClose();
              navigate('/activity');
            }}
          >
            View Activity <ArrowRight size={16} />
          </Button>
        </div>
      </div>
    </Modal>
  );
};
