import React from 'react';
import { Arc } from '../ui/Arc';
import { Money } from '../ui/Money';
import { describePayday, type Payday } from '../../utils/payday';
import './PaydayCard.css';

/**
 * The countdown to the next salary.
 *
 * The app already spoke up when money was LATE and never when it was coming,
 * which meant the only news about your income was bad news. The arc fills as
 * the cycle runs down, so the shape carries the answer before the number does.
 */
export const PaydayCard: React.FC<{ payday: Payday }> = ({ payday }) => (
  <div className="payday-card" data-tour="payday">
    <Arc
      value={payday.progress}
      size={116}
      stroke={10}
      label={`${payday.source} arrives in ${describePayday(payday.daysAway).toLowerCase()}`}
    >
      <span className="payday-days">{payday.daysAway}</span>
      <span className="payday-unit">{payday.daysAway === 1 ? 'day' : 'days'}</span>
    </Arc>
    <div className="payday-copy">
      <span className="text-label">Next payday</span>
      <span className="heading-md">{describePayday(payday.daysAway)}</span>
      <span className="text-body text-xs text-muted">
        {payday.source} &middot; <Money amount={payday.amountMinor} hideMinor />
      </span>
    </div>
  </div>
);
