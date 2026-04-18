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
} from './crypto';
import { migrateSingleUserToMultiTenant, createDefaultInstance, instanceMetaKey } from './migrations';
import { createInvite, verifyInvite, markInviteUsed, listInvites, deleteInvite } from './invites';

export interface Env {
  FINANCE_KV: KVNamespace;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
  ADMIN_INIT_SECRET?: string;   // optional — absence disables /api/admin/init
}

/** Auth context returned by authenticate(). */
type AuthContext = { username: string };

// ─── Instance type ────────────────────────────────────────────────────────────

interface Instance {
  id: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: string;
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
  // Allow localhost for dev (any port) + the configured production origin
  const isLocalhost = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const matchesAllowed = origin && allowedOrigin && origin === allowedOrigin;

  let allowOrigin = '*';
  if (isLocalhost || matchesAllowed) {
    allowOrigin = origin!;
  } else if (allowedOrigin) {
    allowOrigin = allowedOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Instance-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function respond(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function authenticate(request: Request, env: Env): Promise<AuthContext | null> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
    if (payload.authenticated !== true || typeof payload.username !== 'string') return null;
    return { username: payload.username };
  } catch {
    return null;
  }
}

async function authenticateAdmin(request: Request, env: Env, cors: Record<string, string>): Promise<AuthContext | Response> {
  const auth = await authenticate(request, env);
  if (!auth) return respond({ error: 'Unauthorized' }, 401, cors);
  if (auth.username !== 'admin') return respond({ error: 'Forbidden' }, 403, cors);
  return auth;
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
  `users:${username}:${leaf}`;

const instanceKey = (instanceId: string, leaf: 'data:transactions' | 'data:income' | 'data:userCategories') =>
  `instances:${instanceId}:${leaf}`;

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
): Promise<{ instanceId: string } | Response> {
  const instanceId = request.headers.get('X-Instance-Id');
  if (!instanceId) return respond({ error: 'Missing instance.' }, 400, cors);
  const raw = await env.FINANCE_KV.get(instanceMetaKey(instanceId));
  if (!raw) return respond({ error: 'Instance not found.' }, 404, cors);
  const inst = JSON.parse(raw) as Instance;
  if (!inst.members.includes(auth.username)) return respond({ error: 'Forbidden.' }, 403, cors);
  return { instanceId };
}

// ─── Timing-safe dummy hash (lazy, computed once per worker lifetime) ─────────

let cachedDummyHash: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  return (cachedDummyHash ??= hashPassword(`dummy:${crypto.randomUUID()}`));
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

type Transaction = { id: string; date: string; description: string; category: string; amount: number; type: string; source: string };
type TaxBreakdown = { federal: number; state: number; socialSecurity: number; medicare: number; other: number };
type IncomeEntry = { id: string; date: string; description: string; grossAmount: number; netAmount: number; taxes: TaxBreakdown; source: string };

async function getTransactions(kv: KVNamespace, instanceId: string): Promise<Transaction[]> {
  const raw = await kv.get(instanceKey(instanceId, 'data:transactions'));
  return raw ? (JSON.parse(raw) as Transaction[]) : [];
}

async function saveTransactions(kv: KVNamespace, instanceId: string, txns: Transaction[]): Promise<void> {
  await kv.put(instanceKey(instanceId, 'data:transactions'), JSON.stringify(txns));
}

async function getIncomeEntries(kv: KVNamespace, instanceId: string): Promise<IncomeEntry[]> {
  const raw = await kv.get(instanceKey(instanceId, 'data:income'));
  return raw ? (JSON.parse(raw) as IncomeEntry[]) : [];
}

async function saveIncomeEntries(kv: KVNamespace, instanceId: string, entries: IncomeEntry[]): Promise<void> {
  await kv.put(instanceKey(instanceId, 'data:income'), JSON.stringify(entries));
}

function generateId(): string {
  return crypto.randomUUID();
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
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN ?? '*');

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

