# S2 Task Card — ARCH-1 VS-03 Editor Transaction / Resource Delta

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID: `arch-1-vs-03-editor-transaction-resource-delta`
- Phase / wave: `ARCH-1 / first vertical slice`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Core History Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, History/editorTransaction-only scope / codex/architecture-stabilization`
- Baseline HEAD: `f5a6cf9`
- Claim commit: `commit containing this wave claim`
- Context Pack + manifest hash | bootstrap-manual: `bootstrap-manual explicitly approved for the single ARCH-1 pure History seam; repo-index broad gate remains closed`
- Freshness / relevant dirty inputs: history.ts and new transaction/test paths clean; VS-02 Session and repo-index query writes are disjoint; no other History writer
- Depends on: `arch-1-vs-01-image-replacement-characterization (done); ARCH-0A gate (done); ARCH-0B context-safety gate (done or explicitly approved fresh Bootstrap)`
- Blocks: `arch-1-vs-04-slide-image-replacement-command; arch-1-vs-05-image-replacement-app-store-integration`
- Risk statement: `History is a product hotspot. A second timeline, mutable byte alias, or misaligned undo delta could corrupt document/resource parity even if tests count one step.`
- Retry count / last failure class: `0 / none`

## Product outcome

One pure transaction plan can describe a Course Project V9 document change and cloned asset add/remove/replace deltas as one logical history step, without creating a second Store or history timeline.

## Current status and evidence

`partial`

- `src/renderer/store/history.ts` already defines `AssetFileHistoryChange`, `ComponentPackageHistoryChange`, `HistoryResourceChanges`, and `HistoryEntry`.
- Asset-delta apply logic is duplicated privately in `editorStore.ts`; it is not a reusable Core History API.
- Active V9 Slide history stores full document snapshots while Store keeps full `slideCandidateSidecarPast/Future` snapshots.
- `v9HistoryToStoreHistory` currently projects V9 history length using dummy revision patches; it does not carry real resource deltas.
- No focused test proves V9 document metadata/reference and sidecar bytes reverse through the same logical step.

## Canonical contract and carrier

- Contract/type and evidence: `CourseProjectDocument` plus existing `HistoryResourceChanges` / `AssetFileHistoryChange` in `src/renderer/store/history.ts`.
- Surface-specific carrier: not applicable; Core receives a pure next document and resource mutations without importing Slide/Flow/Spatial types.
- Persisted fields affected: none in this task; plans contain V9 document values but are not persisted separately.
- Schema change allowed: `no`

## Stable target / async policy

- project identity: transaction plan records the target/base project ID supplied by VS-02/VS-04; it does not derive current selection.
- revision policy: plan records `baseRevision`; integration must require VS-02 exact revision before apply.
- session generation: consumed as validated identity, never stored as history state.
- surface/location/owner: opaque target metadata only; Core must not import Surface selection or carrier resolution.
- item identity: opaque `itemId/authoringAddress` may be returned as selection hint; item validation belongs to the caller port.
- stale result/user feedback: not produced by the delta helper itself; it must preserve the caller's structured stale result and create no plan on failure.
- IME/draft/drag behavior: not applicable; this task represents only a completed user commit, never draft/pointer-move/composition state.

## Current write path

```text
V9 Surface command
→ full CourseProjectDocument snapshot history
→ Store persistCandidateResult
→ full sidecar past/future snapshot
→ synthetic Store HistoryEntry
```

The target path is a pure one-shot plan. It must not push to Store or a timeline in this task.

## Current consumers

### Runtime/Preview/Player/Export

- No direct consumer; later save/publish reads the resulting document/sidecar after VS-05 applies the plan.

### Build/Fixture/Release

- `tests/unit/assetTransactions.test.ts` characterizes resource undo on the legacy Store path.
- ARCH-0 representative fixtures provide deterministic V9 asset bytes.

### Tests/docs/generated

- `tests/unit/editorStore.test.ts` characterizes current V9 snapshot history count/cap.
- `docs/development-plan/20-modules/01_EDITOR_CORE_STATE_TRANSACTION_HISTORY.md` requires reuse of current resource delta.

### Legacy record IDs

- `LEG-001` read-only projection/history debt; no deletion in this task.

## Replacement path

Add one generic, resource-aware transaction-plan/history-step primitive around the existing delta types. VS-05 may adapt the existing Slide authoring history to that primitive. Do not introduce a parallel `transactionHistory`, `binaryHistory`, Store, or Session. Full sidecar snapshots remain the old path until VS-05 proves the replacement slice; no consumer is switched here.

## Scope and locks

### Allowed write

- `src/renderer/store/history.ts`
- `src/renderer/authoring/editorTransaction.ts`
- `tests/unit/editorTransaction.test.ts`
- `tests/unit/historyResourceChanges.test.ts` if a second focused file is necessary
- This task card result fields

### Required read

- `src/renderer/course/slideEditorCommands.ts` current snapshot history
- `src/renderer/project/v9AssetAdapter.ts`
- `src/renderer/store/editorStore.ts` resource apply and synthetic history helpers only
- `tests/unit/assetTransactions.test.ts`
- `tests/unit/editorStore.test.ts` history semantics section
- Final VS-01 expectations and VS-02 target/revision policy

### Forbidden write

- `src/renderer/App.tsx`, EditorState/actions in `editorStore.ts`
- `courseAuthoringSession.ts`, Slide/Flow/Spatial/Media command files
- Workspace/Properties/main/preload/Published/export
- Contracts/Schema, package/lockfile, fixtures, inventories, generated/semantic repo-index
- Other task cards

### Do not read unless needed

- Full Store/App files beyond named history helpers
- Historical V8 tasks and release output

### Hotspot locks（Coordinator 集成时独占）

- Core History lock: `src/renderer/store/history.ts`. No other history migration may run concurrently.

## Change budget

- Task timebox: `1.5 Worker days`
- Main source files: `2 product files`
- New/moved files: `1 Core module + 1–2 focused tests; no moves`
- Public exports: `internal generic transaction-plan/resource-step helpers only`
- Move/delete: `none`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `none; indexImpact only`
- V1 target tests / expected time: `2 focused files, under 8 minutes`
- V2 integration tests / expected time: `deferred to VS-05; typecheck only in this card`
- Max implementation retries: `2`
- Max design attempts: `3`

## Migration steps

1. Characterize current `AssetFileHistoryChange` clone/apply semantics and no-op behavior.
2. Export immutable add/remove/replace planning and forward/reverse apply helpers from Core History.
3. Define a Surface-agnostic `EditorTransactionPlan` containing base revision, next V9 document, existing `HistoryResourceChanges`, selection hint and feedback.
4. Prove one plan/step carries both document and resource evidence without owning a timeline.
5. Run Worker target validation and independent History review.
6. Leave App/Store/Slide integration to VS-05.
7. Record exact index impact; do not reduce compatibility entries yet.

## Must preserve

- Existing `AssetFileHistoryChange` and `ComponentPackageHistoryChange` meaning.
- Byte cloning/immutability for before and after values.
- Add, remove and replace reversibility.
- `MAX_HISTORY_STEPS` semantics for the later consumer.
- No Core dependency on a concrete Surface or selection union.
- No document/sidecar write when a plan is rejected or a mutation is a no-op.

## Stop conditions

- Any V9 Schema or persisted contract change is required.
- Core must import Slide/Flow/Spatial/Media implementation types.
- A second Store/history/resource timeline is introduced.
- Asset bytes can alias caller-owned mutable arrays.
- App/Store becomes a second hotspot in this task.
- Representative fixture bytes or user data are at risk.
- The API only works by exposing a raw Store hook or double-writing V8.

## Validation

### V1 Worker target（1–3 个命令 + 最小人工流程）

- `npx vitest run tests/unit/editorTransaction.test.ts tests/unit/historyResourceChanges.test.ts`
- `npx tsc --noEmit`
- Manual: inspect one Slide-heavy add/replace delta and confirm before/after arrays are cloned and no timeline/Store is created.

### V2 Coordinator integration

- Review the dependency graph for zero Surface imports.
- Re-run relevant existing History/asset characterization tests without changing their assertions.
- No desktop run; no App/UI consumer exists yet.

### Representative project / performance

- Build a plan from the Slide-heavy archive in memory and reverse it to exact document/bytes.
- No performance threshold; record only that the helper is deterministic and bounded.

## Legacy/delete gate

- `LEG-001` remains nonzero. No field, snapshot stack, Store projection or adapter may be deleted here.

## Rollback

- Start point: `pending final ARCH-0B gate baseline`
- Pure implementation commit: `pending`
- Hotspot integration commit: `not applicable in this task`
- Generated commit: `none`
- Old path remains: all current V9 snapshot/sidecar history paths remain untouched and active.
- User data copy/restore note: no user file is opened or modified; rollback is source-only.

## Result evidence

- Consumers migrated/remaining: `pending; expected 0 migrated`
- Behavior before/after: `pending`
- Validation results: `pending`
- Known risks/findings: `pending`
- indexImpact: `regenerate`
- Next allowed task: `VS-04 after VS-02 and VS-03 are reviewed/target-green`

## Ready checklist（Coordinator）

- [x] VS-01 done and Bootstrap exception recorded
- [x] manual Bootstrap verified
- [x] current write path and consumer categories evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] Core History lock available
- [x] budgets and validation named
- [x] rollback and old path state clear
- [x] no related user dirty change
- [x] no product escalation triggered
