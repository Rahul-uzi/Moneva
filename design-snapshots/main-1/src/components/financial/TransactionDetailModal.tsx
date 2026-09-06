import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { Transaction } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './TransactionDetailModal.css';

import { parseApiDate } from '../../utils/datetime';
interface TransactionDetailModalProps {
  transaction: Transaction | null;
  accountName?: string;
  toAccountName?: string;
  categoryName?: string;
  onClose: () => void;
  /** Called after the entry has been removed, so the caller can refresh. */
  onDeleted?: () => void;
}

export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  transaction,
  accountName = 'Account',
  toAccountName = 'Account',
  categoryName,
  onClose,
  onDeleted,
}) => {
  const { addToast } = useUiStore();
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // A wrongly recorded entry had no way out of the app: the API could delete
  // one, but nothing in the UI called it.
  const handleDelete = async () => {
    if (!transaction) return;
    setIsDeleting(true);
    try {
      await apiClient.delete(`/transactions/${transaction.id}`);
      addToast('Entry deleted. Balances updated.', 'success');
      setConfirmDelete(false);
      onDeleted?.();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not delete that entry.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!transaction) return null;

  /**
   * Only salary and transfers can be removed.
   *
   * Salary is matched the same way the backend classifies it - by the Salary
   * category or the word in the description - so what the app calls salary here
   * and what "salary received" counts on the dashboard stay in step.
   */
  const isSalaryEntry =
    transaction.transaction_type === 'income' &&
    ((categoryName || '').toLowerCase() === 'salary' ||
      (transaction.description || '').toLowerCase().includes('salary'));
  const canDelete = transaction.transaction_type === 'transfer' || isSalaryEntry;

  const isIncome = transaction.transaction_type === 'income';
  const isExpense = transaction.transaction_type === 'expense';
  const isTransfer = transaction.transaction_type === 'transfer';

  const fullDateStr = parseApiDate(transaction.transaction_date).toLocaleString('en-IN', {
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

        {canDelete && (
          <Button variant="secondary" fullWidth onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete this entry
          </Button>
        )}
      </div>

      <ConfirmationDialog
        isOpen={confirmDelete}
        title="Delete this entry?"
        message={`${formatMonetaryValue(transaction.amount_minor, transaction.currency)} will be removed and your account balance corrected. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onClose={() => setConfirmDelete(false)}
        isLoading={isDeleting}
      />
    </Modal>
  );
};
