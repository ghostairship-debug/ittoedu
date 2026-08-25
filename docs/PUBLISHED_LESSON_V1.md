# PublishedLesson V1 发布格式

PublishedLesson V1 是单 HTML 与网页包共用的单向 Player 输入。它由 Course Project V9（经 Published Course V2 producer）在导出边界编译产生，不是工程文件，也不是 `.h5lesson` 的另一种保存形式。作者工程从 V8 切到 V9 不自动升级本发布格式版本。

## 目标与边界

- Player 的场景、命名状态、声明式交互、声音、视频、自由运行时和组件行为保持不变；
- 成品不主动交付完整 Course Project V9、历史记录、工程时间、组件包目录和编辑器配置；
- 发布结果不能重新导入编辑器恢复为 `.h5lesson`；
- 不做 DRM。浏览器必须取得可执行逻辑和运行素材，有技术能力的接收者仍可检查和分析成品。

发布链路：

```text
Course Project V9 + 工程素材 + 组件包
              │
              ▼
       单向发布编译与检查
              │
              ▼
 PublishedLesson V1 + 运行素材 + Player
          ├─ 单 HTML
          └─ 网页包
```

PDF/PPTX 的内部捕获链路仍可使用作者态 `ExportPayload`，因为它们需要对象级静态导出信息；用户交付的单 HTML 与网页包必须使用 PublishedLesson V1。

## 发布内容

PublishedLesson V1 只保留 Player 执行所需数据：

- 标题、1280×720 画布、场景及场景名；
- 原生节点的运行属性，但不含图层名称和锁定状态；
- 命名状态的运行覆盖，但不含状态说明和缩略图状态；
- 场景/全局声明式交互；
- 声音、视频、画布控制器和播放设置；
- 已启用的场景/全局运行时；
- 实际被场景或全局层引用的组件；
- 工程运行素材与实际被引用组件的组件素材。

以下作者态内容不会进入发布数据：

- 完整工程包装、`schemaVersion`、工程 ID；
- `createdAt`、`updatedAt`、历史记录和编辑器视图状态；
- `componentPackages`、原始包路径、`manifest.json` 与独立 `runtime.js`；
- 组件 `editor.properties/pages`、变体、预设、说明和缩略图；
- 运行时文案 `metadata`、状态说明、节点锁定和图层名称；
- 源码映射。

组件 `defaultProps` 会在发布时与实例 props 合并，成品只携带实例运行所需的有效参数。未被任何节点使用的组件包不会发布。

## 可执行代码

场景运行时、全局运行时和组件运行时代码是互动成品的必要组成部分。发布编译器不会把原始组件包、manifest 或 `runtimeSource` 字段直接复制进成品，而是将执行字符串按 UTF-16LE 代码单元精确编码后放入最小运行描述；Player 启动时恢复原字符串。

选择 UTF-16LE 是为了精确保留所有 JavaScript 字符串，包括中文、Emoji、代理对和孤立代理代码单元。编码只避免原始文件结构和明文源码的主动交付，不提供加密或抗逆向能力。

当前 CoursePlayer 对可执行 Runtime 的 Published playback 是明确的 partial slice：Slide `scene.layerItems` 中的 API 2 `canvas-runtime` 可按 DOM/Phaser/hybrid 执行，Slide scene-local 与 Flow surface-local 的 API 3 DOM `surface-runtime` 也可执行；global/shared/Spatial/capture 等未覆盖 carrier 仍使用后备。API 2 的宿主动作、presentation 与节点解析尚未接入，不得把“源码已携带”解释为完整宿主上下文 parity。三种互动交付与编辑器当前位置/整课预览复用同一 Published host。

## 两种互动发布物

### 单 HTML

- 离线便携模式把 PublishedLesson V1、全部发布素材和 Player 内联；
- 在线轻量模式只把实际引用且声明 `remote.url` 的工程素材保留为原 HTTPS URL；未声明远程地址的工程素材与全部组件素材仍内联；
- 在线轻量 CSP 只加入实际远程图片/媒体/字体的精确 origin 与工程 `network.connectOrigins`，不允许 wildcard hostname 或远程脚本；
- 发布 JSON 整体使用 Base64 装入 HTML；
- 不含 `.h5lesson`、`project.json` 或组件包目录。

### 网页包

- `index.html`
- 唯一发布数据 `course-data.js`
- `player/player.iife.js` 与 `player/player.css`
- `assets/` 中的工程运行素材
- `component-assets/` 中的组件运行素材

网页包不再同时保存 `course.json` 和离线回退副本，也不生成组件 `manifest.json` 或 `runtime.js`。工程与组件素材继续使用包内相对路径，唯一数据脚本同时支持静态服务器和 `file://` 双击打开；在线轻量单 HTML 的远程投影不会改变网页包语义。

## 验收门禁

发布相关测试必须同时验证：

1. 离线便携单 HTML 与网页包产生相同的 PublishedLesson 内容语义，仅素材 URL 载体不同；在线轻量单 HTML 只允许合同声明的远程投影差异；
2. 发布数据不含工程包装、工程时间、组件包结构和编辑器字段；
3. 网页包只有一份发布数据，不含组件源码/manifest 重复文件和源码映射；
4. 所有素材 URL 在网页包根目录内，不能路径穿越；
5. 编码前后的任意 Unicode JavaScript 代码单元完全一致；
6. Player 能把 PublishedLesson 恢复为运行模型并实际注册组件；
7. 仍在渐进退役的 V8-shaped `ExportPayload` 只可作为内部作者态预览和捕获输入，不是可打开或可保存的工程格式；Project V1–V8 `.h5lesson` 必须明确拒绝。
