---
name: build-courseware-project
description: 从已确认的 01-teaching-plan.md 与 02-presentation-script.md 构建、增量修复和验证当前编辑器支持的可编辑互动课件。Use when the agent should act as a clean Build Coordinator, discover current capabilities from artifacts/ai-capabilities/index.json, select Native/Runtime/Component ownership, write Course Project V9 via product factories and V9 commands, export deliverables, or make a revision-protected edit at a stable authoringAddress using the same commands a teacher would use.
---

# 构建互动课件工程

以两份当前教学文件为体验真相，以 Capability Index 和源码为工程真相。交付可编辑 Course Project V9（`.h5lesson`）与离线 HTML；不得用旧聊天、旧课件或模板补写缺失内容。

仓库里**没有** `agent-kit/` CLI。不要运行 `courseware-agent-kit.mjs`，也不要虚构 `scaffold` / `graph` / `assemble` / `rig` / `validate --workspace`。

## 1. 冷启动

1. 直接读取 `01-teaching-plan.md`、`02-presentation-script.md` 和其中引用的材料。
2. 读取用户本轮约束；不继承被否决的设计和无关聊天摘要。
3. 确认编辑器根目录就是当前 git 仓库根（`main` 上的 Course Project V9）。能力索引：`<editor-root>/artifacts/ai-capabilities/index.json`。
4. 若两份文件缺失关键教学内容、表面选择或逐步操作，或实现必须改变教师可感知体验，返回 `$orchestrate-courseware`；不要猜。未确认的策划或脚本不得当作成品输入。

## 2. 发现能力

先读索引，不通读整库。需要解释时再读 [current-capabilities.md](references/current-capabilities.md)。

```text
<editor-root>/artifacts/ai-capabilities/index.json
```

按查询打开它指向的 `schemas/`、`diagnostics.json`、`limits.json` 或组件快照。索引过期时用 `npm run check:ai-capabilities` 核对，不要手写一份对不上的 JSON。

只使用当前存在且适配需求的能力；计划中的能力不能冒充已发布。`surfaces.types` 为 `slide` / `flow` / `spatial-2d`，状态 `available`。Mixed 由同一工程里的 `locations` / `surfaces` 推导，**不要**写 `projectMode`。P8 已合入：三种表面的编辑与 CoursePlayer 试运行都能挂 Component API 4；缺包才静态后备。索引里 catalog 为空只表示本机没有外部组件目录，不表示宿主不能挂工程内嵌包。

## 3. 载体所有权

对照脚本里的表面与「整页动态 / 局部互动」选择载体。Runtime/Component 的文字必须、普通可替换图片应当公开稳定作者目标。

1. **原生节点 + 声明式交互**：稳定文案、公式、图片、形状、视频、教师控制器；以及点击、显隐、切场景、播媒体等简单稳定行为。
2. **组件**：稍复杂的局部互动（拖拽、配对、本地多步控件）。先匹配工程已有包和（若目录可用）可导入包，能小改就复用；没有合适的就允许新建 Component API 4 包并嵌入本课。不要因为「只这一课用」而改用整页 Runtime 去仿一个控件。不要把空 catalog 当成禁止新建。
3. **场景 / 世界 Runtime**：整页或整块世界的动画、特效、连续耦合机制；尽量少放可教文字。不要把局部拖拽器做进场景 Runtime。
4. **无限画布**：脚本若要求空间漫游，运行态必须同时支持自由逛（会话平移/缩放，不写回工程）和镜头画面/路径巡游。手势与组件、Runtime、视频、教师控制器冲突时，被占用的交互优先。

## 4. 资产与任务图（动手前）

不要从空白一次写出整课。Coordinator 先在内部列出（不必给教师第三份合同文件；成功后删掉临时笔记）：

1. 资产：脚本引用了什么；哪些已在材料中；哪些可生成；哪些必须向教师要原件。
2. 载体映射：每个片段的表面与 Native / 声明式交互 / 组件 / 场景 Runtime。
3. 执行顺序：为纵切准备的资产 → 最高风险真实片段 → 其余页 → 集成验证。
4. 资产生成失败或必须改体验时，停下来回编排改脚本，不用占位图把课做完。

## 5. 用产品 API 写工程

权威工程是 `CourseProjectDocument`（`schemaVersion: 9`），不是 Agent Kit 语义 DSL，也不是 Project V8。

空白工厂（按脚本选定的表面选用；默认 Slide 工厂**不会**变成讲义或无限画布）：

| 形态 | 工厂 |
|---|---|
| 演示页 | `src/renderer/project/createCourseProject.ts` → `createBlankCourseProject` |
| 流式讲义 | `src/renderer/project/createFlowCourseProject.ts` → `createBlankFlowCourseProject` |
| 无限画布 | `src/renderer/project/createSpatialCourseProject.ts` → `createBlankSpatialCourseProject` |

同一课需要多种表面时，从一种空白工程出发，再用 `src/renderer/course/courseLocationCommands.ts` 的 `addCourseSlidePage` / `addCourseFlowPage` / `addCourseSpatialPage` 追加。不要新造第二份工程拼盘。

写入走与教师相同的 V9 命令，一次 history：

- Slide：`slideEditorCommands.ts`、`v9SlideContentCommands.ts`（含 `addSlideRuntimeLayer`）
- Flow：`flowEditorCommands.ts`（含 `insertFlowEditorBlock`、`cutFlowEditorBlocks` / `pasteFlowEditorBlocks`、`replaceFlowMediaBlockAsset`、`importAndReplaceFlowMediaBlock`）；共享插入见 `flowSharedAuthoringAdapters.ts`（`insertFlowSharedMedia`、`insertFlowSharedRuntime`）
- Spatial：`spatialEditorCommands.ts`（含 `addSpatialWorldVideoLayer`、`addSpatialWorldComponentLayer`、`addSpatialWorldRuntimeLayer`）。工具栏视频必须把真实 session **和** `asset` 传给 `addSpatialWorldVideoLayer`；不要克隆假 session。
- 组件：`importComponentPackage` 写入工程，再按表面插入；替换用 store `replaceComponentPackage`。

