# 1.2：Native 编辑闭环

> 启动门：已签署的 `v1.1.1` 是当前维护基线，1.2 的五个根节点可按下述写锁实例化；协调状态仍只看任务板。

执行者必须先读 [次旗舰模型执行指南](EXECUTION_GUIDE.md) 与 [决策闭合实施合同](IMPLEMENTATION_CONTRACT.md)，再进入对应独立节点规格。README 只保存版本结果、DAG 和验收摘要，不授权执行者在节点内重选数据形状或 carrier。

## 结果与边界

教师可以在 Flow 中直接创作正文图文和文字、图片、图形浮层，完整编辑图形属性，并把这些作者内容保真导出为一份连续 DOCX；正文仍遵循文档流、块级排版、布局与环绕。Slide 同时支持可编辑填空题以及 Table、Chart、Line，并能在 Scene、命名状态和三 Surface 的既有所有权范围内编辑背景；结果可保存、重开、撤销、在 Player 运行并进入适用导出。Table、Chart 与 input 是经过批准的严格 V9 Native 窄增量，不以 HTML、Component 或 Runtime 伪装。旧 V9 工程继续读取；不修改 V9 版本号，不引入 V10。

本版必须修复 Table/Chart 作者态插入失败与色板首个颜色变化导致关闭的问题；input 共用传输边界一并覆盖。交付统一“图表”类型选择入口，以及所有现有取色入口的固定常用色、自定义连续取色和 HEX。一次连续调色一条历史，取消/切换目标不误写；这些基础可用性不能延后到 S1。当前反例、原责任节点与收尾顺序见 [执行指南 §2](EXECUTION_GUIDE.md)。

Flow/Spatial 图表扩展和项目色板/Token 范围应用已列入 [1.3](../1.3/README.md)必选路线；1.2 对未支持位置只保留清晰的限制说明，不出现五张重复禁用图表卡，不提前修改容器 Schema 或能力索引。

