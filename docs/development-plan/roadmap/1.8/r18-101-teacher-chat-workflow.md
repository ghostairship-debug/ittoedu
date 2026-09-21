# r18-101-teacher-chat-workflow：交付讨论计划编辑模型控制可读进度与视觉变更审阅

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`, `r18-096-capability-workspace`, `r18-100-task-feedback-loop`
- Optional: 否
- Write locks: `chat-ui`, `workspace-shell`
- Gaps: G04, G05, G06

## 结果与现状

教师在输入区直接控制讨论/计划/编辑、模型/强度、引用范围和同步状态；能读懂正文/进度/提问、处理必要原生授权、运行中纠正并审阅视觉变更。

2026-09-09核验：模型/强度、意图、引用范围、补充/纠正/Stop与auto/preview入口已有实现；“入口缺失”保留为历史问题，不重新开发一套聊天壳。本轮按[统一方案](../../../../AI编辑最短路径产品决策报告.md)修剩余可见问题：机器候选在流式阶段泄漏为正文、配置与usage真实性、finish/unchanged和回执未完整等状态投影、preview到期，以及与main持久终态一致。OpenCode当前目录/UI故障仍需分段定位，不能用后台目录刷新错误代替根因。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/renderer/ui/chat/CourseChatPanel.tsx](../../../../src/renderer/ui/chat/CourseChatPanel.tsx)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentProjection.ts](../../../../src/shared/localAgentProjection.ts)
- [src/renderer/authoring/generation/generationTaskController.ts](../../../../src/renderer/authoring/generation/generationTaskController.ts)
- [src/renderer/authoring/generation/generationPreview.ts](../../../../src/renderer/authoring/generation/generationPreview.ts)
- [src/renderer/authoring/generation/generationSnapshot.ts](../../../../src/renderer/authoring/generation/generationSnapshot.ts)
- [tests/e2e/chatFailureFixture.ts](../../../../tests/e2e/chatFailureFixture.ts)

## 允许写域与旧路径退出

Chat与Workspace UI投影、可读事件组件、引用/提问/原生授权/变更审阅与必要可访问样式；只消费090的正式事件及091/096/100，不维护私有model/task/history或第二权限状态。

## 执行步骤

本节点在现有Chat保留当前任务必要操作，补准确的未应用/已应用/无需修改/部分完成/失败、回执待保存或待送达状态及变更审阅。以下剩余行为通过才形成更新后的工程证据，不把文档更新当产品完成。聊天首页、项目/会话布局、首个产物展开画布、极简局部AI/专业模式及未命名/双流程归1.9的041/042/044，不前置到本节点。

进入本节点前，090须为092–094基础门提供现有聊天壳的最小原生授权请求/回答；本节点沿用并完善焦点、详情和整体任务呈现，不重新实现授权Owner，也不作为adapter或100首次真实纵切的前置。

1. 输入附近持续显示意图、真实model/effort、默认观察和工程修改范围、观察是否同步；新会话默认编辑，用户文字中的只讨论/先计划优先。原生CLI有效授权另行表达，选区或当前页范围不能冒充CLI全部文件权限。
2. 消费090/adapter的正文、公开摘要、计划、工具活动、问题、候选、提交、验证分型事件；按item/phase/type与turn终态分流，机器候选不能先作为正文输出再折叠。完整有效候选才可交付；结构化reply只显示可读内容，普通代码/JSON讨论正常显示，不以花括号过滤。覆盖逐字符、多消息项、非最终候选、异常结束、取消迟到和历史重开。
3. 任务运行时保留补充/纠正/回答输入与Stop；分别显示已接收/已消费，问题有可达焦点，未处理问题不淹没在日志。
4. 预览模式展示前后画面、目标列表和共享影响，待应用不能标完成；正式应用后消费共同终态。committed显示实际变化与适用Undo，正式unchanged显示无需修改且无新Undo项；有后续人工历史时遵守原历史顺序。20分钟绝对deadline来自共同Owner，waiting-input/awaiting-apply不隐式延长；到期候选不能直接应用，再次请求经新输入/观察入口准备，UI不私自重置预算。
5. 将三adapter实际需要的原生授权请求通过正式事件展示，回传允许/拒绝/取消及原生支持的选项，标明等待与结果；不统一拒绝，不默认提权，不制作CLI没有的选项。原生文件/工具成功与候选/正式工程提交分别显示，已有MCP等原生连接不因应用不建设MCP平台而被隐藏或阻断。
6. finish与必要observe/continue投影同一main/AiTask状态，不以renderer忙碌结束自行判成功。回执保存失败准确显示已应用但记录未完整；原生注入未确认显示待送，不能称CLI已收到。已持久化终态可重开恢复，未落盘即崩溃的未知状态不补造完成。技术smoke与requires-review按实际证据呈现，不包装为所有互动/教学目标通过。
7. 模型/强度区分待应用与原生已生效，目录错误可定位/刷新，不新建UI私有配置真相。usage消费正式来源和本次/累计口径，unknown不补零；性能分别记录首次正确结果、任务终结及人工等待，不能以首字或进度数量代替完成。

## 验收与可信反例

- T01/T08/T11可仅用普通UI完成；编辑无法执行明确显示未完成，取消/失败不阻断人工编辑与保存。
- finish后无多余总结turn；正式unchanged无新revision/Undo项；preview待应用及到期不误显完成。main/renderer和已持久化历史重开一致，回执待保存/待送与跨崩溃未知状态如实展示。
- 反例：模型目录变动、超长JSON/正文、Markdown危险内容、服务错误、断线、待回答时切页，不丢问题/误显模型/把completed标已修改。
- 机器候选的流式、最终、取消与重开路径不泄漏信封；普通JSON讨论仍可读。严格错误定位字段和真实usage经过UI投影不丢失、不累计重计，动态技术通过不冒充语义通过。
- 原生授权可仅通过软件允许、拒绝或取消，键盘可达；过期请求/重复点击不误投任务。默认观察范围缩小不改变CLI权限，界面不能把CLI外部文件变化说成已进入当前画布或History。

## 停止条件

UI所需能力尚未被原生确认时标不可用或等待，不写虚假控件；不在UI修补协议身份或另建状态机。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts --grep "S3 默认可见与普通讨论：安全消息、完整历史及零工程写入|S3 聊天失败注入：一次修复、无进展停止、取消与人工撤销后旧结果零写入"
```

上述既有命名用例只证明其实际覆盖的UI/失败路径，不证明新增消息分流、finish、unchanged或preview到期。实现这些行为时补直接命名用例并更新过滤，严格错误/usage协议测试与090/adapter共用。用主力CLI真实窗口验证必要操作和完成状态；允许/拒绝/取消确定性事件与adapter共享，不重复付费链。键盘可达关键操作，至少30个本地原生事件测UI投影p95≤300ms；首次正确结果另行核对，用户等待单列。三CLI完整差异由103汇合，不以主力结果代签其他CLI。

## 回退与交接

交付教师操作截图/键盘顺序/可读状态文案与102恢复显示入口；原始trace继续归本地AI owner，不进课件。
