import { IncomeEntry } from '../types';
import { request, lastKnownVersion, getVersionedList } from './core';

// ─── Income ──────────────────────────────────────────────────────────────────

/**
 * Fetch all income entries. Pass `year` to scope the request to a single
 * calendar year (Task 9's YearSelector can opt into this for large datasets).
 * Always remembers the returned version for use by subsequent write calls.
 */
export async function getIncome(year?: number): Promise<IncomeEntry[]> {
  return getVersionedList<IncomeEntry, 'income'>('/api/income', 'income', 'income', year);
}

export type AddIncomeInput = Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };

export async function addIncome(
  entry: AddIncomeInput,
): Promise<{ skipped: boolean; entry: IncomeEntry | null }> {
  const expectedVersion = lastKnownVersion('income');
  if (expectedVersion === undefined) {
    throw new Error('Cannot add income without first fetching income entries.');
  }
  return request('/api/income', {
    method: 'POST',
    body: JSON.stringify({ entry, expectedVersion }),
  });
}

export type IncomeUpdate = Partial<Pick<IncomeEntry, 'date' | 'description' | 'grossAmount' | 'netAmount'>>;

export async function updateIncome(id: string, updates: IncomeUpdate): Promise<IncomeEntry> {
  const expectedVersion = lastKnownVersion('income');
  if (expectedVersion === undefined) {
    throw new Error('Cannot update income entry without first fetching income entries.');
  }
  return request(`/api/income/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...updates, expectedVersion }),
  });
}
