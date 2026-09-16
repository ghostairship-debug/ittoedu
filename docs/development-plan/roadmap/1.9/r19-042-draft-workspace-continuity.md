# r19-042-draft-workspace-continuity：实现真实工作空间、课例身份与工程保存连续性

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload`
- Gaps: G09

## 结果与边界

节点ID保留作路线引用，旧“未绑定讨论→draft→首存新会话”设计已被Owner决定替代。按 [课例与文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)创建真实课例并立即持有稳定身份，材料/文档/对话先于课件存在；首次工程保存只绑定文件与新编辑目标，不重建课例对话。

Owner明确无兼容需求：直接使用新课例记录，不迁移旧draft、旧workspace identity或旧会话格式。不修改V9项目id/revision的工程语义；本地课例标识不等于工程目标。

## 直接入口与写域

- [workspaceIdentity.ts](../../../../src/shared/workspaceIdentity.ts)、[main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)：本地身份边界。
- [ipcTypes.ts](../../../../src/shared/ipcTypes.ts)、[localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)：目录/课例窄端口、任务目标及epoch。
- [useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)、[courseProjectLifecycle.ts](../../../../src/renderer/project/courseProjectLifecycle.ts)、[projectPersistence.ts](../../../../src/main/projectPersistence.ts)：保存、关闭、恢复和另存。
- [repository.ts](../../../../src/main/localAgent/repository.ts)、[harness.ts](../../../../src/main/localAgent/harness.ts)：040端口与课例归属接线。

共享IPC/身份/Chat由唯一Owner写入；045和049消费本节点课例/文件引用，不各自造身份。

## 执行与验收

1. 选工作空间、命名/定位新课例，创建真实目录及lesson.json；普通目录作为课例打开时保留教师文件。同名、权限/创建失败、取消不留下虚假课例。
2. 课例内四类教学文档、材料目录和当前课件用相对路径；无工程时允许文档/材料创作，不用空字符串或虚构路径绕过工程守卫。
3. 构建产生唯一工程，首次保存时flush合法草稿、失效旧编辑epoch，成功后绑定文件并以新观察续作。取消/失败保留当前内容；AI记录失败不能撤销成功保存。
4. Save As新工程身份且不复制原工程会话/候选/CLI句柄。课例外目标独立记录，不写越出课例的相对路径。新课例副本另分配ID，移动本版本课例重关联记录与恢复稿。
5. 保存中继续编辑仍dirty；Stop、关闭、崩溃与迟到回调不串课例或重复提交。文档文件保存由049负责，工程保存仍归原保存Owner。

## 聚焦验证与交接

在 localAgentTaskContract、useCourseProjectLifecycle、projectPersistence 的实际测试补新转换与失败反例；不保留旧身份迁移测试作为交付义务。共用两个同名不同目录课例验证身份/工程：一个首次保存并继续，一个取消保存仍可编辑，补Save As、移动和重启。文档共编部分由049/050在这些真实课例上接续验证并回链，不要求先完成下游文件编辑器才能交付042身份端口。

040提供记录端口，042向041/045/049/044提供真实课例与工程目标。开始时核对总纲、任务板、工作协议及合同；当前仅路线规格。
