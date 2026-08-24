# S2 Task Card — ARCH-2 B1-11 Runtime Properties Canonical Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-11-runtime-properties-integration`
- Phase / wave: `ARCH-2 / W2-B1 Runtime authoring integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator + Runtime Properties Workers / independent Runtime reviewers / Coordinator`
- Claimed at / released at: `2026-08-24 11:32 Asia/Shanghai / 2026-08-24 12:11 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `273e2dd`
- Claim commit: `3049064`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2 at 273e2dd; three fresh read-only Properties/UI/raw-action recons`
- Freshness / relevant dirty inputs: `clean tree at claim; Runtime property view/planner, editorStore Runtime-property actions and PropertiesTab/RuntimeContentEditor paths exclusively locked by this card`
- Depends on: `arch-2-b1-09-runtime-source-draft-integration done; arch-2-b1-10-runtime-content-text-integration done`
- Blocks: `Slide Runtime template lifecycle; W2-B1 Runtime authoring validation`
- Risk statement: `Professional Properties reads a lossy V8 RuntimeDocument and writes whole patches through raw update actions. Any API 3 Runtime can be downgraded to canvas-runtime/API 2, enabled is incorrectly coupled to LayerItem.visible, content keystrokes can overwrite unrelated fields and every key can create history.`
- Retry count / last failure class: `0 / none`

## Product outcome

In the existing professional Properties surface, a teacher can inspect the exact canonical Runtime and edit enabled, an API-valid render mode, or one registered content string for the currently visible Slide scene/global Runtime. Each real field commit changes only that canonical field in one current transaction; unchanged, locked, stale, replaced or detached targets remain honest zero-write outcomes. Existing cross-location global visibility remains, while no Flow/Spatial local Runtime inspector or execution capability is invented.

## Current status and evidence

- `eb382f7` adds the canonical inspector view plus exact enabled/renderMode target and pure all-owner planner; `bb35c25` binds the narrow Store transaction and removes both raw Runtime update actions.
- `f90d443` proves the real Store/history/resource/archive/Published vertical slice. `aeefac9` binds Properties and the buffered keyed content editor; `5b0b970` locks the real Electron Properties path.
- `d5109a6` / `9aa8d4f` keep schema-valid legacy content keys visible but read-only when they cannot form a stable B1-10 address. `4119205` protects IME composition and keeps Spatial global Runtime reachable despite retained graph selection.
- `0be7386` removes the obsolete raw-action test ratchets while preserving Developer template setup and Runtime source/content/asset regression intent.
- Independent Core/Store and UI reviews approve with no remaining findings after the legacy-key, Spatial-global and IME fixes.

## Canonical contract and carrier

- Canonical data: one existing `RuntimeLayerItem.runtime` in Course Project V9.
- Stable field addresses: `runtime/enabled`, `runtime/renderMode`, or `runtime/content/values/<JSON-Pointer-escaped-key>` on the exact Runtime `layerItemId`.
- Canonical read model: a thin Properties view over B1-09 `selectRuntimeSourceAuthoringView`; it must not add a third carrier resolver or reuse the `runtime/source` target as another field target.
- Current visual reachability: professional/no-node Slide scene Runtime; global Runtime in the existing global Properties branch from Slide, Flow or Spatial locations. Flow surface Runtime, Spatial world Runtime and Slide surface Runtime remain without a local Properties inspector.
- Planner carrier support: all four canonical owners (`global`, `surface`, `scene`, `world`) for contract reuse and tests without claiming new UI reachability.
- Persisted fields affected: exactly one selected Runtime scalar/content value, document `revision`, and `updatedAt`.
- Schema change allowed: `no`.

## Stable target / editing policy

- The Properties view synchronously captures project/revision/session generation/location/surface/state/owner/item/exact field address plus initial field value from canonical V9.
- Runtime content uses the existing B1-10 content target/planner/Store transaction; no Player host session is fabricated and no whole-content patch is accepted.
- Runtime property scalar targets are discriminated by field/value type: `enabled:boolean` or `renderMode:RuntimeRenderMode`.
- State switching alone does not stale shared Runtime definitions; captured state existence and its effective lock remain authoritative.
- Scope/location/project/revision/generation/owner/item/type/address/initial-value drift rejects with visible feedback and zero document/history/resource/dirty change.
- Same value is a true no-op with no history frame.
- Content inputs buffer locally and commit once on blur/Enter; Escape restores the captured value. A failed commit retains the draft and visible error.
- Effective lock disables every mutable Runtime control. API 3 exposes its real protocol/API and fixed DOM mode; API 2 exposes its three allowed modes.

