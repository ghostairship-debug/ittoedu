# 1.5：材料、PPTX 与内容质量

## 结果与边界

本版完成后，教师可以在应用本地保存、检索、引用和删除材料，把普通教学 PPTX 原子导入为可编辑内容，并在确认前明确列出未支持项，修改母版对应的共享装饰和各页正文，复制参考样式骨架并替换槽位，并在发布前检查数学、答案、图表正文和来源定位。材料缓存不进入 Course Project 主合同；进入课程的可见引用必须是普通可携带内容。

OpenMAIC 只是一条可选研究 / 桥接旁支。任何核心任务、版本退出门或发布制品都不得依赖它。

S2 Owner 验收 1.4–1.5 后发布 `v1.5.0` accepted 源码标签，不发布 HTML 或安装器。

PPTX 人工导入增强是本版并列交付线，始终可见，不受 AI 开关或 CLI 是否可用影响。版本节点、详细边界和实施顺序见 [PPTX 能力增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。

## 任务 DAG

当前实现进度（2026-09-06，以 v1.5.0-rc.1 为基础；r15-037/r15-038 已修复真实29页课件的画布拒绝、126个普通对象遗漏与错误文字继承。文字自动扩框也已通过真实painter与最终桌面复验；工程收尾完成，Owner于2026-09-06接受当前范围并签署S2，保留67次复杂内容遗漏）：

- 原始514个对象（含28个小尺寸对象）与修复后643个对象均通过正式同步解析；126个目标源对象已逐项核对恢复，193次跳过降至67次。保留复杂对象提示与既定后续版本边界，不把自动化结论签为 accepted。详细证据、字体适配导致的自动扩框及余留限制见[收尾复核](../../reviews/1.5-materials-content-2026-09-06.md)。

- Owner 已取消自动图片后备与外部渲染后端。母版/版式共享装饰、占位符继承、普通分组坐标、图片裁剪及未合并 Native Table 已接入；共享底层内容可复用 PPTX 母版，前景按页保持顺序。导入/归档与 PPTX 导出 54 项通过，真实 Electron 共享编辑、表格编辑、保存重开、Undo/Redo 与离线播放通过；详见 [本轮复核](../../reviews/1.5-materials-content-2026-09-06.md)。合并表格在 1.6 先交付合同、编辑与消费者，再接 PPTX 映射；1.5 对合并表格明确提示，不伪造合并结果。

- `WorkspaceIdentityV1` 与材料记录已严格定义在共享模块，Main 是工程路径规范化的唯一 producer。Windows 路径归一化大小写、分隔符与点段；相同工程 ID 的不同文件路径使用不同材料目录。未保存工程先保存后使用材料库，不创建第二种临时身份。
- 本地材料入口位于“创作工具 → 教学材料库”。支持粘贴文本和 UTF-8 TXT / Markdown / CSV 文件（2 MB 上限），搜索标题 / 正文 / 来源、查看原文、定位原文件、删除单条与清空当前工程。记录保存在 userData/materials/v1；每条原子写入，搜索从权威材料记录重建，没有独立易损索引。它们不进入课件文件。
- `material.citation` 通过已有 Native / Flow command 插入普通正文和可见来源，共用统一 receipt、stale 检查和一次历史事务。缓存身份、材料 ID 与本地记录不进入工程或 Published；删除材料不影响已插入文本。
- 材料仓库隔离 / 删除与重启重读、Slide / Flow 可携带引用及 stale 零写入的四项聚焦用例通过。真实 Electron 已验证粘贴导入、来源搜索、插入引用、另存为隔离、返回原工程、删除材料后保存仍保留来源；材料库呈现已人工查看截图。最终桌面用例同时覆盖真实 UTF-8 文件导入、清空副本材料不影响原工程，1/1 通过；当前类型检查和桌面构建通过。截图为 `output/playwright/r13-review/r15-material-library.png`。
- 受限 PPTX 已按正式关系解析文字/基础形状/内嵌图片，暂存完成后一次提交文档与 sidecar，整包撤销；大小和压缩比超限明确拒绝；不支持对象或局部损坏按对象/页面跳过并报告，保留其他内容，动画与部分效果省略后保留静态对象。只有无可导入对象或主文档无法读取时才停止。正常 PptxGenJS 文件与真实 UI 导入/保存重开/离线播放已验证。
- 样板改写已接入设计生产力面板；文字槽位映射、容量预览、独立身份和资源、一次 Undo 与保存重开已验证。内容 QA 四类 finding 已接入 GUI、CLI 和报告，显示依据/建议并定位对象；检查只读，普通自然语言不被宣称已审校。
- 1.4 动态工具 / Builder V2 已形成 `v1.4.0-rc.1`。1.5 已实现范围的验证与实际截图见 [1.5 复核](../../reviews/1.5-materials-content-2026-09-06.md)，固定课例、真实29页课件与Owner结论见 [S2 验收单](../../acceptance/S2-tools-and-materials.md)。新增 PPTX 整改已完成工程复验，S2已由Owner签署，发布 `v1.5.0` accepted 内部源码标签；保留已知遗漏。

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r15-005-workspace-identity` | 定义材料域与 AI 会话域共享的 WorkspaceIdentityV1 | — | 否 | `contracts-schema` | `WorkspaceIdentityV1 = projectId + normalizedPath` 严格解析；同 ID 不同路径互不可见，Save As 产生新身份；它是材料域与 AI 会话域共用的唯一 workspace key，不承载任一域的私有语义，也不存在第二套定义 |
| `r15-000-material-contract` | 定义本地材料记录、工程关联、引用与删除语义 | `r15-005-workspace-identity` | 否 | `contracts-schema`, `main-preload` | 版本化本地材料记录按 `r15-005-workspace-identity` 关联并严格解析；材料原文、索引和 trace 不进 CourseProject、Published 或导出；删除行为与课程可见引用保留策略可判定；本节点只定义材料域私有语义，不重复定义 workspace identity |
| `r15-010-material-repository` | 应用本地材料可导入、读取、检索、定位和删除 | `r15-000-material-contract` | 否 | `main-preload` | 导入受支持文本 / 文件后可按标题、正文和来源检索并打开原位置；重启应用后仍可用；删除一个材料、当前工程材料不影响其他工程；损坏索引可重建且不改权威工程；本节点在现有 `tests/unit/coursewareAuthoringRunner.test.ts` 增加并通过材料仓库隔离 / 删除用例 |
| `r15-020-material-tools-citations` | Authoring Tools 可引用材料并写入可见、可携带来源 | `r15-010-material-repository`, `r14-020-slide-tools`, `r14-021-flow-tools` | 否 | `main-preload`, `store-kernel` | 从检索结果插入内容时，正文和来源定位写成普通 V9 内容；删除本地材料后已写引用在保存重开、Player 和导出中仍可见；stale target 零写入；引用插入可一次 Undo |
| `r15-037-native-frame-sync` | 修复合法小尺寸对象导致统一画布初始化失败 | `r15-033-pptx-common-native` | 否 | `contracts-schema`, `authoring-slide`, `published-slide` | 同一 V9 合法正尺寸经 materializer、patch parser、宿主 guard、initial snapshot 与 incremental ACK 全链接受；不把细线或小文字强行放大到16px，不放宽非有限/零负尺寸；真实29页样本的28个小尺寸对象及9个受影响页均能启动编辑、Undo/Redo、保存重开和播放，其他场景继续可用 |
| `r15-038-pptx-common-mapping-repair` | 补齐真实教学课件的高收益映射与正确文字继承 | `r15-032-pptx-inheritance`, `r15-037-native-frame-sync` | 否 | `app-save-recovery`, `store-slide`, `export-pptx` | 以树状图概率课件126次首因跳过为修复集：87个分组文字递归解析适用字体、20个普通边框/虚线、11个圆角调整、1个流程矩形、7个单字符对齐；非占位文字不得误套bodyStyle加项目符号，分组缩放须保留文字/描边语义；逐对象重解析追踪后续阻断，不能把消除首因当作恢复成功；标题和树状图实际显示、可编辑、重开及导出正确 |
| `r15-030-pptx-import` | 受限 PPTX 解析、资源限制、不支持项报告与 document + sidecar 原子提交 | `r14-060-release` | 否 | `app-save-recovery`, `store-kernel` | 正常 fixture 导入为可编辑页面 / 对象；超文件大小、超解压比或主文档不可读时停止；不支持对象及局部损坏按页码 / 对象报告并跳过，保留其他内容供确认；无可导入对象不写入；任一 document 或 sidecar 写入失败时两者均不提交；导入可整体撤销；本节点在现有 `tests/unit/courseProjectArchive.test.ts` 增加并通过 PPTX document + sidecar 原子事务用例 |
| `r15-040-style-remix` | 复制参考页可编辑骨架并用明确槽位替换内容 | `r13-060-release`, `r14-060-release` | 否 | `store-kernel`, `generated-index` | Remix 预览列出骨架来源、槽位映射与容量处理；确认后创建无身份冲突的普通 V9 内容；修改副本不影响来源；缺槽位 / 超容量返回定位结果且不留下半页；保存重开与 Player 一致 |
| `r15-050-content-qa` | 数学、答案一致性、图表正文一致性和来源定位进入可导航 QA | `r14-060-release` | 否 | `diagnostics`, `generated-index` | 四类预置错误分别产生可跳转 finding；数学检查区分解析错误与渲染警告，答案检查比较题目与 evaluator，图表检查比较数据与正文主张，来源检查定位缺失引用；检查只读且不因 OpenMAIC 缺席降级；本节点在现有 `tests/unit/courseProjectHealth.test.ts` 增加并通过四类内容 QA 用例 |
| `r15-031-pptx-owner-contract` | 明确 PPTX 母版、版式、占位符与图层的映射合同 | `r15-030-pptx-import` | 否 | `contracts-schema`, `store-course`, `export-pptx` | 用多母版交错页固定映射样例：导入集合使用独立 Slide Surface；母版/版式公共装饰使用 surfaceLayerItems 与精确 location visibility，占位符实例留在 scene；课程全局层不得被自动污染；单一顺序与 V9/Published 严格合同不变，导出母版与 Overlay 例外有确定规则 |
| `r15-032-pptx-inheritance` | 交付母版版式继承、占位符实例与共享层编辑导出 | `r15-031-pptx-owner-contract` | 否 | `app-save-recovery`, `store-course`, `store-slide`, `export-pptx` | 解析有效背景、颜色、字体、位置与占位符，保留源页序和隐藏母版图形规则；编辑共享装饰只影响引用页，编辑占位符正文不改其他页；可表达的共享底层内容导出为母版，Overlay 按页保留前景；保存重开、一次 Undo 与可编辑 PPTX 导出均正确 |
| `r15-033-pptx-common-native` | 补齐常用图文线条、图片裁剪、普通分组与 Native Table 导入 | `r15-031-pptx-owner-contract` | 否 | `app-save-recovery`, `store-slide`, `published-slide` | 普通文本字号/段落/主题、支持形状、水平竖直翻转线与常见箭头均转为现有 Native；普通分组递归展开并组合坐标变换，图片保留裁剪后的外观；已有载体可表达的内容不得无故转图；普通未合并表格映射既有 Native Table；复杂对象及合并表格明确提示，确认部分导入后跳过，线端位置、线宽、箭头和文本实际呈现正确 |
| `r15-036-pptx-closure` | 完成真实教学 PPTX 创作闭环并补齐 S2 验收材料 | `r15-032-pptx-inheritance`, `r15-033-pptx-common-native`, `r15-038-pptx-common-mapping-repair` | 否 | `app-save-recovery`, `generated-index`, `diagnostics` | 真实普通课件、多母版课件和含复杂对象课件均有逐项预期：常规文字/形状/普通表格必须可编辑，复杂内容在预览中按页和对象明确提示；不承诺自动图片后备；导入后教师可修改并保存重开、整体 Undo/Redo、播放及适用导出；删除初始场景/整页回归保全；普通内容不能借部分导入无故遗漏，最终由 S2 签署 |
| `r15-060-release` | Owner 验收 S2 工具与素材并发布 v1.5.0 accepted 源码标签 | `r15-020-material-tools-citations`, `r15-030-pptx-import`, `r15-040-style-remix`, `r15-050-content-qa`, `r15-036-pptx-closure` | 否 | `none` | Owner 在同一固定课例完成 S2 工具与素材验收：覆盖 1.4 的三 Surface/global Authoring Tools、Builder V2、动态载体三硬门，以及 1.5 的材料导入/检索/引用/删除、PPTX 导入、Remix 与四类内容 QA；检查保存重开、Undo、Player、HTML、适用导出和失败零写入，晋升 1.4–1.5 已验收行为到保全矩阵，签署 accepted 后创建 `v1.5.0` 源码标签；OpenMAIC 缺席不阻塞；本版新增 PPTX 增强节点也必须达到其验收边界，不能只完成 AI 主线即发布 |
| `r15-900-openmaic-review` | 评估 OpenMAIC 与当前合同的可复用边界并形成采用 / 不采用记录 | `r14-060-release` | 是 | `none` | 记录许可证、进程 / 数据边界、可复用接口、与 V9 / Authoring Tool 的冲突及退出成本；结论可以是不采用；不改核心合同、不写发布门、不阻塞 `r15-060-release` |
| `r15-901-openmaic-bridge` | 在评估通过时提供隔离桥接原型 | `r15-900-openmaic-review`, `r15-040-style-remix` | 是 | `app-save-recovery` | 原型只经已批准材料 / import / Authoring Tool 边界交换数据；禁用或卸载后核心工作流和固定课例不变；失败零写入；没有任何核心节点依赖本节点 |

并行 frontier：材料链、PPTX 导入、Style Remix、内容 QA 和 OpenMAIC 评估可并行。`r15-050-content-qa` 与 `r15-060-release` 明确不依赖 `r15-900-*` / `r15-901-*`。

## 接口与数据合同

- `r15-005-workspace-identity` 单独定义共享 `WorkspaceIdentityV1 = projectId + normalizedPath`；材料域和后续 AI 会话域都依赖它，各自不得重复定义 workspace key。
- 本地材料目录使用版本化 metadata + content / index，并以共享 WorkspaceIdentity 为 owner；材料缓存、搜索索引、解析 trace 均不写入 `.h5lesson`。
- 课程中的引用是普通 V9 可见内容，至少保留显示标签和来源定位；本地原材料被删除后，已经提交的课程正文 / 引用仍由工程自身保存。
- PPTX importer 在内存 staging 完成 ZIP、关系、素材、继承和对象转换；母版/版式公共装饰在独立 Slide Surface 的共享层，实例正文在 scene。普通图文、线条、分组、裁剪图和未合并表格优先映射现有 Native。未支持对象、简化样式、行为省略及背景替代按页明确报告，教师确认后才部分导入；无可用对象、资源超限、损坏主文档或 stale 零写入。一次 document + sidecar 事务提交，可整体 Undo/Redo。不依赖 Office/LibreOffice、商业 SDK、网络服务或自动图片/PDF 转换；教师可自行从源软件导出图片，通过现有图片入口补入。
- Style Remix 复用的是重映射身份后的可编辑骨架与明确槽位，不复制隐藏 Recipe / runtime 状态。
- 内容 QA 返回 severity、rule ID、canonical target、message、evidence 与修复建议；QA 不自行更改答案或正文。
- OpenMAIC 桥接不得取得 CourseProject 私有写入口，也不得成为材料、Remix 或 QA 的默认实现。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/editorTransaction.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/coursewareAuthoringRunner.test.ts tests/unit/coursewareCaseBuilder.test.ts tests/unit/assessmentEvaluators.test.ts
npm run test:product -- tests/unit/courseProjectArchive.test.ts tests/unit/coursePptxExport.test.ts tests/unit/assetReferences.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线的统一验证与 S2 Owner 发布门；OpenMAIC 测试不得加入核心命令链。

## PPTX 增强收口顺序

Owner 已决定取消自动图片后备及本地渲染后端，不再把它们作为 1.5 或后续版本的发布依赖。既有删除/线条证据继续有效；新增原生映射按以下顺序收口。

1. `r15-031-pptx-owner-contract` 固定母版/版式/占位符与共享层、实例、导出叠放的映射；不扩 Schema。
2. `r15-032-pptx-inheritance` 交付继承与共享层；`r15-033-pptx-common-native` 补普通图文、线条、分组、裁剪和现有 Native Table 对应的普通表格。当前 Native Table 没有合并单元格字段，合并表格明确提示，不静默拆坏。
3. `r15-037-native-frame-sync` 与 `r15-038-pptx-common-mapping-repair` 修复真实课件暴露的同步接受域和普通映射；`r15-036-pptx-closure` 验证逐页转换清单、部分导入确认、单次资源事务、保存重开、Player 和适用导出，并补齐实际呈现中发现的普通文字裁剪；更新固定课例与能力声明。
4. `r15-060-release` 仍由 S2 Owner 教师验收，工程候选不替代 accepted。取消后备不意味着接受普通内容无故遗漏。

1.6补PPT另存为导入、下标/透明图片/翻转文字与合并表格闭环；1.7补复杂形状/渐变与图表；1.8补旧公式与简单SmartArt；1.9补媒体/简单效果；2.0做实际教学生产验收。未支持项持续明示，复杂对象可由教师在源软件另存图片后补入。详见[增强计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。

真实课件反馈后的阶段顺序与193次跳过分类见[整改计划](../../PPTX_IMPORT_ENHANCEMENT_PLAN.md)。r15-037/r15-038属于S2前必须修复的当前可用性缺陷，不能推迟到AI主线之后；1.6的.ppt另存为入口不恢复已取消的图片渲染后备。
