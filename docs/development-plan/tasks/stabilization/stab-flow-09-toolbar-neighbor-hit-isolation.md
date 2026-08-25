# S2 Task Card — Flow Context Toolbar Neighbor Hit Isolation

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation
- Necessity / skip condition: Fresh Wave A Electron evidence reproduced the below-placed Flow context toolbar intercepting a real double-click on the immediately following paragraph. Skip only if source geometry proves the toolbar footprint cannot overlap a neighboring block at supported paper widths; current constants prove a 48px overlap (`60px` below extent versus `12px` block gap), so the task is necessary.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Reviewer risk surface: Flow document-layout hit isolation and preservation of stable toolbar geometry
- Evidence reuse: Bind focused evidence to the product commit. The fresh Wave A browser failure is the reproducer and Wave A supplies the post-fix real-mouse acceptance rerun. Docs/task-board/generated-only changes do not invalidate product evidence.
- Invalidating paths: `src/renderer/ui/FlowWorkspace.tsx`; `src/renderer/ui/FlowBlockContextToolbar.tsx`; `tests/unit/flowWorkspace.test.tsx`; `tests/e2e/stabilizationCoreUsability.spec.ts`
- Task ID: `stab-flow-09-toolbar-neighbor-hit-isolation`
- Phase / wave: `post-audit stabilization / A-freshness repair for C-flow-authoring`
- Status: `done`
- Owner / Reviewer / Integrator: `Flow Layout Repair Worker / independent Flow hit-geometry reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace; Integrator is the sole FlowWorkspace writer / codex/architecture-stabilization`
- Baseline HEAD: task/decision baseline `b193ebd`; current product bytes `58c1e45`; Wave A freshness attempt failed after the 28/28 focused refresh.
- Context: `bootstrap-manual`; inspect only the existing Flow block frame, toolbar placement constants, focused workspace test and Wave A real-mouse reproducer.
- Freshness / relevant dirty inputs: worktree clean at claim; no product/test path is dirty.
- Depends on: `stab-flow-04-stable-context-toolbar`
- Blocks: `stab-wave-a-core-usability final-candidate freshness`; `stab-wave-c-flow-authoring`
- Risk statement: An absolute toolbar may preserve its own geometry while stealing the neighboring block's authoring hit area; a repair must reserve only Session/layout space and must not mutate Flow documents or history.
- Retry count / last failure class: `0 / focused and real-mouse acceptance passed`

## Product outcome

When a selected Flow block shows the stable context toolbar below itself, the next document block remains directly mouse-addressable instead of being covered by toolbar chrome.

## Scope and acceptance

- Allowed write: one narrow layout calculation in `FlowWorkspace.tsx`, one focused assertion in `flowWorkspace.test.tsx`, this task card and generated task-board state.
- Forbidden write: Flow contracts/schema, toolbar controls or command semantics, text selection adapters, Properties, Player/export, Wave A/Wave C E2E logic, dependencies or unrelated layout refactors.
- Acceptance:
  - [x] A below-placed toolbar reserves its complete existing below extent in normal and wrapped block margin flow, leaving the existing base gap after the toolbar.
  - [x] The immediately following block is not geometrically covered and the unchanged Wave A real `dblclick` enters its inline editor without `force` or coordinate workarounds.
  - [x] Toolbar width/height/control slots, selection state, top placement, document bytes, revision and history semantics remain unchanged.
- No new abstraction: reuse `FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET` as the single existing footprint constant.

## Minimal validation

- `npx vitest run tests/unit/flowWorkspace.test.tsx`
- `npm run typecheck`
- `git diff --check`
- Post-fix gate evidence is the separately owned `npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts --workers=1` after one fresh desktop build.

## Result and rollback

- Start evidence: final product candidate `58c1e45`; decision/task baseline `b193ebd`.
- Product commit: `0999b1c`.
- Result evidence: the shared existing `FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET` now augments only the bottom margin of a selected block whose effective toolbar placement is `below`. Normal and wrapped bases remain `12px` and `8px`, producing `72px` and `68px`; a following unselected paragraph remains `12px`. `npx vitest run tests/unit/flowWorkspace.test.tsx` passed `15/15`; `npm run typecheck`, `git diff --check` and fresh `npm run build:desktop` passed, with only the registered inline-dynamic-import and renderer chunk-size warnings. The unchanged Wave A center `dblclick` and complete real Electron gate passed `1/1` in 2.0 minutes. The independent Flow hit-geometry reviewer concluded `APPROVE`: final style precedence is correct, top placement is untouched, margins do not enter `getBoundingClientRect()` placement feedback, and no document/history path changed.
- Pipeline status: pass at product commit `0999b1c`.
- Outcome status: `engineering candidate`; the reproduced neighboring paragraph is directly mouse-addressable again, while teacher/product acceptance remains outside this V1 card.
- Outcome boundary: this card proves neighbor hit isolation only; it does not declare the overall Flow authoring experience teacher-accepted.
- Rollback: revert `0999b1c`; no data migration or contract rollback is involved.
- Semantic index impact: `none`
- Generated refresh: `task-board refreshed at closure`
