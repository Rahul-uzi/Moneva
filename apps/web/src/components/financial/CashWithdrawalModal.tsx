import React, { useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AmountInput } from '../ui/AmountInput';
import { FormField } from '../ui/FormField';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { nowForDateTimeInput } from '../../utils/datetime';
import { formatMonetaryValue } from '../../utils/money';
import type { Account, Transaction } from '../../types/api';
import './CashWithdrawalModal.css';

interface Props {
  isOpen: boolean;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Taking cash out is not spending it.
 *
 * WHY THIS EXISTS AS ITS OWN SCREEN. A withdrawal was being recorded as an
 * expense, because expense was the only thing on offer. It is not one: the
 * money moved from a bank account into a pocket and the person is no poorer
 * for it. Recorded as an expense it drops net worth by the full amount, and
 * then drops it AGAIN when the cash is actually spent and that spend is
 * recorded. One real withdrawal understated a net worth by its full amount
 * and was waiting to do it a second time.
 *
 * The general transfer feature was deliberately removed from this app - it
 * confused more people than it served. This is not that coming back. It is
 * the one transfer an ordinary person makes constantly, named after what they
 * did rather than after what the ledger calls it, with both ends chosen for
 * them.
 */
export const CashWithdrawalModal: React.FC<Props> = ({ isOpen, accounts, onClose, onSuccess }) => {
  const addToast = useUiStore((s) => s.addToast);

  const [amountPaise, setAmountPaise] = useState<number>(0);
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [when, setWhen] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /** Anything that holds physical cash, by the name people give it. */
  const looksLikeCash = (a: Account) => /\b(cash|wallet|pocket|purse)\b/i.test(a.name);

  const active = accounts.filter((a) => a.is_active !== false && a.account_type === 'asset');
  const cashAccounts = active.filter(looksLikeCash);
  const bankAccounts = active.filter((a) => !looksLikeCash(a));

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setError(null);
      setAmountPaise(0);
      setWhen(nowForDateTimeInput());
      // The bank is almost always where it came from, and the cash account is
      // almost always where it went. Preselected so the common withdrawal is
      // an amount and a tap.
      setFromId(bankAccounts[0]?.id || active[0]?.id || '');
      setToId(cashAccounts[0]?.id || '');
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, accounts]);

  const noCashAccount = cashAccounts.length === 0;

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);

    if (amountPaise <= 0) return setError('Enter how much you took out.');
    if (!fromId) return setError('Choose the account it came out of.');
    if (!toId) return setError('Choose where the cash went.');
    if (fromId === toId) return setError('The money has to move between two different accounts.');

    setIsSaving(true);
    try {
      await apiClient.post<Transaction>('/transactions', {
        client_mutation_id: crypto.randomUUID(),
        account_id: fromId,
        to_account_id: toId,
        // A transfer, which is what it is. No category: a withdrawal is not
        // spending, so filing it under one would put it in a budget it does
        // not belong in.
        transaction_type: 'transfer',
        amount_minor: amountPaise,
        currency: 'INR',
        description: 'Cash withdrawal',
        transaction_date: when ? new Date(when).toISOString() : new Date().toISOString(),
        device_id: 'web-client',
      });
      addToast(
        `${formatMonetaryValue(amountPaise)} moved to cash. Your total is unchanged.`,
        'success',
      );
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Could not record that. Try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cash withdrawal">
      <p className="cw-lead">
        Moving money from a bank account into cash. This does <strong>not</strong> change
        your total &mdash; you still have it, just not in the bank. Record what you
        actually spend separately, as you spend it.
      </p>

      {noCashAccount ? (
        /* Without somewhere for the cash to land this cannot be a transfer,
           and quietly making it an expense instead is the bug this screen
           exists to prevent. So it stops and says what is missing. */
        <div className="cw-missing">
          <Banknote size={18} />
          <p>
            You have no cash account yet. Add one called <strong>Cash</strong> under
            your accounts, then come back &mdash; that is where the withdrawal lands.
          </p>
        </div>
      ) : (
        <form onSubmit={save} className="cw-form">
          {error && <div className="form-error-banner">{error}</div>}

          <AmountInput valuePaise={amountPaise} onChangePaise={setAmountPaise} label="How much you took out" />

          <div className="select-group">
            <label className="form-label" htmlFor="cw-from">Out of</label>
            <select id="cw-from" className="form-select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {active.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div className="select-group">
            <label className="form-label" htmlFor="cw-to">Into</label>
            <select id="cw-to" className="form-select" value={toId} onChange={(e) => setToId(e.target.value)}>
              {cashAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <FormField
            label="When"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />

          <div className="cw-actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Record withdrawal
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
