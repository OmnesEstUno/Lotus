/**
 * Re-export shim — transitional file while consumers are migrated to
 * per-resource imports.  Will be deleted once all imports are updated.
 */

export { ConflictError, lastKnownVersion } from './core';

export {
  subscribeActiveInstance,
  getActiveInstanceId,
  setActiveInstanceIdLocal,
  subscribeUsername,
  getCurrentUsername,
  isAuthenticated,
  getSetupStatus,
  initSetup,
  confirmSetup,
  login,
  verify2FA,
  logout,
  migrateLegacy,
} from './auth';

export {
  getTransactions,
  addTransactions,
  updateTransaction,
  bulkUpdateCategory,
  bulkDelete,
  purgeAllData,
} from './transactions';
export type { AddTransactionInput, TransactionUpdate } from './transactions';

export {
  getIncome,
  addIncome,
  updateIncome,
} from './income';
export type { AddIncomeInput, IncomeUpdate } from './income';

export {
  getUserCategories,
  saveUserCategories,
  renameCategory,
  deleteCategory,
} from './categories';

export {
  getInstances,
  createInstance,
  renameInstance,
  deleteInstance,
  removeInstanceMember,
  setActiveInstance,
} from './instances';

export {
  adminInit,
  createInvite,
  listInvites,
  deleteInvite,
  createWorkspaceInvite,
  listWorkspaceInvites,
  deleteWorkspaceInvite,
  acceptWorkspaceInvite,
  getWorkspaceInviteMeta,
} from './invites';
export type { InviteSummary, WorkspaceInviteSummary } from './invites';

export {
  submitFeatureRequest,
  listFeatureRequests,
} from './featureRequests';
export type { FeatureRequest } from './featureRequests';
