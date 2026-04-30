import { UserCategories } from '../types';
import { request, rememberVersion, lastKnownVersion } from './core';

// ─── User Categories ─────────────────────────────────────────────────────────

export async function getUserCategories(): Promise<UserCategories> {
  const r = await request<UserCategories & { version: number }>('/api/user-categories');
  rememberVersion('userCategories', r.version);
  // Return only the fields the rest of the frontend expects (strip version)
  return { customCategories: r.customCategories, mappings: r.mappings };
}

export async function saveUserCategories(data: UserCategories): Promise<void> {
  const expectedVersion = lastKnownVersion('userCategories');
  if (expectedVersion === undefined) {
    throw new Error('Cannot save user categories without first fetching them.');
  }
  await request('/api/user-categories', {
    method: 'PUT',
    body: JSON.stringify({ ...data, expectedVersion }),
  });
}

/** Rename a category everywhere it appears: transactions that use it, user
 *  mappings that point at it, and the customCategories list (if applicable).
 *  Returns the number of transactions and mappings that were updated. */
export async function renameCategory(
  from: string,
  to: string,
): Promise<{ updated: number; mappingsUpdated: number }> {
  const expectedTransactionsVersion = lastKnownVersion('transactions');
  const expectedUserCategoriesVersion = lastKnownVersion('userCategories');
  if (expectedTransactionsVersion === undefined) {
    throw new Error('Cannot rename category without first fetching transactions.');
  }
  if (expectedUserCategoriesVersion === undefined) {
    throw new Error('Cannot rename category without first fetching user categories.');
  }
  return request('/api/rename-category', {
    method: 'POST',
    body: JSON.stringify({ from, to, expectedTransactionsVersion, expectedUserCategoriesVersion }),
  });
}

/** Delete a category. Transactions using it get reassigned to `reassignTo`
 *  (default "Other"). Mappings pointing at it are removed. The category is
 *  removed from the user's customCategories list. */
export async function deleteCategory(
  name: string,
  reassignTo = 'Other',
): Promise<{ reassigned: number; mappingsRemoved: number }> {
  const expectedTransactionsVersion = lastKnownVersion('transactions');
  const expectedUserCategoriesVersion = lastKnownVersion('userCategories');
  if (expectedTransactionsVersion === undefined) {
    throw new Error('Cannot delete category without first fetching transactions.');
  }
  if (expectedUserCategoriesVersion === undefined) {
    throw new Error('Cannot delete category without first fetching user categories.');
  }
  return request('/api/delete-category', {
    method: 'POST',
    body: JSON.stringify({ name, reassignTo, expectedTransactionsVersion, expectedUserCategoriesVersion }),
  });
}
