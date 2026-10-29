# 2026-10-28 既定路线接续：画布焦点、ACP可靠性与两件真实作品

本批接手 `4c34d90c9232c7cf1fc343bb2c6493fae3c04541` 的既有 dirty 工作树，按 `NEXT_EXECUTION.md` 三个工作包继续执行。时间采用目标电脑北京时间；原始日志保留 UTC。开发、集成与产品判断由 Root 和 ChatGPT 原生子智能体完成；本机原生 Agent 仅作为已授权的 ACP 内容消费者，未承担软件开发。

## 本批结论

1. 画布精确目标已经贯通：内置 Engine 的正式 `ModelRequest` 投影通过集成测试，真实 Terra 消费者通过 MCP/ACP 完成。原生标题实际读取 11 字符，Runtime 标签实际读取 7 字符并局改为 9 字符；默认语义读取不再附带工程目录。焦点、上下文和写入授权仍由各自原 owner 决定。
2. 找到并修复了一次真实 ACP 返修造成的富文本样式丢失。修复后用不同的临时标题实际重做省略 `format` 的替换，再通过 GUI Undo/Redo/Undo 验证并保存；没有把无变化调用当成修复证据。
3. 活跃 ACP 任务取消、域撤权、人工接力、新进程恢复同一原生会话及正式保存/导出已经走通。另一个隔离市场副本完成真实 stdio 连接关闭→`connection_failure`撤权→新进程明确恢复同会话→只保存/导出r33；没有重放已应用修改。两个场景分别记账，不扩大成任意崩溃、断网或未决写入恢复保证。
4. 市场作品完成 Runtime 精确字段返修、人工布局与数据保全、GUI Undo/Redo、正式保存、离线互动和独立冷开。叙事作品完成原定人工接力与返修闭环，并另存原生分栏视觉候选；候选通过同一对象 Source 就地回退，保留已验收基线。
5. 视觉复核额外发现 Flow 目录遮挡正文，旧“无横向溢出”检查没有覆盖它。现有播放器布局 owner 修复后，两份新导出各通过六次目录开合/尺寸转换；1280 展开目录时正文视口从 x=260 开始，主标题从 x=326 开始，实际截图无遮挡。
6. 原始 GLX→真实子作者→封存认领→父正式采用的新完整消费者仍未完成：内置连接的实际 OAuth refresh 返回 HTTP 401。已修正误导性诊断，保留既有物化/身份修复，没有伪造父 Engine run、借外部 MCP run 冒充真实父任务或切换模型绕过。

## 代码增量

| 范围 | 实质改变 | 验证依据 |
|---|---|---|
| 选择版本与目标延续 | `SelectionContextController` 在 prepare/drain 前保留原手工捕获的 epoch/revision/targets；renderer 外部 UI 状态转发对应版本；External 用现有 `continueDocumentTargets` 映射后发句柄 | 精确选择、跨 revision、缺版本/已改变拒绝、没有页面替代；`canvasFocusContext20261028`、`g20ExternalMcpService` |
| 模型工具目录 | 同一个 classifier 处理 `contentOutput` 与显式 selection；文字范围/明确文字字段使用 text，普通对象使用 content-edit，页面/文档/多目标保持 general；Engine 后续请求仍保留已加载工具 | 内置实际 `ModelRequest` 断言及实际 Source/file 扩展读取；9/9 |
| 外部按需披露 | 首次 `tools/list` 保持既有兼容；成功的显式 `workbench.state` 取得精确目标后冻结本 run 的非通用 profile，沿既有通知重列；rebind 重置 | 真实 SDK 38/38；GUI 实测目录 62→30，按需扩展后31；提前加载能力和原写权保留 |
| 最小语义读取 | 默认/semantic `read` 不再附带作者目录，`detail:'object'` 继续提供明确的工程发现入口 | semantic 9/9；真实 11/7/9 字符读取；按选择 target 可直接发现对象 Source |
| 富文本替换 | 省略 format 时区分普通文本与真实 HTML/实体；普通字符串沿已有文本替换保留 inline 样式，显式 format 始终优先 | 真实故障→修复；原生范围、聚合选择、绑定字段、HTML/实体/显式格式测试；相关44/44 |
| ACP owner | 异步回包后的终态检查、断连后不复活、prompt 终态清 pending、取消重入仅一次撤权、wire-order 配置更新优先 | `acpAgentSession` 17/17；真实活跃取消、stdio断连与明确跨进程恢复 |
| OAuth 诊断 | 模型目录解析阶段的 refresh 错误也映射为安全、准确诊断；401要求重新登录，网络/限流/服务器错误保留各自恢复含义 | `g20ExecutionSettingsService` 9/9；实际连接401被准确显示，未泄漏 token/raw body、未改登录流程或默认设置 |
| Flow 目录 | `flowToc` 透传既有开合事件及有效 open；modelProjection、compiledPlayer 在原 relayout 内采用既有 shell inset；不改作者内容或缩放/pan owner | 真实1280反例；model/compiled两消费者有效 red→green，相关7/7；最终HTML各六次实际几何检查 |

