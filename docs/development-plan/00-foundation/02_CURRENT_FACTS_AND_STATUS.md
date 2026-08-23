# 当前仓库事实、成熟度与真实缺口

> 事实核查起点：计划整合前 main HEAD 为 `dbe518ea2223b994534e9f02d228873f264ffe11`；产品 TypeScript 源码与父提交 `690411d4a101b4020134712108262bddf08e0d2e` 一致。`dbe518e` 除方案/评估文档外，还刷新了 3 份 `artifacts/ai-capabilities` 生成物。计划落盘后的新 HEAD 由 ARCH-0A 记录；路径和符号优先于易漂移行号。

## 1. 当前协议与产品主路径

- 作者工程：Course Project V9，包含 `id` 与单调 `revision`；
- 发布：Published Course V2；
- Runtime：API 2 / Surface Runtime API 3；
- Component：API 4；
- V9 Schema 软冻结，不支持 V8 工程导入；
- V9 Try-run 与 Full Preview 的正式方向是 CoursePlayer + Published V2；
- Phaser 继续负责 Slide 编辑态命中和几何，不作为 V9 运行主路径。

## 2. 当前高耦合热点

| 文件 | 约大小 | 真实问题 |
|---|---:|---|
| `src/renderer/store/editorStore.ts` | 352 KB | V8 Project、三 Surface session/history、sidecar、组件、UI 与大量 action 混合 |
| `src/renderer/ui/Workspace.tsx` | 145 KB | 三 Surface、试运行、预览和编辑接线集中 |
| `src/renderer/ui/PropertiesTab.tsx` | 128 KB | 多 Surface、多节点、多模式属性逻辑集中 |
| `src/renderer/styles/globals.css` | 109 KB | 全产品样式集中 |
| `src/renderer/ui/InteractionEditor.tsx` | 85 KB | 互动模型与大 UI 混合 |
| `src/renderer/App.tsx` | 73 KB | 项目生命周期、Catalog、保存、预览、导出、诊断编排混合 |
| `src/renderer/ui/FlowWorkspace.tsx` | 65 KB | Flow 文本、块、浮层和布局集中 |
| `tests/e2e/editor.spec.ts` | 144 KB | 大多数核心 E2E 集中 |

文件大小只是风险信号，不是机械拆分门禁。

## 3. 当前 Store 真相

当前 Store 类型同时声明了三种 Surface 后端，但正常产品生命周期是 **exactly-one-active**：Slide backend、Flow session、Spatial session 三者始终恰有一个激活，切换时会显式清空另两个。初始化、三种新建和 V9 打开都会建立一个激活后端，不存在正常用户可达的“无活动 session 的合法 V9”状态。

当前结构中存在：

- 可写 `project: ProjectDocument`（V8 形状）；
- 当前激活 Surface 后端的 V9 `history.present`；
- `selectActiveCourseProjectDocument` 使用三个 nullable 字段的防御式 fallback 链取活动文档；该链不代表三份 V9 文档在运行时同时非空或相互竞争；
- `slideCandidateUi` 等只读/可回写风险投影；
- 为兼容 UI 而映射的通用 `history`；
- Slide/Flow/Spatial 各自的 session/history 实现（正常时只激活一套）；
- `CourseAuthoringSession`；
- Slide sidecar 与组件包完整 past/future 快照。

真实债务是“一个活动 V9 session + 可写/派生混杂的 V8-shaped `state.project` + 按 Surface 分开的 history 实现”，而不是三份同时激活的 V9 真相。同时，`src/renderer/store/history.ts` 已经有 patches、asset file changes 与 component package changes 的资源 delta 结构。目标应复用并泛化这一基础，而不是再发明一套平行二进制历史框架。

## 4. 当前编辑上下文

- `EditorMode` 只有 `simple | professional`；
- UI 文案是“简洁/专业”；
- DeveloperTab 是专业模式下的代码能力入口，不是现有第三种全局模式；
- `CourseAuthoringSession` 已包含 location、surface、revision、generation、itemIds 和 stale callback guard；
- `CourseAuthoringScopeToken` 已包含 global/surface/scene/world owner、ownerKey、location、surface、scene/state。

因此，不应新建与这些事实长期并存的第二套统一导航真相。

## 5. Surface 正确载体

| 场景 | Canonical carrier |
|---|---|
| Slide 场景内容 | `SlideSceneDocument.layerItems` |
| Flow 稿纸正文 | `FlowSurfaceDocument.blocks`；组件是 `FlowComponentBlock` |
| Flow 视口/稿纸浮层 | `surfaceLayerItems` 中的 `LayerItem`，由 `paperSpace` 区分 |
| Spatial 世界内容 | `SpatialSurfaceDocument.world.layerItems` |
| 全局内容 | `globalLayerItems` |
| Surface 共享内容 | `surfaceLayerItems` |

