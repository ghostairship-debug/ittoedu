# 互动课件编辑器

面向教师的可编辑互动课件桌面编辑器。**当前产品就是本仓库根目录 / `main`**：默认工程真相为 Course Project V9，发布为 Published Course V2，兼容 Runtime API 2/3 与 Component API 4。

当前开发以根目录 [开发总纲](COURSEWARE_DEVELOPMENT_PLAN.md) 为唯一入口：架构稳定化与审计修复已收口为 `engineering candidate`，总纲第 5 节“审计收口与生产减负”同样已收口，当前没有 Ready 卡。详细执行文件统一在 [docs/development-plan/](docs/development-plan/README.md)。

开发使用精简生产模式：默认路径"确认问题 → 实现一个行为 → 最小充分验证 → product commit"，S2/热点/并发才建卡，Reviewer 按风险触发，验证同 SHA 去重，完整验证只在集成/发布门运行。当前编辑器内没有可见 AI。自动化最多证明 `engineering candidate`；`accepted` 仍来自产品 Owner 的真实验收。

## 快速开始

### 双击启动当前源码

- Windows 10/11 x64；
- 已验证 Node.js 24.x、npm 11.x；建议使用当前 Node.js LTS；
- 可双击运行 `.cmd` 的标准 Windows 环境；
- 首次安装依赖需要访问 npm registry；Skill 同步本身只读写本机文件，不需要联网。

从 Git 拉取或源码 ZIP 解压后，直接双击根目录的 `启动课件编辑器.cmd`。启动入口会先把仓库权威课件 Skill 同步到当前用户目录，在缺少依赖时执行锁定安装，然后构建 Player、Renderer 与 Electron 主进程并打开编辑器；它不会调用 `electron-builder`，也不会生成便携版、安装包或 `release/` 制品。Skill 同步失败会显示明确警告，但不会阻止编辑器继续启动。

命令行等价方式：

```powershell
npm ci
npm start
```

`npm ci` 会严格按 `package-lock.json` 安装依赖；`npm start` 会通过 `prestart` 自动同步 Skill，再构建生产模式所需的三个目录并直接运行源码版 Electron。需要热更新开发时再使用 `npm run dev`；开发服务器固定使用 `127.0.0.1:5173`，若端口被占用会直接报错。

### Codex Skill 安装范围

仓库中的 [`.agents/skills/`](.agents/skills/) 是两个课件 Skill 的权威源码，也是进入本仓库及其子目录时的项目级发现入口。双击启动或执行 `npm start` 时，[安装脚本](scripts/install-courseware-skills.ps1) 会把它们幂等同步到 `%USERPROFILE%\.agents\skills`，从而允许当前用户在其他工作区调用：

```powershell
npm run install:courseware-skills
```

安装器只管理 `orchestrate-courseware` 与 `build-courseware-project`。它记录已安装树签名：内容未变时直接跳过，只更新仍与管理记录匹配的副本；用户改过的已管理副本会保留并提示人工处理。未纳入管理记录的同名当前 Skill 会用仓库副本覆盖，以便全局安装始终跟随仓库最新版。旧 `build-project-v8-courseware` 与 `build-project-v7-courseware` 只有在既往由本项目管理且字节仍与安装记录或已知官方版一致时才安全退役；修改过或未管理的旧 Builder 副本仍保留。安装器不会删除或修改 `%USERPROFILE%\.codex\skills` 中的历史副本。Codex 通常会自动发现变更；若列表未刷新，请重启 Codex。这些 Skill 是外部 AI 创作工作流，不会把 AI 能力嵌入 Editor 1.x。

开始修改前建议先建立基线：

```powershell
npm run typecheck
npm test
```

## 产品能力

