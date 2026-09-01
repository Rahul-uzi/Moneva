import React, { useState } from 'react';
import { Check, X, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';
import { formatMonetaryValue } from '../../utils/money';
import './ActionProposalCard.css';

export interface ProposedAction {
  type: 'add_expense' | 'add_income' | 'transfer' | 'bill_payment' | 'goal_contribution' | 'create_budget' | 'create_goal' | 'create_bill';
  amountPaise: number;
  description: string;
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
      case 'transfer': return 'Internal Transfer';
      case 'bill_payment': return 'Pay Bill';
      case 'goal_contribution': return 'Savings Goal Contribution';
      case 'create_budget': return 'Create Budget';
      case 'create_goal': return 'Create Savings Goal';
      case 'create_bill': return 'Create Bill';
      default: return 'Proposed Action';
    }
  };

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
