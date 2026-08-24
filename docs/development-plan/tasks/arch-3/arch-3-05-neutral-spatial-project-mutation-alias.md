# S1 Task Card — Neutral Spatial Project Mutation Alias

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: `spatialAuthoringHistory.ts#commitSpatialProjectMutation` is structurally identical to the neutral Course Project mutation helper while seven source consumers rely on its domain name; if claim-time source already has only one implementation and the Spatial export is zero-logic, skip with exact counts.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: bind focused Spatial command tests and exact implementation/import/consumer counts to the product commit; docs/task-board/generated-only changes do not invalidate. Spatial history, neutral helper, focused test or resolution config changes invalidate.
- Invalidating paths: `src/renderer/course/spatialAuthoringHistory.ts`; `src/renderer/course/courseProjectMutation.ts`; `src/renderer/authoring/spatialWorldAuthoring.ts`; `src/renderer/course/spatialCameraCommands.ts`; `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/course/spatialPathCommands.ts`; `src/renderer/course/spatialRelationCommands.ts`; `src/renderer/course/spatialSemanticZoom.ts`; `src/renderer/store/editorStore.ts`; `tests/unit/spatialEditorCommands.test.ts`; Vitest/TypeScript resolution config
- Task ID: `arch-3-05-neutral-spatial-project-mutation-alias`
- Phase / wave: `ARCH-3 / Spatial mutation deduplication`
- Status: `done`
- Owner / Reviewer / Integrator: `Spatial Mutation Worker / independent Spatial mutation reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:56:43+08:00 / 2026-08-24T19:01:45+08:00`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch3-spatial-mutation / codex/arch3-spatial-mutation`
- Baseline HEAD: `70c5d3c`
- Context: `ARCH_3_RE_ADMISSION_REPORT.md`; the neutral helper is established and the duplicate Spatial implementation has seven source consumers and thirty calls.
- Freshness / relevant dirty inputs: clean root; both implementations and the seven source consumers/thirty calls re-read at claim; write set disjoint from Flow task
- Depends on: `arch-3-03-remaining-edge-readmission` done
- Blocks: ARCH-3 phase gate
- Risk statement: deduplication must preserve the Spatial public name and every call site while leaving history/session/resource-transition behavior untouched.
- Retry count / last failure class: `0 / none`

## Product outcome

All Spatial authoring mutations retain their existing domain API and behavior but execute the one neutral Course Project clone/revision/timestamp/Schema implementation instead of a second identical copy.

## Current path and exact target

`spatialAuthoringHistory.ts` contains the same ten-line implementation as `courseProjectMutation.ts`. Its domain export is consumed by seven source files at thirty call sites, so the narrow path is a compatibility alias, not a consumer migration.

## Scope and locks

### Allowed write

- `src/renderer/course/spatialAuthoringHistory.ts`

### Required read

- `src/renderer/course/courseProjectMutation.ts`
- all current `commitSpatialProjectMutation` importers/calls
- `tests/unit/spatialEditorCommands.test.ts`

### Forbidden write

- all Spatial consumers/call sites, focused tests, Slide/Flow modules, history/session/resource-transition primitives, Store/App/Workspace/Properties, Schema/contracts, dependencies and generated files

## Required implementation shape

1. Remove the duplicate implementation and its now-unused Schema import.
2. Import the neutral helper and export it as `commitSpatialProjectMutation` with zero logic.
3. Keep all current consumer imports and thirty calls unchanged.
4. Do not move history/session types, add wrappers/options or migrate other helpers.

## Expected delta

- mutation implementation copies `2 → 1`;
- Spatial history Schema import `1 → 0`;
- Spatial domain API name, seven source consumers and thirty calls unchanged;
- compatibility alias contains no function body.

## Must preserve

- structured clone before one recipe invocation
- `revision = previous + 1`, explicit/default timestamp and final Schema parse
- Spatial history limits, resource transitions, selection, generation and session camera behavior
- all existing error and stale-target behavior

## Validation

- `npx vitest run tests/unit/spatialEditorCommands.test.ts`
- exact implementation/import/consumer/call counts and `git diff --check`
- no test edit, TypeScript, full suite, E2E, build or generated refresh under V1

## Rollback

- Start point: claim commit plus its recorded baseline.
- One source commit; revert restores the local implementation without data migration.

## Result evidence

- Product commit: root `3361592` (isolated-worker source `dc15bf8`). `spatialAuthoringHistory.ts` removes its duplicate function and Schema import, imports the neutral helper and exposes `commitSpatialProjectMutation` as a zero-logic const alias.
- Focused validation: `npx vitest run tests/unit/spatialEditorCommands.test.ts` passed `1 file / 6 tests`; only the allowed source file changed and diff hygiene passed.
- Exact delta: structurally identical mutation implementations `2 → 1`, target Schema import `1 → 0`; seven source consumers and thirty call sites are unchanged.
- Independent review: APPROVE with no findings. It verified operation equivalence, zero-logic alias, stable consumers/calls and untouched history/session/resource behavior; focused evidence was reused rather than rerun.
- Generated refresh: defer-to-ARCH-3-gate.

## Ready checklist（Coordinator）

- [x] implementations are structurally identical
- [x] single-file write set disjoint from Flow task
- [x] consumer/call-site freeze explicit
- [x] no Store/App/contract/dependency escalation
