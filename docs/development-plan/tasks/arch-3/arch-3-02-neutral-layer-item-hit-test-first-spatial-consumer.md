# S1 Task Card — Neutral LayerItem Hit Test, First Spatial Consumer

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: `v9SpatialHitAdapter` currently imports six generic LayerItem hit symbols from the Slide-named adapter; if claim-time source already owns those policies in a neutral module while Slide/Spatial are thin Surface wrappers, skip and record current ownership.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: bind focused Spatial/Slide authoring tests and exact import/symbol delta to the product commit; docs/task-board/generated-only changes do not invalidate. Hit modules, focused tests, geometry/hit policy or test/config changes invalidate.
- Invalidating paths: `src/renderer/phaser/layerItemHitTest.ts`; `src/renderer/phaser/v9SlideHitAdapter.ts`; `src/renderer/phaser/v9SpatialHitAdapter.ts`; `src/renderer/authoring/stageViewportTransform.ts`; `tests/unit/spatialWorkspaceAuthoring.test.ts`; `tests/unit/v9SlideViewportAdapter.test.ts`; Vitest/TypeScript resolution config
- Task ID: `arch-3-02-neutral-layer-item-hit-test-first-spatial-consumer`
- Phase / wave: `ARCH-3 / Spatial first consumer`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Spatial Boundary Worker / independent hit-policy reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T18:31:35+08:00 / —`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch3-spatial-neutral-hit / codex/arch3-spatial-neutral-hit`
- Baseline HEAD: `c758873`
- Context: `ARCH_3_ADMISSION_REPORT.md` at `629fd15`; last repo-index is product-fresh and later changes are admission/Flow-claim docs only, with exact hit modules re-read at claim.
- Freshness / relevant dirty inputs: clean root; write set is disjoint from the parallel Flow task
- Depends on: `arch-3-00-surface-admission` done
- Blocks: remaining Spatial-edge re-admission and ARCH-3 phase gate
- Risk statement: neutralization must move only generic LayerItem geometry/hittability; absorbing pointer conversion, viewport/world priority, coordinate space or scope mapping would erase real Surface semantics.
- Retry count / last failure class: `0 / none`

## Product outcome

Spatial hit-testing no longer depends on Slide internals while Slide and Spatial retain identical LayerItem bounds/hittability/rotation/marquee behavior and their own Surface-specific pointer/priority/scope rules.

## Current path and exact target

`v9SpatialHitAdapter` imports four values and two types from `v9SlideHitAdapter`: bounds, target, adapt, point hit, marquee hit and bounds conversion. Spatial then adds coordinateSpace/source and viewport-first ordering. `spatialWorldAuthoring → v9SlideContentEdit` is a separate retained edge.

## Scope and locks

### Allowed write

- new `src/renderer/phaser/layerItemHitTest.ts`
- `src/renderer/phaser/v9SlideHitAdapter.ts`
- `src/renderer/phaser/v9SpatialHitAdapter.ts`
- focused test changes only if current characterization is insufficient: `tests/unit/spatialWorkspaceAuthoring.test.ts`, `tests/unit/v9SlideViewportAdapter.test.ts`

### Required read

- all current source importers of `v9SlideHitAdapter`
- existing Spatial viewport/global priority and native/image/video/Component/Runtime hit tests
- Slide adapter tests and rotation geometry helpers

### Forbidden write

- `src/renderer/authoring/spatialWorldAuthoring.ts`, `src/renderer/authoring/v9SlideContentEdit.ts`, `EditorPhaserBridge.ts`, Workspace/UI/Store/App, commands/history/session, Schema/contracts, other tests, dependencies and generated files

## Required implementation shape

1. Move generic LayerItem bounds, hittability, adapt, reverse-order point hit and marquee hit to `layerItemHitTest.ts` under neutral names.
2. Keep all existing Slide-named exports as zero-logic aliases/re-exports; keep `editorPhaserPointerToWorld` in the Slide adapter.
3. Switch only `v9SpatialHitAdapter` to neutral names/types.
4. Keep coordinateSpace/source enrichment, viewport-first priority and Spatial scope mapping in the Spatial adapter.

## Expected delta

- `v9SpatialHitAdapter` Spatial → Slide edge `1 → 0`;
- audited Spatial-named Slide edges `2 → 1`;
- Spatial imports from Slide hit adapter `6 symbols → 0`;
- Slide wrapper source importers `4 → 3`;
- generic hit implementation copies remain `1`.

## Must preserve

- Native/Component/Runtime eligibility, pass-through and effective visibility
- teacher-controller hittable only in global-equivalent scope
- locked versus writable semantics
- reverse draw-order point hit and rotated AABB marquee behavior
- Slide Phaser pointer conversion and Spatial viewport/world priority/scope/coordinate tags

## Validation

- `npx vitest run tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/v9SlideViewportAdapter.test.ts`
- exact source import/symbol/implementation count and `git diff --check`
- no full suite, E2E, build or TypeScript rerun under V1; combined TypeScript runs at the ARCH-3 gate

## Rollback

- Start point: `c758873` plus this claim commit
- One product/test commit; reverting restores prior file ownership without data or contract migration

## Result evidence

- Product commit and before/after: pending
- Focused validation: pending
- Exact consumer/implementation delta: pending
- Independent review: pending
- Remaining risks/re-admission: pending
- Generated refresh: defer-to-ARCH-3-gate

## Ready checklist（Coordinator）

- [x] admission and six-symbol target exact
- [x] allowed files independent from Flow task
- [x] Surface-specific policy firewall explicit
- [x] no Store/App/contract/dependency escalation
