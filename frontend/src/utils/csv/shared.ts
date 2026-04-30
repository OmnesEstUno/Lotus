// ─── Schema Detection ───────────────────────────────────────────────────────
//
// We don't care which bank the CSV came from. We find the columns we need by
// matching header names against a list of aliases, with substring matching as
// a fallback. That covers Chase, Citi, Bank of America, Amex, credit unions,
// Mint exports, personal bank exports, and so on.

export interface CSVSchema {
  date: string;                 // header name for the transaction date
  description: string;          // primary description/payee column
  altDescription?: string;      // optional secondary (e.g. "Original Description")
  amount?: string;              // single signed-amount column
  debit?: string;               // separate debit column (expenses, positive)
  credit?: string;              // separate credit column (income/payments, positive)
  category?: string;            // optional category hint from the CSV
  type?: string;                // optional type column (e.g. Chase "Sale/Payment/Return")
}

// Header aliases. Order matters — exact matches before partials.
const DATE_ALIASES = [
  'transaction date', 'trans date', 'post date', 'posting date', 'posted date',
  'effective date', 'date posted', 'date',
];
const DESCRIPTION_ALIASES = [
  'description', 'payee', 'merchant', 'transaction description',
  'memo', 'details', 'name', 'item',
];
const ALT_DESCRIPTION_ALIASES = [
  'original description', 'extended description', 'notes', 'long description',
];
const AMOUNT_ALIASES = [
  'amount', 'transaction amount', 'amount ($)', 'value', 'net amount',
];
const DEBIT_ALIASES = [
  'debit', 'debits', 'withdrawal', 'withdrawals', 'debit amount',
  'expense', 'expenses', 'outflow', 'money out',
];
const CREDIT_ALIASES = [
  'credit', 'credits', 'deposit', 'deposits', 'credit amount',
  'inflow', 'money in',
];
const CATEGORY_ALIASES = ['category', 'classification', 'merchant category'];
const TYPE_ALIASES = ['type', 'transaction type', 'trans type'];

export function normalize(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function findHeader(headers: string[], aliases: string[]): string | undefined {
  const normalized = headers.map((h) => ({ orig: h, norm: normalize(h) }));

  // Pass 1: exact match
  for (const alias of aliases) {
    const found = normalized.find((h) => h.norm === alias);
    if (found) return found.orig;
  }
  // Pass 2: header contains the alias as a whole word/phrase
  for (const alias of aliases) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const found = normalized.find((h) => re.test(h.norm));
    if (found) return found.orig;
  }
  return undefined;
}

export function detectSchema(headers: string[]): CSVSchema | null {
  const date = findHeader(headers, DATE_ALIASES);
  const description = findHeader(headers, DESCRIPTION_ALIASES);
  const altDescription = findHeader(headers, ALT_DESCRIPTION_ALIASES);

  // Pick one of: single amount column, OR debit+credit pair
  const amount = findHeader(headers, AMOUNT_ALIASES);
  const debit = findHeader(headers, DEBIT_ALIASES);
  const credit = findHeader(headers, CREDIT_ALIASES);

  const category = findHeader(headers, CATEGORY_ALIASES);
  const type = findHeader(headers, TYPE_ALIASES);

  if (!date || !description) return null;
  if (!amount && !(debit && credit)) return null;

  return {
    date,
    description,
    altDescription: altDescription && altDescription !== description ? altDescription : undefined,
    amount,
    debit,
    credit,
    category,
    type,
  };
}

// ─── Low-level parsers ──────────────────────────────────────────────────────

export function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // MM/DD/YYYY or M/D/YYYY
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // MM-DD-YYYY
  const mdyDash = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdyDash) {
    const [, m, d, y] = mdyDash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // YYYY-MM-DD (already ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // YYYY/MM/DD
  const ymd = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

export function parseAmount(raw: string): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Remove currency symbols, commas, whitespace. Support parentheses as negative.
  let cleaned = s.replace(/[$£€¥,\s]/g, '');
  let negative = false;
  const paren = cleaned.match(/^\((.+)\)$/);
  if (paren) {
    negative = true;
    cleaned = paren[1];
  }
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

// ─── CSV-only classification helpers ────────────────────────────────────────

// ─── Categories that mark a row as INCOME in any bank CSV ────────────────
// Positive amounts + one of these labels → income (not a refund).
const INCOME_CATEGORY_STRINGS = new Set([
  'paycheck',
  'payroll',
  'salary',
  'wages',
  'income',
  'interest income',
  'dividend',
  'dividends',
  'investment income',
  'refund',           // tax refund
  'tax refund',
  'federal tax',
  'state tax',
  'taxes',
  'tax return',
  'benefits',
  'social security',
  'unemployment',
]);

// ─── Categories that mean "skip this row entirely" ──────────────────────
// Transfers between your own accounts, credit card payoffs — never count as
// income or expense (they'd double-count against the credit-card CSV).
const SKIP_CATEGORY_STRINGS = new Set([
  'transfer',
  'transfers',
  'internal transfer',
  'credit card payment',
  'credit card payoff',
  'card payment',
  'balance transfer',
]);

// Returns true if a CSV "category" column value means this row should be
// skipped (transfer / CC payoff). Bank-agnostic.
export function isSkippedCategory(csvCategory: string | undefined): boolean {
  if (!csvCategory) return false;
  return SKIP_CATEGORY_STRINGS.has(csvCategory.trim().toLowerCase());
}

// Returns true if a CSV "category" column value (plus positive amount) means
// this row is income. Bank-agnostic.
export function isIncomeCategory(csvCategory: string | undefined): boolean {
  if (!csvCategory) return false;
  return INCOME_CATEGORY_STRINGS.has(csvCategory.trim().toLowerCase());
}

// Returns true if a description matches patterns that strongly indicate this
// row is income, regardless of CSV category. Used when there is no category
// column.
export function descriptionLooksLikeIncome(description: string): boolean {
  return /\b(payroll|paycheck|direct\s+dep|salary|wages|tax\s+(refund|return)|irs\s+treas|treas\s+310|va\s+benef|benefits|unemployment|\bssa\b|ssi\b|dividend|interest\s+paid|interest\s+income|deposit@mobile|mobile\s+deposit|funds\s+transfer\s+cr|remote\s+deposit)\b/i.test(description);
}

// Returns true if a description matches patterns for transfers / CC payoffs.
// Used when there is no category column.
export function descriptionLooksLikeTransferOrPayment(description: string): boolean {
  return /\b(transfer\s+to|transfer\s+from|venmo\s+(payment|cashout)|\bzelle\b|autopay|auto-pmt|online\s+payment|payment\s+thank\s+you|automatic\s+payment|credit\s+card\s+payment|card\s+payment|epay|e-pay|chase\s+credit\s+crd|citi\s+card)\b/i.test(description);
}
