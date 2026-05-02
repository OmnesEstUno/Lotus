# Lotus Session Handoff — Mobile Friendly Pass (2026-05-01)

You're picking up mid-stream from a long pairing session focused on making the Lotus web app usable on phones. The previous agent's context was getting large, so the user asked for a clean handoff.

---

## Read these first (in order)

1. This document.
2. **`docs/mobile-readiness.md`** — written after the big code-review-cleanup pass. Inventories what's RN-portable, what isn't, design tokens, abstraction layers. The eventual destination is a React Native port; everything in the current web app is "throwaway-ish."
3. **`docs/code-review-findings-2026-04-23.md`** — full report from the cleanup pass that ended at `main` SHA `023a6a4` (now ancient). Useful for understanding the codebase's architectural posture: optimistic concurrency, storage/dialog/download abstractions, folder reorg, worker hardening.
4. `git log --oneline main..feat/mobile-charts` — the in-flight branch.

---

## Where things stand

**Active branch:** `feat/mobile-charts` (off `main`).

**Commits, oldest first:**

| SHA | What |
|---|---|
| `c1bc567` | Chart-legibility pass: taller heights at <640px, x-tick density trimmed, y-axis label hidden, NetBalance horizontal-scrolls when >12 bars (all-time mode), Spending Trends legend chips become a horizontal scroller on mobile. New `useIsNarrow` hook. |
| `1ad40e2` | FAB sizes halved on mobile (96px → 48px), text labels hidden, anchor moved 24px → 16px |
| `7621c70` | `TimeRangeSelector` swapped from button row to compact `<select>` dropdown |
| `4bca149` | New `--card-padding-x: 0.25rem` token; `.card` now uses `padding: var(--space-6) var(--card-padding-x)` |
| `223cc97` | DashboardCard minimize button promoted to sibling of `.dashboard-card-actions`; pinned right and never wraps regardless of header content. Actions slot wraps internally. |
| `1e8801c` | `.stat-value` font is `clamp(1.125rem, 4vw, 1.5rem)` + `overflow: hidden` + `word-break: break-word` so currency values can't burst out of stat cards |
| `384ce40` | DashboardCard title wraps inside the space between drag-handle and selector; selector hugs its content |
| `3feb9e9` | (Reverted) JS-measured TimeRangeSelector width tracking the current option |
| `11bffb0` | Revert of above; plain `<select>` with inline `paddingLeft: 15px` |

**Open follow-up at handoff:**

- **`YearSelector` still has `minWidth: 120` inline** at `frontend/src/components/dashboard/YearSelector.tsx:41`. The user noticed it via DevTools when inspecting what they thought was the `TimeRangeSelector`. They asked whether to remove it — I asked back for confirmation but the session ended before they answered. **Probable action:** drop the `minWidth: 120` from that `style` prop.

---

## Strategic context (don't re-litigate these)

- **RN port is the eventual destination.** The user is shoring up the web mobile experience because (a) it's broken at <640px today, and (b) the design decisions made during a responsive pass transfer to RN. Polish work that *only* benefits the web (CSS tuning, hover states, browser-specific fixes) is explicitly de-prioritized.
- **Lightweight pass, not a polish pass.** When the user committed to mobile work, they chose option A from this menu:
  - **A. Targeted gap-fill (~1 week)** — workspace switcher, DataEntry layout, Expenses-by-Category, drill-down column collapse. Functional, not polished. ✅ chose this.
  - B. Full polish (~3 weeks). Rejected.
  - C. Just the navigation decision (~2 days). Rejected as too narrow.
- **Storage stays Cloudflare KV; offline is deferred.** The user explored Plaid bank sync, RN architecture, and offline-first SQLite during musing breaks. None of those are scoped for this work — they're future considerations.

---

## Architecture quick reference

- **Frontend**: React 18 + TypeScript strict + Vite. `frontend/src/` with feature-organized folders:
  - `api/` — per-resource modules (`auth`, `transactions`, `income`, `categories`, `instances`, `invites`, `featureRequests`, `core`)
  - `utils/dataProcessing/` — one file per `build*` chart-data function, plus `shared.ts`
  - `utils/categorization/{rules,colors}.ts`
  - `utils/csv/{shared,parseTransactions,parseIncome}.ts`
  - `utils/{storage,dialog,download,constants}.ts` — abstraction layers ready for RN swap
  - `hooks/` — `useWorkspaces`, `useDashboardLayout`, `useUserCategories`, `useIsNarrow`, etc.
  - `components/` — page-and-feature-organized
- **Backend**: Cloudflare Workers + KV. `worker/src/` reorganized into `auth/`, `invites/`, `storage/` subfolders. `index.ts` is intentionally one big router. Production-hardened: PBKDF2 600k, login + TOTP rate limits, security headers, optimistic-concurrency `expectedVersion` on every mutation, batch-size caps (`MAX_BATCH_SIZE: 1000`, `MAX_BULK_IDS: 10000`).
- **Design tokens**: `:root` in `frontend/src/index.css` defines `--bg-*`, `--text-*`, `--accent-*`, `--space-0..12`, `--font-size-*`, `--font-weight-*`, `--z-*`, `--touch-target-{min,compact}`, `--radius-*`, `--card-padding-x`. All RN-portable as a `theme.ts` object.
- **Mobile breakpoint**: `640px`. Mobile-first; `@media (min-width: 640px)` reveals desktop features (sidebar, etc.). The `useIsNarrow` hook is the JS-side companion.

