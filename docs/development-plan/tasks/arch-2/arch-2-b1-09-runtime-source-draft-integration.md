# S2 Task Card — ARCH-2 B1-09 Runtime Source Draft Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-09-runtime-source-draft-integration`
- Phase / wave: `ARCH-2 / W2-B1 Runtime authoring integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator + Runtime Worker / independent Runtime reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 13:16 Asia/Shanghai / 2026-08-24 13:56 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `223e020`
- Claim commit: `211b404`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime; fresh/high/safe-for-S2; source abcd102b, semantic 2616aecc, config 103c4aa4, tool 0895bc33; three read-only Runtime/Developer/test recons`
- Freshness / relevant dirty inputs: `clean tree at claim; Runtime source planner, Store Runtime draft actions and DeveloperTab Runtime section exclusively locked by Coordinator`
- Depends on: `arch-2-b1-04-runtime-asset-replacement-integration done; W2-A project-resource transaction gate done`
- Blocks: `Runtime template/properties/content consumer migration; W2-B1 Runtime authoring validation`
- Risk statement: `DeveloperTab edits a V8 RuntimeDocument projection: applying even unchanged API 3 source downgrades the canonical definition to canvas-runtime/API 2 and adds history; a dirty draft can silently move to another target with identical source, while Flow/Spatial may report success without a canonical write.`
- Retry count / last failure class: `1 / reviewer-found authoring-context regression fixed in c9b34ac`

## Product outcome

A teacher can edit an existing current-scope Runtime source in DeveloperTab, explicitly apply or cancel the local draft, and receive one canonical V9 transaction or an honest zero-write stale/error result. API 2/API 3 and every untouched Runtime field remain exact; a draft never follows navigation, scope, owner or item replacement.

## Current status and evidence

- `20259e6` locks the old API 3 downgrade, same-source retarget, fake-success, no-op, archive and Published-read failures in a permanent vertical-slice suite.
- `e5da5d7` adds the immutable canonical V9 Runtime source view and pure exact-target planner for global/surface/scene/world owners.
- `3660c6c` persists valid source changes through one typed project-resource transaction and current-Surface history; no-op and every rejection remain zero-write.
- `ec046b5` binds Developer Runtime source drafts to the captured document target with explicit Apply/Cancel, composition guards and honest Flow/Spatial availability.
- `c9b34ac` closes the independent-review finding by preserving the current named state and global scope while the legacy Slide template entry refreshes its authoring session.
- Current Surface Runtime definitions remain valid V9 API 3 records. This card proves authoring/read preservation only and does not claim new API 3 execution support in Player hosts.

## Canonical contract and carrier

- Canonical data: V9 `CourseRuntimeDefinition` on a `RuntimeLayerItem`; never `RuntimeDocument` or the V8 scene/global projection.
- Developer current-scope mapping: global scope -> first global Runtime; Slide local -> first active-scene Runtime; Flow local -> first active-surface Runtime; Spatial local -> first active-world Runtime.
- Stable field address: exact `runtime/source` on the captured Runtime `layerItemId`; host `targetId/hitId` is forbidden.
- Planner accepts all real Runtime LayerItem owners (`global`, `surface`, `scene`, `world`) so Store validation is not tied to one UI projection; Flow blocks are never fabricated as carriers.
- Persisted fields affected: only `runtime.source`, document `revision`, and `updatedAt`.
- Schema change allowed: `no`.

## Stable target / draft policy

- Capture project/revision/session generation/location/surface/owner/ownerKey/item/address when the displayed draft binds to its Runtime, not when Apply is clicked.
- Dirty draft + target/revision change: preserve the text, mark it stale and disable commit until the teacher cancels or returns to the exact target. Do not silently replace or retarget it.
- Clean draft + target change: bind to the new exact Runtime. Cancel explicitly loads the current target value and clears draft feedback.
- Composition disables destructive draft actions; navigation may proceed, but the preserved draft remains stale rather than being committed to the new location.
- Runtime definition is shared across Slide named states. State switching alone does not stale the target, but captured-state existence and effective lock still control the write.
- Location, surface, coarse scope, owner, item, type, revision or session-generation drift rejects with visible feedback and zero document/history/resource/dirty change.

