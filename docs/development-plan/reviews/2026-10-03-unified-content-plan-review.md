# 统一内容架构方案与实施快照评审（产品导向复核版）

> 日期：2026-10-03　性质：只读评审意见（非 Owner 决定，非任务卡）　读者：执行该方案的 AI 会话与后续评审 AI

| 项 | 内容 |
|---|---|
| 评审对象 | [总方案](../unified-content-architecture/README.md)、[内容与设计](../unified-content-architecture/CONTENT_AND_DESIGN.md)、[实施方案](../unified-content-architecture/REFACTOR_PLAN.md)、[事实依据](../unified-content-architecture/EVIDENCE.md)、[实施记录](../unified-content-architecture/EXECUTION_LOG.md)，以及同日工作树中正在落地的实现 |
| 快照 | HEAD `64d97fa2`；工作树 438 项未提交改动（14:10）；composition 编辑相关源码最后修改约 13:45（`mountWebComposition.ts`）；EXECUTION_LOG 为 13:57 版 |
| 方式 | 只读。未运行测试、构建、e2e，未调用模型，未改动任何既有文件。"已通过"类陈述均引用 EXECUTION_LOG 自述，未复跑 |
| 前提来源 | Owner 在本次评审讨论中的口述（§1）。尚未写入 AGENTS.md 或正式合同 |

## 0. 阅读约定

- 证据标记：**[F]** 事实（读到源码/文档，附位置）；**[I]** 推断；**[O]** 意见；**[U]** 未核实（含外部网页来源、子评审员转述、未复跑的自述）。
- 位置写作 `路径:行号`，为快照时点；相关文件仍在被修改，行动前重读。
- 本文不新增校验门，不要求全矩阵验证。每项建议在 §6 给出 1–3 条最小直接检查；已有且未受影响的证据继续有效。
- 本文不授权修改 `AGENTS.md`（其修改需 Owner 确认）。
- 优先级：P1 = 直接影响"能否用融合方案完成日常编辑"；P2 = 中期；P3 = 低成本、越早越便宜。

## 1. Owner 前提（评审讨论中口述，2026-10-03）

1. 内部生产工具，尚无用户。现阶段适合频繁大改；仍需要能退回的存档点（§4.9）。
2. 教育是首发场景，产品目标是综合办公产品，长期可能扩成通用网页编辑器。此前"整页当程序、只能改字换图"的结构化编辑上限偏低；融合方案方向被认可。
3. 评审不以 2.0 及更早阶段的历史决定为准绳（2.0 阶段已过），按当前目标判断。但"当前已采用的合同级决定"需有一处登记（§7）。
4. 原生优先。第三方内容仅受限支持：不解析其内嵌引擎；能可靠定位的静态结构、样式、数据可改，程序部分原样运行并提供源码入口。
5. 融合 = 响应式排版 + 自由定位。人工编辑时两种逻辑都要成立，响应式元素可转为自由定位。
6. 页面含局部互动时，静态部分仍可编辑，互动部分用原生组件/Runtime 块承载；仅整页都是互动时整页用 Runtime。Runtime 与节点如何组织留待后续设计（§4.2）。
7. 每页可有不同尺寸，默认教室屏幕尺寸；其他尺寸须有明确需求，例如 Flow 流式排版用于教室长文阅读（§5）。

待 Owner 确认的两条假设（本文据此展开，确认前不当作决定）：

- **A1**：此处"响应式"指场景画布内的内容重排，以及场景尺寸变化后的重排；不含面向手机/平板的多设备断点体系（由前提 7 推出）。
- **A2**：教室屏幕默认比例为 16:9（当前默认 `DEFAULT_SLIDE_CANVAS` = 1280×720，`src/shared/slideCanvas.ts:10`）。

## 2. 结论摘要

