import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Button } from './Button';
import { Illustration } from './Illustration';
import './States.css';

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No Data Found',
  description = 'There are no items recorded yet.',
  actionLabel,
  onAction,
}) => (
  <div className="state-container empty-state">
    <Illustration name="empty" />
    <h3 className="heading-sm">{title}</h3>
    <p className="text-body">{description}</p>
    {actionLabel && onAction && (
      <Button variant="secondary" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);

export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading financial data...' }) => (
  <div className="state-container loading-state" role="status">
    <div className="state-spinner" />
    <p className="text-body">{message}</p>
  </div>
);

/** Offline empty state - distinct from a genuine error so users aren't alarmed. */
export const OfflineState: React.FC<{ message?: string }> = ({
  message = 'You are offline. Showing the last data we saved on this device.',
}) => (
  <div className="state-container offline-state">
    <Illustration name="offline" />
    <h3 className="heading-sm">No connection</h3>
    <p className="text-body">{message}</p>
  </div>
);

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something Went Wrong',
  message = 'Failed to load data from backend API.',
  onRetry,
}) => (
  <div className="state-container error-state">
    <Illustration name="error" />
    <h3 className="heading-sm">{title}</h3>
    <p className="text-body">{message}</p>
    {onRetry && (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <RefreshCw size={14} /> Retry
      </Button>
    )}
  </div>
);

export const SuccessState: React.FC<{ title: string; description?: string }> = ({ title, description }) => (
  <div className="state-container success-state">
    <Illustration name="success" />
    <h3 className="heading-sm">{title}</h3>
    {description && <p className="text-body">{description}</p>}
  </div>
);

export const OfflineBanner: React.FC = () => (
  <div className="offline-banner">
    <WifiOff size={16} />
    <span>Working Offline — Changes will sync when online</span>
  </div>
);
