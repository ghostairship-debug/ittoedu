# r12-021-chart-authoring-delivery｜Chart 编辑 UI、保存重开、Published、Player 与 HTML 闭环

- Release / Dependencies: 1.2 / r12-020-chart-core, r12-008-native-authoring-transport
- Write locks: `props-slide`, `authoring-slide`, `published-slide`, `export-pptx`, `workspace-shell`
- Inventory access: none

## Outcome / current evidence

当前已有 Chart commands、五类绘图和数据属性编辑器，但 2026-09-05 可见插入立即触发 `patch.node：Invalid input`，五种图表大按钮同时铺在“常用”中。共同同步缺口先由 `r12-008-native-authoring-transport` 修复；本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.2/§4/§7.4 补齐真实创作闭环与插入入口组织，保留已有图表数据和绘图实现。

## Read first

- `src/renderer/ui/ElementsTab.tsx`
- `src/renderer/styles/globals.css`
- `src/renderer/ui/properties/SlideChartProperties.tsx`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/player/surfaces/slide/SlidePublishedAdapter.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `tests/unit/v9SlideProductIntegration.test.tsx`
- `tests/unit/buildPublishedCourseV2.test.ts`
- `tests/unit/coursePptxExport.test.ts`
- `tests/e2e/stabilizationCoreUsability.spec.ts`

## Write scope

允许修改 Chart 插入/Properties、ElementsTab 的图表局部入口与限制说明、对应样式、局部数据表 draft、共享 chart view/render、Published Slide、PPTX 与现有目标测试。共同传输回到 `r12-008-native-authoring-transport`，共享取色回到 `r12-040-background-authoring`；禁止修改 schema/commands、引入保存态 chart library config、静默截断多系列、把 chart 静态截图进 PPTX 或重排无关元素功能。

## Execution

1. 按 §7.4 将五张快速添加大卡收为一个“图表”入口及五类选择面板；保留按类型搜索、拖入定位和键盘选择/取消，选择一次只插入一个图表。Flow/Spatial/global 保留单一限制说明，不显示整组禁用卡。properties 保留 title、类型、分类、系列、值、颜色、legend、data labels、cartesian axes 与 donut hole；不适用字段不写入。
2. 数据表用局部 draft，整表提交前显示逐 cell 错误；一次成功提交调用一个 `r12-020-chart-core` command，一次失败零工程写入。
3. 多系列切换 pie/donut 时弹出 retained series 选择；取消无写入。切回 cartesian 不伪造被丢弃系列。
4. 作者与 Published 复用纯 chart view model 和确定性 SVG/canvas renderer；提供数据摘要 accessible text，零尺寸/非法数据不渲染为空。
5. 保存重开、Player、单 HTML 均从合同数据重建，不序列化库实例。
6. PPTX 五类映射原生 chart，bar 映射 clustered column；解包 PPTX 断言 chart relationship/data 存在，不能只断言文件非空。

## Stop conditions

- 当前 PPTX 库不能生成任一承诺类型的原生 chart。
- UI 或 renderer 需要改变合同，或必须把 library option bag 持久化。
- 类型切换无法在教师确认前保持零写入。

## Acceptance

- 只用 UI 创建并编辑五类图表；初始/增量同步成功，插入后可选中、拖动/缩放和 Undo/Redo，保存重开后可继续编辑；错误逐 cell 定位，成功一条历史。完整快照 ACK 不得被 mock 绕过。
- 常用区只有一个图表入口，五种类型可发现；在当前默认侧栏宽度及窄窗口下没有遮挡、裁切或横向溢出，搜索、拖入定位、Esc 和键盘操作可用。提供实际渲染证据，不能仅断言按钮存在。
- 保存重开、Player、单 HTML 的类型、数据、颜色、标签与摘要一致。
- PPTX 五类均为原生可编辑 chart；不支持的样式明示 warning，图表本体不遗漏。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideProductIntegration.test.tsx tests/unit/buildPublishedCourseV2.test.ts`
- `npm run test:product -- tests/unit/coursePptxExport.test.ts tests/unit/courseSlidePreflightParity.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

按 UI→view renderer→Published→PPTX 纵切回滚，不保留仅某一 carrier 支持的 Chart。交接 `r12-050-native-closure` 时附五类保存 fixture、数据错误反例、accessible summary 与 PPTX chart relationship 证据。