1. **方向认可。** 融合路线（浏览器排版 + 结构化 Web 内容 + 专业节点 + 程序区域）与阶段一（软件接手创建/导入/保存、真实任务浏览器交接）符合 §1，应继续。
2. **当前主要缺口不在载体，而在"人手改"的完整度（P1）。** 元素级手势刚起步：仅同父级兄弟重排、自由定位元素的移动/缩放，且只在弹窗编辑器内；响应式↔自由定位没有互转命令；拖拽一律写 px，与设计文档"保持原单位"不一致；手改只写行内样式，推断会固定数值并覆盖作者规则（§4.1）。
3. **局部互动缺"产生路径"（P1）。** 承载机制已存在并有测试；导入器不产出 runtime 节点，创作 Skill 也未给出声明局部互动块的方式。方案示例切片"问题卡片＋两栏＋图表＋局部互动"在该契约出现前不能算已落地（§4.2）。
4. **新 kind 与按页尺寸的直接 consumer 仍有遗漏（P1）：** 引用清理、健康检查、可视预检、插图空间计算（§4.3）。
5. **composition"必须静态"的边界只由导入器强制（P2）：** 契约层与编辑入口不拦截，Player 只拦可执行 `<script>`（§4.4）。
6. **页面尺寸：** 按页覆盖已实现；Owner 决定默认教室屏幕、其他尺寸须有明确需求、长文走 Flow。需把"默认"落实到创作/模板，并逐个判定读取课程默认画布的位置（§5）。
7. **中期项（P2）：** 统一两套 Web 编辑栈与样式规则层、PPTX 可编辑子集、整块重写时的身份对应、首稿质量杠杆（§4.5–§4.7）。
8. **治理（轻量）：** 437 项改动混有多个倡议且无提交；方案要求"同域一起切换、不双写"，回滚只能靠提交边界。建议按轨道存档（需 Owner 同意），并登记当前合同级决定（§4.9、§7）。

## 3. 已认可，应保持

- **融合方向与单一来源原则**：每个内容区域一个正式来源，DOM/测量框/缩略图为派生物（`CONTENT_AND_DESIGN.md` §2.1、§9）；引用收集走同一访问器，校验/发布/资产不各猜一遍（`src/shared/composition/references.ts`）。[F]
- **真实 viewport**：每个 composition 图层用一个 iframe 作 layout viewport，媒体查询/`vw` 绑定目标规格（`src/player/composition/mountWebComposition.ts`，iframe 创建约 :88；`CONTENT_AND_DESIGN.md` §4.4 的论证正确）。[F]
- **局部互动的承载机制**：数据模型允许 `runtime`/`document`/`native` 节点嵌入 Web 结构（`src/shared/composition/schema.ts`）；Player 在重排、尺寸变化、内容更新中保持实例（`tests/integration/webCompositionRuntime.test.ts:97,133`；`unifiedCompositionDrag.test.ts` 末段断言 `creates=1 / destroys=0`、按钮状态保持）；嵌套 Runtime 经受控构建准入（`nestedCompositionAdmission.test.ts:26,94`）。[F，测试通过状态引用 EXECUTION_LOG 自述]
- **专业内容面板**：文档/文字/图表/表格以草稿编辑，"应用到作品"一次事务提交（`src/renderer/composition/CompositionProfessionalEditor.tsx`）。[F]
- **手势设计**：拖动中只做叠加预览，释放时提交一条编辑 = 一步撤销；缩放视口下坐标已换算；Esc 取消；CSS 变换元素禁用并说明原因（`WebCompositionAuthoringContent.tsx` 的 `startDrag`；`compositionDrag.ts:28`）。[F]
- **合同产物已同步**：`artifacts/contracts/{course-project-v9,published-course-v2,component-manifest}.schema.json` 于 13:27 已含 composition 与 scene canvas（12:40 时仍为 0，该问题已消除）。[F]
- **软件接手创建/导入/保存**：`src/main/workbench/htmlImport/CreateCourseFromHtml.ts` 只编排既有子调用，不拥有 writer；`unifiedCreateFromHtmlEngine.test.ts` 有 1 项真实 Engine/Host 链（admission 为 fixture，EXECUTION_LOG 自述）。[F/U]

## 4. 发现与建议

### 4.1 [P1] 人手改：响应式与自由定位互转、元素级手势

**事实**

| 能力 | 现状 | 位置 |
|---|---|---|
| 排版内重排（同一父级的兄弟之间） | 有：释放时一条 `move` | `src/renderer/composition/compositionDrag.ts:51-71` |
| 自由定位元素移动/缩放 | 有：写 `left/top`、`width/height`（px）；专业内容节点（document/native）本身不可拖，提示拖其外层布局容器 | `compositionDrag.ts:33,74-87` |
| 一次手势 = 一步撤销、Esc 取消、缩放视口换算 | 有（真实 Chromium 用例） | `tests/integration/unifiedCompositionDrag.test.ts:117` |
| 自动布局项改尺寸（如栏宽） | 无：提示"尺寸由布局属性决定" | `WebCompositionAuthoringContent.tsx:54` |
| 跨容器拖入 | 手势无（只在同父兄弟间选位）；`move` 命令本身支持换父级 | `compositionDrag.ts:51-71`；`src/core/tools/compositionContent.ts:55-75` |
| CSS 变换元素、竖排书写模式 | 禁用并说明 | `compositionDrag.ts:28-29` |
| 画布内直接手势（不开弹窗） | 无：手柄仅在传入 `onEdit` 时渲染，只有 `CompositionEditorDialog` 传入 | `WebCompositionAuthoringContent.tsx:28,199-204`；`CompositionEditorDialog.tsx:52` |

