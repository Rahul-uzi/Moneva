import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { FormField } from '../ui/FormField';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
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

  // Confirmed Transaction State
  const [confirmedTransaction, setConfirmedTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isOpen && isMounted) {
        setConfirmedTransaction(null);
        setFormError(null);

        if (recurringSalary) {
          setAmountPaise(recurringSalary.amount_minor);
          setSourceName(recurringSalary.source);
        } else {
          setAmountPaise(0);
          setSourceName('Monthly Salary');
        }

        if (accounts.length > 0) {
          setAccountId(accounts[0].id);
        }

        const incCat = categories.find((c) => c.type === 'income');
        if (incCat) {
          setCategoryId(incCat.id);
        }

        setTxDate(new Date().toISOString().slice(0, 16));
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, recurringSalary, accounts, categories]);

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
      title={confirmedTransaction ? 'Salary Confirmed' : 'Confirm Salary Receipt'}
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
            <span className="preview-tag text-teal font-bold uppercase">Salary Confirmation Preview</span>
            <span className="text-body text-xs text-muted">
              Confirm the exact amount received before mutating your account balance.
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

          <div className="salary-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Confirm & Record Salary
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
