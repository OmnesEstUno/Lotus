import { useState, useRef, useEffect, FormEvent, DragEvent } from 'react';
import { BUILT_IN_CATEGORIES, Category, IncomeEntry, ParsedCSVRow } from '../types';
import { parseTransactionCSV, parseIncomeCSV } from '../utils/csvParser';
import { parsePDFPaystub, extractIncomeFromCSVText, ExtractedPaystub } from '../utils/pdfParser';
import {
  addTransactions,
  addIncome,
  getTransactions,
  getIncome,
  AddTransactionInput,
} from '../api/client';
import { formatCurrency } from '../utils/dataProcessing';
import {
  buildExistingDedupLookup,
  ExistingDedupLookup,
  findDuplicateMatch,
  DuplicateMatch,
  recordRowInBatch,
} from '../utils/dedup';
import { useUserCategories } from '../hooks/useUserCategories';
import { useWorkspaces } from '../hooks/useWorkspaces';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../components/CategorySelect';
import Layout from '../components/layout/Layout';
import DuplicateStatusCell, { DuplicateStatus } from '../components/data-entry/DuplicateStatusCell';

// NOTE: This file is deliberately large because the CSV upload flow and the
// manual/pay-stub income flow share non-trivial state (existingDedupLookup,
// pendingDuplicate handoff, useUserCategories). A future refactor should
// introduce a useDataEntryState() hook and extract CSVUploadPreview,
// ManualExpenseForm, and IncomeForm as separate components. Tracked as a
// deferred item in docs/superpowers/plans/2026-04-17-verification-pass.md.

type ManualTab = 'expense' | 'income';

interface PreviewRow {
  idx: number;
  row: ParsedCSVRow;
  duplicateStatus: DuplicateStatus;
  duplicateMatch: DuplicateMatch | null;
}

