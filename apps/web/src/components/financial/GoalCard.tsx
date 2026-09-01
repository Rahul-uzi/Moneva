import React from 'react';
import { Target, PlusCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '../ui/Card';
import type { SavingsGoal } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './GoalCard.css';

interface GoalCardProps {
  goal: SavingsGoal;
  onClick?: () => void;
  onContribute?: (goal: SavingsGoal) => void;
}

export const GoalCard: React.FC<GoalCardProps> = ({ goal, onClick, onContribute }) => {
  const current = goal.current_saved_minor || 0;
  const target = goal.target_amount_minor;
  const remaining = Math.max(0, target - current);
  const rawRatio = target > 0 ? (current / target) * 100 : 0;
  const progress = goal.progress_percentage ?? Math.min(100, Math.round(rawRatio));
  const isCompleted = current >= target;

  // 4-Tier Semantic Status
  let statusBadge = {
    label: 'Not Started',
    badgeClass: 'badge-not-started',
  };

  if (isCompleted) {
    statusBadge = {
      label: 'Completed',
      badgeClass: 'badge-completed',
    };
  } else if (rawRatio >= 85) {
    statusBadge = {
      label: 'Near Target',
      badgeClass: 'badge-near-target',
    };
  } else if (rawRatio > 0) {
    statusBadge = {
      label: 'In Progress',
      badgeClass: 'badge-in-progress',
    };
  }

  const targetDateStr = goal.target_date
    ? new Date(goal.target_date).toLocaleDateString('en-IN', {
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <Card variant="surface" interactive onClick={onClick} className="goal-card">
      <div className="goal-header">
        <div className="goal-title-group">
          <div className="goal-icon">
            <Target size={18} />
          </div>
          <span className="goal-name">{goal.name}</span>
        </div>
        <div className={`goal-status-badge ${statusBadge.badgeClass}`}>
          {isCompleted && <CheckCircle2 size={10} />}
          <span>{statusBadge.label}</span>
        </div>
      </div>

      <div className="goal-amounts">
        <div className="amount-col">
          <span className="text-label text-xs">Saved</span>
          <span className="number-md text-teal font-bold">{formatMonetaryValue(current)}</span>
        </div>
        <div className="amount-col text-right">
          <span className="text-label text-xs">Target</span>
          <span className="number-md text-main">{formatMonetaryValue(target)}</span>
        </div>
      </div>

      <div className="goal-progress-section">
        <div className="progress-top-row">
          <span className="text-xs text-muted">
            {isCompleted ? 'Goal Reached!' : `Remaining: ${formatMonetaryValue(remaining)}`}
          </span>
          <span className="text-xs font-bold text-teal">{progress}%</span>
        </div>
        <div className="goal-progress-bar">
          <div className="goal-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="goal-card-footer">
        <span className="text-xs text-muted">
          {targetDateStr ? `Target: ${targetDateStr}` : 'No target date'}
        </span>
        {onContribute && (
          <button
            type="button"
            className="contribute-chip-btn"
            onClick={(e) => {
              e.stopPropagation();
              onContribute(goal);
            }}
          >
            <PlusCircle size={12} /> Contribute
          </button>
        )}
      </div>
    </Card>
  );
};
