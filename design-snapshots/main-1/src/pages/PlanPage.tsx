import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Target, CreditCard, PieChart, ChevronRight } from 'lucide-react';
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
import { ErrorState, EmptyState } from '../components/ui/States';
import { PlanSkeleton } from '../components/ui/Skeleton';
import { apiClient, describeApiError } from '../services/apiClient';
import { useUiStore } from '../stores/useUiStore';
import { formatMonetaryCompact } from '../utils/money';
import { parseApiDate } from '../utils/datetime';
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
  // The extra reminders stay collapsed: the first one is the urgent one, and
  // a stack of warnings above the content pushes the plan itself off screen.
  const [showAllStatuses, setShowAllStatuses] = useState<boolean>(false);

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
        const msg = describeApiError(err, 'Failed to load financial plan.');
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

    // Clamped so an overspent budget fills the bar rather than overflowing it.
    const budgetPct = totalBudgetLimit > 0
      ? Math.min(100, Math.round((totalBudgetSpent / totalBudgetLimit) * 100))
      : 0;
    const goalPct = totalGoalTarget > 0
      ? Math.min(100, Math.round((totalGoalSaved / totalGoalTarget) * 100))
      : 0;

    return {
      totalBudgetLimit,
      totalBudgetSpent,
      totalGoalTarget,
      totalGoalSaved,
      totalBillsOwed,
      budgetPct,
      goalPct,
      isOverBudget: totalBudgetLimit > 0 && totalBudgetSpent > totalBudgetLimit,
      billsDueCount: bills.filter((b) => b.status === 'upcoming').length,
    };
  }, [budgets, goals, bills]);

  /** Nothing planned at all - one invitation reads better than three refusals. */
  const isPlanEmpty = budgets.length === 0 && goals.length === 0 && bills.length === 0;

  /**
   * Everything that needs attention, most urgent first.
   *
   * This was a single line, so a month with an overspent budget AND a bill
   * landing tomorrow only ever admitted to one of them. Every item is listed
   * now; the page shows the first and keeps the rest one tap away rather than
   * spending half a screen on warnings.
   */
  const statuses = useMemo(() => {
    type Status = {
      id: string;
      tone: 'danger' | 'warn' | 'good';
      kind: 'overspend' | 'bill' | 'goals' | 'budgets';
      bill: Bill | null;
      hint: string;
      text: string;
    };
    const out: Status[] = [];

    // Money already spent that should not have been - the only item you can no
    // longer do anything about, so it comes first.
    budgets
      .filter((b) => (b.spent_amount_minor || 0) > b.limit_amount_minor)
      .forEach((b) => {
        const name = categories.find((c) => c.id === b.category_id)?.name ?? 'A budget';
        const over = (b.spent_amount_minor || 0) - b.limit_amount_minor;
        out.push({
          id: `over:${b.id}`,
          tone: 'danger',
          kind: 'overspend',
          bill: null,
          hint: 'Review',
          text: `${name} over by ${formatMonetaryCompact(over)}`,
        });
      });

    // Read once per evaluation, matching how ActivityPage derives its period.
    const nowMs = new Date().getTime();
    bills
      .filter((b) => b.status === 'upcoming')
      .map((b) => ({
        bill: b,
        days: Math.ceil((parseApiDate(b.due_date).getTime() - nowMs) / 86400000),
      }))
      .filter((x) => x.days <= 7)
      .sort((a, b) => a.days - b.days)
      .forEach((x) => {
        const when =
          x.days < 0 ? 'overdue' : x.days === 0 ? 'due today' : `due in ${x.days}d`;
        out.push({
          id: `bill:${x.bill.id}`,
          tone: x.days < 0 ? 'danger' : 'warn',
          kind: 'bill',
          bill: x.bill,
          hint: 'View bill',
          text: `${x.bill.name} ${when}`,
        });
      });

    // Nothing is wrong: say something worth knowing instead of nothing at all.
    if (out.length === 0) {
      if (metrics.totalGoalTarget > 0) {
        out.push({
          id: 'goals',
          tone: 'good',
          kind: 'goals',
          bill: null,
          hint: 'See goals',
          text: `${metrics.goalPct}% of the way to your goals`,
        });
      } else if (budgets.length > 0) {
        out.push({
          id: 'budgets',
          tone: 'good',
          kind: 'budgets',
          bill: null,
          hint: 'See budgets',
          text: `${metrics.budgetPct}% of your budgets used`,
        });
      }
    }

    return out;
  }, [budgets, bills, categories, metrics]);

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

  if (isLoading) return <PlanSkeleton />;
  if (error) return <ErrorState title="Plan Error" message={error} onRetry={() => void fetchPlanData(true)} />;

  return (
    <div className="plan-page-container">
      {/* The subtitle used to spell out "Budgets, Savings Goals & Bills" directly
          above tabs that say exactly that, and the three actions were styled
          primary / secondary / ghost despite being peers. */}
      <div className="plan-header">
        <h1 className="heading-lg">Plan</h1>
        {/* Hidden while the plan is empty: the card below already offers these
            three, and showing both put the same actions on screen twice. */}
        {!isPlanEmpty && (
        <div className="plan-action-btns" data-tour="plan-add">
          <button type="button" className="plan-add-btn" onClick={() => setIsBudgetModalOpen(true)}>
            <Plus size={14} /> Budget
          </button>
          <button type="button" className="plan-add-btn" onClick={() => setIsGoalModalOpen(true)}>
            <Plus size={14} /> Goal
          </button>
          <button type="button" className="plan-add-btn" onClick={() => setIsBillModalOpen(true)}>
            <Plus size={14} /> Bill
          </button>
        </div>
        )}
      </div>

      {/* Three equal columns. Each box used to size to its own content, so
          "X / Y" wrapped onto two lines, the dividers landed at different
          heights and the bills icon was orphaned beside its label. The figure
          that matters is now on top with its context beneath it. */}
      {!isPlanEmpty && (
        <div className="plan-metrics-card" data-tour="plan-metrics">
          <div className="plan-metric-box">
            <span className="metric-label"><PieChart size={13} className="icon-blue" /> Budgets</span>
            <span className={`number-md ${metrics.isOverBudget ? 'text-coral' : 'text-main'}`}>
              {formatMonetaryCompact(metrics.totalBudgetSpent)}
            </span>
            <span className="metric-sub">of {formatMonetaryCompact(metrics.totalBudgetLimit)}</span>
            <span className="metric-bar">
              <span
                className={`metric-bar-fill ${metrics.isOverBudget ? 'is-over' : 'is-budget'}`}
                style={{ width: `${metrics.budgetPct}%` }}
              />
            </span>
          </div>

          <div className="plan-metric-box">
            <span className="metric-label"><Target size={13} className="icon-teal" /> Saved</span>
            <span className="number-md text-teal">{formatMonetaryCompact(metrics.totalGoalSaved)}</span>
            <span className="metric-sub">of {formatMonetaryCompact(metrics.totalGoalTarget)}</span>
            <span className="metric-bar">
              <span className="metric-bar-fill is-goal" style={{ width: `${metrics.goalPct}%` }} />
            </span>
          </div>

          <div className="plan-metric-box">
            <span className="metric-label"><CreditCard size={13} className="icon-coral" /> Bills due</span>
            <span className="number-md text-coral">{formatMonetaryCompact(metrics.totalBillsOwed)}</span>
            <span className="metric-sub">
              {metrics.billsDueCount === 1 ? '1 upcoming' : `${metrics.billsDueCount} upcoming`}
            </span>
            <span className="metric-bar" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* The totals above say what the numbers are; this says what to do - and
          now does it. It looked like a notice you could tap and nothing
          happened, which is worse than not looking tappable at all. */}
      {statuses.length > 0 && (
        <div className="plan-status-list">
          {(showAllStatuses ? statuses : statuses.slice(0, 1)).map((st) => (
            <button
              key={st.id}
              type="button"
              className={`plan-status plan-status-${st.tone}`}
              onClick={() => {
                if (st.kind === 'bill' && st.bill) setSelectedBillDetail(st.bill);
                else if (st.kind === 'overspend' || st.kind === 'budgets') setActiveTab('budgets');
                else setActiveTab('goals');
              }}
            >
              <span className="plan-status-dot" aria-hidden="true" />
              <span className="plan-status-text">{st.text}</span>
              <span className="plan-status-hint">{st.hint}</span>
              <ChevronRight size={16} className="plan-status-chevron" />
            </button>
          ))}

          {/* Says how many are hidden, so one urgent line never implies it is
              the only thing wrong. */}
          {statuses.length > 1 && (
            <button
              type="button"
              className="plan-status-more"
              onClick={() => setShowAllStatuses((v) => !v)}
            >
              {showAllStatuses
                ? 'Show less'
                : `+${statuses.length - 1} more ${statuses.length === 2 ? 'reminder' : 'reminders'}`}
            </button>
          )}
        </div>
      )}

      {/* Counts were dropped here for the same reason as the Activity tabs:
          four "(0)"s is noise, and the section headers already say how many. */}
      {!isPlanEmpty && (
      <div className="plan-filter-tabs">
        <button
          type="button"
          className={`filter-tab ${activeTab === 'all' ? 'tab-active-all' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'budgets' ? 'tab-active-asset' : ''}`}
          onClick={() => setActiveTab('budgets')}
        >
          Budgets
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'goals' ? 'tab-active-income' : ''}`}
          onClick={() => setActiveTab('goals')}
        >
          Goals
        </button>
        <button
          type="button"
          className={`filter-tab ${activeTab === 'bills' ? 'tab-active-liability' : ''}`}
          onClick={() => setActiveTab('bills')}
        >
          Bills
        </button>
      </div>
      )}

      {/* An account with nothing planned used to render three full empty
          states back to back - three identical illustrations over roughly a
          screen and a half of scrolling, all saying the same thing. */}
      {isPlanEmpty && (
        <div className="plan-empty">
          <span className="plan-empty-icon"><Target size={26} /></span>
          <h2 className="heading-md">Nothing planned yet</h2>
          <p className="text-body text-sm text-muted">
            Set spending limits, save towards something, and never miss a bill.
            Start with whichever matters most.
          </p>
          <div className="plan-empty-actions">
            <button type="button" className="plan-empty-btn" onClick={() => setIsBudgetModalOpen(true)}>
              <PieChart size={16} className="icon-blue" />
              <span className="plan-empty-btn-title">Budget</span>
              <span className="plan-empty-btn-sub">Cap a category</span>
            </button>
            <button type="button" className="plan-empty-btn" onClick={() => setIsGoalModalOpen(true)}>
              <Target size={16} className="icon-teal" />
              <span className="plan-empty-btn-title">Goal</span>
              <span className="plan-empty-btn-sub">Save towards it</span>
            </button>
            <button type="button" className="plan-empty-btn" onClick={() => setIsBillModalOpen(true)}>
              <CreditCard size={16} className="icon-coral" />
              <span className="plan-empty-btn-title">Bill</span>
              <span className="plan-empty-btn-sub">Get reminded</span>
            </button>
          </div>
        </div>
      )}

      {/* Keyed on the tab so the card cascade replays when the filter changes -
          otherwise the list swaps in place with nothing to show it reacted. */}
      <div className="plan-sections" key={activeTab}>

      {/* 1. Category Budgets Section */}
      {!isPlanEmpty && (activeTab === 'all' || activeTab === 'budgets') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Budgets</h2>
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
      {!isPlanEmpty && (activeTab === 'all' || activeTab === 'goals') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Savings Goals</h2>
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
      {!isPlanEmpty && (activeTab === 'all' || activeTab === 'bills') && (
        <div className="plan-section">
          <div className="section-title-row">
            <h2 className="heading-md">Bills</h2>
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

      </div>

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
