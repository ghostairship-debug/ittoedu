# S1 Task Card — Neutral Flow Shared Overlay Mutation

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: `flowSharedAuthoringAdapters.ts` still has one Flow → Slide edge solely for two Surface-neutral project mutations; if claim-time source already uses the neutral helper for both online paths and contains no Slide helper import, skip with exact counts.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: bind the focused adapter test and exact source/import/call delta to the product commit; docs/task-board/generated-only changes do not invalidate. Adapter, neutral helper, Slide wrapper, focused test or test-resolution changes invalidate.
- Invalidating paths: `src/renderer/course/flowSharedAuthoringAdapters.ts`; `src/renderer/course/courseProjectMutation.ts`; `src/renderer/course/slideEditorCommands.ts`; `tests/unit/flowSharedAuthoringAdapters.test.tsx`; Vitest/TypeScript resolution config
- Task ID: `arch-3-04-neutral-flow-shared-overlay-mutation`
- Phase / wave: `ARCH-3 / Flow second consumer`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Flow Overlay Boundary Worker / independent Flow overlay reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:56:43+08:00 / pending`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch3-flow-overlay / codex/arch3-flow-overlay`
- Baseline HEAD: `70c5d3c`
- Context: `ARCH_3_RE_ADMISSION_REPORT.md`; first Flow consumer already established one neutral implementation and a zero-logic Slide compatibility export.
- Freshness / relevant dirty inputs: clean root; exact two call sites and the global-only visibility coverage re-read at claim; write set disjoint from Spatial task
- Depends on: `arch-3-03-remaining-edge-readmission` done
- Blocks: ARCH-3 phase gate
- Risk statement: both online calls must move together without changing overlay ownership, visibility, revision/history, Schema or error behavior.
- Retry count / last failure class: `0 / none`

## Product outcome

Flow page shared-overlay insertion, conversion, transformation, properties and per-location visibility use the neutral Course Project mutation primitive without depending on a Slide-named implementation, while preserving one revision/history step and existing validation/errors.

## Current path and exact target

`flowSharedAuthoringAdapters.ts` imports `commitSlideProjectMutation` once and calls it twice: its general overlay mutation path and the surface-overlay branch of per-location visibility. The current visibility test selects the global Teacher Controller and does not cover the second direct call.

## Scope and locks

### Allowed write

- `src/renderer/course/flowSharedAuthoringAdapters.ts`
- `tests/unit/flowSharedAuthoringAdapters.test.tsx`

### Required read

- `src/renderer/course/courseProjectMutation.ts`
- `src/renderer/course/slideEditorCommands.ts`
- current ownership/visibility and mutation result behavior in the focused test

### Forbidden write

- neutral helper or Slide wrapper, `createFlowCourseProject.ts`, Store/App/Workspace/Properties, generic consumers, Spatial, Schema/contracts, dependencies and generated files

## Required implementation shape

1. Replace the one Slide helper import with the neutral helper import.
2. Switch both existing calls in the same source file; do not alter recipes or result mapping.
3. Add one focused surface-overlay per-location visibility characterization through the second call path.
4. Do not introduce another wrapper, options object, facade or batch migration.

## Expected delta

- target file Flow → Slide edge `1 → 0`;
- target file old helper calls `2 → 0`, neutral calls `0 → 2`;
- audited Flow-named Slide edges `2 → 1`, old calls `3 → 1`;
- one neutral implementation remains; no compatibility wrapper changes.

## Must preserve

- one revision and one history entry for a real change
- final Course Project Schema parse and existing error mapping
- global/surface ownership, effective ordering and per-location visibility semantics
- Flow document block order, selection, IME/DnD and carrier boundaries

## Validation

- `npx vitest run tests/unit/flowSharedAuthoringAdapters.test.tsx`
- exact import/call counts and `git diff --check`
- no TypeScript, full suite, E2E, build or generated refresh under V1

## Rollback

- Start point: claim commit plus its recorded baseline.
- One product/test commit; revert restores only the old import/name and added characterization.

## Result evidence

- Pending implementation, focused validation and independent review.

## Ready checklist（Coordinator）

- [x] online two-call path and missing characterization exact
- [x] allowed files disjoint from Spatial task
- [x] neutral helper and Slide wrapper read-only
- [x] no Store/App/contract/dependency escalation
