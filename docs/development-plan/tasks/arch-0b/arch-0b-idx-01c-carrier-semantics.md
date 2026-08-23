# S0 Task Card — ARCH-0B Carrier Semantics

## State and assignment

- Task ID: `arch-0b-idx-01c-carrier-semantics`
- Phase / wave: `ARCH-0B / semantic repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, semantic-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `fac5be7`
- Claim commit: `commit containing this card`
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

- [ ] Course/V9, Slide, Flow, Spatial, Media, Components and Global Layers have concise carrier maps
- [ ] Flow paper is `FlowSurfaceDocument.blocks`, paper component is `FlowComponentBlock`, overlay is `surfaceLayerItems`/`LayerItem.paperSpace`
- [ ] Slide scene and Spatial world remain their own LayerItem locations
- [ ] Component carrier differs for Flow paper versus overlays/Slide/Spatial
- [ ] Media metadata/bytes/placement layers remain distinct
- [ ] Tests reject any “all content is LayerItem” collapse

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- Generate/query to OS temporary output after IDX-02 repair; `git diff --check`

## Rollback

- Start point: `ca354119f609055e6839be1f0445102d9958c205`
- Implementation commit: pending
- Old path remains: semantic file paths stay available, but carrier section would be less precise.

## Consumers and index

- Consumer delta: improves exact Context Pack facts only
- Legacy record IDs: none
- indexImpact: `semantic-update + Coordinator regenerate`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] current carrier contracts verified
- [x] semantic lock available
- [x] query writes disjoint
- [x] no relevant user dirty changes
- [x] no product escalation
