# r18-090-ai-task-contract：定义任务观察候选反馈与应用策略的版本化共同合同

- Release: 1.8
- Dependencies: `r18-088-plugin-baseline-probes`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `main-preload`, `chat-ui`
- Gaps: G03, G05, G06, G08, G09, G12

## 结果与现状

把共同实施合同落成正式strict本地协议与迁移：任务不等于CLI单轮，观察可更新、候选有身份、提交有receipt、讨论/计划/编辑与应用策略可被宿主约束。

完整原生CLI是长期执行核心。默认观察范围、用户要求的工程修改范围与原生CLI权限分别表达；本合同承载实际原生配置和必要授权往返，不将最小snapshot变成文件/终端/网络/工具/Skills/子任务的能力沙箱。

2026-09-09核验：正式strict类型、原生端口、V2持久化、V1只读投影、批次回执、同任务续行和执行预算已经集成。V1只承担适用的旧记录展示或现有候选内部载荷，不能替代完整V2任务状态；V9与Published V2不改变。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)保留为历史来源，当前剩余工作按[执行包](FIRST_BATCH_EXECUTION.md)推进；已关闭的问题不重新实例化。

本轮按[统一方案](../../../../AI编辑最短路径产品决策报告.md)补剩余共同语义：提交后finish或必要观察/续行、正式unchanged、main/renderer一致的持久终态、回执送达、严格错误与用量投影，以及既有20分钟绝对deadline贯穿完整处理链。它们仍待实现和直接验证，不能以既有continue或receipt测试通过代签。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)
- [src/shared/localAgentProjection.ts](../../../../src/shared/localAgentProjection.ts)
- [src/shared/generationContract.ts](../../../../src/shared/generationContract.ts)
- [src/shared/authoringToolContract.ts](../../../../src/shared/authoringToolContract.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)
- [src/renderer/authoring/generation/generationTaskController.ts](../../../../src/renderer/authoring/generation/generationTaskController.ts)

## 允许写域与旧路径退出

正式shared本地AI合同、解析器、repository迁移及直接consumer，Harness公共启动/终态/回执接线，以及现有聊天壳的必要事件投影；合同增量独立提交并保持旧记录可读。复用097/098现有范围与资源引用规则，新增完成意图、回执送达、结构化失败、准确usage和预算所需的窄字段，不建设自有模型循环、独立MCP服务、通用工具RPC或第二权限平台。

## 执行步骤

1. 在现有Task/Observation/Proposal/HostResult/UserInput中版本化提交后finish或observe/continue语义。声明只在检查通过、正式committed或unchanged回执已保存且必要证据满足时生效；preview待应用不是完成。旧adapter缺字段走有预算兼容路径，不默认finish。
2. 保持workspace/task/epoch/request/observation/candidate/receipt关联，沿共同合同第2/3/6节补main harness、AiTask guard/持久化、renderer和历史投影的同一终态。完成不依赖额外模型总结；正式unchanged不增加revision或撤销项，任意空候选不能冒充无需修改。
3. 旧记录逐版本严格解析、只读迁移；旧running和候选不能自动续写，坏记录隔离。新任务经新版本入口，删除已迁移consumer的旧私有类型。
4. 在同一Owner表达回执已持久化与已送达原生的区别。Codex的thread/inject_items仅在对应版本的身份、角色、幂等和恢复行为验证后使用；不支持或注入失败时准确标记待送，下次真正请求前带入，不为送回执固定启动推理。已提交但记录写入失败只重试记录；未落盘即崩溃的未知状态不得自动replay或补造receipt。
5. 复用AiTask.execution的20分钟绝对deadline，使观察、原生执行、prepare、必要准入和提交前检查消费同一剩余预算；子阶段不重置。awaiting-apply/waiting-input不隐式延长，到期恢复须新输入/新观察，不能直接应用旧候选。保留一次明确诊断的格式修复；首个失败建立基线，其后连续两次无实质进展停止。
6. 让错误码、阶段/步骤、目标/资产、字段路径、revision、是否提交和实际已有行为帧/状态穿过严格错误投影。usage沿真实wire→正式事件→持久化→投影→UI贯通，区分本次/累计、去重与unknown；不虚构三CLI共有字段或内部模型请求数。
7. 与091保留已接通的原生工作上下文、有效配置来源和必要授权回答，CLI工作目录与candidate root分开；只修当前配置/事件的实际缺口。非秘密偏好与原生确认由唯一Owner负责，不在Chat复制状态，不把环境或秘密写入trace。

原生已确认会话身份、初始化退出/取消收口与配置偏好的有效证据继续复用；本轮共同合同变化命中其consumer时才补受影响检查。临时/待确认身份不得成为可恢复句柄，不能只改V1投影而遗漏V2持久化。

Observation的readScope只界定本轮默认附带的工程观察，writeDestinations约束正式工程编辑；两者不能充当CLI整体文件权限。宿主只从当前candidate root内realpath闭合制品或正式结构化通道摄取候选，经canonical文档资源事务提交。CLI在原生授权下的文件/工具操作与画布、History提交分开记录；外部文件变化沿原保存/冲突生命周期处理，不冒称已同步。Generated Component/Runtime仍受自身宿主合同约束。

## 验收与可信反例

- 所有生产consumer从同一正式合同导入；合法事件往返保持身份/null字段；讨论/计划不能进入工程候选提交。
- committed/unchanged后的finish与必要observe/continue各有明确终态；preview未应用不finish；main/renderer/AiTask及已持久记录重开一致，旧adapter缺元数据不假完成。
- 回执保存失败只重试记录，不重复工程提交；无推理注入与待送状态准确，不声称未实现的跨崩溃恢复。严格错误/usage经过持久化和投影仍保留原生实际提供的定位字段与计量口径。
- 同一绝对deadline跨阶段保留，preview等待不隐式延长；到期不能提交。无进展按首失败基线加两次重复计数，随机身份或summary变化不能重置。
- 反例：跨workspace、旧epoch、重复receipt、未知版本/字段、损坏记录、旧候选恢复均明确拒绝或隔离，工程零新增写入。
- 补生产V2 adapter与Harness之间的身份/失败测试，不能只通过V1 transport wrapper证明新链；原生ID未确认或互相冲突时不得静默恢复另一会话。
- 原生授权往返保留request/turn/task关联与允许、拒绝、取消语义，过期或重复回答不误投；候选root外制品不能被宿主摄取，但已授权的普通CLI文件操作不因观察scope被产品拒绝。

## 停止条件

若088仍有未证实原生能力，不能虚构统一接口能力；若需要V9字段或新writer先说明必要性并更新上位合同。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts -t "round-trips V2 records without treating a native turn end as task completion|deduplicates identical receipts and rejects conflicts without adding a second commit|cannot report a checked candidate or an empty receipt as a real commit"
npm run typecheck
```

上述现有用例仅覆盖既有身份、真实回执和CLI回合/任务区别。实现本轮增量时补finish/unchanged、严格错误/usage往返、deadline等待及回执送达的命名用例，再更新选择；未实现用例不写成已通过。涉及记录演进时用旧会话和新记录验证可读性；真实原生能力证据由092–094/103汇合，不重复三CLI完整任务矩阵。

## 回退与交接

交付状态表、字段语义、迁移样例和下一包consumer清单。迁移失败隔离记录并保留原文件，不影响工程打开。
