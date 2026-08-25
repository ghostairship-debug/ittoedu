# 互动组件开发指南（V4）

> **当前工程格式是 Course Project V9。** 本文只描述当前 V9 可用边界；类型与协议真值以 `src/shared/componentTypes.ts`、`componentSchema.ts` 和源码为准。

本文定义 `.h5component` 协议。类型真值以 [`src/shared/componentTypes.ts`](../src/shared/componentTypes.ts) 和 [`src/shared/componentSchema.ts`](../src/shared/componentSchema.ts) 为准。

文档同步基线：**2026-08-18**。生产 Schema、导入器、宿主、发布器与测试只接受 Component API 4。

产品发布者是 ittoedu。ittoedu 自有组件命名空间为 `com.ittoedu.*`；第三方作者必须使用自己控制的反向域名，文档中的 `com.example.*` 仅为示例，不能据此冒用 ittoedu 身份。

编辑器只接受 V4：严格声明 `supportedScopes` 与 `renderMode`，使用 DOM/Phaser 分能力上下文、可见性/暂停生命周期和确定性捕获准备。V1–V3 包会在导入边界得到明确的“不受支持”诊断。

组件必须使用 V4。Course Project V9 JSON 是组件实例、公开参数、作用域、几何和业务状态的工程真相；DOM、Phaser 和 Three.js 只是组件内部的呈现/交互实现。可枚举的节点/全局元素点击、元素入场/退场、状态/场景跳转、声音和视频控制优先使用声明式 interactions。整页或整块世界的动画、特效与连续耦合机制使用画布或 surface 运行时，少放可教文字。稍复杂的局部互动（拖拽、配对、本地多步控件）使用 Component API 4：先匹配已有包，允许为本课新建。不要用场景运行时去仿一个局部控件。旧 Project V1–V8 与 Component API 1–3 均明确拒绝。

中央编辑状态与当前位置试运行共用同一个 1280×720 Player 视觉画布。编辑状态由当前隔离 authoring Player 创建组件真实视觉，并在其上叠加透明 Phaser 原生交互层；authoring 宿主冻结组件输入、宿主动作、声明式互动、音视频、导航和课程状态推进。组件只能通过本文的显式文字目标向宿主描述“哪一段 Props 可在何处编辑”，不能借 authoring 协议访问编辑器 DOM 或 Store。普通试运行、整课预览、捕获和成品仍使用各自既有的 preview/capture 行为。该 iframe 是当前合成与生命周期实现，不是把外部导入组件视为不可信代码的产品边界。

该目标桥是确定性的人工 authoring 协议，不包含 Blueprint、AI 局部 patch 或模型调用。全部编辑器内 AI 接入延后到 2.0 以后；1.x 仅保留可选、版本化的能力边界。

组件发现、导入、插入和包管理位于专业模式独立“组件”页。全尺寸“内置组件库”从受控 catalog 动态生成通用/学科、学段与用途筛选，可多选加入工程但不自动创建实例；“导入外部组件”允许一次选择多个包，选定后直接校验并原子加入，不逐包弹出导入确认或成功摘要。两种来源最终都进入同一“工程组件”列表，卡片负责插入，次级菜单负责详情、显式更新、替换、定位和受引用保护的移除。已经嵌入的精确包可直接反复实例化，不重新读取目录或重复提示；会覆盖已用代码的更新、替换和哈希冲突仍显式审阅或阻断。编辑器选中节点时通过“属性/交互”维护 `node.click`；右侧“互动与动画”维护状态/场景进入、节点激活、动画完成、音视频生命周期/时间点、`component.event` 和带 `scene/global` 来源的 `runtime.event`。步骤可用 `after-previous` / `with-previous` 编排顺序与并行，并设局部延迟。组件若只需发出一个可枚举事件，应使用 V4 `ctx.emit()`，再由规则编排元素动画、状态、声音、视频或导航。

机器发现入口为 [`artifacts/ai-capabilities/index.json`](../artifacts/ai-capabilities/index.json)，组件细节按需读取 `schemas/component-api4.json` 与 `component-catalog.snapshot.json`。快照只接纳与预期 catalog SHA-256、包字节哈希和 manifest 身份一致的条目；审核摘要缺失、目录缺失或完整性不匹配时必须标记为不可用/降级。这里的 catalog 状态表达发行身份与完整性，不决定组件执行权限。它不是组件生成器，也不解除质量门禁。目录不可用时仍可通过「导入外部组件」或课例构建写入工程内嵌包。不得因生成物存在或矩阵测试通过就宣称稳定、可商用或发布就绪。

组件不应重复实现编辑器已有的一等能力：常规视频使用 `VideoNode`，课程声音使用 `media.audio` 声音库与声道，默认教师控制平台使用 `globalLayer` 中的 `TeacherControllerNode`。内置控制器的默认 `scene.open-picker` 按钮展开全部场景，选择后只进入目标初始状态；固定 `scene.go` 是高级按钮动作。只有策划要求独特视觉、复用封装或内置节点无法表达的行为时，才把媒体播放器或控制平台制作成 V4 组件。

### 0.1 当前组件来源

组件目录状态以当次生成的 [`artifacts/ai-capabilities/index.json`](../artifacts/ai-capabilities/index.json) 和 `component-catalog.snapshot.json` 为准；本次同步为 `catalogStatus: available`、`packageCount: 4`。以后目录不可用或包数变化，只表示当时没有对应目录包可浏览，**不是** Flow/Spatial/Slide 试运行不能挂组件（P8 已合入），也不是禁止为本课导入或新建 `.h5component`。

