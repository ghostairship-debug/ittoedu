# S2 Task Card — Post-audit Wave B Ownership And Controller Gate

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: wave-gate
- Necessity / skip condition: Controller runtime/session and Spatial canonical owner/history changes share Player/Store integration boundaries; run this gate only after all dependency cards bind focused evidence to one integrated candidate.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 20 minutes
- Reviewer budget: 2
- Reviewer risk surfaces: `Controller Session/Player lifecycle`; `Spatial canonical owner/history`
- Evidence reuse: Reuse dependency focused evidence at the integrated candidate; run the one browser spec and affected renderer typecheck once. Docs/task-board/generated-only changes do not invalidate product evidence.
- Invalidating paths: `src/player/teacherControllerRuntimeSession.ts`; `src/player/surfaces/publishedDynamicHosts.ts`; `src/player/surfaces/slide/SlidePublishedAdapter.ts`; `src/player/surfaces/flow/FlowSurfaceHost.ts`; `src/player/surfaces/spatial/SpatialSurfaceHost.ts`; `src/renderer/store/editorStore.ts`; `src/renderer/ui/ElementsTab.tsx`; `src/renderer/ui/NodesTab.tsx`; `src/renderer/ui/PropertiesTab.tsx`; `src/renderer/course/spatialEditorCommands.ts`; `tests/e2e/stabilizationOwnershipController.spec.ts`; `playwright.config.ts`; `tsconfig.json`
- Task ID: `stab-wave-b-ownership-controller`
- Phase / wave: `post-audit stabilization / B-ownership-controller gate`
- Status: `draft`
- Owner / Reviewer / Integrator: `Validation Worker / Controller Session Reviewer + Spatial Canonical/History Reviewer / Stabilization Integrator`
- Claimed at / released at: `not claimed / not released`
- Worktree / branch: `integration worktree / codex/architecture-stabilization`
- Baseline HEAD: `d2371aa` (replace with integrated candidate at claim)
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: Dependency commits and exact invalidating paths must be rechecked at claim; root docs/generated inputs remain read-only.
- Depends on: `stab-ctrl-03-collapsed-hit-footprint`; `stab-ctrl-05-mixed-runtime-session`; `stab-ctrl-06-safe-default-collapsed`; `stab-spatial-01-honest-properties`; `stab-spatial-02-copy-paste-duplicate`; `stab-spatial-03-owner-aware-insertion`; `stab-spatial-04-owner-aware-selection`; `stab-spatial-05-cross-owner-move-guard`; `stab-mix-02-cross-surface-history-continuity`
- Blocks: `audit-closure consumption of Wave B evidence; other cards are blocked only when they explicitly depend on stab-wave-b-ownership-controller`
- Risk statement: Player Session integration can leak into persistence, while Spatial scope/history integration can produce false success or stale canonical writes.
- Retry count / last failure class: `0 / none`

## Product outcome

One integrated candidate proves honest controller runtime semantics and Spatial canonical owner/history behavior without rerunning every dependency suite.

## Scope and acceptance

- One E2E spec, at most three compound groups:
  1. Three-Surface collapsed footprint, 1280×720 Flow TOC recovery, Mixed collapse/Surface offsets and restart reset.
  2. Spatial properties, duplicate/clipboard, owner-aware insertion/selection and cross-owner move refusal all match canonical writes or explicit zero-write failure.
  3. Spatial→Slide→Spatial undo/redo uses one canonical history and camera remains Session-only.
- Run renderer typecheck once after integration; do not repeat dependency Vitest suites.
- No per-location controller positions, second history, generic owner abstraction, full E2E or desktop build.
- Two reviews are non-overlapping: Controller reviewer covers Session/Player lifecycle; Spatial reviewer covers owner/canonical/history.
- Pipeline pass permits only `engineering candidate`.

## Minimal validation

- `npx playwright test tests/e2e/stabilizationOwnershipController.spec.ts`
- `npx tsc --noEmit`
- `git diff --check`

## Result and rollback

- Start point: integrated dependency commits.
- Gate commit and rollback: pending; gate spec/status revert independently, product fixes use dependency rollback points.
- Result evidence: pending candidate commit, browser result, renderer typecheck and two risk-surface reviews.
- Outcome conclusion boundary: automation is not teacher/product `accepted`.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`

