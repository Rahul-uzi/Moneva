import React from 'react';
import { Modal } from '../ui/Modal';
import type { Transaction } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './TransactionDetailModal.css';

interface TransactionDetailModalProps {
  transaction: Transaction | null;
  accountName?: string;
  toAccountName?: string;
  categoryName?: string;
  onClose: () => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  transaction,
  accountName = 'Account',
  toAccountName = 'Account',
  categoryName,
  onClose,
}) => {
  if (!transaction) return null;

  const isIncome = transaction.transaction_type === 'income';
  const isExpense = transaction.transaction_type === 'expense';
  const isTransfer = transaction.transaction_type === 'transfer';

  const fullDateStr = new Date(transaction.transaction_date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Modal isOpen={!!transaction} onClose={onClose} title="Transaction Details">
      <div className="tx-detail-container">
        <div className="tx-detail-amount-card">
          <span className="tx-type-badge">{transaction.transaction_type.toUpperCase()}</span>
          <span className={`number-xl ${isIncome ? 'text-teal' : isExpense ? 'text-coral' : 'text-main'}`}>
            {isIncome ? '+' : isExpense ? '-' : ''}
            {formatMonetaryValue(transaction.amount_minor, transaction.currency)}
          </span>
        </div>

        <div className="tx-detail-rows">
          <div className="detail-row">
            <span className="detail-label">Account</span>
            <span className="detail-val">{accountName}</span>
          </div>

          {isTransfer && (
            <div className="detail-row">
              <span className="detail-label">To Account</span>
              <span className="detail-val">{toAccountName}</span>
            </div>
          )}

          {!isTransfer && categoryName && (
            <div className="detail-row">
              <span className="detail-label">Category</span>
              <span className="detail-val">{categoryName}</span>
            </div>
          )}

          <div className="detail-row">
            <span className="detail-label">Date & Time</span>
            <span className="detail-val">{fullDateStr}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Description</span>
            <span className="detail-val">{transaction.description || 'No description provided'}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Mutation ID</span>
            <span className="detail-val text-mono">{transaction.client_mutation_id}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">Sync Status</span>
            <span className="detail-val text-teal">{transaction.sync_status || 'synced'}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};