任何“所有实例都归一成 LayerItem”的实现都是错误的。

## 6. 已经成立、必须保护

| 能力 | 状态 |
|---|---|
| 新建/打开 V9 工程 | `existing / preserve` |
| 保存直接读取活动 V9 document + sidecar + component files | `existing / preserve` |
| RecoveryWriteCoordinator | `existing / preserve` |
| Try-run / Full Preview 的 V2 主路径 | `existing / preserve` |
| HTML/Web package 的 V2 主路径 | `existing / preserve` |
| CoursePlayer 与三 Surface Host | `existing / preserve` |
| player 不导入 renderer store | `existing / preserve` |
| read-model boundary 与 forbidden-token 棘轮 | `existing / preserve` |
| 组件包生命周期与三 Surface 挂载 | `existing / preserve` |
| contracts / ai-capabilities 生成与 check | `existing / preserve` |

## 7. 当前部分完成或 Legacy 消费者

| 能力 | 状态 | 真实缺口 |
|---|---|---|
| HTML/Web 导出 | `existing/preserve + legacy fallback` | V2 主路已存在；“无 publish sources”旧 fallback 在正常 V9 生命周期疑似不可达，须先做 reachability 证明，不得为它新建 sessionless V9 真相 |
| PPTX | `partial / legacy-consumer` | Slide-only 分支仍读 V8 projection |
| PDF / preflight | `partial / legacy-consumer` | PDF 先走 V2 print，但 raster fallback 仍可读 V8 projection；导出预检对正常 V9 工程也会先全量读 `state.project` 再合并 V9 报告 |
| Preview / HTML / Web no-source fallback | `legacy-consumer / reachability-unproven` | `projectCandidatePreviewDocument` 构造 V8-shaped projection；正常 V9 流程下无活动 sources 疑似不可达 |
| Project Health | `legacy-consumer` | App 实时对 V8 `project` 全量计算 |
| History | `partial` | 资源 delta 基础存在，但 Surface 历史和完整快照仍并存 |
| 现有 DeveloperTab 能力 | `existing/partial` | 专业模式内已有 Runtime/Object/Rules/Component 编辑；本轮只保留并改接稳定 target/transaction，不新建 Code Workspace 入口或第三模式 |
| Facade / Feature public API | `partial` | read-model 等局部先例存在，完整边界未形成 |
| repo-index | `missing` | 手工认知索引引用的结构化目录不存在 |

## 8. 知识系统事实

- `PROJECT_COGNITION_INDEX.md` 的旧版本曾引用不存在的 `repo-index/*` 和失效源码路径；2026-08-24 已改成明确的人工 Bootstrap 短入口。repo-index 仍未落地；“仓库没有 `agent-kit/` CLI”继续成立，不得反向恢复该旧工具；
- 仓库使用 `typescript: 7.0.2`；主导出不提供传统 `createProgram/createSourceFile` API；
- 评估中的只读 spike 表明 `typescript/unstable/sync` 可在当前规模快速遍历；
- 根 `tsconfig.json` 不覆盖 main/preload 和 e2e；开发导航必须同时覆盖 `tsconfig.json`、`tsconfig.electron.json`、`tsconfig.e2e.json` 并对共享文件去重；
- 本地 Git 对象 `0c12bb0d69268a00d407cddd9ea06c75ba202898` 可读，其 `repo-index` 底稿的 modules/features/tests 分层可作结构参考；但其路径、任务状态、V8/Agent Kit/Player 事实已过时，不得 cherry-pick、恢复或作为权威前置；
- 当前 AI 能力快照报告外部 Catalog `available`、共 4 个包；外部目录是可变输入，不得把“当前 4 包”写成架构不变量。

静态 repo-index 是自动多智能体长期执行的必要开发基础设施，但当前仍是 `missing`；任何文档在 ARCH-0B 完成前都不得把 `repo:index`、`repo:context` 或 generated 索引写成已经可用的当前事实。

## 9. 本轮真正关键路径

```text
正确的治理与基线
→ 可确定生成的 repo-index
→ 无环边界和最小窄 Facade
→ 一个完整 transaction/history 纵切
→ 跨 Surface Features 与三种 Surfaces
→ Preview / Export / Diagnostics 的真实 Legacy consumers
→ 删除重复真相
```