- 进入弹窗的入口：Slide"编辑组合内容"按钮（`SlideWorkspaceConnector.tsx:450-454`），Flow/Spatial 为按钮或双击（`FlowWorkspaceConnector.tsx:154-157`、`SpatialWorkspaceConnector.tsx:184-187`、`FlowOverlayAuthoringLayer.tsx:713,811`）。[F]
- **互转无专用命令**：属性面板"定位"下拉只写 `position`（`CompositionContentEditor.tsx:110`），不采集当前显示几何，也不清理另一模式遗留的 `left/top/right/bottom/width/height`。[F]
- **单位**：`compositionFreeDrag` 一律写 px（`compositionDrag.ts:84-85`）；几何取自 computed style（`mountWebComposition.ts` 的 `observeLayout`），`%` 声明被解析为 px。`CONTENT_AND_DESIGN.md:168` 写的是"按实际单位和作用域修改该声明，不静默改为像素坐标"。文档与实现不一致。[F]
- **样式写入只有行内 style**（`compositionContent.ts:79-87`、`src/shared/composition/inlineStyle.ts`）；面板可编辑属性固定为 width/height/gap/padding/font-size/color/background-color/border-radius + display/position/left/top（`CompositionContentEditor.tsx:85-88,105-113`）。[F] 行内样式优先于样式表，手改会把该属性固定在所有宽度下，覆盖作者的 class/`@media` 规则。[I]
- **内部元素未接入元素快捷条/元素 AI 卡**：`src/renderer/workbench/**`、`src/player/lightEdit/**` 对 composition 无命中；AI 通路是 `content.targets` / `content.update`（`src/core/tools/DocumentToolGateway.ts:862-914`）。[F，grep 范围限于上述目录]

**建议（保持最小，不改 schema）**

a. 在现有 `style` 编辑之上增加两条命令，各为一次事务、可撤销：
   - `toFree`（响应式→自由）：在编辑视口量取元素当前显示几何，写入 `position:absolute` 与 `left/top/width/height`，使其显示边界与转换前一致（容差 ≤1px）；保证存在定位祖先（缺失时在同一事务给直接父级补 `position:relative`）；兄弟元素补位属预期。
   - `toFlow`（自由→响应式）：清除 `position/left/top/right/bottom`，元素回到 DOM 顺序位置，`width/height` 保留。
   两个方向不对称：前者可保持外观，后者必然改变位置；界面文案如实表达。
b. 单位策略写入 `CONTENT_AND_DESIGN.md` §4.1/§4.3：教室默认的固定页面以 px 为准；若元素现有声明为 `%`，拖拽保持 `%`（用容器尺寸换算）。暂不实现保持 `%` 时，文档改为"拖拽写 px"，避免两者分歧。
c. 补齐手势（按需排序）：自动布局项改尺寸（flex 项写 `flex-basis`/`width`，grid 栏分隔写容器 track）；跨容器拖入（复用 `move`）；画布内直接手势。后者需 Owner 决定弹窗是过渡形态还是终态（§7-5）。
d. 手改与规则的关系见 §4.5；至少在面板标明"此值写在元素上，将覆盖已有样式规则"。

### 4.2 [P1] 局部互动：产生路径与契约

**事实**

