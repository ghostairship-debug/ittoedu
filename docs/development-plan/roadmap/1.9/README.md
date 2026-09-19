# 1.9：目录会话、自然创作与完整工作台交付

日期：2026-09-18。**唯一当前实施入口：[1.9 完整实施方案 F00–F08](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)。** 本轮只重建文档，不实现、不运行测试。后续 AI 获得实现指令后按主方案接手至050/051/060，不能以专项UI完成代替1.9完成。

## 结果与边界

工作空间是真实目录，项目为可选文件夹；会话归目录，文件是发送时冻结的编辑目标。无课件仍能聊天/材料处理/文档编辑/恢复。打开文件不换会话；课件默认当前页，选择自动缩为当前选择，输入上方单一自动目标提示。材料通过路径、@、附件或粘贴使用；/菜单与复制等基础交互真实可用。默认按任务推进，只有用户要求先审具体制品时停点，不强制课例注册、导入向导或四阶段文稿。

工作台高频轻改与编辑器模式精修共用同一工程、选择、历史、任务；自由停靠与标签变化不重置状态。既有046–048正文/Flow/可编辑Word数学、045三格式原格式消费、049文件共编与051媒体效果全部保留。本版无旧格式迁移；不扩多工程并行编辑、Office内嵌原格式编辑、通用模型平台或长期专项。

U01–U10及各分项已有实现，[历史证据](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)按相关变化复用。046–048、051 核心规格不重写，以各文首状态横幅为准，禁止从零重做。[有限收尾](../../reviews/2026-09-17-r19-limited-closeout.md)与[候选记录](../../reviews/2026-09-17-r19-final-candidate.md)明确050/060及原revision27返回入口尚未闭合；不把新目标记为已实现或重做未受影响成果。

合同：[目录会话与文件](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)、[正文/源文/数学](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)、[架构](../../ARCHITECTURE_CONTRACT.md)。设计依据：[V3.1及最新交互](../../../../双形态UI设计/00-设计说明.md)；审查决定：[汇总](../../reviews/2026-09-18-r19-workbench-review-and-interaction-summary.md)。早期讨论只保留来源，不覆盖上述最新决定。

## 任务 DAG

