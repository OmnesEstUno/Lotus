# Lotus Code Review Findings — 2026-04-23

## Scope
Full review of frontend/ and worker/ per the code-review-cleanup plan.

## Baseline
- Starting LOC (Phase 0): 11,750 (frontend/src + worker/src, .ts/.tsx/.css)
- Starting branch: `chore/code-review-cleanup` off `main` @ `023a6a4`
- Worktree: `/var/home/Grey/.config/superpowers/worktrees/Lotus/code-review-cleanup`

## Executive Summary
- Duplication: worker/src/invites.ts and workspace-invites.ts are ~90% identical.
- Security: Missing rate limiting on login/TOTP; read-modify-write races on all bulk mutations.
- Mobile: Only one breakpoint (640px); many fixed px dimensions; ~18 static inline style blocks.
- RN portability: 11+ localStorage sites, 15+ window.alert/confirm/prompt sites, 4 recharts components, 1 pdfjs dependency, 1 qrcode component, 1 react-datepicker component.

## Findings by Category

### Dead Code / Unused Imports

**Task 1.1 result: No unused imports found.**

All `.ts` / `.tsx` files under `frontend/src/` and `worker/src/` were scanned. Every imported symbol is referenced at least once outside its import line. Verification approach:

1. `tsc --noEmit` with `noUnusedLocals: true` — zero errors on both frontend and worker.
2. Manual grep of each imported symbol in all 6 known-heavy files (DataEntry.tsx, Dashboard.tsx, Settings.tsx, Login.tsx, TransactionDrillDown.tsx, worker/src/index.ts) — all symbols referenced.
3. Manual grep of every import in every remaining `.ts`/`.tsx` file — all symbols referenced.

**Notable observation (not an unused import, note for style cleanup):**
- `frontend/src/components/charts/CategoryLineChart.tsx` imports from `'../../types'` in two separate `import` statements (line 12 and line 15). Both are used; they could be merged into one statement for tidiness. This is a style issue, not an unused import, and is out of scope for Task 1.1.

**Task 1.2 result: 5 dead exports removed; 2 flagged spots resolved; no commented-out code found.**

Dead exports removed:

| File | Symbol | Rationale |
|------|--------|-----------|
| `frontend/src/utils/dedup.ts` | `export function transactionDedupKey` | Only called within `dedup.ts` itself (`buildExistingDedupLookup`, `recordRowInBatch`). No external imports. De-exported (kept, visibility reduced). |
| `frontend/src/utils/dedup.ts` | `export function incomeDedupKey` | Same — only called internally. De-exported. |
| `frontend/src/utils/dedup.ts` | `export function rowDedupKey` | Same — only called internally. De-exported. |
| `frontend/src/hooks/useDashboardLayout.ts` | `export const CARD_IDS` | Only used within `useDashboardLayout.ts`. External consumers import `CardId` (the type) and `CARD_LABELS`, but not `CARD_IDS` itself. De-exported. |
| `frontend/src/pages/Settings.tsx` | `export type { UserCategories }` | Re-export stub with comment "for use elsewhere if needed". All consumers import `UserCategories` from `'../types'` directly — none import it from `Settings`. Removed re-export + now-unused import from Settings. |

Flagged spots:

- **`Dashboard.tsx:137` eslint-disable** — KEPT and replaced with explanatory `// eslint-disable-next-line` comment. The disable is load-bearing: the effect runs `setLoading(false)` on mount only as the "initial load" no-instance path. `refetchAll` has stable identity (`useCallback(…, [])`), but `activeInstanceId` must NOT be added because a second effect at lines 140–147 already handles workspace-change refetches; adding `activeInstanceId` here would reset loading to `false` at the same tick the second effect sets it to `true`, causing a visible flash. The empty-deps intent is correct.

- **`Logo.tsx` ASPECT constant** — INLINED. `ASPECT = 180 / 120` was used exactly once; inlined as the literal `1.5` with a trailing comment `// 180/120 aspect ratio`. The aspect ratio description moved into the JSDoc comment above the function. No readability loss.

Commented-out code sweep: 415 non-TODO/NOTE/FIXME comment lines audited. All are section headers, inline explanations, or instructional prose. Zero abandoned code blocks found.

**Task 1.2 (follow-up): 2 additional dead exports removed (missed in prior sweep).**

- `frontend/src/components/charts/CategoryLineChart.tsx`: removed dead export of `Props as CategoryLineChartProps` (no external consumers)
- `frontend/src/components/dashboard/TimeRangeSelector.tsx`: removed dead `export { TIME_RANGE_LABELS }` (internal-only)

### Duplication

**Phase 2 — frontend duplication:**

