import React from 'react';
import './Card.css';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'surface' | 'gradient' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
  /**
   * Make a tappable card a real button: focusable, opened with Enter or Space,
   * announced as a button. Only for cards with NO controls inside - a button
   * cannot contain buttons, and screen readers hide anything nested in one.
   */
  asButton?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'surface',
  padding = 'md',
  interactive = false,
  asButton = false,
  className = '',
  onClick,
  onKeyDown,
  ...props
}) => {
  /* A card you can tap is a button to a keyboard and a screen reader too.
     It was a plain div with onClick: no role, no focus, no Enter - so an
     account's details could not be opened without a pointer at all. Only the
     card's own key presses count. Opt-in (asButton), because cards that hold
     their own buttons - a bill's Pay, a goal's Contribute - must not be one. */
  const buttonProps = asButton && onClick
    ? {
        role: 'button',
        tabIndex: props.tabIndex ?? 0,
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
          onKeyDown?.(e);
          if (e.defaultPrevented || e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
          }
        },
      }
    : { onKeyDown };

  return (
    <div
      className={`moneva-card card-${variant} card-pad-${padding} ${interactive ? 'card-interactive' : ''} ${className}`}
      onClick={onClick}
      {...props}
      {...buttonProps}
    >
      {children}
    </div>
  );
};
