# S2 Task Card — Flow Formatting Surface State

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-02 / FLOW-07 / FLOW-08 已确认上下文工具栏会在长短形态间跳变，且 caret、range、整块与混合格式值没有一致反映；若 Wave A 后主要工具几何稳定且四种选择状态已由真实编辑状态驱动，则跳过。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 18 minutes
- Reviewer budget: 1
- Evidence reuse: focused 结果绑定 product commit；Wave A 的文本选择证据直接复用。本卡后仅文档/generated 变化时复用，命中下列 toolbar、selection adapter、Properties 或 focused 测试时失效。
- Invalidating paths: src/renderer/ui/FlowBlockContextToolbar.tsx; src/renderer/ui/FlowWorkspace.tsx; src/renderer/ui/PropertiesTab.tsx; src/renderer/authoring/flowTextEdit.ts; tests/unit/flowBlockContextToolbar.test.tsx; tests/unit/flowProductIntegration.test.tsx
- Task ID: stab-flow-04-stable-context-toolbar
- Phase / wave: post-audit stabilization / C-flow-authoring
- Status: claimed
- Owner / Reviewer / Integrator: Flow Formatting Worker / independent rich-text reviewer / Coordinator
- Claimed at / released at: 2026-08-25 / not released
- Worktree / branch: shared integration workspace with Flow Formatting firewall / codex/architecture-stabilization
- Baseline HEAD: `c9c290a` (formula entry closed at `7b0676c`; integrated second-lane evidence at `b737820`)
- Context: exact-source Bootstrap confirmed the toolbar currently changes content/geometry by edit kind, exposes no selection-derived mixed state, and Properties reads only the first run; use one pure derivation in `flowTextEdit.ts` and preserve the existing collapsed-range no-op contract.
- Freshness / relevant dirty inputs: worktree and every listed toolbar/Properties/test path were clean at claim; Wave A selection and flow-03 formula entry changes are part of the baseline and must be preserved.
- Depends on: stab-wave-a-core-usability
- Blocks: stab-wave-c-flow-authoring
- Retry count: 0

## Product outcome

Flow 文本编辑时主要格式工具保持稳定位置，高频能力直接可达，低频能力渐进披露；工具栏和属性区准确反映 caret、range、整块与 mixed selection，并把格式写到真实 runs。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-02、FLOW-07、FLOW-08。
- 当前合同：继续使用 V9 现有 FlowRichText / runs 能力和现有格式命令，不增加并行的 toolbar state 或格式缓存。
- Canonical write: UI 值从当前 selection/block 推导，命令仍写回唯一 block/runs 并进入现有 history。
- 非目标：不新增富文本字段、不复制 Slide 文本框模型、不实现 inline formula、不扩充低频格式全集。

## Scope, locks and acceptance

- Allowed write: Flow 上下文工具栏的稳定壳层、渐进披露、selection-to-format 派生与现有 runs 命令接线，以及最多两个 focused 单测。
- Forbidden write: contracts/schema、Published producer、媒体布局、节点大纲、Wave C E2E spec、dependencies/generated。
- Hotspot lock: FlowWorkspace 只在 Wave A 和公式入口接入边界后串行合入；PropertiesTab 同期只允许本卡写 Flow formatting 区。
- Acceptance:
  - [ ] 常用控件所在壳层不随 selection 长短或 mixed 值改变尺寸/锚点。
  - [ ] caret 显示插入点格式，range 显示选区格式，整块显示块级值，mixed 值有明确不确定态。
  - [ ] 对 range 的格式命令只修改选中 runs；整块命令不伪装为选区格式。
  - [ ] 低频控件可发现但默认不挤占主要工具几何。

## Minimal validation

- npx vitest run tests/unit/flowBlockContextToolbar.test.tsx
- npx vitest run tests/unit/flowProductIntegration.test.tsx
- 静态核对 UI 状态来自真实 selection/block 且未新增持久化镜像，并运行 git diff --check；不运行 Playwright。

## Result and rollback

- Result evidence: pending；完成时记录 product commit、四种 selection 状态矩阵、focused 结果与 Reviewer 结论。
- Outcome boundary: V1 只证明格式状态和命令接线的实现候选；真实拖选后的格式纵切由 Wave C 证明。
- Rollback: 独立 revert toolbar/adapter/测试提交，恢复旧呈现；不改合同或数据。
- Semantic index impact: canonical-update only if an existing authoring capability description changes
- Generated refresh: defer-to-wave-gate
