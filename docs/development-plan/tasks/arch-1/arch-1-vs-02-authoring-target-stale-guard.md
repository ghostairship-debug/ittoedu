# S1 Task Card — ARCH-1 VS-02 AuthoringTarget / Stale Guard

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Task ID: `arch-1-vs-02-authoring-target-stale-guard`
- Phase / wave: `ARCH-1 / first vertical slice`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `pending final ARCH-0B gate baseline`
- Claim commit: `pending`
- Context: `pending ARCH-0B gate; replace with fresh repo:context manifest hash or explicitly approved Bootstrap`
- Freshness / relevant dirty inputs: refresh VS-01 characterization and current Session/scope/effective-layer consumers after ARCH-0B gate; do not inherit current concurrent index worktree
- Depends on: `arch-1-vs-01-image-replacement-characterization (done); ARCH-0A gate (done); ARCH-0B context-safety gate (done or explicitly approved fresh Bootstrap)`
- Blocks: `arch-1-vs-04-slide-image-replacement-command; arch-1-vs-05-image-replacement-app-store-integration`
- Retry count: `0`

## Product outcome

An asynchronous image replacement can carry one immutable target captured before the file dialog and can reject project/location/surface/owner/item/revision drift without writing to the current selection.

## Current fact and evidence

- `src/renderer/authoring/courseAuthoringSession.ts` owns the existing authoring session; its token currently contains only `locationId`, `surfaceType`, `revision`, and `generation`.
- Current freshness checks compare only location and generation. They do not identify project, surface ID, owner, item, or an explicit revision policy.
- `src/renderer/course/effectiveLayerProjection.ts#EffectiveLayerProjectionRow` already exposes project ID, revision, surface, owner key, item ID and stable `authoringAddress`; this evidence should feed the target rather than creating another navigation Store.
- `tests/unit/courseAuthoringSession.test.ts` covers location/generation and composing guards but not project switch, owner switch, item deletion or exact revision conflict.

## Non-goals

- No App/Store integration or file-dialog orchestration.
- No Surface command, asset import, history, save, preview or export change.
- No new `ActiveEditor`, navigation Store, command bus or persisted target field.
- No general merge/rebase policy; the first slice uses exact revision only.

## Scope and locks

### Allowed write

- `src/renderer/authoring/courseAuthoringSession.ts`
- `tests/unit/courseAuthoringTarget.test.ts`
- This task card result fields

### Required read

- `src/shared/contracts/course-project-v9/types.ts` project/location/surface/item identity
- `src/renderer/authoring/courseAuthoringScope.ts`
- `src/renderer/course/effectiveLayerProjection.ts`
- `src/shared/authoringAddress.ts`
- `tests/unit/courseAuthoringSession.test.ts`
- Final VS-01 characterization result

### Forbidden write

- `src/renderer/App.tsx`, `src/renderer/store/editorStore.ts`, `src/renderer/store/history.ts`
- Slide/Flow/Spatial/Media commands, Workspace, Properties, main/preload
- Contracts/Schema, package/lockfile, fixtures, inventories, generated/semantic repo-index
- VS-01 or any other task card

### Do not read unless needed

- Full App/Store/Workspace bodies
- Historical Editor 1.0 tasks and release output

### Hotspot locks（通常 0–1 个）

- `courseAuthoringSession.ts` authoring-identity lock only; no App/Store lock.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `1 product identity file`
- New/moved files: `1 focused test; no moves`
- Public exports: `internal AuthoringTarget factory/guard/result types only`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `none; indexImpact only`
- Target tests / expected validation time: `2 focused files, under 5 minutes`
- Max implementation retries: `2`

## Characterization

- Current successful behavior: location switch increments generation; stale location/generation callbacks are rejected; composing Flow text blocks a location switch.
- Known failure: a callback can carry only current location/generation, so coincident revision numbers in another project and owner/item drift are not identifiable.
- Async/stale/history/save/preview implications: target capture is non-persisted identity only; it must not commit history or become another navigation truth.
- Stable target fields: `projectId`, `documentRevision`, `revisionPolicy: { kind: 'exact' }`, `sessionGeneration`, `surfaceType`, `surfaceId`, `locationId`, optional `stateId`, `owner`, `ownerKey`, `itemId`, and stable `authoringAddress`.
- Validation order: project/session/location/surface/owner identity → item existence/carrier → exact revision. Selection-only change inside the same owner does not invalidate the captured item.

## Implementation outline

1. Add immutable `CourseAuthoringTarget` and stable stale-result codes to the existing Session module.
2. Build a target from the existing Session token plus structural project/scope/item inputs; do not store a document or node reference.
3. Add a Surface-agnostic validator that compares scalar identity and calls an injected item-existence predicate.
4. Keep existing Session/location functions as the sole authoring navigation lifecycle.

## Acceptance

- [ ] Target contains every required project/revision/generation/surface/location/owner/item identity field and exact revision policy.
- [ ] Same-scene selection A→B does not retarget a captured A.
- [ ] Project/location/surface/generation/owner/item/revision mismatches return stable, actionable rejection codes and never run the callback.
- [ ] Core identity imports no Slide/Flow/Spatial selection or Media command.
- [ ] No second Session/navigation truth, persisted field, raw Store dependency or unrelated behavior change.
- [ ] Budget and authoring-identity lock respected.

## Minimal validation

- `npx vitest run tests/unit/courseAuthoringTarget.test.ts tests/unit/courseAuthoringSession.test.ts`
- `npx tsc --noEmit`
- Manual structural inspection: build one target from the Slide-heavy project/effective row and confirm it contains only immutable scalar identity.
- Desktop validation: not applicable; this is a pure identity task and may not claim desktop behavior.

## Rollback

- Start point: `pending final ARCH-0B gate baseline`
- Implementation commit: `pending`
- Old path remains: existing Session freshness functions remain recoverable; revert this additive identity commit without touching user data.

## Consumers and index

- Consumer delta: `0 until VS-04/VS-05 consume the target`
- Legacy record IDs: `LEG-001 reference only; no deletion`
- indexImpact: `regenerate`

## Result evidence

- Behavior before/after: `pending`
- Validation results: `pending`
- Consumer delta: `pending`
- Remaining risks: `pending`
- Rollback commit: `pending`
- Next allowed task: `VS-04 only after VS-02 and VS-03 are reviewed/target-green`

## Findings / next allowed task

- Pending implementation findings. Do not broaden target policy beyond the image-replacement slice in this card.

## Ready checklist（Coordinator）

- [ ] dependsOn satisfied
- [ ] context fresh or Bootstrap verified
- [ ] evidence and paths valid
- [ ] write locks available
- [ ] budget/validation/rollback complete
- [ ] no related user dirty change
- [ ] no product escalation triggered