以下13个节点的ID、Dependencies、Optional和粗写锁保持；更新用户结果与验收语义。F编号是当前实施分组，不是第二套版本DAG或预建任务卡。

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-040-session-persistence-deletion` | 目录会话恢复、损坏隔离和范围删除 | `r18-060-release`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 指定目录/会话可重开；损坏隔离、停止/删除正确，首存/另存不串目标、不删真实文件。 [完整规格](r19-040-session-persistence-deletion.md) |
| `r19-041-session-navigation` | 目录导航、自然聊天与两种编辑位置 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity` | 否 | `chat-ui`, `ai-session`, `workspace-shell`, `props-shared` | 项目/会话管理、单一目标提示、复制与/和@菜单真实可用；四向布局/双位置状态连续。 [完整规格](r19-041-session-navigation.md) |
| `r19-042-draft-workspace-continuity` | 目录归属与文件编辑身份连续性 | `r19-040-session-persistence-deletion` | 否 | `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload` | 无课件可工作；首存不换会话；另存/移动/复制/失败及迟到目标正确。 [完整规格](r19-042-draft-workspace-continuity.md) |
| `r19-043-long-task-context` | 原生长任务恢复、缓存失效与真实耗时 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r19-044-course-creation-workflows`, `r19-045-material-context` | 否 | `ai-session`, `cli-adapters`, `chat-ui` | 压缩/重启/切CLI重读任务当前文件、材料及有效决定；不重放已提交内容，性能有事实。 [完整规格](r19-043-long-task-context.md) |
| `r19-044-course-creation-workflows` | 按任务创作与明确制品审阅 | `r19-042-draft-workspace-continuity`, `r19-045-material-context`, `r18-104-builder-skill-discovery`, `r19-049-document-file-coauthoring` | 否 | `contracts-schema`, `ai-session`, `chat-ui`, `generated-index`, `store-kernel` | 默认从材料/主题持续交付；仅用户要求先审稿时暂停，当前稿变更使旧批准/候选失效。 [完整规格](r19-044-course-creation-workflows.md) |
| `r19-045-material-context` | 材料直达、结构化读取与出处 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r15-020-material-tools-citations` | 否 | `main-preload`, `contracts-schema`, `generated-index`, `workspace-shell` | 路径/@/附件/粘贴无需向导；PDF/DOCX/PPTX分别真实读取消费，独立材料可携带。 [完整规格](r19-045-material-context.md) |
| `r19-046-shared-document-contract` | 定义统一正文、源文、数学与双保存接口 | `r18-060-release` | 否 | `contracts-schema`, `export-docx-print` | 唯一新正文/源文/数学/资源与接口具备严格样例，九类数学结构及Word试改证明转换，无旧格式兼容分支。 [完整规格](r19-046-shared-document-contract.md) |
| `r19-047-shared-document-editor` | 实现连续正文与源文共用编辑核心 | `r19-046-shared-document-contract` | 否 | `authoring-flow`, `workspace-shell` | 连续中文/公式/列表表格输入、选区、源文和分组撤销成立；只接窄保存接口，无第二工程History。 [完整规格](r19-047-shared-document-editor.md) |
| `r19-048-flow-document-delivery` | 交付新Flow正文、保存播放及可编辑Word数学 | `r19-047-shared-document-editor` | 否 | `contracts-schema`, `generated-index`, `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print`, `app-save-recovery` | 新根Schema与全部直接producer/consumer同批可运行；Flow保存/恢复、两预览、HTML、实际Word结构编辑及现有功能通过。 [完整规格](r19-048-flow-document-delivery.md) |
| `r19-049-document-file-coauthoring` | 普通Markdown文件编辑、恢复与AI共编 | `r19-042-draft-workspace-continuity`, `r19-041-session-navigation`, `r19-047-shared-document-editor` | 否 | `contracts-schema`, `main-preload`, `ai-session`, `chat-ui`, `workspace-shell`, `app-save-recovery` | 根目录/项目真实文件手改、AI实改、冲突恢复、选择性撤回与保存重开正确。 [完整规格](r19-049-document-file-coauthoring.md) |
| `r19-050-internal-dogfood` | 完整教师任务与连续编辑验收 | `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context`, `r19-048-flow-document-delivery`, `r19-049-document-file-coauthoring` | 否 | `chat-ui` | 同一工作台组合覆盖目录/目标、三格式、按任务/先审稿、双位置、Flow/Word、长任务与交付；关闭已知失败。 [完整规格](r19-050-internal-dogfood.md) |
| `r19-051-pptx-media-effects` | 增强内嵌媒体与可表达的简单演示效果 | `r18-051-pptx-editable-diagrams`, `r18-060-release` | 否 | `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx` | 支持范围媒体实际播放且可编辑，简单效果顺序/触发正确，离线HTML素材闭包。 [完整规格](r19-051-pptx-media-effects.md) |
| `r19-060-release` | 1.9工程候选收口与源码发布交接 | `r19-050-internal-dogfood`, `r19-051-pptx-media-effects` | 否 | `none` | 050/051及全部必选结果闭合，版本保全与源码一致；发布另按授权，S4在2.0。 [完整规格](r19-060-release.md) |

Dependencies只表示启动所需硬前置；稳定窄接口后的独立叶子可先准备，整节点完成仍须真实接线。040→042提供归属/目标；041提供容器，049消费041/047，045提供材料；044消费文件/材料事实，043接续，050验证组合，051独立汇入060。046–048、051有效证据不因重建计划自动失效。

## 实施、协调与版本门

- 按主方案批次A–E滚动执行：先固定共享身份与生命周期；基础缺陷/复制修复可立即独立推进；自然目标、目录文件AI、菜单与管理形成纵切；两种位置视觉从早期持续打磨；最后汇合完整教师链和媒体线。
- App/Chat、共享Schema、IPC/preload、保存/工程事务、依赖/索引只有唯一集成人写；多执行者必须有精确非重叠文件清单。单执行者不预建卡；只有实际协调状态写任务板。
- 用户主流程、文件/工程正确性优先于维护负担与预防性风险。现有首存假阳性、目录回复命中用户输入、旧模式选择器与skip逐项纠正，零匹配不算通过。
- 按 V01–V15 记录真正完成、已验、未验；无模型检查先行，真实CLI只跑与变化对应的命名场景。Codex/OpenCode实际Luna默认支持的Fast，Claude已确认DeepSeek；不擅换模型、不裸跑付费全矩阵。
- 完整版本保全门在060汇合，既有有效全集可复用；缺失范围必须补，不能以聚焦绿替代。源码候选 v1.9.0-rc.N 的实际发布另按授权，不签accepted、不发布安装器/固定课例HTML，软件HTML导出能力仍验。
- 2.0承担全软件内QA/修复及S4；不接收本版未完成的核心流程、三格式、Flow/Word或PPTX必选项。

后续交接按主方案第9节提供基线、已改/已验/未验、剩余问题与下一动作；本README不另存动态完成百分比。
