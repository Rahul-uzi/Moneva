import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { FormField } from '../ui/FormField';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import type { SavingsGoal } from '../../types/api';
import './BudgetModal.css';

interface GoalModalProps {
  isOpen: boolean;
  goalToEdit?: SavingsGoal | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const GoalModal: React.FC<GoalModalProps> = ({
  isOpen,
  goalToEdit,
  onClose,
  onSuccess,
}) => {
  const isEditing = !!goalToEdit;
  const [name, setName] = useState<string>('');
  const [targetPaise, setTargetPaise] = useState<number>(0);
  const [targetDate, setTargetDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const { addToast } = useUiStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      if (goalToEdit) {
        setName(goalToEdit.name);
        setTargetPaise(goalToEdit.target_amount_minor);
        setTargetDate(goalToEdit.target_date ? goalToEdit.target_date.split('T')[0] : '');
      } else {
        const nextYear = new Date();
        nextYear.setFullYear(nextYear.getFullYear() + 1);
        setName('');
        setTargetPaise(0);
        setTargetDate(nextYear.toISOString().split('T')[0]);
      }
      setError(null);
    }, 0);

    return () => clearTimeout(timer);
  }, [goalToEdit, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please enter a goal name.');
      return;
    }
    if (targetPaise <= 0) {
      setError('Please enter a target amount greater than zero.');
      return;
    }
    if (!targetDate) {
      setError('Please select a target date.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && goalToEdit) {
        await apiClient.patch<SavingsGoal>(`/goals/${goalToEdit.id}`, {
          name: name.trim(),
          target_amount_minor: targetPaise,
          target_date: new Date(targetDate).toISOString(),
        });
        addToast('Savings goal updated successfully!', 'success');
      } else {
        await apiClient.post<SavingsGoal>('/goals', {
          name: name.trim(),
          target_amount_minor: targetPaise,
          target_date: new Date(targetDate).toISOString(),
          status: 'active',
        });
        addToast('Savings goal created successfully!', 'success');
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to save goal.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? 'Edit Savings Goal' : 'Add Savings Goal'}>
      <form onSubmit={handleSubmit} className="plan-modal-form">
        {error && <div className="plan-modal-error">{error}</div>}

        <FormField
          label="Goal Name"
          type="text"
          placeholder="e.g. Emergency Fund, New Laptop, Vacation"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <AmountInput valuePaise={targetPaise} onChangePaise={setTargetPaise} label="Target Savings Amount" />

        <FormField
          label="Target Completion Date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />

        <Button type="submit" variant="primary" fullWidth isLoading={isSubmitting}>
          {isEditing ? 'Save Changes' : 'Create Goal'}
        </Button>
      </form>
    </Modal>
  );
};
