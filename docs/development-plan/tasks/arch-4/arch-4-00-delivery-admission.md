# S1 Task Card — ARCH-4 Delivery and Legacy Consumer Admission

> 本卡独立准入用户可达的交付格式问题；不因“Legacy”名称或阶段标题迁移所有格式。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: ARCH-3 gate 已完成；ARCH-4 只有在当前合法 V9 UI 路径可复现 V8-shaped consumer、输出缺页或显式错误时才生成实现卡，没有真实风险/替代路径的格式 retained 或 skip。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 25 minutes
- Reviewer budget: 1
- Evidence reuse: admission binds current App/export/main-PDF source and focused test topology at product HEAD `36a92f8`; report/task/task-board-only changes do not invalidate. Any listed delivery source/test or export IPC/config change invalidates the affected decision.
- Invalidating paths: `src/renderer/App.tsx`; `src/renderer/export/exportPreflight.ts`; `src/renderer/export/course/buildCoursePackages.ts`; `src/renderer/export/course/buildCoursePrintArtifacts.ts`; `src/renderer/export/course/buildCoursePptx.ts`; `src/renderer/export/course/flowDocx.ts`; `src/renderer/export/buildPptx.ts`; `src/renderer/export/renderSceneImages.ts`; `src/main/pdfExport.ts`; `tests/unit/coursePackageExport.test.ts`; `tests/unit/coursePrintArtifacts.test.ts`; current App export integration/Electron journey tests; export IPC/preload/types/config
- Task ID: `arch-4-00-delivery-admission`
- Phase / wave: `ARCH-4 / necessity admission`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator + HTML/Web and PDF Admission Auditors / independent delivery admission reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T19:14:14+08:00 / 2026-08-24T19:23:22+08:00`
- Worktree / branch: `shared root, read-only product audit / codex/architecture-stabilization`
- Baseline HEAD: `36a92f8`
- Context: ARCH-3 is closed; previous ARCH-4 hypothesis is being revalidated against actual App orchestration, package artifacts and Electron PDF readiness rather than copied into tasks.
- Freshness / relevant dirty inputs: clean root; product sources and tests read-only; two disjoint format audits active
- Depends on: `arch-3-gate-00-surface-modularization` done
- Blocks: any ARCH-4 implementation card and ARCH-4 phase gate
- Retry count / last failure class: `0 / none`

## Product outcome

Only delivery paths with a reproducible current V9 correctness gap or removable Legacy consumer enter ARCH-4 work, with Electron print readiness and pure-Slide compatibility treated as real constraints rather than hidden assumptions.

## Questions to decide

1. Does legal V9 HTML/Web preflight still read the V8 projection, and can that consumer be removed without changing package production?
2. Which Flow/Spatial/Mixed PDF pages are absent from the current Published/static plan, and what does the real Electron readiness gate require?
3. Are sessionless App fallbacks reachable from legal UI or only defensive dead branches?
4. Which PPTX, DOCX, Project Health, fixture/release and legacy validators retain current responsibility?
5. What is the narrowest serial hotspot order, focused validation and one actual output review if output structure changes?

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_4_ADMISSION_REPORT.md`
- this card, newly admitted ARCH-4 task cards, and generated `docs/development-plan/TASK_BOARD.md`

### Required read

- legal App V9 HTML/Web/PDF orchestration and all source-null branches
- Published Course V2/static print/PPTX/DOCX artifacts and Electron PDF readiness
- focused unit/integration/Electron coverage and exact Legacy symbol counts

### Forbidden write

- all product source/tests, Schema/contracts/Published producer, fixtures/dependencies, existing task cards, repo-index/semantic/golden/capability generated facts

## Decision rules

- A legal V9 path that calls a V8 projection before/after its canonical producer is a qualified consumer only if removing it preserves actionable warnings/errors.
- PDF admission must satisfy renderer artifact shape and main-process readiness together; do not label incompatible HTML as `pdf-html`.
- Unreachable source-null defensive branches are skip, not implementation work.
- Pure Slide/PPTX/DOCX or diagnostics paths with current compatibility value remain until a behavior-level replacement exists.
- App and main export orchestration are serial hotspots even when format adapters are otherwise independent.

## Validation

- Exact call/control-flow/source consumer and test mapping.
- One independent delivery admission review.
- `npm run generate:task-board`, `npm run check:task-board`, and `git diff --check`; no product test.

## Rollback

- Start point: `36a92f8` plus this claim commit.
- Admission docs/task state are independently revertible; no product/output/persisted-data change.

## Result evidence

- Source-backed report: `docs/development-plan/baselines/ARCH_4_ADMISSION_REPORT.md` at product baseline `36a92f8`.
- Admitted exactly two serial S2 integrations: legal V9 HTML/Web preflight bypasses the V8 base; non-pure-Slide V9 PDF obtains a complete Published/mixed artifact or fails without Legacy fallback.
- PDF admission corrected the initial two-file hypothesis: mixed Flow markup is currently a nested document and Electron readiness assumes one image per page, so Flow fragment and main readiness are part of the same user behavior.
- Source-null, pure-Slide PDF/PPTX, Spatial-only PDF, DOCX, diagnostics and compatibility consumers are retained/skip with explicit reasons. `validateProjectArchiveBytes` alone proceeds to ARCH-5 deletion admission.
- Exact routes/counts, allowed hotspots, focused tests, serial order and the one gate-only actual PDF review are recorded in the report/cards.
- Independent delivery admission review: APPROVE with no findings. It verified both current control-flow gaps, the renderer/main PDF constraint, serial hotspot order, retained compatibility paths and the minimal focused/one-artifact validation boundary. No product test was run under V0.

## Ready checklist（Coordinator）

- [x] ARCH-3 phase gate done
- [x] legal V9 and main-process readiness both in scope
- [x] product hotspots read-only during admission
- [x] no contract/dependency/user-data escalation
