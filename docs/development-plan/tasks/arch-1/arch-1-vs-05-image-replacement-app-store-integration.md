# S2 Task Card — ARCH-1 VS-05 Image Replacement App / Store Integration

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID: `arch-1-vs-05-image-replacement-app-store-integration`
- Phase / wave: `ARCH-1 / first vertical slice integration`
- Status: `draft`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending primary integration worktree / codex/architecture-stabilization`
- Baseline HEAD: `pending reviewed VS-02/VS-03/VS-04 integration baseline after ARCH-0B gate`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `pending ARCH-0B gate; require fresh App/Store/History/Media Context Pack`
- Freshness / relevant dirty inputs: all pure-task commits must be reviewed and worktree clean; App, Store and Slide History locks must be free before claim
- Depends on: `arch-1-vs-02-authoring-target-stale-guard (reviewed/target-green); arch-1-vs-03-editor-transaction-resource-delta (reviewed/target-green); arch-1-vs-04-slide-image-replacement-command (reviewed/target-green)`
- Blocks: `arch-1-vs-06-image-replacement-desktop-regression; ARCH-1 vertical-slice gate`
- Risk statement: `This is the only App+Store integrator. A wrong target, resource/history misalignment, sidecar snapshot growth, or V8 double-write can corrupt the active project despite apparently green UI.`
- Retry count / last failure class: `0 / none`

## Product outcome

Clicking “replace image” captures image A before the dialog; dialog completion either atomically updates that exact V9 item and bytes in one history step or returns a visible stale error without changing any project/resource state.

## Current status and evidence

`partial / known wrong-target risk`

- `App.tsx#selectAndImportImage('replace')` awaits `selectImage()` and only then reads `selectSelectedNode(useEditorStore.getState())`.
- `editorStore.replaceImageAsset(nodeId, asset, bytes)` receives no project/revision/generation/surface/location/owner target.
- The V9 branch binds the current media session; it cannot distinguish a coincident revision in another project or current page/owner drift.
- `persistCandidateResult` currently grows full `slideCandidateSidecarPast/Future` snapshots and maps V9 history to dummy revision patches.
- `state.project` is a V8-shaped derived projection. The new path may refresh it only after the canonical V9 commit; it must not mutate it as a second write.
- Existing direct action consumers are limited to App, Store declaration/implementation and one asset-transaction test, so the async consumer can be migrated atomically.

## Canonical contract and carrier

- Contract/type and evidence: Course Project V9 `CourseProjectDocument`; VS-02 `CourseAuthoringTarget`; VS-03 transaction/resource step; VS-04 image-replacement plan.
- Surface-specific carrier: one Slide scene `NativeLayerItem` with `nativeType: 'image'`; optional named-state native-data override follows captured state identity.
- Persisted fields affected: `CourseProjectDocument.assets`, the captured image asset reference/override, and archive sidecar bytes. No new field.
- Schema change allowed: `no`

## Stable target / async policy

- project identity: capture `projectId` before opening the dialog; current project must match at commit.
- revision policy: exact `documentRevision`; any intervening document commit returns `revision-conflict`. No silent merge/rebase/overwrite.
- session generation: captured authoring generation must match current Session generation.
- surface/location/owner: captured Slide surface ID, location ID, optional state ID, owner=`scene`, and ownerKey must match.
- item identity: captured `itemId` plus stable `authoringAddress`; selection may change to B without retargeting A, but A must still exist as the same image carrier.
- stale result/user feedback: stable structured reason becomes a `UserFacingError` telling the teacher to reselect/retry; stale failure changes no document, bytes, dirty flag, selection or history.
- IME/draft/drag behavior: not applicable to the image dialog. Selection-only changes do not commit history; only successful dialog completion creates one step.

## Current write path

```text
App replace click
→ await native image dialog
→ read current selected node
→ Store replaceImageAsset(nodeId, meta, bytes)
→ currentMediaSession / V9 document mutation
→ Slide document snapshot history + full sidecar past/future snapshot
→ derived V8 project + synthetic Store history
```

## Current consumers

### Runtime/Preview/Player/Export