- 固定 1280 × 720、16:9 课件画布；
- 多场景新增、复制、重命名、删除、缩略图和拖动排序；
- 每个场景包含“基础 + 多个命名状态”，支持初始/缩略图状态、最小元素覆盖、状态内新增/隐藏、状态层级和可撤销编辑；
- 文字、语义公式、图片、视频、基础图形、箭头、大括号、方括号、画布内教师控制器和互动组件；
- 单选、多选、框选、对齐、分布、吸附、缩放、旋转及图层排序；
- 中文输入法就地编辑、选区富文本，以及整段/选区级原生文字着重号；着重号在横排文字下方、竖排文字右侧逐字显示；横排自动增高，左右两种列方向的竖排文字可纵向拉长并自动增宽；字体列表显示中文名、CSS 字体名和本机可用状态；
- 一等 `FormulaNode`：以稳定 `formulaId`、无障碍文本和递归 AST 保存行、标记、运算符、竖式分数、根式、上下标及围栏；双击公式可用类 Word 的受限线性输入、结构模板和实时排版预览编辑，普通属性不暴露 AST JSON；编辑画布、Player、缩略图、HTML 与 PDF 共用同一个 Canvas 渲染模块，但编辑画布在独立文档中取不到内置数学字体，可能回退到系统数学字体，字形以 Player 或导出为准；
- 图片裁剪、焦点、适应/填充/拉伸、翻转、圆角和羽化；图片节点可登记稳定 ID 的归一化安全区，安全区只作为作者态编辑覆盖层和人工裁剪提示，不进入 Player 或导出画面；
- Course Project V9 必须包含最小 `designTokens`：字体 Token 保存稳定 ID、名称和 CSS `fontFamily`，色板 Token 保存稳定 ID、名称和颜色值；它们只提供人类/AI 可读取的工程词汇，不承载叙述性美术方向，也不会自动改写已有节点；
- 撤销、重做、复制、粘贴、重复，以及异步压缩、单通道去重写入的本地恢复副本；
- 简洁/专业两套编辑工作流：简洁模式只保留“元素 / 图层 / 属性”三个一级入口和常用图文能力，最近工程、另存为与工程检查收进“更多”；专业模式追加独立“组件 / 互动与动画 / 开发”入口、精确参数和高级声音设置。模式是本机界面偏好，切换不会改写、删除或降级 Course Project V9；
- Course Project V9 事件驱动元素动画：简洁模式会原子写入 `node.activated → node.enter` 规则及播放初始隐藏；专业模式可继续把 `node.enter` / `node.exit` 连接到点击、场景/状态进入、音视频/组件/运行时事件或前一动画完成。动作步骤支持 `after-previous` / `with-previous` 顺序与并行、局部延迟和完成事件；
- Course Project V9 声明式交互规则：场景规则与课程级 `globalInteractions` 分开保存；当前可视化配置节点点击、场景/状态进入、节点激活、动画完成、组件事件、带场景/全局来源的运行时事件和音视频事件，并用 `scene.in` / `presentation.in` 限定范围；
- 统一“元素”面板：文本、公式、图片、视频、声音和全部图形快捷入口统一放在“常用”；“媒体”负责批量导入、管理和复用工程内声音、视频与图片，专业模式再显示“控制与全局”。组件不再混入元素长列表，而在独立“组件”页统一浏览内置库、批量导入外部包并使用工程组件；
- Course Project V9 场景/全局自由运行时只接受 `RuntimeDocument` API 2：`renderMode` 严格声明 `dom/phaser/hybrid` 能力；一次性复杂互动可直接写入场景，跨场景复杂规则可写入全局运行时；稳定视觉仍应落在可编辑节点和命名状态中；
- 中央工作区始终是同一个 1280 × 720 画布，只在“编辑状态 / 当前位置试运行”之间切换职责：Player 是两种状态的唯一视觉源；编辑状态在其上叠加透明 Phaser 原生节点交互层，当前位置试运行则把输入交还给真实 Player；
- 编辑状态使用隔离的 authoring Player 挂载组件与场景/全局运行时，但冻结学生互动、声明式动作、音视频、导航和课程状态写入；因此可在原位置看见完整合成画面并安全拖改原生节点。当前位置试运行从当前场景和当前命名状态启动，顶部“整课预览”仍从课程起点播放；
- Component API 4 `.h5component` 导入：支持场景/全局作用域、全部 `props.content` 文案、严格 `dom/phaser/hybrid` 能力、暂停/显隐和捕获生命周期；
- 组件可显式开放画布双击文字编辑：DOM 使用 `data-courseware-edit-key`，Phaser/hybrid 使用可选的 `ctx.editor?.registerTextRegion()`；当前四个内置实验组件已把画面上的可编辑稳定文字全部登记为画布目标，属性栏仍是完整基线；
- 场景运行时可选择 `authoringApiVersion: 1`，用 `ctx.authoring.register()` 或 DOM `data-courseware-edit-key` / `data-courseware-asset-key` 显式开放文字和图片命中区；键必须已存在于 `content.values` 或 `assets`。未声明 authoring 目标的 API 2 运行时仍由 Player 正常显示，只继续通过属性面板修改；运行时内容与素材绑定由当前场景的全部命名状态共享；
- 专业“开发”面板是加宽的单任务工作台，通过“运行时 / 对象 JSON / 规则 JSON / 组件代码”切换，一次只呈现一类编辑内容；代码区使用不折行的较大等宽编辑区。第三方组件代码默认只读，必须在场景“基础”或全局层创建带明确来源标记的新 ID/版本工程内副本，才可修改副本 manifest/runtime。修改进入撤销历史，并在应用前校验包路径、入口、缩略图、素材、运行时 API、注册身份和现有实例作用域；该面板不是通用 IDE，本身不提供文件浏览、Shell、依赖安装或编辑器源码修改；扩展运行时的宿主能力由实际执行环境另行定义；
- 母版式统一“全局层”可直接编辑跨场景持久的文字、图片、图形和组件，并设置前后景与场景可见范围；
- 新工程默认在全局画布放置结构化教师控制器；其“场景目录”按钮默认为 `scene.open-picker`，点击后展开全部场景并选择跳转，只进入目标场景的初始状态；目录展开、焦点与当前项高亮仅是 Player 临时 UI，不写入工程或场景状态。互动 Player 中整个可见控制器都可拖动，轻点仍执行原按钮，鼠标/触控超过阈值后只移动并抑制本次点击；位置受 1280×720 逻辑画布约束并可贴边，Alt+方向键提供键盘等价操作，Shift 可细调。授课位置只保存为会话偏移，切幕和重播保持，课程重开或重新打开后恢复作者位置；
- “元素”中的媒体管理可批量导入图片、声音和视频，也可把工程中已有图片或视频再次“添加到画布”，避免重复导入；从元素快捷入口选择多张图片或多个视频时会确定性错位排布并保持多选，从媒体页导入则只入库；编辑画布支持 50%–200% 缩放、Ctrl/Command+滚轮缩放、空格或鼠标中键平移及一键复位；
- 单项图片、视频、声音导入/替换及未引用素材删除把引用、素材元数据和实际字节纳入同一撤销事务；删除前使用同一素材引用图检查基础/命名状态、全局层、声音、场景/全局 Runtime 与组件 Props/图片属性。自由文本或缺少组件包上下文时采用保守阻断并给出位置，不能以“当前 UI 不会生成”为由删除仍可能被 AI 或导入工程引用的素材；
- 顶部“工程检查”显示当前已接线的结构、素材、交互、组件、运行时与静态兜底问题，并提供只读“信息释放”和“视觉密度”概览；V9→V8 残缺投影造成的多 Surface、共享层、Flow/Spatial 交互和多 Runtime 盲区仍未被覆盖，因此“0 个问题”不等于整课语义完整，这是长期边界而非等某条路线完成就会解除的临时状态；
- 四种成品导出均先生成当前已接线的目标格式 Export Preflight，按错误、警告、说明列出已检出的结构问题、静态差异和启发式风险；V9 Runtime/Component 源码的外联网络合规和部分富排版检查当前仍不完整，报告存在不等于覆盖完整，这是长期边界而非临时状态，离线结果须用真实浏览器和导出复核；
- 关闭含未保存修改的窗口时明确提供“保存 / 不保存 / 取消”三种选择；保存过程中发生的新修改继续保持未保存状态，不会被错误标记为已保存；
- 统一导出菜单：离线便携/在线轻量单 HTML、网页包、静态 PDF、对象级可编辑 PPTX；
- 场景缩略图按 `thumbnailStateId` 绘制背景、原生元素和组件缩略图，并按层合成已启用场景/全局运行时登记的静态后备；组件未提供图片时显示带名称的后备框，已启用运行时未提供后备时显示“运行时”提示角标；
- 大型课件缩略图延迟渲染、图片按场景加载和增量撤销历史。

详细操作见 [用户指南](docs/USER_GUIDE.md)，当前路线见 [COURSEWARE_DEVELOPMENT_PLAN.md](COURSEWARE_DEVELOPMENT_PLAN.md)。AI 制作课件先使用 [`orchestrate-courseware`](.agents/skills/orchestrate-courseware/SKILL.md) 写出并确认中等详细的 `01-teaching-plan.md`，再写带表面与逐步操作的 `02-presentation-script.md`；确认后再交给 [`build-courseware-project`](.agents/skills/build-courseware-project/SKILL.md) 盘点资产并用真实产品 API 增量构建 Course Project V9。教师工作流不使用 Hash、审批状态机或 Evidence 清单。聊天记录不充当唯一真相，自动管线最多给出 `engineering candidate`，`accepted` 必须来自明确的人类验收。协议背景见 [自由运行时指南](docs/RUNTIME_AUTHORING.md) 与 [组件开发指南](docs/COMPONENT_AUTHORING.md)。

