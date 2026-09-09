# r18-090-ai-task-contract：定义任务观察候选反馈与应用策略的版本化共同合同

- Release: 1.8
- Dependencies: `r18-088-plugin-baseline-probes`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`, `main-preload`, `chat-ui`
- Gaps: G03, G05, G06, G08, G09, G12

## 结果与现状

把共同实施合同落成正式strict本地协议与迁移：任务不等于CLI单轮，观察可更新、候选有身份、提交有receipt、讨论/计划/编辑与应用策略可被宿主约束。

完整原生CLI是长期执行核心。默认观察范围、用户要求的工程修改范围与原生CLI权限分别表达；本合同承载实际原生配置和必要授权往返，不将最小snapshot变成文件/终端/网络/工具/Skills/子任务的能力沙箱。

已有localAgent V1事件与generation V1候选可复用，但不能表示完整任务/观察/问答/续轮状态。V9与Published V2不改变。

正式strict类型、原生端口、V2持久化、V1只读投影与批次回执已有工作区实现。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)发现生产Harness尚未闭合Claude真实外部身份持久化、偏好进入新运行和初始化失败/取消收口；与091–094在原Owner边界修复。按[首批执行包第4节](FIRST_BATCH_EXECUTION.md#4-090-b公共owner和旧记录接线)核对实际consumer，不重建合同或把旧V1模拟测试通过当作新V2接线完成。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentTaskGuards.ts](../../../../src/shared/localAgentTaskGuards.ts)
- [src/shared/generationContract.ts](../../../../src/shared/generationContract.ts)
- [src/shared/authoringToolContract.ts](../../../../src/shared/authoringToolContract.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)

## 允许写域与旧路径退出

正式shared本地AI合同、解析器、repository迁移及其唯一consumer适配，Harness和process中的公共启动上下文接线，以及现有聊天壳的最小原生授权请求/回答consumer；合同增量独立提交并保持旧记录可读。提前定义097语义替换和098资源操作需要的范围/引用规则，不提前实现097/098产品功能。只增加真实原生事件需要的窄字段与回传，不建设自有模型循环、独立MCP服务、通用工具RPC或第二权限平台。

## 执行步骤

1. 根据088实证固定Task/Observation/Proposal/HostResult/UserInput字段、状态转移、intent、applyPolicy、工程范围与能力确认事件；为实际需要的原生授权请求、允许/拒绝/取消回传补关联身份，不能虚构三CLI共有能力。
2. 固定workspace/task/epoch/request/observation/candidate/receipt关联；明确重复、乱序、取消、过期与已提交部分保留，按共同合同第2/3/6节定义。
3. 旧记录逐版本严格解析、只读迁移；旧running和候选不能自动续写，坏记录隔离。新任务经新版本入口，删除已迁移consumer的旧私有类型。
4. 将合同映射到真实owner与消费顺序；串行提交租约、活动草稿和未来draft身份只扩本地AI域，不把聊天写入工程。
5. 与091固定原生工作上下文和有效配置来源，分开CLI工作目录与候选根。当前Harness一律以session staging作为cwd、process筛除大部分继承环境的路径须按实际配置发现需要迁移；保留用户/目录配置及必要环境，不读取凭据正文、不把环境或秘密写入会话trace。
6. 在现有聊天壳接通最小原生授权请求与允许/拒绝/取消回答，消费同一正式事件并显示等待/结果，使092–094基础门可以通过软件实际完成。使用本节点现有chat-ui/main-preload写锁顺序集成；101再完善展示、审阅与可用性，不是原生授权或100反馈纵切的前置。

本次修复由唯一Harness消费原生已确认会话身份，不能只对V1 adapter更新；临时/待确认身份不得成为可恢复句柄。与093证明新建→持久化→应用继续使用同一真实ID；与092/094证明初始化退出/取消后run.done可结束、槽位释放、下次启动可用。配置偏好与实际确认的职责由091持有，不能在Chat补一份状态。

Observation的readScope只界定本轮默认附带的工程观察，writeDestinations约束正式工程编辑；两者不能充当CLI整体文件权限。宿主只从当前candidate root内realpath闭合制品或正式结构化通道摄取候选，经canonical文档资源事务提交。CLI在原生授权下的文件/工具操作与画布、History提交分开记录；外部文件变化沿原保存/冲突生命周期处理，不冒称已同步。Generated Component/Runtime仍受自身宿主合同约束。

## 验收与可信反例

- 所有生产consumer从同一正式合同导入；合法事件往返保持身份/null字段；讨论/计划不能进入工程候选提交。
- 反例：跨workspace、旧epoch、重复receipt、未知版本/字段、损坏记录、旧候选恢复均明确拒绝或隔离，工程零新增写入。
- 补生产V2 adapter与Harness之间的身份/失败测试，不能只通过V1 transport wrapper证明新链；原生ID未确认或互相冲突时不得静默恢复另一会话。
- 原生授权往返保留request/turn/task关联与允许、拒绝、取消语义，过期或重复回答不误投；候选root外制品不能被宿主摄取，但已授权的普通CLI文件操作不因观察scope被产品拒绝。

## 停止条件

若088仍有未证实原生能力，不能虚构统一接口能力；若需要V9字段或新writer先说明必要性并更新上位合同。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/diagnosticLog.test.ts tests/unit/editorTransaction.test.ts
npm run typecheck
```

用一份真实旧会话和一份新记录验证可读迁移及新观察启动；fixture用于乱序/损坏、原生授权关联与配置来源等确定性边界。真实能力对等证据由092–094/103汇合，本节点不重复三CLI完整任务矩阵。

## 回退与交接

交付状态表、字段语义、迁移样例和下一包consumer清单。迁移失败隔离记录并保留原文件，不影响工程打开。