- `currentCourseArchiveData` saves active V9 + sidecar + component files.
- `buildPublishedCourseV2Payload` and HTML/Web consume the active V9 sources read-only; they are validation endpoints, not write participants.

### Build/Fixture/Release

- Slide-heavy representative fixture is the primary integration input.
- Existing E2E normal replacement is a consumer but does not cover deferred target.

### Tests/docs/generated

- `tests/unit/assetTransactions.test.ts` direct replace case.
- `tests/unit/v9MediaTabAdapter.test.tsx` sidecar/archive behavior.
- VS-01 characterization and VS-02–04 focused tests.

### Legacy record IDs

- `LEG-001` derived V8 projection/history debt; no deletion in this task.
- `LEG-003` HTML/Web fallback is not used by the new active-source path.

## Replacement path

```text
App captures immutable target before dialog
→ dialog returns imported meta/bytes
→ target-based Store action validates current canonical state
→ VS-04 pure planner returns one VS-03 transaction plan
→ existing Slide authoring history evolves so the same step carries resource delta
→ Store applies V9 document + bytes + dirty + feedback once
→ V8-shaped state.project is refreshed only as the existing derived projection
```

The App consumer of the nodeId-only async action must be removed. A synchronous compatibility adapter may remain only if an exact consumer still requires it and it routes through the same V9 target path; it may not be used after an `await`. No V8 recipe or `commitAssetTransaction` write is allowed.

## Scope and locks

### Allowed write

- `src/renderer/App.tsx`
- `src/renderer/store/editorStore.ts`
- `src/renderer/course/slideEditorCommands.ts`
- `src/renderer/course/slideAuthoringBackend.ts` only as required to carry the same resource-aware history step
- `tests/integration/imageReplacementVerticalSlice.test.ts`
- The image-replacement case in `tests/unit/assetTransactions.test.ts`
- This task card result fields

### Required read

- Final VS-01 characterization and reviewed VS-02–04 APIs/tests
- `src/renderer/authoring/courseAuthoringSession.ts`
- `src/renderer/course/effectiveLayerProjection.ts`
- `src/renderer/course/v9MediaAudioCommands.ts`
- `src/renderer/store/history.ts`
- `App.tsx#currentCourseArchiveData`, `handleSave`, and replace callback only
- Store `currentMediaSession`, `persistCandidateResult`, `undo`, `redo`, active V9 selectors, and sidecar stacks only
- V9 archive and Published V2 read consumers

### Forbidden write

- Contracts/Schema, package/lockfile, main/preload/IPC
- Workspace, Properties, MediaTab UI, Player/Preview/Published/export implementations
- Flow/Spatial modules
- Representative fixtures, inventories, baselines, generated/semantic repo-index
- VS-01–04 or any other task card
- Any new raw Store hook, global command bus, Store/Session/history root, or V8 write path

### Do not read unless needed

- Unrelated App/Store actions and full Workspace/Properties bodies
- PPTX/PDF paths and release verification
- Historical Editor 1.0 tasks

### Hotspot locks（Coordinator 集成时独占）

- App
- Editor Store
- Slide/Core History integration

All three are held by this task's Coordinator. VS-02/03/04 and every other App/Store/History writer must be stopped during integration.

## Change budget

- Task timebox: `2 Coordinator days`
- Main source files: `4 maximum`
- New/moved files: `1 integration test; no moves`
- Public exports: `target-based internal Store action/result; no raw hook`
- Move/delete: `nodeId-only App consumer may be removed; no broader deletion`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `actionable stale feedback only; no workflow/layout change`
- Schema/contract changes: `no`
- Generated diff: `none; indexImpact only`
- V1 target tests / expected time: `3 focused files, under 12 minutes`
- V2 integration tests / expected time: `typecheck + representative Store integration, under 20 minutes; desktop deferred to VS-06`
- Max implementation retries: `2`
- Max design attempts: `3`

## Migration steps

