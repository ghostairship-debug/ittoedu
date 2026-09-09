# r20-021-profile-controls：完成课件Skills内置交付与同源按需加载

- Release: 2.0
- Dependencies: `r20-000-public-governance`, `r18-050-three-cli-benchmark`, `r18-104-builder-skill-discovery`, `r19-044-course-creation-workflows`
- Optional: 否
- Write locks: `generated-index`, `ai-session`, `chat-ui`, `workspace-shell`

## 结果与现状

材料理解、教学设计、呈现脚本、构建、局部/整课修改、实际检查修复与导出所需Skill方法随软件可用，并按任务加载。教师无需安装外部课件Skill或切外部Agent完成步骤；用户原生CLI已有Skills和工具发现继续保留。

1.8的096/104提供同源能力发现，1.9/044接通两种创作流程。本节点完成实际内容、加载、随应用交付和失败恢复，不只提供Skill选择按钮。当前courseAgentSkills短提示与外部完整参考不等价，必须以实际内容与课程结果核对迁移。

## 开始前与阅读入口

按[产品方案第5–8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)及[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对当前依赖和写锁。

- [courseAgentSkills.ts](../../../../src/shared/courseAgentSkills.ts)、[profile.ts](../../../../src/main/localAgent/profile.ts)、[candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)：产品Skill内容、请求选择和会话资源。
- [编排Skill](../../../../.agents/skills/orchestrate-courseware/SKILL.md)、[构建Skill](../../../../.agents/skills/build-courseware-project/SKILL.md)及相关references：现有方法与质量判断；在开发中作为产品资料读取。
- [authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)、[generate-ai-capabilities.ts](../../../../scripts/generate-ai-capabilities.ts)：正式工具与同源能力卡。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[vite.renderer.config.ts](../../../../vite.renderer.config.ts)：当前UI和应用资源交付入口。
- [install-courseware-skills.ps1](../../../../scripts/install-courseware-skills.ps1)：兼容外部受管副本，不作为内部可用的安装前置。

## 允许写域与旧路径退出

产品Skill内容源、生成资源、profile/会话加载与Workspace选择/诊断。以现有产品维护内容为唯一源，提取共用方法，内外只保留启动/交付差异；迁移后删除对应重复提示/完整内联路径。不引入通用Skill执行引擎、第二规划模型或独立工具目录。

## 执行步骤

1. 逐项迁入完整课件方法：材料整体理解与出处、知识获得路径、呈现布局与操作、模板/组件适配、正式可编辑构建、增量保全、真实视觉/互动检查和适用导出。沿044区分自动材料前置与手动四阶段确认，不能用统一两稿门拦自动流程。
2. 按会话基础→当前任务Skill→相关质量参考→精确能力卡分层交付。简单修改直接取目标小卡和必要规则；复杂任务可读取完整协议/原图/源码，压预算不能删教学目标或必需字段。
3. 在应用构建/运行中提供稳定的产品资源位置和版本，启动/恢复后可按需读取；没有个人课件Skill安装副本时内部全流程仍成立。外部Builder继续取同源内容和能力语义，受管更新保留其兼容流程及用户修改。
4. 保留CLI原生工作目录配置、用户Skills和工具连接；产品Skill附加课件方法，不覆盖原生系统行为、强改工具白名单或统一拒绝授权。需要原生请求/回答时使用既有GUI接线，不新建权限平台。
5. 教师按用途选择或由当前任务自动发现Skill，可查看本轮实际用途、CLI/模型和引用来源，不要求理解内部Schema。切CLI/阶段后清理失效profile引用，不能残留上一个工程的材料或旧任务规则。
6. 以相同输入和有效配置核对外部有效方法是否完整迁入，再在内部实际制作Native与动态课例；查清失败属于缺材料/方法、能力卡还是宿主反馈，回对应Owner修复。不能把外部另一个Agent的检查作为内部完成条件。
7. 记录技术说明/参考/材料/源码输入量、发现往返和返工；复用未变方法和能力版本，优化重复读取。具体速度结果由020标准任务验收，本节点不以Skill字节缩小代替质量。

## 验收与可信反例

- 在没有个人课件Skill安装的干净应用配置中，材料、策划、脚本、构建、修改、检查修复和导出方法实际可读/可执行，内部产物质量不因少给有效参考下降。
- 应用与外部Builder取得同一能力ID/输入/scope/限制；simple/professional和局部/主聊天都能使用对应能力，原生用户Skills仍可发现。
- Skill资源缺失、版本错配、个人副本修改、切CLI/阶段后旧profile、错误scope或必要质量参考缺失，均明确失败或恢复路径，不静默换陈旧Schema。

## 停止条件

缺产品资源或能力时在内部报告具体缺口并回Owner修复；不得要求教师安装外部工作流补做已承诺的2.0步骤。新能力仍须正式工具/宿主合同，不把Skill文本当权限或运行成功证明。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。相关产物准备一次后直接选择现有测试，补内容同源、按需读取、无外部安装的交付路径及升级失效；字符串存在测试只能证明入口约束。新用例先随实现创建再列入入口，零匹配不得通过；需要E2E时列实际FILE与--grep命名用例，不整文件运行三CLI付费矩阵。

```text
npm run check:ai-capabilities
npx --no-install vitest run tests/unit/aiCapabilities.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareSkillsInstaller.test.ts tests/unit/coursewareCaseBuilder.test.ts
```

在真实应用完成一项Native与一项动态制作/修订并核对实际读取轨迹，完整教学与视觉方法实际参与；外部受管版本只作开发兼容核对。020/025复用未变证据，不在本节点重复三CLI全矩阵。

## 回退与交接

交付随应用可用的Skill内容/版本、内外同源与原生发现证据及未完成项；020消费实际内部方法，025核对质量对等，030完善帮助。回退不能删除用户原生Skills或已完成课程。