外部仍按原权限提供文件和服务工具。这不是“整个 MCP 目录只剩几个工具”，也没有改默认 Agent、登录入口或权限。原生 ACP 没有暴露完整内部模型请求 schema；本批能证明真实 `tools.load` 后的工具调用成功，不能据此给出未观测的原生请求 token 降幅。

## 真实作品与交付

全部作品位于 `output/continuation-20261028/product-ui/workspace/`，复用冻结 brief、素材及既有 A 路线作品继续，不将返修计为新作 T1/T2。

| 作品 | 正式稿 | 作者结构与保全 | 最终交付 |
|---|---|---|---|
| 叙事基线 | `story.glx`，r23 | 33实例：16文字、5文档块、5图片、3原生组、3有界Web互动、1Flow；正文、图片身份/裁剪及四章顺序保留 | `story-delivery-offline.html`；新导出离线互动/目录几何通过；r23原稿独立冷开既有本批证据复用 |
| 叙事分栏候选 | `story-polished.glx`，r27 | 另存候选；新增3个原生布局组，原33实例保留；标题 Source 唯一改动为62→48字号，资源集合不变 | `story-polished-delivery-offline.html`；新构建独立冷开、离线互动/目录几何通过 |
| 市场 | `market.glx`，r32 | 38实例，含原生文字/表格/图表；仅1个有界Runtime；新标签、书摊固定成本450、咖啡单价30和默认N1200/W1全部保留 | `market-delivery-offline.html`；独立冷开和两尺寸离线QA通过 |

### 叙事旅程

- 实际 GUI 改主标题为“旧站的一天 · 社区试运行版”，修改傍晚撤收约定，通过真实替换图片操作使用 `platform-alt.png`，保留5%左裁剪；实际 Undo/Redo。
- 真实画布选择“12:00 候车厅档案”11字符后，ACP 将其改为“12:00 记忆候车厅”。原生任务仍活跃时取消，先撤领域授权，再取消会话；已提交 r17 保留，没有自动保存或重复应用。
- 撤权期间人工把第一段改为“第一班车已经不再驶入”。新进程恢复同一会话、明确重新授权后读当前状态，保存/导出 r18；全模型比对证明恢复没有新增作者变化。
- 独立比对发现第一次省略 format 的替换丢掉标题 inline 样式。该 r18 产物保留为失败证据，没有称为最终合格。
- 修复软件后恢复原样式，再用不同临时文字实际替换（同样省略 format），样式保持；GUI Undo/Redo/Undo 后保存 r23。最终完整作者模型只包含约定局改与人工接力；noon 标题仍为35px、Georgia、原绿色。
- 正文8段共721汉字，四章、5图、四时段状态与两个独立记忆展开保留。新分栏候选仅是额外视觉润色，和已完成 T3 保全验证分开记账。

