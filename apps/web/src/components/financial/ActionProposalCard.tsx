import React, { useState } from 'react';
import { Check, X, ShieldAlert, CalendarRange } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatMonetaryValue } from '../../utils/money';
import './ActionProposalCard.css';

export interface ProposedAction {
  type:
    | 'add_expense'
    | 'add_income'
    | 'bill_payment'
    | 'goal_contribution'
    | 'create_budget'
    | 'create_goal'
    | 'create_bill'
    // Money lent to a person, and that money coming back. Neither moves a
    // balance: the rupees left the bank when they were lent, and the ledger
    // recorded that already.
    | 'remember_debt'
    | 'settle_debt'
    // A spending plan the assistant wrote, offered for the Plan tab.
    | 'budget_plan';
  amountPaise: number;
  description: string;
  /** Whose debt it is - only the two debt actions carry this. */
  person?: string;
  /** 'owed_to_me' or 'i_owe'. */
  debtDirection?: string;
  /** The existing debt a settlement points at, matched by name on the server. */
  debtId?: string;
  /** Only for budget_plan: each line, already matched to a real category. */
  planItems?: PlanLine[];
  /** Names in the plan that matched no category - shown, never guessed at. */
  planUnmatched?: string[];
  categoryName?: string;
  accountName?: string;
  toAccountName?: string;
  savingsGoalName?: string;
  billName?: string;
  accountId?: string;
  toAccountId?: string;
  categoryId?: string;
  savingsGoalId?: string;
  billId?: string;
}

export interface PlanLine {
  categoryId: string;
  categoryName: string;
  amountPaise: number;
  /** This month's budget for the category today, if it has one. */
  currentPaise?: number | null;
}

interface ActionProposalCardProps {
  proposal: ProposedAction;
  onConfirm: (proposal: ProposedAction) => Promise<void>;
  onCancel: () => void;
}

export const ActionProposalCard: React.FC<ActionProposalCardProps> = ({
  proposal,
  onConfirm,
  onCancel,
}) => {
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setIsExecuting(true);
    setError(null);
    try {
      await onConfirm(proposal);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to execute proposed action.';
      setError(msg);
    } finally {
      setIsExecuting(false);
    }
  };

  const getActionTitle = () => {
    switch (proposal.type) {
      case 'add_expense': return 'Add Expense';
      case 'add_income': return 'Add Income';
      case 'bill_payment': return 'Pay Bill';
      case 'goal_contribution': return 'Savings Goal Contribution';
      case 'create_budget': return 'Create Budget';
      case 'create_goal': return 'Create Savings Goal';
      case 'create_bill': return 'Create Bill';
      case 'remember_debt':
        return proposal.debtDirection === 'i_owe' ? 'Remember what you owe' : 'Remember who owes you';
      case 'settle_debt': return 'Mark as paid back';
      default: return 'Proposed Action';
    }
  };

  /* A plan is a different kind of question. Every other card asks "record
     this one thing?"; this one asks "keep this whole month?", so it shows the
     month - each category, what it is today and what it would become - and
     says plainly where it goes and that nothing is doubled. */
  if (proposal.type === 'budget_plan') {
    const lines = proposal.planItems ?? [];
    const total = lines.reduce((sum, l) => sum + l.amountPaise, 0);
    return (
      <div className="action-proposal-card proposal-plan">
        <div className="proposal-header">
          <CalendarRange size={18} className="proposal-icon" />
          <span className="proposal-title">Save this plan to your Plan tab?</span>
        </div>

        {lines.length > 0 ? (
          <ul className="plan-lines">
            {lines.map((l) => (
              <li key={l.categoryId} className="plan-line">
                <span className="plan-line-name">{l.categoryName}</span>
                <span className="plan-line-amount">
                  {l.currentPaise != null && l.currentPaise !== l.amountPaise && (
                    <span className="plan-line-was">{formatMonetaryValue(l.currentPaise)} &rarr; </span>
                  )}
                  {formatMonetaryValue(l.amountPaise)}
                </span>
              </li>
            ))}
            <li className="plan-line plan-line-total">
              <span className="plan-line-name">Monthly spending limit</span>
              <span className="plan-line-amount">{formatMonetaryValue(total)}</span>
            </li>
          </ul>
        ) : (
          <p className="proposal-note">None of this plan's categories match yours, so there is nothing to save.</p>
        )}

        {proposal.planUnmatched && proposal.planUnmatched.length > 0 && (
          <p className="proposal-note">
            Not included &mdash; you have no category called {proposal.planUnmatched.join(', ')}.
          </p>
        )}

        <p className="proposal-note">
          Saved as this month&rsquo;s budgets. A category that already has one is updated, never doubled.
        </p>

        {error && <div className="proposal-error">{error}</div>}

        <div className="proposal-actions">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isExecuting}>
            <X size={14} /> Not now
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            isLoading={isExecuting}
            disabled={lines.length === 0}
          >
            <Check size={14} /> Save to Plan
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="action-proposal-card">
      <div className="proposal-header">
        <ShieldAlert size={18} className="proposal-icon" />
        <span className="proposal-title">Proposed Action</span>
      </div>

      <div className="proposal-content">
        <div className="proposal-detail-row">
          <span className="detail-label">Action</span>
          <span className="detail-val font-semibold">{getActionTitle()}</span>
        </div>

        {proposal.amountPaise > 0 && (
          <div className="proposal-detail-row">
            <span className="detail-label">Amount</span>
            <span className="detail-val number-md text-coral font-semibold">
              {formatMonetaryValue(proposal.amountPaise)}
            </span>
          </div>
        )}

        <div className="proposal-detail-row">
          <span className="detail-label">Description</span>
          <span className="detail-val">{proposal.description}</span>
        </div>

        {proposal.person && (
          <div className="proposal-detail-row">
            <span className="detail-label">
              {proposal.debtDirection === 'i_owe' ? 'You owe' : 'Owed by'}
            </span>
            <span className="detail-val">{proposal.person}</span>
          </div>
        )}

        {/* Said on the card itself, where the user is deciding. A reminder
            that silently looked like a balance would be worse than none. */}
        {(proposal.type === 'remember_debt' || proposal.type === 'settle_debt') && (
          <p className="proposal-note">
            This is a reminder only &mdash; it does not change any balance or budget.
          </p>
        )}

        {proposal.accountName && (
          <div className="proposal-detail-row">
            <span className="detail-label">Account</span>
            <span className="detail-val">{proposal.accountName}</span>
          </div>
        )}

        {proposal.toAccountName && (
          <div className="proposal-detail-row">
            <span className="detail-label">To Account</span>
            <span className="detail-val">{proposal.toAccountName}</span>
          </div>
        )}

        {proposal.categoryName && (
          <div className="proposal-detail-row">
            <span className="detail-label">Category</span>
            <span className="detail-val">{proposal.categoryName}</span>
          </div>
        )}

        {proposal.billName && (
          <div className="proposal-detail-row">
            <span className="detail-label">Bill</span>
            <span className="detail-val">{proposal.billName}</span>
          </div>
        )}

        {proposal.savingsGoalName && (
          <div className="proposal-detail-row">
            <span className="detail-label">Savings Goal</span>
            <span className="detail-val">{proposal.savingsGoalName}</span>
          </div>
        )}
      </div>

      {error && <div className="proposal-error">{error}</div>}

      <div className="proposal-actions">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isExecuting}>
          <X size={14} /> Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleConfirm} isLoading={isExecuting}>
          <Check size={14} /> Confirm & Execute
        </Button>
      </div>
    </div>
  );
};
