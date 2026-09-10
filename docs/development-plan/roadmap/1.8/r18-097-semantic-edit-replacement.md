# r18-097-semantic-edit-replacement：闭合一般语义编辑与选区依赖创建和原子替换

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`, `r18-095-authoring-observation`
- Optional: 否
- Write locks: `authoring-slide`, `authoring-flow`, `authoring-spatial`, `store-kernel`, `contracts-schema`, `generated-index`
- Gaps: G03, G08

## 结果与现状

教师可自然修改文字/样式/位置或将选区替换为另一载体；必要资产/载体创建、旧对象删除与引用迁移在一个正式事务完成。

当前已有多步候选、$result前序引用、选区依赖创建、私有预演和原子替换后一次事务提交。剩余改进是短传输、宿主展开已知身份、批量组织及失败后的操作语义保护；不重建替换机制。本轮按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)修正这些缺口，既有通过证据继续有效。

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

短传输是090现有Generation合同下的版本化投影视图，由公共合同Owner先定义，宿主展开后进入原完整candidate；不另建协议平台或V9写入格式。generationContract、prepareGenerationCandidate及共享carrier/target规则各由一个实际writer维护，096派生卡片和099动态consumer在稳定窄接口后接线，重叠实现顺序集成。

## 执行步骤

在已实现的窄编辑和选区替换上，目标明确时模型只输出正式操作、请求内目标短引用和需要改变的参数；宿主补冻结请求已知身份与正式默认值。未提及props保留，不要求回写整个对象或整包源码。普通准确编辑与批量/交互修改分别取得直接证据，不以其中一类代签另一类，也不因旧节点已集成省略本轮新增边界。

1. 将T04/T05等正式操作映射到当前请求冻结的canonical destination、revision、sessionGeneration/epoch及必要资源身份；strict短投影展开后仍经完整candidate解析、精确目标校验和正式Facade。未知、跨请求、过期或不匹配短引用明确拒绝，不解释成当前活动选择。carrier沿已有规则派生，不伪造必要载体理由、不跳准入；新旧adapter按显式版本能力处理，不猜对象、不做generic JSON patch。
2. 替换明确旧target及允许附带create scope，默认保留位置/尺寸/order/visibility/rotation与适用交互；不可表达引用输出诊断。
3. 复用多步候选和$result，把关联修改及同对象语义兼容配置合为一批私有预演、一次正式事务和一次撤销。创建→引用→替换保持顺序；依赖实际运行输出的后续步骤保留阶段边界。新ID由真实工具结果产生；共享资源局部修改沿既有派生引用，不影响未选实例。
4. 迁移短投影的直接producer/consumer与同源示例，退出要求模型重复宿主已知UUID/完整target的对应路径；不适合短投影的操作仍可用完整正式candidate。验证三表面scope与前序引用合法域，不并存两套工程或完成真相。

## 验收与可信反例

- T04把正确标题改为“简谐运动”、放大并居中，实际文字/样式/位置一致；选区替换新增依赖并一次Undo/Redo准确恢复，保存重开与Player/导出可消费。
- 一种主力CLI用普通语言完成上述短编辑，记录实际输入/输出、往返与准备/提交/呈现耗时；已知能力不反复发现，公开参数修改不改源码、不丢未提及参数。共享三表面事务边界仍分别验证，完整三CLI同任务矩阵归103。
- 反例：create失败、后续步骤失败、目标被删、版本过期、共享引用歧义、无权限跨页，整个未提交替换零写，老内容保持。
- 同一操作的完整candidate与短投影展开后取得相同业务结果、正式回执和一次撤销；未知/跨请求别名、stale、scope不符和前序引用错误均不能提交。
- 首次候选和失败后候选均核对任务允许的操作与影响；图片换色失败不得改用文本块或遮盖物并宣称完成。不能只查外框或carrier，因为image→text仍可同属Native；授权重排或载体转换仍可正常完成。

## 停止条件

需要扩大到原授权之外的页面/共享实例时，先检查用户已有明确决定；授权不足才取得缺失范围，不重复询问已确定事项。失败恢复不得未经新意图或既有授权依据改换对象、内容或操作语义；不静默放大scope或放宽strict。无法迁移交互时列明，不吞引用。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/editorTransaction.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/assetTransactions.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx
```

上述已有事务/会话入口只证明其原覆盖，不证明短投影已实现。实施时补短/完整candidate业务等价、未知与跨请求短引用、stale、批量前序依赖和失败恢复语义的命名用例，再登记实际测试文件和过滤条件。真实UI检验文字编辑和一种授权跨carrier替换的前后、Undo/Redo、保存重开及运行；动态效果另由099验证。

## 回退与交接

交付正式意图/构造器样例、replacement/资源原子边界和098/099可复用receipt；任何回退经既有历史/对应提交完成。
