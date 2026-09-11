/**
 * Privacy policy and terms, inside the app.
 *
 * WHY IT HAS TO BE HERE AND NOT A LINK. MONEVA asks for two of the most
 * invasive permissions Android has - the notification shade and the SMS inbox -
 * and it holds somebody's financial history. A person deciding whether to grant
 * those deserves to read what happens to the data without leaving the app to
 * find it, and without a website that might not exist next year.
 *
 * WHAT MAKES THIS ONE DIFFERENT FROM MOST. Every claim below is checked against
 * the code, and the ones that would be convenient to leave out are in:
 *
 *   - The Assistant sends your balances, recent transactions, budgets, goals
 *     and bills to Google. That is the single most surprising thing this app
 *     does with data, so it is stated in its own paragraph rather than buried
 *     in a list of "service providers".
 *   - The automatic capture can be WRONG, and the terms say so plainly instead
 *     of implying the figures are authoritative.
 *
 * A policy that omits those is the kind nobody should believe.
 */

import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import './LegalSheet.css';

/**
 * Fill these in before anyone but you installs the app.
 *
 * A privacy policy with no way to reach a human is not a policy - it is a wall
 * of text. The address below is where a person asks what you hold about them,
 * or asks you to delete it.
 */
const CONTACT_EMAIL = 'rahuldhiman2080@gmail.com';
const LAST_UPDATED = '11 September 2026';

type Tab = 'privacy' | 'terms';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Which one to open on. */
  initial?: Tab;
}

export const LegalSheet: React.FC<Props> = ({ isOpen, onClose, initial = 'privacy' }) => {
  const [tab, setTab] = useState<Tab>(initial);

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
        {tab === 'privacy' ? <Privacy /> : <Terms />}
        <p className="legal-updated">Last updated {LAST_UPDATED}</p>
      </div>
    </Modal>
  );
};

const Privacy: React.FC = () => (
  <>
    <p className="legal-lede">
      MONEVA keeps a record of your money. This page says exactly what it holds,
      what it never holds, and who else can see it. In plain words, because you
      cannot agree to something you had to decode.
    </p>

    <h3>What MONEVA keeps</h3>
    <ul>
      <li>Your email address and the name you chose.</li>
      <li>
        Your password, stored scrambled. Nobody can read it back — not even us.
      </li>
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
        bank or UPI alert is looked at, and only the payment inside it — the
        amount, the date, who you paid — is kept, after you tap to confirm it.
      </li>
      <li>
        <strong>The same is true of notifications.</strong> Anything that is not
        a completed payment is discarded on your phone, before it is written
        down.
      </li>
      <li>
        No location, no contacts, no photos, no advertising ID, no tracking of
        what you tap.
      </li>
    </ul>

    <h3>Who else can see your money</h3>
    <p>
      <strong>Google, but only when you use the Assistant.</strong> Asking the
      Assistant a question sends your account balances, your eight most recent
      transactions, this month&rsquo;s spending by category, and your budgets,
      goals and bills to Google&rsquo;s Gemini service so it can answer. Your
      name, email and password are not sent. If you would rather this never
      happened, do not use the Assistant — every other part of MONEVA works
      without it.
    </p>
    <p>
      <strong>Our hosting provider</strong> stores the database that holds your
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
        removed from our database. This cannot be undone.
      </li>
      <li>
        <strong>Turn capture off</strong> whenever you like. Reading messages
        and reading notifications are separate switches, and both start off.
      </li>
    </ul>

    <h3>Keeping it safe</h3>
    <p>
      Everything travels encrypted. Passwords are stored scrambled and reset
      codes are too. You can add a fingerprint lock and two-factor sign-in. If a
      sign-in token is ever stolen, using it a second time ends that session
      automatically.
    </p>

    <h3>Age</h3>
    <p>MONEVA is for people aged 18 and over.</p>

    <h3>If this page changes</h3>
    <p>
      Anything that changes what is collected or who sees it will be shown in
      the app before it takes effect, not quietly edited in.
    </p>

    <h3>Asking us something</h3>
    <p>
      Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to ask
      what is held about you, or to have it deleted.
    </p>
  </>
);

const Terms: React.FC = () => (
  <>
    <p className="legal-lede">
      Short version: MONEVA helps you keep track of your money. It is not a
      bank, it is not advice, and it can be wrong — so check anything that
      matters against your bank.
    </p>

    <h3>What MONEVA is</h3>
    <p>
      A tool for recording and understanding your own spending. It does not hold
      money, move money, or connect to your bank account.
    </p>

    <h3>It is not financial advice</h3>
    <p>
      Nothing in MONEVA — not a chart, not a warning, not an answer from the
      Assistant — is professional financial, tax or investment advice. Decisions
      about your money are yours. For advice, speak to someone qualified.
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
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </p>
  </>
);

export default LegalSheet;
