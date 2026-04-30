# Lotus → React Native Migration Readiness

Generated 2026-04-26 after the code-review-cleanup pass. This document is a spec for the next agent who will port the Lotus web app to React Native with offline support.

---

## What's Ready

### Abstractions (one-stop swap points)

- **Storage layer** — `frontend/src/utils/storage.ts` exports two objects: `storage` (wraps `localStorage`) and `sessionStore` (wraps `sessionStorage`). Both expose sync `get`/`set`/`remove` methods; `storage` additionally has `subscribe(cb)` for cross-tab storage events. Every callsite in the app imports from this module — confirmed via grep: `frontend/src/api/client.ts`, `frontend/src/hooks/useCurrentUser.ts`, `frontend/src/hooks/useDashboardLayout.ts`, `frontend/src/pages/Login.tsx`, `frontend/src/pages/WorkspaceInvitePage.tsx`. No stray `localStorage` calls exist outside the abstraction (only `useCurrentUser.ts` imports both `storage` and calls it through the abstraction; a direct `localStorage` reference in that file is just for the `StorageEvent` type in the `subscribe` callback). To port to RN: swap each method's body to `@react-native-async-storage/async-storage`. **Important:** AsyncStorage is async — the current surface is sync (mirroring `localStorage`). The RN port must make the surface async (`Promise<string | null>` etc.) and update all callers at the same time.

- **Dialog layer** — `frontend/src/utils/dialog.ts` exports `dialog.alert(msg): Promise<void>`, `dialog.confirm(msg): Promise<boolean>`, and `dialog.prompt(msg, default?): Promise<string | null>`. Signatures are already async-returning (web implementations just wrap the sync calls in `Promise.resolve()`). Nine consumer files import from this module: `DangerZone.tsx`, `Dashboard.tsx`, `DataEntryContext.tsx`, `DataEntry.tsx`, `Settings.tsx`, `WorkspacesCard.tsx`, `InviteTokensCard.tsx`, `WorkspaceTabs.tsx`, and `TransactionDrillDown.tsx`. To port to RN: replace each method body with `Alert.alert` calls using callback-to-Promise bridging; caller signatures stay identical — no caller changes needed.

- **Download layer** — `frontend/src/utils/download.ts` exports `downloadBlob(filename, blob)` and `downloadJSON(filename, data)`, which use `URL.createObjectURL` and a synthesized `<a>` element. Only `frontend/src/components/DangerZone.tsx` imports this (backup export). To port to RN: replace both function bodies with the `Share` API (`Share.share({ url: filePath })`) or `react-native-fs` for writing to the device filesystem.

- **Constants module** — `frontend/src/utils/constants.ts` centralises all timing constants (`TOAST_DEFAULT_DURATION_MS`, `TOAST_TICK_INTERVAL_MS`, `SUCCESS_FLASH_DURATION_MS`), drag/touch tuning (`TOUCH_SENSOR_DELAY_MS`, `TOUCH_SENSOR_TOLERANCE_PX`), date ranges (`YEAR_LOOKBACK`, `YEAR_LOOKFORWARD`), auth rules (`PASSWORD_MIN_LENGTH`, `USERNAME_REGEX`), chart sizing (`CHART_HEIGHT_PX`, `CHART_Y_AXIS_HEADROOM`, `CHART_Y_TICK_STEP`), and all KV storage key factories (`STORAGE_KEYS.*`). Pure TS — no DOM dependency — fully RN-portable. Imported by 16+ files across the codebase.

- **Date constants** — `frontend/src/utils/dateConstants.ts` exports `MONTH_NAMES_SHORT` (a 12-element `const` tuple) and the `MonthIndex` type. No DOM dependency; RN-portable as-is.

### Design Tokens

`frontend/src/index.css` `:root` block defines the following tokens (values verified):

