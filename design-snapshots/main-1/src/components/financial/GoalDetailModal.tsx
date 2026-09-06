import React, { useEffect, useState } from 'react';
import { Target, Calendar, PlusCircle, Edit3, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TransactionRow } from './TransactionRow';
import { apiClient } from '../../services/apiClient';
import { formatMonetaryValue } from '../../utils/money';
import type { SavingsGoal, Transaction } from '../../types/api';
import './GoalDetailModal.css';

interface GoalDetailModalProps {
  goal: SavingsGoal | null;
  onClose: () => void;
  onContribute: (goal: SavingsGoal) => void;
  onEdit: (goal: SavingsGoal) => void;
  onDelete: (goal: SavingsGoal) => void;
}

export const GoalDetailModal: React.FC<GoalDetailModalProps> = ({
  goal,
  onClose,
  onContribute,
  onEdit,
  onDelete,
}) => {
  const [contributions, setContributions] = useState<Transaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (goal && isMounted) {
        setIsLoadingTx(true);
        apiClient
          .get<Transaction[]>('/transactions')
          .then((res) => {
            if (isMounted) {
              const goalTxs = res.data.filter((t) => t.savings_goal_id === goal.id);
              setContributions(goalTxs);
            }
          })
          .catch(() => {
            if (isMounted) setContributions([]);
          })
          .finally(() => {
            if (isMounted) setIsLoadingTx(false);
          });
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [goal]);

  if (!goal) return null;

  const current = goal.current_saved_minor || 0;
  const target = goal.target_amount_minor;
  const remaining = Math.max(0, target - current);
  const rawRatio = target > 0 ? (current / target) * 100 : 0;
  const percent = goal.progress_percentage ?? Math.min(100, Math.round(rawRatio));
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
        day: 'numeric',
        year: 'numeric',
      })
    : 'No Date';

  return (
    <Modal isOpen={!!goal} onClose={onClose} title={`Savings Goal: ${goal.name}`}>
      <div className="goal-detail-body">
        {/* Header Metric Card */}
        <div className="goal-detail-card">
          <div className="goal-detail-header-row">
            <div className="goal-detail-title">
              <Target size={20} className="text-violet" />
              <span className="heading-xs text-main">{goal.name}</span>
            </div>
            <div className={`goal-status-badge ${statusBadge.badgeClass}`}>
              <span>{statusBadge.label}</span>
            </div>
          </div>

          <div className="goal-metrics-grid">
            <div className="metric-box">
              <span className="text-label">Saved</span>
              <span className="number-lg text-teal">{formatMonetaryValue(current)}</span>
            </div>
            <div className="metric-box">
              <span className="text-label">Target</span>
              <span className="number-lg text-main">{formatMonetaryValue(target)}</span>
            </div>
            <div className="metric-box">
              <span className="text-label">Remaining</span>
              <span className="number-lg text-blue">{formatMonetaryValue(remaining)}</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="detail-progress-section">
            <div className="progress-label-row">
              <span className="text-xs text-muted">
                <Calendar size={12} /> Target Date: {targetDateStr}
              </span>
              <span className="text-xs font-bold text-teal">{percent}% Complete</span>
            </div>
            <div className="detail-progress-bar">
              <div className="detail-progress-fill" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>

        {/* Contribution History Section */}
        <div className="contributions-history-section">
          <h4 className="heading-xs text-main">Contribution History ({contributions.length})</h4>

          {isLoadingTx ? (
            <div className="text-body text-center text-xs text-muted py-2">Loading contributions...</div>
          ) : contributions.length === 0 ? (
            <div className="empty-contributions-box">
              <span className="text-body text-xs text-muted">
                ₹0.00 saved. No financial contributions recorded towards this goal yet.
              </span>
            </div>
          ) : (
            <div className="contributions-list">
              {contributions.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} />
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="goal-detail-actions">
          <div className="left-actions">
            <button
              type="button"
              className="card-action-btn"
              onClick={() => {
                onClose();
                onEdit(goal);
              }}
            >
              <Edit3 size={14} /> Edit Target
            </button>
            <button
              type="button"
              className="card-action-btn btn-danger"
              onClick={() => {
                onClose();
                onDelete(goal);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>

          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onContribute(goal);
            }}
          >
            <PlusCircle size={16} /> Contribute Money
          </Button>
        </div>
      </div>
    </Modal>
  );
};
