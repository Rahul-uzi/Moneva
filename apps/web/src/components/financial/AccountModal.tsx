import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { Account } from '../../types/api';
import './AccountModal.css';

interface AccountModalProps {
  isOpen: boolean;
  accountToEdit?: Account | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  accountToEdit,
  onClose,
  onSuccess,
}) => {
  const isEditing = !!accountToEdit;
  const [name, setName] = useState<string>('');
  const [accountType, setAccountType] = useState<'asset' | 'liability'>('asset');
  const [openingBalancePaise, setOpeningBalancePaise] = useState<number>(0);
  // Kept as strings so the fields can be empty. A number state would have to
  // pick a stand-in for "not filled in", and every candidate is a real day.
  const [statementDay, setStatementDay] = useState<string>('');
  const [dueDay, setDueDay] = useState<string>('');
  const [creditLimitPaise, setCreditLimitPaise] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (accountToEdit) {
        setName(accountToEdit.name);
        setAccountType(accountToEdit.account_type);
        setOpeningBalancePaise(accountToEdit.opening_balance_minor || 0);
        setStatementDay(accountToEdit.statement_day ? String(accountToEdit.statement_day) : '');
        setDueDay(accountToEdit.due_day ? String(accountToEdit.due_day) : '');
        setCreditLimitPaise(accountToEdit.credit_limit_minor || 0);
      } else {
        setName('');
        setAccountType('asset');
        setOpeningBalancePaise(0);
        setStatementDay('');
        setDueDay('');
        setCreditLimitPaise(0);
      }
      setError(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [accountToEdit, isOpen]);

  /* Billing terms belong to a liability. Asking a savings account when its
     statement closes would be nonsense, and storing an answer would make the
     card screen draw a cycle for a bank account. */
  const isCardType = accountType === 'liability';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter an account name.');
      return;
    }

    // Both days or neither: one alone describes no billing cycle, and the
    // server refuses it. Caught here so the message names the missing field
    // instead of arriving as a rejected save.
    const hasStatement = statementDay.trim() !== '';
    const hasDue = dueDay.trim() !== '';
    if (isCardType && hasStatement !== hasDue) {
      setError('A card needs both dates - when the statement closes, and when payment is due.');
      return;
    }

    // Cleared, not omitted, when the account is not a card: null is how a card
    // stops being one, and leaving the keys out would silently keep old terms
    // on an account the user has just changed to a savings account.
    const cardTerms = {
      statement_day: isCardType && hasStatement ? Number(statementDay) : null,
      due_day: isCardType && hasDue ? Number(dueDay) : null,
      credit_limit_minor: isCardType && creditLimitPaise > 0 ? creditLimitPaise : null,
    };

    setIsSubmitting(true);
    try {
      if (isEditing && accountToEdit) {
        await apiClient.patch<Account>(`/accounts/${accountToEdit.id}`, {
          name: name.trim(),
          account_type: accountType,
          ...cardTerms,
        });
        addToast('Account updated successfully!', 'success');
      } else {
        await apiClient.post<Account>('/accounts', {
          name: name.trim(),
          account_type: accountType,
          opening_balance_minor: openingBalancePaise,
          currency: 'INR',
          ...cardTerms,
        });
        addToast('Account created successfully!', 'success');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to save account.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Account' : 'Add New Account'}>
      <form onSubmit={handleSubmit} className="account-modal-form">
        {error && <div className="account-modal-error">{error}</div>}

        <FormField
          label="Account Name"
          type="text"
          placeholder="e.g. HDFC Bank, Cash Wallet"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div className="select-group">
          <label className="form-label">Account Category / Type</label>
          <select
            className="form-select"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as 'asset' | 'liability')}
          >
            <option value="asset">Asset (Bank, Savings, Cash)</option>
            <option value="liability">Liability (Credit Card, Loan)</option>
          </select>
        </div>

        {!isEditing && (
          <AmountInput
            valuePaise={openingBalancePaise}
            onChangePaise={setOpeningBalancePaise}
            label="Opening / Starting Balance"
          />
        )}

        {/* Only for a liability, and optional even then: a loan has no
            statement cycle, and neither does a card the user only wants to
            track a balance on. */}
        {isCardType && (
          <div className="account-modal-card-terms">
            <p className="account-modal-hint">
              If this is a credit card, its two dates are what let the app tell
              you what is owed and when - a balance alone cannot.
            </p>

            <div className="account-modal-days">
              <FormField
                label="Statement closes on"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                placeholder="18"
                value={statementDay}
                onChange={(e) => setStatementDay(e.target.value)}
              />
              <FormField
                label="Payment due on"
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                placeholder="8"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>

            <AmountInput
              valuePaise={creditLimitPaise}
              onChangePaise={setCreditLimitPaise}
              label="Credit limit (optional)"
            />
          </div>
        )}

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save Changes' : 'Create Account'}
        </Button>
      </form>
    </Modal>
  );
};
