# S2 Task Card — Post-audit Wave A Core Usability Gate

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: wave-gate
- Necessity / skip condition: Controller authoring ownership/bounds, Mixed world insertion and merged Flow text selection/empty geometry are core authoring blockers; this gate runs one real-browser vertical slice only after all three dependency cards bind focused evidence to the integrated candidate.
- Complexity delta: neutral
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: Reuse dependency-card focused evidence at the integrated commit; rerun only the single gate spec when a listed product/spec/browser path changes. Docs/task-board/generated-only changes do not invalidate it.
- Invalidating paths: `src/renderer/ui/FlowWorkspace.tsx`; `src/renderer/ui/Workspace.tsx`; `src/renderer/ui/TeacherControllerAuthoringChrome.tsx`; `src/renderer/authoring/flowTextEdit.ts`; `src/renderer/course/globalLayerCommands.ts`; `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/store/editorStore.ts`; `tests/e2e/stabilizationCoreUsability.spec.ts`; `playwright.config.ts`
- Task ID: `stab-wave-a-core-usability`
- Phase / wave: `post-audit stabilization / A-core gate`
- Status: `draft`
- Owner / Reviewer / Integrator: `Validation Worker / Core Usability Reviewer / Stabilization Integrator`
- Claimed at / released at: `not claimed / not released`
- Worktree / branch: `integration worktree / codex/architecture-stabilization`
- Baseline HEAD: `d2371aa` (replace with integrated candidate at claim)
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: Dependency product commits and listed paths must be rechecked at claim; root docs/generated inputs remain read-only.
- Depends on: `stab-ctrl-01-authoring-bounds-and-recovery`; `stab-mix-01-effective-order-allocation`; `stab-flow-01-real-text-selection`
- Blocks: `core-gate release for B/C/D cards that explicitly depend on stab-wave-a-core-usability; unrelated cards remain claimable`
- Risk statement: Integration can reintroduce pointer/hit routing or stale Store behavior not visible in isolated focused tests.
- Retry count / last failure class: `0 / none`

## Product outcome

One integrated candidate proves the three core author behaviors in a real browser without repeating each implementation suite.

## Scope and acceptance

- One E2E spec, at most three compound behaviors:
  1. Slide/Flow/Spatial page controller preview is inert/pass-through; Global Layer clamps/cancels/recovers safely and save/reopen plus real Player accept the result.
  2. Default Slide→new Spatial→two distinct world insertions succeeds and reopened effective orders remain unique.
  3. Flow supports real pointer text selection and stable empty-block caret/first-character geometry.
- Reuse dependency Vitest evidence; do not rerun it in this gate.
- No product fixes, Schema changes, full E2E, desktop build or new generic test runner.
- Pipeline pass permits only `engineering candidate`.

## Minimal validation

- `npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts`
- `git diff --check`

## Result and rollback

- Start point: integrated dependency commits.
- Gate commit and rollback: pending; gate spec/status revert independently, product fixes retain their own rollback points.
- Result evidence: pending candidate commit, one spec result and evidence-reuse decision.
- Outcome conclusion boundary: real-browser automation is not teacher/product `accepted`.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`