当外部目录可用时，ittoedu 自有实验包预期仍是：

- `com.ittoedu.language.reading-annotation`：朗读重音、停顿和连读语义；
- `com.ittoedu.language.pinyin-annotation`：汉字/拼音配对与显隐行为；
- `com.ittoedu.visual.text-container`：使用 `visualStyle` 在透明玻璃、磨砂玻璃、便利贴、撕纸和文件夹之间切换；
- `com.ittoedu.visual.image-frame`：使用 `visualStyle` 在笔刷裁切和贴纸白边之间切换。

四个包在许可、维护人和质量门槛通过前不得宣称为已发布内置库。课例构建应先匹配工程已有包或可导入包，没有合适的就新建课例本地包。

语文两项因具有独立学科语义和行为保持分立；七项旧通用视觉包只是外观差异，已删除并按内容载体合并为两个组件。当行为、数据结构和导出语义不变时，新外观应继续作为属性选项，不应再新建一个包。旧七个 ID 没有别名、迁移或宿主兼容分支。两个新视觉组件使用纯 CSS/SVG 程序视觉，不复用旧来源不明位图。

四个实验包若出现在目录中，可编辑的稳定可见文字均必须同时出现在属性栏和画布双击目标中。不可见的无障碍说明继续只在属性栏编辑。

## 1. 组件包结构

`.h5component` 本质是 ZIP，根目录必须直接包含 `manifest.json` 和 manifest 指定的入口：

```text
global-controls.h5component
├── manifest.json
├── runtime.js
├── thumbnail.png          # 可选
└── assets/
    └── click.wav          # 可选
```

约束：

工程同时记录两种不同哈希：`sha256` 是最初选择的 `.h5component` ZIP 原始字节来源锁，`contentSha256` 是对全部安全相对路径和解包字节按稳定顺序、带长度边界计算的 canonical SHA-256。新 Course Project V9 归档必须包含 `contentSha256`；打开、保存或 headless 校验时任一嵌入文件被改动都会作为归档损坏拒绝。内容哈希不受 ZIP 压缩、条目顺序和时间戳影响，也不是数字签名、许可证或权属证明。

组件进入工程后，可执行 `npm run --silent validate:project -- <file.h5lesson>` 检查真实内嵌文件、Schema、当前已接线的结构性工程健康结果和四格式预检。REPAIR 完成前，该命令尚不能证明完整 V9 语义或 Runtime/Component 实际网络使用与工程声明一致；退出码 0 仍须由真实 Player、导出和外部请求检查补足。当前四个 ittoedu 身份实验包虽然可重现构建并通过历史四组件矩阵，但许可证和维护人仍未确认，排除在正式发布范围外。

- 单包不超过 50 MB；
- 路径使用 `/`，不得有绝对路径、盘符、反斜线、`..` 或路径穿越；
- 入口是同步注册的普通浏览器 JavaScript，不能使用 `import`、`export` 或 `require`；
- 第三方执行依赖应在构建阶段打入入口脚本，不运行时加载远程脚本；远程媒体/API 按工程声明，宿主、父页面或本地能力只能使用目标环境明确提供的稳定合同，不得假定所有导出环境都有同一能力；
- 包内素材全部在 manifest `assets` 中声明；
- 缩略图可选，支持 PNG、JPG、WebP、GIF 或 SVG；正式可视组件建议始终提供。

## 2. V4 manifest

```json
{
  "schemaVersion": 4,
  "runtimeApiVersion": 4,
  "renderMode": "dom",
  "supportedScopes": ["global"],
  "id": "com.example.global-controls",
  "name": "全局课程控制条",
  "version": "4.0.0",
  "description": "跨场景持续存在的课程控制条",
  "entry": "runtime.js",
  "thumbnail": "thumbnail.png",
  "defaultSize": { "width": 1060, "height": 74 },
  "minSize": { "width": 520, "height": 60 },
  "preserveAspectRatio": false,
  "assets": {},
  "defaultProps": {
    "content": {
      "title": "课程控制",
      "buttons": {
        "previous": "上一页",
        "replay": "重播本页",
        "next": "下一页",
        "restart": "重开课程"
      },
      "status": {
        "ready": "控制条跨场景保持",
        "replayed": "已重播当前场景"
      }
    },
    "accent": "#38bdf8",
    "background": "#0f172a"
  },
  "editor": {
    "properties": [
      { "key": "content.title", "label": "控制条标题", "type": "text", "maxLength": 40 },
      { "key": "content.buttons.previous", "label": "上一页按钮", "type": "text" },
      { "key": "content.buttons.replay", "label": "重播按钮", "type": "text" },
      { "key": "accent", "label": "强调色", "type": "color" },
      { "key": "background", "label": "背景色", "type": "color" }
    ]
  }
}
```

核心字段：

- `schemaVersion` 与 `runtimeApiVersion` 均为 `4`；
- `renderMode` 必须是 `dom`、`phaser` 或 `hybrid`，并且与入口实际访问的能力一致；
- `supportedScopes` 至少包含一个且不能重复，可选 `scene`、`global`；
- `id` 推荐反向域名，`version` 使用语义化版本；
- `defaultProps.content` 是所有人工可见文字的保留树；
- `defaultSize`、`minSize` 和 `preserveAspectRatio` 定义实例变换边界。
- `thumbnail` 可选，但所有面向交付的可视组件都应提供；路径必须指向包内 PNG、JPG、WebP、GIF 或 SVG。

