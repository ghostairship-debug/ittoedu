# r18-092-codex-interactive-adapter：接通Codex图片公开摘要提问纠正与原生回合控制

- Release: 1.8
- Dependencies: `r18-091-cli-model-controls`
- Optional: 否
- Write locks: `cli-adapter-codex`
- Gaps: G01, G04, G05, G06, G09

## 结果与现状

Codex app-server接收真实图片/文件、公开可读事件、提问回答和中途纠正，支持同任务多回合及准确取消；与相同配置和用户授权的外部Codex保留原生文件、终端、网络、工具连接、Skills及子任务能力。

V2 app-server transport与原生接线已集成。2026-09-08[审查](../../reviews/1.8-first-batch-review.md)中的RPC失败收口、turn模型接线及原生授权修复保留为已实施基础；其有效证据继续复用，不再把漏传model、固定read-only/never或统一decline写成当前实施起点。

本轮按[AI编辑最短路径统一方案](../../../../AI编辑最短路径产品决策报告.md)第6、7节补剩余缺口：同模式输出Schema仍内嵌本轮requestId；usage按错误平面字段读取；候选信封在终态解析前进入正文；首次模型配置及有条件结束需与共享Owner接通。原生记录中的27条用量可用于事故取证，不代表当前应用已能正确计量，也不等于已精确取得27次底层请求边界。

当前原生文件、终端、网络、工具连接、Skills、子任务和授权边界继续保持；最小观察不是OS权限边界。具体实施组织见[执行包](FIRST_BATCH_EXECUTION.md)，历史样本不代签本轮新增行为。

## 开始前与阅读入口

