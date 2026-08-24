# S1 Task Card — Neutral Project Mutation, First Flow Consumer

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: `flowEditorCommands#runMutation` currently imports a Surface-neutral clone/mutate/revision/timestamp/schema helper from `slideEditorCommands`; if claim-time source already provides one neutral implementation consumed by Flow without a Flow → Slide edge, skip and record the current owner.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: bind focused Flow/tree tests and exact source/import delta to the product commit; docs/task-board/generated-only changes do not invalidate. Source/helper/import or focused-test/config changes invalidate this evidence.
- Invalidating paths: `src/renderer/course/courseProjectMutation.ts`; `src/renderer/course/slideEditorCommands.ts`; `src/renderer/course/flowEditorCommands.ts`; `tests/unit/flowEditorCommands.test.ts`; `tests/unit/courseTreeView.test.ts`; Vitest/TypeScript resolution config
- Task ID: `arch-3-01-neutral-project-mutation-first-flow-consumer`
- Phase / wave: `ARCH-3 / Flow first consumer`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Flow Boundary Worker / independent Flow reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:30:20+08:00 / —`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch3-flow-neutral-mutation / codex/arch3-flow-neutral-mutation`
- Baseline HEAD: `6d0ff92`
- Context: `ARCH_3_ADMISSION_REPORT.md` at `629fd15`; last repo-index is product-fresh and subsequent changes are admission docs/task state, with exact source re-read at claim.
- Freshness / relevant dirty inputs: clean root; no concurrent writer in the three allowed source files
- Depends on: `arch-3-00-surface-admission` done
- Blocks: remaining Flow-edge re-admission and ARCH-3 phase gate
- Risk statement: moving the implementation must not create a second mutation mechanism, change revision/timestamp/schema semantics, or silently batch-migrate other Flow/Store consumers.
- Retry count / last failure class: `0 / none`

## Product outcome

Editing Flow document structure no longer depends on a Slide-named internal helper; Flow and Slide use one neutral Course Project mutation implementation with identical revision, timestamp and Schema behavior.

## Current path and exact target

- Donor: `slideEditorCommands#commitSlideProjectMutation`, one implementation at lines 259–268.
- First consumer: `flowEditorCommands#runMutation`, one direct call.
- Other audited Flow-named consumers: `flowSharedAuthoringAdapters` two calls and `createFlowCourseProject` one call; retained for re-admission.

## Scope and locks

### Allowed write

- new `src/renderer/course/courseProjectMutation.ts`
- `src/renderer/course/slideEditorCommands.ts`
- `src/renderer/course/flowEditorCommands.ts`
- focused test changes only if current tests cannot characterize compatibility: `tests/unit/flowEditorCommands.test.ts`, `tests/unit/courseTreeView.test.ts`

### Required read

- donor implementation and all current importers
- focused tests for Flow revision/history/schema behavior and old compatibility export

### Forbidden write

- `flowSharedAuthoringAdapters.ts`, `createFlowCourseProject.ts`, Store/App/Workspace/Properties, Spatial, history/session primitives, Schema/contracts, other tests, dependencies and generated files

## Required implementation shape

1. Move the single implementation to `courseProjectMutation.ts` as `commitCourseProjectMutation`.
2. Keep `commitSlideProjectMutation` as a zero-logic compatibility re-export/alias from `slideEditorCommands.ts`.
3. Switch only `flowEditorCommands#runMutation` to the neutral name.
4. Do not copy code, add options/config/facade, or rename all consumers.

## Expected delta

- audited `flowEditorCommands` Flow → Slide edge `1 → 0`;
- audited Flow-named source Slide edges `3 → 2`;
- audited Flow-named calls through Slide helper `4 → 3`;
- mutation implementation copies remain `1`;
- compatibility export remains consumed and contains no behavior.

## Must preserve

- structured clone before recipe; one recipe invocation
- `revision = previous + 1`
- explicit/default ISO timestamp behavior
- final `courseProjectDocumentSchema.parse`
- all Flow carrier, selection, history, IME/DnD and error behavior

## Validation

- `npx vitest run tests/unit/flowEditorCommands.test.ts tests/unit/courseTreeView.test.ts`
- exact source/import/reference count and `git diff --check`
- no full suite, E2E, build or TypeScript rerun under V1; combined TypeScript runs at the ARCH-3 gate

## Rollback

- Start point: `6d0ff92` plus this claim commit
- One product/test commit; reverting restores the old import/name without data migration

## Result evidence

- Product commit and before/after: pending
- Focused validation: pending
- Exact consumer/implementation delta: pending
- Independent review: pending
- Remaining risks/re-admission: pending
- Generated refresh: defer-to-ARCH-3-gate

## Ready checklist（Coordinator）

- [x] admission and first consumer exact
- [x] allowed files independent from Spatial task
- [x] compatibility and stop conditions explicit
- [x] no Store/App/contract/dependency escalation