只有 `supportedScopes` 包含 `global` 的 V4 组件能添加到全局层。统一全局层也直接接收原生文字、图片、图形、视频和教师控制器；这些原生元素不需要组件 manifest。

V4 的 `renderMode` 是能力声明，不是自动转换开关：改成 `dom` 不会把 Phaser 对象变成 HTML，改成 `phaser` 也不会把表格或 CSS 布局转换成 Canvas。字段、入口代码和验收必须一起修改。选择原则：密集文字、表格、表单和可访问控件偏 DOM；粒子、碰撞、精灵和高频程序动画偏 Phaser；确实需要两者协作才使用 `hybrid`。

缩略图应使用与 `defaultSize` 相同的宽高比，展示组件的稳定默认外观，不要依赖远程字体、运行时网络或透明到不可辨认的内容。编辑器会把它绘制到左侧场景缩略图；未提供或解码失败时改用带组件名称的边框后备框。后备框只保证组件可见，不代表视觉质量合格。

## 3. 所有组件文字必须放入 `props.content`

V4 编辑器会对合并后的 `props.content` 递归遍历，把其中每个字符串自动显示为文字编辑项。支持对象和数组，例如：

```json
{
  "content": {
    "question": "请选择正确答案",
    "options": ["叶绿体", "线粒体", "细胞核"],
    "feedback": {
      "correct": "回答正确",
      "wrong": "请再观察一次"
    }
  }
}
```

运行时只能从 `ctx.props.content` 读取这些文案。不得把最终显示文字仅硬编码在 `runtime.js`，也不得因某个状态不在编辑器预览首页就漏登记。

V4 对 `content` 使用递归合并。修改一个深层字符串不会丢失默认值、变体或预设中的兄弟文案；其他 props 仍沿用顶层覆盖语义。

`editor.properties` 对文字的作用是指定顺序、友好标签、说明、多行和长度，不决定文字是否可编辑。即使某个 `content` 字符串没有显式字段，它仍会自动出现。显式声明 `content...` 时只能使用 `text` 或 `textarea`。

动态分数和时间可计算，但人工模板仍放入 content，例如 `得分：{score}`。Logo、照片原有文字和不可拆分艺术字属于需说明的素材例外。

## 4. 公开属性

除自动文字外，`editor.properties` 支持：

| 类型 | 属性值 | 用途 |
| --- | --- | --- |
| `text` | 字符串 | 单行文案 |
| `textarea` | 字符串 | 长文案 |
| `number` | 数字 | 分值、速度、数量、时长 |
| `boolean` | 布尔值 | 功能开关 |
| `color` | `#rrggbb` | 颜色 |
| `select` | 选项字符串 | 布局、模式、题型 |
| `image` | 工程素材 ID | 教师可替换图片 |

`key` 是点分路径，例如 `content.feedback.correct`、`items.0.imageId`。禁止空路径段、`__proto__`、`prototype` 和 `constructor`。

图片属性存的是工程 `AssetMeta.id`，运行时通过 `ctx.projectAssetUrl(assetId)` 读取。组件自带且不需替换的图片通过 manifest `assets` 和 `ctx.assetUrl(assetKey)` 读取。

工程素材删除使用共享引用图：外部组件基础/命名状态 Props 中出现的工程 Asset ID、公开 `image` 属性及有效默认值都会保护素材；提供包上下文时还会保守扫描组件 Runtime source。缺少匹配包上下文时，删除安全路径会按可能引用阻断并报告上下文缺失，而不是把素材判为未使用。因此应优先把教师可替换图片声明为 `image` 属性，不要只把工程 Asset ID 隐藏在任意字符串或源码中。

### 4.1 显式开放画布文字编辑

属性栏始终是公开文字的基础编辑入口。若组件还希望教师在编辑画布中双击文字直接修改，必须显式登记命中区域；宿主不会扫描画面文字或按 DOM 文本猜测 Props。

DOM 组件在真实文字元素上标记点分 Props 路径：

```html
<h2
  data-courseware-edit-key="content.title"
  data-courseware-edit-label="标题"
>
  标题
</h2>
<p
  data-courseware-edit-key="content.prompt"
  data-courseware-edit-label="题干"
  data-courseware-edit-multiline="true"
>
  题干
</p>
```

Phaser 或 hybrid 组件通过可选编辑桥登记组件本地设计坐标中的矩形：

```js
var removeTitleRegion = ctx.editor?.registerTextRegion({
  key: 'content.title',
  label: '标题',
  multiline: false,
  maxLength: 80,
  getBounds: function () {
    return { x: 24, y: 18, width: 272, height: 42 }
  }
})
```

规则：

