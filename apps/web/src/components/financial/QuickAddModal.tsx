import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banknote,
  CalendarClock,
  ChevronDown,
  Clock3,
  Landmark,
  NotebookPen,
  Plus,
  Repeat,
  Sparkles,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { AmountInput } from '../ui/AmountInput';
import { Button } from '../ui/Button';
import { AccountModal } from './AccountModal';
import { ExpenseSuccessModal } from './ExpenseSuccessModal';
import { SalaryConfirmationModal } from './SalaryConfirmationModal';
import { RecurringSalaryModal } from './RecurringSalaryModal';
import { CashWithdrawalModal } from './CashWithdrawalModal';
import { SalaryStreamPrompt } from './SalaryStreamPrompt';
import { matchSalaryStream, type IncomeLike, type SalaryMatch } from '../../utils/salaryMatch';
import { suggestCategory } from '../../utils/categorise';
import {
  buildDescription,
  describeWhen,
  payeeSuggestions,
  type EntryType,
  type PayeeSuggestion,
} from '../../utils/quickAdd';
import { apiClient } from '../../services/apiClient';
import { nowForDateTimeInput } from '../../utils/datetime';
import { formatMonetaryValue } from '../../utils/money';
import { useUiStore } from '../../stores/useUiStore';
import { BANKS, MERCHANTS, WALLETS } from '../../data/transferDestinations';
import type { Account, Category, Transaction, RecurringIncome } from '../../types/api';
import './QuickAddModal.css';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/** The three details that are usually right already, folded until asked for. */
type Panel = 'account' | 'when' | 'note';

const CATALOGUE = [...MERCHANTS, ...WALLETS, ...BANKS];

/**
 * Recording money in or out.
 *
 * WHAT CHANGED, AND WHY. This was nine stacked fields - two salary banners,
 * three dropdowns, a second payee box, a date field, a notes field - every one
 * of them on screen for every entry, though most entries only ever need two
 * things: how much, and who. So the sheet now leads with exactly those, and
 * the rest is still there but folded:
 *
 *   - the amount is the hero, because it is the one field nobody skips;
 *   - one "paid to" field replaces the catalogue dropdown AND the typed payee
 *     box, with suggestions drawn from who the user actually pays;
 *   - the category is chosen FOR them as they type the payee, and says why,
 *     so the common case is no tap at all - and a tap still overrides it;
 *   - account, date and note sit in a row of pills showing their current
 *     value, and open in place only when one needs changing;
 *   - the ATM and salary shortcuts survive as one quiet line, still placed
 *     before the amount, so a withdrawal is caught before it is mis-filed.
 *
 * Nothing was dropped. What was dropped is the asking.
 */
