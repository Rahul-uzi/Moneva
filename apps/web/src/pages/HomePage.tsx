import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { FinancialSummaryCard } from '../components/financial/FinancialSummaryCard';
import { SalaryUsageCard } from '../components/financial/SalaryUsageCard';
import { AccountCard } from '../components/financial/AccountCard';
import { BudgetCard } from '../components/financial/BudgetCard';
import { GoalCard } from '../components/financial/GoalCard';
import { BillCard } from '../components/financial/BillCard';
import { TransactionRow } from '../components/financial/TransactionRow';
import { TransactionDetailModal } from '../components/financial/TransactionDetailModal';
import { SalaryConfirmationModal } from '../components/financial/SalaryConfirmationModal';
import { DueSalaryCard } from '../components/financial/DueSalaryCard';
import { PaydayCard } from '../components/financial/PaydayCard';
import { ErrorState, EmptyState } from '../components/ui/States';
import { HomeSkeleton } from '../components/ui/Skeleton';
import { ChevronRight } from 'lucide-react';
import { apiClient, describeApiError } from '../services/apiClient';
import { formatMonetaryValue } from '../utils/money';
import { useUiStore } from '../stores/useUiStore';
import { nextPayday } from '../utils/payday';
import { isNewSince } from '../utils/activity';
import { readLastSeen, writeLastSeen } from '../services/lastSeen';
import type {
  RecurringIncome,
  FinancialSummary, Account, Budget, SavingsGoal, Bill, Transaction, SalaryUsage, DueIncome,
  Category,
} from '../types/api';
import './HomePage.css';

interface OutletContextType {
  refreshTrigger?: number;
}


/**
 * Header link for a truncated section.
 *
 * The dashboard shows the first two bills, budgets and goals. Without this the
 * count was invisible, so someone with five upcoming bills saw two and had no
 * reason to think otherwise.
 */