- `ctx.editor` 是隔离 authoring Player 在 `mode: 'edit'` 可能提供的可选扩展，必须判空；当前位置试运行、整课预览、普通 preview/capture 和成品 Player 不提供该桥；
- 返回函数用于提前注销区域；组件销毁时宿主也会清理仍登记的区域；
- `getBounds()` 可随组件内部运动返回最新位置，但必须是有限数值、正宽高和组件本地坐标；Phaser / Canvas 内部布局或运动改变边界后调用 `ctx.editor?.invalidate()`，宿主会合并刷新且销毁后的调用安全无效；
- `key` 必须能解析为字符串，并对应 `editor.properties` 中的 `text` / `textarea` 或宿主递归发现的 `props.content` 文字；
- DOM 的 `data-courseware-edit-label` 与 `data-courseware-edit-multiline` 可覆盖浮层标签和单/多行表现，最大长度仍以公开属性定义为准；
- 状态覆盖、撤销/重做和保存由宿主负责。组件只需在 `updateProps()` 中立即刷新画面；
- 未登记区域继续整体选择并通过属性栏编辑。

编辑浮层是纯文本入口，不替代组件自己的富文本数据结构。完整示例可参考 `examples/render-host-benchmark/components/editable-table/`（DOM）和 `examples/sample-counter-component/`（Phaser）。

## 5. 页面、变体和预设

V4 提供 `editor.pages`、`variants` 和 `presets`：

- `editor.pages` 只对属性分组并控制编辑器正在预览的内部页；
- 声明页面时需提供 `previewPageProp`；
- `ctx.editorState.pageId` 是编辑状态，不要与学生播放的业务初始页混用；
- `variants` 是可切换属性补丁；
- `presets` 是可直接添加的起点，可引用变体和预览页。

V4 预设合并顺序：

```text
defaultProps → variant props → preset props → instance props
```

其中各层 `content` 递归合并。无论页面、变体和状态有多少，所有可达状态的可见文案都必须出现在有效 `props.content` 中。

## 6. 注册运行时

```js
window.CoursewareComponent.define({
  id: 'com.example.global-controls',
  runtimeApiVersion: 4,

  create(ctx) {
    let mode = ctx.mode
    let props = ctx.props

    return {
      setMode(nextMode) {
        mode = nextMode
      },
      resize(width, height) {
        // 重新布局已有对象。
      },
      updateProps(nextProps) {
        props = nextProps
        // 立即更新文字、图片和样式。
      },
      setEditorState(state) {
        // 仅处理编辑预览页/变体状态。
      },
      destroy() {
        // 清理监听、Timer、Tween、音频和外部引用。
      }
    }
  }
})
```

注册的 `id`、`runtimeApiVersion` 必须与 manifest 一致。入口同步且只注册一个定义；`create()` 必须返回含 `destroy()` 的生命周期对象。

## 7. V4 `create(ctx)` 上下文

```ts
interface ComponentCreateContextBase {
  runtimeApiVersion: 4
  renderMode: 'dom' | 'phaser' | 'hybrid'
  instanceId: string
  width: number
  height: number
  mode: 'edit' | 'preview' | 'capture'
  props: Record<string, unknown>
  editorState: Readonly<{ pageId?: string; variantId?: string }>
  editor?: {
    registerTextRegion(region: {
      key: string
      label?: string
      multiline?: boolean
      maxLength?: number
      getBounds(): { x: number; y: number; width: number; height: number }
    }): () => void
    invalidate(): void
  }

  actions: Readonly<{
    goToScene(sceneId: string, targetStateId?: string): boolean
    nextScene(): boolean
    previousScene(): boolean
    replayScene(): boolean
    restartCourse(): boolean
  }>

  scope: 'scene' | 'global'
  events?: CourseEventBus
  courseState?: CourseStateStore
  presentation?: RuntimePresentationApi

  assetUrl(assetKey: string): string
  projectAssetUrl(assetId: string): string
  capture: { waitUntil(promise: Promise<unknown>): void }
  emit(eventName: string, payload?: unknown): void
}

interface ComponentCreateContextDom extends ComponentCreateContextBase {
  renderMode: 'dom'
  dom: { root: HTMLElement }
}

interface ComponentCreateContextPhaser extends ComponentCreateContextBase {
  renderMode: 'phaser'
  phaser: {
    Phaser: typeof Phaser
    scene: Phaser.Scene
    root: Phaser.GameObjects.Container
  }
}

interface ComponentCreateContextHybrid extends ComponentCreateContextBase {
  renderMode: 'hybrid'
  dom: { root: HTMLElement }
  phaser: {
    Phaser: typeof Phaser
    scene: Phaser.Scene
    root: Phaser.GameObjects.Container
  }
}
```

- DOM 对象加入 `ctx.dom.root`，Phaser 可见对象加入 `ctx.phaser.root`；
- `dom` 模式不存在 `ctx.phaser`，`phaser` 模式不存在 `ctx.dom`，只有 `hybrid` 同时提供两者；
- `mode === 'edit'` 表示组件正由统一画布的 authoring Player 渲染；宿主同时屏蔽组件输入并冻结宿主动作、内置媒体、导航和课程状态，组件自身也不得绕过这些边界创建原生媒体或推进学生业务；`capture` 只产生确定静态画面；
- `editor` 仅由隔离 authoring Player 按需提供，必须判空；它只登记画布文字命中区，不是编辑器 DOM、工程 Store 或通用 patch 入口；
- `props` 已合并默认值和实例值；
- `actions` 在预览和互动网页导出中工作，在编辑画布中返回 `false`；捕获模式不得主动导航或推进状态；
- V4 的 `scope` 始终存在；Player 还提供生命周期作用域的可选 `events`、课程级 `courseState` 和场景 `presentation`，这些可选值仍需按类型判空；
- `events` 订阅在组件销毁时由宿主自动解除，组件仍可保存 disposer 并显式清理；
- `courseState` 普通翻页和重播保留，`restartCourse()` 时清空；只可存纯数据；
- `emit()` 在 Player 中包装为 `component:event`，并同时派发兼容的浏览器事件。
- 异步字体、图片、GLB、纹理或解码器初始化必须用 `capture.waitUntil()` 登记，Promise 必须可确定结束。

