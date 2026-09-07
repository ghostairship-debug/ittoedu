# r18-090-ai-task-contract：定义任务观察候选反馈与应用策略的版本化共同合同

- Release: 1.8
- Dependencies: `r18-088-plugin-baseline-probes`
- Optional: 否
- Write locks: `contracts-schema`, `ai-session`
- Gaps: G03, G05, G06, G08, G09, G12

## 结果与现状

把共同实施合同落成正式strict本地协议与迁移：任务不等于CLI单轮，观察可更新、候选有身份、提交有receipt、讨论/计划/编辑与应用策略可被宿主约束。

已有localAgent V1事件与generation V1候选可复用，但不能表示完整任务/观察/问答/续轮状态。V9与Published V2不改变。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/generationContract.ts](../../../../src/shared/generationContract.ts)
- [src/shared/authoringToolContract.ts](../../../../src/shared/authoringToolContract.ts)
- [src/main/localAgent/repository.ts](../../../../src/main/localAgent/repository.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)

## 允许写域与旧路径退出

正式shared本地AI合同、解析器、repository迁移及其唯一consumer适配；合同增量独立提交并保持旧记录可读。提前定义097语义替换和098资源操作需要的范围/引用规则，不提前实现产品功能。

## 执行步骤

1. 根据088实证固定Task/Observation/Proposal/HostResult/UserInput字段、状态转移、intent、applyPolicy、读写范围与能力确认事件。
2. 固定workspace/task/epoch/request/observation/candidate/receipt关联；明确重复、乱序、取消、过期与已提交部分保留，按共同合同第2/3/6节定义。
3. 旧记录逐版本严格解析、只读迁移；旧running和候选不能自动续写，坏记录隔离。新任务经新版本入口，删除已迁移consumer的旧私有类型。
4. 将合同映射到真实owner与消费顺序；串行提交租约、活动草稿和未来draft身份只扩本地AI域，不把聊天写入工程。

## 验收与可信反例

- 所有生产consumer从同一正式合同导入；合法事件往返保持身份/null字段；讨论/计划不能进入工程候选提交。
- 反例：跨workspace、旧epoch、重复receipt、未知版本/字段、损坏记录、旧候选恢复均明确拒绝或隔离，工程零新增写入。

## 停止条件

若088仍有未证实原生能力，不能虚构统一接口能力；若需要V9字段或新writer先说明必要性并更新上位合同。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run check:contracts
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
```

用一份真实旧会话和一份新记录验证可读迁移及新观察启动；fixture用于乱序/损坏等确定性边界。

## 回退与交接

交付状态表、字段语义、迁移样例和下一包consumer清单。迁移失败隔离记录并保留原文件，不影响工程打开。
