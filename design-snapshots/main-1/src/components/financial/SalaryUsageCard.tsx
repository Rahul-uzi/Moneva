import React from 'react';
import { Wallet, TrendingDown, ArrowRight } from 'lucide-react';
import { Card } from '../ui/Card';
import { formatMonetaryValue } from '../../utils/money';
import type { SalaryUsage } from '../../types/api';
import './SalaryUsageCard.css';

interface Props {
  usage: SalaryUsage;
  onSetUpSalary?: () => void;
}

/**
 * This month's income against this month's spending.
 * "Left" is total income received minus every expense recorded this month.
 */
export const SalaryUsageCard: React.FC<Props> = ({ usage, onSetUpSalary }) => {
  const {
    salary_received_minor: salary,
    other_income_minor: other,
    total_income_minor: income,
    spent_minor: spent,
    remaining_minor: remaining,
    used_percent: usedPercent,
    has_salary_configured: hasSalary,
    currency,
  } = usage;

  const monthLabel = new Date(usage.period_start).toLocaleDateString(undefined, { month: 'long' });
  const overspent = remaining < 0;
  // Bar is capped for layout; the numeric percentage still shows the real value.
  const barWidth = Math.min(100, Math.max(0, usedPercent));

  if (income === 0 && !hasSalary) {
    return (
      <Card variant="surface" className="salary-usage-card" data-tour="salary">
        <div className="salary-head">
          <Wallet size={18} className="text-blue" />
          <h2 className="heading-sm">Monthly Income</h2>
        </div>
        <p className="text-body">
          Add your salary once and MONEVA tracks how much of it you have spent each month.
        </p>
        {onSetUpSalary && (
          <button type="button" className="salary-setup-link" onClick={onSetUpSalary}>
            Set up salary <ArrowRight size={14} />
          </button>
        )}
      </Card>
    );
  }

  return (
    <Card variant="surface" className="salary-usage-card" data-tour="salary">
      <div className="salary-head">
        <Wallet size={18} className="text-blue" />
        <h2 className="heading-sm">{monthLabel} Income</h2>
        <span className={overspent ? 'salary-pct is-over' : 'salary-pct'}>
          {usedPercent}% used
        </span>
      </div>

      <div className="salary-amounts">
        <div className="salary-amount">
          <span className="text-label">Received</span>
          <span className="number-md text-teal">{formatMonetaryValue(income, currency)}</span>
        </div>
        <div className="metric-divider" />
        <div className="salary-amount">
          <span className="text-label">Spent</span>
          <span className="number-md text-coral">{formatMonetaryValue(spent, currency)}</span>
        </div>
      </div>

      <div className="salary-bar-track">
        <div
          className={overspent ? 'salary-bar-fill is-over' : 'salary-bar-fill'}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="salary-remaining">
        {overspent ? <TrendingDown size={15} className="text-coral" /> : null}
        <span className="text-body">{overspent ? 'Over by' : 'Left to spend'}</span>
        <strong className={overspent ? 'number-md text-coral' : 'number-md text-main'}>
          {formatMonetaryValue(Math.abs(remaining), currency)}
        </strong>
      </div>

      {salary > 0 && other > 0 && (
        <span className="text-label salary-breakdown">
          Salary {formatMonetaryValue(salary, currency)} · Other {formatMonetaryValue(other, currency)}
        </span>
      )}
    </Card>
  );
};
