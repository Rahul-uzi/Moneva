import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BriefcaseBusiness, CalendarClock, Check, ChevronDown, Landmark, Repeat, Tag } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NumberPad, PadAmount } from '../ui/NumberPad';
import { MoneyFlow } from './MoneyFlow';
import { apiClient } from '../../services/apiClient';
import { nowForDateTimeInput } from '../../utils/datetime';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import { describeWhen } from '../../utils/quickAdd';
import { DEFAULT_SALARY_SOURCE, salaryAccountDefault, salaryStreamEffect } from '../../utils/moneySheets';
import { padToPaise, paiseToPad } from '../../utils/numberPad';
import type { Account, Category, Transaction, RecurringIncome } from '../../types/api';
import './QuickAddModal.css';
import './MoneySheets.css';

interface SalaryConfirmationModalProps {
  isOpen: boolean;
  recurringSalary?: RecurringIncome | null;
  accounts: Account[];
  categories: Category[];
  onClose: () => void;
  onSuccess: () => void;
}

type Panel = 'source' | 'account' | 'category' | 'when';

const dayMonth = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/**
 * Recording a salary that has arrived - and, by default, remembering it.
 *
 * THE DESIGN. Employer -> Bank is drawn as two circles, each the control for
 * its side. Saved salaries sit under the figure as one-tap amounts, the figure
 * is typed on MONEVA's own pad (no phone keyboard over the sheet), and one
 * switch says in a sentence what happens next month. Removing a schedule
 * lives in the Salary schedule sheet, not beside the Save button.
 */
