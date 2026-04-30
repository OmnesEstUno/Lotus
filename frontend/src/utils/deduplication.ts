// Client-side dedup helpers. Must mirror the key logic in worker/src/index.ts
// so client-detected duplicates match what the server would detect.
//
// Two rows are identical when their date, normalized description (trimmed +
// lowercased), and rounded amount (2 decimals) all match.

import { IncomeEntry, ParsedCSVRow, Transaction } from '../types';

function transactionDedupKey(t: Pick<Transaction, 'date' | 'description' | 'amount'>): string {
  const desc = (t.description ?? '').trim().toLowerCase();
  const amount = Number(t.amount).toFixed(2);
  return `${t.date}|${desc}|${amount}`;
}

function incomeDedupKey(e: Pick<IncomeEntry, 'date' | 'description' | 'netAmount'>): string {
  const desc = (e.description ?? '').trim().toLowerCase();
  const amount = Number(e.netAmount).toFixed(2);
  return `${e.date}|${desc}|${amount}`;
}

function rowDedupKey(row: ParsedCSVRow): string {
  if (row.kind === 'income') {
    return incomeDedupKey({ date: row.date, description: row.description, netAmount: row.amount });
  }
  return transactionDedupKey({ date: row.date, description: row.description, amount: row.amount });
}

/**
 * A description of where a duplicate was found — either in the user's
 * pre-existing data or earlier in the current upload batch. Used by the
 * DataEntry preview to show a user-facing summary of the matching row.
 */
export type DuplicateMatch =
  | { source: 'existing'; summary: string }
  | { source: 'batch'; summary: string };

/**
 * A richer lookup structure than a plain Set — we keep a Map keyed by the
 * dedup key so we can retrieve the matching row for preview purposes.
 */
export interface ExistingDedupLookup {
  transactions: Map<string, Transaction>;
  income: Map<string, IncomeEntry>;
}

export function buildExistingDedupLookup(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
): ExistingDedupLookup {
  const txnMap = new Map<string, Transaction>();
  for (const t of transactions) txnMap.set(transactionDedupKey(t), t);
  const incMap = new Map<string, IncomeEntry>();
  for (const e of incomeEntries) incMap.set(incomeDedupKey(e), e);
  return { transactions: txnMap, income: incMap };
}

/** One-line summary used in the UI for a duplicate's "twin" row. */
function summarizeTxn(t: Transaction): string {
  return `${t.date} · ${t.description} · $${Math.abs(t.amount).toFixed(2)}`;
}
function summarizeIncome(e: IncomeEntry): string {
  return `${e.date} · ${e.description} · $${e.netAmount.toFixed(2)}`;
}
function summarizeParsedRow(row: ParsedCSVRow): string {
  return `${row.date} · ${row.description} · $${Math.abs(row.amount).toFixed(2)}`;
}

/**
 * Find a duplicate match for a parsed row. Checks the user's existing data
 * first, then rows earlier in the current batch. Returns null for unique
 * rows, or a `DuplicateMatch` describing which row it collides with.
 */
export function findDuplicateMatch(
  row: ParsedCSVRow,
  existing: ExistingDedupLookup,
  seenInBatchTxn: Map<string, ParsedCSVRow>,
  seenInBatchIncome: Map<string, ParsedCSVRow>,
): DuplicateMatch | null {
  const key = rowDedupKey(row);

  if (row.kind === 'income') {
    const existingHit = existing.income.get(key);
    if (existingHit) {
      return { source: 'existing', summary: summarizeIncome(existingHit) };
    }
    const batchHit = seenInBatchIncome.get(key);
    if (batchHit) {
      return { source: 'batch', summary: summarizeParsedRow(batchHit) };
    }
    return null;
  }

  const existingHit = existing.transactions.get(key);
  if (existingHit) {
    return { source: 'existing', summary: summarizeTxn(existingHit) };
  }
  const batchHit = seenInBatchTxn.get(key);
  if (batchHit) {
    return { source: 'batch', summary: summarizeParsedRow(batchHit) };
  }
  return null;
}

/** Record a row in the appropriate in-batch map after it's been processed. */
export function recordRowInBatch(
  row: ParsedCSVRow,
  seenInBatchTxn: Map<string, ParsedCSVRow>,
  seenInBatchIncome: Map<string, ParsedCSVRow>,
): void {
  const key = rowDedupKey(row);
  if (row.kind === 'income') {
    seenInBatchIncome.set(key, row);
  } else {
    seenInBatchTxn.set(key, row);
  }
}
