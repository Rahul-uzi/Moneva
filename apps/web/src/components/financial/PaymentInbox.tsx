import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Bell, ExternalLink } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Money } from '../ui/Money';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import {
  acknowledgeProposal,
  drainProposals,
  getCaptureStatus,
  isCaptureSupported,
  openNotificationAccessSettings,
  setCapturing,
  type CaptureStatus,
} from '../../services/notificationCapture';
import type { AlertProposal } from '../../utils/paymentAlert';
import { suggestCategory } from '../../utils/categorise';
import { decideConfirm, badgeFor, needsDestinationPicker, describeProposal } from './paymentInboxRules';
import { recordConfirmation, recordRejection } from '../../utils/autoAdd';
import { loadTrustLedger, saveTrustLedger } from '../../services/autoAddStore';
import type { Account, Category, Transaction } from '../../types/api';
import './PaymentInbox.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Payments the phone noticed, waiting to be confirmed.
 *
 * The app reads payment alerts from UPI apps and banks and offers each one as
 * a filled-in row. It does NOT write them. Every transaction here costs one
 * tap, and that tap is the point: the parser has not yet been run against a
 * real Indian inbox, so a wrong figure should cost the user a glance, not a
 * corrupted ledger. Once the readings have been checked against real
 * messages, an "add these automatically" switch becomes a small change here.
 *
 * Confirming is safe to repeat. The id travelling with each proposal is
 * derived from the payment itself, so a double tap or a retry after a dropped
 * connection lands on the row that already exists rather than making another.
 */
