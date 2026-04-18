# Verification Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the Lotus codebase, remove dead code, deduplicate, and split oversized files — without changing any user-visible behavior or look/feel. Leave the codebase in a clean state before the mobile-friendly pass.

**Architecture:** React + Vite + TypeScript frontend (GitHub Pages) + Cloudflare Worker backend (KV storage). Single-user personal finance app with CSV import, dashboard analytics, and custom categories. Current surface: 3 protected routes (DataEntry, Dashboard, Settings) + Login. Worker is a single 701-line file; Dashboard is a single 1724-line file containing ~5 sub-components; DataEntry is 990 lines. This plan moves those sub-components into dedicated files, extracts shared utilities, removes confirmed-unused exports, and does minimal CSS prep for the upcoming mobile pass.

**Tech Stack:** React 18, Vite 5, TypeScript (strict), Recharts, PapaParse, pdfjs-dist, date-fns. Cloudflare Workers + KV. Web Crypto API for PBKDF2 / HMAC. No test framework currently configured — verification is `tsc --noEmit` + `npm run build` clean + manual smoke test.

**Scope constraints:**
- No functional changes — existing UI and data flows must look and behave identically.
- No API contract changes (endpoints, request/response shapes stay the same).
- Mobile-prep CSS tweaks allowed only where they don't visibly affect desktop rendering.
- Behavior-changing security additions (rate limiting, stricter validation, TOTP replay prevention) are deferred to a later plan — see **Deferred Items** at the end.

**Verification after every task:** `cd frontend && npx tsc --noEmit && npm run build` must succeed. Worker changes additionally require `cd worker && npx tsc --noEmit`.

---

## File Structure

### Files being created

- `frontend/src/components/EmptyState.tsx` — extracted from Dashboard
- `frontend/src/components/DangerZone.tsx` — extracted from Dashboard
- `frontend/src/components/dashboard/ExpenseCategoryTable.tsx` — extracted from Dashboard
- `frontend/src/components/dashboard/MonthlyBalanceView.tsx` — extracted from Dashboard
- `frontend/src/components/dashboard/ExpandedMonthView.tsx` — extracted from Dashboard
- `frontend/src/components/dashboard/constants.ts` — shared Dashboard-scope constants (chart colors, drill-down range labels, month names)
- `frontend/src/components/data-entry/DuplicateStatusCell.tsx` — extracted from DataEntry
- `frontend/src/components/data-entry/CSVUploadPreview.tsx` — extracted from DataEntry
- `frontend/src/components/data-entry/ManualExpenseForm.tsx` — extracted from DataEntry
- `frontend/src/components/data-entry/IncomeForm.tsx` — extracted from DataEntry (covers pay stub upload + manual income)
- `worker/src/crypto.ts` — PBKDF2, JWT, TOTP, base32 helpers — extracted from index.ts

### Files being modified

