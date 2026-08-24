# ARCH-3 Surface 模块化阶段门报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 合并产品候选：`d9a1b29`；后续任务状态提交未改变产品源码
>
> 结论：`pass / engineering candidate`

## 1. 结论

ARCH-3 以四张行为保持型实现卡完成，不为三个 Surface 预建对称架构：

- Flow-named → Slide 的直接边从初始 `3` 降为 `1`，旧 mutation calls 从 `4` 降为 `1`；唯一剩余项是生产零引用的删除候选；
- Spatial-named → Slide 的直接边从 `2` 降为 `1`，其中六-symbol 通用命中边已归零，剩余 content-edit 边按真实 consumer 条件保留；
- Course Project mutation 的函数实现从 Slide/Spatial 两份同构副本收敛为一份 neutral implementation；
- Slide-named renderer source 继续没有 Flow/Spatial 直接依赖；Surface-specific session、viewport/world、selection、history 与 carrier 均未合并。

Combined renderer TypeScript 通过，AST 所有权快照与预期完全一致。阶段状态为 pipeline green / engineering candidate；本阶段没有用户可见视觉或导出变化，不新增 art/teacher acceptance 结论。

## 2. 实现与 focused evidence 复用

| 任务 | 根提交 | 行为/边界 delta | 已通过的最小验证 | 独立审查 |
|---|---|---|---|---|
| Flow command 首 consumer | `1904d27` | `flowEditorCommands` Slide edge `1→0`；Flow-named edges `3→2` | `flowEditorCommands` + `courseTreeView`：`2 files / 22 tests` | APPROVE |
| Spatial hit 首 consumer | `40a3f37` | Spatial hit Slide edge `1→0`；导入 symbols `6→0` | Spatial workspace + Slide viewport：`2 / 14` | APPROVE |
| Flow shared overlay | `d9a1b29` | 目标 Slide edge `1→0`；旧 calls `2→0`；补 surface-overlay 逐页显隐 characterization | `flowSharedAuthoringAdapters`：`1 / 7` | APPROVE |
| Spatial mutation 去重 | `3361592` | 同构实现 `2→1`；Schema import `1→0`；consumer/calls 不变 | `spatialEditorCommands`：`1 / 6` | APPROVE |

四组 focused evidence 的 source/test/config invalidating paths 自各自审查后未变化，因此阶段门复用结果而未重复执行。命中这些行为的 Preview、Player、Export、Electron、E2E、desktop build、性能或代表工程输入也没有变化。

## 3. Combined-head 静态边界审计

使用 TypeScript 7 official unstable AST/snapshot 对 root `tsconfig.json` 的 renderer source 做一次性快照；未把结果固化成易碎 dependency ratchet。

| 审计项 | 当前结果 | 判断 |
|---|---:|---|
| Slide-named renderer sources | `14` | 范围与初次准入一致 |
| Slide-named → Flow | `0` edges | pass |
| Slide-named → Spatial | `0` edges | pass |
| Flow-named renderer sources | `15` | 盘点范围 |
| Flow-named → Slide | `1 edge / 1 old helper call` | retained deletion candidate only |
| `flowSharedAuthoringAdapters` neutral calls | `2` | pass |
| Spatial-named renderer sources | `13` | 盘点范围 |
| Spatial-named → Slide | `1 edge / 10 imported symbols` | retained content boundary only |
| `v9SpatialHitAdapter` → Slide | `0` | pass |
| mutation function-body declarations | `1`，仅 `courseProjectMutation.ts#commitCourseProjectMutation` | pass |
| Spatial mutation consumers/calls | `7 source consumers / 30 calls` | unchanged |
| Spatial history Schema imports | `0` | pass |
| Slide hit adapter local functions | `1`，仅 `editorPhaserPointerToWorld` | generic hit exports are zero-logic re-exports |
| `appendBlankFlowPage` incoming consumers | production `0`；test consumer files `1` | ARCH-5 deletion candidate |

精确 residual edges：

- `src/renderer/project/createFlowCourseProject.ts → ../course/slideEditorCommands`，只导入/调用 `commitSlideProjectMutation`；
- `src/renderer/authoring/spatialWorldAuthoring.ts → ./v9SlideContentEdit`，三个 resolver 与七个 draft/action/snapshot types，共十个 symbols。

Compatibility shape 也符合门禁：Slide mutation 是 neutral import alias + export，Spatial mutation 是 neutral const alias；`v9SlideHitAdapter` 的通用命中 symbols 全部从 `layerItemHitTest` 零逻辑 re-export，只保留 Slide Phaser pointer conversion。

## 4. TypeScript 与生成物

- Combined renderer TypeScript：`npx tsc --noEmit`，exit `0`。
- Task board：最终卡片状态固定后一次 generate/check 通过。
- Repo-index：最终报告和任务状态固定后 generate/check 通过；首次 closure snapshot 暴露任务卡仍写着旧的 artifacts 路径，纠正为实际 `repo-index/generated/**` 后只重做生成物 freshness，没有重跑产品验证。
- Diff hygiene：通过。

本阶段没有修改合同、Schema、capability metadata、semantic/golden facts 或依赖，因此不重复 contracts、AI capabilities、golden quality、完整 test/E2E/build/performance 等不相关检查。

## 5. Retained boundaries 与重入条件

### Spatial content edit

保留 `1 edge / 10 symbols`。三个 resolver 当前仅被 Spatial 改名 re-export，仓库没有在线 consumer；其余为 draft/action/snapshot types。重入条件：Spatial UI 真实消费共同 key/blur/selection policy；第三个 Surface 需要相同 draft contract；或出现可复现的 Slide/Spatial 编辑行为漂移。

### Store 与 generic helper consumers

保留。只把部分 calls 换成 neutral 名称不能消除它们仍需的 Slide session/history/constants 边，有些还会新增第二条 import。对应用户行为真实修改且能消除完整边界时再准入。

### `appendBlankFlowPage`

进入 ARCH-5 deletion candidate。当前生产 incoming consumer 为 `0`，一个测试明确证明它已被 `addCourseFlowPage` 替代且旧 helper 缺少 mixed print plan 同步。ARCH-5 仍需重查静态、动态、字符串、package/config/artifact、兼容与生成物八类删除门禁，不从本报告直接授权删除。

## 6. 状态分层与下一阶段

- Pipeline：green。Focused evidence 新鲜；combined TypeScript、静态快照、task-board/repo-index freshness 与 diff hygiene 全部通过。
- Engineering：`engineering candidate / pass`。真实跨 Surface 边和重复 implementation 下降，保留边有证据和重入条件，没有新增平行 transaction/history/facade。
- Outcome：本阶段只移动实现所有权并增加 characterization，用户可见编辑、运行和导出结果预期不变；最近有效的产品结果证据未失效。
- Art / accepted：未产生新视觉结果；不声明新的 `art candidate` 或教师 `accepted`。

ARCH-3 阶段门关闭后，下一步仅启动 ARCH-4 的格式/consumer 必要性准入；本报告不自动授权任何 Preview、Player、Export 或 Legacy 迁移。
