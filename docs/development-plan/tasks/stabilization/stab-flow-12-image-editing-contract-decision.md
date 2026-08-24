# S2 Product Decision — Flow Advanced Image Editing Contract

> 本卡只记录产品裁决；不得借本卡修改合同或实现。任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: docs
- Necessity / skip condition: 审计 FLOW-05 指出 crop、focal、object-fit、aspect 等高级图片编辑需求超出当前 FlowMediaBlock；若已有与当前源码一致、明确写出批准/拒绝/延后及退出条件的 Product Owner 决定，则复用并关闭本卡。
- Complexity delta: additive-exception
- Additive exception: 只有 Product Owner 明确批准后，才可按最新源码另建独立的 V9 additive contract implementation 卡与 consumer integration 卡；新增可选字段必须保持 strict 合同并单独评估 Published producer/Player/export。本卡不授权合同或产品代码修改。
- Validation ceiling: V0
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 决定绑定 audit revision 与 product commit；仅文档/task-board/generated 变化时复用，命中下列媒体合同或审计事实时必须重新核对。
- Invalidating paths: PRODUCT_DEEP_AUDIT_2026-08-24.md; src/shared/contracts/course-project-v9/types.ts; src/shared/contracts/course-project-v9/schema.ts; src/shared/contracts/published-course-v2/types.ts; src/shared/contracts/published-course-v2/schema.ts; docs/development-plan/tasks/stabilization/stab-flow-12-image-editing-contract-decision.md
- Task ID: stab-flow-12-image-editing-contract-decision
- Phase / wave: post-audit stabilization / E-contract-performance
- Status: product-decision
- Owner / Reviewer / Integrator: Product Owner / independent image-contract reviewer / Coordinator
- Claimed at / released at: — / —
- Worktree / branch: decision-only
- Baseline HEAD: record when deciding
- Context: compare FLOW-05 advanced image requests with current FlowMediaBlock
- Freshness / relevant dirty inputs: re-read the invalidating paths before recording a decision
- Depends on: none
- Blocks: stab-audit-closure-gate
- Retry count: 0

## Product outcome

Product Owner 对 Flow 高级图片编辑字段只作批准、拒绝或延后裁决，并明确首个 consumer、当前合同内替代目标与退出条件；当前合同内的预览、替换、alt、题注、布局和顺序仍由 flow-08 完成。

## Current contract and decision boundary

- 审计依据：FLOW-05。
- 当前合同：FlowMediaBlock 只有 assetId、mediaKind、altText、caption、layout、wrap；没有 crop、focal、object-fit、aspect 等持久化表达。
- 首个 consumer：教师在 Flow 文档流中为一张图片设置可保存、可重开的裁切/焦点，并由真实 Player 保持同一构图。
- 当前替代目标：基础图片作者能力继续走 flow-08；需要自由构图时使用 Slide 自由节点或预先处理资产，但不得把 Flow 图片静默改成 Slide carrier。
- 退出条件：拒绝则保持当前合同；延后则写明真实课件需求数量、替代路径失败或导出一致性边界成熟等重开信号。

## Scope, acceptance and forbidden work

- Allowed write: 仅本任务卡中的决定记录。
- Forbidden write: 所有产品代码、contracts/schema、Published producer、Editor/Player/export、测试文件、依赖、generated、任何预造实现卡或测试路径。
- Acceptance:
  - [ ] 明确记录批准、拒绝或延后三者之一及理由。
  - [ ] 记录首个 consumer、替代目标、退出/重开条件和 Editor/Player/export 一致性边界。
  - [ ] 若批准，明确另建精确的 contract implementation 与 consumer integration 卡；本卡不得领取编码。

## Minimal validation

- 静态核对 FLOW-05、当前 FlowMediaBlock 与 Published V2 producer 的字段边界。
- 核对决定完整、没有混入 flow-08 基础修复或实现测试命令，并运行 git diff --check。

## Result and rollback

- Decision: pending Product Owner；仅允许填入 approved / rejected / deferred 之一及理由。
- Result evidence: pending；完成时记录 audit revision、product commit 与 Reviewer 结论。
- Outcome boundary: 本卡只证明产品裁决已完整记录，不证明高级图片合同或 UI 已实现。
- Rollback: 决定记录可单独 revert；未来合同/consumer 由各自独立提交回滚。
- Semantic index impact: none until a later approved contract task lands
- Generated refresh: none

