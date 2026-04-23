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

### Duplication
(Populated in Phases 2–3.)

### Security
(Populated in Phase 5.)

### Concurrency / Data Integrity
(Populated in Phase 6.)

### Hard-coded Values
(Populated in Phase 4.)

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