打包：`createCourseProjectArchive`（`src/renderer/project/courseProjectArchive.ts`）。校验：

```text
npm run --silent validate:course-project -- <project.h5lesson>
```

`validate:project` 是同一入口。该命令当前只证明 Schema、包内文件和已经接线的结构性工程健康/预检项目；在 REPAIR 路线完成前，退出码 0 不代表完整 V9 语义或 Runtime/Component 实际网络使用与工程声明一致已经证明。不要把 Project V8 写成当前格式，也不要把 Headless 绿色写成完整交付证据。

若当前产品没有对应命令或宿主，停止并报告产品缺口，不自造影子 Project DSL。

## 6. 先做最高风险纵切

选择最可能推翻载体、视觉、互动、编辑或导出的最小真实片段。必须使用真实内容、真实 Player、真实作者目标和真实保存路径；占位机制不能证明方案成立。

试运行与整课预览走 CoursePlayer：`FlowSurfaceHost`、`SpatialSurfaceHost`、`SlidePublishedAdapter`。禁止把 Phaser `PlayerApp` 接回 Mixed / Flow / Spatial 试运行。Phaser 只服务 Slide **编辑**命中。

纵切失败时修正底座或载体，再扩展；不要在错误机制上批量生成。

## 7. 增量构建与 Worker

Coordinator 是唯一能写权威 Project 和共享接口的人。小型强耦合课件由 Coordinator 分段完成。

仅当边界清楚且能独立验收时使用干净 Worker。每个 Worker 只得到：本单元脚本、共享视觉/接口简报、相关能力卡、输入输出路径和验收命令。Worker 输出独立模块或建议补丁，不直接改权威 Project，也不修改别的单元。

每合入一个单元就重跑受影响的最小验证；完成共享层后再做整课集成。动态代码保存在普通模块中；禁止在构建脚本里手写巨型 Runtime/Component 字符串。

## 8. 保持可编辑

所有画布项、控制器、Runtime 和 Component 都作为显式图层项参与同一层级关系。教师控制器仍是**一份全局图层**，不要复制进 scene `layerItems`。场景/世界编辑时控制器 inert；不要用点击控制器来切换全局层。

稳定内容尽可能是 Native；动态载体公开可编辑内容、素材、关键参数和可选择区域。

首次构建后保留稳定 project/surface/scene/layerItem/binding ID。教师手工编辑后不得全量重建覆盖。定位目标只用跨保存稳定的 `authoringAddress`，不要用会话 `hitId`。

正式编辑器入口是 `src/renderer/App.tsx`（不要写 `ProductApp`）。编辑器内没有可见 AI：无复制引用、无应用 Patch、无聊天。`courseAiHandoff` / `courseAiPatch` 是 internal/reserved、未挂载。不要把不存在的 `npm run current:course-selection` / `npm run patch:course-project` 写成工作流。

增量修改：打开工程、改稳定地址上的字段、保存。revision 冲突或地址失效时重新读取工程，不猜测合并。

当前入口用**源码里的真名**，不要停在已改名的旧符号上：

- 组件替换：`replaceComponentPackage`（没有 `replaceCourseComponentPackage`）
- 组件导入：`importComponentPackage`
- Slide Runtime：`addSlideRuntimeLayer`
- Flow Runtime：`insertFlowSharedRuntime`
- Spatial Runtime：`addSpatialWorldRuntimeLayer`
- Flow 剪贴：`cutFlowEditorBlocks` / `pasteFlowEditorBlocks` **已实现**

仍不要做：稿纸绕排/float；持久化 `projectMode`；打开或导入 V8 `.h5lesson`。外部组件 catalog 在索引里可为 `unavailable`；那只挡住「从目录挑现成包」，不挡住为本课新建或导入 `.h5component`。未过许可/维护人/质量门槛的目录包不要宣称为已发布内置库。

交互后返回编辑的当前画面是会话检查点，不自动写成默认答案；只有教师显式保存为命名状态时才持久化。无限画布运行态的平移/缩放同样只改会话相机，不写回 `camera.home`。

## 9. 验证与交付

运行产品 Schema 与当前已接线的结构性健康检查（`validate:course-project`）、相关单测、真实编辑保存重开、CoursePlayer、默认离线 HTML 和本课要求的其它导出。真实 HTML/网页包还要观察外部请求，补足 Headless 尚未完整覆盖的 Runtime/Component 源码离线合规。验证范围见 [validation-boundaries.md](references/validation-boundaries.md)。

工程检查通过后，由全新上下文做一次只读体验 QA。自动化最多 `engineering candidate`；具体课例未经真实视觉/互动复核不得称 `art candidate`；`accepted` 必须来自教师明确验收。不得宣称 Editor 1.0 已发布。

只保留两份教学 Markdown、真实 Project、默认 HTML 及用户要求的交付物。成功后清理 Worker 任务、临时副本、截图和中间报告。

## 停止条件

- 两份教学文件不一致或缺少必须由教师决定的内容；
- 当前能力不能实现且需要可感知降级；
- 载体内部文字、普通图片或关键参数无法满足约定的编辑性；
- 稳定地址、revision 或目标字段已经失效；
- 真实 Player、保存重开或交付格式缺少足够证据。

停止时说明最早应返回的阶段和最小缺口，不用下游代码掩盖问题。
