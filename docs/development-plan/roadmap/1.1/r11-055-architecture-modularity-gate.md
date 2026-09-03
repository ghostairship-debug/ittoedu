# r11-055-architecture-modularity-gate｜证明 Owner 模块化与依赖方向收口

- Release / Dependencies: 1.1 / r11-037-editor-store-owner-modularization, r11-052-supported-test-migration
- Write locks: `generated-index`
- Inventory access: `read`
- Preservation: PM-01–PM-28

## Outcome / current evidence

在当前固定 product tree 上以 dependency/read-model ratchet 和代表性行为证明 1.1 是真实模块化，而非搬文件：组合根只接线、owner 方向正确、旧 writer/Facade/运行时环消失、raw Store consumer 收紧，且用户行为没有降级。本节点不修改产品实现；失败返回对应 owner 节点。它先作为 r11-053 前的 pre-delete gate 执行；r11-054 改变源码、测试或 generator closure 后，必须在最终 post-delete closure 原样重跑完整 gate，新的通过结果才可交给 r11-060。

## Integrator audit / gate invalidated（2026-09-03）

当前 focused 结构测试虽绿，但 055 证据无效：`architectureDependencyRatchet.test.ts` 只截取 factory 片段并禁止少数函数名，甚至要求 root 含 Surface 业务文案；`readModelBoundary.test.ts` 主要证明 leaf import 存在，无法发现 root 仍持有 connector、mutation 和宽 Facade。源码已经提供可复现反例：Properties/Workspace roots 未只路由，`editorStore.ts` 未只接线，`crossSurfaceCommands` 已成为万能服务。

本节点保持原子门且不改产品。首次启动前必须确认：r11-026/029/037/052 已在当前树重新验收；r11-029 后的 r11-025 evidence 仍有效或已重做；r11-032/034–036 的 evidence closure 未变；r11-001 建立、r11-052 同任务维护的 preservation map/matrix 已使 `check:preservation` 与 `check:development-roadmap` 为绿。随后以 import graph、TypeScript AST/精确 symbol 和固定最小违规 fixture 重建结构门。r11-054 只可在删除直接造成的 stale target 声明上做机械清理；post-delete revalidation 允许 ledger 仅按授权删除单调移除对应 consumer，再按本规格全部 Focused validation 重跑，不要求回滚产品或重做 053。若需要改变 assertion、AST/import helper、fixture，或 ledger 出现新增边、owner 改写、baseline/白名单放宽，才必须先回滚受影响删除并返回本节点，修正后从 r11-053 重新固定 identity。任何失败按 Gate assertions 的 Failure owner 返回，禁止修改白名单、正则或期望业务字符串求绿。

## Read first

- `docs/development-plan/ARCHITECTURE_CONTRACT.md` 的 Owner、方向与主动模块化条目
- `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`
- `tests/unit/architectureDependencyRatchet.test.ts`
- `tests/unit/readModelBoundary.test.ts`
- r11-026–r11-037 的实质 diff、focused evidence 与 handoff

## Gate assertions

| Boundary | Required proof | Failure owner |
|---|---|---|
| composition root | `editorStore.ts` 只实例化/接线；无 planner/document mutation/Feature message | r11-037 |
| Store modules | slice/use case 无 root Store、完整 `EditorState`、raw `get/set` 或跨 owner deep import | r11-037 |
| Properties root | `PropertiesTab.tsx` 只路由且窄 adapter 不泄漏 Store/document | r11-026；若失败其实来自 Flow/Spatial 叶子语义，再分别返回 r11-027/028 |
| Workspace root | `Workspace.tsx` 只做 exactly-one 路由，connector 只接窄 port | r11-029 |
| App root | App 只组合 project lifecycle、delivery 与 import/input hooks | r11-034–r11-036 对应节点 |
| Flow/Spatial leaves | leaf 无 root Store、跨 Surface command 或 wrong-owner persist | r11-027 / r11-028 |
| cross-Surface composition | `crossSurfaceCommands` 只有 undo/location/canvasMode/text-edit 窄分派；无具体 Surface command、persist、save/recovery/ACK 或完整 ports | r11-037 |
| delivery | Slide Native painter 与 package analysis/preflight/emitter 各有单一 owner | r11-030 或 r11-043 |
| dependency graph | 无新增 runtime SCC、Core→Feature、Player→Store、contract→renderer；教师控制器环为零 | r11-037 |
| truth/writers | 无第二 Store/Session/History/writer、wrong-owner mirror、完整 Store Facade | r11-025/r11-037 |
| behavior | 保存/重开/History、三 Surface、Preview/Player、导出代表闭环通过 | 对应最近失败节点 |

## Write scope

