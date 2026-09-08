import React, { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { apiClient } from '../../services/apiClient';
import { useUiStore } from '../../stores/useUiStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { formatMonetaryValue } from '../../utils/money';
import { parseStatement, assignImportIds, type ParsedStatement } from '../../utils/parseStatement';
import { subscriptionName } from '../../utils/subscriptions';
import type { Account } from '../../types/api';
import './ImportSheet.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
  accounts: Account[];
}

/** The server caps a request at 500 rows; a statement can hold years. */
const CHUNK = 200;

interface Outcome {
  created: number;
  duplicates: number;
  rejected: number;
  /** The run stopped part way; what is counted above did land. */
  partial?: boolean;
}

/**
 * Bringing a bank statement in.
 *
 * The listener can only ever see the future - there is no permission that
 * would let it read the years before it was installed - so a statement export
 * is the only honest route to that history.
 *
 * The shape of this screen follows from one risk: a wrong reading here is
 * invisible AND bulk. If the parser takes the "Closing Balance" column as the
 * amount, a hundred plausible, entirely wrong rows arrive in one tap and
 * nothing on screen looks broken. So the file is read, what was understood is
 * SHOWN - which column became the amount, what the dates were taken to mean,
 * a few real rows - and only then is there a button. Nothing is written
 * before the user has had a chance to see that it was read correctly.
 */
