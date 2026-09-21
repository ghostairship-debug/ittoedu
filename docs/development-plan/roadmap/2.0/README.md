# 2.0：软件内完整创作、速度与成品质量

## 结果与边界

2026-09-21执行状态：上下文共编、内置方法、首次外部处理说明、记录清理、CLI 诊断与帮助已进入工程候选。Markdown 和原生课件的三 CLI 实测、Flow 精确选区、PPTX 7 项及保全 27 项通过，详见[当前验收记录](../../reviews/2026-09-21-r20-contextual-acceptance.md)。020/040 整课完整生产链、025 指定插件对照、030 实际读屏与 050/060 尚未闭合。继承已签收的 1.9 内部 RC 的目录会话/文件目标与按任务创作，明确审稿才暂停，不恢复固定四稿或简洁/专业分档。

上下文编辑纵线按[1.9.1–2.0实施方案](../../R19_1_TO_R20_CONTEXTUAL_AUTHORING_PLAN.md)分阶段接入：1.9.1–1.9.3先闭合选区目标、Markdown 人工卡片和 Markdown 选区 AI，1.9.4接入 Flow；2.0 的 `r20-020-public-authoring` 汇合软件内生产闭环、三表面适配、质量/速度和最终验收。选区仍是会话态目标，不新增持久化 paragraph 对象或第二套工程历史。

按[方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)和[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)，教师从材料处理、教学设计、呈现、生成、修改到实际QA、修复、保存重开与导出都通过软件完成，无需另开外部AI/终端/Builder。021交付完整内置Skills及按需质量参考，022材料与数据控制，020接齐生产全链条并解决实际速度/质量瓶颈。

原生CLI加GUI是长期架构；相同账号/模型/配置/授权下保留文件、终端、网络、工具与连接、Skills和子任务。025比较CLI能力及有限真实插件/外部开发基线，证明GUI和内置工作流未降低课件能力/质量；对照只用于开发验收，不进入教师日常流程。不逐项复制IDE专有面板，也不据此裁剪原生CLI权限。

常见Native秒级、代表动态分钟级、标准整课30分钟内按冻结任务/材料/模型及完成口径实测；同时看材料准确、知识获得路径、视觉、互动、可编辑交付。报告分阶段/总耗时和失败，少量真实运行不宣称可靠p95，不用首屏时间冒充整课完成。整课计时从原件上传完成且用户启动任务开始，包含材料解析和必要图像理解；手动教师等待单列。

精确编辑与复杂编辑分别报告首次正确可用结果及全任务结束，auto/preview、冷启动/连续会话分桶，并单列明确用户等待。具体事件、用量和有限对照口径沿开发计划与[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)，不另设秒数或百分比门。

产品仍为内部生产版；原生CLI管理认证，应用不复制凭据、不自建模型循环。历史ID的public只是稳定标识。既定首次使用说明和数据控制保留。041 PPTX为独立必选线，普通PPTX不依赖外部转换软件；旧PPT转换和复杂特性边界保持。

