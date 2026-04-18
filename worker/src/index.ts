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

export interface Env {
  FINANCE_KV: KVNamespace;
  JWT_SECRET: string;
  ALLOWED_ORIGIN?: string;
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

async function authenticate(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
    return payload.authenticated === true;
  } catch {
    return false;
  }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

type Transaction = { id: string; date: string; description: string; category: string; amount: number; type: string; source: string };
type TaxBreakdown = { federal: number; state: number; socialSecurity: number; medicare: number; other: number };
type IncomeEntry = { id: string; date: string; description: string; grossAmount: number; netAmount: number; taxes: TaxBreakdown; source: string };

async function getTransactions(kv: KVNamespace): Promise<Transaction[]> {
  const raw = await kv.get('data:transactions');
  return raw ? (JSON.parse(raw) as Transaction[]) : [];
}

async function saveTransactions(kv: KVNamespace, txns: Transaction[]): Promise<void> {
  await kv.put('data:transactions', JSON.stringify(txns));
}

async function getIncomeEntries(kv: KVNamespace): Promise<IncomeEntry[]> {
  const raw = await kv.get('data:income');
  return raw ? (JSON.parse(raw) as IncomeEntry[]) : [];
}

async function saveIncomeEntries(kv: KVNamespace, entries: IncomeEntry[]): Promise<void> {
  await kv.put('data:income', JSON.stringify(entries));
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
      // ── Setup Status ──
      if (path === '/api/setup/status' && method === 'GET') {
        const initialized = (await env.FINANCE_KV.get('auth:initialized')) === 'true';
        return respond({ initialized }, 200, cors);
      }

      // ── Initialize Setup ──
      if (path === '/api/setup/init' && method === 'POST') {
        const alreadyInit = (await env.FINANCE_KV.get('auth:initialized')) === 'true';
        if (alreadyInit) return respond({ error: 'Already initialized.' }, 400, cors);

        const body = await request.json() as { password?: string };
        if (!body.password || body.password.length < 8) {
          return respond({ error: 'Password must be at least 8 characters.' }, 400, cors);
        }

        const passwordHash = await hashPassword(body.password);
        const totpSecret = generateTOTPSecret();

        await env.FINANCE_KV.put('auth:passwordHash', passwordHash);
        await env.FINANCE_KV.put('auth:totpSecret', totpSecret);
        // Don't mark as initialized yet — confirm with TOTP first

        return respond({ totpSecret }, 200, cors);
      }

      // ── Confirm TOTP Setup ──
      if (path === '/api/setup/confirm' && method === 'POST') {
        const body = await request.json() as { totpCode?: string };
        const secret = await env.FINANCE_KV.get('auth:totpSecret');
        if (!secret) return respond({ error: 'Setup not started.' }, 400, cors);
        if (!body.totpCode) return respond({ error: 'Missing TOTP code.' }, 400, cors);

        const valid = await verifyTOTP(secret, body.totpCode);
        if (!valid) return respond({ error: 'Invalid code.' }, 400, cors);

        await env.FINANCE_KV.put('auth:initialized', 'true');
        return respond({ ok: true }, 200, cors);
      }

      // ── Login ──
      if (path === '/api/auth/login' && method === 'POST') {
        const body = await request.json() as { password?: string };
        const storedHash = await env.FINANCE_KV.get('auth:passwordHash');
        if (!storedHash || !body.password) {
          return respond({ error: 'Invalid credentials.' }, 401, cors);
        }

        const valid = await verifyPassword(body.password, storedHash);
        if (!valid) return respond({ error: 'Invalid credentials.' }, 401, cors);

        // Issue short-lived pre-auth token (expires in 5 minutes)
        const preAuthId = generateId();
        const preAuthToken = await signJWT(
          { preAuth: true, id: preAuthId, exp: Math.floor(Date.now() / 1000) + 300 },
          env.JWT_SECRET,
        );

        await env.FINANCE_KV.put(`preauth:${preAuthId}`, '1', { expirationTtl: 300 });
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
          return respond({ error: 'Invalid or expired session. Please log in again.' }, 401, cors);
        }

        if (!payload.preAuth || typeof payload.id !== 'string') {
          return respond({ error: 'Invalid token type.' }, 401, cors);
        }

        const preAuthEntry = await env.FINANCE_KV.get(`preauth:${payload.id}`);
        if (!preAuthEntry) return respond({ error: 'Session expired. Please log in again.' }, 401, cors);

        const secret = await env.FINANCE_KV.get('auth:totpSecret');
        if (!secret) return respond({ error: 'Server misconfigured.' }, 500, cors);

        const valid = await verifyTOTP(secret, body.totpCode);
        if (!valid) return respond({ error: 'Invalid or expired code.' }, 401, cors);

        // Consume the pre-auth token
        await env.FINANCE_KV.delete(`preauth:${payload.id}`);

        // Issue full session token (7 days)
        const token = await signJWT(
          { authenticated: true, exp: Math.floor(Date.now() / 1000) + 86400 * 7 },
          env.JWT_SECRET,
        );

        return respond({ token }, 200, cors);
      }