## Current write path

```text
V8 project.globalRuntime / scene.runtime
→ RuntimeInspector RuntimeDocument patch / whole content copy
→ updateGlobalRuntime / updateSceneRuntime
→ V9 → V8 → V9 conversion
→ forced canvas-runtime/API 2 + LayerItem.visible = runtime.enabled
```

## Replacement path

```text
canonical Properties Runtime view
→ exact field target + local field draft
→ field-specific scalar planner OR existing B1-10 content planner
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one current transaction, or honest no-op/rejection
```

## Scope and locks

### Allowed write

- New `src/renderer/runtime/runtimeInspectorAuthoringView.ts`.
- New `src/renderer/runtime/runtimePropertyAuthoringCommands.ts`.
- `src/renderer/store/editorStore.ts` — one narrow Runtime-property commit action plus removal of the now-unconsumed raw Runtime update actions/helper.
- `src/renderer/ui/PropertiesTab.tsx` — Runtime inspector binding and visible feedback only.
- `src/renderer/ui/RuntimeContentEditor.tsx` — keyed buffered canonical content fields only.
- New focused Runtime property view/planner tests and one mounted Properties vertical slice, or narrowly justified equivalents.
- Targeted existing Runtime/UI tests needed to remove raw-action calls/spies and preserve their original regression intent.
- This task card result fields.

### Required read

- B1-09 canonical Runtime source view/planner/Store transaction and all-carrier tests.
- B1-10 Runtime content target/planner/Store and Workspace race tests.
- Runtime API 2/API 3 schema, archive and Published V2 readers.
- Current global/scene Properties tests, Developer template tests and raw Store Runtime tests.

### Forbidden write

- Course Project Schema/API, Player/Preview/Published hosts or producer behavior.
- DeveloperTab and Runtime template create/remove behavior; `setSceneRuntime`/`setGlobalRuntime` remain for the next card.
- Runtime source/assets, Workspace live-host editing, native/Component authoring or generic LayerItem visibility semantics.
- New Flow/Spatial local Runtime Properties UI, Surface execution support, package/lockfile or fixtures.
- Other task cards and generated repo-index files before close.

## Change budget

- Task timebox: `one S2 user behavior: canonical editing of existing Runtime properties`.
- Main source files: `5`; focused/new tests: `up to 4`; targeted legacy-test cleanup allowed; no moves.
- Public exports: `canonical Properties Runtime view, field-specific property target/planner and one narrow Store action/result type`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `yes, protocol-aware controls, buffering, lock and typed result feedback`.
- Schema/contract changes: `no`.
- Max implementation retries: `2`; max design attempts: `3`.

## Migration steps

1. Lock API 3 downgrade, enabled/visible coupling, whole-content overwrite, per-keystroke history, lock bypass and stale-target failures.
2. Add a thin immutable canonical inspector view that retargets B1-09 source identity to exact property/content fields.
3. Add the discriminated enabled/renderMode target and pure all-owner planner, including API 3 DOM-only validation.
4. Add one narrow Store property action through the current course-authoring identity and existing transaction persistence; reuse B1-10 for content.
5. Bind Properties to canonical values/targets, add buffered content rows and visible typed feedback.
6. Remove `updateSceneRuntime`/`updateGlobalRuntime`, their unique helper if dead, and all source/test references; keep template set-action consumers unchanged.
7. Verify mounted scene/global/API 3 behavior, history/undo/redo, archive/Published preservation and adjacent Runtime paths.
8. Record consumer elimination, close the card and refresh repo-index separately.

## Must preserve

- Runtime `protocol`, `runtimeApiVersion`, `source`, all unrelated content values/metadata, `assets`, `nodeBindings`, `staticFallback` and every LayerItem/scoped field remain exact.
- `LayerItem.visible` and `playbackInitialVisibility` are independent and never changed by Runtime property edits.
- API 2 permits `phaser | dom | hybrid`; API 3 permits only `dom`. Invalid field/value pairs reject before cloning or persistence.
- One real commit advances revision exactly once and creates one current editor transaction with an empty resource delta; no compatibility resource/component snapshot stack grows.
- Content target replacement resets a clean draft; a failed stale/revision/lock commit keeps the user's draft and reports the reason.
- Existing global inspector reachability across locations remains; local Flow/Spatial/Slide-surface inspector reachability is not added or claimed.
- Runtime source, asset replacement, Workspace content editing and Developer template creation remain mounted and unchanged.

