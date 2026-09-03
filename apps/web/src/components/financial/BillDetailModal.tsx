import React from 'react';
import { Calendar, CreditCard, Bell, Repeat, CheckCircle2, AlertCircle, Edit3, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatMonetaryValue } from '../../utils/money';
import type { Bill, Category } from '../../types/api';
import './BillDetailModal.css';

import { parseApiDate } from '../../utils/datetime';
interface BillDetailModalProps {
  bill: Bill | null;
  category?: Category;
  onClose: () => void;
  onPay: (bill: Bill) => void;
  onEdit: (bill: Bill) => void;
  onDelete: (bill: Bill) => void;
}

export const BillDetailModal: React.FC<BillDetailModalProps> = ({
  bill,
  category,
  onClose,
  onPay,
  onEdit,
  onDelete,
}) => {
  if (!bill) return null;

  const isPaid = bill.status === 'paid';
  const dueDate = parseApiDate(bill.due_date);
  const now = new Date();
  
  // Strip time for exact date comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let statusBadge = {
    label: 'Upcoming',
    badgeClass: 'status-upcoming-badge',
    icon: <Calendar size={12} />,
  };

  if (isPaid) {
    statusBadge = {
      label: 'Paid',
      badgeClass: 'status-paid-badge',
      icon: <CheckCircle2 size={12} />,
    };
  } else if (diffDays < 0) {
    statusBadge = {
      label: 'Overdue',
      badgeClass: 'status-overdue-badge',
      icon: <AlertCircle size={12} />,
    };
  } else if (diffDays === 0) {
    statusBadge = {
      label: 'Due Today',
      badgeClass: 'status-due-today-badge',
      icon: <AlertCircle size={12} />,
    };
  } else if (diffDays <= 3) {
    statusBadge = {
      label: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}`,
      badgeClass: 'status-due-soon-badge',
      icon: <AlertCircle size={12} />,
    };
  }

  const dueDateFormatted = dueDate.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Modal isOpen={!!bill} onClose={onClose} title={`Bill: ${bill.name}`}>
      <div className="bill-detail-body">
        {/* Main Card */}
        <div className="bill-detail-card">
          <div className="bill-detail-header-row">
            <div className="bill-detail-title">
              <CreditCard size={20} className="text-coral" />
              <span className="heading-xs text-main">{bill.name}</span>
            </div>
            <div className={`bill-status-pill ${statusBadge.badgeClass}`}>
              {statusBadge.icon}
              <span>{statusBadge.label}</span>
            </div>
          </div>

          <div className="bill-amount-display">
            <span className="text-label text-xs">Amount Due</span>
            <span className="number-xl text-coral">{formatMonetaryValue(bill.amount_minor, bill.currency)}</span>
          </div>

          <div className="bill-meta-grid">
            <div className="meta-box">
              <span className="meta-label">
                <Calendar size={12} /> Due Date
              </span>
              <span className="meta-val font-semibold">{dueDateFormatted}</span>
            </div>

            <div className="meta-box">
              <span className="meta-label">
                <Repeat size={12} /> Recurrence
              </span>
              <span className="meta-val capitalize">{bill.recurrence || 'One-time'}</span>
            </div>

            <div className="meta-box">
              <span className="meta-label">Category</span>
              <span className="meta-val">{category?.name || 'General Expense'}</span>
            </div>

            <div className="meta-box">
              <span className="meta-label">
                <Bell size={12} /> Reminder
              </span>
              <span className="meta-val">{bill.reminder_enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="bill-detail-actions">
          <div className="left-actions">
            <button
              type="button"
              className="card-action-btn"
              onClick={() => {
                onClose();
                onEdit(bill);
              }}
            >
              <Edit3 size={14} /> Edit
            </button>
            <button
              type="button"
              className="card-action-btn btn-danger"
              onClick={() => {
                onClose();
                onDelete(bill);
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>

          {!isPaid && (
            <Button
              variant="accent"
              onClick={() => {
                onClose();
                onPay(bill);
              }}
            >
              Pay Bill Now
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
