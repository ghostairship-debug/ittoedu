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
- [src/renderer/authoring/tools/componentConfigureTool.ts](../../../../src/renderer/authoring/tools/componentConfigureTool.ts)
- [src/renderer/authoring/generation/prepareGenerationCandidate.ts](../../../../src/renderer/authoring/generation/prepareGenerationCandidate.ts)

## 允许写域与旧路径退出

正式语义操作/构造器及必要strict输入、各Surface工具Owner、唯一candidate prepare与document/resource transaction；输入增量独立合同提交后再迁consumer。

## 执行步骤

先交付已授权标题/样式/位置和已有组件公开参数的窄编辑，再补完整选区替换。目标明确时模型只输出需要改变的字段，宿主补稳定引用和合法默认值；未提及props保留，不要求回写整个对象或整包源码。一组相关修改合并成一个正式事务。普通编辑可先展示内部结果，但整个097仍须完成以下替换与失败边界才关闭。

1. 列明T04/T05所需窄意图与target/create依赖，构造器只解析已授权稳定引用和补齐正式默认值；不猜对象、不做generic JSON patch。
2. 替换明确旧target及允许附带create scope，默认保留位置/尺寸/order/visibility/rotation与适用交互；不可表达引用输出诊断。
3. 一次prepare解析全部新资源和前序引用，经既有单一事务提交；共享资源局部修改先形成新引用，不影响未选实例。
4. 迁移普通编辑candidate消费层，删除要求模型手拼UUID/缺scope的路径；验证三表面scope合法域。

## 验收与可信反例

- T04把正确标题改为“简谐运动”、放大并居中，实际文字/样式/位置一致；选区替换新增依赖并一次Undo/Redo准确恢复，保存重开与Player/导出可消费。
- 一种主力CLI用普通语言完成上述短编辑，记录实际输入/输出、往返与准备/提交/呈现耗时；已知能力不反复发现，公开参数修改不改源码、不丢未提及参数。共享三表面事务边界仍分别验证，完整三CLI同任务矩阵归103。
- 反例：create失败、后续步骤失败、目标被删、版本过期、共享引用歧义、无权限跨页，整个未提交替换零写，老内容保持。

## 停止条件

替换需要扩大到其他页面/共享实例时必须可读提问取得范围；不静默放大scope或放宽strict。无法迁移交互时列明，不吞引用。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/editorTransaction.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/assetTransactions.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx
```

真实UI检验文字编辑和一种跨carrier替换的前后、Undo/Redo、保存重开及运行；动态效果另由099验证。

## 回退与交接

交付正式意图/构造器样例、replacement/资源原子边界和098/099可复用receipt；任何回退经既有历史/对应提交完成。
