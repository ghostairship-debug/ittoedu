# S2 Task Card — ARCH-2 B1-04 Runtime Asset Replacement Store / Workspace Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-04-runtime-asset-replacement-integration`
- Phase / wave: `ARCH-2 / W2-B1 Runtime authoring integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent Runtime reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `2ada909`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2; source abcd102b, semantic 2616aecc, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree; Editor Store and Workspace locks exclusively held by Coordinator`
- Depends on: `B1-01 done; W2-A project-resource transaction gate done`
- Blocks: `Runtime definition/Developer integration; W2-B1 Runtime authoring validation`
- Risk statement: `The current Workspace performs asset import and Runtime binding update as two commits; a late target or failed second write leaves an orphan resource or writes only the V8 projection.`
- Retry count / last failure class: `0 / none`

## Product outcome

Clicking a Runtime image target captures the exact V9 Runtime binding before the file picker and then either replaces binding + AssetMeta + bytes in one current Surface transaction or rejects with no orphan resource and no target retargeting.

## Current behavior

- Workspace captures only session-local Runtime `targetId/scope/sceneId/key`.
- After await it calls `importAsset()` and then `updateSceneRuntime()` / `updateGlobalRuntime()`—two histories and a partial-failure window.
- Flow/Spatial Runtime patch actions fall into the empty V8 compatibility commit.
- The current authoring iframe visually exposes only the projected first Slide scene/global Canvas Runtime; Store-level V9 behavior must support all real carriers without claiming Flow/Spatial visual reachability yet.

## Stable target mapping

- Workspace live-target validation remains discovery-only.
- Store maps `{scope, sceneId, bindingKey}` to the actual effective V9 Runtime row/owner and calls B1-01 capture; it never uses host `targetId/hitId` as `itemId`.
- Scene target resolves the Runtime that the current V8 preview projects; global resolves the first effective global Runtime. Ambiguous/missing rows reject.
- Runtime assets are shared by named states: state switches do not invalidate; captured state only supplies effective lock semantics.
- Completion validates exact project/revision/session generation/location/surface/owner/item/address/binding.

## Replacement path

```text
Workspace validates transient host target
→ Store captures field-specific V9 target before await
→ file picker returns image
→ B1-01 planner
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one Slide / Flow / Spatial history frame
```

## Scope and locks

### Allowed write

- `src/renderer/store/editorStore.ts` Runtime target/actions only
- `src/renderer/ui/Workspace.tsx` Runtime asset callback only
- New Store/Workspace Runtime replacement integration tests
- Targeted `tests/unit/runtimeTargetEditSession.test.ts` only if signature evidence requires it
- This task card result fields

### Required read

- B1-01 target/planner tests
- A-04 project-resource transaction and three Surface undo/redo
- Workspace Runtime target registry/context and current projected Runtime selection
- V9 effective layer projection/address helpers and archive/Published read endpoints

### Forbidden write

- App file selection implementation, DeveloperTab/Properties Runtime definition actions
- Runtime planner/shared contracts/Schema/target-edit session unless explicitly re-scoped
- Surface histories/carriers, Player/Published hosts/producer
- Interaction files, package/lockfile, fixtures, repo-index and other task cards

## Must preserve

- One document/resource commit and one existing history; no V8 double write or new timeline.
- Old asset is not deleted; unrelated Runtime, binding, fallback, protocol/API/renderMode and selection stay unchanged.
- Cancel/no-op/stale/conflict creates no history/dirty/resource write.
- App `onSelectImageAsset` continues to decode only; Store owns the single import/binding transaction.
- Workspace busy token remains UI-only and is always cleared.

## Validation

- Parameterized Store integration for global/surface/Slide/Flow overlay/Spatial surface/world carriers and current Slide/Flow/Spatial history routing.
- One undo/redo restores binding/meta/bytes; full compatibility snapshot depths do not grow; save/reopen and Published V2 read-only preserve binding.
- Workspace deferred image race: target captured before await; location/revision/item deletion rejects with zero write; normal path invokes only `replaceRuntimeAssetAtTarget` once.
- Existing Runtime text/session/authoring tests, B1-01 tests, A-04/A-05 resource regressions, all TypeScript and diff hygiene.

## Consumer reduction

- Workspace Runtime replacement commits: `2 → 1`.
- Replacement callback direct `importAsset`: `1 → 0`.
- Replacement callback direct `updateSceneRuntime` / `updateGlobalRuntime`: `1 / 1 → 0 / 0`.
- Partial-failure orphan-resource path: `1 → 0`.
- Product asset-delta behaviors: `2 → 3`.

## Rollback

- Start point: `2ada909` plus this claim commit.
- Pure B1-01 remains independently green. Revert Store/Workspace integration and its tests as one unit; tests write only memory/copied archives.

## Result evidence

- Pending implementation, independent review and representative validation.
