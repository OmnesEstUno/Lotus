export const CATEGORIES = [
  'Costco',
  'Amazon',
  'Groceries',
  'Dining & Takeout',
  'Gas',
  'Shopping',
  'Travel',
  'Entertainment',
  'Pet Care',
  'Subscriptions & Utilities',
  'Automotive',
  'Health & Wellness',
  'Personal Care',
  'Home & Garden',
  'Fees & Interest',
  'Taxes',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Transaction {
  id: string;
  date: string; // ISO date: YYYY-MM-DD
  description: string;
  category: Category;
  amount: number; // negative = expense, positive = refund/credit
  type: 'expense' | 'refund';
  source: 'csv' | 'manual';
}

export interface TaxBreakdown {
  federal: number;
  state: number;
  socialSecurity: number;
  medicare: number;
  other: number;
}

export interface IncomeEntry {
  id: string;
  date: string; // ISO date: YYYY-MM-DD
  description: string;
  grossAmount: number;
  netAmount: number;
  taxes: TaxBreakdown;
  source: 'manual' | 'paystub';
}

export type TimeRange = 'week' | 'month' | '3month' | 'year' | 'all';

export interface ParsedExpenseRow {
  kind: 'expense';
  date: string;
  description: string;
  category: Category;
  amount: number; // negative = expense, positive = refund
  type: 'expense' | 'refund';
}

export interface ParsedIncomeRow {
  kind: 'income';
  date: string;
  description: string;
  amount: number; // always positive
}

export type ParsedCSVRow = ParsedExpenseRow | ParsedIncomeRow;

export interface CSVParseResult {
  rows: ParsedCSVRow[];
  errors: ParseError[];
  skippedCount?: number; // rows intentionally skipped (transfers, CC payments)
}

export interface ParseError {
  row: number;
  message: string;
}

export interface SetupStatus {
  initialized: boolean;
}

export interface AuthState {
  step: 'idle' | 'password' | 'totp' | 'authenticated';
  preAuthToken?: string;
  error?: string;
}
