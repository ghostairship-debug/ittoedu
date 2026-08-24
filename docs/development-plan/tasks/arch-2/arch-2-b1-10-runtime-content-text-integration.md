# S2 Task Card — ARCH-2 B1-10 Runtime Content Text Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-10-runtime-content-text-integration`
- Phase / wave: `ARCH-2 / W2-B1 Runtime authoring integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator + Runtime Content Worker / independent Runtime reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 11:00 Asia/Shanghai / 2026-08-24 11:24 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `5b5c16c`
- Claim commit: `2078f9d`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2 at 5b5c16c; two fresh read-only Workspace/Properties/template recons`
- Freshness / relevant dirty inputs: `clean tree at claim; Runtime content planner, narrow Store actions and Workspace Runtime-text callbacks exclusively locked by Coordinator`
- Depends on: `arch-2-b1-09-runtime-source-draft-integration done; arch-2-b1-04-runtime-asset-replacement-integration done`
- Blocks: `Runtime Properties migration; Slide Runtime template creation; W2-B1 Runtime authoring validation`
- Risk statement: `The visible Slide scene/global in-place Runtime text editor binds only to a session-local Player targetId, then writes through the V8 projection. It bypasses canonical lock/revision/item identity, turns same-value commits into history, couples LayerItem.visible to runtime.enabled, and would downgrade any API 3 definition to canvas-runtime/API 2.`
- Retry count / last failure class: `0 / none`

## Product outcome

On the existing unified Slide canvas, a teacher can open a visible scene/global Runtime text target and commit it to the exact canonical V9 Runtime/content key captured when editing began. A real change creates one current Slide transaction; unchanged, locked, stale, replaced or detached targets produce honest zero-write outcomes. Runtime protocol/API, LayerItem visibility and every unrelated field remain exact.

## Current status and evidence

- `8c2001e` adds the immutable exact content-key target and pure V9 planner, including JSON-Pointer field escaping, four owners, captured-state lock, true no-op and API 2/API 3 field preservation.
- `1feaf50` adds narrow Store capture/commit actions and binds Workspace to the two-phase live-host plus canonical-target edit session; the former V8 scene/global text write is removed.
- `5a76981` adds a permanent Store/mounted Workspace vertical slice covering current-Surface transactions, undo/redo, resource/compatibility stacks, stale/lock/delete races, archive/Published reads and host target replacement.
- Real visual reachability remains intentionally limited to Slide scene Runtime and Slide-location global Runtime. Flow, Spatial, Slide surface-layer and API 3 in-place target discovery were neither claimed nor fabricated.
- The existing Runtime asset, Component text and native text paths remain separate and pass adjacent mounted regressions.

## Canonical contract and carrier

- Canonical data: one string value at `RuntimeLayerItem.runtime.content.values[contentKey]` in Course Project V9.
- Stable field address: `runtime/content/values/<JSON-Pointer-escaped-key>` on the exact Runtime `layerItemId`; host `targetId` remains discovery-only and cannot select a persisted item.
- UI capture mapping in this card: Slide global scope -> first projected global Runtime; Slide scene scope -> first projected active-scene Runtime. Capture returns null for every other carrier or unavailable/locked/key-missing target.
- Pure planner accepts real Runtime owners (`global`, `surface`, `scene`, `world`) for reuse and all-Surface contract tests, without claiming a Flow/Spatial visual host.
- Persisted fields affected: only one `runtime.content.values` entry, document `revision`, and `updatedAt`.
- Schema change allowed: `no`.

## Stable target / editing policy

- At editor open, validate the live Runtime text target and immediately capture project/revision/session generation/location/surface/owner/item/exact address plus content key and initial value.
- The active UI edit retains both identities: live Player target session for detach/replacement races and canonical V9 target for persisted ownership/revision/lock.
- State switching alone does not stale Runtime content because the definition is shared across Slide named states; captured-state existence and its effective lock remain authoritative.
- Scope/location/project/revision/generation/owner/item/type/address/key drift rejects with visible feedback and zero document/history/resource/dirty change.
- A missing or effectively locked Runtime cannot open a writable overlay. A target that becomes stale after open cannot commit.
- Same string is a true no-op and must not claim a history write.

