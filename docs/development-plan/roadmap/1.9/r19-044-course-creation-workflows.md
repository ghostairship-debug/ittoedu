# r19-044-course-creation-workflows：按任务创作与明确制品审阅

- Release: 1.9
- Dependencies: `r19-042-draft-workspace-continuity`, `r19-045-material-context`, `r18-104-builder-skill-discovery`, `r19-049-document-file-coauthoring`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `chat-ui`, `generated-index`, `store-kernel`

日期：2026-09-18。本文是目标规格，当前实施次序、事实和验收统一见[完整实施方案](../../R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)；本轮仅文档重建。

## 目标与现状
默认像通用 Agent 桌面端接受任务、读取材料并持续完成课件，同时保留教学知识获得路径和质量约束。导入材料、策划不再是强制步骤；无固定四稿/四次确认。用户明确要求先审稿时才在真实当前制品暂停。对应 F07 与 V08/V09/V11，现有自动/手动四阶段代码和 Skill 需真实迁移，文档更新不等于已改。

## 直接入口与职责
沿现有 lesson authoring/流程 guards、localAgent profile/service/harness、CourseChatPanel、文件版本端口及生成 controller 查清所有 consumer；同时核对仓库 .agents/skills/orchestrate-courseware、build-courseware-project、托管安装源/安装产物、发现索引和测试。准确文件清单开工时从实际安装脚本解析，不能只改一份 SKILL.md 或界面文字。
040/042 提供会话/目标，045 提供材料读取事实，049 提供真实当前稿，工程提交仍由唯一事务 Owner；不建立新模型循环/工作流引擎。

## 执行与退出
1. 直接接受目录自然任务、粘贴/附件/路径；按需补少量影响结果的问题。无材料的主题创作可推进，不强制制造材料或计划；需要依据材料时实际读取相关正文/图示/来源。
2. Agent 仍可策划和产出可编辑文档，文件名与数量由任务决定。保存的文档是真实文件；聊天摘要不是第二正文。
3. 用户说“先看计划、确认后再做”时记录该制品及当前正文/附件版本，展示并等待；确认后推进。更改已审稿则只使依赖该版本的批准/任务失效，不把一般任务变成四阶段向导。
4. 保持原生 CLI 的工具、网络、文件、Skills、子任务及授权。目录任务不误进要求 lesson context 的路径；课件编辑保留正式 snapshot、能力发现、staging 和 receipt。
5. 一轮消息冻结目标；@ 材料不会隐式改投。补充输入、停止、取消、部分完成、恢复和错误可解释；提交后反馈失败核对已有结果，不重复提交。
6. 统一运行 guard、提示词、托管 Skill 与 UI 的新规则并删除旧必经 writer/分支；保留外部显式 Skill 调用的可说明行为，不能要求教师去软件外补齐软件承诺的链路。
7. 延续按能力选路、原因驱动修复、结构/画面/运行检查和首个可用成果；不牺牲教学内容换假速度，不新建固定首轮率或调用次数门。

## 验收与交接
默认任务从材料/主题到实际可编辑课件、保存、重开、预览/HTML；另一路用户明确先审当前文档再继续。覆盖人工改稿、附件变化、运行中切页/补充指令、Stop/失败后接续及旧候选零误写。三格式消费与045/050共用证据；目录聊天回复或 running 只能证明启动，不能证明作品交付。旧 Manual/Authoring/CurrentTeacher 规格改为新行为，保留真正的当前稿失效与质量反例。
