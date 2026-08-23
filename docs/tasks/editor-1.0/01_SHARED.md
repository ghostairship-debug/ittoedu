# 共享约束（历史冻结）

> 本文件只适用于已完成的 Editor 1.0 T/P/Q/F/G 历史任务，不再作为当前开发协议。当前规则见 [最终详细执行方案](../../development-plan/README.md)。

所有 Editor 1.0 收尾任务必须遵守。与源码冲突时以源码为准，并在同一变更修正文档。

第三方 / 高性价比工人还要遵守 [02_WORKER.md](02_WORKER.md)（Git、文件防火墙、停手条件）。任务卡比本文件更具体时，以任务卡的「允许 / 禁止 / 逐步算法」为准。

## 已锁定决策

1. **Course Project V9 是唯一作者工程真相。** 新建、编辑、保存、恢复、Player、导出、工程检查和 AI 构建都只写 V9。
2. **删除 V8 导入。** 没有需要再打开的 V8 `.h5lesson`。不保留密封导入器。Archive 只接受 `schemaVersion === 9`；其他整数版本为 unsupported；缺少版本或损坏为 corrupted。
3. **空白工程直接构造 V9**，不得 `migrateProjectV8ToCourseProjectV9(createProject())`。
4. **不新增** `projectMode`、四模式字段、Hash/审批/Evidence 教师流程、可见 AI、每场景一份教师控制器副本。
5. **不启动 V10。** 统一图层尚未完整支持 ownership-aware 操作前，保留现有全局/surface 共享作者入口。
6. Vite `chunks larger than 500 kB` 不当缺陷修。
7. 自动化最多 `engineering candidate`。`accepted` 必须来自教师。
8. **V9 试运行 / 整课预览走 CoursePlayer + Published V2 宿主**，不要把 Phaser `PlayerApp` 接回 Mixed 主路径。Phaser 仍只服务 Slide 编辑命中。
9. **所有画布默认 `#ffffff`，颜色可改并写入 V9**（Slide 用场景字段；Spatial/Flow 用 T1 可选字段）。
10. 课程结构能删除整组，同类型位置能跨组调整。主按钮文案区分「新增流式讲义 / 新增无限画布 / 新增演示页面」。

## 两条车道

```text
车道 P  产品事实与教师可感知收尾     可改 UI，不改 V9 判别器
车道 C  合同冻结与协议去 V8         已完成；此后 Schema 仅 additive，且单独提交
```

同一提交不得同时改 Schema 判别器和教师可感知交互。

12.2 的 P1–P7 与 12.3/12.4 的 P8 全部属于车道 P，**均已合入**。不要再领取。T1 的 additive `backgroundColor` 已合入。V9 已软冻结：不要改已有字段/判别器；新可选字段须单独合同提交。

## 禁止

- 从 `f272756` 或 donor HEAD 当产品主干再重建。
- 领取已删除的 R0–R8 任务卡。
- 为「看起来纯 V9」一次性拆掉全部 `SceneNode` 投影。
- 本轮重写整个 `editorStore.ts` 或 `Workspace.tsx`。
- 用 `.passthrough()` / `z.unknown()` 弱化核心合同。
- 把 Player DOM 或投影副本存成工程。
- 靠删测试降覆盖率；V8 import 测试里的通用保存/导出/恢复必须先迁到 V9 夹具。
- 宣称编辑器内已有 AI。
- 为修视频/控制器而恢复 V8 导入或双后端。
- 每表面复制教师控制器，或把控制器写进 scene `layerItems` 冒充「本页控件」。
- 把 P 车道缺陷标成 `accepted` 或 `art candidate` 而不做课例复核。

## 1.0 之后才做（不要绑进本包）

统一 Command 层、拆分 `editorStore`、删光 `SceneNode`、拆 Workspace、Player Authoring 改语义 Patch、Editor 2.0 聊天/模型。为「时好时坏」做的大规模会话重挂治理也放到 1.0 之后；本包只修 P1–P4 列明的竞态。

## 兼容承诺（V9 软冻结）

- 能读取所有合法 V9 工程。
- 不改变已有字段和判别器含义。
- 不重新解释统一图层顺序、owner、location、presentation state、稳定 ID。
- 不允许旧 V9 工程被静默丢字段。缺 `backgroundColor` 的旧 Spatial/Flow 工程视为白底。
- 允许 additive 可选字段（须写入 Schema、写明缺省、单独合同提交、保持 `.strict()`）。
- 不承诺旧编辑器打开含新键的课。
- 不要求当前编辑器读取 V10+。