## 技术栈

| 层 | 技术与职责 |
| --- | --- |
| 桌面容器 | Electron 43：窗口、文件对话框、协议、PDF、最近工程与恢复数据 |
| 编辑器界面 | React 19、Zustand、Immer、dnd-kit |
| 业务真相 | Course Project V9 JSON、Zod Schema、location/surface/图层/交互/运行时/组件实例 |
| 统一视觉画布 | Player Runtime：编辑状态、当前位置试运行和成品共用同一 1280 × 720 合成语义 |
| 原生编辑交互 | Phaser 4：编辑状态中的透明选择、框选、拖拽、缩放、旋转与命中层 |
| DOM 增强 | Shadow DOM 宿主：密集文字、表格、表单、HUD 和 HTML 组件/运行时 |
| 可选真 3D | Three.js/WebGL 由具体运行时或 V4 组件携带执行代码；当前资源离线打包，后续远程媒体按工程 origin 声明加载；编辑器核心不暴露 Three.js |
| 构建 | TypeScript 7、Vite 8 |
| 数据校验 | Zod 4 |
| 工程压缩 | fflate |
| PPTX | PptxGenJS 4 |
| 测试 | Vitest、Testing Library、Playwright Electron |
| 发布 | electron-builder |

所有运行时依赖均锁定在 `package-lock.json`，二次开发时不要删除锁文件或把 `node_modules` 放入版本库。

## 架构

```text
Electron Main
  ├─ 安全窗口与自定义协议
  ├─ 文件/工程/PDF IPC
  └─ Preload 白名单 API
           │
           ▼
React Renderer ── Zustand / Course Project V9 业务状态（唯一工程真相）
  ├─ 编辑器 UI
  ├─ 场景状态物化与状态覆盖命令
  ├─ 统一 StageViewport（固定 1280 × 720）
  ├─ 透明 Phaser EditorScene 交互层
  ├─ 版本化 Player authoring patch / target 协议
  ├─ 工程和组件包读写
  └─ 单 HTML / 网页包 / PDF / PPTX 导出
           │
           ▼
Player Runtime
  ├─ authoring / playback 两种宿主状态（视觉实现相同）
  ├─ Phaser PlayerScene
  ├─ CourseRuntimeKernel（导航、事件、课程状态、场景表现状态）
  ├─ 固定粗粒度 DOM underlay / Phaser Canvas / 组件 DOM / DOM overlay
  ├─ Runtime API 2 严格 DOM/Phaser/Hybrid 能力宿主
  └─ V4 场景/全局组件与自由运行时生命周期
```

架构核心不是 DOM 或 Phaser，而是受 Schema 校验的 Course Project V9 JSON。原生节点、声明式交互、自由运行时和组件都读取同一工程数据；渲染器只负责实现画面与输入。`renderMode` 决定宿主向某份 API 2/V4 代码开放哪些能力，不会把现有 DOM、Phaser、Canvas 或 Three.js 代码自动翻译成另一种实现。

中央工作区不再维护一套“编辑画面”和另一套“运行画面”。当前隔离 Player 负责真实视觉合成；编辑状态通过版本化 authoring 协议把完整原生节点快照、背景和层级变化发送给 Player，并由透明 Phaser 层只处理原生节点选择与几何操作。authoring 宿主会冻结输入、导航、音视频、声明式互动和课程状态，组件/运行时只能通过该协议发布文字或素材命中目标，不能借 authoring 协议直接改写编辑器 Store。切换到“当前位置试运行”后，同一画布位置改用 playback 宿主接收真实互动。这里的 iframe 是当前视觉合成、生命周期和会话竞态实现，不是 Runtime/Component 必须永久继承的信任边界。

Player 使用固定粗粒度平面：全局运行时 DOM underlay → 场景运行时 DOM underlay → 单一 Phaser Canvas → V4 组件 DOM 平面 → 场景运行时 DOM overlay → 全局运行时 DOM overlay。Phaser Canvas 内部再维护全局/场景前后景、原生节点和 Phaser 组件；V4 DOM/hybrid 组件的 DOM 部分跟随组件框变换，但整体位于 Canvas 上方，不能与单个 Phaser 对象按 depth 交错。DOM 与 Canvas 不是一个统一显示列表；要求精确交错的对象应使用同一渲染器，或拆成明确前景/后景。

主要目录：

```text
src/
├── main/       Electron 主进程、IPC、文件操作、协议与安全策略
├── preload/    暴露给 Renderer 的冻结桌面 API
├── renderer/   React UI、透明 Phaser 几何交互代理、工程与导出
├── player/     预览、单 HTML 和网页包共用的 Player Runtime
└── shared/     数据模型、Schema、几何、文字、图片和图形渲染

tests/
├── unit/        数据、Store、UI 与导出单元测试
├── integration/ Player、组件注册等集成测试
└── e2e/         真实 Electron 工作流测试

scripts/         示例生成、图标构建和发布验证
examples/        示例工程、组件包及其可编辑源码
docs/            用户指南与组件开发协议
resources/       应用图标等打包资源
```

关键入口：

- `src/main/index.ts`：Electron 生命周期；
- `src/preload/index.ts`：Renderer 可调用的桌面能力；
- `src/renderer/App.tsx`：编辑器顶层流程；
- `src/renderer/store/editorStore.ts`：工程状态和编辑命令；
- `src/renderer/phaser/EditorScene.ts`：编辑画布交互；
- `src/player/PlayerApp.ts`：预览和导出播放器；
- `src/shared/courseProjectTypes.ts`：Course Project V9 工程类型；
- `src/shared/courseProjectSchema.ts`：Course Project V9 运行时校验入口；
- `src/shared/projectTypes.ts` / `projectSchema.ts`：仍被 V9 引用的共享 Native 形状（合同冻结任务会抽离，不再当作「当前工程是 V8」）；
- `src/shared/projectSchemaTypeContract.ts`：共享 Native 类型与 Zod 输出的编译期双向门禁；
- `src/shared/assetReferences.ts`：删除、诊断、归档与发布裁剪共用的带位置素材引用事实源；
- `src/shared/diagnosticCodes.ts`：Project Health 与 Export Preflight 的类型化诊断码注册表。

## 数据格式

### 课件工程

`.h5lesson` 本质上是 ZIP，保存工程 JSON、素材及已嵌入组件。当前工程为 Course Project `schemaVersion: 9`，一等支持三类 surface、统一图层、场景状态、语义公式、媒体、声明式交互、动作步骤编排、事件驱动入场/退场、`playback.presenter` 和结构化教师控制器，并要求项目级 `designTokens`。公式以递归 AST、稳定 `formulaId` 和 `accessibleText` 随工程及状态覆盖保存；`ImageNode.safeAreas` 以节点归一化坐标保存作者希望保留的主体区域。全局层可容纳原生文字、公式、图片、视频、图形、教师控制器和外部组件。旧 Project V1–V8 不再由主程序载入或导入；打开时会得到明确的“不受支持”结果。更高版本同样会被拒绝，不能静默丢字段。需要恢复更旧工程时使用归档标签 `internal-prototype-1.7.0` 对应的旧编辑器，或后续独立离线转换工具。