050由Owner实际S4签署，060发布同一v2.0.0源码与固定课例离线HTML。HTML签署前生成并冻结，签署后不重生成；无安装器。AI不可用时人工编辑/保存/Player/导出仍正常。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r20-000-public-governance` | 冻结内部生产支持矩阵数据边界与发布政策 | `r19-060-release` | 否 | `contracts-schema`, `generated-index`, `workspace-shell` | 支持矩阵由真实能力与当前源码生成/核实，三CLI共同任务可完成；人工编辑在所有AI不可用状态继续。 [完整规格](r20-000-public-governance.md) |
| `r20-010-cli-setup-ui` | 完善CLI安装登录诊断与既有模型控制的生产设置 | `r20-000-public-governance`, `r16-030-cli-lifecycle` | 否 | `workspace-shell`, `cli-adapters` | 三CLI分别从可用/缺失状态完成设置与恢复，真实模型配置生效；错误能定位到下一步动作。 [完整规格](r20-010-cli-setup-ui.md) |
| `r20-011-first-use-risk-notice` | 首次外部 CLI 使用前显示一般数据发送风险并记录本地确认 | `r20-000-public-governance` | 否 | `workspace-shell` | 首次发送说明与实际引用一致；取消无外部启动/发送，确认只留应用本地且可查。 [完整规格](r20-011-first-use-risk-notice.md) |
| `r20-020-public-authoring` | 完成软件内部整课创作闭环与速度质量优化 | `r20-010-cli-setup-ui`, `r20-011-first-use-risk-notice`, `r18-046-stop-undo-stale`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls` | 否 | `chat-ui`, `store-kernel`, `ai-session` | 所有课件步骤在软件内部完成；三表面Native/Component/Runtime实际生成、修改、QA修复、保存重开与导出，标准任务速度和质量有证据。 [完整规格](r20-020-public-authoring.md) |
| `r20-021-profile-controls` | 完成课件Skills内置交付与同源按需加载 | `r20-000-public-governance`, `r18-050-three-cli-benchmark`, `r18-104-builder-skill-discovery`, `r19-044-course-creation-workflows` | 否 | `generated-index`, `ai-session`, `chat-ui`, `workspace-shell` | 完整内置Skill/质量参考实际交付、发现、按需加载和升级；应用与外部共用内容源，用户无需外装课件Skill，原生Skills保留。 [完整规格](r20-021-profile-controls.md) |
| `r20-022-materials-privacy-controls` | 完成常见材料支持与引用删除数据控制 | `r20-011-first-use-risk-notice`, `r15-020-material-tools-citations`, `r19-040-session-persistence-deletion`, `r19-045-material-context` | 否 | `main-preload`, `contracts-schema`, `workspace-shell` | 补齐已承诺常见材料生产读取与片段/原图/出处；引用/删除/Save As控制真实，AI记录不进工程或导出。 [完整规格](r20-022-materials-privacy-controls.md) |
| `r20-025-plugin-workflow-parity` | 实测原生能力与课件质量对等并关闭GUI引入的差距 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls` | 否 | `chat-ui`, `cli-adapters`, `workspace-shell` | 相同有效配置/授权下原生能力及课件质量没有GUI引入的系统性下降；有限真实开发对照可复用，不成为教师操作依赖。 [完整规格](r20-025-plugin-workflow-parity.md) |
| `r20-030-docs-accessibility` | 完成内部设置 / Chat / timeline 的键盘、读屏、错误恢复与用户文档 | `r20-000-public-governance` | 否 | `workspace-shell`, `generated-index`, `chat-ui` | 随稳定UI提前完成键盘/焦点/状态反馈，最终完整流程可读屏操作，帮助与支持说明消费实际界面和025结论。 [完整规格](r20-030-docs-accessibility.md) |
| `r20-040-three-cli-acceptance` | 汇合三CLI内部全流程与速度质量证据 | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility` | 否 | `cli-adapters` | 汇合三CLI有限矩阵、内部全链条、标准速度与成品质量，失败完整保留；少量模型样本不冒充可靠p95。 [完整规格](r20-040-three-cli-acceptance.md) |
| `r20-041-pptx-production-acceptance` | 完成 PPTX 导入增强的内部生产创作验收 | `r19-051-pptx-media-effects`, `r20-030-docs-accessibility` | 否 | `app-save-recovery`, `workspace-shell`, `generated-index` | 支持范围可编辑且实际显示/播放正确；每类未支持项准确标页码/类型/原因，人工导入全过程可完成。 [完整规格](r20-041-pptx-production-acceptance.md) |
| `r20-050-owner-acceptance` | Owner验收S4内部全流程并签署v2.0.0 accepted | `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility`, `r20-040-three-cli-acceptance`, `r20-041-pptx-production-acceptance` | 否 | `none` | Owner对内部全链条、速度/质量和PPTX当前候选实际S4签署；固定HTML真实断网运行并冻结身份。 [完整规格](r20-050-owner-acceptance.md) |
| `r20-060-release` | 发布 v2.0.0 内部源码标签与固定课例离线 HTML | `r20-050-owner-acceptance` | 否 | `none` | 发布源码和HTML与050签署相同，离线运行正确、无AI记录/凭据；全部必选节点/签署门可追溯。 [完整规格](r20-060-release.md) |

Dependencies只列开始开发的硬前置，完整节点仍须满足真实集成条件与Acceptance。000后设置、021 Skill、022材料及030键盘/焦点/状态反馈随接口和界面稳定推进；030不等待025整项结束才开发，最终帮助和支持结论仍等实际界面与025结论。020消费实际设置/021/022，025完成有限有效对照，040显式汇合020/021/022/025/030。041 PPTX并列，050显式保留各必选线与S4签署，060发布。唯一Owner持公共锁并顺序集成共享文件，非重叠叶子可隔离委派；不另建性能、质量或调度平台。

## 共同合同与验证

- 复用[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)的原生授权、观察/候选/receipt、模式/策略、恢复及唯一事务；AI私有记录不进工程或导出。
- 020实施实际生产优化，021交付完整内置Skill；040汇合真实行为和速度质量证据，不能把性能只留在验收报告。当前1.8正确性、接口和终态缺口仍在原Owner关闭，不延期到2.0。020承接完整生产场景新增的实际瓶颈；统一方案第9.2节的条件优化及第10.5节的模型/服务研究不因进入2.0自动变成必选交付。
- [计划第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md#6-高可靠性验收)规定有限三CLI重复门及停止条件；025可复用有效外部对照，仅补实际变化。外部AI代生成/检查/修复不能算内部闭环。
- 局部按[准备与选择规则](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)只准备受影响制品和命名用例；结构看针对性测试，视觉互动看实际呈现/动作，持久化看保存重开/Undo/导出，读屏用实际工具。完整矩阵在040汇合，未变化的证据复用；自动化不代签Owner。
- 050冻结固定HTML与源码身份；060复用同一候选verify，只核对身份、数据边界并实际断网打开，不重复执行会重新生成HTML的命令。
