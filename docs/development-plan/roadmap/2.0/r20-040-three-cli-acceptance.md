# r20-040-three-cli-acceptance：汇合三CLI内部全流程与速度质量证据

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility`
- Optional: 否
- Write locks: `cli-adapters`

## 结果与现状

同一生产候选的Codex、Claude和OpenCode在软件内完成适用的完整自然语言工作流、两种创作流程与持续生命周期；真实产物可编辑、可保存重开、可运行和可导出。汇合原生能力/质量对等和标准任务速度证据，明确实际支持边界。

本节点是最终证据汇合门，不再开发第二套工作流、Skill或性能平台。103、1.9、020–025有效证据直接复用，只补2.0相关实现/环境变化；不能通过重复全部付费调用凑数量。

## 开始前与阅读入口

按[产品方案第7–8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划第6节](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[T01–T12对标](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对同一候选、真实支持和剩余项。

- [localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)、[harness.ts](../../../../src/main/localAgent/harness.ts)：任务、意图、原生映射、停止和实际提交证据。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)：软件入口与唯一工程结果。
- [stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)、[diagnosticLog.test.ts](../../../../tests/unit/diagnosticLog.test.ts)、[localAgentTaskContract.test.ts](../../../../tests/unit/localAgentTaskContract.test.ts)：现有应用/存储/协议反例入口。
- [020内部全流程](r20-020-public-authoring.md)、[021内置Skill](r20-021-profile-controls.md)、[022材料](r20-022-materials-privacy-controls.md)、[025有限对照](r20-025-plugin-workflow-parity.md)：实际生产输入和结论条件。

## 允许写域与旧路径退出

三CLI最终验收驱动、相关adapter复现与证据；无权跨Owner直接改工作流或表面源码。发现失败回实际实现节点，保留失败并更新受影响证据，不新增另一套验收定义。

## 执行步骤

1. 显式等待020/021/022/025/030最终收口，再汇合同一候选的任务原话、CLI/模型/强度/有效配置、材料、Skill/工具实际可达性、真实结果和失败。030可提前开发，但其最终界面与支持说明仍须完整。标明证据对应源码/依赖/环境、哪些有效复用、哪些需因相关变化补测；不要重新制造长期评分或任务治理台账。
2. 保留T01–T12完整范围：识图/图片修改、文字、动态机制、连续纠正、人工交替、计划后执行、Flow/Spatial、按钮QA、模型/模式与原生请求控制、历史删除和长任务。补1.9未命名/首存、材料/双流程、聊天首页/局部AI与专业模式的最终真实范围。
3. 三CLI各自满足开发计划已约定的有限关键自然链重复门与确定性失败边界；沿用有效运行，相关变化只补受影响链，不扩大成每节点三家全矩阵。某CLI自身不支持的功能准确列出，不能拿另一家成功替代必要支持证据。
4. 确认材料→设计/脚本→生成→局部/整课修改→真实检查修复→保存和导出均由软件入口完成；没有外部AI预制成品、外部终端手工Builder或另一Agent补检查的隐藏步骤。
5. 按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)汇合020冻结标准任务的原始阶段/总耗时、首成果时间、输入读取/往返、返工和失败，以及Native秒级、代表动态分钟级、标准整课30分钟目标的实际结果。精确编辑与复杂编辑分别报告首次正确可用结果与全任务终态，auto/preview、冷启动/连续会话及明确用户等待分开。整课从原件上传完成且用户启动任务起计，解析与必要图像理解、设计、构建、QA/修复全部计入；用量按实际本次/累计语义去重，确实未提供的指标与不可分离的内部区间标未知。未达项保持可见并按原Owner处理，不在本门新建性能优化平台。
6. 将025的原生能力与课件成品质量比较分别核对，确保内置没有系统性退化。实际教学、视觉、互动、可编辑性和恢复/导出结果都须成立，不能只报告工具成功或静态准入。
7. 保存重开、Undo/Redo、Player/适用导出与人工回退复核；终结与持久化结果、恢复后行为一致，已完成不重放、部分完成保留成果并只接续未完目标，提交结果未知时核对当前工程，不重提事务或补造回执。提交成功不能替代语义/互动正确。PPTX 041独立并列。固定发布HTML仅证明课程运行，不代替AI实际工作区的完整操作证据。

## 验收与可信反例

- 三CLI完整必需范围、2.0内部闭环、025有效对照及速度/质量结论条件成立，无未关闭当前核心流程阻断、假完成或数据错误。
- 最终必需门沿既定支持范围与速度质量目标。统一方案中未被实际瓶颈触发的优化机制、Auto或新服务不自动成为缺项；当前核心失败、数据错误和假完成仍返回原Owner关闭，不能借后续性能研究延期。
- 结果可追溯到真实候选/配置/材料；未验证能力和不满足目标不得改称通过，也不能以调整模型/规模但不披露或删除慢/失败样本消除。
- 缺一个必需CLI、旧版本成功冒充当前、用户提示夹带内部协议、恢复后重复提交、外部补步骤或只看第一张画布，均阻断此门相应结论。

## 停止条件

外部服务不可用则明确该证据受阻，不用另一CLI代替或无限重试；其他有效证据保留。速度或支持范围需产品取舍时将原始结果交Owner，不由验收脚本自行放宽标准。

## 聚焦验证

准备与证据复用统一遵循[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)。只选本候选相关改变的协议/保存/失败测试；同一候选已完成的有效完整检查不因进入最终门重跑。下列E2E明确选择当前真实聊天、源码与整课/动态用例组，按实际受影响范围运行或复用，不整文件附带无关测试。新增2.0用例先随实现创建，再列入实际FILE与--grep，零匹配不得通过；仅旧S3用例通过不能代替新2.0能力验收。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/diagnosticLog.test.ts tests/unit/editorTransaction.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 (真实聊天：(codex|claude|opencode) 生成候选、继续修改、单次撤销与保存|真实组件源码：(codex|claude|opencode) 读取既有包并连续修订|真实整课：Codex 从确认文档生成、重开与离线逐页运行|真实生成组件：Codex 候选、教师改属性、保存重开与连续互动|真实生成Runtime：连续动画、文案编辑、历史与离线互动)$"
```

真实三CLI最终差异必须有实际软件操作和产物；自动化只形成engineering candidate。T01–T12、各CLI既定有限重复门、内部全流程和速度质量条件全部沿开发计划保留，命名选择仅缩小每次重跑范围，不缩小最终必需覆盖。不在此新增数量、重试或准入平台；050/060既定集成与release门仍有效。

## 回退与交接

交付最终有效证据、实际支持范围、速度/质量结果与S4可执行步骤；未满足条件不得转accepted。050仍同时等待PPTX/无障碍及Owner签署，060发布同一候选。
