import React, { useEffect, useState, useCallback } from 'react';
import { Sparkles, Calendar } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { FormField } from '../ui/FormField';
import { Button } from '../ui/Button';
import { AccountModal } from './AccountModal';
import { ExpenseSuccessModal } from './ExpenseSuccessModal';
import { SalaryConfirmationModal } from './SalaryConfirmationModal';
import { RecurringSalaryModal } from './RecurringSalaryModal';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { Account, Category, Transaction, RecurringIncome } from '../../types/api';
import './QuickAddModal.css';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [merchant, setMerchant] = useState<string>('');
  const [txDate, setTxDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modals state
  const [savedTransaction, setSavedTransaction] = useState<Transaction | null>(null);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState<boolean>(false);
  const [isSalaryConfirmOpen, setIsSalaryConfirmOpen] = useState<boolean>(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState<boolean>(false);
  const [selectedRecurringRule, setSelectedRecurringRule] = useState<RecurringIncome | null>(null);

  const { addToast } = useUiStore();

  const loadOptions = useCallback(async () => {
    try {
      const [accRes, catRes] = await Promise.all([
        apiClient.get<Account[]>('/accounts'),
        apiClient.get<Category[]>('/categories'),
      ]);
      setAccounts(accRes.data);
      setCategories(catRes.data);

      if (accRes.data.length > 0) {
        setAccountId(accRes.data[0].id);
        if (accRes.data.length > 1) {
          setToAccountId(accRes.data[1].id);
        }
      }

      const matchingCats = catRes.data.filter((c) => c.type === type);
      if (matchingCats.length > 0) {
        setCategoryId(matchingCats[0].id);
      }
    } catch {
      setFormError('Failed to load accounts or categories');
    }
  }, [type]);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (isOpen && isMounted) {
        const nowISO = new Date().toISOString().slice(0, 16);
        setTxDate(nowISO);
        setSavedTransaction(null);
        void loadOptions();
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, loadOptions]);

  const handleCreateDefaultCategory = async () => {
    try {
      const catName = type === 'income' ? 'Salary & Income' : 'General Expense';
      const res = await apiClient.post<Category>('/categories', {
        name: catName,
        type,
        icon: type === 'income' ? 'Wallet' : 'Tag',
        color: type === 'income' ? '#2563EB' : '#FF6B6B',
      });
      addToast(`Created "${catName}" category.`, 'success');
      await loadOptions();
      setCategoryId(res.data.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to create category.';
      setFormError(msg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (amountPaise <= 0) {
      setFormError('Please enter an amount greater than zero.');
      return;
    }
    if (!accountId) {
      setFormError('Please select an account. Create an account first if none exist.');
      return;
    }

    if (type !== 'transfer' && !categoryId) {
      setFormError('Please select a category.');
      return;
    }

    if (type === 'transfer') {
      if (!toAccountId) {
        setFormError('Please select a destination account for transfer.');
        return;
      }
      if (accountId === toAccountId) {
        setFormError('Source and destination accounts must be different.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const clientMutationId = crypto.randomUUID();
      const combinedDescription = merchant.trim()
        ? notes.trim()
          ? `${merchant.trim()} - ${notes.trim()}`
          : merchant.trim()
        : notes.trim() || null;

      const payload = {
        client_mutation_id: clientMutationId,
        account_id: accountId,
        to_account_id: type === 'transfer' ? toAccountId : null,
        category_id: type !== 'transfer' && categoryId ? categoryId : null,
        transaction_type: type,
        amount_minor: amountPaise,
        currency: 'INR',
        description: combinedDescription,
        transaction_date: txDate ? new Date(txDate).toISOString() : new Date().toISOString(),
        device_id: 'web-client',
      };

      const res = await apiClient.post<Transaction>('/transactions', payload);
      
      onSuccess();
      setSavedTransaction(res.data);
      setAmountPaise(0);
      setMerchant('');
      setNotes('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to create transaction.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCategories = categories.filter((c) => c.type === type);

  return (
    <>
      <Modal isOpen={isOpen && !savedTransaction && !isSalaryConfirmOpen && !isRecurringModalOpen} onClose={onClose} title="Record Transaction">
        <form onSubmit={handleSubmit} className="quick-add-form">
          {formError && <div className="form-error-banner">{formError}</div>}

          <div className="type-tabs">
            <button
              type="button"
              className={`tab-btn ${type === 'expense' ? 'tab-active tab-expense' : ''}`}
              onClick={() => setType('expense')}
            >
              Expense
            </button>
            <button
              type="button"
              className={`tab-btn ${type === 'income' ? 'tab-active tab-income' : ''}`}
              onClick={() => setType('income')}
            >
              Income
            </button>
            <button
              type="button"
              className={`tab-btn ${type === 'transfer' ? 'tab-active tab-transfer' : ''}`}
              onClick={() => setType('transfer')}
            >
              Transfer
            </button>
          </div>

          {/* Special Salary Shortcut Banner for Income Tab */}
          {type === 'income' && (
            <div className="income-salary-shortcut">
              <div className="shortcut-text">
                <Sparkles size={16} className="text-blue" />
                <span className="text-body text-xs font-semibold">Got your monthly salary today?</span>
              </div>
              <div className="shortcut-btns">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setSelectedRecurringRule(null);
                    setIsSalaryConfirmOpen(true);
                  }}
                >
                  Confirm Salary Receipt
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsRecurringModalOpen(true)}
                >
                  <Calendar size={14} /> Expected Rules
                </Button>
              </div>
            </div>
          )}

          {/* Amount Field */}
          <AmountInput
            valuePaise={amountPaise}
            onChangePaise={setAmountPaise}
            label={type === 'income' ? 'Income Amount' : type === 'expense' ? 'Expense Amount' : 'Transfer Amount'}
          />

          {/* Account Selector */}
          <div className="select-group">
            <label className="form-label">{type === 'transfer' ? 'From Account' : 'Account'}</label>
            {accounts.length === 0 ? (
              <div className="empty-selection-box">
                <span className="text-body text-xs text-coral">No account added yet.</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setIsAddAccountOpen(true)}>
                  + Add Account
                </Button>
              </div>
            ) : (
              <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.account_type.toUpperCase()})
                  </option>
                ))}
              </select>
            )}
          </div>

          {type === 'transfer' ? (
            <div className="select-group">
              <label className="form-label">To Account</label>
              <select className="form-select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id} disabled={acc.id === accountId}>
                    {acc.name} ({acc.account_type.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="select-group">
              <label className="form-label">Category</label>
              {filteredCategories.length === 0 ? (
                <div className="empty-selection-box">
                  <span className="text-body text-xs text-muted">No {type} category available.</span>
                  <Button type="button" variant="secondary" size="sm" onClick={handleCreateDefaultCategory}>
                    + Add Category
                  </Button>
                </div>
              ) : (
                <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {filteredCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Merchant / Payee / Source */}
          <FormField
            label={type === 'income' ? 'Income Source / Payee' : 'Merchant / Payee'}
            type="text"
            placeholder={type === 'income' ? 'e.g. Acme Corp, Freelance Client, Dividend' : 'e.g. Swiggy, Amazon, Uber'}
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />

          {/* Date & Time */}
          <FormField
            label="Transaction Date & Time"
            type="datetime-local"
            value={txDate}
            onChange={(e) => setTxDate(e.target.value)}
          />

          {/* Notes */}
          <FormField
            label="Notes / Memo (Optional)"
            type="text"
            placeholder="e.g. August retainer, Bonus payout"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            isLoading={isSubmitting}
            disabled={accounts.length === 0}
          >
            {type === 'expense' ? 'Save Expense' : type === 'income' ? 'Save Income' : 'Save Transfer'}
          </Button>
        </form>
      </Modal>

      {/* Sub-modal for creating account on the fly */}
      <AccountModal
        isOpen={isAddAccountOpen}
        onClose={() => setIsAddAccountOpen(false)}
        onSuccess={() => void loadOptions()}
      />

      {/* Salary Confirmation Modal */}
      <SalaryConfirmationModal
        isOpen={isSalaryConfirmOpen}
        recurringSalary={selectedRecurringRule}
        accounts={accounts}
        categories={categories}
        onClose={() => {
          setIsSalaryConfirmOpen(false);
          setSelectedRecurringRule(null);
        }}
        onSuccess={onSuccess}
      />

      {/* Recurring Salary Modal */}
      <RecurringSalaryModal
        isOpen={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
        onSelectForConfirmation={(rule) => {
          setSelectedRecurringRule(rule);
          setIsSalaryConfirmOpen(true);
        }}
      />

      {/* Success Modal for Expense/Income */}
      <ExpenseSuccessModal
        transaction={savedTransaction}
        categoryName={categories.find((c) => c.id === savedTransaction?.category_id)?.name}
        accountName={accounts.find((a) => a.id === savedTransaction?.account_id)?.name}
        onClose={() => {
          setSavedTransaction(null);
          onClose();
        }}
      />
    </>
  );
};
