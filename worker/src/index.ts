/**
 * Lotus Cloudflare Worker
 *
 * Zero external dependencies — all crypto via Web Crypto API.
 *
 * Setup:
 *   wrangler kv namespace create FINANCE_KV
 *   wrangler secret put JWT_SECRET        # random 40+ char string
 *   wrangler deploy
 */

import {
  hashPassword,
  verifyPassword,
  signJWT,
  verifyJWT,
  generateTOTPSecret,
  verifyTOTP,
} from './auth/crypto';
import { checkAndIncrement, clearRateLimit } from './auth/rateLimit';
import { beginRegistration, finishRegistration } from './auth/webauthn';
import { migrateSingleUserToMultiTenant, createDefaultInstance, instanceMetaKey, migrateToYearPartitioned } from './storage/kvMigrations';
import { createInvite, verifyInvite, markInviteUsed, listInvites, deleteInvite } from './invites/inviteTokens';
import {
  createWorkspaceInvite,
  verifyWorkspaceInvite,
  markWorkspaceInviteUsed,
  listWorkspaceInvites,
  deleteWorkspaceInvite,
} from './invites/workspaceInvites';
import {
  readAllYears,
  readAllYearsWithVersion,
  readYears,
  writeAllYears,
  upsertInYear,
  updateInAnyYear,
  deleteFromAnyYear,
  yearOfISODate,
} from './storage/paginatedYearStorage';
import { JWT_TTL_SECONDS, PREAUTH_TTL_SECONDS, KV_PREFIXES, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_SECONDS, TOTP_MAX_ATTEMPTS, TOTP_LOCKOUT_SECONDS, MAX_BATCH_SIZE, MAX_BULK_IDS, BIOMETRIC_REAUTH_THRESHOLD_SECONDS, WEBAUTHN_REGISTER_MAX_ATTEMPTS, WEBAUTHN_REGISTER_LOCKOUT_SECONDS } from './constants';
import type { KVNamespace } from '@cloudflare/workers-types';

export interface Env {
  FINANCE_KV: KVNamespace;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  ADMIN_INIT_SECRET?: string;   // optional — absence disables /api/admin/init
  RP_ID: string;
  RP_ORIGIN: string;
}

/** Auth context returned by authenticate(). */
interface AuthContext { username: string; iat: number }

// ─── Instance type ────────────────────────────────────────────────────────────

interface Instance {
  id: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: string;
  /** Optimistic-concurrency version.  Missing on legacy records → treated as 0. */
  version: number;
}

// ─── User profile type ────────────────────────────────────────────────────────

interface UserProfile {
  passwordHash: string;
  totpSecret: string;
  createdAt: string;
  confirmed: boolean;
  pendingInviteId?: string;
  instanceIds?: string[];
  activeInstanceId?: string | null;
}

// ─── CORS ────────────────────────────────────────────────────────────────────

function corsHeaders(origin: string | null, allowedOrigin: string): Record<string, string> {
  // Allow localhost for dev (any port) + the configured production origin.
  // Default to empty string (not '*') so browsers reject unrecognised origins.
  const isLocalhost = !!origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const matchesAllowed = !!origin && !!allowedOrigin && origin === allowedOrigin;

  let allowOrigin = '';
  if (isLocalhost || matchesAllowed) allowOrigin = origin!;

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Instance-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

function respond(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...SECURITY_HEADERS,
      ...headers,
    },
  });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
    if (payload.authenticated !== true || typeof payload.username !== 'string') return null;
    // Legacy tokens (issued before iat was added) lack the claim. Treat them
    // as freshly issued so session-age gates don't reject existing sessions
    // at rollout — the user can still re-auth via TOTP explicitly if needed.
    const iat = typeof payload.iat === 'number' ? payload.iat : Math.floor(Date.now() / 1000);
    return { username: payload.username, iat };
  } catch {
    return null;
  }
}

