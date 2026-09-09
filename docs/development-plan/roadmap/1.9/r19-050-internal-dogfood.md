# r19-050-internal-dogfood：以真实课例验证双流程连续创作与主要耗时优化

- Release: 1.9
- Dependencies: `r18-043-context-references`, `r18-044-tool-timeline`, `r18-045-safe-markdown-formula`, `r18-046-stop-undo-stale`, `r19-040-session-persistence-deletion`, `r19-041-session-navigation`, `r19-042-draft-workspace-continuity`, `r19-043-long-task-context`, `r19-044-course-creation-workflows`, `r19-045-material-context`
- Optional: 否
- Write locks: `chat-ui`

## 结果与现状

真实教师课例通过聊天首页持续创作：材料读取/设计→自动或手动生成→局部和整课修改→实际QA修复→长任务/重启恢复→保存及适用导出。同步优化实际主要耗时，问题按当前用户可用性排序。

本节点汇合040–045及1.8未失效证据，新增未命名、双流程、材料分片和工作台必须实际使用；不能把1.8/103一轮成功外推成1.9连续创作。

开发可并行不缩减集成门：040恢复/删除、042真实身份、045材料读取、044两流程、041消费真实身份/阶段/首成果的工作台接线、043真实长任务数据与展示均须完成后才能形成本节点结论。不能因为041开发不再等待044、043开发不再等待041，就把未集成路径从050清单移除。

## 开始前与阅读入口

按[产品方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[对标T01–T12](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对当前候选和证据有效范围。

- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[harness.ts](../../../../src/main/localAgent/harness.ts)、[repository.ts](../../../../src/main/localAgent/repository.ts)：真实对话、阶段和恢复事实。
- [materialService.ts](../../../../src/main/materialService.ts)、[prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)、[useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)：材料、提交、保存的直接Owner。
- [stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)：现有真实应用/生成/导出测试入口，夹具结果与实际CLI证据分开。
- [mixedCrossSurfaceHistory.test.tsx](../../../../tests/integration/mixedCrossSurfaceHistory.test.tsx)：跨表面人工/AI历史保全。

## 允许写域与旧路径退出

连续课例驱动、真实证据和Chat范围内复现入口；产品跨Owner缺陷回对应040–045或1.8实现处取得写锁再修。本节点不新增任务调度、性能平台或第二测试矩阵。

## 执行步骤

1. 在真实聊天首页建立至少两份不同材料/目标的课例：自动流程核对有效原件、整体结构与本次教学范围所需内容/图像的实际读取结果后开始，手动流程确认四个当前阶段后生成。不因无关附录未读阻塞，也不声称整份材料全部理解。分别检查新项目首成果后显示画布与已有工程直接打开，使用本版明确支持的格式和三表面/动态能力。
2. 连续完成局部文字/图片/参数及一次实际机制修改、结构/画面/运行检查与相关范围修复；人工改稿后AI继续，查看来源/阶段结果，不全量重建覆盖。
3. 搜索、讨论分支、切任务、回答问题和串行排队编辑后跨原生长上下文/重启边界继续；首次保存、Save As、停止和范围删除遵守唯一身份，旧候选不重放。
4. 在simple/professional与局部/主聊天之间切换，验证AI能力一致；Undo/Redo、保存重开、Player/离线HTML及适用导出正确。断网或CLI故障时人工主流程继续。
5. 复用043阶段计时，记录首次/连续会话、原始输入量、读取往返、首成果、最终完成、返工和失败。选当前最大可控瓶颈回原Owner优化并比较受影响任务；不以省略教学/视觉/互动检查达标，不把2.0速度目标当已兑现成绩。
6. 汇合三CLI在本版新增生命周期与流程上的实际差异，保留失败与明确支持范围。外部已确认稿Builder的互操作沿104保全，其有效旧证据可复用，不要求教师到外部补齐本版已经承诺的软件流程。

## 验收与可信反例

- 三CLI连续使用和T12生命周期有对应真实证据，自动/手动、材料、draft/首存及工作台在本版支持范围完成；无未关闭当前核心流程阻断、数据错误或假完成。
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
