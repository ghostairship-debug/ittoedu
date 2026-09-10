# r18-091-cli-model-controls：按三CLI真实能力发现模型强度与会话配置

- Release: 1.8
- Dependencies: `r18-090-ai-task-contract`
- Optional: 否
- Write locks: `cli-adapter-codex`, `cli-adapter-claude`, `cli-adapter-opencode`, `main-preload`, `ai-session`
- Gaps: G04

## 结果与现状

UI可取得三CLI真实模型、推理强度、有效配置与会话能力，用户选择可被原生确认并实际进入请求；不再硬编码low或Big Pickle。同一账号、版本、工作上下文和授权下保留原生配置，不因进入GUI裁剪原生工具或默默提高权限。

2026-09-08[首批审查](../../reviews/1.8-first-batch-review.md)中的偏好未接入请求、原生配置及失败收口修复已进入后续集成；其仍有效的接线和反例证据继续复用，不再作为整节点重启的实施起点。当前Harness已在open后configure，Codex也已向turn/start传入所选model/effort。

本轮剩余修复以[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)第6节为准：Codex仍先按目录默认模型创建thread，再应用所选模型；配置目录的重复查询、失效和错误状态须按真实链路完善。OpenCode当前UI无法选择模型的完整根因尚未复现，不能将models.dev刷新日志当作已确认根因。初始化接线改进不表示已证明提速幅度，配置对象或目录发现成功也不代替请求生效。具体实施组织见[执行包](FIRST_BATCH_EXECUTION.md)。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/main/localAgent/openCodeAcp.ts](../../../../src/main/localAgent/openCodeAcp.ts)
- [src/main/localAgent/adapter.ts](../../../../src/main/localAgent/adapter.ts)
- [src/main/localAgent/service.ts](../../../../src/main/localAgent/service.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/process.ts](../../../../src/main/localAgent/process.ts)
- [src/main/localAgent/claudeProcessTransport.ts](../../../../src/main/localAgent/claudeProcessTransport.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)

## 允许写域与旧路径退出

LocalAgent模型/有效配置发现、Main/preload窄桥与唯一非秘密偏好；UI控件由101消费。共享启动上下文和open配置合同由090/091的唯一Owner接线，各adapter按实际原生能力消费。Codex初始化、稳定Schema、用量和消息分流共用同一实际writer，不能与092并行修改同一文件。禁止Renderer传任意启动参数、凭据或未知模型字段；这不授权过滤掉原生CLI所需配置、环境、Skills或用户工具连接。

## 执行步骤

1. 复用原生模型与能力枚举，将用户已选配置沿Harness→adapter open→原生会话创建链传入。Codex新线程使用已选择模型，不先创建默认模型线程再切换；未明确选择的配置继续沿CLI原生规则。
2. 初始化时确认原生已返回的配置。effort等只能通过turn参数设置的字段，在原生settings/配置事件返回后记录effective；不能等待只能由turn触发的确认后才发出turn，也不能假定thread/start有顶层effort字段。
3. 将model/effort/mode的期望值、待切换值与原生确认值分开。新建、恢复、用户主动换模型分别采用原生支持时机；不为减少model-switch阻止合法切换。模型变化时消费原生完整配置状态，清除失效effort并采用该模型真实默认。
4. 相同CLI版本、有效工作上下文和非秘密配置身份下合并并发目录查询，相关版本/配置变化时重新发现。区分加载失败、解析失败、真实空目录和旧缓存，失败后可以刷新；旧目录不冒充当前已确认可用。为101提供同一可读状态，不在聊天维护第二模型列表。
5. 保持用户/目录配置、必要环境与原生工作目录；候选根不机械替代原生工作上下文。配置变更只在原生支持边界生效，不通过统一read-only/never、工具白名单或静默降低用户强度获得表面提速。

