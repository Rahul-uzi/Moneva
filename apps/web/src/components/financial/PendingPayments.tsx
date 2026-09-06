import React, { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { PaymentInbox } from './PaymentInbox';
import {
  drainProposals,
  getCaptureStatus,
  isCaptureSupported,
  onPaymentNotification,
} from '../../services/notificationCapture';
import './PendingPayments.css';

interface Props {
  /** Called after a payment is added, so the dashboard can re-read itself. */
  onAdded: () => void;
}

/**
 * "Two payments noticed" - on the dashboard, where it will be seen.
 *
 * The inbox was reachable only from Profile, three taps in, behind a settings
 * row. That is the wrong place for something time-sensitive: a payment the
 * phone noticed an hour ago is only useful if you are told about it, and
 * nobody opens Settings to check whether their app found something.
 *
 * Shows nothing at all when there is nothing waiting, so it costs the
 * dashboard no space on the ordinary day. Reading the queue is a local call to
 * the plugin - no network - so checking often is cheap.
 */
export const PendingPayments: React.FC<Props> = ({ onAdded }) => {
  const [count, setCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const recount = useCallback(async () => {
    if (!isCaptureSupported()) return;
    const status = await getCaptureStatus();
    if (!status.capturing || !status.granted) {
      setCount(0);
      return;
    }
    setCount((await drainProposals()).length);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      await recount();
      if (!alive) return;
    })();

    // While the app is open, an arriving alert should show up without waiting
    // for the next launch.
    let unsubscribe: (() => void) | undefined;
    void onPaymentNotification(() => void recount()).then((off) => {
      if (alive) unsubscribe = off;
      else off();
    });

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [recount]);

  // Nothing waiting is the normal state; say nothing rather than show a zero.
  if (count === 0 && !isOpen) return null;

  return (
    <>
      {count > 0 && (
        <button type="button" className="pending-pay" onClick={() => setIsOpen(true)}>
          <span className="pending-pay-icon">
            <Bell size={18} />
          </span>
          <span className="pending-pay-text">
            <strong>
              {count} payment{count === 1 ? '' : 's'} noticed
            </strong>
            <span>Tap to check and add {count === 1 ? 'it' : 'them'}</span>
          </span>
          <ChevronRight size={18} className="pending-pay-chevron" />
        </button>
      )}

      {isOpen && (
        <PaymentInbox
          isOpen
          onClose={() => {
            setIsOpen(false);
            void recount();
          }}
          onSuccess={() => {
            onAdded();
            void recount();
          }}
        />
      )}
    </>
  );
};
