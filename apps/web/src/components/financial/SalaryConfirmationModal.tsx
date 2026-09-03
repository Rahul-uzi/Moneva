import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { FormField } from '../ui/FormField';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { nowForDateTimeInput } from '../../utils/datetime';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import { Trash2 } from 'lucide-react';
import type { Account, Category, Transaction, RecurringIncome } from '../../types/api';
import './SalaryConfirmationModal.css';

interface SalaryConfirmationModalProps {
  isOpen: boolean;
  recurringSalary?: RecurringIncome | null;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}

export const SalaryConfirmationModal: React.FC<SalaryConfirmationModalProps> = ({
  isOpen,
  recurringSalary,
  accounts,
  categories,
  onClose,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [sourceName, setSourceName] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [txDate, setTxDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  // One dialog does both jobs: record what actually arrived, and optionally
  // remember it as a monthly stream. Splitting them across two modals meant
  // setting up salary and recording salary were separate journeys.
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [rules, setRules] = useState<RecurringIncome[]>([]);
  const [rulesBusy, setRulesBusy] = useState<boolean>(false);

  // Confirmed Transaction State
  const [confirmedTransaction, setConfirmedTransaction] = useState<Transaction | null>(null);

  // Reset only when the dialog opens. This used to depend on `accounts` and
  // `categories` too, and onSuccess refetches them - so a new array identity
  // re-ran the effect and wiped `confirmedTransaction`, hiding the success
  // screen for a salary that had genuinely been recorded.
  useEffect(() => {
    if (!isOpen) return;
    // Deferred, as elsewhere in this file, so the state settles after the
    // render rather than cascading during it.
    const timer = setTimeout(() => {
      setConfirmedTransaction(null);
      setFormError(null);
      setIsRecurring(false);
      setAmountPaise(recurringSalary ? recurringSalary.amount_minor : 0);
      setSourceName(recurringSalary ? recurringSalary.source : 'Monthly Salary');
      setTxDate(nowForDateTimeInput());
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, recurringSalary]);

  // Defaults are filled in once the lists arrive, without disturbing a choice
  // the user has already made.
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setAccountId((cur) => cur || (accounts.length > 0 ? accounts[0].id : ''));
      setCategoryId((cur) => cur || (categories.find((c) => c.type === 'income')?.id ?? ''));
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, accounts, categories]);

  // Matches the load pattern used elsewhere in this file: the fetch is started
  // inside the effect and guarded, so no state is set on an unmounted dialog.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void (async () => {
      try {
        const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
        if (active) setRules(res.data);
      } catch {
        // The dialog still works for a one-off salary without the stream list.
      }
    })();
    return () => {
      active = false;
    };
  }, [isOpen]);

  const handleDeleteRule = async (id: string) => {
    setRulesBusy(true);
    try {
      await apiClient.delete(`/income/recurring/${id}`);
      setRules((prev) => prev.filter((r) => r.id !== id));
      addToast('Salary stream removed.', 'info');
    } catch {
      addToast('Could not remove that salary stream.', 'error');
    } finally {
      setRulesBusy(false);
    }
  };

  if (!isOpen) return null;

  const handleConfirmSalary = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (amountPaise <= 0) {
      setFormError('Please enter a valid salary amount greater than zero.');
      return;
    }

    if (!accountId) {
      setFormError('Please select an account to receive your salary.');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        client_mutation_id: crypto.randomUUID(),
        account_id: accountId,
        category_id: categoryId || null,
        transaction_type: 'income',
        amount_minor: amountPaise,
        currency: 'INR',
        description: `Salary Received: ${sourceName}`,
        transaction_date: txDate ? new Date(txDate).toISOString() : new Date().toISOString(),
        device_id: 'web-client',
      };

      const res = await apiClient.post<Transaction>('/transactions', payload);

      if (isRecurring) {
        // Same source updates the existing stream rather than stacking
        // duplicates every month.
        const existing = rules.find(
          (r) => r.source.trim().toLowerCase() === sourceName.trim().toLowerCase(),
        );
        const nextMonth = new Date(txDate ? new Date(txDate) : new Date());
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        try {
          if (existing) {
            await apiClient.patch(`/income/recurring/${existing.id}`, {
              amount_minor: amountPaise,
              next_occurrence: nextMonth.toISOString(),
            });
          } else {
            await apiClient.post('/income/recurring', {
              source: sourceName.trim() || 'Monthly Salary',
              amount_minor: amountPaise,
              frequency: 'monthly',
              next_occurrence: nextMonth.toISOString(),
            });
          }
        } catch {
          addToast('Salary saved, but the monthly stream could not be stored.', 'error');
        }
      }

      setConfirmedTransaction(res.data);
      addToast('Salary recorded successfully into your ledger!', 'success');
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to record salary.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={confirmedTransaction ? 'Salary Recorded' : 'Add Salary'}
    >
      {confirmedTransaction ? (
        <div className="salary-confirmed-body">
          <div className="confirmed-icon-ring">
            <CheckCircle2 size={44} />
          </div>

          <h3 className="heading-md text-main">Salary Recorded</h3>
          <p className="text-body text-center text-xs text-muted">
            Your ledger and account balance have been updated authoritatively.
          </p>

          <div className="confirmed-amount-box">
            <span className="text-label text-teal font-bold uppercase">Received Salary</span>
            <span className="number-xl text-teal">+{formatMonetaryValue(confirmedTransaction.amount_minor)}</span>
            <span className="text-body text-xs">{confirmedTransaction.description}</span>
          </div>

          <div className="confirmed-plan-cta">
            <h4 className="heading-xs text-blue">Plan This Money</h4>
            <p className="text-body text-xs text-muted text-center">
              Would you like to allocate this income into your category budgets or savings goals?
            </p>
            <div className="cta-actions">
              <Button variant="secondary" onClick={onClose}>
                Done
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onClose();
                  navigate('/plan');
                }}
              >
                Go to Planner <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleConfirmSalary} className="salary-modal-form">
          {formError && <div className="form-error-banner">{formError}</div>}

          <div className="salary-preview-card">
            <span className="preview-tag text-teal font-bold uppercase">What you actually received</span>
            <span className="text-body text-xs text-muted">
              This adds to your balance straight away. Adjust the amount if it differs
              from what you expected.
            </span>
          </div>

          <FormField
            label="Employer / Income Source"
            type="text"
            placeholder="e.g. Tech Corp, Freelance Client"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
          />

          <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="Salary Amount Received" />

          <div className="select-group">
            <label className="form-label">Receiving Account</label>
            <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.account_type.toUpperCase()}) - Current: {formatMonetaryValue(acc.balance_paise ?? acc.opening_balance_minor)}
                </option>
              ))}
            </select>
          </div>

          <div className="select-group">
            <label className="form-label">Income Category</label>
            <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories
                .filter((c) => c.type === 'income')
                .map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
            </select>
          </div>

          <FormField
            label="Received Date & Time"
            type="datetime-local"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
          />

          {/* One tick decides whether this is a one-off or a monthly stream, so
              there is no separate "expected rules" journey to find. */}
          <label className="salary-repeat-row">
            <input
              type="checkbox"
              className="toggle-checkbox"
              checked={isRecurring}
              onChange={(e) => setIsRecurring(e.target.checked)}
            />
            <span className="salary-repeat-copy">
              <span className="text-body font-semibold">I get this every month</span>
              <span className="text-body text-xs text-muted">
                Saves it as a stream so next month is one tap. Nothing is added to your
                balance until you record it.
              </span>
            </span>
          </label>

          {rules.length > 0 && (
            <div className="salary-streams">
              <span className="text-label">Saved streams</span>
              {rules.map((r) => (
                <div key={r.id} className="salary-stream-row">
                  <button
                    type="button"
                    className="stream-use"
                    onClick={() => {
                      setSourceName(r.source);
                      setAmountPaise(r.amount_minor);
                    }}
                  >
                    <span className="stream-name">{r.source}</span>
                    <span className="stream-amount">{formatMonetaryValue(r.amount_minor)}</span>
                  </button>
                  <button
                    type="button"
                    className="card-action-btn btn-danger"
                    onClick={() => void handleDeleteRule(r.id)}
                    disabled={rulesBusy}
                    aria-label={`Remove ${r.source}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="salary-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Record Salary
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
