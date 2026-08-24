# S1 Task Card — Flow Formula Edit Entry

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-11 已确认公式编辑依赖狭窄命中区域或合成 dblclick，首次重渲染后真实 click target 不稳定；若 Wave A 后当前实现已提供稳定、显式且可重复进入的公式入口，则跳过。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 12 minutes
- Reviewer budget: 1
- Evidence reuse: focused 结果绑定 product commit；仅文档/generated 变化时复用，命中下列公式入口、FlowWorkspace 或 focused 测试时失效。真实 Chromium 点击纵切由 Wave C 统一运行。
- Invalidating paths: src/renderer/ui/FlowWorkspace.tsx; src/renderer/ui/PublishedFormulaPaint.tsx; src/renderer/ui/FlowFormulaBlockProperties.tsx; tests/unit/flowWorkspace.test.tsx; tests/unit/flowProductIntegration.test.tsx
- Task ID: stab-flow-03-formula-edit-entry
- Phase / wave: post-audit stabilization / C-flow-authoring
- Status: claimed
- Owner / Reviewer / Integrator: Flow Formula Worker / independent formula-entry reviewer / Coordinator
- Claimed at / released at: 2026-08-25 / not released
- Worktree / branch: shared integration workspace with FlowWorkspace/formula firewall / codex/architecture-stabilization
- Baseline HEAD: 1347c0b (Wave A and insertion affordance integrated; product bytes end at a2f7386)
- Context: generated repo-index is intentionally stale after first-wave product commits; exact-source manual Bootstrap must re-check rendered formula target replacement, current editing state and visible entry after Wave A before writing.
- Freshness / relevant dirty inputs: worktree and every listed product/test path were clean at claim; the existing `flowProductIntegration.test.tsx` now includes the closed cross-01 scope matrix and must be preserved.
- Depends on: stab-wave-a-core-usability
- Blocks: stab-wave-c-flow-authoring
- Retry count: 0

## Product outcome

Flow 的独立公式块在首次重渲染后仍能从正文可见区域稳定进入编辑；连续两次真实点击不会因 target 替换而失效，同时界面提供不依赖猜测双击位置的显式入口。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-11。
- 当前合同：只修复现有独立 formula block 的作者入口；公式内容仍通过现有 command 写回当前 V9 字段。
- Canonical write: 继续使用单一 Flow block selection/editing 状态和现有 history。
- 非目标：不实现正文内联公式、不新增合同字段、不改公式 AST、不顺带重做工具栏或公式排版。

## Scope, locks and acceptance

- Allowed write: 独立公式块的 hit target、显式编辑 affordance、重渲染后的入口状态，以及最多两个 focused 单测。
- Forbidden write: contracts/schema、Published producer、Player/export、inline formula、Wave C E2E spec、dependencies/generated。
- Hotspot lock: 仅在 Wave A 完成“选区/空块 → 页面 inert”后进入 FlowWorkspace；公式改动先于工具栏/媒体接入。
- Acceptance:
  - [ ] 首次重渲染后，正文可见 target 仍能进入现有公式编辑状态。
  - [ ] 两次连续真实 click 的语义在组件层保持稳定，不以仅派发合成 dblclick 的测试代替。
  - [ ] 有明确可发现的公式编辑入口，狭窄左侧区域不再是唯一入口。
  - [ ] 普通文本块 target 和选择行为不被公式入口接管。

## Minimal validation

- npx vitest run tests/unit/flowWorkspace.test.tsx
- npx vitest run tests/unit/flowProductIntegration.test.tsx
- 静态核对无 inline formula 或合同写入，并运行 git diff --check；不运行 Playwright、全量 verify 或 desktop build。

## Result and rollback

- Result evidence: pending；完成时记录 product commit、入口状态断言与 Reviewer 结论。
- Outcome boundary: V1 只证明独立公式入口的实现候选；真实点击与首轮渲染纵切由 Wave C 证明。
- Rollback: 独立 revert 本卡 UI/测试提交，恢复原入口；不迁移 persisted data。
- Semantic index impact: none
- Generated refresh: defer-to-wave-gate
