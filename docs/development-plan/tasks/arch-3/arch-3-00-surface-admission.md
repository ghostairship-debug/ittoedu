# S1 Task Card — ARCH-3 Surface Necessity Admission

> 本卡只把当前跨 Surface consumer 事实转换为 admit/skip 决定；不为三种 Surface 预建对称 seam。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: ARCH-2 gate 已完成，ARCH-3 要求分别证明 Slide/Flow/Spatial 的真实跨边界 consumer、用户失败或可量化理解范围下降；没有该证据的 Surface 以 skip 结束，不因目录、文件大小或阶段标题建卡。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 20 minutes
- Reviewer budget: 1
- Evidence reuse: 准入绑定当前 product HEAD 与 fresh repo-index；本卡/报告/task-board-only 变化不失效。命中下列 Surface donor/consumer 或相关 import resolution 后只重审对应决定。
- Invalidating paths: `src/renderer/course/flowEditorCommands.ts`; `src/renderer/course/flowSharedAuthoringAdapters.ts`; `src/renderer/project/createFlowCourseProject.ts`; `src/renderer/course/slideEditorCommands.ts`; `src/renderer/phaser/v9SpatialHitAdapter.ts`; `src/renderer/phaser/v9SlideHitAdapter.ts`; `src/renderer/authoring/spatialWorldAuthoring.ts`; `src/renderer/authoring/v9SlideContentEdit.ts`; relevant focused tests and TypeScript config
- Task ID: `arch-3-00-surface-admission`
- Phase / wave: `ARCH-3 / necessity admission`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + Surface Admission Auditor / independent admission reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:23:02+08:00 / —`
- Worktree / branch: `shared root, read-only product audit / codex/architecture-stabilization`
- Baseline HEAD: `48131e2`
- Context: fresh deterministic repo-index at `48131e2` plus direct source/import audit; current product source is unchanged after the ARCH-2 gate candidate.
- Freshness / relevant dirty inputs: clean root worktree; all product hotspots read-only
- Depends on: `arch-2-gate-00-cross-surface-features` done
- Blocks: ARCH-3 admitted implementation cards and phase gate
- Retry count / last failure class: `0 / none`

## Product outcome

ARCH-3 creates work only where a Surface currently imports another Surface's internal implementation, and each admitted task moves one neutral policy/primitive to one real first consumer while preserving Surface-specific carriers and behavior.

## Questions to decide

1. Does Slide itself depend on Flow/Spatial internals or have another qualified behavior blocker?
2. Which Flow → Slide edge is truly Surface-neutral and can move with one first consumer?
3. Which Spatial → Slide edge is truly generic LayerItem policy and can move without changing viewport/world behavior?
4. After each first consumer moves, which remaining edges require a fresh behavior-level admission rather than automatic cleanup?

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_3_ADMISSION_REPORT.md`
- this card and generated `docs/development-plan/TASK_BOARD.md`

### Required read

- `docs/development-plan/30-execution/05_ARCH_3_SURFACE_MODULARIZATION.md`
- current Slide/Flow/Spatial named files, exact import edges, donor implementations and focused tests
- current repo-index facts and direct source verification

### Forbidden write

- all product source/tests/contracts/fixtures/dependencies, other task cards, semantic/golden facts and generated repo-index

## Decision rules

- A new neutral file must take one existing implementation and connect one real consumer in the same task; no copied implementation or unused public API.
- Keep a zero-logic compatibility export when other current consumers still need the old name.
- Do not batch-migrate remaining edges merely because the first neutral seam now exists.
- Workspace, Properties, App and Store remain untouched; file size is not admission evidence.

## Validation

- Exact import/reference counts and source-backed behavior/test mapping.
- Independent admission review.
- `npm run generate:task-board`, `npm run check:task-board`, and `git diff --check`; no product test.

## Rollback

- Start point: `48131e2` plus this claim commit
- Report/task state are independently revertible; no product or persisted data change

## Result evidence

- Report/decision commit: pending
- Slide decision: pending
- Flow decision and exact delta: pending
- Spatial decision and exact delta: pending
- Review/validation: pending
- Next allowed tasks: pending

## Ready checklist（Coordinator）

- [x] ARCH-2 gate done and repo-index fresh
- [x] read-only scope and invalidation paths bounded
- [x] no product hotspot writer required
- [x] no contract, dependency or user-data escalation
