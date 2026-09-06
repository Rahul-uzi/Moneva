import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { ChevronDown, Pencil, Search, Trash2 } from 'lucide-react';
import { TransactionRow } from '../components/financial/TransactionRow';
import { TransactionDetailModal } from '../components/financial/TransactionDetailModal';
import { TransactionEditModal } from '../components/financial/TransactionEditModal';
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog';
import { ErrorState, EmptyState } from '../components/ui/States';
import { ActivitySkeleton } from '../components/ui/Skeleton';
import { apiClient, describeApiError } from '../services/apiClient';
import { formatMonetaryValue } from '../utils/money';
import { useUiStore } from '../stores/useUiStore';
import type { Transaction, Account, Category } from '../types/api';
import './ActivityPage.css';

import { parseApiDate } from '../utils/datetime';
interface OutletContextType {
  refreshTrigger?: number;
}

export const ActivityPage: React.FC = () => {
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const { addToast } = useUiStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [activeTab, setActiveTab] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [period, setPeriod] = useState<'month' | '30d' | '90d' | '3m' | 'all'>('all');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  // Long-press target: the sheet offers edit or delete for any entry here.
  const [actionTx, setActionTx] = useState<Transaction | null>(null);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [deleteTx, setDeleteTx] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const fetchActivityData = async (isMounted: boolean) => {
    try {
      const [txRes, accRes, catRes] = await Promise.all([
        apiClient.get<Transaction[]>('/transactions'),
        apiClient.get<Account[]>('/accounts'),
        apiClient.get<Category[]>('/categories'),
      ]);

      if (isMounted) {
        setTransactions(txRes.data);
        setAccounts(accRes.data);
        setCategories(catRes.data);
        setError(null);
      }
    } catch (err: unknown) {
      if (isMounted) {
        const msg = describeApiError(err, 'Failed to load activity log.');
        setError(msg);
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      void fetchActivityData(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [refreshTrigger]);

  // Account and Category lookups
  const accountMap = useMemo(() => {
    const map = new Map<string, string>();
    accounts.forEach((acc) => map.set(acc.id, acc.name));
    return map;
  }, [accounts]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat) => map.set(cat.id, cat.name));
    return map;
  }, [categories]);

  // Filtered transactions
  /**
   * Start of the selected window, or null for everything.
   *
   * "Last 90 days" is a rolling window; "last 3 months" is three calendar
   * months including this one. They land close together but are not the same
   * thing, so both are offered rather than picking one and calling it both.
   */
  const periodStart = useMemo(() => {
    const now = new Date();
    switch (period) {
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      case '30d': {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        return d;
      }
      case '90d': {
        const d = new Date(now);
        d.setDate(d.getDate() - 90);
        return d;
      }
      case '3m':
        return new Date(now.getFullYear(), now.getMonth() - 2, 1);
      default:
        return null;
    }
  }, [period]);

  // Extracted so the tab counts can use the same predicate as the list itself,
  // rather than a second copy that could drift out of step with it.
  const matchesSearch = useCallback(
    (tx: Transaction) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const desc = (tx.description || '').toLowerCase();
      const catName = (tx.category_id ? categoryMap.get(tx.category_id) || '' : '').toLowerCase();
      const accName = (accountMap.get(tx.account_id) || '').toLowerCase();
      return desc.includes(q) || catName.includes(q) || accName.includes(q);
    },
    [searchQuery, categoryMap, accountMap],
  );

  const filteredTransactions = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          (activeTab === 'all' || tx.transaction_type === activeTab) &&
          (!periodStart || parseApiDate(tx.transaction_date) >= periodStart) &&
          matchesSearch(tx),
      ),
    [transactions, activeTab, matchesSearch, periodStart],
  );

  // Group transactions by Date
  const groupedTransactions = useMemo(() => {
    const groups: { dateLabel: string; items: Transaction[]; net: number }[] = [];
    const todayStr = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    filteredTransactions.forEach((tx) => {
      const txDate = parseApiDate(tx.transaction_date);
      let label = txDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (txDate.toDateString() === todayStr) label = 'Today';
      else if (txDate.toDateString() === yesterdayStr) label = 'Yesterday';

      let existingGroup = groups.find((g) => g.dateLabel === label);
      if (!existingGroup) {
        existingGroup = { dateLabel: label, items: [], net: 0 };
        groups.push(existingGroup);
      }
      existingGroup.items.push(tx);
      if (tx.transaction_type === 'income') existingGroup.net += tx.amount_minor;
      if (tx.transaction_type === 'expense') existingGroup.net -= tx.amount_minor;
    });

    return groups;
  }, [filteredTransactions]);

  // Filter summary metrics
  const filterSummary = useMemo(() => {
    let incomeSum = 0;
    let expenseSum = 0;
    filteredTransactions.forEach((tx) => {
      if (tx.transaction_type === 'income') incomeSum += tx.amount_minor;
      if (tx.transaction_type === 'expense') expenseSum += tx.amount_minor;
    });
    return { incomeSum, expenseSum, net: incomeSum - expenseSum };
  }, [filteredTransactions]);


  const handleDelete = async () => {
    if (!deleteTx) return;
    setIsDeleting(true);
    try {
      await apiClient.delete(`/transactions/${deleteTx.id}`);
      addToast('Entry deleted. Balances updated.', 'success');
      setDeleteTx(null);
      void fetchActivityData(true);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not delete that entry.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) return <ActivitySkeleton />;
  if (error) return <ErrorState title="Activity Error" message={error} onRetry={() => void fetchActivityData(true)} />;

  return (
    <div className="activity-container">
      <div className="activity-header-box">
        <h1 className="heading-lg">Activity Log</h1>
        {/* Scopes the whole page, so it sits with the title rather than inside
            one of the things it filters. */}
        <div className="period-chip">
        <select
          className="activity-period-select"
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
          aria-label="Time period"
        >
          <option value="all">All time</option>
          <option value="month">This month</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="3m">Last 3 months</option>
        </select>
          <ChevronDown size={14} />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="activity-filter-tabs" data-tour="activity-tabs">
        <button
          type="button"
          className={`filter-tab ${activeTab === 'all' ? 'tab-active-all' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'expense' ? 'tab-active-expense' : ''}`}
          onClick={() => setActiveTab('expense')}
        >
          Expenses
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'income' ? 'tab-active-income' : ''}`}
          onClick={() => setActiveTab('income')}
        >
          Income
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'transfer' ? 'tab-active-transfer' : ''}`}
          onClick={() => setActiveTab('transfer')}
        >
          Transfers
        </button>
      </div>

      {/* Search + period */}
      {/* The tour highlights the whole field, icon included: anchored on the
          input alone the magnifier sat outside the highlight and was blurred
          with the rest of the page. */}
      <div className="activity-search-box" data-tour="activity-search">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Search transactions"
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Activity Summary Metrics */}
      <div className="activity-metrics-card">
        <div className="activity-metrics-bar">
        <div className="activity-metric-item">
          <span className="metric-sub">Total Income</span>
          <span className="number-md text-teal">{formatMonetaryValue(filterSummary.incomeSum)}</span>
        </div>
        <div className="metric-separator" />
        <div className="activity-metric-item">
          <span className="metric-sub">Total Expenses</span>
          <span className="number-md text-coral">{formatMonetaryValue(filterSummary.expenseSum)}</span>
        </div>
        </div>
      </div>

      {/* Grouped Transactions List */}
      {filteredTransactions.length === 0 ? (
        <EmptyState
          title="No Transactions Found"
          description={
            searchQuery || activeTab !== 'all'
              ? 'No transactions match your selected search or filter.'
              : 'You have not created any transaction activity yet.'
          }
        />
      ) : (
        <div className="grouped-transactions" key={`${activeTab}:${searchQuery}:${period}`}>
          {groupedTransactions.map((group) => (
            <div key={group.dateLabel} className="date-group">
              <div className="date-group-header">
                <span className="text-label">{group.dateLabel}</span>
                {/* A day's net is the figure people scan an activity log for. */}
                <span className={`date-group-net ${group.net < 0 ? 'text-coral' : 'text-teal'}`}>
                  {group.net >= 0 ? '+' : '-'}
                  {formatMonetaryValue(Math.abs(group.net))}
                </span>
              </div>
              <div className="group-items">
                {group.items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onClick={() => setSelectedTx(tx)}
                    onLongPress={() => setActionTx(tx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Long-press actions */}
      {actionTx && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Transaction actions" onClick={() => setActionTx(null)}>
          <div className="modal-container tx-action-sheet" onClick={(e) => e.stopPropagation()}>
            <span className="tx-action-title">{actionTx.description || 'Transaction'}</span>
            <span className="tx-action-amount">{formatMonetaryValue(actionTx.amount_minor, actionTx.currency)}</span>
            <button type="button" className="tx-action-btn" onClick={() => { setEditTx(actionTx); setActionTx(null); }}>
              <Pencil size={16} /> Edit
            </button>
            <button type="button" className="tx-action-btn is-danger" onClick={() => { setDeleteTx(actionTx); setActionTx(null); }}>
              <Trash2 size={16} /> Delete
            </button>
            <button type="button" className="tx-action-btn is-plain" onClick={() => setActionTx(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <TransactionEditModal
        transaction={editTx}
        categories={categories}
        onClose={() => setEditTx(null)}
        onSaved={() => void fetchActivityData(true)}
      />

      <ConfirmationDialog
        isOpen={!!deleteTx}
        title="Delete this entry?"
        message={deleteTx ? `${formatMonetaryValue(deleteTx.amount_minor, deleteTx.currency)} will be removed and your account balance corrected. This cannot be undone.` : ''}
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onClose={() => setDeleteTx(null)}
        isLoading={isDeleting}
      />

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <TransactionDetailModal
          transaction={selectedTx}
          accountName={accountMap.get(selectedTx.account_id)}
          toAccountName={selectedTx.to_account_id ? accountMap.get(selectedTx.to_account_id) : undefined}
          categoryName={selectedTx.category_id ? categoryMap.get(selectedTx.category_id) : undefined}
          onClose={() => setSelectedTx(null)}
          onDeleted={() => void fetchActivityData(true)}
        />
      )}
    </div>
  );
};
