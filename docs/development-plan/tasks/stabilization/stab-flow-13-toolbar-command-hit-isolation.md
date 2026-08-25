# S1 Task Card — Flow Toolbar Command Hit Isolation

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: Wave C 真实 Electron 纵切已重现“局部加粗” click 冒泡到正文块，将一个有效 range 选区降级为 whole-block；仅在工具栏根节点已隔离 command click 且真实 gate 不再复现时可跳过，当前源码没有 click 隔离，因此必须修复。
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 12 minutes
- Reviewer budget: 1
- Reviewer risk surface: Flow toolbar event propagation, native range preservation, and unchanged command semantics
- Evidence reuse: focused 证据绑定 product commit；Wave C 的真实 range 重试是后续 V2 验收。仅 docs/task-board/generated 变化时复用。
- Invalidating paths: `src/renderer/ui/FlowBlockContextToolbar.tsx`; `src/renderer/ui/FlowWorkspace.tsx`; `tests/unit/flowWorkspace.test.tsx`; `tests/e2e/stabilizationFlowAuthoring.spec.ts`
- Task ID: `stab-flow-13-toolbar-command-hit-isolation`
- Phase / wave: `post-audit stabilization / C-flow-authoring repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Flow Toolbar Repair Worker / independent Flow interaction reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace; Integrator is the sole Flow toolbar writer / codex/architecture-stabilization`
- Baseline HEAD: Wave C spec/failure diagnosis `953553e`; unchanged product bytes `0999b1c`.
- Context: exact-source Bootstrap covers `FlowBlockContextToolbar`, block-frame click selection, the focused workspace test and Wave C trace.
- Freshness / relevant dirty inputs: worktree clean at claim; two Wave C attempts first exposed fixture overlay collision, then the isolated toolbar click reproduced selection downgrade after the native range remained live.
- Depends on: `stab-flow-04-stable-context-toolbar`; `stab-flow-09-toolbar-neighbor-hit-isolation`
- Blocks: `stab-wave-c-flow-authoring`
- Risk statement: stopping the command click too early could suppress the button command; stopping it too late lets the block click rewrite selection and commit the edit.
- Retry count / last failure class: `0 / product defect reproduced by isolated Wave C toolbar click`

## Product outcome

Clicking a Flow context-toolbar command applies only that command and preserves the active native text range; it no longer also selects the containing block as a second, unintended action.

## Scope and acceptance

- Allowed write: one event-boundary repair in `FlowBlockContextToolbar.tsx`, one focused regression assertion in `flowWorkspace.test.tsx`, this task card and generated task-board state.
- Forbidden write: Flow contracts/schema, text/run command semantics, Properties, Player/export, media, Wave C spec, dependencies or unrelated refactors.
- Acceptance:
  - [ ] Toolbar command `click` reaches the intended button handler and does not reach the outer Flow block `onClick`.
  - [ ] A range-only bold command keeps the selection in text/range mode and remains local to the selected run.
  - [ ] Existing pointer-down focus preservation, toolbar geometry, document/history behavior and accessible names remain unchanged.
- No new abstraction: use the toolbar root as the existing event boundary.

## Minimal validation

- `npx vitest run tests/unit/flowWorkspace.test.tsx`
- `npx tsc -p tsconfig.e2e.json --noEmit`
- `git diff --check`
- Post-fix V2 evidence is the separately owned Wave C spec rerun; do not run full verify or another unrelated browser spec.

## Result and rollback

- Start evidence: product commit `0999b1c`; Wave C gate/fixture checkpoint `953553e`.
- Product commit: pending.
- Result evidence: pending.
- Outcome boundary: V1 proves command-hit isolation only; the three-behavior Flow authoring outcome remains owned by Wave C.
- Rollback: revert the narrow product commit; no contract, migration or persisted byte changes are involved.
- Semantic index impact: none
- Generated refresh: `task-board at claim and closure`
