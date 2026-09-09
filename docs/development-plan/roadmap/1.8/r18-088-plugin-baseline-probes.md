# r18-088-plugin-baseline-probes：冻结插件工作流基线并证明三CLI关键原生能力

- Release: 1.8
- Dependencies: `r18-087-navigation-level-exit`
- Optional: 否
- Write locks: `cli-adapters`
- Gaps: G04, G09, G10

## 结果与现状

以实际安装的三CLI验证图像、文件读取、模型/强度、可读事件、提问、纠正、取消与续轮；冻结两款VS Code插件相应工作流的比较条件，输出逐项原生能力证据和已实测版本，供090冻结接口。实际插件的画面/动作对照在r20-025必做，不以缺少IDE阻断本地协议定义，也不把CLI探针当插件验收。

已有原生预检覆盖图像、问答、取消和续轮的相应范围，含失败与模型差异，见[预完成证据](../../reviews/1.8-first-batch-preflight.md)。下一执行者从[首批执行包](FIRST_BATCH_EXECUTION.md)先修四项反例；未变证据继续复用。旧只读/白名单/拒绝授权配置不证明完整CLI能力对等，090–094修订实际能力配置后只补受影响的原生行为证据，不重跑无关付费探针。

早期仅文本、一次关闭stdin和无读取的接线已经出现后续实现，当前反例以2026-09-08首批审查和实际源码为准；不可恢复成旧实现边界。官方文档、协议探针和当前GUI行为各自证明相应范围。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md](../../AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)

## 允许写域与旧路径退出

仅现有adapter旁的可独立运行探针、脱敏协议fixture和证据文档；本包不切换生产consumer。实际插件基线使用隔离课例/目录，不修改用户代码或配置。

## 执行步骤

1. 先读取版本、模型/输入类型与配置能力；记录平台、CLI/插件版本、模型与effort，基线按评估第3/7节的工作流逐项映射。
2. 分别发送最小真实图片并得到对图像内容的回答；完成一次可读正文/公开摘要、问答回传、运行中纠正和取消、候选→宿主结果→同一会话续轮。只使用原生正式协议。
3. 冻结插件的选区/图片引用、模型与模式、纠正、审阅和继续修改对照流程。记录本机IDE/插件是否具备；真实画面/动作保留给025，不提前运行整个103矩阵。
4. 逐项区分支持、版本受限、暂未接线与不支持；给出090采用的协议字段/事件样本。需要升级CLI时写出可复核最低版本，不以另一个CLI替代。

## 验收与可信反例

- 三CLI存在已验证的图像/读取/续轮路径，图片使用实际像素输入；按具体模型标记原生能力差异，提问/纠正区分结构化、正文和回合边界。插件对照条件已冻结，实际画面与动作仍须025取得。
- 反例：未知模型/不支持effort、无图像能力、断流、取消后迟到事件均明确失败；不从日志文字伪造能力或提交成功。

## 停止条件

共同必需工作流没有任何已验证原生路径时，088及受影响后续链不得标完成；给出受支持配置/可审阅替代路径。某模型不支持图像不等于整个CLI不支持，但不能替该模型报通过；090用unknown/unsupported表达差异。其他独立Flow修复继续。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)复用未失效证据，只选择实际发生协议、版本或配置变化的CLI原生探针；以下不是每个节点都要执行的三条清单，不因运行探针准备无关Player/Electron产物。探针直接验证原生协议，不能以模拟测试替代，也不替代后续真实产品接线。

```text
npx --no-install tsx scripts/probe-local-agent-native.ts codex conversation
npx --no-install tsx scripts/probe-local-agent-native.ts claude conversation
npx --no-install tsx scripts/probe-local-agent-native.ts opencode conversation opencode/muse-spark-1.3
```

以上是实际已存在的原生探针，控制模式与失败证据见报告。相同CLI/模型/wire未变时复用本轮结果；产品接线改变后验证接线，不能反复运行原生探针替代产品证明。真实插件对照不由fixture代替。

## 回退与交接

保留旧生产adapter；交付版本/能力矩阵、原生输入输出样本、插件对照条件、失败分类与090接口依据。探针失败不更改工程；025仍须真实插件录像或截图。
