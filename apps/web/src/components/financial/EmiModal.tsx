import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient, describeApiError } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { emiProgress } from '../../utils/cardCycle';
import { formatMonetaryValue } from '../../utils/money';
import type { Account, Emi } from '../../types/api';
import './EmiModal.css';

interface Props {
  isOpen: boolean;
  emiToEdit?: Emi | null;
  /** Cards and loans the plan can be charged to. */
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}

/** An ISO instant as the yyyy-mm-dd a date input wants. */
const asDateInput = (iso: string): string => {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : '';
};

const todayInput = (): string => new Date().toISOString().slice(0, 10);

/**
 * Entering a plan the user is already committed to.
 *
 * Four facts, because four is what the calendar needs: what it is, the
 * instalment, how many, and when the first one went out. Nothing is derived
 * from the ledger - the bank takes the instalment whether or not the app saw
 * the alert, so asking is the only way to be right.
 *
 * The total is shown back as it is typed. A person deciding whether to convert
 * a purchase to EMI is shown a monthly figure by the shop; the number that
 * actually matters is what it adds up to, and it is rarely put in front of
 * them.
 */
export const EmiModal: React.FC<Props> = ({
  isOpen, emiToEdit, accounts, onClose, onSuccess,
}) => {
  const isEditing = !!emiToEdit;
  const [name, setName] = useState('');
  const [monthlyPaise, setMonthlyPaise] = useState(0);
  const [months, setMonths] = useState('12');
  const [startedOn, setStartedOn] = useState(todayInput());
  const [accountId, setAccountId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    if (!isOpen) return;
    if (emiToEdit) {
      setName(emiToEdit.name);
      setMonthlyPaise(emiToEdit.monthly_minor);
      setMonths(String(emiToEdit.months));
      setStartedOn(asDateInput(emiToEdit.started_at));
      setAccountId(emiToEdit.account_id || '');
    } else {
      setName('');
      setMonthlyPaise(0);
      setMonths('12');
      setStartedOn(todayInput());
      setAccountId('');
    }
    setError(null);
  }, [emiToEdit, isOpen]);

  const monthCount = Number.parseInt(months, 10);
  const monthsAreValid = Number.isFinite(monthCount) && monthCount >= 1 && monthCount <= 600;
  const totalPaise = monthsAreValid ? monthlyPaise * monthCount : 0;

  // Shown live so the plan can be read back before it is saved: a start date
  // typed wrong by a month is invisible in the form and obvious here.
  const preview = (monthsAreValid && monthlyPaise > 0 && startedOn)
    ? emiProgress(
        { name, monthlyMinor: monthlyPaise, months: monthCount,
          startedAt: new Date(`${startedOn}T00:00:00.000Z`).toISOString() },
        Date.now(),
      )
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError('Give the plan a name - what is being paid off.');
    if (monthlyPaise <= 0) return setError('Enter the monthly instalment.');
    if (!monthsAreValid) return setError('Enter how many instalments, between 1 and 600.');
    if (!startedOn) return setError('Enter the date of the first instalment.');

    // Sent as an instant at midnight UTC, matching how the calendar reads it
    // back. A local-midnight date would land in the previous day east of
    // Greenwich and move the instalment a month for a plan that starts on the
    // 1st.
    const startedAt = new Date(`${startedOn}T00:00:00.000Z`).toISOString();

    setIsSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        monthly_minor: monthlyPaise,
        months: monthCount,
        started_at: startedAt,
        account_id: accountId || null,
      };
      if (isEditing && emiToEdit) {
        await apiClient.patch<Emi>(`/emis/${emiToEdit.id}`, body);
        addToast('Plan updated.', 'success');
      } else {
        await apiClient.post<Emi>('/emis', body);
        addToast('Plan added.', 'success');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(describeApiError(err, 'Could not save the plan.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = async () => {
    if (!isEditing || !emiToEdit) return;
    setIsSubmitting(true);
    try {
      await apiClient.patch<Emi>(`/emis/${emiToEdit.id}`, { is_active: false });
      addToast('Plan closed.', 'info');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(describeApiError(err, 'Could not close the plan.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit instalment plan' : 'Add instalment plan'}
    >
      <form onSubmit={handleSubmit} className="emi-modal-form">
        {error && <div className="emi-modal-error">{error}</div>}

        <FormField
          label="What is being paid off"
          type="text"
          placeholder="e.g. iPhone 16, Fridge"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <AmountInput
          valuePaise={monthlyPaise}
          onChangePaise={setMonthlyPaise}
          label="Instalment each month"
        />

        <div className="emi-modal-row">
          <FormField
            label="Number of instalments"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
          <FormField
            label="First instalment"
            type="date"
            value={startedOn}
            onChange={(e) => setStartedOn(e.target.value)}
          />
        </div>

        <div className="select-group">
          <label className="form-label">Charged to (optional)</label>
          <select
            className="form-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {/* Optional on purpose: plenty of people are paying something off
                on a card they have not added here, and refusing the plan until
                they do would lose the figure entirely. */}
            <option value="">Not linked to an account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {preview && (
          <div className="emi-modal-preview">
            <div className="emi-modal-preview-row">
              <span>Total over {monthCount} months</span>
              <strong>{formatMonetaryValue(totalPaise)}</strong>
            </div>
            <div className="emi-modal-preview-row is-muted">
              <span>{preview.paidCount} already paid</span>
              <span>{formatMonetaryValue(preview.remainingMinor)} left</span>
            </div>
          </div>
        )}

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save changes' : 'Add plan'}
        </Button>

        {/* Closing, not deleting. A plan settled early is a fact about what was
            being paid off, and the history is worth keeping. */}
        {isEditing && (
          <button
            type="button"
            className="emi-modal-close-plan"
            onClick={() => void handleClose()}
            disabled={isSubmitting}
          >
            Mark this plan as finished
          </button>
        )}
      </form>
    </Modal>
  );
};
