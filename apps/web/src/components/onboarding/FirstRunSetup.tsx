/**
 * The gap between "signed up" and "has an app worth opening again".
 *
 * Registration creates a user row and nothing else. So the welcome slides
 * finished, the guided tour finished, and the app handed over a set of screens
 * that were all working and all empty - which reads as a failure to load, not
 * as work waiting to be done. The rival everyone compares us to rebuilds six
 * months of spending from the SMS inbox in the first thirty seconds; we open
 * on zero.
 *
 * Two steps close most of that, and both already existed:
 *
 *   1. An account, because there is nowhere to put a transaction without one.
 *   2. A statement import, because notifications can only ever see the future
 *      - there is no permission that would let the listener read the years
 *      before it was installed - and the CSV parser has understood HDFC,
 *      ICICI, SBI and Axis exports the whole time, from Profile, where a new
 *      user has no reason to look.
 *
 * The screen is a checklist rather than a wizard on purpose. A wizard implies
 * both steps are compulsory; the second genuinely is not, and pretending
 * otherwise makes someone with no statement to hand feel stuck at step two of
 * two. So: one required, one offered, and a way past both.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Check, ArrowRight, Wallet, FileSpreadsheet } from 'lucide-react';
import { Button } from '../ui/Button';
import { AccountModal } from '../financial/AccountModal';
import { ImportSheet } from '../financial/ImportSheet';
import { apiClient } from '../../services/apiClient';
import type { Account } from '../../types/api';
import './FirstRunSetup.css';

interface Props {
  onFinish: () => void;
}

export const FirstRunSetup: React.FC<Props> = ({ onFinish }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  /**
   * Whether an import has completed - not how many rows it brought.
   *
   * `onImported` carries no count, and the sheet itself already reports
   * created/duplicate/rejected in detail on its own success screen. Inventing
   * a number here to make the tick look more informative would put a figure on
   * screen that nothing verified, in an app whose entire claim is that its
   * figures are exact.
   */
  const [hasImported, setHasImported] = useState(false);

  /**
   * Read the accounts rather than assume there are none.
   *
   * This screen can be reached again from Profile, and someone replaying it
   * has accounts already. Starting from "you have no accounts" and being wrong
   * about it is the kind of small lie that makes people stop believing the
   * rest of the screen.
   */
  const loadAccounts = useCallback(async () => {
    try {
      const res = await apiClient.get<Account[]>('/accounts');
      setAccounts(res.data ?? []);
    } catch {
      // An unreachable server is not a reason to block setup - the person can
      // still skip, and the account step will simply say it is not done yet.
      setAccounts([]);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const hasAccount = accounts.length > 0;

  return (
    <div
      className="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Set up MONEVA"
    >
      <div className="onboarding-card setup-card">
        <button type="button" className="onboarding-skip" onClick={onFinish}>
          Skip
        </button>

        <h2 className="heading-lg onboarding-title">Two things and you are set</h2>
        <p className="text-body onboarding-body">
          The second one is optional, but it is what stops MONEVA opening empty.
        </p>

        <ol className="setup-steps">
          <li className={hasAccount ? 'setup-step is-done' : 'setup-step'}>
            <span className="setup-mark" aria-hidden="true">
              {hasAccount ? <Check size={16} /> : <Wallet size={16} />}
            </span>
            <div className="setup-text">
              <strong>Add an account</strong>
              <p>
                {hasAccount
                  ? `${accounts.length} account${accounts.length === 1 ? '' : 's'} ready. Transactions have somewhere to go.`
                  : 'A bank account, a card, or just cash. Everything you record belongs to one.'}
              </p>
            </div>
            <Button
              variant={hasAccount ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => setIsAccountOpen(true)}
            >
              {hasAccount ? 'Add another' : 'Add'}
            </Button>
          </li>

          <li className={hasImported ? 'setup-step is-done' : 'setup-step'}>
            <span className="setup-mark" aria-hidden="true">
              {hasImported ? <Check size={16} /> : <FileSpreadsheet size={16} />}
            </span>
            <div className="setup-text">
              <strong>
                Bring in your history <span className="setup-optional">optional</span>
              </strong>
              <p>
                {hasImported
                  ? 'Statement imported. Check Activity to see what came in.'
                  : 'Download a statement from your bank and MONEVA will read it. HDFC, ICICI, SBI and Axis exports are understood; you see what was read before anything is saved.'}
              </p>
            </div>
            <Button
              variant={hasImported ? 'ghost' : 'secondary'}
              size="sm"
              /* Disabled until there is an account, because the rows would
                 have nowhere to land. The import sheet says so too, but
                 letting someone open it only to be told no is a wasted tap. */
              disabled={!hasAccount}
              onClick={() => setIsImportOpen(true)}
            >
              {hasImported ? 'Import more' : 'Import'}
            </Button>
          </li>
        </ol>

        <div className="onboarding-actions">
          <Button variant="primary" fullWidth onClick={onFinish}>
            {hasAccount ? (
              <>
                Start using MONEVA
                <ArrowRight size={16} />
              </>
            ) : (
              <>
                I will do this later
                <ArrowRight size={16} />
              </>
            )}
          </Button>
        </div>
      </div>

      {isAccountOpen && (
        <AccountModal
          isOpen
          onClose={() => setIsAccountOpen(false)}
          onSuccess={() => {
            setIsAccountOpen(false);
            void loadAccounts();
          }}
        />
      )}

      {isImportOpen && (
        <ImportSheet
          isOpen
          onClose={() => setIsImportOpen(false)}
          onImported={() => {
            // The sheet reports its own counts in detail; all this screen needs
            // is that something arrived, so the step can be marked done.
            setHasImported(true);
          }}
          accounts={accounts}
        />
      )}
    </div>
  );
};

export default FirstRunSetup;
