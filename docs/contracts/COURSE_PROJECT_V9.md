# Course Project V9 工程合同说明

> 本文档描述当前源码已经成立的 Course Project V9 核心数据结构与语义约束。
> 权威类型定义以 `src/shared/contracts/course-project-v9/`（`src/shared/courseProjectTypes.ts` 与 `src/shared/courseProjectSchema.ts` 为 re-export 桩）为准。
>
> **软冻结（2026-08-19）**：已有字段、判别器与语义锁死；仍允许 additive 可选字段。演进规则见 [V9_COMPATIBILITY_POLICY.md](V9_COMPATIBILITY_POLICY.md)。这不是 Editor 1.0 发布。

---

## 1. 唯一工程真相

- **版本标识**：`schemaVersion: 9`（即 `COURSE_PROJECT_SCHEMA_VERSION = 9`）。
- **唯一可打开工程**：Course Project V9 是当前编辑器与播放器唯一支持打开的工程格式。
- **校验规则**：`schemaVersion` 缺少或非数字判定为 corrupted；非 `9` 的其他整数判定为 unsupported。不打开、不导入 V8 工程。
- **空白工程**：直接构造符合 `CourseProjectDocument` 结构的 V9 数据，不再走 V8 迁移链路。

### 1.1 顶层字段

`CourseProjectDocument` 顶层由 `courseProjectDocumentSchema` 进行严格（`.strict()`）校验，无任何自由预埋 JSON（如未受管的 AI handoff、审批流状态、Hash 证据等），且不存在持久化的 `projectMode` 字段。当前工程版本常量为 `COURSE_PROJECT_SCHEMA_VERSION`（9），历史 Project V8 形状常量 `PROJECT_SCHEMA_VERSION`（8）不再代表可打开工程。

顶层字段完整列表：

```text
schemaVersion, id, revision, title, createdAt, updatedAt,
assets, componentPackages, network?, designTokens, theme?, components?, media, playback,
courseState, navigationGuards, locations, startLocationId,
globalLayerItems, globalInteractions, surfaces, mixedPrintPlan?
```

- `schemaVersion`：必须为 `9`（`COURSE_PROJECT_SCHEMA_VERSION`）。
- `id`：工程稳定唯一标识。
- `revision`：单调自增作者编辑事务版本号（与审批 hash 无关）。
- `title`：课程标题。
- `createdAt` / `updatedAt`：UTC ISO 8601 时间戳字符串。
- `assets`：工程内嵌资源元数据映射字典（`key === asset.id`），V9 值为 `CourseAssetMeta`（V8 `AssetMeta` 加可选远程交付字段，见第 7 节）。
- `componentPackages`：内嵌组件包元数据映射字典（`key === packageId`）。
- `network`（可选）：课程级网络声明（`CourseNetworkDeclaration`），见第 7 节。
- `designTokens`：工程级设计 Token（字体 `fonts`、颜色 `colors`）。
- `theme`（可选）：课程主题样式，见第 8 节。
- `components`（可选）：按名称登记的课程组件，见第 8 节。
- `media`：工程级音频与媒体配置。
- `playback`：全局播放器与演讲者模式配置。
- `courseState`：全局声明式状态定义列表。
- `navigationGuards`：全局声明式导航拦截守卫规则列表。
- `locations`：统一课程结构位置索引列表（`min: 1`）。
- `startLocationId`：课程起始位置标识（必须指向有效 location）。
- `globalLayerItems`：跨表面全局共享图层项列表。
- `globalInteractions`：全局交互规则列表。
- `surfaces`：课程表面定义列表（`min: 1`）。
- `mixedPrintPlan`（可选）：多表面工程跨表面导出编排计划。

---

## 2. 表面模型（Surfaces）

`surfaces` 数组承载课程的所有表面内容，受 `COURSE_SURFACE_TYPES` 约束，支持三种正交表面类型：

### 2.1 演示页面（`SlideSurfaceDocument`）
- `type: 'slide'`
- 画布固定尺寸为 `1280 x 720`（`canvas: { width: 1280, height: 720 }`）。
- 包含场景列表 `scenes: SlideSceneDocument[]`。
- 每个场景具备独立的必填 `backgroundColor` 与可选 `backgroundAssetId`。
- 场景可包含 `presentation: SlidePresentation`，通过 `states: SlidePresentationState[]` 实现基于 `layerItemOverrides` 的状态切换。

