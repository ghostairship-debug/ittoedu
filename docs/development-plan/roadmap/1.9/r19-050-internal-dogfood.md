# r19-050-internal-dogfood：以真实课例验证双流程连续创作与主要耗时优化

- Release: 1.9
- Dependencies: `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context`, `r19-048-flow-document-delivery`, `r19-049-document-file-coauthoring`
- Optional: 否
- Write locks: `chat-ui`

## 结果与现状

真实教师课例通过聊天首页持续创作：材料读取/设计→自动或手动生成→局部和整课修改→实际QA修复→长任务/重启恢复→保存及适用导出。同步优化实际主要耗时，问题按当前用户可用性排序。

本节点汇合040–049（046/047由048/049传递覆盖）及仍适用的1.8证据。真实工作空间/课例、三格式独立材料、四阶段真实文档共编、新Flow正文和实际Word数学均须使用；Owner不要求旧格式兼容，旧模型fixture必须换成新模型再验证相同功能，不能用旧测试成功冒充新增能力。

[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)中当前已证实的正确性、接口、配置与终态缺口仍由1.8原Owner关闭，不等到本节点修复；本节点复用其有效证据，并处理连续生产场景新增的实际瓶颈，不恢复全部历史节点。

开发可并行不缩减集成门：040恢复/删除、042课例身份、041导航容器、045材料、049文件共编、044两流程/阶段/首成果、043接续及048新Flow/Word均须完成；050验证它们在同一真实工作台组合，不恢复041/044隐性互等。

组合执行按[总方案第6节](../../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#6-最小充分验证与证据复用)复用同一课例链：上游独立接口先交付，跨节点消费/接线在本节点或首次组合时取得证据并回链，最终收口须覆盖全部必选结果。自动/手动、三材料和三CLI按实际差异安排到代表链，不展开全维度笛卡尔矩阵；已有有效局部和组合证据不重复执行。

## 开始前与阅读入口

按[产品方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[对标T01–T12](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对当前候选和证据有效范围。

- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[harness.ts](../../../../src/main/localAgent/harness.ts)、[repository.ts](../../../../src/main/localAgent/repository.ts)：真实对话、阶段和恢复事实。
- [materialService.ts](../../../../src/main/materialService.ts)、[prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)、[useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)：材料、提交、保存的直接Owner。
- [stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)：现有真实应用/生成/导出测试入口，夹具结果与实际CLI证据分开。
- [mixedCrossSurfaceHistory.test.tsx](../../../../tests/integration/mixedCrossSurfaceHistory.test.tsx)：跨表面人工/AI历史保全。

## 允许写域与旧路径退出

连续课例驱动、真实证据和Chat范围内复现入口；产品跨Owner缺陷回对应040–049或实际实现处取得写锁再修。本节点不新增任务调度、性能平台或第二测试矩阵。

## 执行步骤

1. 从真实工作空间入口命名创建至少两份不同材料/目标的课例：自动流程核对实际读取结果后开始，手动分别确认四阶段真实当前文件后生成。PDF、DOCX、PPTX各自有读取和消费证据，移动共享原件后课例材料仍可用。右侧文档先于课件可打开，新课件首成果后显示实际画布；已有工程采用本版统一模型，覆盖三表面/动态能力。
2. 连续完成局部文字/图片/参数及一次实际机制修改、结构/画面/运行检查与相关范围修复；人工改稿后AI继续，查看来源/阶段结果，不全量重建覆盖。在既有课例中按实际改动选择整页重排/跨页批量、单实例或共享组件修改、实际交互故障修复等代表操作。优先使用已有Component文件级patch和多步候选，验证未改文件、shared/instance影响、人工修改及一次事务撤销；不强制每次输出diff，也不另起每项三CLI矩阵。
3. 搜索、讨论分支、切任务、回答问题和串行排队编辑后跨原生长上下文/重启边界继续；首次保存、Save As、停止和范围删除遵守唯一身份，旧候选不重放。已完成任务保持终结，部分完成只接续未完目标；提交后未落盘而无法确认时先读取当前事实，不重提事务或伪造回执。
4. 在simple/professional与局部/主聊天之间切换，验证AI能力一致。完成新Flow混排与源文往返、真实文件AI改稿后手改再撤回、外部冲突及改稿阻止旧脚本在途提交；Undo/Redo、保存重开、两种预览/离线HTML及实际Word数学编辑正确。断网或CLI故障时人工主流程继续。
5. 复用1.8及043计时，精确编辑与复杂编辑分别记录首次正确可用结果、全任务结束、输入分项、读取/续轮/返工与失败；auto/preview、冷启动/连续会话及明确用户等待分开。固定同一任务和实际配置比较受影响变化，小样本保留原始值与中位数。仅对实测主要瓶颈深化增量观察、源码补丁或资源/检查复用，不将这些机制或新的固定提速比例变成本版必建门；不省略教学/视觉/互动检查，不把2.0速度目标当已兑现成绩。
6. 汇合三CLI在本版新增生命周期与流程上的实际差异，保留失败与明确支持范围。外部已确认稿Builder的互操作沿104保全，其有效旧证据可复用，不要求教师到外部补齐本版已经承诺的软件流程。

## 验收与可信反例

- 三CLI连续使用和T12生命周期有对应真实证据，真实课例/首存、自动/手动、三格式材料、文档共编、新Flow/Word及工作台完成；无未关闭当前核心流程阻断、数据错误或假完成。
- 主要耗时有实际归因及改进/明确限制，生成内容具有知识获得路径、可读视觉、可操作互动和可继续编辑结果。
- 只跑一轮demo、在用户提示补内部协议、隐瞒慢/失败样本、重启后重写已提交内容、让外部AI补成品、删除误影响课件均不能通过。

## 停止条件

核心生命周期失败回实际Owner修复，不清空记录/新建工程绕过。若目标规模或质量需取舍，由Owner根据真实课例决定，不能自行删教学内容或压成单一Surface。

## 聚焦验证

按实际修复选取已有检查，真实CLI和窗口路径是本节点主要证据；未变103/040–045结果不重跑。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备，直接运行命名入口。本节点保留完整连续创作集成门，先汇总已有有效证据，再只执行本版新增或受变化影响的缺口；下列精确E2E覆盖现有三CLI基础链，已有有效结果可直接复用。新双流程/工作台/长任务集成用例须随实现先建立命名，再精确grep选中，零匹配不算通过；不把整份stabilizationCoreUsability文件当默认局部检查。

```text
npx --no-install vitest run tests/unit/diagnosticLog.test.ts tests/unit/localAgentTaskContract.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S3 真实聊天：(codex|claude|opencode) 生成候选、继续修改、单次撤销与保存$'
```

记录连续课例、模型/强度/有效配置、实际阶段耗时和失败关闭范围；只补本版新路径及相关变化。PPTX 051仍独立并列，060必须同时等待本节点与051。

## 回退与交接

交付真实课例、当前可用性问题与关闭证据、读取/时间基线和2.0待补格式/Skill/质量对照项。仅形成1.9工程候选，不代替PPTX门或S4教师签署。
