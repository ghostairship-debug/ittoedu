# S1 Task Card — ARCH-1 VS-06A Web Package CSP Style Runtime

## State and assignment

- Task ID: `arch-1-vs-06a-web-package-csp-style-runtime`
- Phase / wave: `ARCH-1 / desktop validation finding`
- Status: `done`
- Owner / Reviewer / Integrator: `Export / Player Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 04:00 Asia/Shanghai / done 2026-08-24 04:05 Asia/Shanghai`
- Worktree / branch: `shared validation workspace, export-only lock / codex/architecture-stabilization`
- Baseline HEAD: `83054bb`
- Claim commit: `494b38cd9e38ad90e1d44217af249482c1aba402`
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

- [x] Web package style-src permits self CSS plus dynamic inline style attributes
- [x] Web package script-src remains `self + unsafe-eval` without `unsafe-inline`
- [x] default-src stays none and connect-src stays self
- [x] standalone HTML CSP is unchanged
- [x] unit package tests and real VS-06 file:// load report no CSP console errors

## Minimal validation

- `npx vitest run tests/unit/coursePackageExport.test.ts`
- `npm run typecheck && npm run build:desktop`
- VS-06 dedicated normal delivery test
- diff hygiene

## Rollback

- Start point: `83054bb`
- Implementation commit: `c6cb941de03a929fdeb7a9f7d1f4f89ece105138`
- Old path remains: Web payload/files are generated, but Chromium blocks Player-authored inline layout styles and logs CSP errors.

## Result evidence

- Web-package `style-src` now permits only packaged self stylesheets plus inline style attributes required by the current Player's per-layer geometry; no script, image, media, font, connection or worker source was broadened.
- `script-src` remains exactly `self + unsafe-eval` and explicitly excludes `unsafe-inline`; `default-src 'none'` and `connect-src 'self'` remain. Standalone HTML keeps its existing offline inline CSP unchanged.
- `coursePackageExport` passed `1 file / 3 tests`; all three TypeScript projects and `build:desktop` passed.
- Before the fix, real Web `file://` playback emitted four Chromium CSP errors. After the fix, the VS-06 normal delivery test passed standalone and Web file loads with visible replacement image, zero page/console errors and zero HTTP(S) requests.
