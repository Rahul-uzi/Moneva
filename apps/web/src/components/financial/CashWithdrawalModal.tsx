import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarClock, ChevronDown, CreditCard, Landmark, Plus, Wallet } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NumberPad, PadAmount } from '../ui/NumberPad';
import { MoneyFlow } from './MoneyFlow';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { nowForDateTimeInput } from '../../utils/datetime';
import { formatMonetaryValue } from '../../utils/money';
import { describeWhen } from '../../utils/quickAdd';
import { cashAccountsOf, withdrawalSources } from '../../utils/moneySheets';
import { padToPaise, paiseToPad } from '../../utils/numberPad';
import type { Account, Transaction } from '../../types/api';
import './QuickAddModal.css';
import './MoneySheets.css';

interface Props {
  isOpen: boolean;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}

/** The notes an ATM actually hands out, as one-tap amounts - four, so they
 *  sit in one even row on a phone instead of leaving one alone on a second. */
const QUICK_AMOUNTS = [50000, 100000, 200000, 500000];

type Panel = 'from' | 'to' | 'when';

/**
 * Taking cash out is not spending it.
 *
 * WHY THIS EXISTS AS ITS OWN SCREEN. A withdrawal was being recorded as an
 * expense, because expense was the only thing on offer. It is not one: the
 * money moved from a bank account into a pocket and the person is no poorer
 * for it. Recorded as an expense it drops net worth by the full amount, and
 * then drops it AGAIN when the cash is actually spent.
 *
 * THE DESIGN. Bank -> Cash is drawn, not described, and each circle is the
 * control for that side. "From" offers only banks and cards: it used to list
 * every account, so it could read "Cash", and cash into cash is not a
 * withdrawal. The amount is typed on MONEVA's own pad, so the phone keyboard
 * never covers the sheet, and the notes an ATM gives are one tap each.
 */
