# r19-049-document-file-coauthoring：交付真实Markdown文件编辑、恢复与AI共编

- Release: 1.9
- Dependencies: `r19-042-draft-workspace-continuity`, `r19-041-session-navigation`, `r19-047-shared-document-editor`
- Optional: 否
- Write locks: `contracts-schema`, `main-preload`, `ai-session`, `chat-ui`, `workspace-shell`, `app-save-recovery`

## 结果与边界

在右侧标签里直接编辑课例的真实Markdown，使用与Flow相同的正文核心；短暂空闲自动保存，外部改稿可比较，AI明确改稿后直接更新/标记并可撤回可定位部分。文件不转存成课件工程。

依据 [课例/文件合同](../../R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md) 与 [正文合同](../../R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)。本节点不等待048全部Flow导出，也不持有044阶段决策。

## 直接入口与写域

读取 [ipcTypes.ts](../../../../src/shared/ipcTypes.ts)、[CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[generationContract.ts](../../../../src/shared/generationContract.ts)、[generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)。新增文件Owner提供open/save/watch/prepare/apply/revert窄端口；main负责真实文件I/O，renderer保留可恢复编辑会话。App/Chat/IPC唯一集成人接线。

## 执行与验收

1. 使用042真实课例身份和041标签，接入047；四阶段文档真实落盘，原Chat文本框不再持有第二正文。
2. 实现预期版本写入、附件先准备/正文替换、失败恢复与操作结果核实；写入失败不能把旧磁盘稿当当前稿。原生CLI外部写入也触发watch比较。
3. 实现无冲突外部刷新/合并，同处冲突保留双方；切标签、关闭、重启和课例移动不丢未保存稿。
4. AI准备先flush真实当前稿，绑定范围/版本/epoch；无冲突部分直接写回并标记，人工同处修改保留。记录实际改动组，以新的逆向修改撤回仍能匹配的部分；其余明确未撤回。
5. 向044提供当前正文/附件版本及变更通知，不在本节点自行确认阶段。阶段/在途构建版本失效由044处理；050证明完整接续。
6. 跨Flow与文档复制通过资源归属端口，文档正式保存不残留临时project资源引用。移动课例后图示与正文可读。

## 聚焦验证与退出

新增lessonDocumentFiles/coauthoring命名测试随实现创建，真实临时目录证明CAS/冲突/崩溃恢复/附件闭包；实际窗口完成编辑→外部同处改稿→AI修改→手改→部分撤回→重开。不得只测JSON或最近一次Ctrl+Z便声称选择性撤回。

需要真实模型时仅Luna；文件I/O与冲突可先做不耗模型的验证。交付真实当前稿接口给044/043并在050汇合，未执行的部分单列。
