import React, { useEffect, useState } from 'react';
import { Info, Plus, Trash2, Calendar, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { FormField } from '../ui/FormField';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import type { RecurringIncome } from '../../types/api';
import './RecurringSalaryModal.css';

import { parseApiDate } from '../../utils/datetime';
interface RecurringSalaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectForConfirmation: (rule: RecurringIncome) => void;
}

export const RecurringSalaryModal: React.FC<RecurringSalaryModalProps> = ({
  isOpen,
  onClose,
  onSelectForConfirmation,
}) => {
  const [rules, setRules] = useState<RecurringIncome[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);

  // Form State
  const [source, setSource] = useState<string>('');
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [frequency, setFrequency] = useState<string>('monthly');
  const [nextDate, setNextDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  const fetchRecurringRules = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
      setRules(res.data);
    } catch {
      // Safe fallback
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isOpen && isMounted) {
        void fetchRecurringRules();
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        setNextDate(nextMonth.toISOString().split('T')[0]);
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!source.trim()) {
      setError('Please enter a source name (e.g. Employer, Client).');
      return;
    }

    if (amountPaise <= 0) {
      setError('Please enter an amount greater than zero.');
      return;
    }

    if (!nextDate) {
      setError('Please select a next expected payday date.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post<RecurringIncome>('/income/recurring', {
        source: source.trim(),
        amount_minor: amountPaise,
        frequency,
        next_occurrence: new Date(nextDate).toISOString(),
        active: true,
      });

      addToast('Recurring income rule saved successfully!', 'success');
      setIsFormOpen(false);
      setSource('');
      setAmountPaise(0);
      void fetchRecurringRules();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to save recurring rule.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await apiClient.delete(`/income/recurring/${id}`);
      addToast('Recurring income rule removed.', 'info');
      void fetchRecurringRules();
    } catch {
      addToast('Failed to delete recurring rule.', 'error');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Recurring Salary Rules">
      <div className="recurring-salary-body">
        {/* Authoritative Distinction Notice */}
        <div className="distinction-notice">
          <Info size={18} className="notice-icon text-blue" />
          <p className="text-body text-xs">
            <strong>Expected Income vs Actual Income:</strong> Recurring rules represent expected future salary. They do <strong>NOT</strong> modify your bank balances until explicitly confirmed.
          </p>
        </div>

        {/* Existing Rules List */}
        <div className="rules-section">
          <div className="rules-section-header">
            <h4 className="heading-xs text-main">Configured Salary Streams ({rules.length})</h4>
            {!isFormOpen && (
              <Button variant="secondary" size="sm" onClick={() => setIsFormOpen(true)}>
                <Plus size={14} /> Add Stream
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="text-body text-center text-xs text-muted py-2">Loading salary rules...</div>
          ) : rules.length === 0 && !isFormOpen ? (
            <div className="empty-rules-box">
              <span className="text-body text-xs text-muted">No recurring salary rules configured yet.</span>
            </div>
          ) : (
            <div className="rules-list">
              {rules.map((rule) => (
                <div key={rule.id} className="rule-card">
                  <div className="rule-card-main">
                    <div className="rule-title-row">
                      <span className="rule-source font-semibold">{rule.source}</span>
                      <span className="number-sm text-teal font-bold">
                        {formatMonetaryValue(rule.amount_minor)}
                      </span>
                    </div>
                    <div className="rule-meta-row">
                      <span className="rule-freq text-muted text-xs capitalize">{rule.frequency}</span>
                      <span className="rule-date text-muted text-xs">
                        <Calendar size={12} /> Expected:{' '}
                        {parseApiDate(rule.next_occurrence).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="rule-card-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        onSelectForConfirmation(rule);
                        onClose();
                      }}
                    >
                      <Check size={14} /> Received Today
                    </Button>
                    <button
                      type="button"
                      className="icon-delete-btn"
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Delete rule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Rule Form */}
        {isFormOpen && (
          <form onSubmit={handleCreateRule} className="add-rule-form">
            <h4 className="heading-xs text-blue">New Expected Salary Rule</h4>
            {error && <div className="form-error-banner">{error}</div>}

            <FormField
              label="Source / Employer Name"
              type="text"
              placeholder="e.g. Acme Corp, Tech Retainer"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />

            <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="Expected Net Amount" />

            <div className="select-group">
              <label className="form-label">Frequency</label>
              <select className="form-select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
                <option value="bi-weekly">Bi-weekly</option>
              </select>
            </div>

            <FormField
              label="Next Expected Payday"
              type="date"
              value={nextDate}
              onChange={(e) => setNextDate(e.target.value)}
            />

            <div className="form-action-btns">
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
                Save Rule
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
