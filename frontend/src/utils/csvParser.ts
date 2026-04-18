import Papa from 'papaparse';
import { CategoryMapping, CSVParseResult, ParsedCSVRow, ParseError } from '../types';
import { applyUserMappings, categorize } from './categories';

// ─── Schema Detection ───────────────────────────────────────────────────────
//
// We don't care which bank the CSV came from. We find the columns we need by
// matching header names against a list of aliases, with substring matching as
// a fallback. That covers Chase, Citi, Bank of America, Amex, credit unions,
// Mint exports, personal bank exports, and so on.

interface CSVSchema {
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

function normalize(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, ' ');
}

function findHeader(headers: string[], aliases: string[]): string | undefined {
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

function detectSchema(headers: string[]): CSVSchema | null {
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

function parseDate(raw: string): string | null {
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

function parseAmount(raw: string): number | null {
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
function isSkippedCategory(csvCategory: string | undefined): boolean {
  if (!csvCategory) return false;
  return SKIP_CATEGORY_STRINGS.has(csvCategory.trim().toLowerCase());
}

// Returns true if a CSV "category" column value (plus positive amount) means
// this row is income. Bank-agnostic.
function isIncomeCategory(csvCategory: string | undefined): boolean {
  if (!csvCategory) return false;
  return INCOME_CATEGORY_STRINGS.has(csvCategory.trim().toLowerCase());
}

// Returns true if a description matches patterns that strongly indicate this
// row is income, regardless of CSV category. Used when there is no category
// column.
function descriptionLooksLikeIncome(description: string): boolean {
  return /\b(payroll|paycheck|direct\s+dep|salary|wages|tax\s+(refund|return)|irs\s+treas|treas\s+310|va\s+benef|benefits|unemployment|\bssa\b|ssi\b|dividend|interest\s+paid|interest\s+income|deposit@mobile|mobile\s+deposit|funds\s+transfer\s+cr|remote\s+deposit)\b/i.test(description);
}

// Returns true if a description matches patterns for transfers / CC payoffs.
// Used when there is no category column.
function descriptionLooksLikeTransferOrPayment(description: string): boolean {
  return /\b(transfer\s+to|transfer\s+from|venmo\s+(payment|cashout)|\bzelle\b|autopay|auto-pmt|online\s+payment|payment\s+thank\s+you|automatic\s+payment|credit\s+card\s+payment|card\s+payment|epay|e-pay|chase\s+credit\s+crd|citi\s+card)\b/i.test(description);
}

// ─── Row parser (works for any schema) ──────────────────────────────────────

interface RowOutcome {
  row?: ParsedCSVRow;
  error?: ParseError;
  skipped?: boolean;
}

function parseRow(
  raw: Record<string, string>,
  schema: CSVSchema,
  rowNum: number,
  userMappings?: CategoryMapping[],
): RowOutcome {
  // ─ Date ────────────────────────────────
  const rawDate = raw[schema.date] || '';
  const date = parseDate(rawDate);
  if (!date) {
    return {
      error: {
        row: rowNum,
        message: `Row ${rowNum}: The date "${rawDate}" is not in a recognizable format (expected something like MM/DD/YYYY or YYYY-MM-DD).`,
      },
    };
  }

  // ─ Description ─────────────────────────
  const rawDesc = (raw[schema.description] || '').trim();
  const rawAltDesc = schema.altDescription ? (raw[schema.altDescription] || '').trim() : '';
  const description = rawDesc || rawAltDesc;
  if (!description) return { skipped: true };

  // ─ Type hint (e.g. Chase "Type": Sale / Payment / Return / Adjustment) ─
  const csvType = schema.type ? (raw[schema.type] || '').trim().toLowerCase() : '';
  if (csvType === 'payment') return { skipped: true };

  // ─ Amount — either single column or debit/credit pair ─
  let amount: number;
  let signIsExpense: boolean;

  if (schema.amount) {
    const parsed = parseAmount(raw[schema.amount] || '');
    if (parsed === null || parsed === 0) return { skipped: true };
    amount = parsed;
    signIsExpense = amount < 0;
  } else if (schema.debit && schema.credit) {
    const debitVal = parseAmount(raw[schema.debit] || '');
    const creditVal = parseAmount(raw[schema.credit] || '');
    const debitAbs = debitVal !== null ? Math.abs(debitVal) : 0;
    const creditAbs = creditVal !== null ? Math.abs(creditVal) : 0;

    if (debitAbs > 0 && creditAbs === 0) {
      amount = -debitAbs;
      signIsExpense = true;
    } else if (creditAbs > 0 && debitAbs === 0) {
      amount = creditAbs;
      signIsExpense = false;
    } else {
      return { skipped: true };
    }
  } else {
    return { skipped: true };
  }

  // ─ Category hint from CSV (optional) ─
  const csvCategory = schema.category ? (raw[schema.category] || '').trim() : '';

  // ─ Skip transfers & CC payoffs (don't count as income OR expense) ─
  if (isSkippedCategory(csvCategory) || descriptionLooksLikeTransferOrPayment(description)) {
    return { skipped: true };
  }

  // ─ Income detection ─
  //
  // A row is income if it has a positive amount (or a "credit") AND either:
  //   - the CSV category says so (paycheck, income, tax refund, ...), or
  //   - the description contains an income keyword (payroll, IRS TREAS, ...).
  //
  // Category resolution: user mappings win over the built-in merchant rules
  // so that previously-assigned custom categories auto-apply on re-upload.
  const resolveCategory = () =>
    applyUserMappings(description, userMappings) ?? categorize(description, csvCategory);

  // If positive but not clearly income, treat as a refund (store return).
  if (!signIsExpense) {
    const isIncome = isIncomeCategory(csvCategory) || descriptionLooksLikeIncome(description);
    if (isIncome) {
      return {
        row: {
          kind: 'income',
          date,
          description,
          amount: Math.abs(amount),
        },
      };
    }
    return {
      row: {
        kind: 'expense',
        date,
        description,
        category: resolveCategory(),
        amount: Math.abs(amount),
        type: 'refund',
      },
    };
  }

  // ─ Ordinary expense ─
  return {
    row: {
      kind: 'expense',
      date,
      description,
      category: resolveCategory(),
      amount: -Math.abs(amount),
      type: 'expense',
    },
  };
}

// ─── Entrypoint ─────────────────────────────────────────────────────────────

export async function parseTransactionCSV(
  file: File,
  userMappings?: CategoryMapping[],
): Promise<CSVParseResult> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        const schema = detectSchema(headers);

        if (!schema) {
          resolve({
            rows: [],
            errors: [
              {
                row: 0,
                message:
                  "We couldn't identify the required columns in this file. Please make sure your CSV has at minimum a date column, a description/payee column, and either a single amount column or separate debit/credit columns.",
              },
            ],
          });
          return;
        }

        const rawRows = results.data as Record<string, string>[];
        const parsed: ParsedCSVRow[] = [];
        const errors: ParseError[] = [];
        let skipped = 0;

        rawRows.forEach((raw, idx) => {
          const outcome = parseRow(raw, schema, idx + 2, userMappings);
          if (outcome.error) errors.push(outcome.error);
          else if (outcome.skipped) skipped++;
          else if (outcome.row) parsed.push(outcome.row);
        });

        resolve({ rows: parsed, errors, skippedCount: skipped });
      },
      error: (err) => {
        resolve({
          rows: [],
          errors: [
            { row: 0, message: `The file could not be read: ${err.message}. Please make sure it is a valid CSV file.` },
          ],
        });
      },
    });
  });
}

// ─── Kept for pay stub CSV extraction in pdfParser.ts ──────────────────────

export async function parseIncomeCSV(file: File): Promise<{ text: string; error?: string }> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as string[][];
        const text = rows.map((r) => r.join('\t')).join('\n');
        resolve({ text });
      },
      error: (err) => {
        resolve({ text: '', error: `The file could not be read: ${err.message}.` });
      },
    });
  });
}
