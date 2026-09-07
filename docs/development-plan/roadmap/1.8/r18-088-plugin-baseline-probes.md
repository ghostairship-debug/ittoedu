# r18-088-plugin-baseline-probes：冻结插件工作流基线并证明三CLI关键原生能力

- Release: 1.8
- Dependencies: `r18-087-navigation-level-exit`
- Optional: 否
- Write locks: `cli-adapters`
- Gaps: G04, G09, G10

## 结果与现状

以实际安装的三CLI和两款VS Code插件验证图像、文件读取、模型/强度、可读事件、提问、纠正、取消与续轮；输出逐项能力证据和最低受支持版本，供090冻结接口。

现有成功只覆盖文字/指定包源码；Codex发送仅文本，Claude一次关闭stdin，OpenCode未开放读取。官方文档可行性不能代替本机协议与插件行为。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/protocol.ts](../../../../src/main/localAgent/protocol.ts)
- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)

## 允许写域与旧路径退出

仅现有adapter旁的可独立运行探针、脱敏协议fixture和证据文档；本包不切换生产consumer。实际插件基线使用隔离课例/目录，不修改用户代码或配置。

## 执行步骤

1. 先读取版本、模型/输入类型与配置能力；记录平台、CLI/插件版本、模型与effort，基线按评估第3/7节的工作流逐项映射。
2. 分别发送最小真实图片并得到对图像内容的回答；完成一次可读正文/公开摘要、问答回传、运行中纠正和取消、候选→宿主结果→同一会话续轮。只使用原生正式协议。
3. 记录真实插件的选区/图片引用、模型与模式、纠正、审阅和继续修改流程。只作必要的最小任务，不提前运行整个103矩阵。
4. 逐项区分支持、版本受限、暂未接线与不支持；给出090采用的协议字段/事件样本。需要升级CLI时写出可复核最低版本，不以另一个CLI替代。

## 验收与可信反例

- 三CLI所有共同基础能力有真实往返证据，图像读取使用实际像素输入；插件基线含画面与动作，平台独占功能单列。
- 反例：未知模型/不支持effort、无图像能力、断流、取消后迟到事件均明确失败；不从日志文字伪造能力或提交成功。

## 停止条件

共同必需能力在当前原生协议无法完成时，088及其合同/adapter后续链不得标完成；给出受支持版本/可审阅替代路径，090不得把未经证实字段写成既定能力。其他独立Flow修复继续。

## 聚焦验证

在以下现有测试入口补本规格命名行为，不能用旧用例通过充当新能力证据。若确需新文件，先在实现diff中创建再同步入口。仅失败指向更广范围或版本门要求才扩大验证。

```text
npm run test:product -- tests/unit/electronLaunchEnvironment.test.ts
```

按上述最小原生与插件步骤执行并保存脱敏结果；这是必需的真实证据，不由该测试文件的fixture代替。

## 回退与交接

保留旧生产adapter；交付版本/能力矩阵、原生输入输出样本、基线录像或截图、失败分类与090接口建议。探针失败不更改工程。
