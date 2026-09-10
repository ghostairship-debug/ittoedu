# r18-103-ai-usability-exit：完成助手与外部Builder自然语言可用性工程结束门

- Release: 1.8
- Dependencies: `r18-089-flow-viewport-repair`, `r18-092-codex-interactive-adapter`, `r18-093-claude-interactive-adapter`, `r18-094-opencode-interactive-adapter`, `r18-096-capability-workspace`, `r18-098-image-edit-transaction`, `r18-099-dynamic-edit-verification`, `r18-100-task-feedback-loop`, `r18-101-teacher-chat-workflow`, `r18-102-freshness-conflict-recovery`, `r18-104-builder-skill-discovery`
- Optional: 否
- Write locks: `generated-index`, `chat-ui`
- Gaps: G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12

## 结果与现状

以普通教师提示在三CLI完成理解、编辑、验证和人工交替，并让实际Build Skill从外部课例目录按需构建/修订；关闭G01–G12当前阻断后形成S3可复核工程候选。

2026-09-10当前汇合见[本轮实施记录](../../reviews/2026-09-10-latency-completion.md)：路径、分段时间、真实按钮事实反馈、会话临时占用恢复及受影响文字/图片/排版/互动/OpenCode T11已通过，原有限槽位与未变边界按有效范围复用。Owner临时将Claude Code接入DeepSeek后，`deepseek-flash[1M]` / max的可滚动预览、零写待应用、应用后finish、Undo/Redo和保存重开已通过，本次待补代表项已补齐，可移交060。原Sonnet/high 503保留为失败；不外推临时后端图像理解，不将新旧配置混算性能，也不把工作树材料入口称为S3已就绪或accepted。下列日期段是历史起点，不能覆盖该当前结论。

2026-09-08当前证据已包含真实三表面观察、Flow助手停靠与新HTML、共享组件全实例准入、104两个外部工程片段及Native文字自动尺寸；真实CLI已有尝试按各自模型和配置保留。G01–G12分别登记工程通过、实际自然任务通过、失败和未验。103/050三CLI有限重复矩阵尚待汇合，不能用这些子路径、CLI启动或内部协议提示代替一般编辑完成。

2026-09-09[统一方案](../../../../AI编辑最短路径产品决策报告.md)核验确认已有continue、真实receipt和20分钟任务预算；同时补充了坏PNG输入与错误替代、流式机器数据、usage映射及条件终结等剩余缺口。原事故提交了图片到绿色Native文本的替代，不能记为换色成功。本文新增的验收条件仍待产品实现和真实结果，不因方案落地或既有局部用例通过而自动关闭。

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

1. 冻结实际候选版本、输入副本、CLI版本/model/effort/服务档、有效配置/工作上下文/授权与T01–T12原话；不向测试提示补UUID、scope、component.package等内部指导。原坏PNG保留为预期失败负例，有效PNG及含内容/透明图片为正例，不拿修好后的输入和原坏输入直接计算提速。
2. 按开发方案第6节执行本版矩阵：关键链每CLI预先固定3次独立完整运行，含新会话/延续会话，三次均成功；保留全部失败，任何失败先定位归因，只在相关问题关闭后重做受影响证据。
3. 并列覆盖普通文字/样式与图片精确修改、保留文案/公式的整页或批量修改、单实例/明确共享组件修改及真实互动故障；保留讨论零写、Runtime替换/变慢、Flow/Spatial、模型/纠正/Stop、人工并发、Undo/保存重开/Player/适用导出。简单任务不能代替复杂能力，复杂任务也不能挤掉已支持的小修改。
4. 分别验证完整候选finish后无总结turn、正式unchanged无需修改，以及确需后续阶段的真实receipt/新观察/同任务continue。补preview待应用与到期、main/renderer/AiTask持久终态、回执待保存/待送、严格失败证据和20分钟绝对deadline全链边界；已有多阶段门保留，不强制每个任务第二次修改。
5. G01–G12逐项登记实际通过/失败/未验与依赖证据；独立汇合既有PPTX/三表面/导航，移交060教师复核。
6. 复核104外部Builder的真实读取轨迹和产物；测本地上下文/事件延迟及初始说明预算。首次正确可用结果、任务终结、用户等待、失败/取消和返工分别记录；usage沿实际wire及正式投影核对本次/累计与来源，unknown不补零，原生turn不冒充内部模型请求。

