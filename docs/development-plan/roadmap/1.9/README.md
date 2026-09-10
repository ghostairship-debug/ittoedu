# 1.9：聊天创作工作台、材料与内置双流程

## 结果与边界

按[方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)和[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)，S3后同时交付完整软件工作流和创作策略：042未绑定聊天/未命名/首次保存，045材料解析与分片，044内置自动/手动与按阶段Skills，041聊天首页/画布/极简与专业模式，043长任务，050连续真实课例与瓶颈优化。复用1.8当前工程观察、编辑、回执与原生能力，不重建Harness或第二工程。

本版消费[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)在1.8的正确性、接口与完整终态成果。PNG夹具和失败恢复、用量映射、配置初始化、稳定输出Schema、消息分流、能力发现及已有组件patch的提示/发现矛盾仍在当前1.8原Owner关闭，不推迟到043或050；计划同步不代表这些修复已完成。043处理新增长任务与材料上下文，050处理连续课例中实际出现的瓶颈。

自动模式必须上传且成功读取课程材料，优先模板/设计；手动依次确认教学简报、策划、呈现简报与脚本。主聊天改页/场景/整课，局部AI绑定当前对象；既有工程打开真实画布，新建在首个完整画布产物提交后显示。极简与专业模式具备相同AI能力。

