# S2 Task Card — Non-Slide V9 PDF Completeness

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: legal V9 Flow-only and Mixed PDF exports currently fall back to V8 raster or select Spatial-only image HTML that omits other surfaces; if claim-time artifact selection already covers every mixedPrintPlan page and non-pure-Slide App routing cannot fall back, skip with an actual current output.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 25 minutes
- Reviewer budget: 1
- Evidence reuse: bind print artifact unit, App PDF integration and root TypeScript to the product commit; docs/task-board/generated-only changes do not invalidate. App PDF routing, artifact/Flow fragment/main readiness, focused tests or TypeScript/Electron config changes invalidate.
- Invalidating paths: `src/renderer/App.tsx`; `src/renderer/export/course/buildCoursePrintArtifacts.ts`; `src/renderer/export/course/flowPrintPlan.ts`; `src/main/pdfExport.ts`; `tests/unit/coursePrintArtifacts.test.ts`; `tests/integration/coursePdfExportApp.test.tsx`; `src/renderer/export/renderSceneImages.ts`; `src/renderer/export/buildPptx.ts`; `tsconfig.json`; `tsconfig.electron.json`; Vitest/TypeScript resolution config
- Task ID: `arch-4-02-non-slide-v9-pdf-completeness`
- Phase / wave: `ARCH-4 / Published PDF completeness`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent PDF delivery reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T19:31:05+08:00 / 2026-08-24T19:45:05+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `36b53e1`
- Context: `ARCH_4_ADMISSION_REPORT.md`; must claim only after arch-4-01 closes because App is the shared exclusive hotspot.
- Freshness / relevant dirty inputs: clean root; current PDF matrix, nested Flow document, main readiness and pure-Slide parity gap re-read at claim; App has no concurrent writer
- Depends on: `arch-4-01-v9-html-web-preflight` done
- Blocks: ARCH-4 phase gate and its one actual Mixed PDF review
- Risk statement: a nominal pdf-html file is not success unless it is a valid document, passes Electron readiness and covers the complete ordered page plan without weakening pure-Slide fidelity.
- Retry count / last failure class: `0 / none`

## Product outcome

A teacher exporting a legal V9 course containing Flow or multiple Surface kinds receives one PDF input that includes every planned Slide, Flow and Spatial page in order, or an explicit completeness error; the App never silently falls back to a Slide-only V8 snapshot that can omit content.

## Current path and exact target

Published print artifacts currently create image PDF HTML only for captured Slide pages and Spatial frames. App supplies no Slide capture. Flow-only and Mixed-without-Spatial fall back; Mixed-with-Spatial selects the partial Spatial image file. The available mixed HTML nests a whole Flow document and lacks `.page`, while main readiness assumes one image per page.

## Scope and locks

### Allowed write

- `src/renderer/App.tsx`, only PDF artifact selection/fallback behavior
- `src/renderer/export/course/buildCoursePrintArtifacts.ts`
- `src/renderer/export/course/flowPrintPlan.ts`, only a reusable body fragment while standalone output remains exact
- `src/main/pdfExport.ts`, only printable readiness condition/state
- `tests/unit/coursePrintArtifacts.test.ts`
- new `tests/integration/coursePdfExportApp.test.tsx`

### Required read

- current image PDF builder, V8 renderer fallback and desktop export API
- pure-Slide Published versus Legacy fidelity gap
- mixedPrintPlan ordering, Flow runtime TOC omission and Spatial SVG rules

### Forbidden write

- Project/Published schemas, types or contracts; Published producer; Store/Workspace/Properties/Player; IPC/preload/file dialog shape; `renderSceneImages.ts`; PPTX builders; DOCX; HTML/Web preflight; source-null Legacy branch; dependencies/generated files

## Required implementation shape

1. Reuse a Flow body fragment in standalone and mixed HTML; never nest a second doctype/html/body.
2. Mark each logical Slide/Flow/Spatial print section with `.page` in mixedPrintPlan order.
3. Keep image-based PDF HTML when its captures cover every planned page; this preserves Spatial-only.
4. When coverage is incomplete and the course is not pure Slide, emit the complete mixed semantic HTML as `pdf-html`.
5. Keep pure Slide without Published captures on the current V8 raster path.
6. For a non-pure-Slide V9 course with no complete `pdf-html`, throw the exact actionable completeness error and perform zero V8 render/export calls.
7. Main readiness requires at least one `.page` and all actual images decoded; it must not require one image per page.

## Exact failure semantics

- Title: `PDF 导出不完整`
- Message: `未生成覆盖当前课程全部表面的 PDF 打印内容。`
- Suggestion: `请检查混合打印计划后重试；为避免遗漏 Flow 或 Spatial 内容，本次未回退到旧版 Slide 快照。`

Main-process printing/decode errors remain visible through existing error handling and never trigger a Legacy retry.

## Must preserve

- page ordering from `mixedPrintPlan`
- Spatial-only per-frame SVG image path and non-1280×720 viewport
- pure-Slide high-fidelity raster fallback
- Flow static content and runtime TOC omission
- global/controller static-export omission and existing report/warnings
- source-null defensive fallback, PPTX and DOCX behavior

## Validation

- `npx vitest run tests/unit/coursePrintArtifacts.test.ts tests/integration/coursePdfExportApp.test.tsx`
- `npx tsc --noEmit`
- `npx tsc -p tsconfig.electron.json --noEmit`
- exact artifact coverage/fallback/failure assertions and `git diff --check`
- one actual Mixed Electron PDF is deferred to and run exactly once at the ARCH-4 phase gate; no other E2E, build, full suite or generated refresh under V2

## Rollback

- Start point: claim commit plus recorded baseline after arch-4-01.
- One product/test commit; revert restores prior artifact selection and readiness without persisted-data migration.

## Result evidence

- Product/test commit: `a887469`. Mixed/Flow semantic PDF HTML now follows the complete ordered page list with one valid document and a reusable Flow body fragment; complete ordered image coverage still wins, preserving Spatial-only, while pure Slide without Published capture keeps its existing raster path.
- App failure boundary: legal non-pure-Slide V9 with no `pdf-html` throws the exact three-part `PDF 导出不完整` error before any V8 raster or desktop export call. Source-null, PPTX, DOCX and HTML/Web paths were not changed.
- Electron readiness: at least one `.page` is still mandatory and every actual `document.images` entry must decode; only the invalid one-image-per-logical-page assumption was removed.
- Focused validation bound to `a887469`: `npx vitest run tests/unit/coursePrintArtifacts.test.ts tests/integration/coursePdfExportApp.test.tsx` passed `2 files / 6 tests`; `npx tsc --noEmit` and `npx tsc -p tsconfig.electron.json --noEmit` both passed; allowed-path audit and `git diff --check` passed.
- Independent PDF delivery review: APPROVE with no blocking finding. It verified coverage/order, no nested Flow document, image selection, pure-Slide fallback, exact fail-closed semantics, readiness and forbidden-boundary preservation while reusing the existing evidence. The only residual is actual Chromium pagination/scaling/clipping, intentionally deferred to the single ARCH-4 Mixed PDF gate.
- Generated refresh: task board only at card closure; repo-index remains deferred to the ARCH-4 phase gate.

## Ready checklist（Coordinator）

- [x] current format matrix and omission paths reproduced
- [x] renderer artifact and main readiness addressed together
- [x] pure-Slide/Spatial-only retained behavior explicit
- [x] one real output review deferred exactly once to gate
