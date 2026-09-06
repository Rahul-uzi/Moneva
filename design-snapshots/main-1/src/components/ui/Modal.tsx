import React from 'react';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { useScrollLock } from './useScrollLock';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  // Hook must run before the early return.
  useScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="heading-sm">{title}</h3>
          <IconButton icon={<X size={18} />} ariaLabel="Close modal" variant="ghost" size="md" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
};
