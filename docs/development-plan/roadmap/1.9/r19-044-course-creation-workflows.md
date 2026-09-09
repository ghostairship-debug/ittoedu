# r19-044-course-creation-workflows：内置自动材料与手动分阶段的整课创作流程

- Release: 1.9
- Dependencies: `r19-042-draft-workspace-continuity`, `r19-045-material-context`, `r18-104-builder-skill-discovery`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `chat-ui`, `generated-index`, `store-kernel`

## 结果与现状

在现有聊天壳内完成两种整课创作：自动模式从已成功读取的上传材料连续设计、构建和检查；手动模式详细分阶段确认后构建。两者共享教学/呈现/构建/修复能力，产物在同一工程继续编辑、保存和导出。

自动流程的“已读”指原件有效、整体结构可取得，且本次教学范围需要的内容和图像已有实际读取结果；无关附录未读不阻塞当前范围，相关缺页/图示仍需补齐。消费045已有读取事实与版本，不新增“全材料理解”状态。

当前内置courseAgentSkills只是短提示集合，外部编排/Builder包含更完整的教学、视觉和验证方法；不能只加模式按钮就宣称等效。r18-105已撤回，本节点承担双流程与Skill/Builder协作的实际实现，工作台视觉整理由041完成。

## 开始前与阅读入口

