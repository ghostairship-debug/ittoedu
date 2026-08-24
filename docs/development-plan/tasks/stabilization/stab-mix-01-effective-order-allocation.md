# S1 Task Card — Mixed Effective Order Allocation

> Audit coverage: `MIX-01`.

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: Default Slide→new Spatial→second world insertion collides with the global controller order; skip only if focused command probes already insert two different world kinds with globally unique effective orders under the unchanged strict V9 Schema.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the two focused command results to the product commit; docs/task-board/generated-only changes reuse them unless a listed allocator/command/test path changes.
- Invalidating paths: `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/course/globalLayerCommands.ts`; `tests/unit/spatialEditorCommands.test.ts`; `tests/unit/effectiveLayerCommands.test.ts`
- Task ID: `stab-mix-01-effective-order-allocation`
- Phase / wave: `post-audit stabilization / A-core`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Mixed Order Worker / Unified Order Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared workspace with file firewall; integration on codex/architecture-stabilization`
- Baseline HEAD: `5c512f9`
- Context: fresh `repo:context` query on `Spatial world insertion effective course layer order allocator` returned low confidence, so manual Bootstrap is required before writing.
- Freshness / relevant dirty inputs: repo-index check passed at claim; worktree was clean and no relevant dirty inputs were present.
- Hotspot locks: `globalLayerCommands.ts`, `spatialEditorCommands.ts`, and the two focused order tests are reserved to this card until integration.
- Depends on: `none`
- Blocks: `stab-wave-a-core-usability`; `stab-spatial-02-copy-paste-duplicate`; `stab-spatial-03-owner-aware-insertion`
- Retry count: `0`

## Product outcome

Every Spatial world insertion in a default Mixed project receives a unique effective course-layer order instead of failing on the second item.

## Current fact and canonical boundary

- `spatialEditorCommands.ts` currently allocates from world items only, while global/surface/world items share the effective V9 order namespace.
- Reuse the existing course-wide allocator in `globalLayerCommands.ts`; do not create a Spatial-only truth.
- Order is persisted V9 data committed with the existing Spatial command/history path. Schema uniqueness remains strict.

## Scope and acceptance

- Allowed write: the existing allocator and Spatial world append path, plus the two named tests.
- Required read: default controller order and effective-layer projection/validation.
- Forbidden write: Store/Workspace/Properties, Schema relaxation, load-time deduplication, broad renumbering, dependencies and generated files.
- Hotspot lock and order: `globalLayerCommands.ts` has one writer for this card and is released before Spatial duplicate/owner insertion work.
- Acceptance:
  - [ ] Two distinct world kinds inserted consecutively create two IDs and one history entry each.
  - [ ] Global/surface/world effective orders are unique and existing relative order is preserved.
  - [ ] Every world insertion kind uses the same allocator; no text-only special case.

## Minimal validation

- `npx vitest run tests/unit/spatialEditorCommands.test.ts tests/unit/effectiveLayerCommands.test.ts`
- `git diff --check`

## Result and rollback

- Start point: claim baseline.
- Product commit and rollback: pending; one implementation commit and one revert boundary, with the local-only allocator removed from authority.
- Result evidence: pending focused insertion/order results; save/reopen and browser behavior are owned once by Wave A.
- Outcome conclusion boundary: V1 establishes at most `engineering candidate`.
- Stop condition: Schema weakening or broad order rewriting requires re-scope.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
