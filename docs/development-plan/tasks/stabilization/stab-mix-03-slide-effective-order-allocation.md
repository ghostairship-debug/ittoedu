# S1 Task Card — Mixed Slide Effective Order Allocation

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: The Wave A browser gate reproducibly creates a Slide scene item after two Spatial world insertions and saves duplicate effective `order` values; skip only if the same sequence already yields course-wide unique orders under the unchanged strict V9 Schema.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the focused command result to the product commit; docs/task-board/generated-only changes reuse it unless a listed allocator/append/test path changes. The Wave A browser gate reruns once after this card closes.
- Invalidating paths: `src/renderer/course/v9SlideContentCommands.ts`; `src/renderer/course/globalLayerCommands.ts#allocateCourseLayerOrder`; `tests/unit/v9SlideContentCommands.test.ts`; `tests/unit/effectiveLayerCommands.test.ts`; `tests/e2e/stabilizationCoreUsability.spec.ts`
- Task ID: `stab-mix-03-slide-effective-order-allocation`
- Phase / wave: `post-audit stabilization / A-core repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Mixed Order Worker / Unified Order Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace; Slide content allocator lock / codex/architecture-stabilization`
- Baseline HEAD: `1c54d46` (Wave A dependency candidate; product bytes end at `fcb09b1`)
- Context: manual Bootstrap followed the failing browser sequence through `addRectangleNode` into `appendSceneLayer` / `nextSceneLayerOrder`, compared it with `allocateCourseLayerOrder`, and confirmed that the Slide allocator sees only global/current-surface/current-scene orders while Spatial world orders share the same persisted effective namespace.
- Freshness / relevant dirty inputs: the product paths and focused unit tests are clean at claim. The only dirty input is the Wave A gate spec owned by the waiting gate; its failed saved-project assertion is the discovery evidence and it is listed as invalidating but not writable by this implementation card.
- Hotspot locks: only `v9SlideContentCommands.ts` and its named unit tests are writable; no Store, Workspace, Properties, Schema, generated or gate-spec changes.
- Depends on: `stab-mix-01-effective-order-allocation`
- Blocks: `stab-wave-a-core-usability`
- Risk statement: adding a Slide item after Spatial content can produce duplicate persisted `order`, making effective-layer sorting ambiguous and violating strict saved-project assumptions.
- Retry count / last failure class: `0 / none`

## Product outcome

Adding any Slide scene item after content already exists on another Surface preserves one unique course-wide effective layer order per persisted item.

## Current fact and canonical boundary

- `nextSceneLayerOrder` currently builds a partial `used` set from global, current surface and current scene only.
- `globalLayerCommands.ts#allocateCourseLayerOrder` is the existing canonical visitor across global, every surface, every Slide scene and every Spatial world.
- Keep the current scene-relative preferred order, then resolve collisions through that allocator. Do not renumber existing items or weaken Schema validation.

## Scope and acceptance

- Allowed write: `v9SlideContentCommands.ts` and the two named unit tests only.
- Required read: the Wave A failure, `stab-mix-01`, canonical allocator, all Slide append kinds.
- Forbidden write: Store/Workspace/Properties, gate spec, Schema/contracts, load-time repair, dependencies and generated files.
- Acceptance:
  - [ ] Default Slide → two distinct Spatial world insertions → Slide native insertion persists globally unique effective orders.
  - [ ] Native, component and runtime Slide append paths continue to share `appendSceneLayer`; no kind-specific allocator is introduced.
  - [ ] Current-scene relative order is preserved; existing items are not renumbered; one insertion remains one history entry.

## Change and retry budget

- Task timebox: 20 minutes
- Main source files: 1
- Existing test files: at most 2
- New/moved files: 0
- Public exports: 0
- Move/delete: 0
- Dependency/lockfile changes: 0
- Schema/contract/producer changes: 0
- Generated diff: none until the Wave A checkpoint
- Maximum implementation retries: 2
- Maximum design attempts: 2

## Minimal validation

- `npx vitest run tests/unit/v9SlideContentCommands.test.ts tests/unit/effectiveLayerCommands.test.ts`
- `git diff --check`

## Result and rollback

- Start point: `1c54d46`; discovery is the Wave A saved-project assertion reporting four effective items but three unique orders.
- Product commit and rollback: pending; revert the one allocator/test commit independently.
- Result evidence: pending product commit and focused result.
- Outcome conclusion boundary: V1 plus the resumed browser gate establishes at most `engineering candidate`.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