## Current write path

```text
Player host targetId/key
→ RuntimeTargetEditSession
→ V8 scene/global RuntimeDocument content copy
→ updateSceneRuntime / updateGlobalRuntime
→ V9 → V8 → V9 conversion + visible/enabled coupling
```

## Replacement path

```text
Player host targetId/key
→ live-target validation + captured V9 runtime/content key target
→ local overlay draft
→ live-target revalidation + exact V9 text planner
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one current Slide history frame, or honest no-op/rejection
```

## Scope and locks

### Allowed write

- New `src/renderer/runtime/runtimeContentTextAuthoringCommands.ts`.
- `src/renderer/store/editorStore.ts` — narrow typed capture/commit actions and result types only.
- `src/renderer/ui/Workspace.tsx` — Runtime text begin/session/commit binding only; Runtime asset and Component/native text paths remain unchanged.
- New `tests/unit/runtimeContentTextAuthoringCommands.test.ts`.
- New `tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx`, or a narrowly justified equivalent mounted Workspace test.
- Targeted existing Runtime target/race test assertions only when required.
- This task card result fields.

### Required read

- B1-01/B1-04 Runtime asset target/planner/Store/Workspace path and race tests.
- B1-09 Runtime source view/planner/Store transaction and all-owner tests.
- Runtime authoring host registry/session tests and the existing unified-canvas E2E.
- V9 schema, archive and Published V2 read endpoints.

### Forbidden write

- Runtime Schema/API, Player/Preview/Published hosts or producer behavior.
- PropertiesTab/RuntimeContentEditor, DeveloperTab, Runtime template creation/removal and raw Store action removal.
- Runtime source/assets, native/Component text editing, generic LayerItem visibility semantics.
- Flow/Spatial Workspace host exposure, surface-runtime execution, package/lockfile or fixtures.
- Other task cards and generated repo-index files before close.

## Change budget

- Task timebox: `one S2 user behavior; split Properties and template lifecycle into later cards`.
- Main source files: `3`; new tests: `up to 2`; no moves/deletes.
- Public exports: `field-specific Runtime content target/planner plus two narrow Store action/result types`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `yes, only accurate Runtime text open/commit/no-op/error feedback`.
- Schema/contract changes: `no`.
- Max implementation retries: `2`; max design attempts: `3`.

## Migration steps

1. Lock V8 downgrade, visible/enabled coupling, same-value fake write, lock bypass and stale-target failures.
2. Add field-address escaping, immutable capture target and pure all-owner Runtime content-text planner.
3. Add narrow Store capture/commit actions using the current canonical document/session and one project-resource transaction.
4. Capture the canonical target when the Workspace overlay opens; retain live and canonical identities until commit/cancel.
5. Replace Workspace raw scene/global Runtime writes with the typed action and discriminated feedback.
6. Verify current Slide history, undo/redo, archive/Published reads and zero compatibility-stack/resource growth.
7. Record consumer reduction, close the card and refresh repo-index separately.

## Must preserve

- Runtime `protocol`, `runtimeApiVersion`, `renderMode`, `enabled`, `source`, all other content values/metadata, `assets`, `nodeBindings`, `staticFallback` and every LayerItem/scoped field remain exact.
- `LayerItem.visible` is independent and never changed by a content-text edit.
- Content keys containing `~` or `/` receive an unambiguous JSON-Pointer-escaped stable address; empty, unsafe, excessive or missing keys reject.
- One non-empty commit advances revision exactly once and creates one current Slide editor-transaction with an empty resource delta; no compatibility resource/component snapshot stack grows.
- Host target cleanup/replacement still closes or rejects the edit before persistence; canonical replacement/stale/lock failures remain zero-write even if an identical live key reappears.
- Runtime asset replacement, Component text and native text interactions remain mounted and unchanged.
- Flow/Spatial/API 3 in-place target reachability is not claimed or fabricated.

