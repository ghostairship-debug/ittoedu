# S1 Task Card — ARCH-1 VS-06A Web Package CSP Style Runtime

## State and assignment

- Task ID: `arch-1-vs-06a-web-package-csp-style-runtime`
- Phase / wave: `ARCH-1 / desktop validation finding`
- Status: `implementing`
- Owner / Reviewer / Integrator: `Export / Player Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 04:00 Asia/Shanghai / pending`
- Worktree / branch: `shared validation workspace, export-only lock / codex/architecture-stabilization`
- Baseline HEAD: `83054bb`
- Claim commit: `pending`
- Context: `VS-06 real file:// Web package emits four CSP style-src violations from the current Player's dynamic element.style writes`
- Freshness / relevant dirty inputs: `VS-06 new E2E spec is disjoint; buildCoursePackages and coursePackageExport test locks held here`
- Depends on: `VS-06 finding after VS-05 target-green`
- Blocks: `VS-06 HTML/Web acceptance`
- Retry count: `0`

## Product outcome

An exported offline Web package renders the existing Published V2 Player's dynamic layout without CSP style violations, while scripts remain disallowed from inline execution and network access remains closed.

## Scope and locks

### Allowed write

- `src/renderer/export/course/buildCoursePackages.ts` Web-package CSP only
- `tests/unit/coursePackageExport.test.ts` CSP regression only
- This task card and generated task board

### Forbidden write

- Standalone HTML CSP, Player implementation/CSS, contracts/Schema, package/lockfile, App/Store, E2E spec, generated index

## Current fact

The Web package CSP is `style-src 'self'`, but Slide/Flow/Spatial Player hosts set per-item position, size, opacity and z-index through `element.style`. Chromium blocks those style attributes and reports CSP errors. Refactoring every host into an unbounded class/hash matrix is outside this fix.

## Acceptance

- [ ] Web package style-src permits self CSS plus dynamic inline style attributes
- [ ] Web package script-src remains `self + unsafe-eval` without `unsafe-inline`
- [ ] default-src stays none and connect-src stays self
- [ ] standalone HTML CSP is unchanged
- [ ] unit package tests and real VS-06 file:// load report no CSP console errors

## Minimal validation

- `npx vitest run tests/unit/coursePackageExport.test.ts`
- `npm run typecheck && npm run build:desktop`
- VS-06 dedicated normal delivery test
- diff hygiene

## Rollback

- Start point: `83054bb`
- Implementation commit: `pending`
- Old path remains: Web payload/files are generated, but Chromium blocks Player-authored inline layout styles and logs CSP errors.

## Result evidence

- Pending.
