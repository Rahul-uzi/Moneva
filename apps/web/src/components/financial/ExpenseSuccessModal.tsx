import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatMonetaryValue } from '../../utils/money';
import type { Transaction } from '../../types/api';
import './ExpenseSuccessModal.css';

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

  const formattedDate = new Date(transaction.transaction_date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Modal isOpen={!!transaction} onClose={onClose} title="Expense Saved">
      <div className="expense-success-body">
        <div className="success-icon-ring">
          <CheckCircle2 size={40} />
        </div>

        <div className="success-amount-card">
          <span className="text-label text-coral font-bold uppercase">Expense Recorded</span>
          <span className="number-xl text-coral">
            -{formatMonetaryValue(transaction.amount_minor, transaction.currency)}
          </span>
          <span className="text-body text-sm font-semibold">
            {transaction.description || 'General Expense'}
          </span>
        </div>

        <div className="success-details-list">
          <div className="detail-row">
            <span className="detail-label">Category</span>
            <span className="detail-val">{categoryName}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Paid From Account</span>
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
