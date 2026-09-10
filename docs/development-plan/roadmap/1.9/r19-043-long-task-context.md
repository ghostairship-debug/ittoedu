# r19-043-long-task-context：闭合长任务上下文压缩缓存失效与阶段性能诊断

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`, `r19-042-draft-workspace-continuity`, `r19-044-course-creation-workflows`, `r19-045-material-context`
- Optional: 否
- Write locks: `ai-session`, `cli-adapters`, `chat-ui`
- Gaps: G07, G09

## 结果与现状

长对话和多阶段课例在原生CLI压缩、任务中断和恢复后保留目标、用户决定、已提交结果及最新课件事实；读取与阶段耗时可解释，主要重复输入和无效返工得到针对性改善。

本节点继承1.8按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)应完成的按需发现、用量、配置、消息分流和条件终结基础；这些当前缺口不延期至本节点，实际完成以产品证据为准。044/045新增阶段与材料读取。长任务不能依靠旧完整snapshot或重新注入整段聊天维持正确性；本节点不建设第二模型总结循环。

开发消费040/042的真实记录与身份、044的阶段制品和045的材料版本/读取事实，不以041整套UI完成为前置。先沿当前聊天入口核对这些实际数据；新的工作台展示与041由同一UI集成人接线，最终连续创作门由050汇合，不新增另一份阶段或材料状态。

## 开始前与阅读入口

按[产品方案第5–8节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)与[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)核对范围、当前依赖和写锁。

- [harness.ts](../../../../src/main/localAgent/harness.ts)、[repository.ts](../../../../src/main/localAgent/repository.ts)：唯一任务阶段、原生会话和恢复。
- [profile.ts](../../../../src/main/localAgent/profile.ts)、[localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)：当前任务锚点、事件与usage。
- [codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)、[claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)、[openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)：实际原生compact/usage/恢复映射，按发生差异的adapter读取。
- [generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：观察输入与阶段状态消费。

## 允许写域与旧路径退出

同一任务Owner的上下文续接、缓存失效、原生compact/usage事件及Chat阶段诊断；材料索引/提取事实由045持有，能力由096/104生成。只传版本化引用和必要当前事实，不维护可写的影子工程摘要。

Write locks列出整节点可能触及的域，实际claim只覆盖当批文件和时段。同一粗锁覆盖不同adapter叶子时，由唯一协调Owner在同一协调任务内持锁并委派精确非重叠叶子到隔离工作区，不创建两个争用active卡。harness/repository、共享合同和CourseChatPanel各由唯一集成人顺序修改，不能以与041并行的名义并写同一文件或复制任务Owner。接口未就绪只做独立叶子，040/042/044/045真实数据和展示未集成不能报整节点完成。

## 执行步骤

1. 使用CLI原生上下文管理，宿主保留原始任务目标、当前意图/修改范围、有效教师决定、阶段制品引用、结构化失败和已提交receipt。压缩后需要的原文可按需取得，旧摘要有来源及版本，不伪装成当前文档；历史短目标引用不得重新绑定当前选区。
2. 分别核对材料/提取版本、能力语义、源码/资源身份和doc/draft/view/runtime观察版本。只有未变内容复用；同名材料更新、人工改稿、组件源码更新和运行视图变化必须失效对应缓存。
3. 中断/首存/恢复后先读取新身份与观察，再接续明确未完阶段；复用正式receipt去重，不重新执行已完成单元。main、renderer和持久化结果区分已完成、部分完成与未完成；提交后未落盘即崩溃而无法确认的状态保持未知，先核对当前工程事实，不假定失败重提或补造成功回执。用户纠正能更新任务目标而不被旧阶段摘要覆盖。
4. 复用1.8阶段事件与用量口径，补本版材料读取、原生压缩/恢复边界；记录首次正确可用结果与全任务终态。输入按技术说明/材料/图片/源码分开，auto/preview、冷启动/连续会话和明确用户等待分别记录。用量以实际last/total语义去重，确实未提供的指标与内部请求、服务/推理区间标未知，不由字符数或token数换算耗时，不累加并行跨度。
5. 用与1.8可比的真实任务定位主要瓶颈，存在可控浪费时回原Owner修正，例如反复全量snapshot、累计回执、未改包源码或无关重检；没有可控瓶颈时保留实际限制。带基准增量观察和资源/静态检查复用等沿统一方案第9.2节的启动证据决定，未触发不新建也不阻断本节点。独立资源准备可并行，同工程写入仍串行重校验；不添加分类模型、swarm或通用调度平台。

## 验收与可信反例

- 真实连续课例跨过一次原生压缩或已确认的长上下文/恢复边界，随后人工修改并继续；最新事实、有效决定与修改范围保持，已完成步骤不重做。
- 能力版本变化、资产同名更新、压缩后丢目标、旧running重启、已完成/部分完成恢复、提交结果未知、usage缺失、缓存命中但画面改变，均不能误改、重放已提交步骤或伪造完成与性能。
- 有实际分阶段耗时与输入量对照，优化不删教学内容或省略必要视觉/互动检查。秒级/分钟级/整课30分钟目标留到2.0冻结规模后验收，不将本节点统计冒充达标。

## 停止条件

原生CLI不提供某项控制/usage时明确差异，使用可审阅的原生恢复方式，不用另一模型掩盖、不无界加上下文。没有真实耗时或失败证据时不追加缓存/调度层。

## 聚焦验证

按实际涉及的合同和adapter补测试，不为未改adapter重跑同义检查。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)一次准备后运行直接入口。下列E2E只覆盖既有失败/取消基线；新增真实长任务/材料失效行为先随实现加入命名用例，再以精确grep选中，零匹配不算通过，不运行整个stabilizationCoreUsability付费矩阵。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/diagnosticLog.test.ts tests/unit/editorTransaction.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S3 聊天失败注入：一次修复、无进展停止、取消与人工撤销后旧结果零写入$'
```

先复用一个实际长任务完成原生边界→人工修改→继续，并保留读取与阶段时间；其余CLI差异由050连续课例汇合，未变证据不重跑。不人为烧token凑长度，不能用模拟compact事件声称真实长任务通过。

## 回退与交接

交付原生上下文支持差异、缓存失效与阶段时间证据，050据此优化连续课例，2.0复用完成口径。回退诊断/缓存不能丢用户决定、任务来源或已提交结果。
