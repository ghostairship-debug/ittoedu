# S1 Task Card — Flow Inline Terminal Key Isolation

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: Wave C 真实 Electron 纵切已重现 `Ctrl+Enter` 提交后编辑器立即重新进入；源码核对证明 rich/plain inline editor 的终止键继续冒泡到 block keyboard handler。仅在终止键已形成事件边界且聚焦回归证明单次提交/取消时可跳过，当前不满足，因此必须修复。
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 12 minutes
- Reviewer budget: 1
- Reviewer risk surface: rich/plain inline editor terminal-key propagation, single commit/cancel semantics, selection focus, and persisted text runs
- Evidence reuse: focused 证据绑定 product commit；Wave C 的真实 `Ctrl+Enter` 重试是后续 V2 验收。仅 docs/task-board/generated 变化时复用。
- Invalidating paths: `src/renderer/ui/FlowWorkspace.tsx`; `tests/unit/flowWorkspace.test.tsx`; `tests/e2e/stabilizationFlowAuthoring.spec.ts`
- Task ID: `stab-flow-14-inline-terminal-key-isolation`
- Phase / wave: `post-audit stabilization / C-flow-authoring repair`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Flow Keyboard Repair Worker / independent Flow interaction reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace; Integrator is the sole FlowWorkspace writer / codex/architecture-stabilization`
- Baseline HEAD: product commit `d6c95fc`; Wave C diagnostic spec `00a5165`; worktree clean at claim.
- Context: exact-source Bootstrap covers both inline editors, the outer block keyboard handler, focused workspace tests and Wave C trace.
- Freshness / relevant dirty inputs: the Wave C test observes the Enter sequence but leaves the rich editor mounted; independent review traced the same event from editor commit into the outer block re-entry branch. Plain editor has the same missing boundary and is repaired in the same event-semantic unit.
- Depends on: `stab-flow-13-toolbar-command-hit-isolation`
- Blocks: `stab-wave-c-flow-authoring`
- Risk statement: stopping propagation outside terminal branches could suppress ordinary typing/history shortcuts; failing to cover both editor variants would leave code/callout/section blocks inconsistent.
- Retry count / last failure class: `0 / product defect isolated before implementation`

## Product outcome

Finishing or cancelling Flow inline text editing performs exactly one terminal action: `Ctrl/Meta+Enter` commits once and returns to block focus, while `Escape` cancels once; neither key is reinterpreted by the containing block.

## Scope and acceptance

- Allowed write: terminal-key event boundaries in the two existing inline editors, focused rich/plain regressions, this task card and generated task-board state.
- Forbidden write: Flow contracts/schema, edit/history command semantics, Properties, Player/export, dependencies or unrelated refactors.
- Acceptance:
  - [ ] Rich `Ctrl/Meta+Enter` commits exactly one history entry, preserves the local text run, returns block focus and unmounts the editor.
  - [ ] Rich `Escape` cancels once, returns block focus and never bubbles into a second null selection.
  - [ ] Plain input/textarea terminal Enter and Escape use the same boundary without changing ordinary multiline Enter behavior.
- No new abstraction: stop propagation only inside the existing terminal branches.

## Minimal validation

- `npx vitest run tests/unit/flowWorkspace.test.tsx`
- `npx tsc --noEmit`
- `npx tsc -p tsconfig.e2e.json --noEmit`
- `git diff --check`
- Post-fix V2 evidence is the separately owned Wave C spec rerun; do not run full verify or another browser spec.

## Result and rollback

- Start evidence: product commit `d6c95fc`; Wave C diagnostic checkpoint `00a5165`.
- Result evidence: pending.
- Pipeline status: pending.
- Outcome status: pending V1 repair and V2 Wave C fulfillment.
- Outcome boundary: V1 proves terminal-key isolation only; the composed Flow outcome remains owned by Wave C.
- Rollback: revert the narrow product commit; no contract, migration or persisted-byte changes are involved.
- Semantic index impact: none
- Generated refresh: `task-board at claim and closure`