旧包不能只把 manifest 数字改成 4：离线迁移时应先把入口改为 `ctx.phaser`/`ctx.dom`，补齐 `supportedScopes`、`renderMode`、生命周期和捕获合同，再用当前导入器做真实交互与静态捕获验收。修改 `renderMode` 不会自动转换现有实现。

V4 组件可以直接订阅 `scene:enter`、读取/写入课程状态并与运行时协作：

```js
var removeSceneListener = ctx.events?.on('scene:enter', function (event) {
  currentSceneId = event.sceneId
  render()
})

if (ctx.courseState) {
  var uses = (ctx.courseState.get('globalControls.uses') || 0) + 1
  ctx.courseState.set('globalControls.uses', uses)
}

// 组件判定完成后切换作者可编辑的稳定场景状态。
ctx.presentation?.transitionTo('state_correct', {
  duration: 260,
  ease: 'Sine.easeInOut'
})
```

`events/courseState/presentation` 必须判空，`scope` 可直接使用。组件没有独立 `localState` 和导航守卫；复杂课程规则、跨组件编排和导航约束仍优先放在 `globalRuntime`。组件可直接切换稳定场景状态，也可通过 `emit()` 上报高层事件交给运行时协调。

### 7.1 渲染平面与真 3D

组件宿主使用固定的粗粒度 DOM/Canvas 平面，不承诺 DOM 元素与 Phaser 显示对象按每个节点的 depth 任意穿插。Phaser 部分进入主 Canvas 的组件容器；DOM 部分进入与组件框同步位置、尺寸、旋转、透明度和可见性的 Phaser DOM 表面，并整体位于 Canvas 上方、运行时 DOM overlay 下方。需要精确前后交错的对象应放在同一渲染器内，或把视觉拆成明确的前后景；不要依赖浏览器偶然的 z-index 结果。

因此 DOM/hybrid 组件的 DOM 部分应按 overlay 内容设计。场景节点顺序或全局元素的 `layer: 'underlay'` 不能把这部分 DOM 压到 Canvas 后面；它们只对组件的 Phaser 代理/Phaser 部分保持 Canvas 内层级语义。必须位于原生节点背后的可复用视觉应使用 Phaser 组件，或把后景明确交给运行时 DOM underlay。

编辑器核心和 Player 不内置 Three.js。需要可复用的地球、太阳系、立体几何等真 3D 组件时，在构建阶段把 Three.js 与所需 loader 打进组件自己的 `runtime.js`，使用 `renderMode: 'dom'` 并把 `WebGLRenderer.domElement` 挂到 `ctx.dom.root`；同时确需 Phaser 才使用 `hybrid`。3D 模型默认使用 GLB，并作为组件包内 manifest asset 交付；loader、纹理和解码器也必须离线，不得访问 CDN。当前 Course Project V9 没有一等 `model` 素材类型，不能用 `image` 属性伪装 GLB；若要让教师从工程“媒体”管理中独立替换模型，须先扩展 Project Schema、归档、媒体管理和全部导出链路。

Three.js/WebGL 组件必须在 `resize()` 更新 renderer 与相机，在 `setVisible(false)` / `suspend()` 停止 RAF 和昂贵更新，在 `prepareCapture()` 主动渲染确定帧，在 `destroy()` 释放 geometry、material、texture、render target、renderer、监听和 RAF。加载任务通过 `ctx.capture.waitUntil()` 登记，并提供可理解的缩略图与可捕获静态画面。这样 3D 成本只由使用该组件的工程承担，不成为编辑器核心依赖。

## 8. 场景组件与全局组件

### 场景组件

- 随场景渲染；
- 离开场景和重播本页时销毁；
- 适合题型、实验、动画模块和场景内工具；
- V4 manifest 必须包含 `supportedScopes: ['scene']` 或同时包含两种作用域。

### 全局组件

- 播放器启动时创建一次；
- 普通翻页和重播本页时保持同一实例；
- `restartCourse()` 时销毁并重建；
- 可声明 `underlay` 或 `overlay`；Phaser 部分遵循该层级，DOM/hybrid 的 DOM 部分仍位于固定组件 DOM 平面；
- 可见范围为 `all`、`include` 或 `exclude`，引用稳定场景 ID；
- 隐藏时宿主关闭显示和输入，但不销毁内部状态。
- 可通过 `ctx.scope === 'global'` 确认播放器挂载作用域，通过 `ctx.events` 订阅 `scene:enter` 更新常驻 HUD，通过 `ctx.courseState` 与场景运行时共享进度。

全局组件适合确有复用价值的定制导航、定制教师工具、计时和积分 UI。普通上一页/下一页/场景目录/重播/重开/声音/全屏控制优先使用内置 `TeacherControllerNode`；常规音乐优先使用 Course Project V9 声音库和声道。只服务一个工程的复杂课程规则通常更适合 `globalRuntime`，可枚举的按钮映射优先使用 `interactions` / `globalInteractions`。

