# S2 Task Card — ARCH-2 B1-08 Published Interaction Spatial Global Host

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-08-published-interaction-spatial-global-host`
- Phase / wave: `ARCH-2 / W2-B1 Published Interaction host integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator + Spatial Player Worker / independent Published Interactions reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 09:46 Asia/Shanghai / —`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `f3ed789`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; freshly regenerated at f3ed789; manual Spatial renderer/lifecycle/test recon by three read-only workers`
- Freshness / relevant dirty inputs: `clean tree at claim; SpatialSurfaceHost/model and SpatialPublishedAdapter exclusively locked by Coordinator`
- Depends on: `arch-2-b1-07-published-interaction-flow-global-host done`
- Blocks: `W2-B1 Published Interaction validation gate`
- Risk statement: `Spatial mixes SVG world groups, HTML world media, viewport HUD, semantic/off-camera culling and free pan/zoom gestures. Playback-hidden world targets are currently detached by camera visibility, while global HUD and world/surface records have different coordinate and gesture ownership. A generic DOM query, camera-pan interception or second controller would break the Spatial product model.`
- Retry count / last failure class: `0 / none`

## Product outcome

In try-run, Preview and packaged Published V2 playback, the one session-global Interaction controller can bind eligible native Spatial global, surface and world LayerItems and execute the supported click/motion/navigation slice across the host's renderer-owned HTML/SVG records, while native taps coexist with free camera pan/zoom and occupied gestures remain untouched.

## Current status and evidence

- B1-06/B1-07 already own exactly one current global controller and one reusable HTML/SVG-capable DOM port; the Spatial adapter does not expose it.
- `SpatialSurfaceHost` owns a stable `SpatialHostRecord` map keyed by `layerItemId` and renders SVG groups, HTML world video wrappers and viewport wrappers with exact `global | surface | world` source data.
- `collectSpatialPlaybackEntries` includes Schema-valid global/surface/world LayerItems, but world camera visibility treats `playbackInitialVisibility:hidden` as a reason to detach, preventing `node.enter`.
- Spatial camera gestures deliberately allow native tap targets and suppress the click after a real pan; Component/Runtime/media/controller descendants carry explicit gesture-owner markers.

## Supported slice and explicit limits

- carrier: `PublishedCourseV2Payload.globalInteractions` only; no Spatial-local rules/controller;
- stable node targets: current renderer records for global, surface and `surface.world.layerItems` `layerItemId`;
- trigger/actions: B1-03/B1-06 `node.click`, `node.enter`, `node.exit` and whole-course navigation;
- `scene.in` remains false on Spatial because the current session location is not a Slide scene;
- `scene.go` remains the B1-06 strict Slide-scene resolver; Spatial location order is reached by next/previous/replay/restart, not by relabeling camera-frame/location IDs as scene IDs;
- free pan/zoom and semantic/off-camera culling remain session camera behavior, not Interaction state or authoring writes;
- no Schema, producer, Store, authoring UI or payload writeback.

## Canonical contract and carrier

- Contract: Interaction V1 controller/port and Published Course V2 Spatial LayerItems.
- Global carrier: exactly one session-owned `globalInteractions` controller.
- Node source: `global | surface | world`; adding `world` is an internal renderer-source type refinement, not a persisted contract.
- Persisted fields affected: `none`; visibility, motion and camera remain session-only.
- Schema change allowed: `no`.

## Stable target / async / lifecycle policy

- project/session identity: B1-06 structured-cloned Published payload and shared global visibility state;
- location identity: navigator `CourseLocation.id` and Spatial host `locationId`; camera-frame ID is not a scene ID;
- renderer identity: current `SpatialHostRecord` object and wrapper for one `layerItemId`;
- generation boundary: invalidate before Published location/reset/suspend/destroy, refresh handles before record teardown and after reconciliation, then signal ready only when active/current;
- global transient visibility: shared across Slide/Flow/Spatial ordinary generations and reset only on successful course restart/destroy;
- surface/world transient visibility: Spatial-port-local, reset on Published location/replay/reset, preserved across free camera movement and direct suspend/resume;
- hard availability: authored `visible:false`, location scope, semantic zoom/off-camera culling and disabled controller chrome remain stronger than transient visibility;
- stale result: old AbortSignals, record wrappers, listeners and motions cancel before a fresh generation can execute.

## Current write path

```text
Published V2 global Interaction rules
→ one session-global controller
→ active SpatialPublishedAdapter has no PublishedInteractionSurfacePort
→ global Spatial node rules diagnose/skip
```

## Replacement path

```text
one session-global controller
→ SpatialPublishedAdapter delegates SpatialSurfaceHost-owned port
→ current global/surface/world record handles by layerItemId
→ delegated native tap + HTML/SVG motion / transient visibility
→ existing session navigation port
```

## Scope and locks

### Allowed write

- `src/player/interactions/PublishedDomInteractionSurfacePort.ts` only for the internal `world` node-source refinement if required.
- `src/player/surfaces/spatial/SpatialSurfaceHost.ts` for record handles, visibility/camera boundary and lifecycle.
- `src/player/surfaces/spatial/spatialModel.ts` only for separating camera/semantic scope from playback-initial visibility without changing existing callers.
- `src/player/surfaces/publishedDynamicHosts.ts` only for Spatial adapter/factory delegation.
- New focused `tests/integration/publishedInteractionSpatialHostIntegration.test.ts`.
- `tests/unit/spatialSurfaceHost.test.ts` / `tests/unit/spatialModel.test.ts` only for minimal renderer/camera regressions.
- This task card result fields.

