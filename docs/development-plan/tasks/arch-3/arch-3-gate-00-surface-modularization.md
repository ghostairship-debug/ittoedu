# S1 Task Card — ARCH-3 Surface Modularization Phase Gate

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: phase-gate
- Necessity / skip condition: ARCH-3 changed four concrete Surface boundary ownership points; if all focused evidence remains fresh, this gate only proves the combined TypeScript graph, exact residual boundaries and generated freshness rather than rerunning user journeys whose inputs did not change.
- Complexity delta: subtractive
- Validation ceiling: V3
- Validation budget: 20 minutes
- Reviewer budget: 1
- Evidence reuse: reuse the four implementation cards' product-bound focused tests and independent reviews; product evidence is invalidated only by their listed source/tests, root renderer TypeScript resolution, or renderer Slide/Flow/Spatial-named file membership changes. Report/task/task-board/repo-index generated-only changes do not invalidate it.
- Invalidating paths: `src/renderer/course/courseProjectMutation.ts`; `src/renderer/course/slideEditorCommands.ts`; `src/renderer/course/flowEditorCommands.ts`; `src/renderer/course/flowSharedAuthoringAdapters.ts`; `src/renderer/project/createFlowCourseProject.ts`; `src/renderer/phaser/layerItemHitTest.ts`; `src/renderer/phaser/v9SlideHitAdapter.ts`; `src/renderer/phaser/v9SpatialHitAdapter.ts`; `src/renderer/authoring/stageViewportTransform.ts`; `src/renderer/course/spatialAuthoringHistory.ts`; `src/renderer/authoring/spatialWorldAuthoring.ts`; `src/renderer/authoring/v9SlideContentEdit.ts`; `src/renderer/course/spatialCameraCommands.ts`; `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/course/spatialPathCommands.ts`; `src/renderer/course/spatialRelationCommands.ts`; `src/renderer/course/spatialSemanticZoom.ts`; `src/renderer/store/editorStore.ts`; `src/renderer/course/courseLocationCommands.ts`; `src/renderer/course/effectiveLayerCommands.ts`; `src/renderer/course/globalLayerCommands.ts`; `src/renderer/course/v9MediaAudioCommands.ts`; `src/renderer/authoring/v9TeacherControllerAuthoring.ts`; `tests/unit/flowEditorCommands.test.ts`; `tests/unit/courseTreeView.test.ts`; `tests/unit/spatialWorkspaceAuthoring.test.ts`; `tests/unit/v9SlideViewportAdapter.test.ts`; `tests/unit/flowSharedAuthoringAdapters.test.tsx`; `tests/unit/spatialEditorCommands.test.ts`; `tests/unit/courseLocationCommands.test.ts`; renderer Slide/Flow/Spatial-named source membership; `tsconfig.json`; Vitest/TypeScript resolution config
- Task ID: `arch-3-gate-00-surface-modularization`
- Phase / wave: `ARCH-3 / phase gate`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent ARCH-3 gate reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T19:03:00+08:00 / 2026-08-24T19:11:54+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d26ba7c`
- Context: all six ARCH-3 admission/implementation cards are done; combined product HEAD contains four reviewed subtractive commits and the root worktree is clean.
- Freshness / relevant dirty inputs: focused tests remain bound to their reviewed product commits; no invalidating product/config change followed them
- Depends on: `arch-3-00-surface-admission`, `arch-3-01-neutral-project-mutation-first-flow-consumer`, `arch-3-02-neutral-layer-item-hit-test-first-spatial-consumer`, `arch-3-03-remaining-edge-readmission`, `arch-3-04-neutral-flow-shared-overlay-mutation`, and `arch-3-05-neutral-spatial-project-mutation-alias` done
- Blocks: ARCH-4 necessity admission
- Risk statement: the gate must distinguish intentionally retained edges from regressions and must not turn a one-time ownership snapshot into a brittle permanent ratchet.
- Retry count / last failure class: `2 / independent review expanded invalidation coverage; closure then corrected the generated repo-index write path from an obsolete artifacts location to the actual root directory`

## Product outcome

ARCH-3 closes with fewer real cross-Surface dependencies and one mutation implementation, while every remaining edge has a current reason, owner and re-entry trigger and all combined renderer types remain valid.

## Evidence to reuse

- Flow neutral command/tree: `2 files / 22 tests`, independent APPROVE.
- Neutral hit policy: `2 files / 14 tests`, independent APPROVE.
- Flow shared overlay: `1 file / 7 tests`, independent APPROVE.
- Spatial mutation alias: `1 file / 6 tests`, independent APPROVE.

No focused command is rerun unless an invalidating input changed.

## Scope and locks

### Allowed write

- new `docs/development-plan/baselines/ARCH_3_PHASE_GATE_REPORT.md`
- this card and generated `docs/development-plan/TASK_BOARD.md`
- final refresh of `repo-index/generated/**`

### Required read

- all ARCH-3 reports/cards and current changed source/tests
- exact current Surface import graph, compatibility wrappers and retained consumers
- repo-index/task-board freshness scripts

### Forbidden write

- product source/tests, Schema/contracts, dependencies, architecture ratchet, semantic/golden facts, fixtures and capability metadata/generated files

## Validation

- `npx tsc --noEmit`
- one AST/static ownership snapshot for exact Slide/Flow/Spatial edges, symbols, helper calls, aliases and dead-api references
- `npm run generate:task-board` and `npm run check:task-board`
- `npm run repo:index` and `npm run repo:index:check`
- `git diff --check`
- no focused Vitest rerun, full unit suite, Electron E2E, build, performance, Preview/Player/Export or representative-project run

## Required gate facts

- Slide-named renderer sources → Flow/Spatial: `0` edges.
- Flow-named sources → Slide: `1 edge / 1 old helper call`, only production-dead `appendBlankFlowPage`.
- Spatial-named sources → Slide: `1 edge / 10 symbols`, the retained content-edit boundary.
- Generic hit policy lives once; Spatial hit adapter no longer imports Slide; Slide hit compatibility exports are zero-logic.
- Course Project mutation function body lives once; Slide and Spatial compatibility exports are zero-logic.
- Spatial mutation remains at seven source consumers/thirty calls and no local Schema import.
- `appendBlankFlowPage` has zero production incoming consumer and one test consumer file.

## Rollback

- Start point: `d26ba7c` plus this claim commit.
- Gate report/card/generated refresh are independently revertible; no product behavior or persisted data changes.

## Result evidence

- Phase report: `docs/development-plan/baselines/ARCH_3_PHASE_GATE_REPORT.md`, bound to combined product candidate `d9a1b29`.
- Reused fresh focused evidence: `2/22`, `2/14`, `1/7`, and `1/6` tests from the four reviewed implementation commits; no invalidating path changed and no focused command was rerun.
- Combined validation: `npx tsc --noEmit` passed. A TypeScript 7 AST snapshot confirmed Slide → Flow/Spatial `0`; Flow → Slide `1 edge / 1 call`; Spatial → Slide `1 edge / 10 symbols`; one mutation function body; zero Spatial Schema import; seven Spatial mutation consumers/thirty calls; and zero production incoming consumer for `appendBlankFlowPage`.
- Retained edges and re-entry conditions are recorded rather than hidden or migrated for naming symmetry. No architecture ratchet or new abstraction was added.
- Independent gate review: APPROVE after invalidating paths were expanded to cover every counted consumer, retained generic source, focused test and deletion-candidate test; no remaining finding and no product validation rerun requested.
- Closure freshness: final task-board and repo-index generate/check plus diff hygiene passed after the card's generated-output path was corrected; no product validation was repeated.

## Ready checklist（Coordinator）

- [x] every ARCH-3 admission/implementation card terminal
- [x] focused evidence freshness checked
- [x] no product writer required
- [x] V3 scope excludes final-candidate-only validation