修复顺序：先由唯一Owner定义创建前可用的已选配置及确认时机，再接通Codex初始化和相关consumer；Claude/OpenCode继续使用已证实的原生入口，仅补本次变化影响的适配。OpenCode沿启动、initialize、session创建/恢复、目录返回、解析、UI、配置更新、原生完整状态、下一任务实际配置分段定位。配置失败或确认不一致不得假报current，也不得静默启动默认模型。运行中不能立即生效时记录待切换；只保存非秘密配置，不修改用户全局CLI设置。

用户已有MCP或其他原生工具连接、Skills和子任务由CLI继续管理；应用只提供所需窄配置/授权接线，不自建MCP服务或工具RPC。空mcpServers/sdkMcpServers数组不能单独证明已有连接消失或保留，必须以实际发现与调用为证据。

原生授权的最小请求/回答界面由090在当前聊天壳交付，092–094基础门直接消费；091负责有效配置和原生支持的选项，不等待101。101只完善配置展示与整体任务可用性，不能形成100等待adapter、adapter又等待101的隐性依赖。

## 验收与可信反例

- 每CLI选用不同于原默认的可用模型并查看实际请求/原生确认；支持effort的模型可切换且真实生效。
- 反例：模型下架、CLI未登录、无effort选项、运行中不支持切换、恢复到不兼容模型时明确状态，人工编辑正常。
- 新线程从Harness入口捕获实际原生wire：与原默认不同的已选模型已进入thread创建；初始化确认与turn配置确认分阶段返回时无循环等待、无提前假报生效。未显式选择时沿用原生默认。
- 恢复、主动换模型、原生拒绝、确认不一致和无合法effort分别验证。只断言configured.current或turn/start含model不能证明首次创建已正确。
- 相同上下文并发目录查询合并；失败可刷新；不同上下文不串用缓存；旧目录有准确状态。OpenCode须证明列表加载→选择→下一任务实际使用，不能只看下拉框可点击。
- 使用无秘密的配置夹具证明工作目录、配置来源与必要环境不会被宿主静默替换；原生授权模式在新建/恢复后保持，未经用户授权不能提高权限。真实工具/授权行为随092–094和103的受影响对照汇合。

## 停止条件

若当前CLI无法发现某能力，给出最低版本或明确不支持，不填假选项；不借此添加自有Provider配置。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次变化准备必要产物一次。目标入口为`tests/unit/codexAppServer.test.ts`、`tests/unit/claudeProcessTransport.test.ts`、`tests/unit/openCodeAcp.test.ts`及实际Harness配置consumer测试；`diagnosticLog.test.ts`仅在对应诊断行为受影响时选用。这些是定位入口，不是整文件批跑指令。

待补命名用例：创建前模型偏好传递、初始化/turn分阶段确认、新建/恢复/主动切换、并发查询与缓存隔离、原生完整配置消费。在实施diff中补充实际测试名和`-t`/`--grep`选择，确认目标确实被选中；0匹配和旧current对象断言均不能代签新增行为。

088及9月8日修复后仍有效的原生目录、配置入口、拒绝/不支持和授权证据继续复用。真实发现→选择→请求确认仅补受影响CLI/路径，完整三CLI汇合仍归103；不因文档更新重跑已通过矩阵。原事故model-switch记录可作为缺陷依据，不能当修后证据。初始化收益的有限对照区分冷启动/连续会话并固定模型、强度、服务档和输入，不承诺特定秒数，也不将计时作为已知正确性修复前置。

## 回退与交接

完成须同时具备：创建/恢复链与唯一偏好一致；原生确认与UI/记录一致；本次新增及受影响反例有直接证据；剩余CLI/UI根因及性能不确定性如实交接。目录出现、局部对象返回或历史节点已集成不单独代表本轮完成。

交付capability/有效配置消费API、初始化确认时机、来源及失效规则和101显示样例；092消费相同创建配置。错误保留最后有效偏好，不能静默启动另一个模型或使用另一权限模式。
