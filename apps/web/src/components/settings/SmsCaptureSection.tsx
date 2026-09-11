/**
 * Reading bank SMS: the switch, and the sweep back through the inbox.
 *
 * The plugin behind this has existed, tested, since it was written - and
 * nothing called it, so the feature was unreachable. This is the door.
 *
 * The screen has one job beyond the two controls: make the trade legible
 * BEFORE the permission dialog, not after. READ_SMS reaches an inbox that also
 * holds one-time codes and private conversation, and a person deciding whether
 * to grant it deserves to know what actually happens to that - which is that
 * the sender is checked natively before any message body is examined, and that
 * nothing but a parsed transaction ever leaves the phone. Saying so here costs
 * four lines and is the difference between informed consent and a tapped
 * dialog.
 *
 * Nothing it captures is written to the ledger on its own: SMS is an untrusted
 * channel in autoAdd, so every proposal waits in the Payment Inbox to be
 * accepted. That holds no matter what the auto-add switch says.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Download, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import { useUiStore } from '../../stores/useUiStore';
import {
  backfillFromSms,
  getSmsStatus,
  isSmsCaptureSupported,
  requestSmsPermission,
  setSmsCapturing,
  type SmsStatus,
} from '../../services/smsCapture';
import './SmsCaptureSection.css';

interface Props {
  /** Called after a backfill so the Payment Inbox can pick up what arrived. */
  onCaptured?: () => void;
  /** Opens the privacy page. Offered here, before the permission dialog. */
  onReadPrivacy?: () => void;
}

const BACKFILL_MONTHS = 12;

export const SmsCaptureSection: React.FC<Props> = ({ onCaptured, onReadPrivacy }) => {
  const [status, setStatus] = useState<SmsStatus>({
    supported: false,
    granted: false,
    capturing: false,
    backfilledTo: 0,
  });
  const [isWorking, setIsWorking] = useState(false);
  const addToast = useUiStore((s) => s.addToast);

  const refresh = useCallback(async () => {
    setStatus(await getSmsStatus());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isSmsCaptureSupported()) return null;

  const turnOn = async () => {
    setIsWorking(true);
    try {
      if (!status.granted) {
        const { granted, permanentlyDenied } = await requestSmsPermission();
        if (!granted) {
          // Android stops showing the dialog after the second refusal, so
          // offering the same button again would offer something that can no
          // longer happen. Say where the switch actually lives.
          addToast(
            permanentlyDenied
              ? 'Android is no longer asking. Turn on SMS access for MONEVA in Settings, Apps, MONEVA, Permissions.'
              : 'Without permission MONEVA cannot read bank messages.',
            'error',
          );
          return;
        }
      }
      await setSmsCapturing(true);
      await refresh();
    } finally {
      setIsWorking(false);
    }
  };

  const turnOff = async () => {
    setIsWorking(true);
    try {
      // The app's own switch, not the system permission. Stopping has to work
      // immediately and without sending anyone to a settings screen.
      await setSmsCapturing(false);
      await refresh();
    } finally {
      setIsWorking(false);
    }
  };

  const runBackfill = async () => {
    setIsWorking(true);
    try {
      const result = await backfillFromSms(BACKFILL_MONTHS);
      if (!result) {
        addToast('The inbox could not be read.', 'error');
        return;
      }
      addToast(
        result.kept === 0
          ? `Looked at ${result.scanned.toLocaleString('en-IN')} messages and found no payments. Bank alerts older than a few months are often deleted by the phone.`
          : `Found ${result.kept} payment${result.kept === 1 ? '' : 's'} in ${result.scanned.toLocaleString('en-IN')} messages. They are waiting in your Payment Inbox.`,
        result.kept === 0 ? 'info' : 'success',
      );
      await refresh();
      onCaptured?.();
    } finally {
      setIsWorking(false);
    }
  };

  const on = status.granted && status.capturing;

  return (
    <>
      <div className={`toggle-row${on ? '' : ' is-off'}`}>
        <div className="toggle-info">
          <span className="toggle-label">
            <MessageSquare size={14} className="toggle-icon" /> Read bank messages
          </span>
          <span className="toggle-sub">
            {on
              ? 'On. Catches banks that text you but send no notification.'
              : 'Off. Many banks only text — those payments are invisible without this.'}
          </span>
        </div>
        <Button
          variant={on ? 'secondary' : 'primary'}
          size="sm"
          className="row-action-btn"
          disabled={isWorking}
          onClick={() => void (on ? turnOff() : turnOn())}
        >
          {on ? 'Turn off' : 'Turn on'}
        </Button>
      </div>

      {/* Said before the permission dialog, not after. Somebody deciding
          whether to grant access to their inbox should know what happens to
          the messages that are not payments - which is nothing at all. */}
      {!on && (
        <p className="sms-promise">
          <ShieldCheck size={14} />
          <span>
            MONEVA checks who sent a message before reading it. Messages from
            people are never opened, one-time codes are thrown away, and no
            message ever leaves your phone — only the payment you confirm.
            {onReadPrivacy && (
              <>
                {' '}
                {/* Before the dialog, not after. Somebody weighing up access to
                    their own inbox should be able to read what happens to it
                    without first agreeing to it. */}
                <button type="button" className="sms-promise-link" onClick={onReadPrivacy}>
                  Read the detail
                </button>
              </>
            )}
          </span>
        </p>
      )}

      {/* Only once capture is actually on. A sweep with the switch off would
          read the inbox and discard everything it found, which is the worst of
          both: the permission is used and nothing comes of it. */}
      {on && (
        <div className="toggle-row">
          <div className="toggle-info">
            <span className="toggle-label">
              <Download size={14} className="toggle-icon" /> Bring in past payments
            </span>
            <span className="toggle-sub">
              {status.backfilledTo > 0
                ? `Read back to ${new Date(status.backfilledTo).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}. Run again to catch anything missed.`
                : `Reads the last ${BACKFILL_MONTHS} months. Nothing is saved until you confirm it.`}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="row-action-btn"
            disabled={isWorking}
            onClick={() => void runBackfill()}
          >
            {isWorking ? 'Reading…' : 'Read inbox'}
          </Button>
        </div>
      )}
    </>
  );
};

export default SmsCaptureSection;