        return respond({ totpSecret, username }, 200, cors);
      }

      // ── Confirm TOTP Setup ──
      // TODO: consider tying init→confirm with a short-lived token for anti-race hardening.
      //       Currently any caller who knows the username can attempt confirm; TOTP codes
      //       rotate every 30s which limits the window, but a pre-auth token would close it.
      if (path === '/api/setup/confirm' && method === 'POST') {
        const body = await request.json() as { username?: string; totpCode?: string };
        const username = (body.username ?? '').trim().toLowerCase();
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

        return respond({ ok: true }, 200, cors);
      }

      // ── Login ──
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json() as { username?: string; password?: string };
        const username = (body.username ?? '').trim().toLowerCase();
        if (!username || !body.password) return respond({ error: 'Invalid credentials.' }, 401, cors);

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

        const preAuthId = crypto.randomUUID();
        const preAuthToken = await signJWT(
          { preAuth: true, id: preAuthId, username, exp: Math.floor(Date.now() / 1000) + 300 },
          env.JWT_SECRET,
        );

        await env.FINANCE_KV.put(`preauth:${preAuthId}`, username, { expirationTtl: 300 });
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
        const stored = await env.FINANCE_KV.get(`preauth:${payload.id}`);
        if (stored !== username) return respond({ error: 'Session expired.' }, 401, cors);

        const raw = await env.FINANCE_KV.get(userKey(username, 'profile'));
        if (!raw) return respond({ error: 'User not found.' }, 401, cors);
        const profile = JSON.parse(raw) as { totpSecret: string };

        const valid = await verifyTOTP(profile.totpSecret, body.totpCode);
        if (!valid) return respond({ error: 'Invalid or expired code.' }, 401, cors);

        await env.FINANCE_KV.delete(`preauth:${payload.id}`);

        const token = await signJWT(
          { authenticated: true, username, exp: Math.floor(Date.now() / 1000) + 86400 * 7 },
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
      const auth = await authenticate(request, env);
      if (!auth) return respond({ error: 'Unauthorized' }, 401, cors);

      const { username } = auth;

      // ── Instance CRUD ──

      // List instances the user is a member of
      if (path === '/api/instances' && method === 'GET') {
        const profile = await getUserProfile(env.FINANCE_KV, username);
        if (!profile) return respond({ error: 'User profile not found.' }, 500, cors);
        const instances: Instance[] = [];
        for (const id of profile.instanceIds ?? []) {
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (raw) instances.push(JSON.parse(raw) as Instance);
        }
        return respond({ instances, activeInstanceId: profile.activeInstanceId ?? null }, 200, cors);
      }

      // Create a new instance (the user becomes its owner)
      if (path === '/api/instances' && method === 'POST') {
        const body = await request.json() as { name?: string };
        const name = (body.name ?? '').trim();
        if (!name) return respond({ error: 'Name required.' }, 400, cors);
        const id = crypto.randomUUID();
        const instance: Instance = { id, name, owner: username, members: [username], createdAt: new Date().toISOString() };
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
          const body = await request.json() as { name?: string };
          const trimmed = (body.name ?? '').trim();
          if (!trimmed) return respond({ error: 'Name required.' }, 400, cors);
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (!inst.members.includes(username)) return respond({ error: 'Forbidden.' }, 403, cors);
          inst.name = trimmed;
          await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(inst));
          return respond(inst, 200, cors);
        }

        // Delete instance (owner only; removes data too)
        if ((m = path.match(/^\/api\/instances\/([^/]+)$/)) && method === 'DELETE') {
          const id = m[1];
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (inst.owner !== username) return respond({ error: 'Only the owner can delete.' }, 403, cors);
          await Promise.all([
            // TODO(Task-3.5): also delete year-sharded data keys once year pagination lands.
            env.FINANCE_KV.delete(instanceMetaKey(id)),
            env.FINANCE_KV.delete(instanceKey(id, 'data:transactions')),
            env.FINANCE_KV.delete(instanceKey(id, 'data:income')),
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

        // Add member (owner only)
        if ((m = path.match(/^\/api\/instances\/([^/]+)\/members$/)) && method === 'POST') {
          const id = m[1];
          const body = await request.json() as { username?: string };
          const addMember = (body.username ?? '').trim().toLowerCase();
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (inst.owner !== username) return respond({ error: 'Only the owner can share.' }, 403, cors);
          const known = await getUsernames(env.FINANCE_KV);
          if (!known.includes(addMember)) return respond({ error: 'Unknown user.' }, 400, cors);
          if (!inst.members.includes(addMember)) {
            inst.members.push(addMember);
            await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(inst));
            const memberProfile = await getUserProfile(env.FINANCE_KV, addMember);
            if (!memberProfile) return respond({ error: 'User profile not found.' }, 500, cors);
            memberProfile.instanceIds = [...(memberProfile.instanceIds ?? []), id];
            if (!memberProfile.activeInstanceId) memberProfile.activeInstanceId = id;
            await saveUserProfile(env.FINANCE_KV, addMember, memberProfile);
          }
          return respond(inst, 200, cors);
        }

        // Remove member (owner only)
        if ((m = path.match(/^\/api\/instances\/([^/]+)\/members\/([^/]+)$/)) && method === 'DELETE') {
          const id = m[1];
          const memberToRemove = m[2].toLowerCase();
          const raw = await env.FINANCE_KV.get(instanceMetaKey(id));
          if (!raw) return respond({ error: 'Not found.' }, 404, cors);
          const inst = JSON.parse(raw) as Instance;
          if (inst.owner !== username) return respond({ error: 'Only the owner can modify members.' }, 403, cors);
          if (inst.owner === memberToRemove) return respond({ error: 'Cannot remove the owner.' }, 400, cors);
          inst.members = inst.members.filter((u) => u !== memberToRemove);
          await env.FINANCE_KV.put(instanceMetaKey(id), JSON.stringify(inst));
          const p = await getUserProfile(env.FINANCE_KV, memberToRemove);
          if (!p) return respond({ error: 'Member profile not found.' }, 500, cors);
          p.instanceIds = (p.instanceIds ?? []).filter((x) => x !== id);
          if (p.activeInstanceId === id) p.activeInstanceId = p.instanceIds[0] ?? null;
          await saveUserProfile(env.FINANCE_KV, memberToRemove, p);
          return respond(inst, 200, cors);
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // Data endpoints — require valid JWT + X-Instance-Id membership check
      // ─────────────────────────────────────────────────────────────────────
      const resolved = await resolveInstance(request, auth, env, cors);
      if (resolved instanceof Response) return resolved;
      const { instanceId } = resolved;

      // ── GET transactions ──
      if (path === '/api/transactions' && method === 'GET') {
        const txns = await getTransactions(env.FINANCE_KV, instanceId);
        return respond(txns, 200, cors);
      }

      // ── POST transactions (batch) ──
      if (path === '/api/transactions' && method === 'POST') {
        const body = await request.json() as { transactions?: Omit<Transaction, 'id'>[] };
        if (!Array.isArray(body.transactions) || body.transactions.length === 0) {
          return respond({ error: 'No transactions provided.' }, 400, cors);
        }

        const existing = await getTransactions(env.FINANCE_KV, instanceId);

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
          added.push({ ...t, id: generateId() });
        }

        if (added.length > 0) {
          await saveTransactions(env.FINANCE_KV, instanceId, [...existing, ...added]);
        }
        return respond({ added: added.length, skipped }, 200, cors);
      }

      // ── DELETE transaction ──
      const txnDeleteMatch = path.match(/^\/api\/transactions\/([^/]+)$/);
      if (txnDeleteMatch && method === 'DELETE') {
        const id = txnDeleteMatch[1];
        const txns = await getTransactions(env.FINANCE_KV, instanceId);
        const next = txns.filter((t) => t.id !== id);
        if (next.length === txns.length) return respond({ error: 'Transaction not found.' }, 404, cors);
        await saveTransactions(env.FINANCE_KV, instanceId, next);
        return respond({ ok: true }, 200, cors);
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
        };
        const txns = await getTransactions(env.FINANCE_KV, instanceId);
        const idx = txns.findIndex((t) => t.id === id);
        if (idx < 0) return respond({ error: 'Transaction not found.' }, 404, cors);

        const existing = txns[idx];
        const updated: Transaction = {
          ...existing,
          date: typeof body.date === 'string' && body.date ? body.date : existing.date,
          description: typeof body.description === 'string' ? body.description : existing.description,
          category: typeof body.category === 'string' && body.category ? body.category : existing.category,
          amount: typeof body.amount === 'number' && !isNaN(body.amount) ? body.amount : existing.amount,
        };
        const next = [...txns];
        next[idx] = updated;
        await saveTransactions(env.FINANCE_KV, instanceId, next);
        return respond(updated, 200, cors);
      }

      // ── GET income ──
      if (path === '/api/income' && method === 'GET') {
        const entries = await getIncomeEntries(env.FINANCE_KV, instanceId);
        return respond(entries, 200, cors);
      }

      // ── POST income ──
      if (path === '/api/income' && method === 'POST') {
        const body = await request.json() as {
          entry?: Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };
        };
        if (!body.entry) return respond({ error: 'No entry provided.' }, 400, cors);

        const { allowDuplicate, ...rawEntry } = body.entry;
        const existing = await getIncomeEntries(env.FINANCE_KV, instanceId);

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
        await saveIncomeEntries(env.FINANCE_KV, instanceId, [...existing, entry]);

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

          if (taxEntries.length > 0) {
            await saveTransactions(env.FINANCE_KV, instanceId, [...taxTxns, ...taxEntries]);
          }
        }

        return respond({ skipped: false, entry }, 200, cors);
      }

      // ── DELETE income ──
      const incDeleteMatch = path.match(/^\/api\/income\/([^/]+)$/);
      if (incDeleteMatch && method === 'DELETE') {
        const id = incDeleteMatch[1];
        const entries = await getIncomeEntries(env.FINANCE_KV, instanceId);
        const next = entries.filter((e) => e.id !== id);
        if (next.length === entries.length) return respond({ error: 'Income entry not found.' }, 404, cors);
        await saveIncomeEntries(env.FINANCE_KV, instanceId, next);
        return respond({ ok: true }, 200, cors);
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
        };
        const entries = await getIncomeEntries(env.FINANCE_KV, instanceId);
        const idx = entries.findIndex((e) => e.id === id);
        if (idx < 0) return respond({ error: 'Income entry not found.' }, 404, cors);

        const existing = entries[idx];
        const updated: IncomeEntry = {
          ...existing,
          date: typeof body.date === 'string' && body.date ? body.date : existing.date,
          description: typeof body.description === 'string' ? body.description : existing.description,
          grossAmount: typeof body.grossAmount === 'number' && !isNaN(body.grossAmount) ? body.grossAmount : existing.grossAmount,
          netAmount: typeof body.netAmount === 'number' && !isNaN(body.netAmount) ? body.netAmount : existing.netAmount,
        };
        const next = [...entries];
        next[idx] = updated;
        await saveIncomeEntries(env.FINANCE_KV, instanceId, next);
        return respond(updated, 200, cors);
      }

      // ── GET user categories (custom categories + description mappings) ──
      if (path === '/api/user-categories' && method === 'GET') {
        const raw = await env.FINANCE_KV.get(instanceKey(instanceId, 'data:userCategories'));
        const data = raw ? JSON.parse(raw) : { customCategories: [], mappings: [] };
        return respond(data, 200, cors);
      }

      // ── PUT user categories (replaces the full document) ──
      if (path === '/api/user-categories' && method === 'PUT') {
        const body = await request.json() as {
          customCategories?: string[];
          mappings?: Array<{ pattern: string; category: string }>;
        };
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
        await env.FINANCE_KV.put(
          instanceKey(instanceId, 'data:userCategories'),
          JSON.stringify({ customCategories, mappings }),
        );
        return respond({ ok: true }, 200, cors);
      }

      // ── POST bulk delete (transactions + income in one call) ──
      if (path === '/api/bulk-delete' && method === 'POST') {
        const body = await request.json() as { transactionIds?: string[]; incomeIds?: string[] };
        const txnIds = new Set(Array.isArray(body.transactionIds) ? body.transactionIds : []);
        const incIds = new Set(Array.isArray(body.incomeIds) ? body.incomeIds : []);

        let deletedTransactions = 0;
        let deletedIncome = 0;

        if (txnIds.size > 0) {
          const existing = await getTransactions(env.FINANCE_KV, instanceId);
          const next = existing.filter((t) => !txnIds.has(t.id));
          deletedTransactions = existing.length - next.length;
          if (deletedTransactions > 0) {
            await saveTransactions(env.FINANCE_KV, instanceId, next);
          }
        }

        if (incIds.size > 0) {
          const existing = await getIncomeEntries(env.FINANCE_KV, instanceId);
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
        const body = await request.json() as { confirm?: boolean };
        if (body.confirm !== true) {
          return respond({ error: 'Confirmation required.' }, 400, cors);
        }
        await env.FINANCE_KV.delete(instanceKey(instanceId, 'data:transactions'));
        await env.FINANCE_KV.delete(instanceKey(instanceId, 'data:income'));
        return respond({ ok: true }, 200, cors);
      }

      // ── POST rename category (cascades through transactions, mappings, custom list) ──
      if (path === '/api/rename-category' && method === 'POST') {
        const body = await request.json() as { from?: string; to?: string };
        const from = (body.from ?? '').trim();
        const to = (body.to ?? '').trim();
        if (!from || !to) return respond({ error: 'Both "from" and "to" are required.' }, 400, cors);
        if (from === to) return respond({ updated: 0 }, 200, cors);

        // Update transactions
        const txns = await getTransactions(env.FINANCE_KV, instanceId);
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
        const userCats = raw ? JSON.parse(raw) as { customCategories: string[]; mappings: Array<{ pattern: string; category: string }> } : { customCategories: [], mappings: [] };

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

        await env.FINANCE_KV.put(instanceKey(instanceId, 'data:userCategories'), JSON.stringify(userCats));

        return respond({ updated: txnUpdates, mappingsUpdated: mappingUpdates }, 200, cors);
      }

      // ── POST delete category (reassigns everything to "Other" or the provided target) ──
      if (path === '/api/delete-category' && method === 'POST') {
        const body = await request.json() as { name?: string; reassignTo?: string };
        const name = (body.name ?? '').trim();
        const reassignTo = (body.reassignTo ?? 'Other').trim() || 'Other';
        if (!name) return respond({ error: 'Missing category name.' }, 400, cors);

        // Reassign transactions
        const txns = await getTransactions(env.FINANCE_KV, instanceId);
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
        const userCats = raw ? JSON.parse(raw) as { customCategories: string[]; mappings: Array<{ pattern: string; category: string }> } : { customCategories: [], mappings: [] };
        userCats.customCategories = userCats.customCategories.filter((c) => c !== name);
        const mappingsBefore = userCats.mappings.length;
        userCats.mappings = userCats.mappings.filter((m) => m.category !== name);
        const mappingsRemoved = mappingsBefore - userCats.mappings.length;
        await env.FINANCE_KV.put(instanceKey(instanceId, 'data:userCategories'), JSON.stringify(userCats));

        return respond({ reassigned: txnUpdates, mappingsRemoved }, 200, cors);
      }

      return respond({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return respond({ error: 'An unexpected error occurred on the server.' }, 500, cors);
    }
  },
};
