# S1 Task Card — Flow Current-Contract Media Authoring

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-04 / FLOW-05 已确认 Flow 图片和视频在非浮层文档流中的基础作者能力不完整或不真实；若 flow-07 后现有字段已支持真实预览、视频 controls、替换、alt、题注、布局与正文顺序编辑，则跳过。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 18 minutes
- Reviewer budget: 1
- Evidence reuse: flow-07 的 Editor/Player layout 证据直接复用；本卡 focused 结果绑定 product commit。仅文档/generated 变化时复用，命中下列媒体作者实现、命令或 focused 测试时失效。
- Invalidating paths: src/renderer/ui/FlowWorkspace.tsx; src/renderer/ui/PropertiesTab.tsx; src/renderer/course/flowEditorCommands.ts; src/renderer/store/editorStore.ts; src/renderer/course/flowEditorSlice.ts; src/renderer/project/courseProjectArchive.ts; src/renderer/project/v9AssetAdapter.ts; tests/unit/flowWorkspaceMedia.test.tsx; tests/unit/flowMediaBlockEdit.test.ts
- Task ID: stab-flow-08-video-authoring-basics
- Phase / wave: post-audit stabilization / C-flow-authoring
- Status: claimed
- Owner / Reviewer / Integrator: Flow Media Authoring Worker / independent media-authoring reviewer / Coordinator
- Claimed at / released at: 2026-08-25 / not released
- Worktree / branch: shared integration workspace with FlowWorkspace/Properties media firewall / codex/architecture-stabilization
- Baseline HEAD: `96a0c74` (media width parity closed at `01eb6b0`; Spatial Properties changes are isolated by type branch)
- Context: exact-source Bootstrap confirmed image/video already use real sidecar URLs and existing update/replace/reorder/history commands, while the Editor video lacks controls and the Properties alt-text entry is image-only. Reuse flow-07 layout evidence; do not add a second media command path.
- Freshness / relevant dirty inputs: FlowWorkspace/Properties and both focused test paths were clean at claim. Baseline focused passed `12/12` but had no assertion for video controls, video alt authoring, undo or edited-video archive reopen.
- Depends on: stab-flow-07-media-layout-widths
- Blocks: stab-wave-c-flow-authoring
- Retry count: 0

## Product outcome

Flow 文档流中的图片和视频具备当前 V9 合同已经能够表达的最小高频作者能力：所见预览真实，视频可在编辑界面使用 controls 检查，资源可替换，图片/视频的替代文本、题注、布局与正文顺序可编辑且可保存。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-04、FLOW-05。
- 当前合同：只消费现有 FlowMediaBlock 的 assetId、mediaKind、altText、caption、layout、wrap 等字段，以及现有文档块顺序命令。
- Canonical write: 媒体属性和替换继续写当前 block；reorder 继续写正文 block 顺序；资产引用继续走现有 asset command/history。
- 非目标：不新增 poster、autoplay、loop、muted、start/end、crop、focal、object-fit、aspect 等字段；不把图片改成 Slide 自由节点；不偷偷扩 Schema 或 Published producer。

## Scope, locks and acceptance

- Allowed write: Flow 图片/视频当前字段的编辑入口、真实预览/controls、资源替换和正文 reorder 接线，以及最多两个 focused 单测。
- Forbidden write: contracts/schema、Published producer 新字段、媒体高级属性、Slide/Spatial 节点模型、Wave C E2E spec、dependencies/generated。
- Hotspot lock: FlowWorkspace/PropertiesTab 由 Coordinator 在 flow-07 后串行接入；不与公式或格式任务并行写同一区域。
- Acceptance:
  - [ ] 图片和视频都渲染当前 asset 的真实预览；视频预览提供可用 controls。
  - [ ] replace 走现有 asset/block 命令并可撤销，不创建脱离 block 的影子状态。
  - [ ] altText、caption、layout、wrap 仅在当前 media 类型有效时可编辑，保存重开仍来自同一字段。
  - [ ] 文档流媒体可通过现有结构命令调整正文顺序，不暴露自由节点 z-order。
  - [ ] 缺失的高级能力只转交 flow-11/12 产品裁决，不混入本卡。

## Minimal validation

- npx vitest run tests/unit/flowWorkspaceMedia.test.tsx
- npx vitest run tests/unit/flowMediaBlockEdit.test.ts
- 静态核对写入仅覆盖当前合同字段、没有 Slide carrier 或高级字段，并运行 git diff --check；不运行 Playwright。

## Result and rollback

- Result evidence: pending；完成时记录 product commit、图片/视频字段矩阵、focused 结果与 Reviewer 结论。
- Outcome boundary: V1 只证明当前合同内作者能力的实现候选；真实 Player 与浏览器综合路径由 Wave C 证明。
- Rollback: 独立 revert 媒体 UI/命令/测试提交；现有 persisted fields 无迁移。
- Semantic index impact: canonical-update if current-contract authoring capability becomes newly reachable
- Generated refresh: defer-to-wave-gate
