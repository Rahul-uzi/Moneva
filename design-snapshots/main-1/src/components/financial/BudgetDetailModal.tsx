import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Edit3, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TransactionRow } from './TransactionRow';
import { apiClient } from '../../services/apiClient';
import { formatMonetaryValue } from '../../utils/money';
import type { Budget, Category, Transaction } from '../../types/api';
import './BudgetDetailModal.css';

interface BudgetDetailModalProps {
  budget: Budget | null;
  category?: Category | null;
  onClose: () => void;
  onEdit: (budget: Budget) => void;
  onDelete: (budget: Budget) => void;
}

export const BudgetDetailModal: React.FC<BudgetDetailModalProps> = ({
  budget,
  category,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (budget && isMounted) {
        setIsLoadingTx(true);
        apiClient
          .get<Transaction[]>('/transactions')
          .then((res) => {
            if (isMounted) {
              const categoryTxs = res.data.filter(
                (t) => t.category_id === budget.category_id && t.transaction_type === 'expense'
              );
              setTransactions(categoryTxs);
            }
          })
          .catch(() => {
            if (isMounted) setTransactions([]);
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
  }, [budget]);

  if (!budget) return null;

  const spent = budget.spent_amount_minor || 0;
  const limit = budget.limit_amount_minor;
  const remaining = budget.remaining_amount_minor ?? Math.max(0, limit - spent);
  const rawRatio = limit > 0 ? (spent / limit) * 100 : 0;
  const percent = Math.min(100, Math.round(rawRatio));
  const isOver = spent > limit;

  // Semantic Status Color Logic
  let statusBadge = {
    label: 'Healthy',
    colorClass: 'status-healthy',
    icon: CheckCircle2,
  };

  if (isOver) {
    statusBadge = {
      label: 'Over Budget',
      colorClass: 'status-over',
      icon: AlertTriangle,
    };
  } else if (rawRatio >= 85) {
    statusBadge = {
      label: 'Near Limit Warning',
      colorClass: 'status-warning',
      icon: AlertTriangle,
    };
  } else if (rawRatio >= 70) {
    statusBadge = {
      label: 'Normal Spending',
      colorClass: 'status-normal',
      icon: Info,
    };
  }

  const StatusIcon = statusBadge.icon;

  return (
    <Modal isOpen={!!budget} onClose={onClose} title={`Budget: ${category?.name || 'Category'}`}>
      <div className="budget-detail-body">
        {/* Header Metric Card */}
        <div className="budget-detail-card">
          <div className="status-badge-row">
            <div className={`status-badge ${statusBadge.colorClass}`}>
              <StatusIcon size={14} />
              <span>{statusBadge.label}</span>
            </div>
            <span className="text-muted text-xs capitalize">{budget.period || 'Monthly'} Period</span>
          </div>

          <div className="metric-primary-row">
            <div className="metric-box">
              <span className="text-label">Spent</span>
              <span className={`number-lg ${isOver ? 'text-coral' : 'text-main'}`}>
                {formatMonetaryValue(spent)}
              </span>
            </div>
            <div className="metric-box">
              <span className="text-label">Budget Limit</span>
              <span className="number-lg text-blue">{formatMonetaryValue(limit)}</span>
            </div>
            <div className="metric-box">
              <span className="text-label">{isOver ? 'Over By' : 'Remaining'}</span>
              <span className={`number-lg ${isOver ? 'text-coral' : 'text-teal'}`}>
                {formatMonetaryValue(isOver ? spent - limit : remaining)}
              </span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="detail-progress-container">
            <div className="progress-labels">
              <span className="text-xs text-muted">Spending Progress</span>
              <span className={`text-xs font-bold ${statusBadge.colorClass}`}>{percent}%</span>
            </div>
            <div className="detail-progress-bar">
              <div
                className={`detail-progress-fill ${statusBadge.colorClass}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Transactions List Section */}
        <div className="budget-transactions-section">
          <h4 className="heading-xs text-main">Expenses in this Budget ({transactions.length})</h4>

          {isLoadingTx ? (
            <div className="text-body text-center text-xs text-muted py-2">Loading transactions...</div>
          ) : transactions.length === 0 ? (
            <div className="empty-tx-box">
              <span className="text-body text-xs text-muted">
                ₹0.00 spent. No transactions recorded under this budget category yet.
              </span>
            </div>
          ) : (
            <div className="tx-list">
              {transactions.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="budget-detail-actions">
          <Button
            variant="secondary"
            onClick={() => {
              onClose();
              onDelete(budget);
            }}
          >
            <Trash2 size={14} /> Delete Rule
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onEdit(budget);
            }}
          >
            <Edit3 size={14} /> Edit Limit & Period
          </Button>
        </div>
      </div>
    </Modal>
  );
};
