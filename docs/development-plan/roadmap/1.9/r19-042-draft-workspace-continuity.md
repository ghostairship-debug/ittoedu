# r19-042-draft-workspace-continuity：支持未命名工程AI与首次保存后的明确身份切换

- Release: 1.9
- Dependencies: `r19-040-session-persistence-deletion`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `app-save-recovery`, `chat-ui`
- Gaps: G09

## 结果与现状

未命名课件可使用AI；首次保存切换到正式workspace后能明确继续尚未完成目标，两个未命名工程、Save As与恢复互不混淆。

当前会话依赖保存路径；draft身份是本地AI域补充，不需要V9升级。首次保存不能静默复制外部会话/trace。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/workspaceIdentity.ts](../../../../src/main/workspaceIdentity.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/projectPersistence.ts](../../../../src/main/projectPersistence.ts)
- [tests/unit/useCourseProjectLifecycle.test.tsx](../../../../tests/unit/useCourseProjectLifecycle.test.tsx)
- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)

## 允许写域与旧路径退出

正式本地draft identity合同、workspace/保存生命周期接线、AI repository和Chat切换；合同先独立提交，不把空路径当身份。

## 执行步骤

1. 创建应用管理的draft身份，生命周期与工程实例关联；崩溃恢复/丢弃有明确映射与清理，不扩V9。
2. 首次保存按共同合同第8节：旧epoch停止→保存成功→新身份/新观察→明确重新绑定未完用户目标；不继承旧CLI sessionId/trace。
3. 旧draft对话保留为可查看历史；新正式会话显示来源与当前目标，绑定失败不影响保存，也不自动再次执行已完成步骤。
4. Save As始终新身份不复制；未命名课件关闭/取消保存/重启恢复分别处理，人工保存/Undo优先保持。

## 验收与可信反例

- 未保存新课件可讨论与编辑；首次保存后继续目标读取新状态且不重复提交；两个draft隔离，Save As不带旧会话。
- 反例：另存失败、取消路径选择、保存中Stop/CLI完成、关闭未保存工程、恢复旧draft，均不错误绑定/丢工程/复制历史。

## 停止条件

若首次保存流程会吞人工草稿或要求修改Course Project身份语义，停止该路径并给出合同差异，保留人工保存。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:contracts
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/useCourseProjectLifecycle.test.tsx tests/unit/editorTransaction.test.ts
```

真实未命名工程编辑→首次保存→继续，另做取消保存/Save As/关闭重开；核对AI来源提示和实际文档内容。

## 回退与交接

交付draft到正式身份转移与失败恢复证据；043/050使用同一生命周期，不再自行推导空路径身份。