本版只形成 `v1.2.0-rc.N` engineering candidate 源码标签，不发布 HTML 或安装器；Owner accepted 在 S1（1.3）统一签署。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Spec | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| `r12-000-native-contract` | 定义 Table / Chart 的 V9 Native 严格分支与 Published V2 窄增量 | — | 否 | `contracts-schema` | [执行规格](r12-000-native-contract.md) | 旧 V9 fixture 仍通过严格解析；Table / Chart 合法 fixture 通过；缺字段、额外字段和未知判别器分别被拒绝；不匹配的新内容由旧 reader 明确报错而不是静默丢弃 |
| `r12-005-flow-native-authoring-parity` | 补齐 Flow 原生文字/图片浮层作者能力，同时保留正文图文的文档流语义 | — | 否 | `store-flow`, `props-flow`, `props-shared`, `props-slide`, `authoring-flow` | [执行规格](r12-005-flow-native-authoring-parity.md) | 仅用 Flow 可见 UI 可创建和选择文字、图片与图形浮层，并直接编辑既有文字、图片、几何与可见性属性；矩形和线条复用共享 Shape 属性编辑器，可修改填充、边框、透明度、宽度、线型、圆角及适用箭头，画布即时显示；所有写入走 Flow canonical command，一手势一历史事务，Undo/Redo、保存重开、Player 与单 HTML 一致；正文 paragraph/heading 与正文图片仍保持文档流语义；DOCX 由 `r12-045-flow-docx-fidelity` 验收 |
| `r12-006-input-response-contract` | 定义 Native input、input.submit 与 Published V2 对等严格分支 | — | 否 | `contracts-schema`, `published-slide`, `published-interaction` | [执行规格](r12-006-input-response-contract.md) | V9 Native 与 Published V2 成对增加严格 `input` 分支和 `input.submit` 触发器，旧 V9 fixture 继续通过，缺字段、额外字段、未知判别器分别被拒绝；input content 不重复保存 ID 或几何，只允许 Slide scene，其他容器越界时定位拒绝；`input.submit` 必须引用真实 Native input；既有条件/动作 wire 不变；共享答案归一化后全仓 typecheck 通过，尚未交付的 consumer 明确 fail loud |
| `r12-007-input-response-delivery` | 交付 Slide 填空题作者、运行、PPTX、诊断与能力索引闭环 | `r12-006-input-response-contract`, `r12-008-native-authoring-transport` | 否 | `store-slide`, `props-slide`, `authoring-slide`, `authoring-interaction`, `published-slide`, `published-interaction`, `published-dynamic`, `export-pptx`, `diagnostics`, `generated-index` | [执行规格](r12-007-input-response-delivery.md) | 仅用 Slide 可见 UI 可创建和配置文本/数值输入框；创建、切换类型、复制、删除分别以单一作者事务同步维护节点、值键、有效性键和 canonical 规则族，文本答案最多 15 个；提交事件携带 rawValue，Controller 在匹配规则前完成归一化和双键原子写入，规则恰好命中一支，IME 不误提交；try-run 与 Player 同语义；PPTX 为可编辑静态填写区；诊断可定位悬空键/规则；本节点生成能力索引 |
| `r12-008-native-authoring-transport` | 闭合 Table/Chart/input 的 Native 作者态传输与真实宿主同步 | `r12-000-native-contract`, `r12-006-input-response-contract` | 否 | `contracts-schema`, `authoring-slide`, `published-slide` | [执行规格](r12-008-native-authoring-transport.md) | 正式 Table、五 Chart、text/number input 输入通过 strict patch parser 与宿主 frame guard；真实宿主初始及增量 ACK 成功；未知/错分支/越界/stale 输入仍拒绝，保留精确失败反馈，无双轨类型名单 |
| `r12-010-table-core` | Factory、Command、History 支持稳定行 / 列 / 单元格身份、增删重排、宽高和样式 | `r12-000-native-contract` | 否 | `store-slide`, `authoring-slide` | [执行规格](r12-010-table-core.md) | 创建表格后连续执行单元格编辑、行列增删重排、宽高和样式修改；每一步 Undo / Redo 后结构、稳定身份与值精确恢复；一次命令只产生一个历史事务 |
| `r12-011-table-authoring-delivery` | Table 编辑 UI、键盘路径、保存重开、Player、HTML 与原生 PPTX 闭环 | `r12-010-table-core`, `r12-008-native-authoring-transport` | 否 | `props-slide`, `authoring-slide`, `published-slide`, `export-pptx` | [执行规格](r12-011-table-authoring-delivery.md) | 仅用可见 UI 创建后作者态完成同步并持续可操作；完成键盘移格、编辑、增删与重排；保存重开后可继续编辑且数据样式不变；Player/HTML 一致，PPTX 为原生可编辑表格 |
| `r12-020-chart-core` | Factory、Command、History 支持 bar / line / area / pie / donut 及可编辑数据 | `r12-000-native-contract` | 否 | `store-slide`, `authoring-slide` | [执行规格](r12-020-chart-core.md) | 五种图表分别由同一严格 Native 合同创建；系列 / 分类 / 数值 / 类型变更可 Undo / Redo；非法数值和系列长度不一致产生定位到字段的诊断且工程不被部分改写 |
| `r12-021-chart-authoring-delivery` | Chart 编辑 UI、保存重开、Published、Player 与 HTML 闭环 | `r12-020-chart-core`, `r12-008-native-authoring-transport` | 否 | `props-slide`, `authoring-slide`, `published-slide`, `export-pptx`, `workspace-shell` | [执行规格](r12-021-chart-authoring-delivery.md) | 常用区单一图表入口，五类选择/搜索/拖入/键盘可用，其他 Surface 限制清晰；真实 UI 创建五类后同步正常、可编辑数据样式和 Undo/Redo；保存重开可继续编辑，Player/HTML 一致，PPTX 五类均原生可编辑 |
| `r12-030-line-authoring` | Line 支持直接绘制、端点、折点、吸附与细线命中 | — | 否 | `contracts-schema`, `store-slide`, `props-slide`, `workspace-shell`, `authoring-slide`, `published-slide`, `export-pptx`, `diagnostics` | [执行规格](r12-030-line-authoring.md) | 在演示页直接绘制直线和折线，拖动端点 / 折点并吸附；1 px 视觉线仍有独立可选中命中区；每个手势仅提交一个历史事务；保存重开、Player 与 HTML 保持几何；PPTX straight 原生、elbow 静态后备有定位 warning |
| `r12-040-background-authoring` | 六 owner 背景编辑与共享常用色/连续调色闭环 | — | 否 | `contracts-schema`, `store-slide`, `store-flow`, `store-spatial`, `store-course`, `props-shared`, `props-slide`, `props-flow`, `props-spatial`, `props-global`, `authoring-slide`, `authoring-flow`, `authoring-spatial`, `published-slide`, `published-flow`, `published-spatial`, `published-producer`, `export-pptx`, `export-docx-print`, `diagnostics` | [执行规格](r12-040-background-authoring.md) | 分别修改 Course、Slide Surface、Scene、命名状态、Flow、Spatial 背景，UI 明确 owner；Undo/Redo、保存重开不串层，三 Surface、HTML、PPTX/DOCX 解析优先级一致，旧 fixture 不变；共享控件覆盖现有取色入口并提供常用色、连续取色和 HEX；连续操作不重挂载，一次操作一笔历史，取消/切目标零误写，Chart 整表草稿事务不变；真实 Renderer 验证操作与布局 |
| `r12-045-flow-docx-fidelity` | 让 Flow 作者浮层按转换矩阵进入连续 DOCX | `r12-005-flow-native-authoring-parity` | 否 | `export-docx-print`, `published-flow`, `app-save-recovery` | [执行规格](r12-045-flow-docx-fidelity.md) | 一个 Published Flow Surface 导出为一份连续 Word 文档；普通作者浮层只出现一次；仅 global teacher-controller 同时 all+includeInStaticExports 才在 footer 重复；每类内容逐项保留、静态后备、可见占位、排除或明确拒绝，诊断定位 layerItemId；固定 fixture 证明 PDF/打印不变 |
| `r12-050-native-closure` | 统一补齐诊断、Capability、无障碍、Published 与导出 preflight | `r12-005-flow-native-authoring-parity`, `r12-007-input-response-delivery`, `r12-011-table-authoring-delivery`, `r12-021-chart-authoring-delivery`, `r12-030-line-authoring`, `r12-040-background-authoring`, `r12-045-flow-docx-fidelity` | 否 | `generated-index`, `diagnostics`, `published-producer` | [执行规格](r12-050-native-closure.md) | Capability 精确声明 Flow 原生图文/图形浮层、Slide input 与 Table、Chart、Line、Background；健康检查定位坏表格/图表、无效背景及 input 键/规则问题，键盘可到达编辑入口；补齐 Table/Chart/input 作者态同步、常用色/连续调色及统一图表入口证据；Published 与适用导出不静默遗漏，既有正文图文、人工对象编辑与导出基线不退化；1.2 不提前声称 Flow/Spatial Chart 可用，UI 缺陷返回上游 |
| `r12-060-release` | 形成 1.2 engineering candidate 并发布 v1.2.0-rc.N 源码标签 | `r12-050-native-closure` | 否 | `none` | [执行规格](r12-060-release.md) | 自动化与全部 1.2 目标检查、真实 UI 同步/连续调色/常用色/入口布局验收通过；固定 fixture 覆盖全部新能力、保存重开、Undo/Redo、Player、单 HTML 与适用 DOCX/PPTX；有明确 Git 授权时创建 `v1.2.0-rc.N`，否则报告 candidate-ready；本节点不签署 accepted，保全矩阵晋升留到 1.3 的 S1 |