export const CashWithdrawalModal: React.FC<Props> = ({ isOpen, accounts, onClose, onSuccess }) => {
  const addToast = useUiStore((s) => s.addToast);

  const [amount, setAmount] = useState<string>('');
  const [fromId, setFromId] = useState<string>('');
  const [toId, setToId] = useState<string>('');
  const [when, setWhen] = useState<string>('');
  const [whenTouched, setWhenTouched] = useState<boolean>(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [shownPanel, setShownPanel] = useState<Panel | null>(null);
  /** A cash account made from this sheet, before the parent has refetched. */
  const [madeCash, setMadeCash] = useState<Account | null>(null);
  const [isMakingCash, setIsMakingCash] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setError(null);
      setAmount('');
      setWhen(nowForDateTimeInput());
      setWhenTouched(false);
      setPanel(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const pool = useMemo(() => {
    const open = accounts.filter((a) => a.is_active !== false);
    return madeCash && !open.some((a) => a.id === madeCash.id) ? [...open, madeCash] : open;
  }, [accounts, madeCash]);

  const sources = useMemo(() => withdrawalSources(pool), [pool]);
  const cashAccounts = useMemo(() => cashAccountsOf(pool), [pool]);

  /* The selection is DERIVED, not copied into state by an effect. The old
     sheet set its default after the accounts arrived, and until that ran the
     dropdown showed whichever account came first - which could be Cash. A
     derived value is right on the very first render. */
  const from = sources.find((a) => a.id === fromId) ?? sources[0];
  const into = cashAccounts.find((a) => a.id === toId) ?? cashAccounts[0];

  const amountPaise = padToPaise(amount);
  const balance = from?.balance_paise;
  const after = balance != null && from?.account_type === 'asset' ? balance - amountPaise : null;

  const togglePanel = (next: Panel) => {
    setShownPanel(next);
    setPanel((cur) => (cur === next ? null : next));
  };

  const makeCashAccount = async () => {
    setIsMakingCash(true);
    setError(null);
    try {
      const res = await apiClient.post<Account>('/accounts', {
        name: 'Cash',
        account_type: 'asset',
        opening_balance_minor: 0,
      });
      setMadeCash(res.data);
      setToId(res.data.id);
      setPanel(null);
      addToast('Cash account added.', 'success');
    } catch {
      setError('Could not add a cash account just now.');
    } finally {
      setIsMakingCash(false);
    }
  };

  const save = async (ev?: React.FormEvent) => {
    ev?.preventDefault();
    setError(null);

    if (amountPaise <= 0) return setError('Enter how much you took out.');
    if (!from) return setError('Add the bank account it came out of first.');
    if (!into) return setError('Add a cash account for it to go into.');

    setIsSaving(true);
    try {
      await apiClient.post<Transaction>('/transactions', {
        client_mutation_id: crypto.randomUUID(),
        account_id: from.id,
        to_account_id: into.id,
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
      addToast(`${formatMonetaryValue(amountPaise)} moved to cash. Your total is unchanged.`, 'success');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Could not record that. Try again in a moment.');
    } finally {
      setIsSaving(false);
    }
  };

  const over = after != null && after < 0 && amountPaise > 0;
  const note =
    after != null && amountPaise > 0
      ? over
        ? `More than the ${formatMonetaryValue(balance!)} in ${from!.name}`
        : `${formatMonetaryValue(after)} left in ${from!.name}`
      : 'Your total stays the same — it just moves';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Cash withdrawal">
      <form className="qa ms" data-type="transfer" onSubmit={save} noValidate>
        {sources.length === 0 ? (
          <div className="ms-notice">
            <Landmark size={20} aria-hidden="true" />
            <span>Add the bank account you took it out of first &mdash; under Accounts.</span>
          </div>
        ) : (
          <MoneyFlow
            moving={amountPaise > 0}
            from={{
              caption: 'From',
              label: from?.name ?? 'Bank',
              icon: from?.account_type === 'liability' ? <CreditCard size={22} /> : <Landmark size={22} />,
              onClick: sources.length > 1 ? () => togglePanel('from') : undefined,
              expanded: panel === 'from',
              controls: 'cw-pick',
            }}
            to={{
              caption: 'To',
              label: into?.name ?? 'Add cash',
              icon: <Wallet size={22} />,
              tone: 'accent',
              onClick: () => togglePanel('to'),
              expanded: panel === 'to',
              controls: 'cw-pick',
            }}
          />
        )}

        <div id="cw-pick" className="qa-drawer" data-open={panel !== null} inert={panel === null} aria-hidden={panel === null}>
          <div className="qa-drawer-inner">
            {shownPanel === 'from' && (
              <div className="ms-pick">
                <p className="ms-pick-title" id="cw-out">Take it out of</p>
                <div className="qa-chip-wrap" role="radiogroup" aria-labelledby="cw-out">
                  {sources.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === from?.id}
                      className={`qa-chip ${a.id === from?.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setFromId(a.id);
                        setPanel(null);
                      }}
                    >
                      {a.account_type === 'liability'
                        ? <CreditCard size={14} aria-hidden="true" />
                        : <Landmark size={14} aria-hidden="true" />}
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {shownPanel === 'to' && (
              <div className="ms-pick">
                <p className="ms-pick-title" id="cw-into">Put it into</p>
                <div className="qa-chip-wrap" role="radiogroup" aria-labelledby="cw-into">
                  {cashAccounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === into?.id}
                      className={`qa-chip ${a.id === into?.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setToId(a.id);
                        setPanel(null);
                      }}
                    >
                      <Wallet size={14} aria-hidden="true" />
                      {a.name}
                    </button>
                  ))}
                  {/* Without somewhere for the cash to land this cannot be a
                      transfer - and quietly making it an expense instead is
                      the bug this screen exists to prevent. */}
                  <button
                    type="button"
                    className="qa-chip qa-chip-add"
                    onClick={() => void makeCashAccount()}
                    disabled={isMakingCash}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {isMakingCash ? 'Adding…' : 'New cash account'}
                  </button>
                </div>
              </div>
            )}
            {shownPanel === 'when' && (
              <div className="qa-when">
                <div className="qa-chip-wrap">
                  <button
                    type="button"
                    className={`qa-chip ${!whenTouched ? 'is-selected' : ''}`}
                    onClick={() => {
                      setWhen(nowForDateTimeInput());
                      setWhenTouched(false);
                      setPanel(null);
                    }}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    className="qa-chip"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() - 1);
                      setWhen(nowForDateTimeInput(d));
                      setWhenTouched(true);
                    }}
                  >
                    Yesterday
                  </button>
                </div>
                <input
                  className="qa-field"
                  type="datetime-local"
                  aria-label="Date and time"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    setWhenTouched(true);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <PadAmount value={amount} label="Amount taken out" note={note} noteTone={over ? 'warn' : 'normal'} />

        <div className="ms-quick is-even" role="group" aria-label="Quick amounts">
          {QUICK_AMOUNTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`qa-chip ${amountPaise === p ? 'is-selected' : ''}`}
              onClick={() => setAmount(paiseToPad(p))}
            >
              {formatMonetaryValue(p).replace(/\.00$/, '')}
            </button>
          ))}
        </div>

        <NumberPad value={amount} onChange={setAmount} listenToKeyboard={isOpen} />

        <div className="ms-footer">
          <button
            type="button"
            className={`qa-pill qa-pill-when ${panel === 'when' ? 'is-open' : ''}`}
            aria-expanded={panel === 'when'}
            aria-controls="cw-pick"
            onClick={() => togglePanel('when')}
          >
            <CalendarClock size={14} aria-hidden="true" />
            <span className="qa-pill-text">{describeWhen(when, whenTouched)}</span>
            <ChevronDown size={14} className="qa-pill-chevron" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="qa-error" role="alert" key={error}>
            {error}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          className="qa-save"
          isLoading={isSaving}
          disabled={!from || !into}
        >
          <Banknote size={16} aria-hidden="true" />
          {amountPaise > 0 ? `Withdraw ${formatMonetaryValue(amountPaise)}` : 'Withdraw'}
        </Button>
      </form>
    </Modal>
  );
};