### 2.2 流式讲义（`FlowSurfaceDocument`）
- `type: 'flow'`
- 包含版心布局配置 `layout: { readingWidth: number, wideContentWidth: number }`。
- 正文由结构化块构成：`blocks: FlowBlock[]`（支持 heading, paragraph, list, quote, divider, media, table, formula, code, callout, section, component）。
- 可选画布/稿纸背景色 `backgroundColor?: string`，缺省时视为白底（`#ffffff`）。

### 2.3 无限画布（`SpatialSurfaceDocument`）
- `type: 'spatial-2d'`
- 包含二维世界定义 `world`，支持 infinite 或 finite 边界模式，包含世界图层元素 `world.layerItems`、路径 `paths?: SpatialPathDocument[]` 与关系连线 `relations?: SpatialRelationDocument[]`。
- 包含相机配置 `camera: { home: SpatialCameraPose, frames: SpatialCameraFrame[] }`。`home` 与 `frames` 是作者持久化镜头；试运行/整课预览另有会话相机，支持自由平移缩放，且不因逛世界而写回这些字段。播放路径与切 `spatial-camera` location 仍做镜头巡游。
- 包含语义缩放规则 `semanticZoom: SpatialSemanticZoomRule[]`。
- 可选无限画布底色 `backgroundColor?: string`，缺省时视为白底（`#ffffff`）。

---

## 3. 模式推导与课程结构

- **无持久化 projectMode**：工程中不存在持久化的 `projectMode` 或“四模式”字段。
- **推导规则**：
  - 纯 Slide、纯 Flow、纯 Spatial 与 Mixed 页面类型由工程内的 `locations` 与 `surfaces` 组合关系动态推导。
- **位置索引（`CourseLocation`）**：
  - `slide-scene`：指向特定 slide surface 与 scene（及可选 state）。
  - `flow-block`：指向 flow surface 与 block。
  - `spatial-camera`：指向 spatial surface 与 cameraFrame。
- **跨表面打印计划（`MixedPrintPlan`）**：当工程包含多个 surface 时提供 `mixedPrintPlan` 统一导出编排。

---

## 4. 统一图层系统（Unified Layer Items）

所有视觉元素均遵循统一图层项结构 `LayerItem`：

```typescript
export type LayerItem = NativeLayerItem | ComponentLayerItem | RuntimeLayerItem
```

### 4.1 图层作用域与排序
- **全局图层（`globalLayerItems: GlobalLayerEntry[]`）**：跨表面全局共享，通过 `LocationVisibility` 控制逐 location 可见性；可选 `plane: 'underlay' | 'overlay'` 表示位于当前页面内容下方或上方。
- **表面共享图层（`surfaceLayerItems: ScopedLayerItem[]`）**：在单个 surface 内共享。
- **场景/世界图层（`layerItems: LayerItem[]`）**：属于特定 Slide 场景或 Spatial 世界。
- **有效平面**：合成恒为 global Underlay → 当前 surface/scene/world 内容 → global Overlay；跨 owner 的 `order` 数值允许相同，不参与全局与本地内容的平面判定。
- **图层排序**：`order` 仍是各 owner 内从后向前（back-to-front）的稀疏排序键；global 项只在各自有效平面内比较顺序。
- **旧工程缺省**：缺 `plane` 时，教师控制器视为 Overlay；存在全局控制器时，控制器之前的旧 global 项视为 Underlay，控制器及其后的项视为 Overlay；没有控制器时视为 Overlay。该规则只依赖 global 内部顺序，不随页面内容增删或排序变化。

### 4.2 元素类型
- **Native（`NativeLayerItem`）**：包含 `text`、`formula`、`image`、`video`、`shape`、`teacher-controller`。
- **Component（`ComponentLayerItem`）**：基于 Component API 4 规范（`packageId`、`version`、`props`、可选 `staticFallbackAssetId`）。
- **Runtime（`RuntimeLayerItem`）**：包含独立代码、配置与动态能力。

### 4.3 教师控制器（Teacher Controller）
- 教师控制器作为一份全局图层元素存在于 `globalLayerItems` 中（`nativeType: 'teacher-controller'`）。
- 教师控制器固定属于 global Overlay；旧工程可缺 `plane`，但显式 `plane: 'underlay'` 非法。
- 禁止为每个场景复制一份控制器副本，禁止将控制器写入场景 `layerItems`。
- 编辑态控制器保持 inert（静态预览），试运行与播放态响应拖拽与点击交互。

