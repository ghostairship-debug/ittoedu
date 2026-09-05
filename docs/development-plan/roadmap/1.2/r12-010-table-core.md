# r12-010-table-core｜Factory、Command、History 支持稳定行 / 列 / 单元格身份、增删重排、宽高和样式

- Release / Dependencies: 1.2 / r12-000-native-contract
- Write locks: `store-slide`, `authoring-slide`
- Inventory access: none

## Outcome / current evidence

`r12-000-native-contract` 已冻结 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §3 的 Table schema。本节点只实现默认 factory 与 canonical Slide commands/history，使所有结构编辑具有稳定身份和原子撤销；不再修改合同形状，也不交付最终 UI/Player/PPTX。

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

允许修改 Table factory、Slide typed commands、slice 接线及对应现有单测。需要新 helper 时放在同一 authoring owner 内。禁止修改 Table schema、Properties/renderer/PPTX、Flow/Spatial/global，禁止让 UI 直接持有可变 table draft 作为第二真相。

## Execution

1. 实现注入 ID factory 的确定性 3×3 Table factory；断言默认样式、header 与所有 row/column/cell ID 唯一。
2. 实现 cell text、table style、cell style、row height、column width patch；每个 command 先解析 canonical Slide target，再构造并完整校验 candidate。
3. 实现 row/column before/after insert、delete 与完整 ID order reorder；按合同同步 cells/columnId，最后一行/列、未知/重复/缺失 ID 拒绝。
4. 复制 Table 时重建外层 LayerItem 与所有子项 ID；presentation override 仍走既有有效 read/command 语义，不把数组位置变成 target。
5. 每个 public command 添加成功、invalid、locked、stale 与 Undo/Redo 用例；失败时 document revision、history 与 selection 均不变化。

## Stop conditions

- 需要改变 `r12-000-native-contract` 的字段、约束或 Table 有效域。
- 必须绕过 canonical target/history，或一次行列操作需要多条可观察事务。
- 重排无法在不重建现有子项 ID 的情况下完成。

## Acceptance

- Factory 和全部结构/样式命令满足合同，复制重建 ID，普通编辑保留 ID。
- 每次成功操作一条历史，Undo/Redo 精确恢复结构、值、样式和身份；失败零写入。
- 没有 UI mirror、数组下标身份或 Flow/Spatial/global 支持。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideContentCommands.test.ts tests/unit/effectiveLayerCommands.test.ts`
- `npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run typecheck`

## Rollback / handoff

Factory 与每组 command/test 成对回滚，不能留下只可创建不可编辑或会破坏 ID 的 Table。交接 `r12-011-table-authoring-delivery` 时列出 public command symbol、错误码和完整 Undo/Redo fixture。
