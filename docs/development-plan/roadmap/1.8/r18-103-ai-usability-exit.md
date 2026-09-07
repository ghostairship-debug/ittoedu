# r18-103-ai-usability-exit：完成助手与外部Builder自然语言可用性工程结束门

- Release: 1.8
- Dependencies: `r18-089-flow-viewport-repair`, `r18-096-capability-workspace`, `r18-098-image-edit-transaction`, `r18-099-dynamic-edit-verification`, `r18-101-teacher-chat-workflow`, `r18-102-freshness-conflict-recovery`, `r18-104-builder-skill-discovery`
- Optional: 否
- Write locks: `generated-index`, `chat-ui`
- Gaps: G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12

## 结果与现状

以普通教师提示在三CLI完成理解、编辑、验证和人工交替，并让实际Build Skill从外部课例目录按需构建/修订；关闭G01–G12当前阻断后形成S3可复核工程候选。

当前旧窄路径成功与G01–G12失败同时存在；本包不能把CLI能启动、fixture通过或指定内部协议的提示当一般编辑完成。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)
- [docs/development-plan/reviews/1.8-ai-assistant-gap-register.md](../../reviews/1.8-ai-assistant-gap-register.md)
- [tests/e2e/stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)
- [tests/unit/coursewareCaseBuilder.test.ts](../../../../tests/unit/coursewareCaseBuilder.test.ts)

## 允许写域与旧路径退出

真实验收驱动/结果文档、必要的发现/Chat证据接线；产品缺陷返回其Owner节点修复再更新本包证据，不以本包锁跨域补丁。

## 执行步骤

1. 冻结实际候选版本、课例、CLI/model/effort与T01–T12原话；不向测试提示补UUID、scope、component.package等内部指导。
2. 按开发方案第6节执行本版矩阵：关键链每CLI预先固定3次独立完整运行，含新会话/延续会话，三次均成功；保留全部失败，任何失败先定位归因，只在相关问题关闭后重做受影响证据。
3. 覆盖讨论零写、图片保真、文字/Runtime替换及变慢、Flow/Spatial、按钮排错、模型/纠正/Stop、人工并发、Undo/保存重开/Player/适用导出。
4. 复核104外部Builder的真实读取轨迹和产物；测本地上下文/事件延迟及初始说明预算。
5. G01–G12逐项登记实际通过/失败/未验与依赖证据；独立汇合既有PPTX/三表面/导航，移交060教师复核。

## 验收与可信反例

- 所有确定性失败边界通过，关键自然链达到有限重复门且无未关闭可复现宿主错误/假完成/数据错误；双入口真实结果及失败记录完整。
- 反例：通过率挑样本、换模型掩盖旧失败、模拟CLI、静态动画图、内部协议提示、没打开产物，均不得算通过。

## 停止条件

任一CLI不可用或当前核心用例失败则此门未通过；定位具体层继续修复，不能降成二选一或把核心任务延期到1.9。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/editorTransaction.test.ts tests/unit/electronLaunchEnvironment.test.ts tests/unit/coursewareCaseBuilder.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts
```

真实三CLI与实际安装Build Skill为必需门，命令中的自动化仅验证确定性边界/驱动；自然语言矩阵与截图/交互/导出按主方案留证。

## 回退与交接

交付缺口关闭表、完整尝试索引、窗口/性能/读取预算和S3教师逐步清单；本包只签engineering candidate，不建accepted标签。
