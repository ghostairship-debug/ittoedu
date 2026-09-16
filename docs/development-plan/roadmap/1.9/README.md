# 1.9：真实工作空间、文档共编与课件连续创作

## 结果与边界

2026-09-15 Owner 已明确：真实工作空间前置，教师自由组织大目录，每个课例独立；命名后创建课例，一条对话贯穿；左上目录、左下课例/对话、中间聊天、右侧材料/教学文档/课件标签。PDF、DOCX、PPTX三类材料分别实际读取与创作消费，整理为课例内独立正文、必要图示和出处。

**Flow 连续编辑、右侧教学文档复用和可编辑 Word 数学导出整体为 1.9 正式交付范围。Owner 最新明确没有兼容需求；本次直接采用统一新正文/课例结构，不实现旧Flow、旧工程或旧记录迁移。** 当前实施进度、剩余范围与证据入口统一见[总实施方案第4节](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)，实际协调状态只看任务板。

执行入口：[总实施方案](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md)、[正文/源文/数学合同](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)、[课例/文件/共编合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)。[讨论纪要](../../R19_WORKSPACE_AUTHORING_DISCUSSION_20260915.md)保留决定来源，早期双格式/首次保存换课例等建议已由新合同替代。

自动流程必须采用并成功读取材料，材料可来自工作空间已有文件或新增文件；手动流程分别确认教学简报、策划、呈现简报和脚本。四阶段正文是真实文件，确认绑定当前稿及附件。两种流程共用原生CLI与唯一工程事务，当前外部Skill的停点到044实际路由改造时再同步。

