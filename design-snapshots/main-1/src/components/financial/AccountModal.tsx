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
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (accountToEdit) {
        setName(accountToEdit.name);
        setAccountType(accountToEdit.account_type);
        setOpeningBalancePaise(accountToEdit.opening_balance_minor || 0);
      } else {
        setName('');
        setAccountType('asset');
        setOpeningBalancePaise(0);
      }
      setError(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [accountToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter an account name.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && accountToEdit) {
        await apiClient.patch<Account>(`/accounts/${accountToEdit.id}`, {
          name: name.trim(),
          account_type: accountType,
        });
        addToast('Account updated successfully!', 'success');
      } else {
        await apiClient.post<Account>('/accounts', {
          name: name.trim(),
          account_type: accountType,
          opening_balance_minor: openingBalancePaise,
          currency: 'INR',
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

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save Changes' : 'Create Account'}
        </Button>
      </form>
    </Modal>
  );
};