### 原生分栏与 Source 回退

`object.layout` 使用六个已观察整对象句柄，把开篇四个文本对象与平台图片/说明编入两列；软件新增三个无 frame 的原生 group，一次正式事务。原实例数据/样式/资源逐项相等，GUI Undo 恢复原树，Redo 恢复分栏。

随后 `text.format` 对 `listChildren` 返回的 whole `guoling.document-block` 标题句柄拒绝“当前目标没有可格式化的正文”。现有合同仅对显式正文槽位/范围及唯一正文的原生 text 作隐式格式化；该结果是已知目标类型边界，不通过扩大任意组件槽位绕过。

Root 重新在画布点该标题，沿同一选择 target 取得对象的 Source，仅回读295字符的 `.data.json`，正式 `project.apply` 唯一替换字号62→48。完整模型比对证明没有修改别的节点。这里没有重找全工程、重建标题或把主内容改成大 Web 对象。

### Flow 目录与最终叙事交付

Root 在分栏候选的1280截图中发现260px目录压住正文；旧脚本检查无 document overflow，却没有检查实际遮挡。新增真实 model/compiled 消费者测试在原实现均失败，修复后通过；最初夹具本身使用了不支持的 document-block 数据形状，其失败不算产品有效 red，保留两次记录。

最终重新构建 player、renderer、electron，并通过正式 `document.export` 生成两个新文件；导出前后作者 snapshot 与 GLX 哈希完全不变。每份实际导出均依次检查1440关闭→1440打开→1280打开→1280关闭→1440关闭→1440打开。1280打开时目录右界260、正文视口260–1280、主标题左界326；关闭后视口恢复0–1280。两份均通过四章导航/aria-current、四时段、两个独立记忆展开、五图及无错误/HTTP请求。Root已看最终两尺寸图与新分栏稿冷开图，正文与标题无遮挡、图文保留，独立冷开的48px标题和四章结构正确。范围为默认zoom=1/pan=0，不扩写为全部缩放状态已验。

叙事导出仍保留此前已有的“动态 CSS 资源依赖无法静态确定”警告；本批没有改成静默成功。已实际覆盖的离线互动、五图和章节均无网络请求/运行错误，这不等于静态分析已证明任意动态路径依赖闭包。市场最终导出 warnings 为空。

分栏稿独立冷开使用全新 profile、实际Electron main PID 28204、新epoch `1f0cf8cb-5a0d-4688-8d97-3df0e04a275c`：r27、dirtyfalse、Undo/Redo=0、36实例身份与作者model一致、21个资源身份键集合一致，原GLX、最终HTML与参考证据哈希不变。资源按键集合核对，不能冒称本次逐字节比对了全部运行时资源。

### 市场迁移验证

真实单击 Runtime 内的“总订单 / 笔”，读回7字符；Terra 9次领域调用完成“预计总订单 / 笔”局改、保存和导出。全模型差异仅为该 HTML 标签增加两个字及 revision，JS、数据、图表、其他原生对象与人工布局不变。GUI Undo/Redo 后重新保存 r32 并导出最终文件。

| 情景 | 总订单 | 营业额 | 总成本 | 净结余 |
|---|---:|---:|---:|---:|
| N1200 / W1 默认 | 480 | 19,392 | 11,524 | 7,868 |
| N0 | 0 | 0 | 3,100 | -3,100 |
| N1200 / W0.65 | 310 | 12,505 | 8,527 | 3,978 |
| 恢复作者默认 | 480 | 19,392 | 11,524 | 7,868 |

离线 QA 核实际输入、恢复按钮、九列表格和两组图表，1440×900与1280×800无错误/网络请求，标签未截断。全新配置目录/进程冷开 r32，38实例与资源、作者模型一致，undo/redo 均为0，原文件/导出/参考证据哈希不变。

## ACP 实际结果与计时边界