若一个包声明同时支持两种作用域，其实现应根据可选 `ctx.scope` 正确适配两种生命周期；在字段缺失的编辑宿主中使用安全回退，不能直接解引用。

## 9. 宿主动作

```js
function next() {
  if (mode !== 'preview') return
  ctx.actions.nextScene()
}

function branch() {
  if (mode !== 'preview') return
  ctx.actions.goToScene('scene_summary', 'state_complete')
}
```

动作返回同步 `boolean`：目标不存在、越过首页/末页、当前页重入或导航守卫阻止时可能为 `false`。`goToScene(sceneId, targetStateId?)` 可原子进入目标场景的指定命名状态；省略或状态引用失效时进入目标场景初始状态。同场景调用可只切换状态；若导航守卫把请求重定向到另一个场景，原请求的目标状态不会套用到重定向场景。

`replayScene()` 只重建当前场景作用域，不重建全局组件；`restartCourse()` 会重建全局组件并从第一场景开始。不要混用。

## 10. 生命周期

```ts
interface ComponentInstanceLifecycle {
  setMode?(mode: 'edit' | 'preview' | 'capture'): void
  resize?(width: number, height: number): void
  updateProps?(props: Record<string, unknown>): void
  setEditorState?(state: Readonly<{ pageId?: string; variantId?: string }>): void
  setVisible?(visible: boolean): void
  suspend?(): void
  resume?(): void
  prepareCapture?(): void | Promise<void>
  destroy(): void
}
```

- `setMode`：切换编辑/预览/捕获行为，不重复注册输入；捕获模式不得推进学习状态；
- `resize`：重新布局现有对象；
- `updateProps`：立即刷新 `props.content`、图片和公开样式；
- `setEditorState`：切换编辑器内部预览页面；
- `setVisible`：全局可见范围或宿主显隐改变时关闭/恢复显示和输入，不销毁业务状态；
- `suspend` / `resume`：暂停/恢复 RAF、物理、媒体和昂贵更新，不把暂停时长补算成一大帧；
- `prepareCapture`：宿主会先排空此前登记的资源任务，再由此 hook 把 DOM/Canvas/WebGL 推进并渲染到确定的最终静态帧；hook 内同步登记的任务必须在异步最终绘制完成后才 resolve，宿主随后立即复制该实例 Canvas/WebGL 帧，再准备下一个实例；PPTX 组件捕获按实例依次创建隔离 Player，避免大量 Three/WebGL 组件同时占用上下文；
- `destroy`：解除监听，停止 Timer、Tween、RAF 和音频，释放组件自己的引用、纹理和 GPU 资源。

生命周期方法应可重复、安全调用。全局组件需特别防止把场景切换、隐藏或 suspend 误判为销毁或重新创建。宿主记录组件生命周期的首个失败并销毁失败挂载，后续捕获继续拒绝，不能因一次显隐或同步更新而“复活”为空白成功。`prepareCapture()` 抛错只使该组件实例产生可诊断占位，已经成功的组件快照继续保留，不应吞掉错误或让整批 PPTX 组件退化。

组件自行创建的音频、视频或媒体流不会自动进入 Course Project V9 的主音量、声道和画布控制器管理。若确需自建媒体，组件必须公开必要属性，监听或接受宿主静音语义，并在隐藏/销毁时暂停、解除事件、释放对象 URL 与媒体资源；常规课件声音和视频应使用内置媒体模型。

场景状态切换不会销毁组件实例。宿主会在同一实例上调用 `resize()` 和 `updateProps()`，因此这两个方法必须真正刷新现有显示对象，不能要求通过重新执行 `create()` 才生效。

## 11. 图片加载

```js
function loadProjectImage(assetId) {
  const textureKey = `${ctx.instanceId}:cover:${assetId}`
  const url = ctx.projectAssetUrl(assetId)
  const scene = ctx.phaser.scene

  scene.load.image(textureKey, url)
  scene.load.once(`filecomplete-image-${textureKey}`, () => {
    const image = scene.add.image(0, 0, textureKey).setOrigin(0)
    ctx.phaser.root.add(image)
  })
  scene.load.start()
}
```

上例只适用于 V4 `phaser` / `hybrid` 组件。DOM 组件使用普通图片元素并挂到 `ctx.dom.root`。两者都必须处理素材不存在、加载失败和属性切换；不要缓存物理 URL，也不要为每次属性变化创建无法释放的新纹理。异步完成条件应同时登记到 `ctx.capture.waitUntil()`。

## 12. 编辑与预览

编辑模式中，组件由 Player 作为唯一视觉源显示；透明 Phaser 层只负责组件节点的整体选择、移动、缩放和旋转。属性栏可编辑 `props.content` 和公开字段。V4 全局组件可与全局原生元素一起在统一“全局层”中编辑位置、层级和可见范围。

组件在“编辑状态”画布中由隔离 authoring Player 以 `mode: 'edit'` 创建，显示与成品相同坐标和合成层级下的稳定视觉，同时禁止内部互动；在中央“当前位置试运行”、顶部“整课预览”和网页导出中使用 `mode: 'preview'`；静态捕获使用 `mode: 'capture'`，不得推进学生业务，只生成确定画面。当前位置试运行从当前场景/状态启动（基础场景回退当前场景初始状态），整课预览从第一场景初始状态启动。场景命名状态切换时不会重新执行 `create()`，而是在同一实例上调用 `resize()` / `updateProps()`，因此状态覆盖中的组件参数必须能即时反映。