`designTokens.fonts` 和 `designTokens.colors` 都使用同类内唯一、以小写字母开头的稳定 ID。字体 Token 只保存名称与 CSS 字体值，色板 Token 只保存名称与颜色值；它们是机器可读的最小设计词汇，不是节点样式引用系统。修改 Token 支持撤销/重做，但不会追溯更新已经使用相似字体或颜色的节点。图片安全区同样属于作者态元数据：编辑器在选中图片时绘制覆盖层，Player、缩略图和导出器不把边框或标签画进成品；导出预检只提醒作者人工确认裁剪后的主体是否完整。

`playback.presenter.enabled` 开启后，Player 会接收无修饰键的 PageUp/PageDown 以及属性栏录入的精确附加按键组合。`scene-navigation` 策略直接切换相邻场景并在首尾边界给出反馈；`authored-command` 只分发 `presenter.command` 规则，没有匹配规则时不会退化为自动翻页。左/右方向键仍由独立的 `playback.keyboardNavigation` 控制。输入框、文本编辑、滑块、显式键盘捕获区和打开的模态层会保留键盘所有权；按键长按、组合键不匹配和短时间硬件抖动不会重复触发。

Course Project V9 的声明式交互规则是稳定状态与运行逻辑之间的首选连接层。`scene.interactions` 管理当前场景节点及场景事件；`globalInteractions` 管理只创建一次的全局元素和课程级映射，并用 `scene.in` 限制规则在哪些场景生效。每条规则包含触发器、AND 条件和有序动作步骤；步骤的 `after-previous` 等待上一并行组完成，`with-previous` 与前一步同组启动，`delayMs` 是相对于当前触发点或上一组的局部延迟。`scene.go` 可携带 `targetStateId` 原子进入指定场景状态；场景导航、重播和重开必须是最后一个独立动作组。

`node.enter` / `node.exit` 是动作载荷，使用 `none`、`fade`、`slide`或 `scale`，滑动额外保存上/下/左/右方向，并提供时长与缓动。动画完成后会按步骤稳定 ID 发出 `animation.completed`，可触发下一条规则；被后续动画、场景销毁或状态基线更新取消时不发完成事件。`playbackInitialVisibility: 'hidden'` 只决定互动 Player 是否先隐藏等待入场；入场/退场只改变 Player 瞬态可见性，不写回节点 `visible` 或切换场景状态。路径、关键帧和连续程序动画仍由组件或运行时承载。

简洁模式选中场景节点时，“属性”直接提供低负担的“出现动画”，并一次性维护入场规则与播放初始隐藏。专业模式把规则编辑分成两处：“属性”中的“交互”只显示该节点的 `node.click` 规则；右侧“互动与动画”维护进入场景/状态、节点激活、动画完成、声音结束、视频生命周期/时间点、组件事件及 `runtime.event` 等非点击规则。完整规则统一按“当 / 如果 / 就”解释，并提供自然语言摘要、搜索/筛选、常用模板及可读的顺序/并行动作序列。

`media.audio.sounds` 以稳定 `soundId` 建立声音库条目，并关联工程内音频素材、声道、默认音量和循环设置。“元素”→“常用”中的声音快捷入口负责导入，“媒体”负责试听、重命名、删除和复用；专业模式在媒体管理中追加默认静音、主音量、五个声道音量和旁白 ducking。交互动作只引用 `soundId` 或声道，不引用物理路径；Player 统一处理场景/课程生命周期、自动播放解锁、播放/恢复淡入、暂停/停止淡出及可取消的 ducking 淡变。视频是独立 `VideoNode`，可添加、删除、拖拽、缩放和配置封面、裁切方式、播放区间、循环、音量、速度、表面点击播放及开始播放时对背景音乐执行 `none/duck/pause/stop`。视频表面点击保留给媒体播放，不再提供“连接到状态”快捷入口；状态或场景变化应在专业模式使用视频生命周期规则，或另放按钮/透明图形热点。旧视频点击规则仍可查看，但只有关闭视频内置点击播放与原生 controls 后才能命中；编辑器会提示该冲突，也会提示“循环视频的结束事件不可达”。

工程素材引用不只存在于当前场景基础节点。命名状态背景与 `nodeOverrides`、全局层、声音目录、场景/全局 Runtime 的绑定、内容、源码字面量与 `staticFallback`，以及外部组件的嵌套 Props、公开图片属性和状态覆盖都进入同一引用分析。存在直接或保守引用时，媒体删除会被阻止并指出上下文；只有未引用素材可以删除，且删除、Undo 与 Redo 会同步恢复或移除元数据和原字节。Project Health 的 `asset-unused` 与单 HTML/网页包的发布资源投影复用同一事实源；`.h5lesson` 是否裁剪孤儿素材仍是独立兼容决策，本轮不静默改变工程归档语义。

工程打开、保存、恢复副本压缩、组件包导入和网页包生成均走异步归档路径。自动恢复在编辑停止约 1.8 秒后排队，只允许一个构建/写入管线运行；新修订会取消已经过期的压缩结果，并跳过重复修订。手动保存以启动保存时的工程快照为准；若压缩或写盘期间继续编辑，保存完成后这些新修改仍标记为未保存。启动时可恢复上次本地副本；关闭窗口时使用“保存 / 不保存 / 取消”明确决定。

组件包是工程的一等资源。专业模式“组件”页把高频插入和包管理合并为一份“工程组件”列表：卡片可插入实例或预设，次级菜单提供详情、更新、替换、定位使用位置和安全移除；仍被实例引用的包不能删除。同 ID 新包用于替换或升级前会校验现有实例作用域，失败时工程保持原状；成功后所有实例版本同步更新。单个组件运行失败由宿主隔离并记录诊断，不应使整页或其余组件失效。

可复用组件源码与制品位于独立的本地 `courseware-components` 目录，不通过 Vite 虚拟模块或编辑器硬编码清单装入核心。专业模式“组件”→“打开内置组件库”以全尺寸界面扫描目录根部的 `catalog.json`，按通用/学科、学段和用途动态筛选，并可一次把多个包加入工程而不自动创建实例。加入前会重新读取并校验 `.h5component` 的 SHA-256，再把精确 ID、版本、哈希、导入时间和来源标签随完整包嵌入 `.h5lesson`。与发行版审核摘要匹配表示该 catalog 的发行身份与完整性已确认，不形成高于其他已审核组件的执行权限等级。“导入外部组件”允许多选，选定后直接校验并加入工程，不再对每个新包弹出确认或成功摘要。工程已经嵌入的精确包可直接反复实例化，不再读取目录或重复提醒；会覆盖现有代码的更新、替换及同 ID/版本哈希冲突仍显式审阅或阻断。哈希校验用于完整性与版本锁定，不等于业务审核或恶意代码安全证明。