精确模型均为 `gpt-6.1-terra` / `xhigh`，沿已存在的原生 ChatGPT 订阅；已装 native 0.164.0 / adapter 2.3.0。没有读取/中转 token、启动登录、切换默认路由或使用外部 Agent 开发软件。

| 实验 | 原生 prompt 时间 | 本次事实 | 限制 |
|---|---:|---|---|
| 叙事活跃取消 | 36.438秒 | 首次正式应用后撤权/取消约0.2秒，pending归零，r17保留 | 首次样式有缺陷；4次Skill路径猜测失败源于Root allowlist漏了skills工具，不能当纯产品速度 |
| 人工接力后新进程resume | 78.307秒，恢复6.245秒 | 同一原生session；r18保存/导出，未重复作者修改 | 该阶段仍带首次样式缺陷；一次view.click未提供属于实验配置问题 |
| 市场精确标签修改 | 45.344秒 | 9次领域工具、无工具失败；r29→30，保存/导出；Root后续Undo/Redo到r32 | 属于局部字段实验，不是完整新作首次合格时间 |
| 最新精确读取与Source展开 | 27.326秒 | 5次调用：state→read9字符→tools.load→同对象22条目录→2355字符内容HTML；r32/磁盘不变 | 旧包装器要求磁盘变化而exit1；独立回执核验消费者通过，原failed记录保留 |
| 真实stdio关闭后新进程resume | 36.416秒，恢复1.695秒 | 同session，5次工具；只读当前r33→保存→离线导出，全部成功，作者model/history不变 | 断开发生在一次已完成只读之后；未验证丢失写回执或OS/工作台崩溃 |

最新只读实验的包装器已增加显式 `expectDiskChange:false`，默认仍为写作实验的 true；报告记录预期，符合预期不等于作品验收。没有为改绿报告而重跑模型。原生 usage 为通道提供的累计计数，不能解释为单次上下文窗口、实际账单或证明工具优化节省多少 token。

本批没有新的同条件 A/MCP、B/裸HTML、C/内置整作速度比较。历史 B 作品保留可参考；视觉润色改善 A 的开篇构图，但没有进行盲评或证明 A/B 视觉、速度全面持平。十分钟首次合格仍是挑战目标。

### 真实连接断开与明确恢复

原市场r32保持原样，另存 `market-disconnect.glx`。此前v2试验中的唯一正式作者变化是“预计总订单 / 笔”→“情景总订单 / 笔”，r33尚未保存；逐项模型比对确认其余计算、表格、图表、资源身份和人工布局不变。

最初两次计划用Windows进程树身份复核后关闭本轮适配器，但CIM查询超时，均没有注入断连：第一次10秒身份查询超时，未修改作者稿，native总55.118秒；第二次初查29.466秒完成、复查30.061秒超时，已提交标签留在r33，经撤权/正常取消收口，native总80.896秒。两次均作为实验失败保留。Skill路径猜测失败来自Root试验allowlist遗漏`skills.read/list`，不是产品性能证据。后续不再继续调试Windows WMI。

第三次使用现有transport已持有的ChildProcess所有权：仅在实验controller设置显式`allowTransportFaultInjection:true`、单个活跃prompt、存在pending request且未取消时接受一次IPC，调用实际`transport.close()`；未新增产品API、状态系统或伪造关闭事件。真实原生消费者先完成当前9字符读取，host核同session、非replay回执及文档/History不变，再关闭stdio。实际`transport_closed`触发原owner的`connection_failure`，约2.04秒后发出撤权请求并获确认；pending requests/permissions归零。原controller仍为failed/exit1，独立host验收通过；requestId/sessionId关联及额外错误缺席也已独立复核。

新进程显式重新授权并`session/resume`恢复同一个`01a18171-0480-72c1-95b9-8ae83b82c25c`，先`workbench.state/read`，然后`file.save`、按需发现`document.export`并导出。五次工具全部成功，无新增作者修改。最终r33、dirtyfalse、全作者model和Undo/Redo深度与断开前相同；仅绑定文件版本因正式保存更新。新副本为 `market-disconnect.glx`，导出为 `market-disconnect-recovered-offline.html`，两份正式回执warnings均为空。该副本是可靠性验收候选，不替代已接受的市场r32。

