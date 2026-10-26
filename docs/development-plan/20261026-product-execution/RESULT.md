# 果铃下一阶段产品执行：接续收口与参考入口交付

更新：2026-10-26。本文汇总本批实际结果；原始失败、模型首稿和前轮日志保留。用户当前指令优先于历史方案，不据旧任务卡自动恢复已完成整批。

## 1. 本次交付结论

上一轮遗留的大 HTML 点击异常、源码集成复核、创作指标复核及状态整理已收口。随后完成批准方案 R1 的仓库参考入口，并通过新构建 Main 的真实只读 MCP 验证发现和读取链路。

- **大 HTML 点击异常属于自动化坐标换算。** 正确处理嵌套 iframe 缩放后，果铃预览和原件独立 Electron 均收到目标按钮的可信输入并完成“进入课堂→下一页”；不需要修改产品命中代码。
- **S1、P1、S2 和完整 HTML 采用的限定范围已通过独立复核。** 本轮追加能力资料 4/4、采用集成 12/12 及必要 Main 构建；未受影响的有效证据继续复用。
- **新增参考入口能够实际读取。** 原有方法指向工作区 `creative-reference/README.md`；索引链接已有冻结作品、方法、资产和真实采用经验。新 Main 中 `skills.read → file.search → file.read → 组件说明` 四步均通过。
- **创作速度目标未达成。** H/G0 原稿均未合格，G1 是返工结果。不能用首存/首导时间宣布十分钟合格，也不能据此宣布果铃相对裸 HTML 更快。
- **原生多 Agent 已实际尝试并按故障降级。** 三条子会话首次读取均挂起；后续采用 Root 统一远程 I/O、子 Agent 并行源码审查与实现，任务继续完成。Root 收口及取回报告时两次较大文本exec读取返回内部错误，后续现有工作区的小读取继续可用，无需重新初始化。

## 2. 基线、改动与保护边界

复用工作区 `ws_96838155f7`，没有重新初始化工作区。HEAD 为 `c211524bc0e56599e76820b2f9e3b940dd695987`。本轮接手时有 68 个已修改/未跟踪文件，约 3.04 MB；初始内容和 tracked diff 保存在：

- `output/product-execution-20261026/parallel-closure-20261026/baseline.json`
- 同目录 `before/`、`baseline-tracked.patch`

这些是上一轮有效未提交基线，不是本轮新写的 68 个文件。当前共享工作区按精确文件所有权集成，避免从 HEAD 新 worktree 丢掉已落地成果。最终增量见同目录 `closure-changes.json`。

最终核对：初始68个文件全部仍在，58个字节未变；本轮相对接手基线修改其中10个，并新增或修改4个原本不在dirty清单中的文件，共14个仓库文件有本轮增量。主要是参考方法/索引、其生成资料及交接状态；额外discovery/index/capability变化属于同一次Skill内容语义版本传播，没有增加工具或改生产执行逻辑。诊断脚本、截图和日志另存既有output目录。HEAD未改变，没有删除基线文件。

### 上一轮源码继续保留并完成复核

| 范围 | 主要实际修改位置 | 本轮裁决 |
|---|---|---|
| 能力、Skill、分发与检查输入 | `scripts/generate-ai-capabilities.ts`、`scripts/install-courseware-skills.ps1`、`ToolCatalog.ts`、`HtmlImportTools.ts`、`package.json`、`.github/workflows/check-contracts.yml` 及对应生成物/测试 | 同源定义与内置 Engine、ExternalMcpService、Scoped/Bundled Skill、GUI catalog 真实接线成立。检查范围未缩减。 |
| 人工—AI 共编 | `StreamingEditArguments.ts`、`DocumentToolGateway.ts`、`ExecutionEngine.ts` 及直接单元/集成/E2E | 同一目标的新读取句柄支持正确，run/document/epoch/lease/权限和精确范围仍校验；没有替换 CAS、History 或正式 writer。 |
| 完整 HTML 采用与嵌套资源 | `CreateCourseFromHtml.ts`、`ownedDocumentAuthoring.ts`、`extractHtmlResources.ts`、`frameworks/react1927.ts` 及对应测试 | 完整程序进入正式 entry；静态独立页和动态片段保留原路径；嵌套资源真实 consumer 通过。 |
| 纯绘制语义 | `src/shared/componentPaintStyle.ts`、原 Player DOM apply 及 Core/Flow/Slide/文档消费者 | 纯函数单一 shared owner；DOM/WeakMap 留端内，旧 Core→Player 反向依赖退出，计算语义未变。 |

