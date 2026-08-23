# S1 Task Card — ARCH-4 Spatial PPTX SVG Base64

## State and assignment

- Task ID: `arch-4-pptx-spatial-svg-base64`
- Phase / wave: `ARCH-4 / PPTX adapter finding`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Export Reviewer / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `344b0cf`
- Claim commit: `pending`
- Context: `fresh repo:context required at ARCH-4 delivery wave`
- Freshness / relevant dirty inputs: Mixed/Spatial fixture reproduces current red baseline
- Depends on: `ARCH-4 PPTX adapter wave ready; Export/PPTX lock available`
- Blocks: Mixed/Spatial PPTX outcome green
- Retry count: `0`

## Product outcome

Mixed/Spatial PPTX contains the rendered Spatial SVG media and relationships instead of silently producing empty Spatial pages with a PptxGenJS base64-header error.

## Current fact and evidence

`buildCoursePptx.ts#addSpatialFramePage` passes a percent-encoded `data:image/svg+xml;charset=utf-8,...` URI to PptxGenJS. PptxGenJS requires `base64,`, logs an error, and omits media while the returned PPTX remains non-empty. ARCH-0A one-shot export reproduced two missing Spatial images.

## Non-goals

- No Published producer, App, PDF/HTML, shared SVG renderer, screenshot/raster pipeline, dependency, or Schema change.
- No acceptance based only on non-empty PPTX bytes/page count.

## Scope and locks

### Allowed write

- `src/renderer/export/course/buildCoursePptx.ts`
- `tests/unit/coursePptxExport.test.ts`
- This task card

### Required read

- `src/renderer/export/base64.ts`
- `src/renderer/export/course/buildCoursePrintArtifacts.ts` SVG renderer
- Mixed/Spatial representative fixture and current performance red evidence

### Forbidden write

- Published producer, App, PDF/main, HTML/Web, Player, contracts, package/lockfile

### Hotspot locks

- Export/PPTX adapter only; no Published producer lock.

## Change budget

- Task timebox: `1 Worker day`
- Main files: `1 product + 1 focused test`
- New public exports/dependencies/UI/Schema changes: `no`
- Target validation: PPTX focused suite + print-artifact non-regression; under 10 minutes
- Max implementation retries: `2`; max design attempts: `2`

## Acceptance

- [ ] UTF-8 SVG is converted through existing base64 data-URL helper
- [ ] No PptxGenJS base64-header error
- [ ] Unzipped PPTX has Spatial SVG media and slide relationship references
- [ ] Slide count/pages are not used as sole success evidence
- [ ] PDF/print and HTML/Web paths unchanged

## Minimal validation

- `npx vitest run tests/unit/coursePptxExport.test.ts`
- `npx vitest run tests/unit/coursePrintArtifacts.test.ts`
- Build/unzip Mixed fixture PPTX and inspect `ppt/media` + relationships; `git diff --check`

## Rollback

- Start point: ARCH-4 PPTX wave baseline
- Implementation commit: pending
- Old path remains: one adapter conversion can be reverted independently.

## Consumers and index

- Consumer delta: fixes the V2 PPTX adapter; no Legacy count change
- Legacy record IDs: `LEG-004` read-only context
- indexImpact: `regenerate`

## Result evidence

- Pending.

## Stop conditions

- Base64 SVG remains unsupported, requires SVG→PNG rasterization/new dependency, changes shared SVG/PDF semantics, or requires App/Published producer changes; then re-scope to S2/product review.

## Ready checklist (Coordinator)

- [ ] dependencies and export lock ready
- [ ] fresh context and representative fixture
- [ ] no relevant user dirty change
- [ ] validation/rollback complete
- [ ] no product escalation