单 HTML 和网页包导出会把组件默认参数展平到实际实例 props，只发布运行必需的组件 ID、版本、API/渲染能力、编码执行逻辑和组件素材；组件包的 `manifest.json`、`editor.properties/pages`、变体、预设、说明、缩略图和独立原始 `runtime.js` 不进入发布物。执行逻辑在浏览器端仍可恢复和分析，这只是 [PublishedLesson V1](PUBLISHED_LESSON_V1.md) 的轻量发布裁剪，不是代码加密或 DRM。

外部组件节点与原生节点一样，可作为 Course Project V9 `node.enter` / `node.exit` 动作目标。宿主只对组件根容器执行立即、淡化、四向滑动或缩放，不重新执行 `create()`；时机由规则触发器决定，动作步骤可顺序、并行、延迟并以 `animation.completed` 接力。`playbackInitialVisibility: 'hidden'` 只在互动 Player 中等待入场；编辑、缩略图和静态导出仍显示组件的稳定作者画面。组件内部关键帧、循环或复杂动画仍由组件自己管理，不能与宿主动画重复叠加。

内部点击、拖拽、动画状态推进和宿主动作只在 `preview` 生效。authoring 中即使组件代码创建了命中对象，宿主也会屏蔽输入并冻结动作；组件不得访问编辑器 DOM，也不得假定属性栏结构。

V4 保证所有 `props.content` 文字可在属性栏编辑；画布原位编辑是可选扩展，组件必须通过 DOM `data-courseware-edit-key` 或 `ctx.editor.registerTextRegion()` 显式登记。未登记不影响属性栏、预览或导出。

PDF/PPTX 不执行组件互动或声音。可视组件应提供可理解的稳定编辑预览和静态结果；视频型定制组件需要明确海报/占位方案。内置 `TeacherControllerNode` 默认不进入静态导出，而自定义组件是否应出现在静态成品中由组件视觉和导出捕获结果决定。

DOM 静态捕获支持常规背景、边框、文字、图片、表单值和 Canvas/WebGL 快照，但不承诺复现所有伪元素、滤镜、混合模式、遮罩或特殊 CSS。组件作者必须实测 PDF/PPTX；必要时在 `capture` 模式提供更简单的确定画面，或把关键视觉绘制到可捕获 Canvas。

## 13. 组件包管理与故障隔离

Editor 1.0.0 在专业模式独立“组件”页的“工程组件”列表把组件包作为工程一等资源管理：显示包 ID、版本、场景实例数和全局实例数。仍有任一实例引用时禁止删除；只有引用数为 0 时可安全删除。

“选择新包替换”只接受 manifest ID 相同的新包。替换前会校验新包的 `supportedScopes` 是否覆盖所有现有场景/全局实例；校验、解包或迁移失败时原工程保持不变，成功后所有实例版本统一更新。不同 ID 的组件不能借替换入口隐式迁移。

专业“开发”工作台不会直接改写导入的第三方组件。选择“组件代码”任务后，Runtime 与 Manifest 通过二级标签一次显示一个。第三方包的 manifest/runtime 默认只读；用户必须先在场景“基础”或全局层对所选实例执行“创建可编辑副本”，得到新的工程内包 ID 和版本，原包保持不变，所选实例切换到副本。命名状态只允许覆盖 Props，不能改变组件包身份，因此必须先返回“基础”。可编辑资格由 Course Project V9 中持久化的 `editableCopy` 来源标记判断，不能靠包 ID 命名伪装。此后才能在受控代码框中修改副本 manifest/runtime；ID 和版本不可在代码框内改写，应用前复用组件包路径、入口、缩略图、素材、运行时 API 与现有实例作用域校验，成功修改进入正常撤销历史。

“只读”只阻止直接覆盖原包，不阻止查看或复制已经交付的代码，也不替代许可证约束；创建副本前应确认组件授权允许修改和二次分发。可编辑副本是工程作者态能力，不是源码保密措施。`.h5lesson` 保存完整组件包；单 HTML/网页包虽会裁掉 manifest、编辑器字段和独立原始 `runtime.js`，浏览器仍需取得可恢复的执行逻辑。不要在组件或工程中存放密钥，并且不要把 PublishedLesson 裁剪描述为加密、不可逆向或 DRM。

组件创建、属性更新、尺寸/可见性/暂停更新、捕获准备和销毁必须可隔离失败。单个实例异常会进入本地诊断日志并保留其他页面/组件运行；静态导出也只回退该实例，不能清空此前成功快照或阻断后续实例。作者排障时先运行“工程检查”确认包和引用，再导出不含课件素材内容的诊断报告。

## 14. 打包

在组件源码目录执行，确保当前目录根部就是 manifest：

```powershell
Compress-Archive -Path manifest.json,runtime.js,thumbnail.png,assets `
  -DestinationPath global-controls.zip -Force
