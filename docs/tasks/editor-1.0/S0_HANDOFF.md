# S0 HANDOFF：探索产物（E1–E5）

> 日期：2026-08-19
> 状态：探索完成，供 [S1](S1_STABILITY_CODE_PLAN.md) 使用。本文件不改 `src/**`。
> 方法：[S0_STABILITY_EXPLORATION_PLAN.md](S0_STABILITY_EXPLORATION_PLAN.md)

五名 Gemini 3.7 子代理并行取证；父代理复核源码后写本笔记。子代理原文不得直接当事实：见文末「复核」。

---

## E1 生命线表

| ID | 触发 | Store / command | session / revision / sidecar | Host mount/destroy | UI 读什么 | 失败通道 | 类 |
|---|---|---|---|---|---|---|---|
| L1 | 启动 → 读恢复 | App effect `readRecoveryProject` | 尚未 load session | 无 | 对话框 | `UserFacingError` / toast「无法读取本地恢复状态」；peek 失败空 catch 当无官方文件 | A/B |
| L2 | 打开合法 V9 zip | `openDefaultCourseProjectAsync` → `loadCourseProject` | 按起始表面 `apply*Backend`，sidecar=`freezeCourseAssetSidecar` | Workspace 随 session 种类挂编辑 Host | V9 present + 投影 | 损坏/非9：`UserFacingError`，不进 boundary | B |
| L3 | 打开损坏 / 非 9 | `refuseUnsupportedOrCorrupt` | 不写 session | 无 | 无 | 中文 `UserFacingError` | —（已相对健康） |
| L4 | Mixed：Slide→Flow→Spatial→Slide | `activateCourseLocation` → 跨表面 `apply*Backend` | **整段重建**互斥 session；`canvasMode` 可由 P2 保留 `run` | 子树切换：拆 Phaser 或 Flow/Spatial 容器，再挂新的 | 新 session.present | composing 中文拒绝；switch 失败只 set error，**保留旧 session**（不半毁） | B/C 闪白 |
| L5 | 同表面切页（Slide） | `activateScene` + `persistCandidateResult` | 复用 slideBackend | Phaser **不**因切场 destroy | snapshot.locationId | stale → 英文 reason toast | C |
| L6 | 编辑→当前位置试运行→回编辑 | `setCanvasMode` | **作者 session 仍在** | Slide：CoursePlayer 挂到独立 DOM；Phaser **继续活着只是隐藏**。Flow/Spatial：CoursePlayer 挂 `tryRunRef` | Slide `tryRunMountKey` 含 **revision**；Flow/Spatial effect 依赖整个 `session` 对象 | 挂载 `onError`→试运行 feedback；`enqueueSerial` destroy 吞错 | A/B |
| L7 | 整课预览开/关 | App `beginSerializedSessionMount` + `mountPublishedCourseTryRun` | 不改作者 session | overlay Host；关闭 `enqueueSerial(destroy)` | `selectActiveCourseProjectDocument` | `onError` 预览 feedback | B |
| L8 | 插入媒体后撤销保存重开 | media command + sidecar 栈 | present.assets + `slideCandidateSidecar` **两套历史** | blob URL 多处自建自毁 | sidecar.files | 字节与引用分叉 → 空白 | B/C |
| L9 | 输入中切页 | composing 守卫 | 不改 session | 不重挂 | — | 中文 `COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON` | C（故意拒绝，文案已人话） |
| L10 | 过期 `expectedRevision` | command `ok:false reason: stale-revision` | **不**推进 revision | 无 | toast | **英文** `stale-revision` 直出；不重试 | C |
| L11 | React 子树 throw | 无 | 文档仍在 Zustand | 整棵 App 卸掉 | `AppErrorBoundary` 全屏 | 仅一层 boundary；保存栏一并消失 | A |
| L12 | 恢复副本写入 | `RecoveryWriteCoordinator` | 快照用 V9 present + sidecar | 无 | toast | `onError` 中文「请立即手动保存」 | B |
| L13 | 保存 | `currentCourseArchiveData()` | **读活 session present**（无文档则 UserFacingError） | 无 | — | 桌面 `DesktopOperationError` 映射磁盘满/权限 | —（打开保存相对健康） |

