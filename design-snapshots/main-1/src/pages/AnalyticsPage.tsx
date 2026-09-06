import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  PieChart as PieChartIcon,
  BarChart3,
  Download,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  Tag,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ErrorState, EmptyState } from '../components/ui/States';
import { AnalyticsSkeleton } from '../components/ui/Skeleton';
import { apiClient, describeApiError } from '../services/apiClient';
import { exportJsonFile } from '../services/exportService';
import { useUiStore } from '../stores/useUiStore';
import { formatMonetaryValue } from '../utils/money';
import type { FinancialSummary } from '../types/api';
import './AnalyticsPage.css';

interface CategoryBreakdownItem {
  category_id: string;
  name: string;
  icon?: string;
  color?: string;
  total_minor: number;
  percentage: number;
}

interface SpendingTrendItem {
  date_label: string;
  amount_minor: number;
}

interface OutletContextType {
  refreshTrigger?: number;
}

export const AnalyticsPage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshTrigger } = useOutletContext<OutletContextType>() || {};
  const { addToast } = useUiStore();

  // Range Selector State: week | month | 3months | year | all
  const [range, setRange] = useState<'week' | 'month' | '3months' | 'year' | 'all'>('month');

  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [categories, setCategories] = useState<CategoryBreakdownItem[]>([]);

  // Breakdown filters, applied client-side over the already-fetched period data.
  const [categoryQuery, setCategoryQuery] = useState<string>('');
  const [minSpendRupees, setMinSpendRupees] = useState<string>('');
  const [sortBy, setSortBy] = useState<'amount' | 'name'>('amount');
  const [trends, setTrends] = useState<SpendingTrendItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Compute date range filters
  const dateParams = useMemo(() => {
    if (range === 'all') return {};
    const now = new Date();
    const startDate = new Date();

    if (range === 'week') {
      startDate.setDate(now.getDate() - 7);
    } else if (range === 'month') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (range === '3months') {
      startDate.setMonth(now.getMonth() - 3);
    } else if (range === 'year') {
      startDate.setFullYear(now.getFullYear() - 1);
    }

    return {
      start_date: startDate.toISOString(),
      end_date: now.toISOString(),
    };
  }, [range]);

  const fetchAnalyticsData = useCallback(async (isMounted: boolean) => {
    try {
      const queryStr = new URLSearchParams(dateParams as Record<string, string>).toString();
      const urlSuffix = queryStr ? `?${queryStr}` : '';

      const [sumRes, catRes, trendRes] = await Promise.all([
        apiClient.get<FinancialSummary>(`/finance/summary${urlSuffix}`),
        apiClient.get<CategoryBreakdownItem[]>(`/finance/analytics/category-breakdown${urlSuffix}`),
        apiClient.get<SpendingTrendItem[]>(`/finance/analytics/spending-trends${urlSuffix}`),
      ]);

      if (isMounted) {
        setSummary(sumRes.data);
        setCategories(catRes.data);
        setTrends(trendRes.data);
        setError(null);
      }
    } catch (err: unknown) {
      if (isMounted) {
        const msg = describeApiError(err, 'Failed to load analytics data.');
        setError(msg);
      }
    } finally {
      if (isMounted) {
        setIsLoading(false);
      }
    }
  }, [dateParams]);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      void fetchAnalyticsData(isMounted);
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [fetchAnalyticsData, refreshTrigger]);

  const maxTrendAmount = useMemo(() => {
    if (trends.length === 0) return 1;
    return Math.max(...trends.map((t) => t.amount_minor), 1);
  }, [trends]);

  // Export Analytics Report
  const handleExportReport = async () => {
    setIsExporting(true);
    try {
      const queryStr = new URLSearchParams(dateParams as Record<string, string>).toString();
      const urlSuffix = queryStr ? `?${queryStr}` : '';

      const res = await apiClient.get(`/finance/reports/export${urlSuffix}`);
      const result = await exportJsonFile(
        `moneva_analytics_report_${range}_${new Date().toISOString().slice(0, 10)}.json`,
        res.data,
        'MONEVA analytics report',
      );
      addToast(result.message, 'success');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to generate report.';
      addToast(msg, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Filtered + sorted view of the category breakdown.
  const visibleCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    const parsedMin = parseFloat(minSpendRupees);
    const minMinor = Number.isFinite(parsedMin) ? Math.round(parsedMin * 100) : 0;
    const filtered = categories.filter(
      (c) => (!q || c.name.toLowerCase().includes(q)) && c.total_minor >= minMinor,
    );
    return [...filtered].sort((a, b) =>
      sortBy === 'name' ? a.name.localeCompare(b.name) : b.total_minor - a.total_minor,
    );
  }, [categories, categoryQuery, minSpendRupees, sortBy]);

  const filteredTotalMinor = useMemo(
    () => visibleCategories.reduce((sum, c) => sum + c.total_minor, 0),
    [visibleCategories],
  );

  if (isLoading) return <AnalyticsSkeleton />;
  if (error) return <ErrorState title="Analytics Error" message={error} onRetry={() => void fetchAnalyticsData(true)} />;

  const hasData = (summary?.income_minor || 0) > 0 || (summary?.expense_minor || 0) > 0 || categories.length > 0;

  return (
    <div className="analytics-page-container">
      {/* Header & Date Range Controls */}
      <div className="analytics-header">
        <div>
          <h1 className="heading-lg">Financial Analytics</h1>
          <span className="text-label">Real Ledger Insights & Reports</span>
        </div>

        {/* Date Range Selector */}
        <div className="range-selector">
          <button
            type="button"
            className={`range-tab ${range === 'week' ? 'range-active' : ''}`}
            onClick={() => setRange('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={`range-tab ${range === 'month' ? 'range-active' : ''}`}
            onClick={() => setRange('month')}
          >
            Month
          </button>
          <button
            type="button"
            className={`range-tab ${range === '3months' ? 'range-active' : ''}`}
            onClick={() => setRange('3months')}
          >
            3 Months
          </button>
          <button
            type="button"
            className={`range-tab ${range === 'year' ? 'range-active' : ''}`}
            onClick={() => setRange('year')}
          >
            Year
          </button>
          <button
            type="button"
            className={`range-tab ${range === 'all' ? 'range-active' : ''}`}
            onClick={() => setRange('all')}
          >
            All
          </button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          title="Not Enough Data Yet"
          description="Add income, expenses, or record transactions to unlock dynamic analytics, category breakdowns, and spending trends."
          actionLabel="Record Transaction"
          onAction={() => navigate('/')}
        />
      ) : (
        <>
          {/* Summary Metrics Banner */}
          <div className="analytics-metrics-grid">
            <Card variant="surface" className="metric-analytics-card">
              <span className="text-label text-xs">
                <DollarSign size={14} className="text-blue" /> Net Worth
              </span>
              <span className="number-lg text-main">
                {formatMonetaryValue(summary?.net_worth_minor || 0, summary?.currency)}
              </span>
              <span className="text-xs text-muted">Assets − Liabilities</span>
            </Card>

            <Card variant="surface" className="metric-analytics-card">
              <span className="text-label text-xs">
                <TrendingUp size={14} className="text-teal" /> Net Cash Flow
              </span>
              <span
                className={`number-lg ${(summary?.net_cash_flow_minor || 0) >= 0 ? 'text-teal' : 'text-coral'}`}
              >
                {formatMonetaryValue(summary?.net_cash_flow_minor || 0, summary?.currency)}
              </span>
              <span className="text-xs text-muted">Income − Expenses</span>
            </Card>
          </div>

          {/* Income vs Expense Ratio */}
          <Card variant="surface" className="analytics-card">
            <div className="card-header-row">
              <div className="header-title">
                <BarChart3 size={18} className="text-blue" />
                <h2 className="heading-md">Income vs Expenses</h2>
              </div>
              <span className="text-xs text-muted">Excludes transfers</span>
            </div>

            <div className="inc-exp-row">
              <div className="inc-box">
                <span className="text-label text-xs">
                  <ArrowDownLeft size={14} className="text-teal" /> Total Income
                </span>
                <span className="number-md text-teal">
                  {formatMonetaryValue(summary?.income_minor || 0, summary?.currency)}
                </span>
              </div>
              <div className="exp-box">
                <span className="text-label text-xs">
                  <ArrowUpRight size={14} className="text-coral" /> Total Expenses
                </span>
                <span className="number-md text-coral">
                  {formatMonetaryValue(summary?.expense_minor || 0, summary?.currency)}
                </span>
              </div>
            </div>

            {/* Income vs Expense Progress Comparison Bar */}
            {((summary?.income_minor || 0) > 0 || (summary?.expense_minor || 0) > 0) && (
              <div className="inc-exp-bar-container">
                <div
                  className="bar-inc-fill"
                  style={{
                    width: `${
                      ((summary?.income_minor || 0) /
                        ((summary?.income_minor || 0) + (summary?.expense_minor || 0))) *
                      100
                    }%`,
                  }}
                />
                <div
                  className="bar-exp-fill"
                  style={{
                    width: `${
                      ((summary?.expense_minor || 0) /
                        ((summary?.income_minor || 0) + (summary?.expense_minor || 0))) *
                      100
                    }%`,
                  }}
                />
              </div>
            )}
          </Card>

          {/* Spending Trends Chart */}
          <Card variant="surface" className="analytics-card">
            <div className="card-header-row">
              <div className="header-title">
                <TrendingUp size={18} className="text-teal" />
                <h2 className="heading-md">Expense Spending Trends</h2>
              </div>
              <span className="text-xs text-muted">{trends.length} Data Points</span>
            </div>

            {trends.length === 0 ? (
              <div className="empty-trend-text text-xs text-muted text-center py-3">
                No expense transactions recorded in this period.
              </div>
            ) : (
              <div className="trends-chart-grid">
                {trends.map((t, idx) => {
                  const heightPct = Math.max(8, Math.round((t.amount_minor / maxTrendAmount) * 100));
                  return (
                    <div key={idx} className="trend-bar-column">
                      <span className="bar-val-label">{formatMonetaryValue(t.amount_minor)}</span>
                      <div className="trend-bar-track">
                        <div className="trend-bar-fill" style={{ height: `${heightPct}%` }} />
                      </div>
                      <span className="trend-date-label">{t.date_label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Category Breakdown */}
          <Card variant="surface" className="analytics-card">
            <div className="card-header-row">
              <div className="header-title">
                <PieChartIcon size={18} className="text-violet" />
                <h2 className="heading-md">Category Spending Breakdown</h2>
              </div>
              <span className="text-xs text-muted">{categories.length} Categories</span>
            </div>

            {categories.length > 0 && (
              <div className="breakdown-filter-bar">
                <input
                  type="text"
                  className="form-input breakdown-filter-input"
                  placeholder="Filter categories…"
                  value={categoryQuery}
                  onChange={(e) => setCategoryQuery(e.target.value)}
                  aria-label="Filter categories by name"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  className="form-input breakdown-filter-min"
                  placeholder="Min ₹"
                  value={minSpendRupees}
                  onChange={(e) => setMinSpendRupees(e.target.value)}
                  aria-label="Minimum spend in rupees"
                />
                <button
                  type="button"
                  className="breakdown-sort-btn"
                  onClick={() => setSortBy((v) => (v === 'amount' ? 'name' : 'amount'))}
                  aria-label={`Sort by ${sortBy === 'amount' ? 'name' : 'amount'}`}
                >
                  {sortBy === 'amount' ? 'Highest' : 'A–Z'}
                </button>
              </div>
            )}

            {(categoryQuery || minSpendRupees) && (
              <span className="text-label breakdown-filter-summary">
                {visibleCategories.length} of {categories.length} categories ·{' '}
                {formatMonetaryValue(filteredTotalMinor, summary?.currency || 'INR')}
                {(categoryQuery || minSpendRupees) && (
                  <button
                    type="button"
                    className="breakdown-clear-btn"
                    onClick={() => {
                      setCategoryQuery('');
                      setMinSpendRupees('');
                    }}
                  >
                    Clear
                  </button>
                )}
              </span>
            )}

            {categories.length === 0 ? (
              <div className="text-xs text-muted text-center py-3">No category expense transactions in this period.</div>
            ) : visibleCategories.length === 0 ? (
              <div className="text-xs text-muted text-center py-3">No categories match this filter.</div>
            ) : (
              <div className="categories-breakdown-list">
                {visibleCategories.map((c) => (
                  <div key={c.category_id} className="category-breakdown-item">
                    <div className="cat-item-left">
                      <div className="cat-icon-badge" style={{ backgroundColor: `${c.color || '#7C3AED'}20`, color: c.color || '#7C3AED' }}>
                        <Tag size={16} />
                      </div>
                      <div className="cat-info">
                        <span className="cat-name">{c.name}</span>
                        <div className="cat-progress-track">
                          <div
                            className="cat-progress-fill"
                            style={{
                              width: `${c.percentage}%`,
                              backgroundColor: c.color || 'var(--moneva-violet)',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="cat-item-right">
                      <span className="cat-amount">{formatMonetaryValue(c.total_minor)}</span>
                      <span className="cat-percent-pill">{c.percentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Reports & Export */}
          <Card variant="surface" className="analytics-card">
            <div className="card-header-row">
              <div className="header-title">
                <Download size={18} className="text-teal" />
                <h2 className="heading-md">Financial Reports</h2>
              </div>
            </div>
            <p className="text-body text-xs text-muted">
              Generate and download a comprehensive financial report for the selected period ({range.toUpperCase()}).
            </p>

            <Button variant="secondary" onClick={handleExportReport} isLoading={isExporting}>
              <Download size={14} /> Download Analytics Report (JSON)
            </Button>
          </Card>
        </>
      )}
    </div>
  );
};
