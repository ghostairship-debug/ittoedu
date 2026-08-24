# S2 Task Card — ARCH-2 B1-12 Runtime Template Lifecycle Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-12-runtime-template-lifecycle-integration`
- Phase / wave: `ARCH-2 / W2-B1 Runtime authoring integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + Runtime Template Workers / independent Runtime reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 12:14 Asia/Shanghai / pending`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `a870631`
- Claim commit: `1b4f0ca`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2 at a870631; focused template/create/delete/consumer reconnaissance`
- Freshness / relevant dirty inputs: `clean tree at claim; Runtime template planner, runtime source creation view, editorStore template action, DeveloperTab and focused lifecycle tests exclusively locked by this card`
- Depends on: `arch-2-b1-09-runtime-source-draft-integration done; arch-2-b1-10-runtime-content-text-integration done; arch-2-b1-11-runtime-properties-integration done`
- Blocks: `W2-B1 Runtime authoring validation`
- Risk statement: `Developer Runtime creation still builds a lossy V8 RuntimeDocument and sends whole-document set actions. It can overwrite an existing canonical Runtime, couples template creation to manual scope activation, and leaves raw V8 conversion helpers as a parallel write path.`
- Retry count / last failure class: `0 / none`

## Product outcome

From the existing Developer surface, a teacher can create the one supported Slide scene or global Runtime template directly into the exact canonical V9 slot captured at click time. A real create produces one current transaction and immediately exposes the existing source/properties authoring path; stale, occupied, detached, non-Slide or invalid targets reject with visible feedback and zero writes. Runtime removal continues through the existing unified layer deletion behavior, including named-state hide semantics, undo and redo; no second Runtime-only removal mechanism is introduced.

## Canonical contract and carrier

- Canonical data: one `RuntimeLayerItem` in a Slide scene or global layer list in Course Project V9.
- Creation address: a slot-specific `CourseRuntimeTemplateCreationTarget`, because the target Runtime item does not exist yet.
- Supported UI reachability: current Slide scene and global scope in DeveloperTab. Flow surface, Spatial world, Slide surface and global creation while located outside Slide remain unsupported and show no create action.
- Canonical removal: existing unified effective-layer delete/hide command; this card must prove it, not fork it.
- Persisted fields affected on create: exactly one new Runtime LayerItem plus document `revision` and `updatedAt`; resource delta remains empty.
- Schema change allowed: `no`.

## Stable creation target

- Capture project/revision policy/session generation/location/surface/state/owner/owner key/scene id and the fixed `runtime-template` slot before dispatch.
- The pure planner re-resolves the current Slide slot, validates exact project/revision/session/location/surface/owner/state identity and rejects when the slot is occupied.
- A state switch alone may remain valid only when the captured state still exists; scene/global owner identity and location stay exact.
- Store supplies the generated LayerItem id and timestamp to the pure planner; conflicts, invalid clocks and invalid schema reject before persistence.
- One real create advances revision once and creates one current transaction. Same/occupied is an explicit zero-write rejection, not an overwrite.

## Canonical template

- Runtime: `canvas-runtime`, Runtime API 2, enabled, Phaser render mode, existing empty Runtime source, empty content/assets.
- Layer item: generated unique id, deterministic next order, scene/global label, `1280 × 720`, visible, unlocked, opacity `1`, rotation `0`, surface hit policy and inherited playback visibility.
- Global item visibility scope: `all`; scene item remains scene-owned.
- No template chooser, asset fixture, external package or API 3 template is added.

## Current write path

```text
Developer freshRuntime()
→ setSceneRuntime / setGlobalRuntime
→ V8 RuntimeDocument conversion and whole-slot replacement
→ manual location/state/scope refresh
```

## Replacement path

```text
canonical Runtime source view creationTarget
→ createRuntimeTemplateAtTarget
→ pure slot planner with Store-supplied id/time
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one canonical V9 create, or typed zero-write rejection
```

## Scope and locks

### Allowed write

- New `src/renderer/runtime/runtimeTemplateAuthoringCommands.ts` and focused unit tests.
- `src/renderer/runtime/runtimeSourceAuthoringView.ts` plus focused creation-target tests.
- `src/renderer/store/editorStore.ts` — one narrow template-create action and deletion of now-dead raw set/conversion helpers.
- `src/renderer/ui/DeveloperTab.tsx` plus focused mounted Developer tests.
- Focused unified deletion lifecycle tests and narrowly necessary Runtime regression tests.
- Existing Electron Runtime milestone only when needed to prove the user path.
- This task card result fields.

### Required read

- B1-09 source view/planner/Store action and B1-11 canonical Properties view.
- Unified Nodes/effective-layer delete, named-state hide and undo/redo behavior.
- Runtime archive/Published projection and existing Developer template tests.
- Runtime LayerItem schema, ownership/order helpers and current transaction persistence.

### Forbidden write

- Course Project Schema/API, Player/Preview/Published implementation or producer semantics.
- PropertiesTab, Workspace content/source/assets, generic deletion semantics or LayerItem visibility semantics.
- Flow/Spatial/Slide-surface Runtime create UI or local Runtime execution support.
- New Runtime-only removal button/planner, template chooser, dependency/lockfile or fixtures.
- Other task cards and generated repo-index files before close.

## Change budget

- Task timebox: `one S2 user behavior: canonical Slide Runtime template lifecycle`.
- Main source files: `4`; focused/new tests: `up to 4`; targeted legacy-test cleanup allowed; no moves.
- Public exports: `template creation target/planner/view projection and one narrow Store action/result type`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `yes, typed create feedback and immediate canonical editor availability`.
- Schema/contract changes: `no`.
- Max implementation retries: `2`; max design attempts: `3`.

## Migration steps

1. Lock raw set-action overwrite, stale target, occupied slot, identity drift and canonical template invariants.
2. Add slot-specific creation target projection to the B1-09 source view for supported Slide scene/global missing-Runtime states.
3. Add the pure creation planner for both owners with exact target validation, unique id/order and canonical fixed template.
4. Add one narrow Store action through the existing course-authoring identity and transaction persistence.
5. Bind Developer create to the canonical target/result and remove manual activation/refresh coupling.
6. Delete `setSceneRuntime`, `setGlobalRuntime`, `freshRuntime` and dead V8-to-V9 write helpers after the final consumer migrates.
7. Prove existing unified scene/global/base/named-state deletion plus undo/redo, and run adjacent source/content/properties/assets/archive/Published regressions.
8. Record consumer elimination, close the card and refresh repo-index separately.

## Must preserve

- Existing Runtime definitions can never be replaced by template creation.
- Every unrelated project, location, surface, scene/state, layer item, resource/component snapshot and external resource remains exact.
- Creation has an empty resource delta; no compatibility resource/component snapshot stack grows.
- The created Runtime is immediately addressable by the B1-09 source editor and B1-11 Properties path without a navigation/scope reset hack.
- Base-state unified delete removes the carrier; named-state delete preserves the base carrier and records the existing hide override; global delete removes the global carrier.
- Undo/redo restores/reapplies create and removal through existing history semantics.
- `courseRuntimeToDocument` remains for the V9→V8 read projection until its real consumers migrate elsewhere.

## Validation

### V1 focused

- Template planner: scene/global exact template, id/order allocation, one-step immutability and every project/revision/session/location/surface/owner/state/slot/id/time/schema rejection.
- Source view: supported missing Slide scene/global creation targets; existing Runtime, non-Slide, invalid state/session and unsupported owner produce no target.
- Mounted Developer: scene/global create, immediate source editor, retained state/scope, typed stale/occupied feedback, non-Slide absence and no legacy set action.
- Lifecycle: unified scene/global/base-state deletion, named-state hide, undo/redo and no Runtime-only removal path.

### V2 Coordinator integration

- B1-09 source, B1-10 content, B1-11 Properties and Runtime asset replacement vertical slices.
- Developer/global layer, archive and Published contract regressions.
- Targeted real Electron template→source→Properties path.
- `npm run typecheck`; Electron/e2e typechecks when affected; `git diff --check`; task-board freshness.

## Consumer reduction / legacy gate

- `setSceneRuntime` symbols in `src` and `tests`: `non-zero → 0`.
- `setGlobalRuntime` symbols in `src` and `tests`: `non-zero → 0`.
- `runtimeDocumentToCourseRuntime`, `makeRuntimeLayerItem`, `writeSceneRuntime`, `writeGlobalRuntime`, `freshRuntime`: `non-zero → 0`.
- `courseRuntimeToDocument`: preserve only real V9→V8 read consumers; do not remove as collateral.
- New Runtime template write path product consumers: exactly `1` in DeveloperTab.

## Rollback

- Start point: `a870631` plus this claim commit.
- New planner/view projection and Store action have one Developer consumer. Revert canonical create binding, raw-action removal and focused tests as one unit; no persisted migration or external resource writes occur.

## Result evidence

- Consumers migrated/remaining: `pending`.
- Behavior before/after: `pending`.
- Validation results: `pending`.
- Known risks/findings: `pending`.
- indexImpact: `Runtime template planner/target, Store transaction, Developer binding and legacy writer inventory change; refresh generated repo-index after close`.
- Next allowed task: `ARCH-2 W2-B1 Runtime authoring validation gate`.

## Ready checklist (Coordinator)

- [x] dependsOn done/wave-validated
- [x] context fresh and focused reconnaissance complete
- [x] current write/remove paths and real visual reachability evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and legacy consumer state clear
- [x] no related user dirty change
- [x] no product escalation triggered