export const ImportSheet: React.FC<Props> = ({ isOpen, onClose, onImported, accounts }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [isImporting, setIsImporting] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const addToast = useUiStore((s) => s.addToast);
  // Scopes the derived ids to this account - see importMutationId.
  const ownerId = useAuthStore((s) => s.user?.id ?? '');

  const currency = accounts.find((a) => a.id === accountId)?.currency ?? 'INR';

  const reset = () => {
    setFileName(''); setParsed(null); setOutcome(null); setProgress(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  /** An .xlsx is bytes, so it goes to the server to become text first. */
  const isSpreadsheet = (file: File) =>
    /\.(xlsx|xlsm)$/i.test(file.name)
    || file.type.includes('spreadsheetml')
    || file.type === 'application/vnd.ms-excel';

  const readFile = async (file: File) => {
    reset();
    setFileName(file.name);
    setIsReading(true);
    try {
      let text: string;

      if (isSpreadsheet(file)) {
        // Converted server-side, where openpyxl already lives for the export
        // in the other direction. Only the conversion happens there - the
        // columns, dates and amounts are still read by the parser below, so
        // there is one set of rules rather than two that can drift apart.
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        // Chunked: String.fromCharCode(...wholeFile) blows the argument limit
        // on anything past a few hundred kilobytes.
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const res = await apiClient.post<{ csv: string; sheet_name: string; rows: number }>(
          '/transactions/import/sheet',
          { filename: file.name, content_base64: btoa(binary) },
        );
        text = res.data.csv;
      } else {
        text = await file.text();
      }

      setParsed(parseStatement(text));
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      addToast(
        detail || 'That file could not be read. A CSV or Excel export from your bank works best.',
        'error',
      );
      setFileName('');
    } finally {
      setIsReading(false);
    }
  };

  const runImport = async () => {
    if (!parsed || parsed.rows.length === 0 || !accountId) return;
    setIsImporting(true);
    setProgress(0);

    const totals: Outcome = { created: 0, duplicates: 0, rejected: 0 };
    // Assigned across the whole file before chunking: two identical payments
    // on the same day need different occurrence numbers, and they may well
    // fall either side of a chunk boundary.
    const ids = assignImportIds(parsed.rows, ownerId);

    try {
      for (let at = 0; at < parsed.rows.length; at += CHUNK) {
        const slice = parsed.rows.slice(at, at + CHUNK);
        const res = await apiClient.post<{
          created: number; duplicates: number; rejected: { index: number; reason: string }[];
        }>('/transactions/import', {
          account_id: accountId,
          rows: slice.map((row, i) => ({
            // Derived from the payment, so importing this file again - or an
            // export that overlaps it - lands on the rows already there.
            client_mutation_id: ids[at + i],
            transaction_type: row.direction === 'debit' ? 'expense' : 'income',
            amount_minor: row.amountMinor,
            currency,
            // Cleaned, not raw. A statement narration is
            // "BY TRANSFER-UPI/DR/512345/ZOMATO", and a ledger of those is
            // unreadable - and the reference in it belongs to that one
            // payment, so it also defeats the brand lookup that draws the
            // row's logo. Same filter the subscription list uses, so an
            // imported row and a captured one end up spelled alike.
            description: subscriptionName(row.description) || null,
            transaction_date: row.date,
          })),
        });
        totals.created += res.data.created;
        totals.duplicates += res.data.duplicates;
        totals.rejected += res.data.rejected.length;
        setProgress(Math.min(at + CHUNK, parsed.rows.length));
      }
      setOutcome(totals);
      if (totals.created > 0) onImported();
    } catch {
      // A chunk failed. The earlier ones are already committed, so saying only
      // "it failed" would leave the user believing nothing happened while
      // several hundred rows sit in their ledger. Report what actually landed,
      // and say plainly that finishing the job is another run of the same file.
      setOutcome({ ...totals, partial: true });
      if (totals.created > 0) onImported();
    } finally {
      setIsImporting(false);
    }
  };

  const layout = parsed?.layout;
  const preview = parsed?.rows.slice(0, 5) ?? [];

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} title="Bring in a statement">
      {/* ---------- done ---------- */}
      {outcome ? (
        <div className="import-done">
          <CheckCircle2 size={40} className="import-done-icon" />
          <p className="import-done-line">
            <strong>{outcome.created}</strong> added
            {outcome.duplicates > 0 && <> · <strong>{outcome.duplicates}</strong> already here</>}
            {outcome.rejected > 0 && <> · <strong>{outcome.rejected}</strong> skipped</>}
          </p>
          {outcome.partial && (
            <p className="import-partial">
              The import stopped before the end of the file. What is counted
              above is already saved - run the same file again to finish, and
              nothing will be added twice.
            </p>
          )}
          {outcome.duplicates > 0 && !outcome.partial && (
            <p className="import-note">
              Rows already in MONEVA were left alone, so importing an overlapping
              export is safe.
            </p>
          )}
          <Button variant="primary" onClick={() => { reset(); onClose(); }}>Done</Button>
        </div>
      ) : accounts.length === 0 ? (
        /* Without an account there is nowhere for the rows to go. Reaching
           this with an empty dropdown and a greyed-out button reads as the
           app being broken, when in fact one step is simply missing. */
        <div className="import-problem">
          <AlertTriangle size={16} />
          <div>
            <strong>Add an account first.</strong>
            <p>
              Imported transactions have to belong to an account. Create one on
              the Accounts screen, then come back to this.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- pick a file ---------- */}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="import-file-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }}
          />

          <button type="button" className="import-drop" onClick={() => fileRef.current?.click()}>
            <Upload size={20} />
            <span className="import-drop-title">
              {fileName || 'Choose a statement from your bank'}
            </span>
            <span className="import-drop-sub">
              {isReading
                ? 'Reading the file...'
                : 'A CSV or Excel download from your bank statement page.'}
            </span>
          </button>

          {/* ---------- nothing understood ---------- */}
          {parsed && !layout && (
            <div className="import-problem">
              <AlertTriangle size={16} />
              <div>
                <strong>Could not find the columns.</strong>
                <p>
                  This needs a file with a date column and either an amount, or
                  separate withdrawal and deposit columns. A PDF statement will
                  not work - look for the CSV or Excel download instead.
                </p>
              </div>
            </div>
          )}

          {/* ---------- what was understood ---------- */}
          {layout && (
            <>
              <div className="import-read">
                <FileSpreadsheet size={15} />
                <span>What MONEVA read from this file</span>
              </div>

              {/* The whole reason this step exists. A parser that picked the
                  balance column would produce a hundred plausible, wrong rows
                  in one tap - and this is the only place that is visible. */}
              <dl className="import-layout">
                <div><dt>Date</dt><dd>{layout.date}</dd></div>
                <div>
                  <dt>Read as</dt>
                  <dd>
                    {layout.dateOrder === 'dmy' ? 'day / month / year'
                      : layout.dateOrder === 'mdy' ? 'month / day / year'
                        : 'year - month - day'}
                  </dd>
                </div>
                {layout.description && (
                  <div><dt>Description</dt><dd>{layout.description}</dd></div>
                )}
                {layout.debit && <div><dt>Money out</dt><dd>{layout.debit}</dd></div>}
                {layout.credit && <div><dt>Money in</dt><dd>{layout.credit}</dd></div>}
                {layout.amount && <div><dt>Amount</dt><dd>{layout.amount}</dd></div>}
              </dl>

              <p className="import-count">
                <strong>{parsed.rows.length}</strong> rows ready
                {parsed.skipped.length > 0 && (
                  <> · {parsed.skipped.length} skipped (headings, totals, blank lines)</>
                )}
              </p>

              {/* Importing the first ten thousand rows and reporting success
                  would be its own silent failure - the user would have no way
                  to know the rest of the file never arrived. */}
              {parsed.truncatedAt !== undefined && (
                <div className="import-problem">
                  <AlertTriangle size={16} />
                  <div>
                    <strong>Only the first {parsed.truncatedAt} rows will be read.</strong>
                    <p>
                      This file is longer than one import can take. Add these,
                      then export the remaining period from your bank as a
                      second file - anything already added will be recognised.
                    </p>
                  </div>
                </div>
              )}

              {preview.length > 0 && (
                <div className="import-preview">
                  {preview.map((row) => (
                    <div key={row.line} className="import-preview-row">
                      <span className="import-preview-date">
                        {new Date(row.date).toLocaleDateString('en-IN',
                          { day: 'numeric', month: 'short', year: '2-digit' })}
                      </span>
                      <span className="import-preview-desc">
                        {subscriptionName(row.description) || 'No description'}
                      </span>
                      <span className={`import-preview-amt is-${row.direction}`}>
                        {row.direction === 'debit' ? '-' : '+'}
                        {formatMonetaryValue(row.amountMinor, currency)}
                      </span>
                    </div>
                  ))}
                  {parsed.rows.length > preview.length && (
                    <p className="import-more">
                      and {parsed.rows.length - preview.length} more
                    </p>
                  )}
                </div>
              )}

              <label className="import-account">
                <span>Add to</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>

              <Button
                variant="primary"
                onClick={() => void runImport()}
                disabled={isImporting || parsed.rows.length === 0 || !accountId}
              >
                {isImporting
                  ? `Adding ${progress} of ${parsed.rows.length}...`
                  : `Add ${parsed.rows.length} transactions`}
              </Button>

              <p className="import-note">
                Safe to repeat. Anything already in MONEVA is recognised and
                left alone, so an export that overlaps an earlier one will not
                double up.
              </p>
            </>
          )}
        </>
      )}
    </Modal>
  );
};
