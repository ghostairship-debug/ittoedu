# S2 Task Card — ARCH-2 A-04 Cross-Surface Media Library Import Integration

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID: `arch-2-a-04-media-library-import-integration`
- Phase / wave: `ARCH-2 / W2-A Media Store integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent Store reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `9642d01`
- Claim commit: `b52c28a`
- Context Pack + manifest hash | bootstrap-manual: `feature:media and feature:editor-core; fresh/high/safe-for-S2; source e3b0993c, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree; App, Editor Store and Core resource-apply locks exclusively held by Coordinator`
- Depends on: `A-00, A-01 and A-02 done`
- Blocks: `ARCH-2 component replacement integration; W2-A resource gate`
- Risk statement: `This is the only App/Store writer. A second commit, late target read, or old snapshot pop can detach metadata from bytes across Flow/Spatial undo.`
- Retry count / last failure class: `0 / none`

## Product outcome

Selecting a batch for the project media library captures the project before the file dialog and then either imports every new metadata/byte pair atomically in one existing Surface history step or rejects the stale/conflicting result without changing any Store-owned state or placing content.

## Current behavior

- Slide batch import is one document commit but grows one full sidecar snapshot.
- Flow loops N `importAsset` calls, producing N revisions/history/snapshots.
- Spatial loops N calls but writes metadata into present without revision/history while growing N resource snapshots; Undo cannot restore parity.
- App explicit image/video library imports capture no project target before the async dialog.
- Core asset delta application uses ordinary property assignment, which is unsafe for valid own-key IDs such as `__proto__`.

## Stable target / conflict policy

- Capture `projectId` and exact document revision before `selectImages` / `selectVideos` for explicit library mode.
- A library import is project-scoped: location/selection may change without retargeting; project or revision drift rejects with zero write.
- Empty/all-reused batches create no dirty/history/snapshot change.
- Same-ID metadata/byte conflict rejects the whole batch.
- Synchronous compatibility calls capture the current target immediately and route through the same action.

## Replacement path

```text
App captures project/revision before dialog
→ A-01 pure planner
→ createEditorTransactionStep
→ current Slide / Flow / Spatial existing history commits one resource frame
→ corresponding persistence adapter applies forward resource delta once
→ undo/redo reads frame transition and never pops a full snapshot for that frame
→ save/publish remain read-only consumers
```

## Scope and locks

### Allowed write

- `src/renderer/App.tsx` only image/video explicit library callbacks
- `src/renderer/store/editorStore.ts` import action, three persistence adapters and undo/redo resource routing
- `src/renderer/store/history.ts` own-key/Buffer-safe resource application only
- New `tests/integration/courseMediaLibraryImportVerticalSlice.test.ts`
- New `tests/integration/mediaLibraryImportRace.test.tsx`
- Targeted updates to `tests/unit/historyResourceChanges.test.ts` and `tests/unit/batchMediaAndInsertion.test.ts`
- Test-data-only byte-length corrections in `tests/unit/mediaTab.test.tsx` and `tests/unit/flowUnifiedLayerEntry.test.tsx`
- This task card result fields

### Required read

- A-01 planner and A-02 Flow/Spatial history APIs/tests
- ARCH-1 Slide transaction persistence donor
- App media dialog/prepare/batch callbacks
- Archive and Published V2 read endpoints
- Three representative fixture sources

### Forbidden write

- Media/Components pure planners, Surface carriers/placement commands, Slide/Flow/Spatial history modules
- Components/App replacement flow, Runtime/Interactions/Global Layers
- Contracts/Schema, main/preload/IPC, package/lockfile, fixtures
- Published producer/Player/export implementation, semantic/generated repo-index
- Other task cards

## Must preserve

- One active V9 document and one existing Surface history; no new timeline or V8 double-write.
- Slide/Flow/Spatial selections and all placement carrier collections remain unchanged.
- Delta frames do not grow full sidecar or package snapshot stacks.
- Legacy bare history still aligns its compatibility snapshots through mixed undo/redo/branch/cap.
- Store derived `project` refreshes only after the canonical V9 commit.
- Core resource maps preserve arbitrary own keys and detached base `Uint8Array` bytes.

## Stop conditions

- Any V9 Schema/persisted format or carrier change is required.
- One batch creates more than one revision/history step.
- Flow/Spatial needs a second Store/Session/history/resource timeline.
- Delta undo/redo still uses `sidecarDirection` or grows a full snapshot.
- Explicit library mode reads project identity only after `await`.
- Save/reopen or Published V2 lacks any committed byte.

## Validation

### Target

- New integration: Slide, Flow and Spatial two-item import, no-op/conflict/stale, one undo/redo, legacy→delta→legacy branch, snapshot depth unchanged.
- `npx vitest run tests/unit/courseMediaLibraryImportPlan.test.ts tests/unit/crossSurfaceResourceHistory.test.ts tests/unit/historyResourceChanges.test.ts tests/unit/batchMediaAndInsertion.test.ts tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts`
- `npx tsc --noEmit` plus Electron/E2E typechecks if App signatures change.

### Representative / delivery

- Load Slide-heavy, Flow-heavy and Mixed/Spatial copies; import without placement, save/reopen exact metadata/bytes, build Published V2 read-only and validate V9.
- Run deterministic fixture check; never overwrite source fixtures.
- Compare focused transaction and phase performance to ARCH-0A thresholds at the W2-A gate.

## Consumer / reduction gate

- Library-only full-snapshot behavior consumers: `3 → 0`.
- Flow N-item commits/revisions: `N → 1`; Spatial `0 effective → 1`.
- Product asset-delta behaviors: `1 → 2`.
- `importAssets` Flow/Spatial item loop consumer: `1 → 0`.
- Structural legacy adapters/fields remain until their total exact consumers reach zero.

## Rollback

- Start point: `9642d01` plus this claim commit.
- Pure A-01/A-02 commits remain if independently green.
- Revert App/Store/Core integration as one unit; tests use in-memory or copied archives only.

## Result evidence

- Hotspot integration commit: `59436aa` (App + Store + Core resource apply + focused tests as one amended atomic commit).
- App captures explicit image/video library targets before the file dialog; stale revision produces actionable feedback and zero project/resource/history writes. Normal two-image App import creates one Slide transaction and no full snapshot.
- Store sync compatibility and target actions now share A-01. Slide, Flow and Spatial each commit a two-item batch as one revision/history frame; one undo/redo removes/restores both metadata and bytes. Selection, topology, session item IDs and all four compatibility resource-stack depths stay unchanged.
- Flow/Spatial resource undo/redo reads A-02 transitions before moving history; legacy stacks are trimmed by bare-entry counts. Course Session revision follows forward commits, history ABA advances generation, and Session/item arrays remain frozen.
- Core byte planning/application now detaches Buffer subclasses and writes own data properties safely; Store forward/inverse/redo proves `__proto__` remains an own key without prototype mutation.
- Consumers reduced: Store/App direct `importCourseMediaAssets` library consumer `1 → 0`; Flow/Spatial per-item import loop `1 → 0`; library-only full-snapshot Surface behavior `3 → 0`; production asset-delta behaviors `1 → 2`.
- Final focused Coordinator run passed 14 files / 148 tests; independent Store review passed 13 files / 137 tests with no blocker. App race 2/2 and representative Store matrix 7/7 include archive reopen and Published V2 read-only evidence. Root/Electron/E2E typechecks, diff hygiene, three representative validators and deterministic fixture hashes passed.
- Two old tests supplied metadata byte lengths that disagreed with their bytes; only test data was corrected, preserving strict invalid-asset rejection. No contract, carrier, fixture archive, Published producer or user file changed.
- Pipeline status: `engineering candidate`. Outcome status: `art candidate unchanged` because the visible UI/workflow is preserved; no teacher/product acceptance or desktop E2E is claimed by this Store integration card. Placement, audio and Runtime resource behaviors remain separate tasks.
