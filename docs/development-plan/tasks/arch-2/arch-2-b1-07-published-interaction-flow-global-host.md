# S2 Task Card — ARCH-2 B1-07 Published Interaction Flow Global Host

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-07-published-interaction-flow-global-host`
- Phase / wave: `ARCH-2 / W2-B1 Published Interaction host integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator + Flow Player Worker / independent Published Interactions reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 09:25 Asia/Shanghai / 2026-08-24 09:40 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `c3b5796`
- Claim commit: `08ca122`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; fresh/high/safe-for-S2 at B1-06 close; manual Flow host recon by three read-only workers`
- Freshness / relevant dirty inputs: `clean tree at claim; FlowSurfaceHost and FlowPublishedAdapter exclusively locked by Coordinator`
- Depends on: `arch-2-b1-06-published-interaction-session-slide-host done`
- Blocks: `ARCH-2 B1-08 Spatial global Interaction host; W2-B1 Published Interaction validation gate`
- Risk statement: `Flow renders document blocks plus global/surface LayerItem overlays, rerenders the article and overlay for location changes, and currently omits playback-hidden overlay targets. Adding a second controller, binding arbitrary Flow block DOM, or missing the pre-rerender generation boundary would violate the established Published session contract.`
- Retry count / last failure class: `0 / none`

## Product outcome

In current try-run, Preview and packaged Published V2 playback, the one session-global Interaction controller can bind eligible native Flow overlay LayerItems and execute the B1-03 `node.click` slice, including enter/exit motion and whole-course navigation. Flow document blocks remain content, not a new local Interaction carrier.

## Current status and evidence

- `ca2c9ac` adds the Flow renderer-owned DOM port/handle generation and delegates it through the existing adapter/session seam; no controller is created in Flow.
- `a624be6` adds the Schema-valid Mixed Flow integration suite; `f2b13c2` closes the independent review's rejected-update atomicity finding and adds active-motion/destroy evidence.
- Current Flow global/surface overlay wrappers preserve location scope and authored `visible:false`, keep playback-hidden targets mounted/non-hit, share only global visibility state, and reject owned/pass-through clicks while still allowing wrapper motion.
- Automated evidence supports `engineering candidate`; no visual-art or teacher acceptance is claimed.

## Supported slice and explicit limits

- carrier: `PublishedCourseV2Payload.globalInteractions` only; no Flow-local rules/controller;
- stable node targets: rendered Flow global/surface overlay `layerItemId` only;
- trigger/actions: the B1-03/B1-06 supported `node.click`, `node.enter`, `node.exit` and whole-course navigation slice;
- `scene.in` remains false on Flow because the session has no current Slide scene ID;
- Flow blocks, list items, table cells and TOC anchors are not promoted into Interaction V1 targets by this card;
- component, Runtime, video/media and teacher-controller click gestures remain owned; stable wrappers may still execute motion;
- no Schema, producer, authoring UI, Store or payload writeback.

## Canonical contract and carrier

- Contract: `src/shared/contracts/interaction-v1/{types,schema}.ts`, `PublishedInteractionController`, and the B1-06 DOM surface port.
- Global carrier: exactly one `PublishedCourseV2Payload.globalInteractions` controller owned by `PublishedInteractionCourseSession`.
- Stable target: Flow-rendered overlay `PublishedLayerItem.layerItemId`; source is `global` or `surface`.
- Persisted fields affected: `none`; visibility/motion are session-only.
- Schema change allowed: `no`.

## Stable target / async / lifecycle policy

- project/session identity: the B1-06 structured-cloned Published payload and session-global visibility state;
- location identity: the navigator location ID and Flow host location ID must match before controller mount;
- generation boundary: invalidate controller/port before every Flow overlay replacement, refresh renderer-owned handles after render, then signal ready only when active;
- global transient visibility: shared across ordinary Slide/Flow/location generations and reset only on course restart/destroy;
- surface transient visibility: Flow-port-local and reset when the Flow location generation changes;
- stale result: old wrappers, timers, listeners and motions return false/cancel before new DOM becomes eligible;
- destroy order: controller/motion/listener first, then component/controller instances and Flow DOM.

## Current write path

```text
Published V2 global Interaction rules
→ one session-global controller
→ active FlowPublishedAdapter has no PublishedInteractionSurfacePort
→ rules diagnose/skip because no Flow node can bind or move
```

## Replacement path

```text
one session-global controller
→ FlowPublishedAdapter delegates the FlowSurfaceHost-owned DOM port
→ renderer registers current global/surface overlay wrappers by layerItemId
→ stable click delegation / host-owned transient visibility and motion
→ existing session navigation port
```

## Current consumers

### Runtime/Preview/Player/Export

- `mountPublishedCourseTryRun`, whole-course Preview and packaged Published V2 all use `createPublishedCourseSession` and the Flow adapter.

### Build/Fixture/Release

- Published V2 producer already serializes global rules and Flow overlay LayerItems; it remains read-only.

### Tests/docs/generated

- B1-06 integration proves session orchestration on Slide; `flowSurfaceHost.test.ts` characterizes Flow overlays, components, controller and scroll behavior.

## Scope and locks

### Allowed write

- `src/player/surfaces/flow/FlowSurfaceHost.ts` for renderer-owned node handles and lifecycle.
- `src/player/surfaces/publishedDynamicHosts.ts` only for Flow adapter/factory delegation to the existing session.
- New focused `tests/integration/publishedInteractionFlowHostIntegration.test.ts`.
- `tests/unit/flowSurfaceHost.test.ts` only for a minimal renderer/lifecycle regression if integration coverage cannot observe it.
- This task card result fields.

### Required read

- B1-03 controller and B1-06 DOM port/session/Slide implementation.
- Flow host overlay render, component/controller gesture ownership, location queue and existing tests.
- Published V2 global/surface LayerItem carrier and session entry consumers.

### Forbidden write

- Interaction/V9/Published Schema or types, producer/export, Store/UI/authoring.
- Flow block contracts or a Flow-local interaction carrier.
- Spatial host/model/gestures (dependent card).
- Legacy InteractionEngine/PlayerScene or arbitrary document queries.
- Package/lockfile and repo-index/generated files until close.

### Hotspot locks（Coordinator 集成时独占）

- `FlowSurfaceHost.ts`, Flow adapter construction and Published session lifecycle seam.

## Change budget

- Task timebox: `one S2 Flow global vertical slice`.
- Main source files: `2`; no contract changes.
- New/moved files: `one focused integration test; no moves`.
- Public exports: `one narrow Flow host port getter/options seam; no new product workflow API`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `Flow Published playback only`.
- Schema/contract changes: `no`.
- Generated diff: `task board claim/close; repo-index refresh after close only if facts change`.
- V1 target tests / expected time: `focused Flow integration + DOM/controller tests, under 90 seconds`.
- V2 integration tests / expected time: `Flow/Slide Published interaction and Flow regressions + root typecheck, under 3 minutes`.
- Max implementation retries: `2`.
- Max design attempts: `3`.

## Migration steps

1. Claim the card and lock Flow host/adapter paths.
2. Keep playback-hidden scoped overlay nodes mounted while authored `visible:false` remains absent.
3. Let the Flow renderer register current overlay wrappers with source, ownership, click eligibility, visibility state and authored motion endpoint.
4. Expose one active DOM surface port through FlowPublishedAdapter; do not create another controller.
5. Invalidate before location/update/suspend/destroy, reset only Flow-local visibility per location generation, and restore after fresh active render.
6. Verify ordinary navigation preserves session-global visibility, restart resets it, stale work cancels, gestures remain owned and the payload stays immutable.
7. Independently review, close, refresh repo-index, then claim Spatial global host.

## Must preserve

- Exactly one session-global Interaction controller, independent of mounted Surface count.
- Flow document scrolling, TOC, media, component, Runtime and teacher-controller gesture ownership.
- Authored `visible:false`, location scope and host availability stay stronger than transient visibility.
- Click handlers do not prevent default, stop propagation or claim pointer/capture gestures.
- Global state persists across ordinary Slide/Flow generations; Flow surface-local target state does not leak across location generations.
- Existing Flow host standalone use remains valid without supplying interaction options.
- Published playback never writes Store, V9 or its cloned payload.

## Stop conditions

- Any Schema/producer/carrier change, Flow-local controller, second global controller, arbitrary DOM query, block-ID promotion, gesture interception, Store/V9 writeback, Spatial hotspot or dependency change stops/splits this card.

## Validation

### V1 Worker target

- `npx vitest run tests/integration/publishedInteractionFlowHostIntegration.test.ts tests/unit/publishedDomInteractionSurfacePort.test.ts tests/unit/publishedInteractionController.test.ts`
- Inspect mounted hidden native target, click/motion, location rerender and owned-gesture rejection in jsdom.

### V2 Coordinator integration

- `npx vitest run tests/integration/publishedInteractionFlowHostIntegration.test.ts tests/integration/publishedInteractionSlideHostIntegration.test.ts tests/unit/flowSurfaceHost.test.ts tests/unit/publishedCourseNavigation.test.ts`
- `npm run typecheck`; `git diff --check`; task-board freshness.

### Representative behavior

- A Flow global native trigger reveals a playback-hidden global target once; `scene.in` does not match on Flow.
- Global visibility survives Flow location and Slide/Flow navigation, while surface target visibility resets with the Flow generation.
- delayed/active work cancels on location change, suspend, restart and destroy; resumed host binds once.
- component/Runtime/video/controller/pass-through clicks remain unavailable and payload remains unchanged.

## Legacy/delete gate

- Add a Flow consumer to the B1-06 session/port; do not delete legacy InteractionEngine until its separate exact consumer gate reaches zero.

## Rollback

- Start point: `c3b5796` plus the claim commit.
- Flow host and Flow adapter/test integration should remain separable commits where practical.
- Reverting this card returns Flow Published playback to non-executing global rules without user-data migration.

## Result evidence

- Consumers migrated/remaining: `mountPublishedCourseTryRun, whole-course Preview and packaged Published V2 now let the one session-global controller consume active Flow global/surface overlay LayerItems. Spatial global host and scene.enter remain unimplemented; Flow document blocks remain intentionally outside Interaction V1.`
- Behavior before/after: `Flow previously rendered Published global/surface overlays but exposed no interaction surface, so every global click/motion rule skipped. Eligible native Flow overlays now bind once, hidden nodes enter/exit, global state survives ordinary Flow/Slide generations, surface-local state resets per Flow location, and stale work is cancelled before rerender/suspend/restart/destroy without payload writes or gesture theft.`
- Validation results: `Final focused Flow host 2 files / 29 tests; expanded Published Interaction/Flow regression 6 files / 76 tests; npm run typecheck (root/Electron/e2e) and git diff --check passed. Two independent source/lifecycle reviews passed after the rejected-update failure-atomicity fix.`
- Known risks/findings: `Inherited MixedNavigator cross-Surface activation/location failure rollback is not failure-atomic: a rare host activation failure after suspending the old host can leave navigator identity and player activity divergent. This predates B1-07 and should be handled by a separate navigator failure-atomicity card, not inside the Flow host. Spatial global host and scene.enter remain later work.`
- indexImpact: `Flow Published Interaction host facts will change; refresh generated repo-index after close if indexed facts differ`.
- Next allowed task: `ARCH-2 B1-08 Spatial global Interaction host, then W2-B1 validation gate`.

## Ready checklist（Coordinator）

- [x] dependsOn done/wave-validated
- [x] context fresh plus manual host recon
- [x] current write path and all consumer categories evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] required hotspot locks available
- [x] budgets and validation named
- [x] rollback and old path state clear
- [x] no related user dirty change
- [x] no product escalation triggered
