import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import type { SavingsGoal, Account, Transaction } from '../../types/api';
import './GoalContributionModal.css';

interface GoalContributionModalProps {
  goal: SavingsGoal | null;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}

export const GoalContributionModal: React.FC<GoalContributionModalProps> = ({
  goal,
  accounts,
  onClose,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [accountId, setAccountId] = useState<string>('');
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Success Transaction State
  const [confirmedTransaction, setConfirmedTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (goal && isMounted) {
        setConfirmedTransaction(null);
        setIsConfirming(false);
        setFormError(null);
        setAmountPaise(0);

        if (accounts.length > 0) {
          setAccountId(accounts[0].id);
        }
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [goal, accounts]);

  if (!goal) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const availableBalance = selectedAccount
    ? selectedAccount.balance_paise ?? selectedAccount.opening_balance_minor
    : 0;

  const handleNextOrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (amountPaise <= 0) {
      setFormError('Please enter a contribution amount greater than zero.');
      return;
    }

    if (!accountId || !selectedAccount) {
      setFormError('Please select a source account for funding this contribution.');
      return;
    }

    if (amountPaise > availableBalance) {
      setFormError(
        `Contribution of ${formatMonetaryValue(amountPaise)} exceeds available account balance of ${formatMonetaryValue(availableBalance)}.`
      );
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    // Execute real financial transaction event
    setIsSubmitting(true);
    try {
      const payload = {
        client_mutation_id: crypto.randomUUID(),
        account_id: accountId,
        savings_goal_id: goal.id,
        transaction_type: 'transfer',
        amount_minor: amountPaise,
        currency: 'INR',
        description: `Goal Contribution: ${goal.name}`,
        transaction_date: new Date().toISOString(),
        device_id: 'web-client',
      };

      const res = await apiClient.post<Transaction>('/transactions', payload);
      setConfirmedTransaction(res.data);
      addToast(`Contributed ${formatMonetaryValue(amountPaise)} to "${goal.name}"!`, 'success');
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to post goal contribution.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={!!goal}
      onClose={onClose}
      title={confirmedTransaction ? 'Contribution Complete' : `Contribute to: ${goal.name}`}
    >
      {confirmedTransaction ? (
        <div className="contribution-confirmed-body">
          <div className="confirmed-icon-ring">
            <CheckCircle2 size={44} />
          </div>

          <h3 className="heading-md text-main">Contribution Recorded!</h3>
          <p className="text-body text-center text-xs text-muted">
            Your funding account balance decreased and your savings goal progress increased.
          </p>

          <div className="confirmed-summary-box">
            <span className="text-label text-teal font-bold uppercase">Saved to {goal.name}</span>
            <span className="number-xl text-teal">+{formatMonetaryValue(confirmedTransaction.amount_minor)}</span>
            <span className="text-body text-xs">Paid from {selectedAccount?.name}</span>
          </div>

          <div className="confirmed-actions">
            <Button variant="secondary" fullWidth onClick={onClose}>
              Done
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                onClose();
                navigate('/plan');
              }}
            >
              View Planner <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleNextOrSubmit} className="contribution-modal-form">
          {formError && <div className="form-error-banner">{formError}</div>}

          {isConfirming ? (
            <div className="confirmation-preview-box">
              <div className="preview-header-row">
                <ShieldAlert size={18} className="text-teal" />
                <span className="preview-title font-bold text-teal uppercase">Confirm Financial Contribution</span>
              </div>
              <p className="text-body text-xs text-muted">
                Review the details below. This will reduce your account balance and increase your saved goal progress.
              </p>

              <div className="preview-details">
                <div className="preview-row">
                  <span className="detail-label">Savings Goal</span>
                  <span className="detail-val font-semibold">{goal.name}</span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Contribution Amount</span>
                  <span className="detail-val number-md text-teal font-bold">
                    {formatMonetaryValue(amountPaise)}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Source Account</span>
                  <span className="detail-val">{selectedAccount?.name}</span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Balance After</span>
                  <span className="detail-val text-main">
                    {formatMonetaryValue(availableBalance - amountPaise)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="goal-summary-banner">
                <span className="text-label">Goal Target</span>
                <span className="number-md text-teal">{formatMonetaryValue(goal.target_amount_minor)}</span>
                <span className="text-body text-xs text-muted">
                  Current Saved: {formatMonetaryValue(goal.current_saved_minor || 0)}
                </span>
              </div>

              <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="Contribution Amount" />

              <div className="select-group">
                <label className="form-label">Funding Account</label>
                <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((acc) => {
                    const bal = acc.balance_paise ?? acc.opening_balance_minor;
                    return (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.account_type.toUpperCase()}) - Available: {formatMonetaryValue(bal)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </>
          )}

          <div className="modal-action-row">
            {isConfirming ? (
              <Button type="button" variant="secondary" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>
                Back / Edit
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}

            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              {isConfirming ? 'Confirm Contribution' : 'Review & Confirm'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
