import { Transaction } from '../types';
import { request, lastKnownVersion, getVersionedList } from './core';

// ─── Transactions ────────────────────────────────────────────────────────────

/**
 * Fetch all transactions. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 * Always remembers the returned version for use by subsequent write calls.
 */
export async function getTransactions(year?: number): Promise<Transaction[]> {
  return getVersionedList<Transaction, 'transactions'>('/api/transactions', 'transactions', 'transactions', year);
}

/** Payload for addTransactions — each row may carry `allowDuplicate` to
 *  explicitly bypass the server's dedup check (used when the user has
 *  approved a row that was flagged as a duplicate). */
export type AddTransactionInput = Omit<Transaction, 'id'> & { allowDuplicate?: boolean };

export async function addTransactions(
  transactions: AddTransactionInput[],
): Promise<{ added: number; skipped: number }> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot add transactions without first fetching them.');
  }
  return request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transactions, expectedVersion }),
  });
}

export type TransactionUpdate = Partial<Pick<Transaction, 'date' | 'description' | 'category' | 'amount' | 'notes' | 'archived'>>;

export async function updateTransaction(id: string, updates: TransactionUpdate): Promise<Transaction> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot update transaction without first fetching transactions.');
  }
  return request(`/api/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
}

export async function bulkUpdateCategory(
  pattern: string,
  newCategory: string,
  previousCategory?: string,
): Promise<{ updated: number }> {
  const expectedVersion = lastKnownVersion('transactions');
  if (expectedVersion === undefined) {
    throw new Error('Cannot bulk-update categories without first fetching transactions.');
  }
  return request('/api/transactions/bulk-update-category', {
    method: 'POST',
    body: JSON.stringify({ pattern, newCategory, previousCategory, expectedVersion }),
  });
}

/** Delete a mixed set of transactions and income entries in a single call. */
export async function bulkDelete(
  transactionIds: string[],
  incomeIds: string[],
): Promise<{ deletedTransactions: number; deletedIncome: number }> {
  const body: Record<string, unknown> = { transactionIds, incomeIds };
  if (transactionIds.length > 0) {
    const v = lastKnownVersion('transactions');
    if (v === undefined) throw new Error('Cannot delete transactions without first fetching them.');
    body.expectedTransactionsVersion = v;
  }
  if (incomeIds.length > 0) {
    const v = lastKnownVersion('income');
    if (v === undefined) throw new Error('Cannot delete income entries without first fetching them.');
    body.expectedIncomeVersion = v;
  }
  return request('/api/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Irreversibly wipes all transactions and income entries. Keeps user
 *  categories and mappings. Caller must have already obtained explicit
 *  confirmation from the user before invoking this. */
export async function purgeAllData(): Promise<void> {
  await request('/api/purge-all', {
    method: 'POST',
    body: JSON.stringify({ confirm: true }),
  });
}
