import React from 'react';
import { Calendar, CheckCircle2, AlertCircle, Repeat } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Bill } from '../../types/api';
import { formatMonetaryValue } from '../../utils/money';
import './BillCard.css';

import { parseApiDate } from '../../utils/datetime';
interface BillCardProps {
  bill: Bill;
  onPay?: () => void;
  onClick?: () => void;
}

export const BillCard: React.FC<BillCardProps> = ({ bill, onPay, onClick }) => {
  const isPaid = bill.status === 'paid';
  const dueDate = parseApiDate(bill.due_date);
  const now = new Date();

  // Strip time for exact day comparison
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  let statusBadge = {
    label: 'Upcoming',
    badgeClass: 'status-upcoming',
  };

  if (isPaid) {
    statusBadge = {
      label: 'Paid',
      badgeClass: 'status-paid',
    };
  } else if (diffDays < 0) {
    statusBadge = {
      label: 'Overdue',
      badgeClass: 'status-overdue',
    };
  } else if (diffDays === 0) {
    statusBadge = {
      label: 'Due Today',
      badgeClass: 'status-due-today',
    };
  } else if (diffDays <= 3) {
    statusBadge = {
      label: `Due in ${diffDays}d`,
      badgeClass: 'status-due-soon',
    };
  }

  const dueDateStr = dueDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <Card variant="surface" interactive onClick={onClick} className="bill-card">
      <div className="bill-header">
        <div className="bill-icon">
          <Calendar size={18} />
        </div>
        <div className="bill-title-box">
          <span className="bill-name">{bill.name}</span>
          <div className="bill-due-row">
            <span className="bill-due">Due {dueDateStr}</span>
            {bill.recurrence && (
              <span className="recurrence-pill">
                <Repeat size={10} /> {bill.recurrence}
              </span>
            )}
          </div>
        </div>
        <span className={`bill-status-badge ${statusBadge.badgeClass}`}>
          {!isPaid && diffDays <= 0 && <AlertCircle size={10} />}
          <span>{statusBadge.label}</span>
        </span>
      </div>

      <div className="bill-footer">
        <span className="number-md text-coral font-bold">{formatMonetaryValue(bill.amount_minor, bill.currency)}</span>
        {!isPaid && onPay && (
          <Button
            variant="accent"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onPay();
            }}
          >
            Pay Now
          </Button>
        )}
        {isPaid && (
          <span className="text-paid">
            <CheckCircle2 size={16} /> Paid
          </span>
        )}
      </div>
    </Card>
  );
};
