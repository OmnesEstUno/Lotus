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
(Populated in Phases 7–9.)

### Inline Styles
(Populated in Phase 10.)

### Resource Leaks
(Populated in Phase 11.)

### Error Handling
(Populated in Phase 12.)

## Mobile / React Native Readiness
(Populated in Phase 13.)