AI入口默认可见。身份/事务见[共同合同](../1.8/IMPLEMENTATION_CONTRACT.md)，本版形成v1.9.0-rc.N源码候选，不发布HTML或安装器。051 PPTX媒体/效果保持必选并列线，060等待AI与PPTX；S4在2.0签署。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r19-040-session-persistence-deletion` | 会话恢复、迁移/损坏隔离、Save As 隔离和范围删除 | `r18-060-release`, `r16-020-local-session-store` | 否 | `chat-ui`, `ai-session` | 真实重启/迁移/损坏隔离、三种删除与Save As隔离正确；恢复读取新事实，旧running/候选不重放。 [完整规格](r19-040-session-persistence-deletion.md) |
| `r19-041-session-navigation` | 交付聊天首页、项目会话导航与极简/专业共用AI工作台 | `r19-040-session-persistence-deletion` | 否 | `chat-ui`, `ai-session`, `workspace-shell`, `props-shared` | 聊天首页、项目/会话、既有画布立即打开与新项目首完整产物后显示；极简/专业保全手动及同等AI，局部与主聊天目标正确。 [完整规格](r19-041-session-navigation.md) |
| `r19-042-draft-workspace-continuity` | 实现未命名工程与首次保存的AI身份连续性 | `r19-040-session-persistence-deletion` | 否 | `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload` | 未绑定/draft/保存workspace各自明确；两draft隔离，首次保存切新身份以新观察继续目标，不复制原外部session/trace或重放候选。 [完整规格](r19-042-draft-workspace-continuity.md) |
| `r19-043-long-task-context` | 闭合长任务上下文压缩缓存失效与阶段性能诊断 | `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r19-044-course-creation-workflows`, `r19-045-material-context` | 否 | `ai-session`, `cli-adapters`, `chat-ui` | CLI原生长上下文/压缩后继续人工交替与目标正确；缓存失效、有限预算、停止恢复与阶段耗时可解释。 [完整规格](r19-043-long-task-context.md) |
| `r19-044-course-creation-workflows` | 内置自动材料与手动分阶段的整课创作流程 | `r19-042-draft-workspace-continuity`, `r19-045-material-context`, `r18-104-builder-skill-discovery` | 否 | `contracts-schema`, `ai-session`, `chat-ui`, `generated-index`, `store-kernel` | 已读材料自动推进与手动四阶段确认均在软件完成；共用完整必要Skills/Builder/模板/真实QA，普通修改不重走整课。 [完整规格](r19-044-course-creation-workflows.md) |
| `r19-045-material-context` | 实现课程材料结构化读取、分片发现与可追溯引用 | `r19-040-session-persistence-deletion`, `r15-020-material-tools-citations` | 否 | `main-preload`, `contracts-schema`, `generated-index`, `workspace-shell` | 原件/结构/页片段/原图/来源与已读状态真实；文本和已声明复合格式走通，未完格式明确交2.0，失败不假读。 [完整规格](r19-045-material-context.md) |
| `r19-050-internal-dogfood` | 以真实课例验证双流程连续创作与主要耗时优化 | `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context` | 否 | `chat-ui` | 双流程、材料、工作台、首存、重启/长任务与连续课例真实完成，定位优化主要耗时；不将外部Agent代做算内置通过。 [完整规格](r19-050-internal-dogfood.md) |
| `r19-051-pptx-media-effects` | 增强内嵌媒体与可表达的简单演示效果 | `r18-051-pptx-editable-diagrams`, `r18-060-release` | 否 | `app-save-recovery`, `store-slide`, `authoring-interaction`, `published-slide`, `export-pptx` | 支持范围媒体实际播放且可人工编辑；简单效果顺序/触发符合既有正式语义；离线HTML素材闭包正确。 [完整规格](r19-051-pptx-media-effects.md) |
| `r19-060-release` | 形成 1.9 engineering candidate 并发布 v1.9.0-rc.N 源码标签 | `r19-050-internal-dogfood`, `r19-051-pptx-media-effects` | 否 | `none` | 1.9所有必选节点通过且无未关闭核心流程/数据错误，源码候选与验证实现一致；AI与PPTX均完成。 [完整规格](r19-060-release.md) |

Dependencies只列开始开发的硬前置，完整节点仍须满足真实集成条件与Acceptance。040后由唯一Owner先确定身份、材料和阶段事件的必要窄接口，再并行推进042保存/身份叶子、045材料提取/查询与041基础工作台。044实际消费042/045/104；041阶段卡和首成果接线等真实044结果后集成。043依赖040/042/044/045，不再等待041整项UI。050汇合040–045，051 PPTX并列；共享合同、App/Chat/IPC由持锁Owner顺序集成，非重叠叶子按[执行安排](../../AI_ASSISTANT_DELIVERY_PLAN.md#31-并行写入安排)隔离委派。节点编号不是执行顺序。

## 接口与验证重点

- 复用本地版本化repository和唯一任务Owner；旧记录可查看、坏记录隔离，恢复后重新观察，旧running/候选不自动执行。
- 材料原件与结构索引分开，保留出处/图像，提供摘要、搜索和按页/片段读取；上传成功不代表内容已读；成功读取指有效原件、整体结构与本次教学范围的实际文本/原图齐备，无关附录不阻塞。复用现有解析器和CLI工具，不建向量平台。
- 未绑定聊天、draft、保存workspace分清；首存终止旧epoch、保存后以新身份/新观察继续目标，旧draft历史可读。Save As不复制会话，删除不承诺外部CLI记录。
- Skills按任务阶段读取完整必要指导/质量参考；不靠默认全量注入或压缩成几句损失质量。普通局部修改不重走整课策划。
- 长上下文由CLI原生处理，宿主提供当前目标、真实receipt和必要新观察；恢复区分已完成、部分完成、未完成与未落盘而无法确认的状态，不重放已提交步骤。精确编辑与复杂编辑分别报告首次正确可用结果和全任务终态，auto/preview、冷启动/连续会话及明确用户等待分开。细粒度源码补丁、增量观察和资源/检查复用仅在对应瓶颈实测成立时深化，不成为本版必建门。
- 局部检查按[准备与选择规则](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)只构建变化或缺失的必要制品、选择具体用例；条数不是充分性标准，0匹配/排除/跳过不算通过。材料看真实提取/原图，视觉互动看真实成品，恢复看真实生命周期。050集中连续用例，复用有效1.8证据，不反复跑付费矩阵。
