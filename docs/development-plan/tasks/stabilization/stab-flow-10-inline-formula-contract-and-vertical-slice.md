# S2 Product Decision — Inline Formula Contract

> 本卡只记录产品裁决；不得借本卡修改合同或实现。任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: docs
- Necessity / skip condition: 审计 FLOW-12 指出正文夹杂公式无法由当前独立 formula block 表达。若已有与当前源码一致、明确写出批准/拒绝/延后及退出条件的 Product Owner 决定，则复用并关闭本卡。
- Complexity delta: additive-exception
- Additive exception: 只有 Product Owner 明确批准后，才可按最新源码另建独立的 V9 additive contract implementation 卡与 consumer integration 卡；可选字段必须保持现有 strict 合同。本卡不授权新增字段、修改 Schema/Published producer 或实现纵切。
- Validation ceiling: V0
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 决定绑定 audit revision 与 product commit；仅文档/task-board/generated 变化时复用，命中下列 V9/Published 合同或审计事实时必须重新核对。
- Invalidating paths: PRODUCT_DEEP_AUDIT_2026-08-24.md; src/shared/contracts/course-project-v9/types.ts; src/shared/contracts/course-project-v9/schema.ts; src/shared/contracts/published-course-v2/types.ts; src/shared/contracts/published-course-v2/schema.ts; docs/development-plan/tasks/stabilization/stab-flow-10-inline-formula-contract-and-vertical-slice.md
- Task ID: stab-flow-10-inline-formula-contract-and-vertical-slice
- Phase / wave: post-audit stabilization / E-contract-performance
- Status: product-decision
- Owner / Reviewer / Integrator: Product Owner / independent contract-scope reviewer / Coordinator
- Claimed at / released at: — / —
- Worktree / branch: decision-only
- Baseline HEAD: record when deciding
- Context: compare FLOW-12 with current V9 and Published V2 contracts
- Freshness / relevant dirty inputs: re-read the invalidating paths before recording a decision
- Depends on: none
- Blocks: stab-audit-closure-gate
- Retry count: 0

## Product outcome

Product Owner 对“Flow 正文内联公式”只作一个可执行裁决：批准、拒绝或延后。决定必须说明首个真实 consumer、当前合同内替代目标和重新打开议题的退出条件，避免把未来完整实现伪装成当前稳定化修复。

## Current contract and decision boundary

- 审计依据：FLOW-12。
- 当前合同：FlowRichText 只有 text / runs；公式是独立 FlowFormulaBlock，拥有 formulaId、accessibleText 与 AST。当前不能诚实表达正文中的 inline formula。
- 若批准，决定必须至少确认未来合同是否覆盖稳定 ID/AST/a11y，以及 paragraph、heading、quote、list、table cell 中的删除、复制粘贴、撤销、保存重开、Player、打印与 PPTX 边界；这些只是新卡的输入，不在本卡实现。
- 首个 consumer：教师在 Flow paragraph 中输入“文字—公式—文字”，保存重开后由真实 Player 读取。
- 当前替代目标：继续使用独立公式块，并允许纯文本/Unicode 公式满足低复杂度内容。
- 退出条件：拒绝则关闭该方向；延后则必须写明可量化的重开信号，例如多个真实课件无法接受独立公式块且现有替代路径验证失败。

## Scope, acceptance and forbidden work

- Allowed write: 仅本任务卡中的决定记录。
- Forbidden write: 所有产品代码、contracts/schema、Published producer、Editor/Player/export、测试文件、依赖、generated、任何预造实现卡或测试路径。
- Acceptance:
  - [ ] 明确记录批准、拒绝或延后三者之一及理由。
  - [ ] 记录首个 consumer、替代目标、退出/重开条件和合同兼容边界。
  - [ ] 若批准，明确下一步是基于最新源码另建精确的 contract implementation 与 consumer integration 卡，而不是领取本卡编码。

## Minimal validation

- 静态核对 FLOW-12、当前 V9 FlowRichText / FlowFormulaBlock 与 Published V2 producer 边界。
- 核对决定字段完整、没有产品写路径或实现测试命令，并运行 git diff --check。

## Result and rollback

- Decision: pending Product Owner；仅允许填入 approved / rejected / deferred 之一及理由。
- Result evidence: pending；完成时记录 audit revision、product commit 与 Reviewer 结论。
- Outcome boundary: 本卡只证明产品裁决已完整记录，不证明合同或功能已经实现。
- Rollback: 决定记录可单独 revert；若未来实现已开始，必须由其独立任务和提交处理，不能通过本卡回滚产品代码。
- Semantic index impact: none until a later approved contract task lands
- Generated refresh: none