全局 Skill 的前轮真实清理记录见 `s1-integration/global-cleanup.json`：七个未修改的受管副本已移除，managedAfter 为空。本轮复核启动引用后没有重新安装或再次清理。显式安装/卸载及签名保护仍保留。

### 本轮新增与更新

1. 新建根目录 `creative-reference/README.md`，保留现有作品、资源和组件的唯一来源。
2. 在 `.agents/skills/orchestrate-courseware/references/creation-method.md` 增加一段可选参考导航。
3. 单次运行既有能力生成器，同步该 reference、Skill manifest 和应用内 bundle；没有另建注册或分发体系。
4. 新增本批独立诊断和证据脚本：大 HTML 输入对照、真实 MCP 参考读取、创作时间归集与截图复核。
5. 更新本结果、当前状态、开发入口和任务卡；任务板由既有生成器生成。

没有新增生产 UI、第二 writer、全系统重构或格式迁移。本轮未 commit、push、打包发行或部署，未重启用户已有窗口，未调用本机模型 Agent。

## 3. 大 HTML 交互诊断

样本为 25,577,746 字节的既有 HTML。上轮 `p2/gui-v2/run-lw4DF3/evidence.json` 失败证据保留。新诊断在独立私有 profile 和真实生产 Electron 中，经实际资源管理器打开原件；文件只读。

### 同一次快照的坐标对照

| 载体 | iframe 实际缩放 | Playwright 给出的按钮中心 | 逐层换算后的中心 |
|---|---:|---|---|
| 果铃 HTML 预览 | 1004/1280 = 0.784375 | (458.42, 736.76) | (410.67, 641.10) |
| 原件独立 Electron | 1601/1280 ≈ 1.250781 | (221.42, 493.86) | (276.94, 605.11) |

单位为主页面 CSS 像素。错误符合只加 iframe 原点、遗漏 iframe 缩放的坐标计算。普通 locator 点击报拦截；按其 boundingBox 中心发送鼠标输入，产品中命中 cover-left、原件中命中段落 P。逐层换算后，两者都在正确 start 按钮记录到 `isTrusted=true` 的 pointer/mouse/click，并完成正确 Next 按钮点击与 `02 / 14` 状态。

这说明当前失败在自动化输入坐标路径。两种载体保持隐藏、未获焦点状态就成功，不需要改产品事件转发、焦点、iframe 或原网页。产品 Next 日志还保留 trial 的错误命中；通过依据是正确 Next 按钮的可信事件及实际页面结果，不是任意可信事件。

### 验证事实

- 2026-10-26 15:59:32—16:00:56（北京时间）；Electron 43.1.1 / Chromium 150.0.7871.114。
- 产品、原件两条路径均成功进入与翻页；page/console error 均为 0。
- 原件字节、SHA-256、mtime 均未变；正式 Session `dirty=false`、Undo/Redo 深度均为 0。
- 本轮自己的 Electron 进程正常退出；未操作其他窗口。
- 是 CDP 可信鼠标输入与真实 Electron 验证，不替代实体设备或人工鼠标的额外认证。

完整结果与可复现脚本位于：

- `output/product-execution-20261026/parallel-closure-20261026/html/HTML_INPUT_RESULT.md`
- `html/large-html-input-diagnostic.cjs`、`html/inspect-html-input.cjs`
- `html/run-FfNYpF/evidence.json`，以及 product/raw 中逐步坐标、输入事件和截图。

### 性能结论的范围

复用上轮同样本 before/after/after/before 记录：

| 测量 | before 均值 | after 均值 | 变化 |
|---|---:|---:|---:|
| 资源分析脚本 | 5814.69 ms | 4817.60 ms | 减少 17.15% |
| DocumentHost 打开链 | 4750.83 ms | 4094.37 ms | 减少 13.82% |

