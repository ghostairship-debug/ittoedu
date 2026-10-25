# 自动／逐步前置选择的判断纠正

日期：2026-10-25。按 Owner 本次纠正，只读核对当前模型指令、renderer 和保留协议；本文件是本叶子唯一写入。没有修改产品或测试，没有恢复模式 UI，没有执行测试、模型请求、commit、push 或发布。

**当前体验应当是直接发送任务，由 AI 按任务、用户原话和既有授权判断推进；自动／逐步不是开始或继续任务的前置选择。** 当前源码已明确这一方向。此前依据 repair18 历史用例名称，将“首次模式选择／UI 切换”当作当前常用产品入口，是判断错误，应撤回该产品描述。历史用例及其失败只证明相应 fixture／保留协议的观察，不能作为恢复前置模式 UI 的依据。

## 1. 当前模型合同

| 当前源码证据 | 实际边界 |
|---|---|
| [ExecutionEngine.ts:1059](../../../src/main/workbench/execution/ExecutionEngine.ts#L1059) | 明确要求“不要询问用户选择自动或逐步模式，不为开始工作先调用 task.setMode”；按当前任务持续完成已授权目标，只有影响结果且不能合理推断的取舍、必要输入或权限决定才提问 |
| [userQuestion.ts:75](../../../src/shared/workbench/userQuestion.ts#L75) | `ask_user` 描述明确“不为开始创作或继续任务追加自动／逐步模式选择” |
| [userQuestion.ts:81](../../../src/shared/workbench/userQuestion.ts#L81) | `purpose:'advancement-mode'` 仅承接用户已经明确要求的推进方式选择，不主动询问模式 |
| [ExecutionEngine.ts:232](../../../src/main/workbench/execution/ExecutionEngine.ts#L232) | `task.setMode` 仅记录用户本次原话或新回答中已经明确要求的改变；通常直接判断并推进，无需先询问或先调用它 |
| [userQuestion.ts:67](../../../src/shared/workbench/userQuestion.ts#L67) | 普通 `ask_user` 仍用于不能推断的真实决定、用户明确要求的产物审阅；用户已免去该确认就不再追加确认 |

“按 AI 判断推进”仍服从用户明确的“先审阅”“逐步确认”“到某处停下”等要求，也服从原文档／文件权限；它不意味着忽略这些要求，或把所有明确偏好与提问协议删除。

## 2. 当前 UI 与发送路径

- 当前 [ExecutionAssistant.tsx:1110](../../../src/renderer/workbench/ExecutionAssistant.tsx#L1110) 直接构造消息、引用、附件、权限等发送请求，新消息不插入前置 `advancementMode` 选择。`mode` 在该处表示队列／调整等提交方式，与 `automatic/stepwise` 不是同一字段。
- 当前消息输入 [ConversationInput.tsx:105](../../../src/renderer/workbench/ConversationInput.tsx#L105) 及 composer 工具区提供消息、引用、附件、模型、权限等操作，没有固定自动／逐步选择器。全 renderer 的 `advancementMode` 命中仅为既有会话／重试等数据同步与透传；未发现 renderer 发出 `set-advancement-mode` 的现行 UI 生产者。
- 当前 [ExecutionAssistant.tsx:1508](../../../src/renderer/workbench/ExecutionAssistant.tsx#L1508) 只在已有 `openQuestion` 时渲染通用 `ExecutionQuestionCard`。[executionTimelineReadModel.ts:154](../../../src/shared/workbench/executionTimelineReadModel.ts#L154) 要求实际 `ask_user` 问题及 `status:'waiting'`；[ExecutionQuestionCard.tsx:12](../../../src/renderer/workbench/ExecutionQuestionCard.tsx#L12) 按收到的真实问题显示选项／其他想法，不内置启动模式选择。
- 所以，通用问题卡的存在不等于自动／逐步前置选择仍在。当前源码允许承接显式偏好的问题及历史协议；模型若违反指令而仍发出合法模式问题，通用卡也能显示它。本次没有模型实跑证据证明发生过这种偏离，也没有依据加一个新全局拒绝门。

以上是源码与直接消费者核对，没有冒充本次新增 GUI 实机截图或真实模型行为验收。

## 3. 为什么仍保留显式偏好／兼容协议

| 保留项 | 当前职责 |
|---|---|
| `automatic/stepwise` 数据枚举、可选 `ExecutionStart.advancementMode` | 保存已明确偏好和历史任务事实，不构成新任务必须先选的要求 |
| `ask_user.purpose`、选项稳定 `value` | 承接用户明确要求的实际选择。`advancementModeForAnswer` 仅从真实 purpose、单项选择且无其他文字的回答中返回该偏好（[userQuestion.ts:61](../../../src/shared/workbench/userQuestion.ts#L61)） |
| `task.setMode` 和有来源的接受记录 | [ExecutionEngine.ts:1260](../../../src/main/workbench/execution/ExecutionEngine.ts#L1260) 接受本次原话、已接受的用户调整或实际已答问题来源，避免凭历史文字伪造新选择；不应为了删除前置 UI 而删除这些语义 |
| Desktop `set-advancement-mode` 请求 | [executionDesktop.ts:108](../../../src/shared/workbench/executionDesktop.ts#L108) / [ExecutionDesktopService.ts:1193](../../../src/main/workbench/execution/ExecutionDesktopService.ts#L1193) 保留服务能力及有序 steering／会话持久化；协议保留不证明当前 renderer 仍有相应按钮 |
| 历史／重试数据透传 | 保留原任务已明确事实，不能借此在新普通任务里追加模式选择；当前 Main 新提交沿输入的可选字段冻结，并没有把“缺省未选模式”变成启动阻断 |

本次不删除这些协议，不改错误码、持久化或历史事实，也不重新添加它们对应的旧 UI。

## 4. repair18 历史用例的真实价值与局限

[executionRepair20261012.test.ts:77](../../../tests/integration/executionRepair20261012.test.ts#L77) 的 `repair18 persists the real first mode choice %s and accepts ordered UI switching without changing frozen input` 有以下事实：

1. 测试给用户正文只是“新建短作品”，离线 fetcher 在 79 行强行返回“采用哪种推进方式？”及自动／逐步选项。它不运行真实模型来决定是否询问，也没有证明现行 instruction 会主动产生这个问题；该 fixture 的普通启动前提与当前“不要追加前置模式选择”的合同不一致。
2. 84 行直接调用 Desktop `set-advancement-mode` 协议，没有渲染或点击一个当前真实模式选择器。因此名称中的 “UI switching” 不能作为现行 UI 入口证据。
3. 它仍覆盖保留协议的实际问答、选择的持久化、有序接受新的明确偏好，以及不篡改冻结输入等属性。这些属性有价值，但应放在“用户明确提出偏好／兼容协议”场景，不能继续用来要求恢复普通任务前置选择。
4. 前一轮已有的 automatic 新增稳定失败观察与 `executing` 早于 `active.question` 注册的时序机制分析仍须保留，不能因本次纠正悄悄改成通过。它的当前产品含义需要纠正：失败不是“当前常用启动模式 UI 已坏”的证据，也没有因此获得恢复该 UI 的授权。

## 5. 是否需要产品改动与后续 fixture 建议

**为落实本次 Owner 纠正，当前证据不要求产品代码变化。** 模型合同、发送入口与通用问题卡职责已符合取消前置模式选择的方向；本次应纠正报告和历史 fixture 的解释，不恢复旧 UI，不新增模式或操作路径。

后续如果处理这个历史 fixture，可采用以下有明确保护属性的方案，先保留原始 fullName／起终点观察或提供显式对应，不能借改名使失败消失：

- 将显式偏好协议 fixture 的用户原话改为真正要求选择／记录偏好的场景，继续保留持久化、有序新选择、冻结输入不改、重开等实质断言。若保留直接 `set-advancement-mode` 服务调用，应准确标为服务兼容性覆盖，不声称点击了真实 UI。
- 问答夹具应以真实 `waiting` 且带问题的事件作为可回答信号，避免把内部 `executing` 当成 question-ready；该准备条件的调整不能删掉拒绝重复／停止后回答等正确边界。
- 普通新任务的合同覆盖应证明没有前置选择要求、没有缺省模式启动门，并保留遇到真实不能推断决定时的普通提问能力。离线响应不能替代“真实模型是否遵从指令”的证据，不为此启动付费模型矩阵。

本文件仅提出上述 fixture 方向，尚未修改任何测试源码或生产实现。后续有新的 UI、默认动作或操作路径变化仍按 Owner 要求先确认。