- `parseWebComposition` 遇到可执行 `<script>`、任一 `on*` 属性、`javascript:` URL 或含脚本的 `srcdoc`，整页返回 `kind:'program'`（`src/main/workbench/htmlImport/parseWebComposition.ts:36-55,269-274`）；全文件没有构造 `runtime` 节点的代码，`runtime` 仅出现在 `reconcileIds` 的签名分支（约 :164）。[F]
- 调用方在页面级二选一：composition 图层或整页 runtime 图层（`prepareHtmlCourseCandidate.ts:99-126`，约 :117 与 :123-126）。[F]
- 创作 Skill 示例只描述 `guoling-native` / `guoling-chart` / `guoling-document` 三种包装（`.agents/skills/orchestrate-courseware/references/web-composition-examples.md`；`parseWebComposition.ts:131-141`）；对 `.agents/skills/orchestrate-courseware`、`.agents/skills/build-courseware-project` 搜索"局部互动 / 互动区域 / guoling-runtime"无声明方式。[F，快照时点]
- 承载与编辑侧已具备：见 §3（实例保持、嵌套 Runtime 受控构建准入）；`CompositionContentEditor` 对 runtime 节点提示"互动区域保留其程序与状态，可调整顺序"。[F]

**推断** [I]：目前能由软件自动产出的 composition 是"整页无脚本"的页面；"静态壳 + 局部互动块"只能由手工构造或测试夹具得到。

**建议**

先定"局部互动块"的创作与落地契约，再宣布切片完成。契约应满足：

- R1 AI 写普通 HTML/JS，不登记、不编号（`AGENTS.md` 模型/软件分工原则）；
- R2 软件封装为 runtime 节点，资源、准入、静态后备走与嵌套 Runtime 相同的受控构建通道；
- R3 块的状态在周围页面重排、块自身尺寸变化时保持；编辑静态兄弟节点不重建块实例（宿主侧已有测试）；
- R4 尺寸约定：容器给定宽度；块要么上报自然高度，要么使用固定高度，不靠反复截图测量（与 `CONTENT_AND_DESIGN.md` §4.2 一致）；
- R5 块内编辑：文字/图片走既有 Runtime 轻编辑，深编辑走源码入口，AI 续改走既有动态内容编辑规划器；
- R6 整页都是互动的页面保持为单个 Runtime，不强拆。

具体包装形式（如一个声明元素）留待设计，但须在 Skill 示例中给出。第三方整页含脚本：保持整页 Runtime + 文字/图片轻编辑 + 源码入口（受限支持，符合 §1-4）；**不做自动切岛**。

可选、非门控的信息：抽样既有 AI 首稿，统计互动分布（无互动 / 整页互动 / 局部互动），用于调整 Skill 对"互动放进独立块"的引导。

### 4.3 [P1] 直接 consumer 覆盖：新 kind 与按页尺寸

按"直接 consumer 同批切换"原则，以下位置仍读取旧口径。清单来自 grep，不是穷尽。

| 位置 | 现状 | 建议 |
|---|---|---|
| `src/core/tools/courseReferenceCleanup.ts:278-287` | 删除图层时，只清理顶层 `runtime` 的 `nodeBindings`；composition 内嵌 runtime 的 `nodeBindings` 不清理。`references.ts` 会把它们作为 `layer-item` 引用发出，V9 `checkLayer` 不校验该类引用（`course-project-v9/schema.ts` diff）；顶层 runtime 的 `nodeBindings` 在 schema 里同样不校验（`schema.ts:231` 仅字段定义），其保护完全来自删除时清理 [F] | 删除被绑定图层后，内嵌 runtime 的绑定可能悬空 [I]：与顶层保持一致，在同一清理函数里遍历 composition 内嵌 runtime。不新增 schema 校验 |
| `src/shared/courseProjectHealth/controllerMedia.ts:365-367` | `hasExecutableRuntimeAssetConsumer` 只认顶层 `item.kind==='runtime'`，不含嵌套 Runtime [F] | 影响取决于该健康规则的意图 [U]，确认后按需纳入 |
| `src/renderer/export/slideVisualPreflight.ts:587,606` | 出界/密度判断用 `surface.canvas`（课程默认），`slideLocation()` 已返回 scene [F] | 场景有自己的 canvas 时改用 `effectiveSceneCanvas(surface, scene)` |
| `src/renderer/authoring/generation/expandGenerationSemanticCandidate.ts:95` | 插图剩余空间用 `surface.canvas.height` [F] | 同上，按场景有效尺寸 |
| `SlidePublishedAdapter.ts:934`、`buildPublishedCourse.ts:689`、`applyRecipe.ts:47`、`coursewareBuilderV2.ts:110` | 同样读 `surface.canvas`，看起来是有意读取课程默认（共享层参考画布 / 发布 surface 默认 / 新场景模板） [I] | 逐个确认语义，不批量替换 |