### Required read

- B1-06/B1-07 session, DOM port and global visibility policy.
- Spatial host/model/runtime-session/gesture modules and current tests.
- Published V2 producer/schema reference checks proving world LayerItem IDs are legal global rule targets.

### Forbidden write

- Interaction/V9/Published Schema or persisted types, producer/export, Store/UI/authoring.
- Spatial local interaction carrier/controller or camera-frame-as-scene remapping.
- Legacy InteractionEngine/PlayerScene, arbitrary document queries or pointer gesture capture changes.
- Package/lockfile and repo-index/generated files until close.

### Hotspot locks（Coordinator 集成时独占）

- `SpatialSurfaceHost.ts`, Spatial adapter construction and shared DOM port source type.

## Change budget

- Task timebox: `one S2 Spatial global vertical slice`.
- Main source files: `3–4; no persisted contract changes`.
- New/moved files: `one focused integration test; no moves`.
- Public exports: `one narrow Spatial host port getter/options seam and optional internal camera-scope helper`.
- Dependency/lockfile changes: `no`.
- UI copy/behavior changes: `Spatial Published playback only`.
- Schema/contract changes: `no`.
- Generated diff: `task board claim/close; repo-index refresh after close`.
- V1 target tests / expected time: `focused Spatial integration + gesture/DOM/controller tests, under 90 seconds`.
- V2 integration tests / expected time: `Spatial/Flow/Slide Published Interaction regressions + root typecheck, under 3 minutes`.
- Max implementation retries: `2`.
- Max design attempts: `3`.

## Migration steps

1. Claim the card and lock Spatial host/model/adapter paths.
2. Separate camera/semantic availability from playback-initial hidden state so an in-camera hidden wrapper can be revealed while out-of-camera items stay unavailable.
3. Filter authored `visible:false`, register current global/surface/world records with exact source/state/ownership, and preserve HTML/SVG authored endpoints.
4. Expose one active port through SpatialPublishedAdapter; do not create or copy a controller.
5. Invalidate/reset on Published location generations and teardown, but preserve state across camera pan/zoom and direct suspend/resume.
6. Verify native tap versus pan suppression, occupied gestures, camera culling, cross-Surface shared state, navigation cancellation and payload immutability.
7. Independently review, close, refresh repo-index, then run the W2-B1 gate.

## Must preserve

- Exactly one session-global Interaction controller.
- Spatial free pan/zoom, path/camera behavior, semantic/off-camera culling and authored camera data.
- Component, Runtime, video/media and teacher-controller gesture ownership; native interaction handles must not be marked as occupied camera gestures.
- A real pan continues to suppress its synthetic click before the delegated interaction listener; a tap may execute without preventDefault/stopPropagation by the port.
- Global state is session-shared; surface/world state never leaks across Published location generations.
- Existing SVG, HTML world-video, viewport HUD, component and controller rendering remains operational.
- Published playback never writes Store, V9 or its cloned payload.

## Stop conditions

- Any Schema/producer/carrier change, Spatial-local controller, second global controller, arbitrary DOM query, camera/location identity conflation, gesture capture change, Store/V9 writeback or dependency change stops/splits this card.

## Validation

### V1 Worker target

- `npx vitest run tests/integration/publishedInteractionSpatialHostIntegration.test.ts tests/unit/spatialSurfaceHost.test.ts tests/unit/spatialPlaybackGestures.test.ts`
- Inspect HTML/SVG hidden native target, tap-versus-pan, off-camera unavailability and owned gestures in jsdom.

### V2 Coordinator integration

- Spatial focused suite plus Flow/Slide Published Interaction, DOM port/controller and navigation regressions.
- `npm run typecheck`; `git diff --check`; task-board freshness.

### Representative behavior

- Native global HUD or in-camera world trigger enters/exits a playback-hidden global/world target once; world/source-local target resets on camera-location generation.
- Global visibility survives Spatial location and Slide/Flow/Spatial return; location scope and semantic/off-camera availability stay stronger.
- Tap executes, pan suppresses click and changes camera, while Component/Runtime/video/controller/pass-through targets remain unbound.
- delayed/active work cancels on location, cross-Surface, suspend/restart/destroy; resume binds once; payload remains unchanged.

## Legacy/delete gate

- Add the Spatial consumer to the B1-06 session/port; legacy InteractionEngine stays until its separate exact consumer gate reaches zero.

## Rollback

- Start point: `f3ed789` plus the claim commit.
- Host/model and adapter/test integration remain separable commits where practical.
- Reverting this card restores non-executing Spatial global rules without user-data migration.

## Result evidence

- Consumers migrated/remaining: `pending`.
- Behavior before/after: `pending`.
- Validation results: `pending`.
- Known risks/findings: `pending`.
- indexImpact: `Spatial Published Interaction host/record/camera facts will change; refresh repo-index after close`.
- Next allowed task: `W2-B1 Published Interaction validation gate`.

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