## Validation

### V1 focused

- New Runtime inspector view tests: current scene/global plus Flow surface/global and Spatial world/global canonical carriers, effective lock, invalid session/state/missing Runtime, exact API/protocol data and field addresses.
- New Runtime property planner tests: both fields, four owners, API 2/API 3 exact preservation, visibility independence, no-op, lock/state/revision/generation/location/owner/item/address/type/initial-value/value/time/schema failures and immutability.
- `tests/unit/runtimeContentEditor.test.tsx`: buffered blur/Enter, Escape, replacement sync, failed commit retention, lock, metadata/multiline/maxLength.
- Mounted Properties vertical slice: Slide scene/global/API 3 global, one-field transactions, content reuse, undo/redo, stale/lock feedback and no raw action calls.

### V2 Coordinator integration

- B1-09 source and B1-10 content vertical slices.
- Runtime asset replacement race, global Properties, Developer template and archive/Published contract regressions.
- Targeted real Electron Properties smoke if a stable existing fixture or narrow scenario can exercise this path.
- `npm run typecheck`; Electron/e2e typechecks when affected; `git diff --check`; task-board freshness.

## Consumer reduction / legacy gate

- Properties direct `updateSceneRuntime`: `1 → 0`.
- Properties direct `updateGlobalRuntime`: `1 → 0`.
- Properties V8 scene/global Runtime inspector read: `1/1 → 0/0`.
- Raw `updateSceneRuntime` / `updateGlobalRuntime` symbols in `src` and `tests`: `non-zero → 0`.
- Developer `setSceneRuntime` / `setGlobalRuntime` product consumers remain `1/1 → 1/1`; no new consumer may be added.

## Rollback

- Start point: `273e2dd` plus this claim commit.
- New view/planner and Store action have one Properties consumer. Revert canonical UI integration, raw-action removal and targeted tests as one unit; no persisted migration or external resource writes occur.

## Result evidence

- Consumers migrated/remaining: `Properties direct updateSceneRuntime/updateGlobalRuntime 1/1 → 0/0; Properties V8 scene.runtime/project.globalRuntime inspector reads 1/1 → 0/0; raw updateSceneRuntime/updateGlobalRuntime symbols in src+tests → 0. Developer setSceneRuntime/setGlobalRuntime retain exactly one product path each (selector+call) for B1-12 and did not grow.`
- Behavior before/after: `Properties previously copied a lossy V8 RuntimeDocument through whole-patch actions, which could downgrade surface-runtime/API 3 to canvas-runtime/API 2, couple enabled to LayerItem.visible and create history per content keystroke. It now reads an immutable canonical V9 view and submits an exact scalar or content-key target through one current transaction. API 3 remains DOM-only and exact; visibility stays independent; buffered content commits once, preserves dirty/stale drafts and is IME-safe; invalid legacy keys display read-only instead of crashing.`
- Validation results: `Coordinator V1 5 files / 55 tests; V2 7 files / 67 tests; independent Core/Store 7 / 93 and UI 5 / 55; legacy cleanup 4 / 52; real Electron Properties milestone 1/1 passed in 43.6s. npm run typecheck (renderer/Electron/e2e), git diff --check and raw-consumer gates passed.`
- Known risks/findings: `Slide scene/global Runtime template creation still uses legacy RuntimeDocument set actions and is the next card. Existing global Properties reachability is preserved across Slide/Flow/Spatial, but Flow surface, Spatial world and Slide surface Runtime still have no local Properties inspector; API 3 execution reachability is not claimed. Automated outcome remains engineering candidate, not teacher-accepted visual evidence.`
- indexImpact: `Runtime Properties canonical view/planner, Store transaction, UI bindings and raw-action inventory change; refresh generated repo-index after close`.
- Next allowed task: `ARCH-2 B1-12 Slide Runtime template lifecycle integration`.

## Ready checklist (Coordinator)

- [x] dependsOn done/wave-validated
- [x] context fresh and three focused recons complete
- [x] current write path and real visual reachability evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and legacy consumer state clear
- [x] no related user dirty change
- [x] no product escalation triggered
