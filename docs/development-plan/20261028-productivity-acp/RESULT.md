# 2026-10-28 生产力与 ACP 接续结果

## 结论与范围

本批在 HEAD `4c34d90c` 基础上保留并接续上一批尚未提交的正式成果，优先修复 Source 内嵌原生文字与共享状态冷启动，再用原市场作品检验 ACP 的正式修改、保存和导出。没有开展完整自有 Harness 重构、切换产品默认路线或替换领域 writer。目录日期按目标电脑北京时间 2026-10-28；当次原始日志使用 UTC，部分为 2026-10-27。

已验证：Source 原生文字编辑与局部 Runtime 状态保持、真实 Source 更新和独立冷开；共享状态注册窗口的失败/通过对照及原市场作品冷开；薄 ACP 会话 owner 的 12 项测试；当前原生 ChatGPT 授权的精确 `gpt-6.1-terra` 实际配置与真实领域返修。已经交付的同一市场产物通过编辑态、独立冷开、离线三种环境共 12 个情景，Root 经 RDC 复核最终画面；验收没有追加模型调用。以下分别列事实，不用 Agent 结束替代作品合格。

当前投资建议为**保留现有自有入口，冻结重度 Harness 开发**。历史速度优势没有形成同模型、同工具与同质量终点的证据；下一步优先共享领域能力、ACP 与复杂任务可靠性。此判断可逆，不授权删除已有循环或迁移默认入口。

## 1. Source 内嵌原生编辑闭环

根因是双击期间的真实布局变化：第一下命中 Source 内嵌原生文字，选中后画布/面板重新布局；第二下按同一屏幕坐标重新命中时只剩父容器，原生编辑目标丢失。

沿现有作者输入 owner 保留第一下的语义目标与原生编辑捕获，在双击激活前复核文档、epoch、表面、编辑组、所有权、唯一挂载与锁。仍由既有原生编辑器、DocumentSession、History 和保存提交；临时投影几何不写回作者 frame。清除了上一轮临时 inline trace。

真实生产 Source/Electron 验证 `source-ui/run-FBj4Wc`：

- Source v1 通过可信鼠标计数到 3。
- 双击并修改原生子文字后，计数仍为 3，module/mount 身份未变。
- 真正修改 Source 为 v2 后，旧实例 dispose 一次，新实例重新准备与挂载，计数重置且可继续操作。
- 正式保存 revision 2、dirty=false；新 profile 冷开保留文字与 v2，Undo/Redo 空，临时运行状态重新开始。
- 全程 page error 为 0，没有模型调用；Root 经 RDC 复核修改后与冷开画面。

UI 验证中另修正了测试自身的 iframe 坐标换算。打开代码面板后画布缩放，原始 boundingBox/locator 输入落在按钮外；按 iframe 实际 border-box 映射后，事件仍为 trusted mouse。该问题与第一下语义目标丢失的产品 Bug 分开记录。

证据：`output/next-execution-20261027/source-ui/run-FBj4Wc/facts.json`、同目录 02/04 截图；`output/long-execution-20261028/source-lifecycle-coordinates.log`。失败过程保留在同批 source-inline/source-lifecycle-final 日志和旧 run 中。

## 2. 共享状态冷启动

原市场作品的两张图表已经挂载，却停在旧 N=1000 的默认数据；控制器与表格则是正确的作者默认 N=1200。两张 Source 图表合法地先 subscribe，再同步 get/draw，不能归咎于作者异步订阅。

旧 Sandbox 同时维护永久状态事件桥和按名称跨端口注册的订阅。更新落在注册往返之间时，缓存改变但具名回调遗漏；显式监听 `__runtime.state` 还会收到重复镜像。

本次复用已有永久桥，在本地先更新缓存、再分发具名状态回调和镜像。保留 optimistic writeId/ACK 与旧回声抑制，不增加 state owner，不改变普通 subscribe 无初始回放的语义。独立审查确认编辑器、发布 Player 和 compiled Player 均沿 ComponentRuntimeWorld 提供同一永久桥。