来源为 `worktrees/p2/output/product-execution-20261026/p2/comparison/summary.json` 与 `host-summary.json`。相关分析事实一致、原件只读。以上不是 GUI 总首开到可操作时刻；本轮约 85 秒的完整诊断包含故意复现失败、截图、多种输入和两个载体，也不能作为首开成绩。没有新增同条件 GUI before/after 比较，不宣称秒开或普遍流畅。

## 4. 办公、正式采用与原功能保留

P1 的独立复核确认流式与 final-only 参数沿同一 `editArguments` 判断，宿主只接受同一精确目标的有效读取句柄；停止、过期 epoch、换 run、撤权后重附加、只读及范围扩大仍拒绝。之前的 47/47 定向检查、真实 Windows Electron 人→AI→人、Undo/Redo、保存、新 profile 冷开及离线消费者证据继续有效，详见 [P1_RESULT.md](P1_RESULT.md)。

P1 E2E 使用确定性本地 provider。其运行耗时是软件验证耗时，不是实际模型创作速度。

HTML 采用分流的实际边界：

| 输入 | 行为 |
|---|---|
| 含可执行脚本/事件处理的完整文档 | `entry.html/program.set`，保持完整 DOM、响应式 viewport 与共享程序 |
| 可独立分页的静态内容 | 保留 `splitHtmlSections` 和既有 Surface 页面路径 |
| 动态 HTML 片段 | 保留单 Slide 内的内容，不提升为作品 entry |

来源经当前 Session 读取，包含已打开但未保存的正文和递归依赖；写入目标仅为本次创建的新工程。固定子调用身份、回执查询、最终正式事务仍在。导入 ACK 丢失不重复导入；未知结果不重放；保存拒绝只报告 imported/saved:false。两份直接集成测试本轮 12/12 通过，包含静态分页、动态片段、递归资源、嵌套 iframe/srcdoc 的真实 consumer、保存冷开及一个 History。

临时测量窗口在这些集成用例中有明确 mock，因此其通过证明流程和归档保留；视觉与响应式继续由 G1 的真实载体证据证明。

## 5. 创作原始结果、返工与计时

原始 H、G0 文件和日志未覆盖。计时统一以各路线 `send-attempted.json.at` 为起点，操作完成以真实 receiptTime 为准；不拿轮询终态快照当精确结束，也不以累计工具时间反推纯思考。

| 事实 | H：直接 HTML | G0：原始 GLX 路线 |
|---|---:|---:|
| 任务发送，北京时间 | 13:18:35.021 | 13:27:19.109 |
| 首次有内容保存 | 44.086 秒 | 56.239 秒（正式 GLX） |
| 首个离线文件可用 | 44.086 秒，直接 HTML 无独立导出步骤 | 60.853 秒（正式离线导出） |
| run 完成 | 396.292 秒 | 90.386 秒 |
| 首次合格原稿 | 未形成 | 未形成 |
| 十分钟合格 | 未通过 | 未通过 |

H 有路线图与声明站序不一致、时间显示及手机站名可读性问题。G0 原采用路径把手机内容缩小并阻断控件，源内容还存在时间显示和站名可读性问题；修复采用路径后，同源 G0 的控件恢复，但源内容问题继续存在。显示精度问题与真实准时分类分开判断，不把所有字符串差异都笼统说成计算错误。

另查到 H 在 13:23:27 收到一次阶段澄清：提醒后续局部修改不属于首次交付，不提供设计/内容纠错。该事实单独保留；原 terminal 中笼统的“No followups”不能覆盖这条记录。等待时间保留，不能凭两条 run 的耗时宣称架构提速。

### G1 返工后的结果