目录有更高语义版本时只显示“审阅并更新”，不会静默替换。更新仍须保持同一组件 ID、覆盖现有作用域并通过导入校验；同一 ID/版本对应不同哈希时直接阻断，维护者必须提升版本号。当前目录是朗读标注、拼音标注、文字视觉容器和图片装饰容器四个 `experimental` 包；后两者分别在属性栏切换 5 种文字外观和 2 种图片外观。隐藏 V8 矩阵 2/2 完成四组件画布文字编辑、样式切换、100 次压力导航、4 页 PDF 与 4 页 PPTX；catalog 因此移除 `current-v8-full-matrix-unverified`，但许可和维护人阻断保留。新视觉组件为 CSS/SVG 独立重做，已删除旧来源不明位图；这仍不等于权属或商用许可已完成。

涉及工程格式的修改必须同步检查：

1. `src/shared/projectTypes.ts`；
2. `src/shared/projectSchema.ts`；
3. `src/renderer/project/createProject.ts`；
4. 工程保存、打开、版本拒绝与必要的离线转换边界；
5. 编辑器、播放器及各导出器；
6. `tests/unit/projectArchive.test.ts` 和相关 E2E。

不要只修改 TypeScript 类型而遗漏 Zod Schema，否则工程可能在保存后无法重新打开。

### 互动组件

`.h5component` 也是 ZIP，根目录必须包含 `manifest.json` 和入口脚本。当前只接受 Component API 4：`schemaVersion: 4`、`runtimeApiVersion: 4`，显式声明 `supportedScopes` 和 `renderMode: 'dom' | 'phaser' | 'hybrid'`，按模式只获得 `ctx.dom` 和/或 `ctx.phaser`，并支持显隐、暂停、恢复与捕获准备生命周期。API 1–3 包会给出“不受支持”诊断。

Runtime/Component 都是经过审核的可信扩展，外部导入只是分发方式；不能因为组件“非内置”就强制低权限执行。当前 Component API 4 的可移植上下文仍只标准化 DOM/Phaser 等已公开能力；课程若确实需要父页面、本地或桌面能力，应由对应宿主提供稳定接口或同宿主执行语义，并诚实处理网页导出等环境没有该能力的情况。V9 已提供远程资源与精确网络 origin 声明；在线轻量导出以及主 renderer 中的当前位置/整课预览都已按该合同接线。预览以精确 origin lease 放行实际 Published 依赖，并随 session、工程和 document generation 撤销；远程脚本仍不开放，长期 Provider Key 不写入课件。Three.js 等执行依赖仍应在构建阶段打进具体运行时/组件；远程模型/媒体以后作为正式资源类型处理，不得把 GLB 伪装成图片。

组件画布文字编辑必须显式加入协议：DOM 元素使用 `data-courseware-edit-key="content.title"`；Phaser/hybrid 组件在隔离 authoring Player 提供编辑宿主时调用 `ctx.editor?.registerTextRegion({ key, getBounds })`。`key` 必须同时对应 manifest 公开的文字字段或有效 `props.content` 字符串。普通试运行、整课预览、捕获和成品不提供该桥；未登记区域继续整体选择并通过属性栏编辑，不会根据画面文字反推 Props。

场景/全局自由运行时通过 `CoursewareRuntime.define()` 注册，源码内联在 Course Project V9 中。当前只接受 API 2，并按 `renderMode` 只暴露声明的 DOM/Phaser 能力。普通教师仍通过属性栏编辑 `content.values`；场景与全局运行时还可独立选择 Runtime Authoring V1，显式登记可在对应画布作用域原位修改的 text/asset 目标。该 authoring 版本独立于 Runtime API 2，不声明时仍显示真实视觉，只是不产生画布命中区。专业“开发”面板可校验并修改当前工程承载的 runtime source，但不会生成实现，也不会因修改 `renderMode` 自动转换 DOM/Phaser 代码。一次性互动无需为了接入编辑器而组件化；题面、反馈、完成页等稳定画面仍必须优先使用原生节点、命名状态或可编辑组件。

## 编辑与播放一致性

编辑状态和播放状态使用同一个 Player 视觉入口、同一份节点模型与场景状态物化规则；差异只在宿主权限和叠加的编辑交互层：