并行 frontier：五个根节点仍可按依赖启动，但 `r12-000-native-contract`、`r12-006-input-response-contract`、`r12-030-line-authoring`、`r12-040-background-authoring` 共享 `contracts-schema`，且后两者还覆盖跨 Surface owner；首批可安全并行的是 `r12-000-native-contract` 与 `r12-005-flow-native-authoring-parity`，最多两路。单执行者按执行指南顺序推进。Table / Chart 的字段合同只由 `r12-000-native-contract` 完成。

## 接口与数据合同

- `NativeElementContent` 增加 `table`、`chart` 与 Slide-scene-only `input` 三个严格判别分支；精确字段、边界、归一化和有效域只看实施合同。稳定 LayerItem ID 与 frame 仍只由 LayerItem 持有。
- Flow 正文 paragraph/heading 继续由 FlowBlock / TextRun 表达，正文图片继续使用文档流的 layout/wrap；不得为追求 Slide 式自由度给正文增加 x/y/rotation 或普通 z-order 语义。
- Flow 文字、图片和图形浮层继续使用既有 LayerItem 与 Native 内容，复用共享 property editor、图片处理和 canonical command/history owner。若执行时证明现有 strict V9 分支确实无法表达验收结果，必须停止本节点并先建立独立 additive contract 任务；不得在属性 UI 内私藏状态或静默放宽 Schema。
- input 只允许放在 Slide scene。`input.submit` 由真实 Native input 的提交事件携带当前值，Published Controller 先归一化并原子写入值键与有效性键，再求规则条件；不增加通用 DOM 回读端口，不修改 `course-state.set`，不在 `InteractionEngine` 复制执行语义。
- input 的正确答案仍编译为 `course-state.compare` 规则族；文本答案最多 15 个。创建、切换类型、复制和删除必须让节点、两个状态声明与规则族同事务一致；教师只配置正确/错误两类反馈。
- Published Course V2 只增加匹配 Player 所需的 Table、Chart 与 input 分支；producer 与 matching Player 成对发布，不承诺旧 reader 的前向兼容。
- 一个 Published Flow Surface 对应一份连续 Word 文档。普通作者浮层只出现一次；1.2 唯一重复例外是 global teacher-controller 同时满足 visibility all 与 `includeInStaticExports=true`，此时进入 footer。DOCX 使用专用投影，不能直接改变共享打印/PDF 浮层开关。
- Table 行、列、单元格使用稳定身份，重排不得用数组位置充当外部身份；Table/Chart 只允许 Slide scene/surface。Chart 首发类型固定为 bar、line、area、pie、donut，五类均输出原生 PPTX chart。
- Line 保持既有 shape 判别器，以严格可选 `lineGeometry` 保存 straight/elbow 的固定参数化几何；细线的视觉宽度与命中宽度分离。背景只在 Course / Surface / Scene / state 既有 owner 增加合同列明的可选字段，不增加平行 `backgroundState`。
- 保存、历史、Published 和导出只能读取同一权威 V9 状态；UI 不保存第二份表格 / 图表数据。共同 authoring transport 复用正式 Native content 定义，不保留 parser/guard/painter 的不同接受域；颜色的局部预览不成为工程或历史真相。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npx vitest run tests/unit/playerAuthoringProtocol.test.ts tests/unit/publishedSlideAuthoringPatch.test.ts tests/unit/sceneStateUi.test.tsx
npm run test:product -- tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/v9SlideContentCommands.test.ts
npm run test:product -- tests/unit/interactionSchema.test.ts tests/unit/interactionDiscriminatorContract.test.ts tests/unit/assessmentEvaluators.test.ts tests/unit/courseStateStore.test.ts
npm run test:product -- tests/unit/buildPublishedCourseV2.test.ts tests/unit/coursePptxExport.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/interactionAuthoringCommands.test.ts tests/unit/publishedInteractionController.test.ts tests/unit/publishedCourseState.test.ts tests/unit/coursePrintArtifacts.test.ts
npm run test:product -- tests/unit/flowBlockContextToolbar.test.tsx tests/unit/flowMediaBlockEdit.test.ts tests/unit/flowOverlayTransform.test.ts tests/unit/flowUnifiedLayers.test.tsx
npm run test:product -- tests/integration/courseExportPreflightApp.test.tsx
npm run test:product -- tests/integration/architectureBaselineFlows.test.tsx tests/integration/mixedCrossSurfaceHistory.test.tsx
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts
```

版本候选再执行总路线的统一验证与发布门。测试只证明 engineering candidate；S1 的固定课例检查与 Owner 签署决定 accepted。