按[产品方案第4–8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)和[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对依赖与写锁。

- [courseAgentSkills.ts](../../../../src/shared/courseAgentSkills.ts)、[profile.ts](../../../../src/main/localAgent/profile.ts)：当前内置方法和加载策略。
- [编排Skill](../../../../.agents/skills/orchestrate-courseware/SKILL.md)、[构建Skill](../../../../.agents/skills/build-courseware-project/SKILL.md)及其按需references：作为迁移的产品内容源读取，不在开发任务中执行课件流程。
- [localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)、[localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)、[generationContract.ts](../../../../src/shared/generationContract.ts)：任务/意图/阶段/材料条件和当前确认稿门。
- [harness.ts](../../../../src/main/localAgent/harness.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)：原生CLI继续、当前UI与真实工程提交。
- [coursewareBuilderV2.ts](../../../../src/renderer/course/coursewareBuilderV2.ts)、[authoringToolFacade.ts](../../../../src/renderer/authoring/tools/authoringToolFacade.ts)、[recipeCatalog.ts](../../../../src/renderer/recipes/recipeCatalog.ts)：构造、窄观察、正式工具和模板复用。
- [install-courseware-skills.ps1](../../../../scripts/install-courseware-skills.ps1)：外部受管副本更新；个人改动仍按安装合同处理。

## 允许写域与旧路径退出

既有任务/Generation与当前Chat的阶段接线、共用Skill内容/路由、Builder构造与观察消费及strict本地合同。先稳定合同和同源内容，再迁移现有consumer，删除“所有整课都必须两稿确认”的统一拦截；该门继续用于手动流程和外部已确认稿Builder。

内部生成使用当前文档和唯一canonical事务。复用Builder构造核心时不能把其私有History嵌入当前工程、另起Vite/第二浏览器或创建另一个可写Project；外部受管Facade保持既有启动/交付兼容。CLI保留原生规划、工具、Skills和子任务，宿主不复制Agent循环。

044提供唯一阶段、确认与首成果事实，041持有工作台阶段卡和首成果展开接线；041可先开发已有工程和局部AI界面，只有消费042/044真实结果后才完成。044当前聊天壳的必要控制与041最终呈现由同一UI集成人顺序修改，不各建状态。Write locks列出可能写域，按批次申请实际锁；同一粗锁下需要并行的非重叠叶子由唯一协调Owner在同一协调任务内持锁委派到隔离工作区，不创建两个争用active卡。共享合同、App/Chat、IPC和正式事务文件保持唯一writer。

## 执行步骤

1. 在唯一任务合同中区分自动/手动流程、讨论/计划/编辑意图和应用策略；阶段制品保存在应用本地，可在聊天查看/修改，确认绑定教师实际看过的当前版本。它们不新增V9字段，也不把聊天摘要当作品真相。
2. 自动模式先核对045的有效原件、整体结构及本次教学范围必要图文的真实读取结果；缺材料、空附件、相关范围读取失败或关键冲突时补问/提示切手动，不因无关附录未读全阻塞。理解教学目标后优先匹配实际模板、设计参考、Recipe和已有组件，说明适配依据；模板不合适允许定制，不强制逐份确认两份Markdown。
3. 手动模式按教学简报确认→教学策划确认→呈现简报确认→呈现脚本确认→构建推进；当前阶段可读、可改、可返回，生成前授权不能代替看过制品后的确认。已有完整稿可明确采用，不重写已闭合内容。
4. 两流程共用完整的教学设计、主推进、呈现设计和验证参考；会话基础简短常驻，当前任务Skill及相关质量/能力卡按需加载。保留“新知识有讲解/证据获得路径”“互动承担认知作用”“正文主推进可达”等实际要求，不能用几段泛化提示替换有效外部方法。
5. 先完成最高风险真实片段，再按完整页面或自洽互动单元构建、正式提交和反馈观察；host补ID/默认值/重复结构，Agent输出语义输入。读取窄scope/回执，已读能力/材料/未改源码不重复全量回传。Native、公开组件参数与深层源码分别走现有最短适配路径。
6. 同一原生任务接收实际结构/画面/运行和提交结果，修复仅覆盖失败及受影响区域；对复杂组件/Runtime保留既有真实准入和实例验证，不以模型自评替代。当前版本支持的保存/Player/导出通过软件入口交付。
7. 当前Chat提供流程选择、材料状态、阶段正文/确认、停止、继续和已提交结果。普通局部改字改色不重走整课阶段；切流程保留工程/人工修改和已提交成果，从当前事实接续，不将自动产物伪装成手动已确认稿。
8. 同步产品profile/guard、根入口约定和仓库Skill路由，再由受管installer更新外部副本；外部已确认稿Builder保留原停点，不要求它也新增自动模式。相关入口语义由同一来源派生，避免内外双轨。

## 验收与可信反例

- 从现有软件入口完成一份真实材料自动课例和另一份详细手动课例，均可连续改内容/视觉/机制；教学主线、材料出处、首个完整单元、后续生成与实际检查可追溯。
- 自动缺材料/坏材料、手动未确认当前稿、阶段返回后迟到候选、人工修改后继续、Stop、首次保存切身份、局部修改入口，均遵守真实条件，不越级、误绑定或重建覆盖。
- 同一CLI/模型下按相同材料与有效Skill能力核对内置结果；缺失教学内容、质量参考或检查机会必须修正。1.9完成本版支持范围，2.0/021补齐完整内置交付，不以按钮存在宣称所有流程已达到最终质量。

## 停止条件

关键教学事实缺失、本次教学范围必要材料/图像未实际读到或必须改变教师已确认体验时回到对应阶段；无关附录未读不触发这一停止条件。纯技术分解由Agent处理，不把协议/测试选择交给教师。不要为速度删正文、静态化互动或让外部AI补成品。

## 聚焦验证

合同测试证明材料前置、当前稿确认、阶段返回/停止及去重；Builder测试证明同一正式命令和人工内容保全，不只断言Skill字符串存在。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)一次准备后运行直接入口。下列E2E只覆盖既有失败/取消基线；自动/手动阶段和首成果新行为先随实现加入命名用例，再精确grep选中，零匹配不算通过，不局部执行整个stabilizationCoreUsability真实付费矩阵。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/coursewareSkillsContract.test.ts tests/unit/coursewareCaseBuilder.test.ts tests/unit/editorTransaction.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S3 聊天失败注入：一次修复、无进展停止、取消与人工撤销后旧结果零写入$'
```

用一个已过原生基础门的CLI在真实应用完成两流程，并实际修改、重开、播放和适用导出。记录首成果、总耗时、实际读取与返工，保留失败；050汇合其他CLI的实际差异，本节点不再跑完整三CLI矩阵。

## 回退与交接

交付阶段/材料条件、同源Skill内容和加载、构造/提交/反馈证据，041只整理其UI，043完善长任务，050连续使用，2.0/021完成生产内置化。回退入口不能改变已保存课件、已有人工历史或外部受管Builder的有效流程。