新增确定性回归使用真实隐藏 Electron/沙箱，仅延迟子端到宿主的订阅注册：

- 旧实现：get=42、画面=1、具名通知 0、镜像通知 2，精确失败。
- 修复后：画面=42，两类通知各 1；原有乐观回写及相关 Source/realm 检查共 6/6 通过。
- 原市场作品 `market-ui/run-5p2cnu` 的首次打开与独立冷开均显示 N=1200、咖啡营业额 4032、总营业额 19104；表格、两图和汇总一致，作者 revision 28 与原文件哈希不变。零模型预检通过，Root 复核冷开图像。

证据：`shared-state-red.log`、`state-inline-green.log`、`market-acp-preflight.log`（位于本批 output）；原作品事实与截图位于 `output/next-execution-20261027/market-ui/run-5p2cnu/`。

## 3. ACP 薄会话与真实 Terra 领域任务

新增 `src/main/workbench/external/acp/AcpAgentSession.ts`，由隔离实验 controller 实际消费。职责仅为单连接/原生会话、能力协商、精确配置、权限请求、取消、回放标记和自己启动的进程清理。没有模型循环、压缩、shadow history、通用重试或新的领域 writer；没有新增多 Harness UI 或切换默认入口。

直接验证的可靠性边界：

- 配置必须在设置回包中确认实际 currentValue；未确认不能 prompt，不把“模型在列表中”当作已经切换成功。
- 默认拒绝未知权限；取消立即处理当前和迟到的权限决策。
- 先由现有领域宿主撤权，再通知 ACP cancel；有界清理，不因未知结果自动重发修改。
- 全程处理父宿主 IPC 断连，撤权未确认明确失败，清理 owned adapter。
- 原生恢复使用已声明 resume/load 与同一 sessionId；load 回放标记仅展示。
- 真实 adapter 将 MCP tool_call 标记为 execute，授权按结构化 server/tool 精确允许清单判断，拒绝携带 shell command/cmd 的伪装，不能按显示标题放行。

`tests/unit/acpAgentSession.test.ts` 在目标电脑 12/12 通过，含真实 stdio 子进程。控制器权限形状另做 9 项远端零模型验证；独立审查发现并已补齐 IPC 断连、实验路线标志串扰及撤权 ACK 条件。

### 授权与实际调用

先核原有路由目录存在精确 ID；正式实验进一步通过当前原生 ChatGPT account/config/model-list 核实 `gpt-6.1-terra` 和 medium，再由 ACP 配置回包确认。复用已安装 native 0.164.0 / adapter 2.3.0，不读取/复制凭据，不改全局配置。仅将原生 Harness 作为被测执行通道，开发由本会话与原生子 Agent 完成。

本轮唯一新增真实模型任务：`market-ui/run-XjYk6N`，一次 ACP prompt 内由原生 Harness 完成多次工具往返；不等于一次底层模型请求。

- 原件是 pre-T3 市场 GLX 的隔离副本。任务只改咖啡客单价 28→30，保留书摊固定成本450、默认N1200/W1.00及全部其余作者内容。
- 真实 `workbench.state` 返回活动文件、revision/dirty、当前表面选区、writable 与新目标句柄。
- 15 次领域工具调用均完成，包括目录发现/6次 operation.read 续读、两份原生表格读取、project.apply、file.save、document.export。
- 正式 apply 回执 r28→r29；save 回执 savedRevision=currentRevision=29、dirty=false；export 回执 html-offline written、exportedRevision=currentRevision=29。
- 原生 prompt 回包 `_meta.quota.model_usage` 明确是 `gpt-6.1-terra`；不是仅靠显示名称推定。
- prompt 阶段 44.050秒，包含模型/工具等待；controller 总计49.172秒包含接入和清理。它们不包含全部独立作品验收，不是最终合格时间。
- 通道回传累计 inputTokens=59192、cachedReadTokens=392832、outputTokens=1173、totalTokens=453197；底层模型请求轮数与实际费用未独立计量，不填0或换算账单。原生通道将 input 与 cached input 分列，不能直接与内置引擎累计 inputTokens 或 API 单请求成本相比。

