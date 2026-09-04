# 1.2：Native 编辑闭环

> 启动门：`r11-064-patch-release` 已于 2026-09-04 签署 `accepted`，1.2 的四个根节点可按下述写锁和依赖实例化；协调状态仍只看任务板。

## 结果与边界

教师可以在 Flow 中直接完成两种互补的图文创作：正文 paragraph/heading 和正文图片继续遵循文档流、块级排版、布局与环绕；需要自由视觉编排时，将内容放入或转为 Flow 原生文字/图片浮层，并获得与共享 Native owner 一致的文字、图片和通用几何属性。演示页同时可以直接创建和编辑 Table、Chart、Line，并能在 Scene、命名状态和三 Surface 的既有所有权范围内编辑背景；结果可保存、重开、撤销、在 Player 运行并进入适用导出。Table / Chart 是严格 V9 Native 内容，不以 HTML、Component 或 Runtime 伪装。旧 V9 工程继续读取；不修改 V9 版本号，不引入 V10。

发布制品只有源码 tag，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r12-000-native-contract` | 定义 Table / Chart 的 V9 Native 严格分支与 Published V2 窄增量 | `r11-064-patch-release` | 否 | `contracts-schema` | 旧 V9 fixture 仍通过严格解析；Table / Chart 合法 fixture 通过；缺字段、额外字段和未知判别器分别被拒绝；不匹配的新内容由旧 reader 明确报错而不是静默丢弃 |
| `r12-005-flow-native-authoring-parity` | 补齐 Flow 原生文字/图片浮层作者能力，同时保留正文图文的文档流语义 | `r11-064-patch-release` | 否 | `editor-store-history`, `workspace-properties` | 仅用 Flow 可见 UI 可创建/选择文字与图片浮层，并直接编辑名称、位置/尺寸、旋转、透明度、可见/锁定、文字内容/样式，以及图片替换、适配、裁剪、翻转、圆角/羽化；正文 paragraph/heading 仍是语义 block，正文图片仍按布局/环绕重排且可明确转为浮层；所有修改一手势一历史事务，保存重开、Player、单 HTML 和适用导出结果一致 |
| `r12-010-table-core` | Factory、Command、History 支持稳定行 / 列 / 单元格身份、增删重排、宽高和样式 | `r12-000-native-contract` | 否 | `contracts-schema`, `editor-store-history` | 创建表格后连续执行单元格编辑、行列增删重排、宽高和样式修改；每一步 Undo / Redo 后结构、稳定身份与值精确恢复；一次命令只产生一个历史事务 |
| `r12-011-table-authoring-delivery` | Table 编辑 UI、键盘路径、保存重开、Player、HTML 与原生 PPTX 闭环 | `r12-010-table-core` | 否 | `workspace-properties`, `published-producer` | 仅用可见 UI 完成创建、键盘移格、编辑、增删与重排；保存重开后单元格值、尺寸和样式不变；Player / 单 HTML 显示一致；PPTX 产出原生可编辑表格而非截图 |
| `r12-020-chart-core` | Factory、Command、History 支持 bar / line / area / pie / donut 及可编辑数据 | `r12-000-native-contract` | 否 | `contracts-schema`, `editor-store-history` | 五种图表分别由同一严格 Native 合同创建；系列 / 分类 / 数值 / 类型变更可 Undo / Redo；非法数值和系列长度不一致产生定位到字段的诊断且工程不被部分改写 |
| `r12-021-chart-authoring-delivery` | Chart 编辑 UI、保存重开、Published、Player 与 HTML 闭环 | `r12-020-chart-core` | 否 | `workspace-properties`, `published-producer` | 仅用 UI 创建五种图表并修改数据与样式；保存重开后类型、数据、颜色和标签不变；Player 与单 HTML 呈现同一数据；不支持的导出必须给出显式 preflight 结果，不得静默漏图 |
| `r12-030-line-authoring` | Line 支持直接绘制、端点、折点、吸附与细线命中 | `r11-064-patch-release` | 否 | `editor-store-history`, `workspace-properties` | 在演示页直接绘制直线和折线，拖动端点 / 折点并吸附；1 px 视觉线仍有独立可选中命中区；每个手势仅提交一个历史事务；保存重开、Player 与 HTML 保持几何结果 |
| `r12-040-background-authoring` | 背景编辑覆盖 Scene、命名状态、Slide Surface，并保持既有 Flow / Spatial 行为 | `r11-064-patch-release` | 否 | `editor-store-history`, `workspace-properties` | 分别修改课程 / Scene、命名状态、演示页、Flow 与 Spatial 的受支持背景；UI 明确显示当前 owner；Undo / Redo 和保存重开保持所有权不串层；Player 与 HTML 使用同一解析优先级 |
| `r12-050-native-closure` | 统一补齐诊断、Capability、无障碍、Published 与导出 preflight | `r12-005-flow-native-authoring-parity`, `r12-011-table-authoring-delivery`, `r12-021-chart-authoring-delivery`, `r12-030-line-authoring`, `r12-040-background-authoring` | 否 | `generated-index`, `published-producer` | Capability 索引精确声明 Flow 原生图文浮层和四项新增 Native 能力；健康检查定位坏表格 / 图表数据与无效背景引用；键盘可到达编辑入口；Published 构建对 Flow 浮层资产、文字内容和新增内容无静默遗漏；现有正文图文、人工对象编辑与导出基线不退化 |
| `r12-060-release` | 固定课例通过人工闭环并发布 1.2 源码 tag | `r12-050-native-closure` | 否 | `none` | Owner 在固定课例中分别验证 Flow 正文图文、原生文字/图片浮层，创建并修改 Table、五种 Chart、Line 和多层背景，完成保存、重开、Undo/Redo、Player、单 HTML 和适用 DOCX/PPTX；把已验收 Native 行为晋升到保全矩阵，证明只扩展正式 Native/property/render owner、未把正文改成 generic layer、未在 App/Workspace/root Store 新增 switch、无第二 writer 后签署 `accepted` 并发布源码 tag |

并行 frontier：`r12-000-native-contract`、`r12-005-flow-native-authoring-parity`、`r12-030-line-authoring`、`r12-040-background-authoring` 在 r11-064 完成、各自写锁不冲突时可启动；contract 完成后，`r12-010-table-core` 与 `r12-020-chart-core` 可继续并行。Table / Chart 的 contract 写入必须由 `r12-000-native-contract` 单独完成。

## 接口与数据合同

- `NativeElementContent` 增加 `table` 与 `chart` 两个严格判别分支；两者的稳定 ID、数据、几何与样式都进入 V9 工程和 round-trip。
- Flow 正文 paragraph/heading 继续由 FlowBlock / TextRun 表达，正文图片继续使用文档流的 layout/wrap；不得为追求 Slide 式自由度给正文增加 x/y/rotation 或普通 z-order 语义。
- Flow 文字/图片浮层继续使用既有 LayerItem 与 Native text/image 内容，复用共享 Native property editor、图片处理和 canonical command/history owner。若执行时证明现有 strict V9 分支确实无法表达验收结果，必须停止本节点并先建立独立 additive contract 任务；不得在属性 UI 内私藏状态或静默放宽 Schema。
- Published Course V2 只增加匹配 Player 所需的 Table / Chart 分支；producer 与 matching Player 成对发布，不承诺旧 reader 的前向兼容。
- Table 行、列、单元格使用稳定身份，重排不得用数组位置充当外部身份。Chart 首发类型固定为 bar、line、area、pie、donut。
- Line 保持 Native 对象语义；细线的视觉宽度与命中宽度分离。背景写入已有 global / Scene / state / surface owner，不增加平行的 `backgroundState`。
- 保存、历史、Published 和导出只能读取同一权威 V9 状态；UI 不保存第二份表格 / 图表数据。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npm run test:product -- tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/v9SlideContentCommands.test.ts
npm run test:product -- tests/unit/buildPublishedCourseV2.test.ts tests/unit/coursePptxExport.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowMediaBlockEdit.test.ts tests/unit/flowOverlayTransform.test.ts tests/unit/flowUnifiedLayers.test.tsx
npm run test:product -- tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts
```

版本候选再执行总路线的统一验证与发布门。测试只证明工程候选；Owner 的固定课例检查决定发布。
