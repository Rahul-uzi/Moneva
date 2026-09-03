import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { formatMonetaryValue } from '../../utils/money';
import type { Bill, Account, Transaction } from '../../types/api';
import './BillPayModal.css';

import { parseApiDate } from '../../utils/datetime';
interface BillPayModalProps {
  bill: Bill | null;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}

export const BillPayModal: React.FC<BillPayModalProps> = ({
  bill,
  accounts,
  onClose,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [accountId, setAccountId] = useState<string>('');
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Success State
  const [confirmedTransaction, setConfirmedTransaction] = useState<Transaction | null>(null);

  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (bill && isMounted) {
        setConfirmedTransaction(null);
        setIsConfirming(false);
        setError(null);

        if (accounts.length > 0) {
          setAccountId(accounts[0].id);
        }
      }
    }, 0);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [bill, accounts]);

  if (!bill) return null;

  const selectedAccount = accounts.find((a) => a.id === accountId);
  const availableBalance = selectedAccount
    ? selectedAccount.balance_paise ?? selectedAccount.opening_balance_minor
    : 0;

  const handleNextOrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!accountId || !selectedAccount) {
      setError('Please select a payment account.');
      return;
    }

    if (bill.amount_minor > availableBalance) {
      setError(
        `Payment of ${formatMonetaryValue(bill.amount_minor, bill.currency)} exceeds available account balance of ${formatMonetaryValue(availableBalance, selectedAccount.currency)}.`
      );
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        account_id: accountId,
        client_mutation_id: crypto.randomUUID(),
        device_id: 'web-client',
        payment_date: new Date().toISOString(),
      };

      const res = await apiClient.post<Transaction>(`/bills/${bill.id}/pay`, payload);
      setConfirmedTransaction(res.data);
      addToast(`Payment of ${formatMonetaryValue(bill.amount_minor, bill.currency)} for "${bill.name}" confirmed!`, 'success');
      onSuccess();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail || 'Failed to pay bill.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={!!bill}
      onClose={onClose}
      title={confirmedTransaction ? 'Payment Complete' : `Pay Bill: ${bill.name}`}
    >
      {confirmedTransaction ? (
        <div className="bill-pay-confirmed-body">
          <div className="confirmed-icon-ring">
            <CheckCircle2 size={44} />
          </div>

          <h3 className="heading-md text-main">Bill Payment Confirmed!</h3>
          <p className="text-body text-center text-xs text-muted">
            The expense transaction was recorded in your ledger and your bill status updated to paid.
          </p>

          <div className="confirmed-summary-box">
            <span className="text-label text-coral font-bold uppercase">Paid Bill</span>
            <span className="number-xl text-coral">-{formatMonetaryValue(confirmedTransaction.amount_minor, confirmedTransaction.currency)}</span>
            <span className="text-body text-xs">Paid from {selectedAccount?.name}</span>
          </div>

          <div className="confirmed-actions">
            <Button variant="secondary" fullWidth onClick={onClose}>
              Done
            </Button>
            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                onClose();
                navigate('/activity');
              }}
            >
              View Activity <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleNextOrSubmit} className="bill-pay-form">
          {error && <div className="form-error-banner">{error}</div>}

          {isConfirming ? (
            <div className="confirmation-preview-box">
              <div className="preview-header-row">
                <ShieldAlert size={18} className="text-coral" />
                <span className="preview-title font-bold text-coral uppercase">Confirm Bill Payment</span>
              </div>
              <p className="text-body text-xs text-muted">
                Review the payment details. Submitting will create an expense transaction and reduce your account balance.
              </p>

              <div className="preview-details">
                <div className="preview-row">
                  <span className="detail-label">Bill Name</span>
                  <span className="detail-val font-semibold">{bill.name}</span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Amount Due</span>
                  <span className="detail-val number-md text-coral font-bold">
                    {formatMonetaryValue(bill.amount_minor, bill.currency)}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Payment Account</span>
                  <span className="detail-val">{selectedAccount?.name}</span>
                </div>
                <div className="preview-row">
                  <span className="detail-label">Balance After</span>
                  <span className="detail-val text-main">
                    {formatMonetaryValue(availableBalance - bill.amount_minor, selectedAccount?.currency)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="bill-pay-summary-banner">
                <span className="text-label">Bill Due Amount</span>
                <span className="number-xl text-coral">{formatMonetaryValue(bill.amount_minor, bill.currency)}</span>
                <span className="text-body text-xs text-muted">Due Date: {parseApiDate(bill.due_date).toLocaleDateString()}</span>
              </div>

              <div className="select-group">
                <label className="form-label">Payment Account</label>
                <select className="form-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((acc) => {
                    const bal = acc.balance_paise ?? acc.opening_balance_minor;
                    return (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.account_type.toUpperCase()}) - Available: {formatMonetaryValue(bal, acc.currency)}
                      </option>
                    );
                  })}
                </select>
              </div>
            </>
          )}

          <div className="modal-action-row">
            {isConfirming ? (
              <Button type="button" variant="secondary" onClick={() => setIsConfirming(false)} disabled={isSubmitting}>
                Back / Edit
              </Button>
            ) : (
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            )}

            <Button type="submit" variant="accent" isLoading={isSubmitting}>
              {isConfirming ? 'Confirm Payment' : 'Review & Pay'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