| Category | Tokens |
|---|---|
| Backgrounds | `--bg-base` (#09090b), `--bg-surface` (#18181b), `--bg-card` (#27272a), `--bg-elevated` (#3f3f46) |
| Borders | `--border` (#3f3f46), `--border-subtle` (#27272a) |
| Accent | `--accent` (#818cf8), `--accent-hover` (#6366f1), `--accent-dim` (rgba 15% opacity) |
| Text | `--text-primary` (#fafafa), `--text-secondary` (#6a6faa), `--text-muted` (#797eb9) |
| Semantic | `--success`/`--success-bg`, `--danger`/`--danger-bg`, `--warning`/`--warning-bg` |
| Radii | `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (12px) |
| Spacing | `--space-0` through `--space-12` (rem-based scale: 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3rem; note: `--space-7`, `--space-9`, `--space-11` are absent — skip to next defined value) |
| Typography (size) | `--font-size-xs` (0.75rem) through `--font-size-3xl` (1.875rem) |
| Typography (weight) | `--font-weight-regular` (400), `--font-weight-medium` (500), `--font-weight-semibold` (600), `--font-weight-bold` (700) |
| Z-index layers | `--z-base` (1), `--z-sticky` (100), `--z-dropdown` (200), `--z-modal-backdrop` (500), `--z-modal` (501), `--z-toast` (900), `--z-tooltip` (1000) |
| Touch targets | `--touch-target-min` (44px), `--touch-target-compact` (40px) |

Mirror all of these in a TypeScript `theme.ts` for RN. `StyleSheet` does not accept CSS variables — extract to a plain JS object keyed by token name, then reference via `theme.colors.bgBase` etc.

### Responsive layout (web, but instructive for RN)

- Mobile-first with a sidebar/tablet breakpoint at 640px.
- Container padding is fluid via `clamp(var(--space-3), 4vw, var(--space-6))` (0.75rem–1.5rem).
- Modal width is `min(90vw, 900px)`.
- 44px touch targets enforced on all interactive elements via `--touch-target-min`.
- `h1`/`h2` typography uses `clamp()` for fluid scaling between breakpoints.

In RN: media queries do not exist. Use `useWindowDimensions()` and conditionally pick style objects. The numeric breakpoints (640, 1024) translate directly.

### Optimistic concurrency / Conflict resolution

`frontend/src/api/client.ts` exports `ConflictError` (with `currentVersion?: number`) and maintains a module-private `resourceVersions: Map<string, number>`. The `lastKnownVersion(resource)` export is the read surface. Every read function populates the map via `rememberVersion()`; every mutation reads from it and sends `expectedVersion` in the request body.

Resources versioned: `transactions`, `income`, `userCategories`, `instance:<id>`.

The `request()` helper throws `ConflictError` on HTTP 409.

Pages that catch `ConflictError`: `Dashboard.tsx`, `DataEntry.tsx`, `Settings.tsx`, `WorkspacesCard.tsx`. The `useUserCategories` hook (`frontend/src/hooks/useUserCategories.ts`) also catches it and auto-retries once.

This is the **foundation for offline conflict resolution**. When the RN port goes offline-first:

1. Local mutations are queued with their `expectedVersion` snapshot.
2. On reconnect, the queue is drained in order.
3. A 409 response on a queued mutation triggers a refetch + UI prompt — same `ConflictError` branch as today.

### Backend hardening (no RN work needed)

The Cloudflare Worker (`worker/src/`) is production-ready:

- Security headers on every response (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`).
- CORS restricts to localhost (any port, dev) + `ALLOWED_ORIGIN` env var; never falls back to `*`.
- Login rate limit: 5 attempts per 15 minutes (`LOGIN_MAX_ATTEMPTS = 5`, `LOGIN_LOCKOUT_SECONDS = 900`).
- TOTP rate limit: 5 attempts per 60-second lockout (`TOTP_MAX_ATTEMPTS = 5`, `TOTP_LOCKOUT_SECONDS = 60`).
- Setup flow bound by a short-lived setup token (90-second TTL).
- PBKDF2 600k iterations for new hashes; backward-compatible with legacy 100k format.
- TOTP verification accepts current 30-second window and the immediately preceding one (offsets 0 and −1).
- JSON body size caps: 1,000 items per batch POST (`MAX_BATCH_SIZE`), 10,000 IDs per bulk-delete (`MAX_BULK_IDS`).
- Optimistic concurrency versioning across all per-instance data and workspace metadata.

---

## What Still Requires Hands-On Porting

### Third-party libraries (each needs a direct swap)

All of the following were verified present in `frontend/package.json` and confirmed imported in source.

| Current (web) | RN equivalent | Consumer files |
|---|---|---|
| `recharts` ^2.12.7 | `victory-native` or `react-native-svg-charts` | `frontend/src/components/charts/CategoryLineChart.tsx`, `frontend/src/components/dashboard/ExpandedMonthView.tsx`, `frontend/src/components/dashboard/MonthTotalsBar.tsx`, `frontend/src/components/dashboard/NetBalanceView.tsx` |
| `react-datepicker` ^9.1.0 | `@react-native-community/datetimepicker` | `frontend/src/components/DateRangePicker.tsx` |
| `qrcode.react` ^4.1.0 | `react-native-qrcode-svg` | `frontend/src/pages/Login.tsx` (TOTP setup QR code via `QRCodeSVG`) |
| `qrcode` ^1.5.4 | `react-native-qrcode-svg` or canvas-based | `frontend/src/components/InviteTokensCard.tsx` (workspace invite QR via `QRCode.toDataURL`) |
| `pdfjs-dist` ^4.4.168 | Move parsing server-side OR use `react-native-pdf` | `frontend/src/utils/pdfParser.ts` (browser-side paystub extraction), `frontend/src/main.tsx` (worker config), `frontend/src/pages/DataEntry.tsx` (consumer) |
| `@dnd-kit/core` ^6.3.1 + `@dnd-kit/sortable` ^10.0.0 + `@dnd-kit/utilities` ^3.2.2 | `react-native-draggable-flatlist` | `frontend/src/pages/Dashboard.tsx` (card reorder), `frontend/src/pages/Settings.tsx` (card visibility list reorder), `frontend/src/components/dashboard/DashboardCard.tsx` (drag handle) |
| `react-router-dom` ^6.26.0 | `@react-navigation/native` | `frontend/src/App.tsx` (HashRouter, Routes, Route, Navigate), `frontend/src/pages/Login.tsx`, `frontend/src/pages/WorkspaceInvitePage.tsx`, `frontend/src/components/layout/Layout.tsx` |
| `papaparse` ^5.4.1 | `papaparse` (works in RN) | `frontend/src/utils/csvParser.ts`, `frontend/src/pages/DataEntry.tsx` |
| `date-fns` ^3.6.0 | `date-fns` (works in RN) | multiple files |

Note: `papaparse` and `date-fns` are pure JS and should work in RN without changes.

### DOM-only JSX primitives

The entire JSX tree uses HTML elements. RN has `<View>`, `<Text>`, `<ScrollView>`, `<FlatList>`, `<TextInput>`, `<Pressable>`. This is a line-by-line JSX rewrite — there is no shortcut.

High-traffic patterns requiring attention:

- **`<table>`/`<thead>`/`<tbody>`/`<tr>`/`<td>`** — used in: `Dashboard.tsx`, `DataEntry.tsx`, `Settings.tsx`, `TransactionDrillDown.tsx`, `ExpenseCategoryTable.tsx`, `MonthlyBalanceView.tsx`, `ArchivedCard.tsx`. Replace with custom RN table component built from `FlatList` rows, or a library like `react-native-table-component`.
- **`<input type="file">`** — used in `DataEntry.tsx` for CSV and PDF upload. Replace with `react-native-document-picker`.
- **`<input type="text/number/date">`** — replace with `<TextInput>`.
- **`<select>`** — replace with `<Picker>` (`@react-native-picker/picker`).
- **Inline SVG icons** — replace with `react-native-svg`.
- **`<a href>` navigation** — replace with navigation actions from `@react-navigation/native`.

### CSS does not exist in RN

Every `.css` file and `className=` attribute must become `StyleSheet.create({})` objects. Migration plan:

1. Extract all design tokens from `frontend/src/index.css` `:root` into `theme.ts` (see Design Tokens section above).
2. For each component, create a co-located `<Component>.styles.ts` file using `StyleSheet.create({})` and the `theme` object.
3. Replace every `className=` prop with `style=`.
4. Replace CSS layout (flexbox via class names) with `StyleSheet` flex properties — RN's flexbox defaults differ: `flexDirection` defaults to `'column'` (same as web), but there is no block flow, no `display: grid`, and no `clamp()`.

### Hash routing

`frontend/src/App.tsx` uses `HashRouter` from `react-router-dom`. Replace the entire router with `@react-navigation/native` stack/tab navigators. The route structure is:

- `/login` → Login screen (unauthenticated)
- `/workspace-invite` → WorkspaceInvitePage (unauthenticated)
- `/dashboard` → Dashboard (protected)
- `/settings` → Settings (protected)
- Wildcard redirects based on `isAuthenticated()`

Note: `window.location.hash = '#/login'` is used in `api/client.ts` (on 401) and in `Login.tsx` / `WorkspaceInvitePage.tsx` for imperative navigation. Replace with a navigation ref (`NavigationContainerRef`) and `navigation.reset(...)`.

### Forms

`<input onChange={(e) => setX(e.target.value)}>` → `<TextInput onChangeText={setX}>`. The `e.target.value` vs direct string difference is mechanical but pervasive across all form-heavy pages (`DataEntry.tsx`, `Settings.tsx`, `Login.tsx`).

---

## Offline Support (NOT YET IMPLEMENTED)

The cleanup pass laid the foundation but did not implement offline mode.

### What exists today (still online-only)

- Every fetch goes directly to the network; there is no cache layer in `api/client.ts`.
- Mutations block on network response before updating local state.
- `resourceVersions` versioning is in place but is used only for multi-tab conflict resolution, not offline queuing.

### What needs to be built

1. **Local cache** — wrap every read function in `api/client.ts` with cache-first / network-fallback. On web, IndexedDB is appropriate; on RN, AsyncStorage with size caps (or SQLite via `react-native-sqlite-storage` for larger datasets).

2. **Mutation queue** — instead of awaiting the network response directly, append each mutation (with its `expectedVersion`) to a persisted queue and apply optimistically to local cache. Drain the queue on reconnect.

3. **Conflict resolution** — on HTTP 409 for a queued mutation, the queued write is rejected. Show the user a UI to resolve: replay manually, discard, or merge. The existing `ConflictError` machinery (`instanceof ConflictError`, `error.currentVersion`) is the natural entry point.

4. **Sync indicator** — UI affordance showing pending-sync count, last-sync timestamp, and offline/online state. Place this in the `Layout` component (currently `frontend/src/components/layout/Layout.tsx`).

5. **Background sync** (RN-only) — use `BackgroundFetch` / `BackgroundTasks` to drain the mutation queue when the app is backgrounded and the device regains connectivity.

---

## Migration Approach Suggestion

Order by safety — each step is independently testable before the next begins.

1. **RN scaffold + navigation.** Login screen only. Verify that `api/client.ts` (which is mostly portable — only `window.location.hash` and `StorageEvent` need removal) connects to the existing Cloudflare Worker backend.

2. **Port Dashboard.** Charts via `victory-native`, data tables via `FlatList`. The optimistic-concurrency code in `api/client.ts` works as-is once the `window.location.hash` redirect is replaced with a navigation ref.

3. **Port DataEntry.** CSV upload via `react-native-document-picker` + `papaparse` (portable). Manual income forms via `TextInput`. PDF paystub parsing: either move `pdfParser.ts` logic to a new Worker endpoint, or accept `react-native-pdf` as a dependency for on-device rendering only (extraction still needs the Worker).

4. **Port Settings.** Category management, dashboard card visibility list. Replace `@dnd-kit` with `react-native-draggable-flatlist`.

5. **Implement offline.** Read-side cache first (optimistic local reads), then mutation queue with conflict resolution UI.

6. **Final QA** across multiple device sizes, online and offline, covering the breakage watch list below.

---

## Breakage Watch List

Specifically test these flows in the RN port before shipping:

1. **Login + TOTP setup** — QR code rendering (`QRCodeSVG` from `qrcode.react` in `Login.tsx`; `QRCode.toDataURL` from `qrcode` in `InviteTokensCard.tsx`). Both need `react-native-qrcode-svg` or equivalent.

2. **CSV upload** — `DataEntry.tsx` uses `<input type="file">` to feed `papaparse`. Replace with `react-native-document-picker`; `papaparse` itself is portable.

3. **PDF paystub parsing** — `pdfParser.ts` imports `pdfjs-dist` and uses `File.arrayBuffer()`. This is browser-only. Either move extraction to the Worker (recommended) or use `react-native-pdf` + manual text extraction on device.

4. **Dashboard card drag-reorder** — `@dnd-kit` uses pointer/mouse events and HTML5 drag API. RN drag-and-drop requires `react-native-draggable-flatlist` or `react-native-gesture-handler` with a custom implementation. The drag-sensor constants (`TOUCH_SENSOR_DELAY_MS = 200`, `TOUCH_SENSOR_TOLERANCE_PX = 5`) in `constants.ts` are already extracted and can be reused.

5. **Date-range picker** — `DateRangePicker.tsx` uses `react-datepicker`. Replace with `@react-native-community/datetimepicker`; the picker UX differs significantly between platforms.

6. **Chart rendering** — all four chart components (`CategoryLineChart.tsx`, `ExpandedMonthView.tsx`, `MonthTotalsBar.tsx`, `NetBalanceView.tsx`) use `recharts`, which renders to SVG via DOM. Replace with `victory-native` (uses `react-native-svg`) or `react-native-svg-charts`.

---

## Environment Setup

The only frontend environment variable is:

- `VITE_API_URL` — the base URL of the Cloudflare Worker (e.g. `https://lotus.example.workers.dev`). Defaults to `http://localhost:8787` when unset (see `api/client.ts` line 5). In RN: supply via `react-native-config` (`.env` files per environment) or build-time constants. The variable name can stay the same if `react-native-config` is configured to read `.env`.