- `frontend/src/api/client.ts` — remove unused `deleteTransaction`, `deleteIncome` exports
- `frontend/src/types/index.ts` — remove unused `SetupStatus`, `AuthState`, `CATEGORIES` alias
- `frontend/src/utils/dataProcessing.ts` — remove unused `getYearsSorted`; export shared `MONTH_NAMES`
- `frontend/src/utils/categories.ts` — move `isSkippedCategory`, `isIncomeCategory`, `descriptionLooksLikeIncome`, `descriptionLooksLikeTransferOrPayment` out (they're only used by csvParser)
- `frontend/src/utils/csvParser.ts` — inline the four helpers moved out of categories.ts
- `frontend/src/pages/Dashboard.tsx` — reduce from 1724 lines to ~300 by importing the extracted pieces
- `frontend/src/pages/DataEntry.tsx` — reduce from 990 lines by importing extracted forms
- `frontend/src/index.css` — remove dead `.grid-3` rule; add responsive min-width clamp to Toast positioning via CSS
- `frontend/src/components/Toast.tsx` — replace hardcoded `minWidth: 320` with responsive `min(320px, calc(100vw - 32px))`
- `worker/src/index.ts` — remove crypto inline code, import from new `crypto.ts`; extract `bytesToHex` / `hexToBytes` helpers

### Files unchanged

- `frontend/src/App.tsx`, `main.tsx`, `index.html`, `vite.config.ts`, configs
- `frontend/src/utils/pdfParser.ts`, `dedup.ts` — already well-scoped
- `frontend/src/hooks/useUserCategories.ts` — already well-scoped
- `frontend/src/components/CategorySelect.tsx`, `Logo.tsx`, `Layout.tsx` — already focused
- `worker/wrangler.toml`, `worker/package.json`
- `.github/workflows/deploy.yml`

---

## Phase 1: Dead Code Removal (low-risk warm-up)

### Task 1.1: Remove unused API client exports

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Confirm `deleteTransaction` and `deleteIncome` have no remaining callers**

Run:
```bash
cd /var/home/Grey/Projects/Lotus
grep -rn "deleteTransaction\|deleteIncome" frontend/src 2>&1
```
Expected: only the two export declarations in `frontend/src/api/client.ts`. No call sites anywhere else. (They were superseded by `bulkDelete`.)

- [ ] **Step 2: Delete both functions**

Remove the entire `deleteTransaction` function block (the `export async function deleteTransaction(id: string)...` lines) from `frontend/src/api/client.ts`.

Remove the entire `deleteIncome` function block likewise.

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run build
```
Expected: PASS, no errors about missing symbols.

- [ ] **Step 4: Commit**

```bash
cd /var/home/Grey/Projects/Lotus
git add frontend/src/api/client.ts
git commit -m "chore: remove unused deleteTransaction/deleteIncome API exports

Superseded by bulkDelete in current UI. Both single-entity delete
endpoints remain on the Worker for any future consumers but are no
longer reachable from the client."
```

---

### Task 1.2: Remove unused type exports

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Confirm `SetupStatus`, `AuthState`, and `CATEGORIES` alias are unused**

Run:
```bash
grep -rn "SetupStatus\|AuthState\b" frontend/src 2>&1
```
Expected: only the export declarations. `SetupStatus` is currently inlined in Login via the response shape; `AuthState` was planned but never adopted.

Run:
```bash
grep -rn "\bCATEGORIES\b" frontend/src 2>&1
```
Expected: only the alias declaration in `types/index.ts`. All call sites use `BUILT_IN_CATEGORIES` directly.

- [ ] **Step 2: Delete the three exports**

In `frontend/src/types/index.ts`, remove:
- The `export const CATEGORIES = BUILT_IN_CATEGORIES;` line and its comment
- The `export interface SetupStatus { initialized: boolean; }` block
- The `export interface AuthState { step: ...; preAuthToken?: string; error?: string; }` block

- [ ] **Step 3: Verify build**

Run:
```bash
cd frontend && npx tsc --noEmit && npm run build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "chore: remove unused SetupStatus, AuthState, CATEGORIES alias"
```

---

### Task 1.3: Remove unused `getYearsSorted` helper

**Files:**
- Modify: `frontend/src/utils/dataProcessing.ts`

- [ ] **Step 1: Confirm no callers**

Run:
```bash
grep -rn "getYearsSorted" frontend/src 2>&1
```
Expected: only the declaration in `dataProcessing.ts`.

- [ ] **Step 2: Delete the function**

In `frontend/src/utils/dataProcessing.ts`, remove the entire `export function getYearsSorted(...)` block.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/dataProcessing.ts
git commit -m "chore: remove unused getYearsSorted helper"
```

---

### Task 1.4: Remove dead `.grid-3` CSS rule

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Confirm `.grid-3` is unused (`.grid-2` is used and must stay)**

Run:
```bash
grep -rn "grid-3\b" frontend/src 2>&1
```
Expected: only the two CSS rule declarations (line 450 standalone, line 453 inside the mobile media query). Zero usages in `.tsx` files.

- [ ] **Step 2: Edit the CSS**

In `frontend/src/index.css`:
- Remove the line `.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }`
- In the `@media (max-width: 640px)` block, change `.grid-2, .grid-3 { grid-template-columns: 1fr; }` to `.grid-2 { grid-template-columns: 1fr; }`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: PASS. (CSS changes don't fail tsc, but `build` will inline the CSS into the output.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "chore: drop dead .grid-3 CSS rule"
```

---

## Phase 2: Encapsulation / Deduplication

### Task 2.1: Centralize `MONTH_NAMES`

**Files:**
- Modify: `frontend/src/utils/dataProcessing.ts`
- Modify: `frontend/src/pages/Dashboard.tsx`

`MONTH_NAMES` is declared once as a local `const` inside `buildMonthlyBalance` in `dataProcessing.ts` and again at module scope in `Dashboard.tsx`. Centralize it.

- [ ] **Step 1: Export `MONTH_NAMES` from dataProcessing.ts**

In `frontend/src/utils/dataProcessing.ts`, add a top-level export just below the existing `getTrendingCategories` function:

```ts
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
```

Remove the inner `const MONTH_NAMES = [...]` line inside `buildMonthlyBalance` — the outer export will satisfy the reference.

- [ ] **Step 2: Import and use in Dashboard**

In `frontend/src/pages/Dashboard.tsx`:
- Delete the line `const MONTH_NAMES = ['Jan', 'Feb', ...];` at module scope (currently line 58).
- Add `MONTH_NAMES` to the existing import from `'../utils/dataProcessing'`.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/dataProcessing.ts frontend/src/pages/Dashboard.tsx
git commit -m "refactor: export shared MONTH_NAMES from dataProcessing"
```

---

### Task 2.2: Move csv-only helpers out of categories.ts

**Files:**
- Modify: `frontend/src/utils/categories.ts`
- Modify: `frontend/src/utils/csvParser.ts`

`isSkippedCategory`, `isIncomeCategory`, `descriptionLooksLikeIncome`, `descriptionLooksLikeTransferOrPayment` are implementation details of `csvParser.ts`. They have no callers elsewhere.

- [ ] **Step 1: Verify no external callers**

Run:
```bash
grep -rn "isSkippedCategory\|isIncomeCategory\|descriptionLooksLikeIncome\|descriptionLooksLikeTransferOrPayment" frontend/src 2>&1
```
Expected: every hit is in `utils/categories.ts` (declarations) or `utils/csvParser.ts` (the four imports + the four call sites).

- [ ] **Step 2: Also move the supporting `SKIP_CATEGORY_STRINGS` and `INCOME_CATEGORY_STRINGS` sets**

These two `Set` constants in `categories.ts` are only read by the four helpers being relocated. Move them too.

In `frontend/src/utils/csvParser.ts`, add (above `parseTransactionCSV`) the four functions and their two supporting sets, copied verbatim from `categories.ts`. Change the function declarations from `export function` to just `function` (they become module-local).

- [ ] **Step 3: Remove them from categories.ts**

In `frontend/src/utils/categories.ts`:
- Delete the `const INCOME_CATEGORY_STRINGS = new Set([...])` block
- Delete the `const SKIP_CATEGORY_STRINGS = new Set([...])` block
- Delete the four `export function isSkippedCategory`, `isIncomeCategory`, `descriptionLooksLikeIncome`, `descriptionLooksLikeTransferOrPayment` blocks.

- [ ] **Step 4: Update the import in csvParser.ts**

Remove the four helpers from the `import { ... } from './categories'` statement at the top of `csvParser.ts`. The import should now only pull in `applyUserMappings` and `categorize`.

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/categories.ts frontend/src/utils/csvParser.ts
git commit -m "refactor: collocate csv-only helpers with the parser

isSkippedCategory, isIncomeCategory, descriptionLooksLikeIncome, and
descriptionLooksLikeTransferOrPayment (plus their supporting
SKIP/INCOME string sets) are implementation details of
parseTransactionCSV. Move them there so categories.ts only exports
the merchant/color API that is genuinely shared."
```

---

### Task 2.3: Extract hex conversion helpers in the worker

**Files:**
- Modify: `worker/src/index.ts`

`hashPassword` and `verifyPassword` each inline the same `[...u8].map((b) => b.toString(16).padStart(2, '0')).join('')` pattern, and `verifyPassword` inlines the inverse hex-to-bytes pattern. Extract both.

- [ ] **Step 1: Add two helpers just above `hashPassword`**

In `worker/src/index.ts`, insert above the existing `async function hashPassword(...)` declaration:

```ts
function bytesToHex(u8: Uint8Array): string {
  return [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
}
```

- [ ] **Step 2: Replace inline code in `hashPassword`**

Replace the inline `toHex` lambda and its two calls with two calls to `bytesToHex`:

```ts
// Before:
const toHex = (u8: Uint8Array) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;

// After:
return `pbkdf2:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(bits))}`;
```

- [ ] **Step 3: Replace inline code in `verifyPassword`**

Replace the inline `fromHex` lambda and its salt decode with `hexToBytes`:

```ts
// Before:
const fromHex = (hex: string) => new Uint8Array((hex.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));
const salt = fromHex(saltHex);
// ... later:
const newHashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');

// After:
const salt = hexToBytes(saltHex);
// ...
const newHashHex = bytesToHex(new Uint8Array(bits));
```

- [ ] **Step 4: Verify build**

Run: `cd worker && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts
git commit -m "refactor: extract bytesToHex/hexToBytes helpers in worker"
```

---

### Task 2.4: Extract Dashboard-scope constants

**Files:**
- Create: `frontend/src/components/dashboard/constants.ts`
- Modify: `frontend/src/pages/Dashboard.tsx`

The four chart colors (`INCOME_COLOR`, `EXPENSE_COLOR`, `SURPLUS_COLOR`, `DEFICIT_COLOR`) and the `DRILL_DOWN_RANGE_LABELS` map currently live at module scope inside `Dashboard.tsx`. They'll need to be referenced from the extracted `MonthlyBalanceView` and `ExpandedMonthView` components in Phase 3, so move them to a dedicated constants file first.

- [ ] **Step 1: Create the new file**

Create `frontend/src/components/dashboard/constants.ts` with:

```ts
// Shared constants for the Dashboard page and its extracted sub-components.

export const SURPLUS_COLOR = '#7dd3fc'; // muted sky blue
export const DEFICIT_COLOR = '#a78bfa'; // muted violet
export const INCOME_COLOR = '#4ade80';
export const EXPENSE_COLOR = '#f87171';

export type DrillDownRange = 'year' | 'last12' | 'last3' | 'all';

export const DRILL_DOWN_RANGE_LABELS: Record<DrillDownRange, string> = {
  year: 'This year',
  last12: 'Last 12 months',
  last3: 'Last 3 months',
  all: 'All time',
};

// Shared formatter for chart tick labels that must handle negatives.
// "-$1.5k", "$500", etc.
export function formatAxisCurrency(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const short = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k` : String(abs);
  return `${sign}$${short}`;
}
```

- [ ] **Step 2: Remove the old definitions from Dashboard.tsx**

In `frontend/src/pages/Dashboard.tsx`:
- Delete the `type DrillDownRange = 'year' | 'last12' | ...` declaration near the top
- Delete the `const DRILL_DOWN_RANGE_LABELS: Record<...> = { ... }` block
- Delete the four `const SURPLUS_COLOR`, `DEFICIT_COLOR`, `INCOME_COLOR`, `EXPENSE_COLOR` declarations
- Delete the `function formatAxisCurrency(...)` declaration

- [ ] **Step 3: Add import**

At the top of `Dashboard.tsx`, add:

```ts
import {
  SURPLUS_COLOR,
  DEFICIT_COLOR,
  INCOME_COLOR,
  EXPENSE_COLOR,
  DrillDownRange,
  DRILL_DOWN_RANGE_LABELS,
  formatAxisCurrency,
} from '../components/dashboard/constants';
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/constants.ts frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract Dashboard-shared constants to dedicated module"
```

---

## Phase 3: File Splits

### Task 3.1: Extract `EmptyState`

**Files:**
- Create: `frontend/src/components/EmptyState.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create the component file**

Create `frontend/src/components/EmptyState.tsx` with:

```tsx
interface EmptyStateProps {
  message: string;
}

export default function EmptyState({ message }: EmptyStateProps) {
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.875rem',
      }}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        style={{ margin: '0 auto 12px', opacity: 0.4 }}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
      <p>{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Delete the local `function EmptyState` from Dashboard.tsx and import instead**

In `frontend/src/pages/Dashboard.tsx`:
- Remove the entire `function EmptyState({ message }: { message: string }) { ... }` block
- Add at the top: `import EmptyState from '../components/EmptyState';`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EmptyState.tsx frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract EmptyState to its own component"
```

---

### Task 3.2: Extract `ExpenseCategoryTable`

**Files:**
- Create: `frontend/src/components/dashboard/ExpenseCategoryTable.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

This is the largest single sub-component in Dashboard (~290 lines). It owns its own state (selection set, search query, drill-down range, edit draft) so it ports cleanly.

- [ ] **Step 1: Identify the block**

In `frontend/src/pages/Dashboard.tsx`, the section to extract runs from the comment `// ─── Expandable Expense Category Table ─────` through the closing brace of `function ExpenseCategoryTable(...)`. This includes:
- The `EditDraft` interface (rename to `ExpenseEditDraft` on extract since it only applies to expenses)
- The `ExpenseCategoryTableProps` interface
- The `ExpenseCategoryTable` function itself

- [ ] **Step 2: Create the new file**

Create `frontend/src/components/dashboard/ExpenseCategoryTable.tsx`. Copy the entire block verbatim. At the top add the imports the component needs:

```tsx
import { useState, useEffect } from 'react';
import { parseISO, subMonths } from 'date-fns';
import { Transaction, Category, UserCategories } from '../../types';
import { updateTransaction } from '../../api/client';
import { formatCurrency, MONTH_NAMES } from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../CategorySelect';
import { DrillDownRange, DRILL_DOWN_RANGE_LABELS } from './constants';
```

Rename the local `EditDraft` interface to `ExpenseEditDraft` within this file (it doesn't cross file boundaries, but the rename avoids conflict with `ExpandedMonthView`'s `MonthEditDraft` if they were ever in the same scope). Export the component as default.

- [ ] **Step 3: Remove the block from Dashboard.tsx and add the import**

In `Dashboard.tsx`:
- Remove the extracted block (the interface declarations and the function)
- Add: `import ExpenseCategoryTable from '../components/dashboard/ExpenseCategoryTable';`
- Drop any imports that are now unused in Dashboard.tsx (e.g., `subMonths`, potentially `parseISO` if no other usage remains — run the build to find out)

- [ ] **Step 4: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS. TypeScript will flag any leftover unused imports; remove them.

- [ ] **Step 5: Manual smoke test checklist**

Before committing, quickly verify in the dev server:
1. Dashboard loads; expense-by-category table renders
2. Click a category row → drill-down appears with search input and date range
3. Select a row checkbox → batch delete button appears
4. Edit a row → inline inputs appear, save works
5. "Back to all categories" button returns to the full table

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/ExpenseCategoryTable.tsx frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract ExpenseCategoryTable to its own file"
```

---

### Task 3.3: Extract `MonthlyBalanceView`

**Files:**
- Create: `frontend/src/components/dashboard/MonthlyBalanceView.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

`MonthlyBalanceView` renders the normal (non-expanded) income-vs-expense table and bar chart.

- [ ] **Step 1: Create the new file**

Create `frontend/src/components/dashboard/MonthlyBalanceView.tsx`. Copy the `MonthlyBalanceViewProps` interface and `MonthlyBalanceView` function verbatim from `Dashboard.tsx`. Add at the top:

```tsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { formatCurrency } from '../../utils/dataProcessing';
import {
  SURPLUS_COLOR, DEFICIT_COLOR, INCOME_COLOR, EXPENSE_COLOR, formatAxisCurrency,
} from './constants';
```

Export as default.

- [ ] **Step 2: Remove the block from Dashboard.tsx and add the import**

- Remove `interface MonthlyBalanceViewProps` and `function MonthlyBalanceView`
- Add `import MonthlyBalanceView from '../components/dashboard/MonthlyBalanceView';`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Verify the Dashboard's "Income vs. Expenditures" card renders with all four bars (Income, Expenses, Surplus, Deficit) and the table is clickable to drill into a month.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/MonthlyBalanceView.tsx frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract MonthlyBalanceView to its own file"
```

---

### Task 3.4: Extract `ExpandedMonthView`

**Files:**
- Create: `frontend/src/components/dashboard/ExpandedMonthView.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

This is the second-largest block (~430 lines) — daily trend chart, category summary chips, chronological activity list with edit/delete.

- [ ] **Step 1: Create the new file**

Create `frontend/src/components/dashboard/ExpandedMonthView.tsx`. Copy the `ExpandedMonthViewProps` interface, the `MonthEditDraft` interface, and the `ExpandedMonthView` function verbatim. Imports at the top:

```tsx
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Transaction, IncomeEntry, Category, UserCategories } from '../../types';
import { updateTransaction, updateIncome } from '../../api/client';
import {
  buildDailyBalance, buildMonthEvents, formatCurrency, MONTH_NAMES,
} from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../CategorySelect';
import { INCOME_COLOR, EXPENSE_COLOR } from './constants';
```

Export as default.

- [ ] **Step 2: Remove the block from Dashboard.tsx and add the import**

- Remove `interface ExpandedMonthViewProps`, `interface MonthEditDraft`, and `function ExpandedMonthView`
- Add: `import ExpandedMonthView from '../components/dashboard/ExpandedMonthView';`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Click a month bar in Income vs Expenditures → verify:
1. Daily trend chart renders
2. Category summary chips appear
3. Activity table shows transactions + income
4. Search input filters rows
5. Edit a transaction → inline inputs save
6. Edit an income entry → inline inputs save
7. Back button returns to the full year view

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/ExpandedMonthView.tsx frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract ExpandedMonthView to its own file"
```

---

### Task 3.5: Extract `DangerZone`

**Files:**
- Create: `frontend/src/components/DangerZone.tsx`
- Modify: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create the new file**

Create `frontend/src/components/DangerZone.tsx`. Copy the `DangerZoneProps` interface and `DangerZone` function verbatim. Imports at the top:

```tsx
import { useState } from 'react';
import { Transaction, IncomeEntry, UserCategories } from '../types';
import { purgeAllData } from '../api/client';
```

Export as default.

- [ ] **Step 2: Remove the block from Dashboard.tsx and add the import**

- Remove the `DangerZoneProps` interface and `function DangerZone`
- Remove any comment block that was above the DangerZone declaration
- Add: `import DangerZone from '../components/DangerZone';`
- Check if `purgeAllData` is still imported in Dashboard.tsx — if not, drop it from the api/client imports

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Scroll to bottom of Dashboard → verify Danger Zone card renders with both "Download JSON backup" and "Purge all data" flows.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DangerZone.tsx frontend/src/pages/Dashboard.tsx
git commit -m "refactor: extract DangerZone to its own component"
```

---

### Task 3.6: Verify Dashboard.tsx is now small and coherent

**Files:**
- Inspect: `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Count remaining lines**

Run: `wc -l frontend/src/pages/Dashboard.tsx`
Expected: roughly 250–320 lines. The file should now contain only:
- Imports
- The top-level `Dashboard` function (with `useState` hooks, `refetchAll`, `handleDelete`, `handleUndo`, `handleUpdate{Transaction,Income}`, and the render)
- Nothing else

- [ ] **Step 2: Verify no stale references**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS. If any import is unused, remove it.

- [ ] **Step 3: No commit needed if nothing changed** (this task is verification only; if you find unused imports or dead code remnants, fix them and commit with a message like `chore: tidy Dashboard.tsx imports after extraction`).

---

### Task 3.7: Extract `DuplicateStatusCell` from DataEntry

**Files:**
- Create: `frontend/src/components/data-entry/DuplicateStatusCell.tsx`
- Modify: `frontend/src/pages/DataEntry.tsx`

- [ ] **Step 1: Create the new file**

Create `frontend/src/components/data-entry/DuplicateStatusCell.tsx`. Copy the `DuplicateStatusCellProps` interface and `DuplicateStatusCell` function verbatim from `DataEntry.tsx`. Imports:

```tsx
// No external imports needed — only React props and inline styles
```

Also export the `DuplicateStatus` type (currently in `DataEntry.tsx` as `type DuplicateStatus = 'unique' | 'pending' | 'approved' | 'denied';`):

```tsx
export type DuplicateStatus = 'unique' | 'pending' | 'approved' | 'denied';
```

Export the component as default.

- [ ] **Step 2: Update DataEntry.tsx**

- Remove the `type DuplicateStatus = ...` declaration (now imported)
- Remove the `interface DuplicateStatusCellProps` and `function DuplicateStatusCell`
- Add: `import DuplicateStatusCell, { DuplicateStatus } from '../components/data-entry/DuplicateStatusCell';`

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/data-entry/DuplicateStatusCell.tsx frontend/src/pages/DataEntry.tsx
git commit -m "refactor: extract DuplicateStatusCell to its own file"
```

---

### Task 3.8: Document DataEntry split as optional follow-on

**Files:**
- Inspect only: `frontend/src/pages/DataEntry.tsx`

The remaining DataEntry extractions (`CSVUploadPreview`, `ManualExpenseForm`, `IncomeForm`) are **not** included as mandatory tasks because they involve significant state ownership (the upload flow owns `userCategories`, `existingDedupLookup`, `pendingUndo`-equivalent state, and the income form shares state with the pay-stub upload). Splitting cleanly requires either lifting state via props (regressing the encapsulation we just improved with `useUserCategories`) or threading multiple callback layers.

**Decision:** Defer the full DataEntry split to a follow-up plan that can think carefully about the state model. The `DuplicateStatusCell` extraction in Task 3.7 is the one safe win that doesn't require rearchitecting state.

- [ ] **Step 1: Confirm DataEntry.tsx is within acceptable range**

Run: `wc -l frontend/src/pages/DataEntry.tsx`
Expected: roughly 930–970 lines (down from 990 after DuplicateStatusCell extraction). Not great, but acceptable without functional changes.

- [ ] **Step 2: Add a header comment flagging the split for later**

At the top of `DataEntry.tsx`, just below the import block, add:

```tsx
// NOTE: This file is deliberately large because the CSV upload flow and the
// manual/pay-stub income flow share non-trivial state (existingDedupLookup,
// pendingDuplicate handoff, useUserCategories). A future refactor should
// introduce a useDataEntryState() hook and extract CSVUploadPreview,
// ManualExpenseForm, and IncomeForm as separate components. Tracked in
// docs/superpowers/plans/<future>-data-entry-split.md.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DataEntry.tsx
git commit -m "docs: flag DataEntry split as deferred follow-up"
```

---

### Task 3.9: Extract Worker crypto helpers to `crypto.ts`

**Files:**
- Create: `worker/src/crypto.ts`
- Modify: `worker/src/index.ts`

The worker's first ~160 lines are cryptographic primitives (PBKDF2 password hash/verify, JWT sign/verify, TOTP base32 + generate + verify). They have no dependency on the routing logic and are pure functions over Web Crypto API.

- [ ] **Step 1: Create `worker/src/crypto.ts`**

Move these into the new file verbatim:
- `bytesToHex`, `hexToBytes` (added in Task 2.3)
- `hashPassword`, `verifyPassword`
- `b64url`, `b64urlDecode`
- `signJWT`, `verifyJWT`
- `base32Decode`, `generateTOTPSecret`, `getTOTP`, `verifyTOTP`

Export each one as a named export. Keep the module-internal helpers (`bytesToHex`, `hexToBytes`, `b64url`, `b64urlDecode`) exported as well since they could be useful, but they aren't strictly required to be public — mark them `// eslint-disable-next-line` free by leaving them as plain exports.

- [ ] **Step 2: Update imports in `worker/src/index.ts`**

At the top of `worker/src/index.ts`, add:

```ts
import {
  hashPassword,
  verifyPassword,
  signJWT,
  verifyJWT,
  generateTOTPSecret,
  getTOTP,
  verifyTOTP,
} from './crypto';
```

Remove the moved declarations from `index.ts`.

- [ ] **Step 3: Verify the `getTOTP` helper is not needed externally**

Run:
```bash
grep -n "getTOTP" worker/src/index.ts
```
Expected: only call sites (from inside `verifyTOTP`). If no external call remains, `getTOTP` can stay module-private inside `crypto.ts` — remove it from the exports. `verifyTOTP` is what `index.ts` calls.

- [ ] **Step 4: Verify build**

Run: `cd worker && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke test (if wrangler dev is running)**

Restart `wrangler dev`, then:
1. Hit `/api/setup/status` → should still return `{ initialized: true }`
2. Log in with your password + TOTP → should succeed

- [ ] **Step 6: Commit**

```bash
git add worker/src/crypto.ts worker/src/index.ts
git commit -m "refactor: extract crypto primitives to worker/src/crypto.ts

Pulls PBKDF2 password hashing, JWT sign/verify, and TOTP generation
into a focused module. index.ts now only contains route handling and
data access, which makes it easier to reason about the auth surface."
```

---

## Phase 4: Mobile-Prep Tweaks (structural prep only)

### Task 4.1: Make Toast responsive

**Files:**
- Modify: `frontend/src/components/Toast.tsx`

- [ ] **Step 1: Replace the fixed minWidth**

In `frontend/src/components/Toast.tsx`, find the style object on the wrapper `<div>` and change:

```tsx
// Before:
minWidth: 320,
maxWidth: 'calc(100vw - 32px)',

// After:
minWidth: 'min(320px, calc(100vw - 32px))',
maxWidth: 'calc(100vw - 32px)',
```

This keeps the 320px floor on desktop but collapses cleanly on phones narrower than 352px total (320 + 32 padding).

- [ ] **Step 2: Verify visually in dev server**

Run the dev server and trigger a delete on a transaction → toast should appear, and resizing the browser to 375px width should show it fitting without horizontal scroll.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Toast.tsx
git commit -m "style: make Toast width responsive for narrow viewports"
```

---

### Task 4.2: Add mobile-safe padding to login card

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Find the existing `@media (max-width: 640px)` block near the bottom of index.css**

It currently contains only `.grid-2 { grid-template-columns: 1fr; } .hide-mobile { display: none; }`.

- [ ] **Step 2: Add a login-card rule**

Extend the media query:

```css
@media (max-width: 640px) {
  .grid-2 { grid-template-columns: 1fr; }
  .hide-mobile { display: none; }
  .login-card { padding: 24px; }
}
```

The desktop `.login-card { padding: 40px; }` stays in place above.

- [ ] **Step 3: Verify visually**

Open Login page, shrink viewport to 375px → card should have 24px instead of 40px padding and feel appropriately sized. Desktop look at 1000px+ is unchanged.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "style: tighten login card padding on narrow viewports"
```

---

## Phase 5: Self-Review

### Task 5.1: Run full verification

**Files:** none modified

- [ ] **Step 1: Clean type-check both workspaces**

```bash
cd /var/home/Grey/Projects/Lotus/frontend && npx tsc --noEmit
cd /var/home/Grey/Projects/Lotus/worker && npx tsc --noEmit
```
Expected: both PASS with zero errors.

- [ ] **Step 2: Clean build**

```bash
cd /var/home/Grey/Projects/Lotus/frontend && npm run build
```
Expected: PASS. Bundle size should be similar to before (file splits don't change what's imported at runtime).

- [ ] **Step 3: Manual smoke test checklist**

Start both dev servers (`wrangler dev` in worker/, `npm run dev` in frontend/). In the browser:

| Flow | Expected |
|---|---|
| Login with existing credentials | ✓ lands on Dashboard |
| Dashboard loads all 4 sections | ✓ Spending Trends, Expenses by Category, Income vs Expenditures, Averages |
| Upload a CSV (any sample) | ✓ preview shows, duplicates flagged with twin info |
| Assign a custom category in preview | ✓ mapping saves |
| Import a batch | ✓ success message, Dashboard refreshes |
| Click a category row on Dashboard | ✓ drill-down, search, date range all work |
| Edit a transaction | ✓ save persists |
| Delete a transaction → Undo | ✓ toast appears, Undo restores |
| Click a month on Income vs Expenditures | ✓ expanded month view |
| Navigate to Settings | ✓ custom categories and mappings list |
| Rename a custom category | ✓ transactions update, Dashboard reflects |
| Scroll to Danger Zone | ✓ Download JSON works; Purge flow requires "DELETE" typed |

If anything fails, note which task introduced the regression and git-bisect.

- [ ] **Step 4: Document completion**

Create a brief summary commit message or PR description listing:
- Lines removed (target: ~100+ net across dead-code tasks)
- Files created (10)
- Dashboard.tsx reduction (target: 1724 → <320 lines)
- Worker index.ts reduction (target: 701 → <500 lines)

---

## Deferred Items (for future plans, explicitly out of scope here)

These are valuable improvements identified during the audit but deferred because they would change user-facing behavior or require significant rearchitecture — both violating the "no functionality change" constraint of this pass.

1. **Rate limiting on auth endpoints** (`worker/src/index.ts` login / verify-2fa). Track failed attempts per-IP in KV; return 429 after N failures within a window. Blocking brute-force is genuinely important; schedule as its own plan with explicit UX decisions (lockout duration, user-facing error message wording, whether to email, etc.).

2. **TOTP replay prevention.** Store used `${code}:${timestep}` combinations in KV with 90-second TTL; reject on second use. Low impact on happy path, real protection against stolen-cookie replay.

3. **Stricter input validation on PUT/POST endpoints.** Validate date format (`/^\d{4}-\d{2}-\d{2}$/`), bound string lengths, check that amounts are finite numbers with reasonable magnitude. This is defensive; the current code trusts the client more than it should. Schedule alongside general API hardening.

4. **Full DataEntry component split.** See `Task 3.8` note. Requires introducing a `useDataEntryState` hook first.

5. **Responsive table overhaul.** Tables (`ExpenseCategoryTable` drill-down, `ExpandedMonthView` activity list, `Settings` custom-category table, CSV preview) currently overflow horizontally on narrow viewports. Proper fix is either horizontal card layout at mobile breakpoint, or column hiding. This is the meat of the mobile-friendly pass and deserves a dedicated plan.

6. **Chart responsive sizing.** `ResponsiveContainer` is already used, but the `height` prop is hardcoded. Mobile work should consolidate heights into CSS custom properties or conditionally adjust based on breakpoint.

7. **Bundle size.** `recharts` (525 KB) and `pdfjs-dist` (364 KB) dominate the build. If bundle size becomes an issue, consider lazy-loading pdfjs (only needed on DataEntry's pay-stub upload) and investigating lighter-weight chart libraries.

8. **Tests.** There is no test framework currently. Before the mobile pass would be a good time to add Vitest + React Testing Library and write coverage for the utilities (csvParser, categorize, dedup helpers) which are pure functions and would pay off quickly.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-verification-pass.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because most tasks are mechanical and parallel-friendly.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, with checkpoints at each Phase boundary for you to review and sanity-check.

**Which approach?**