export default function DataEntry() {
  // Upload state
  const [dragOver, setDragOver] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [skippedCount, setSkippedCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual tab state
  const [manualTab, setManualTab] = useState<ManualTab>('expense');

  // Manual expense state
  const [manualDate, setManualDate] = useState('');
  const [manualDesc, setManualDesc] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategory, setManualCategory] = useState<Category>('Other');
  const [manualError, setManualError] = useState('');
  const [manualSuccess, setManualSuccess] = useState('');

  // Income state (manual or from pay stub)
  const [incomeFile, setIncomeFile] = useState<File | null>(null);
  const [incomeParsing, setIncomeParsing] = useState(false);
  const incomeFileRef = useRef<HTMLInputElement>(null);
  const [incDesc, setIncDesc] = useState('');
  const [incDate, setIncDate] = useState('');
  const [incGross, setIncGross] = useState('');
  const [incNet, setIncNet] = useState('');
  const [incFederal, setIncFederal] = useState('');
  const [incState, setIncState] = useState('');
  const [incSS, setIncSS] = useState('');
  const [incMedicare, setIncMedicare] = useState('');
  const [incOther, setIncOther] = useState('');
  const [incomeError, setIncomeError] = useState('');
  const [incomeSuccess, setIncomeSuccess] = useState('');
  const [incomeLowConfidence, setIncomeLowConfidence] = useState(false);

  // ─── User Categories ─────────────────────────────────────────────────────
  const { userCategories, addCustomCategory, saveMapping } = useUserCategories();

  // ─── Active workspace ─────────────────────────────────────────────────────
  const { activeInstanceId } = useWorkspaces();

  // ─── Existing data for duplicate detection ──────────────────────────────
  // Loaded on mount (and whenever the active workspace changes) so CSV rows
  // can be marked as potential duplicates before the user even clicks Import.
  // Non-fatal if the fetch fails — the server still enforces dedup as a safety net.
  const [existingDedupLookup, setExistingDedupLookup] = useState<ExistingDedupLookup>({
    transactions: new Map(),
    income: new Map(),
  });

  useEffect(() => {
    if (!activeInstanceId) return;
    Promise.all([getTransactions(), getIncome()])
      .then(([txns, inc]) => setExistingDedupLookup(buildExistingDedupLookup(txns, inc)))
      .catch(() => {});
  }, [activeInstanceId]);

  function handlePreviewCategoryChange(rowIdx: number, pickedValue: string) {
    let categoryName: string | null = pickedValue;
    let isCustom = userCategories.customCategories.includes(pickedValue);

    if (pickedValue === NEW_CATEGORY_SENTINEL) {
      const input = window.prompt('Name for the new category:');
      if (!input) return;
      categoryName = addCustomCategory(input);
      if (!categoryName) return;
      isCustom = !BUILT_IN_CATEGORIES.includes(categoryName as (typeof BUILT_IN_CATEGORIES)[number]);
    }

    const row = previewRows.find((r) => r.idx === rowIdx);
    if (row && row.row.kind === 'expense') {
      if (isCustom) {
        saveMapping(row.row.description, categoryName);
      }
      updateRow(rowIdx, (r) => (r.kind === 'expense' ? { ...r, category: categoryName! } : r));
    }
  }

  function handleManualCategoryChange(pickedValue: string) {
    if (pickedValue === NEW_CATEGORY_SENTINEL) {
      const input = window.prompt('Name for the new category:');
      if (!input) return;
      const name = addCustomCategory(input);
      if (!name) return;
      setManualCategory(name);
      if (!BUILT_IN_CATEGORIES.includes(name as (typeof BUILT_IN_CATEGORIES)[number]) && manualDesc.trim()) {
        saveMapping(manualDesc.trim(), name);
      }
      return;
    }
    setManualCategory(pickedValue);
    const isCustom = userCategories.customCategories.includes(pickedValue);
    if (isCustom && manualDesc.trim()) {
      saveMapping(manualDesc.trim(), pickedValue);
    }
  }

  // ─── Unified Upload ──────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setParseErrors([]);
    setPreviewRows([]);
    setSkippedCount(0);
    setSubmitSuccess(null);
    setSubmitError(null);

    if (!file.name.match(/\.csv$/i)) {
      setParseErrors(['This file type is not supported. Please upload a CSV file.']);
      return;
    }

    const result = await parseTransactionCSV(file, userCategories.mappings);

    if (result.errors.length > 0 && result.rows.length === 0) {
      setParseErrors(result.errors.map((e) => e.message));
      return;
    }
    if (result.errors.length > 0) {
      setParseErrors(result.errors.map((e) => e.message));
    }
    setSkippedCount(result.skippedCount ?? 0);

    // Tag each parsed row with a duplicate status + the matching "twin" row
    // (if any) so the UI can show the user exactly what this row collides
    // with. Subsequent identical rows in the same batch are also flagged.
    const seenTxn = new Map<string, ParsedCSVRow>();
    const seenIncome = new Map<string, ParsedCSVRow>();
    const tagged: PreviewRow[] = result.rows.map((row, idx) => {
      const match = findDuplicateMatch(row, existingDedupLookup, seenTxn, seenIncome);
      recordRowInBatch(row, seenTxn, seenIncome);
      return {
        idx,
        row,
        duplicateStatus: match ? 'pending' : 'unique',
        duplicateMatch: match,
      };
    });
    setPreviewRows(tagged);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  function updateRow(idx: number, updater: (row: ParsedCSVRow) => ParsedCSVRow) {
    setPreviewRows((prev) => prev.map((r) => (r.idx === idx ? { ...r, row: updater(r.row) } : r)));
  }

  function removeRow(idx: number) {
    setPreviewRows((prev) => prev.filter((r) => r.idx !== idx));
  }

  // ─── Duplicate Approval Controls ────────────────────────────────────────
  function setDuplicateStatus(idx: number, status: DuplicateStatus) {
    setPreviewRows((prev) =>
      prev.map((r) => (r.idx === idx ? { ...r, duplicateStatus: status } : r)),
    );
  }

  function approveAllPendingDuplicates() {
    setPreviewRows((prev) =>
      prev.map((r) => (r.duplicateStatus === 'pending' ? { ...r, duplicateStatus: 'approved' } : r)),
    );
  }

  function denyAllPendingDuplicates() {
    setPreviewRows((prev) =>
      prev.map((r) => (r.duplicateStatus === 'pending' ? { ...r, duplicateStatus: 'denied' } : r)),
    );
  }

  const pendingDuplicateCount = previewRows.filter((r) => r.duplicateStatus === 'pending').length;
  const totalDuplicateCount = previewRows.filter(
    (r) => r.duplicateStatus === 'pending' || r.duplicateStatus === 'approved' || r.duplicateStatus === 'denied',
  ).length;

  async function submitUpload() {
    if (previewRows.length === 0) return;
    if (pendingDuplicateCount > 0) {
      setSubmitError(
        `You have ${pendingDuplicateCount} potential duplicate${pendingDuplicateCount !== 1 ? 's' : ''} that still need${pendingDuplicateCount === 1 ? 's' : ''} review. Approve or deny them before importing, or use the batch buttons at the top of the preview.`,
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Denied rows are dropped entirely
      const toSubmit = previewRows.filter((r) => r.duplicateStatus !== 'denied');
      const expenseRows = toSubmit.filter((r) => r.row.kind === 'expense');
      const incomeRows = toSubmit.filter((r) => r.row.kind === 'income');

      let addedTxns = 0;
      let skippedTxns = 0;
      if (expenseRows.length > 0) {
        const txns: AddTransactionInput[] = expenseRows.map((r) => {
          const row = r.row as Extract<ParsedCSVRow, { kind: 'expense' }>;
          return {
            date: row.date,
            description: row.description,
            category: row.category,
            amount: row.amount,
            type: row.type,
            source: 'csv' as const,
            // Approved duplicates bypass the server's dedup check
            allowDuplicate: r.duplicateStatus === 'approved',
          };
        });
        const result = await addTransactions(txns);
        addedTxns = result.added;
        skippedTxns = result.skipped;
      }

      let addedIncome = 0;
      let skippedIncome = 0;
      for (const r of incomeRows) {
        const row = r.row as Extract<ParsedCSVRow, { kind: 'income' }>;
        const result = await addIncome({
          date: row.date,
          description: row.description,
          grossAmount: row.amount,
          netAmount: row.amount,
          taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0, other: 0 },
          source: 'manual',
          // Approved duplicates bypass the server's dedup check
          allowDuplicate: r.duplicateStatus === 'approved',
        });
        if (result.skipped) skippedIncome++;
        else addedIncome++;
      }

      // Build a concise result summary
      const importedParts: string[] = [];
      if (addedTxns > 0) importedParts.push(`${addedTxns} expense${addedTxns !== 1 ? 's' : ''}`);
      if (addedIncome > 0) importedParts.push(`${addedIncome} income entr${addedIncome !== 1 ? 'ies' : 'y'}`);

      const skippedTotal = skippedTxns + skippedIncome;
      let message: string;
      if (importedParts.length === 0 && skippedTotal > 0) {
        message = `No new records imported — all ${skippedTotal} ${skippedTotal !== 1 ? 'entries were' : 'entry was'} already in your data.`;
      } else if (importedParts.length > 0 && skippedTotal > 0) {
        message = `Imported ${importedParts.join(' and ')}. ${skippedTotal} duplicate${skippedTotal !== 1 ? 's' : ''} skipped.`;
      } else if (importedParts.length > 0) {
        message = `Successfully imported ${importedParts.join(' and ')}.`;
      } else {
        message = 'Nothing was imported.';
      }
      setSubmitSuccess(message);
      setPreviewRows([]);
      setParseErrors([]);
      setSkippedCount(0);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Manual Expense ──────────────────────────────────────────────────────

  // When the server flags a manual entry as a duplicate, we stash the pending
  // payload so the user can choose to re-submit it with allowDuplicate=true.
  const [manualDuplicatePending, setManualDuplicatePending] = useState<AddTransactionInput | null>(null);

  async function submitManualExpense(payload: AddTransactionInput) {
    setSubmitting(true);
    try {
      const { added, skipped } = await addTransactions([payload]);
      if (added === 0 && skipped > 0) {
        setManualError('A transaction with this date, description, and amount already exists.');
        setManualDuplicatePending(payload);
        return;
      }
      setManualSuccess(`Added "${payload.description}" for ${formatCurrency(Math.abs(payload.amount))}.`);
      setManualDate('');
      setManualDesc('');
      setManualAmount('');
      setManualCategory('Other');
      setManualDuplicatePending(null);
    } catch (err) {
      setManualError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualExpense(e: FormEvent) {
    e.preventDefault();
    setManualError('');
    setManualSuccess('');
    setManualDuplicatePending(null);

    if (!manualDate) { setManualError('Please select a date for this transaction.'); return; }
    if (!manualDesc.trim()) { setManualError('Please enter a description for this transaction.'); return; }
    const amt = parseFloat(manualAmount.replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) { setManualError('Please enter a valid dollar amount (e.g. 45.99).'); return; }

    await submitManualExpense({
      date: manualDate,
      description: manualDesc.trim(),
      category: manualCategory,
      amount: -amt,
      type: 'expense',
      source: 'manual',
    });
  }

  async function retryManualExpenseAsDuplicate() {
    if (!manualDuplicatePending) return;
    setManualError('');
    await submitManualExpense({ ...manualDuplicatePending, allowDuplicate: true });
  }

  // ─── Pay Stub Upload + Manual Income ─────────────────────────────────────

  async function handleIncomeFile(file: File) {
    setIncomeError('');
    setIncomeSuccess('');
    setIncomeLowConfidence(false);
    setIncomeParsing(true);
    try {
      let stub: ExtractedPaystub;
      if (file.name.match(/\.pdf$/i)) {
        stub = await parsePDFPaystub(file);
      } else if (file.name.match(/\.csv$/i)) {
        const { text, error } = await parseIncomeCSV(file);
        if (error) throw new Error(error);
        stub = await extractIncomeFromCSVText(text);
      } else {
        throw new Error('Please upload a PDF or CSV pay stub file.');
      }

      setIncomeFile(file);
      setIncDesc(stub.description || file.name.replace(/\.[^.]+$/, ''));
      setIncDate(new Date().toISOString().slice(0, 10));
      setIncGross(stub.grossPay !== null ? stub.grossPay.toFixed(2) : '');
      setIncNet(stub.netPay !== null ? stub.netPay.toFixed(2) : '');
      setIncFederal(stub.taxes.federal > 0 ? stub.taxes.federal.toFixed(2) : '');
      setIncState(stub.taxes.state > 0 ? stub.taxes.state.toFixed(2) : '');
      setIncSS(stub.taxes.socialSecurity > 0 ? stub.taxes.socialSecurity.toFixed(2) : '');
      setIncMedicare(stub.taxes.medicare > 0 ? stub.taxes.medicare.toFixed(2) : '');
      setIncOther(stub.taxes.other > 0 ? stub.taxes.other.toFixed(2) : '');
      if (stub.confidence === 'low') setIncomeLowConfidence(true);
    } catch (err) {
      setIncomeError((err as Error).message);
    } finally {
      setIncomeParsing(false);
    }
  }

  // Same pattern as manualDuplicatePending — stash the pending income
  // payload so the user can choose to add it anyway.
  const [incomeDuplicatePending, setIncomeDuplicatePending] = useState<Omit<IncomeEntry, 'id'> | null>(null);

  async function submitManualIncome(entry: Omit<IncomeEntry, 'id'>, allowDuplicate = false) {
    setSubmitting(true);
    try {
      const result = await addIncome({ ...entry, allowDuplicate });
      if (result.skipped) {
        setIncomeError('An income entry with this date, description, and amount already exists.');
        setIncomeDuplicatePending(entry);
        return;
      }
      const totalTax = Object.values(entry.taxes).reduce((s, v) => s + v, 0);
      setIncomeSuccess(
        `Income of ${formatCurrency(entry.grossAmount)} recorded.` +
          (totalTax > 0 ? ` ${formatCurrency(totalTax)} in taxes has been added to your expense tracking.` : ''),
      );
      setIncDesc(''); setIncDate(''); setIncGross(''); setIncNet('');
      setIncFederal(''); setIncState(''); setIncSS(''); setIncMedicare(''); setIncOther('');
      setIncomeFile(null); setIncomeLowConfidence(false);
      setIncomeDuplicatePending(null);
    } catch (err) {
      setIncomeError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleIncomeSubmit(e: FormEvent) {
    e.preventDefault();
    setIncomeError('');
    setIncomeSuccess('');
    setIncomeDuplicatePending(null);

    if (!incDate) { setIncomeError('Please select the pay date.'); return; }
    if (!incDesc.trim()) { setIncomeError('Please enter a description (e.g. "Paycheck – Company Name").'); return; }
    const gross = parseFloat(incGross);
    if (isNaN(gross) || gross <= 0) { setIncomeError('Please enter a valid gross income amount.'); return; }
    const net = parseFloat(incNet || incGross);
    if (isNaN(net) || net <= 0) { setIncomeError('Please enter a valid net (take-home) income amount.'); return; }
    if (net > gross) { setIncomeError('Your take-home pay cannot be more than your gross pay.'); return; }

    const taxes = {
      federal: parseFloat(incFederal) || 0,
      state: parseFloat(incState) || 0,
      socialSecurity: parseFloat(incSS) || 0,
      medicare: parseFloat(incMedicare) || 0,
      other: parseFloat(incOther) || 0,
    };

    await submitManualIncome({
      date: incDate,
      description: incDesc.trim(),
      grossAmount: gross,
      netAmount: net,
      taxes,
      source: incomeFile ? 'paystub' : 'manual',
    });
  }

  async function retryIncomeAsDuplicate() {
    if (!incomeDuplicatePending) return;
    setIncomeError('');
    await submitManualIncome(incomeDuplicatePending, true);
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Enter Data</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            Upload transaction CSVs from any supported bank/credit card, or enter records manually below.
          </p>
        </div>

        {/* ── Unified Upload ── */}
        <div className="card" style={{ marginBottom: 32 }}>
          <div className="card-header">
            <h2>Upload Transactions</h2>
            <span className="text-xs text-muted">Works with any bank or card CSV — columns auto-detected</span>
          </div>

          {submitSuccess && (
            <div className="alert alert-success" style={{ marginBottom: 16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {submitSuccess}
            </div>
          )}
          {submitError && (
            <div className="alert alert-danger" style={{ marginBottom: 16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {submitError}
            </div>
          )}
          {parseErrors.length > 0 && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {parseErrors.map((err, i) => (
                <div key={i} className="alert alert-danger">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {err}
                </div>
              ))}
            </div>
          )}

          {previewRows.length === 0 ? (
            <div
              className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.5 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="drop-zone-text">Drop your CSV file here, or click to browse</p>
              <p className="drop-zone-hint">
                Handles expenses and income together. Transfers and credit card payments are skipped automatically.
              </p>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onFileSelect} />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{previewRows.length}</strong> records found
                  {skippedCount > 0 && (
                    <span className="text-muted text-xs"> &nbsp;({skippedCount} transfer{skippedCount !== 1 ? 's' : ''}/payment{skippedCount !== 1 ? 's' : ''} skipped)</span>
                  )}
                  . Review and edit before importing.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setPreviewRows([]); setParseErrors([]); setSkippedCount(0); }}>Clear</button>
                  <button className="btn btn-primary btn-sm" onClick={submitUpload} disabled={submitting || pendingDuplicateCount > 0}>
                    {submitting ? <span className="spinner" /> : `Import ${previewRows.filter((r) => r.duplicateStatus !== 'denied').length} Records`}
                  </button>
                </div>
              </div>

              {/* Duplicate banner — shown whenever any duplicates exist */}
              {totalDuplicateCount > 0 && (
                <div
                  className={`alert ${pendingDuplicateCount > 0 ? 'alert-warning' : 'alert-info'}`}
                  style={{ marginBottom: 12, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <div style={{ flex: 1 }}>
                      {pendingDuplicateCount > 0 ? (
                        <>
                          <strong>{pendingDuplicateCount}</strong> row{pendingDuplicateCount !== 1 ? 's' : ''} look{pendingDuplicateCount === 1 ? 's' : ''} like{' '}
                          {pendingDuplicateCount === 1 ? 'a duplicate' : 'duplicates'} of existing entries or earlier rows in this file.
                          Review each row below or use the batch actions. You can't import until every duplicate has been approved or denied.
                        </>
                      ) : (
                        <>All <strong>{totalDuplicateCount}</strong> potential duplicate{totalDuplicateCount !== 1 ? 's' : ''} reviewed.</>
                      )}
                    </div>
                  </div>
                  {pendingDuplicateCount > 0 && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-secondary" onClick={approveAllPendingDuplicates}>
                        Approve all {pendingDuplicateCount}
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={denyAllPendingDuplicates}>
                        Deny all {pendingDuplicateCount}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="preview-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ idx, row, duplicateStatus, duplicateMatch }) => {
                      const isIncome = row.kind === 'income';
                      const rowStyle: React.CSSProperties =
                        duplicateStatus === 'pending'
                          ? { background: 'rgba(251,191,36,0.06)', borderLeft: '3px solid var(--warning)' }
                          : duplicateStatus === 'approved'
                            ? { background: 'rgba(74,222,128,0.05)', borderLeft: '3px solid var(--success)' }
                            : duplicateStatus === 'denied'
                              ? { opacity: 0.4, textDecoration: 'line-through' }
                              : {};
                      return (
                        <tr key={idx} style={rowStyle}>
                          <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{row.date}</td>
                          <td>
                            <span
                              className="chip"
                              style={{
                                background: isIncome ? 'var(--success-bg)' : 'var(--danger-bg)',
                                color: isIncome ? 'var(--success)' : 'var(--danger)',
                                border: `1px solid ${isIncome ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
                              }}
                            >
                              {isIncome ? 'Income' : row.type === 'refund' ? 'Refund' : 'Expense'}
                            </span>
                          </td>
                          <td>
                            <input
                              className="input"
                              style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                              value={row.description}
                              onChange={(e) => updateRow(idx, (r) => ({ ...r, description: e.target.value } as ParsedCSVRow))}
                            />
                            {duplicateMatch && duplicateStatus !== 'unique' && (
                              <div
                                className="text-xs text-muted"
                                style={{ marginTop: 4, paddingLeft: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={`Matches ${duplicateMatch.source === 'existing' ? 'an existing entry' : 'an earlier row in this file'}: ${duplicateMatch.summary}`}
                              >
                                ↳ Matches {duplicateMatch.source === 'existing' ? 'existing' : 'row above'}: {duplicateMatch.summary}
                              </div>
                            )}
                          </td>
                          <td>
                            {isIncome ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              <CategorySelect
                                value={row.category as Category}
                                customCategories={userCategories.customCategories}
                                onChange={(picked) => handlePreviewCategoryChange(idx, picked)}
                                compact
                              />
                            )}
                          </td>
                          <td className={`num ${isIncome || row.type === 'refund' ? 'text-success' : 'text-danger'}`}>
                            {isIncome || row.type === 'refund' ? '+' : ''}{formatCurrency(Math.abs(row.amount))}
                          </td>
                          <td>
                            <DuplicateStatusCell
                              status={duplicateStatus}
                              onApprove={() => setDuplicateStatus(idx, 'approved')}
                              onDeny={() => setDuplicateStatus(idx, 'denied')}
                              onRevert={() => setDuplicateStatus(idx, 'pending')}
                            />
                          </td>
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => removeRow(idx)}
                              title="Remove row"
                              style={{ padding: '4px 8px' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* ── Manual Entry ── */}
        <div className="card">
          <div className="card-header">
            <h2>Manual Entry</h2>
            <div className="tabs">
              <button className={`tab ${manualTab === 'expense' ? 'active' : ''}`} onClick={() => setManualTab('expense')}>
                Expense
              </button>
              <button className={`tab ${manualTab === 'income' ? 'active' : ''}`} onClick={() => setManualTab('income')}>
                Income / Pay Stub
              </button>
            </div>
          </div>

          {manualTab === 'expense' && (
            <form onSubmit={handleManualExpense} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 560 }}>
              {manualError && (
                <div className="alert alert-danger" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{manualError}</span>
                  </div>
                  {manualDuplicatePending && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={retryManualExpenseAsDuplicate}
                        disabled={submitting}
                      >
                        Add anyway
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => { setManualDuplicatePending(null); setManualError(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
              {manualSuccess && (
                <div className="alert alert-success">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  {manualSuccess}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Date</label>
                <input type="date" className="input" value={manualDate} onChange={(e) => setManualDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <input type="text" className="input" value={manualDesc} onChange={(e) => setManualDesc(e.target.value)} placeholder="e.g. Costco – Grocery run" required />
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Amount ($)</label>
                  <input type="text" className="input" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="0.00" required />
                </div>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <CategorySelect
                    value={manualCategory}
                    customCategories={userCategories.customCategories}
                    onChange={handleManualCategoryChange}
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <span className="spinner" /> : 'Add Transaction'}
              </button>
            </form>
          )}

          {manualTab === 'income' && (
            <>
              {incomeError && (
                <div className="alert alert-danger" style={{ marginBottom: 16, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{incomeError}</span>
                  </div>
                  {incomeDuplicatePending && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={retryIncomeAsDuplicate}
                        disabled={submitting}
                      >
                        Add anyway
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => { setIncomeDuplicatePending(null); setIncomeError(''); }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
              {incomeSuccess && (
                <div className="alert alert-success" style={{ marginBottom: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  {incomeSuccess}
                </div>
              )}
              {incomeLowConfidence && (
                <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  We couldn't automatically read all values from your pay stub. Please fill in any missing fields below.
                </div>
              )}

              <div
                className={`drop-zone ${incomeParsing ? 'drag-over' : ''}`}
                style={{ marginBottom: 20, padding: '24px 16px' }}
                onClick={() => !incomeParsing && incomeFileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={async (e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) await handleIncomeFile(file); }}
              >
                {incomeParsing ? (
                  <>
                    <div className="spinner" style={{ margin: '0 auto 8px' }} />
                    <p className="drop-zone-text">Reading your pay stub…</p>
                  </>
                ) : (
                  <>
                    <p className="drop-zone-text" style={{ marginBottom: 2 }}>Upload a pay stub (PDF or CSV) to auto-fill the form</p>
                    <p className="drop-zone-hint">Values below will be pre-populated and you can adjust anything before saving.</p>
                  </>
                )}
                <input
                  ref={incomeFileRef}
                  type="file"
                  accept=".pdf,.csv"
                  style={{ display: 'none' }}
                  onChange={async (e) => { const file = e.target.files?.[0]; if (file) await handleIncomeFile(file); e.target.value = ''; }}
                />
              </div>

              <form onSubmit={handleIncomeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 600 }}>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Pay Date</label>
                    <input type="date" className="input" value={incDate} onChange={(e) => setIncDate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input type="text" className="input" value={incDesc} onChange={(e) => setIncDesc(e.target.value)} placeholder="e.g. Bi-weekly paycheck" required />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <h3 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>Pay Amounts</h3>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Gross Pay ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incGross} onChange={(e) => setIncGross(e.target.value)} placeholder="0.00" required />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Net Pay / Take-home ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incNet} onChange={(e) => setIncNet(e.target.value)} placeholder="0.00" required />
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
                  <h3 style={{ marginBottom: 4, color: 'var(--text-secondary)' }}>Tax Deductions</h3>
                  <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                    These will be recorded as expenses in your "Taxes" category. Leave blank if unknown.
                  </p>
                  <div className="grid-2">
                    <div className="form-group">
                      <label className="form-label">Federal Income Tax ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incFederal} onChange={(e) => setIncFederal(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">State Income Tax ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incState} onChange={(e) => setIncState(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Social Security ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incSS} onChange={(e) => setIncSS(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Medicare ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incMedicare} onChange={(e) => setIncMedicare(e.target.value)} placeholder="0.00" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Other Deductions ($)</label>
                      <input type="number" step="0.01" min="0" className="input" value={incOther} onChange={(e) => setIncOther(e.target.value)} placeholder="0.00" />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Save Income Record'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