1. Re-run VS-01 characterization on the integration baseline.
2. Add the target-based Store capture/commit seam without changing App behavior yet.
3. Evolve existing Slide history to carry the VS-03 resource delta in the same logical step; do not add a timeline.
4. Switch the App replace callback to capture before `await` and call the target-based action after dialog completion.
5. Run focused stale/success/undo/redo tests and independent diff review.
6. Integrate App+Store+History atomically; stop at `target-green` pending VS-06 desktop validation.
7. Remove or quarantine the old async nodeId consumer; retain only evidence-backed synchronous compatibility if required.

## Must preserve

- Exactly one active V9 authoring session and one canonical V9 document.
- Cancelled dialog creates no history and no dirty change.
- Same-owner selection-only A→B still commits captured A.
- Successful replace creates exactly one logical history step.
- Document metadata/reference and asset bytes undo/redo together.
- Replacement does not grow full `slideCandidateSidecarPast/Future` snapshots.
- Save-in-flight identity checks continue to include document and resource identity.
- `state.project` remains a derived compatibility projection, never a second write.
- Preview/Player/Export stay read-only.

## Stop conditions

- Any V9 Schema, IPC, persisted format or migration change is required.
- Core/History must import a concrete Surface selection or Media UI.
- A second Store, Session, history or resource timeline is introduced.
- The implementation still writes V9 and V8 independently.
- Replacement still grows full sidecar snapshots or produces more than one history step.
- A raw Store Hook/facade is required.
- A second App/Store/History hotspot writer appears.
- Any representative archive is modified in place or save/reopen shows data loss.
- Same design fails target behavior three times.

## Validation

### V1 Worker target（1–3 个命令 + 最小人工流程）

- `npx vitest run tests/integration/imageReplacementVerticalSlice.test.ts tests/unit/assetTransactions.test.ts tests/unit/courseAuthoringSession.test.ts`
- `npm run typecheck`
- Manual Store flow: capture A, select B in the same scene, resolve replacement, inspect canonical V9 A/bytes/history and verify B unchanged.

### V2 Coordinator integration

- Re-run VS-02–04 focused tests plus `tests/unit/v9MediaTabAdapter.test.tsx`.
- Inspect history before/after/undo/redo: one step, resource delta present, sidecar snapshot depth unchanged.
- Run three representative validators and deterministic fixture check.
- No desktop pass claimed until VS-06; this task cannot become `wave-validated` alone.

### Representative project / performance

- Slide-heavy: target/success/stale/undo/redo Store-level flow on a copy/in-memory archive.
- Flow-heavy and Mixed/Spatial: validators only in this card; VS-06 owns visible regressions.
- Compare focused transaction timing to ARCH-0A thresholds only if the test exposes a repeatable measurement; do not invent a new threshold.

## Legacy/delete gate

- `LEG-001` remains nonzero. The V8 projection and unrelated snapshot paths remain until exact consumer-zero gates.
- The old App nodeId async consumer must be zero before this task is done; broader `replaceImageAsset` compatibility is retained only with an exact synchronous consumer record.

## Rollback

- Start point: `pending reviewed VS-02/VS-03/VS-04 integration baseline`
- Pure implementation commit: `VS-02/03/04 commits; retained if independently green`
- Hotspot integration commit: `pending single VS-05 commit`
- Generated commit: `none`
- Old path remains: old App/Store path remains recoverable until VS-06 passes; rollback the VS-05 integration commit as one unit.
- User data copy/restore note: tests use in-memory or copied fixtures only; never overwrite a user or representative source file.

## Result evidence

- Consumers migrated/remaining: `pending`
- Behavior before/after: `pending`
- Validation results: `pending`
- Known risks/findings: `pending`
- indexImpact: `regenerate`
- Next allowed task: `VS-06 after VS-05 is reviewed and integrated`

## Ready checklist（Coordinator）

- [ ] dependsOn done/wave-validated
- [ ] context fresh or Bootstrap verified
- [ ] current write path and all consumer categories evidenced
- [ ] Allowed/Required/Forbidden paths valid
- [ ] required hotspot locks available
- [ ] budgets and validation named
- [ ] rollback and old path state clear
- [ ] no related user dirty change
- [ ] no product escalation triggered
