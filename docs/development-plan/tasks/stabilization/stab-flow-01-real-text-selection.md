# S2 Task Card — Flow Text Interaction Foundation

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-01 / FLOW-10 已确认 Flow 正文真实拖选会被父级手势打断，空编辑 root 又可能没有稳定的非零 rect 与 caret 几何；只有在当前源码已经同时满足真实拖选、空块首字符前后几何稳定及 IME 不回归时才跳过。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: focused 结果绑定 product commit；仅任务卡、报告、task-board 或 generated 变化时复用，命中下列交互实现、样式或 focused 测试时失效。Wave A 统一补真实 Chromium 证据，本卡不重复运行 Playwright。
- Invalidating paths: src/renderer/ui/FlowWorkspace.tsx; src/renderer/authoring/flowTextEdit.ts; src/renderer/styles/globals.css; tests/unit/flowInlineTextEditor.test.tsx; tests/unit/flowWorkspace.test.tsx
- Task ID: stab-flow-01-real-text-selection
- Phase / wave: post-audit stabilization / A-core
- Status: claimed
- Owner / Reviewer / Integrator: Flow Text Worker / independent interaction reviewer / Coordinator
- Claimed at / released at: 2026-08-25 / —
- Worktree / branch: shared workspace with file firewall / codex/architecture-stabilization
- Baseline HEAD: 5c512f9
- Context: fresh `repo:context` query on `Flow native text selection empty editable root caret IME` returned low confidence; manual Bootstrap must resolve the exact pointer owner, empty-root DOM and composition path before writing.
- Freshness / relevant dirty inputs: repo-index check passed at claim; worktree was clean and no relevant dirty inputs were present.
- Hotspot locks: `FlowWorkspace.tsx`, `flowTextEdit.ts`, Flow text styles, and the two focused Flow tests are reserved to this card until integration.
- Depends on: none
- Blocks: stab-wave-a-core-usability; stab-flow-03-formula-edit-entry; stab-flow-04-stable-context-toolbar
- Retry count: 0

## Product outcome

Flow 的文本块先成为可靠的原生文本编辑面：用户能拖选任意范围；空 paragraph、heading、quote、list 与 table cell 能显示稳定 caret；输入首字符前后不会因 root 宽高跳变而错位；中文 IME 组合输入保持可用。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-01、FLOW-10。
- 当前合同：只使用 Course Project V9 已有 FlowRichText / runs 和现有块判别器；为稳定空 root 使用的 DOM 占位不得持久化为正文。
- Canonical write: 文本仍通过现有 Flow text command/history 写回原 block，不增加第二份 editor state。
- 非目标：不增加 Schema 字段、不实现 inline formula、不改工具栏信息架构、不在本卡声明真实浏览器结果，也不重构整个 FlowWorkspace。

## Scope, locks and acceptance

- Allowed write: Flow 文本编辑 pointer/selection 边界、空 root 几何与 composition 处理，以及最多两个 focused 单测。
- Forbidden write: contracts/schema、Published producer、Player、媒体、全局层/教师控制器、Wave A E2E spec、dependencies/generated。
- Hotspot lock: FlowWorkspace 写入顺序固定为“选区/空块 → 页面 inert → 公式 → 工具栏/媒体”；本卡是该热点第一写入者。
- Acceptance:
  - [ ] pointer 事件不再把浏览器原生 range 拖选误判为块拖拽，选择可跨多个文字 run。
  - [ ] 空 paragraph、heading、quote、list item 与 table cell 的编辑 root 都有非零 rect 和可见 caret。
  - [ ] 首字符输入前后 caret 与 root 的基准几何稳定，不靠持久化假字符。
  - [ ] compositionstart/update/end 路径不被 selection 修复截断或重复提交。

## Minimal validation

- npx vitest run tests/unit/flowInlineTextEditor.test.tsx
- npx vitest run tests/unit/flowWorkspace.test.tsx
- 静态核对未新增持久化占位或 Schema 写入，并运行 git diff --check。真实 Chromium 拖选与 IME 由 stab-wave-a-core-usability 统一验证。

## Result and rollback

- Result evidence: pending；完成时记录 product commit、focused 结果与 Reviewer 结论。
- Outcome boundary: V1 只证明交互状态与 DOM 几何的实现候选；不声称真实 Chromium 已通过或整体 Flow 编辑体验 accepted。
- Rollback: 一个可独立 revert 的实现/测试提交恢复旧 selection 与空 root 行为；不迁移数据。
- Semantic index impact: none
- Generated refresh: defer-to-wave-gate
