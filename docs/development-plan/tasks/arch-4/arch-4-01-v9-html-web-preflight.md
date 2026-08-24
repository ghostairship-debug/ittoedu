# S2 Task Card — V9-native HTML/Web Preflight

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: legal V9 single-HTML/Web-package preflight currently starts from the V8 projection and persists schemaVersion 8; if claim-time App already routes both targets directly through the V9 Course Package preflight and reports schemaVersion 9, skip with exact control-flow evidence.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 20 minutes
- Reviewer budget: 1
- Evidence reuse: bind the new App integration, existing Course Package preflight unit and root TypeScript to the product commit; docs/task-board/generated-only changes do not invalidate. App preflight routing/mapping, report type, V9 collector, focused tests or TypeScript config changes invalidate.
- Invalidating paths: `src/renderer/App.tsx`; `src/renderer/export/exportPreflight.ts`; `src/renderer/export/course/buildCoursePackages.ts`; `tests/integration/courseExportPreflightApp.test.tsx`; `tests/unit/coursePackageExport.test.ts`; `tsconfig.json`; Vitest/TypeScript resolution config
- Task ID: `arch-4-01-v9-html-web-preflight`
- Phase / wave: `ARCH-4 / HTML-Web preflight`
- Status: `ready`
- Owner / Reviewer / Integrator: `Coordinator / independent HTML-Web preflight reviewer / Coordinator`
- Claimed at / released at: `pending / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `pending at claim`
- Context: `ARCH_4_ADMISSION_REPORT.md`; App is an exclusive hotspot and this card must complete before the PDF card claims it.
- Freshness / relevant dirty inputs: re-read legal V9/source-null routing and the saved-report mapping at claim
- Depends on: `arch-4-00-delivery-admission` done
- Blocks: `arch-4-02-non-slide-v9-pdf-completeness` and ARCH-4 phase gate
- Risk statement: removing the V8 base must not weaken the existing V9 package closure/resource/component/player-bundle blockers or change retained PDF/PPTX/source-null preflight paths.
- Retry count / last failure class: `0 / none`

## Product outcome

When a teacher checks a legal V9 single HTML or Web package export, the visible/savable preflight report describes that V9 project and its real package resources instead of first analyzing a V8-shaped projection.

## Current path and exact target

`handleExport` unconditionally calls `collectExportPreflight(state.project)` and then merges Course Package preflight into that base. The base fixes `schemaVersion: 8`, so even the saved V9 report is mislabeled.

## Scope and locks

### Allowed write

- `src/renderer/App.tsx`, only preflight mapping/routing
- `src/renderer/export/exportPreflight.ts`, only `schemaVersion: 8 | 9`
- new `tests/integration/courseExportPreflightApp.test.tsx`

### Required read

- `src/renderer/export/course/buildCoursePackages.ts`
- `tests/unit/coursePackageExport.test.ts`
- existing preflight dialog/save/continue behavior and source-null guards

### Forbidden write

- Published producer, Course Package collector/builders, Store, contracts/Schema, real HTML/Web builders, size warning, Preview, PDF/PPTX/DOCX, source-null fallback, other tests, dependencies and generated files

## Required implementation shape

1. Map an existing `CoursePackagePreflightReport` directly to `ExportPreflightReport` for legal V9 `single-html` and `web-package` targets.
2. Use the V9 project/report identity, schema, generated time, target, items and summary; do not create another preflight analyzer.
3. Do not compute `collectExportPreflight` before discarding it on those two routes.
4. Keep the old base/merge path for PDF/PPTX and the source-null defensive path.
5. Keep `reportVersion: 1`; widen only the report carrier schema type to `8 | 9`.

## Expected delta

- legal V9 HTML/Web routes to V8 collector `2 → 0`;
- per HTML/Web export V8 collector calls `1 → 0`, V9 collector calls remain `1`;
- savable report schema `8 → 9`;
- repository/App old collector remains for retained paths; no Legacy symbol deletion claim.

## Must preserve

- V9 missing asset bytes, component hash/package and empty Player bundle errors
- target-specific delivery, project ID, generated time, summary/canExport and save/continue UI
- HTML size warning and actual package builders
- PDF/PPTX and source-null behavior

## Validation

- `npx vitest run tests/integration/courseExportPreflightApp.test.tsx tests/unit/coursePackageExport.test.ts`
- `npx tsc --noEmit`
- exact route/call/schema assertions and `git diff --check`
- no Electron E2E, build, visual review, full suite or generated refresh under V2

## Rollback

- Start point: claim commit plus recorded baseline.
- One App/type/test commit; revert restores the old merged report without data migration.

## Result evidence

- Pending implementation, focused validation and independent review.

## Ready checklist（Coordinator）

- [x] user-visible saved schema error reproduced
- [x] existing V9 collector is the replacement
- [x] retained paths and heuristic non-parity explicit
- [x] App single-writer order locked