- 基础场景与当前状态覆盖先物化为同一 `SceneDocument` 视图，再由 authoring Player 渲染；透明 Phaser `ProxyNodeAdapter` 只同步原生节点几何和命中，不重复绘制视觉；旧 Text/Formula/Image/Video/Shape/TeacherController/ExternalComponent 编辑器视觉适配链已经删除；
- 场景缩略图使用 `thumbnailStateId`（缺省回退到 `initialStateId`），并绘制背景、原生元素和组件缩略图；
- 状态中新建的节点在基础中默认隐藏、只在当前状态显示；状态中删除表示当前状态隐藏，只有从基础删除才清理节点及全部覆盖；
- Player 进入场景时物化 `initialStateId`；状态切换原位更新同一节点/组件实例，不修改工程数据；
- `scene.go` 可选携带 `targetStateId`，Player 在创建目标场景节点、运行时和组件前原子物化目标状态；状态引用无效时使用目标场景 `initialStateId`；
- 预览、单 HTML 和网页包使用 `src/player/`；
- 中央“当前位置试运行”使用最新工程从当前场景/状态启动；若正在编辑基础场景，则以该场景 `initialStateId` 启动。顶部“整课预览”只接受活动 Course Project V9，在主 renderer 的全屏覆盖层中从第一场景初始状态开始；异常缺失活动 V9 时明确报告不可用，不生成 V8 课件或打开独立预览窗口；
- 文字、公式、图片、视频、图形或教师控制器增加新属性时，需要同时检查类型/Schema、默认创建、状态物化、透明几何代理、Player 渲染、素材引用、诊断和静态导出；
- 外部组件在编辑模式中可整体变换；V4 使用显式公开属性，并自动显示所有 `props.content` 字符串；
- 场景/全局运行时的 `content.values` 可由属性面板修改。Published V2 现已真实执行四个窄幅 Runtime slice：Slide scene-local API 2 DOM/Phaser/hybrid、session-global API 2 DOM/Phaser/hybrid、Slide scene-local API 3 DOM、Flow surface-local API 3 DOM；当前位置试运行、整课预览、离线/在线单 HTML 和网页包均复用 `createPublishedCourseSession`。每个 enabled global API 2 item 在一个会话中只创建一次，同一容器随 Slide/Flow/Spatial 导航迁入当前 global wrapper；restart 重建，普通换页保留实例与内部状态。`enabled: false`、global API 3 与未覆盖 shared/scene-local Flow/Spatial carrier 仍显示后备；注册、创建、生命周期或 Phaser 核心销毁失败只隔离该实例。API 2 的宿主动作、presentation 与节点解析仍是 partial context；Runtime 事件、静态捕获及宿主本地能力不得借此宣称 parity；
- Component API 4 的 Published V2 已证明切片为 Slide `scene.layerItems` 中 scene-local Phaser component：真实包/版本、props、组件素材与工程素材、emit、frame、order、命中及 generation 生命周期在当前位置试运行、整课预览、离线/在线单 HTML和网页包中保持互动；单实例失败只显示本地后备。该证据不覆盖 global/surface-shared、Flow/Spatial、hybrid 或 PDF/PPTX capture；
- 当前场景或全局运行时显式登记的 text/asset 目标可在对应编辑作用域原位修改；场景值由该场景全部命名状态共享，全局值由整课共享，均不生成 `presentation.nodeOverrides`；
- 场景的 `interactions` 与课程级 `globalInteractions` 将可编辑节点、组件事件和带作用域的运行时事件映射到元素入场/退场、状态、导航和音视频动作；连续 `with-previous` 步骤同组并行，下一个 `after-previous` 等待整组完成；
- 新工程的 `TeacherControllerNode` 位于全局画布。默认“场景目录”是 `scene.open-picker`，列出全部场景，选择后进入该场景初始状态；展开与选中不会写入场景状态。固定 `scene.go` 可为高级按钮配置目标场景与可选目标状态；
- 元素入场/退场只作用于宿主容器，不重建原生节点或组件，也不改变工程可见性或命名状态；`playbackInitialVisibility` 仅在互动 Player 中生效，捕获、缩略图和静态导出使用作者稳定画面；
- 统一全局层中的原生元素与组件都在普通翻页和重播时保留，只按场景更新可见性；
- 所有人工可见文字必须位于原生文本、运行时内容表或 V4 组件 `props.content`，不能只硬编码在源码中。

新增节点类型时，至少要同步修改联合类型与 discriminator 注册表、Schema、默认节点创建、Store 命令、属性面板、透明几何代理、Player 渲染、素材引用、诊断、导出和测试。当前产品不恢复 Project V1–V7 迁移链；如未来存在真实转换需求，应另行设计显式离线转换工具。

## 导出链路

选择单 HTML、网页包、PDF 或 PPTX 后，编辑器都会先为该目标生成当前已接线的 Export Preflight。报告统一包含 `error`、`warning`、`info` 三档以及可选的 `sceneId/stateId/nodeId/path` 定位信息；已检出的错误会阻断导出，静态格式差异与启发式问题作为人工复核线索。在线轻量单 HTML 会列出实际引用的远程素材，无法形成精确 CSP origin 的 wildcard 地址会在写盘前阻断；它不探测网络可达性。当前 V9 路径尚未完整接入 Runtime/Component 源码的网络声明一致性检查和全部富排版分析，因此“无错误”只表示现有检查未发现阻断项，不能证明 CORS、远端服务或静态捕获均可用。报告可保存为带 `reportVersion`、工程/格式信息和汇总结果的 JSON；它面向一次具体导出，不能代替真实浏览器外部请求检查、长期结构检查或异常诊断日志。

| 格式 | 实现方式 | 交互 | 后续编辑 |
| --- | --- | --- | --- |
| 单 HTML | 离线便携模式内联全部发布素材；在线轻量模式保留实际引用且声明了 `remote.url` 的工程素材地址，其余素材仍内联 | 保留 | 不能从成品恢复工程；修改原 `.h5lesson` |
| 网页包 | ZIP 内分离 `index.html`、唯一 `course-data.js` 发布数据、Player 和运行素材 | 保留 | 不能从成品恢复工程；修改原 `.h5lesson` |
| PDF | 使用实际 Player Runtime 捕获 Canvas、DOM、全局层与场景层，再由 Electron 打印 | 不保留 | 固定版式 |
| PPTX | 原生节点逐对象生成；公式、组件和运行时按透明快照/`staticFallback` 静态化 | 不保留 | 原生对象可修改；公式等静态化内容只能整体调整 |

单 HTML 和网页包保留声明式交互、声音、视频播放、事件驱动入场/退场及场景目录，但不主动包含完整 Course Project V9、历史、编辑器元数据、组件 manifest 或独立原始 `runtime.js`；网页包只保存一份 `course-data.js` 发布数据，不再并存 `course.json` 或离线回退副本。浏览器仍需取得并可恢复执行逻辑，因此这里不承诺源码保密、不可逆向或 DRM。格式边界见 [PublishedLesson V1](docs/PUBLISHED_LESSON_V1.md)。PDF/PPTX 是静态结果：不播放声音，不执行交互或元素动画，也不应用 `playbackInitialVisibility: 'hidden'`；视频导出为封面/占位画面，画布内教师控制器默认不进入静态导出。

静态捕获会对每个实例先排空此前通过 `capture.waitUntil()` 登记的资源任务，再调用 Runtime API 2 / Component API 4 的 `prepareCapture()` 生成最终帧；hook 内同步登记的有限任务也会被等待，并在该实例完成后立即复制其 Canvas/WebGL 帧。最终按“运行时 DOM underlay → Phaser Canvas → V4 组件 DOM/WebGL → 运行时 DOM overlay”合成。WebGL/Three.js 作者必须在 `prepareCapture()` 主动渲染确定帧，不能依赖循环 RAF 恰好保留缓冲；hook 内登记的异步任务必须在完成最终绘制后才 resolve。宿主的即时副本可兼容 `preserveDrawingBuffer: false`。

当前捕获合同只要求一个可重复的确定帧。动态过程多帧捕获仍是研究项；在真实课例证明需要且能冻结时间、帧数与终端语义之前，不增加第二套时间线或捕获协议，也不把循环动画误当成可等待任务。

静态导出按最小失败单元隔离：Player 已成功启动后，PDF 某一场景捕获失败时只让该页改用带诊断信息的静态后备，其余页面继续使用真实 Player 捕获；PPTX 组件按实例依次创建独立捕获 Player，单个组件失败只回退该实例，运行时快照失败只回退对应场景/全局运行时条目及图层。已经成功取得的页面、组件和运行时快照不会因后续条目失败而被整批丢弃。只有捕获 Player 本身无法初始化等批次级故障，才会对该批次执行统一后备。

PPTX 映射规则：

