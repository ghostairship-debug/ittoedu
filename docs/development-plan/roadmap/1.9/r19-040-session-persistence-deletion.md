# r19-040-session-persistence-deletion：课例对话恢复、损坏隔离、工程另存隔离和范围删除

- Release: 1.9
- Dependencies: `r18-060-release`, `r16-020-local-session-store`
- Optional: 否
- Write locks: `chat-ui`, `ai-session`

## 结果与现状

新课例记录在重启后可查真实对话、引用、任务与提交结果，重新读取当前文件/工程后继续。Owner 明确本次无兼容需求，不迁移旧版本记录；未知版本或损坏仅隔离对应记录，不清空其他内容。

依据 [课例与文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)。040 提供可版本化的记录、列表、恢复和删除端口；042消费端口建立真实课例身份，040不等待042整项实现，不自行构造空路径工程。

## 直接入口与写域

- [repository.ts](../../../../src/main/localAgent/repository.ts)、[harness.ts](../../../../src/main/localAgent/harness.ts)、[service.ts](../../../../src/main/localAgent/service.ts)：本地记录、运行与恢复。
- [localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)、[localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)：任务归属、版本、epoch及receipt。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)：只呈现真实记录，不持有第二记录库。

共享合同与Chat接线由唯一集成人完成；仅使用当批需要的写域。

## 执行与验收

1. 记录按真实 lessonId/目录与conversationId归属，工程目标独立绑定；消息、引用、原生会话映射、任务及已提交receipt可恢复。新记录使用一个严格版本，不保留旧格式分支。
2. 重启后 running 标为中断；继续时读取当前文档、附件/确认与工程观察，经adapter核实恢复句柄。已完成不重做，旧候选不自动执行，未知结果先核实。
3. 单对话/课例记录/全部应用记录删除共用服务；运行中先失效epoch并停止，再清理本范围。不得删除真实课例文件、附件、工程或未保存文档恢复稿，不承诺删除外部CLI历史。
4. 工程Save As使用新工程身份且不复制原工程会话/候选/trace；首次保存保留课例对话。课例移动按稳定ID重关联本版本记录，复制产生新身份与新对话。
5. 单条坏JSON/未知版本可隔离；写记录失败不撤销已成功的工程或文档保存，UI报告真实可恢复范围。

## 聚焦验证与交接

在现有 diagnosticLog、localAgentTaskContract 测试补新归属、终态去重、损坏和删除反例；新身份集成由042验收。真实应用退出/重启、运行中删除、Save As及不同课例隔离；需要真实CLI时只使用Luna。未执行的恢复不能借旧版本测试算通过。

交付040窄端口给042/041；应用记录之外无写入权限扩大。当前是路线规格，未开工。
