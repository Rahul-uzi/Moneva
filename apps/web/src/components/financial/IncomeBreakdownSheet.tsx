import React, { useEffect, useState } from 'react';
import { ProfileSheet } from '../profile/ProfileSheet';
import { TransactionRow } from './TransactionRow';
import { apiClient } from '../../services/apiClient';
import { formatMonetaryValue } from '../../utils/money';
import { parseApiDate } from '../../utils/datetime';
import { isSalaryIncome } from '../../utils/incomeSplit';
import type { SalaryUsage, Transaction } from '../../types/api';
import './IncomeBreakdownSheet.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usage: SalaryUsage;
  /** The salary sources the user set up - what decides salary vs extra. */
  salarySources: string[];
  /** A row was tapped: the sheet closes and the payment opens. */
  onSelect: (transaction: Transaction) => void;
}

/**
 * The month's income, behind the Salary / Extra income line on the card.
 *
 * The card only gives two totals; this says which payments make them up, so
 * a figure like "Extra income ₹1,200" can be checked rather than taken on
 * trust. Fetched when it opens - the dashboard itself only loads five rows.
 */
export const IncomeBreakdownSheet: React.FC<Props> = ({ isOpen, onClose, usage, salarySources, onSelect }) => {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { period_start: start, period_end: end, currency } = usage;

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setFailed(false);
    apiClient
      .get<Transaction[]>('/transactions', { params: { transaction_type: 'income', start_date: start, end_date: end } })
      .then((res) => {
        if (!alive) return;
        // The month runs up to, not including, the 1st of the next.
        const cutoff = parseApiDate(end).getTime();
        setRows(
          res.data
            .filter((t) => parseApiDate(t.transaction_date).getTime() < cutoff)
            .sort((a, b) => parseApiDate(b.transaction_date).getTime() - parseApiDate(a.transaction_date).getTime()),
        );
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [isOpen, start, end]);

  const month = parseApiDate(start).toLocaleDateString(undefined, { month: 'long' });
  const salary = rows?.filter((t) => isSalaryIncome(t.description, salarySources)) ?? [];
  const extra = rows?.filter((t) => !isSalaryIncome(t.description, salarySources)) ?? [];
  const sum = (list: Transaction[]) => list.reduce((n, t) => n + t.amount_minor, 0);

  const section = (title: string, list: Transaction[], hint: string) => (
    <section className="ib-section" aria-label={title}>
      <div className="ib-section-head">
        <h3 className="text-label">{title}</h3>
        <span className="ib-section-total">{formatMonetaryValue(sum(list), currency)}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-body text-muted ib-empty">{hint}</p>
      ) : (
        <div className="ib-rows">
          {list.map((t) => (
            <TransactionRow key={t.id} transaction={t} onClick={() => onSelect(t)} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <ProfileSheet isOpen={isOpen} title={`${month} income`} onClose={onClose}>
      {failed ? (
        <p className="text-body text-muted">Could not load this month&apos;s income. Check your connection and try again.</p>
      ) : rows === null ? (
        <p className="text-body text-muted">Loading…</p>
      ) : (
        <>
          {section('Salary', salary, 'No salary recorded this month yet.')}
          {section('Extra income', extra, 'Nothing besides salary this month.')}
          <div className="ib-total">
            <span className="text-body">Received</span>
            <strong className="number-md text-teal">{formatMonetaryValue(sum(rows), currency)}</strong>
          </div>
        </>
      )}
    </ProfileSheet>
  );
};