- 文字：未使用可见着重号且不属于左起竖排的文字作为 PowerPoint 原生文本框，文字可直接修改；包含可见着重号或使用左起竖排的文本节点按稳定画面转为独立透明 PNG，以保留字符位置和列序；
- 公式：由共享公式渲染器生成独立透明 PNG，并把 `formulaId` 与无障碍文本写入对象元数据；PowerPoint 中可整体移动、缩放或删除，但不能编辑 AST、分子分母或上下标；工程检查会明确报告该静态化差异；
- 基础图形：PowerPoint 原生形状；
- 图片：独立高分辨率 PNG 对象，裁剪、翻转、圆角和羽化会烘焙进图片；
- 视频：静态封面或带文件名的播放占位，不保留视频播放和声音；
- 画布内教师控制器：默认省略；显式允许静态导出时作为静态控制条保留，不具备按钮行为；
- 互动组件：独立透明静态快照，整个组件可移动、复制和删除；
- 全局原生元素：按场景可见性生成对应的可编辑文字、图片和形状对象；
- 全局组件：按场景可见性生成静态快照；
- 场景/全局运行时：优先在隐藏 Player 中捕获实际 underlay/overlay 透明快照；只有实际画面不可用时才使用 `staticFallback`。`runtime-layer` 保留原生对象，`full-scene` 整页扁平化；
- 场景背景：幻灯片背景；
- 隐藏节点：不导出；
- 图层顺序：保持 `scene.nodes` 顺序。

`elbow-arrow` 当前映射为 PowerPoint 原生 `bentArrow`；互动组件在 PPTX 内不保留内部交互。

相关代码位于 `src/renderer/export/`。修改 PPTX 时必须解包检查幻灯片 XML，并至少验证原生 `<p:sp>`、图片 `<p:pic>` 和文字 `<a:t>`，防止意外退化为整页图片。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| 双击 `启动课件编辑器.cmd` | 自动同步课件 Skill、补齐依赖、构建并打开当前源码版编辑器，不生成安装包 |
| `npm run install:courseware-skills` | 将仓库权威课件 Skill 幂等同步到当前用户的 `.agents/skills` |
| `npm start` | 自动同步课件 Skill，构建生产模式 Player、Renderer、Electron 后启动源码版应用 |
| `npm run dev` | 启动开发版 Electron |
| `npm run typecheck` | 检查 Renderer、Player、Main、Preload，以及独立配置覆盖的 Playwright/Electron E2E 类型；命令本身不启动 Electron |
| `npm test` | 运行 Vitest 单元与集成测试 |
| `npm run test:e2e` | 构建依赖并以始终隐藏的 BrowserWindow 运行全部 Playwright Electron 测试 |
| `npm run build:player` | 构建预览、单 HTML 和网页包共用的 Player IIFE |
| `npm run build:renderer` | 构建 React 编辑器 |
| `npm run build:electron` | 编译 Main 与 Preload |
| `npm run build:desktop` | 只构建可由根目录入口直接启动的三个生产目录 |
| `npm run generate:ai-capabilities` | 从权威 Schema、协议常量、诊断注册表和受校验组件目录生成分层 AI 能力契约 |
| `npm run check:ai-capabilities` | 只读检查能力内容、来源证据和 16 KiB 索引门禁；内容或证据任一过期都会失败，不自动写文件 |
| `npm run --silent validate:project -- <file.h5lesson>` | 无界面读取 Course Project V9，向 stdout 输出 [Validation Report V1](docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md)；Schema-invalid 保持 unreadable/exit 2、六个语义分区为 null。Schema 合法后追加只读的 V9-native Runtime / Interaction / Component / Controller-Media health，finding 带只含稳定 V9 ID 的 target。精确 code 可达性见机器 ledger；0 只表示现有检查无 error，不代表网络 declaration parity、像素或真实互动已证明 |
| `npm run generate:contracts` | 从 Zod 生成 `artifacts/contracts/` |
| `npm run check:contracts` | 检查合同快照与源码一致 |
| `npm run build` | 先检查 AI 能力契约，再执行类型检查、测试并构建全部生产产物 |
| `npm run build:examples` | 重新生成示例工程和示例组件包 |
| `npm run build:lesson-demo` | 生成三页光合作用最小回归课例 |
| `npm run build:render-benchmark` | 生成原生 / Phaser / DOM / Three.js / V4 Phaser 组件五路径离线基准 |
| `npm run build:icons` | 从源图标重新生成应用图标 |
| `npm run verify` | 依次执行能力检查、三配置类型检查、Vitest、隐藏 E2E 和桌面构建，不重复调用 `build` |
| `npm run verify:w3-portability` | 构建 Player，并在 Windows 系统临时隔离树中验证目录版/Portable 复制启动、工程断源重开重存及单 HTML/网页包离线移动；不替代另一台干净 Windows 的人工验收 |

机器发现入口是 [`artifacts/ai-capabilities/index.json`](artifacts/ai-capabilities/index.json)。它提供当前工程协议、Runtime API 2、Component API 4、互动、诊断和导出面的低成本索引；`build-courseware-project` 先核对该索引及生成证据，需要细节时再读取 `schemas/`、`diagnostics.json`、`limits.json` 或组件快照。索引本身不是编辑器内 AI、自动课件生成器或工作流。能力索引 `protocols.project` 为 9。外部组件 catalog 的审核摘要缺失、目录缺失或包完整性不匹配时，核心契约仍可生成，但组件目录能力必须明确标记为 `unavailable`/降级；这不定义已审核外部导入组件的执行权限。当前快照中的四个包仍全部是 `experimental`，许可和维护人阻断没有被能力索引解除。

外部 Builder 的最低闭环是“读取已确认教学文件与 Capability → 使用仓库真实 TypeScript API 生成 Course Project V9 → 校验 → 按稳定绑定局部修正 → 重开、Player、四格式与视觉证据 → 人工验收”。`validate:project` 命令本身不启动 Electron、不执行真实导出、不改写工程；当前 `projectHealth` 已直接覆盖 V9 的 Runtime、Interaction、Component 与 Controller-Media 四域，但不扫描可执行源码，也不判断 URL/Secret/CORS 或 network declaration parity。Node 下文字/公式布局使用公开标注的确定性近似测量，最终像素裁切、互动与离线外部请求必须以真实编辑器、Player 或导出复核。自动闭环最多给出 `engineering candidate`，不得用 Headless 通过代替这些证据或人类验收。

E2E 默认向 Electron 传入 `COURSEWARE_E2E_BACKGROUND=1`：主窗口保持 `BrowserWindow.isVisible() === false`，不会调用 `show()`、出现在任务栏或抢占焦点；透明、离屏坐标与关闭后台渲染节流只是额外防护和稳定性设置。生产构建/制品验证中的自动启动也显式使用同一环境变量。正常 `npm start`、开发启动和双击入口不读取该测试默认值，仍会照常显示窗口。常规验证不得使用可视 E2E；只有开发者明确需要观察单个故障时才手工运行 `npm run test:e2e:visible`。

