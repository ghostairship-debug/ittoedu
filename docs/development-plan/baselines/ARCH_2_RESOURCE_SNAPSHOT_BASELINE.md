# ARCH-2 资源快照与跨 Surface 行为基线

记录时间：2026-08-24（Asia/Shanghai）  
基线提交：`d6b56a2`（ARCH-1 gate complete）  
执行分支：`codex/architecture-stabilization`

## 1. 结论

ARCH-1 已证明一个 Slide 图片替换可以把 V9 document 与素材 bytes 放入同一 `EditorTransactionStep`。ARCH-2 起点仍有两类明确债务：

1. Flow 与 Spatial history 只保存 `CourseProjectDocument`，不能携带 asset/package delta；
2. Media 与 Components 的多数工程级操作仍依赖完整资源 map 快照，或在 Flow/Spatial 活动时落入已经为空的 V8 `commit` 壳并显示伪成功。

首批迁移选择两个互补且边界清楚的用户行为：

- 批量素材只导入项目媒体库，不做任何 Surface placement；
- 替换一个已安装组件包，并保持所有现有实例的原 carrier。

它们共同验证 asset 与 component 两种已有 resource delta，同时不会把 Flow 正文、Spatial 世界或 Slide 场景统一成错误载体。

## 2. 结构基线

| 指标 | ARCH-2 起点 | 证据/解释 |
|---|---:|---|
| sidecar 完整历史栈字段 | 2 | `slideCandidateSidecarPast` / `Future` |
| sidecar 栈符号引用行 | 41 | `editorStore.ts` 精确 grep；含声明、读、写、对齐与清空 |
| sidecar 完整快照 persistence adapters | 3 | `persistCandidateResult`、`persistFlowResult`、`persistSpatialResult` |
| resource-aware Surface histories | 1 / 3 | Slide mixed frame；Flow/Spatial 为 document-only |
| 已上线 asset-delta 用户行为 | 1 | ARCH-1 target-stable Slide image replacement |
| component package 完整历史栈字段 | 2 | `slideCandidateComponentPackagesPast` / `Future` |
| package 栈源码引用行 | 19 | 其中 11 个读写点位于 `persistCandidateResult` |
| package 栈测试引用行 | 7 | 旧 snapshot 对齐断言 |
| 已上线 component-package delta producer | 0 | Core 类型/应用器存在，但产品命令未构造 delta |
| Flow/Spatial package-resource undo timelines | 0 | 文档可变，Store package map 不随 undo/redo |
| Flow/Spatial 会落入 no-op V8 壳的 Media actions | 6 | import sound(s)、audio settings、sound update/delete、asset delete |
| raw renderer Store imports | 23 files | W2 不得增加；Feature UI consumers 后续必须下降 |

结构字段与行为 consumer 分开计数。首批只要求目标行为不再增长完整快照；三个兼容 persistence adapter 与栈字段在其精确 consumer 尚未归零前保留，不能虚报删除。

## 3. Media 两素材批量入库 before-state

输入是两个互不冲突的新 AssetMeta + bytes，操作语义仅为 library import。

| 活动 Surface | revision | Surface history | sidecar full snapshots | 一次 Undo 的当前结果 |
|---|---:|---:|---:|---|
| Slide | `+1` | `+1` | `+1` | 可撤销整批，但依赖完整 sidecar snapshot |
| Flow | `+2` | `+2` | `+2` | 只撤销第二项，第一项仍存在 |
| Spatial | `+0` | `+0` | `+2` | 文档/bytes 不一起撤销，资源历史错位 |

原因：`importAssets` 在 Flow/Spatial 分支逐项调用 `importAsset`；Spatial 分支直接替换 `history.present.assets`，没有 revision 增量或 document history entry，却仍让 `persistSpatialResult` 压入完整 sidecar。

首批 after-gate：三 Surface 均为一次 revision、一次 logical history、零完整 sidecar snapshot；一次 Undo/Redo 必须原子移除/恢复全部 metadata 与 bytes，且任何 Slide scene、Flow block/overlay、Spatial world item 数量都不变。

## 4. Component package replacement before-state

| 活动/工程形态 | 当前结果 | 资源历史 |
|---|---|---|
| Slide-only | metadata、package resource 与 LayerItem 版本可更新 | 依赖一份完整 package-map snapshot |
| Mixed，且含 FlowComponentBlock | replacement helper 漏掉递归 Flow blocks，版本锁可使 V9 Schema 拒绝 | 无合法提交 |
| Flow active | 落入空 `commit()`；用户路径可显示完成但 V9 不变 | 0 |
| Spatial active | 同样落入空 `commit()`，V9 不变 | 0 |

正确的 planner 必须遍历并只改版本：global/surface shared ComponentLayerItem、Slide scene ComponentLayerItem、Spatial world ComponentLayerItem，以及任意嵌套 section 内的 `FlowComponentBlock`。实例 ID、props、fallback、几何、ownership 与 carrier 均不得变化。

首批 after-gate：手动替换与 Catalog update 继续共用一个 Store action；三 Surface/Mixed 均一次 revision、一次 history、一个 `ComponentPackageHistoryChange`；一次 Undo/Redo 同步恢复 package metadata、执行包与所有实例版本。旧 V8 planner 生产 consumer和 replacement 的空 `commit()` fallback 均由 1 降到 0。

## 5. 已确认但不混入首批的风险

- Library → canvas 涉及四种 placement：Slide LayerItem、FlowMediaBlock、Flow overlay LayerItem、Spatial world LayerItem；另卡迁移。
- Flow “从文件替换媒体”仍有 await 后目标/sidecar 会话漂移；另做 stable-target card。
- Component import/delete/editable copy/editable update 尚未全走 delta，因此 package snapshot 字段暂不可删除。
- Runtime asset replacement当前是先 import 再 binding update 的两次提交；W2-B 首卡处理。
- Runtime、Interaction、Flow teacher controller 在 Flow/Spatial 活动时存在 no-op/V8 projection 写入；W2-B 分行为迁移。
- Published V2 hosts 当前没有真实 Runtime execution 或 InteractionEngine consumer；Legacy authoring preview 在行为等价前不得删除。

## 6. 首批验收与量化下降

| 门 | 起点 | 首批目标 |
|---|---:|---:|
| Media library-only full-snapshot behavior consumers | 3 | 0 |
| Flow N-item library import commits | N | 1 |
| Spatial effective document history for N-item import | 0 | 1 |
| product asset-delta behaviors | 1 | 2 |
| product component-package delta producers | 0 | 1 |
| V9 replacement legacy planner consumers | 1 | 0 |
| replacement empty-commit fallback | 1 | 0 |
| resource-aware Surface histories | 1 / 3 | 3 / 3 |

每个行为还必须满足：exact project/revision conflict、输入不可变、一次 undo/redo、save/reopen、Published V2 read-only build、三份代表工程 validation，以及 ARCH-0A 性能阈值不回退。

## 7. 基线验证

只读审计在 clean `d6b56a2` 上分别运行：

- Media/History 聚焦：8 files / 38 tests passed；
- Components/Published 聚焦：10 files / 80 tests passed；
- repo-index `feature:media`、`feature:components`、`feature:editor-core` 均为 fresh/high/safe-for-S2；
- source-count 命令使用 `git grep`，未修改产品、合同、fixture 或用户文件。

这些 green 测试只说明旧覆盖通过；它们没有覆盖上述 Flow/Spatial batch/import/replace 错位。因此当前 pipeline status=`engineering baseline`，outcome status=`known-debt`，不得称为可接受行为。