- G1 修正时间显示与边界比较、地图箭头/分段关系和手机可读性；软件采用路径改为正式程序入口。
- 最早保留的 G1 正式离线产物完成于 **13:48:49.487**，距 G0 发送 **21 分 30.378 秒**。这是包括等待、诊断、软件集成与返工的墙钟间隔，主动返工时长没有连续记录，保持未知。
- 13:49:50.617 正式产物 130 项检查通过。局部修改只改变请求内容、r1→r2；修改后另存/导出成功。13:58:28.825 独立冷开源码一致、磁盘不变，13:59:01.305 冷开后离线产物另一次 130 项通过。
- 本轮 Root 复核既有桌面/390px 开篇、地图、结果和结尾截图：布局和层级一致，路线箭头与文字关系清楚，手机内容未被缩成幻灯片。独立画面确认时间记录在 timing 文件中；不伪造 Owner 艺术签收或实体手机认证。
- 此 G1 是辅助返工候选，不是新的冷启动 Gc 实验，不冒充 Luna 首次成功。其正式文件为 `diagnostic/workspace/city-night-final.glx` 和 `city-night-final-cold-offline.html`。

完整时间、原始文件摘要、澄清、返工及局改/冷开证据见 `parallel-closure-20261026/creation-timing.json`。复现归集脚本为 `collect-creation-timing.cjs`，没有重新调用模型。

**判断：** 正式采用与后续编辑能力成立；原稿合格率和十分钟目标仍未达成。H 缺少合格基线，相对速度结论不成立。首导只有约一分钟，当前更有价值的问题是首次交付的内容/图形/手机使用质量，而非继续增加装配或调度机制。

## 6. 下一批已实施：R1 最小参考入口

根目录 [creative-reference/README.md](../../../creative-reference/README.md) 已建立，按问题指向：

- 可执行的连续阶段背景与它的参数、生命周期、失败边界；
- 原生内容/Runtime 的职责和视觉方法；
- 咖啡 r264 冻结案例；
- 既有资产短索引；
- 本次城市夜线的正反结果。

没有复制整份咖啡、素材或组件，没有新资产 ID、目录注册、检索服务或服务器。方法中新增的段落只提示按需读取已授权工作区的参考；目录不存在或不适用时继续既有创作，参考不随应用自动提供，也不是必读或强制模板。

本轮单次生成当前能力资料后，4/4 能力测试通过，更新必要 Main 构建。随后以新私有 profile、根仓库工作区、read-only 权限启动真实 MCP：

1. `skills.read` 读到了新 reference 导航；
2. `file.search` 找到了仓库索引；
3. `file.read` 读到索引内容；
4. `file.read` 沿索引读到已有背景组件说明。

四步均通过，自己的 MCP 宿主正常停止。证据为 `parallel-closure-20261026/reference/result.json` 与 call-1—4.json。旧组件的正式检索、跨工程采用、修改及离线实播沿源说明复用；本轮没有伪报一次新的异题材作品采用。

## 7. 本轮验证与独立审查

| 证据 | 结果 | 适用范围 |
|---|---|---|
| `validation/closure-capabilities.json` | 4/4，通过 | 生成物、Skill bundle、Scoped 目录/读取、发现资料一致 |
| `validation/closure-html-adoption.json` | 12/12，通过 | 两份直接集成：采用分流、当前稿、恢复、History、保存/冷开、嵌套资源 |
| `validation/closure-build-electron.json` | 通过，约 10.31 秒 | 既有源构建流程更新 sources/electron，新的 Skill 内容进入 Main |
| `validation/closure-reference-mcp.json` | 四次真实读取通过，正常停止 | 新构建实际消费者的参考发现链 |
| `parallel-closure-20261026/html/run-FfNYpF/evidence.json` | 两载体可信进入/翻页通过 | 大 HTML 点击遗留项 |
| 前轮 P1、三套类型、完整构建、边界检查 | 复用有效通过证据 | 本轮未改其生产逻辑；不把历史 main 第一次失败藏掉，以 final 通过结果为准 |
| 前轮 G1 正式与冷开离线检查、本轮审图 | 130/130 + 130/130，画面复核完成 | 指定作品和指定桌面/手机视口 |

A 独立复核 S1 的真实消费者、检查输入与安装保护；B 独立复核 P1、S2 及正式采用；C 开发诊断并分析 Root 实际运行的输入证据；Root 审查候选、执行真实载体、集成并判断验收。重要原候选的未变评审不重复扩大。

