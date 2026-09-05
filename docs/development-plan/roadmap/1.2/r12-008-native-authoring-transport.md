# r12-008-native-authoring-transport｜闭合 Table/Chart/input 的 Native 作者态传输与真实宿主同步

- Release / Dependencies: 1.2 / r12-000-native-contract, r12-006-input-response-contract
- Write locks: `contracts-schema`, `authoring-slide`, `published-slide`, `workspace-shell`
- Inventory access: none

## Outcome / current evidence

2026-09-05 [本地复审 L1 / P1](../../reviews/1.2-local-review-2026-09-05.md)：初始快照已经接受新 Native，但真实 UI 修改 Chart 类型/数据后作者画布持续呈现旧柱图，进入试运行重建才读到新值。`SlideLocationWorkspace` 后续更新遍历经 `courseLayerItemToEditorCanvasNode` 过滤的 `document.nodes`，Table/Chart/input 不在旧六类投影中。当前修复对象是增量 producer，不再以已修复的初始 parser 拒绝为前提；input 的可见作者入口仍由其 delivery 交付。

依照 [共同传输合同](IMPLEMENTATION_CONTRACT.md) §2.2，让初始与增量从同一正式 Native render input 构建。已有 strict parser、frame guard 与 materializer 继续复用；只有发现与本轮 producer 的真实不一致才在同一 Owner 内调整，保持 V9/Published 版本和持久化语义不变。

## Read first

- `src/shared/contracts/native-v1/types.ts`
- `src/shared/contracts/native-v1/schema.ts`
- `src/shared/playerAuthoringProtocol.ts`
- `src/player/surfaces/slide/publishedSlideAuthoringPatch.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`
- `src/renderer/store/slideEditorProjection.ts`（只读定位过滤边界）
- `tests/unit/playerAuthoringProtocol.test.ts`
- `tests/unit/publishedSlideAuthoringPatch.test.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

只修改 `SlideLocationWorkspace.tsx` 的正式 Native 快照/增量接线、`playerAuthoringProtocol.ts`、`src/shared/contracts/native-v1/` 的非持久化 render input、`src/player/surfaces/slide/` 的 patch/guard/adapter 与必要失败反馈、上述目标测试。旧 `slideEditorProjection.ts` 和 legacy SceneNode 只读，不通过扩白名单绕过问题。共享 content schema 只复用，不改变有效域；不扩 Flow/Spatial/global，不改运行规则、表格/图表数据命令、配色或导出样式。

## Execution

1. 先复现 UI 创建柱图→修改类型/数据→画布陈旧；增加 Table 内容和 input 合同 fixture 的增量反例。初始 parser 的合法/非法既有证据继续有效，不为制造反例改坏初始路径。
2. 让更新枚举和 payload 直接使用与初始快照相同的正式 V9 Native render input；保留外层 LayerItem 几何与有效 state 内容，不再从旧六类 document 投影反推新 Native。
3. 贯通内容、样式、几何与 Undo/Redo 增量，保留目标 ID、scope、revision、generation、requestId 和 ACK/barrier。禁止跳过握手、每次重挂载宿主、只回复 ACK 而不消费或以 standalone painter 代替宿主证据。
4. 用合同 fixture 启动真实 Published 宿主，证明 Table、五 Chart、text/number input 初始与增量都能 ACK，未知/错分支/越界/stale 仍拒绝。当前 Table/Chart UI 同时证明修改后不用切换试运行即可更新；完整编辑、保存重开与导出由后续 delivery 验收，避免循环依赖。
5. 同步失败保留精确目标和原因，状态反馈区分工程提交与画布同步；本节点不引入补偿写入、第二 History 或无限自动重试。

## Stop conditions

- 需要扩大持久化有效域、改变已有字段、恢复 legacy SceneNode 或跳过 strict 校验。
- 只能让 playback 渲染成功，真实作者态快照或增量 ACK 仍失败。
- 故障转移到图表数据命令、属性控件或导出后，返回对应 delivery owner；不在本节点复制实现。

## Acceptance

- Table、bar/line/area/pie/donut、text/number input 完整输入均通过 parser 与宿主 frame guard；错误输入仍精确拒绝。
- 正式 fixture 中的新 Native 在真实宿主完成初始、内容/样式/几何与 Undo/Redo 增量；当前 Table/Chart UI 的属性与画布保持一致，不靠重进试运行刷新。既有六类 Native 与 Component/Runtime 不退化；完整保存重开/导出在 delivery 闭合。
- 不靠 mock ACK、手工 Store 注入或跳过快照形成通过；成功/失败反馈与实际提交结果一致。

## Focused validation

- `npx vitest run tests/unit/playerAuthoringProtocol.test.ts tests/unit/publishedSlideAuthoringPatch.test.ts tests/unit/v9SlideProductIntegration.test.tsx`
- `npm run typecheck`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

共同类型/校验、guard、materializer 与 consumer 接线作为一个可审阅回滚单元，不能保留双轨白名单。向 Table、Chart、input delivery 交接合法/非法输入、真实宿主初始及增量 ACK 证据；各 delivery 继续承担其数据、保存、Player 与导出验收。closure/release 只验收，不代写这一修复。