## Current write path

```text
Developer local textarea
→ validate RuntimeDocument projection + JavaScript
→ updateSceneRuntime / updateGlobalRuntime
→ V9 → V8 → V9 conversion (always API 2)
→ Slide-only legacy mutation, or Flow/Spatial fake success
```

## Replacement path

```text
V9 Runtime source view + captured field target
→ local draft (apply / cancel / stale guard)
→ source syntax + module restriction + V9 definition Schema validation
→ pure Runtime source planner
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one current Slide / Flow / Spatial history frame
```

## Scope and locks

### Allowed write

- New `src/renderer/runtime/runtimeSourceAuthoringView.ts`.
- New `src/renderer/runtime/runtimeSourceAuthoringCommands.ts`.
- `src/renderer/store/editorStore.ts` — narrow typed Runtime source action/commit seam only.
- `src/renderer/ui/DeveloperTab.tsx` — Runtime source view/draft/apply/cancel/honest availability only; other Developer sections remain unchanged.
- New `tests/unit/runtimeSourceAuthoringView.test.ts` and `tests/unit/runtimeSourceAuthoringCommands.test.ts`.
- New `tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx`.
- Targeted `tests/unit/developerMode.test.tsx` only where mounted draft behavior changes.
- This task card result fields.

### Required read

- B1-01 carrier/address/effective-lock planner and tests.
- B1-04 Store project-resource transaction, current identity and all-Surface history tests.
- V9 Runtime schema/types, permanent canvas/surface Runtime fixtures, archive and Published V2 producer read endpoints.
- Existing Developer source validation and code-editor tests.

### Forbidden write

- Runtime contracts/Schema/API, Player/Preview/Published hosts or producer behavior.
- PropertiesTab, Workspace Runtime text/asset behavior, Runtime template creation/removal and generic Runtime assets.
- Surface carrier/history implementations, App/save implementation, package/lockfile, fixtures.
- Interaction/Component/Media features, repo-index generated files and other task cards.

## Change budget

- Task timebox: `one S2 vertical slice; split template creation and remaining Runtime properties/content consumers into the next card`.
- Main source files: `4`; new tests: `up to 3`; no moves/deletes.
- Public exports: `typed Runtime source view/target/planner plus two narrow Store result/action types only`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `yes, explicit Cancel/stale/unavailable/error feedback in the existing Runtime section only`.
- Schema/contract changes: `no`.
- Max implementation retries: `2`; max design attempts: `3`.

## Migration steps

1. Lock API 3 downgrade, same-source retarget, no-op and Flow/Spatial fake-success failures in focused tests.
2. Add immutable V9 Runtime source view and exact-field target.
3. Add pure source update planner with full target/lock/schema/no-op validation.
4. Route Store persistence through one existing project-resource transaction/current Surface history.
5. Bind Developer draft to the captured target; add cancel/composition/stale behavior and typed error handling.
6. Verify undo/redo, save/reopen and Published read preservation without claiming API 3 execution.
7. Record consumer reduction, close the card and refresh repo-index separately.

## Must preserve

- `protocol`, `runtimeApiVersion`, `renderMode`, `enabled`, `content`, `assets`, `nodeBindings`, `staticFallback`, LayerItem fields and shared visibility remain byte-for-byte/structurally unchanged except source.
- Existing JavaScript syntax and import/export/require restrictions remain; final definition and full project parse as V9.
- One non-empty apply advances revision exactly once and creates one current Surface history entry; no compatibility snapshot stack grows.
- Same source is a true no-op. Failure/no-op does not dirty, select, navigate, write resources or display success.
- Other DeveloperTab object/rules/component capabilities remain mounted and reachable.
- Flow/Spatial local source editing points only at real surface/world carriers; absence is honest and never becomes a synthetic V8 scene write.