### 4.4 稳定标识
- 每个图层项具备跨保存生命周期稳定的 `layerItemId`（authoringAddress）。
- 临时运行时 `hitId` 不得替代持久化 `layerItemId`。

---

## 5. 运行时协议与布局模式

- **`LayerFrame.mode`**：当前持久化仅支持 `'absolute'`。
- **`CourseRuntimeDefinition.protocol`**：当前持久化支持 `'canvas-runtime'`（API 2）与 `'surface-runtime'`（API 3）。
- **夹具状态**：T0 夹具 `canvas-runtime.h5lesson` 持久化为 `canvas-runtime`（API 2），`surface-runtime.h5lesson` 持久化为 `surface-runtime`（API 3）。历史过渡判别器 `legacy-runtime-v2`、`legacy-whole-canvas` 与 `surface-v1` 已从 Schema 和类型中移除。

---

## 6. 课程状态、Interaction 读写与导航守卫

- **课程状态声明（`courseState: CourseStateDeclaration[]`）**：声明式标量状态（`boolean`、`number`、`string`、`null`）；键最长 240 字符且整课唯一。
- **Interaction 条件**：`course-state.exists` 检查声明键当前是否存在，`course-state.compare` 使用 `eq` / `neq` / `gt` / `gte` / `lt` / `lte` 比较当前值。不同条件继续按 AND 组合；比较值必须与声明类型一致，排序比较只允许数字状态。
- **Interaction 动作**：`course-state.set` 同步写入一个已声明键，写入值必须与声明类型一致。它不是 terminal 动作；同一规则中后续 `after-previous` 动作和后续导航守卫可立即读取新值。
- **导航守卫（`navigationGuards: CourseNavigationGuard[]`）**：声明式条件拦截规则（`effect: 'block'`），仅允许根据状态条件进行导航拦截，禁止执行任意重定向或执行代码。
- **窄切片边界**：当前合同不包含 increment/delete、表达式、工作流引擎或判题结果自动桥；Runtime/Component 仍可通过既有宿主接口处理更复杂的课程机制。

---

## 7. 远程资源与网络声明（additive 可选）

本节字段全部为软冻结后的 additive 可选字段：既有 V9 文件不含这些键，原样合法；各对象保持 `.strict()`。

### 7.1 资源远程交付（`CourseAssetMeta.remote`）
- V9 资源元数据为 `CourseAssetMeta`：共享 V8 `AssetMeta` 全部字段，外加可选 `remote: { url: string }`。V8 `AssetMeta` 本身不扩展这些键。
- `remote.url` 声明与内嵌字节一致的 HTTPS 交付地址（允许 path/query），供“在线轻量”导出与远程媒体使用；内嵌本地字节仍是作者缓存与离线来源，`path`/`byteLength` 永远描述内嵌字节，不得为 remote-only 资产伪造。
- `remote.url` 只接受 `https:` 且禁止 userinfo 凭证；Secret/凭证值不进入工程合同。

### 7.2 课程网络声明（`network.connectOrigins`）
- `network.connectOrigins?: string[]` 声明 Runtime/Component 代码允许连接的精确 origin（远程媒体、HTTP API、WebSocket、未来 AI API）。
- 每个 origin 必须是规范化的精确 `https:`/`wss:` origin：字符串等于其 URL `origin`（小写 scheme/host、不写默认端口），拒绝 wildcard、userinfo、path/query/fragment 与其他 scheme；列表内不得重复。
- 预览、发布与导出宿主从工程声明派生允许的 origin，未声明访问一律拒绝；远程脚本暂不开放。本节只定义网络声明，不定义或禁止桌面、本地、父页面等宿主专属能力；运行时放行与 CSP 派生由后续任务实现。

---

## 8. 课程主题、组件、节点状态与素材来源（2026-10-04 创作流程重构）

本节字段与 Published V2 同批切换（V9 原地修改，不建 V10）；各对象保持 `.strict()`。软件维护的派生事实由 `normalizeCourseProject`（`src/core/course/normalizeCourseProject.ts`）在每次提交与导入候选时重算，不要求作者登记。

