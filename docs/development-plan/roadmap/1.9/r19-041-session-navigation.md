# r19-041-session-navigation：交付会话搜索分支多任务状态与既有事务历史审阅

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`
- Gaps: G05, G09

## 结果与现状

教师可搜索会话、从明确节点分支讨论、查看多个任务状态，并按既有事务历史定位AI变更；讨论分支不会复制工程。

基础会话列表不足以支持长期查找、分支讨论和多任务；不能借分支引入第二工程/History。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

本地会话索引/引用与Chat搜索、分支、多任务、receipt导航；任务并发读取可以，写入仍由现有单租约串行。

## 执行步骤

1. 建立应用本地可重建搜索索引，命中消息/任务/引用并跳到真实会话位置，不复制消息为另一真相。
2. 分支只引用/复制允许的讨论上下文与来源节点，新任务从当前工程观察开始；不继承旧可应用候选或旧外部sessionId。
3. 显示等待/运行/需回答/已提交/失败的多任务状态，切换UI不误投输入；多个编辑按写租约排队并重校验。
4. 变更审阅链接到原receipt/正式历史；有后续人工事务遵守现有Undo顺序，不实现任意历史点快照回滚。

## 验收与可信反例

- 搜索能定位真实内容；从历史节点分支讨论并编辑时理解当前课件；切任务与回答问题路由准确，两个任务不会并发写。
- 反例：分支后删源会话、重名工程、索引损坏、排队中教师修改、错误问题身份，均不串会话或回滚人工内容。

## 停止条件

若产品操作需要工程分叉而非讨论分支，列为明确新需求；不私自添加Git/worktree或复制Project实现。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

实际建立至少三会话，搜索/分支/切换/排队编辑/回答与查看变更，再重启检查来源关系。

## 回退与交接

交付分支/搜索/排队状态语义、索引重建和043上下文接口；删除源会话时分支保留范围必须符合本地删除合同。
