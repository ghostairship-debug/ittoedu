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
- Invalidating paths: `src/renderer/ui/FlowWorkspace.tsx`; `src/renderer/ui/Workspace.tsx`; `src/renderer/ui/TeacherControllerAuthoringChrome.tsx`; `src/renderer/authoring/flowTextEdit.ts`; `src/renderer/authoring/v9TeacherControllerAuthoring.ts`; `src/renderer/course/globalLayerCommands.ts`; `src/renderer/course/spatialEditorCommands.ts`; `src/renderer/course/v9SlideContentCommands.ts`; `src/renderer/store/editorStore.ts`; `src/shared/teacherControllerLayout.ts`; `tests/e2e/stabilizationCoreUsability.spec.ts`; `playwright.config.ts`
- Task ID: `stab-wave-a-core-usability`
- Phase / wave: `post-audit stabilization / A-core gate`
- Status: `wave-validated`
- Owner / Reviewer / Integrator: `Validation Worker / Core Usability Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / wave-validated 2026-08-25`
- Worktree / branch: `shared integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `d8d496f` (integrated dependency candidate; product bytes end at `0f7053e`)
- Context: manual Bootstrap read the three dependency cards and evidence, `playwright.config.ts`, the existing Electron launch/save/reopen/preview helpers in `editor.spec.ts` and `imageReplacementVerticalSlice.spec.ts`, and the final listed product paths. The one-spec design uses one Electron process and three bounded `test.step` behaviors.
- Freshness / relevant dirty inputs: worktree and every listed product/spec path were clean at claim. `npm run repo:index:check` correctly reported the committed index stale after Wave A product changes, so the gate uses the recorded exact-source Bootstrap and defers one generated refresh to the wave checkpoint.
- Hotspot locks: released after gate commit `3cd4719`; the gate made no product-code change.
- Depends on: `stab-ctrl-01-authoring-bounds-and-recovery`; `stab-mix-01-effective-order-allocation`; `stab-mix-03-slide-effective-order-allocation`; `stab-flow-01-real-text-selection`
- Blocks: `core-gate release for B/C/D cards that explicitly depend on stab-wave-a-core-usability; unrelated cards remain claimable`
- Risk statement: Integration can reintroduce pointer/hit routing or stale Store behavior not visible in isolated focused tests.
- Retry count / last failure class: `8 / the first independent hit-test oracle targeted the visual child button although runtime intentionally delegates its pointer region to the draggable controller root`
- Final-candidate freshness attempts / last failure class: `3 / pass: the complete unchanged three-group acceptance journey passed in 2.0 minutes`

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

- Start point: integrated candidate `d8d496f`, with product bytes ending at `0f7053e`.
- Gate commit and rollback: original gate `3cd4719`; final-candidate safe-default oracle checkpoint `60c130c`; Flow hit-isolation product repair `0999b1c`. Each remains independently revertible.
- Result evidence: `npm run build:desktop` passed at product commit `0f7053e` with only the existing inline-dynamic-import and bundle-size warnings. `npx tsc -p tsconfig.e2e.json --noEmit`, Playwright test listing and `git diff --check` passed. The final `npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts --workers=1` run passed 1/1 in 2.1 minutes after a prior diagnostic run exposed and repaired an incorrect child-button hit oracle. The final real Electron journey creates two distinct Spatial world kinds, proves course-wide unique persisted orders, performs native Flow mouse selection and empty/first-character geometry checks, verifies Slide/Flow/Spatial controller preview ownership, pointer-cancel zero-write, bounded drag, save/reopen, and a published Player recovery button whose four browser-space edges are inside the Slide stage and whose delegated hit region expands on a real mouse click. Dependency-card focused evidence was reused because the final gate run covered the integrated product candidate and no dependency invalidator changed afterward. The independent Core Usability Reviewer approved the strengthened Player oracle, exact warning boundary and final invalidation list without repeating the browser run. Pipeline status: pass; outcome status: `engineering candidate`, not teacher/product accepted.
  - Final-candidate freshness attempt 1 at product `0999b1c`: the four focused suites passed `28/28`, then the browser gate deterministically failed while double-clicking the first Flow paragraph because the newly stable below-placed formatting toolbar covered 48px of that neighboring block. This was a product usability regression against FLOW-02, not a locator workaround opportunity; `stab-flow-09-toolbar-neighbor-hit-isolation` owns the narrow 60px layout reservation repair.
  - Final-candidate freshness attempt 2 after that product repair and a fresh desktop build passed the unchanged center double-click, empty-caret geometry and real native-range Flow behavior, then failed in the controller group because the old gate clicked the `打开课件时默认折叠` toggle before asserting it. `stab-ctrl-06-safe-default-collapsed` intentionally changed new/missing controllers to checked by default, so the click inverted the correct value. The repaired oracle directly requires the initial checked state; it is not conditional and the downstream save/reopen/Player recovery path remains unchanged.
  - Final-candidate freshness attempt 3: product commit `0999b1c`, gate-spec checkpoint `60c130c`, and freshly materialized desktop artifacts. The unchanged command passed `1/1` in 2.0 minutes, including two distinct Spatial world insertions, Flow empty/first-character geometry, native pointer selection, controller page/global ownership, cancellation zero-write, bounded clamp, save/reopen, unique effective orders and the real Player recovery hit region. The initial safe default is now asserted directly as checked and is still proven downstream by the Player's collapsed recovery button. Before the repair, the four focused suites passed `28/28`; the only affected focused consumer was refreshed at product `0999b1c` and passed `15/15`. Full `npm run typecheck`, fresh `npm run build:desktop`, E2E typecheck/listing and `git diff --check` passed. The Flow hit-geometry reviewer returned `APPROVE`; terminal diagnostics remained clean. Pipeline status: pass; outcome status: `engineering candidate`, not teacher/product accepted.
- Outcome conclusion boundary: real-browser automation is not teacher/product `accepted`.
- Semantic index impact: `none`
- Generated refresh: `complete-at-wave-a-gate`
