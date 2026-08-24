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
- Status: `claimed`
- Owner / Reviewer / Integrator: `Store worker / independent behavior reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T20:59:36+08:00 / pending`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `406c0b1`
- Context: `restoreDefaultTeacherController` and persistence already select a newly created ID; explicit locate remains needed for global authoring scope and for existing-controller behavior
- Freshness / relevant dirty inputs: this claim card and task board only
- Depends on: `arch-5-final-02-v4-and-outcome` rolled back
- Blocks: candidate 3
- Risk statement: skipping selection entirely would preserve the tab but could lose global scope/location semantics, while restoring the tab for existing controllers would silently change the explicit locate workflow.
- Retry count / last failure class: `0 / none`

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

- [ ] a created controller is selected in global scope while the source `elements` tab remains active
- [ ] existing/no-op controller locate still opens Properties
- [ ] controller history/playback restore semantics remain green
- [ ] no App/UI/contract or unrelated Store behavior changes

## Validation

- Run `npx vitest run tests/unit/batchMediaAndInsertion.test.ts tests/unit/globalEditorStore.test.ts tests/unit/architectureDependencyRatchet.test.ts` once.
- Run `npx tsc --noEmit` and `git diff --check`; candidate 3 owns broad/Electron verification.

## Rollback

- Revert the bounded Store/test hunk; no persisted data migration is involved.

## Result evidence

- Pending bounded Store repair, focused validation and independent review.
