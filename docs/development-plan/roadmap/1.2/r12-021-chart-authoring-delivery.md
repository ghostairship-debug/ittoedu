# r12-021-chart-authoring-delivery｜Chart 编辑 UI、保存重开、Published、Player 与 HTML 闭环

- Release / Dependencies: 1.2 / r12-020-chart-core, r12-008-native-authoring-transport
- Write locks: `props-slide`, `props-shared`, `authoring-slide`, `published-slide`, `export-pptx`, `workspace-shell`
- Inventory access: none

## Outcome / current evidence

当前已有 Chart commands、数据编辑器及统一图表入口。[本地复审 F3–F5 / P2](../../reviews/1.2-local-review-2026-09-05.md) 确认完整圆/环退化、网格/轴/标签/左右图例未消费、柱图叠画折线/点及自定义轴范围溢出。L1 增量同步和 L2/L3 owner/state 分别由 `r12-008-native-authoring-transport`、`r12-020-chart-core` 先闭合；本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.2/§2.3/§4/§7.4 修复真实 painter 与交付链，不重新整理已经统一的入口。

## Read first

- `src/renderer/ui/ElementsTab.tsx`
- `src/renderer/styles/globals.css`
- `src/renderer/ui/properties/SlideChartProperties.tsx`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx`
- `src/renderer/course/v9ChartCommands.ts`
- `src/shared/nativeChartView.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `src/renderer/export/course/pptxTableAndChart.ts`
- `tests/unit/nativeChartView.test.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/unit/buildPublishedCourseV2.test.ts`
- `tests/unit/coursePptxExport.test.ts`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

允许修改 Chart Properties、`usePropertiesAuthoringBinding.tsx` 的 Chart 窄接线、`nativeChartView.ts`、Published Slide painter/adapter、PPTX Chart projection 及现有目标测试；ElementsTab 图表局部入口和 globals.css 仅修真实回归，不重排无关 UI。共同传输回到 `r12-008-native-authoring-transport`，owner/state 回到 Chart core，共享取色回到 `r12-040-background-authoring`。禁止修改 schema/commands、保存 chart library config、静默截断多系列或截图代替原生 PPTX。

## Execution

1. 保全 §7.4 已有统一图表入口、五类选择、搜索/拖入/键盘和其他 Surface 的单一限制说明。Properties 保留合同字段；本轮先将 F3–F5 反例加入 shared view 与正式 painter/真实 UI 用例，不以属性控件存在证明绘图正确。
2. 数据表用局部 draft，整表提交前显示逐 cell 错误；一次成功提交调用一个 `r12-020-chart-core` command，一次失败零工程写入。
3. 多系列切换 pie/donut 时弹出 retained series 选择；取消无写入。切回 cartesian 不伪造被丢弃系列。
4. 在共用 chart view 中修复完整圆/环几何，覆盖 `[100]`、`[100,0,0]`、`[0,100,0]` 和正常多扇区；零值不生成伪扇区。按类型生成/消费图元，bar 不叠折线/点；自定义正/负轴范围不含 0 时约束可见基线并裁切 plot，保留原始数值及摘要。
5. 实际 painter 消费网格、分类轴、数值轴及刻度、数据标签、图例开关和四向位置，布局为轴/图例留空间。覆盖每个开关的开/关对照与四向图例实际位置，不仅断言 view flags；保持 accessible text，非法数据/零尺寸不以无提示空白掩盖。
6. 真实 UI 在 base、两个 named state 和合法 Slide surface 修改数据/样式，切换及保存重开后结果正确；作者、Player、单 HTML 从同一合同数据重建，不序列化库实例。
7. PPTX 五类映射原生 chart，bar 映射 clustered column；保留现有支持及精确样式差异告警。解包断言类型、数据和适用轴/标签/图例映射，不能只断言文件非空，也不能据 HTML painter 缺陷推定 PPTX 同源失效。

## Stop conditions

- 当前 PPTX 库不能生成任一承诺类型的原生 chart。
- UI 或 renderer 需要改变合同，或必须把 library option bag 持久化。
- 类型切换无法在教师确认前保持零写入。

## Acceptance

- 只用 UI 创建并编辑五类图表；初始/增量同步成功，插入后可选中、拖动/缩放和 Undo/Redo，保存重开后可继续编辑；错误逐 cell 定位，成功一条历史。完整快照 ACK 不得被 mock 绕过。
- 常用区只有一个图表入口，五种类型可发现；在当前默认侧栏宽度及窄窗口下没有遮挡、裁切或横向溢出，搜索、拖入定位、Esc 和键盘操作可用。提供实际渲染证据，不能仅断言按钮存在。
- 保存重开、Player、单 HTML 的类型、数据、颜色、标签与摘要一致。
- 上述单非零 pie/donut 在真实渲染中形成完整圆/环；bar 没有额外折线/点，数据 `[12,15,18]`、轴 `[10,20]` 及负区间/跨零对照的可见几何不越 plot。五类均无 NaN、退化空白或错误图元。
- 网格、分类轴、数值轴及刻度、数据标签、图例开关逐项改变实际呈现，图例四向位置正确；base/named state/surface 的数据与样式互不污染，Undo/Redo 和保存重开保持。
- PPTX 五类均为原生可编辑 chart；不支持的样式明示 warning，图表本体不遗漏。

## Focused validation

- `npm run test:product -- tests/unit/nativeChartView.test.ts tests/unit/v9SlideProductIntegration.test.tsx tests/unit/buildPublishedCourseV2.test.ts`
- `npm run test:product -- tests/unit/coursePptxExport.test.ts tests/unit/courseSlidePreflightParity.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

按 UI→view renderer→Published→PPTX 纵切回滚，不保留仅某一 carrier 支持的 Chart。交接 `r12-050-native-closure` 时附 F3–F5 的正式反例/真实渲染、owner/state 往返、五类保存 fixture、accessible summary 与 PPTX 映射证据；颜色预览由颜色节点验收。
