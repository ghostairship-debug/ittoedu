# S1 Task Card — Contextual Interaction Entry from Properties

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs
- Necessity / skip condition: 审计 `CROSS-03` 要求先证明真实 local Interaction carrier。当前源码已确认 Flow/Spatial 均返回 `no-local-interaction-carrier`，Properties 已诚实说明限制并提供“打开互动与动画”，Automation 也显示 unavailable；因此满足 skip condition，本卡以零产品改动关闭，不创建 local carrier、空面板或重复入口。
- Complexity delta: neutral
- Validation ceiling: V0
- Validation budget: 5 minutes
- Reviewer budget: 1
- Evidence reuse: 复用绑定 `d2371aa` 当前源码的静态 carrier、Properties 文案和 Automation unavailable 证据；仅下列三个产品路径改变时失效，任务卡、报告、task-board 或 generated-only 变化不触发产品验证。
- Invalidating paths: `src/renderer/interactions/interactionAuthoringView.ts`; `src/renderer/ui/PropertiesTab.tsx` 的 Flow/Spatial interaction-unavailable 分支；`src/renderer/ui/AutomationTab.tsx` 的 local unavailable 分支
- Task ID: `stab-cross-02-interaction-properties-entry`
- Phase / wave: `post-audit stabilization / D-cross-surface`
- Status: `done`
- Owner / Reviewer / Integrator: `Interaction Entry Auditor / independent skip-evidence reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: `d2371aa`
- Context: `bootstrap-manual exact-source review of the three Invalidating paths`
- Freshness / relevant dirty inputs: `product paths match audit baseline; no product edit was made by this card`
- Depends on: `none`
- Blocks: `stab-audit-closure-gate`
- Retry count: `0`

## Product outcome

Flow/Spatial 没有 local Interaction carrier 时继续诚实显示不可用及现有 Automation 入口，不为界面对称性制造无法保存的局部规则能力。

## Current fact, canonical write and non-goals

- Current source fact: `interactionAuthoringView.ts#selectLocalInteractionAuthoringView` 对非 Slide 的 Flow/Spatial 返回 `availability: 'unavailable'` 与 `reason: 'no-local-interaction-carrier'`。
- Current UI fact: `PropertiesTab.tsx` 已说明“没有元素级局部 Interaction carrier”并提供“打开互动与动画”；`AutomationTab.tsx` 已渲染 `local-interaction-unavailable`。
- Canonical write: 本卡没有导航或工程写入；现有 Automation 中只有真实可用的 target 才能经既有 command/history 写入唯一 `CourseProjectDocument`。
- 非目标：不新增 local carrier、合同、Properties 控件、空 InteractionEditor、global-to-local 复制或产品测试。

## Scope, locks and acceptance

- Allowed write: only this task card's skip evidence.
- Required read: the three Invalidating paths and the audit `CROSS-03` statement.
- Forbidden write: all product source/tests, Interaction Schema/protocol、Player、Store、Properties/Automation behavior、dependencies/generated。
- Hotspot lock: none; this is a read-only docs closure.
- Acceptance:
  - [x] Flow/Spatial 当前没有真实 local carrier consumer。
  - [x] Properties 已有诚实限制说明和 Automation 入口，Automation 已有 unavailable 状态。
  - [x] 没有新增 local carrier、空面板、规则旁路或 canonical/history 写入。
  - [x] `CROSS-03` 以 skip evidence 关闭，而不是伪造实现需求。

## Minimal validation

- 静态核对 `interactionAuthoringView.ts` 的 `no-local-interaction-carrier`、Properties 的诚实说明/入口和 Automation 的 unavailable 分支。
- 运行本卡差异卫生检查；未运行任何产品套件、构建或生成器。

## Result and rollback

- Result evidence: `skip / no product change`; baseline `d2371aa` 的三条当前源码事实满足 necessity/skip condition，Reviewer 只需复核路径与文案，不运行产品套件。
- Outcome boundary: 仅确认当前“无 local carrier + 诚实不可用”是正确产品事实；不新增 Interaction 能力，也不声称 Flow/Spatial 互动整体 `accepted`。
- Rollback: 只需回退本任务卡文档；没有产品提交、用户数据迁移或运行状态变化。
- Semantic index impact: `none`
- Generated refresh: `not-required`
