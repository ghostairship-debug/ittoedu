# 项目认知索引

> CURRENT_PRODUCT: 仓库根目录 / `main`（V9 重建已合入；已提交 HEAD 见 `git rev-parse HEAD`）
> HISTORICAL_V8_BASELINE: `f27275658c6dfaa12f2ce35cd9368dcdebe99451`（只作历史对照，禁止再从此重建）
> HISTORICAL_V9_DONOR: `475503498323`（只作供体与失败取证）
> EXECUTION_PLAN: [`COURSEWARE_DEVELOPMENT_PLAN.md`](COURSEWARE_DEVELOPMENT_PLAN.md) 12.11
> TASK_PACK: [`docs/tasks/editor-1.0/00_INDEX.md`](docs/tasks/editor-1.0/00_INDEX.md)
> WORKER_PROTOCOL: [`docs/tasks/editor-1.0/02_WORKER.md`](docs/tasks/editor-1.0/02_WORKER.md)
> UPDATED: 2026-08-19
> PURPOSE: 帮助新 Agent 用最少上下文进入真实代码

本文件是导航，不是源码替代品。若索引与源码、Schema 或可复现证据冲突，以源码事实为准并在同一变更中修正索引。

结构化入口位于 [`repo-index/`](repo-index/README.md)。当前只维护 modules、features 和 tests，不建设全量符号图、依赖图、热点系统或知识图谱服务。

## 1. 新 Agent 的最短启动顺序

1. 阅读 [`AGENTS.md`](AGENTS.md)。
2. 阅读唯一总纲 [`COURSEWARE_DEVELOPMENT_PLAN.md`](COURSEWARE_DEVELOPMENT_PLAN.md) 12.11。领取实现任务的第三方工人先读 [`docs/tasks/editor-1.0/02_WORKER.md`](docs/tasks/editor-1.0/02_WORKER.md)。稳定性方法见 [`docs/tasks/editor-1.0/S0_STABILITY_EXPLORATION_PLAN.md`](docs/tasks/editor-1.0/S0_STABILITY_EXPLORATION_PLAN.md)；S0 阶段禁止改产品代码。
3. 领取任务只看 [`docs/tasks/editor-1.0/00_INDEX.md`](docs/tasks/editor-1.0/00_INDEX.md)。旧 `v8-to-v9-rebuild` 任务包已删除。
4. 当前产品就是仓库根目录。历史 worktree 与 `codex/v9-editor-v8-base` 只作供体，不得再当第二套当前版。
5. `docs/reviews/**`、`docs/INTERNAL_1_0_MILESTONE_0.md` 与旧评估稿只作历史取证，不是当前执行入口。
6. 运行 `git status --short`，保留所有不属于当前任务的修改和未跟踪文件。
7. 从本文件“改什么看哪里”进入相关源码，不先遍历全仓库。
8. 按任务卡跑最小验证。全量命令只属于 T6。

## 2. 真相优先级

1. 用户当前明确要求与最近的 `AGENTS.md`。
2. `src/shared/*Schema.ts`、当前源码和可复现运行证据。
3. [`COURSEWARE_DEVELOPMENT_PLAN.md`](COURSEWARE_DEVELOPMENT_PLAN.md) 的产品决策和执行路线。
4. 本索引及 `repo-index/*.json`。
5. 历史阶段计划、评估原稿、旧截图、示例构建脚本和 donor 代码。

索引中的路径以仓库根目录为准。使用前先识别目录角色：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
```

当前执行以仓库根目录源码为准。`f272756` 与 `3e41ec0..4755034` 只用于对照历史行为，不是开工基线。若任务需要的路径与实际源码不同，先修正索引，不按历史文件名猜实现。

## 3. 正式入口链

### Electron 与 Renderer

```text
src/main/index.ts
  → src/main/createWindow.ts
  → src/preload/index.ts
  → src/renderer/main.tsx
  → src/renderer/App.tsx
