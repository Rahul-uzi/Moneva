import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Landmark, CreditCard, Wallet } from 'lucide-react';
import { AccountCard } from '../components/financial/AccountCard';
import { AccountModal } from '../components/financial/AccountModal';
import { AccountDetailModal } from '../components/financial/AccountDetailModal';
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog';
import { Button } from '../components/ui/Button';
import { ErrorState, EmptyState } from '../components/ui/States';
import { AccountsSkeleton } from '../components/ui/Skeleton';
import { apiClient, describeApiError } from '../services/apiClient';
import { useUiStore } from '../stores/useUiStore';
import { formatMonetaryValue } from '../utils/money';
import type { Account } from '../types/api';
import './AccountsPage.css';

interface OutletContextType {
  refreshTrigger?: number;
}

export const AccountsPage: React.FC = () => {
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [activeTab, setActiveTab] = useState<'all' | 'asset' | 'liability'>('all');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [accountToEdit, setAccountToEdit] = useState<Account | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const { addToast } = useUiStore();

  const fetchAccounts = useCallback(async (isMounted: boolean) => {
    try {
      const res = await apiClient.get<Account[]>('/accounts');
      if (isMounted) {
        setAccounts(res.data);
        setError(null);
      }
    } catch (err: unknown) {
      if (isMounted) {
        const msg = describeApiError(err, 'Failed to load accounts.');
        setError(msg);
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      void fetchAccounts(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [fetchAccounts, refreshTrigger]);

  // Account calculations
  const metrics = useMemo(() => {
    let totalAssets = 0;
    let totalLiabilities = 0;

    accounts.forEach((acc) => {
      const bal = acc.balance_paise ?? acc.opening_balance_minor;
      if (acc.account_type === 'asset') {
        totalAssets += bal;
      } else if (acc.account_type === 'liability') {
        totalLiabilities += bal;
      }
    });

    return {
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    };
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    if (activeTab === 'all') return accounts;
    return accounts.filter((acc) => acc.account_type === activeTab);
  }, [accounts, activeTab]);

  const handleEdit = (acc: Account) => {
    setSelectedAccount(null);
    setAccountToEdit(acc);
  };

  const handleDeletePrompt = (acc: Account) => {
    setSelectedAccount(null);
    setAccountToDelete(acc);
  };

  const handleConfirmDelete = async () => {
    if (!accountToDelete) return;
    setIsDeleting(true);
    try {
      await apiClient.delete(`/accounts/${accountToDelete.id}`);
      addToast(`Account "${accountToDelete.name}" deactivated successfully.`, 'info');
      setAccountToDelete(null);
      void fetchAccounts(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to delete account.';
      addToast(msg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) return <AccountsSkeleton />;
  if (error) return <ErrorState title="Accounts Error" message={error} onRetry={() => void fetchAccounts(true)} />;

  return (
    <div className="accounts-page-container">
      <div className="accounts-header">
        <div>
          <h1 className="heading-lg">My Accounts</h1>
          <span className="text-label">{accounts.length} Active Accounts</span>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsAddModalOpen(true)}>
          <Plus size={16} /> Add Account
        </Button>
      </div>

      {/* Account Metrics Banner */}
      <div className="accounts-metrics-card">
        <div className="metric-box">
          <span className="metric-label"><Landmark size={14} className="icon-blue" /> Total Assets</span>
          <span className="number-md text-main">{formatMonetaryValue(metrics.totalAssets)}</span>
        </div>
        <div className="metric-divider" />
        <div className="metric-box">
          <span className="metric-label"><CreditCard size={14} className="icon-coral" /> Liabilities</span>
          <span className="number-md text-coral">{formatMonetaryValue(metrics.totalLiabilities)}</span>
        </div>
        <div className="metric-divider" />
        <div className="metric-box">
          <span className="metric-label"><Wallet size={14} className="icon-teal" /> Net Balance</span>
          <span className="number-md text-teal">{formatMonetaryValue(metrics.netWorth)}</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="accounts-filter-tabs">
        <button
          type="button"
          className={`filter-tab ${activeTab === 'all' ? 'tab-active-all' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All ({accounts.length})
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'asset' ? 'tab-active-asset' : ''}`}
          onClick={() => setActiveTab('asset')}
        >
          Assets ({accounts.filter((a) => a.account_type === 'asset').length})
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'liability' ? 'tab-active-liability' : ''}`}
          onClick={() => setActiveTab('liability')}
        >
          Liabilities ({accounts.filter((a) => a.account_type === 'liability').length})
        </button>
      </div>

      {/* Accounts List */}
      {filteredAccounts.length === 0 ? (
        <EmptyState
          art="wallet"
          title="No Accounts Found"
          description={
            accounts.length === 0
              ? 'No accounts yet. Click Add Account to create your first bank or cash account.'
              : 'No accounts match the selected category filter.'
          }
          actionLabel={accounts.length === 0 ? 'Add Account' : undefined}
          onAction={accounts.length === 0 ? () => setIsAddModalOpen(true) : undefined}
        />
      ) : (
        <div className="accounts-grid">
          {filteredAccounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              onClick={() => setSelectedAccount(acc)}
            />
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <AccountModal
        isOpen={isAddModalOpen || !!accountToEdit}
        accountToEdit={accountToEdit}
        onClose={() => {
          setIsAddModalOpen(false);
          setAccountToEdit(null);
        }}
        onSuccess={() => void fetchAccounts(true)}
      />

      {/* Account Details Modal */}
      <AccountDetailModal
        account={selectedAccount}
        onClose={() => setSelectedAccount(null)}
        onEdit={handleEdit}
        onDelete={handleDeletePrompt}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!accountToDelete}
        title="Deactivate Account"
        message={`Are you sure you want to deactivate "${accountToDelete?.name}"? Transaction ledger history will be preserved.`}
        confirmLabel="Deactivate Account"
        onConfirm={handleConfirmDelete}
        onClose={() => setAccountToDelete(null)}
        isLoading={isDeleting}
      />
    </div>
  );
};