启动恢复：`shouldOfferCourseProjectRecovery` 在官方 revision **高于**恢复副本时 `ignore-stale-official` 并清理副本，**不会**用旧副本覆盖官方文件。

---

## E2 所有权矩阵

| 状态 | 只应被谁写 | 今天实际写入点 | 只应被谁读 |
|---|---|---|---|
| `CourseProjectDocument` | command → `persist*Result` / `apply*Backend` | 三条 persist + 三条 apply；保存不回写 present（只清 dirty） | 保存、导出、试运行、选择器 |
| `revision` | 成功 command | persist 成功分支 | stale 检查 |
| sidecar bytes | media command + persist sidecar 栈 | `slideCandidateSidecar`；`assetFiles` 仍被 `projectedAssetFiles` 同步 | `selectMediaAssetFiles`（有活 session 时） |
| blob URL | 单一 `BlobUrlRegistry` | **未统一**：Workspace / FlowWorkspace / MediaTab / SceneThumbnail / preview / export 各自 `createObjectURL` | 编辑 DOM、缩略图 |
| 活作者 session | `apply*Backend` 唯一入口 | 已基本收口；`activateCourseLocation` 同表面走 persist 不 apply | Workspace 三选一 |
| 活 Host | 每表面一个 SessionHandle | Phaser 与 CoursePlayer **同时存活**（Slide run）；整课预览第三条链 | 该表面 UI |
| `canvasMode` | 教师切换；导航仅在已是 run 时保留 | `apply*Backend` 默认 `'edit'`，P2 传入 preserve | Workspace 挂载选择 |
| `editingScope` | 左栏 / 明确入口 | 仍有选择副作用风险（Q1 已压） | command 守卫 |
| Phaser game | Slide 编辑 Host | `createEditorGame`；cleanup 只在 `SlideLocationWorkspace` 卸掉时 destroy，**不随 run 卸** | 命中与变换 |
| 教师错误 | ErrorOwner | persist 英文 reason；空 catch；boundary；局部 feedback | toast / 崩溃页 / 试运行条 |

所有权分裂（S1 必须收口）：blob URL、Host（Phaser+Player 双活）、错误通道、sidecar 与 `state.project` 投影。

---

## E3 双路径债

| 意图 | 路径 1 | 路径 2 | 何时 | 不一致时 |
|---|---|---|---|---|
| 读当前课 | `selectActiveCourseProjectDocument`（session.present） | `state.project`（derivedV8） | 保存/试运行走 1；大量 UI/导出/健康检查走 2 | 保存对、屏幕错，或相反 |
| 读当前场景节点 | `slideCandidateUi` | `state.project.scenes` | `selectActiveScene` / `selectEditingNodes` 先 1 后 2 | 无活 snapshot 时读过期 V8 |
| 素材字节 | `slideCandidateSidecar.files` | `state.assetFiles` | 有任一会话走 sidecar，否则 assetFiles | 打开测试仍 `loadProject`+assetFiles |
| 当前位置试运行 | **产品**：三表面都 `mountPublishedCourseTryRun` | **测试/遗留**：`mountSpatialLocationTryRun` / `mountFlowLocationTryRun` 直挂 SurfaceHost | Workspace 产品走 1；单测走 2 | Q0 级「有时能看见」若测试绿、产品路径不同仍可能回潮 |
| Slide 编辑预览 | Phaser + 仍存在的 iframe Runtime Preview（edit） | CoursePlayer（run） | `useCoursePlayerTryRun` 时清 iframe | run 时 Phaser 未毁，双 GPU |
| 打开工程 | 产品 `loadCourseProject` | `loadProject` = migrate V8→V9 再 loadCourse | **生产无调用者**；测试仍 loadProject | 测试绿灯不代表产品打开路径 |
| command 失败 | 部分中文 reason（composing、部分 Flow） | 英文 `stale-revision` / `locked` / `wrong-owner` | persist 一律 `errorMessage: result.reason` | C 类「没反应」或英文 toast |
| 恢复调度 | 快照内容是 V9 present | effect 依赖 `state.project` | App recovery effect | 投影未变则可能漏写恢复副本 |

