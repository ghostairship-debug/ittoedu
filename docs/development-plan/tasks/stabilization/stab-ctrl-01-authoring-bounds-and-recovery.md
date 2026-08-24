# S2 Task Card — Controller Authoring Ownership, Bounds And Recovery

> Audit coverage: `CROSS-04`, `CTRL-05`.

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: Slide/Flow page authoring can hit and mutate the one global controller, and Flow can commit a frame accepted by V9 but rejected by unified canvas; skip only if all three page previews are already inert/pass-through and Global Layer authoring alone proves safe bounds, cancel, recovery, save/reopen and Player consumption.
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 20 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the two focused test results to the product commit; docs/task-board/generated-only changes reuse them, while only the listed source/test paths invalidate the corresponding evidence.
- Invalidating paths: `src/shared/teacherControllerLayout.ts`; `src/renderer/authoring/v9TeacherControllerAuthoring.ts`; `src/renderer/authoring/spatialWorldAuthoring.ts`; `src/renderer/course/globalLayerCommands.ts`; `src/renderer/store/editorStore.ts`; `src/renderer/ui/FlowWorkspace.tsx`; `src/renderer/ui/Workspace.tsx`; `src/renderer/ui/TeacherControllerAuthoringChrome.tsx`; `tests/unit/teacherControllerAuthoringOwnership.test.tsx`; `tests/unit/teacherControllerAuthoringBounds.test.ts`
- Task ID: `stab-ctrl-01-authoring-bounds-and-recovery`
- Phase / wave: `post-audit stabilization / A-core`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Controller Authoring Worker / Controller Ownership Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared workspace with file firewall; integration on codex/architecture-stabilization`
- Baseline HEAD: `5c512f9`
- Context Pack + manifest hash | bootstrap-manual: fresh `repo:context` query on `teacher controller page inert preview global layer bounds recovery pointercancel` returned low confidence, so manual Bootstrap is required before writing.
- Freshness / relevant dirty inputs: repo-index check passed at claim; worktree was clean and no relevant dirty inputs were present.
- Hotspot locks: `FlowWorkspace.tsx`, `Workspace.tsx`, and Store/History controller exposure are reserved to this card until integration.
- Depends on: `none`
- Blocks: `stab-wave-a-core-usability`; `stab-ctrl-06-safe-default-collapsed`
- Risk statement: Removing the wrong route can disable legitimate Global Layer editing; leaving any page writer or unsafe global commit keeps a whole-course corruption path.
- Retry count / last failure class: `0 / none`

## Product outcome

Slide, Flow and Spatial pages show an inert controller preview that reflects the saved `defaultCollapsed` value and passes events through; only Global Layer can persist controller edits, and that one writer cannot save an unrecoverable frame.

## Current fact and canonical boundary

- Page preview has no authoring target, focus target, selection or transform commit. Clicking it must not switch scope to Global Layer.
- Canonical persisted writer is the existing Global Layer command over V9 `globalLayerItems[*].item.frame`; there is no page/Surface override or second frame.
- Global Layer move clamps the visible recovery handle at all four 1280×720 edges. Gesture preview is transient; `pointercancel` commits zero revisions. Existing fully out-of-bounds data has an explicit reset-to-safe-position command with one history entry.
- V8 projection, unified canvas and Published Player are read-only consumers. This card does not authorize producer, payload or Schema changes.

## Scope and acceptance

- Allowed write: page hit/preview guards, the existing controller authoring kernel, Global Layer command and only the Store action needed to expose reset, plus the two named tests.
- Required read: Global Layer UI/authoring address, V9 frame Schema, V9→V8 consistency rule and Player consumer behavior.
- Forbidden write: page drag implementation, Published producer/payload, V9/Published contracts, per-location position, unrelated Flow/Spatial editing, dependencies, generated files, task board and root docs.
- Hotspot lock and order: `Workspace` and `Store/History` have one writer, `Stabilization Integrator`; a Worker may prepare pure helpers/tests only. Release these locks before later Flow or Spatial hotspot cards.
- Non-goals: no generic geometry framework, no V10, no automatic scope jump, no hidden `playback.controls='none'`, and no migration of unrelated layer frames.
- Acceptance:
  - [ ] Slide/Flow/Spatial page previews cannot be selected, focused, dragged, resized or rotated; their transparent area passes pointer gestures to underlying content/surface.
  - [ ] Inert previews render the saved `defaultCollapsed` state without becoming runtime-interactive.
  - [ ] Global Layer remains the sole persistent editor and clamps all four edges while preserving a visible recovery handle.
  - [ ] `pointercancel` discards preview with zero project/history writes; old out-of-bounds data resets explicitly in one history entry.
  - [ ] The resulting project survives save/reopen and is accepted unchanged by unified canvas and Published Player.

## Minimal validation

- `npx vitest run tests/unit/teacherControllerAuthoringOwnership.test.tsx tests/unit/teacherControllerAuthoringBounds.test.ts`
- `git diff --check`

## Result and rollback

- Start point: claim baseline.
- Product/integration commit and rollback: pending; one main commit and one revert boundary, with no retained page writer or double-write path.
- Result evidence: pending commit plus focused ownership/bounds results; real Chromium behavior is owned once by Wave A.
- Outcome conclusion boundary: focused automation establishes at most `engineering candidate`; real editor/Player review is required for `accepted`.
- Stop condition: contract change, silent migration, Published-producer mutation or a second canonical writer requires re-scope/product decision.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