本节点使用现有界面、已有工程和已确认课例，保留原有限三CLI/Build双入口、PPTX/三表面/导航及S3范围。未实施105撤回，未命名/首次保存、自动/手动整课流程与常见材料分片分别由1.9的042/044/045交付，不作为103前置；2.0承担全工作流内部完成和标准课例速度/质量门。当前自然编辑失败仍须在本版Owner修复，不能借版本分工延期已有核心能力。

汇合092–094的原生能力对等证据：相同账号、版本、有效配置、工作上下文和授权下，文件、终端、网络、用户已有工具连接、Skills及子任务不因GUI被裁剪。先复用088和adapter已有效对照，仅对实际改变的能力补最少必要probe；不把每个原生工具都套三次整课矩阵，不凭工具列表或mcpServers空数组判定能力。GUI授权允许/拒绝/取消及candidate摄取root闭合分别核对，对等不能通过默默提权实现。

## 验收与可信反例

- 本节点承接096/097/099/100/101主力纵切之后的完整三CLI同任务矩阵。每家都必须在同一正式产品能力上验证真实模型配置、当前观察、普通/复杂编辑、完整候选条件终结、必要的host receipt驱动继续、图片/动态任务和适用的提问/纠正/取消；明确各家差异，不能以主力成功替代另外两家。
- finish只在必要检查/证据及正式committed或unchanged回执满足时生效；unchanged不增加revision/撤销项，preview待应用/到期不假完成。main/renderer/AiTask及已持久化记录重开一致；回执保存失败仅重试记录，未落盘崩溃后未知结果不自动replay。无推理注入仅按实际能力验证，不支持时准确待送，不伪称原生已收到。
- 20分钟绝对deadline跨观察、原生运行、prepare、准入和提交前检查，waiting-input/awaiting-apply不隐式延长；到期不能提交，用户再次请求以新观察继续目标。首失败建立基线，其后连续两次无实质进展停止；随机身份/summary变化不能绕过。结构化失败的目标、步骤、诊断和实际已有帧/状态确实送达下一输入。
- 有效图片保持操作要求的尺寸/alpha/区域外内容及未选共享实例；原坏PNG准确失败且无提交，无绿色文本/shape替代。动态smoke的挂载/更新/生命周期证据与requires-review不能替代指定答题、重置、重试等真实行为验证。
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

真实三CLI与实际安装Build Skill为必需门，上述现有命令仅覆盖其实际确定性边界/驱动；新增finish、unchanged、错误/usage投影、deadline等待和恢复反例在实现diff补命名用例并更新选择，未实现不记通过。自然语言矩阵与截图/交互/导出按主方案留证；原有限重复门保留，新增性能实验不要求24个模板全部成为局部开工门。

性能主指标为请求到首次正确可用结果，另报全任务终结、首轮成功率、误改、取消、失败与返工。分段记录输入/发现、原生启动与turn、候选/准入、commit/receipt、画面稳定；用户等待单列，冷启动/连续会话分桶，关联任务/候选/事务后按关键路径分析，不累加并行跨度。固定模型/强度等条件进行必要的有限配对，保留全部失败；三次样本不能证明P95或未来100%成功。真实usage计量不等于可分离服务排队/推理时间，缺失字段仍未知，不靠首字或减少验证宣称提速。

## 回退与交接

交付缺口关闭表、完整尝试索引、窗口/性能/读取预算和S3教师逐步清单；本包只签engineering candidate，不建accepted标签。
