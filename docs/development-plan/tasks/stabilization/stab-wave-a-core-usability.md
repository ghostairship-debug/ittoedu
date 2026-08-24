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
- Status: `claimed`
- Owner / Reviewer / Integrator: `Validation Worker / Core Usability Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `cba124f` (integrated dependency candidate; product bytes end at `fcb09b1`)
- Context: manual Bootstrap read the three dependency cards and evidence, `playwright.config.ts`, the existing Electron launch/save/reopen/preview helpers in `editor.spec.ts` and `imageReplacementVerticalSlice.spec.ts`, and the final listed product paths. The one-spec design uses one Electron process and three bounded `test.step` behaviors.
- Freshness / relevant dirty inputs: worktree and every listed product/spec path were clean at claim. `npm run repo:index:check` correctly reported the committed index stale after Wave A product changes, so the gate uses the recorded exact-source Bootstrap and defers one generated refresh to the wave checkpoint.
- Hotspot locks: only `tests/e2e/stabilizationCoreUsability.spec.ts` and this gate's status/evidence are reserved; gate implementation may not change product code.
- Depends on: `stab-ctrl-01-authoring-bounds-and-recovery`; `stab-mix-01-effective-order-allocation`; `stab-mix-03-slide-effective-order-allocation`; `stab-flow-01-real-text-selection`
- Blocks: `core-gate release for B/C/D cards that explicitly depend on stab-wave-a-core-usability; unrelated cards remain claimable`
- Risk statement: Integration can reintroduce pointer/hit routing or stale Store behavior not visible in isolated focused tests.
- Retry count / last failure class: `6 / five gate-spec contract faults repaired; one product integration failure delegated to stab-mix-03-slide-effective-order-allocation`

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