export const PaymentInbox: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [status, setStatus] = useState<CaptureStatus>({
    granted: false, capturing: false, lastKeptAt: 0, keptCount: 0, enabledAt: 0,
    connected: false, connectedAt: 0, batteryExempt: false, manufacturer: '',
  });
  const [proposals, setProposals] = useState<AlertProposal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  // Where money that only MOVED ended up. A transfer is the one kind the
  // server will not accept without a destination, and there is nothing in a
  // bank's alert that says which of your accounts it landed in - so it is
  // asked for rather than guessed.
  const [toAccountId, setToAccountId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const addToast = useUiStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    const next = await getCaptureStatus();
    setStatus(next);
    setProposals(next.capturing ? await drainProposals() : []);
    setIsLoading(false);
  }, []);

  // No setState before the first await, so opening this cannot cascade a
  // second render before the first has painted. `isLoading` starts true and
  // is only ever lowered - which is correct because the parent mounts this
  // component when it opens the modal rather than keeping it mounted and
  // hidden, so each open starts from fresh state.
  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;

    void (async () => {
      await refresh();
      if (!alive) return;

      // The account list is needed before anything can be confirmed: an alert
      // names a bank, not one of this app's accounts, so the user picks.
      try {
        const [accRes, catRes, txRes] = await Promise.all([
          apiClient.get<Account[]>('/accounts'),
          apiClient.get<Category[]>('/categories'),
          // Recent history only, and only so a payee already filed once is
          // filed the same way again - see categorise.ts. Their own past
          // decision is the one signal that is not a guess.
          apiClient.get<Transaction[]>('/transactions', { params: { limit: 200 } }),
        ]);
        if (!alive) return;
        setAccounts(accRes.data);
        setCategories(catRes.data);
        setHistory(txRes.data);
        // An asset account by preference: a payment alert almost always
        // describes money leaving a bank account, not a credit card being
        // repaid, and picking the first liability would be wrong more often.
        const preferred = accRes.data.find((a) => a.account_type === 'asset') ?? accRes.data[0];
        if (preferred) setAccountId(preferred.id);
      } catch {
        /* the empty state below explains it */
      }
    })();

    return () => {
      alive = false;
    };
  }, [isOpen, refresh]);

  const enable = async () => {
    const next = await setCapturing(true);
    setStatus(next);
    if (!next.granted) await openNotificationAccessSettings();
    else void refresh();
  };

  const confirm = async (proposal: AlertProposal) => {
    const decision = decideConfirm(proposal.kind, accountId, toAccountId);
    if (!decision.ok) {
      addToast(decision.message, 'error');
      return;
    }
    setBusyId(proposal.clientMutationId);
    try {
      // The category is a suggestion, shown on the card before this runs, so
      // nothing is filed under a guess the user has not seen. Null when
      // nothing matched - an uncategorised row beats a wrong one, which
      // quietly corrupts a budget.
      await apiClient.post<Transaction>('/transactions', {
        client_mutation_id: proposal.clientMutationId,
        account_id: accountId,
        to_account_id: decision.toAccountId,
        category_id: categoryFor(proposal).categoryId,
        // Three kinds, not two - see decideConfirm. A bare debit/credit
        // ternary files a transfer as income.
        transaction_type: decision.transactionType,
        amount_minor: proposal.amountPaise,
        currency: 'INR',
        description: describeProposal(proposal.merchant, proposal.sources, proposal.accountTail),
        transaction_date: new Date(proposal.postedAt).toISOString(),
        device_id: 'android-notification',
      });
      // Recorded only after the write succeeded. A confirmation the server
      // rejected is not evidence that this reading was right.
      saveTrustLedger(recordConfirmation(loadTrustLedger(), proposal, Date.now()));

      await acknowledgeProposal(proposal);
      setProposals((rest) => rest.filter((p) => p.clientMutationId !== proposal.clientMutationId));
      onSuccess();
    } catch {
      addToast('Could not add that payment. It is still here to try again.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  /** What category this payment probably belongs to, and why. */
  const categoryFor = (proposal: AlertProposal) => {
    // A transfer has no spending category, and inventing one would be worse
    // than leaving it blank: money moved into savings is not "Food & Dining",
    // and a category here is what would drag it back into a budget.
    if (proposal.kind === 'transfer') {
      return {
        categoryId: null,
        categoryName: null,
        source: 'none' as const,
        reason: 'Moved between your own accounts, so it is not spending.',
      };
    }
    return suggestCategory({
      merchant: proposal.merchant,
      text: proposal.merchant ?? '',
      kind: proposal.kind,
      categories,
      history,
    });
  };

  const dismiss = async (proposal: AlertProposal) => {
    /* Waving a payment away says the reading was wrong, and a pattern that
       produces wrong readings is precisely the one that must not be filing
       anything unasked. So this revokes rather than merely not-counting. */
    saveTrustLedger(recordRejection(loadTrustLedger(), proposal, Date.now()));

    await acknowledgeProposal(proposal);
    setProposals((rest) => rest.filter((p) => p.clientMutationId !== proposal.clientMutationId));
  };

  const when = (ms: number) =>
    new Date(ms).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Payments noticed">
      <div className="pay-inbox">
        {!isCaptureSupported() && (
          <p className="pay-inbox-note">
            Reading payment alerts needs the Android app.
          </p>
        )}

        {isCaptureSupported() && !status.capturing && (
          <div className="pay-inbox-intro">
            <Bell size={28} className="pay-inbox-icon" />
            <h4>Let MONEVA read payment alerts</h4>
            <p>
              When Google Pay, PhonePe or your bank shows a payment, MONEVA can read
              the amount and offer to add it - so you do not type it in twice.
            </p>
            <ul className="pay-inbox-facts">
              <li>Only alerts from payment and banking apps are read.</li>
              {/* Kept true rather than reassuring. Adding without asking is
                  off unless the user turns it on, and saying only the first
                  half of that would make this list a promise the settings
                  screen can quietly break. */}
              <li>
                Nothing is added until you tap to confirm it - unless you later
                choose to let the ones you have confirmed many times go in on
                their own.
              </li>
              <li>The text stays on this phone. Only the transaction is saved.</li>
              <li>You can turn this off here at any time.</li>
            </ul>
            <Button onClick={enable} fullWidth>
              Turn on payment alerts
            </Button>
          </div>
        )}

        {isCaptureSupported() && status.capturing && !status.granted && (
          <div className="pay-inbox-intro">
            <h4>One more step, in Android settings</h4>
            <p>
              Android only lets you grant notification access from its own settings
              screen. Find <strong>MONEVA payment alerts</strong> in the list and
              switch it on, then come back here.
            </p>
            <Button onClick={() => void openNotificationAccessSettings()} fullWidth>
              Open notification access <ExternalLink size={15} />
            </Button>
            <button type="button" className="pay-inbox-link" onClick={() => void refresh()}>
              I have turned it on
            </button>
            <button
              type="button"
              className="pay-inbox-link"
              onClick={async () => setStatus(await setCapturing(false))}
            >
              Not now
            </button>
          </div>
        )}

        {status.capturing && status.granted && (
          <>
            {isLoading && <p className="pay-inbox-note">Looking…</p>}

            {!isLoading && proposals.length === 0 && (
              <p className="pay-inbox-note">
                Nothing waiting. The next payment your phone shows will appear here.
              </p>
            )}

            {proposals.length > 0 && accounts.length > 0 && (
              <label className="pay-inbox-account">
                <span>Add to</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}

            {needsDestinationPicker(proposals.map((p) => p.kind), accounts.length) && (
              <label className="pay-inbox-account">
                <span>Moved to</span>
                <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">Choose an account&hellip;</option>
                  {accounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}

            {proposals.map((p) => (
              <div key={p.clientMutationId} className="pay-inbox-card">
                <div className="pay-inbox-row">
                  <div className="pay-inbox-amount">
                    {/* alwaysShow: this is a figure being checked right now,
                        and masking it would only stop the user verifying it. */}
                    <Money
                      amount={p.amountPaise}
                      alwaysShow
                      className={badgeFor(p.kind).className}
                    />
                    <span className="pay-inbox-kind">{badgeFor(p.kind).label}</span>
                  </div>
                  <div className="pay-inbox-actions">
                    <button
                      type="button"
                      className="pay-inbox-btn is-dismiss"
                      onClick={() => void dismiss(p)}
                      disabled={busyId === p.clientMutationId}
                      aria-label="Not a transaction"
                    >
                      <X size={17} />
                    </button>
                    <button
                      type="button"
                      className="pay-inbox-btn is-confirm"
                      onClick={() => void confirm(p)}
                      disabled={busyId === p.clientMutationId}
                      aria-label="Add this payment"
                    >
                      <Check size={17} />
                    </button>
                  </div>
                </div>
                <p className="pay-inbox-meta">
                  {p.merchant ? <strong>{p.merchant}</strong> : <em>No payee named</em>}
                  {p.accountTail ? ` · a/c ••${p.accountTail}` : ''}
                  {` · ${when(p.postedAt)}`}
                </p>
                <p className="pay-inbox-source">
                  Seen in {p.sources.join(' and ')}
                  {p.sources.length > 1 ? ' (same payment)' : ''}
                </p>
                {/* Shown BEFORE it is saved, with the reason. A category that
                    simply appears is one nobody checks; "because you filed
                    Swiggy under Food & Dining before" is something a person
                    can agree or disagree with at a glance. */}
                {categoryFor(p).categoryName && (
                  <p className="pay-inbox-category">
                    <span className="pay-inbox-cat-name">{categoryFor(p).categoryName}</span>
                    {categoryFor(p).reason ? ` - ${categoryFor(p).reason}` : ''}
                  </p>
                )}
              </div>
            ))}

            <button
              type="button"
              className="pay-inbox-link is-off"
              onClick={async () => {
                setStatus(await setCapturing(false));
                setProposals([]);
              }}
            >
              Stop reading payment alerts
            </button>
          </>
        )}
      </div>
    </Modal>
  );
};

export default PaymentInbox;
