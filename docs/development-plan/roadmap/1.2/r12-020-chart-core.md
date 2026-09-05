# r12-020-chart-core｜Factory、Command、History 支持 bar / line / area / pie / donut 及可编辑数据

- Release / Dependencies: 1.2 / r12-000-native-contract
- Write locks: `store-slide`, `authoring-slide`
- Inventory access: none

## Outcome / current evidence

Chart factory 与命令已存在。[本地复审 L2、L3 / P1](../../reviews/1.2-local-review-2026-09-05.md) 的正式命令反例确认：命名状态标题改写 base，schema-valid Slide surface 图表被 scene-only guard 拒绝。本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.3/§4 修复 owner/state 写入并保全既有类型、数据及稳定 ID，不重做五类 factory 或接管 F3–F5 painter 修复。

## Read first

- `src/renderer/project/nativeNodeFactories.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/course/v9ChartCommands.ts`
- `src/renderer/course/slideAuthoringBackend.ts`
- `src/renderer/course/effectiveLayerCommands.ts`
- `src/renderer/store/slices/slideAuthoringSlice.ts`
- `src/renderer/store/slices/slideOwnedCommands.ts`
- `src/renderer/store/history.ts`
- `tests/unit/v9SlideContentCommands.test.ts`
- `tests/unit/v9ChartCommands.test.ts`
- `tests/unit/editorTransaction.test.ts`
- `tests/unit/effectiveLayerCommands.test.ts`

## Write scope

只写 `v9ChartCommands.ts`、`v9SlideContentCommands.ts`、`effectiveLayerCommands.ts`、`slideAuthoringBackend.ts` 的 Chart 目标/事务接线、`slideAuthoringSlice.ts`/`slideOwnedCommands.ts` 及目标测试；`nativeNodeFactories.ts` 仅在实际输入需要时调整。`history.ts` 只读，复用 Table 已交接的 owner/state seam，不建立另一套 writer。禁止修改 Schema、UI/painter/PPTX、接受 NaN/Infinity、改变身份规则或扩 Flow/Spatial/global。

## Execution

1. 将命名状态标题误写与 schema-valid surface fixture 的命令拒绝纳入目标 tests，比较 base、两个 named state 和 surface 的真实变化。
2. 复用 canonical target/effective read/override writer，scene named state 只写 nativeData override，surface 写实际 surface item；不能只放开 guard 或继续从 base 读旧值。Table/Chart 共用同一已有 seam，按共享写锁串行修改。
3. 覆盖 title、common/cartesian/donut style、数据整表、category/series/point、类型切换的既有命令；candidate 整体验证后提交一次。创建/复制保持 owner、可见性与 ID 规则，普通编辑不重建子项 ID。
4. 保留多系列切 pie/donut 的 retainedSeriesId 明确选择语义；没有、错 ID 或取消零写入。非法数值、长度错位、最后分类/系列删除仍拒绝，整表提交不拆历史。
5. 用 base/两个 named state/surface 的数据、样式和类型变化验证 Undo/Redo 与保存往返；locked/stale/缺失 owner/state 失败时 project/revision/history/selection 不变。既有五类 factory 用例未受影响时复用。

## Stop conditions

- 需要修改 `r12-000-native-contract` Chart 字段或扩大类型/有效域。
- 图表库数据结构必须成为保存真相，或类型切换必须静默丢系列。
- 一次数据粘贴只能逐 cell 提交并产生部分成功。

## Acceptance

- 五类由同一合同工厂创建；所有数据、样式与类型 command 原子且有稳定子项 ID。
- 非法 candidate 定位失败且 project/history/revision 不变；Undo/Redo 精确恢复。
- 命名状态修改不污染 base 或其他状态；合法 Slide surface Chart 创建/编辑成功且不写当前 scene state。有效内容读取、candidate 校验与写入采用同一 owner/state 边界。
- 切入单系列图表必须显式选择，任何隐式截断都有测试防回归。

## Focused validation

- `npm run test:product -- tests/unit/v9ChartCommands.test.ts tests/unit/effectiveLayerCommands.test.ts tests/unit/v9SlideContentCommands.test.ts`
- `npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run typecheck`

## Rollback / handoff

commands、owner/state 接线与 tests 整体回滚，不保留直写 base 的旁路。交接 `r12-021-chart-authoring-delivery` 时列出 state/surface 行为、窄命令、retainedSeries 接口、错误 path 与往返 fixture；图表几何与样式由 delivery 修复。