已消掉（不要当 S1 再修一遍）：产品当前位置试运行 **不再** 三套 Host 工厂并行；P2 跨表面可保留 `canvasMode==='run'`；打开非 9 已 UserFacingError。

---

## E4 动态取证

本轮未跑 Electron。静态生命线已足够区分所有权分裂 / 被吞错误 / 双路径 / 重挂。S1 实现卡必须用夹具补生命线测试，而不是再开一轮纯阅读。

---

## E5 不变量（证实后作为 S1 验收）

| # | 不变量 | 现状 | 测试 |
|---|---|---|---|
| 1 | 至多一个活作者 session（slide / flow / spatial 互斥） | `apply*Backend` 已互斥清空 | 产品集成测有，缺「切换失败仍互斥」 |
| 2 | 持久化读取不得在活 session 存在时回落过期 `state.project` | **保存已走 present**；导出/健康/部分 UI 仍回落 | 无 |
| 3 | 被引用 asset 有字节或明确占位 | sidecar 空则空 src | 无生命线 |
| 4 | 同一 DOM 容器同时一个 Host | 容器已分开；**进程内** Phaser+Player 双活 | `serializedSessionMount` 只测串行 |
| 5 | `edit` 时 CoursePlayer 未挂；`run` 时 Phaser 不接收写入 | 手势有 canvasMode 守卫；Phaser RAF 仍跑 | 无 |
| 6 | 失败 command 不推进 revision；过期手势丢弃或对最新 present 重放；教师中文 | revision 已不推进；**英文 toast、无重放** | command 单测有 stale，无 Store toast 断言 |
| 7 | React 子树失败不得拆掉打开/保存/恢复壳 | **违反**：一层 boundary | 仅有 boundary 自身渲染测 |
| 8 | 导出/预览失败不 `set` 作者 session | 基本成立 | 无 |
| 9 | StrictMode 下 destroy≥mount | 挂载链串行，设计对称 | `serializedSessionMount.test.ts` |
| 10 | 恢复 identity 失败不得覆盖官方 zip | `ignore-stale-official` 成立 | 有 lifecycle 纯函数测 |

---

## 复核：Gemini 子代理 vs 源码

| 代理 | 采用 | 驳回 |
|---|---|---|
| SessionOwner | apply 互斥表、composing 守卫、失败不半毁、persist 英文 reason、选择器优先级 | 「Active Document null 导致解包崩溃」夸大：保存路径已 throw UserFacingError |
| Host 生命周期 | tryRunMountKey 含 revision；enqueueSerial 吞错；Slide run 时 Phaser 不毁；StrictMode 串行 | **产品 Spatial/Flow 试运行不是 `mountSpatialLocationTryRun`**，而是 `mountPublishedCourseTryRun`。专用工厂几乎只被测试引用 |
| 双真相 / 资源 | sidecar 写真相、blob 无单一 registry、UI 大量 `state.project` | `loadProject` **生产零调用**，不是「打开主路径仍 migrate」。打开已是 `loadCourseProject` |
| 错误通道 | 一层 boundary、stale 英文直出 | **谎称没有** `appErrorBoundary.test.tsx`（存在）。把 persist 失败当成空 catch 不准确 |
| 打开保存恢复 | （无输出，父代理补完） | — |

硬停止条款有效：无 Read 循环。持久化代理零产出，不resume，避免空转。
