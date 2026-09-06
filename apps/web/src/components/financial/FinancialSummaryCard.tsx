import React from 'react';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { Card } from '../ui/Card';
import { Money } from '../ui/Money';
import './FinancialSummaryCard.css';
import { useCountUp } from '../../hooks/useCountUp';

interface FinancialSummaryCardProps {
  netWorthMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  currency?: string;
  isLoading?: boolean;
}

export const FinancialSummaryCard: React.FC<FinancialSummaryCardProps> = ({
  netWorthMinor,
  incomeMinor,
  expenseMinor,
  currency = 'INR',
  isLoading = false,
}) => {
  // The headline figure counts up on first paint. Presentation only: it always
  // settles on the exact value, and does nothing under prefers-reduced-motion.
  const displayedNetWorth = useCountUp(netWorthMinor);

  if (isLoading) {
    return (
      <Card variant="gradient" className="summary-card-skeleton">
        <div className="skeleton-line lg" />
        <div className="skeleton-line sm" />
      </Card>
    );
  }

  return (
    <Card variant="gradient" className="financial-summary-card" data-tour="net-worth">
      <div className="summary-header">
        <span className="summary-label">TOTAL NET WORTH</span>
        <div className="summary-icon"><Wallet size={18} /></div>
      </div>
      <div className="summary-net-worth">
        <span className="number-xl"><Money amount={displayedNetWorth} currency={currency} /></span>
      </div>
      <div className="summary-divider" />
      <div className="summary-grid">
        <div className="summary-metric">
          <span className="metric-label"><TrendingUp size={14} className="icon-teal" /> Income</span>
          <span className="number-md text-teal"><Money amount={incomeMinor} currency={currency} /></span>
        </div>
        <div className="summary-metric">
          <span className="metric-label"><TrendingDown size={14} className="icon-coral" /> Expenses</span>
          <span className="number-md text-coral"><Money amount={expenseMinor} currency={currency} /></span>
        </div>
      </div>
    </Card>
  );
};
