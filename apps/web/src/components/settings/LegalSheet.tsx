/**
 * Privacy and terms, inside the app, describing THIS install.
 *
 * WHY IT IS HERE AND NOT A LINK. MONEVA asks for two of the most invasive
 * permissions Android has - the notification shade and the SMS inbox - and it
 * holds someone's financial history. A person deciding whether to grant those
 * deserves to read what happens to the data without leaving the app, and
 * without depending on a website that might not exist next year.
 *
 * WHY IT IS DYNAMIC. A privacy policy is usually a description of what an app
 * COULD do, which is why nobody reads them: it tells you about permissions you
 * may never have granted and features you may never have turned on. This one
 * opens by saying what is actually switched on for you, on this phone, right
 * now - so the paragraphs that follow are about your situation rather than a
 * hypothetical one. The claims are read from the same services the settings
 * screen reads, so the page cannot drift out of step with the switches.
 *
 * WHAT IS DELIBERATELY NOT OMITTED. Every claim below is checked against the
 * code, including the inconvenient one: using the Assistant sends your
 * balances, recent transactions, budgets, goals and bills to Google. That is
 * the single most surprising thing this app does with data, so it gets its own
 * paragraph instead of hiding inside a list of "service providers". The terms
 * likewise say plainly that automatic capture can be WRONG, rather than
 * implying the figures are authoritative.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { getSmsStatus } from '../../services/smsCapture';
import { getCaptureStatus, isCaptureSupported } from '../../services/notificationCapture';
import './LegalSheet.css';

/**
 * A dedicated address, never a personal one.
 *
 * This string is printed in a document that ships to every install, so it
 * belongs in configuration rather than in source - and it should be an
 * address that exists to receive these questions, not somebody's own inbox.
 */
const SUPPORT_EMAIL = (import.meta.env?.VITE_SUPPORT_EMAIL as string | undefined)
  ?? 'moneva.help@gmail.com';

const APP_VERSION = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? 'dev';

/** Bump this whenever the text below changes in a way that matters. */
const LAST_UPDATED = '11 September 2026';

type Tab = 'privacy' | 'terms';

interface LiveState {
  /** Android only - there is no shade and no inbox to read on the web. */
  onPhone: boolean;
  readsMessages: boolean;
  readsNotifications: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initial?: Tab;
}

export const LegalSheet: React.FC<Props> = ({ isOpen, onClose, initial = 'privacy' }) => {
  const [tab, setTab] = useState<Tab>(initial);
  const [live, setLive] = useState<LiveState | null>(null);

  const readState = useCallback(async () => {
    if (!isCaptureSupported()) {
      setLive({ onPhone: false, readsMessages: false, readsNotifications: false });
      return;
    }
    const [sms, notif] = await Promise.all([getSmsStatus(), getCaptureStatus()]);
    setLive({
      onPhone: true,
      readsMessages: sms.granted && sms.capturing,
      readsNotifications: notif.granted && notif.capturing,
    });
  }, []);

  useEffect(() => {
    if (isOpen) void readState();
  }, [isOpen, readState]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tab === 'privacy' ? 'Privacy' : 'Terms of use'}
    >
      <div className="legal-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'privacy'}
          className={tab === 'privacy' ? 'legal-tab is-active' : 'legal-tab'}
          onClick={() => setTab('privacy')}
        >
          Privacy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'terms'}
          className={tab === 'terms' ? 'legal-tab is-active' : 'legal-tab'}
          onClick={() => setTab('terms')}
        >
          Terms
        </button>
      </div>

      <div className="legal-body">
        {tab === 'privacy' ? <Privacy live={live} /> : <Terms />}
        <p className="legal-updated">
          MONEVA {APP_VERSION} &middot; last updated {LAST_UPDATED}
        </p>
      </div>
    </Modal>
  );
};

/**
 * What is switched on for this person, before any of the general text.
 *
 * The difference between "MONEVA can read your messages" and "MONEVA is
 * reading your messages right now" is the whole reason anyone opens this page,
 * and almost no policy answers it.
 */
const RightNow: React.FC<{ live: LiveState | null }> = ({ live }) => {
  if (!live) return <p className="legal-now is-loading">Checking this phone&hellip;</p>;

  if (!live.onPhone) {
    return (
      <p className="legal-now">
        You are not on the Android app, so nothing here is reading messages or
        notifications.
      </p>
    );
  }

  return (
    <div className="legal-now">
      <strong>On this phone, right now</strong>
      <ul>
        <li className={live.readsMessages ? 'is-on' : 'is-off'}>
          Reading your bank messages: <strong>{live.readsMessages ? 'on' : 'off'}</strong>
        </li>
        <li className={live.readsNotifications ? 'is-on' : 'is-off'}>
          Reading payment notifications:{' '}
          <strong>{live.readsNotifications ? 'on' : 'off'}</strong>
        </li>
      </ul>
      <p>
        Both are switched off until you turn them on, and you can turn either
        off again in Profile at any moment.
      </p>
    </div>
  );
};

