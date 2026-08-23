# S1 Task Card — ARCH-1 VS-04 Slide Image Replacement Command

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Task ID: `arch-1-vs-04-slide-image-replacement-command`
- Phase / wave: `ARCH-1 / first vertical slice`
- Status: `target-green`
- Owner / Reviewer / Integrator: `Media / Slide Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, Media/Slide pure-command-only scope / codex/architecture-stabilization`
- Baseline HEAD: `1d7027fa939b46059e7b4053273bf10096fc19f9`
- Claim commit: `745e701b514bb2a34d77dfe09f5c2c1c3adf6c4b`
- Context: `bootstrap-manual approved for the single ARCH-1 pure command after VS-02/VS-03 done; broad gate still closed`
- Freshness / relevant dirty inputs: Media/Slide command paths clean; concurrent repo-index semantic/query tuning is disjoint; App/Store remain locked and untouched
- Depends on: `arch-1-vs-01-image-replacement-characterization (done); arch-1-vs-02-authoring-target-stale-guard (reviewed/target-green); arch-1-vs-03-editor-transaction-resource-delta (reviewed/target-green)`
- Blocks: `arch-1-vs-05-image-replacement-app-store-integration`
- Retry count: `1` (first focused run exposed only a test expectation that treated an omitted `before` field as `before: undefined`; planner behavior was unchanged)

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

- [x] Planner updates only captured image A, never current selection B.
- [x] V9 document revision increases once; metadata/reference and sidecar delta describe one atomic action.
- [x] Base scene and named-state carrier behavior is explicit and tested.
- [x] Wrong owner, non-image, locked/deleted item and conflicting same-ID payload return failure with no document/resource plan.
- [x] Core transaction dependency is one-way: Media imports Core types; Core imports no Surface/Media implementation.
- [x] No history push, Store write, V8 double-write, new navigation truth or unrelated media behavior change.
- [x] Budget and Media lock respected.

## Minimal validation

- `npx vitest run tests/unit/courseImageReplacementPlan.test.ts tests/unit/v9MediaAudioCommands.test.ts`
- `npx tsc --noEmit`
- Three representative `validate:course-project` commands, read-only.
- Manual: inspect one Slide-heavy base-state and one named-state plan; confirm original fixture bytes are unchanged.
- Desktop validation: not applicable until VS-05/VS-06 consume the planner.

## Rollback

- Start point: `1d7027fa939b46059e7b4053273bf10096fc19f9`
- Implementation commit: `pending Coordinator integration; Worker made no Git commit`
- Old path remains: existing `replaceCourseLayerMedia` stays active and can be restored by reverting this pure planner commit.

## Consumers and index

- Consumer delta: `0 until VS-05 integration`
- Legacy record IDs: `LEG-001 reference only; no deletion`
- indexImpact: `regenerate`

## Result evidence

- Behavior before/after: `Before, replaceCourseLayerMedia reads the live Slide session/selection and commits Slide history plus a full sidecar. After, planCourseImageReplacement accepts one captured VS-02 target plus canonical V9 document/sidecar/current identity, validates project/session/location/surface/owner/item/address/exact revision, and emits one VS-03 EditorTransactionPlan without reading live selection or writing Store/history/dirty state. Base writes update only the captured scene image; named-state writes create the existing sparse nativeData assetId override while leaving the base image unchanged.`
- Validation results: `npx vitest run tests/unit/courseImageReplacementPlan.test.ts tests/unit/v9MediaAudioCommands.test.ts — 2 files / 8 tests passed; npx tsc --noEmit — passed; slide-heavy, flow-heavy and mixed-spatial validate:course-project runs all returned status=valid and canExport=true. The focused test applies and inverses the plan through VS-03, restoring the exact source document and sidecar files.`
- Consumer delta: `0; the existing replaceCourseLayerMedia path remains active. VS-05 is the sole allowed App/Store/history consumer migration.`
- Remaining risks: `Same-ID candidates are intentionally reusable only when all AssetMeta fields and bytes are equal; an equal current reference is a no-op, while any metadata or byte difference is asset-conflict and cannot produce a replace delta. New IDs produce an add delta; missing metadata or bytes can be repaired without overwriting an existing different payload. VS-05 must create/apply the VS-03 step atomically and retain the exact stale failure. No desktop or visible product behavior is claimed here.`
- Rollback commit: `revert the eventual additive VS-04 planner commit; the old synchronous path remains untouched and no user/fixture data changed`
- Next allowed task: `VS-05 only after this planner is reviewed/target-green`

## Findings / next allowed task

- The canonical hasItem port requires owner=`scene`, Slide location/surface, exact ownerKey, stable authoringAddress, itemId and an effective native image carrier; locked state is rejected after identity validation. Old assets are deliberately retained. VS-05 may proceed only after Coordinator review; do not expand to video, Flow, Spatial or asset cleanup.

## Ready checklist（Coordinator）

- [x] VS-01/VS-02/VS-03 dependencies satisfied
- [x] manual Bootstrap verified
- [x] evidence and paths valid
- [x] Media/Slide command lock available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
