import React, { useState } from 'react';
import { HandCoins } from 'lucide-react';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import type { PersonDebt } from '../../types/api';
import './OwedCard.css';

interface Props {
  debts: PersonDebt[];
  onResolved: () => void;
}

/**
 * Who still has your money.
 *
 * WHY IT IS ON THE HOME SCREEN. The assistant can be told about a loan and
 * asked about it later, but a record only reachable by typing the right
 * question is not a record - a wrong one could never be found, and a right
 * one is forgotten the moment the user stops thinking to ask. This is the
 * part that does the actual remembering.
 *
 * IT CHANGES NO MONEY AND SAYS SO. The rupees left the bank when they were
 * lent and the ledger recorded that already; counting them here as well
 * would answer "how much do I have" twice, differently. Marking one paid
 * back closes the reminder - the money arriving is recorded like any other
 * income, because that is what it is.
 */
export const OwedCard: React.FC<Props> = ({ debts, onResolved }) => {
  const addToast = useUiStore((s) => s.addToast);
  const [busyId, setBusyId] = useState<string | null>(null);

  const owedToMe = debts.filter((d) => d.direction !== 'i_owe' && d.outstanding_minor > 0);
  const iOwe = debts.filter((d) => d.direction === 'i_owe' && d.outstanding_minor > 0);
  if (owedToMe.length === 0 && iOwe.length === 0) return null;

  const total = (rows: PersonDebt[]) =>
    rows.reduce((sum, d) => sum + d.outstanding_minor, 0);

  const settle = async (debt: PersonDebt) => {
    setBusyId(debt.id);
    try {
      await apiClient.post(`/debts/${debt.id}/repay`, {});
      addToast(`Settled with ${debt.person}.`, 'success');
      onResolved();
    } catch {
      addToast('Could not settle that just now.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const section = (title: string, rows: PersonDebt[], verb: string) => {
    if (rows.length === 0) return null;
    return (
      <div className="owed-section">
        <div className="owed-section-head">
          <span className="owed-section-title">{title}</span>
          <span className="owed-section-total">{formatMonetaryValue(total(rows))}</span>
        </div>
        <ul className="owed-list">
          {rows.map((d) => (
            <li key={d.id} className="owed-row">
              <div className="owed-who">
                <span className="owed-name">{d.person}</span>
                {d.note && <span className="owed-note">{d.note}</span>}
              </div>
              <span className="owed-amount">{formatMonetaryValue(d.outstanding_minor)}</span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void settle(d)}
                isLoading={busyId === d.id}
              >
                {verb}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="owed-card">
      <div className="owed-head">
        <HandCoins size={16} />
        <span className="owed-title">Money between people</span>
      </div>

      {section('Owed to you', owedToMe, 'Got it back')}
      {section('You owe', iOwe, 'Paid back')}

      <p className="owed-foot">
        Reminders only &mdash; these are not part of your balance.
      </p>
    </div>
  );
};
