import React from 'react';
import { CreditCard, CalendarClock, AlertTriangle, Layers } from 'lucide-react';
import { formatMonetaryValue } from '../../utils/money';
import {
  cardCycle, cardLedger, cycleTotals, limitUsedPercent, emiProgress, monthlyEmiLoad,
  type CardTerms,
} from '../../utils/cardCycle';
import type { Account, Emi, Transaction } from '../../types/api';
import './CardCycleSection.css';

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  emis: Emi[];
  currency: string;
  now: number;
  onAddEmi: () => void;
  onEditEmi: (emi: Emi) => void;
}

/** An account is a card when it has both billing days - see the Account type. */
export const isCard = (account: Account): boolean =>
  account.statement_day != null && account.due_day != null;

const termsOf = (account: Account): CardTerms => ({
  statementDay: account.statement_day as number,
  dueDay: account.due_day as number,
  creditLimitMinor: account.credit_limit_minor,
});

const onDay = (at: number): string =>
  new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * How long is left, in the terms a person actually thinks in.
 *
 * "in 5 days" is a decision; "8 Oct" is arithmetic the reader has to do first.
 * Late is stated plainly rather than in red-alert language - a payment can be
 * a day late for entirely ordinary reasons, and this screen is not the place
 * to panic somebody who already knows.
 */