核对方法：grep `item.kind === 'runtime'`、`surface.canvas`、`visitAllLayerItems` 逐处判定。导出侧对 composition 已有处理（`buildCoursePptx.ts:451,685-697,716`、`flowDocxProjection.ts:376,630`），语义见 §4.6。

### 4.4 [P2] composition 的静态边界只由导入器强制

**事实**

- 元素节点 `tagName: z.string().min(1)`、`attributes: z.record(z.string(), z.string())`；唯一的 `superRefine` 只校验 id 重复（`src/shared/composition/schema.ts:10,17-25`）；V9 与 Published 共用该工厂。[F]
- `applyCompositionContentEdit` 的 `attributes`/`style` 分支不做惰性校验（`compositionContent.ts:79-87`）；`replace` 分支用同一 schema，亦不拦。[F]
- 完整判定只在导入侧（`parseWebComposition.ts:36-55`）。渲染侧只对可执行 `<script>` 抛错（`mountWebComposition.ts` 约 :275），且放过 `importmap`（导入侧把 `importmap` 视为程序，`parseWebComposition.ts:41-45`，两侧规则不一致）；iframe 为同源 `srcdoc`，未设 `sandbox`（约 :362）。[F]

**影响** [I]：受信团队环境下不是安全事故，但 §1-6 的模型（静态壳 + 程序放 Runtime 块）依赖这条边界；经 AI 编辑通路写入 `onclick`/`srcdoc` 后，页面行为与"程序区域"边界不一致。

**建议**：二选一写入合同。(a) **推荐**：composition 元素 inert-only——V9 与 Published 同批在 `superRefine` 拒绝 `on*` 属性、`javascript:` URL、可执行 `script`、`iframe[srcdoc]`，成本小；(b) 明确允许行内程序并说明与 Runtime 的边界（与 §1-6 不一致，不推荐）。

### 4.5 [P2] 统一 Web 编辑栈与样式规则层

**事实**

- 两套命令重叠：composition 栈（`src/shared/composition/edit.ts`：text/attributes/style/move/replace/remove/document/native，按 `nodeId`）与 HTML 文件源码栈（`src/shared/html/sourceEditCommands.ts`：text/attributes/style/stylesheet/move/remove/data，按源码区间地址）。`src/main/workbench/htmlPreview/htmlSourceEdits.ts:4` 反向引用 `shared/composition/inlineStyle`。[F]
- 两者互有长短，**不是超集关系**：源码栈对脚本页（执行型 script 标 `sourceOnly`）、`<style>` 规则的 at-rule 上下文、JSON 数据岛有处理（`src/shared/html/htmlSourceStructure.ts:54-55,86-97`）；composition 栈有 `replace`、文档/原生节点与稳定 id。[F]
- CSS 解析为两处手写字符扫描（`inlineStyle.ts` 的声明切分；`htmlSourceStructure.ts` 的规则扫描）。嵌套 CSS、`@layer`/`@container`、`@font-face url()`、重复 `!important` 是边角风险。[I]

**建议**：Owner 的长期目标含通用网页编辑器，两套栈各自增长的成本随功能增加。在新增样式/结构编辑能力之前，先定一套命令词汇与一个样式引擎（放 `shared/html/`），composition 与 HTML 文件各自只保留地址解析（nodeId / 源码区间）。换库（如 PostCSS）由夹具失败触发，不预先引入；不整套引入 GrapesJS 一类可视化编辑框架（会形成第二份正式模型，与唯一 writer 冲突）。

**样式规则层**：目标选择（仅此元素 / 此类）与来源显示。按 A1 暂不做多设备断点，优先"来源显示 + 覆盖提示"，再做"改此类"。

### 4.6 [P2] 导出承诺与实现的差距

- `CONTENT_AND_DESIGN.md` §6 的目标写作"专业文字/图片/表格/图表映射为目标对象"；现实现为：composition 在 PPTX 中按播放器图面整图呈现，并在报告中注明"结构与专业数据在工程中继续可编辑"（`buildCoursePptx.ts:451`）。PPTX 以首个 Slide 场景尺寸为唯一输出规格，其余场景等比居中并报告（`buildCoursePptx.ts:892-895,579-580`）。[F]
- 综合办公是长期目标，PPTX 可编辑性是核心交付物，但这是中期项。**建议**：文案先与现状对齐（默认忠实图片）；之后做"可编辑子集"——按层开启，仅映射文本框/纯色矩形/图片/表格，其余逐元素回退并写入导出报告；不拒绝整份可用文档。业界做法多为带回退的子集 [U，来自网页检索，未复核]。

