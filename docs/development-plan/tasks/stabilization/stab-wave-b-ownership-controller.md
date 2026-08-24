# S2 Task Card — Post-audit Wave B Ownership And Controller Gate

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: wave-gate
- Necessity / skip condition: Controller runtime/session and Spatial canonical owner/history changes share Player/Store integration boundaries; run this gate only after all dependency cards bind focused evidence to one integrated candidate.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 35 minutes
- Reviewer budget: 2
- Reviewer risk surfaces: `Controller Session/Player lifecycle`; `Spatial canonical owner/history`
- Evidence reuse: Reuse still-fresh dependency focused evidence at the integrated candidate; because the Spatial clipboard Store commit invalidated only the named cross-Surface history consumer, refresh that one spec before the gate. Run the new browser spec and renderer typecheck once, using freshly materialized desktop artifacts from the same product bytes. Docs/task-board/generated-only changes do not invalidate product evidence.
- Invalidating paths: `src/player/teacherControllerDom.ts`; `src/player/renderTeacherController.ts`; `src/player/teacherControllerRuntimeSession.ts`; `src/player/TeacherEscapeControls.ts`; `src/player/surfaces/publishedDynamicHosts.ts`; `src/player/surfaces/slide/SlidePublishedAdapter.ts`; `src/player/surfaces/flow/FlowSurfaceHost.ts`; `src/player/surfaces/spatial/SpatialSurfaceHost.ts`; `src/renderer/App.tsx`; `src/renderer/store/editorStore.ts`; `src/renderer/ui/Workspace.tsx`; `src/renderer/ui/ScenePanel.tsx`; `src/renderer/ui/ElementsTab.tsx`; `src/renderer/ui/NodesTab.tsx`; `src/renderer/ui/PropertiesTab.tsx`; `src/renderer/course/effectiveLayerProjection.ts`; `src/renderer/authoring/courseAuthoringScope.ts`; `src/renderer/course/spatialAuthoringHistory.ts`; `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/course/spatialClipboardCommands.ts`; `src/renderer/course/effectiveLayerCommands.ts`; `tests/unit/mixedCrossSurfaceHistory.test.tsx`; `tests/e2e/stabilizationOwnershipController.spec.ts`; `playwright.config.ts`; `tsconfig.json`; `tsconfig.e2e.json`; Electron/Renderer build inputs used by fresh artifact materialization
- Task ID: `stab-wave-b-ownership-controller`
- Phase / wave: `post-audit stabilization / B-ownership-controller gate`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Validation Worker / Controller Session Reviewer + Spatial Canonical/History Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace; validation spec is the only product-adjacent write / codex/architecture-stabilization`
- Baseline HEAD: Product/test candidate `120243d`; task evidence/board closure `bc33832`; worktree clean and all named dependency cards terminal.
- Context: `bootstrap-manual`; exact trace covers Player controller DOM/session/three-Surface hosts, App/Workspace/ScenePanel navigation, canonical Spatial Store/selection/clipboard/history/camera seams and the existing Electron E2E harness.
- Freshness / relevant dirty inputs: The Spatial clipboard commit invalidated `mixedCrossSurfaceHistory.test.tsx`, so that single named consumer must be refreshed. Earlier Wave A browser evidence is also stale, but this card does not reuse it as current proof; Wave A receives its own final-candidate freshness rerun. Direct owner/move/clipboard evidence remains available compositionally until an Invalidating path changes.
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
- Run the one invalidated `mixedCrossSurfaceHistory` consumer and renderer typecheck once after integration; materialize fresh desktop artifacts as the browser-test prerequisite, and do not repeat other dependency Vitest suites.
- Allowed write: this task card and one `tests/e2e/stabilizationOwnershipController.spec.ts`; a gate failure creates/reopens the exact owning implementation card rather than modifying product code here.
- No per-location controller positions, second history, generic owner abstraction, full E2E or package build.
- Two reviews are non-overlapping: Controller reviewer covers Session/Player lifecycle; Spatial reviewer covers owner/canonical/history.
- Pipeline pass permits only `engineering candidate`.

## Minimal validation

- `npx vitest run tests/unit/mixedCrossSurfaceHistory.test.tsx`
- `npm run typecheck`
- `npx playwright test tests/e2e/stabilizationOwnershipController.spec.ts --workers=1`
- `git diff --check`

## Result and rollback

- Start point: integrated dependency commits.
- Gate commit and rollback: pending; gate spec/status revert independently, product fixes use dependency rollback points.
- Result evidence: pending candidate commit, browser result, renderer typecheck and two risk-surface reviews.
- Outcome conclusion boundary: automation is not teacher/product `accepted`.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`