Runtime位置编辑与持续AI深化仍为[长期路线](../../AGENT_AUTHORING_LONG_TERM_PLAN.md#91-长期路线候选2026-09-15-owner决定)，不新增本版依赖。既有PPTX媒体/效果线保留。1.9形成v1.9.0-rc.N源码候选，不发布安装器或固定课例HTML制品；软件的离线HTML导出能力仍须验收，S4在2.0。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-040-session-persistence-deletion` | 课例对话恢复、损坏隔离、工程另存隔离和范围删除 | `r18-060-release`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 新课例记录重启/继续、损坏隔离、删除和工程另存隔离正确；不迁移旧记录，不删真实文件。 [完整规格](r19-040-session-persistence-deletion.md) |
| `r19-041-session-navigation` | 交付真实工作空间入口、课例导航与整合标签工作台 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity` | 否 | `chat-ui`, `ai-session`, `workspace-shell`, `props-shared` | 真实工作空间→命名课例→左侧目录/课例对话→右侧标签可用，窄宽窗口与极简/专业保全；阶段和共编由044/049接入。 [完整规格](r19-041-session-navigation.md) |
| `r19-042-draft-workspace-continuity` | 实现真实工作空间、课例身份与工程保存连续性 | `r19-040-session-persistence-deletion` | 否 | `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload` | 课例创建即归属，首次工程保存对话不断；取消/失败/另存/移动/复制/迟到目标均正确。 [完整规格](r19-042-draft-workspace-continuity.md) |
| `r19-043-long-task-context` | 闭合长任务上下文压缩缓存失效与阶段性能诊断 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r19-044-course-creation-workflows`, `r19-045-material-context` | 否 | `ai-session`, `cli-adapters`, `chat-ui` | 压缩/重启/切CLI重读当前文档、附件、确认和工程事实；已完成不重放，耗时按真实证据记录。 [完整规格](r19-043-long-task-context.md) |
| `r19-044-course-creation-workflows` | 内置自动材料与手动分阶段的整课创作流程 | `r19-042-draft-workspace-continuity`, `r19-045-material-context`, `r18-104-builder-skill-discovery`, `r19-049-document-file-coauthoring` | 否 | `contracts-schema`, `ai-session`, `chat-ui`, `generated-index`, `store-kernel` | 实际读取材料后自动推进；手动四阶段分别确认真实文件，当前稿变化阻止旧稿在途构建；本版生成/修改流程可用。 [完整规格](r19-044-course-creation-workflows.md) |
| `r19-045-material-context` | 实现课程材料结构化读取、分片发现与可追溯引用 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r15-020-material-tools-citations` | 否 | `main-preload`, `contracts-schema`, `generated-index`, `workspace-shell` | PDF/DOCX/PPTX及文本均产出课例内独立正文/必要图示/出处；原格式各自真实读取消费，移动共享原件不影响已整理材料。 [完整规格](r19-045-material-context.md) |
| `r19-046-shared-document-contract` | 定义统一正文、源文、数学与双保存接口 | `r18-060-release` | 否 | `contracts-schema`, `export-docx-print` | 唯一新正文/源文/数学/资源与接口具备严格样例，九类数学结构及Word试改证明转换，无旧格式兼容分支。 [完整规格](r19-046-shared-document-contract.md) |
| `r19-047-shared-document-editor` | 实现连续正文与源文共用编辑核心 | `r19-046-shared-document-contract` | 否 | `authoring-flow`, `workspace-shell` | 连续中文/公式/列表表格输入、选区、源文和分组撤销成立；只接窄保存接口，无第二工程History。 [完整规格](r19-047-shared-document-editor.md) |
| `r19-048-flow-document-delivery` | 交付新Flow正文、保存播放及可编辑Word数学 | `r19-047-shared-document-editor` | 否 | `contracts-schema`, `generated-index`, `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print`, `app-save-recovery` | 新根Schema与全部直接producer/consumer同批可运行；Flow保存/恢复、两预览、HTML、实际Word结构编辑及现有功能通过。 [完整规格](r19-048-flow-document-delivery.md) |
| `r19-049-document-file-coauthoring` | 交付真实Markdown文件编辑、恢复与AI共编 | `r19-042-draft-workspace-continuity`, `r19-041-session-navigation`, `r19-047-shared-document-editor` | 否 | `contracts-schema`, `main-preload`, `ai-session`, `chat-ui`, `workspace-shell`, `app-save-recovery` | 真实.md与附件保存重开、外部冲突、恢复、AI直接改稿/部分撤回和当前稿版本接口可用。 [完整规格](r19-049-document-file-coauthoring.md) |
| `r19-050-internal-dogfood` | 以真实课例验证双流程连续创作与主要耗时优化 | `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context`, `r19-048-flow-document-delivery`, `r19-049-document-file-coauthoring` | 否 | `chat-ui` | 真实工作空间连续课例覆盖040–049、三格式各自消费、双流程、Flow/文档/Word和接续；完整组合不能用局部成功替代。 [完整规格](r19-050-internal-dogfood.md) |
| `r19-051-pptx-media-effects` | 增强内嵌媒体与可表达的简单演示效果 | `r18-051-pptx-editable-diagrams`, `r18-060-release` | 否 | `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx` | 支持范围媒体实际播放且可编辑，简单效果顺序/触发正确，离线HTML素材闭包。 [完整规格](r19-051-pptx-media-effects.md) |
| `r19-060-release` | 形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签 | `r19-050-internal-dogfood`, `r19-051-pptx-media-effects` | 否 | `none` | 本版所有必选线闭合且无核心流程/数据错误，形成真实engineering candidate；发布另按授权，S4在2.0。 [完整规格](r19-060-release.md) |

Dependencies只列启动所需硬前置，稳定窄接口后的独立叶子可按工作协议提前准备，整节点完成仍须真实接线。按[滚动批次与并发写域](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)连续执行，不设整批等待屏障：040→042与047、051可并行；042接口稳定后041/045叶子接续，049消费041容器和047核心，不等048全部导出，047不反等049。044消费049当前稿、045读取事实和042身份；043接续，050汇合完整组合。060经050/051覆盖全部必选线。

041只拥有导航/标签容器，044拥有阶段和首成果接线，049拥有文档编辑与共编；050证明真实组合。共享Schema、App/Chat、IPC、工程事务、依赖锁文件与生成物由唯一集成人顺序修改；045/051共用PPTX解析也只有一个writer。实际并行使用隔离工作区和精确文件写域；048根Schema与全部直接consumer仍需同批可运行切换。验证复用规则统一见[总方案第6节](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#6-最小充分验证与证据复用)，不在各叶子重复完整矩阵。

## 接口与验证重点

- 课例身份与工程修改目标分开：创建课例即可开始对话/文档，第一次工程保存只绑定文件并更新编辑epoch；另存新工程不复制原候选/会话句柄。
- 新Flow统一inlines和LaTeX，含正文/表头/说明等字段；源文对象和资源有严格映射，稳定ID、选择/复制/导航遵循同一语义。无旧格式分支，不删除其他Surface正在使用的Native能力。
- 真实Markdown是文件当前稿，工程是唯一V9文档；各有保存/恢复Owner。AI改稿直接更新可定位部分，撤回保留之后手改，外部冲突不静默覆盖。
- 确认与在途构建核对真实文件/附件版本；改稿后旧确认不能继续放行旧脚本候选。压缩/重启/切CLI重读当前文件，不靠聊天摘要复原正文。
- 046尽早验证数学结构→实际Word，048闭合Flow全部真实consumer；代码/链接/复杂对象、打印中间层、工具/Builder/动态准入空正文均不能遗漏。
- 三格式各自读取必要正文/图示并消费；索引、上传、纯文本提取或另一格式成功不能代替。课例搬迁后材料仍独立可用。
- 按[聚焦验证规则](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)准备一次适用制品并执行命名用例；不重复未受影响证据，不把零匹配/跳过算通过。需要真实模型只用Luna及实际支持的Fast。
