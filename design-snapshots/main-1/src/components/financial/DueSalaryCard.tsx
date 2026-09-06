import React, { useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { AmountInput } from '../ui/AmountInput';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import { parseApiDate } from '../../utils/datetime';
import type { Account, DueIncome } from '../../types/api';
import './DueSalaryCard.css';

interface DueSalaryCardProps {
  due: DueIncome[];
  accounts: Account[];
  /** Called after a stream is confirmed or skipped, so the caller can refresh. */
  onResolved: () => void;
}

/**
 * Asks about salary that was due but never recorded.
 *
 * A saved stream never posted anything by itself and nothing compared its date
 * to today, so it sat there for months doing nothing. It now surfaces here on
 * the due date - but only as a question. The money is recorded when the user
 * says it arrived, because a salary can be late, short, or never turn up, and
 * a balance that claims money you have not received is worse than no prompt.
 */
export const DueSalaryCard: React.FC<DueSalaryCardProps> = ({ due, accounts, onResolved }) => {
  const { addToast } = useUiStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [accountId, setAccountId] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  if (due.length === 0) return null;

  // Salary lands in something you own, never on a credit card.
  const payTo = accounts.filter((a) => a.account_type === 'asset');
  const targets = payTo.length > 0 ? payTo : accounts;

  const startConfirm = (item: DueIncome) => {
    setOpenId(item.id);
    setAmountPaise(item.expected_amount_minor);
    setAccountId((cur) => cur || (targets[0]?.id ?? ''));
  };

  const confirm = async (item: DueIncome) => {
    if (!accountId) {
      addToast('Add an account first so the salary has somewhere to land.', 'error');
      return;
    }
    setBusyId(item.id);
    try {
      await apiClient.post(`/income/recurring/${item.id}/confirm`, {
        account_id: accountId,
        amount_minor: amountPaise > 0 ? amountPaise : item.expected_amount_minor,
        device_id: 'web-client',
      });
      addToast(`${item.source} recorded. Balance updated.`, 'success');
      setOpenId(null);
      onResolved();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not record that salary.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const skip = async (item: DueIncome) => {
    setBusyId(item.id);
    try {
      // A stream months behind used to need one tap per month, and the card
      // barely changed between them - it read as a dead button. Saying the
      // money never came clears the whole backlog at once.
      await apiClient.post(`/income/recurring/${item.id}/skip`, { all_missed: true });
      addToast(
        item.missed_count > 1
          ? `Skipped ${item.missed_count} missed months of ${item.source}. Nothing was added to your balance.`
          : `Skipped ${item.source}. Nothing was added to your balance.`,
        'info',
      );
      setOpenId(null);
      onResolved();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      addToast(detail || 'Could not skip that one.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="home-section due-salary-section">
      {due.map((item) => {
        const dueDate = parseApiDate(item.due_on);
        const isOpen = openId === item.id;
        const isBusy = busyId === item.id;
        return (
          <div key={item.id} className="due-salary-card">
            <div className="due-salary-head">
              <span className="due-salary-icon">
                <CalendarClock size={18} />
              </span>
              <div className="due-salary-copy">
                <span className="heading-xs">{item.source} was due</span>
                <span className="text-body text-xs text-muted">
                  {dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
                  {' · expecting '}
                  {formatMonetaryValue(item.expected_amount_minor)}
                  {/* Only worth saying when more than this one slipped by. */}
                  {item.missed_count > 1 ? ` · ${item.missed_count} months behind` : ''}
                </span>
              </div>
            </div>

            {isOpen ? (
              <div className="due-salary-form">
                <AmountInput
                  valuePaise={amountPaise}
                  onChangePaise={setAmountPaise}
                  label="Amount actually received"
                />
                <div className="select-group">
                  <label className="form-label">Received into</label>
                  <select
                    className="form-select"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                  >
                    {targets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="due-salary-actions">
                  <Button variant="secondary" onClick={() => setOpenId(null)} disabled={isBusy}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => void confirm(item)} isLoading={isBusy}>
                    <Check size={15} /> Record it
                  </Button>
                </div>
              </div>
            ) : (
              <div className="due-salary-actions">
                <button
                  type="button"
                  className="due-salary-skip"
                  onClick={() => void skip(item)}
                  disabled={isBusy}
                >
                  <X size={14} />{' '}
                  {item.missed_count > 1 ? `Didn't arrive (${item.missed_count})` : "Didn't arrive"}
                </button>
                <Button variant="primary" onClick={() => startConfirm(item)} disabled={isBusy}>
                  Yes, I got it
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