async function requireAuth(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<AuthContext | Response> {
  const auth = await authenticate(request, env);
  if (!auth) return respond({ error: 'Unauthorized' }, 401, cors);
  return auth;
}

async function authenticateAdmin(request: Request, env: Env, cors: Record<string, string>): Promise<AuthContext | Response> {
  const auth = await requireAuth(request, env, cors);
  if (auth instanceof Response) return auth;
  if (auth.username !== 'admin') return respond({ error: 'Forbidden' }, 403, cors);
  return auth;
}

async function authenticateInstanceOwner(
  request: Request,
  env: Env,
  instanceId: string,
  cors: Record<string, string>,
): Promise<{ auth: AuthContext; inst: Instance } | Response> {
  const auth = await requireAuth(request, env, cors);
  if (auth instanceof Response) return auth;
  const raw = await env.FINANCE_KV.get(instanceMetaKey(instanceId));
  if (!raw) return respond({ error: 'Not found.' }, 404, cors);
  const inst = JSON.parse(raw) as Instance;
  if (inst.owner !== auth.username) return respond({ error: 'Only the owner can do this.' }, 403, cors);
  return { auth, inst };
}

// ─── Username helpers ─────────────────────────────────────────────────────────

async function getUsernames(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get('meta:usernames');
  return raw ? JSON.parse(raw) : [];
}

async function addUsername(kv: KVNamespace, username: string): Promise<void> {
  const existing = await getUsernames(kv);
  if (!existing.includes(username)) {
    await kv.put('meta:usernames', JSON.stringify([...existing, username]));
  }
}

// ─── KV key scoping ───────────────────────────────────────────────────────────

const userKey = (username: string, leaf: 'profile' | 'data:transactions' | 'data:income' | 'data:userCategories') =>
  KV_PREFIXES.USER(username, leaf);

const instanceKey = (instanceId: string, leaf: 'data:transactions' | 'data:income' | 'data:userCategories') =>
  KV_PREFIXES.INSTANCE_DATA(instanceId, leaf);

// ─── User profile helpers ─────────────────────────────────────────────────────

async function getUserProfile(kv: KVNamespace, username: string): Promise<UserProfile | null> {
  const raw = await kv.get(userKey(username, 'profile'));
  if (!raw) return null;
  return JSON.parse(raw) as UserProfile;
}

async function saveUserProfile(kv: KVNamespace, username: string, profile: UserProfile): Promise<void> {
  await kv.put(userKey(username, 'profile'), JSON.stringify(profile));
}

// ─── Instance resolver middleware ─────────────────────────────────────────────

async function resolveInstance(
  request: Request,
  auth: AuthContext,
  env: Env,
  cors: Record<string, string>,
): Promise<{ instanceId: string; instance: Instance } | Response> {
  const instanceId = request.headers.get('X-Instance-Id');
  if (!instanceId) return respond({ error: 'Missing instance.' }, 400, cors);
  const raw = await env.FINANCE_KV.get(instanceMetaKey(instanceId));
  if (!raw) return respond({ error: 'Instance not found.' }, 404, cors);
  const instance = JSON.parse(raw) as Instance;
  if (!instance.members.includes(auth.username)) return respond({ error: 'Forbidden.' }, 403, cors);
  return { instanceId, instance };
}

// ─── Timing-safe dummy hash (lazy, computed once per worker lifetime) ─────────

let cachedDummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (cachedDummyHash ??= hashPassword(`dummy:${crypto.randomUUID()}`));
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

type Transaction = { id: string; date: string; description: string; notes: string; archived?: boolean; category: string; amount: number; type: string; source: string };
type TaxBreakdown = { federal: number; state: number; socialSecurity: number; medicare: number; other: number };
type IncomeEntry = { id: string; date: string; description: string; grossAmount: number; netAmount: number; taxes: TaxBreakdown; source: string };

async function getTransactions(kv: KVNamespace, instanceId: string): Promise<Transaction[]> {
  return readAllYears<Transaction>(kv, instanceKey(instanceId, 'data:transactions'));
}

async function getTransactionsWithVersion(kv: KVNamespace, instanceId: string): Promise<{ items: Transaction[]; version: number }> {
  return readAllYearsWithVersion<Transaction>(kv, instanceKey(instanceId, 'data:transactions'));
}

async function saveTransactions(kv: KVNamespace, instanceId: string, txns: Transaction[]): Promise<void> {
  return writeAllYears<Transaction>(kv, instanceKey(instanceId, 'data:transactions'), txns, (t) => yearOfISODate(t.date));
}

async function getIncomeEntries(kv: KVNamespace, instanceId: string): Promise<IncomeEntry[]> {
  return readAllYears<IncomeEntry>(kv, instanceKey(instanceId, 'data:income'));
}

async function getIncomeEntriesWithVersion(kv: KVNamespace, instanceId: string): Promise<{ items: IncomeEntry[]; version: number }> {
  return readAllYearsWithVersion<IncomeEntry>(kv, instanceKey(instanceId, 'data:income'));
}

async function saveIncomeEntries(kv: KVNamespace, instanceId: string, entries: IncomeEntry[]): Promise<void> {
  return writeAllYears<IncomeEntry>(kv, instanceKey(instanceId, 'data:income'), entries, (i) => yearOfISODate(i.date));
}

async function getUserCategoriesVersion(kv: KVNamespace, instanceId: string): Promise<number> {
  const raw = await kv.get(instanceKey(instanceId, 'data:userCategories'));
  if (!raw) return 0;
  const data = JSON.parse(raw) as { version?: number };
  return typeof data.version === 'number' ? data.version : 0;
}

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Deletes all year shards and the index key for a paginated data prefix.
 * Used by DELETE /api/instances/:id to cascade-delete year-partitioned data.
 */
async function deletePaginatedSlice(kv: KVNamespace, prefix: string): Promise<void> {
  const indexRaw = await kv.get(`${prefix}:index`);
  if (indexRaw) {
    const { years } = JSON.parse(indexRaw) as { years: number[] };
    await Promise.all(years.map((y) => kv.delete(`${prefix}:${y}`)));
    await kv.delete(`${prefix}:index`);
  }
}

/**
 * Boilerplate wrapper for endpoints that mutate a versioned resource.
 *
 * Caller is responsible for ALL security decisions:
 *  - Authentication  (JWT verify via requireAuth / authenticate)
 *  - Authorization   (membership via resolveInstance, ownership, admin)
 *  - Body schema validation (fields beyond expectedVersion)
 *
 * This helper handles ONLY concurrency control:
 *  - Validates expectedVersion is a number  →  400 if not
 *  - Reads the current version via readCurrent()
 *  - Compares versions  →  409 with currentVersion if mismatch
 *  - Calls operate(data, currentVersion) and returns its Response
 *
 * @param readCurrent  Async fn that returns { data, version }.  Pass `data: undefined`
 *                     when the endpoint only needs the version (e.g. DELETE, in-place PUT).
 * @param operate      Receives the data and currentVersion; responsible for performing
 *                     the mutation, saving, and returning the final Response.
 */
async function mutateVersioned<T>(
  cors: Record<string, string>,
  expectedVersion: unknown,
  readCurrent: () => Promise<{ data: T; version: number }>,
  operate: (data: T, currentVersion: number) => Promise<Response>,
): Promise<Response> {
  if (typeof expectedVersion !== 'number') {
    return respond({ error: 'expectedVersion required' }, 400, cors);
  }
  const { data, version: currentVersion } = await readCurrent();
  if (expectedVersion !== currentVersion) {
    return respond({ error: 'conflict', currentVersion }, 409, cors);
  }
  return operate(data, currentVersion);
}

/**
 * Stable key for identifying duplicate transactions. Two transactions are
 * considered identical when their date, normalized description, and amount
 * (rounded to 2 decimals) all match.
 */
function transactionKey(t: Pick<Transaction, 'date' | 'description' | 'amount'>): string {
  const desc = (t.description ?? '').trim().toLowerCase();
  const amount = Number(t.amount).toFixed(2);
  return `${t.date}|${desc}|${amount}`;
}

/**
 * Same concept for income entries: compares date, description, and net
 * (take-home) amount.
 */
function incomeKey(e: Pick<IncomeEntry, 'date' | 'description' | 'netAmount'>): string {
  const desc = (e.description ?? '').trim().toLowerCase();
  const amount = Number(e.netAmount).toFixed(2);
  return `${e.date}|${desc}|${amount}`;
}

// ─── Main fetch handler ───────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN ?? '');

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // ── Admin Bootstrap ──
      if (path === '/api/admin/init' && method === 'POST') {
        const adminSecret = env.ADMIN_INIT_SECRET ?? '';
        const provided = request.headers.get('X-Admin-Secret') ?? '';
        if (!adminSecret) {
          return respond({ error: 'Unauthorized' }, 401, cors);
        }
        // Constant-time compare over padded strings — no length-leak via early return.
        const maxLen = Math.max(provided.length, adminSecret.length);
        let mismatch = provided.length ^ adminSecret.length;
        for (let i = 0; i < maxLen; i++) {
          const a = i < provided.length ? provided.charCodeAt(i) : 0;
          const b = i < adminSecret.length ? adminSecret.charCodeAt(i) : 0;
          mismatch |= a ^ b;
        }
        if (mismatch !== 0) return respond({ error: 'Unauthorized' }, 401, cors);

        const existing = await env.FINANCE_KV.get(userKey('admin', 'profile'));
        if (existing) return respond({ error: 'Admin already exists.' }, 400, cors);

        const body = await request.json() as { password?: string };
        if (!body.password || body.password.length < 12) {
          return respond({ error: 'Password must be at least 12 characters.' }, 400, cors);
        }
        const passwordHash = await hashPassword(body.password);
        const totpSecret = generateTOTPSecret();
        const defaultInstance = await createDefaultInstance(env.FINANCE_KV, 'admin');
        const profile: UserProfile = {
          passwordHash, totpSecret,
          createdAt: new Date().toISOString(),
          confirmed: true,              // admin is pre-confirmed — no TOTP confirm step
          instanceIds: [defaultInstance.id],
          activeInstanceId: defaultInstance.id,
        };
        await env.FINANCE_KV.put(userKey('admin', 'profile'), JSON.stringify(profile));
        await addUsername(env.FINANCE_KV, 'admin');
        await env.FINANCE_KV.put('meta:initialized', 'true');

        const otpauthUrl = `otpauth://totp/Lotus:admin?secret=${totpSecret}&issuer=Lotus`;
        return respond({ totpSecret, otpauthUrl }, 200, cors);
      }

      // ── Admin Invite CRUD ──
      if (path === '/api/admin/invites' && method === 'POST') {
        const auth = await authenticateAdmin(request, env, cors);
        if (auth instanceof Response) return auth;
        const result = await createInvite(env.FINANCE_KV, env.JWT_SECRET);
        return respond(result, 200, cors);
      }

      if (path === '/api/admin/invites' && method === 'GET') {
        const auth = await authenticateAdmin(request, env, cors);
        if (auth instanceof Response) return auth;
        const invites = await listInvites(env.FINANCE_KV, env.JWT_SECRET);
        return respond({ invites }, 200, cors);
      }

      {
        const m = path.match(/^\/api\/admin\/invites\/([^/]+)$/);
        if (m && method === 'DELETE') {
          const auth = await authenticateAdmin(request, env, cors);
          if (auth instanceof Response) return auth;
          await deleteInvite(env.FINANCE_KV, m[1]);
          return respond({ ok: true }, 200, cors);
        }
      }

      // ── Admin: one-time year-partition migration ──
      if (path === '/api/admin/migrate-years' && method === 'POST') {
        const authResult = await authenticateAdmin(request, env, cors);
        if (authResult instanceof Response) return authResult;
        if ((await env.FINANCE_KV.get('meta:yearPartitioned')) === 'true') {
          return respond({ error: 'Already year-partitioned.' }, 400, cors);
        }
        const usernames = await getUsernames(env.FINANCE_KV);
        let migrated = 0;
        let skipped = 0;
        const failures: Array<{ instanceId: string; error: string }> = [];
        for (const u of usernames) {
          const profile = await getUserProfile(env.FINANCE_KV, u);
          if (!profile) continue;
          for (const id of profile.instanceIds ?? []) {
            const flagKey = `meta:yearPartitioned:${id}`;
            if ((await env.FINANCE_KV.get(flagKey)) === 'true') { skipped++; continue; }
            try {
              await migrateToYearPartitioned(env.FINANCE_KV, id);
              await env.FINANCE_KV.put(flagKey, 'true');
              migrated++;
            } catch (err) {
              failures.push({ instanceId: id, error: (err as Error).message });
            }
          }
        }
        if (failures.length === 0) {
          await env.FINANCE_KV.put('meta:yearPartitioned', 'true');
        }
        return respond({ ok: failures.length === 0, migrated, skipped, failures }, 200, cors);
      }

      // ── Setup Status ──
      if (path === '/api/setup/status' && method === 'GET') {
        const metaInitialized = (await env.FINANCE_KV.get('meta:initialized')) === 'true';
        if (metaInitialized) return respond({ initialized: true, migrationPending: false }, 200, cors);
        const legacyInitialized = (await env.FINANCE_KV.get('auth:initialized')) === 'true';
        return respond({ initialized: legacyInitialized, migrationPending: legacyInitialized }, 200, cors);
      }

      // ── Initialize Setup ──
      if (path === '/api/setup/init' && method === 'POST') {
        const body = await request.json() as { username?: string; password?: string; inviteToken?: string };
        const username = (body.username ?? '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
          return respond({ error: 'Username must be 3–32 characters: lowercase letters, digits, underscore, or dash.' }, 400, cors);
        }
        if (username === 'admin') {
          return respond({ error: 'This username is reserved.' }, 400, cors);
        }
        if (!body.password || body.password.length < 8) {
          return respond({ error: 'Password must be at least 8 characters.' }, 400, cors);
        }

        // Verify invite BEFORE any KV writes for the new user
        const inviteToken = (body.inviteToken ?? '').trim();
        if (!inviteToken) {
          return respond({ error: 'An invite token is required to sign up.' }, 400, cors);
        }
        const invite = await verifyInvite(env.FINANCE_KV, inviteToken, env.JWT_SECRET);
        if (!invite.ok) {
          return respond({ error: `Invite rejected: ${invite.reason}` }, 400, cors);
        }

        const existing = await getUsernames(env.FINANCE_KV);
        if (existing.includes(username)) return respond({ error: 'Username already exists.' }, 400, cors);

        const passwordHash = await hashPassword(body.password);
        const totpSecret = generateTOTPSecret();
        const profile = {
          passwordHash,
          totpSecret,
          createdAt: new Date().toISOString(),
          confirmed: false,
          pendingInviteId: invite.id,      // bound for confirm
        };
        await env.FINANCE_KV.put(userKey(username, 'profile'), JSON.stringify(profile));

        const setupTokenId = crypto.randomUUID();
        await env.FINANCE_KV.put(
          `setup-token:${setupTokenId}`,
          JSON.stringify({ username, inviteId: invite.id }),
          { expirationTtl: 90 },
        );
        return respond({ totpSecret, username, setupToken: setupTokenId }, 200, cors);
      }

      // ── Confirm TOTP Setup ──
      if (path === '/api/setup/confirm' && method === 'POST') {
        const body = await request.json() as { username?: string; totpCode?: string; setupToken?: string };
        const { setupToken } = body;
        if (!setupToken || typeof setupToken !== 'string') {
          return respond({ error: 'Missing setup token.' }, 400, cors);
        }
        const tokRaw = await env.FINANCE_KV.get(`setup-token:${setupToken}`);
        if (!tokRaw) return respond({ error: 'Setup token expired. Please retry from invite link.' }, 400, cors);
        const tok = JSON.parse(tokRaw) as { username: string; inviteId: string };
        const username = (body.username ?? '').trim().toLowerCase();
        if (tok.username !== username) {
          return respond({ error: 'Token does not match username.' }, 400, cors);
        }
        const raw = await env.FINANCE_KV.get(userKey(username, 'profile'));
        if (!raw) return respond({ error: 'Setup not started for this user.' }, 400, cors);
        const profile = JSON.parse(raw) as { totpSecret: string; confirmed: boolean };
        if (!body.totpCode) return respond({ error: 'Missing TOTP code.' }, 400, cors);

        const valid = await verifyTOTP(profile.totpSecret, body.totpCode);
        if (!valid) return respond({ error: 'Invalid code.' }, 400, cors);

        profile.confirmed = true;

        if ((profile as { pendingInviteId?: string }).pendingInviteId) {
          const inviteId = (profile as { pendingInviteId?: string }).pendingInviteId!;
          const marked = await markInviteUsed(env.FINANCE_KV, inviteId, username);
          if (!marked) console.warn(`Invite ${inviteId} could not be marked used for ${username} (expired or revoked).`);
          const p = profile as { pendingInviteId?: string };
          delete p.pendingInviteId;
        }

        const defaultInstance = await createDefaultInstance(env.FINANCE_KV, username);
        (profile as UserProfile).instanceIds = [defaultInstance.id];
        (profile as UserProfile).activeInstanceId = defaultInstance.id;

        await env.FINANCE_KV.put(userKey(username, 'profile'), JSON.stringify(profile));
        await addUsername(env.FINANCE_KV, username);
        await env.FINANCE_KV.put('meta:initialized', 'true');

        await env.FINANCE_KV.delete(`setup-token:${setupToken}`);
        return respond({ ok: true }, 200, cors);
      }

      // ── Login ──
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json() as { username?: string; password?: string };
        const username = (body.username ?? '').trim().toLowerCase();
        if (!username || !body.password) return respond({ error: 'Invalid credentials.' }, 401, cors);

        // Rate-limit before any KV reads — covers both "user not found" and "wrong password" paths.
        const limitKey = KV_PREFIXES.RATELIMIT_LOGIN(username);
        const rl = await checkAndIncrement(env.FINANCE_KV, limitKey, LOGIN_MAX_ATTEMPTS, LOGIN_LOCKOUT_SECONDS);
        if (!rl.allowed) {
          return respond({ error: `Too many attempts. Try again in ${Math.ceil(rl.remainingSeconds / 60)} minute(s).` }, 429, cors);
        }

        const raw = await env.FINANCE_KV.get(userKey(username, 'profile'));
        if (!raw) {
          // Run a dummy verify to equalize response time regardless of whether
          // the username exists, preventing a timing oracle on username existence.
          await verifyPassword(body.password, await getDummyHash());
          return respond({ error: 'Invalid credentials.' }, 401, cors);
        }
        const profile = JSON.parse(raw) as { passwordHash: string };

        const valid = await verifyPassword(body.password, profile.passwordHash);
        if (!valid) return respond({ error: 'Invalid credentials.' }, 401, cors);

        // Clear rate-limit counter on successful password verification.
        await clearRateLimit(env.FINANCE_KV, limitKey);

        const preAuthId = crypto.randomUUID();
        const preAuthToken = await signJWT(
          { preAuth: true, id: preAuthId, username, exp: Math.floor(Date.now() / 1000) + PREAUTH_TTL_SECONDS },
          env.JWT_SECRET,
        );

        await env.FINANCE_KV.put(KV_PREFIXES.PREAUTH(preAuthId), username, { expirationTtl: PREAUTH_TTL_SECONDS });
        return respond({ preAuthToken }, 200, cors);
      }

      // ── Verify 2FA ──
      if (path === '/api/auth/verify-2fa' && method === 'POST') {
        const body = await request.json() as { preAuthToken?: string; totpCode?: string };
        if (!body.preAuthToken || !body.totpCode) {
          return respond({ error: 'Missing fields.' }, 400, cors);
        }

        let payload: Record<string, unknown>;
        try {
          payload = await verifyJWT(body.preAuthToken, env.JWT_SECRET);
        } catch {
          return respond({ error: 'Session expired. Please log in again.' }, 401, cors);
        }

        if (!payload.preAuth || typeof payload.id !== 'string' || typeof payload.username !== 'string') {
          return respond({ error: 'Invalid token.' }, 401, cors);
        }

        const username = payload.username;
        const preAuthId = payload.id;
        const stored = await env.FINANCE_KV.get(KV_PREFIXES.PREAUTH(preAuthId));
        if (stored !== username) return respond({ error: 'Session expired.' }, 401, cors);

        // Rate-limit by preauth token ID before checking the TOTP code.
        const totpLimitKey = KV_PREFIXES.RATELIMIT_TOTP(preAuthId);
        const totpRl = await checkAndIncrement(env.FINANCE_KV, totpLimitKey, TOTP_MAX_ATTEMPTS, TOTP_LOCKOUT_SECONDS);
        if (!totpRl.allowed) {
          return respond({ error: `Too many attempts. Try again in ${totpRl.remainingSeconds} second(s).` }, 429, cors);
        }

        const raw = await env.FINANCE_KV.get(userKey(username, 'profile'));
        if (!raw) return respond({ error: 'User not found.' }, 401, cors);
        const profile = JSON.parse(raw) as { totpSecret: string };

        const valid = await verifyTOTP(profile.totpSecret, body.totpCode);
        if (!valid) return respond({ error: 'Invalid or expired code.' }, 401, cors);

        // Clear rate-limit and preauth token on success.
        await clearRateLimit(env.FINANCE_KV, totpLimitKey);
        await env.FINANCE_KV.delete(KV_PREFIXES.PREAUTH(preAuthId));

        const now = Math.floor(Date.now() / 1000);
        const token = await signJWT(
          { authenticated: true, username, iat: now, exp: now + JWT_TTL_SECONDS },
          env.JWT_SECRET,
        );

        return respond({ token, username }, 200, cors);
      }

      // ── Logout ──
      if (path === '/api/auth/logout' && method === 'POST') {
        return respond({ ok: true }, 200, cors);
      }

      // ── Migrate legacy single-user data ──
      if (path === '/api/setup/migrate' && method === 'POST') {
        const metaInit = (await env.FINANCE_KV.get('meta:initialized')) === 'true';
        if (metaInit) return respond({ error: 'Already migrated.' }, 400, cors);

        const body = await request.json() as { username?: string; password?: string };
        const username = (body.username ?? '').trim().toLowerCase();
        if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
          return respond({ error: 'Invalid username format.' }, 400, cors);
        }

        const legacyHash = await env.FINANCE_KV.get('auth:passwordHash');
        if (!legacyHash) return respond({ error: 'No legacy data to migrate.' }, 400, cors);

        const ok = await verifyPassword(body.password ?? '', legacyHash);
        if (!ok) return respond({ error: 'Invalid credentials.' }, 401, cors);

        const result = await migrateSingleUserToMultiTenant(env.FINANCE_KV, username);
        return respond({ ok: true, ...result }, 200, cors);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Protected routes — require valid JWT
      // ─────────────────────────────────────────────────────────────────────
      const auth = await requireAuth(request, env, cors);
      if (auth instanceof Response) return auth;

      const { username, iat } = auth;

      // ── Biometric: register-begin ──
      if (path === '/api/auth/biometric-register-begin' && method === 'POST') {
        const rl = await checkAndIncrement(
          env.FINANCE_KV,
          KV_PREFIXES.RATELIMIT_WEBAUTHN_REGISTER(username),
          WEBAUTHN_REGISTER_MAX_ATTEMPTS,
          WEBAUTHN_REGISTER_LOCKOUT_SECONDS,
        );
        if (!rl.allowed) {
          return respond({ error: `Too many enrollment attempts. Try again in ${Math.ceil(rl.remainingSeconds / 60)} minute(s).` }, 429, cors);
        }

        const now = Math.floor(Date.now() / 1000);
        const sessionAge = iat > 0 ? now - iat : Number.MAX_SAFE_INTEGER;
        const body = await request.json().catch(() => ({})) as { totpCode?: string };

        if (sessionAge > BIOMETRIC_REAUTH_THRESHOLD_SECONDS) {
          if (!body.totpCode) {
            return respond({ requiresReauth: true }, 200, cors);
          }
          // Verify TOTP code
          const raw = await env.FINANCE_KV.get(KV_PREFIXES.USER(username, 'profile'));
          if (!raw) return respond({ error: 'User not found.' }, 401, cors);
          const profile = JSON.parse(raw) as { totpSecret: string };
          const valid = await verifyTOTP(profile.totpSecret, body.totpCode);
          if (!valid) return respond({ error: 'Invalid TOTP code.' }, 401, cors);
        }

        const { options } = await beginRegistration(env.FINANCE_KV as never, username, env.RP_ID, 'Lotus');
        return respond({ options }, 200, cors);
      }

      // ── Biometric: register-finish ──
      if (path === '/api/auth/biometric-register-finish' && method === 'POST') {
        const body = await request.json() as { registrationResponse?: unknown; label?: string };
        if (!body.registrationResponse) return respond({ error: 'Missing registrationResponse.' }, 400, cors);

        const result = await finishRegistration(
          env.FINANCE_KV as never,
          username,
          env.RP_ID,
          env.RP_ORIGIN,
          body.registrationResponse as never,
          body.label ?? 'Unnamed device',
        );
        if ('error' in result) return respond({ error: result.error }, 400, cors);
        return respond({ credential: result.credential }, 200, cors);
      }

      // ── Instance CRUD ──

      // List instances the user is a member of
      if (path === '/api/instances' && method === 'GET') {
        const profile = await getUserProfile(env.FINANCE_KV, username);
        if (!profile) return respond({ error: 'User profile not found.' }, 500, cors);
        const instances: Instance[] = [];
        for (const id of profile.instanceIds ?? []) {
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (raw) {
            const inst = JSON.parse(raw) as Instance;
            // Default missing version to 0 for legacy records
            inst.version = inst.version ?? 0;
            instances.push(inst);
          }
        }
        return respond({ instances, activeInstanceId: profile.activeInstanceId ?? null }, 200, cors);
      }

      // Create a new instance (the user becomes its owner)
      if (path === '/api/instances' && method === 'POST') {
        const body = await request.json() as { name?: string };
        const name = (body.name ?? '').trim();
        if (!name) return respond({ error: 'Name required.' }, 400, cors);
        const id = crypto.randomUUID();
        const instance: Instance = { id, name, owner: username, members: [username], createdAt: new Date().toISOString(), version: 1 };
        await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(instance));
        const profile = await getUserProfile(env.FINANCE_KV, username);
        if (!profile) return respond({ error: 'User profile not found.' }, 500, cors);
        profile.instanceIds = [...(profile.instanceIds ?? []), id];
        if (!profile.activeInstanceId) profile.activeInstanceId = id;
        await saveUserProfile(env.FINANCE_KV, username, profile);
        return respond(instance, 200, cors);
      }

      // Switch active instance
      if (path === '/api/instances/active' && method === 'PUT') {
        const body = await request.json() as { instanceId?: string };
        const profile = await getUserProfile(env.FINANCE_KV, username);
        if (!profile) return respond({ error: 'User profile not found.' }, 500, cors);
        const targetId = body.instanceId ?? '';
        if (!profile.instanceIds?.includes(targetId)) return respond({ error: 'Not a member.' }, 403, cors);
        // Verify the instance still exists in KV (guard against stale ids from concurrent deletes)
        const instRaw = await env.FINANCE_KV.get(instanceMetaKey(targetId));
        if (!instRaw) {
          // Opportunistic cleanup: remove stale id from profile
          profile.instanceIds = (profile.instanceIds ?? []).filter((x) => x !== targetId);
          await saveUserProfile(env.FINANCE_KV, username, profile);
          return respond({ error: 'Instance not found.' }, 404, cors);
        }
        profile.activeInstanceId = targetId;
        await saveUserProfile(env.FINANCE_KV, username, profile);
        return respond({ ok: true }, 200, cors);
      }

      {
        let m: RegExpMatchArray | null;

        // Rename instance
        if ((m = path.match(/^\/api\/instances\/([^/]+)$/)) && method === 'PUT') {
          const id = m[1];
          const body = await request.json() as { name?: string; expectedVersion?: number };
          const trimmed = (body.name ?? '').trim();
          if (!trimmed) return respond({ error: 'Name required.' }, 400, cors);
          if (typeof body.expectedVersion !== 'number') return respond({ error: 'expectedVersion (number) required.' }, 400, cors);
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (inst.owner !== username) return respond({ error: 'Only the owner can rename.' }, 403, cors);
          const currentVersion = inst.version ?? 0;
          if (body.expectedVersion !== currentVersion) {
            return respond({ error: 'Conflict: instance was modified by another request.', currentVersion }, 409, cors);
          }
          inst.name = trimmed;
          inst.version = currentVersion + 1;
          await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(inst));
          return respond(inst, 200, cors);
        }

        // Delete instance (owner only; removes data too).
        // EXEMPT from optimistic-concurrency: only the owner can delete, so a
        // double-click race from two tabs results in the second call getting a 404
        // — no silent data corruption is possible.
        if ((m = path.match(/^\/api\/instances\/([^/]+)$/)) && method === 'DELETE') {
          const id = m[1];
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (inst.owner !== username) return respond({ error: 'Only the owner can delete.' }, 403, cors);
          await Promise.all([
            env.FINANCE_KV.delete(instanceMetaKey(id)),
            deletePaginatedSlice(env.FINANCE_KV, instanceKey(id, 'data:transactions')),
            deletePaginatedSlice(env.FINANCE_KV, instanceKey(id, 'data:income')),
            env.FINANCE_KV.delete(instanceKey(id, 'data:userCategories')),
          ]);
          // Remove from every member's profile
          let partialFailures = 0;
          for (const memberUsername of inst.members) {
            try {
              const p = await getUserProfile(env.FINANCE_KV, memberUsername);
              if (!p) {
                console.warn(`Delete cascade: profile missing for member "${memberUsername}", skipping.`);
                partialFailures++;
                continue;
              }
              p.instanceIds = (p.instanceIds ?? []).filter((x) => x !== id);
              if (p.activeInstanceId === id) p.activeInstanceId = p.instanceIds[0] ?? null;
              await saveUserProfile(env.FINANCE_KV, memberUsername, p);
            } catch (err) {
              console.warn(`Delete cascade: failed to update profile for member "${memberUsername}": ${(err as Error).message}`);
              partialFailures++;
            }
          }
          if (partialFailures > 0) {
            return respond({ ok: true, partialFailures }, 200, cors);
          }
          return respond({ ok: true }, 200, cors);
        }

        // Remove member (owner, or self-removal)
        if ((m = path.match(/^\/api\/instances\/([^/]+)\/members\/([^/]+)$/)) && method === 'DELETE') {
          const id = m[1];
          const memberToRemove = m[2].toLowerCase();
          const evParam = url.searchParams.get('expectedVersion');
          if (evParam === null) return respond({ error: 'expectedVersion query parameter required.' }, 400, cors);
          const expectedVersion = Number(evParam);
          if (!Number.isFinite(expectedVersion)) return respond({ error: 'expectedVersion must be a number.' }, 400, cors);
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          const isOwner = inst.owner === username;
          const isSelfRemoval = username === memberToRemove;
          if (!isOwner && !isSelfRemoval) return respond({ error: 'Only the owner can modify members.' }, 403, cors);
          if (inst.owner === memberToRemove) return respond({ error: 'Cannot remove the owner.' }, 400, cors);
          const currentVersion = inst.version ?? 0;
          if (expectedVersion !== currentVersion) {
            return respond({ error: 'Conflict: instance was modified by another request.', currentVersion }, 409, cors);
          }
          inst.members = inst.members.filter((u) => u !== memberToRemove);
          inst.version = currentVersion + 1;
          await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(inst));
          const p = await getUserProfile(env.FINANCE_KV, memberToRemove);
          if (!p) return respond({ error: 'Member profile not found.' }, 500, cors);
          p.instanceIds = (p.instanceIds ?? []).filter((x) => x !== id);
          if (p.activeInstanceId === id) p.activeInstanceId = p.instanceIds[0] ?? null;
          await saveUserProfile(env.FINANCE_KV, memberToRemove, p);
          return respond(inst, 200, cors);
        }
      }

      // ── Workspace Invite endpoints ──

      // Accept workspace invite (any authenticated user).
      // EXEMPT from optimistic-concurrency: the invite token itself proves
      // authorization.  The accepting user has no prior read of the workspace
      // (and no version to supply), and an "already a member" guard prevents
      // duplicate-accept races from corrupting the members list.
      if (path === '/api/instances/invites/accept' && method === 'POST') {
        const body = await request.json() as { token?: string };
        const token = (body.token ?? '').trim();
        if (!token) return respond({ error: 'Token required.' }, 400, cors);
        const verified = await verifyWorkspaceInvite(env.FINANCE_KV, token, env.JWT_SECRET);
        if (!verified.ok) return respond({ error: `Invite rejected: ${verified.reason}` }, 400, cors);
        const { id: inviteId, record } = verified;
        const instRaw = await env.FINANCE_KV.get(instanceMetaKey(record.instanceId));
        if (!instRaw) return respond({ error: 'Workspace no longer exists.' }, 404, cors);
        const inst = JSON.parse(instRaw) as Instance;
        if (inst.members.includes(auth.username)) return respond({ error: 'Already a member.' }, 400, cors);
        inst.members.push(auth.username);
        inst.version = (inst.version ?? 0) + 1;
        await env.FINANCE_KV.put(instanceMetaKey(record.instanceId), JSON.stringify(inst));
        const memberProfile = await getUserProfile(env.FINANCE_KV, auth.username);
        if (!memberProfile) return respond({ error: 'User profile not found.' }, 500, cors);
        memberProfile.instanceIds = [...(memberProfile.instanceIds ?? []), record.instanceId];
        if (!memberProfile.activeInstanceId) memberProfile.activeInstanceId = record.instanceId;
        await saveUserProfile(env.FINANCE_KV, auth.username, memberProfile);
        await markWorkspaceInviteUsed(env.FINANCE_KV, inviteId, auth.username);
        return respond(inst, 200, cors);
      }

      // Get workspace invite metadata (any authenticated user, no mutation)
      if (path.startsWith('/api/instances/invites/meta') && method === 'GET') {
        const token = url.searchParams.get('token') ?? '';
        if (!token) return respond({ error: 'Token required.' }, 400, cors);
        const verified = await verifyWorkspaceInvite(env.FINANCE_KV, token, env.JWT_SECRET);
        if (!verified.ok) return respond({ error: `Invite invalid: ${verified.reason}` }, 400, cors);
        const { record } = verified;
        const instRaw = await env.FINANCE_KV.get(instanceMetaKey(record.instanceId));
        if (!instRaw) return respond({ error: 'Workspace no longer exists.' }, 404, cors);
        const inst = JSON.parse(instRaw) as Instance;
        // Members array intentionally omitted to prevent membership-roster leak via invite token.
        return respond({
          instanceName: inst.name,
          ownerUsername: inst.owner,
          expiresAt: record.expiresAt,
          usedBy: record.usedBy,
          alreadyMember: inst.members.includes(auth.username),
        }, 200, cors);
      }

      {
        let wm: RegExpMatchArray | null;

        // Create workspace invite (owner only)
        if ((wm = path.match(/^\/api\/instances\/([^/]+)\/invites$/)) && method === 'POST') {
          const ownerCheck = await authenticateInstanceOwner(request, env, wm[1], cors);
          if (ownerCheck instanceof Response) return ownerCheck;
          const result = await createWorkspaceInvite(env.FINANCE_KV, wm[1], ownerCheck.auth.username, env.JWT_SECRET);
          return respond(result, 200, cors);
        }

        // List workspace invites (owner only)
        if ((wm = path.match(/^\/api\/instances\/([^/]+)\/invites$/)) && method === 'GET') {
          const ownerCheck = await authenticateInstanceOwner(request, env, wm[1], cors);
          if (ownerCheck instanceof Response) return ownerCheck;
          const invites = await listWorkspaceInvites(env.FINANCE_KV, wm[1], env.JWT_SECRET);
          return respond({ invites }, 200, cors);
        }

        // Delete workspace invite (owner only)
        if ((wm = path.match(/^\/api\/instances\/([^/]+)\/invites\/([^/]+)$/)) && method === 'DELETE') {
          const ownerCheck = await authenticateInstanceOwner(request, env, wm[1], cors);
          if (ownerCheck instanceof Response) return ownerCheck;
          const inviteId = wm[2];
          // Verify the invite belongs to this instance before deletion
          const raw = await env.FINANCE_KV.get(`workspace-invites:${inviteId}`);
          if (!raw) return respond({ error: 'Invite not found.' }, 404, cors);
          const inviteRecord = JSON.parse(raw);
          if (inviteRecord.instanceId !== wm[1]) return respond({ error: 'Invite does not belong to this workspace.' }, 403, cors);
          await deleteWorkspaceInvite(env.FINANCE_KV, inviteId);
          return respond({ ok: true }, 200, cors);
        }
      }

      // ── Feature Requests ──

      // Submit a feature request (any authenticated user)
      if (path === '/api/feature-requests' && method === 'POST') {
        let body: { text?: unknown };
        try {
          body = await request.json();
        } catch {
          return respond({ error: 'Invalid JSON' }, 400, cors);
        }
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) return respond({ error: 'Text required.' }, 400, cors);
        if (text.length > 2000) return respond({ error: 'Text too long (max 2000 chars).' }, 400, cors);
        const createdAt = new Date().toISOString();
        const shortId = crypto.randomUUID().slice(0, 8);
        const key = `feature-requests:${createdAt}:${shortId}`;
        const record = { id: shortId, username: auth.username, text, createdAt, status: 'new' as const };
        await env.FINANCE_KV.put(key, JSON.stringify(record));
        return respond({ ok: true, id: shortId }, 201, cors);
      }

      // List all feature requests (admin only)
      if (path === '/api/feature-requests' && method === 'GET') {
        const authResult = await authenticateAdmin(request, env, cors);
        if (authResult instanceof Response) return authResult;
        const list = await env.FINANCE_KV.list({ prefix: 'feature-requests:' });
        const items: unknown[] = [];
        for (const k of list.keys) {
          const v = await env.FINANCE_KV.get(k.name);
          if (v) {
            try {
              items.push(JSON.parse(v));
            } catch {
              /* skip malformed entries */
            }
          }
        }
        // Newest first. Keys are `feature-requests:<ISO>:<short>`, so ISO string comparison works chronologically; reverse it.
        type FR = { createdAt: string };
        const sorted = (items as FR[]).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return respond({ items: sorted }, 200, cors);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Data endpoints — require valid JWT + X-Instance-Id membership check
      // ─────────────────────────────────────────────────────────────────────
      const resolved = await resolveInstance(request, auth, env, cors);
      if (resolved instanceof Response) return resolved;
      const { instanceId, instance } = resolved;

      // ── GET transactions ──
      if (path === '/api/transactions' && method === 'GET') {
        const yearParam = url.searchParams.get('year');
        const prefix = instanceKey(instanceId, 'data:transactions');
        if (yearParam) {
          // Year-scoped read: return items from that shard only.
          // Version still comes from the index so the client always has a consistent version.
          const { version } = await readAllYearsWithVersion<Transaction>(env.FINANCE_KV, prefix);
          const txns = await readYears<Transaction>(env.FINANCE_KV, prefix, [Number(yearParam)]);
          return respond({ transactions: txns, version }, 200, cors);
        }
        const { items: txns, version } = await readAllYearsWithVersion<Transaction>(env.FINANCE_KV, prefix);
        return respond({ transactions: txns, version }, 200, cors);
      }

      // ── POST transactions (batch) ──
      if (path === '/api/transactions' && method === 'POST') {
        const body = await request.json() as { transactions?: Omit<Transaction, 'id'>[]; expectedVersion?: number };
        if (typeof body.expectedVersion !== 'number') {
          return respond({ error: 'expectedVersion required' }, 400, cors);
        }
        if (!Array.isArray(body.transactions) || body.transactions.length === 0) {
          return respond({ error: 'No transactions provided.' }, 400, cors);
        }
        if (body.transactions.length > MAX_BATCH_SIZE) {
          return respond({ error: `Batch exceeds maximum of ${MAX_BATCH_SIZE}.` }, 413, cors);
        }

        const { items: existing, version: currentVersion } = await getTransactionsWithVersion(env.FINANCE_KV, instanceId);
        if (body.expectedVersion !== currentVersion) {
          return respond({ error: 'conflict', currentVersion }, 409, cors);
        }

        // Dedup: match on date + normalized description + rounded amount
        // against existing rows + previously-accepted rows in this same batch.
        // A row may carry `allowDuplicate: true` which bypasses the dedup
        // check entirely for that row (the user explicitly approved it).
        const seen = new Set(existing.map(transactionKey));
        const added: Transaction[] = [];
        let skipped = 0;

        for (const raw of body.transactions) {
          // Strip the non-persisted flag before storage
          const { allowDuplicate, ...t } = raw as Omit<Transaction, 'id'> & { allowDuplicate?: boolean };

          if (!allowDuplicate) {
            const key = transactionKey(t);
            if (seen.has(key)) {
              skipped++;
              continue;
            }
            seen.add(key);
          }
          added.push({ ...t, notes: t.notes ?? '', id: generateId() });
        }

        const txPrefix = instanceKey(instanceId, 'data:transactions');
        for (const tx of added) {
          await upsertInYear<Transaction>(env.FINANCE_KV, txPrefix, tx);
        }
        return respond({ added: added.length, skipped }, 200, cors);
      }

      // ── DELETE transaction ──
      const txnDeleteMatch = path.match(/^\/api\/transactions\/([^/]+)$/);
      if (txnDeleteMatch && method === 'DELETE') {
        if (instance.owner !== auth.username) {
          return respond({ error: 'Only the workspace owner can delete data.' }, 403, cors);
        }
        const id = txnDeleteMatch[1];
        const delBody = await request.json().catch(() => ({})) as { expectedVersion?: number };
        return mutateVersioned(
          cors,
          delBody.expectedVersion,
          () => getTransactionsWithVersion(env.FINANCE_KV, instanceId).then(({ version }) => ({ data: undefined, version })),
          async () => {
            const ok = await deleteFromAnyYear<Transaction>(
              env.FINANCE_KV,
              instanceKey(instanceId, 'data:transactions'),
              id,
            );
            if (!ok) return respond({ error: 'Transaction not found.' }, 404, cors);
            return respond({ ok: true }, 200, cors);
          },
        );
      }

      // ── PUT transaction (update editable fields in place) ──
      const txnUpdateMatch = path.match(/^\/api\/transactions\/([^/]+)$/);
      if (txnUpdateMatch && method === 'PUT') {
        const id = txnUpdateMatch[1];
        const body = await request.json() as {
          date?: string;
          description?: string;
          category?: string;
          amount?: number;
          notes?: string;
          archived?: boolean;
          expectedVersion?: number;
        };
        // Build only the fields explicitly provided so updateInAnyYear merges correctly.
        const patch: Partial<Transaction> = {};
        if (typeof body.date === 'string' && body.date) patch.date = body.date;
        if (typeof body.description === 'string') patch.description = body.description;
        if (typeof body.category === 'string' && body.category) patch.category = body.category;
        if (typeof body.amount === 'number' && !isNaN(body.amount)) patch.amount = body.amount;
        if (typeof body.notes === 'string') patch.notes = body.notes;
        if (typeof body.archived === 'boolean') patch.archived = body.archived;

        return mutateVersioned(
          cors,
          body.expectedVersion,
          () => getTransactionsWithVersion(env.FINANCE_KV, instanceId).then(({ version }) => ({ data: undefined, version })),
          async () => {
            const updated = await updateInAnyYear<Transaction>(
              env.FINANCE_KV,
              instanceKey(instanceId, 'data:transactions'),
              id,
              patch,
            );
            if (!updated) return respond({ error: 'Transaction not found.' }, 404, cors);
            return respond(updated, 200, cors);
          },
        );
      }

      // ── GET income ──
      if (path === '/api/income' && method === 'GET') {
        const yearParam = url.searchParams.get('year');
        const prefix = instanceKey(instanceId, 'data:income');
        if (yearParam) {
          const { version } = await readAllYearsWithVersion<IncomeEntry>(env.FINANCE_KV, prefix);
          const entries = await readYears<IncomeEntry>(env.FINANCE_KV, prefix, [Number(yearParam)]);
          return respond({ income: entries, version }, 200, cors);
        }
        const { items: entries, version } = await readAllYearsWithVersion<IncomeEntry>(env.FINANCE_KV, prefix);
        return respond({ income: entries, version }, 200, cors);
      }

      // ── POST income ──
      if (path === '/api/income' && method === 'POST') {
        const body = await request.json() as {
          entry?: Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };
          expectedVersion?: number;
        };
        if (typeof body.expectedVersion !== 'number') {
          return respond({ error: 'expectedVersion required' }, 400, cors);
        }
        if (!body.entry) return respond({ error: 'No entry provided.' }, 400, cors);

        const { allowDuplicate, ...rawEntry } = body.entry;
        const { items: existing, version: currentIncomeVersion } = await getIncomeEntriesWithVersion(env.FINANCE_KV, instanceId);
        if (body.expectedVersion !== currentIncomeVersion) {
          return respond({ error: 'conflict', currentVersion: currentIncomeVersion }, 409, cors);
        }

        // Dedup against existing income entries on date + description + netAmount
        // unless the caller explicitly opted to allow a duplicate.
        if (!allowDuplicate) {
          const key = incomeKey(rawEntry);
          const isDuplicate = existing.some((e) => incomeKey(e) === key);
          if (isDuplicate) {
            return respond({ skipped: true, entry: null }, 200, cors);
          }
        }

        const entry: IncomeEntry = { ...rawEntry, id: generateId() };
        await upsertInYear<IncomeEntry>(env.FINANCE_KV, instanceKey(instanceId, 'data:income'), entry);

        // Auto-create tax transactions from income entry. These also go
        // through the transaction dedup logic so we don't double-insert if
        // someone replays the same income.
        const taxes = entry.taxes;
        const totalTax = (taxes.federal ?? 0) + (taxes.state ?? 0) + (taxes.socialSecurity ?? 0) + (taxes.medicare ?? 0) + (taxes.other ?? 0);

        if (totalTax > 0) {
          const taxTxns = await getTransactions(env.FINANCE_KV, instanceId);
          const seenTxnKeys = new Set(taxTxns.map(transactionKey));
          const taxEntries: Transaction[] = [];

          const taxFields: Array<[keyof TaxBreakdown, string]> = [
            ['federal', 'Federal Income Tax'],
            ['state', 'State Income Tax'],
            ['socialSecurity', 'Social Security Tax'],
            ['medicare', 'Medicare Tax'],
            ['other', 'Other Tax Deductions'],
          ];

          for (const [field, label] of taxFields) {
            const amt = taxes[field] ?? 0;
            if (amt > 0) {
              const candidate = {
                id: generateId(),
                date: entry.date,
                description: `${label} — ${entry.description}`,
                notes: '',
                category: 'Taxes',
                amount: -amt,
                type: 'expense' as const,
                source: 'manual' as const,
              };
              const k = transactionKey(candidate);
              if (!seenTxnKeys.has(k)) {
                seenTxnKeys.add(k);
                taxEntries.push(candidate);
              }
            }
          }

          const txPrefix = instanceKey(instanceId, 'data:transactions');
          for (const tx of taxEntries) {
            await upsertInYear<Transaction>(env.FINANCE_KV, txPrefix, tx);
          }
        }

        return respond({ skipped: false, entry }, 200, cors);
      }

      // ── DELETE income ──
      const incDeleteMatch = path.match(/^\/api\/income\/([^/]+)$/);
      if (incDeleteMatch && method === 'DELETE') {
        if (instance.owner !== auth.username) {
          return respond({ error: 'Only the workspace owner can delete data.' }, 403, cors);
        }
        const id = incDeleteMatch[1];
        const delIncBody = await request.json().catch(() => ({})) as { expectedVersion?: number };
        return mutateVersioned(
          cors,
          delIncBody.expectedVersion,
          () => getIncomeEntriesWithVersion(env.FINANCE_KV, instanceId).then(({ version }) => ({ data: undefined, version })),
          async () => {
            const ok = await deleteFromAnyYear<IncomeEntry>(
              env.FINANCE_KV,
              instanceKey(instanceId, 'data:income'),
              id,
            );
            if (!ok) return respond({ error: 'Income entry not found.' }, 404, cors);
            return respond({ ok: true }, 200, cors);
          },
        );
      }

      // ── PUT income (update editable fields in place) ──
      const incUpdateMatch = path.match(/^\/api\/income\/([^/]+)$/);
      if (incUpdateMatch && method === 'PUT') {
        const id = incUpdateMatch[1];
        const body = await request.json() as {
          date?: string;
          description?: string;
          grossAmount?: number;
          netAmount?: number;
          expectedVersion?: number;
        };
        // Build only the fields explicitly provided so updateInAnyYear merges correctly.
        const patch: Partial<IncomeEntry> = {};
        if (typeof body.date === 'string' && body.date) patch.date = body.date;
        if (typeof body.description === 'string') patch.description = body.description;
        if (typeof body.grossAmount === 'number' && !isNaN(body.grossAmount)) patch.grossAmount = body.grossAmount;
        if (typeof body.netAmount === 'number' && !isNaN(body.netAmount)) patch.netAmount = body.netAmount;

        return mutateVersioned(
          cors,
          body.expectedVersion,
          () => getIncomeEntriesWithVersion(env.FINANCE_KV, instanceId).then(({ version }) => ({ data: undefined, version })),
          async () => {
            const updated = await updateInAnyYear<IncomeEntry>(
              env.FINANCE_KV,
              instanceKey(instanceId, 'data:income'),
              id,
              patch,
            );
            if (!updated) return respond({ error: 'Income entry not found.' }, 404, cors);
            return respond(updated, 200, cors);
          },
        );
      }

      // ── GET user categories (custom categories + description mappings) ──
      if (path === '/api/user-categories' && method === 'GET') {
        const raw = await env.FINANCE_KV.get(instanceKey(instanceId, 'data:userCategories'));
        const data = raw ? JSON.parse(raw) : { customCategories: [], mappings: [], version: 0 };
        if (typeof data.version !== 'number') data.version = 0;
        return respond(data, 200, cors);
      }

      // ── PUT user categories (replaces the full document) ──
      if (path === '/api/user-categories' && method === 'PUT') {
        const body = await request.json() as {
          customCategories?: string[];
          mappings?: Array<{ pattern: string; category: string }>;
          expectedVersion?: number;
        };
        if (Array.isArray(body.customCategories) && body.customCategories.length > MAX_BATCH_SIZE) {
          return respond({ error: `Batch exceeds maximum of ${MAX_BATCH_SIZE}.` }, 413, cors);
        }
        if (Array.isArray(body.mappings) && body.mappings.length > MAX_BATCH_SIZE) {
          return respond({ error: `Batch exceeds maximum of ${MAX_BATCH_SIZE}.` }, 413, cors);
        }
        const customCategories = Array.isArray(body.customCategories)
          ? body.customCategories.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
          : [];
        const mappings = Array.isArray(body.mappings)
          ? body.mappings.filter(
              (m) =>
                m && typeof m.pattern === 'string' && m.pattern.trim().length > 0 &&
                typeof m.category === 'string' && m.category.trim().length > 0,
            )
          : [];
        return mutateVersioned(
          cors,
          body.expectedVersion,
          async () => {
            const prevRaw = await env.FINANCE_KV.get(instanceKey(instanceId, 'data:userCategories'));
            const prevData = prevRaw ? JSON.parse(prevRaw) : { version: 0 };
            const version: number = typeof prevData.version === 'number' ? prevData.version : 0;
            return { data: undefined, version };
          },
          async (_data, currentVersion) => {
            await env.FINANCE_KV.put(
              instanceKey(instanceId, 'data:userCategories'),
              JSON.stringify({ customCategories, mappings, version: currentVersion + 1 }),
            );
            return respond({ ok: true }, 200, cors);
          },
        );
      }

      // ── POST bulk delete (transactions + income in one call) ──
      if (path === '/api/bulk-delete' && method === 'POST') {
        if (instance.owner !== auth.username) {
          return respond({ error: 'Only the workspace owner can delete data.' }, 403, cors);
        }
        const body = await request.json() as {
          transactionIds?: string[];
          incomeIds?: string[];
          expectedTransactionsVersion?: number;
          expectedIncomeVersion?: number;
        };
        const willTouchTxns = Array.isArray(body.transactionIds) && body.transactionIds.length > 0;
        const willTouchInc = Array.isArray(body.incomeIds) && body.incomeIds.length > 0;
        if (willTouchTxns && typeof body.expectedTransactionsVersion !== 'number') {
          return respond({ error: 'expectedTransactionsVersion required when deleting transactions' }, 400, cors);
        }
        if (willTouchInc && typeof body.expectedIncomeVersion !== 'number') {
          return respond({ error: 'expectedIncomeVersion required when deleting income entries' }, 400, cors);
        }
        if (Array.isArray(body.transactionIds) && body.transactionIds.length > MAX_BULK_IDS) {
          return respond({ error: `Batch exceeds maximum of ${MAX_BULK_IDS}.` }, 413, cors);
        }
        if (Array.isArray(body.incomeIds) && body.incomeIds.length > MAX_BULK_IDS) {
          return respond({ error: `Batch exceeds maximum of ${MAX_BULK_IDS}.` }, 413, cors);
        }
        const txnIds = new Set(Array.isArray(body.transactionIds) ? body.transactionIds : []);
        const incIds = new Set(Array.isArray(body.incomeIds) ? body.incomeIds : []);

        let deletedTransactions = 0;
        let deletedIncome = 0;

        if (txnIds.size > 0) {
          const { items: existing, version: currentTxnVersion } = await getTransactionsWithVersion(env.FINANCE_KV, instanceId);
          if (body.expectedTransactionsVersion !== currentTxnVersion) {
            return respond({ error: 'conflict', currentVersion: currentTxnVersion }, 409, cors);
          }
          const next = existing.filter((t) => !txnIds.has(t.id));
          deletedTransactions = existing.length - next.length;
          if (deletedTransactions > 0) {
            await saveTransactions(env.FINANCE_KV, instanceId, next);
          }
        }

        if (incIds.size > 0) {
          const { items: existing, version: currentIncVersion } = await getIncomeEntriesWithVersion(env.FINANCE_KV, instanceId);
          if (body.expectedIncomeVersion !== currentIncVersion) {
            return respond({ error: 'conflict', currentVersion: currentIncVersion }, 409, cors);
          }
          const next = existing.filter((e) => !incIds.has(e.id));
          deletedIncome = existing.length - next.length;
          if (deletedIncome > 0) {
            await saveIncomeEntries(env.FINANCE_KV, instanceId, next);
          }
        }

        return respond({ deletedTransactions, deletedIncome }, 200, cors);
      }

      // ── POST purge all data (transactions + income, keeps user categories) ──
      if (path === '/api/purge-all' && method === 'POST') {
        if (instance.owner !== auth.username) {
          return respond({ error: 'Only the workspace owner can delete data.' }, 403, cors);
        }
        const body = await request.json() as { confirm?: boolean };
        if (body.confirm !== true) {
          return respond({ error: 'Confirmation required.' }, 400, cors);
        }
        await Promise.all([
          deletePaginatedSlice(env.FINANCE_KV, instanceKey(instanceId, 'data:transactions')),
          deletePaginatedSlice(env.FINANCE_KV, instanceKey(instanceId, 'data:income')),
        ]);
        return respond({ ok: true }, 200, cors);
      }

      // ── POST bulk update category for transactions matching a description pattern ──
      if (path === '/api/transactions/bulk-update-category' && method === 'POST') {
        const body = await request.json() as { newCategory?: string; pattern?: string; previousCategory?: string; expectedVersion?: number };
        const newCategory = (body.newCategory ?? '').trim();
        const pattern = (body.pattern ?? '').trim();
        if (!newCategory || !pattern) return respond({ error: 'newCategory and pattern are required.' }, 400, cors);
        return mutateVersioned<Transaction[]>(
          cors,
          body.expectedVersion,
          () => getTransactionsWithVersion(env.FINANCE_KV, instanceId).then(({ items, version }) => ({ data: items, version })),
          async (txns) => {
            const patternLower = pattern.toLowerCase();
            let updated = 0;
            const next = txns.map((t) => {
              if (t.type !== 'expense') return t;
              if (t.archived) return t;
              // Only retarget rows that were in the previous category (if specified) so an
              // accidental broad pattern doesn't overwrite intentionally-different categorizations.
              if (body.previousCategory && t.category !== body.previousCategory) return t;
              if (!t.description.toLowerCase().includes(patternLower)) return t;
              if (t.category === newCategory) return t;
              updated++;
              return { ...t, category: newCategory };
            });
            if (updated > 0) await saveTransactions(env.FINANCE_KV, instanceId, next);
            return respond({ updated }, 200, cors);
          },
        );
      }

      // ── POST rename category (cascades through transactions, mappings, custom list) ──
      if (path === '/api/rename-category' && method === 'POST') {
        const body = await request.json() as { from?: string; to?: string; expectedTransactionsVersion?: number; expectedUserCategoriesVersion?: number };
        if (typeof body.expectedTransactionsVersion !== 'number') {
          return respond({ error: 'expectedTransactionsVersion required' }, 400, cors);
        }
        if (typeof body.expectedUserCategoriesVersion !== 'number') {
          return respond({ error: 'expectedUserCategoriesVersion required' }, 400, cors);
        }
        const from = (body.from ?? '').trim();
        const to = (body.to ?? '').trim();
        if (!from || !to) return respond({ error: 'Both "from" and "to" are required.' }, 400, cors);
        if (from === to) return respond({ updated: 0 }, 200, cors);

        // Update transactions
        const { items: txns, version: currentTxnVersion } = await getTransactionsWithVersion(env.FINANCE_KV, instanceId);
        if (body.expectedTransactionsVersion !== currentTxnVersion) {
          return respond({ error: 'conflict', currentVersion: currentTxnVersion }, 409, cors);
        }
        let txnUpdates = 0;
        const nextTxns = txns.map((t) => {
          if (t.category === from) {
            txnUpdates++;
            return { ...t, category: to };
          }
          return t;
        });
        if (txnUpdates > 0) await saveTransactions(env.FINANCE_KV, instanceId, nextTxns);

        // Update user categories document
        const raw = await env.FINANCE_KV.get(instanceKey(instanceId, 'data:userCategories'));
        const userCats = raw ? JSON.parse(raw) as { customCategories: string[]; mappings: Array<{ pattern: string; category: string }>; version?: number } : { customCategories: [], mappings: [], version: 0 };
        const userCatsVersion = typeof userCats.version === 'number' ? userCats.version : 0;
        if (body.expectedUserCategoriesVersion !== userCatsVersion) {
          return respond({ error: 'conflict', currentVersion: userCatsVersion }, 409, cors);
        }

        // Rename in customCategories list (if the old name was a custom one)
        const wasCustom = userCats.customCategories.includes(from);
        if (wasCustom) {
          userCats.customCategories = userCats.customCategories.filter((c) => c !== from);
          if (!userCats.customCategories.includes(to)) {
            userCats.customCategories.push(to);
          }
        }

        // Update any mappings that pointed at the old category
        let mappingUpdates = 0;
        userCats.mappings = userCats.mappings.map((m) => {
          if (m.category === from) {
            mappingUpdates++;
            return { ...m, category: to };
          }
          return m;
        });

        await env.FINANCE_KV.put(instanceKey(instanceId, 'data:userCategories'), JSON.stringify({ ...userCats, version: userCatsVersion + 1 }));

        return respond({ updated: txnUpdates, mappingsUpdated: mappingUpdates }, 200, cors);
      }

      // ── POST delete category (reassigns everything to "Other" or the provided target) ──
      if (path === '/api/delete-category' && method === 'POST') {
        if (instance.owner !== auth.username) {
          return respond({ error: 'Only the workspace owner can delete data.' }, 403, cors);
        }
        const body = await request.json() as { name?: string; reassignTo?: string; expectedTransactionsVersion?: number; expectedUserCategoriesVersion?: number };
        if (typeof body.expectedTransactionsVersion !== 'number') {
          return respond({ error: 'expectedTransactionsVersion required' }, 400, cors);
        }
        if (typeof body.expectedUserCategoriesVersion !== 'number') {
          return respond({ error: 'expectedUserCategoriesVersion required' }, 400, cors);
        }
        const name = (body.name ?? '').trim();
        const reassignTo = (body.reassignTo ?? 'Other').trim() || 'Other';
        if (!name) return respond({ error: 'Missing category name.' }, 400, cors);

        // Reassign transactions
        const { items: txns, version: currentTxnVersionDel } = await getTransactionsWithVersion(env.FINANCE_KV, instanceId);
        if (body.expectedTransactionsVersion !== currentTxnVersionDel) {
          return respond({ error: 'conflict', currentVersion: currentTxnVersionDel }, 409, cors);
        }
        let txnUpdates = 0;
        const nextTxns = txns.map((t) => {
          if (t.category === name) {
            txnUpdates++;
            return { ...t, category: reassignTo };
          }
          return t;
        });
        if (txnUpdates > 0) await saveTransactions(env.FINANCE_KV, instanceId, nextTxns);

        // Remove from custom list + drop any mappings that pointed at this category
        const raw = await env.FINANCE_KV.get(instanceKey(instanceId, 'data:userCategories'));
        const userCats = raw ? JSON.parse(raw) as { customCategories: string[]; mappings: Array<{ pattern: string; category: string }>; version?: number } : { customCategories: [], mappings: [], version: 0 };
        const deleteCatVersion = typeof userCats.version === 'number' ? userCats.version : 0;
        if (body.expectedUserCategoriesVersion !== deleteCatVersion) {
          return respond({ error: 'conflict', currentVersion: deleteCatVersion }, 409, cors);
        }
        userCats.customCategories = userCats.customCategories.filter((c) => c !== name);
        const mappingsBefore = userCats.mappings.length;
        userCats.mappings = userCats.mappings.filter((m) => m.category !== name);
        const mappingsRemoved = mappingsBefore - userCats.mappings.length;
        await env.FINANCE_KV.put(instanceKey(instanceId, 'data:userCategories'), JSON.stringify({ ...userCats, version: deleteCatVersion + 1 }));

        return respond({ reassigned: txnUpdates, mappingsRemoved }, 200, cors);
      }

      return respond({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return respond({ error: 'An unexpected error occurred on the server.' }, 500, cors);
    }
  },
};