恢复稿的独立离线QA实际跑完四种情景与1440/1280两尺寸，表格、图表、标签与输入恢复通过，无页面错误/外部网络请求。独立Electron main PID95144、全新profile、新epoch `ba74294f-de8c-47d8-91d9-194928aed68d`冷开r33，dirtyfalse、Undo/Redo=0、38实例及资源身份键集合一致。Root亲看冷开GUI和1280离线截图，主要标签、图表和九列表格未被遮挡/裁切。GLX、最终HTML和保存参考证据的哈希在验证前后不变。

范围限于**活跃prompt在已完成读取后发生实际stdio关闭，工作台仍活着并持有已提交未保存稿，然后明确重新授权恢复**。pending request是ACP prompt，不代表领域写入未决；没有验证OS硬崩溃、网络断开、工作台崩溃、已提交写入回执丢失或自动重放去重。Native继续使用既有授权环境，不能称为隔离native登录profile。

## 未闭口与阻断

### 真实 GLX 委派消费者

既有 P1/P2 修复和测试保留。新消费者的父/子提示词、冻结源/目标及封存、采用回执核对脚本已经准备。实际内置连接能解密、身份一致，但 refresh 返回401；本批没有发出真实父/子模型调用。

`delegate.agent` 的真实父身份要求非终态 `ExecutionEngine` record；外部 MCP 的 Gateway run 或原生 ACP session 不能冒充。不能为通过实验补造父记录，也不启用历史 Codex Luna/其他模型。需要用户恢复既有内置连接后，沿准备好的同源 GLX 副本继续真实子作者、HTML+CSS封存、父 `from` 正式采用和保存冷开。并行净收益仍未新增证明。

### B3 临界宽度

新增“95小时”、Microsoft YaHei 28px 的真实 Chromium 探针，沿捕获→装配→原生草稿→渲染比较，且实际跨过1/2行阈值。固有宽88.84375；两行阈值88.8125，相邻一行88.828125，三点源/原生行数为2/2、2/2、1/1，宽度相同、字形差异小于0.1px。该受控样本通过，不是丢失的历史输入复现；没有添加全局余量、nowrap或缩字。历史首个真实几何分歧仍待原输入。

### 仍需按真实需求继续

- OS/工作台崩溃、网络断开及未决领域写入的回执丢失等边界；本批活跃取消和实际stdio关闭后的明确恢复成功不能替代这些场景，不机械重跑已过两条旅程。
- 精确发现的进一步体验：whole多槽位对象的 `inspect` 当前仍按 kind 披露，不承诺任意整对象都能 text.format；已有明确 Source 回退可用。
- 更重真实作品的子作者采用与净收益、首次合格完整计时；不重复已通过短样本，不启动新的通用 Harness 研究。
- ACP可选入口与登录/默认接管的具体产品方案需另行讨论；技术通道实证不等于新入口UI已经交付。

## 验证与证据入口

`output/continuation-20261028/` 下保留成功、失败、原始回执和各次脚本，不回填旧批次成功。

