# S1 Task Card — ARCH-1 VS-04 Slide Image Replacement Command

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Task ID: `arch-1-vs-04-slide-image-replacement-command`
- Phase / wave: `ARCH-1 / first vertical slice`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending isolated Media command worktree / codex/architecture-stabilization`
- Baseline HEAD: `pending final ARCH-0B gate baseline`
- Claim commit: `pending`
- Context: `pending ARCH-0B gate; require fresh Media/Slide context and reviewed VS-02/VS-03 interfaces`
- Freshness / relevant dirty inputs: refresh current `v9MediaAudioCommands` and Slide content helpers after VS-02/VS-03; no App/Store writer in this worktree
- Depends on: `arch-1-vs-01-image-replacement-characterization (done); arch-1-vs-02-authoring-target-stale-guard (reviewed/target-green); arch-1-vs-03-editor-transaction-resource-delta (reviewed/target-green)`
- Blocks: `arch-1-vs-05-image-replacement-app-store-integration`
- Retry count: `0`

## Product outcome

A pure Slide/Media command can replace exactly the captured native image in Course Project V9 and return one document/resource transaction plan without reading live selection or committing history itself.

## Current fact and evidence

- `replaceCourseLayerMedia` already replaces a normal V9 image/video and checks `expectedRevision`, but it is bound to the current `CourseMediaSession` selection/location/state.
- It commits Slide snapshot history directly and returns a full sidecar; it does not accept a stable cross-dialog target or emit `AssetFileHistoryChange`.
- `writeNativeAssetId` already respects base scene versus named presentation state and should be reused rather than reimplemented.
- `tests/unit/v9MediaAudioCommands.test.ts` covers synchronous normal replacement only; it does not cover delayed target, resource-delta undo evidence or same-ID payload conflict.

## Non-goals

- No App callback, Store action, history timeline or undo/redo integration.
- No Flow/Spatial/global image replacement; the first slice is one Slide scene image.
- No image editor/crop UI, dedupe redesign, asset garbage collection or all-media abstraction.
- No V8 mutation/adapter and no Preview/export change.

## Scope and locks

### Allowed write

- `src/renderer/course/v9MediaAudioCommands.ts`
- `src/renderer/course/v9SlideContentCommands.ts` only if an existing narrow pure helper must be exposed
- `tests/unit/courseImageReplacementPlan.test.ts`
- This task card result fields

### Required read

- Reviewed VS-02 `CourseAuthoringTarget` and exact revision policy
- Reviewed VS-03 `EditorTransactionPlan` / resource delta helpers
- `src/renderer/project/v9AssetAdapter.ts`
- `src/renderer/course/slideEditorView.ts`
- `tests/unit/v9MediaAudioCommands.test.ts`
- Slide-heavy base/evidence state structure and VS-01 acceptance

### Forbidden write

- `src/renderer/App.tsx`, `src/renderer/store/editorStore.ts`, `src/renderer/store/history.ts`
- `courseAuthoringSession.ts`, Workspace, Properties, MediaTab UI
- Flow/Spatial/main/preload/Published/export
- Contracts/Schema, package/lockfile, fixtures, inventories, repo-index generated/semantic
- Other task cards

### Do not read unless needed

- Full Store/App bodies
- Unrelated audio/video/component command sections
- Historical tasks and release output

### Hotspot locks（通常 0–1 个）

- Media/Slide command lock only; no App/Store/History lock.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `1 primary command file; at most 1 existing pure helper file`
- New/moved files: `1 focused test; no moves`
- Public exports: `one internal image-replacement planner/result`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `none; indexImpact only`
- Target tests / expected validation time: `2 focused files, under 8 minutes`
- Max implementation retries: `2`

## Characterization

- Current successful behavior: synchronous replacement updates V9 image reference and imports metadata/bytes; named-state writes use the current state.
- Known failure: the command receives current session/selection rather than a target captured before the dialog, and its sidecar is represented as a full snapshot.
- Async/stale/history/save/preview implications: the planner consumes an already captured target, validates canonical carrier/item, increments the V9 document once, and returns existing resource delta types; it does not push a history entry or read Store.
- Stable target/revision policy: target must contain project ID, exact base revision, generation, surface/location/state, owner/ownerKey, item ID and authoring address. This slice accepts owner=`scene`, surfaceType=`slide`, nativeType=`image` only.

## Implementation outline

1. Add a narrow `planCourseImageReplacement`-style pure export beside current V9 Media commands.
2. Resolve the captured target against the supplied V9 document; reject wrong project/carrier/owner/item/locked/non-image without a plan.
3. Reuse existing asset import and native asset-ID helpers to create the next V9 document.
4. Use VS-03 helpers to create cloned add/replace asset delta and return one transaction plan, selection hint and feedback.
5. Keep the existing synchronous command active until VS-05 switches the App/Store consumer.

## Acceptance

- [ ] Planner updates only captured image A, never current selection B.
- [ ] V9 document revision increases once; metadata/reference and sidecar delta describe one atomic action.
- [ ] Base scene and named-state carrier behavior is explicit and tested.
- [ ] Wrong owner, non-image, locked/deleted item and conflicting same-ID payload return failure with no document/resource plan.
- [ ] Core transaction dependency is one-way: Media imports Core types; Core imports no Surface/Media implementation.
- [ ] No history push, Store write, V8 double-write, new navigation truth or unrelated media behavior change.
- [ ] Budget and Media lock respected.

## Minimal validation

- `npx vitest run tests/unit/courseImageReplacementPlan.test.ts tests/unit/v9MediaAudioCommands.test.ts`
- `npx tsc --noEmit`
- Three representative `validate:course-project` commands, read-only.
- Manual: inspect one Slide-heavy base-state and one named-state plan; confirm original fixture bytes are unchanged.
- Desktop validation: not applicable until VS-05/VS-06 consume the planner.

## Rollback

- Start point: `pending reviewed VS-02/VS-03 baseline`
- Implementation commit: `pending`
- Old path remains: existing `replaceCourseLayerMedia` stays active and can be restored by reverting this pure planner commit.

## Consumers and index

- Consumer delta: `0 until VS-05 integration`
- Legacy record IDs: `LEG-001 reference only; no deletion`
- indexImpact: `regenerate`

## Result evidence

- Behavior before/after: `pending`
- Validation results: `pending`
- Consumer delta: `pending`
- Remaining risks: `pending`
- Rollback commit: `pending`
- Next allowed task: `VS-05 only after this planner is reviewed/target-green`

## Findings / next allowed task

- Pending. Do not expand the command to video, Flow, Spatial or asset cleanup in this card.

## Ready checklist（Coordinator）

- [ ] dependsOn satisfied
- [ ] context fresh or Bootstrap verified
- [ ] evidence and paths valid
- [ ] write locks available
- [ ] budget/validation/rollback complete
- [ ] no related user dirty change
- [ ] no product escalation triggered
