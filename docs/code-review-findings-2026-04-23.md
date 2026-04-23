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
(Populated in Phase 1.)

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
