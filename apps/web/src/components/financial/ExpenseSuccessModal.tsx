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
  toAccountName?: string;
  onClose: () => void;
}

export const ExpenseSuccessModal: React.FC<ExpenseSuccessModalProps> = ({
  transaction,
  categoryName = 'Expense',
  accountName = 'Account',
  toAccountName,
  onClose,
}) => {
  const navigate = useNavigate();

  if (!transaction) return null;

  const formattedDate = parseApiDate(transaction.transaction_date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // This screen is shown after an expense, an income OR a transfer. It used to
  // announce "Expense Saved" for all three, so moving your own money between
  // accounts was reported as money spent.
  const kind = transaction.transaction_type;
  const copy =
    kind === 'income'
      ? { title: 'Income Saved', label: 'Income Recorded', sign: '+', tone: 'text-teal', accountLabel: 'Received Into' }
      : kind === 'transfer'
        ? { title: 'Transfer Saved', label: 'Transfer Recorded', sign: '', tone: 'text-main', accountLabel: 'From Account' }
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
          {/* A transfer has no category; it has a destination instead. */}
          {kind !== 'transfer' && (
            <div className="detail-row">
              <span className="detail-label">Category</span>
              <span className="detail-val">{categoryName}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">{copy.accountLabel}</span>
            <span className="detail-val">{accountName}</span>
          </div>
          {kind === 'transfer' && toAccountName && (
            <div className="detail-row">
              <span className="detail-label">To Account</span>
              <span className="detail-val">{toAccountName}</span>
            </div>
          )}
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
