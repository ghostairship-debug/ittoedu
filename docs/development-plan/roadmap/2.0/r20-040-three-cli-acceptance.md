# r20-040-three-cli-acceptance：完成三CLI完整自然语言矩阵与持续创作的最终验收

- Release: 2.0
- Dependencies: `r20-020-public-authoring`, `r20-021-profile-controls`, `r20-022-materials-privacy-controls`, `r20-025-plugin-workflow-parity`, `r20-030-docs-accessibility`
- Optional: 否
- Write locks: `cli-adapters`

## 结果与现状

同一生产候选的Codex/Claude/OpenCode完成完整T01–T12和1.9生命周期，真实产物可保存重开/运行/导出，插件对照结论有效。

最终矩阵复用未失效103/1.9/025证据，补2.0变化和最终环境差异；不重复全部付费调用凑数量。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](../1.8/IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md](../../AI_ASSISTANT_DELIVERY_PLAN.md)
- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)
- [tests/e2e/stabilizationCoreUsability.spec.ts](../../../../tests/e2e/stabilizationCoreUsability.spec.ts)

## 允许写域与旧路径退出

三CLI最终验收驱动/证据；无权跨产品Owner随手修复，发现失败回相应节点并更新受影响证据。

## 执行步骤

1. 建立同一候选证据账本：任务原话、CLI/model/effort、真实结果、失败、版本/依赖变化；标明可复用与必须补测项。
2. 完整覆盖识图/图片编辑/文字/Runtime/连续纠正/人工交替/计划后执行/Flow/Spatial/按钮QA/模型控制/重启删除与长任务。
3. 所有CLI都过开发方案关键自然链固定重复门与确定性边界；2.0设置/Skill/数据/可访问性在实际窗口验证。
4. 保存重开/Undo/Player/适用导出与人工回退复核；不把固定发布HTML的课程运行证据当AI验收工作区。

## 验收与可信反例

- 三CLI完整矩阵和025对照成立，无当前核心流程阻断、假完成或数据错误；每项结果对应真实实现/环境。
- 反例：缺少一个CLI、旧版本成功冒充当前、内部协议提示、丢弃失败样本、记录恢复自动重复写，均阻断此门。

## 停止条件

外部服务不可用则该证据阻断并报告，不让其他CLI代替；只有相关变化才补测，禁止无限重试。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts tests/unit/editorTransaction.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

真实三CLI最终差异矩阵必需；自动化只给工程候选，结果交S4教师复核。

## 回退与交接

交付完整证据账本、支持边界和S4固定步骤；未通过不转accepted。
