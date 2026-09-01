import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { Bill, Category } from '../../types/api';
import './BudgetModal.css';

interface BillModalProps {
  isOpen: boolean;
  billToEdit?: Bill | null;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}

export const BillModal: React.FC<BillModalProps> = ({
  isOpen,
  billToEdit,
  categories,
  onClose,
  onSuccess,
}) => {
  const isEditing = !!billToEdit;
  const [name, setName] = useState<string>('');
  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [dueDate, setDueDate] = useState<string>('');
  const [recurrence, setRecurrence] = useState<string>('monthly');
  const [categoryId, setCategoryId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (billToEdit) {
        setName(billToEdit.name);
        setAmountPaise(billToEdit.amount_minor);
        setDueDate(billToEdit.due_date ? billToEdit.due_date.split('T')[0] : '');
        setRecurrence(billToEdit.recurrence || 'monthly');
        setCategoryId(billToEdit.category_id || '');
      } else {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        setName('');
        setAmountPaise(0);
        setDueDate(nextWeek.toISOString().split('T')[0]);
        setRecurrence('monthly');
        setCategoryId('');
      }
      setError(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [billToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter a bill name.');
      return;
    }
    if (amountPaise <= 0) {
      setError('Please enter an amount greater than zero.');
      return;
    }
    if (!dueDate) {
      setError('Please select a due date.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && billToEdit) {
        await apiClient.patch<Bill>(`/bills/${billToEdit.id}`, {
          name: name.trim(),
          amount_minor: amountPaise,
          due_date: new Date(dueDate).toISOString(),
          recurrence,
          category_id: categoryId || null,
        });
        addToast('Bill reminder updated successfully!', 'success');
      } else {
        await apiClient.post<Bill>('/bills', {
          name: name.trim(),
          amount_minor: amountPaise,
          currency: 'INR',
          due_date: new Date(dueDate).toISOString(),
          recurrence,
          category_id: categoryId || null,
          status: 'upcoming',
        });
        addToast('Bill reminder created successfully!', 'success');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to save bill.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Bill' : 'Add Bill Reminder'}>
      <form onSubmit={handleSubmit} className="plan-modal-form">
        {error && <div className="plan-modal-error">{error}</div>}

        <FormField
          label="Bill Name"
          type="text"
          placeholder="e.g. Electricity, WiFi Fiber, Rent"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="Bill Amount" />

        <FormField
          label="Due Date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />

        <div className="select-group">
          <label className="form-label">Recurrence</label>
          <select className="form-select" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
            <option value="one-time">One-time</option>
          </select>
        </div>

        <div className="select-group">
          <label className="form-label">Category (Optional)</label>
          <select className="form-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">-- Select Category --</option>
            {expenseCategories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save Changes' : 'Create Bill'}
        </Button>
      </form>
    </Modal>
  );
};