只允许修改 `tests/unit/architectureDependencyRatchet.test.ts`、`tests/unit/readModelBoundary.test.ts`、供二者使用的最窄 AST/import helper、测试内联源码或固定最小 architecture violation fixtures，以及 `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`，记录当前正式 owner/consumer 与单调 baseline。违规 fixture/helper 是门的永久回归资产，不得在获得绿灯后删除。禁止修改产品、manifest、Legacy inventory、PM 行、测试行为期望或创建第二架构台账/评分系统。

## Execution

1. 从集成树直接解析 imports 与现有测试，不信任务自述；把 Gate assertions 每行映射到一个结构断言和一个已有行为证据。
2. 以 TypeScript AST/import graph/精确 symbol 扩展 ratchet，只禁止合同明确的边：root Store 泄漏、跨 owner deep import、UI root 回吸职责、第二 writer/registry、module-global service locator、宽 ports/Facade 和已知 runtime SCC；检查必须覆盖 factory 内外全部顶层 helper，不加 LOC/文件数/目录数阈值。
3. 为每类边建立固定最小违规 fixture，证明以下任一会失败：Workspace/Properties raw Store 或 command/mutation；root planner/persist/UI import；`crossSurfaceCommands` 具体 Surface/save/recovery 实现；完整 document/session/writer ports；第二 History/writer；Core→Feature、Store→UI 或 runtime SCC。合法窄 adapter 可以消费命名 selector、单一 owner view 与 typed command port，但不得读取完整 State/document、调用 raw `getState/setState`、组合跨 owner mutation/persist、持有 module-global mutable bind，或返回可替代 Store 的宽对象；相应合法 fixture 必须通过。
4. 更新 `FEATURE_CONSUMER_OWNER_LEDGER` 的当前 owner、consumer 与 raw Store baseline；只允许减少或精确证明为正式 composition adapter，不得把 mirror、宽 Facade 或 service locator 重新命名为 adapter。
5. 只在本次 gate 所验 product closure 的源码、结构测试、AST/import helper、固定 fixture 和 ledger 均到达稳定状态后运行并记录；中途绿灯无效。失败时不修改规则求绿，按 Failure owner 退回产品节点。上述任一输入变化都会使本次证据失效并必须重跑；pre-delete pass 不能替代 r11-054 后的 post-delete pass。
6. 复用未失效的 owner focused tests；只运行覆盖所有迁移 owner 的最小代表组合，确认 PM-01–PM-28 的相关 evidence 仍有效。

## Stop conditions

- 结构门只能靠文件名/字符串快照、LOC 阈值或大白名单通过。
- 任一原 writer/业务实现仍在 root，或新模块只是 re-export/完整 Store Facade。
- 需要改产品或弱化行为测试；本 gate 必须退回前置 owner。

## Acceptance

- Gate assertions 全部结构边由 import/AST/类型边界或精确 symbol 证据通过；每类有能击穿旧假阳性门的最小违规 fixture，不依赖字符串存在性、行数、文件数或架构评分。
- root 无业务实现，旧 writer/双写/Facade/known runtime SCC 为零；raw Store consumer 相对基线严格下降且未跨 owner 扩散。
- Workspace/Properties 只路由；`crossSurfaceCommands`、Feature ports 与 module-global bind 不再形成万能服务或隐藏 Facade。
- 合法 adapter 只消费命名 selector、单 owner view 与 typed port；完整 State/document、raw Store、跨 owner mutation/persist、module-global bind 与宽对象返回的固定反例全部稳定失败。
- ledger、ratchet 与源码一致且只有现有一份；普通后续任务通过常规 test/verify 自动继承这些边界。
- 代表性保存/重开/Undo/Redo、三 Surface、Player 与导出证据有效，没有因拆分删除入口、测试或能力。
- 证据来自最终测试/helper/fixture/ledger 状态；不存在获得绿灯后删除 fixture 或再改 gate 输入的中间通过。
- r11-053 使用 pre-delete pass；r11-060 使用 r11-054 最终 closure 上的 post-delete pass。两者各自绑定对应 product/test/helper/ledger identity，不复用跨 closure 结果。

## Focused validation

- `npx vitest run tests/unit/architectureDependencyRatchet.test.ts tests/unit/readModelBoundary.test.ts tests/unit/editorStore.test.ts tests/unit/coursePackageExport.test.ts`
- `npx vitest run tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx`
- `npm run typecheck`

## Rollback / handoff

本 gate 不修产品；结构或行为失败时回滚对 ledger/ratchet 的错误声明，并把首个失败边、精确 import/symbol、责任节点和仍有效证据交回 Integrator。post-delete revalidation 失败时先回滚 r11-054 受影响删除；若本 gate 的定义随后有任何修改，旧 reconciliation identity 作废，必须从 r11-053 重来。
