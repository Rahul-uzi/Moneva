import React from 'react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Card } from '../ui/Card';
import type { Budget } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './BudgetCard.css';

interface BudgetCardProps {
  budget: Budget;
  categoryName?: string;
  onClick?: () => void;
}

export const BudgetCard: React.FC<BudgetCardProps> = ({ budget, categoryName = 'Category', onClick }) => {
  const spent = budget.spent_amount_minor || 0;
  const limit = budget.limit_amount_minor;
  const remaining = budget.remaining_amount_minor ?? Math.max(0, limit - spent);
  const rawRatio = limit > 0 ? (spent / limit) * 100 : 0;
  const percent = Math.min(100, Math.round(rawRatio));
  const isOver = spent > limit;

  // Semantic Status Color Logic
  let status = {
    label: 'Healthy',
    badgeClass: 'badge-healthy',
    fillClass: 'fill-healthy',
    icon: CheckCircle2,
  };

  if (isOver) {
    status = {
      label: 'Over Budget',
      badgeClass: 'badge-over',
      fillClass: 'fill-over',
      icon: AlertTriangle,
    };
  } else if (rawRatio >= 85) {
    status = {
      label: 'Near Limit',
      badgeClass: 'badge-warning',
      fillClass: 'fill-warning',
      icon: AlertTriangle,
    };
  } else if (rawRatio >= 70) {
    status = {
      label: 'Normal',
      badgeClass: 'badge-normal',
      fillClass: 'fill-normal',
      icon: Info,
    };
  }

  const StatusIcon = status.icon;

  return (
    <Card variant="surface" interactive onClick={onClick} className="budget-card">
      <div className="budget-header">
        <div className="budget-title-box">
          <span className="budget-cat-name">{categoryName}</span>
          <div className={`budget-status-pill ${status.badgeClass}`}>
            <StatusIcon size={11} />
            <span>{status.label}</span>
          </div>
        </div>
        <span className={`budget-percent ${status.badgeClass}`}>{percent}%</span>
      </div>

      <div className="budget-progress-bar">
        <div
          className={`budget-progress-fill ${status.fillClass}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="budget-footer">
        <span className="text-body text-xs">
          <strong>{formatMonetaryValue(spent)}</strong> spent
        </span>
        <span className="text-label text-xs">
          {isOver ? (
            <span className="text-coral font-bold">Over by {formatMonetaryValue(spent - limit)}</span>
          ) : (
            <span>Remaining: {formatMonetaryValue(remaining)}</span>
          )}
        </span>
      </div>
    </Card>
  );
};
