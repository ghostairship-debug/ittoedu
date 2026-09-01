# 当前能力路由

只在需要定位或解释当前产品能力时读取本文件。以源码与生成索引为准。

## 索引与命令

- 生成合同：`<editor-root>/artifacts/ai-capabilities/index.json`。
- 任意课例目录构建：`npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <relative.h5lesson> --html <relative.html>`。课例模块由 `coursewareCaseBuilderApi.ts` 注入真实产品 API，不得静态导入编辑器内部路径。
- `protocols`：project **9**、publishedCourse **2**、runtime `[2, 3]`、component **4**、interaction **1**。
- 仓库**没有** `agent-kit/bin/courseware-agent-kit.mjs` 或 `agent-kit/capabilities/index.json`。发现能力 = 读上述 `index.json`，再打开它列出的 `schemas/`、`diagnostics.json`、`limits.json`、组件快照。
- 核对生成物：`npm run check:ai-capabilities`。不要手改索引冒充当前能力。
- 无界面校验：`npm run --silent validate:course-project -- <project.h5lesson>`（`validate:project` 同一入口）。不要把 Project V8、Hash 或审批状态机写成现行教师工作流。
- 索引里的 `headlessBuild.entrypoints.createCourseProject` 只指向默认 **Slide** 工厂。Flow / Spatial 工厂见下一节，不要以为索引没写就不存在。

## 三种 surface（已发布为产品能力）

`index.json` → `surfaces.status = available`，`types = ["slide","flow","spatial-2d"]`。Published V2 同样列出这三项。

| 教师入口 | 工厂 | 作者命令 | 试运行/预览宿主 |
|---|---|---|---|
| 新建课件 | `createBlankCourseProject` | `slideEditorCommands` / `v9SlideContentCommands` | `SlidePublishedAdapter`（文字含 `style` + `runs`） |
| 新建流式讲义 | `createBlankFlowCourseProject` | `flowEditorCommands` / `flowSharedAuthoringAdapters` | `FlowSurfaceHost` |
| 新建无限画布 | `createBlankSpatialCourseProject` | `spatialEditorCommands` | `SpatialSurfaceHost`（世界视频是 HTML `<video controls>`，不要放进 SVG `foreignObject`） |

Mixed：同一 `CourseProjectDocument` 内用 `addCourseSlidePage` / `addCourseFlowPage` / `addCourseSpatialPage` 追加。界面由 `locations` / `surfaces` 推导。禁止新增 `projectMode` 或“四模式”字段。

无限画布运行态（当前位置试运行与整课预览）同时支持：

- **自由逛**：在空白处以及未被交互占用的图文上拖拽平移、滚轮缩放；只改会话相机，不写回 `camera.home` / 镜头画面。
- **镜头巡游**：`camera.frames`、播放路径、教师控制器切 `spatial-camera` location。
- **让路**：指针落在 Runtime、组件、视频控件或教师控制器上时，那些手势优先，宿主不抢。

打包：`createCourseProjectArchive`。打开非 `schemaVersion: 9` 的工程视为不受支持；不要导入 V8 `.h5lesson`。

## 编辑事实（与教师同一套命令）

- 全局层 `globalLayerItems` 与 surface 层仍是 V9 引擎能力。教师控制器**只有一份全局图层**；场景/世界编辑态 inert，图层树仅 `editingScope === 'global'` 时列出。
- 全局 Native 文字/图片可变换、可写内容；控制器 frame 仍走现有控制器命令。
- Flow 稿纸媒体：alt / caption / `layout`（`content-width` \| `wide` \| `full-width`）、库内同 kind 替换、`importAndReplaceFlowMediaBlock` 从文件替换。不做绕排/float。
- Spatial 插入视频：`addSpatialWorldVideoLayer(session, { assetId, asset, x?, y? }, { expectedRevision })`，并写入 sidecar。`addVideoNode` 的 spatial 早退必须传真实 session + `asset`。
- 组件：P8 已把 Component API 4 挂到 Flow 稿纸/浮层、Spatial 世界/HUD、Slide Published 试运行。导入 `importComponentPackage`，替换 store `replaceComponentPackage`。Runtime 插入：`addSlideRuntimeLayer` / `insertFlowSharedRuntime` / `addSpatialWorldRuntimeLayer`。
- Flow cut/paste **已实现**（`cutFlowEditorBlocks` / `pasteFlowEditorBlocks`）。
- Slide 编辑画布与试运行已统一为同一套 Published 宿主（不再有 `blob:` iframe 编辑预览）；Phaser 仍只作 Slide 编辑的命中/选择/几何层，不负责视觉合成。

## 课程逻辑（状态 + 导航守卫；2026-08-27 Owner 追认保留）

- 能力声明：`index.json` → `interactions.courseLogicAuthoring`；播放器**实际执行**的交互切片看 `interactions.publishedPlayback`——当前 `node.click` 支持 `course-state.exists` / `course-state.compare` 条件和同步 `course-state.set` 动作，限制仍是无判题分支条件与无判题结果自动写状态桥。映射体验时以索引为准，不要凭印象。
- 命令：`executeCourseLogicAuthoringCommand`（`courseLogicAuthoringCommands.ts`）；GUI 在专业模式「互动与动画」。
- 守卫语义：只 `block`；只拦跨位置 go/next/previous；replay 不检查；restart 绕过并重置为默认值；教师控制器可绕过。
- 状态写入：Published `node.click` 可同步执行 `course-state.set`；Runtime/Component 也可经 `ctx.courseState` 读写。判题器（`ctx.assessment.evaluate`）结果不会自动进状态，组件判完须自行写入。

## 仍按不可用处理

- Capability Index 未声明的功能。
- 外部组件目录缺失时（以 `index.json` 当前 `catalogStatus` 为准，本文不复制该可变值；目录指向 `../courseware-components`）。缺失只表示没有现成目录包可浏览，**不是**禁止为本课新建/导入 `.h5component`，也不是 Flow/Spatial 不能挂组件。
- 目录里若恢复实验包，许可/维护人/质量门槛不过就不要当已发布内置库宣传。
- 编辑器内可见 AI、`courseAiHandoff` / `courseAiPatch` 调用点。
- Phaser `PlayerApp` 作为 Mixed/Flow/Spatial 试运行主路径。
- 稿纸环绕布局；把控制器写入 scene `layerItems`。
