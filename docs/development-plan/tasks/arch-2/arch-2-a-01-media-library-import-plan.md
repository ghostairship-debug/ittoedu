# S2 Task Card — ARCH-2 A-01 Media Library Import Plan

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID: `arch-2-a-01-media-library-import-plan`
- Phase / wave: `ARCH-2 / W2-A pure Media command`
- Status: `done`
- Owner / Reviewer / Integrator: `Media Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, new Media planner-only scope / codex/architecture-stabilization`
- Baseline HEAD: `d6b56a2`
- Claim commit: `1de9d64`
- Context Pack + manifest hash | bootstrap-manual: `feature:media; fresh/high/safe-for-S2; source 35e2be08, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `new planner and test paths clean; Store/App/Surface histories locked out`
- Depends on: `ARCH-1 gate done; A-00 read-only audit complete`
- Blocks: `ARCH-2 Media library import Store integration`
- Risk statement: `A conflict or mutable byte alias can corrupt project metadata/sidecar parity even before Store integration.`
- Retry count / last failure class: `0 / none`

## Product outcome

One project-scoped command plans a whole media-library batch as one immutable Course Project V9 document/resource transaction, independent of the current Surface and without placing anything on a canvas.

## Canonical contract and carrier

- Contract: existing `CourseProjectDocument.assets`, `CourseAssetSidecar.files`, `EditorTransactionPlan` and `AssetFileHistoryChange`.
- Carrier: project media library only; no Slide/Flow/Spatial placement carrier is created or changed.
- Schema change allowed: `no`.

## Stable target / conflict policy

- Input includes exact project ID/base revision and an explicit clock.
- Empty/all-reused batches are zero-write no-ops.
- Same ID with different metadata or bytes is a stable conflict, never overwrite.
- Missing metadata or bytes may be repaired only when the present half exactly agrees with the incoming item.
- A non-empty plan advances revision exactly once, regardless of batch size.

## Scope and locks

### Allowed write

- New `src/renderer/media/courseMediaLibraryImport.ts`
- New `tests/unit/courseMediaLibraryImportPlan.test.ts`
- This task card result fields

### Required read

- `src/renderer/project/v9AssetAdapter.ts`
- `src/renderer/authoring/editorTransaction.ts`
- `src/renderer/store/history.ts`
- `v9MediaAudioCommands.ts#importCourseMediaAssets` for compatibility only

### Forbidden write

- Store/App/UI, existing Surface commands/histories, placement commands
- Contracts/Schema, package/lockfile, fixtures, repo-index/generated/semantic
- Other task cards

## Must preserve

- No Store, Session, timeline, selection or placement dependency.
- Returned metadata/packages/bytes cannot alias mutable caller inputs.
- No persisted hash, migration or carrier unification.

## Validation

- `npx vitest run tests/unit/courseMediaLibraryImportPlan.test.ts tests/unit/historyResourceChanges.test.ts tests/unit/editorTransaction.test.ts`
- `npx tsc --noEmit`
- `git diff --check`

## Rollback

- Pure implementation may be reverted independently; no consumer changes and no user files.

## Result evidence

- Pure implementation commit: `91ee19b`.
- `planCourseMediaLibraryImport` validates exact project/revision/clock, plans any batch as one revision, emits only needed asset-file deltas, supports exact half-repair and returns stable no-op/conflict results without reading a Surface or Store.
- Metadata and bytes are detached; Buffer/subclass bytes use `Uint8Array.from`. Own-key guards and safe record writes cover `toString`/`__proto__` asset IDs without mutating Object prototypes.
- Independent review found and then approved the Buffer-alias fix. Final focused validation passed 3 files / 17 tests, root TypeScript and scoped diff hygiene.
- Consumers migrated: `0` by design. The next allowed task is the unique Media Store/App integration; Core record application must preserve prototype-key safety.
