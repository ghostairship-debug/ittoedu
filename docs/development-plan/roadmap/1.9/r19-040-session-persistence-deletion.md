# r19-040-session-persistence-deletion：会话恢复、迁移/损坏隔离、Save As 隔离和范围删除

- Release: 1.9
- Dependencies: `r18-060-release`, `r16-020-local-session-store`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`

## 结果与现状

应用重启后可查看真实对话、引用、任务与receipt并以新观察继续；旧版本可迁移、坏记录可隔离，按会话/工程/全部删除范围准确。

1.8只完成新协议和最低旧记录可读迁移，1.9必须闭合重启/恢复/删除的产品生命周期；serializedSessionMount是通用DOM挂载测试，不能作为本地AI存储证据。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)

## 允许写域与旧路径退出

既有本地AI repository/harness恢复、删除与Chat投影；只用projectId+normalizedPath身份，不把AI记录/trace写进课件。

## 执行步骤

1. 持久化纯文本、引用快照、任务/原生映射、已提交receipt与阶段；断电/退出后running恢复为中断状态，候选重新观察后再生成。
2. 逐版本严格迁移并保留原始记录；单条损坏隔离可删除，同工程其他会话与工程打开继续工作。
3. 实现单会话/当前工程/全部应用记录删除，正在运行任务先使epoch失效、清理本任务资源；删除结果可复查。
4. Save As切新身份且会话为空；UI明确外部CLI历史另行处理，删除/恢复不影响人工历史与课件。

## 验收与可信反例

- 真实重启后消息和已应用结果可查，继续请求读取当前课件；三种删除范围、旧V1迁移和Save As隔离正确。
- 反例：保存记录中途退出、单条坏JSON、运行时删除、旧candidate恢复、同projectId不同路径不能重放写入、误删其他会话或阻塞工程。

## 停止条件

迁移失败隔离单条记录并保留诊断，不清空整个AI库；不承诺删除外部CLI历史。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实应用关闭/重启、Save As、损坏一条可丢弃测试会话及三种范围删除；使用隔离记录，保留有效生产会话。

## 回退与交接

交付迁移/删除/恢复证据和041/042复用API；失败只影响对应AI记录，工程保存仍成功。
