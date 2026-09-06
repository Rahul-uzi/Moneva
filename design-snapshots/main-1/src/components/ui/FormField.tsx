import React from 'react';
import './FormField.css';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, className = '', ...props }, ref) => {
    return (
      <div className="moneva-form-field">
        <label className="form-label">{label}</label>
        <input ref={ref} className={`form-input ${error ? 'input-error' : ''} ${className}`} {...props} />
        {error && <span className="error-message">{error}</span>}
      </div>
    );
  }
);

FormField.displayName = 'FormField';