### 4.7 [P2] 首稿质量杠杆（方案外建议）

- EXECUTION_LOG 的 Q03 自述：两份同条件首稿都存在真实内容/互动错误；新路径保真承载但"不能据此宣布创作质量不弱于裸 HTML"（报告 `output/unified-content-architecture/quality-comparison/2026-10-03-circuits-flash/Q03_REPORT.md`，本评审未读）。[F/U]
- [I] "降低 AI 生产负担"主要体现在不填坐标、不搬运宿主接口；首稿正确性仍是瓶颈，与载体选择无关。
- [O] 可选的低成本杠杆：设计语言 Skill（字阶、间距、配色、6–8 个版式原型）、作品级设计 token 注入、由用户点选页面后触发的确定性"检查本页"（文字溢出/裁切/重叠、最小字号、对比度，在目标 viewport 渲染）。须可忽略、可关闭，保持自由创作；与 `AGENTS.md` "不自动逐页截图/审美精修"一致（用户触发）。

### 4.8 [P3] 文档与代码偏差、命名

- `CONTENT_AND_DESIGN.md:206` 与 `REFACTOR_PLAN.md` U05 写的是页面/文档级"排版根"；代码是每个 composition 图层一个 iframe（`mountWebComposition.ts`），断点绑图层 frame；多图层页的断点语义未定。[F] [O] 以代码为准更简单：文档改为"每个 Web 图层 = 一个 layout viewport，默认铺满作品规格"，并写明多图层页语义。
- 命名：`src/renderer/composition/` 已有无关的历史文件（`crossSurfaceCommands.ts`、`surfaceRouter.ts` 等），另有 `courseLayerComposition` 一类"图层合成"；新 kind 也叫 `composition`，三义同词。方案的 Q01–Q05 与 `tests/fixtures/r18CommonTasks/definitions.ts:235-241` 的 Q01–Q04 任务 ID 冲突。[F] [O] 尚无用户，改判别器与目录名（如 `web`）的代价现在最低；方案编号可改 UQ01–UQ05。命名属主观项，Owner 可否决。

### 4.9 [P2] 治理与存档（轻量）

**事实**：HEAD `64d97fa2`；工作树 437 项未提交改动（13:51），混有 AGENTS 审查、harness 收敛、Skill 改写、文档归档搬移、mermaid 等多个倡议；EXECUTION_LOG："没有 Git 提交"。[F]

**推断**：方案要求"一个域的读取/编辑/保存/发布/输出一起切换、不双写"，回滚因此只能靠提交边界；若某条轨道被判错，只能逐 hunk 手术。[I]

**建议**（提交需 Owner 同意）：按轨道分别存档，以 HEAD 为基线——①内容与编辑（composition kind、scene.canvas、编辑器、导入器、发布/Player/导出接线、片段包）②内嵌浏览器 ③PDF/图片 ④Office ⑤Skill 与能力索引 ⑥文档归档与登记。每个存档点附一次"拿一份真课件走一遍"的结果（导入→修改→保存重开→播放），不写矩阵。这是存档，不是新门。不要对混合工作树做整树 `reset` / `clean` / `checkout` / `stash`。

### 4.10 其他轨道（未深评）

W02 内嵌任务浏览器、W03 PDF/图片、W04 Office 属于综合办公主线，各自独立验收、独立存档。以下为子评审员转述，**[U] 未核实**：W02 的风险集中在任意站点登录交接（SSO/扫码/带 iframe 的页面），移除外部浏览器回退前宜用真实站点验证（EXECUTION_LOG 称外部浏览器仍作显式 fallback）；W04 的"创建"与"对既有文件做无损文本补丁"价值不同，创建可走 Skill + 脚本。

## 5. 页面尺寸策略

**Owner 决定**：每页可有不同尺寸；默认教室屏幕尺寸；其他尺寸须有明确需求；长文阅读用 Flow（§1-7）。

**现状** [F]：

