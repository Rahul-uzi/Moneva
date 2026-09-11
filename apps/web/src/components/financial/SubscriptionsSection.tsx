import React from 'react';
import { RefreshCw, TrendingUp, PauseCircle } from 'lucide-react';
import { BrandMark } from '../ui/BrandMark';
import { brandNameIn } from '../../utils/brandMark';
import { formatMonetaryValue } from '../../utils/money';
import { isLapsed, type Subscription } from '../../utils/subscriptions';
import './SubscriptionsSection.css';

interface Props {
  subscriptions: Subscription[];
  currency: string;
  now: number;
}

const DAY = 86_400_000;

/**
 * When the next one is due, in the terms a person actually thinks in.
 *
 * A date is worse than a distance here: "in 3 days" is a decision, whereas
 * "24 Sept" is arithmetic the reader has to do. Past due is stated flatly
 * rather than alarmingly - a charge can be a day late for entirely ordinary
 * reasons.
 */
const dueIn = (nextExpected: number, now: number): string => {
  const days = Math.round((nextExpected - now) / DAY);
  if (days < -1) return `was due ${Math.abs(days)} days ago`;
  if (days <= 0) return 'due about now';
  if (days === 1) return 'due tomorrow';
  if (days <= 31) return `due in ${days} days`;
  return `due in about ${Math.round(days / 30)} months`;
};

const CADENCE_WORD: Record<Subscription['cadence'], string> = {
  weekly: 'Every week',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

/**
 * Things that leave on a rhythm.
 *
 * Read-only on purpose. These are not records the user created, they are a
 * reading of their own history, and offering an Edit button on a guess would
 * suggest the app knows more than it does. What it can honestly offer is the
 * number that prompts a decision - what this costs over a year - and the two
 * facts that are easy to miss: the price went up, or it has stopped.
 */
export const SubscriptionsSection: React.FC<Props> = ({ subscriptions, currency, now }) => {
  if (subscriptions.length === 0) return null;

  const yearlyTotal = subscriptions
    .filter((s) => !isLapsed(s, now))
    .reduce((sum, s) => sum + s.yearlyMinor, 0);

  return (
    <div className="plan-section">
      <div className="section-title-row">
        <h2 className="heading-md">Repeating payments</h2>
        <span className="text-label">
          {formatMonetaryValue(yearlyTotal, currency)} a year
        </span>
      </div>

      <p className="subs-intro">
        Found by looking at what you have already paid - three or more charges
        on the same rhythm. Nothing here was set up by you, so check it before
        trusting the total.
      </p>

      <div className="subs-list">
        {subscriptions.map((sub) => {
          const lapsed = isLapsed(sub, now);
          return (
            <div
              key={sub.name + sub.firstSeen}
              className={`subs-row${lapsed ? ' is-lapsed' : ''}`}
            >
              {brandNameIn(sub.name)
                ? <BrandMark name={sub.name} size={38} className="subs-mark" />
                : <span className="subs-mark subs-mark-fallback"><RefreshCw size={17} /></span>}

              <div className="subs-info">
                <span className="subs-name">{sub.name}</span>
                <span className="subs-meta">
                  {CADENCE_WORD[sub.cadence]}
                  {' · '}
                  {sub.payments.length} payments
                  {lapsed ? ' · stopped' : ` · ${dueIn(sub.nextExpected, now)}`}
                </span>

                {sub.priceRise && (
                  <span className="subs-flag is-rise">
                    <TrendingUp size={13} />
                    Went up {sub.priceRise.percent}% - was{' '}
                    {formatMonetaryValue(sub.priceRise.fromMinor, currency)}
                  </span>
                )}

                {lapsed && (
                  <span className="subs-flag is-lapsed-flag">
                    <PauseCircle size={13} />
                    Nothing since{' '}
                    {new Date(sub.lastSeen).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short',
                    })}
                    {' - cancelled, or a payment failed'}
                  </span>
                )}
              </div>

              <div className="subs-amounts">
                <span className="subs-amount">
                  {formatMonetaryValue(sub.amountMinor, currency)}
                </span>
                {/* The figure that prompts a decision. A monthly charge reads
                    as small; the same charge over a year rarely does. */}
                <span className="subs-yearly">
                  {formatMonetaryValue(sub.yearlyMinor, currency)}/yr
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
