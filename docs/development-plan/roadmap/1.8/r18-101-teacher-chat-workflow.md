# r18-101-teacher-chat-workflow：交付讨论计划编辑模型控制可读进度与视觉变更审阅

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`, `r18-096-capability-workspace`, `r18-100-task-feedback-loop`
- Optional: 否
- Write locks: `chat-ui`, `workspace-shell`
- Gaps: G04, G05, G06

## 结果与现状

教师在输入区直接控制讨论/计划/编辑、模型/强度、引用范围和同步状态；能读懂正文/进度/提问、运行中纠正并审阅视觉变更。

模型/模式入口缺失，原始事件JSON与busy禁用输入损害可控性；现有可见聊天外壳可以复用。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/renderer/authoring/generation/generationPreview.ts](../../../../src/renderer/authoring/generation/generationPreview.ts)
- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [tests/e2e/chatFailureFixture.ts](../../../../tests/e2e/chatFailureFixture.ts)

## 允许写域与旧路径退出

Chat与Workspace UI投影、可读事件组件、引用/提问/变更审阅与必要可访问样式；只消费091/096/100，不维护私有model/task/history。

## 执行步骤

1. 输入附近持续显示意图、真实model/effort、读写范围、观察是否同步；新会话默认编辑，用户文字中的只讨论/先计划优先。
2. 正文、公开摘要、计划、工具活动、问题、候选、提交、验证分型呈现，原始JSON折叠到诊断；同一item增量与终态去重。
3. 任务运行时保留补充/纠正/回答输入与Stop；分别显示已接收/已消费，问题有可达焦点，未处理问题不淹没在日志。
4. 预览模式展示前后画面、目标列表和共享影响，默认自动编辑展示已应用结果与Undo；有后续人工历史时遵守原历史顺序。

## 验收与可信反例

- T01/T08/T11可仅用普通UI完成；编辑无法执行明确显示未完成，取消/失败不阻断人工编辑与保存。
- 反例：模型目录变动、超长JSON/正文、Markdown危险内容、服务错误、断线、待回答时切页，不丢问题/误显模型/把completed标已修改。

## 停止条件

UI所需能力尚未被原生确认时标不可用或等待，不写虚假控件；不在UI修补协议身份或另建状态机。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/formulaNodeUi.test.tsx tests/unit/electronLaunchEnvironment.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实窗口按讨论→计划→执行→中途纠正→查看变更→Undo走完；键盘可达关键操作，至少30个本地原生事件测UI投影p95≤300ms。

## 回退与交接

交付教师操作截图/键盘顺序/可读状态文案与102恢复显示入口；原始trace继续归本地AI owner，不进课件。
