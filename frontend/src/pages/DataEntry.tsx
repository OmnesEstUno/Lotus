import { useState, useRef, FormEvent, DragEvent } from 'react';
import { CATEGORIES, Category, IncomeEntry, ParsedCSVRow, Transaction } from '../types';
import { parseTransactionCSV, parseIncomeCSV } from '../utils/csvParser';
import { parsePDFPaystub, extractIncomeFromCSVText, ExtractedPaystub } from '../utils/pdfParser';
import { addTransactions, addIncome } from '../api/client';
import { formatCurrency } from '../utils/dataProcessing';
import Layout from '../components/layout/Layout';

type ManualTab = 'expense' | 'income';

interface PreviewRow {
  idx: number;
  row: ParsedCSVRow;
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

    const result = await parseTransactionCSV(file);

    if (result.errors.length > 0 && result.rows.length === 0) {
      setParseErrors(result.errors.map((e) => e.message));
      return;
    }
    if (result.errors.length > 0) {
      setParseErrors(result.errors.map((e) => e.message));
    }
    setSkippedCount(result.skippedCount ?? 0);
    setPreviewRows(result.rows.map((row, idx) => ({ idx, row })));
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

  async function submitUpload() {
    if (previewRows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const expenseRows = previewRows.filter((r) => r.row.kind === 'expense');
      const incomeRows = previewRows.filter((r) => r.row.kind === 'income');

      let addedTxns = 0;
      if (expenseRows.length > 0) {
        const txns: Omit<Transaction, 'id'>[] = expenseRows.map((r) => {
          const row = r.row as Extract<ParsedCSVRow, { kind: 'expense' }>;
          return {
            date: row.date,
            description: row.description,
            category: row.category,
            amount: row.amount,
            type: row.type,
            source: 'csv' as const,
          };
        });
        const { added } = await addTransactions(txns);
        addedTxns = added;
      }

      for (const r of incomeRows) {
        const row = r.row as Extract<ParsedCSVRow, { kind: 'income' }>;
        await addIncome({
          date: row.date,
          description: row.description,
          grossAmount: row.amount,
          netAmount: row.amount,
          taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0, other: 0 },
          source: 'manual',
        });
      }

      const parts: string[] = [];
      if (addedTxns > 0) parts.push(`${addedTxns} expense${addedTxns !== 1 ? 's' : ''}`);
      if (incomeRows.length > 0) parts.push(`${incomeRows.length} income entr${incomeRows.length !== 1 ? 'ies' : 'y'}`);
      setSubmitSuccess(`Successfully imported ${parts.join(' and ')}.`);
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

  async function handleManualExpense(e: FormEvent) {
    e.preventDefault();
    setManualError('');
    setManualSuccess('');

    if (!manualDate) { setManualError('Please select a date for this transaction.'); return; }
    if (!manualDesc.trim()) { setManualError('Please enter a description for this transaction.'); return; }
    const amt = parseFloat(manualAmount.replace(/[^0-9.]/g, ''));
    if (isNaN(amt) || amt <= 0) { setManualError('Please enter a valid dollar amount (e.g. 45.99).'); return; }

    setSubmitting(true);
    try {
      await addTransactions([{
        date: manualDate,
        description: manualDesc.trim(),
        category: manualCategory,
        amount: -amt,
        type: 'expense',
        source: 'manual',
      }]);
      setManualSuccess(`Added "${manualDesc}" for ${formatCurrency(amt)}.`);
      setManualDate('');
      setManualDesc('');
      setManualAmount('');
      setManualCategory('Other');
    } catch (err) {
      setManualError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
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

  async function handleIncomeSubmit(e: FormEvent) {
    e.preventDefault();
    setIncomeError('');
    setIncomeSuccess('');

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

    const entry: Omit<IncomeEntry, 'id'> = {
      date: incDate,
      description: incDesc.trim(),
      grossAmount: gross,
      netAmount: net,
      taxes,
      source: incomeFile ? 'paystub' : 'manual',
    };

    setSubmitting(true);
    try {
      await addIncome(entry);
      const totalTax = Object.values(taxes).reduce((s, v) => s + v, 0);
      setIncomeSuccess(
        `Income of ${formatCurrency(gross)} recorded.` +
          (totalTax > 0 ? ` ${formatCurrency(totalTax)} in taxes has been added to your expense tracking.` : ''),
      );
      setIncDesc(''); setIncDate(''); setIncGross(''); setIncNet('');
      setIncFederal(''); setIncState(''); setIncSS(''); setIncMedicare(''); setIncOther('');
      setIncomeFile(null); setIncomeLowConfidence(false);
    } catch (err) {
      setIncomeError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
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
            <span className="text-xs text-muted">Auto-detects Chase, credit card, or bank/checking CSVs</span>
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
                  <button className="btn btn-primary btn-sm" onClick={submitUpload} disabled={submitting}>
                    {submitting ? <span className="spinner" /> : `Import ${previewRows.length} Records`}
                  </button>
                </div>
              </div>
              <div className="preview-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Category</th>
                      <th className="num">Amount</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map(({ idx, row }) => {
                      const isIncome = row.kind === 'income';
                      return (
                        <tr key={idx}>
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
                          </td>
                          <td>
                            {isIncome ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              <select
                                className="select"
                                style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                                value={row.category}
                                onChange={(e) => updateRow(idx, (r) => ({ ...r, category: e.target.value as Category } as ParsedCSVRow))}
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className={`num ${isIncome || row.type === 'refund' ? 'text-success' : 'text-danger'}`}>
                            {isIncome || row.type === 'refund' ? '+' : ''}{formatCurrency(Math.abs(row.amount))}
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
                <div className="alert alert-danger">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {manualError}
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
                  <select className="select" value={manualCategory} onChange={(e) => setManualCategory(e.target.value as Category)}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
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
                <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {incomeError}
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