收口的默认 `git diff --check` 将前轮及现有 Windows CRLF 记为行尾空白，返回2；没有因此清洗已有源码或技能。本轮导航README因补丁工具将混合换行扩为整篇CRLF，已恢复为LF，避免无关整篇差异。最终空白检查仅对本次命令识别CRLF行尾，不修改仓库配置，返回0；新增两份入口/结果文件的8条Markdown链接均存在。结果与本轮增量归集在 `closure-changes.json`。

## 8. 多智能体并发与连接故障

本会话可同时运行 4 个原生 Agent，实际为 Root + A/B/C；没有把建议的 10 误报成实际并发数。

| 工作线 | 首次直接 DevSpace 调用 | 实际结果 | 降级后的完成内容 |
|---|---|---|---|
| A：能力/Skill | read AGENTS.md，ws_96838155f7，limit=400 | 无输出约395.8秒，中止；无cell/session、无远程写入 | S1独审；R1方法导航的小补丁 |
| B：办公共编 | 同工作区 read AGENTS.md，limit=400 | 无输出约421.2秒，中止；无cell/session、无远程写入 | P1、S2及采用保留行为独审 |
| C：HTML交互 | 同工作区 read AGENTS.md，limit=500 | 无输出约414.6秒，中止；无cell/session、无远程写入 | 诊断脚本、坐标对照和运行结果分析 |
| Root：集成/交付 | 同工作区 read、exec、apply | 开发及验证正常；收口读取多份文档、之后整体取回报告的exec共两次返回-32603 Internal error。两次之后同工作区小read均成功，第一次之后08:13:53Z轻量exec成功；写入/生成/差异检查正常，未重新初始化 | 同步源码、远程运行/写入、创作复核、R1及状态交付；报告改分段取回 |

三条子调用均在首次只读阶段挂起，没有代码竞争或工作区创建失败。当时证据支持“子会话工具调用路径异常、主路径正常”；稍后Root两次内部错误都发生在较大文本exec读取，而小读取/写入仍可用。这只是调用形态相关的现象，尚不足以认定输出大小为根因，也不能判定与子会话挂起同因。没有证据证明本地网络、设备离线、连接器全局失效或并发本身是根因。子调用各只尝试一次，Root按现有工作区有限恢复，没有无限重试或新建工作区。恢复检查时一次read误传offset=0被参数校验拒绝；改为合法的1后立即成功，该次不是远程连接故障。

降级后，子 Agent 在共享临时镜像中并行阅读/实现/审查；远程写、生成物和构建由 Root 顺序集成。共用文件没有冲突，未做 merge/reset/clean，也没有新建工作区。实际收益是审查、脚本实现和主线证据工作能够重叠；没有同任务串行对照，不给出倍数或节省工时。最明显的额外成本是约6.6—7分钟的子调用等待及源码同步，不应包装成无故障并发成功。

## 9. 完成与剩余范围

| 状态 | 范围 |
|---|---|
| 已完成 | 上轮四项接续收口；S1/P1/S2限定能力；HTML采用和资源的本轮必要回归；R1索引、方法接线、真实MCP读取 |
| 已完成且停止扩验 | 大HTML命中诊断；已证共编；纯绘制规则；生成与分发正确性。没有依据继续改这些生产代码。 |
| 未达目标 | Luna首次合格作品的十分钟目标；与合格H的公平相对速度；参考跨不同题材整作的质量收益 |
| 尚无证据 | GUI总首开到可操作的同条件改善幅度、实体手机/全部作品/全仓无回归保证 |
| 沿既有边界保留 | 发布暂停；用户已有修改、旧创作原件、其他任务/进程未清理 |

下一项最值得推进的是提高**首个合格交付**：以未调参的新题材，针对内容结果、图形关系和手机主路径做有实际价值的作品检查，记录返工并兑现后续编辑。先使用已经接通的参考和现有软件能力；如果同类遗漏持续出现，再沿真实责任缺口选择最小改进。不先增加通用编排、组件平台或全系统重构，也不重复本批已经通过的基础验证。

本批活动写入结束，任务卡仅以 queued 保留上述尚未达成的创作目标，不再占用写锁或把旧修复派为 active。任务板通过既有生成器更新。

