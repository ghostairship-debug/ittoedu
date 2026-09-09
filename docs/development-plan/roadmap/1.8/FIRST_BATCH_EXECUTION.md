# 1.8首批执行包：审查修复与原生交互基础

2026-09-08根据Owner review与最新分阶段方案更新。本包只覆盖089及090–094的既有实现修复；下一实施批次先关闭Claude恢复身份、Codex/OpenCode退出收口、真实模型配置和Flow恢复入口四项反例。完成后交付首批实际证据，不自动扩成三adapter完整能力对等、095–104、1.9、2.0或签署S3。后续开发已排入[开发计划](../../AI_ASSISTANT_DELIVERY_PLAN.md#3-正式依赖与执行顺序)，本次文档更新不代表已启动产品实施。

长期方向是完整原生CLI加GUI与编辑器连接，CLI自身负责模型循环、工具、Skills和上下文管理。首批四修之后，090/091/092–094仍需在原Owner接齐工作上下文、原生能力与授权往返；无需另建模型循环。r18-105已撤回，未命名/首存归1.9的042，材料结构与分片归045，自动/手动流程归044，聊天工作台归041；2.0完成软件内全部课件操作与速度质量验收，不要求教师到外部AI、终端或Builder补步骤。这些后续目标不进入本次四项修复。

## 1. 从这里开始

先读根目录总纲的“当前开发路线”、当前任务板/工作协议，以及[首批审查](../../reviews/1.8-first-batch-review.md)、本文件、对应089/090–094规格和直接源码。原[预检证据](../../reviews/1.8-first-batch-preflight.md)只按未受影响范围复用；旧read-only、固定工具白名单或拒绝授权配置下的probe仅证明当时实际覆盖的协议/行为，不是后续目标配置，也不证明完整原生能力对等。上位共同语义见[实施合同](IMPLEMENTATION_CONTRACT.md)相应章节；无需每轮全读总方案、能力索引或无关Skill。

已有正式合同和防错核心可直接使用：

| 路径/符号 | 可复用基础 | 需要核对的直接consumer |
| --- | --- | --- |
| src/shared/localAgentTaskContract.ts：aiTaskSchema、aiObservationSchema、aiProposalSchema、aiHostResultSchema | strict字段、null保留、scope、回执及版本 | 复核090现有harness/repository/窄桥；095才接真实完整观察 |
| 同文件：localAgentRecordV2Schema、localAgentEventV2Schema、LocalAgentCliAdapterV2 | V2记录/增量事件和原生端口，生产consumer已存在 | 修现有090身份/失败路径及092–094原生接线，不重新换一套transport |
| src/shared/localAgentContract.ts：localAgentCapabilitiesSchema | 目录选择器id与resolvedModel分开；unknown、unsupported、原生effort | 091修实际配置链，101消费未来控件 |
| src/shared/localAgentTaskContract.ts：parseLocalAgentLegacyRecord、projectLegacyAgentHistory | repository已消费唯一V1解析，V2持久化/只读投影已存在 | 复核旧记录保全，修原生身份进入V2记录及恢复，不重复建设磁盘Owner |
| src/shared/localAgentTaskGuards.ts | 候选关联、防越界、Stop、部分完成、回执幂等 | 090/100的唯一任务Owner调用；校验函数本身不是工程事务 |
| src/shared/generationContract.ts：generationCommitReceiptSchema；现有coordinator.apply | 实际提交成功后返回批次receipt，拒绝/重复apply无成功回执；当前Chat的V1投影已隔离新字段 | V2的HostResult直接消费该receipt，不能再造提交凭据 |
| tests/fixtures/local-agent-native/*.json | 实际脱敏wire含失败和取消竞态 | 092–094编写对应decoder/transport回归，不靠文字猜字段 |

表中原生端口、V2持久化/投影、能力发现和三transport已存在实现，不能按最初预检状态重新建设。当前需要修复生产接线的具体反例，并核对首批尚缺的真实路径；类型、目录、测试数量均不能单独证明节点完成。

## 2. 修复顺序与写入边界

一个协调者持有共享Harness/Repository/service、合同、工厂与公共测试，并持有其共同写锁；在该写域内只委派实际文件非重叠的CLI叶子，Flow在独立写域并行，使用隔离工作区并保留当前相关未提交实现。当前cli-adapter-codex/claude/opencode细粒度锁已存在，不重新拆锁或改校验器；叶子是协调者写域内的明确分工，不另开与main-preload、ai-session或粗粒度cli-adapters重叠占锁的并行卡。同一实体文件保持单writer，共享变更由协调者顺序集成。

1. 优先关闭P1：协调者和Claude叶子完成真实身份→持久化→应用继续；Codex/OpenCode叶子完成退出/取消RPC收口，协调者验证运行槽释放和下次启动。
2. 接通091配置链：Harness在新建/恢复边界应用唯一偏好，三个adapter提供真实原生配置/确认；从产品入口验证实际请求，不只断言current。共享与叶子变更顺序集成。
3. Flow独立关闭超宽控制器非幂等与默认按钮裁剪，并补真正长正文的滚动/点击证据。

第3–6节保留本批会触及的既有基础与后续同Owner约束，独立规格定义节点完整目标；它们不要求本批顺便补完全部新增能力。已有有效实现不重建，只补四项反例与受影响真实路径。每项修复默认1–3条最小充分检查，不因多个节点共享测试而重复执行。进程故障可用不触发模型调用的隔离注入；配置和Claude恢复必须有真实原生确认/应用路径。

准备与入口统一按[开发计划§6.1](../../AI_ASSISTANT_DELIVERY_PLAN.md#61-准备与局部验证)：依本次代码变化和命名用例准备必要产物一次，纯逻辑/Schema测试不因此触发构建；随后直接执行下列Vitest/Playwright命令。共享检查合并执行或复用，不通过npm测试生命周期钩子反复构建Player和准备全样例。新增反例先在实施diff补命名测试再同步文件/选择条件，实际0匹配不算通过；局部E2E不得运行整个stabilizationCoreUsability三CLI付费矩阵。

多执行者才维护必要协调卡，不预建全部active节点。若并行，子代理只改已分配叶子源码与专属测试；harness、公共合同、Chat、工厂和共享测试均由协调者唯一写入。共享窗口、输出目录与真实宿主检查顺序执行；无并行能力就按同一结果顺序串行。

首批退出是四项反例关闭、现有发送/读取/取消/候选手动应用保全、相应原生与真实窗口证据明确。092–094的原生工具/权限/授权对等、095完整观察、097语义替换、100自动反馈、101完整教师交互均未因本批修复自动完成；不改变有限generation-snapshot的preview边界。共享能力与完整三CLI任务矩阵分别在原Owner和103汇合，不能用首批通过提前签署。

## 3. 089：Flow已知缺陷

**固定事实**：tests/fixtures/architecture-baseline/mixed-spatial.h5lesson副本；“证据讲义”的mixed-global-controller，frame=(190,638,900,64)。1280×720时编辑区域739×576、起点(227,95)，试运行控制器屏幕框(417,733,900,64)，完全低于视口底部671。证据在output/playwright/user-flow-cli-analysis/REPORT.md及flow-*-720.png。

**先读**：src/shared/flowViewportGeometry.ts的createFlowViewportGeometry/revealFlowSelectionPan；src/shared/teacherControllerLayout.ts的teacherControllerAuthoringRecoveryBounds/constrainTeacherControllerAuthoringFrame；src/renderer/ui/flow/FlowOverlayAuthoringLayer.tsx的初始frame投影；src/player/teacherControllerDom.ts的初始校正条件；src/renderer/ui/flowLocationTryRun.ts的mountFlowLocationTryRun；FlowSurfaceHost与现有playbackViewSession的直接接口。

**089-A**：将现有可达范围算法用于初次投影和resize，不只是拖动后。可达兜底是view-only，不打开工程就写revision或history。共享几何解释必须同时驱动显示和命中；不能只给选框补CSS、对内容留旧位置。控制器较宽时至少保住正式recovery bounds中的可操作入口，正文仍响应式排版。

**089-B**：当前位置试运行接入正式Playback View生命周期（创建、mount/activate、resize、destroy），不能再借“没有playbackView”绕开初始校正。200%缩放/平移/恢复只改变观察，不重新挂载Runtime/Component。使用1280×720与1440×900，分别检查编辑、试运行、预览、离线HTML；长正文中/尾、resize和恢复都要观察实际画面。保留既定D1方案A，不把Flow恢复成固定16:9画布。

上述初始投影与Playback View已有实现。本次修复聚焦900宽面板/约683 CSS px视口的非幂等校正：按正式recovery bounds保证缩放/收起可操作，重复render/resize不左右震荡。E2E须检查实际按钮裁剪与点击效果，不能只判断面板部分相交；长正文必须真实可滚动并断言scrollTop及画面变化。复核现成失败截图即可确定边界，不重做全部三表面整合。

**检查（本子包最多3条）**：
- npx --no-install vitest run tests/unit/flowViewportGeometry.test.ts tests/unit/teacherControllerAuthoringBounds.test.ts tests/unit/teacherControllerConsistency.test.ts
- npx --no-install playwright test tests/e2e/r18-089-flow-viewport.spec.ts --grep "mixed-global-controller stays reachable at 1280×720 and 1440×900"
- 两个真实窗口的上述动作/截图。硬件手势没有实际设备就保留未验，不扩展为模拟通过。

## 4. 090-B：公共Owner和旧记录接线

**先读**：src/main/localAgent/harness.ts、repository.ts、service.ts；src/shared/localAgentContract.ts、localAgentTaskContract.ts、localAgentTaskGuards.ts；src/shared/ipcTypes.ts、src/main/ipc.ts、src/preload/index.ts；当前直接consumer src/renderer/ui/chat/CourseChatPanel.tsx和generation/prepareGenerationCandidate.ts。

**确定实现边界**：

- Task仍由LocalAgentHarness持有，Generation Owner持有正式prepare/commit。Chat只发操作和显示投影；不新增Chat私有任务状态或第二Store/History。
- repository按version严格读取，V1经已经实现的parseLocalAgentLegacyRecord/projectLegacyAgentHistory；V2经localAgentRecordV2Schema。新会话只写V2，原V1文件不重写成新内容。可用单一repository按版本分目录读取，不能同一个sessionId同时写两份记录。损坏只隔离该条；保留既有临时文件rename、容量上限、目录引用清理语义。
- V2中CLI会话、Task、runId和nativeTurnId不同。harness为每次原生调用生成runId并追加全会话sequence/time/sessionId；adapter只返回LocalAgentNativeEvent。native turn-ended不自动把Task标completed。候选ready、宿主checked、live committed分别处理。
- 当前start/resume/generate入口迁移到同一个V2 Owner。旧记录的“继续”只提取可读目标/对话上下文并新建任务与当前快照；不能传旧candidate或externalSessionId自动续写。现有生成请求的canonical目标/材料/确认文档约束保留。
- 当前UI若需要阶段性的V1显示格式，可由V2生成只读投影；不得持久化该投影或拿投影字段提交。新增功能消费V2事件，删除对应已迁移私有类型。090对尚未替换的原生单轮adapter可使用有明确删除点的transport适配层，不能宣称它已支持中途输入。
- 首批已有明确的有限观察分支：source=generation-snapshot，保存现有generation snapshot的范围及documentRevision/sessionGeneration，draftEpoch/viewEpoch/runtime必须为null，不能填0假装已捕获；结构/材料文件可随其新observationId保存。旧UI生成入口按现有行为记录applyPolicy=preview，并保留正式commit的活动草稿拒绝；防错核心禁止这种有限观察进入auto应用。095才生成完整authoring/trial/preview观察，101新UI采用既定默认auto。Task.observationId在尚未准备时允许null；不能把有限观察算作T01/T07通过。092–094隔离探针可消费真实捕获的观察fixture。
- assertAiProposalCurrent在prepare前使用，并在既有提交租约内以最新正式状态重新校验。它只约束传入身份，不证明调用者传入的是当前文档；现有documentRevision/sessionGeneration及未来draftEpoch检查不能删除。
- Stop先同步stopAiTask并失效epoch，再await原生取消/自有进程清理。Save As/删除/close的迟到事件可归档，不驱动工程。先前已提交resultIds保留为partial；取消仅保证当前未提交阶段零写。
- acceptAiHostResult只在正式事务已经返回后调用；提交精确使revision+1。直接使用现有coordinator.apply新增的generationCommitReceipt；每个HostResult至多对应一个当前候选批次回执。prepare的plannedEffects不是live receipt，不能把准备副本上的单工具回执填成已提交。重复完整结果返回duplicate，内容冲突失败；不能让重启恢复自动重放。

本次共享修复必须消费所有V2 adapter的原生确认身份，不能只同步V1 wrapper；新建/恢复应用唯一模型偏好并消费原生确认；进程初始化失败/取消后等待结束、槽位释放。上述变化用真实V2 adapter与Harness之间的反例验证，旧V1模拟路径通过不替代。

**本批检查（选择直接对应修复的1–3条）**：
- npx --no-install vitest run tests/unit/localAgentTaskContract.test.ts tests/unit/diagnosticLog.test.ts tests/unit/editorTransaction.test.ts
- npm run typecheck
- 用真实Claude首轮→结束进程→应用继续，核对原生确认身份已进入唯一V2记录；对退出/取消反例核对有界结束、运行槽释放和下一任务可启动。旧V1读取与现有Native候选手动应用按受影响范围检查或复用有效证据，保留唯一持久记录和真实事务。

## 5. 091：模型、能力与配置

**091-A**：复核现有adapter owner中的发现实现，service通过现有local-agent:operate窄桥提供模型配置结果，不借该接口开放任意命令行参数；这个配置接口边界不用于裁剪CLI原有文件、终端、网络或工具能力。Codex用model/list的原生目录/effort；Claude双向initialize返回models/value/resolvedModel/supportedEffortLevels；OpenCode用session/new/configOptions及原生确认，目录未暴露的model vision/effort标unknown，不补固定列表。

**091-B**：期望选择与已确认current分开。Codex选择进入thread/turn原生参数，Claude使用程序化原生模型设置/强度支持入口并验证实际modelUsage，OpenCode使用session/set_config_option返回的currentValue/configOptions。模型变化清理失效effort，原生无默认值时保持null，不填low。运行中不支持配置时排到下一合法边界，显示pending，不能静默重启另一个模型。仅保存非秘密偏好，账号或CLI目录变化刷新发现。

本次优先修复“返回配置成功但实际请求未用”的断点：从Harness configure→新建/恢复→实际原生请求捕获model/effort，确认失败时不得发布虚假current或继续另一模型。专属configure单测仅断言本地current的现有证据不足。

**原生实证陷阱**：Claude的default/opus别名可能解析为同一个模型，不从resolvedModel反猜用户选择；本合同同时保留selector id与resolvedModel。OpenCode的transport image=true不等于Big Pickle能识图，不能把Muse探针结果算给Big Pickle。

**检查**：
- npx --no-install vitest run tests/unit/diagnosticLog.test.ts tests/unit/codexAppServer.test.ts tests/unit/claudeProcessTransport.test.ts tests/unit/openCodeAcp.test.ts
- npm run typecheck（同一未变共享代码已通过则复用）
- 每CLI一次发现→不同于默认的可用模型选择→请求/原生确认；有原生effort的验证切换，无原生依据的不展示。复用本轮已有效模型发现/ACP选择证据，不重复计费探针。

## 6. 092–094：独立原生映射与统一集成

| 子包 | 唯一路径与输入 | 控制/结束语义 | 删除点 |
| --- | --- | --- | --- |
| 092 Codex | codexAppServer.ts；app-server；原生text/localImage；默认工程文件来自当前不可变观察根，其他原生工具按真实授权工作 | requestUserInput关联question/turn并回复answers；steer带expectedTurnId；Stop等待started竞态；host结果用同thread下一turn | 原来仅text输入、丢弃公开summary/plan及每轮finally杀会话路径；后续接齐原生能力时移除固定read-only/never限制 |
| 093 Claude | 现有claudeProcessTransport.ts；--input-format stream-json；原生image内容块、Read | initialize/control_request/control_response；AskUserQuestion回传；stdin整段任务保持打开；匹配本地interrupt后识别aborted_streaming；原生ID确认/持久化后正确继续 | 修正未确认随机ID和仅本地配置；复核旧单向consumer已退出，不再拆另一transport |
| 094 OpenCode | openCodeAcp.ts；ACP prompt image；选定session/config；候选摄取闭合，原生文件/终端与授权由真实协议接通 | session/update消息/plan/tool identity；正文问题用普通输入回答；补充排到下一turn或取消当前turn后同session继续；cancelled是取消终态 | 强制Big Pickle、全局fs.read=false、所有非end_turn都归失败及每轮杀进程路径；后续接齐原生能力时移除终端关闭与统一拒绝授权 |

每家都遵循LocalAgentCliAdapterV2。不要为了让三家方法同名而伪造三家都支持active steer或结构化问答。整个任务的多阶段自动反馈由100实现；同会话继续送入消息/真实host结果的完整原生映射仍归092–094。本批修复Claude实际恢复并保全现有继续能力，不将所有新增接线列为四修退出条件，也不另建模型循环。

首批结束后的同Owner工作还包括原生cwd/配置发现、文件/终端/网络、已有Skills和工具连接、子任务以及授权请求/回答。应用不新增独立MCP服务或通用工具RPC平台，但不能屏蔽CLI已配置的原生连接。默认小观察、候选目录和旧隔离probe不是全CLI权限限制；沿用用户真实有效授权，在GUI保留允许、拒绝和取消语义，不代用户提权。Claude固定工具白名单等旧限制同样属于后续要纠正的配置，旧probe不能作为目标能力对等证据。

本次092/094先关闭初始化退出pending RPC反例：error/close/主动close均清空并拒绝等待请求，关闭幂等，配置/启动阶段等待有界，Stop/删除和下一任务可完成。093先闭合原生确认ID→Harness持久记录→应用继续的恢复路径，禁止随机占位ID直接作为resume句柄。实际请求模型接线与091共享Owner顺序集成；各节点专属测试入口见其最新规格。

**事件投影**：正文增量append、终态全文replace使用同一itemId，避免重复正文；原始reasoning/thinking/redacted内容不进入正文。只有原生明确公开的summary/plan进入对应phase，工具detail保留诊断用途。未知事件可有界记录；未知终态/超限必须明确失败，不用“所有异常忽略”获得绿色。对问题、input-delivery、turn-ended分别验证run/epoch；主进程负责记录sequence。

**默认观察与候选摄取边界**：renderer为应用提供的工程观察传fileId和正式引用；Main把当前Observation中的ID映射到已验证文件路径，映射需realpath闭合，字符串相对路径Schema不是磁盘闭合证明。CLI按任务和真实授权使用其原生工具读取其他资料；当前观察根和candidate root不替代完整原生工作上下文，也不构成通用OS沙箱。OpenCode原生Read与fs/read_text_file等通道各自以实际调用为证，旧探针只证明当时路径。本产品仍按已批准受信团队模型运行；硬边界是宿主只摄取当前candidate root闭合制品、正式事务写入、迟到零工程写入。原生文件操作成功不能冒称当前画布/History已提交。

**本批检查（按受影响adapter选择，不补跑完整对等矩阵）**：
- 按对应092/093/094规格执行专属adapter测试与tests/unit/diagnosticLog.test.ts；共享Harness检查只运行一次。新增反例必须覆盖真实wire/身份持久化/待处理请求结束，不能仅断言返回对象。
- npm run typecheck（同一未变证据复用）
- Claude真实应用恢复与三CLI配置确认按第4、5节合并验证；Codex/OpenCode退出收口先用确定性故障反例，再核对受影响的实际应用启动/停止。已有识图、读取、回答、续轮等证据仅在覆盖范围仍有效时复用，接线变化才补相关链。完整原生能力与三家自然语言任务矩阵留给同Owner后续和103，不通过重复付费探针扩大本批。

生产代码不能import tests/fixtures或output路径；不能写死本机模型、token、会话ID。探针只用于定位受影响差异，不自动在pretest/build中运行。

## 7. 本批结束与升级边界

交付改动文件、四项修复实际结果、复用/新增证据、未通过或外部阻断。只有本批目标和反例通过才写首批完成；保留090–094尚待接齐的完整原生能力，以及S3仍待095–104与既有汇合门的事实。103仍保留三CLI与双入口要求，050、051/052 PPTX、083/087及060/S3没有因撤105削减。同步当前任务卡与任务板，按工作协议清除已结束交接卡；不要把路线节点都做成active卡。

不修改V9、Published、用户账号/全局CLI配置、受管Skill、未来路线内容或用户已有editor-root.local.json；不自行commit/push/发布。子代理仅用于第2节已划定的独立任务。若原生协议事实与本包冲突，保留最小失败样本和具体受影响节点，独立子包继续；不得用假能力/放宽身份/静默降载体通过。仅遇到真实产品语义取舍、超出已批准合同的Schema/权限变化、新服务或无法继续的外部条件才回报Owner；已明确的原生能力对等决定不重复征求，普通CLI授权请求由其原生机制和GUI承接。一般代码分文件与测试安排由执行者完成。