| 验证 | 结果/证据 |
|---|---|
| 实际Engine焦点请求 | `text-focus-profile-green.log`，9/9 |
| External MCP权限/版本/目录 | `external-profile-green.log`，38/38 |
| 既有工具展开消费者 | `scoped-profile-green.log`，6/6 |
| 富文本/正式Gateway/semantic | `rich-style-green-final.log`，44/44 |
| ACP owner | `acp-session-green.log`，17/17 |
| OAuth错误分类 | `oauth-diagnostics-green.log`，9/9 |
| B3真实跨行探针 | `b3-native-boundary-crossing.log/.json`，1/1 |
| Flow真实消费者 | `flow-toc-consumers-red-v2.log`两例有效失败→`flow-toc-consumers-green.log`相关7/7；类型桥修正后`flow-toc-final-bridge-green.log`新两例再次通过 |
| 三套类型检查及构建 | `typecheck-toc-final-green.log` exit0；`build-toc-final.log` player/renderer/electron exit0 |
| 真实焦点与目录 | `live-focus-profile/facts.json`、`acp-market/profile/independent-consumer-validation.json` |
| 叙事取消/恢复与保全 | `acp-story/phase1/`、`phase2/`、`author-preservation.json`、`product-ui/story-style-validation.json` |
| 市场保全/交付 | `acp-market/author-preservation-and-delivery.json`、`market-offline/qa-delivery/facts.json`、`market-cold/independent-UCubFm/facts.json` |
| 叙事基线冷开 | `story-cold/independent-wBwqbS/facts.json` |
| 叙事新导出与分栏冷开 | `story-final-deliveries/facts.json`、`story-polished-cold/independent-AAtG9b/facts.json`；Root已亲看最终冷开图 |
| 最终叙事离线互动/几何 | `story-offline/qa-delivery-final/qa.json`、`story-offline/toc-final/facts.json`；`story-polish/offline-delivery-final/qa.json`、`story-polish/toc-final/facts.json` |
| 原生分栏/Source | `story-polish/authoring.json`、`delivery.json`、`source-fallback-delivery.json` |
| 实际stdio断开/明确恢复 | `acp-market/transport-drop/transport-host-result.json`、`acp-market/disconnect-recovery/author-validation.json`；原controller failed/exit1保持不变 |
| 恢复稿离线/独立冷开 | `market-disconnect-offline/qa/facts.json`、`market-disconnect-cold/independent-UmVeqJ/facts.json`、`acp-market/disconnect-recovery/root-visual-review.json` |
| 最终Root视觉复核 | `story-final-deliveries/root-visual-review.json`；实际最终导出与冷开截图 |
| 目录遮挡反例 | `story-polish/offline-qa/cover-1280.png`、`story-polish/toc-red/facts.json`；自动无overflow为真但不能证明未遮挡 |
| 内置真实阻断 | `delegation-ui-diagnostic-final.log`；无模型调用、无登录变更 |

独立冷开第一次因 Playwright 返回 CMD 包装器PID而不是 Electron main PID失败；后续按已确认的独立 profile 和父子关系清理本轮孤儿进程并修正校验，保留失败记录。市场最早离线QA的 SecurityError 来自 Playwright `serviceWorkers:'block'` 对 sandbox iframe 的注入；删除该测试注入后仍用 offline/网络断言，实际作品通过。以上均未冒充产品修复。

## 保全与下一步入口

基线保存于 `baseline/status.txt`、`tracked.diff`、`facts.json` 与关键 preimage；本轮重叠写域由Root统一远端集成。既有 dirty 源码、作品、恢复稿及未提交文件保留。未执行 reset/clean、commit/push/发布，也未关闭旧用户窗口；独立验证只退出本轮创建且确认身份的进程。针对 Windows CRLF 的 `git -c core.whitespace=cr-at-eol diff --check` 通过，未修改Git配置或批量转换原文件换行。

最终保全核对：起始30份关键preimage中23份逐字节未变，7份仅在本批明确写域内续改；原有三个特殊名称未跟踪文件仍在，HEAD保持 `4c34d90c9232c7cf1fc343bb2c6493fae3c04541`。正式市场、叙事基线、分栏稿及各自最终HTML的SHA256与各轮接受记录一致。具体见 `preservation-final.json` 和 `final-verification-summary.json`。

接下来继续同一个 `NEXT_EXECUTION.md`：优先真实消费者与创作/编辑闭环；GLX支线待现有连接恢复；完整自研 Harness 新增开发、Pi/Codex App Server路线比较与迁移研究保持冻结。