```

任何 CourseStudioApp、V9EditorShell、controlled editor 或第二产品路由都违反根计划。

### 编辑工程真相

工程真相已经是 Course Project V9。Store 里仍有 `v9-slide-candidate` / `V8SlideBackend` 过渡命名，按 T3 收口，不得再引入可写 V8 backend。V8 `.h5lesson` 不再导入；打开非 9 的工程应为不受支持（T2 删除现有导入 UI）。

### Slide 作者画布

```text
V9 Course session
  → buildV9SlideWorkspaceSnapshot
  → WorkspaceSlideAuthoringInput
  → Workspace.tsx
  → EditorPhaserBridge / EditorScene / ProxyNodeAdapter
  → Phaser 负责命中和几何

同一 V9 snapshot
  → Published/authoring preview projection
  → Player host
  → Player 负责视觉真相
```

不要让 Phaser proxy 成为保存或视觉数据源，也不要从 Player DOM/Canvas 反建工程。

### Published 运行与导出

```text
CourseProjectArchiveData
  → buildPublishedCourseV2Payload
  → 产品：当前位置试运行与整课预览走 CoursePlayer + FlowSurfaceHost / SpatialSurfaceHost / SlidePublishedAdapter
  → Phaser PlayerApp 不是 V9 Mixed 试运行主路径（P1 按此修视频/控制器）

同一 producer
  → 优先接现有 buildWebPackage / buildStandaloneHtml / buildPptx
  → Flow DOCX 调用已有 flowDocx.ts
