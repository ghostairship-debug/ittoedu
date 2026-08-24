# S1 Task Card — Flow Content Outline and Overlays

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: 审计 FLOW-06 / FLOW-09 已确认正文顺序与浮层 z-order 混在同一图层心智模型中，ownership 与定位空间命名也会误导操作；若 Wave A 后大纲已按真实文档结构呈现、只有浮层显示 z-order，并清楚区分 ownership 与 coordinate space，则跳过。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: focused 结果绑定 product commit；仅文档/generated 变化时复用，命中下列 Nodes、Flow 投影或 focused 测试时失效。Wave A 文本基础证据可复用。
- Invalidating paths: src/renderer/ui/NodesTab.tsx; src/renderer/course/flowEditorView.ts; src/renderer/course/flowOverlayProjection.ts; tests/unit/flowUnifiedLayerEntry.test.tsx; tests/unit/flowUnifiedLayers.test.tsx; tests/unit/flowEditorView.test.ts
- Task ID: stab-flow-05-content-outline-and-overlays
- Phase / wave: post-audit stabilization / C-flow-authoring
- Status: done
- Owner / Reviewer / Integrator: Flow Information Architecture Worker / independent ownership reviewer / Coordinator
- Claimed at / released at: 2026-08-25 / 2026-08-25
- Worktree / branch: shared integration workspace with NodesTab firewall / codex/architecture-stabilization
- Baseline HEAD: `ddbe070` (Flow formatting surface closed at `27ff341`)
- Context: exact-source Bootstrap confirmed `flowEditorView.blocks` already exposes the canonical DFS order, depth, parent and sibling index, while NodesTab still collapses the body to one aggregate row and mixes it with overlay affordances.
- Freshness / relevant dirty inputs: NodesTab, Flow projection and all three direct test paths were clean at claim; no Store, Schema or projection migration is required.
- Depends on: stab-wave-a-core-usability
- Blocks: stab-wave-c-flow-authoring
- Retry count: 0

## Product outcome

Flow 作者在大纲中看到正文的真实顺序与嵌套，在单独的浮层区域管理 overlay；正文不再暴露无效的 z-order，ownership 和定位空间分别命名，操作结果可预测。

## Current contract, canonical write and non-goals

- 审计依据：FLOW-06、FLOW-09。
- 当前合同：正文顺序来自 Flow blocks/tree；浮层继续使用现有 layer item 与 z-order。global/surface ownership 不等同于 page/world coordinate space。
- Canonical write: 正文 reorder 写现有 block 顺序/嵌套命令；仅 overlay 的排序写现有 layer order。
- 非目标：不做 V10 统一图层迁移、不给正文增加 z-index、不删除 V8/V9 全局或 surface 作者入口、不改 Schema。

## Scope, locks and acceptance

- Allowed write: NodesTab 的 Flow 分区/文案、正文 outline 投影、overlay 命令可达性，以及 `flowUnifiedLayerEntry` 与 `flowEditorView` 两个 focused 单测；未改的 `flowUnifiedLayers` 只作 direct-consumer validation。
- Forbidden write: contracts/schema、Store/history 迁移、Slide/Spatial IA、Published producer、Wave C E2E spec、dependencies/generated。
- Hotspot lock: NodesTab 与 shared authoring shell 由 Coordinator 串行接入；FlowWorkspace 仅做必要只读 selection/command 接线。
- Acceptance:
  - [x] 正文按真实顺序与嵌套显示，并只提供结构上有效的移动操作。
  - [x] overlay 单独呈现且保留 z-order；正文不显示置顶/置底等无效命令。
  - [x] ownership 与定位空间使用不同名称，不把 global 等同 viewport、surface 等同 document。
  - [x] 所有动作继续写现有 canonical carrier，并保持 undo/save 语义。

## Minimal validation

- npx vitest run tests/unit/flowUnifiedLayerEntry.test.tsx tests/unit/flowEditorView.test.ts
- npx vitest run tests/unit/flowUnifiedLayers.test.tsx
- 静态核对正文与 overlay 的命令/载体映射，并运行 git diff --check；不运行 Playwright。

## Result and rollback

- Result evidence: product commit `03cd27a`. NodesTab maps the existing `buildFlowEditorView.blocks` DFS/depth/parent/index into a selectable body outline and exposes only structurally valid move/indent/outdent actions through the existing canonical Flow commands. Body rows have no drag/z-order/visibility/lock affordance; a separate overlay section retains the existing DnD and layer actions. Labels independently state owner (`全课` / `当前 Flow 页面`) and coordinate placement (`钉在视口` / `跟随稿纸`). The UI path proves one history entry, undo and archive reopen. Focused validation passed `9/9`, unchanged direct consumer `3/3`; the fourth-lane integrated candidate passed `154/154`, full typecheck and `git diff --check`. Independent ownership review: `APPROVE`, no retry.
- Outcome boundary: V1 establishes `engineering candidate`；真实浏览器综合路径由 Wave C 证明。
- Rollback: revert `03cd27a`；不迁移 persisted data。
- Semantic index impact: canonical-update if user-facing layer capability text changes
- Generated refresh: defer-to-wave-gate
