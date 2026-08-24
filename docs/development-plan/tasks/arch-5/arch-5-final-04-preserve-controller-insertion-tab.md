# S1 Task Card — Preserve Teacher-Controller Insertion Tab

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: candidate-2 full Vitest exposed a deterministic `b5655ec` regression: creating a missing teacher controller is already selected by command persistence, then a redundant locate call opens Properties and breaks continuous insertion. Fix only the created-controller path; skip/stop if an existing-controller locate would stop opening Properties.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: independent diagnosis reproduced the focused file once and traced `createdLayerItemId → persisted selection → selectNode → properties`; existing Store tests cover restore/history behavior, so add only the missing selection/scope assertions to the failing test.
- Invalidating paths: `src/renderer/store/editorStore.ts`; `tests/unit/batchMediaAndInsertion.test.ts`; `tests/unit/globalEditorStore.test.ts`; `tests/unit/architectureDependencyRatchet.test.ts`
- Task ID: `arch-5-final-04-preserve-controller-insertion-tab`
- Phase / wave: `ARCH-5 / candidate repair`
- Status: `done`
- Owner / Reviewer / Integrator: `Store worker / independent behavior reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:59:36+08:00 / 2026-08-24T21:07:13+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `406c0b1`
- Context: `restoreDefaultTeacherController` and persistence already select a newly created ID; explicit locate remains needed for global authoring scope and for existing-controller behavior
- Freshness / relevant dirty inputs: this claim card and task board only
- Depends on: `arch-5-final-02-v4-and-outcome` rolled back
- Blocks: candidate 3
- Risk statement: skipping selection entirely would preserve the tab but could lose global scope/location semantics, while restoring the tab for existing controllers would silently change the explicit locate workflow.
- Retry count / last failure class: `1 / reviewer rejected createdLayerItemId as a creation-only signal; final code checks pre-restore existence`

## Product outcome

Adding a missing teacher controller from Elements keeps the teacher in the insertion flow while still selecting the new global controller; locating/restoring an existing controller keeps the Properties behavior.

## Scope and hotspot lock

### Allowed write

- `src/renderer/store/editorStore.ts`
- `tests/unit/batchMediaAndInsertion.test.ts`
- this card and generated task board

### Forbidden write

- App/Workspace/Properties, commands/contracts/Schema, other product source/tests, fixtures/config and user data

### Hotspot lock

- Store has exactly one writer for this task.

## Implementation

- Capture the source tab before controller restoration.
- Keep the current global `selectNode` locate for all successful results; only when `createdLayerItemId` is present, restore the captured tab after selection.
- Apply the same behavior to Slide, Flow and Spatial branches through the smallest local helper or equivalent bounded code.
- Strengthen the existing missing-controller test only with selected-ID/global-scope assertions; do not add a new abstraction or suite.

## Acceptance

- [x] a created controller is selected in global scope while the source `elements` tab remains active
- [x] existing/no-op controller locate still opens Properties
- [x] controller history/playback restore semantics remain green
- [x] no App/UI/contract or unrelated Store behavior changes

## Validation

- Run `npx vitest run tests/unit/batchMediaAndInsertion.test.ts tests/unit/globalEditorStore.test.ts tests/unit/architectureDependencyRatchet.test.ts` once.
- Run `npx tsc --noEmit` and `git diff --check`; candidate 3 owns broad/Electron verification.

## Rollback

- Revert the bounded Store/test hunk; no persisted data migration is involved.

## Result evidence

- Product commit `4560c8f` changes only `editorStore.ts` and the focused insertion test (`31 insertions / 4 deletions`). Slide, Flow and Spatial record whether a controller existed before restore, always locate through `selectNode`, and restore the source tab only for a genuinely missing controller.
- Final-code focused evidence: `batchMediaAndInsertion.test.ts` passed `8 / 8`; `globalEditorStore.test.ts` plus `architectureDependencyRatchet.test.ts` passed `2 files / 26 tests`, for `3 files / 34 tests` total. Root `npx tsc --noEmit` and `git diff --check` passed.
- Independent reviewer first issued **REQUEST_CHANGES** because `createdLayerItemId` also identifies repaired existing controllers. The implementation changed to pre-restore existence, added the existing `controls: none → Properties` assertion, and final re-review returned **APPROVE** with no remaining blocker.
