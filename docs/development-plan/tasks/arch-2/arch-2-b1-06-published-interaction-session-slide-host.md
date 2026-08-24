# S2 Task Card — ARCH-2 B1-06 Published Interaction Session / Slide Host Integration

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-06-published-interaction-session-slide-host`
- Phase / wave: `ARCH-2 / W2-B1 Published Interaction host integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + Slide Player Worker / independent Published Interactions reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 08:20 Asia/Shanghai / active`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `2380f8b`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; fresh/high/safe-for-S2; source e9f45f95, semantic 2616aecc, config 103c4aa4, tool 0895bc33; manual Published host recon by three read-only workers`
- Freshness / relevant dirty inputs: `clean tree at claim; Published session/navigation hotspot exclusively locked by Coordinator; Slide host and new DOM port assigned as one implementation track`
- Depends on: `arch-2-b1-03-published-interaction-controller done; arch-2-b1-05-interaction-template-professional-edit-integration done`
- Blocks: `Flow global Interaction host card; Spatial global Interaction host card; W2-B1 Published Interaction validation`
- Risk statement: `Published V2 carries one global rule carrier and Slide-local rule carriers but no current host controller; location IDs differ from Slide scene IDs, full stage renders replace DOM, playback-hidden nodes are omitted, and delayed rules can otherwise outlive a location/surface generation.`
- Retry count / last failure class: `0 / none`

## Product outcome

In current try-run, Preview and packaged Published V2 playback, clicking an eligible native Slide LayerItem executes the B1-03 `node.click` slice from the active scene-local carrier and the one global carrier, including host-owned enter/exit motion and whole-course navigation, without Store/V9 writes or gesture theft.

This card establishes the one-session orchestration and reusable host port used by later Flow and Spatial global consumers. It does **not** claim the B1-05 reveal template's unsupported `scene.enter` trigger.

## Supported slice and explicit limits

- trigger: enabled `node.click` only;
- condition: none or Slide `scene.in`, evaluated against the real `CourseLocation.sceneId`, never the location ID;
- actions: `node.enter`, `node.exit`, `scene.go`, `scene.next`, `scene.previous`, `scene.replay`, `course.restart` through B1-03;
- timing/cancellation: B1-03 delay/group/repeat semantics, with controller teardown before every location/surface/reset generation;
- `scene.go.targetStateId`: validate and execute only if this card materializes the state safely; otherwise return `false` with `navigation-failed` and never silently ignore it;
- Flow/Spatial global click binding: explicitly unavailable until their dependent host cards; do not instantiate duplicate per-Surface global controllers as a shortcut;
- unsupported `scene.enter`, presentation/media/component/runtime triggers and actions remain diagnosed/skipped by B1-03.

## Canonical contract and carrier

- Contract: `src/shared/contracts/interaction-v1/{types,schema}.ts` and `src/player/interactions/PublishedInteractionController.ts`.
- Local carrier: active `PublishedSlideScene.interactions` only.
- Global carrier: `PublishedCourseV2Payload.globalInteractions`, owned once per Published course session.
- Stable node target: Published `layerItemId`; no DOM index, hitId, Store selection or V8 SceneNode projection.
- Schema change allowed: `no`.

## Stable target / async / lifecycle policy

- project/session identity: one structured-cloned Published V2 payload per `PublishedCourseSession`;
- navigation identity: navigator owns location state; Slide `scene.in` and `scene.go` resolve through real slide-scene locations;
- generation boundary: before navigation/reset/replay, destroy current local/global controllers and abort their timers/motions; after host location render, create exactly one current global controller and at most one active Slide-local controller;
- global transient visibility: session-owned and independent from authoring data; ordinary location changes preserve it, course restart/destroy reset it;
- local transient visibility: active Slide scene generation only; replay/location leave resets to authored initial visibility;
- stale result: old AbortSignals, old DOM wrappers and inactive ports return false and never mutate the fresh host generation;
- destroy order: controllers/animations/listeners first, then component/controller instances, host DOM and Player.

## Current write path

```text
Published V2 payload with local/global Interaction V1 rules
→ createPublishedCourseSession / Surface hosts
→ no PublishedInteractionController consumer
→ native nodes use pointer-events:none; playback-hidden nodes are absent
```

## Replacement path

```text
PublishedCourseSession navigation generation
→ one session-owned global controller + optional Slide-local controller
→ active Slide-owned PublishedInteractionSurfacePort
→ stable layerItemId click delegation / host-owned transient DOM motion
→ navigator session port (sceneId↔locationId mapping)
→ no Store, V9 document or Published payload writeback
```

## Current consumers

### Runtime/Preview/Player/Export

- `mountPublishedCourseTryRun` and whole-course Preview build Published V2 then call `createPublishedCourseSession`.
- Packaged Published V2 Player uses the same session factory.
- Presenter teardown calls `session.destroy()`.

### Build/Fixture/Release

- Published V2 producer already serializes the same local/global rules and node IDs; producer/Schema remain read-only.

### Tests/docs/generated

- B1-03 controller unit suite proves pure orchestration only.
- Published navigation and Slide host suites characterize current mount/order/cleanup but have no real Interaction host consumer.

## Scope and locks

### Allowed write

- `src/player/interactions/PublishedDomInteractionSurfacePort.ts` (new, narrow reusable DOM port/session visibility helper).
- `src/player/surfaces/slide/SlidePublishedAdapter.ts` (Slide node registry, effective hidden rendering, port ownership only).
- `src/player/surfaces/publishedDynamicHosts.ts` (single-writer session/controller/navigation integration).
- `src/player/surfaces/mixed/MixedCourseNavigator.ts` only if the proven pre-navigation cancellation seam cannot remain session-local.
- New focused `tests/unit/publishedDomInteractionSurfacePort.test.ts` and `tests/integration/publishedInteractionSlideHostIntegration.test.ts`.
- Existing `tests/unit/publishedCourseNavigation.test.ts` / Slide adapter test only for a minimal regression assertion if needed.
- This task card result fields.

