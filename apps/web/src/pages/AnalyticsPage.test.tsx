// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AnalyticsPage } from './AnalyticsPage';
import { useUiStore } from '../stores/useUiStore';
import type { FinancialSummary } from '../types/api';

/**
 * Analytics: the period's totals, where the money went, and how spending
 * moved - for whichever range is picked.
 */

const get = vi.fn();
vi.mock('../services/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/apiClient')>()),
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
const exportJsonFile = vi.fn();
vi.mock('../services/exportService', () => ({
  exportJsonFile: (...a: unknown[]) => exportJsonFile(...a),
}));

interface BreakdownItem { category_id: string; name: string; color?: string; total_minor: number; percentage: number }
interface TrendItem { date_label: string; amount_minor: number }

const SUMMARY: FinancialSummary = {
  net_worth_minor: 25000000, income_minor: 6000000, expense_minor: 2250000, net_cash_flow_minor: 3750000, currency: 'INR',
};
const BREAKDOWN: BreakdownItem[] = [
  { category_id: 'cat-dine', name: 'Dining Out', total_minor: 450000, percentage: 20 },
  { category_id: 'cat-groc', name: 'Groceries', total_minor: 1200000, percentage: 53 },
  { category_id: 'cat-util', name: 'Utilities', total_minor: 600000, percentage: 27 },
];
const TRENDS: TrendItem[] = [
  { date_label: 'Week 1', amount_minor: 500000 },
  { date_label: 'Week 2', amount_minor: 1000000 },
  { date_label: 'Week 3', amount_minor: 750000 },
];
const EMPTY_SUMMARY: FinancialSummary = {
  net_worth_minor: 0, income_minor: 0, expense_minor: 0, net_cash_flow_minor: 0, currency: 'INR',
};