export const QuickAddModal: React.FC<QuickAddModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [type, setType] = useState<EntryType>('expense');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  /** Recent rows: who the user pays, and what they filed each under. */
  const [history, setHistory] = useState<Transaction[]>([]);

  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [amountPaise, setAmountPaise] = useState<number>(0);
  /** Who the money went to, or came from. One name, wherever it came from. */
  const [merchant, setMerchant] = useState<string>('');
  const [txDate, setTxDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  /** A category the user chose themselves is never overwritten by a guess. */
  const [categoryTouched, setCategoryTouched] = useState<boolean>(false);
  /** Why the category was picked, shown so the guess is never a mystery. */
  const [autoReason, setAutoReason] = useState<string | null>(null);
  const [dateTouched, setDateTouched] = useState<boolean>(false);

  const [panel, setPanel] = useState<Panel | null>(null);
  /** The last panel opened, kept while it folds so it closes with content in
   *  it. Null until one is first opened: an untouched drawer holds nothing. */
  const [shownPanel, setShownPanel] = useState<Panel | null>(null);
  const [payeeFocused, setPayeeFocused] = useState<boolean>(false);

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  /**
   * Whether accounts and categories have actually arrived.
   *
   * Seen on a real phone: for the few seconds the request took, the sheet said
   * "Add an account" and "Create a expense category" to someone with two
   * accounts and fifteen categories - and either tap would have made a
   * duplicate. "Nothing yet" and "nothing at all" are different answers, and
   * only "ready" is allowed to say the second.
   */
  const [optionsStatus, setOptionsStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [formError, setFormError] = useState<string | null>(null);

  // Sheets that open over this one.
  const [savedTransaction, setSavedTransaction] = useState<Transaction | null>(null);
  const [isAddAccountOpen, setIsAddAccountOpen] = useState<boolean>(false);
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState<boolean>(false);
  const [isSalaryConfirmOpen, setIsSalaryConfirmOpen] = useState<boolean>(false);
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState<boolean>(false);
  const [selectedRecurringRule, setSelectedRecurringRule] = useState<RecurringIncome | null>(null);
  /** An income that looks like a salary, waiting on one question. The saved
   *  row is carried along so its receipt can follow the answer. */
  const [pendingSalary, setPendingSalary] = useState<
    { match: SalaryMatch; income: IncomeLike; transaction: Transaction } | null
  >(null);

  const payeeRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  const { addToast } = useUiStore();

  // ---- loading ----------------------------------------------------------

  /* Loaded once per opening. It used to re-run on every Expense/Income
     switch, refetching accounts and categories and resetting the date the
     user had just set - a tab switch is not a reason to go to the network. */
  const loadOptions = useCallback(async () => {
    setOptionsStatus('loading');
    try {
      const [accRes, catRes] = await Promise.all([
        apiClient.get<Account[]>('/accounts'),
        apiClient.get<Category[]>('/categories'),
      ]);
      // A closed account cannot receive a new entry.
      const open = accRes.data.filter((a) => a.is_active !== false);
      setAccounts(open);
      setCategories(catRes.data);
      setAccountId((current) =>
        open.some((a) => a.id === current) ? current : open[0]?.id || '',
      );
      setOptionsStatus('ready');
    } catch {
      setOptionsStatus('failed');
    }

    // Optional: suggestions and auto-category get better with it, and the
    // sheet works perfectly well without it.
    try {
      const res = await apiClient.get<Transaction[]>('/transactions', { params: { limit: 200 } });
      setHistory(res.data || []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      setTxDate(nowForDateTimeInput());
      setDateTouched(false);
      setSavedTransaction(null);
      setPanel(null);
      setFormError(null);
      setCategoryTouched(false);
      setAutoReason(null);
      void loadOptions();
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen, loadOptions]);

  const typedCategories = useMemo(
    () => categories.filter((c) => c.type === type),
    [categories, type],
  );

  // A category of the wrong type, or none, falls back to the first of this
  // type. Only when the user has not chosen one themselves.
  useEffect(() => {
    if (typedCategories.length === 0) return;
    if (typedCategories.some((c) => c.id === categoryId)) return;
    const timer = setTimeout(() => setCategoryId(typedCategories[0].id), 0);
    return () => clearTimeout(timer);
  }, [typedCategories, categoryId]);

  // ---- the category picks itself ------------------------------------------

  /** Every name the sheet can vouch for: ones used before, and the catalogue. */
  const knownNames = useMemo(() => {
    const names = new Set<string>(CATALOGUE.map((d) => d.label.toLowerCase()));
    for (const s of payeeSuggestions({ query: '', type, history, limit: 500 })) {
      names.add(s.label.toLowerCase());
    }
    return names;
  }, [type, history]);

  useEffect(() => {
    if (categoryTouched) return;
    const name = merchant.trim();
    /* Never guess from half a name. While the field still has the cursor,
       "Gau" matched Gautam's history and announced "you filed Gau under Food
       before" - but "Gau" might be Gaurav. Mid-typing, only a name the sheet
       already knows exactly (a tapped suggestion, a full catalogue name) is
       allowed to pick; anything else waits until the user leaves the field. */
    const halfTyped = payeeFocused && !knownNames.has(name.toLowerCase());
    if (!name || typedCategories.length === 0 || halfTyped) {
      const timer = setTimeout(() => setAutoReason(null), 0);
      return () => clearTimeout(timer);
    }

    const suggestion = suggestCategory({
      merchant: name,
      text: name,
      kind: type === 'expense' ? 'debit' : 'credit',
      categories: typedCategories,
      history,
    });

    let pickId: string | null = suggestion.source !== 'none' ? suggestion.categoryId : null;
    // Income reasons were written for bank messages ("the message mentions
    // salary") and read oddly here, so income is categorised silently.
    let reason: string | null = type === 'expense' && pickId ? suggestion.reason : null;

    // A bank or wallet from the catalogue has no keyword the categoriser
    // knows, but the catalogue itself says where it belongs.
    if (!pickId && type === 'expense') {
      const hit = CATALOGUE.find((d) => d.label.toLowerCase() === name.toLowerCase());
      const cat = hit?.categoryHint
        ? typedCategories.find((c) => c.name === hit.categoryHint)
        : undefined;
      if (cat) {
        pickId = cat.id;
        reason = `${hit!.label} is usually ${cat.name}`;
      }
    }

    const timer = setTimeout(() => {
      if (pickId) setCategoryId(pickId);
      setAutoReason(reason);
    }, 0);
    return () => clearTimeout(timer);
  }, [merchant, type, typedCategories, history, categoryTouched, payeeFocused, knownNames]);

  useEffect(() => {
    if (panel === 'note') noteRef.current?.focus({ preventScroll: true });
  }, [panel]);

  // ---- actions ------------------------------------------------------------

  const switchType = (next: EntryType) => {
    if (next === type) return;
    setType(next);
    // A choice made for expenses means nothing for income.
    setCategoryTouched(false);
    setAutoReason(null);
    setFormError(null);
  };

  const togglePanel = (next: Panel) => {
    setShownPanel(next);
    setPanel((current) => (current === next ? null : next));
  };

  const chooseCategory = (id: string) => {
    setCategoryId(id);
    setCategoryTouched(true);
    setAutoReason(null);
  };

  const choosePayee = (s: PayeeSuggestion) => {
    setMerchant(s.label);
    // Folds the keyboard away, so the category it just chose can be seen.
    payeeRef.current?.blur();
  };

  const setWhen = (value: string, touched: boolean) => {
    setTxDate(value);
    setDateTouched(touched);
  };

  const handleCreateDefaultCategory = async () => {
    try {
      const catName = type === 'income' ? 'Salary & Income' : 'General Expense';
      const res = await apiClient.post<Category>('/categories', {
        name: catName,
        type,
        icon: type === 'income' ? 'Wallet' : 'Tag',
        color: type === 'income' ? 'var(--moneva-figure-income)' : 'var(--moneva-figure-expense)',
      });
      addToast(`Created "${catName}" category.`, 'success');
      await loadOptions();
      chooseCategory(res.data.id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to create category.';
      setFormError(msg);
    }
  };

  /**
   * The salary streams, fetched only once an income has actually been saved -
   * an expense never needs them, and the common case should not pay for a
   * request it cannot use.
   */
  const findSalaryMatch = async (income: IncomeLike): Promise<SalaryMatch | null> => {
    try {
      const res = await apiClient.get<RecurringIncome[]>('/income/recurring');
      return matchSalaryStream(income, res.data || []);
    } catch {
      // Offering to move the payday is a courtesy. It must never stand
      // between the user and the money they just recorded.
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (amountPaise <= 0) {
      setFormError('Enter an amount first.');
      return;
    }
    if (!accountId) {
      setFormError('Add an account for this to go into.');
      return;
    }
    if (!categoryId) {
      setFormError('Choose a category.');
      return;
    }

    setIsSubmitting(true);
    try {
      const description = buildDescription(merchant, notes);
      const payload = {
        client_mutation_id: crypto.randomUUID(),
        account_id: accountId,
        // Nothing this form creates has a far side. Transfers are made by
        // goal contributions and cash withdrawals, neither of which is this.
        to_account_id: null,
        category_id: categoryId,
        transaction_type: type,
        amount_minor: amountPaise,
        currency: 'INR',
        description,
        transaction_date: txDate ? new Date(txDate).toISOString() : new Date().toISOString(),
        device_id: 'web-client',
      };

      const res = await apiClient.post<Transaction>('/transactions', payload);
      onSuccess();

      /* An income can be the salary the home screen is counting down to, and
         typing it in here used to leave that countdown running - so the card
         kept promising money that had already arrived, then asked for it
         again on the day. The row is saved either way; this only decides
         whether the payday moves on, and only the user can say that. */
      const salaryIncome: IncomeLike = {
        amountPaise,
        at: new Date(payload.transaction_date),
        text: description || '',
        categoryName: categories.find((c) => c.id === categoryId)?.name ?? null,
      };

      setAmountPaise(0);
      setMerchant('');
      setNotes('');
      setCategoryTouched(false);
      setAutoReason(null);
      setPanel(null);

      if (type === 'income') {
        const match = await findSalaryMatch(salaryIncome);
        if (match) {
          // The receipt waits its turn rather than stacking two sheets.
          setPendingSalary({ match, income: salaryIncome, transaction: res.data });
          return;
        }
      }

      setSavedTransaction(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Could not save that. Try again in a moment.';
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- derived ------------------------------------------------------------

  const suggestions = useMemo(
    () => payeeSuggestions({ query: merchant, type, history }),
    [merchant, type, history],
  );
  const account = accounts.find((a) => a.id === accountId);
  const noAccounts = accounts.length === 0;
  const ready = optionsStatus === 'ready';
  /** Still asking, with nothing from an earlier opening to show meanwhile. */
  const waitingForAccounts = !ready && noAccounts;
  const waitingForCategories = !ready && typedCategories.length === 0;
  const whenLabel = describeWhen(txDate, dateTouched);
  const isExpense = type === 'expense';

  const sheetOpen =
    isOpen && !savedTransaction && !isSalaryConfirmOpen && !isRecurringModalOpen && !pendingSalary;

  return (
    <>
      <Modal isOpen={sheetOpen} onClose={onClose} title="New transaction">
        <form onSubmit={handleSubmit} className="qa" data-type={type} noValidate>
          {/* ---- money out, or in ---- */}
          <div className="qa-switch" role="radiogroup" aria-label="Type of entry">
            <span className="qa-switch-thumb" aria-hidden="true" />
            <button
              type="button"
              role="radio"
              aria-checked={isExpense}
              className="qa-switch-option"
              onClick={() => switchType('expense')}
            >
              Expense
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!isExpense}
              className="qa-switch-option"
              onClick={() => switchType('income')}
            >
              Income
            </button>
          </div>

          {/* ---- the shortcuts, one quiet line ----
              Still BEFORE the amount: a cash withdrawal recorded as an expense
              is the mistake this exists to prevent, so it has to be offered
              before the figure is typed, not as a correction afterwards. */}
          <div className="qa-shortcuts" key={`shortcuts-${type}`}>
            {isExpense ? (
              <button type="button" className="qa-link" onClick={() => setIsWithdrawalOpen(true)}>
                <Banknote size={14} aria-hidden="true" />
                Took cash from an ATM?
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="qa-link"
                  onClick={() => {
                    setSelectedRecurringRule(null);
                    setIsSalaryConfirmOpen(true);
                  }}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  Salary received
                </button>
                <span className="qa-dot" aria-hidden="true" />
                <button type="button" className="qa-link" onClick={() => setIsRecurringModalOpen(true)}>
                  <Repeat size={14} aria-hidden="true" />
                  Salary schedule
                </button>
              </>
            )}
          </div>

          {/* ---- how much ---- */}
          <AmountInput
            variant="hero"
            accent="var(--qa-accent)"
            valuePaise={amountPaise}
            onChangePaise={setAmountPaise}
            label={isExpense ? 'Amount spent' : 'Amount received'}
          />

          {/* ---- who ---- */}
          <div className={`qa-payee ${payeeFocused ? 'is-focused' : ''}`}>
            <label className="qa-payee-label" htmlFor="qa-payee-input">
              {isExpense ? 'Paid to' : 'Received from'}
            </label>
            <input
              id="qa-payee-input"
              ref={payeeRef}
              className="qa-payee-input"
              type="text"
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="done"
              placeholder={isExpense ? 'Who you paid' : 'Who paid you'}
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              onFocus={() => setPayeeFocused(true)}
              onBlur={() => setPayeeFocused(false)}
            />
          </div>

          {payeeFocused && suggestions.length > 0 && (
            <div className="qa-suggestions" role="group" aria-label="Suggestions">
              {suggestions.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  className={`qa-chip qa-chip-suggest ${s.source === 'recent' ? 'is-recent' : ''}`}
                  style={{ animationDelay: `${i * 22}ms` }}
                  // Pressing would blur the field and close this row before the
                  // click lands; holding the focus lets the choice register.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choosePayee(s)}
                >
                  {s.source === 'recent' && <Clock3 size={12} aria-hidden="true" />}
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* ---- what kind ---- */}
          <div className="qa-categories" key={`cats-${type}`}>
            {waitingForCategories ? (
              <div className="qa-chip-row" aria-busy="true" aria-label="Loading categories">
                {[72, 96, 84, 64].map((w, i) => (
                  <span key={i} className="qa-chip qa-chip-skeleton" style={{ width: w }} aria-hidden="true" />
                ))}
              </div>
            ) : typedCategories.length === 0 ? (
              <button type="button" className="qa-chip qa-chip-add" onClick={handleCreateDefaultCategory}>
                <Plus size={14} aria-hidden="true" />
                Add a category
              </button>
            ) : (
              <div className="qa-chip-row" role="radiogroup" aria-label="Category">
                {typedCategories.map((c, i) => {
                  const selected = c.id === categoryId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`qa-chip ${selected ? 'is-selected' : ''}`}
                      style={{
                        animationDelay: `${Math.min(i, 8) * 20}ms`,
                        ...(c.color ? ({ '--qa-dot': c.color } as React.CSSProperties) : {}),
                      }}
                      onClick={() => chooseCategory(c.id)}
                    >
                      <span className="qa-chip-dot" aria-hidden="true" />
                      {c.name}
                      {selected && !categoryTouched && autoReason && (
                        <Sparkles size={12} className="qa-chip-auto" aria-label="picked for you" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {autoReason && !categoryTouched && (
              <p className="qa-reason" key={autoReason}>
                Picked for you &mdash; {autoReason}
              </p>
            )}
          </div>

          {/* ---- the details that are usually right already ---- */}
          <div className="qa-pills">
            {waitingForAccounts ? (
              <span className="qa-pill qa-pill-account qa-pill-skeleton" aria-busy="true">
                <Landmark size={14} aria-hidden="true" />
                <span className="qa-pill-text">Loading…</span>
              </span>
            ) : noAccounts ? (
              <button type="button" className="qa-pill is-warning" onClick={() => setIsAddAccountOpen(true)}>
                <Landmark size={14} aria-hidden="true" />
                Add an account
              </button>
            ) : (
              <button
                type="button"
                className={`qa-pill qa-pill-account ${panel === 'account' ? 'is-open' : ''}`}
                aria-expanded={panel === 'account'}
                aria-controls="qa-drawer"
                onClick={() => togglePanel('account')}
              >
                <Landmark size={14} aria-hidden="true" />
                <span className="qa-pill-text">{account?.name || 'Account'}</span>
                <ChevronDown size={14} className="qa-pill-chevron" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              className={`qa-pill qa-pill-when ${panel === 'when' ? 'is-open' : ''}`}
              aria-expanded={panel === 'when'}
              aria-controls="qa-drawer"
              onClick={() => togglePanel('when')}
            >
              <CalendarClock size={14} aria-hidden="true" />
              <span className="qa-pill-text">{whenLabel}</span>
              <ChevronDown size={14} className="qa-pill-chevron" aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`qa-pill qa-pill-note ${panel === 'note' ? 'is-open' : ''} ${notes.trim() ? 'has-value' : ''}`}
              aria-expanded={panel === 'note'}
              aria-controls="qa-drawer"
              onClick={() => togglePanel('note')}
            >
              <NotebookPen size={14} aria-hidden="true" />
              <span className="qa-pill-text">{notes.trim() || 'Note'}</span>
            </button>
          </div>

          {/* inert while folded: CSS hides it from sight, this takes it out of
              the tab order and away from screen readers as well. */}
          <div
            id="qa-drawer"
            className="qa-drawer"
            data-open={panel !== null}
            inert={panel === null}
            aria-hidden={panel === null}
          >
            <div className="qa-drawer-inner">
              {shownPanel === 'account' && (
                <div className="qa-chip-wrap" role="radiogroup" aria-label="Account">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={a.id === accountId}
                      className={`qa-chip ${a.id === accountId ? 'is-selected' : ''}`}
                      onClick={() => {
                        setAccountId(a.id);
                        setPanel(null);
                      }}
                    >
                      {a.name}
                    </button>
                  ))}
                  <button type="button" className="qa-chip qa-chip-add" onClick={() => setIsAddAccountOpen(true)}>
                    <Plus size={14} aria-hidden="true" />
                    New account
                  </button>
                </div>
              )}

              {shownPanel === 'when' && (
                <div className="qa-when">
                  <div className="qa-chip-wrap">
                    <button
                      type="button"
                      className={`qa-chip ${!dateTouched ? 'is-selected' : ''}`}
                      onClick={() => {
                        setWhen(nowForDateTimeInput(), false);
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
                        setWhen(nowForDateTimeInput(d), true);
                      }}
                    >
                      Yesterday
                    </button>
                  </div>
                  <input
                    className="qa-field"
                    type="datetime-local"
                    aria-label="Date and time"
                    value={txDate}
                    onChange={(e) => setWhen(e.target.value, true)}
                  />
                </div>
              )}

              {shownPanel === 'note' && (
                <input
                  ref={noteRef}
                  className="qa-field"
                  type="text"
                  aria-label="Note"
                  enterKeyHint="done"
                  placeholder="Anything to remember about it"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter closes the note rather than saving the whole entry
                    // half-checked.
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setPanel(null);
                    }
                  }}
                />
              )}
            </div>
          </div>

          {optionsStatus === 'failed' && (
            <div className="qa-error qa-error-retry" role="alert">
              <span>Could not load your accounts and categories.</span>
              <button type="button" className="qa-link" onClick={() => void loadOptions()}>
                Try again
              </button>
            </div>
          )}

          {formError && (
            <div className="qa-error" role="alert" key={formError}>
              {formError}
            </div>
          )}

          <Button
            type="submit"
            variant={isExpense ? 'danger' : 'primary'}
            fullWidth
            className="qa-save"
            isLoading={isSubmitting}
            // Nothing to save into until the accounts are known.
            disabled={noAccounts || waitingForCategories}
          >
            {amountPaise > 0
              ? `Save ${isExpense ? 'expense' : 'income'} · ${formatMonetaryValue(amountPaise)}`
              : `Save ${isExpense ? 'expense' : 'income'}`}
          </Button>
        </form>
      </Modal>

      <AccountModal
        isOpen={isAddAccountOpen}
        onClose={() => setIsAddAccountOpen(false)}
        onSuccess={() => void loadOptions()}
      />

      <SalaryConfirmationModal
        isOpen={isSalaryConfirmOpen}
        recurringSalary={selectedRecurringRule}
        accounts={accounts}
        categories={categories}
        onClose={() => {
          setIsSalaryConfirmOpen(false);
          setSelectedRecurringRule(null);
        }}
        onSuccess={onSuccess}
      />

      <CashWithdrawalModal
        isOpen={isWithdrawalOpen}
        accounts={accounts}
        onClose={() => setIsWithdrawalOpen(false)}
        onSuccess={() => { onSuccess(); onClose(); }}
      />

      <RecurringSalaryModal
        isOpen={isRecurringModalOpen}
        onClose={() => setIsRecurringModalOpen(false)}
        onSelectForConfirmation={(rule) => {
          setSelectedRecurringRule(rule);
          setIsSalaryConfirmOpen(true);
        }}
      />

      <SalaryStreamPrompt
        match={pendingSalary?.match ?? null}
        income={pendingSalary?.income ?? null}
        onDone={() => {
          const tx = pendingSalary?.transaction ?? null;
          setPendingSalary(null);
          // Whatever the answer, the stream may have moved, so the home
          // screen is refreshed before the receipt appears over it.
          onSuccess();
          setSavedTransaction(tx);
        }}
      />

      <ExpenseSuccessModal
        transaction={savedTransaction}
        categoryName={categories.find((c) => c.id === savedTransaction?.category_id)?.name}
        accountName={accounts.find((a) => a.id === savedTransaction?.account_id)?.name}
        onClose={() => {
          setSavedTransaction(null);
          onClose();
        }}
      />
    </>
  );
};
