import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Target, CreditCard, PieChart } from 'lucide-react';
import { BudgetCard } from '../components/financial/BudgetCard';
import { GoalCard } from '../components/financial/GoalCard';
import { BillCard } from '../components/financial/BillCard';
import { BudgetModal } from '../components/financial/BudgetModal';
import { BudgetDetailModal } from '../components/financial/BudgetDetailModal';
import { GoalModal } from '../components/financial/GoalModal';
import { GoalDetailModal } from '../components/financial/GoalDetailModal';
import { GoalContributionModal } from '../components/financial/GoalContributionModal';
import { BillModal } from '../components/financial/BillModal';
import { BillDetailModal } from '../components/financial/BillDetailModal';
import { BillPayModal } from '../components/financial/BillPayModal';
import { ConfirmationDialog } from '../components/ui/ConfirmationDialog';
import { Button } from '../components/ui/Button';
import { LoadingState, ErrorState, EmptyState } from '../components/ui/States';
import { apiClient } from '../services/apiClient';
import { useUiStore } from '../stores/useUiStore';
import { formatMonetaryValue } from '../utils/money';
import type { Budget, SavingsGoal, Bill, Category, Account } from '../types/api';
import './PlanPage.css';

interface OutletContextType {
  refreshTrigger?: number;
}