### 8.1 课程主题（`theme`）
- `theme?: { css: string; assets?: Record<string, { assetId: string }> }`：整课共享的样式（`theme.css`）。宿主把由 `designTokens` 派生的变量（`--font-<id>`、`--color-<id>`）与主题 CSS 放进 `@layer guoling-theme`，注入所有渲染的 Web 文档（组合内容及其中的 HTML 文档组件）；页面自身样式总是优先。
- `theme.assets` 由软件维护：CSS 中 `url(../assets/x.png)` 的槽位绑定到存在的素材。
- 教师控制台未设置颜色时取 `--color-background` / `--color-text` / `--color-accent`。

### 8.2 课程组件（`components`）
- `components?: Record<名称, CourseComponentDefinition>` 是组件定义的唯一所有者，名称即 `components/<名称>.html` 的主干：1–80 字符，不含 `\ / : * ? " < > | # %` 与控制字符，首尾不是空格或点，忽略大小写唯一。
- 定义字段为 Runtime 的 `protocol`、`runtimeApiVersion`、`enabled`、`renderMode`、`source`、`content{values,metadata?}`、`assets` 与可选 `draft{reason}`（草稿必须 `enabled:false`，宿主显示原因占位）。
- 页面以 `<iframe src="../components/<名称>.html" title="说明">` 引用；iframe 下的 Runtime 节点是软件从定义单向派生的副本，只保留实例字段 `staticFallback`、`nodeBindings`、`content.overrides`。提交中对副本定义字段的修改由驱动按字段写回定义；同一组件被改成不同内容或引用不存在的定义时拒绝。名称不存在时不生成副本，宿主显示待填占位。
- 讲义（Flow 正文）用 `course-component` 块按名称引用组件：`{ type: 'course-component'; name; title?; height?; wrap? }`，不存副本；名称不存在时显示 `title`（缺省为名称）占位，定义为草稿时显示原因。组件改名同时改写块的 `name`。Published V2 `courseComponents?: Record<名称, 已发布 Runtime>` 携带被块引用的定义（键为存储名称，按名称忽略大小写匹配），其素材按直接引用进入发布；播放器与编辑器用同一挂载逻辑运行。页面正文（组合中的文档节点）里的此类块只显示名称占位，页面中请用 iframe 引用。

### 8.3 节点状态与页内步骤
- `LayerItemOverride.compositionNodes?: Record<节点 id, { visible?: boolean }>`：任何呈现状态都可控制组合内部节点显隐（只用于 composition 图层，节点须存在）。
- `SlidePresentationState.fragmentStep?: number` 标记来自页内步骤的状态：场景组合中 `class="fragment"` 的元素按图层存储顺序与文档顺序编号；初始状态为 0，生成状态 `fragment_step_<k>` 显示前 k 个，并复制初始状态的覆盖字段；没有该字段的状态是作者状态，保持原样并显示全部步骤。显式节点状态优先于步骤。播放时节点淡入，静态捕获显示全部步骤，编辑视图显示全部内容。

### 8.4 待填素材
- 组合中 `<img src="../assets/x.svg" alt="说明">` 原样保存；`assets/x.svg` 槽位绑定 `path === 'assets/x.svg'` 的素材（否则绑定唯一 `filename` 相同的素材），写在 `composition.assets['assets/x.svg']`。未绑定的项目内相对引用显示占位（`alt` / `title` 为说明）。
- 正文媒体块（讲义与组合中的文档节点）可写 `source`：原样保存的 `assets/...` 引用。规范化按同一规则把 `assetId` 绑定到该路径上种类相同的素材，素材删除或种类不符时去掉 `assetId`、显示待填占位（图片为带说明的占位图，音视频为说明框）；无 `source` 的块仍必须有 `assetId`。在编辑器里选定或替换素材会去掉 `source`。素材改名时引用随之改写；打印与 DOCX 输出“待填素材”说明。

### 8.5 素材来源（`CourseAssetMeta.source`）
- `source?: { kind: 'user-material' | 'model-svg' | 'open-library' | 'image-model' | 'asset-library'; title?; url?; author?; license?: { id; url? }; attribution? }`。
- 发布时有 `attribution` 的已发布素材进入 Published V2 `credits`；播放器角落显示"来源"入口，PDF/PPTX 末尾附"素材来源"页。