Rename-Item global-controls.zip global-controls.h5component
```

无缩略图或素材目录时从命令中移除。不要压缩外层项目目录。

### 14.1 当前仓库参考

V4 DOM 表格、V4 Phaser 仪表以及按内容内联 Three.js 的完整对照见 [`examples/render-host-benchmark/`](../examples/render-host-benchmark/README.md)，可用 `npm run build:render-benchmark` 重建。其 Playwright 压力段执行 25 轮、共 100 次定制场景切换和 25 次末页重播，并检查组件/运行时挂载、Canvas/WebGL、活动 RAF、控制台异常与外部请求。

## 15. 信任与宿主边界

Component 是经过审核的可信扩展，不是普通图片；外部导入只表示组件没有内置进产品，不会自动降低信任等级。当前 authoring iframe、主窗口和网页导出提供的能力并不完全相同，这属于宿主事实，而不是“外部组件必须低权限”的合同。

组件确需父页面、本地、桌面或其他宿主能力时，应使用该环境明确提供的稳定接口或同宿主执行语义；没有该能力的网页/导出环境必须明确降级，不能伪造 parity。发布前仍要审查入口和素材；不要持久化或导出密钥、账号、隐私数据，也不要运行时加载远程脚本。

## 16. 发布检查清单

- [ ] 组件使用 schema/runtime API 4，声明准确的 `supportedScopes` 与最小 `renderMode`；V1–V3 输入得到明确拒绝。
- [ ] Package ID 使用权利主体控制的反向域名；ittoedu 自有组件使用 `com.ittoedu.*`，第三方组件保留自己的命名空间，不靠改 ID 转移权属。
- [ ] manifest 与 runtime 的 ID 和 API 版本一致，入口同步只注册一次。
- [ ] 原始 `.h5component` ZIP 的 `sha256` 与嵌入文件集的 canonical `contentSha256` 均已记录并核对；内容哈希未被误写成签名、许可证或权属证明。
- [ ] 所有人工可见文字均位于有效 `props.content`，所有状态和页面均已覆盖。
- [ ] 显式文字字段只补充标签/说明，未依赖它决定可编辑性。
- [ ] 如开放画布文字编辑，DOM key 或 `ctx.editor?.registerTextRegion()` 与公开字符串路径一致，区域会更新/注销；authoring Player 中命中位置与组件视觉一致，preview/capture/成品在没有 `ctx.editor` 时正常运行。
- [ ] 图片、数字、颜色和模式按真实维护需求公开；工程图片使用 `image` 属性/稳定 Asset ID，可被引用图、删除保护和 Project Health 正确识别。
- [ ] `updateProps()`、`setEditorState()`、`resize()`、`setVisible()`、`suspend/resume()`、`prepareCapture()` 和 `destroy()` 行为正确。
- [ ] DOM/Phaser 对象只使用声明能力；没有依赖跨 DOM/Canvas 平面的逐对象交错，也没有把修改 `renderMode` 当作自动代码转换。
- [ ] 统一画布的编辑模式只显示稳定视觉和显式目标，不响应组件输入、媒体、导航或课程状态推进；预览模式交互正常。
- [ ] 可视组件提供离线缩略图；缩略图缺失/损坏时名称后备可读，场景缩略图不会空白。
- [ ] 场景/全局生命周期、隐藏输入、重播和重开已验证。
- [ ] 外层 `node.enter` / `node.exit` 与组件内部动画责任不重叠；业务触发、顺序/并行/延迟、完成事件与静态稳定帧正确。
- [ ] 组件包使用统计正确；同 ID 替换、作用域不兼容回滚、引用中禁止删除和无引用安全删除已验证。
- [ ] 需要代码修改时创建新 ID/版本的工程内可编辑副本，未直接覆盖第三方包；副本变更可撤销并通过 manifest/runtime 校验。
- [ ] 未重复实现可由 `VideoNode`、声音库/声道、`TeacherControllerNode` 或声明式交互完成的一等能力；自建媒体能响应静音并完整清理。
- [ ] 必需 `scope` 使用正确；`events/courseState/presentation` 均做可选检查；事件订阅、课程状态和场景状态切换语义已验证。
- [ ] 需要跨场景指定状态时使用 `goToScene(sceneId, targetStateId)`，并验证状态失效回退与导航守卫重定向。
- [ ] 组件事件可被全局运行时接收，复杂导航规则未塞进组件私有全局变量。
- [ ] 离线便携单 HTML/网页包不产生外部请求；在线轻量目标只访问工程声明的远程依赖，PDF/PPTX 静态化与捕获降级结果已检查。
- [ ] 发布物未携带作者态 manifest/编辑器字段或重复 `runtime.js`，同时已明确执行逻辑可恢复、不构成源码保密或 DRM。
- [ ] 捕获按实例产生确定帧；单实例失败只生成该实例占位，成功快照不会被后续失败清空，批量 Three/WebGL 组件不会同时创建捕获宿主。
- [ ] Three.js 如有使用，其执行库打包在组件内；GLB、纹理和解码器使用包内资源或工程已声明的远程交付，并有捕获/离线降级；RAF、WebGL 与 GPU 资源可暂停、可捕获、可销毁。
- [ ] ZIP 路径安全、大小写一致，组件包不超过 50 MB。
- [ ] 完整工程已运行 `npm run --silent validate:project -- <file.h5lesson>`；真实内嵌文件、Schema 与当前已接线的工程健康/四格式预检没有未处理的确定性错误，并已用真实 Player/导出确认实际网络使用与工程声明一致。
- [ ] 工程检查没有阻断导出的组件错误；异常隔离与诊断报告路径可用。
