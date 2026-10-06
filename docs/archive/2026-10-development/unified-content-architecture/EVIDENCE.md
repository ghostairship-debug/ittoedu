> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../development-plan/CURRENT_STATUS.md)。

# 事实依据、取舍与讨论追踪

日期：2026-10-03。本文保留方案讨论阶段的调查依据，不作为产品完成证明。以下“现状”指启动本轮实施之前的源码快照；对应入口与合同已有后续变化，当前实现和检查见[实施记录](EXECUTION_LOG.md)。早期记录只解释历史范围，不替代今天的源码；实施始终保留原有未提交变化。

## 1. 现状与结论限度

| 已核实事实 | 主要依据 | 对方案的影响 |
|---|---|---|
| 通用 Agent 已支持动态 Skill；教学不是系统提示词必走流程 | [ExecutionEngine](../../../../src/main/workbench/execution/ExecutionEngine.ts)、[ScopedSkillService](../../../../src/main/workbench/skills/ScopedSkillService.ts) | 不从零重建 harness，不把 HTML-first 描述为所有任务的硬规则 |
| 内置课件 Skill bundle 有两套 Skill、8 个 Markdown 资源，无脚本；工作空间另有研究/数据 Skill | [bundledSkills](../../../../src/shared/generated/bundledSkills.json)、[workspace skills](../../../../.agents/skills)、[生成器](../../../../scripts/generate-ai-capabilities.ts) | “当前以内置说明为主”成立；“完全没有可执行能力”不成立 |
| Skill 读取与作业执行是两件事 | [SkillTools](../../../../src/core/tools/SkillTools.ts)、[ComputeJobService](../../../../src/main/workbench/compute/ComputeJobService.ts) | 按需知识与执行后端复用，脚本不是所有 Skill 的必需内容 |
| 当前 build Skill 仍要求模型创建、导入、保存 | [build Skill](../../../../.agents/skills/build-courseware-project/SKILL.md) | 已知机械流程应下沉软件 |
| `html.import` 受当前可写整课目标过滤；打开/创建目标会更新目录 | [ToolCatalog](../../../../src/core/tools/ToolCatalog.ts)、[ExecutionEngine](../../../../src/main/workbench/execution/ExecutionEngine.ts) | 能力存在与就绪条件应分别呈现；软件负责准备目标 |
| 导入服务已处理资源、拆页/默认映射、包装、身份与候选应用 | [HtmlImportToolService](../../../../src/main/workbench/htmlImport/HtmlImportToolService.ts)、[prepareHtmlCourseCandidate](../../../../src/main/workbench/htmlImport/prepareHtmlCourseCandidate.ts)、[HtmlImportService](../../../../src/main/workbench/htmlImport/HtmlImportService.ts) | 复用既有自动化，不描述为模型目前需要手写所有参数 |
| 已有宿主自行绑定 target 并应用文本的路径 | [AgentFileText](../../../../src/main/workbench/execution/AgentFileText.ts)、[EditSessionService](../../../../src/main/workbench/execution/EditSessionService.ts) | 内容输出/软件应用有现成接入点 |
| 三表面已共享正式工程、身份、事务、资源与发布基础 | [架构合同 §5](../../../development-plan/ARCHITECTURE_CONTRACT.md#5-surface-carrier-矩阵)、[DocumentSession](../../../../src/core/documents/DocumentSession.ts) | 新增统一集中在组合、持续布局及编辑，不是推倒三个独立内核 |
| LayerItem 的 frame 为绝对几何，Flow 已有共享正文与流式布局 | [V9 Schema](../../../../src/shared/contracts/course-project-v9/schema.ts)、[共享正文](../../../../src/shared/document/content.ts)、[FlowWorkspace](../../../../src/renderer/ui/FlowWorkspace.tsx) | 不能说所有现有内容都是固定坐标；正文语义应复用 |
| Slide 已有 320–8192 自定义尺寸、多个比例，但同课程尺寸一致 | [slideCanvas](../../../../src/shared/slideCanvas.ts)、[属性面板](../../../../src/renderer/ui/properties/CourseGlobalPropertiesPanel.tsx)、[Published Schema](../../../../src/shared/contracts/published-course-v2/schema.ts) | 新范围是持续关系、响应式和按页覆盖，而非首次自定义比例 |
| 当前 Slide 改尺寸为整体比例缩放/居中；Flow、Spatial 已分别有宽度和相机语义 | [resizeSlideCanvas](../../../../src/core/course/resizeSlideCanvas.ts)、[flowBodyPresentation](../../../../src/shared/flowBodyPresentation.ts)、[V9 Schema](../../../../src/shared/contracts/course-project-v9/schema.ts) | 坐标保留，新增布局规则；缩放、目标规格和世界相机分开 |
| 图文轻编辑已存在，但不能据此宣称任意 HTML 结构/CSS/JS 深编辑 | [DocumentToolGateway](../../../../src/core/tools/DocumentToolGateway.ts)、[HtmlPreviewPane](../../../../src/renderer/documentFiles/html/HtmlPreviewPane.tsx)、[htmlSourceLocator](../../../../src/main/workbench/htmlPreview/htmlSourceLocator.ts) | 重构必须证明可持久的结构/样式修改，而不只证明 DOM 可选中 |

最初“无法机械导入”的会话样本中，未建立课件目标，创建/打开的是普通 HTML，反复发现 build 能力但没有实际调用 `html.import`。本次结合上述目录与软件链路，将其定性为入口/编排阻断证据；不将未尝试的后端记为运行失败。此样本结论来自此前会话轨迹，本轮没有重新发模型或复现原运行。

## 2. 浏览器与多格式现状

| 已核实事实 | 依据 | 结论 |
|---|---|---|
| 接管按钮按任务 running/API 存在显示，未要求已导航页面或实际登录需要 | [ExecutionAssistant](../../../../src/renderer/workbench/ExecutionAssistant.tsx) | 出现按钮不证明需要登录 |
| 接管只传身份/动作，宿主暂停后可惰性创建浏览器；控制代码只置前不导航 | [ExecutionDesktopService](../../../../src/main/workbench/execution/ExecutionDesktopService.ts)、[ManagedBrowserMcpService](../../../../src/main/workbench/externalTools/ManagedBrowserMcpService.ts)、[managedBrowserControlCode](../../../../src/main/workbench/externalTools/managedBrowserControlCode.ts) | 无网页任务点击后出现空白页有源码解释；本轮未启动产品复现 |
| 受管任务浏览器为外部隔离 Edge；Provider OAuth 使用系统外开 URL | [ManagedBrowserMcpService](../../../../src/main/workbench/externalTools/ManagedBrowserMcpService.ts)、[executionSettingsService](../../../../src/main/workbench/providers/executionSettingsService.ts) | 两者不是同一种登录，使用独立会话有功能理由；入口缺上下文是另一问题 |
| 已有 HTML iframe 预览与图文轻编辑、任务 HTML 隐藏窗口预览 | [HtmlPreviewPane](../../../../src/renderer/documentFiles/html/HtmlPreviewPane.tsx)、[TaskHtmlPreview](../../../../src/main/workbench/observation/TaskHtmlPreview.ts) | 准确说法是尚未找到内嵌通用任务网页/登录面板，不能说没有任何内置浏览器渲染 |
| PDF 页面渲染/提取与 Office 材料提取已存在 | [materialExtraction](../../../../src/renderer/project/materialExtraction.ts)、[AttachmentService](../../../../src/main/workbench/attachments/AttachmentService.ts) | 材料阅读不等于完整格式编辑；PDF/图片视图可独立推进 |
| 正式 DocumentModel 当前为 markdown/text/course-v9 | [document](../../../../src/shared/workbench/document.ts) | Office 不能仅改扩展名就接入正式文档编辑 |
| 计算服务支持代码/程序参数，但实际后端使用 WSL/Podman 固定镜像 | [ComputeJobService](../../../../src/main/workbench/compute/ComputeJobService.ts)、[PodmanComputeBackend](../../../../src/main/workbench/compute/PodmanComputeBackend.ts) | Office 的可分发执行环境仍需实际接通 |
| 制品交付路径是 create-only；既有文件有单独协调/保存 owner | [HostArtifactDeliveryService](../../../../src/main/workbench/execution/HostArtifactDeliveryService.ts)、[DocumentFileCoordinator](../../../../src/main/workbench/DocumentFileCoordinator.ts)、[DocumentDeliveryService](../../../../src/main/workbench/delivery/DocumentDeliveryService.ts) | 原位 Office 修改需受控替换，不能复用 create-only 接口越权覆盖 |

## 3. 历史与当前路线取舍

最早可见提交 `de10d036`（2026-07-23）已称版本 1.6.0，不能当作软件诞生日。其 README 已采用 AI-native、工程模型为真相、高频人工编辑、Runtime 复杂一次性行为、Component 可复用逻辑，以及可替换 DOM/Phaser/Three 的路线。历史作者指南要求稳定内容优先原生，以保护教师直接修改。

2026-09-16 的[编辑优化报告](../../2026-09-l06-inputs/Guoling_AI_Editing_Optimization_Report_2026-09-16.md)讨论了 GrapesJS 的 traits 等做法，但明确避免在已有工具/Schema/组件基础上再造平行注册表。后续[2.0 收敛方案](../../2026-09-convergence/果铃2.0收敛方案.md)将 HTML 收敛为保真 Runtime 承载和有限图文修改，没有承诺任意 Web 深编辑。

**可以得出的事实**：Web 从未完全缺席；现有路径主动优先高频结构编辑、课件状态和工程交付。**不能得出的结论**：当初全面评估并证明可视化 Web 编辑器不适合；或者早期完全没有考虑 AI。没有找到相应决策记录，停止继续深挖历史。

### 3.1 三条路径的现实取舍

| 路线 | 优势 | 主要成本/边界 | 本方案选择 |
|---|---|---|---|
| 有限 Native 增强，所有输入转换进去 | 专业语义清楚，既有直接编辑/导出易延续 | 新视觉能力需要不断补类型；自由 HTML 容易丢表达 | 保留其专业节点，不以有限类型穷尽全部内容 |
| 结构化 Web/组件与专业节点融合 | 标准表达与浏览器布局可复用，结构/样式可视编辑和资产化有共同基础 | 需实现唯一来源、CSS 作用域、自动布局操作及格式映射 | 主推荐路线 |
| 任意源码永久为整份唯一工程 | Web 表达自由，保留程序容易 | 任意运行 DOM 到源码/专业含义的逆向映射困难，持续可视编辑不保证 | 作为必要程序区域的能力，不强迫整课都采用此形态 |

这些是基于当前目标的架构判断，不是性能/质量实测排名。采用浏览器不自动提升创作质量，GrapesJS 等库也不自动解决专业对象和现有生命周期。

## 4. 讨论到方案的追踪

| 用户提出的问题 | 本方案回答 | 工作包 |
|---|---|---|
| 导入为何不可用，能力发现是否过度 | 能力存在与目标就绪分开；纯机械流程由软件完成 | U01、U02 |
| Skill 是否主要是 MD，是否应有脚本 | 当前课件 bundle 以 MD 为主，但已有执行后端；脚本按实际重复价值加入 | U02、W04 |
| 模型应只专注内容 | 已知目标专用内容输出；软件负责身份/资源/应用/保存；开放任务保留行动 | U01 |
| 重型编辑器为何被 HTML 导入架空 | 增强正式结构、布局、专业编辑与复用，避免整页只能轻改 | U03–U05、U08、U10 |
| 不写坐标如何表达布局 | HTML/CSS 或内容关系表达设计，浏览器计算几何；自由摆放仍存在 | U03、U05 |
| 原生节点使用什么逻辑 | 原生保留专业数据，外部可自由/自动布局；Web 自由定位仍写 CSS | U03、U05 |
| 能否统一三表面与比例 | 统一共享内容/布局/编辑；保留分页、阅读流、世界相机；响应式与按页尺寸分别定义 | U06、U07、U09 |
| 是否本质走向可视化 Web 编辑器 | 采用结构化可视编辑路线，区分作者表达、正式来源与呈现方式 | 总方案 §6、U03 |
| 第三方 HTML 编辑是否增强 | 结构/样式/布局能力增强，动态部分按真实来源可编辑范围接入 | U08 |
| 如何积累优质资产并超越裸 HTML | 从真实作品提炼可变边界，软件打包，在第二份内容中证明价值 | U10、Q03、Q04 |
| 接管浏览器按钮与内嵌浏览器 | 先修真实任务交接，后接同一内嵌页面实例；OAuth 分开 | W01、W02 |
| PDF/图片预览和轻编辑 | 专业查看/编辑/保存独立推进，不依赖浏览器嵌入 | W03 |
| Office 三件套能否同样扩展 | 相同 Skill/任务/交付原则，保留各自原格式与专业执行 | W04 |

## 5. 外部参考

以下来源在本会话调查，用于支持公开可证实的做法，不据此推断各产品私有架构。

- WorkBuddy 的 [Skill 文档](https://open.workbuddy.cn/docs/skill)和[连接器文档](https://open.workbuddy.cn/docs/connector)支持用专业说明、脚本/资源与外部执行能力组合。它们不能证明已实现“模型完全不调用应用接口”。
- Kimi 的 [Skills 说明](https://www.kimi.com/en/help/plugins-and-skills/what-are-skills)将专业知识与可选脚本/资源组织为按需使用的能力；不据此推断所有格式的内部编辑模型。
- ChatGPT 的 [Build skills](https://learn.chatgpt.com/docs/build-skills)说明短元信息、按需指引和可选资源/脚本。这支持渐进加载，不等于把确定应用流程都留给模型或都下沉软件。
- 豆包办公方向参考飞书的[相关公开介绍](https://www.feishu.cn/content/article/7677519271848610746)，只能支持其公开工作/技能与连接器方向。它不是豆包全部办公功能的内部技术文档，不能据此声称采用某种统一 DOM/Office 内核。
- GrapesJS 的 [Storage](https://grapesjs.com/docs/modules/Storage.html)与[Components](https://grapesjs.com/docs/modules/Components.html)文档说明项目数据/组件模型与导出 HTML 的区别。这证明“可视化 Web 编辑器＝原始 HTML 唯一真相”并非必然关系；本方案尚未选定 GrapesJS。
- [MDN Viewport concepts](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/CSSOM_view/Viewport_concepts)说明媒体查询、视口单位与嵌套浏览上下文的关系。由此推导：作品目标尺寸必须接到真实 viewport，仅调整宿主中的普通容器宽度不足以保证第三方响应式语义。

## 6. 调查时列出的待证明事项

- 同提示词下创作质量是否不弱于裸 HTML，以及资产增强后的收益幅度。
- 具体解析/组件基础库能否保留所需 CSS、源码定位和持续编辑；不以库的宣传代替当前 consumer 证据。
- 混合 DOM/SVG/Canvas 的真实选择、层叠、尺寸传播与互动生命周期。
- 同页内嵌浏览器的自动化接线、Office 可分发执行环境与逐格式交付。

上述项进入了对应工作包；后续实现与通过/失败结果见 EXECUTION_LOG，不能把此处的历史待证清单作为当前进度。质量比较仍须区分首稿与人工介入，不通过增加防御门、全矩阵或历史版本平台处理不确定性。