## Validation

### V1 focused

- `npx vitest run tests/unit/runtimeSourceAuthoringView.test.ts tests/unit/runtimeSourceAuthoringCommands.test.ts tests/unit/developerMode.test.tsx`
- API 2/API 3 preservation; all four owners; Flow-block rejection; exact address/type/lock/revision/location/owner/session failures; captured named-state lock; immutability and no-op.
- Mounted same-source and different-source target switches, cancel, composition, syntax/module/schema failure and typed Store failure feedback.

### V2 Coordinator integration

- `npx vitest run tests/integration/courseRuntimeSourceAuthoringVerticalSlice.test.tsx tests/integration/courseRuntimeAssetReplacementVerticalSlice.test.ts tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/courseProjectArchive.test.ts tests/unit/buildPublishedCourseV2.test.ts`
- Parameterized Slide scene/global, Flow surface/global and Spatial world/global; one current history, undo/redo, no compatibility stack growth, archive reopen and Published exact source/protocol/API/other-field read.
- `npm run typecheck`; `git diff --check`; task-board freshness.

## Consumer reduction / legacy gate

- Developer direct `updateSceneRuntime`: `1 → 0`.
- Developer direct `updateGlobalRuntime`: `1 → 0`.
- Developer source apply through V8 Runtime projection/schema: `1 → 0`.
- Developer source apply false-success path: `1 → 0`.
- Keep raw Runtime actions while Properties, Workspace text and template creation still consume them; their consumer count may not rise.

## Rollback

- Start point: `223e020` plus this claim commit.
- New view/planner have no external consumer beyond the narrow Store/Developer slice. Revert source integration and tests as one unit; tests use memory/copied archives only.

## Result evidence

- Consumers migrated/remaining: `Developer Runtime source apply no longer consumes updateSceneRuntime, updateGlobalRuntime or the V8 RuntimeDocument schema. PropertiesTab and the Slide-only Workspace Runtime text path still consume both raw update actions; Developer template creation still consumes setSceneRuntime/setGlobalRuntime. No remaining raw consumer count increased.`
- Behavior before/after: `An apply could downgrade API 3, add history for unchanged source, retarget or discard a dirty draft, and report success without a Flow/Spatial canonical write. Existing global/surface/scene/world Runtime source now binds to one captured V9 runtime/source address, preserves every other definition field, commits exactly one current-Surface history frame, or reports an honest no-op/stale/lock/schema error with zero writes. Template creation still uses its legacy Slide path, but its refresh now preserves named state and global scope.`
- Validation results: `V1 3 files / 52 tests; V2 6 files / 58 tests; adjacent Runtime host/preview/export 7 files / 42 tests; npm run typecheck (root/Electron/e2e), git diff --check and task-board freshness passed. Independent core review passed after c9b34ac with V1 52 tests plus 18-file / 131-test Runtime regression; independent UI review passed 4 files / 59 tests; independent legacy-consumer regression review passed 17 files / 139 tests.`
- Known risks/findings: `Properties Runtime fields, Workspace Runtime text and template create/remove remain legacy consumers and are the next migration boundary. Flow/Spatial have canonical Developer source editing, but Workspace in-place Runtime text targets are currently mounted only for Slide. No new Runtime API 3 execution behavior is claimed.`
- indexImpact: `Developer Runtime source authoring, exact target/planner and typed Store transaction facts changed; refresh generated repo-index after close`.
- Next allowed task: `ARCH-2 B1-10 Runtime property/content consumer migration`.

## Ready checklist (Coordinator)

- [x] dependsOn done/wave-validated
- [x] context fresh or Bootstrap verified
- [x] current write path and consumer categories evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and old path state clear
- [x] no related user dirty change
- [x] no product escalation triggered
