# r12-008-native-authoring-transport｜闭合 Table/Chart/input 的 Native 作者态传输与真实宿主同步

- Release / Dependencies: 1.2 / r12-000-native-contract, r12-006-input-response-contract
- Write locks: `contracts-schema`, `authoring-slide`, `published-slide`
- Inventory access: none

## Outcome / current evidence

2026-09-05 在当前工作树的新建空白 Slide 中从 UI 插入柱状图，出现“统一画布启动失败：初始画面同步失败：patch.node：Invalid input”。五类默认图表的内容数据均通过 Chart schema，但 authoring patch parser 全部拒绝；Table 同样被拒绝。绘图实现已存在，缺口在完整作者态同步而非图表几何。input 使用同一传输边界，必须同步覆盖，不把尚未做过的真实 input 操作声明为已复现。

依照 [共同传输合同](IMPLEMENTATION_CONTRACT.md) §2.2，消除 `nativeRenderableNodeSchema`、`NATIVE_NODE_TYPES`、Published authoring frame guard 与新 Native painter 接受域分裂；保持 V9/Published 版本与持久化语义不变。

## Read first

- `src/shared/contracts/native-v1/types.ts`
- `src/shared/contracts/native-v1/schema.ts`
- `src/shared/playerAuthoringProtocol.ts`
- `src/player/surfaces/slide/publishedSlideAuthoringPatch.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`
- `tests/unit/playerAuthoringProtocol.test.ts`
- `tests/unit/publishedSlideAuthoringPatch.test.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

只修改共享 Native 非持久化 render input 定义/校验、authoring protocol 接线、Slide 同步与宿主判定、必要的失败反馈及上述真实 consumer 的目标测试。共享 Native content schema 只复用，不改变数据有效域；不扩 Flow/Spatial/global，不改交互运行规则，不接管表格/图表编辑器、配色或导出样式。

## Execution

1. 用合法 Table、五 Chart、text/number input 内容构造完整 render input，证明“内容合法而 parser/guard 拒绝”；未知类型、未知字段、类型不匹配、过期 revision 和错误 owner 作为负例。
2. 从正式 Native content 定义派生非持久化完整节点类型、strict 校验和运行判断；消除旧六类名单漏项及仅靠强转的接线。工厂和 painter 不再各自声明一份可接受类型真相。
3. 贯通初始完整快照与后续增量更新，保留目标 ID、scope、revision、generation、requestId 和 ACK/barrier。禁止跳过握手、压掉错误或以 standalone painter 测试代替宿主证据。
4. 用合同 fixture 启动真实 Published 宿主，证明新 Native 的初始快照与内容/几何增量能够 ACK；不依赖尚未交付的属性 UI。本次工作树已有 Table/Chart 入口时同时复核原插入反例，完整选择、数据编辑、Undo/Redo、保存重开由后续 delivery 验收，避免隐含循环依赖。
5. 同步失败保留精确目标和原因，状态反馈区分工程提交与画布同步；本节点不引入补偿写入、第二 History 或无限自动重试。

## Stop conditions

- 需要扩大持久化有效域、改变已有字段、恢复 legacy SceneNode 或跳过 strict 校验。
- 只能让 playback 渲染成功，真实作者态快照或增量 ACK 仍失败。
- 故障转移到图表数据命令、属性控件或导出后，返回对应 delivery owner；不在本节点复制实现。

## Acceptance

- Table、bar/line/area/pie/donut、text/number input 完整输入均通过 parser 与宿主 frame guard；错误输入仍精确拒绝。
- 正式 fixture 中的新 Native 在真实宿主完成作者态初始同步与内容/几何增量；当前已有 UI 的插入反例消失，既有六类 Native 与 Component/Runtime 同步不退化。完整 UI 操作与保存重开在依赖本节点的 delivery 闭合。
- 不靠 mock ACK、手工 Store 注入或跳过快照形成通过；成功/失败反馈与实际提交结果一致。

## Focused validation

- `npx vitest run tests/unit/playerAuthoringProtocol.test.ts tests/unit/publishedSlideAuthoringPatch.test.ts tests/unit/v9SlideProductIntegration.test.tsx`
- `npm run typecheck`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

共同类型/校验、guard、materializer 与 consumer 接线作为一个可审阅回滚单元，不能保留双轨白名单。向 Table、Chart、input delivery 交接合法/非法输入、真实宿主初始及增量 ACK 证据；各 delivery 继续承担其数据、保存、Player 与导出验收。closure/release 只验收，不代写这一修复。