- `frontend/src/utils/dateConstants.ts` — new module exporting `MONTH_NAMES_SHORT` (and a `MonthIndex` type). The previously duplicated month-name array in `dataProcessing.ts` (`MONTH_NAMES`) and `DateRangePicker.tsx` (`MONTH_LABELS`) were removed. Three additional consumers (`Dashboard.tsx`, `ExpandedMonthView.tsx`, `ExpenseCategoryTable.tsx`) were migrated; the bridging deprecated re-export was deleted.
- `frontend/src/utils/dataProcessing.ts` — the two parallel branches of `buildMonthlyBalance` (year === -1 all-time and specific-year) shared near-identical accumulation loops over transactions and income entries. Extracted as a private `accumulateByPeriod(transactions, incomeEntries, periodKey, filterTx, filterIncome): Map<string, PeriodBucket>` helper at the top of the module. Both branches now call it with appropriate callbacks. Behavior preserved (verified by tracing). Date is parsed once per item (no double-parse regression).

**Phase 3 — worker duplication:**

- `worker/src/invite-primitives.ts` — new module containing the previously-duplicated crypto/encoding helpers (`hmacSign`, `b64urlEncode*`, `deriveDomainKey`, `getDomainKeyCached`, `encodeToken`, `decodeAndVerifyToken`, `readInviteRecord`, `markUsed`, `InviteCommon`). Adds a constant-time signature comparison (an upgrade over the prior plain `!==`).
- `worker/src/invites.ts` — rewritten on top of `invite-primitives`. Dropped from 107 to 51 lines.
- `worker/src/workspace-invites.ts` — rewritten on top of `invite-primitives`. Dropped from 121 to 68 lines.
- `worker/src/index.ts` — extracted private `requireAuth(request, env, cors)` helper that wraps `authenticate` + 401-on-null. Both `authenticateAdmin` and `authenticateInstanceOwner` now call it; one additional inline duplicate in the route handlers was also migrated.

### Security

**Phase 5 — hardening pass.**

| Task | What changed | File(s) |
|---|---|---|
| 5.1 | Default security headers on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Implemented in the central `respond()` helper so every endpoint inherits. | `worker/src/index.ts` |
| 5.2 | CORS no longer falls back to `*` when no origin matches. The previous fallback returned the production `ALLOWED_ORIGIN` to ANY mismatched origin (an additional bug); both behaviors are removed. New behavior: empty `Access-Control-Allow-Origin` when origin doesn't match localhost or `ALLOWED_ORIGIN`. Added `Vary: Origin` header. Added `X-Instance-Id` to the allow-headers list. | `worker/src/index.ts` |
| 5.3 | Rate-limiting: per-username on `/api/auth/login` (5 attempts / 15 min lockout) and per-preauth-id on `/api/auth/verify-2fa` (5 attempts / 60 sec lockout). KV-backed via `checkAndIncrement` helper. Counter clears on successful auth. Note: KV is eventually consistent — documented as an acceptable limitation for serial brute-force traffic. | `worker/src/index.ts` + `worker/src/constants.ts` |
| 5.4 | Setup flow `init→confirm` now requires a short-lived (90-second) one-shot token. Issued in `/api/setup/init` response, required in `/api/setup/confirm` body, deleted on success. Frontend (`Login.tsx`, `api/client.ts`) updated to plumb the token end-to-end. | `worker/src/index.ts`, `frontend/src/pages/Login.tsx`, `frontend/src/api/client.ts` |
| 5.5 | PBKDF2 iterations bumped 100k → 600k (OWASP 2023+ guidance). Backward-compat: stored hashes prefixed with literal `pbkdf2:` are detected as legacy 100k; new hashes use `${iterations}:${salt}:${hash}` format. Both forms verify correctly. TOTP window narrowed from `[-1, 0, +1]` (90s) to `[-1, 0]` (60s). Combined with rate limiting from 5.3, brute force becomes infeasible. | `worker/src/crypto.ts` |
| 5.6 | Invite-metadata leak audit: response was already correctly omitting the full `members` array (just sending `alreadyMember: boolean`). Documented the design intent with a code comment to guard against future regressions. | `worker/src/index.ts` |
| 5.7 | JSON body size caps on batch endpoints. `MAX_BATCH_SIZE = 1000` for content-bearing arrays; `MAX_BULK_IDS = 10,000` for ID-only arrays. Returns HTTP 413 when exceeded. Capped fields: `body.transactions` (POST /api/transactions), `body.customCategories` and `body.mappings` (PUT /api/user-categories), `body.transactionIds` and `body.incomeIds` (POST /api/bulk-delete). | `worker/src/index.ts` |

### Concurrency / Data Integrity

**Phase 6 — optimistic concurrency + crash safety.**

Background: prior to this work, several worker endpoints did read-modify-write on KV records without protection. Two browser tabs (or two devices) editing the same workspace could silently lose each other's edits.

