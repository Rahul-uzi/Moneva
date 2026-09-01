import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { Budget, Category } from '../../types/api';
import './BudgetModal.css';

interface BudgetModalProps {
  isOpen: boolean;
  budgetToEdit?: Budget | null;
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  budgetToEdit,
  categories,
  onClose,
  onSuccess,
}) => {
  const isEditing = !!budgetToEdit;
  const [categoryId, setCategoryId] = useState<string>('');
  const [limitPaise, setLimitPaise] = useState<number>(0);
  const [period, setPeriod] = useState<string>('monthly');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (budgetToEdit) {
        setCategoryId(budgetToEdit.category_id);
        setLimitPaise(budgetToEdit.limit_amount_minor);
        setPeriod(budgetToEdit.period || 'monthly');
        setStartDate(budgetToEdit.start_date ? budgetToEdit.start_date.split('T')[0] : '');
        setEndDate(budgetToEdit.end_date ? budgetToEdit.end_date.split('T')[0] : '');
      } else {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        
        setCategoryId(categories.length > 0 ? categories[0].id : '');
        setLimitPaise(0);
        setPeriod('monthly');
        setStartDate(firstDay);
        setEndDate(lastDay);
      }
      setError(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [budgetToEdit, isOpen, categories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (limitPaise <= 0) {
      setError('Please enter a budget limit greater than zero.');
      return;
    }
    if (!categoryId) {
      setError('Please select a spending category.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Please provide start and end dates.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && budgetToEdit) {
        await apiClient.patch<Budget>(`/budgets/${budgetToEdit.id}`, {
          limit_amount_minor: limitPaise,
          period,
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
        });
        addToast('Budget limit updated successfully!', 'success');
      } else {
        await apiClient.post<Budget>('/budgets', {
          category_id: categoryId,
          limit_amount_minor: limitPaise,
          period,
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
        });
        addToast('Budget created successfully!', 'success');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to save budget.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const expenseCategories = categories.filter((c) => c.type === 'expense');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Budget' : 'Add Category Budget'}>
      <form onSubmit={handleSubmit} className="plan-modal-form">
        {error && <div className="plan-modal-error">{error}</div>}

        {!isEditing && (
          <div className="select-group">
            <label className="form-label">Expense Category</label>
            <select
              className="form-select"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">-- Select Category --</option>
              {expenseCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <AmountInput valuePaise={limitPaise} onChangePaise={setLimitPaise} label="Budget Limit" />

        <div className="select-group">
          <label className="form-label">Period</label>
          <select className="form-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>

        <div className="dates-row">
          <FormField
            label="Start Date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <FormField
            label="End Date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save Changes' : 'Create Budget'}
        </Button>
      </form>
    </Modal>
  );
};
