import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TransactionRow } from './TransactionRow';
import { LoadingState } from '../ui/States';
import { apiClient } from '../../services/apiClient';
import type { Account, Transaction } from '../../types/api';
import { Money } from '../ui/Money';
import './AccountDetailModal.css';

interface AccountDetailModalProps {
  account: Account | null;
  onClose: () => void;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
}

export const AccountDetailModal: React.FC<AccountDetailModalProps> = ({
  account,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!account) return;

    // Guard against a slower response for a previously selected account
    // landing after this one and rendering the wrong rows under this header.
    let active = true;
    const loadTransactions = async () => {
      setIsLoading(true);
      try {
        const res = await apiClient.get<Transaction[]>(`/transactions?account_id=${account.id}`);
        if (active) setTransactions(res.data);
      } catch {
        if (active) setTransactions([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void loadTransactions();

    return () => {
      active = false;
    };
  }, [account]);

  if (!account) return null;

  const isLiability = account.account_type === 'liability';
  const currentBalance = account.balance_paise ?? account.opening_balance_minor;

  return (
    <Modal isOpen={!!account} onClose={onClose} title="Account Details">
      <div className="account-detail-container">
        <div className="account-detail-card">
          <span className="account-type-badge">{account.account_type.toUpperCase()}</span>
          <h2 className="heading-md">{account.name}</h2>
          <span className={`number-xl ${isLiability ? 'text-coral' : 'text-main'}`}>
            <Money amount={currentBalance} currency={account.currency} />
          </span>
          <span className="text-body text-sm">
            Opening Balance: <Money amount={account.opening_balance_minor} currency={account.currency} />
          </span>
        </div>

        <div className="account-detail-actions">
          <Button variant="secondary" onClick={() => onEdit(account)}>
            Edit Account
          </Button>
          <Button variant="danger" onClick={() => onDelete(account)}>
            Delete Account
          </Button>
        </div>

        <div className="account-tx-section">
          <h3 className="heading-sm">Account Transactions</h3>
          {isLoading ? (
            <LoadingState message="Loading account transactions..." />
          ) : transactions.length === 0 ? (
            <span className="text-body text-center py-4">No transactions linked to this account yet.</span>
          ) : (
            <div className="account-tx-list">
              {transactions.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
