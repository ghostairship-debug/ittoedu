# S2 Task Card — ARCH-2 B1-05 Interaction Template / Professional Edit Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-05-interaction-template-professional-edit-integration`
- Phase / wave: `ARCH-2 / W2-B1 Interaction authoring integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent Interactions reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 07:24 Asia/Shanghai / active`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `81058f0`
- Claim commit: `pending (this claim change)`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; fresh/high/safe-for-S2; source a10a0576, semantic 2616aecc, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree at claim; Store Interaction actions, AutomationTab and Properties Interaction consumers exclusively locked by Coordinator`
- Depends on: `arch-2-b1-02-interaction-authoring-plan done; ARCH-2 W2-A project-resource transaction gate done`
- Blocks: `Published Interaction host integration; W2-B1 Interaction authoring validation`
- Risk statement: `The visible reveal-sequence template currently changes target visibility and appends its rule through two Store writes, while Flow/Spatial local editors are backed by a synthetic V8 scene with no V9 local Interaction carrier.`
- Retry count / last failure class: `0 / none`

## Product outcome

A teacher can create the existing “enter scene, then reveal in sequence” template and continue professionally editing the same stable Interaction V1 rule; template visibility plus rule creation is one V9 transaction/history step, while Flow/Spatial local authoring is honestly unavailable and the one global carrier remains writable from every Surface.

## Current status and evidence

- `src/renderer/ui/InteractionEditor.tsx` calls `onPrepareMotionTargets` and later `onAddRule` for one template click.
- `src/renderer/ui/AutomationTab.tsx` maps those callbacks to `updateNodes` and `addInteractionRule`, producing two revisions/history entries.
- Flow/Spatial derive a synthetic V8 scene with `interactions: []`; current local Automation/Properties UI can therefore look writable although Course Project V9 has no local Interaction carrier there.
- B1-02 pure typed views and planners are target-green but have zero product consumers.

## Canonical contract and carrier

- Contract/type and evidence: `src/shared/contracts/interaction-v1/{schema,types}.ts`; `src/renderer/interactions/interactionAuthoring{View,Commands}.ts`.
- Surface-specific carrier: local rules only in `SlideSceneDocument.interactions`; global rules only in `CourseProjectDocument.globalInteractions`.
- Persisted fields affected: one Slide scene's effective `LayerItem.playbackInitialVisibility` / active-state override plus `interactions`, or global `globalInteractions` plus global-layer initial visibility.
- Schema change allowed: `no`.

## Stable target / async policy

- project identity: typed authoring view supplies immutable `projectId`.
- revision policy: typed view supplies `baseRevision`; Store plans against the live canonical V9 document and rejects drift.
- session generation: no await occurs in this behavior; active document/location and existing Surface history routing are rechecked synchronously at commit.
- surface/location/owner: local target carries the exact Slide location; global target carries the optional active location only for real Slide scene/state conditions.
- item identity: stable V9 `layerItemId`, stable `ruleId`, and stable action IDs; no session-local hit ID or V8 node projection is a write address.
- stale result/user feedback: stale/invalid/unavailable plans set one visible Store error and write no document/history/resource state.
- IME/draft/drag behavior: not involved; the action is a button/select change outside text composition and drag sessions.

## Current write path

```text
Automation template click
→ updateNodes(targets hidden) / one commit
→ addInteractionRule(rule) / second commit
→ Slide-only command or legacy V8 projection fallback
```

Professional edits call raw local/global Store array actions and merge patches in UI before writing.

## Current consumers

### Runtime/Preview/Player/Export

- Published V2 already serializes local/global Interaction V1 rules; Player host execution is a separate next card.

### Build/Fixture/Release

- Course Project V9 archive save/reopen and Published V2 producer read the same canonical fields.

### Tests/docs/generated

- `tests/unit/interactionEditor.test.tsx` characterizes the split callbacks.
- B1-02 focused tests cover pure view/plan identity, carrier, schema, lock and reference failures.

### Legacy record IDs

- No registered transitional Legacy record; the measurable legacy consumers are the template's two-write UI path and Flow/Spatial synthetic-local rule path.

## Replacement path

```text
typed local/global Interaction view captured by UI
→ one Store Interaction command
→ B1-02 planner
→ createEditorTransactionStep
→ existing persistProjectResourceTransaction
→ one current Slide / Flow / Spatial history frame
```

Existing add/delete/duplicate/move rules remain adapters for behaviors outside this card. The reveal-sequence template and professional update path must not double-write through them.

## Scope and locks

### Allowed write

- `src/renderer/store/editorStore.ts` — narrow Interaction authoring actions/selectors and transaction integration only.
- `src/renderer/ui/AutomationTab.tsx` — typed view, honest unavailable state, template/update callbacks only.
- `src/renderer/ui/InteractionEditor.tsx` — replace the reveal template's split callback with one typed callback.
- `src/renderer/ui/PropertiesTab.tsx` — gate local availability and route professional updates through the same command only if required by the stable-rule behavior.
- `tests/integration/courseInteractionAuthoringVerticalSlice.test.ts` (new).
- `tests/unit/interactionEditor.test.tsx` and at most one new focused Automation/Properties integration test.
- This task card result fields.

### Required read

- Interaction V1 contract/schema; B1-02 view/planner/template and tests.
- Existing Store project-resource transaction plus three Surface history routes.
- AutomationTab, InteractionEditor, Properties Interaction consumers and current UI tests.
- Course Project archive, Published V2 read endpoint, undo/redo tests.

### Forbidden write

- Player/Published controller/host/producer and old `InteractionEngine`.
- Runtime/DeveloperTab, App/save implementation, Surface carrier/history implementations.
- V9/Interaction contracts or Schema, component/media features, package/lockfile, fixtures, repo-index/generated files, other task cards.

### Do not read unless needed

- Archived Editor 1.0 tasks, external component catalog, release/electron packaging and unrelated Surface UI.

### Hotspot locks（Coordinator 集成时独占）

- Editor Store Interaction action signatures and `persistProjectResourceTransaction` call site.
- AutomationTab and Properties Interaction callback wiring.

## Change budget

- Task timebox: `one S2 integration card; split Player host or Developer Runtime work into later cards`.
- Main source files: `3 expected, 4 maximum`.
- New/moved files: `0 source; up to 2 focused tests; no moves`.
- Public exports: `up to 2 Store actions plus typed result/input aliases; no broad Store re-export`.
- Move/delete: `only remove the obsolete split template callback; no file deletion`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `yes, only honest local-unavailable feedback and existing action success/error feedback`.
- Schema/contract changes: `no`.
- Generated diff: `task board only during claim/close; repo-index only in a later Coordinator index commit if semantic/source facts change`.
- V1 target tests / expected time: `Interaction editor + B1-02 suites, under 60 seconds`.
- V2 integration tests / expected time: `new three-Surface vertical slice + root TypeScript, under 3 minutes excluding one final related regression union`.
- Max implementation retries: `2`.
- Max design attempts: `3`.

## Migration steps

1. Lock the current two-callback/history behavior and Flow/Spatial synthetic-local behavior in focused tests.
2. Add narrow Store consumers for B1-02 template and professional-update plans.
3. Route the reveal-sequence UI through one template command and typed target.
4. Route professional edits of that same rule through the update command.
5. Render local Flow/Spatial as unavailable; keep global authoring available.
6. Verify one history, undo/redo, save/reopen, Published read and zero-write failures.
7. Record consumer reduction, close the card, then update semantic/index facts separately.

## Must preserve

- Existing Interaction V1 rule shape, IDs, timing, state/scene conditions and UI workflow.
- One canonical Course Project V9 document and one current Surface history; no V8 double write or second rule format.
- Active named-state visibility writes use the effective override without changing unrelated base/state data.
- Global authoring remains available from Slide, Flow and Spatial; Flow/Spatial local is unavailable, not silently empty.
- No-op, stale, missing, duplicate, locked, invalid-reference or limit failure creates no revision/history/resource write.
- Existing add/delete/duplicate/move/click-rule abilities outside this slice remain reachable.

## Stop conditions

- Any V9 or Interaction contract/Schema change, new carrier, second Store/history, Published writeback, raw V8 projection write, second hotspot beyond allowed UI/Store, or representative archive corruption stops/rolls back this card.

## Validation

### V1 Worker target（1–3 个命令 + 最小人工流程）

- `npx vitest run tests/unit/interactionAuthoringView.test.ts tests/unit/interactionAuthoringCommands.test.ts tests/unit/interactionEditor.test.tsx`
- New focused UI/Store characterization if separated from the vertical slice.
- Inspect one Slide Automation template creation and immediate professional name/enable edit in the mounted UI test.

### V2 Coordinator integration

- `npx vitest run tests/integration/courseInteractionAuthoringVerticalSlice.test.ts` plus the related Interaction/UI regression union.
- `npm run typecheck`; `git diff --check`; task-board freshness.

### Representative project / performance

- Parameterized Slide local/global plus Flow/Spatial global transaction/history; local Flow/Spatial unavailable.
- One undo/redo restores both initial visibility and rule; archive save/reopen and Published V2 preserve the same stable rule ID.
- No dedicated performance run: this replaces two synchronous commits with one and adds no render loop/large scan; ARCH-2 phase gate retains the fixed performance comparison.

## Legacy/delete gate

- Remove only the reveal template's `onPrepareMotionTargets` two-write callback after its new product consumer is green.
- Keep unrelated legacy rule actions until their own behavior cards; their consumer count may not rise.

## Rollback

- Start point: `81058f0` plus the claim commit.
- Pure implementation commit: `8d271b8` remains independently green.
- Hotspot integration commit: `pending`.
- Generated commit: `task-board claim/close only; later repo-index refresh independently revertible`.
- Old path remains: existing generic add/update actions remain for out-of-scope rule behaviors; the split reveal callback can be restored by reverting one integration commit.
- User data copy/restore note: tests operate on memory/copied representative archives; no user archive migration or rewrite.

## Result evidence

- Consumers migrated/remaining: `pending`.
- Behavior before/after: `pending`.
- Validation results: `pending`.
- Known risks/findings: `pending`.
- indexImpact: `expected current-fact update after integration; no Schema impact`.
- Next allowed task: `Published Interaction host integration or Runtime Developer transaction integration after independent review`.

## Ready checklist（Coordinator）

- [x] dependsOn done/wave-validated
- [x] context fresh or Bootstrap verified
- [x] current write path and all consumer categories evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and old path state clear
- [x] no related user dirty change
- [x] no product escalation triggered
