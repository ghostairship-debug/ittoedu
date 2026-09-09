# r19-042-draft-workspace-continuity：实现未命名工程与首次保存的AI身份连续性

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`, `main-preload`
- Gaps: G09

## 结果与现状

尚无工程的讨论可以保存；开始构建时建立独立draft身份，未命名课件可使用AI。首次保存后可明确继续未完成目标，两个draft、已有工程与Save As互不混淆。

本节点是未命名/首次保存身份的实际Owner。r18-105已从路线撤回且未实施，不能把它作为已有能力或依赖。当前身份基于projectId + normalizedPath；不把空字符串、虚构正式文件路径或新增V9字段作为draft实现。

## 开始前与阅读入口

先核对[产品方案第2/4节](../../AGENT_AUTHORING_LONG_TERM_PLAN.md)、[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md)、[架构合同](../../ARCHITECTURE_CONTRACT.md)、[工作协议](../../WORKING_PROTOCOL.md)和[共同实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)。040恢复和删除须已具备有效证据。

- [shared/workspaceIdentity.ts](../../../../src/shared/workspaceIdentity.ts)、[main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)：当前持久工程身份。
- [localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)、[localAgentContract.ts](../../../../src/shared/localAgentContract.ts)、[localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)：本地任务身份、IPC与epoch校验。
- [repository.ts](../../../../src/main/localAgent/repository.ts)、[harness.ts](../../../../src/main/localAgent/harness.ts)、[service.ts](../../../../src/main/localAgent/service.ts)：会话存储、运行任务及绑定。
- [useCourseProjectLifecycle.ts](../../../../src/renderer/app/useCourseProjectLifecycle.ts)、[courseProjectLifecycle.ts](../../../../src/renderer/project/courseProjectLifecycle.ts)、[projectPersistence.ts](../../../../src/main/projectPersistence.ts)：保存、取消、恢复与迟到结果。
- [CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)、[materialContract.ts](../../../../src/shared/materialContract.ts)：当前入口和045需要消费的本地身份。

## 允许写域与旧路径退出

应用本地版本化身份、AI repository/harness、保存生命周期窄接线和当前Chat提示。新增strict本地合同先定义未绑定讨论、draft和正式workspace的有效转换，再迁移consumer；不改Course Project V9身份语义，不建第二工程/History。045复用本节点身份消费材料，不各自生成draft映射。

042与045先由唯一集成Owner在短批次内明确共享身份、材料引用和必要IPC的窄合同，再在隔离工作区分别开发保存/会话生命周期与材料repository/service/格式提取叶子。Write locks是本节点可能写域，不能整节点长期占满；具体claim按当批实际文件取得。同一粗锁覆盖不同叶子时，由唯一协调Owner在同一协调任务内持锁并委派精确非重叠叶子，不创建两个争用active卡。共享合同、IPC/preload与Chat仍逐批单writer接线，同一文件不得绕锁并写，045不得另建draft映射；接口未就绪只做独立叶子，身份/保存真实集成完成前不得报整节点完成。

## 执行步骤

1. 定义无工程讨论与应用管理draft的身份/生命周期。讨论可关联已有工程，也可在开始构建时创建draft；两份draft和相同标题会话必须隔离。关联操作明确目标、来源和新观察，不静默搬运旧外部sessionId或可应用候选。
2. 在现有Chat和真实构建入口接通draft观察/提交，取消“未保存就不能用AI”的人工障碍。工程仍由唯一编辑器文档持有，候选只经canonical事务应用。
3. 首次保存沿现有保存Owner执行：先失效旧任务epoch/阻止迟到提交，准备活动草稿并保存；只有保存成功后才取得正式路径和新workspace，用当前工程新观察明确接续尚未完成目标。已完成receipt不能再次执行，旧CLI sessionId/trace不复制到新身份。
4. 保留旧draft对话为可查看来源，新正式会话显示来源与未完目标。AI绑定/记录写入失败不能撤销已经成功的工程保存，UI说明可重新发起的范围。
5. 取消文件选择、保存失败、Stop与保存竞态、关闭未保存工程、丢弃和崩溃恢复分别定义结果。取消/失败保留原稿与已提交内容；恢复先校验当前身份与记录，不恢复旧running为自动执行。
6. Save As始终创建新正式workspace而不复制旧会话/材料缓存。首次保存和Save As不可混作同一迁移；040的范围删除能够识别无工程讨论、draft与正式记录。

## 验收与可信反例

- 无工程讨论→draft构建/编辑→首次保存→继续，目标和当前事实正确，历史恰好记录已发生的提交；两个draft和Save As隔离。
- 取消/失败保存、保存时Stop/CLI终态、关闭/丢弃/重启恢复、同名工程，均不误绑定、不重复提交、不丢活动文字草稿；AI失败不阻塞人工保存。

## 停止条件

若方案需要修改V9持久身份或迁移真实课程内容，先提出具体合同差异；默认继续保留人工保存能力。不得靠复制旧会话/伪造路径解决首次保存连续性。

## 聚焦验证

先在实际身份/任务/持久化测试中补新转换及迟到提交反例，再做真实生命周期检查。

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)完成一次适用准备后直接运行命名文件。check:contracts仅在正式合同/生成物发生相关变化且生成步骤未已完成同义核对时执行；未变结果继续有效。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/diagnosticLog.test.ts tests/unit/useCourseProjectLifecycle.test.tsx tests/unit/projectPersistence.test.ts
npm run check:contracts
```

真实应用同时建立两个draft，完成其中一个首次保存并继续，另一个取消保存后仍可编辑；补Save As、关闭重开与一次保存中Stop。合同核对在正式生成后执行，单纯文档改动不运行产品验收。

## 回退与交接

交付本地身份和转换、失败恢复与旧记录兼容证据，044/045/041只消费这一Owner。回退保留已保存工程、原draft和可读来源，不自行重推空路径身份。