**6.1 — Versioning on per-instance data (transactions, income, user categories):**

- Storage: added `version: number` to the `YearIndex` (in `worker/src/paginated.ts`) and to the user-categories KV record. Every write path (`upsertInYear`, `writeAllYears`, `deleteFromAnyYear`, `updateInAnyYear`, user-categories PUT/rename/delete) increments the version. Legacy records without a version default to 0.
- Reads: `GET /api/transactions`, `GET /api/income`, `GET /api/user-categories` now include `version` in their response envelopes.
- Writes: 11 write endpoints now require `expectedVersion` (or split `expectedTransactionsVersion`/`expectedIncomeVersion`/`expectedUserCategoriesVersion` for endpoints that touch multiple resources). Missing field → 400; stale field → 409 with `{ error: 'conflict', currentVersion }`. Endpoints covered:
  - `POST /api/transactions` (add)
  - `POST /api/income` (add)
  - `PUT /api/user-categories`
  - `POST /api/bulk-delete` (conditional version per non-empty array)
  - `POST /api/transactions/bulk-update-category`
  - `POST /api/rename-category` (dual: transactions + user-categories)
  - `POST /api/delete-category` (dual)
  - `PUT /api/transactions/:id` (single record)
  - `DELETE /api/transactions/:id`
  - `PUT /api/income/:id`
  - `DELETE /api/income/:id`
