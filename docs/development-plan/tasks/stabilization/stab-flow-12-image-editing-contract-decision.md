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
- Status: `done`
- Owner / Reviewer / Integrator: Product Owner / independent image-contract reviewer / Coordinator
- Claimed at / released at: `2026-08-25T09:13:09+08:00 / 2026-08-25T09:13:09+08:00`
- Worktree / branch: `shared root, decision-only / codex/architecture-stabilization`
- Baseline HEAD: `70397bf`
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

## Product Owner decision — 2026-08-25

- Decision: `deferred`。
- Rationale: 可保存重开的 crop/focal 不是低风险画布样式。它需要先确定裁切坐标、焦点、object-fit/aspect 与素材替换的稳定语义，再贯穿 strict V9、Published V2、编辑器即时反馈、真实 Player 和各导出目标；当前直接实现属于中高难度、跨合同与渲染一致性风险。
- Existing alternatives: 继续使用 flow-08 的预览、替换、alt、题注和基础布局；可预先处理图片资产，需要自由构图时显式使用 Slide 自由节点，不把 Flow 图片静默转换 carrier。
- Quantified reopen condition: 至少 `3` 份真实课件需要保存重开后仍一致的 crop/focal，并有评审记录证明预处理资产与显式 Slide 自由节点都不可接受；同时必须先定义 Editor/Player/导出的一致性矩阵、素材替换语义和不支持目标的降级策略，再另建 contract implementation 与 consumer integration 卡。
- Contract boundary: 本决定不新增图片字段，不改变 Flow 文档流 carrier，也不授权用 Slide 行为冒充 Flow 高级图片编辑。

## Scope, acceptance and forbidden work

- Allowed write: 仅本任务卡中的决定记录。
- Forbidden write: 所有产品代码、contracts/schema、Published producer、Editor/Player/export、测试文件、依赖、generated、任何预造实现卡或测试路径。
- Acceptance:
  - [x] 明确记录 `deferred` 及理由。
  - [x] 记录首个 consumer、替代目标、量化重开条件和 Editor/Player/export 一致性边界。
  - [x] 本次未批准实现；未来只有满足重开条件后才可另建精确的 contract implementation 与 consumer integration 卡。

## Minimal validation

- 静态核对 FLOW-05、当前 FlowMediaBlock 与 Published V2 producer 的字段边界。
- 核对决定完整、没有混入 flow-08 基础修复或实现测试命令，并运行 git diff --check。

## Result and rollback

- Decision: `deferred`；Product Owner 于 `2026-08-25` 授权对高难度或高风险项先延后，本项因跨合同、素材语义与多渲染目标一致性风险满足该条件。
- Result evidence: audit revision `5c512f9`；最新相关产品实现基线 `58c1e45`；独立 decision-scope Reviewer 复核当前 FlowMediaBlock 与 Published V2 producer/Player/export 边界后 `APPROVE`。
- Pipeline status: 仅完成 V0 静态合同核对与本卡 `git diff --check`；未运行产品测试，也未产生产品提交。
- Outcome status: 高级图片 crop/focal 等能力仍未实现；flow-08 基础图片能力、资产预处理与显式 Slide 自由节点替代路径保持不变。
- Outcome boundary: 本卡只证明产品裁决、替代路径与重开门槛已完整记录，不证明高级图片合同或 UI 已实现，也不把 `deferred` 计为功能完成。
- Rollback: 决定记录可单独 revert；未来合同/consumer 由各自独立提交回滚。
- Semantic index impact: none until a later approved contract task lands
- Generated refresh: none
