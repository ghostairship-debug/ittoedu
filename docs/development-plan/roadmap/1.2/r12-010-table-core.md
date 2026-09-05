# r12-010-table-core｜Factory、Command、History 支持稳定行 / 列 / 单元格身份、增删重排、宽高和样式

- Release / Dependencies: 1.2 / r12-000-native-contract
- Write locks: `store-slide`, `authoring-slide`
- Inventory access: none

## Outcome / current evidence

Table factory 和专用命令已存在。[本地复审 L2、L3 / P1](../../reviews/1.2-local-review-2026-09-05.md) 确认：命名状态的 cell text 直接改写 scene base，合法 Slide surface Table 被 `requireSceneScope` 拒绝；L5 / P2 的末格 Tab 分两笔提交，第二笔因旧 revision 失败。本节点按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §2.3/§3 修复 canonical owner/state 边界，并提供末格提交+追加行的原子命令；不重建工厂，不在此接管 UI/painter。

## Read first

- `src/renderer/project/nativeNodeFactories.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/course/v9TableCommands.ts`
- `src/renderer/course/slideAuthoringBackend.ts`
- `src/renderer/course/effectiveLayerCommands.ts`
- `src/renderer/store/slices/slideAuthoringSlice.ts`
- `src/renderer/store/slices/slideOwnedCommands.ts`
- `src/renderer/store/history.ts`
- `tests/unit/v9SlideContentCommands.test.ts`
- `tests/unit/v9TableCommands.test.ts`
- `tests/unit/editorTransaction.test.ts`
- `tests/unit/effectiveLayerCommands.test.ts`

## Write scope

允许修改 `v9TableCommands.ts`、`v9SlideContentCommands.ts`、`effectiveLayerCommands.ts`、`slideAuthoringBackend.ts` 中的 Table 目标/事务接线、`slideAuthoringSlice.ts`/`slideOwnedCommands.ts` 与对应目标单测；`nativeNodeFactories.ts` 仅在真实命令输入需要时调整。共享 owner/state seam 复用既有 effective 命令，不新建万能 service；`history.ts` 只读。禁止修改 Schema、Properties/painter/PPTX、Flow/Spatial/global 或添加第二状态/历史。

## Execution

1. 将命名状态 cell text 与 schema-valid surface target 反例纳入现有 command tests；对照基础状态和第二命名状态，先证明真实错写与 `wrong-owner`，不以 Schema 可解析代替命令成功。
2. 专用命令从 canonical target 读取有效 Table；scene base、scene named state、Slide surface 分别落到既有 base/override/surface writer。保留完整 candidate 校验，不只删 scope 检查后继续查 scene 列表。
3. 同一修复覆盖 cell text/style、table style、行列增删重排、宽高；命名状态只改变该状态，surface 不受当前 scene state 干扰。创建/复制保持既有可见性、stable ID 与 owner 规则，删除最后行/列和非法 ID 仍零写入。
4. 提供一个窄复合命令，接受末格稳定 cell ID、文本和追加行意图，在同一 candidate 完成两步后只提交一次；任一步失败都不落地。返回足以按 row/column/cell 稳定 ID 恢复焦点的结果，由 Table delivery 接线；禁止第二次 callback 或关闭 stale 校验。
5. 覆盖 base/两个 named state/surface 的代表性数据、样式、结构、Undo/Redo 和保存往返；补 locked/stale/缺失 owner/state 反例，断言 project/revision/history/selection 不变。复用未改变的 factory/身份用例，不重复建设命令族。

## Stop conditions

- 需要改变 `r12-000-native-contract` 的字段、约束或 Table 有效域。
- 必须绕过 canonical target/history，或一次行列操作需要多条可观察事务。
- 重排无法在不重建现有子项 ID 的情况下完成。

## Acceptance

- Factory 和全部结构/样式命令满足合同，复制重建 ID，普通编辑保留 ID。
- 每次成功操作一条历史，Undo/Redo 精确恢复结构、值、样式和身份；失败零写入。
- 命名状态编辑不污染 base 或其他状态；合法 Slide surface Table 的创建/编辑走正确 owner。末格提交+追加行一条事务，Undo/Redo 同时恢复文本与结构，失败无部分保存。
- 没有 UI mirror、数组下标身份或 Flow/Spatial/global 支持。

## Focused validation

- `npm run test:product -- tests/unit/v9TableCommands.test.ts tests/unit/effectiveLayerCommands.test.ts tests/unit/v9SlideContentCommands.test.ts`
- `npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- `npm run typecheck`

## Rollback / handoff

命令、owner/state seam、slice 与反例成对回滚，不保留旧直写 base 路径。向 `r12-020-chart-core` 交接可复用的 effective seam，向 `r12-011-table-authoring-delivery` 交接末格复合命令、稳定焦点 ID、错误码及 state/surface/历史 fixture；UI 不得再串联两条提交。