const SectionLink: React.FC<{ shown: number; total: number; onSeeAll: () => void }> = ({
  shown,
  total,
  onSeeAll,
}) =>
  total > shown ? (
    <button type="button" className="section-see-all" onClick={onSeeAll}>
      See all {total}
      <ChevronRight size={14} />
    </button>
  ) : (
    <span className="text-label">{total} Total</span>
  );

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [salaryUsage, setSalaryUsage] = useState<SalaryUsage | null>(null);
  const [dueIncome, setDueIncome] = useState<DueIncome[]>([]);
  const [salaryStreams, setSalaryStreams] = useState<RecurringIncome[]>([]);
  /**
   * What this device had already seen when the page opened. Captured once so
   * the markers stay put while you read, rather than clearing under your eyes,
   * and the clock is moved on immediately so the next visit compares to now.
   */
  const [seenAt] = useState<string | null>(() => readLastSeen());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // Needed by the salary confirmation dialog so it can offer a category.
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isSalaryDialogOpen, setIsSalaryDialogOpen] = useState<boolean>(false);

  const { addToast } = useUiStore();

  // Recomputed only when the streams change; `new Date()` inside would make
  // this a new value on every render.
  const payday = useMemo(() => nextPayday(salaryStreams), [salaryStreams]);

  useEffect(() => {
    writeLastSeen(new Date().toISOString());
  }, []);

  const fetchAllData = async (isMounted: boolean) => {
    try {
      // Each card paints as its own request lands rather than the whole page
      // waiting on the slowest one. The summary and accounts are what the user
      // actually looks at first, so they no longer queue behind bills or goals.
      const settle = <T,>(p: Promise<{ data: T }>, apply: (d: T) => void) =>
        p.then((res) => {
          if (isMounted) {
            apply(res.data);
            setIsLoading(false);
          }
        });

      const summaryLoad = settle(
        apiClient.get<FinancialSummary>('/finance/summary'),
        (d) => setSummary(d),
      );
      const accountsLoad = settle(
        apiClient.get<Account[]>('/accounts'),
        (d) => setAccounts(d),
      );

      await Promise.all([
        summaryLoad,
        accountsLoad,
        settle(apiClient.get<Budget[]>('/budgets'), (d) => setBudgets(d)),
        settle(apiClient.get<SavingsGoal[]>('/goals'), (d) => setGoals(d)),
        settle(apiClient.get<Bill[]>('/bills'), (d) => setBills(d)),
        // Only the rows actually shown: this used to fetch the user's entire
        // transaction history and throw all but five away.
        settle(apiClient.get<Transaction[]>('/transactions', { params: { limit: 5 } }), (d) =>
          setTransactions(d),
        ),
        settle(apiClient.get<Category[]>('/categories'), (d) => setCategories(d)),
        // Optional: the dashboard still renders if this one fails.
        settle(
          apiClient
            .get<SalaryUsage | null>('/income/salary-usage')
            .catch(() => ({ data: null })),
          (d) => setSalaryUsage(d),
        ),
        // Salary that came round without being recorded. A saved stream posts
        // nothing by itself, so without this it stayed silent for months.
        settle(
          apiClient
            .get<DueIncome[]>('/income/recurring/due')
            .catch(() => ({ data: [] as DueIncome[] })),
          (d) => setDueIncome(d),
        ),
        // The streams themselves, for the countdown to the next one. Optional
        // in the same way: no streams, no card, no error.
        settle(
          apiClient
            .get<RecurringIncome[]>('/income/recurring')
            .catch(() => ({ data: [] as RecurringIncome[] })),
          (d) => setSalaryStreams(d),
        ),
      ]);

      if (isMounted) setError(null);
    } catch (err: unknown) {
      if (isMounted) {
        const msg = describeApiError(err, 'Failed to load financial dashboard.');
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
      void fetchAllData(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [refreshTrigger]);

  const handlePayBill = async (billId: string) => {
    if (accounts.length === 0) {
      addToast('Please create an account before paying bills.', 'error');
      return;
    }
    // accounts[0] is just insertion order, so a user who added their credit
    // card first would have bills silently paid from the card. Prefer an asset.
    const payFrom = accounts.find((a) => a.account_type === 'asset') ?? accounts[0];
    const bill = bills.find((b) => b.id === billId);
    try {
      await apiClient.post(`/bills/${billId}/pay`, {
        account_id: payFrom.id,
        client_mutation_id: crypto.randomUUID(),
        device_id: 'web-client',
        payment_date: new Date().toISOString(),
      });
      // Say which account the money left, rather than just "recorded".
      addToast(
        bill
          ? `Paid ${bill.name} ${formatMonetaryValue(bill.amount_minor)} from ${payFrom.name}.`
          : `Bill paid from ${payFrom.name}.`,
        'success',
      );
      void fetchAllData(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to pay bill.';
      addToast(msg, 'error');
    }
  };

  if (isLoading) return <HomeSkeleton />;
  if (error) return <ErrorState title="Dashboard Error" message={error} onRetry={() => void fetchAllData(true)} />;

  return (
    <div className="home-container">
      {/* 1. Net Worth Financial Summary Card */}
      {summary && (
        <FinancialSummaryCard
          netWorthMinor={summary.net_worth_minor}
          incomeMinor={summary.income_minor}
          expenseMinor={summary.expense_minor}
          currency={summary.currency}
        />
      )}

      {/* 2. When the next one lands. Only shown while nothing is overdue - two
             answers to "where is my salary" would contradict each other. */}
      {dueIncome.length === 0 && payday && <PaydayCard payday={payday} />}

      {/* 3. Salary that is due but unrecorded - asked, never assumed. */}
      <DueSalaryCard
        due={dueIncome}
        accounts={accounts}
        onResolved={() => void fetchAllData(true)}
      />

      {/* 3. This month's income vs spending */}
      {salaryUsage && (
        <SalaryUsageCard usage={salaryUsage} onSetUpSalary={() => setIsSalaryDialogOpen(true)} />
      )}

      {/* 4. Accounts Overview */}
      {/* The tour points at the whole section, heading included: it frosts the
          page around whatever it highlights, and anchoring on the card row
          alone left the title blurred inside the highlight. It also means the
          step still has something to point at on an account with no accounts
          yet. */}
      <div className="home-section" data-tour="accounts">
        <div className="section-title-row">
          <h2 className="heading-md">My Accounts</h2>
          <span className="text-label">{accounts.length} Total</span>
        </div>
        {accounts.length === 0 ? (
          <EmptyState art="wallet" title="No Accounts" description="Create an account to begin tracking transactions." />
        ) : (
          <div className="accounts-scroll-row">
            {accounts.map((acc) => (
              <div key={acc.id} className="account-scroll-item">
                <AccountCard account={acc} onClick={() => navigate('/accounts')} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 5. Upcoming Bills */}
      {bills.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Upcoming Bills</h2>
            <SectionLink shown={2} total={bills.length} onSeeAll={() => navigate('/plan')} />
          </div>
          <div className="vertical-cards-list">
            {bills.slice(0, 2).map((bill) => (
              <BillCard
                key={bill.id}
                bill={bill}
                onPay={() => handlePayBill(bill.id)}
                onClick={() => navigate('/plan')}
              />
            ))}
          </div>
        </div>
      )}

      {/* 6. Active Budgets */}
      {budgets.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Budget Spending</h2>
            <SectionLink shown={2} total={budgets.length} onSeeAll={() => navigate('/plan')} />
          </div>
          <div className="vertical-cards-list">
            {budgets.slice(0, 2).map((b) => (
              <BudgetCard
                key={b.id}
                budget={b}
                categoryName={b.category_name ?? undefined}
                onClick={() => navigate('/plan')}
              />
            ))}
          </div>
        </div>
      )}

      {/* 7. Savings Goals */}
      {goals.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Savings Goals</h2>
            <SectionLink shown={2} total={goals.length} onSeeAll={() => navigate('/plan')} />
          </div>
          <div className="vertical-cards-list">
            {goals.slice(0, 2).map((g) => (
              <GoalCard key={g.id} goal={g} onClick={() => navigate('/plan')} />
            ))}
          </div>
        </div>
      )}

      {/* 8. Recent Activity */}
      <div className="home-section">
        <div className="section-title-row">
          <h2 className="heading-md">Recent Transactions</h2>
          {transactions.length > 0 && (
            <button type="button" className="section-see-all" onClick={() => navigate('/activity')}>
              See all
              <ChevronRight size={14} />
            </button>
          )}
        </div>
        {transactions.length === 0 ? (
          <EmptyState art="ledger" title="No Recent Activity" description="Click + to add your first transaction." />
        ) : (
          <div className="transactions-list">
            {transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                isNew={isNewSince(tx.transaction_date, seenAt)}
                onClick={() => setSelectedTransaction(tx)}
              />
            ))}
          </div>
        )}
      </div>
      {/* One dialog: what arrived, and whether it repeats. */}
      <SalaryConfirmationModal
        isOpen={isSalaryDialogOpen}
        recurringSalary={null}
        accounts={accounts}
        categories={categories}
        onClose={() => setIsSalaryDialogOpen(false)}
        onSuccess={() => void fetchAllData(true)}
      />

      {selectedTransaction && (
        <TransactionDetailModal
          transaction={selectedTransaction}
          accountName={accounts.find((a) => a.id === selectedTransaction.account_id)?.name}
          onClose={() => setSelectedTransaction(null)}
          onDeleted={() => void fetchAllData(true)}
        />
      )}
    </div>
  );
};
