import React from 'react';
import './IconButton.css';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  ariaLabel: string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  variant = 'secondary',
  size = 'md',
  ariaLabel,
  className = '',
  ...props
}) => {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`moneva-icon-btn icon-btn-${variant} icon-btn-${size} ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};