## Validation

### V1 focused

- `npx vitest run tests/unit/runtimeContentTextAuthoringCommands.test.ts tests/unit/runtimeTargetEditSession.test.ts tests/integration/runtimeContentTextAuthoringVerticalSlice.test.tsx`
- Field escaping, all four owners, API 2/API 3 exact preservation, visible independence, one-key delta, no-op, lock/state/revision/generation/location/owner/item/address/type/key/time/schema failures and immutability.
- Mounted scene/global capture-before-edit, raw-action zero calls, live target detach/replacement, canonical stale/lock/type rejection and honest feedback.

### V2 Coordinator integration

- `npx vitest run tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/integration/runtimeAssetReplacementRace.test.tsx tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/courseProjectArchive.test.ts tests/unit/buildPublishedCourseV2.test.ts`
- Targeted real-app E2E: `npx playwright test tests/e2e/editor.spec.ts --grep "统一画布：场景/全局运行时文字与图片可原位编辑并往返"`.
- `npm run typecheck`; `git diff --check`; task-board freshness.

## Consumer reduction / legacy gate

- Workspace direct `store.updateSceneRuntime`: `1 → 0`.
- Workspace direct `store.updateGlobalRuntime`: `1 → 0`.
- Workspace Runtime text read from V8 `store.project` at commit: `1 → 0`.
- Keep raw Runtime actions while Properties still consumes them; their remaining consumer count may not rise.
- Store visual capture must remain explicitly Slide scene/global only.

## Rollback

- Start point: `5b5c16c` plus this claim commit.
- New target/planner and Store action have one Workspace consumer. Revert source integration and tests as one unit; tests use memory/copied archives and mocked host messages only.

## Result evidence

- Consumers migrated/remaining: `Workspace direct store.updateSceneRuntime 1 → 0; direct store.updateGlobalRuntime 1 → 0; commit-time V8 scene/global Runtime text read 1 path → 0. Properties retains the only product updateSceneRuntime/updateGlobalRuntime consumers (one selector plus one call each); Developer retains the Slide template set actions. Neither remaining count increased.`
- Behavior before/after: `A visible Runtime target previously persisted by copying the V8 RuntimeDocument, bypassing canonical lock/item/revision identity, adding history for unchanged text, coupling LayerItem.visible to enabled and exposing an API 3 downgrade path. Workspace now opens only after both live-host validation and an exact V9 key target capture, revalidates both identities at commit, and either changes that one string through one current transaction or reports an honest unchanged/stale/locked/replaced result with zero authoritative writes.`
- Validation results: `V1 3 files / 56 tests; V2 6 files / 43 tests; Properties/global adjacent regression 4 files / 21 tests; target Electron E2E 1/1 passed twice. npm run typecheck (root/Electron/e2e), git diff --check and task-board freshness passed. Independent Core/Store, Workspace/UI and regression/scope reviewers all approved; Workspace reviewer additionally passed mounted Runtime/asset/Component races 3 files / 26 tests, session units 2 / 20 and native/Component text regressions 3 / 16.`
- Known risks/findings: `Properties Runtime settings/content and Slide Runtime template creation still use legacy RuntimeDocument actions and are separate follow-up cards. The current visual authoring iframe still exposes only Slide scene/global API 2 Runtime targets; no Flow/Spatial/API 3 in-place editing or execution support is claimed.`
- indexImpact: `Runtime content-text target/planner, Store transaction and Workspace host-binding facts changed; refresh generated repo-index after close`.
- Next allowed task: `ARCH-2 B1-11 Runtime Properties canonical integration`.

## Ready checklist (Coordinator)

- [x] dependsOn done/wave-validated
- [x] context fresh and two focused recons complete
- [x] current write path and real visual reachability evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and legacy consumer state clear
- [x] no related user dirty change
- [x] no product escalation triggered
