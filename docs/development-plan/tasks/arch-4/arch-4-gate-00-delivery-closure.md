# S2 Task Card — ARCH-4 Delivery and Legacy Consumer Phase Gate

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: phase-gate
- Necessity / skip condition: ARCH-4 changed legal V9 preflight identity and non-Slide PDF artifact/readiness routing; if both implementation cards are reviewed and their evidence remains fresh, run only the one actual Mixed Electron PDF needed to decide output completeness, then close with exact deltas and generated freshness.
- Complexity delta: subtractive
- Validation ceiling: V3
- Validation budget: 40 minutes
- Reviewer budget: 1
- Evidence reuse: reuse both implementation cards' focused tests, TypeScript checks and independent reviews at `24212d7` and `a887469`. Docs/task-board/repo-index/output-only changes do not invalidate them. Any ARCH-4 product/test/config invalidating path, renderer/main build input or actual-PDF harness input change invalidates the affected evidence.
- Invalidating paths: `src/renderer/App.tsx`; `src/renderer/export/exportPreflight.ts`; `src/renderer/export/course/buildCoursePackages.ts`; `src/renderer/export/course/buildCoursePrintArtifacts.ts`; `src/renderer/export/course/flowPrintPlan.ts`; `src/renderer/export/buildPptx.ts`; `src/renderer/export/renderSceneImages.ts`; `src/main/pdfExport.ts`; `tests/integration/courseExportPreflightApp.test.tsx`; `tests/integration/coursePdfExportApp.test.tsx`; `tests/unit/coursePackageExport.test.ts`; `tests/unit/coursePrintArtifacts.test.ts`; `tests/fixtures/course-project-v9/mixed.h5lesson`; renderer/electron/Vitest/Playwright build and resolution config
- Task ID: `arch-4-gate-00-delivery-closure`
- Phase / wave: `ARCH-4 / phase gate`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent ARCH-4 delivery gate reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T19:46:09+08:00 / 2026-08-24T20:07:40+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `e1d13c3`
- Context: admission and both serial implementation cards are done; page-fit evidence replaced the affected PDF builder evidence, and later `App.tsx` changes were limited to PDF routing.
- Freshness / relevant dirty inputs: implementation evidence remains bound to reviewed product commits; combined-head static review confirms the later PDF-only App branch did not change the HTML/Web preflight mapping
- Depends on: `arch-4-00-delivery-admission`, `arch-4-01-v9-html-web-preflight`, and `arch-4-02-non-slide-v9-pdf-completeness` done
- Blocks: ARCH-5 deletion admission
- Risk statement: structure-level tests cannot prove Chromium pagination, scale, clipping or blank pages; the gate must inspect the real PDF once without escalating into full E2E/build or duplicating final V4.
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-4 closes only if legal V9 HTML/Web preflight is V9-native and one actual desktop-exported Mixed PDF visibly includes Slide, Flow and Spatial in planned order without nested-document artifacts, blank output, obvious clipping or runtime-only TOC chrome.

## Evidence to reuse

- V9 HTML/Web preflight: `2 files / 5 tests`, root TypeScript and independent APPROVE at `24212d7`.
- Non-Slide PDF completeness: `2 files / 6 tests`, root and Electron TypeScript plus independent APPROVE at `a887469`.
- No invalidating product/test/config path changed after either reviewed commit.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_4_PHASE_GATE_REPORT.md`
- this card and generated `docs/development-plan/TASK_BOARD.md`
- final `repo-index/generated/**` refresh
- ignored gate-only artifacts under `output/pdf/` and intermediates under `tmp/pdfs/`
- one temporary targeted Playwright spec, removed immediately after the gate run and never committed

### Required read

- all ARCH-4 reports/cards and combined product diff
- existing Mixed V9 fixture, Electron launch/dialog interception and PDF main-process writer
- actual PDF metadata/text plus every rendered PNG page

### Forbidden write

- product source/tests, persistent E2E suite, Schema/contracts/Published producer, dependencies, fixtures, semantic/golden/capability facts or final-V4 evidence

## Validation

1. Reuse implementation-card focused/TypeScript evidence; do not rerun it unless invalidated.
2. Build only the current renderer and Electron outputs needed by one targeted desktop flow; reuse the unchanged Player bundle.
3. Run exactly one gate-only Playwright test: open `tests/fixtures/course-project-v9/mixed.h5lesson`, use the real App PDF preflight and `desktopApi.exportPdf`, save `output/pdf/arch-4-mixed-surface.pdf`, and assert a nonempty `%PDF-` result with no page/console/external-request error.
4. Parse page count/text/order; render every PDF page with the bundled Poppler runtime into `tmp/pdfs/`; visually inspect every PNG for the three Surface contents, order, clipping, blank pages and runtime TOC omission.
5. Record exact ARCH-4 consumer/output deltas, run one task-board and repo-index generate/check refresh, and `git diff --check`.
6. No full unit, full E2E, `build:desktop`, performance, representative-course matrix or final V4 command.

## Failure rule

- A structurally valid PDF that omits/reorders a Surface, visibly clips required content, contains blank artifact pages or includes runtime TOC fails the gate and reopens only `arch-4-02`.
- Harness failure before PDF creation may be repaired without counting another output. Once a candidate PDF is created, do not regenerate merely for more evidence; inspect that artifact completely first.

## Rollback

- Start point: `e1d13c3` plus this claim commit.
- Gate report/card/generated refresh and ignored evidence are independently removable; no product or persisted-data migration occurs.

## Result evidence

- Phase report drafted at `docs/development-plan/baselines/ARCH_4_PHASE_GATE_REPORT.md`, bound to product candidate `c49330c`.
- Reused reviewed focused evidence: HTML/Web `2 files / 5 tests`; PDF completeness `2 / 6`; page-fit replacement evidence `2 / 6`; applicable root/Electron TypeScript checks all passed.
- Exactly one actual targeted Electron export passed `1 test / 1 passed` through real archive open, App preflight, IPC, hidden print window and save writer. Result: `output/pdf/arch-4-mixed-surface.pdf`, 27,799 bytes, SHA-256 `DAF12E21D503D224913533C23C87DF62D110A2FE6709F162E00FE6AEA9DB8653`.
- PDF metadata/text: 3 pages at 960×540 pt; Slide → Flow → Spatial markers in order; no runtime TOC. Bundled Poppler rendered all pages at 144 DPI; all three 1920×1080 PNGs were nonblank and their non-white bounds stayed inside the page.
- Visual qualification: Flow/Spatial are complete and unclipped. Slide's two exported text layers overlap because the committed gate fixture assigns both the identical `(40,40,520,80)` frame; this input fact does not hide an omitted page or edge clipping and prevents no completeness conclusion, but no art/accepted status is claimed.
- Temporary gate spec was deleted immediately after the single run. Target renderer/Electron builds passed; full E2E/build/V4 was not run.
- Exact retained-symbol delta and ARCH-5 deletion candidates are recorded in the report. Independent ARCH-4 gate review: APPROVE, no blocker; it independently confirmed the actual artifact metadata/hash/page bounds, fixture-owned overlap, evidence reuse and `engineering candidate` qualification. Final task-board/repo-index freshness is performed by the closure commit.

## Ready checklist（Coordinator）

- [x] both implementation cards terminal and independently approved
- [x] focused evidence freshness checked
- [x] one actual output path and no-repeat boundary explicit
- [x] final V4 remains reserved for ARCH-5