### Required read

- B1-03 controller/port and focused tests.
- Published V2 contract/producer read endpoint.
- CoursePlayer, MixedCourseNavigator and all Published session entry/teardown consumers.
- Slide Published adapter, presentation-state carrier and current component/controller gesture ownership.

### Forbidden write

- Renderer/Store/UI, V9/Published/Interaction contracts or Schema, producer/export code.
- FlowSurfaceHost, SpatialSurfaceHost/model/gestures (dependent cards).
- Legacy `InteractionEngine`, `PlayerScene`, Phaser `NodeMotionDirector` or V8 projection.
- App/Workspace, package/lockfile, fixtures, repo-index/generated files until close.

### Hotspot locks（Coordinator 集成时独占）

- `publishedDynamicHosts.ts`, Published session lifecycle and any MixedCourseNavigator callback seam.
- Slide adapter interaction lifecycle during this card.

## Change budget

- Task timebox: `one S2 Slide vertical slice; Flow and Spatial are dependent cards`.
- Main source files: `3; optional fourth only for a pre-navigation hook`.
- New/moved files: `one source helper; up to two focused tests; no moves`.
- Public exports: `one internal Published host/DOM port seam; no new product API`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `none outside Published playback`.
- Schema/contract changes: `no`.
- Generated diff: `task board claim/close only; repo-index refresh after close if current facts change`.
- V1 target tests / expected time: `DOM port + B1-03 controller, under 60 seconds`.
- V2 integration tests / expected time: `Slide host/navigation vertical slice + root TypeScript, under 3 minutes`.
- Max implementation retries: `2`.
- Max design attempts: `3`.

## Migration steps

1. Claim the card and lock Published session/Slide paths.
2. Add the reusable host-owned DOM port with stable-root click delegation, gesture eligibility, initial hidden state, abort-aware motion and explicit teardown.
3. Keep authored `visible:false` absent; keep playback-hidden effective Slide nodes mounted but non-hit until `node.enter`.
4. Add one session coordinator that owns exactly one current global controller plus one current Slide-local controller.
5. Map `scene.in`/`scene.go` through Slide scene IDs and all other navigation through current Published location order.
6. Teardown before navigation/reset/suspend/destroy, rebuild after the fresh host generation, and preserve only global session visibility across ordinary locations.
7. Verify try-run/Preview/export-factory reachability, cancellation, gestures, diagnostics and zero authoring writes.
8. Independently review, close, refresh repo-index, then claim Flow and Spatial host consumers.

## Must preserve

- One global Interaction V1 carrier and separate scene-local carrier/controller; equal local/global rule IDs cannot cancel one another.
- Components, Runtime, video/media and teacher-controller gestures win; `pass-through`/surface-owned hit policies are not promoted to click targets.
- Click handlers do not prevent default, stop propagation or claim capture gestures.
- Authored visibility, location scope and presentation state remain stronger than transient interaction visibility.
- Existing Slide component/controller/media rendering and teacher navigation remain operational.
- Navigation order remains Published location order; Flow block/camera IDs are not mislabeled as Slide scene IDs.
- Diagnostics are observational and route through existing `SurfacePlayerServices.reportDiagnostic`.
- Published playback never writes Store, Course Project V9 or its cloned payload.

## Stop conditions

- Any Schema/contract/producer change, Store/V9 writeback, second global carrier/controller per mounted Surface, arbitrary document query, gesture interception, silent target-state ignore, legacy engine reuse or required Flow/Spatial hotspot stops/splits this card.

## Validation

### V1 Worker target

- `npx vitest run tests/unit/publishedDomInteractionSurfacePort.test.ts tests/unit/publishedInteractionController.test.ts`
- Inspect mounted hidden/native click/motion and owned-gesture rejection in jsdom.

### V2 Coordinator integration

- `npx vitest run tests/integration/publishedInteractionSlideHostIntegration.test.ts tests/unit/publishedCourseNavigation.test.ts`
- Related Slide/component/controller regressions.
- `npm run typecheck`; `git diff --check`; task-board freshness.

### Representative behavior

- Payload where `location.id !== scene.id`: local and global rules both fire once; `scene.in` uses scene ID; `scene.go(sceneId)` lands at the mapped location.
- Initially hidden target mounts non-hit, enters/exits, and replay restores local authored state.
- Same-Slide location change, cross-Surface navigation, replay, restart, suspend and destroy cancel delayed/active stale work.
- Owned Component/Runtime/video/controller and pass-through targets remain unbound; diagnostics use phase `execute`.

## Legacy/delete gate

- Add the first real B1-03 consumer; do not delete legacy `InteractionEngine` until its separate exact consumer gate reaches zero.
- No consumer may import the legacy engine or copy its V8 node model.

## Rollback

- Start point: `2380f8b` plus the claim commit.
- DOM port, Slide host and Published session integration remain separable commits where practical.
- Reverting this card returns Published V2 to its current non-executing rule behavior without rewriting user data.

## Result evidence

- Consumers migrated/remaining: `pending`.
- Behavior before/after: `pending`.
- Validation results: `pending`.
- Known risks/findings: `Flow/Spatial global click hosts and scene.enter template playback intentionally remain later cards; targetStateId must be supported or diagnosed honestly.`
- indexImpact: `expected: Published Interaction current consumer/lifecycle facts change; refresh after close`.
- Next allowed task: `Flow global Interaction host, then Spatial global Interaction host, then W2-B1 validation gate`.

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
