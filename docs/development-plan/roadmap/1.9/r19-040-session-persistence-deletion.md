# r19-040-session-persistence-deletion：会话恢复、迁移/损坏隔离、Save As 隔离和范围删除

- Release: 1.9
- Dependencies: `r18-060-release`, `r16-020-local-session-store`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`

## 结果与现状

应用重启后可查看真实对话、引用、任务和提交结果，并用新观察继续未完成目标；旧记录可迁移，单条损坏不阻塞工程，按会话/工程/全部删除范围准确。

1.8的V2任务/记录和最低旧记录可读是输入，不代表本节点的重启、损坏和删除已经完成。042依赖本节点建立未命名/首次保存身份；本节点先保持已保存工程的projectId + normalizedPath隔离，不自行用空路径模拟draft。

## 开始前与阅读入口

确认依赖的当前有效证据与写锁。上位依据为[产品与创作优化方案](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)及[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)，当前协调状态只看[任务板](../../TASK_BOARD.md)。

- [repository.ts](../../../../src/main/localAgent/repository.ts)：记录解析、原子写入、列表和损坏隔离。
- [harness.ts](../../../../src/main/localAgent/harness.ts)、[service.ts](../../../../src/main/localAgent/service.ts)：运行槽、恢复、停止和删除接线。
- [localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)、[localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)：版本、epoch、终态和receipt边界。
- [workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：工程隔离和恢复/删除投影。
- [diagnosticLog.test.ts](../../../../tests/unit/diagnosticLog.test.ts)：当前已包含真实Repository/Harness存储、重启、损坏与失败写入测试；不以通用DOM挂载测试替代。

## 允许写域与旧路径退出

既有本地AI repository/harness恢复、删除和Chat投影；版本迁移在唯一repository完成，Chat不持有另一份可写记录。只迁移应用自己的记录，不写入课件或复制外部CLI历史。持久化合同新增字段时按既有strict版本规则同步合同。

## 执行步骤

1. 持久化当前消息、材料/观察引用、原生会话映射、任务阶段和已提交receipt。进程退出或重启后旧running恢复为可解释的中断状态；终态和已提交结果不能被迟到事件改写。
2. 按版本迁移并保留必要原始记录；单条坏JSON/不支持版本隔离，其他会话和人工工程打开继续工作。列表显示真实可恢复范围，不能把只读旧历史伪装成可直接续跑。
3. 继续任务时重新取得当前工程、活动草稿和观察身份，明确未完目标与已完成阶段；外部恢复句柄只有经对应adapter确认有效才使用。旧candidate不自动重放，失败不要求教师清空记录。
4. 单会话/当前工程/全部应用记录删除复用同一服务。运行中删除先失效epoch并有界停止本任务，再清理本范围资源；完成结果可重新查询核对。
5. Save As使用新身份且不复制旧会话；原会话仍属于原工程。说明应用记录与外部CLI历史的区别，删除材料缓存不能误删已成为正式课程内容的引用。

## 验收与可信反例

- 真实退出/重启后消息与已提交结果可查；继续任务使用当前课件，三种删除范围、旧V1记录和Save As隔离正确。
- 保存记录中途退出、单条损坏、运行时删除、同projectId不同路径、迟到终态及恢复旧candidate，均不能重复提交、误删其他记录或阻塞人工保存。

## 停止条件

迁移失败隔离受影响记录并报告可恢复内容，不清空整个AI库；不能确认外部历史已删除时不得称其删除成功。现有工程保存失败回保存Owner，不以AI重置绕过。

## 聚焦验证

在现有入口补本规格的版本迁移、运行中删除和恢复去重行为；只选直接覆盖改动的检查，未变证据继续有效。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备后直接运行命名文件。现有E2E只覆盖消息重放/讨论基线；新增重启、迁移和删除行为先随实现加入命名用例，再用精确grep选中，零匹配不算通过，不执行整个stabilizationCoreUsability真实付费矩阵。

```text
npx --no-install vitest run tests/unit/diagnosticLog.test.ts tests/unit/localAgentTaskContract.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep 'S3 默认可见与普通讨论：安全消息、分页事件重放及零工程写入$'
```

用隔离记录在真实应用完成关闭/重启、Save As和三种范围删除，并损坏一条可丢弃测试会话。自动化只证明所覆盖存储/竞态；真实CLI继续任务证据在本节点取得后由050复用，不在每个下游重跑全部CLI矩阵。

## 回退与交接

交付迁移、删除、恢复及失败路径，明确042可扩展的本地身份和041可消费的只读列表/来源接口。回退只影响应用AI记录，人工保存和课件保持可用。