- 场景级覆盖：V9 `slideSceneSchema.canvas?`、Published scene `canvas?`；`effectiveSceneCanvas(surface, scene)`（`slideCanvas.ts:33-39`）；`resizeSlideSceneCanvas`（`src/core/course/resizeSlideCanvas.ts:58-82`）；属性面板"恢复课程默认尺寸"（`EmptyScenePropertiesPanel.tsx:128-135`）。
- 场景改尺寸时：自由内容按 contain 等比缩放；Web 区的 `x/y/width/height` 按轴向独立缩放，由 CSS 重排（`reflowFrame`，`resizeSlideCanvas.ts:92-118`）。
- 共享（global/surface）层以课程默认画布为唯一参考，经 contain + 居中映射到各页（`sharedSlideFrameMapping`，`slideCanvas.ts:41-58`）。
- 导出：PPTX 首场景规格 + 其余 contain（§4.6）；PDF 各页保持自身规格（EXECUTION_LOG 自述 [U]）。
- 预设：`SLIDE_CANVAS_PRESETS` 含宽屏 16:9、标准 4:3、竖屏 9:16、长页 720×2560（`slideCanvas.ts:14-19`）。

**含义与建议**

- 默认即教室屏幕：新建页面、AI 创作、版式模板默认走该尺寸（A2 待确认）；其他尺寸由用户显式选择。
- 长文阅读走 Flow 而非把 Slide 做成长页。预设里的"长页"与"竖屏"是否继续作为一等选项，与 Flow 职责有重叠，待 Owner 定（§7-1）。
- 按 A1，"响应式"= 场景内重排；不为手机/平板建立断点体系，除非出现明确需求。
- 补齐 §4.3 中读取课程默认画布的 consumer。PPTX 多规格策略保持现状（首场景规格 + 其余 contain，已在导出报告中可见）。

## 6. 建议顺序与最小直接检查

**顺序**

0. 当前拖拽批次按 EXECUTION_LOG（13:57）已收口：真实拖拽重排/自由移动缩放、取消零提交、专业内容面板各 1 项自述通过，最终构建与三域类型检查自述通过 [U]。以下步骤均在该快照之上。
1. 模式互转命令 + 单位策略（§4.1 a、b）。
2. 局部互动块契约 + 一个真课件切片（§4.2）。
3. consumer 遗漏清扫，含按页尺寸（§4.3）。
4. 静态边界决定与（若选 a）schema 约束（§4.4）。
5. 存档点（需 Owner 同意提交，§4.9）。
6. 其后：统一 Web 编辑栈与样式规则层；自动布局尺寸手势与跨容器拖入、画布内手势；PPTX 可编辑子集；整块重写时的身份对应；首稿质量杠杆。

**不做**：解析第三方内嵌引擎；自动把第三方互动页拆成"静态壳 + 互动岛"；为本批创建 V10；新增全局拒绝门；预先引入 PostCSS / GrapesJS 等；修改 `AGENTS.md`。

**最小直接检查**（每项选最低成本且能证伪目标行为者，通过后停止）

| 目标 | 检查 |
|---|---|
| 模式互转 | 真 Chromium：自动布局元素 `toFree` 后显示边界与转换前差 ≤1px；`toFlow` 后回到流；各为 1 步撤销；保存重开后 CSS 与操作后一致 |
| 局部互动切片 | 一份 AI 创作的"静态壳 + 局部互动块"页面 → 导入/保存/重开/Player；互动状态在页面重排与块尺寸变化后保持；静态部分可改字、改栏、拖动 |
| consumer | 构造 composition 内含带 `nodeBindings` 的 runtime，删除其绑定图层 → 无悬空；预检对自定义尺寸场景按本场景尺寸判定 |
| AI 负担（记录，非门） | 无目标 HTML → 课件：记录模型请求次数与工具调用数（现有运行记录或一次真实运行） |

## 7. 需要 Owner 确认或记录

1. 教室屏幕的默认比例（A2：16:9，1280×720）；预设中"长页 720×2560""竖屏 9:16"是否保留为一等选项。
2. "响应式"的含义（A1）。
3. 静态页默认导入载体为 composition（当前实现）——登记为现行决定。
4. composition 静态边界：§4.4 选 (a) 还是 (b)。
5. 画布内直接编辑 vs 弹窗编辑（弹窗是过渡还是终态）；composition 内部元素是否接入元素快捷条/元素 AI 卡（后者未核实现状）。
6. 是否允许提交/分支存档（§4.9）。
7. `AGENTS.md` "当前阶段授权"仍写"R3 已完成，正在进入 2.0 发布阶段"，与 Owner 本次说明（已过 2.0 阶段）不一致；该文件修改需 Owner 确认，本文不改。
8. **现行合同级决定登记表**（建议放在 `unified-content-architecture/EXECUTION_LOG.md`，其余文档引用；每行写 Owner 原话/日期/范围）：