---

## User collaboration preferences (observed)

- **Small, focused commits with descriptive messages.** One concept per commit. Prefer multiple small commits over one big one.
- **Tests in the browser before merging.** The user smoke-tests on real phones + desktop and merges to `main` themselves. Don't run `git merge` or `git push` without explicit ask.
- **Honest tradeoff surfacing.** Recommend, then list alternatives. Don't pretend choices are obvious when they aren't.
- **Concrete plans before implementation** for non-trivial work. Use the `superpowers:writing-plans` skill for multi-step features. The `superpowers:subagent-driven-development` flow has been used heavily and works well for this codebase.
- **Subagents for delegation.** The pairing model has been: I (controller) provide context + scoped prompts to subagents (implementers). Each prompt includes file paths, exact code where useful, and guardrails. Verification: `npx tsc --noEmit && npm run build` from `frontend/` after each commit.
- **The user is comfortable steering.** They'll push back, redirect, or correct in-flight. Listen carefully and reverse course quickly when they do.
- **Previous session context lives in memory.** See `~/.claude/projects/-var-home-Grey-Projects-Lotus/memory/MEMORY.md`.

---

## Conventions to respect

- **No new dependencies without strong justification** — RN port means anything you add now you'll likely throw away.
- **Use existing tokens**, not raw values. New tokens are fine when they encode a pattern (e.g. `--card-padding-x`).
- **Prefer CSS-only fixes** over JS-driven ones. The TimeRangeSelector arc — added JS measurement, then reverted — is a cautionary tale.
- **Don't break the desktop experience.** Mobile fixes use `@media (max-width: 639px)` or `useIsNarrow()` and leave `>=640px` untouched.
- **Optimistic concurrency stays.** Every write goes through `expectedVersion`; reads stash via `rememberVersion()` / `lastKnownVersion()`. Don't bypass.
- **Don't add `subscribeInstancesChanged` or other shared-state pub/sub patterns lightly.** If a hook's state isn't propagating across consumers, prefer the existing pattern in `frontend/src/api/core.ts` (mirrors `subscribeActiveInstance` and `subscribeUsername`).

---

## How to verify before committing

```
cd frontend
npx tsc --noEmit       # must be clean
npm run build           # must be clean (chunk-size warning is pre-existing)
```

The user smoke-tests in browser at 320px / 375px / desktop. If your fix should work at 320px, mention that explicitly so they know to test there.

---

## Likely next steps after this branch merges

In rough priority (the user has been working through these):

1. **Resolve the lingering `YearSelector` `minWidth: 120`** (probably a one-line drop).
2. **Audit Expenses-by-Category month grid on mobile.** Sticky columns + horizontal scroll inside the table-wrapper exists, but the readout below 400px is still tight.
3. **DataEntry modal mobile audit.** 1000-line file, lots of forms, no responsive pass yet beyond what Phase 9 did. Likely the largest source of remaining mobile friction.
4. **TransactionDrillDown column collapse on phones.** Multi-column table with checkbox + date + description + notes + category + amount + ellipsis menu — wide. Either (a) horizontal scroll (already present in `.preview-scroll`), (b) collapse columns to a stacked card layout below 480px.
5. **Login / TOTP setup mobile polish.** QR code + clipboard + OTP flow on small screens.

The user has not yet committed to all of these — confirm scope before each one.

---

## Files most recently touched

- `frontend/src/index.css` — biggest CSS file, recently grew with mobile rules. Lots of `@media (max-width: 639px)` blocks.
- `frontend/src/hooks/useIsNarrow.ts` — new
- `frontend/src/components/dashboard/TimeRangeSelector.tsx` — recently reverted to a simple state
- `frontend/src/components/dashboard/DashboardCard.tsx` — minimize button restructured
- `frontend/src/components/dashboard/CategoryChipRow.tsx` — chip row class refactor
- `frontend/src/components/dashboard/NetBalanceView.tsx` — horizontal-scroll wrapper
- `frontend/src/components/dashboard/ExpandedMonthView.tsx` — daily chart trim
- `frontend/src/components/charts/CategoryLineChart.tsx` — height/margin/tick density on mobile
- `frontend/src/components/layout/Layout.tsx` — opposite-page nav, username layout
- `frontend/src/components/layout/WorkspacePickerFAB.tsx` — bottom-left mobile FAB

---

## One concrete first move

If unsure where to start, do this:

```bash
git checkout feat/mobile-charts
cd frontend
npx tsc --noEmit && npm run build
```

Then open the app at 375px-wide viewport and walk every page. Report what's still broken to the user; let them prioritize.