const dueIn = (days: number): string => {
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${-days} days overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} days`;
};

/**
 * The ring: how much of the limit is gone.
 *
 * Colour carries the same fact as the number, for the glance rather than the
 * read - and the number is always there, so nothing is said by colour alone.
 */
const LimitRing: React.FC<{ percent: number }> = ({ percent }) => {
  // Clamped for the drawing only. A card over its limit shows a full ring and
  // the true figure beside it, rather than a ring that wraps back to nearly
  // empty and reads as plenty of room.
  const shown = Math.min(100, Math.max(0, percent));
  const state = percent >= 100 ? ' is-spent' : percent >= 75 ? ' is-tight' : '';
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      className={`cardcycle-ring${state}`}
      viewBox="0 0 56 56"
      role="img"
      aria-label={`${percent}% of the limit used`}
    >
      <circle className="cardcycle-ring-track" cx="28" cy="28" r={radius} />
      <circle
        className="cardcycle-ring-fill"
        cx="28" cy="28" r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown / 100)}
      />
      <text className="cardcycle-ring-text" x="28" y="28">{percent}%</text>
    </svg>
  );
};

/**
 * What a credit card is actually doing.
 *
 * A card is the one account where the balance answers nothing. What matters is
 * which purchases are on the statement that just closed, what is still owed on
 * it, and how many days are left - and none of that is visible in a list of
 * transactions. People miss due dates on cards they have the money to pay,
 * which is the most expensive avoidable mistake in personal finance.
 *
 * Instalment plans sit in the same place because they are the other half of
 * the same question: what is already committed before this month starts.
 */
export const CardCycleSection: React.FC<Props> = ({
  accounts, transactions, emis, currency, now, onAddEmi, onEditEmi,
}) => {
  const cards = accounts.filter(isCard);
  const runningPlans = emis.filter((e) => e.is_active);

  /* The instalments block stays even with nothing in it, because it is the
     only way to add the first plan - hiding it until a plan exists would make
     the feature unreachable. The cards block above genuinely has nothing to
     say without a card, so that one does hide. */

  const emiPlans = runningPlans.map((e) => ({
    emi: e,
    plan: {
      name: e.name,
      monthlyMinor: e.monthly_minor,
      months: e.months,
      startedAt: e.started_at,
    },
  }));
  const monthlyLoad = monthlyEmiLoad(emiPlans.map((p) => p.plan), now);

  return (
    <div className="cardcycle-section">
      {cards.length > 0 && (
        <>
          <div className="section-title-row">
            <h2 className="heading-md">Card cycles</h2>
          </div>

          <div className="cardcycle-list">
            {cards.map((account) => {
              const terms = termsOf(account);
              const cycle = cardCycle(terms, now);
              const totals = cycleTotals(cardLedger(transactions, account.id), cycle, terms);
              const used = limitUsedPercent(totals, terms);

              return (
                <div
                  key={account.id}
                  className={`cardcycle-card${cycle.isOverdue && totals.outstandingMinor > 0 ? ' is-overdue' : ''}`}
                >
                  <div className="cardcycle-head">
                    <span className="cardcycle-mark"><CreditCard size={17} /></span>
                    <div className="cardcycle-title">
                      <span className="cardcycle-name">{account.name}</span>
                      <span className="cardcycle-meta">
                        Closes {onDay(cycle.nextStatementAt)}
                        {' · '}
                        {cycle.daysUntilStatement === 1
                          ? '1 day of this cycle left'
                          : `${cycle.daysUntilStatement} days of this cycle left`}
                      </span>
                    </div>
                    {used !== null && <LimitRing percent={used} />}
                  </div>

                  {/* The two figures the card is FOR: what is owed on the
                      statement that closed, and when it has to be paid. */}
                  <div className="cardcycle-owed">
                    <div className="cardcycle-owed-figure">
                      <span className="text-label">Owed on statement</span>
                      <span className="number-md">
                        {formatMonetaryValue(totals.outstandingMinor, currency)}
                      </span>
                    </div>
                    <div className={`cardcycle-due${cycle.isOverdue && totals.outstandingMinor > 0 ? ' is-late' : ''}`}>
                      {cycle.isOverdue && totals.outstandingMinor > 0
                        ? <AlertTriangle size={14} />
                        : <CalendarClock size={14} />}
                      <span>
                        {totals.outstandingMinor === 0
                          ? `Nothing due · ${onDay(cycle.dueAt)}`
                          : `${dueIn(cycle.daysUntilDue)} · ${onDay(cycle.dueAt)}`}
                      </span>
                    </div>
                  </div>

                  <div className="cardcycle-breakdown">
                    <span>
                      Billed {formatMonetaryValue(totals.lastStatementMinor, currency)}
                    </span>
                    {totals.paidSinceStatementMinor > 0 && (
                      <span className="is-paid">
                        Paid {formatMonetaryValue(totals.paidSinceStatementMinor, currency)}
                      </span>
                    )}
                    {/* Not yet on any statement, so easy to forget it is
                        already spent. */}
                    <span>
                      Since then {formatMonetaryValue(totals.currentCycleMinor, currency)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="section-title-row cardcycle-emi-head">
        <h2 className="heading-md">Instalments</h2>
        <button type="button" className="cardcycle-add" onClick={onAddEmi}>
          Add a plan
        </button>
      </div>

      {emiPlans.length === 0 ? (
        <p className="cardcycle-empty">
          An EMI does not show up in a month&apos;s spending until the month it
          lands in. Adding one puts the whole commitment in front of you before
          you take the next.
        </p>
      ) : (
        <>
          <p className="cardcycle-load">
            <Layers size={13} />
            {formatMonetaryValue(monthlyLoad, currency)} a month is already committed
          </p>

          <div className="cardcycle-list">
            {emiPlans.map(({ emi, plan }) => {
              const progress = emiProgress(plan, now);
              const percent = Math.round((progress.paidCount / plan.months) * 100);
              return (
                <button
                  type="button"
                  key={emi.id}
                  className="cardcycle-emi"
                  onClick={() => onEditEmi(emi)}
                >
                  <div className="cardcycle-emi-top">
                    <span className="cardcycle-emi-name">{emi.name}</span>
                    <span className="cardcycle-emi-amount">
                      {formatMonetaryValue(plan.monthlyMinor, emi.currency || currency)}/mo
                    </span>
                  </div>

                  <div className="cardcycle-bar">
                    <span className="cardcycle-bar-fill" style={{ width: `${percent}%` }} />
                  </div>

                  <div className="cardcycle-emi-meta">
                    <span>{progress.paidCount} of {plan.months} paid</span>
                    {/* The figure that decides whether the next one is
                        affordable - what is still owed, not what it cost. */}
                    <span>
                      {progress.isFinished
                        ? `Finished ${onDay(progress.finishesAt)}`
                        : `${formatMonetaryValue(progress.remainingMinor, emi.currency || currency)} left · ends ${onDay(progress.finishesAt)}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
