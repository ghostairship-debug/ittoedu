# S2 Product Decision — Flow Advanced Video Playback Contract

> 本卡只记录产品裁决；不得借本卡修改合同或实现。任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: docs
- Necessity / skip condition: 审计 FLOW-04 指出 poster、autoplay、loop、muted、start/end 等高级播放需求超出当前 FlowMediaBlock；若已有与当前源码一致、明确写出批准/拒绝/延后及退出条件的 Product Owner 决定，则复用并关闭本卡。
- Complexity delta: additive-exception
- Additive exception: 只有 Product Owner 明确批准后，才可按最新源码另建独立的 V9 additive contract implementation 卡与 consumer integration 卡；新增可选字段必须保持 strict 合同并单独评估 Published producer/Player。本卡不授权合同或产品代码修改。
- Validation ceiling: V0
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 决定绑定 audit revision 与 product commit；仅文档/task-board/generated 变化时复用，命中下列媒体合同或审计事实时必须重新核对。
- Invalidating paths: PRODUCT_DEEP_AUDIT_2026-08-24.md; src/shared/contracts/course-project-v9/types.ts; src/shared/contracts/course-project-v9/schema.ts; src/shared/contracts/published-course-v2/types.ts; src/shared/contracts/published-course-v2/schema.ts; docs/development-plan/tasks/stabilization/stab-flow-11-video-playback-contract-decision.md
- Task ID: stab-flow-11-video-playback-contract-decision
- Phase / wave: post-audit stabilization / E-contract-performance
- Status: `done`
- Owner / Reviewer / Integrator: Product Owner / independent media-contract reviewer / Coordinator
- Claimed at / released at: `2026-08-25T09:13:09+08:00 / 2026-08-25T09:13:09+08:00`
- Worktree / branch: `shared root, decision-only / codex/architecture-stabilization`
- Baseline HEAD: `70397bf`
- Context: compare FLOW-04 advanced playback requests with current FlowMediaBlock
- Freshness / relevant dirty inputs: re-read the invalidating paths before recording a decision
- Depends on: none
- Blocks: stab-audit-closure-gate
- Retry count: 0

## Product outcome

Product Owner 对 Flow 高级视频播放字段只作批准、拒绝或延后裁决，并明确首个 consumer、当前合同内替代目标与退出条件；当前合同内的预览、controls、替换和基础布局仍由 flow-08 完成。

## Current contract and decision boundary

- 审计依据：FLOW-04。
- 当前合同：FlowMediaBlock 只有 assetId、mediaKind、altText、caption、layout、wrap；没有 poster、autoplay、loop、muted、start/end 字段。
- 首个 consumer：需要在真实 Player 中按教师设置呈现封面或受控起止时间的 Flow 视频块。
- 当前替代目标：基础作者能力继续走 flow-08；复杂播放编排优先评估现有 Runtime/Component 是否已能满足，而不是立即扩 Native media 合同。
- 退出条件：拒绝则保持当前合同；延后则写明真实课件数量、无法由 Runtime/Component 替代的需求或可访问性/浏览器策略成熟度等重开信号。

## Product Owner decision — 2026-08-25

- Decision: `deferred`。
- Rationale: 高级视频播放不是低风险字段补充。poster、autoplay、loop、muted 与 start/end 必须在 strict V9、Published V2 producer、编辑器预览和真实 Player 中保持一致，还要明确浏览器自动播放限制、键盘/读屏可访问性与导出降级语义；当前直接实现属于中高难度、跨合同风险。
- Existing alternatives: 继续使用 flow-08 已交付的预览、controls、替换和基础布局；需要复杂播放编排时，先以现有 Runtime/Component 做有界方案验证，而不是扩张 Native `FlowMediaBlock`。
- Quantified reopen condition: 至少 `3` 份真实课件需要 poster 或受控 start/end（或等价高级播放策略），并有记录证明 Runtime/Component 有界 spike 无法满足；同时必须先形成浏览器自动播放、键盘/读屏可访问性以及不支持导出目标的降级政策，再另建 contract implementation 与 consumer integration 卡。
- Contract boundary: 本决定不新增媒体字段，不改变 Published producer/Player，不扩大 flow-08 的基础能力范围。

## Scope, acceptance and forbidden work

- Allowed write: 仅本任务卡中的决定记录。
- Forbidden write: 所有产品代码、contracts/schema、Published producer、Editor/Player/export、测试文件、依赖、generated、任何预造实现卡或测试路径。
- Acceptance:
  - [x] 明确记录 `deferred` 及理由。
  - [x] 记录首个 consumer、替代目标、量化重开条件和浏览器/可访问性边界。
  - [x] 本次未批准实现；未来只有满足重开条件后才可另建精确的 contract implementation 与 consumer integration 卡。

## Minimal validation

- 静态核对 FLOW-04、当前 FlowMediaBlock 与 Published V2 producer 的字段边界。
- 核对决定完整、没有混入 flow-08 基础修复或实现测试命令，并运行 git diff --check。

## Result and rollback

- Decision: `deferred`；Product Owner 于 `2026-08-25` 授权对高难度或高风险项先延后，本项因跨合同、浏览器政策与可访问性风险满足该条件。
- Result evidence: audit revision `5c512f9`；最新相关产品实现基线 `58c1e45`；独立 decision-scope Reviewer 复核当前 FlowMediaBlock 与 Published V2 producer/Player 边界后 `APPROVE`。
- Pipeline status: 仅完成 V0 静态合同核对与本卡 `git diff --check`；未运行产品测试，也未产生产品提交。
- Outcome status: 高级视频播放字段与 UI 仍未实现；flow-08 的基础视频作者能力及 Runtime/Component 替代评估路径保持不变。
- Outcome boundary: 本卡只证明产品裁决、替代路径与重开门槛已完整记录，不证明高级播放合同或 UI 已实现，也不把 `deferred` 计为功能完成。
- Rollback: 决定记录可单独 revert；未来合同/consumer 由各自独立提交回滚。
- Semantic index impact: none until a later approved contract task lands
- Generated refresh: none