export const PlanPage: React.FC = () => {
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active view filter tab
  const [activeTab, setActiveTab] = useState<'all' | 'budgets' | 'goals' | 'bills'>('all');

  // Modals state
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState<boolean>(false);
  const [budgetToEdit, setBudgetToEdit] = useState<Budget | null>(null);
  const [selectedBudgetDetail, setSelectedBudgetDetail] = useState<Budget | null>(null);

  const [isGoalModalOpen, setIsGoalModalOpen] = useState<boolean>(false);
  const [goalToEdit, setGoalToEdit] = useState<SavingsGoal | null>(null);
  const [selectedGoalDetail, setSelectedGoalDetail] = useState<SavingsGoal | null>(null);
  const [selectedGoalContribution, setSelectedGoalContribution] = useState<SavingsGoal | null>(null);

  const [isBillModalOpen, setIsBillModalOpen] = useState<boolean>(false);
  const [billToEdit, setBillToEdit] = useState<Bill | null>(null);
  const [billToPay, setBillToPay] = useState<Bill | null>(null);
  const [selectedBillDetail, setSelectedBillDetail] = useState<Bill | null>(null);

  // Delete Dialog state
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'budget' | 'goal' | 'bill';
    id: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const { addToast } = useUiStore();

  const fetchPlanData = useCallback(async (isMounted: boolean) => {
    try {
      const [budRes, goalRes, billRes, catRes, accRes] = await Promise.all([
        apiClient.get<Budget[]>('/budgets'),
        apiClient.get<SavingsGoal[]>('/goals'),
        apiClient.get<Bill[]>('/bills'),
        apiClient.get<Category[]>('/categories'),
        apiClient.get<Account[]>('/accounts'),
      ]);

      if (isMounted) {
        setBudgets(budRes.data);
        setGoals(goalRes.data);
        setBills(billRes.data);
        setCategories(catRes.data);
        setAccounts(accRes.data);
        setError(null);
      }
    } catch (err: unknown) {
      if (isMounted) {
        const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to load financial plan.';
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
      void fetchPlanData(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [fetchPlanData, refreshTrigger]);

  // Overall Plan Metrics
  const metrics = useMemo(() => {
    const totalBudgetLimit = budgets.reduce((acc, b) => acc + b.limit_amount_minor, 0);
    const totalBudgetSpent = budgets.reduce((acc, b) => acc + (b.spent_amount_minor || 0), 0);

    const totalGoalTarget = goals.reduce((acc, g) => acc + g.target_amount_minor, 0);
    const totalGoalSaved = goals.reduce((acc, g) => acc + (g.current_saved_minor || 0), 0);

    const totalBillsOwed = bills
      .filter((b) => b.status === 'upcoming')
      .reduce((acc, b) => acc + b.amount_minor, 0);

    return {
      totalBudgetLimit,
      totalBudgetSpent,
      totalGoalTarget,
      totalGoalSaved,
      totalBillsOwed,
    };
  }, [budgets, goals, bills]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      if (deleteTarget.type === 'budget') {
        await apiClient.delete(`/budgets/${deleteTarget.id}`);
        addToast(`Budget deleted successfully.`, 'info');
      } else if (deleteTarget.type === 'goal') {
        await apiClient.delete(`/goals/${deleteTarget.id}`);
        addToast(`Savings goal deleted successfully.`, 'info');
      } else if (deleteTarget.type === 'bill') {
        await apiClient.delete(`/bills/${deleteTarget.id}`);
        addToast(`Bill deleted successfully.`, 'info');
      }
      setDeleteTarget(null);
      void fetchPlanData(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to delete item.';
      addToast(msg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) return <LoadingState message="Calculating budgets & goal targets..." />;
  if (error) return <ErrorState title="Plan Error" message={error} onRetry={() => void fetchPlanData(true)} />;

  return (
    <div className="plan-page-container">
      <div className="plan-header">
        <div>
          <h1 className="heading-lg">Financial Planner</h1>
          <span className="text-label">Budgets, Savings Goals & Bills</span>
        </div>
        <div className="plan-action-btns">
          <Button variant="primary" size="sm" onClick={() => setIsBudgetModalOpen(true)}>
            <Plus size={14} /> Budget
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setIsGoalModalOpen(true)}>
            <Plus size={14} /> Goal
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsBillModalOpen(true)}>
            <Plus size={14} /> Bill
          </Button>
        </div>
      </div>

      {/* Planner Summary Metrics Banner */}
      <div className="plan-metrics-card">
        <div className="plan-metric-box">
          <span className="metric-label"><PieChart size={14} className="icon-blue" /> Budgets Spent</span>
          <span className="number-md text-main">
            {formatMonetaryValue(metrics.totalBudgetSpent)} / {formatMonetaryValue(metrics.totalBudgetLimit)}
          </span>
        </div>
        <div className="metric-divider" />
        <div className="plan-metric-box">
          <span className="metric-label"><Target size={14} className="icon-teal" /> Savings Progress</span>
          <span className="number-md text-teal">
            {formatMonetaryValue(metrics.totalGoalSaved)} / {formatMonetaryValue(metrics.totalGoalTarget)}
          </span>
        </div>
        <div className="metric-divider" />
        <div className="plan-metric-box">
          <span className="metric-label"><CreditCard size={14} className="icon-coral" /> Due Bills Owed</span>
          <span className="number-md text-coral">{formatMonetaryValue(metrics.totalBillsOwed)}</span>
        </div>
      </div>

      {/* View Filter Tabs */}
      <div className="plan-filter-tabs">
        <button
          type="button"
          className={`filter-tab ${activeTab === 'all' ? 'tab-active-all' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All ({budgets.length + goals.length + bills.length})
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'budgets' ? 'tab-active-asset' : ''}`}
          onClick={() => setActiveTab('budgets')}
        >
          Budgets ({budgets.length})
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'goals' ? 'tab-active-income' : ''}`}
          onClick={() => setActiveTab('goals')}
        >
          Goals ({goals.length})
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'bills' ? 'tab-active-liability' : ''}`}
          onClick={() => setActiveTab('bills')}
        >
          Bills ({bills.length})
        </button>
      </div>

      {/* 1. Category Budgets Section */}
      {(activeTab === 'all' || activeTab === 'budgets') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Category Spending Budgets</h2>
            <span className="text-label">{budgets.length} Active</span>
          </div>

          {budgets.length === 0 ? (
            <EmptyState
              title="No Budgets Defined"
              description="Define category spending limits to prevent overspending."
              actionLabel="Add Budget"
              onAction={() => setIsBudgetModalOpen(true)}
            />
          ) : (
            <div className="cards-grid">
              {budgets.map((b) => {
                const cat = categories.find((c) => c.id === b.category_id);
                return (
                  <div key={b.id} className="plan-card-wrapper">
                    <BudgetCard
                      budget={b}
                      categoryName={cat?.name || 'Category'}
                      onClick={() => setSelectedBudgetDetail(b)}
                    />
                    <div className="card-quick-actions">
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => {
                          setBudgetToEdit(b);
                          setIsBudgetModalOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="card-action-btn btn-danger"
                        onClick={() =>
                          setDeleteTarget({
                            type: 'budget',
                            id: b.id,
                            name: `Budget (${cat?.name || 'Category'})`,
                          })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. Savings Goals Section */}
      {(activeTab === 'all' || activeTab === 'goals') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Savings Targets & Goals</h2>
            <span className="text-label">{goals.length} Active</span>
          </div>

          {goals.length === 0 ? (
            <EmptyState
              title="No Savings Goals"
              description="Set targets for emergency funds, vacations, or major purchases."
              actionLabel="Add Goal"
              onAction={() => setIsGoalModalOpen(true)}
            />
          ) : (
            <div className="cards-grid">
              {goals.map((g) => (
                <div key={g.id} className="plan-card-wrapper">
                  <GoalCard
                    goal={g}
                    onClick={() => setSelectedGoalDetail(g)}
                    onContribute={(goalToFund) => setSelectedGoalContribution(goalToFund)}
                  />
                  <div className="card-quick-actions">
                    <button
                      type="button"
                      className="card-action-btn"
                      onClick={() => {
                        setGoalToEdit(g);
                        setIsGoalModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="card-action-btn btn-danger"
                      onClick={() =>
                        setDeleteTarget({
                          type: 'goal',
                          id: g.id,
                          name: g.name,
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Bills & Reminders Section */}
      {(activeTab === 'all' || activeTab === 'bills') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Bills & Recurring Obligations</h2>
            <span className="text-label">{bills.length} Tracked</span>
          </div>

          {bills.length === 0 ? (
            <EmptyState
              title="No Bill Reminders"
              description="Keep track of recurring electricity, internet, or subscription bills."
              actionLabel="Add Bill"
              onAction={() => setIsBillModalOpen(true)}
            />
          ) : (
            <div className="cards-grid">
              {bills.map((b) => (
                <div key={b.id} className="plan-card-wrapper">
                  <BillCard
                    bill={b}
                    onClick={() => setSelectedBillDetail(b)}
                    onPay={() => setBillToPay(b)}
                  />
                  <div className="card-quick-actions">
                    <button
                      type="button"
                      className="card-action-btn"
                      onClick={() => {
                        setBillToEdit(b);
                        setIsBillModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="card-action-btn btn-danger"
                      onClick={() =>
                        setDeleteTarget({
                          type: 'bill',
                          id: b.id,
                          name: b.name,
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Budget Modal */}
      <BudgetModal
        isOpen={isBudgetModalOpen}
        budgetToEdit={budgetToEdit}
        categories={categories}
        onClose={() => {
          setIsBudgetModalOpen(false);
          setBudgetToEdit(null);
        }}
        onSuccess={() => void fetchPlanData(true)}
      />

      {/* Budget Detail Modal */}
      <BudgetDetailModal
        budget={selectedBudgetDetail}
        category={categories.find((c) => c.id === selectedBudgetDetail?.category_id)}
        onClose={() => setSelectedBudgetDetail(null)}
        onEdit={(b) => {
          setBudgetToEdit(b);
          setIsBudgetModalOpen(true);
        }}
        onDelete={(b) => {
          const cat = categories.find((c) => c.id === b.category_id);
          setDeleteTarget({
            type: 'budget',
            id: b.id,
            name: `Budget (${cat?.name || 'Category'})`,
          });
        }}
      />

      {/* Goal Modal */}
      <GoalModal
        isOpen={isGoalModalOpen}
        goalToEdit={goalToEdit}
        onClose={() => {
          setIsGoalModalOpen(false);
          setGoalToEdit(null);
        }}
        onSuccess={() => void fetchPlanData(true)}
      />

      {/* Goal Detail Modal */}
      <GoalDetailModal
        goal={selectedGoalDetail}
        onClose={() => setSelectedGoalDetail(null)}
        onContribute={(g) => setSelectedGoalContribution(g)}
        onEdit={(g) => {
          setGoalToEdit(g);
          setIsGoalModalOpen(true);
        }}
        onDelete={(g) => {
          setDeleteTarget({
            type: 'goal',
            id: g.id,
            name: g.name,
          });
        }}
      />

      {/* Goal Contribution Modal */}
      <GoalContributionModal
        goal={selectedGoalContribution}
        accounts={accounts}
        onClose={() => setSelectedGoalContribution(null)}
        onSuccess={() => void fetchPlanData(true)}
      />

      {/* Bill Modal */}
      <BillModal
        isOpen={isBillModalOpen}
        billToEdit={billToEdit}
        categories={categories}
        onClose={() => {
          setIsBillModalOpen(false);
          setBillToEdit(null);
        }}
        onSuccess={() => void fetchPlanData(true)}
      />

      {/* Bill Detail Modal */}
      <BillDetailModal
        bill={selectedBillDetail}
        category={categories.find((c) => c.id === selectedBillDetail?.category_id)}
        onClose={() => setSelectedBillDetail(null)}
        onPay={(b) => setBillToPay(b)}
        onEdit={(b) => {
          setBillToEdit(b);
          setIsBillModalOpen(true);
        }}
        onDelete={(b) => {
          setDeleteTarget({
            type: 'bill',
            id: b.id,
            name: b.name,
          });
        }}
      />

      {/* Bill Pay Modal */}
      <BillPayModal
        bill={billToPay}
        accounts={accounts}
        onClose={() => setBillToPay(null)}
        onSuccess={() => void fetchPlanData(true)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!deleteTarget}
        title="Delete Item"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onClose={() => setDeleteTarget(null)}
        isLoading={isDeleting}
      />
    </div>
  );
};