```

## 4. 稳定模块地图

| 模块 | 主要文件 | 负责什么 |
|---|---|---|
| V9 工程合同 | `src/shared/courseProjectTypes.ts`, `courseProjectSchema.ts`, `courseProjectModel.ts` | 工程类型、校验、纯模型与引用一致性 |
| Published 合同 | `src/shared/publishedCourseTypes.ts`, `publishedCourseSchema.ts` | 发布 payload 的类型与校验 |
| 编辑会话 | `src/renderer/store/editorStore.ts` | 当前 backend、V9 session、history、文件/UI session action |
| Slide 模型 | `src/renderer/course/v9SlideVerticalSlice.ts`, `slideEditorView.ts`, `slideEditorCommands.ts` | location/scope/selection、只读投影与原子 command |
| 原产品壳 | `src/renderer/App.tsx`, `src/renderer/ui/**`, `src/renderer/styles/globals.css` | 教师可见工作流和原 UI |
| Phaser 作者链 | `src/renderer/ui/Workspace.tsx`, `workspaceSlideAuthoring.ts`, `src/renderer/phaser/**` | 命中、选择、变换、viewport 和作者代理 |
| 文件生命周期 | `src/renderer/project/courseProjectArchive.ts`, `recoveryWriteCoordinator.ts`, `src/main/projectPersistence.ts`, `src/main/ipc.ts` | 打开、保存、sidecar、恢复、最近工程和关闭 |
| Published Player | 产品 `PlayerApp.ts` + 已有 `surfaces/flow`、`surfaces/spatial` | 课程会话、表面 Host、导航 |
| 互动与动态运行 | `src/player/InteractionEngine.ts`, `CourseEventBus.ts`, `DeclarativeCourseState.ts`, Runtime/Component hosts | 事件、条件、动作、运行时和组件会话 |
| 发布导出 | `src/renderer/export/course/**` | producer、HTML/网页包、PPTX、PDF/DOCX |
| Builder/能力卡 | `.agents/skills/orchestrate-courseware`, `.agents/skills/build-courseware-project`, `artifacts/ai-capabilities/index.json` | 课件策划、V9 构建、能力发现。仓库没有 `agent-kit/` CLI |

详细机器可读版本见 [`repo-index/modules.json`](repo-index/modules.json)。

## 5. 改什么看哪里

| 任务 | 首先查看 | 同时核对 | 不要做 |
|---|---|---|---|
| 新建/打开/保存/关闭/恢复 | `App.tsx`, `editorStore.ts`, `courseProjectArchive.ts` | main IPC、persistence、recent、sidecar | 回落 `saveProjectAsync`、恢复 V8 导入 |
| Slide scene/state/scope command | `v9SlideVerticalSlice.ts` | `slideEditorView.ts`, Store wrapper, Schema | 从 V8 view 反建 V9 |
| 画布选择/拖动/缩放 | `Workspace.tsx`, `workspaceSlideAuthoring.ts` | Phaser bridge、stage viewport transform | 新建 Slide Workspace |
| 图层/属性/元素 UI | 对应原 `*Tab.tsx` | App documentControl、Store target token | 受控路径读取 hidden V8 project |
| 教师控制器作者态 | V9 slice、Workspace、Nodes/Properties | teacher controller layout、preview projection | 编辑态执行导航 |
| 教师控制器播放态 | Published 宿主 + `TeacherControllerDom` | `SlidePublishedAdapter`、Flow/Spatial host、`publishedDynamicHosts.ts` | 编辑态执行导航；每表面复制控制器 |
| 试运行跨表面跳转 | `editorStore.activateCourseLocation`、`apply*Backend` | `Workspace` course-try-run `goToLocation` | 跨表面时写死 `canvasMode: 'edit'`（P2 修） |
| 画布底色 | Spatial CSS、`SpatialSurfaceDocument`、Slide 场景字段 | `derivedV8ProjectFromSpatial`、Properties | 只改假 V8 投影；写死 `#111318` |
| Slide 互动 | producer、`InteractionEngine.ts`, Published App/Slide Host | event bus、状态与 destroy | 用 Runtime 热点永久绕行 |
| Runtime/Component | shared contracts、player hosts、Developer/Components/Properties | asset/package sidecar、authoringAddress；P8 已挂 Flow/Spatial/Slide 试运行 | 复制 CourseStudio 动态编辑器；把空 catalog 当成不能新建组件 |
| Flow | V9 model/view、原壳适配、`FlowSurfaceHost.ts` | PDF/DOCX、统一课程状态 | 复制 FlowBlockEditor UI |
| Spatial | viewport/relations model、`SpatialSurfaceHost.ts`、`spatialPlaybackGestures.ts` | world/viewport 坐标分离、会话相机自由逛与镜头巡游 | inverse-scale 补偿控制器；运行态禁止平移 |
| 课程树删除/跨组 | `ScenePanel.tsx`、`courseLocationCommands.ts` | `planCourseTreeReorder`、`deleteCourseSurface` | 用删 Flow 标题块冒充删整页（P6） |
| HTML/网页包 | `buildPublishedCourse.ts`, `buildCoursePackages.ts` | Player bundle、资源清单 | 恢复 `.course-nav` |
| PPTX/PDF/DOCX | 对应 `buildCourse*.ts` | print plan、fallback、真实打开 | 只断言文件存在 |
| 能力说明 | docs、Skill、Agent Kit capability index | 当前正式 UI 和 tests | 声明尚不可达能力 |

## 6. 当前阶段与首要风险

当前阶段是 **稳定性内核（车道 S）**：T0–T6、P1–P8、Q1–Q8、F1–F3、G0–G3 已合入 `main`。不是 `accepted`。第一方案见 [`docs/tasks/editor-1.0/S0_STABILITY_EXPLORATION_PLAN.md`](docs/tasks/editor-1.0/S0_STABILITY_EXPLORATION_PLAN.md)。禁止在 S0 阶段改产品代码。

- 产品：仓库根目录 / `main`
- V8 导入已删除（T2），不是长期兼容面
- 首要风险：继续按功能卡打 `editorStore.ts` / `Workspace.tsx` 造成崩溃与空白回退；跳过探索直接拆 Store；按已删除的 R0–R8 施工；把 Phaser 接回 V9 试运行主路径

## 7. 关键不变量

- 原 App、原 Workspace、原 UI 文件和 Phaser 链保持正式可达。
- 一个当前工程、一个 Store 生命周期、一个 V9 写入真相。
- 一次用户操作一次 command/history/revision。
- 选择和异步提交使用 session/location/state/scope/layer 的稳定 target，拒绝陈旧回调。
- editor view、authoring proxy、Player preview 各自是只读投影，不可互相反序列化。
- global/surface 作者态可显示 base 对象；Player 必须遵守 effective visibility。
- global/surface 继续作为 V9 存储、作者与运行能力；四态左栏固定提供“共享内容 → 全局层（全课）”，统一有效图层不能取代该可见入口。
- 纯 Slide/Flow/Spatial 与 Mixed 从 `locations/surfaces` 推导，不新增 `projectMode` 或 V10 迁移；新建工程和课程结构必须有三类 surface 的直接创建入口。
- “轻量”只控制默认信息密度和渐进披露，不得删除、禁用或隐藏到不可发现 V8 已有能力。
- 编辑态控制器 inert；试运行控制器可执行但只改会话。
- Spatial world 与 viewport 控件使用不同坐标空间。
- HTML/网页包无画布外旧导航。
- 普通教师 UI 不暴露内部协议词和 ID。

功能级不变量见 [`repo-index/features.json`](repo-index/features.json)。

## 8. 验证选择

优先查询 [`repo-index/tests.json`](repo-index/tests.json)。通用原则：

- docs/index：只查链接、JSON、diff。
- 单函数/组件：只运行任务文档列出的 1–2 个最相关 Vitest 文件。
- T0–T5：禁止全量 `npm test` / typecheck / e2e / desktop build。
- 只有 [T6](docs/tasks/editor-1.0/T6_FREEZE.md) 可跑全量命令。不得在未获教师确认时写 `accepted`。

不要因为存在 `npm run verify:full` 就在开发循环运行它；中间类型或构建风险记录到 HANDOFF，由 T6 一次性验证。

## 9. 高风险文件提示

这些文件职责多、调用链长，修改前先找窄边界。12.11 起它们属于稳定性内核候选，功能卡默认冻结；**S0 仍禁止以稳定性为名立刻重构**，见 [S0](docs/tasks/editor-1.0/S0_STABILITY_EXPLORATION_PLAN.md)：

- `src/renderer/App.tsx`
- `src/renderer/store/editorStore.ts`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/course/v9SlideVerticalSlice.ts`
- `src/player/PlayerApp.ts`
- `src/player/surfaces/flow/FlowSurfaceHost.ts`
- `src/player/surfaces/spatial/SpatialSurfaceHost.ts`
- `src/shared/courseProjectModel.ts`
- `src/renderer/export/course/buildPublishedCourse.ts`

只做当前结果需要的最小改动。没有当前消费者时，不抽象 adapter、service、command framework 或插件层。

## 10. Donor、旧协议与生成物

不可作为正式前端母体：

- `src/renderer/course/CourseStudioApp.tsx`
- `CourseSurfaceCanvas.tsx`
- `V9EditorShell.tsx`
- `course-studio.css`
- donor 的整套 Flow/Spatial/互动/播放 UI

`src/shared/projectTypes.ts` / `projectSchema.ts` 在 T1 抽离共享合同前仍被 V9 引用；不要按文件名当成「当前工程格式是 V8」或批量删除。V8 导入相关源码由 T2 删除，不要提前拆掉仍被空白工厂调用的 migration 而不改工厂。

不要手工修改 `dist-player/`、`dist-renderer/`、`dist-electron/`、`output/`、`test-results/` 或示例内生成的 `course.html`。只有对应源码变化且任务要求刷新时才运行生成脚本。

## 11. 工作树卫生

- `git status --short` 中已有修改默认属于用户或其他工作，不得覆盖、回退或顺手提交。
- 若工作树出现评估材料，默认视为用户自有文件；除非用户明确要求，不读取、修改或纳入提交。
- 不使用 `git reset --hard`、批量 checkout 或递归删除来清理工作树。
- 提交前只暂存本任务明确修改的文件。
