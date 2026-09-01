import React, { useEffect, useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Search } from 'lucide-react';
import { TransactionRow } from '../components/financial/TransactionRow';
import { TransactionDetailModal } from '../components/financial/TransactionDetailModal';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/States';
import { apiClient } from '../services/apiClient';
import { formatMonetaryValue } from '../utils/money';
import type { Transaction, Account, Category } from '../types/api';
import './ActivityPage.css';

interface OutletContextType {
  refreshTrigger?: number;
}

export const ActivityPage: React.FC = () => {
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [activeTab, setActiveTab] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

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
        const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to load activity log.';
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
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type filter
      if (activeTab !== 'all' && tx.transaction_type !== activeTab) {
        return false;
      }
      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const desc = (tx.description || '').toLowerCase();
        const catName = (tx.category_id ? categoryMap.get(tx.category_id) || '' : '').toLowerCase();
        const accName = (accountMap.get(tx.account_id) || '').toLowerCase();
        return desc.includes(q) || catName.includes(q) || accName.includes(q);
      }
      return true;
    });
  }, [transactions, activeTab, searchQuery, categoryMap, accountMap]);

  // Group transactions by Date
  const groupedTransactions = useMemo(() => {
    const groups: { dateLabel: string; items: Transaction[] }[] = [];
    const todayStr = new Date().toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    filteredTransactions.forEach((tx) => {
      const txDate = new Date(tx.transaction_date);
      let label = txDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (txDate.toDateString() === todayStr) label = 'Today';
      else if (txDate.toDateString() === yesterdayStr) label = 'Yesterday';

      let existingGroup = groups.find((g) => g.dateLabel === label);
      if (!existingGroup) {
        existingGroup = { dateLabel: label, items: [] };
        groups.push(existingGroup);
      }
      existingGroup.items.push(tx);
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
    return { incomeSum, expenseSum };
  }, [filteredTransactions]);

  if (isLoading) return <LoadingState message="Loading transaction activity..." />;
  if (error) return <ErrorState title="Activity Error" message={error} onRetry={() => void fetchActivityData(true)} />;

  return (
    <div className="activity-container">
      <div className="activity-header-box">
        <h1 className="heading-lg">Activity Log</h1>
        <span className="text-label">{filteredTransactions.length} Items</span>
      </div>

      {/* Filter Tabs */}
      <div className="activity-filter-tabs">
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

      {/* Search Input */}
      <div className="activity-search-box">
        <Search size={16} className="search-icon" />
        <input
          type="text"
          placeholder="Search by description, account, or category..."
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Activity Summary Metrics */}
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
        <div className="grouped-transactions">
          {groupedTransactions.map((group) => (
            <div key={group.dateLabel} className="date-group">
              <div className="date-group-header">
                <span className="text-label">{group.dateLabel}</span>
              </div>
              <div className="group-items">
                {group.items.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onClick={() => setSelectedTx(tx)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <TransactionDetailModal
          transaction={selectedTx}
          accountName={accountMap.get(selectedTx.account_id)}
          toAccountName={selectedTx.to_account_id ? accountMap.get(selectedTx.to_account_id) : undefined}
          categoryName={selectedTx.category_id ? categoryMap.get(selectedTx.category_id) : undefined}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </div>
  );
};
