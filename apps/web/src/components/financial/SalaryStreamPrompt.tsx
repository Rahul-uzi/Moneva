import React, { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import { nextOccurrenceAfter, type IncomeLike, type SalaryMatch } from '../../utils/salaryMatch';
import './SalaryStreamPrompt.css';

interface Props {
  match: SalaryMatch | null;
  income: IncomeLike | null;
  onDone: () => void;
}

const dayMonth = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

/**
 * "Was that your salary?"
 *
 * The income is already recorded by the time this appears - the money is in
 * the ledger either way, and nothing here can lose it. The only question is
 * whether the payday countdown should move on.
 *
 * SO IT ASKS RATHER THAN ACTS. Guessing wrong in the yes direction skips a
 * month the user is still owed and stops the app ever reminding them; guessing
 * wrong in the no direction leaves a countdown they can fix in two taps. The
 * asymmetry is the whole reason this is a question.
 */
export const SalaryStreamPrompt: React.FC<Props> = ({ match, income, onDone }) => {
  const addToast = useUiStore((s) => s.addToast);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  if (!match || !income) return null;

  const { stream, amountChanged } = match;

  const confirm = async () => {
    setIsSaving(true);
    try {
      const next = nextOccurrenceAfter(income, stream);
      /* The DATE moves; the expected amount does not. A bonus month or a
         month with one-off arrears would otherwise rewrite what every future
         salary is expected to be, off a single tap. A real raise is a change
         the user makes once, deliberately, in the salary settings. */
      await apiClient.patch(`/income/recurring/${stream.id}`, { next_occurrence: next });
      addToast(`Marked as received. Next ${stream.source} on ${dayMonth(next)}.`, 'success');
    } catch {
      // The income itself is saved; only the countdown is still stale.
      addToast('Saved, but the payday countdown could not be moved.', 'error');
    } finally {
      setIsSaving(false);
      onDone();
    }
  };

  return (
    <Modal isOpen onClose={onDone} title="Was that your salary?">
      <div className="ssp-body">
        <div className="ssp-icon">
          <CalendarCheck size={28} />
        </div>

        <p className="text-body ssp-lead">
          This looks like <strong>{stream.source}</strong>, which was expected on{' '}
          {dayMonth(stream.next_occurrence)}.
        </p>

        <div className="ssp-figures">
          <div className="ssp-figure">
            <span className="ssp-figure-label">You recorded</span>
            <span className="ssp-figure-value">{formatMonetaryValue(income.amountPaise)}</span>
          </div>
          <div className="ssp-figure">
            <span className="ssp-figure-label">Usually</span>
            <span className="ssp-figure-value">{formatMonetaryValue(stream.amount_minor)}</span>
          </div>
        </div>

        {/* Said plainly, because a different figure is the one case where
            somebody might reasonably hesitate over the answer. */}
        {amountChanged && (
          <p className="text-body text-xs text-muted ssp-note">
            A different amount is fine &mdash; the countdown moves either way, and what
            you expect each month stays as it is.
          </p>
        )}

        <p className="text-body text-xs text-muted ssp-note">
          Say yes and your next payday moves to{' '}
          {dayMonth(nextOccurrenceAfter(income, stream))}. Say no and the countdown is
          left alone.
        </p>

        <div className="ssp-actions">
          <Button variant="secondary" onClick={onDone} disabled={isSaving}>
            No, it was something else
          </Button>
          <Button variant="primary" onClick={() => void confirm()} isLoading={isSaving}>
            Yes, that was my salary
          </Button>
        </div>
      </div>
    </Modal>
  );
};
