# r18-103-ai-usability-exit：完成助手与外部Builder自然语言可用性工程结束门

- Release: 1.8
- Dependencies: `r18-089-flow-viewport-repair`, `r18-092-codex-interactive-adapter`, `r18-093-claude-interactive-adapter`, `r18-094-opencode-interactive-adapter`, `r18-096-capability-workspace`, `r18-098-image-edit-transaction`, `r18-099-dynamic-edit-verification`, `r18-100-task-feedback-loop`, `r18-101-teacher-chat-workflow`, `r18-102-freshness-conflict-recovery`, `r18-104-builder-skill-discovery`
- Optional: 否
- Write locks: `generated-index`, `chat-ui`
- Gaps: G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12

## 结果与现状

以普通教师提示在三CLI完成理解、编辑、验证和人工交替，并让实际Build Skill从外部课例目录按需构建/修订；关闭G01–G12当前阻断后形成S3可复核工程候选。

2026-09-08当前证据已包含真实三表面观察、Flow助手停靠与新HTML、共享组件全实例准入、104两个外部工程片段及Native文字自动尺寸；真实CLI已有尝试按各自模型和配置保留。G01–G12分别登记工程通过、实际自然任务通过、失败和未验。103/050三CLI有限重复矩阵尚待汇合，不能用这些子路径、CLI启动或内部协议提示代替一般编辑完成。

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

1. 冻结实际候选版本、课例、CLI/model/effort、有效配置/工作上下文/授权与T01–T12原话；不向测试提示补UUID、scope、component.package等内部指导。
2. 按开发方案第6节执行本版矩阵：关键链每CLI预先固定3次独立完整运行，含新会话/延续会话，三次均成功；保留全部失败，任何失败先定位归因，只在相关问题关闭后重做受影响证据。
3. 覆盖讨论零写、图片保真、文字/Runtime替换及变慢、Flow/Spatial、按钮排错、模型/纠正/Stop、人工并发、Undo/保存重开/Player/适用导出。
4. 复核104外部Builder的真实读取轨迹和产物；测本地上下文/事件延迟及初始说明预算。
5. G01–G12逐项登记实际通过/失败/未验与依赖证据；独立汇合既有PPTX/三表面/导航，移交060教师复核。

本节点使用现有界面、已有工程和已确认课例，保留原有限三CLI/Build双入口、PPTX/三表面/导航及S3范围。未实施105撤回，未命名/首次保存、自动/手动整课流程与常见材料分片分别由1.9的042/044/045交付，不作为103前置；2.0承担全工作流内部完成和标准课例速度/质量门。当前自然编辑失败仍须在本版Owner修复，不能借版本分工延期已有核心能力。

汇合092–094的原生能力对等证据：相同账号、版本、有效配置、工作上下文和授权下，文件、终端、网络、用户已有工具连接、Skills及子任务不因GUI被裁剪。先复用088和adapter已有效对照，仅对实际改变的能力补最少必要probe；不把每个原生工具都套三次整课矩阵，不凭工具列表或mcpServers空数组判定能力。GUI授权允许/拒绝/取消及candidate摄取root闭合分别核对，对等不能通过默默提权实现。

## 验收与可信反例

- 本节点承接096/097/099/100/101主力纵切之后的完整三CLI同任务矩阵。每家都必须在同一正式产品能力上验证真实模型配置、当前观察、普通编辑、host receipt驱动的继续修改、图片/动态任务和适用的提问/纠正/取消；明确各家差异，不能以主力成功替代另外两家。
- 2026-09-08首批四项反例必须关闭，且修复影响的原生恢复/退出/配置与Flow实际按钮行为有当前有效证据。沿开发方案6.2既定有限重复门保留全部失败，既有050/051/052/083/087和S3签署要求不削减；相关实现未变的证据共用，不额外重复付费矩阵。
- 原生工具和授权对等的受影响有限对照通过；默认小snapshot不限制CLI取得更多资料，但当前工程事实、用户编辑目标、candidate摄取和canonical事务保持正确。外部CLI/Skill是本版开发对照与既有双入口，不替应用核心链兜底。
- 所有确定性失败边界通过，关键自然链达到有限重复门且无未关闭可复现宿主错误/假完成/数据错误；双入口真实结果及失败记录完整。
- 反例：通过率挑样本、换模型掩盖旧失败、模拟CLI、静态动画图、内部协议提示、没打开产物，均不得算通过。

## 停止条件

任一CLI不可用或当前核心用例失败则此门未通过；定位具体层继续修复，不能降成二选一或把核心任务延期到1.9。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)准备本次集成候选所需产物一次，复用与当前实现、依赖、夹具和环境匹配的证据。以下是103完整汇合入口，局部节点不得照抄整文件执行；已有有效覆盖时只补失效范围，不在完成各节点后再无条件重跑同一矩阵。新增行为先补命名测试并同步入口，0匹配不算通过；既定三CLI、双入口、有限重复与060/S3门保持。

```text
npx --no-install vitest run tests/unit/editorTransaction.test.ts tests/unit/electronLaunchEnvironment.test.ts tests/unit/coursewareCaseBuilder.test.ts
npx --no-install playwright test tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts
```

真实三CLI与实际安装Build Skill为必需门，命令中的自动化仅验证确定性边界/驱动；自然语言矩阵与截图/交互/导出按主方案留证。记录默认输入、发现往返、生成、准入、提交、渲染和返工耗时作为1.8基线，不用跳过QA满足尚属后续阶段的最终速度目标。

## 回退与交接

交付缺口关闭表、完整尝试索引、窗口/性能/读取预算和S3教师逐步清单；本包只签engineering candidate，不建accepted标签。
