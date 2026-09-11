import React from 'react';
import { WifiOff, RefreshCw, Clock } from 'lucide-react';
import { Button } from './Button';
import { Illustration } from './Illustration';
import type { IllustrationName } from './Illustration';
import { describeAge } from '../../services/lastKnownGood';
import './States.css';

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Which drawing to show. Every empty state in the app used to render the
   * same wallet, whether it was about transactions, budgets or notifications;
   * naming the subject is the whole point of having a set.
   */
  art?: IllustrationName;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No Data Found',
  description = 'There are no items recorded yet.',
  actionLabel,
  onAction,
  art = 'ledger',
}) => (
  <div className="state-container empty-state">
    <Illustration name={art} />
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

/**
 * Offline, with nothing saved to fall back on.
 *
 * This used to say "showing the last data we saved on this device" in every
 * case, and nothing was ever saved - the functions to do it existed with no
 * callers. It was the app claiming to hold something it did not.
 *
 * Now saved figures ARE kept, and when they exist the screen shows them with
 * `SavedDataBanner` rather than this. So this state is what remains: offline
 * with genuinely nothing to show, which is the one case where there is nothing
 * to be done but say so.
 */
export const OfflineState: React.FC<{ message?: string }> = ({
  message = 'You are offline, and this screen has nothing saved on this device yet. It will fill in once you are back online.',
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

/**
 * Offline, said plainly.
 *
 * The old wording promised "changes will sync when online". Nothing queues a
 * write and nothing syncs one - `enqueueOperation` has never had a caller - so
 * anyone who believed that sentence and carried on typing would have lost what
 * they entered. Saying less is the fix until the queue is real.
 */
export const OfflineBanner: React.FC = () => (
  <div className="offline-banner">
    <WifiOff size={16} />
    <span>No connection — you can look, but not save</span>
  </div>
);

/**
 * "These are your figures from earlier, and here is how much earlier."
 *
 * Shown when a screen is rendering saved data because the server did not
 * answer - almost always a cold start on a sleeping free-tier service, which
 * takes up to 43 seconds to wake.
 *
 * The age is the whole point and is never rounded away. Someone reading a
 * balance has to know whether it is a minute old or a day old, because those
 * two lead to different decisions, and a banner that said only "saved data"
 * would leave them guessing at exactly the moment it matters.
 */
export const SavedDataBanner: React.FC<{ savedAt: number; onRetry?: () => void }> = ({
  savedAt,
  onRetry,
}) => (
  <div className="saved-data-banner" role="status">
    <Clock size={14} />
    <span>Showing your figures from {describeAge(savedAt)}</span>
    {onRetry && (
      <button type="button" className="saved-data-refresh" onClick={onRetry}>
        Refresh
      </button>
    )}
  </div>
);