      // ── Logout ──
      if (path === '/api/auth/logout' && method === 'POST') {
        return respond({ ok: true }, 200, cors);
      }

      // ─────────────────────────────────────────────────────────────────────
      // Protected routes — require valid JWT
      // ─────────────────────────────────────────────────────────────────────
      const authed = await authenticate(request, env);
      if (!authed) return respond({ error: 'Unauthorized' }, 401, cors);

      // ── GET transactions ──
      if (path === '/api/transactions' && method === 'GET') {
        const txns = await getTransactions(env.FINANCE_KV);
        return respond(txns, 200, cors);
      }

      // ── POST transactions (batch) ──
      if (path === '/api/transactions' && method === 'POST') {
        const body = await request.json() as { transactions?: Omit<Transaction, 'id'>[] };
        if (!Array.isArray(body.transactions) || body.transactions.length === 0) {
          return respond({ error: 'No transactions provided.' }, 400, cors);
        }

        const existing = await getTransactions(env.FINANCE_KV);

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
          await saveTransactions(env.FINANCE_KV, [...existing, ...added]);
        }
        return respond({ added: added.length, skipped }, 200, cors);
      }

      // ── DELETE transaction ──
      const txnDeleteMatch = path.match(/^\/api\/transactions\/([^/]+)$/);
      if (txnDeleteMatch && method === 'DELETE') {
        const id = txnDeleteMatch[1];
        const txns = await getTransactions(env.FINANCE_KV);
        const next = txns.filter((t) => t.id !== id);
        if (next.length === txns.length) return respond({ error: 'Transaction not found.' }, 404, cors);
        await saveTransactions(env.FINANCE_KV, next);
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
        const txns = await getTransactions(env.FINANCE_KV);
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
        await saveTransactions(env.FINANCE_KV, next);
        return respond(updated, 200, cors);
      }

      // ── GET income ──
      if (path === '/api/income' && method === 'GET') {
        const entries = await getIncomeEntries(env.FINANCE_KV);
        return respond(entries, 200, cors);
      }

      // ── POST income ──
      if (path === '/api/income' && method === 'POST') {
        const body = await request.json() as {
          entry?: Omit<IncomeEntry, 'id'> & { allowDuplicate?: boolean };
        };
        if (!body.entry) return respond({ error: 'No entry provided.' }, 400, cors);

        const { allowDuplicate, ...rawEntry } = body.entry;
        const existing = await getIncomeEntries(env.FINANCE_KV);

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
        await saveIncomeEntries(env.FINANCE_KV, [...existing, entry]);

        // Auto-create tax transactions from income entry. These also go
        // through the transaction dedup logic so we don't double-insert if
        // someone replays the same income.
        const taxes = entry.taxes;
        const totalTax = (taxes.federal ?? 0) + (taxes.state ?? 0) + (taxes.socialSecurity ?? 0) + (taxes.medicare ?? 0) + (taxes.other ?? 0);

        if (totalTax > 0) {
          const taxTxns = await getTransactions(env.FINANCE_KV);
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
            await saveTransactions(env.FINANCE_KV, [...taxTxns, ...taxEntries]);
          }
        }

        return respond({ skipped: false, entry }, 200, cors);
      }

      // ── DELETE income ──
      const incDeleteMatch = path.match(/^\/api\/income\/([^/]+)$/);
      if (incDeleteMatch && method === 'DELETE') {
        const id = incDeleteMatch[1];
        const entries = await getIncomeEntries(env.FINANCE_KV);
        const next = entries.filter((e) => e.id !== id);
        if (next.length === entries.length) return respond({ error: 'Income entry not found.' }, 404, cors);
        await saveIncomeEntries(env.FINANCE_KV, next);
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
        const entries = await getIncomeEntries(env.FINANCE_KV);
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
        await saveIncomeEntries(env.FINANCE_KV, next);
        return respond(updated, 200, cors);
      }

      // ── GET user categories (custom categories + description mappings) ──
      if (path === '/api/user-categories' && method === 'GET') {
        const raw = await env.FINANCE_KV.get('data:userCategories');
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
          'data:userCategories',
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
          const existing = await getTransactions(env.FINANCE_KV);
          const next = existing.filter((t) => !txnIds.has(t.id));
          deletedTransactions = existing.length - next.length;
          if (deletedTransactions > 0) {
            await saveTransactions(env.FINANCE_KV, next);
          }
        }

        if (incIds.size > 0) {
          const existing = await getIncomeEntries(env.FINANCE_KV);
          const next = existing.filter((e) => !incIds.has(e.id));
          deletedIncome = existing.length - next.length;
          if (deletedIncome > 0) {
            await saveIncomeEntries(env.FINANCE_KV, next);
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
        await env.FINANCE_KV.delete('data:transactions');
        await env.FINANCE_KV.delete('data:income');
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
        const txns = await getTransactions(env.FINANCE_KV);
        let txnUpdates = 0;
        const nextTxns = txns.map((t) => {
          if (t.category === from) {
            txnUpdates++;
            return { ...t, category: to };
          }
          return t;
        });
        if (txnUpdates > 0) await saveTransactions(env.FINANCE_KV, nextTxns);

        // Update user categories document
        const raw = await env.FINANCE_KV.get('data:userCategories');
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

        await env.FINANCE_KV.put('data:userCategories', JSON.stringify(userCats));

        return respond({ updated: txnUpdates, mappingsUpdated: mappingUpdates }, 200, cors);
      }

      // ── POST delete category (reassigns everything to "Other" or the provided target) ──
      if (path === '/api/delete-category' && method === 'POST') {
        const body = await request.json() as { name?: string; reassignTo?: string };
        const name = (body.name ?? '').trim();
        const reassignTo = (body.reassignTo ?? 'Other').trim() || 'Other';
        if (!name) return respond({ error: 'Missing category name.' }, 400, cors);

        // Reassign transactions
        const txns = await getTransactions(env.FINANCE_KV);
        let txnUpdates = 0;
        const nextTxns = txns.map((t) => {
          if (t.category === name) {
            txnUpdates++;
            return { ...t, category: reassignTo };
          }
          return t;
        });
        if (txnUpdates > 0) await saveTransactions(env.FINANCE_KV, nextTxns);

        // Remove from custom list + drop any mappings that pointed at this category
        const raw = await env.FINANCE_KV.get('data:userCategories');
        const userCats = raw ? JSON.parse(raw) as { customCategories: string[]; mappings: Array<{ pattern: string; category: string }> } : { customCategories: [], mappings: [] };
        userCats.customCategories = userCats.customCategories.filter((c) => c !== name);
        const mappingsBefore = userCats.mappings.length;
        userCats.mappings = userCats.mappings.filter((m) => m.category !== name);
        const mappingsRemoved = mappingsBefore - userCats.mappings.length;
        await env.FINANCE_KV.put('data:userCategories', JSON.stringify(userCats));

        return respond({ reassigned: txnUpdates, mappingsRemoved }, 200, cors);
      }

      return respond({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return respond({ error: 'An unexpected error occurred on the server.' }, 500, cors);
    }
  },
};
