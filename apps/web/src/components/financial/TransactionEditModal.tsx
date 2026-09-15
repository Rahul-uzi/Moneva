import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { nowForDateTimeInput, parseApiDate } from '../../utils/datetime';
import type { Category, Transaction } from '../../types/api';
import './TransactionEditModal.css';

interface Props {
  transaction: Transaction | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
  /** Open with the note field focused - long-press offers it as its own action. */
  focusNotes?: boolean;
}

export const TransactionEditModal: React.FC<Props> = ({
  transaction,
  categories,
  onClose,
  onSaved,
  focusNotes = false,
}) => {
  const { addToast } = useUiStore();
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [description, setDescription] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [txDate, setTxDate] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!transaction) return;
    const timer = setTimeout(() => {
      setAmountPaise(transaction.amount_minor);
      setDescription(transaction.description || '');
      setCategoryId(transaction.category_id || '');
      setNotes(transaction.notes || '');
      setTxDate(nowForDateTimeInput(parseApiDate(transaction.transaction_date)));
      setError(null);
      if (focusNotes && notesRef.current) {
        // scrollIntoView as well as focus: on a phone the note sits below the
        // fold of the sheet, and focus alone leaves the caret somewhere the
        // user cannot see.
        notesRef.current.focus();
        notesRef.current.scrollIntoView({ block: 'nearest' });
        // Caret at the END of any existing note, so adding to one does not
        // mean first tapping past what is already written.
        const end = notesRef.current.value.length;
        notesRef.current.setSelectionRange(end, end);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [transaction, focusNotes]);

  if (!transaction) return null;

  const isTransfer = transaction.transaction_type === 'transfer';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountPaise <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setIsSaving(true);
    try {
      // A transfer has no category, so it is left out rather than sent as null.
      await apiClient.patch(`/transactions/${transaction.id}`, {
        amount_minor: amountPaise,
        description: description.trim(),
        // Sent even when empty, which is how a note is cleared: the server
        // skips a field that is absent, so omitting a blank one would make
        // deleting a note impossible. It stores "" back as NULL.
        notes: notes.trim(),
        transaction_date: new Date(txDate).toISOString(),
        ...(isTransfer ? {} : { category_id: categoryId || null }),
      });
      addToast('Transaction updated. Balances recalculated.', 'success');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || 'Could not update that transaction.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={!!transaction} onClose={onClose} title="Edit Transaction">
      <form onSubmit={handleSave} className="tx-edit-form">
        {error && <div className="form-error-banner">{error}</div>}

        <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="Amount" />

        <FormField
          label="Description"
          type="text"
          placeholder="e.g. Zomato dinner"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {!isTransfer && (
          <div className="select-group">
            <label className="form-label">Category</label>
            <select
              className="form-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Uncategorised</option>
              {categories
                .filter((c) => c.type === transaction.transaction_type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <FormField
          label="Date & Time"
          type="datetime-local"
          value={txDate}
          onChange={(e) => setTxDate(e.target.value)}
        />

        {/* Kept apart from Description on purpose. The description is what the
            row is titled by and what the category and the logo are matched
            against - usually written by the parser, not by the user. A note
            typed in there would rename the payment and could move it into a
            different category. Nothing reads this field. */}
        <div className="moneva-form-field">
          <label className="form-label" htmlFor="tx-notes">
            Note <span className="tx-edit-optional">optional</span>
          </label>
          <textarea
            ref={notesRef}
            id="tx-notes"
            className="form-input tx-edit-notes"
            rows={3}
            maxLength={1000}
            placeholder="Split with Anita - she owes me half"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <span className="tx-edit-note-hint">
            Just for you. It never changes the category or the name on the row.
          </span>
        </div>

        <div className="tx-edit-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSaving}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};
