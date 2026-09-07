# r18-097-semantic-edit-replacement：闭合一般语义编辑与选区依赖创建和原子替换

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-095-authoring-observation`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `store-kernel`, `contracts-schema`, `generated-index`
- Gaps: G03, G08

## 结果与现状

教师可自然修改文字/样式/位置或将选区替换为另一载体；必要资产/载体创建、旧对象删除与引用迁移在一个正式事务完成。

选区快照无create scope，Native type不可变，现有创建能力分散；不能让模型猜UUID或先删旧对象再试建。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/shared/authoringToolContract.ts](../../../../src/shared/authoringToolContract.ts)
- [src/shared/generationContract.ts](../../../../src/shared/generationContract.ts)
- [src/renderer/authoring/tools/authoringToolScope.ts](../../../../src/renderer/authoring/tools/authoringToolScope.ts)
- [src/renderer/authoring/tools/nativeAuthoringTool.ts](../../../../src/renderer/authoring/tools/nativeAuthoringTool.ts)
- [src/renderer/authoring/tools/flowAuthoringTool.ts](../../../../src/renderer/authoring/tools/flowAuthoringTool.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)

## 允许写域与旧路径退出

正式语义操作/构造器及必要strict输入、各Surface工具Owner、唯一candidate prepare与document/resource transaction；输入增量独立合同提交后再迁consumer。

## 执行步骤

1. 列明T04/T05所需窄意图与target/create依赖，构造器只解析已授权稳定引用和补齐正式默认值；不猜对象、不做generic JSON patch。
2. 替换明确旧target及允许附带create scope，默认保留位置/尺寸/order/visibility/rotation与适用交互；不可表达引用输出诊断。
3. 一次prepare解析全部新资源和前序引用，经既有单一事务提交；共享资源局部修改先形成新引用，不影响未选实例。
4. 迁移普通编辑candidate消费层，删除要求模型手拼UUID/缺scope的路径；验证三表面scope合法域。

## 验收与可信反例

- T04把正确标题改为“简谐运动”、放大并居中，实际文字/样式/位置一致；选区替换新增依赖并一次Undo/Redo准确恢复，保存重开与Player/导出可消费。
- 反例：create失败、后续步骤失败、目标被删、版本过期、共享引用歧义、无权限跨页，整个未提交替换零写，老内容保持。

## 停止条件

替换需要扩大到其他页面/共享实例时必须可读提问取得范围；不静默放大scope或放宽strict。无法迁移交互时列明，不吞引用。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/assetTransactions.test.ts
npm run test:product -- tests/integration/mixedCrossSurfaceHistory.test.tsx
```

真实UI检验文字编辑和一种跨carrier替换的前后、Undo/Redo、保存重开及运行；动态效果另由099验证。

## 回退与交接

交付正式意图/构造器样例、replacement/资源原子边界和098/099可复用receipt；任何回退经既有历史/对应提交完成。
