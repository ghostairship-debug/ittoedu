# r18-094-opencode-interactive-adapter：接通OpenCode原生配置按需读取图片与交互续轮

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapter-opencode`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

OpenCode ACP按原生配置使用所选模型/强度，读取当前观察/能力资源，接收图像并支持提问纠正、取消和续轮；与相同配置和授权的外部OpenCode保留文件、终端、网络、工具连接、Skills与子任务能力。

2026-09-09核对：ACP配置、图像输入、文件/终端桥、权限回传和初始化退出清理已有实现。当前声明terminal:true；文件操作不再限于观察或单个candidate文件，关闭时统一拒绝并清理待处理RPC。模型设置已检查原生确认值，再读取完整配置状态并设置当前模型实际支持的强度。保留这些实现及有效证据，不重复实施2026-09-08[审查](../../reviews/1.8-first-batch-review.md)中的旧修复。

当前UI模型选择故障仍需沿真实链路定位。后台模型目录刷新超时、历史版本的ACP issue、下拉框可点都不能单独证明当前根因或配置已生效。CLI工作范围与宿主candidate摄取边界继续分开；已有接线不等于真实对等验收已经完成。

当前分工与验证选择见[执行包](FIRST_BATCH_EXECUTION.md)；当前增量以[统一最短路径方案](../../../../AI编辑最短路径产品决策报告.md)第6.4节和本规格为准。节点是既有Owner边界，不表示重新创建历史任务。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/main/localAgent/profile.ts](../../../../src/main/localAgent/profile.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/renderer/ui/chat/NativeAgentConfiguration.tsx](../../../../src/renderer/ui/chat/NativeAgentConfiguration.tsx)
- [tests/unit/openCodeAcp.test.ts](../../../../tests/unit/openCodeAcp.test.ts)

## 允许写域与旧路径退出

OpenCode ACP协商/配置/原生文件终端及授权接线与共用桥的必要分支；只摄取当前candidate root闭合内容，不新增live工程工具RPC、独立MCP服务或通用OS沙箱平台。共享工作上下文由090/091集成。

## 执行步骤

1. 记录进程启动、initialize、session/new或session/load、配置目录返回、选项解析、UI、set_config_option、原生完整状态确认和下一任务实际配置；区分启动失败、解析失败、真实空目录与配置拒绝。后台刷新超时不能直接归因为空目录。
2. 在090/091的现有能力查询与配置Owner下，合并同上下文的并发查询；缓存按真实CLI版本、工作上下文和非秘密配置身份隔离，失败可刷新，旧目录标明尚未确认。目录由原生配置提供，不新建模型目录服务；支持协议允许的分组选项，不能用历史issue替代当前版本取证。
3. 保留已有模型/强度原生确认与完整状态更新；切换模型后重新消费其强度选项，无effort的模型UI明确不提供。区分待应用选择与原生已生效配置，确认失败不静默使用另一模型或强度；新建、恢复与主动切换均从Harness入口联调。
4. 保留原生图像、按需观察、文件/终端和授权接线；仅补直接失败影响的分支。候选根只约束宿主摄取，不替代CLI工作目录或文件权限；允许、拒绝、取消按原生语义回传，不从普通文本推测身份或成功。
5. 实际回执与100的完成/续行语义衔接：需要继续时带入新观察和host result；满足正式完成条件时不为总结固定再开推理。若当前ACP没有经验证的无推理历史追加能力，在应用会话保存待送事实，下一次真正请求前送达，不能伪造原生已收到或重复提交工程。旧adapter缺少完成元数据时沿有预算的兼容路径执行。
6. 保留用户原生连接、Skills与子任务；实际发现/调用才证明其可达，不能仅凭mcpServers空数组判断。清理跨session句柄，应用只实现当前ACP所需窄接线，不建设另一工具或模型循环。

进程error/close/主动close统一拒绝并清理RPC、等待有界及关闭幂等已有实现；相关代码未变时复用有效证据。触及生命周期时才补Harness运行槽释放与取消检查，不通过无限重试或普遍延长等待掩盖问题。

## 验收与可信反例

- 真实OpenCode用已确认模型识图并按需展开能力，完成小编辑并取得host receipt；按正式完成声明结束，或为明确后续阶段续轮。仅准备成功不能显示已应用。
- 反例：candidate root外摄取、过期session、请求不存在模型、坏候选、重复completed、Stop后迟到候选均不写工程；原生授权下的其他文件操作不因观察scope被产品拒绝，也不能冒称当前工程已提交。
- 立即exit(23)须使open拒绝；初始化/配置/启动无响应后Stop/删除结束，后续任务可启动。实际模型确认沿091从Harness入口验证，配置失败不静默使用另一模型。
- 有缓存、空缓存、初始化失败、解析失败、分组选项和并发查询分别给出实际状态；缓存不冒充已确认目录。切模型后完整配置同步，下一任务确实使用确认后的模型/强度；不以UI选择值代替原生事实。
- 与相同有效配置的外部基线核对受影响文件/终端/网络和工具/Skill/子任务能力；必要授权可经GUI允许、拒绝或取消，原生不支持项如实说明。只声明能力或放开标志而没有实际操作不能作为通过。

## 停止条件

账户或Provider不可用单列外部阻断；不通过放宽UUID/scope/schema来消除模型错误，不把能启动当可用。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次代码变化和所选用例准备必要产物一次，再执行以下直接入口；纯逻辑/Schema测试不因此重构建。现有用例只证明其实际覆盖的行为；新增行为在实施diff中补命名测试，并同步文件及 `-t` / `--grep` 选择。执行时确认目标测试实际被选中，0匹配不算通过，不用旧用例通过代签新能力。未变化证据继续复用，仅失败指向更广范围或版本门要求才扩大验证。

```text
npx --no-install vitest run tests/unit/openCodeAcp.test.ts -t "reports the native-confirmed configuration before a quiet prompt produces any model output|selects the model before discovering and applying its native effort|does not start a prompt after a conflicting native effort ACK"
```

以上现有用例验证模型确认与强度切换，不代签新增目录诊断、缓存隔离、分组选项或终结行为；这些增量由实施diff补充命名用例并更新选择。只有生命周期实现发生变化才重选初始化退出/关闭与文件终端授权的对应用例。

真实ACP只补当前故障所需的最小识图/读取/编辑/纠正或配置链；保留所有失败及实际配置，不使用另一CLI成功替代。原生对等复用088有效证据并在103汇合，不重复全平台矩阵。

## 回退与交接

交付ACP能力、路径边界、分段诊断、原生完整配置确认与100完成/续轮证据；明确未复现或未验证范围，失败清理只触及本任务暂存与进程。