let data: { summary: FinancialSummary; breakdown: BreakdownItem[]; trends: TrendItem[] };
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
});
beforeEach(() => {
  data = { summary: SUMMARY, breakdown: BREAKDOWN, trends: TRENDS };
  get.mockImplementation((url: string) => {
    if (url.startsWith('/finance/summary')) return Promise.resolve({ data: data.summary });
    if (url.startsWith('/finance/analytics/category-breakdown')) return Promise.resolve({ data: data.breakdown });
    if (url.startsWith('/finance/analytics/spending-trends')) return Promise.resolve({ data: data.trends });
    if (url.startsWith('/finance/reports/export')) return Promise.resolve({ data: { rows: [] } });
    return Promise.resolve({ data: [] });
  });
  exportJsonFile.mockResolvedValue({ message: 'Report saved to Downloads' });
  useUiStore.setState({ toasts: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const show = async () => {
  render(
    <MemoryRouter initialEntries={['/analytics']}>
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/" element={<div>Home screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
};

/** The figure printed beside a label such as "Net Worth". */
const figure = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const categoryNames = () => Array.from(document.querySelectorAll('.cat-name')).map((el) => el.textContent);
/** The query string of the most recent summary request. */
const lastSummaryQuery = () => {
  const urls = get.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/finance/summary'));
  const url = urls[urls.length - 1];
  return new URLSearchParams(url.includes('?') ? url.slice(url.indexOf('?') + 1) : '');
};

describe('the period totals', () => {
  it('shows net worth, cash flow, income and expenses from the ledger', async () => {
    await show();
    expect(figure('Net Worth')).toBe('₹2,50,000.00');
    expect(figure('Net Cash Flow')).toBe('₹37,500.00');
    expect(figure('Total Income')).toBe('₹60,000.00');
    expect(figure('Total Expenses')).toBe('₹22,500.00');
  });

  it('draws one trend bar per point, labelled with its amount', async () => {
    await show();
    expect(screen.getByText('3 Data Points')).toBeTruthy();
    expect(screen.getByText('Week 2')).toBeTruthy();
    expect(screen.getByText('₹10,000.00')).toBeTruthy();
  });

  it('says so when the period has no spending to chart', async () => {
    data.trends = [];
    await show();
    expect(screen.getByText('No expense transactions recorded in this period.')).toBeTruthy();
  });
});

describe('the category breakdown', () => {
  it('lists the biggest spend first, and alphabetically on request', async () => {
    await show();
    expect(categoryNames()).toEqual(['Groceries', 'Utilities', 'Dining Out']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by name' }));
    expect(categoryNames()).toEqual(['Dining Out', 'Groceries', 'Utilities']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by amount' }));
    expect(categoryNames()).toEqual(['Groceries', 'Utilities', 'Dining Out']);
  });

  it('narrows by name and by a minimum spend, with a running total', async () => {
    await show();
    fireEvent.change(screen.getByLabelText('Filter categories by name'), { target: { value: 'din' } });
    expect(categoryNames()).toEqual(['Dining Out']);
    expect(screen.getByText(/1 of 3 categories ·/).textContent).toContain('₹4,500.00');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(categoryNames()).toHaveLength(3);

    // Utilities is exactly 6,000: the minimum is inclusive.
    fireEvent.change(screen.getByLabelText('Minimum spend in rupees'), { target: { value: '6000' } });
    expect(categoryNames()).toEqual(['Groceries', 'Utilities']);
    expect(screen.getByText(/2 of 3 categories ·/).textContent).toContain('₹18,000.00');

    fireEvent.change(screen.getByLabelText('Minimum spend in rupees'), { target: { value: '50000' } });
    expect(screen.getByText('No categories match this filter.')).toBeTruthy();
  });
});

describe('the range', () => {
  it('asks for the last month by default and refetches when the range changes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12, 30));
    await show();
    let q = lastSummaryQuery();
    // Whole days in local time, ending at the very end of today.
    expect(q.get('start_date')).toBe(new Date(2026, 8, 15, 0, 0, 0, 0).toISOString());
    expect(q.get('end_date')).toBe(new Date(2026, 9, 15, 23, 59, 59, 999).toISOString());

    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    await settle();
    q = lastSummaryQuery();
    expect(q.get('start_date')).toBe(new Date(2026, 9, 8, 0, 0, 0, 0).toISOString());

    fireEvent.click(screen.getByRole('button', { name: 'Year' }));
    await settle();
    expect(lastSummaryQuery().get('start_date')).toBe(new Date(2025, 9, 15, 0, 0, 0, 0).toISOString());
  });

  it('shows the new range\'s figures, with no dates at all for All', async () => {
    await show();
    data.summary = { ...SUMMARY, income_minor: 90000000, net_worth_minor: 30000000 };
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await settle();
    expect(get).toHaveBeenLastCalledWith('/finance/analytics/spending-trends');
    expect(lastSummaryQuery().toString()).toBe('');
    expect(figure('Total Income')).toBe('₹9,00,000.00');
    expect(screen.getByText(/selected period \(ALL\)/)).toBeTruthy();
  });
});

describe('empty, failed and exported', () => {
  it('invites a first transaction when there is nothing to analyse', async () => {
    data = { summary: EMPTY_SUMMARY, breakdown: [], trends: [] };
    await show();
    expect(screen.getByText('Not Enough Data Yet')).toBeTruthy();
    expect(screen.queryByText('Net Worth')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Record Transaction' }));
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('shows an error with a retry, not a crash, when the figures cannot load', async () => {
    get.mockImplementation(() => Promise.reject(new Error('offline')));
    await show();
    expect(screen.getByText('Analytics Error')).toBeTruthy();
    expect(screen.getByText('Failed to load analytics data.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });

  it('downloads the report for the chosen range and says where it went', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /Download Analytics Report/ }));
    await waitFor(() => expect(exportJsonFile).toHaveBeenCalledTimes(1));
    const exportUrl = get.mock.calls.map((c) => c[0] as string).find((u) => u.startsWith('/finance/reports/export'));
    expect(exportUrl).toMatch(/start_date=/);
    const [filename, payload] = exportJsonFile.mock.calls[0] as [string, unknown];
    expect(filename).toMatch(/^moneva_analytics_report_month_\d{4}-\d{2}-\d{2}\.json$/);
    expect(payload).toEqual({ rows: [] });
    await waitFor(() => expect(useUiStore.getState().toasts.map((t) => t.message)).toContain('Report saved to Downloads'));
  });
});
