import Papa from 'papaparse';
import { CategoryMapping, CSVParseResult, ParsedCSVRow, ParseError } from '../../types';
import { applyUserMappings, categorize } from '../categorization/rules';
import {
  CSVSchema,
  detectSchema,
  parseDate,
  parseAmount,
  isSkippedCategory,
  isIncomeCategory,
  descriptionLooksLikeIncome,
  descriptionLooksLikeTransferOrPayment,
} from './shared';

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
