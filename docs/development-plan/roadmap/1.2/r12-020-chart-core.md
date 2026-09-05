# r12-020-chart-core｜Factory、Command、History 支持 bar / line / area / pie / donut 及可编辑数据

- Release / Dependencies: 1.2 / r12-000-native-contract
- Write locks: `store-slide`, `authoring-slide`
- Inventory access: none

## Outcome / current evidence

`r12-000-native-contract` 已冻结 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §4 的 Chart union。本节点实现五类共用的 factory 与 canonical data/style commands，确保非法表格输入零部分改写、类型切换不静默丢数据。

## Read first

- `src/renderer/project/nativeNodeFactories.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/course/effectiveLayerCommands.ts`
- `src/renderer/store/slices/slideAuthoringSlice.ts`
- `src/renderer/store/history.ts`
- `tests/unit/v9SlideContentCommands.test.ts`
- `tests/unit/editorTransaction.test.ts`
- `tests/unit/effectiveLayerCommands.test.ts`

## Write scope

只写 Chart factory、typed commands、Slide slice 接线和现有 command/history tests。禁止修改 Chart schema、构建 UI/renderer/PPTX、接受 NaN/Infinity、用 chart library 的内部索引作为稳定身份，或扩到 Flow/Spatial/global。

## Execution

1. 实现注入 ID factory 的默认 Chart factory，五类都从同一 categories/series/points builder 创建；bar 固定为纵向簇状柱形语义。
2. 实现 title/common style/cartesian style/donut hole patch；candidate 先过完整 Chart schema 再一次提交。
3. 实现 category/series insert/delete/reorder 与 point value patch，保持 point-category 对齐和既有 ID；最后 category/series 删除拒绝。
4. 类型切换保留数据与 ID。多系列切到 pie/donut 必须接收教师已确认的 retainedSeriesId；没有、错 ID 或未确认均零写入。
5. 支持一次性表格 candidate 更新：先定位每个非法 cell，全部合法才替换；不逐 cell 写 history。
6. 为五类、负值、非有限值、长度错位、pie/donut 约束、stale/locked 和 Undo/Redo 增加 table-driven tests。

## Stop conditions

- 需要修改 `r12-000-native-contract` Chart 字段或扩大类型/有效域。
- 图表库数据结构必须成为保存真相，或类型切换必须静默丢系列。
- 一次数据粘贴只能逐 cell 提交并产生部分成功。

## Acceptance

- 五类由同一合同工厂创建；所有数据、样式与类型 command 原子且有稳定子项 ID。
- 非法 candidate 定位失败且 project/history/revision 不变；Undo/Redo 精确恢复。
- 切入单系列图表必须显式选择，任何隐式截断都有测试防回归。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideContentCommands.test.ts tests/unit/effectiveLayerCommands.test.ts`
- `npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run typecheck`

## Rollback / handoff

Factory、commands 与 tests 整体回滚；不得留下能创建却无法合法修改的 Chart。交接 `r12-021-chart-authoring-delivery` 时列出 commands、retainedSeries 决策接口、错误 path 与五类 fixture。
