# S0 Task Card — ARCH-0B Carrier Semantics

## State and assignment

- Task ID: `arch-0b-idx-01c-carrier-semantics`
- Phase / wave: `ARCH-0B / semantic repair`
- Status: `done`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, semantic-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `fac5be7`
- Claim commit: `ea3b7c513a72c85d30dbc139c2870010edea06d6`
- Context: `IDX-01B semantic + IDX-02 Context Pack review`
- Freshness / relevant dirty inputs: query task writes are disjoint; generated refresh intentionally deferred
- Depends on: `arch-0b-idx-01b-semantic-coverage (done)`
- Blocks: accurate Context Pack canonical carrier section; IDX-03 Flow/Surface golden tasks
- Retry count: `0`

## Product outcome

Feature queries state the real Surface-specific canonical carrier—especially FlowBlock versus LayerItem—rather than returning only file paths under a carrier heading.

## Current fact and evidence

The query model and Context Pack support `feature.carriers`, but the 21 semantic Feature records do not populate it. Flow, Slide, Spatial, Media, Components and Global Layers therefore lack explicit carrier output.

## Non-goals

- No query/generator/generated/product/contract/package change.
- No universal LayerItem abstraction, complete type encyclopedia, or duplicated module dependency policy.

## Scope and locks

### Allowed write

- `repo-index/semantic/features.json` carrier fields only
- `tests/unit/repoIndexSemantic.test.ts` carrier assertions only
- This task card

### Required read

- V9 `types.ts` carrier definitions
- Surface carrier, Media, Components and Global Layer module documents

### Forbidden write

- Modules/invariants/exclusions, generated/config/query/generator
- product/contracts/package/lockfile/other cards

### Hotspot locks

- Feature semantic single owner only.

## Change budget

- Task timebox: `half Worker day`
- Main files: `1 semantic JSON + 1 focused test + this card`
- Public/dependency/UI/Schema/generated changes: `no`
- Target validation: semantic focused suite; under 1 minute
- Max implementation retries: `1`

## Acceptance

- [x] Course/V9, Slide, Flow, Spatial, Media, Components and Global Layers have concise carrier maps
- [x] Flow paper is `FlowSurfaceDocument.blocks`, paper component is `FlowComponentBlock`, overlay is `surfaceLayerItems`/`LayerItem.paperSpace`
- [x] Slide scene and Spatial world remain their own LayerItem locations
- [x] Component carrier differs for Flow paper versus overlays/Slide/Spatial
- [x] Media metadata/bytes/placement layers remain distinct
- [x] Tests reject any “all content is LayerItem” collapse

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- Generate/query to OS temporary output after IDX-02 repair; `git diff --check`

## Rollback

- Start point: `ca354119f609055e6839be1f0445102d9958c205`
- Implementation commit: `f46f48e3bdecf480be2abd0bedc82bc8e5196ffe`
- Old path remains: semantic file paths stay available, but carrier section would be less precise.

## Consumers and index

- Consumer delta: improves exact Context Pack facts only
- Legacy record IDs: none
- indexImpact: `semantic-update + Coordinator regenerate`

## Result evidence

- Added concise `carriers` maps only to `feature:course-project-v9`, `feature:slide`, `feature:flow`, `feature:spatial`, `feature:media`, `feature:components`, and `feature:global-layers-controller`.
- Flow is explicit: paper=`FlowSurfaceDocument.blocks (FlowBlock[]; not LayerItem[])`, paper component=`FlowComponentBlock`, paper media=`FlowMediaBlock`, overlay=`surfaceLayerItems` containing LayerItem with `paperSpace=viewport|paper`.
- Components expose four carrier classes: project packages, LayerItem instance for Slide/Spatial/Flow overlay, Flow paper `FlowComponentBlock`, and global/surface shared `ScopedLayerItem`.
- Media keeps metadata (`CourseProjectDocument.assets`), bytes (`CourseAssetSidecar.files`), LayerItem placement and Flow paper placement separate.
- Expanded `tests/unit/repoIndexSemantic.test.ts` with carrier assertions that reject collapsing Flow paper into LayerItem and preserve distinct Slide/Spatial locations.
- Validation: `npx vitest run tests/unit/repoIndexSemantic.test.ts` → 1 file / 4 tests passed, including generator output to the OS temporary directory; JSON parse and `git diff --check` hygiene passed.
- Scope: only Feature carrier fields, carrier-focused assertions, and this card changed by this Worker. Query/config/package dirty inputs are disjoint and untouched; Modules, invariants, exclusions, generator, generated facts, product source and contracts are unchanged.
- Coordinator review: inspected all seven carrier maps and independently reran the full semantic suite; 4/4 passed, including OS-temporary generation.

## Findings / next allowed task

- IDX-02 Context Pack may now render the carrier section directly from these seven records; no query implementation change belongs to this card.
- Future carrier additions should remain short and Surface-specific rather than turning semantic into a type encyclopedia.

## Ready checklist (Coordinator)

- [x] current carrier contracts verified
- [x] semantic lock available
- [x] query writes disjoint
- [x] no relevant user dirty changes
- [x] no product escalation