作者全量差异恰好为咖啡价格字段与 revision，正式文件与实时 Session 一致，资源哈希保持。首次 UI 验收因自动化人数框输入失准失败；下一次完整验收的 12 个情景已过，但 Playwright 自身的 Service Worker 注入在 opaque Source 沙箱中产生错误。两次失败事实和原产物均保留，没有因验收问题重新调用模型。

已修复测试的坐标输入与离线 Service Worker 拦截。真实 Chromium 对照稳定复现原注入错误；新 helper 仅处理属性 getter 的 DOMException/SecurityError，其余错误仍暴露，且注册明确被 NotAllowedError 拒绝，无 worker 请求、注册或实例。应用沙箱、依赖版本、页面错误和离线网络断言均未放宽。上游同类问题见 [Playwright #43113](https://github.com/microsoft/playwright/issues/43113)；本机直接对照记录是 `output/long-execution-20261028/offline-service-workers-2026-10-27T19-04-39-375Z.json`。

最终复验 `market-ui/run-UWOIYo`：

| 环境 | 情景 | 结果 |
|---|---|---|
| 当前编辑器、独立新 profile 冷开、完全离线 HTML | 默认 N1200/W1.00 | 每种环境均为订单480、营业额19392、成本11524、净结余7868 |
| 同上 | 零客流 N0 | 订单/收入0，固定成本3100，净结余−3100；负值图表与表格一致 |
| 同上 | N1000/W0.65 | 订单259、营业额10444、成本7637、净结余2807 |
| 同上 | 恢复默认 | 回到作者 N1200/W1.00，价格30、书摊成本450继续保留 |

共 12/12 情景通过，正式保存 r29/dirty=false；正常退出、新 profile 冷开 Undo/Redo 为0。页面错误0、离线网络尝试0，原件及原失败记录/GLX/HTML/JSONL等7份文件的哈希全程不变。Root 复核最终离线默认、冷开降雨与封面图像，表格、图表、文字及保留封面布局完整。最终自动验收 37.8 秒（整个 Playwright 命令39.1秒），单列为验证耗时；不与44.050秒相加伪造完整生产力速度，也不回写原失败事实。

正式交付副本是 `output/next-execution-20261027/market-ui/run-UWOIYo/workspace/market.glx` 与同目录 `market-offline.html`，与原 ACP 交付字节完全相同。GLX SHA-256 为 `e1432f7d79e3f7880f774b5b184d1d5bf40d7f6be5149d6f57ea45c61f1e7c85`，HTML 为 `c3bd8d76a16bb6df0bee66b511f3df439523a62121115ee6516158a717e25eb5`。原自动 facts 保留 awaiting-image-review 状态，Root 独立视觉判断记在本结果及本批 `final-verification.json`，不改自动记录伪装成机器视觉验收。

直接证据：原 run 的 controller JSON/JSONL、facts.json，以及 `output/long-execution-20261028/terra-domain-receipts.json`。不能仅用 end_turn、磁盘变化或文件存在宣称整个任务完成。

## 4. 历史 Harness 速度核查与投入边界

| 证据来源与等级 | 核实结果 | 可以得出的判断 |
|---|---|---|
| 10/26 H/G0，creation-timing.json | 同记 gpt-6-luna；run结束396.292/90.386秒，但两份原稿均未合格；首次离线44.086/60.853秒；H存在等待与阶段澄清 | 找到了“GLX更快结束”的表面来源，不能认定首次合格速度领先。H仍是内置作者路线，不是独立root HTML |
| 后续市场 A/B 原始 timing JSONL | A为root正式MCP，B为同root独立HTML；记录模型GPT-6 Astra Pro。候选T2为858.908/250.144秒；A明确盲审待定 | 真正独立HTML基线存在，但不能把候选比值当最终同质速度倍率 |
| 市场 C 返修/局改原始summary | actualModel均gpt-6.1-sol；质量返修30请求/54工具、elapsed470.832秒，T3为14请求/18工具、177.398秒；保存r31/r29 | 与A/B模型不同，完成/文件存在不等于独立质量合格；没有同模型三路线结论 |
| R3 E1派生统计 | 同内置路线两种上下文入口8.504/10.520秒，均3模型请求；单次成对样本 | 支持精确对象上下文减少输入；不证明B快路径或C完整循环的独特增量 |
| R3四格及返修派生复算 | 首轮全部QA失败；结构化两格返修后通过文件所载共同QA，120.718/129.533秒为执行阶段和，非连续最终合格墙钟 | 不能由共同QA字段推定全面语义/艺术验收；并行/装配收益须计入协调、返修和验收，不能选首存或阶段和作终点 |
| 历史ACP/Pi | ACP选区短改21.961秒但磁盘未变；Pi两次36.357/21.824秒使用DeepSeek | 失败或不同模型不能当成熟Harness性能上限，也不能推导自有更快 |

来源分别为 `output/product-execution-20261026/parallel-closure-20261026/creation-timing.json`、`docs/development-plan/20261026-product-execution/RESULT.md`、`output/audit-remediation-20261027/benchmark/{protocol.md,A/market-timing.jsonl,B/market-timing.jsonl,C/quality-rework/control/original/summary.json,C/t3/control/original/summary.json}`，以及 R3 editing/parallel-audit/harness 原记录。原始 JSONL、当次控制器 summary 与后续派生统计分开理解，没有按二手记忆下结论。

下面 A/B/C 是本轮投资方案编号，与上表历史实验的 A=MCP、B=独立HTML、C=内置AI 不同。

| 方案 | 当前投资判断 |
|---|---|
| A：ACP + 成熟 Harness + 完整领域能力 | 继续解决真实目录、选区、正式事务、授权、保存和恢复；本轮已取得真实Terra工具回执，不把历史配置/发现失败当路线极限 |
| B：A + 轻量快速领域执行 | 值得在高频确定性短改上低成本验证；现有机械执行/目标范围能力先复用，尚无独立同条件增量计量 |
| C：B + 完整自有 Harness | 保留可用入口、核心Bug与可靠性修复；冻结重度循环/历史/压缩扩建，待C相对B显示可重复额外收益再重开 |

领域工具、机械装配、精确对象上下文、Runtime编辑、事务和资产属于共享产品能力，其收益不能整体记到自研loop。维护责任确实包括历史/压缩/重试/调度/恢复/模型适配，但没有工时账本，不给虚构人月或成本百分比。单次本轮Terra结果也不用于不可逆淘汰或默认迁移。

| 研究维度 | 当前事实与受约束判断 |
|---|---|
| 响应速度 | E1精确上下文能减少输入，本轮ACP仍发生目录续读。优先缩小领域上下文和机械执行往返；轻量快路径B相对A的增量尚待测，完整循环C相对B没有稳定速度证据。 |
| 创作与编辑质量 | Source原生编辑、共享状态、正式事务和资源保全已改善，外部Terra同样受益。这些是共享领域服务的质量收益；尚无同模型结果证明自有循环更懂布局或更善于返修。 |
| 持续工作空间上下文 | 软件已有文档/选区/版本/运行状态。原生输入、命中和布局捕获需要实时本地机制，但不要求模型循环常驻；共享MCP上下文能否达到同样任务效率应先验证。 |
| 复杂任务完成 | 成熟会话拥有可复用生命周期，但本批只是短改、取消/恢复边界测试与冷开，未证明活跃长任务故障恢复。不能从内部控制权或成熟SDK名称直接推定成功率。 |
| Skill与资产复用 | 工具发现、事务、机械装配、参考和资产身份归果铃服务；内外Harness应共享。只在完整循环独有调度确实改善最终交付时，才算C的额外收益。 |
| 维护成本 | C继续承担通用历史、压缩、循环、工具调度、恢复和模型适配；A/B也有薄接入和权限维护成本。缺少工时数据，目前合理选择是集中修领域与可靠性，保留重新投资的可能。 |

## 5. 活工作台、参考与下一步

已有软件事实包括当前空间/活动文件、真实选区、epoch/revision/dirty、可写句柄、正式操作票据和运行状态；本轮外部Harness已消费活动文档和正式目标，当前表面选区已传回，尚未证明对象级目标或选区限定路径被实际采用。Source共享状态和原生编辑同样由软件维护，不需要模型常驻记录完整UI历史。

合理下一步是按任务读轻量当前事实，必要时在原owner补最近编辑/相关运行错误的有界摘要；尚无证据需要独立记忆或事件平台。模型更长历史并不自动提高当前状态准确度。本次目录读取仍遍历200项、产生6次续读；当选区确实覆盖任务目标时，已有选区限定project.list能力可作下一次低成本上下文验证，不能把未优化的全目录读取当ACP固有限制。

可迁移经验是“正式表格维护作者输入、Runtime维护派生结果、图表订阅共享状态；原生文字作为Source内部可编辑子对象”。软件已补机制，无需让Skill教模型规避订阅竞态。咖啡和既有参考保留，按需加载，不复制整作或增加强制模板。

仍待后续的明确边界：

- 更长的创作/连续返修、活跃任务中断后跨进程重新授权与人工接力；本批不把空闲resume或单次短改算长任务全部完成。
- 原始GLX物化后真实子作者到正式采用的完整新消费者；上一轮53项聚焦证据保留，不重复称为本轮付费并行验收。
- 临界文字“95小时”宽度的原始采用输入和首个几何分歧仍缺闭合证据，不加全局余量。
- 第二题迁移与同条件最终合格对照；分别判断投资方案B相对A、C相对B的增量，不能用历史裸HTML路线冒充轻量快路径。只有会改变投入判断时补小样本，不再研究一轮通用内核选型。
- 新多Harness选择UI、首次登录/默认路由与重要兼容变化仍需具体产品讨论。

## 6. 工程保护与交接

DevSpace和RDC均已验证。子Agent远程调用长时间挂起后，改为Root统一远程I/O、子Agent在本地镜像实现/独审，文件写域明确。Root通过DevSpace集成和运行，通过RDC检查实际截图；一次连接失败后读取确认未写入，再应用补丁。

起始状态与23份关键preimage保存在 `output/long-execution-20261028/`。保留既有dirty、未跟踪项、作品与旧窗口，不commit/push/发布。前轮委派、MCP恢复、realm及其测试等未进入本次写域的15份文件与preimage逐文件保持一致；Git状态与tracked diff另存，新增源码原位保留，并通过DevSpace展示本轮变更供复核。生产构建、类型与测试按受影响边界检查，不宣称全仓全平台无回归。

| 本批实际运行的验证 | 结果与日志（相对本批output目录） |
|---|---|
| player / renderer / electron生产构建；ACP接入后electron重建 | 通过；`integrated-build.log`、`acp-electron-build.log` |
| 三套TypeScript配置最终检查 | 通过；`typecheck-final-delivery.log` |
| 共享状态、原生inline与realm聚焦测试 | 3文件6测试通过；`state-inline-green.log`；原实现反例为`shared-state-red.log` |
| ACP会话owner | 12测试通过；`acp-session-tests.log` |
| ACP权限结构 | 9项远端零模型检查通过；`acp-permission-shape.json` |
| Source真实编辑/生命周期/保存冷开 | 1条完整旅程通过，16.0秒；`source-lifecycle-coordinates.log` |
| 原市场冷启动与原生授权预检 | 通过，零模型；`market-acp-preflight.log` |
| 离线测试注入失败/通过对照 | 通过；`offline-service-worker-guard.log`及对应JSON |
| 同一Terra正式交付的UI/冷开/离线 | 12情景通过；`market-terra-verify-final.log`；失败记录另保留 |

维护下一入口为 [CURRENT_STATUS](../CURRENT_STATUS.md) 与 [NEXT_EXECUTION](../NEXT_EXECUTION.md)。本结果覆盖本批实际交付，不替代历史未验范围或将多批测试数量相加。