const Privacy: React.FC<{ live: LiveState | null }> = ({ live }) => (
  <>
    <p className="legal-lede">
      MONEVA keeps a record of your money. This page says exactly what it holds,
      what it never holds, and who else can see it &mdash; in plain words,
      because you cannot agree to something you had to decode.
    </p>

    <RightNow live={live} />

    <h3>What MONEVA keeps</h3>
    <ul>
      <li>Your email address and the name you chose.</li>
      <li>Your password, stored scrambled. Nobody can read it back.</li>
      <li>
        The money you record: accounts, transactions, budgets, goals, bills and
        cards.
      </li>
    </ul>

    <h3>What it never keeps</h3>
    <p>
      This is the part that matters, because MONEVA can read your messages and
      your notifications.
    </p>
    <ul>
      <li>
        <strong>Your text messages are never stored or sent anywhere.</strong>{' '}
        MONEVA checks who sent a message before opening it. Messages from people
        are skipped without being read. One-time codes are thrown away. Only a
        bank or UPI alert is looked at, and only the payment inside it &mdash;
        the amount, the date, who you paid &mdash; is kept, after you tap to
        confirm it.
      </li>
      <li>
        <strong>The same is true of notifications.</strong> Anything that is not
        a completed payment is discarded on your phone, before it is written
        down.
      </li>
      <li>
        No location, no contacts, no photos, no advertising ID, and no record of
        what you tap.
      </li>
    </ul>

    <h3>Who else can see your money</h3>
    <p>
      <strong>Google, but only if you use the Assistant.</strong> Asking the
      Assistant a question sends your account balances, your eight most recent
      transactions, this month&rsquo;s spending by category, and your budgets,
      goals and bills to Google&rsquo;s Gemini service so it can answer. Your
      name, email and password are not sent. If you would rather this never
      happened, do not use the Assistant &mdash; every other part of MONEVA
      works without it.
    </p>
    <p>
      <strong>Our hosting provider</strong> stores the database holding your
      records. <strong>Google&rsquo;s mail service</strong> delivers your
      password-reset and confirmation emails.
    </p>
    <p>
      Nobody else. Your data is not sold, not shared with advertisers, and not
      used to build a profile of you. There are no ads in MONEVA.
    </p>

    <h3>Getting your data out, or getting rid of it</h3>
    <ul>
      <li>
        <strong>Export</strong> everything as a spreadsheet or a file, any time,
        from Profile.
      </li>
      <li>
        <strong>Delete your account</strong> from Profile. Your records are
        removed. This cannot be undone.
      </li>
      <li>
        <strong>Turn capture off</strong> whenever you like. Reading messages
        and reading notifications are separate switches, and both start off.
      </li>
    </ul>

    <h3>Keeping it safe</h3>
    <p>
      Everything travels encrypted. Passwords and reset codes are stored
      scrambled. You can add a fingerprint lock and two-factor sign-in. If a
      sign-in token is ever stolen, using it a second time ends that session
      automatically.
    </p>

    <h3>Age</h3>
    <p>MONEVA is for people aged 18 and over.</p>

    <h3>If this page changes</h3>
    <p>
      Anything that changes what is collected, or who sees it, will be shown in
      the app before it takes effect &mdash; not quietly edited in.
    </p>

    <h3>Asking us something</h3>
    <p>
      Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> to ask
      what is held about you, or to have it deleted.
    </p>
  </>
);

const Terms: React.FC = () => (
  <>
    <p className="legal-lede">
      Short version: MONEVA helps you keep track of your money. It is not a
      bank, it is not advice, and it can be wrong &mdash; so check anything that
      matters against your bank.
    </p>

    <h3>What MONEVA is</h3>
    <p>
      A tool for recording and understanding your own spending. It does not hold
      money, move money, or connect to your bank account.
    </p>

    <h3>It is not financial advice</h3>
    <p>
      Nothing in MONEVA &mdash; not a chart, not a warning, not an answer from
      the Assistant &mdash; is professional financial, tax or investment advice.
      Decisions about your money are yours. For advice, speak to someone
      qualified.
    </p>

    <h3>It can be wrong, and you should assume it sometimes is</h3>
    <p>
      When MONEVA reads a payment from a message or a notification, it is making
      a best guess from text a bank wrote for a human. It can misread an amount,
      get a direction backwards, miss a payment entirely, or record one twice.
      That is why it shows you what it found and waits for you to accept it.
    </p>
    <p>
      <strong>
        Your bank statement is the authority on your money. MONEVA is not.
      </strong>{' '}
      Check anything important against your bank before acting on it.
    </p>

    <h3>Your account</h3>
    <p>
      Keep your password to yourself and keep your phone locked. Anything done
      through your account is treated as done by you. Tell us straight away if
      you think someone else has got in.
    </p>

    <h3>Availability</h3>
    <p>
      MONEVA is provided as it is, free, with no promise that it will always be
      available or that your data will never be lost. Export a copy of anything
      you would be upset to lose. That is true of every free service, and it is
      better said than implied.
    </p>

    <h3>Where this leaves us</h3>
    <p>
      We are not responsible for financial decisions you make using MONEVA, for
      figures it got wrong, or for money lost as a result. You use it because it
      is useful, not because it is guaranteed.
    </p>

    <h3>Ending it</h3>
    <p>
      Delete your account from Profile whenever you want, and everything held
      about you goes with it.
    </p>

    <h3>Which law</h3>
    <p>These terms are governed by the laws of India.</p>

    <h3>Questions</h3>
    <p>
      <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    </p>
  </>
);

export default LegalSheet;
