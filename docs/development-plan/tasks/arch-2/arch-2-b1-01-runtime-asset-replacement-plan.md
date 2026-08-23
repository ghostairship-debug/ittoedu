# S2 Task Card — ARCH-2 B1-01 Runtime Asset Replacement Plan

> 本卡是任务状态唯一真相；只有 Coordinator 可 integrate or close it.

## State and assignment

- Task ID: `arch-2-b1-01-runtime-asset-replacement-plan`
- Phase / wave: `ARCH-2 / W2-B1 pure Runtime command`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Runtime Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `shared workspace, new Runtime planner-only scope / codex/architecture-stabilization`
- Baseline HEAD: `1dfb370`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2; source 16556796, semantic 2616aecc, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree; new planner/test paths clean; Store/Workspace/Player locked out`
- Depends on: `ARCH-2 W2-A gate done`
- Blocks: `Runtime asset replacement Store/Workspace integration`
- Risk statement: `A weak host hit identity or separate asset/binding writes can retarget another Runtime or leave orphan bytes after failure.`
- Retry count / last failure class: `0 / none`

## Product outcome

One pure Runtime command plans replacing exactly one captured Runtime asset binding together with any required AssetMeta/bytes as one immutable V9 document/resource transaction, without reading live selection, Store or a session-local hit ID.

## Canonical target and carriers

- Target wraps existing `CourseAuthoringTarget` plus `bindingKey`; `targetId/hitId` never enters the contract.
- Canonical field address is `runtime/assets/<JSON-Pointer-escaped-key>/assetId`.
- Allowed RuntimeLayerItem carriers: global, surface shared, Slide scene and Spatial world. Flow Runtime is surface overlay only; Flow blocks are forbidden.
- Existing protocol/API/renderMode/content/other bindings/fallback stay unchanged.
- Schema change allowed: `no`.

## Stable target / conflict policy

- Validate exact project/revision/session generation/location/surface/state/owner/ownerKey/item/address.
- Reject missing/locked/type-changed Runtime or missing binding.
- Accept only valid image metadata/bytes; same-ID metadata/byte disagreement rejects atomically.
- Handle `added`, `repaired`, `reused`, `unchanged`; do not delete the old asset because other references may remain.
- Non-empty plan advances revision exactly once and emits at most one `AssetFileHistoryChange`.

## Scope and locks

### Allowed write

- New `src/renderer/runtime/courseRuntimeTransactions.ts`
- New `tests/unit/courseRuntimeTransactions.test.ts`
- This task card result fields

### Required read

- `CourseAuthoringTarget` validation and authoring-address helpers
- A-01 Media conflict/immutability donor and A-04 EditorTransaction resource path
- Course V9 Runtime/LayerItem contracts and three Surface carrier resolvers
- Existing Runtime target-edit session only to preserve its transient boundary

### Forbidden write

- Store, Workspace, DeveloperTab, PropertiesTab, Player/Published hosts
- Existing Runtime target-edit session/shared contracts/Schema
- Surface command/history modules, package/lockfile, fixtures
- repo-index semantic/generated and other task cards

## Must preserve

- No Store/Session/timeline ownership in the planner.
- No protocol/API/renderMode conversion and no FlowBlock fabrication.
- Inputs and Buffer/Uint8Array bytes are detached; outputs are frozen values.
- Final document parses as Course Project V9.
- Failure/no-op has no plan and no mutation.

## Validation

- Carrier matrix: global, surface shared, Slide scene, Flow surface overlay, Spatial surface and Spatial world; API 2 and API 3.
- Escaped `/` and `~` binding keys; stale identity matrix; wrong address/owner/item/lock/binding/type.
- add/repair/reuse/no-op/conflict, one-target-only, immutable inputs and exact revision.
- `npx vitest run tests/unit/courseRuntimeTransactions.test.ts tests/unit/editorTransaction.test.ts tests/unit/historyResourceChanges.test.ts`
- `npx tsc --noEmit` and `git diff --check`.

## Rollback

- Pure files have no consumer until the next card and can be reverted independently; no user/persisted file is touched.

## Result evidence

- Pending Worker implementation and independent review.
