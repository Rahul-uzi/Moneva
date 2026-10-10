import React, { useId } from 'react';
import { ChevronRight } from 'lucide-react';
import './ProfileRows.css';

/* The grouped-list vocabulary of the Profile page: a labelled group, a row
   that opens something, and a row that is a switch. */

interface GroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsGroup: React.FC<GroupProps> = ({ label, children, className = '' }) => {
  const id = useId();
  return (
    <section className={`pf-group ${className}`} aria-labelledby={id}>
      <h2 className="pf-group-label" id={id}>{label}</h2>
      <div className="pf-list">{children}</div>
    </section>
  );
};

interface RowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  value?: React.ReactNode;
  valueTone?: 'on' | 'warn' | 'muted';
  tone?: 'warn' | 'danger';
  /** Makes the whole row a button with a chevron. */
  onClick?: () => void;
  /** A control at the end of the row (a button), instead of a chevron. */
  action?: React.ReactNode;
  /** A line under the row that spans its full width, e.g. a progress bar. */
  footer?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}

export const SettingsRow: React.FC<RowProps> = ({
  icon, title, sub, value, valueTone, tone, onClick, action, footer, disabled, ariaLabel,
}) => {
  const inner = (
    <>
      {icon && <span className="pf-ico" aria-hidden="true">{icon}</span>}
      <span className="pf-row-text">
        <span className="pf-row-title">{title}</span>
        {sub && <span className="pf-row-sub">{sub}</span>}
      </span>
      {value !== undefined && value !== null && (
        <span className={`pf-row-val${valueTone ? ` is-${valueTone}` : ''}`}>{value}</span>
      )}
      {action}
      {onClick && !action && <ChevronRight className="pf-chev" size={16} aria-hidden="true" />}
      {footer && <span className="pf-row-footer">{footer}</span>}
    </>
  );
  const cls = `pf-row${tone ? ` is-${tone}` : ''}${icon ? ' has-icon' : ''}`;
  if (onClick && !action) {
    return (
      <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
        {inner}
      </button>
    );
  }
  return <div className={`${cls} is-static`}>{inner}</div>;
};

interface SwitchRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export const SwitchRow: React.FC<SwitchRowProps> = ({ icon, title, sub, checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    className={`pf-row${icon ? ' has-icon' : ''}`}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    {icon && <span className="pf-ico" aria-hidden="true">{icon}</span>}
    <span className="pf-row-text">
      <span className="pf-row-title">{title}</span>
      {sub && <span className="pf-row-sub">{sub}</span>}
    </span>
    <span className="pf-switch" aria-hidden="true" />
  </button>
);