| 决定 | 来源/状态 |
|---|---|
| 融合方案：响应式排版 + 自由定位，可互转 | Owner 口述 2026-10-03，待登记 |
| 原生优先；第三方受限支持，不解析内嵌引擎 | Owner 口述 2026-10-03，待登记 |
| 每页可不同尺寸，默认教室屏幕，其他尺寸须有明确需求 | Owner 口述 2026-10-03，待登记 |
| V9/Published 新增 `kind:'composition'`（含 Component manifest） | 已实现，待 Owner 确认 |
| 场景级 `canvas` 覆盖 | 已实现，待 Owner 确认（与上条口述一致） |
| 静态页默认导入为 composition | 已实现，待 Owner 确认 |
| `.h5component` 结构片段打包/复用 | 已实现，待 Owner 确认 |
| 新依赖：`docx`、`exceljs`、`pdf-lib`、`xlsx-calc`、`mermaid`、`@xmldom/xmldom` | 已实现，待 Owner 确认 |
| Office/PDF/图片原格式编辑；内嵌任务浏览器默认 | 已实现，待 Owner 确认 |

## 8. 已撤回、已消除、未核实

**撤回**（本评审早期草稿内容，因 §1 前提而不再适用）

- "composition 退出默认导入，先做源码优先骨架并设 Gate B"；"冻结 U06–U10、W02–W04 扩域"。Owner 明确结构化编辑/融合是目标方向；改为按轨道存档（§4.9）。
- 以 2.0 的 M15/M17/M19 决定为准绳判定"越权/反转"。仅保留"登记现行决定"（§7-8）。
- "零模型语料度量作为通过门"。降为可选信息（§4.2）。
- "第三方互动页自动拆分为静态壳 + 互动岛"。不做（受限支持）。

**经抽查被证伪或收窄**

- "源码结构编辑栈是 composition 命令的超集"：不成立（§4.5）。
- "静态页的 AI 续改/元素 AI 卡通路退化"：不成立，`content.targets` / `content.update` / `text.replace` 已对 composition 接线（`ToolCatalog.ts:232-234`；`DocumentToolGateway.ts:862-870,891-914`）。仍成立：composition 目标不支持换图（`DocumentToolGateway.ts:901`，由抽查子代理读取），相对旧路径是否退化 [U]。
- "composition 只在导入器强制静态"：收窄为"完整判定只在导入器；渲染端只拦可执行 `<script>`"（§4.4）。
- "合同产物陈旧"：已于 13:27 消除（§3）。
- "Office 无 consumer"：12:40 起已接入 `AgentFileService` / `ExecutionEngine` / `AgentFileTools`（子评审员复核，本评审未复核）。

**未核实 / 不采信**

- 含脚本页占比数字（子评审员称 `output/` 下 108/112、406/417）：语料不是真实首稿，不采信数字。
- `skills.read` 约占工具调用 7%、每请求约 33–37KB 载荷：子评审员粗统计，未复核。
- 业界参照（Slidev、Marp、dom-to-pptx、Webstudio、GrapesJS 等）来自网页检索，未复核。
- `reconcileIds` 对"同形兄弟同时改文案则整体换 ID"的单测断言（`tests/unit/webCompositionParser.test.ts:93-96`）：子评审员转述，未复核；当前 AI 默认续改走短句柄，不依赖该对齐。仅当"AI 整块重写区域"成为真实工作流时才需要投影锚点之类的机制，现不建议预建。
- 教师真实操作体验：无证据。独立的"评审自查/挑刺"步骤因额度限制未执行，本文结论未经第二次独立挑刺。

## 9. 方法与限度

- 16 个只读子代理：8 个镜头（方案自洽 / 内容模型 / 阶段一 / 产品 / 合同一致性 / 替代路线 1 / 替代路线 2 / 业界参照）→ 综合评分 → 6 条决定性断言抽查（4 条成立并被收窄，2 条被证伪，见 §8）。主评审人在 §1 前提下重做取舍，并复核了本文引用的位置（13:40–14:12 读取；其后 composition 源码仅 `mountWebComposition.ts` 于 13:45 有改动，引用的行号已按该版本校正）。
- 未运行测试、构建、e2e、真实模型、真实浏览器。
- composition 编辑相关文件仍在被修改（拖拽、专业面板、文档），行动前以当前文件为准。
