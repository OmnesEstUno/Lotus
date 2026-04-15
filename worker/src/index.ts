/**
 * Finastic Cloudflare Worker
 *
 * Zero external dependencies — all crypto via Web Crypto API.
 *
 * Setup:
 *   wrangler kv namespace create FINANCE_KV
 *   wrangler secret put JWT_SECRET        # random 40+ char string
 *   wrangler deploy
 */

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

// ─── Crypto: PBKDF2 password hashing ─────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    key,
    256,
  );
  const toHex = (u8: Uint8Array) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const [, saltHex, storedHashHex] = parts;
  const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    key,
    256,
  );
  const newHashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time comparison
  if (newHashHex.length !== storedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < newHashHex.length; i++) diff |= newHashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  return diff === 0;
}

// ─── Crypto: JWT ─────────────────────────────────────────────────────────────

function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header, body, sig] = parts;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sig), enc.encode(`${header}.${body}`));
  if (!valid) throw new Error('Invalid signature');
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as Record<string, unknown>;
  if (typeof payload.exp === 'number' && Date.now() / 1000 > payload.exp) throw new Error('Token expired');
  return payload;
}

// ─── Crypto: TOTP ─────────────────────────────────────────────────────────────

function base32Decode(encoded: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const str = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0;
  const output: number[] = [];
  for (const char of str) {
    const idx = chars.indexOf(char);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return new Uint8Array(output);
}

function generateTOTPSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map((b) => chars[b & 31]).join('');
}

async function getTOTP(secret: string, stepOffset = 0): Promise<string> {
  const T = Math.floor(Date.now() / 30000) + stepOffset;
  const buf = new ArrayBuffer(8);
  new DataView(buf).setUint32(4, T >>> 0, false);
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = hash[19] & 0xf;
  const code = (((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff)) % 1_000_000;
  return code.toString().padStart(6, '0');
}

async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  for (const offset of [-1, 0, 1]) {
    if ((await getTOTP(secret, offset)) === code) return true;
  }
  return false;
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
        const added: Transaction[] = body.transactions.map((t) => ({ ...t, id: generateId() }));
        await saveTransactions(env.FINANCE_KV, [...existing, ...added]);
        return respond({ added: added.length }, 200, cors);
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

      // ── GET income ──
      if (path === '/api/income' && method === 'GET') {
        const entries = await getIncomeEntries(env.FINANCE_KV);
        return respond(entries, 200, cors);
      }

      // ── POST income ──
      if (path === '/api/income' && method === 'POST') {
        const body = await request.json() as { entry?: Omit<IncomeEntry, 'id'> };
        if (!body.entry) return respond({ error: 'No entry provided.' }, 400, cors);

        const entry: IncomeEntry = { ...body.entry, id: generateId() };
        const existing = await getIncomeEntries(env.FINANCE_KV);
        await saveIncomeEntries(env.FINANCE_KV, [...existing, entry]);

        // Auto-create tax transactions from income entry
        const taxes = entry.taxes;
        const totalTax = (taxes.federal ?? 0) + (taxes.state ?? 0) + (taxes.socialSecurity ?? 0) + (taxes.medicare ?? 0) + (taxes.other ?? 0);

        if (totalTax > 0) {
          const taxTxns = await getTransactions(env.FINANCE_KV);
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
              taxEntries.push({
                id: generateId(),
                date: entry.date,
                description: `${label} — ${entry.description}`,
                category: 'Taxes',
                amount: -amt,
                type: 'expense',
                source: 'manual',
              });
            }
          }

          if (taxEntries.length > 0) {
            await saveTransactions(env.FINANCE_KV, [...taxTxns, ...taxEntries]);
          }
        }

        return respond(entry, 200, cors);
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

      return respond({ error: 'Not found.' }, 404, cors);
    } catch (err) {
      console.error(err);
      return respond({ error: 'An unexpected error occurred on the server.' }, 500, cors);
    }
  },
};