export const SalaryConfirmationModal: React.FC<SalaryConfirmationModalProps> = ({
  isOpen,
  recurringSalary,
  accounts,
  categories,
  onClose,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [amount, setAmount] = useState<string>('');
  const [sourceName, setSourceName] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [txDate, setTxDate] = useState<string>('');
  const [dateTouched, setDateTouched] = useState<boolean>(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [shownPanel, setShownPanel] = useState<Panel | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  /*
   * TRUE in both places it is set - here and in the reset effect below.
   * Setting it only in the reset was not enough, and the device proved it: the
   * first open after launch showed the switch OFF and every open after it ON.
   * The reset runs inside a setTimeout(0) whose cleanup clears the timer, so on
   * a cold mount that one pass can be lost. State whose wrong value is
   * silently destructive must not depend on a deferred write.
   */
  const [isRecurring, setIsRecurring] = useState<boolean>(true);
  const [rules, setRules] = useState<RecurringIncome[]>([]);
  /**
   * Whether the user's salary schedules have actually arrived.
   *
   * Seen on a real phone: for the few seconds the request took, the sheet
   * believed there were NO schedules - it offered "Every month" and said
   * "we'll expect it again", and a Save in that window would have created a
   * second "Monthly Salary" beside the real one. Nothing about schedules is
   * decided until this is 'ready'.
   */
  const [rulesState, setRulesState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [confirmed, setConfirmed] = useState<{ tx: Transaction; next: string | null } | null>(null);

  // Reset only when the sheet opens. It used to depend on `accounts` and
  // `categories` too, and onSuccess refetches them - so a new array identity
  // re-ran it and wiped the receipt of a salary that had been recorded.
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const timer = setTimeout(() => {
      setConfirmed(null);
      setFormError(null);
      // ON by default. Off, the ordinary path recorded the payment and
      // remembered nothing: the home card kept offering to set up a salary
      // that had been set up several times, and the next payday prompted
      // nobody. The switch is right there to turn off for a one-off bonus.
      setIsRecurring(true);
      setAmount(recurringSalary ? paiseToPad(recurringSalary.amount_minor) : '');
      setSourceName(recurringSalary ? recurringSalary.source : '');
      setTxDate(nowForDateTimeInput());
      setDateTouched(false);
      setPanel(null);
      // A schedule list from an earlier opening may be stale; nothing is
      // decided from it until this opening's fetch has answered. Marked and
      // fetched in the same step, so a fast answer can never land BEFORE the
      // "loading" mark and leave the sheet stuck on "Checking…".
      setRulesState('loading');
      void (async () => {
        try {
          const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
          if (!active) return;
          setRules(res.data || []);
          setRulesState('ready');
        } catch {
          // A salary can still be recorded without the list; the schedule is
          // then left alone rather than guessed at.
          if (active) setRulesState('failed');
        }
      })();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [isOpen, recurringSalary]);

  /** Fetches the schedules; resolves to null when they could not be read. */
  const loadRules = async (): Promise<RecurringIncome[] | null> => {
    try {
      const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
      const list = res.data || [];
      setRules(list);
      setRulesState('ready');
      return list;
    } catch {
      setRulesState('failed');
      return null;
    }
  };


  const openAccounts = useMemo(() => accounts.filter((a) => a.is_active !== false), [accounts]);
  const incomeCategories = useMemo(() => categories.filter((c) => c.type === 'income'), [categories]);
  const activeRules = useMemo(() => rules.filter((r) => r.active !== false), [rules]);

  // Derived, so the defaults are right on the first render rather than after
  // an effect has caught up. A salary goes to the BANK by default, never to
  // whichever account happens to come first.
  const account = openAccounts.find((a) => a.id === accountId) ?? salaryAccountDefault(openAccounts);
  const category =
    incomeCategories.find((c) => c.id === categoryId) ??
    incomeCategories.find((c) => c.name.toLowerCase() === 'salary') ??
    incomeCategories[0];

  const amountPaise = padToPaise(amount);
  const effectiveSource = sourceName.trim() || DEFAULT_SALARY_SOURCE;
  const existing = activeRules.find(
    (r) => r.source.trim().toLowerCase() === effectiveSource.toLowerCase(),
  );
  const received = txDate ? new Date(txDate) : new Date();
  const effect = salaryStreamEffect(received, amountPaise, existing);

  /* What happens to next month, in one short line - shown right under the
     figure, where the eye already is. It sat in a card below the pad, and on
     a phone the pinned Save button covered it: the one sentence that says
     whether a payday moves was the one nobody saw. */
  const repeatLine =
    rulesState === 'loading'
      ? 'Checking your salary schedule…'
      : rulesState === 'failed'
        ? 'Could not check your salary schedule — it will be left as it is'
        : effect.action === 'advance'
      ? `Next payday moves to ${dayMonth(effect.next)}`
      : effect.action === 'keep'
        ? `${existing!.source} is still due ${dayMonth(effect.next)} — this one is extra`
        : isRecurring
          ? `We'll expect it again around ${dayMonth(effect.next)}`
          : 'Just this once — no reminder next month';

  const togglePanel = (next: Panel) => {
    setShownPanel(next);
    setPanel((cur) => (cur === next ? null : next));
  };

  const pickStream = (r: RecurringIncome) => {
    setSourceName(r.source);
    setAmount(paiseToPad(r.amount_minor));
    setPanel(null);
  };

  if (!isOpen) return null;

  const handleConfirmSalary = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setFormError(null);

    if (amountPaise <= 0) {
      setFormError('Enter the salary you received.');
      return;
    }
    if (!account) {
      setFormError('Add an account for your salary to go into.');
      return;
    }

    setIsSubmitting(true);
    try {
      /* Decide about the schedule from the REAL list. If it has not arrived,
         wait for it; if it cannot be read, record the salary and leave every
         schedule exactly where it is - a duplicate "Monthly Salary" is worse
         than a schedule that needs one manual nudge. */
      let list: RecurringIncome[] | null = rulesState === 'ready' ? rules : await loadRules();
      if (list) list = list.filter((r) => r.active !== false);
      const realExisting = list?.find(
        (r) => r.source.trim().toLowerCase() === effectiveSource.toLowerCase(),
      );
      const realEffect = list ? salaryStreamEffect(received, amountPaise, realExisting) : null;

      const res = await apiClient.post<Transaction>('/transactions', {
        client_mutation_id: crypto.randomUUID(),
        account_id: account.id,
        category_id: category?.id ?? null,
        transaction_type: 'income',
        amount_minor: amountPaise,
        currency: 'INR',
        description: `Salary Received: ${effectiveSource}`,
        transaction_date: received.toISOString(),
        device_id: 'web-client',
      });

      /* The switch decides whether a stream is CREATED. It does not decide
         whether an existing one is ADVANCED - a salary recorded while its
         stream still said "expected tomorrow" left the home screen counting
         down to a payday that had already happened. Whether this payment IS
         the one the stream was waiting for is decided by the date alone (see
         salaryStreamEffect): close to the due date it moves the stream on;
         weeks before it, it leaves the stream exactly where it is. */
      let next: string | null = realEffect?.action === 'keep' ? realEffect.next : null;
      if (!realEffect) {
        addToast('Salary saved. Your salary schedule could not be checked, so it was left as it is.', 'info');
      } else if (realEffect.action === 'advance' || (realEffect.action === 'create' && isRecurring)) {
        try {
          if (realEffect.action === 'advance') {
            await apiClient.patch(`/income/recurring/${realExisting!.id}`, {
              amount_minor: amountPaise,
              next_occurrence: realEffect.next,
            });
          } else {
            await apiClient.post('/income/recurring', {
              source: effectiveSource,
              amount_minor: amountPaise,
              frequency: 'monthly',
              next_occurrence: realEffect.next,
              anchor_day: new Date(realEffect.next).getDate(),
            });
          }
          next = realEffect.next;
        } catch {
          addToast('Salary saved, but next month could not be scheduled.', 'error');
        }
      }

      setConfirmed({ tx: res.data, next });
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Could not save that salary. Try again in a moment.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={confirmed ? 'Salary saved' : 'Add salary'}>
      {confirmed ? (
        <div className="qa ms-done" data-type="income">
          <div className="ms-done-ring">
            <Check size={30} />
          </div>
          <span className="ms-done-amount">+{formatMonetaryValue(confirmed.tx.amount_minor)}</span>
          <p className="ms-done-sub">
            {confirmed.next
              ? `Added to your balance. Next payday: ${dayMonth(confirmed.next)}.`
              : 'Added to your balance.'}
          </p>
          <div className="ms-actions">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                navigate('/plan');
              }}
            >
              Plan it <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleConfirmSalary} className="qa ms" data-type="income" noValidate>
          <MoneyFlow
            moving={amountPaise > 0}
            from={{
              caption: 'From',
              label: sourceName.trim() || 'Who paid?',
              icon: <BriefcaseBusiness size={22} />,
              onClick: () => togglePanel('source'),
              expanded: panel === 'source',
              controls: 'sal-pick',
            }}
            to={{
              caption: 'To',
              label: account?.name ?? 'Account',
              icon: <Landmark size={22} />,
              tone: 'accent',
              onClick: openAccounts.length > 1 ? () => togglePanel('account') : undefined,
              expanded: panel === 'account',
              controls: 'sal-pick',
            }}
          />

          <div id="sal-pick" className="qa-drawer" data-open={panel !== null} inert={panel === null} aria-hidden={panel === null}>
            <div className="qa-drawer-inner">
              {shownPanel === 'source' && (
                <div className="ms-pick">
                  <div className="qa-payee">
                    <label className="qa-payee-label" htmlFor="sal-source">From</label>
                    <input
                      id="sal-source"
                      className="qa-payee-input"
                      type="text"
                      autoComplete="off"
                      autoCapitalize="words"
                      enterKeyHint="done"
                      placeholder="Who paid you"
                      value={sourceName}
                      onChange={(e) => setSourceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setPanel(null);
                        }
                      }}
                    />
                  </div>
                </div>
              )}
              {shownPanel === 'account' && (
                <div className="ms-pick">
                  <p className="ms-pick-title" id="sal-acc">Paid into</p>
                  <div className="qa-chip-wrap" role="radiogroup" aria-labelledby="sal-acc">
                    {openAccounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={a.id === account?.id}
                        className={`qa-chip ${a.id === account?.id ? 'is-selected' : ''}`}
                        onClick={() => {
                          setAccountId(a.id);
                          setPanel(null);
                        }}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {shownPanel === 'category' && (
                <div className="ms-pick">
                  <p className="ms-pick-title" id="sal-cat">Category</p>
                  <div className="qa-chip-wrap" role="radiogroup" aria-labelledby="sal-cat">
                    {incomeCategories.map((c) => {
                      const selected = c.id === category?.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`qa-chip ${selected ? 'is-selected' : ''}`}
                          style={c.color ? ({ '--qa-dot': c.color } as React.CSSProperties) : undefined}
                          onClick={() => {
                            setCategoryId(c.id);
                            setPanel(null);
                          }}
                        >
                          <span className="qa-chip-dot" aria-hidden="true" />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {shownPanel === 'when' && (
                <div className="qa-when">
                  <div className="qa-chip-wrap">
                    <button
                      type="button"
                      className={`qa-chip ${!dateTouched ? 'is-selected' : ''}`}
                      onClick={() => {
                        setTxDate(nowForDateTimeInput());
                        setDateTouched(false);
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
                        setTxDate(nowForDateTimeInput(d));
                        setDateTouched(true);
                      }}
                    >
                      Yesterday
                    </button>
                  </div>
                  <input
                    className="qa-field"
                    type="datetime-local"
                    aria-label="Date and time received"
                    value={txDate}
                    onChange={(e) => {
                      setTxDate(e.target.value);
                      setDateTouched(true);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <PadAmount value={amount} label="Salary received" note={repeatLine} />

          {activeRules.length > 0 && (
            <div className="ms-quick" role="group" aria-label="Your salaries">
              {activeRules.map((r) => {
                const selected =
                  r.source.trim().toLowerCase() === effectiveSource.toLowerCase() && amountPaise === r.amount_minor;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={selected}
                    className={`qa-chip ${selected ? 'is-selected' : ''}`}
                    onClick={() => pickStream(r)}
                  >
                    {formatMonetaryValue(r.amount_minor).replace(/\.00$/, '')}
                    <span className="ms-quick-sub">{r.source}</span>
                  </button>
                );
              })}
            </div>
          )}

          <NumberPad value={amount} onChange={setAmount} listenToKeyboard={isOpen && panel !== 'source'} />

          <div className="ms-footer">
            {incomeCategories.length > 0 && (
              <button
                type="button"
                className={`qa-pill ${panel === 'category' ? 'is-open' : ''}`}
                aria-expanded={panel === 'category'}
                aria-controls="sal-pick"
                onClick={() => togglePanel('category')}
              >
                <Tag size={14} aria-hidden="true" />
                <span className="qa-pill-text">{category?.name ?? 'Category'}</span>
                <ChevronDown size={14} className="qa-pill-chevron" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className={`qa-pill qa-pill-when ${panel === 'when' ? 'is-open' : ''}`}
              aria-expanded={panel === 'when'}
              aria-controls="sal-pick"
              onClick={() => togglePanel('when')}
            >
              <CalendarClock size={14} aria-hidden="true" />
              <span className="qa-pill-text">{describeWhen(txDate, dateTouched)}</span>
              <ChevronDown size={14} className="qa-pill-chevron" aria-hidden="true" />
            </button>
            {/* With a stream already in place there is nothing to switch - it
                moves on (or stays) by its date, and the line under the figure
                says which - so the control only appears when it decides
                something: whether to START a monthly schedule. */}
            {!existing && rulesState === 'ready' && (
              <button
                type="button"
                role="switch"
                aria-checked={isRecurring}
                className={`qa-pill ms-repeat-pill ${isRecurring ? 'has-value' : ''}`}
                onClick={() => setIsRecurring((v) => !v)}
              >
                <Repeat size={14} aria-hidden="true" />
                <span className="qa-pill-text">Every month</span>
                <span className="ms-toggle is-small" aria-hidden="true" />
              </button>
            )}
          </div>

          {formError && (
            <div className="qa-error" role="alert" key={formError}>
              {formError}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            className="qa-save"
            isLoading={isSubmitting}
            disabled={openAccounts.length === 0}
          >
            {amountPaise > 0 ? `Save salary · ${formatMonetaryValue(amountPaise)}` : 'Save salary'}
          </Button>
        </form>
      )}
    </Modal>
  );
};