确认上述依赖的当前有效证据及写锁；以[开发总纲当前路线](../../../../COURSEWARE_DEVELOPMENT_PLAN.md#5-当前开发路线)、[任务板](../../TASK_BOARD.md)、[工作协议](../../WORKING_PROTOCOL.md)和[架构合同](../../ARCHITECTURE_CONTRACT.md)为上位约束。共用决定只读[AI开发方案](../../AI_ASSISTANT_DELIVERY_PLAN.md)及[实施合同](IMPLEMENTATION_CONTRACT.md)相关条目，已读且未变的内容不重复全读。

- [src/main/localAgent/codexAppServer.ts](../../../../src/main/localAgent/codexAppServer.ts)
- [src/shared/localAgentTaskContract.ts](../../../../src/shared/localAgentTaskContract.ts)
- [src/main/localAgent/harness.ts](../../../../src/main/localAgent/harness.ts)
- [src/main/localAgent/candidateStaging.ts](../../../../src/main/localAgent/candidateStaging.ts)
- [src/shared/localAgentContract.ts](../../../../src/shared/localAgentContract.ts)
- [src/shared/localAgentProjection.ts](../../../../src/shared/localAgentProjection.ts)

## 允许写域与旧路径退出

Codex原生adapter及脱敏fixture；不得修改Claude/OpenCode能力语义或复制调度器。共享open/usage/完成合同、Harness与持久化由090/091及现有任务Owner持有写域并顺序集成，Chat由101消费；本叶子不凭`cli-adapter-codex`锁扩写共享实体文件。初始化、稳定Schema、用量与消息分流在`codexAppServer.ts`中由同一实际writer合并。

## 执行步骤

1. 消费091创建前的已选模型与分阶段原生确认合同，配合修复open→configure造成的首次默认模型切换；保持恢复和用户主动换模型能力，不向thread/start添加未支持的effort字段。
2. 保留app-server结构化结果主线，使outputSchema在同协议版本、同candidate/auto传输模式内稳定；删除本轮requestId常量，身份保留在输入/信封并由现有decode/prepare/candidate链严格校验。两个模式仍可有不同Schema，不为共用前缀强制统一，也不以固定过期目标或削弱校验换缓存。
3. 按当前版本真实wire解析`tokenUsage.last/total`。本次与累计分开，累计更新不得逐条再加；保留实际提供的input、cached input、output、reasoning及cache-write等字段，reasoning包含于output时不重复计入。未知为null，原生未提供请求身份/边界时不报告精确请求数。同步共享strict事件、投影、持久化和UI；不把解析器局部修复当完整交付。
4. 按item ID、phase/type与turn生命周期分流公开进展、工具、结构化reply、候选及宿主回执。确认属于可读文本的消息正常流式显示；结构化reply仅显示解析后的reply内容，信封不得先泄漏到UI。候选缓冲到完整、正确身份及有效终态后才交付，中途edit信封不提交。普通代码/JSON讨论不按花括号隐藏。
5. 保留image/localImage、原生提问/授权、steer和interrupt的已有路径；图片路径文本不算视觉输入，默认输入精简不限制原生工具继续获取材料。仅补本次改动影响的关联、取消和迟到反例，候选staging仍只限定宿主摄取。
6. 消费共同任务Owner的finish/observe和实际回执状态。成功finish不固定追加模型总结；observe才继续同一原生会话。候选就绪、原生completed、正式提交和任务终态分开，adapter不另建任务完成规则，也不以文本completed代替HostResult。

回执派发与工程提交分开。实际HostResult先由现有Owner持久化；按adapter版本能力选择无推理追加或下次请求送入。若使用当前协议的`thread/inject_items`，先验证角色、身份、幂等和恢复语义；无推理追加不是所有CLI成功结束的前置，能力不足须保留准确待送状态，追加失败不能重做工程事务。

只有本版本真实测试仍无法可靠分开公开进展与候选时，才对同一adapter既有staging/artifact路径做受控替换验证；保留strict宿主解析与一次有明确诊断的格式修复，不长期维护两条不同完成真相。

已实现失败收口继续作为不变量：error、close、主动close及超时须拒绝/清空待处理RPC并唤醒消费方；各阶段等待有界，关闭/退出竞态幂等。共享Harness清理由唯一Owner维护。原生授权来自用户/CLI，不能用固定只读、统一拒绝或静默提权替代；不复制工具循环或建设MCP/RPC平台。

## 验收与可信反例

- 同传输模式下不同请求ID生成稳定Schema；candidate与auto两个模式均拒绝错请求、stale及迟到候选。结构稳定只证明实现属性，不证明缓存必命中或提速幅度。
- 对应版本嵌套usage fixture覆盖last/total、缺失/null、重复通知、累计重发、原生轮次计量重置与恢复；事件、记录和UI不重复累计。旧平面tokenUsage假fixture不能代签真实wire。
- 逐字符信封、多item、非最终edit、最终reply/edit、普通JSON讨论、异常半包、取消迟到和历史重开均保持可读分流；无中途候选提交或机器信封泄漏。
- 成功finish没有固定额外总结，observe仍能续行与纠正；回执送达状态与应用持久记录一致。若实施inject_items，另证无新turn、幂等和恢复；不支持或追加失败时待送且不重复提交。
- 识别已有选中图片、可读进度、回答与中途纠正等已通过证据继续复用；图片不可读、旧turn纠正、断流和Stop后的当前未提交阶段零写入，只补受本次改动影响的反例。
- 原生初始化立即exit(23)、无响应后Stop/删除、运行槽释放及新任务恢复的有效证据继续复用；仅当生命周期接线改变时重查，不关闭其他CLI或用户进程。
- 在相同版本、账号、有效配置和授权的外部基线下，受影响文件/终端/网络及已有工具/Skill/子任务能力不被GUI裁剪；一个必要原生授权往返能允许、拒绝和取消。权限限制来自用户/CLI时如实显示，不能通过默认提权取得成功。
- 普通CLI文件生成与正式工程提交分开；root外制品、过期和迟到候选不能被宿主摄取或写入工程。此约束不禁止原生已授权的其他文件操作。

## 停止条件

已安装版本缺少必要原生能力时使用088支持矩阵明确阻断；不降为旧文本路径再标完成。

## 聚焦验证

按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)为本次变化准备必要产物一次。`tests/unit/codexAppServer.test.ts`是adapter定位入口；共享事件/投影/持久化、Chat及任务终态由对应Owner选择实际consumer测试，`diagnosticLog.test.ts`仅在受影响时选用。不默认整文件批跑或触发真实CLI矩阵。

待补命名用例：同模式稳定Schema与两个模式身份拒绝；嵌套usage全链路和恢复去重；typed流式分流与取消半包；finish/observe消费及回执派发兼容性。在实施diff中补实际测试名和`-t`/`--grep`选择；0匹配、旧平面usage、最终JSON可解析或旧固定续轮成功均不能代签新行为。

真实Codex按改动分别验证识图→小修改→实际回执→结束，以及确需观察→同会话续行/纠正→Stop；保持提示为普通语言，内部协议由产品产生。复用088及9月8日修复后的图片、提问/授权、steer、interrupt、RPC清理和候选边界有效样本，仅补受影响路径，在103汇合完整三CLI门。

缓存/初始化收益使用固定版本、模型/强度/服务档、上下文和输入的有限配对；首次冷启动与连续会话分开。未命中继续按证据定位，不宣称requestId是全部根因。原生未公开的内部请求起止标为未知，私有JSONL只作本次事故取证，不成为产品运行前置。

## 回退与交接

完成须同时具备：初始化与091一致；同模式Schema稳定且身份门不弱化；真实用量经事件/持久化/UI一致；公开消息与机器数据分流；finish/observe和回执派发与共享任务Owner一致；新增及受影响反例有直接证据。单个adapter单测通过不代替共同consumer接线，也不代替103/S3。

交付Codex有效版本/模型、输入输出样本、事件/用量去重和取消证据；100/101消费同一task/observation/receipt与消息语义。新能力不支持时准确呈现并保留原有效consumer，不回退到裸JSON或单轮文本路径后假报完成。
