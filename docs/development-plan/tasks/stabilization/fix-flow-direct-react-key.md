# S0 Task Card — Flow Direct React Key

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: 当前 focused Flow 测试可复现 React `key` spread warning；若 claim 时 warning 已消失且 direct key 已存在，则跳过实现并记录现状。
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 5 minutes
- Reviewer budget: 0
- Evidence reuse: 复用绑定 implementation product commit 的 focused 结果；后续仅任务卡、报告、task-board 或 generated 变化时不重跑。
- Invalidating paths: `src/renderer/ui/FlowWorkspace.tsx`; `tests/unit/flowWorkspace.test.tsx`; React/Vitest dependency or test configuration
- Task ID: `fix-flow-direct-react-key`
- Phase / wave: `current stabilization / simple fix`
- Status: `done`
- Owner / Reviewer / Integrator: `Flow Fix Worker / none / Coordinator`
- Claimed at / released at: `2026-08-24T16:55:56+08:00 / 2026-08-24T17:02:03+08:00`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `4a98535`
- Context / freshness: reproduce the focused warning at claim; repo-index optional
- Depends on: `none`
- Blocks: current Flow/UI warning-free integration
- Retry count: `0`

## Product outcome

Flow block roots retain stable React identity without emitting the `key`-prop spread warning; IME, selection, keyboard, nesting and DnD behavior remain unchanged.

## Evidence, scope and acceptance

- Current fact: `FlowWorkspace.tsx` puts `key` inside `frameProps` and spreads it into the root `<div>`, which React warns about.
- Allowed write: the block-root key construction in `src/renderer/ui/FlowWorkspace.tsx`, `tests/unit/flowWorkspace.test.tsx`, and this card.
- Forbidden write: Workspace, Store, App, Properties, contracts, Flow commands/history/model, dependencies and other Surfaces.
- Non-goals: no render-tree extraction, UI redesign, cross-Surface refactor, warning suppression or weakened assertion.
- Acceptance: apply `key={blockView.blockId}` directly; leave no key in spread props; preserve adjacent Flow behavior.
- Change / retry budget: one JSX fix, at most one focused test adjustment and two implementation attempts.

## Minimal validation

- `npx vitest run tests/unit/flowWorkspace.test.tsx`
- Assert no key-spread warning; `git diff --check`.

## Result and rollback

- Product commit / result: `50df8fb` (`fix(flow): pass block key directly to React`); `key={blockView.blockId}` now sits directly on the Flow block root and is absent from `frameProps`; no test or adjacent Flow behavior code changed.
- Validation evidence: at product commit `50df8fb`, `npx vitest run tests/unit/flowWorkspace.test.tsx` passed `12/12`; `git diff --check` passed. The existing jsdom Canvas `getContext` diagnostic remained non-blocking and unrelated.
- Review evidence: S0 reviewer budget is `0`; the worker and Coordinator inspected the exact one-line semantic move and found no scope expansion.
- Pipeline / outcome: focused pipeline `pass`; warning fix is an `engineering candidate`; visual or teacher acceptance is not claimed.
- Rollback: `git revert 50df8fb` restores the single JSX change from the claim baseline.
- Remaining risk: very low and limited to focused Flow reconciliation behavior; no public or persisted contract changes.
- Semantic index impact: `none`
- Generated refresh: `defer-to-wave-gate`