架构与回归基准见 [`examples/render-host-benchmark/`](examples/render-host-benchmark/README.md)。当前基准覆盖统一 Player 的组件宿主和捕获路径；旧 API 兼容夹具不再进入当前回归。

当前 Playwright 基准在完成五条路径的真实点击、拖拽、滚轮、排序和确定帧捕获后，执行 25 轮压力循环：每轮依次切换四个定制场景并重播末页，合计 **100 次切页 + 25 次重播**。门禁同时检查运行时/组件挂载点、DOM Canvas、WebGL/Three 捕获副本、活动 RAF、控制台异常和外部网络请求，防止只验证“能打开”而遗漏宿主泄漏。

## 当前源码启动与历史版本边界

根目录 `启动课件编辑器.cmd` 仍是面向当前源码工作区的标准双击入口；它生成被 `.gitignore` 排除的 `dist-player/`、`dist-renderer/` 与 `dist-electron/`，然后直接使用项目锁定的 Electron 运行。拉取新提交后再次双击即可同步和重建，不需要复用旧 `release/`。

打包制品当前不作为交付目标：最近一次工程收口按 Owner 决定跳过打包与性能测量，结论上限为 `engineering candidate`。`release/`、源码 ZIP、校验截图和其他可重建制品不随源码提交；正式分发时必须基于明确的当前工作树快照生成、补齐打包/性能/签名证据，并通过独立制品渠道交付。历史 1.6.0/1.7.0 二进制、哈希和构建说明只由 Git 历史与标签 `internal-prototype-1.7.0` 保存，不能作为当前版本启动入口或验证证据。

## 测试与提交要求

小改动至少运行：

```powershell
npm run typecheck
npm test
```

涉及画布、工程读写、组件、导出或 Electron IPC 时运行：

```powershell
npm run verify
```

准备当前源码交付时，再双击根目录入口做一次真实启动冒烟。当前流程不运行以下历史打包命令：

```powershell
.\启动课件编辑器.cmd
```

交付基线以当前 `npm test`、`npm run test:e2e`、生产构建和根目录入口冒烟的实际结果为准。新增功能应补充相应测试，不应通过删除断言来维持通过状态。

## 安全边界

- 主窗口开启 `contextIsolation`、`sandbox` 和 `webSecurity`；
- 禁用 `nodeIntegration`、`<webview>`、生产版 DevTools、任意导航和新窗口；
- Renderer 只能调用 Preload 暴露的冻结白名单 API；
- 文件位置由系统对话框或已批准的最近工程路径确定；
- IPC 参数、扩展名、签名、文件大小和 ZIP 路径均需校验；
- 导出的离线 HTML 使用 CSP 禁止网络连接；
- 中央统一画布的 authoring / playback Player 通过仅允许同源派生 Blob 子框架的受限导航策略装载不含 `allow-same-origin` 的 sandbox iframe，并把消息绑定到当前会话；主框架继续拒绝 Blob、外部页面和任意导航。该机制服务于视觉合成、生命周期和旧实例竞态，不代表可以执行不可信代码，也不是可信扩展必须永久继承的权限边界；真实 consumer 需要宿主能力时，应另行提供稳定宿主接口或同宿主执行语义；
- 中央统一画布用父窗口临时 Blob URL 承载 Player 文档；工程与组件素材以可转移二进制缓冲区送入 sandbox，再由 iframe 在自身不透明源内创建并回收 Blob URL。这样既不授予 `allow-same-origin`，也避免大媒体 Base64 膨胀和父窗口 Blob URL 被沙箱拒绝；
- `.h5lesson` 的场景/全局运行时及 `.h5component` 都含可执行 JavaScript，只能打开可信来源。

修改窗口、协议、IPC、文件系统或组件 runtime 时，不要为了开发方便关闭现有安全选项。

## 已知边界

- 当前根目录双击入口只支持 Windows，源码命令行仍以 Node.js/npm 为前提；
- Blueprint、AI 局部 patch 及其他编辑器内 AI 能力不属于 1.x；统一延后到 2.0 以后。当前 authoring 协议只提供版本化、可校验的人工编辑边界，不会自动调用模型或修改工程；
- 不包含通用时间轴、关键帧/路径系统、节点连线式状态机、题库/成绩、多用户协作、云同步、模板市场和移动端编辑；编辑器提供事件驱动的入场/退场、顺序/并行步骤、表单式声明交互映射和稳定场景状态，复杂连续效果仍由可信运行时或组件实现；
- PDF 为静态版式；
- PPTX 为对象级素材导出，互动组件只保留其在 `capture` 模式经 `prepareCapture()` 生成的确定性静态快照；失败时使用带名称的诊断占位；
- 单 HTML 已明确提供离线便携与在线轻量两种选择：前者内嵌发布素材，后者保留实际引用的声明式远程素材 URL，并按工程 `connectOrigins` 生成精确 CSP；网页包仍使用相对本地资源；当前位置与整课预览也只按实际 Published 远程素材和声明 origin 建可撤销的 main-session lease，CORS/TLS 仍由浏览器裁决；
- 当前源码入口直接运行项目锁定的 Electron，不生成已签名安装包；请只从可信仓库获取源码和依赖锁文件。

## 源码 ZIP 说明

用于合作开发的源码 ZIP 应包含：

- `src/`、`tests/`、`scripts/`、`.agents/skills/`；
- `docs/`、`examples/`、`resources/`；
- `package.json`、`package-lock.json`；
- TypeScript、Vite、Vitest、Playwright、Electron 配置与根目录 `启动课件编辑器.cmd`；
- 本 README、`AGENTS.md` 和 `.gitignore`。

源码 ZIP 不包含：

- `node_modules/`；
- `dist-electron/`、`dist-player/`、`dist-renderer/`；
- `release/`；
- `artifacts/` 中除版本化 `ai-capabilities/` 之外的检查点/测试制品，以及 `output/`、`test-results/`、`tmp/`、日志和本机工具缓存；
- `.git/`。

合作伙伴解压后双击 `启动课件编辑器.cmd`，即可同步当前项目的课件 Skill、按锁文件恢复依赖、构建并打开当前源码。不要把 `node_modules/`、生产构建目录或历史 `release/` 产物混入源码包。

## 许可

`package.json` 当前标记为 `UNLICENSED`。源码包仅供项目所有者授权的内部合作与二次开发使用；对外发布、销售或再许可前，应由项目所有者补充正式许可证、版权归属和第三方依赖合规说明。
