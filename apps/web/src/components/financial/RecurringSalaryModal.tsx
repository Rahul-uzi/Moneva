import React, { useCallback, useEffect, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, Check, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NumberPad, PadAmount } from '../ui/NumberPad';
import { MoneyFlow } from './MoneyFlow';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import {
  FREQUENCIES,
  describeNext,
  everyLabel,
  localDateValue,
  paydayFromDateValue,
} from '../../utils/moneySheets';
import { padToPaise } from '../../utils/numberPad';
import type { RecurringIncome } from '../../types/api';
import './QuickAddModal.css';
import './MoneySheets.css';

interface RecurringSalaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectForConfirmation: (rule: RecurringIncome) => void;
}

const dayMonth = (value: string): string => {
  const p = paydayFromDateValue(value);
  return p ? p.at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'Pick a date';
};

/**
 * Expected salaries - money the app is waiting for, not money anyone has.
 *
 * THE DESIGN. The list is one card per salary - its initial in a circle, how
 * far away it is, and Received. Adding one turns the whole sheet into the
 * same flow-and-number-pad layout as the other money sheets, instead of a form
 * squeezed in under the list. Removing a schedule asks first: it was a single
 * tap on a bare bin icon, beside the button people actually meant to press.
 */
export const RecurringSalaryModal: React.FC<RecurringSalaryModalProps> = ({
  isOpen,
  onClose,
  onSelectForConfirmation,
}) => {
  const [rules, setRules] = useState<RecurringIncome[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAdding, setIsAdding] = useState<boolean>(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [source, setSource] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [frequency, setFrequency] = useState<string>('monthly');
  const [nextDate, setNextDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
      setRules(res.data || []);
    } catch {
      // The sheet still lets a schedule be added without the list.
    } finally {
      setIsLoading(false);
    }
  }, []);

  const resetForm = () => {
    setError(null);
    setSource('');
    setAmount('');
    setFrequency('monthly');
    // A month from today: closer to a real payday than "the 1st", and
    // obviously a default rather than a fact about the user.
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    setNextDate(localDateValue(d));
  };

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setConfirmingId(null);
      setIsAdding(false);
      resetForm();
      void fetchRules();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, fetchRules]);

  if (!isOpen) return null;

  const visible = rules.filter((r) => r.active !== false);
  // With nothing scheduled, adding one IS the sheet - no empty list to read past.
  const adding = isAdding || (!isLoading && visible.length === 0);
  const amountPaise = padToPaise(amount);

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);

    if (!source.trim()) return setError('Enter who pays you.');
    if (amountPaise <= 0) return setError('Enter the amount you expect.');
    const due = paydayFromDateValue(nextDate);
    if (!due) return setError('Choose when the next one is due.');

    setIsSubmitting(true);
    try {
      await apiClient.post<RecurringIncome>('/income/recurring', {
        source: source.trim(),
        amount_minor: amountPaise,
        frequency,
        next_occurrence: due.at.toISOString(),
        anchor_day: due.day,
        active: true,
      });
      addToast('Salary schedule saved.', 'success');
      setIsAdding(false);
      resetForm();
      void fetchRules();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Could not save that schedule.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      await apiClient.delete(`/income/recurring/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      setConfirmingId(null);
      addToast('Salary schedule removed.', 'info');
    } catch {
      addToast('Could not remove that schedule.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={adding ? 'Add a salary' : 'Salary schedule'}>
      {adding ? (
        <form className="qa ms" data-type="income" onSubmit={handleCreate} noValidate>
          <MoneyFlow
            moving={amountPaise > 0}
            from={{
              caption: 'From',
              label: source.trim() || 'Who pays you?',
              icon: <BriefcaseBusiness size={22} />,
            }}
            to={{
              caption: everyLabel(frequency),
              label: dayMonth(nextDate),
              icon: <CalendarDays size={22} />,
              tone: 'accent',
            }}
          />

          <div className="qa-payee">
            <label className="qa-payee-label" htmlFor="rs-source">From</label>
            <input
              id="rs-source"
              className="qa-payee-input"
              type="text"
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder="Who pays you"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>

          <PadAmount value={amount} label="Amount you expect" />

          <div className="ms-quick" role="radiogroup" aria-label="How often">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={frequency === f.value}
                className={`qa-chip ${frequency === f.value ? 'is-selected' : ''}`}
                onClick={() => setFrequency(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <NumberPad value={amount} onChange={setAmount} />

          <label className="ms-field">
            <span className="ms-field-label">Next payday</span>
            <input
              className="qa-field"
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />
          </label>

          {error && (
            <div className="qa-error" role="alert" key={error}>
              {error}
            </div>
          )}

          <div className="ms-two">
            {visible.length > 0 ? (
              <Button type="button" variant="secondary" onClick={() => { setIsAdding(false); resetForm(); }}>
                Cancel
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={onClose}>
                Not now
              </Button>
            )}
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save schedule
            </Button>
          </div>
        </form>
      ) : (
        <div className="qa ms" data-type="income">
          <p className="ms-lead">
            Pay you&rsquo;re expecting, not money yet. Nothing changes your balance until you mark it received.
          </p>

          {isLoading ? (
            <div className="ms-list" aria-busy="true" aria-label="Loading salary schedules">
              <div className="ms-skeleton" />
            </div>
          ) : (
            <div className="ms-list">
              {visible.map((rule, i) => {
                const next = describeNext(rule.next_occurrence);
                const confirming = confirmingId === rule.id;
                return (
                  <div key={rule.id} className="ms-card" style={{ animationDelay: `${i * 40}ms` }}>
                    <span className="ms-card-avatar" aria-hidden="true">
                      {rule.source.trim().charAt(0).toUpperCase() || '₹'}
                    </span>
                    <span className="ms-card-main">
                      <span className="ms-card-name">{rule.source}</span>
                      <span className={`ms-card-when ${next.due ? 'is-due' : ''}`}>
                        {everyLabel(rule.frequency)} · {next.text}
                      </span>
                    </span>
                    <span className="ms-card-amount">{formatMonetaryValue(rule.amount_minor)}</span>

                    {confirming ? (
                      <div className="ms-confirm" role="group" aria-label={`Remove ${rule.source}?`}>
                        <span className="ms-confirm-text">Remove this schedule?</span>
                        <Button size="sm" variant="secondary" onClick={() => setConfirmingId(null)}>
                          Keep
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isLoading={busyId === rule.id}
                          onClick={() => void handleDelete(rule.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="ms-card-actions">
                        <Button
                          size="sm"
                          variant={next.due ? 'primary' : 'secondary'}
                          onClick={() => {
                            onSelectForConfirmation(rule);
                            onClose();
                          }}
                        >
                          <Check size={14} /> Received
                        </Button>
                        <button
                          type="button"
                          className="ms-icon-btn"
                          aria-label={`Remove ${rule.source}`}
                          onClick={() => setConfirmingId(rule.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && (
            <button type="button" className="ms-add" onClick={() => setIsAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add another salary
            </button>
          )}
        </div>
      )}
    </Modal>
  );
};
