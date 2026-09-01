import React from 'react';
import { Plus } from 'lucide-react';
import './QuickActionButton.css';

interface QuickActionButtonProps {
  onClick: () => void;
}

export const QuickActionButton: React.FC<QuickActionButtonProps> = ({ onClick }) => {
  return (
    <button
      type="button"
      className="quick-action-btn"
      onClick={onClick}
      aria-label="Add Transaction"
    >
      <Plus size={24} />
    </button>
  );
};