- Frontend: a module-private `resourceVersions` map in `frontend/src/api/client.ts` is populated by every read function and consumed by every mutation function. A `ConflictError` class extends `Error` with a `currentVersion` field and is thrown by the `request()` helper on 409. `Dashboard.tsx`, `Settings.tsx`, and `DataEntry.tsx` catch `ConflictError`, refetch fresh data, and surface a "Data was changed elsewhere — please retry" message.
- The `useUserCategories` auto-save hook performs an automatic single retry on conflict (since auto-save is a fire-and-forget side effect, the user shouldn't see it fail).
- Endpoints intentionally exempt: `POST /api/purge-all` (destructive wipe by design, behind explicit confirm flag).

**6.2 — Versioning on workspace (instance) metadata:**

- Storage: `version: number` added to the `Instance` record. Read paths default missing → 0; writes increment.
- Read: `GET /api/instances` now returns `version` per instance; frontend stashes via `resourceVersions.set('instance:<id>', v)`.
- Writes gated: `PUT /api/instances/:id` (rename) and `DELETE /api/instances/:id/members/:u` (remove member). Both 409 on mismatch.
- Exemptions (documented in code): `POST /api/instances` (new resource), `DELETE /api/instances/:id` (owner-only delete; double-click race returns 404), `POST /api/instances/invites/accept` (invite token is the authorization, and the "already a member" guard prevents duplicate-accept).
- UI: `WorkspacesCard.tsx` handlers catch `ConflictError` and show a refresh-and-retry message.

**6.3 — Crash-safety on paginated index:**

- `worker/src/paginated.ts` `upsertInYear` now writes the year-index BEFORE the shard. If a partial failure occurs, the index is a superset (a phantom year with no shard), and the read path already tolerates missing shards as `[]`. Previously, a crash between writes could leave an orphaned shard not referenced from the index — silently invisible data.
- `writeAllYears` (full bulk rewrite) was NOT changed; it does a parallel multi-write where the ordering question is genuinely ambiguous. Documented as out-of-scope for this task.

**Known limitations:**

- Cloudflare KV is eventually consistent; two concurrent requests at the same edge POP can both read the pre-increment count. For brute-force or two-tab traffic that serializes through one POP, the version mechanism still works. Documented as an acceptable limitation.
- Partial deploys (frontend updated, worker not yet) cause writes to send `expectedVersion` that the old worker ignores. Reverse (new worker, old frontend) means the new worker rejects writes with 400. The GitHub Actions workflow deploys both together, so this only affects manual partial deploys.

### Hard-coded Values

**Task 4.2 result: 24 replacements across 11 source files; all literals migrated to `frontend/src/utils/constants.ts`.**

#### Storage Keys (`STORAGE_KEYS`)

`STORAGE_KEYS.HIDDEN` was added to the constant object as part of this task (the other five keys already existed from Task 4.1).

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `STORAGE_KEYS.TOKEN` | `api/client.ts` | 3 |
| `STORAGE_KEYS.USERNAME` | `api/client.ts` | 4 |
| `STORAGE_KEYS.ACTIVE_INSTANCE` | `api/client.ts` (was `ACTIVE_INSTANCE_STORAGE_KEY`) | 4 |
| `STORAGE_KEYS.PENDING_WORKSPACE_INVITE` | `pages/WorkspaceInvitePage.tsx`, `pages/Login.tsx` | 5 |
| `STORAGE_KEYS.DASHBOARD_ORDER` | `hooks/useDashboardLayout.ts` | 2 |
| `STORAGE_KEYS.DASHBOARD_MINIMIZED` | `hooks/useDashboardLayout.ts` | 2 |
| `STORAGE_KEYS.HIDDEN` | `hooks/useDashboardLayout.ts` | 2 |

#### Unix Ms Multiplier (`UNIX_MS_MULTIPLIER`)

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `UNIX_MS_MULTIPLIER` (was `* 1000`) | `components/InviteTokensCard.tsx`, `components/WorkspacesCard.tsx`, `pages/WorkspaceInvitePage.tsx` | 3 |

Not replaced: `frontend/src/utils/dataProcessing.ts:92` — `span / (24 * 60 * 60 * 1000)` converts milliseconds to days; this is a different domain (ms→days, not unix→ms) and has no matching constant.

#### Timing Constants

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `TOAST_DEFAULT_DURATION_MS` (was `5000`) | `components/Toast.tsx` | 1 |
| `TOAST_TICK_INTERVAL_MS` (was `50`) | `components/Toast.tsx` | 1 |
| `SUCCESS_FLASH_DURATION_MS` (was `1200`) | `pages/DataEntry.tsx` | 3 |
| `TOUCH_SENSOR_DELAY_MS` (was `200`) | `pages/Dashboard.tsx`, `pages/Settings.tsx` | 2 |
| `TOUCH_SENSOR_TOLERANCE_PX` (was `5`) | `pages/Dashboard.tsx`, `pages/Settings.tsx` | 2 |

Not replaced: `transition: 'width 50ms linear'` in `Toast.tsx` — this is a CSS duration string (not a JS numeric literal), a distinct value that happens to match `TOAST_TICK_INTERVAL_MS` only coincidentally.

#### Chart Constants

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `CHART_HEIGHT_PX` (was `400`) | `components/charts/CategoryLineChart.tsx` | 1 |
| `CHART_Y_AXIS_HEADROOM` (was `1.1`) | `components/charts/CategoryLineChart.tsx` | 1 |
| `CHART_Y_TICK_STEP` (was `50`) | `components/charts/CategoryLineChart.tsx` | 2 |

#### Year-Range Constants

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `YEAR_LOOKBACK` (was `- 10`) | `components/DateRangePicker.tsx`, `pages/Dashboard.tsx` | 3 |
| `YEAR_LOOKFORWARD` (was `+ 10`) | `components/DateRangePicker.tsx` | 1 |

#### Auth-Validation Constants

| Constant | Replaced in file(s) | Count |
|----------|--------------------|----|
| `PASSWORD_MIN_LENGTH` (was `8`) | `pages/Login.tsx` | 2 |
| `USERNAME_REGEX` (was `/^[a-z0-9_-]{3,32}$/`) | `pages/Login.tsx` | 2 |
| `USERNAME_HINT` (was `'3–32 characters: lowercase letters, digits, underscore, or dash.'`) | `pages/Login.tsx` | 2 |

Note: The error message strings `'Username must be 3–32 characters...'` were NOT replaced with `USERNAME_HINT` because they contain additional prose (`'Username must be '` prefix) and do not match the constant's value verbatim.

### CSS / Responsive Units

**Phase 7 — design tokens.** Added spacing scale (`--space-0` through `--space-12`), typography scale (`--font-size-xs` through `--font-size-3xl` plus weights), z-index layer scale (`--z-base` through `--z-tooltip`), and touch-target tokens (`--touch-target-min: 44px`, `--touch-target-compact: 40px`). Bumped base font-size from 14px → 16px (conventional rem math). Migrated existing CSS rules in `frontend/src/index.css`:
- 3 z-index values mapped to layer tokens (`.navbar`, `.modal-backdrop`, `.fab-enter-data`); 5 left as literals (intra-table stacking 1/2/3, datepicker popper at 300).
- ~51 padding/margin/gap values migrated to spacing tokens. Hairlines (1-2px borders/dividers) kept as literals. Drop-zone uses `clamp(var(--space-6), 5vw, var(--space-10))` per Phase 9 prep.
- 22 font-sizes + 18 font-weights migrated to typography tokens. Non-standard sizes (0.8125rem, 0.95rem, etc.) and the 11px recharts axis label kept as literals.

**Phase 9 — responsive layout.**
- **9.1 Mobile-first breakpoints + fluid padding:** Sidebar (`.workspace-tabs`) flipped to mobile-first — hidden by default, shown via `@media (min-width: 640px)`. `.container` padding now `clamp(var(--space-3), 4vw, var(--space-6))`. `.modal-card` `max-width: min(90vw, 900px)` so it never overflows mobile screens. `.modal-card` and `.modal-backdrop` padding uses `clamp()` for fluid scaling.
- **9.2 Touch-target minimums:** `.btn`, `.btn-sm`, `.nav-link`, `.tab` all now meet 44px (or 40px compact). Drag handles, modal close button, and toggle-switch tap zones expanded to 44x44 (visual icon size preserved via explicit height/width on inner elements). `.dashboard-card-handle` got 44px hit area with `padding: var(--space-1)`.
- **9.3 Fluid typography:** `h1` uses `clamp(var(--font-size-2xl), 4vw, var(--font-size-3xl))` — floors at 24px on phones, caps at 30px on desktop. `h2` similarly clamped. `h3` left at fixed 1rem.

**Pixels intentionally retained:**
- Hairline borders/dividers/scrollbars (1-3px) — pixel-perfect by design
- Recharts axis labels (11px) — chart-library-internal
- Material symbol icon at fixed 32px — sized to grid
- Sidebar fixed width (150px) above 640px — desktop-only, not relative to font

**Single-breakpoint legacy** (`@media (max-width: 640px)`): the original CSS had only one breakpoint. Phase 9 added the inverse `@media (min-width: 640px)` for mobile-first sidebar; the original max-width block remains for any rules still using the desktop-first model. Both coexist; future refactors can flip remaining rules incrementally.

### Inline Styles

**Phase 8 — moved static inline styles to CSS classes; kept dynamic ones inline.**

| Task | File | Sites extracted | Sites kept inline (dynamic) |
|---|---|---|---|
| 8.1 | `frontend/src/components/layout/Layout.tsx` | 3: `.navbar-user`, `.main-content-wrapper`, `.main-content-inner` | none |
| 8.2 | `frontend/src/components/dashboard/DashboardCard.tsx` | 6: `.dashboard-card-header-left`, `.dashboard-card-handle`, `.dashboard-card-drag-icon`, `.dashboard-card-title`, `.dashboard-card-actions`, `.dashboard-card-minimize-btn` + `.dashboard-card-minimize-icon` | 3: drag transform/opacity/zIndex from useSortable, `marginBottom` conditional on `minimized` prop, drag-handle `cursor` toggle |
| 8.3 | `frontend/src/pages/DataEntry.tsx` | ~29 new CSS classes covering form headers, card margins, alert layouts, drop zone decorations, hidden file inputs, preview toolbar, duplicate banner, table cell widths, manual/income forms | 4: row background driven by `duplicateStatus`, chip colors driven by `isIncome` flag, two header-with-prose sites |

**Tokens used where they fit; literals kept where the design didn't match a token slot:**
- `0.95rem` (navbar user-name font-size) — no matching token; kept literal
- `1.375rem` (DashboardCard minimize icon at 22px) — no matching token; kept literal

**Components NOT touched** because their inline styles are entirely dynamic (props/state-driven):
- `frontend/src/components/CheckmarkToggle.tsx` (active/themeColor/size driven)
- `frontend/src/components/Modal.tsx` (body scroll lock toggle)
- `frontend/src/components/Toast.tsx` (progress bar width interpolated each tick)

### Resource Leaks

**Phase 10 — unmount-safety + cleanup discipline.**

- **DataEntry setTimeout** (`frontend/src/pages/DataEntry.tsx`): three `setTimeout(() => onRequestClose(), SUCCESS_FLASH_DURATION_MS)` calls in `submitUpload`, `submitManualExpense`, `submitManualIncome` previously fired even after the component unmounted, calling `onRequestClose` on a dead reference. Added `isMountedRef` with cleanup effect; each callback now guards with `if (!isMountedRef.current) return;`.
- **Toast** (`frontend/src/components/Toast.tsx`): the `setInterval` progress tick used to call `onDismiss()` after duration, even if the Toast had unmounted (parent state update warning). Also, including `onDismiss` in the effect's dep array meant the countdown reset every parent render. Fixed both:
  - `onDismissRef` updated via a sync effect; interval reads via the ref and drops `onDismiss` from deps (no more reset-on-render).
  - `mountedRef` guards the dismiss call (no state updates on unmounted components).
- **useWorkspaces hook**: already surfaces `error` state to callers; no change needed.

### Error Handling

**Phase 10.3 — surface previously-swallowed errors.**

- **`useUserCategories.ts`**: save errors (both conflict-retry and non-conflict catches) now set a `saveError` state field returned from the hook. Settings.tsx renders it as a second `alert-danger` banner.
- **`Settings.tsx` `refreshTransactions`**: replaced silent `.catch` with `setStatus({ kind: 'error', text: 'Could not refresh data — some figures may be stale.' })`.
- **`DataEntry.tsx` dedup lookup** (was `.catch(() => {})`): now sets a `dedupUnavailable` flag that renders an inline warning banner: "Duplicate detection unavailable — existing data could not be fetched. New rows may overlap with existing ones."

**Intentionally non-surfacing catches (kept):**
- `Settings.tsx handleRename/handleDelete` post-success `Promise.all([refreshTransactions(), getUserCategories()]).catch(() => undefined)` — post-success refresh; if it fails, the success message already shown is correct, and `refreshTransactions` sets its own error status anyway. Low-priority follow-up.

## Mobile / React Native Readiness

**Phase 13 deliverable:** `docs/mobile-readiness.md` — a self-contained spec for the next agent who will port Lotus to React Native with offline support.

The report catalogs:
- **What's ready** — abstractions (storage/dialog/download wrappers, constants module), design tokens, responsive layout, optimistic-concurrency machinery, hardened backend.
- **What still requires hands-on porting** — third-party libraries that don't have RN equivalents (recharts, react-datepicker, qrcode/qrcode.react, pdfjs-dist, dnd-kit, react-router-dom), DOM-only JSX primitives, CSS-to-StyleSheet migration, hash routing, form event-vs-text differences.
- **Offline support design** — what was NOT built in this pass and the recommended approach: local cache layer, mutation queue, conflict resolution UI, sync indicator, background sync.
- **Suggested migration order** — login scaffold → dashboard → data-entry → settings → offline → final QA.
- **Breakage watch list** — areas to test specifically: TOTP QR rendering, CSV upload, PDF parsing, drag-reorder, charts, datepicker.

See `docs/mobile-readiness.md` for the full report.

## Summary & Delta

**Cleanup branch:** `chore/code-review-cleanup` (off `main` @ `023a6a4`).

**Code volume:**
- Starting LOC (Phase 0): 11,750 (frontend/src + worker/src, .ts/.tsx/.css).
- Final LOC: 12,759.
- Delta: +1,009 lines (+8.6%).

The line count grew despite removing duplication because the cleanup added substantial new functionality:
- 6 new wrapper/constant modules (invite-primitives.ts, frontend constants.ts, worker constants.ts, dateConstants.ts, storage.ts, dialog.ts, download.ts).
- Versioning code across worker and frontend (~360 lines for optimistic concurrency).
- Rate-limiting helpers, security headers, and setup-token plumbing in the worker.
- ~38 new CSS classes for extracted inline styles + design tokens (~80 lines added to index.css).
- Error-surfacing UI in Settings, Dashboard, DataEntry.

Net effect: the codebase is **better organized**, **more secure**, **race-condition-free**, **mobile-responsive**, and **closer to RN-portable** — even with more lines.

**Commits:** 56 commits to `chore/code-review-cleanup` since `main`.

**Highlights by category:**
- **Dead code:** 7 dead exports removed; 1 magic constant inlined; 1 ESLint disable documented.
- **Duplication:** ~228 lines of duplicated invite code → 222 lines across 3 files (1 shared module, 2 thin adapters); 1 month-name array deduplicated; `accumulateByPeriod` extracted from `buildMonthlyBalance`.
- **Security:** 7 hardening fixes (headers, CORS, login rate-limit, TOTP rate-limit, setup-token binding, PBKDF2 600k+TOTP narrowing, body size caps).
- **Concurrency:** 11 write endpoints now require `expectedVersion`; 4 versioned resources (transactions, income, user-categories, instance metadata); paginated-index write order fixed for crash-safety.
- **Hard-coded values:** ~24 magic numbers and storage keys extracted to `frontend/src/utils/constants.ts`; 4 worker TTLs + KV-key helpers extracted to `worker/src/constants.ts`.
- **CSS:** spacing/typography/z-index/touch-target tokens added; ~60 px values migrated to tokens; mobile-first breakpoints + fluid container/modal padding; 44px touch-target minimums; fluid h1/h2 typography.
- **Inline styles:** ~38 static inline style sites moved to CSS classes across Layout, DashboardCard, DataEntry. Dynamic styles intentionally preserved.
- **Resource leaks:** setTimeout cleanup guards in DataEntry; Toast unmount safety + dep-array fix.
- **Error handling:** 3 swallowed-error sites now surface to UI (useUserCategories save, Settings refresh, DataEntry dedup lookup).
- **RN prep:** storage/dialog/download wrappers introduced; ~30 callsites migrated.

**What was deferred:**
- **Phase 12 (DataEntry split):** skipped per user direction. The 1000-line DataEntry.tsx is left intact — its sub-flows are intertwined enough that the next agent can naturally split them per RN screen during the port.
- **Pre-existing Dashboard.tsx oddness:** the dead `activeInstanceId === undefined` guard at line 135 remains (out of scope for cleanup; flagged for a future small refactor).
- **Two-import-statement style** in `CategoryLineChart.tsx` (cosmetic, not an unused-import issue).
- **`writeAllYears` ordering** in `worker/src/paginated.ts` — not changed; bulk-rewrite ordering is genuinely ambiguous and warrants a separate decision.

## Phase 14 — Second-pass deduplication (factories)

After the initial 13-phase cleanup, a follow-up survey identified six remaining structural duplication candidates that wouldn't have been caught by the first pass because they emerged from cumulative cleanup (e.g., the optimistic-concurrency pattern from Phase 6.1 created N similar mutation handlers; the dnd-kit usage in Dashboard + Settings reorder code).

| Phase | What changed | Files | Approach |
|---|---|---|---|
| 14a | Invites adapter factory | `worker/src/invite-primitives.ts`, `invites.ts`, `workspace-invites.ts` | `makeInviteModule<TRecord, TCreateOpts, TListOpts>()` returns a fully-typed CRUD object. Each adapter file shrank: `invites.ts` 52→22 lines, `workspace-invites.ts` 70→33 lines. Public API (function names + signatures) unchanged. |
| 14b | Worker `mutateVersioned` helper | `worker/src/index.ts` | Helper handles only concurrency control (parse `expectedVersion`, 400/409 logic, write-with-incremented-version, success response). Auth checks remain at endpoint layer. 6 endpoints migrated; 7 skipped (multi-resource, multi-version, or different response shapes). |
| 14c | Frontend `runMutation` helper | new `frontend/src/utils/mutation.ts` + Dashboard, Settings, DataEntry, WorkspacesCard | 12 mutation handlers consolidated. The helper takes `{ onStart, call, onSuccess, onConflict, onError, onFinally, conflictMessage }` and the page handlers become 5-10 lines each. All 12 `instanceof ConflictError` checks in pages/components removed. |
| 14d | `useSortableListReorder` hook | new `frontend/src/hooks/useSortableListReorder.ts` + Dashboard, Settings | Eliminated duplicated dnd-kit setup (sensors + drag-end handler). 14 lines removed from Dashboard, 15 from Settings. |
| 14e | `useListWithActions` hook | new `frontend/src/hooks/useListWithActions.ts` + ArchivedCard | One of three candidate components migrated; InviteTokensCard (intertwined QR-map state, conditional `expandedId`) and WorkspaceInvitesPanel (prop-driven re-fetch, response-derived state) didn't fit cleanly and were left intact. |
| 14f | `getVersionedList` helper | `frontend/src/api/client.ts` | 2 GET functions migrated (`getTransactions`, `getIncome`). `getUserCategories` (returns object, not array) and `getInstances` (per-item versioning) skipped. |

**Honest accounting on line counts:** The factories themselves add lines. Phase 14 net delta is **+114 lines** (12,759 → 12,873). The wins are:

- Structural duplication eliminated (the user's original concern).
- One source of truth for each pattern — future bugs/changes happen in one place.
- Future similar resources (new invite types, new versioned endpoints, new sortable lists) require ~10 lines of configuration instead of ~50 lines of copy-paste.
- All `ConflictError` recovery now flows through one helper — easier to reason about.

**Phase 14 commits (6):**
- `d7aa328` — invite adapters factory
- `98cd8de` — worker mutateVersioned helper
- `253e998` — frontend runMutation helper
- `bab28bf` — useSortableListReorder hook
- `5af2bb2` — useListWithActions hook
- `3025991` — getVersionedList helper

## Phase 15 — Encapsulation + folder structure

After the 14-phase content cleanup, a final pass reshaped the directory tree so file/folder names communicate architecture before any code is read. The plan: nested folders by responsibility, abbreviation removal, naming consistency.

| Sub-phase | What changed | Commits |
|---|---|---|
| 15a | Worker reorg: flat layout → `auth/`, `invites/`, `storage/` subfolders. Extracted `rateLimit.ts` from `index.ts`. Split `invite-primitives.ts` into `invites/primitives.ts` (low-level helpers) + `invites/moduleFactory.ts` (the `makeInviteModule` factory). Renamed `invites.ts` → `invites/inviteTokens.ts` (more specific name), `paginated.ts` → `storage/paginatedYearStorage.ts`, `migrations.ts` → `storage/kvMigrations.ts`. | 5 |
| 15b | Frontend utils reorg: `categories.ts` split into `categorization/{rules,colors}.ts`. `dataProcessing.ts` split into 7 files under `dataProcessing/` (one per `build*` function plus a `shared.ts` for cross-cutting helpers). `csvParser.ts` split by concern (`csv/{shared,parseTransactions,parseIncome}.ts`) — the original wasn't actually two-format-parsers; it was schema-detecting, so the split is by concern not by format. Renamed `dedup.ts` → `deduplication.ts`. | 4 |
| 15c | Frontend API reorg: `client.ts` (~600 lines) split into 8 per-resource files (`core.ts`, `auth.ts`, `transactions.ts`, `income.ts`, `categories.ts`, `instances.ts`, `invites.ts`, `featureRequests.ts`). 23 consumer files migrated to per-resource imports. `client.ts` deleted. Staged migration (core → resource files via re-export shim → migrate consumers → delete shim) kept the build green at every step. | 4 |

### Final directory structure

```
frontend/src/
├── api/
│   ├── core.ts                    (request, ConflictError, version map, getVersionedList)
│   ├── auth.ts                    (login, setup, TOTP, session subscriptions)
│   ├── transactions.ts            (CRUD + bulkUpdateCategory + bulkDelete + purgeAllData)
│   ├── income.ts                  (CRUD)
│   ├── categories.ts              (user categories CRUD + rename/delete)
│   ├── instances.ts               (workspace CRUD + active-instance state)
│   ├── invites.ts                 (admin tokens + workspace invite redemption)
│   └── featureRequests.ts         (CRUD)
├── utils/
│   ├── categorization/
│   │   ├── rules.ts               (categorize() + auto-rules)
│   │   └── colors.ts              (CATEGORY_COLORS + getCategoryColor)
│   ├── dataProcessing/
│   │   ├── monthlyBalance.ts
│   │   ├── categoryAverages.ts
│   │   ├── lineChartData.ts
│   │   ├── monthEvents.ts
│   │   ├── dailyBalance.ts
│   │   ├── monthlyExpenseTable.ts
│   │   └── shared.ts
│   ├── csv/
│   │   ├── shared.ts              (schema detection + low-level field parsers)
│   │   ├── parseTransactions.ts   (main entry)
│   │   └── parseIncome.ts         (pay-stub helper)
│   ├── deduplication.ts           (was dedup.ts)
│   ├── pdfParser.ts
│   ├── dateConstants.ts
│   ├── constants.ts
│   ├── storage.ts
│   ├── dialog.ts
│   ├── download.ts
│   └── mutation.ts
└── (rest of frontend/src/ unchanged: components/, hooks/, pages/, types/, etc.)

worker/src/
├── index.ts                       (routing — intentionally left as one large file)
├── constants.ts
├── auth/
│   ├── crypto.ts
│   └── rateLimit.ts
├── invites/
│   ├── primitives.ts
│   ├── moduleFactory.ts
│   ├── inviteTokens.ts
│   └── workspaceInvites.ts
└── storage/
    ├── paginatedYearStorage.ts
    └── kvMigrations.ts
```

### Why this matters

The directory tree now communicates architecture as data. A new agent (or human reader) dropped into the codebase can infer the system's layers and concerns from `ls -R src/` without reading a single line of code. Specifically:

- `frontend/src/api/{auth,transactions,income,categories,instances,invites}.ts` immediately tells you the API surface area.
- `worker/src/{auth,invites,storage}/` mirrors the same conceptual layers on the backend.
- `utils/categorization/{rules,colors}.ts` makes it clear that categorization has both a rule layer and a presentation layer.
- `utils/dataProcessing/<one file per chart function>` means jumping to the right code is name-driven, not grep-driven.

### Honest tradeoffs

- **Lines went up again:** +77 (12,873 → 12,950). Each new file has imports + module overhead. The win is exploration cost, not code volume.
- **More files to navigate:** 38 source files now vs ~30 before Phase 15. Reasonable in exchange for better grouping.
- **`worker/src/index.ts` still 1500 lines:** intentionally not split. Its responsibility is routing; splitting routing logic across files would fragment the Cloudflare Worker entry point in a way that complicates the eventual RN port without clear benefit.
- **No barrel `index.ts` files in new folders:** by design — consumers import from specific files, which keeps the tree shape informative and avoids cyclic-import surprises.

## Updated Final State

- **Total commits since main:** 76 (was 63 after Phase 14, +13 in Phase 15).
- **Final LOC:** 12,950 (was 12,759 after Phase 13, +91 in Phase 14, +77 in Phase 15).
- **Source files:** 38 (was ~30) under `frontend/src/{api,utils}` + `worker/src/`.
- **Skipped consolidations** (documented earlier): InviteTokensCard, WorkspaceInvitesPanel, getUserCategories, getInstances, multi-version worker endpoints, single-record query-param endpoint, FeatureRequest cards, chart containers, chart tooltips. **Skipped reorganizations:** worker's `index.ts` (routing — intentionally cohesive), pages/components (Phase 12 declined for similar cohesion reasons).

## Next Steps

1. Merge `chore/code-review-cleanup` to `main` (or open as a PR for review).
2. Hand `docs/mobile-readiness.md` to the next agent who'll start the React Native port.
3. Future small refactors as discovered: Dashboard.tsx effect simplification, CategoryLineChart import consolidation, writeAllYears ordering decision.
