import React, { useEffect, useState } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { FinancialSummaryCard } from '../components/financial/FinancialSummaryCard';
import { SalaryUsageCard } from '../components/financial/SalaryUsageCard';
import { AccountCard } from '../components/financial/AccountCard';
import { BudgetCard } from '../components/financial/BudgetCard';
import { GoalCard } from '../components/financial/GoalCard';
import { BillCard } from '../components/financial/BillCard';
import { TransactionRow } from '../components/financial/TransactionRow';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/States';
import { apiClient } from '../services/apiClient';
import { useUiStore } from '../stores/useUiStore';
import type { FinancialSummary, Account, Budget, SavingsGoal, Bill, Transaction, SalaryUsage } from '../types/api';
import './HomePage.css';

interface OutletContextType {
  refreshTrigger?: number;
}

export const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [salaryUsage, setSalaryUsage] = useState<SalaryUsage | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  const fetchAllData = async (isMounted: boolean) => {
    try {
      const [sumRes, accRes, budRes, goalRes, billRes, txRes, salaryRes] = await Promise.all([
        apiClient.get<FinancialSummary>('/finance/summary'),
        apiClient.get<Account[]>('/accounts'),
        apiClient.get<Budget[]>('/budgets'),
        apiClient.get<SavingsGoal[]>('/goals'),
        apiClient.get<Bill[]>('/bills'),
        apiClient.get<Transaction[]>('/transactions'),
        // Optional: the dashboard still renders if this one fails.
        apiClient.get<SalaryUsage>('/income/salary-usage').catch(() => ({ data: null })),
      ]);

      if (isMounted) {
        setSummary(sumRes.data);
        setSalaryUsage(salaryRes.data);
        setAccounts(accRes.data);
        setBudgets(budRes.data);
        setGoals(goalRes.data);
        setBills(billRes.data);
        setTransactions(txRes.data.slice(0, 5));
        setError(null);
      }
    } catch (err: unknown) {
      if (isMounted) {
        const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to load financial dashboard.';
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
    try {
      await apiClient.post(`/bills/${billId}/pay`, {
        account_id: accounts[0].id,
        client_mutation_id: crypto.randomUUID(),
        device_id: 'web-client',
        payment_date: new Date().toISOString(),
      });
      addToast('Bill payment recorded successfully!', 'success');
      void fetchAllData(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to pay bill.';
      addToast(msg, 'error');
    }
  };

  if (isLoading) return <LoadingState message="Calculating live ledger metrics..." />;
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

      {/* 2. This month's income vs spending */}
      {salaryUsage && (
        <SalaryUsageCard usage={salaryUsage} onSetUpSalary={() => navigate('/plan')} />
      )}

      {/* 3. Accounts Overview */}
      <div className="home-section">
        <div className="section-title-row">
          <h2 className="heading-md">My Accounts</h2>
          <span className="text-label">{accounts.length} Total</span>
        </div>
        {accounts.length === 0 ? (
          <EmptyState title="No Accounts" description="Create an account to begin tracking transactions." />
        ) : (
          <div className="accounts-scroll-row">
            {accounts.map((acc) => (
              <div key={acc.id} className="account-scroll-item">
                <AccountCard account={acc} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Upcoming Bills */}
      {bills.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Upcoming Bills</h2>
          </div>
          <div className="vertical-cards-list">
            {bills.slice(0, 2).map((bill) => (
              <BillCard key={bill.id} bill={bill} onPay={() => handlePayBill(bill.id)} />
            ))}
          </div>
        </div>
      )}

      {/* 4. Active Budgets */}
      {budgets.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Budget Spending</h2>
          </div>
          <div className="vertical-cards-list">
            {budgets.slice(0, 2).map((b) => (
              <BudgetCard key={b.id} budget={b} />
            ))}
          </div>
        </div>
      )}

      {/* 5. Savings Goals */}
      {goals.length > 0 && (
        <div className="home-section">
          <div className="section-title-row">
            <h2 className="heading-md">Savings Goals</h2>
          </div>
          <div className="vertical-cards-list">
            {goals.slice(0, 2).map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
        </div>
      )}

      {/* 6. Recent Activity */}
      <div className="home-section">
        <div className="section-title-row">
          <h2 className="heading-md">Recent Transactions</h2>
        </div>
        {transactions.length === 0 ? (
          <EmptyState title="No Recent Activity" description="Click + to add your first transaction." />
        ) : (
          <div className="transactions-list">
            {transactions.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
