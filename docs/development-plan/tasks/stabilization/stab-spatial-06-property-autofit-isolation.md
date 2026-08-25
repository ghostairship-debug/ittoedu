# S2 Task Card — Spatial Properties Auto-fit Isolation

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation
- Necessity / skip condition: Wave B reproduced a default Spatial world text whose Properties name-only edit changed `frame.height` from `80` to `51.24`; skip only if the current UI already passes the name patch through without appending layout fields and a default auto-height counterexample proves exact canonical delta plus one undoable history entry.
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the focused default-auto-height Properties counterexample and renderer typecheck to the product commit. Wave B may reuse them at the same product bytes, but must still rerun its one real-browser gate after fresh desktop artifact materialization. Docs/task-board/generated-only changes do not invalidate product evidence.
- Invalidating paths: `src/renderer/ui/PropertiesTab.tsx` text auto-fit patch expansion; `tests/unit/spatialProductIntegration.test.tsx` default auto-height Properties counterexample; shared text layout/render helpers only if the implementation actually changes them
- Task ID: `stab-spatial-06-property-autofit-isolation`
- Phase / wave: `post-audit stabilization / B-ownership-controller repair`
- Status: `done`
- Owner / Reviewer / Integrator: `Spatial Properties Repair Worker / independent property-delta reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace; Properties hotspot has one writer / codex/architecture-stabilization`
- Baseline HEAD: `63d3e58`; product bytes remain the Wave B candidate introduced at `ad9d904`, with both failed browser attempts preserved in the gate card.
- Context: `bootstrap-manual`; the failing archive delta, Playwright trace, `PropertiesTab` auto-fit wrapper, canonical Spatial patch routing and the prior focused fixture's forced `overflow='fixed'` were inspected before claim.
- Freshness / relevant dirty inputs: worktree clean at claim. `PropertiesTab.tsx` and `spatialProductIntegration.test.tsx` have not changed since `d2e40d4`; the real default-auto-height browser counterexample is fresh at product candidate `ad9d904`.
- Depends on: `stab-spatial-01-honest-properties`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: A visible non-layout Properties action can silently resize authored text, while an over-broad repair could stop legitimate auto-fit after text, style or writing-dimension changes.
- Retry count / last failure class: `0 / none`

## Product outcome

Renaming or changing another non-layout property of an auto-height text preserves its authored frame; only patches capable of changing text layout may request auto-fit geometry, and the resulting canonical write remains one user action and one history entry.

## Scope, locks and acceptance

- Allowed write: the narrow text auto-fit decision in `src/renderer/ui/PropertiesTab.tsx` and one focused default-auto-height regression in `tests/unit/spatialProductIntegration.test.tsx`.
- Required read: `renderTextNodeCanvas`, `TextNode`/`DeepPartial` patch semantics, Spatial effective-layer property routing, and the existing auto-height width/height controls.
- Forbidden write: Store/history commands, Course Project contracts/Schema, Player/Published/export, text layout algorithms, insertion defaults, other Surface architecture, dependencies or generated indexes.
- Hotspot lock: Properties is single-writer until this card reaches a terminal state; the gate spec and docs may be read but not changed under this implementation card.
- Acceptance:
  - [x] A default auto-height Spatial world text name edit changes only its canonical `label`, preserves its complete frame/content/style, and adds exactly one revision/history entry.
  - [x] Undo/redo restores and reapplies that exact label-only delta.
  - [x] Text/runs, style and the writing dimension continue to request auto-fit; x/y/rotation/name/visibility/lock/opacity/playback-only patches do not append width/height.
  - [x] No Store, contract, Player, insertion-default or layout-algorithm change.

## Minimal validation

- `npx vitest run tests/unit/spatialProductIntegration.test.tsx`
- `npm run typecheck`
- `git diff --check`

## Result and rollback

- Start point: `63d3e58` with Wave B retrying after the deterministic label-plus-geometry failure.
- Product commit and rollback: `58c1e45`; revert that commit if the focused counterexample or Wave B gate regresses.
- Result evidence: `PropertiesTab` now invokes text auto-fit only when a patch contains text, runs, style, width or height; metadata/common patches pass through without derived dimensions. The new default Spatial world-text UI counterexample proves full-document equality except label/revision/timestamp, exact frame/content/style preservation, one revision/history entry and exact undo/redo. `npx vitest run tests/unit/spatialProductIntegration.test.tsx` passed `16/16`; `npm run typecheck` passed all three TypeScript projects; `git diff --check` passed. The independent property-delta reviewer inspected layout/non-layout categories, fixed↔auto semantics, the shared Slide boundary and the exact history oracle and concluded `APPROVE` without editing or duplicating validation. At that checkpoint pipeline status was pass and outcome status was `engineering candidate` pending the Wave B real-browser rerun recorded below.
- Wave B fulfillment: the same product bytes `58c1e45`, materialized into the fresh desktop artifact used by gate-spec checkpoint `d051c37`, passed the single real Electron Wave B gate `1/1` in `5.1m`. The Spatial Properties group changed only the selected default auto-height text label, preserved its complete authored frame/content/style, produced the expected single canonical history action and completed exact undo/redo. Later closure-candidate changes through product `23f2d00` do not touch this card's narrow Properties/test Invalidating paths, so the focused and browser evidence remain reusable.
- Outcome boundary: focused automation permits only `engineering candidate`; the real browser behavior remains owned by Wave B.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`
