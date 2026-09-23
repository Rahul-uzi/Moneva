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
import { nowForDateTimeInput } from '../../utils/datetime';
import { useUiStore } from '../../stores/useUiStore';
import {
  BANKS,
  WALLETS,
  MERCHANTS,
  OTHER_DESTINATION_ID,
  findDestination,
} from '../../data/transferDestinations';
import type { Account, Category, Transaction, RecurringIncome } from '../../types/api';
import './QuickAddModal.css';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  /**
   * Who the money went to, picked from the catalogue that used to sit behind
   * the Transfer tab's "Send to" - banks, wallets and apps.
   *
   * Empty, or "Other", means the payee is typed into `merchant` instead. There
   * is no second free-text field: one name for the payee, wherever it came
   * from, is what the description is built out of.
   */
  const [payeeId, setPayeeId] = useState<string>('');
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

      // No second account is preselected any more: the payee list is not a
      // list of your accounts, and it opens on "Type it below" on purpose.
      if (accRes.data.length > 0) {
        setAccountId(accRes.data[0].id);
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
        const nowISO = nowForDateTimeInput();
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
        color: type === 'income' ? 'var(--moneva-figure-income)' : 'var(--moneva-figure-expense)',
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

    if (!categoryId) {
      setFormError('Please select a category.');
      return;
    }

    // Choosing "Other" and then typing nothing leaves a row with no name on
    // it, which is worse than no choice at all.
    if (type === 'expense' && payeeId === OTHER_DESTINATION_ID && !merchant.trim()) {
      setFormError('Please type who the money went to.');
      return;
    }

    setIsSubmitting(true);
    try {
      const clientMutationId = crypto.randomUUID();

      // One name for the payee wherever it came from: the catalogue label
      // when one was picked, otherwise whatever was typed.
      const payeeName = payee ? payee.label : merchant.trim();
      const combinedDescription = payeeName
        ? notes.trim()
          ? `${payeeName} - ${notes.trim()}`
          : payeeName
        : notes.trim() || null;

      const payload = {
        client_mutation_id: clientMutationId,
        account_id: accountId,
        // Nothing this form creates has a far side any more. Transfers are
        // still made by goal contributions and by captured ATM withdrawals,
        // neither of which comes through here.
        to_account_id: null,
        category_id: categoryId || null,
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
      setPayeeId('');
      setNotes('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to create transaction.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  /** The catalogue entry behind the chosen payee, if one was chosen. */
  const payee = type === 'expense' ? findDestination(payeeId) : undefined;

  /** The payee has to be typed when none was picked, or "Other" was. */
  const payeeIsTyped = type === 'expense' && (!payeeId || payeeId === OTHER_DESTINATION_ID);

  /**
   * Picking a payee also picks the category it usually belongs to.
   *
   * Applied on change rather than at submit, so the choice is visible in the
   * Category field and can be overridden. Matched by NAME against the user's
   * own categories, so one they deleted is never invented - and when no match
   * exists the category is simply left alone.
   */
  const choosePayee = (id: string) => {
    setPayeeId(id);
    const hint = findDestination(id)?.categoryHint;
    if (!hint) return;
    const match = categories.find((c) => c.type === 'expense' && c.name === hint);
    if (match) setCategoryId(match.id);
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
            label={type === 'income' ? 'Income Amount' : 'Expense Amount'}
          />

          {/* Account Selector */}
          <div className="select-group">
            <label className="form-label">Account</label>
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

          {/* Who the money went to.
              Optional: picking from the list saves typing and picks the
              category too, but an unlisted payee is still just typed below.
              It sits above Category deliberately - choosing a payee changes
              the category, and a field that changes itself has to be visible
              when it does. */}
          {type === 'expense' && (
            <div className="select-group">
              <label className="form-label">Paid to</label>
              <select
                className="form-select"
                value={payeeId}
                onChange={(e) => choosePayee(e.target.value)}
              >
                <option value="">Type it below</option>
                <optgroup label="Apps & services">
                  {MERCHANTS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Banks">
                  {BANKS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Wallets & UPI">
                  {WALLETS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </optgroup>
                <option value={OTHER_DESTINATION_ID}>Someone else / Other…</option>
              </select>
            </div>
          )}

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

          {/* The typed payee. Hidden once one is picked from the list above -
              the label already names who was paid, and asking twice wasted a
              whole field. Income always types it; there is no catalogue of
              people who pay you. */}
          {(type === 'income' || payeeIsTyped) && (
            <FormField
              label={type === 'income' ? 'Income Source / Payee' : 'Merchant / Payee'}
              type="text"
              placeholder={type === 'income' ? 'e.g. Acme Corp, Freelance Client, Dividend' : 'e.g. Swiggy, Amazon, Uber'}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          )}

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
            {type === 'expense' ? 'Save Expense' : 'Save Income'}
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
