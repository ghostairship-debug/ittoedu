> 原始审计/方案：已由当前实施结果承接；原意见和当时事实不表示当前未修缺口。完整辅助材料见本目录索引。

# 三路创作验证审计报告

- 作者：Claude（Claude Opus 5.5，经 Claude Code CLI 只读审查）
- 日期：2026-10-06
- 审查对象：`D:/果铃恢复候选/samples/20261006-ai-three-way/`（裸 HTML、内置 AI、公共 MCP 三路创作现场）
- 审查方式：全程只读。未调用模型，未修改任何现场文件或源码。

## 摘要

三路都没能干净完成任务。

- **裸 HTML**：1 次请求就产出能运行的 HTML，但电路图有 3 处无负载短路。
- **内置 AI**：模型正常结束（`finishReason: stop`），保存到 rev30，但 run 状态为 `partial`；rev28 离线导出成功过一次，rev30 导出因构建超时失败。
- **公共 MCP**：首轮请求体 3.98 MB，收到 HTTP 400；续轮时 Main 原生崩溃（`c000001d`）。最后提交 rev32，磁盘只保存了 rev24。

问题按层级划分：

- **软件层**（主要原因）：工具回执和工程文件视图塞进了浏览器计算样式和原文字节；观察服务会返回错页或空帧，却标记为成功。这两点把上下文撑大，诱发大量无效重试，最后拖垮宿主。
- **Skill 层**（次要原因）：缺少几条关键用法说明，模型只能靠试错摸接口。
- **模型层**（无法控制）：电路拓扑画错、重复使用失效句柄、交付时夸大自检结果。

需要修改的是前两层。

---

## 一、数据对比

| 指标 | 裸 HTML | 内置 AI | MCP 首轮 | MCP 续轮（仅本轮） |
|---|---|---|---|---|
| 起止 (UTC) | 02:01:21.169–02:06:19.160 | 02:01:07.038–02:51:57.800 | 02:01:21.154–02:14:02.242 | 02:35:37.402–02:45:53.793 |
| 耗时 | 4.98 min | 50.8 min | 12.68 min | 10.27 min |
| 模型请求 | 1 | 86（均完成） | 29 次尝试 / 28 次完成 | 16 次完成（req 29–44） |
| 工具调用 | 0 | 152（15 次报错） | 61 | 18 次尝试，#79 无回执 |
| Input tokens | 523 | 13,580,590 | 4,224,337 | 4,028,010 |
| Output tokens | 57,129 | 258,570 | 112,152 | 73,034 |
| Reasoning tokens | 41,607 | 账本无此字段 | 67,518 | 49,694 |
| Cached input | 0 | 未记录 | 3,276,544 | 两轮累计 6,994,560 |
| 平均输入/请求 | 523 | 157,914 | 150,869 | 251,751 |
| 峰值输入 | 523 | 518,153（req 80） | 821,543（req 28） | 313,015 |
| 峰值请求体 | — | 2,976,795 B | 3,978,326 B（req 29，400） | 640,159 B |
| 最终状态 | `model-finished` | `partial`，saved rev30 | `failed`（HTTP 400） | `failed`（`fetch failed`） |

数据来源：

- 内置 AI：`profiles/builtin/workbench-v2/runs/8d076adc….json` 中的 requests 和 tools 数组。
- MCP：两份 `run-result.json`。续轮为累计值，"仅本轮"一列是减去首轮后的结果。
- MCP 两轮合计 45 次尝试、44 次完成，与 `mcp/resume-1/comparison-status.json` 一致。
- 实际响应模型均为 `deepseek-v4-1-flash-260910`，请求别名为 `deepseek-flash`，参数 `reasoning_effort: max`，计费类型 `unknown`。上表数字是 usage，不是账单。

---

## 二、各组过程与终止原因

### 2.1 内置 AI

**工具调用分布（152 次）**

| 工具 | 次数 |
|---|---|
| `view.observe` | 38 |
| `project.apply` | 33 |
| `project.read` | 21 |
| `file.grep` | 9 |
| `project.list` | 8 |
| `skills.read`、`object.update` | 各 6 |
| `mcp.invoke` | 5 |
| `task.note`、`document.export` | 各 4 |
| `file.write` | 3 |
| `file.search`、`file.mkdir`、`tools.load`、`project.save`、`file.open` | 各 2 |
| `file.list`、`mcp.discover`、`context.read`、`file.read`、`file.rename` | 各 1 |

**15 次报错**

- `object.update invalid-target` × 6（#64–69）
- `document.export target-conflict` × 2（#114、#150）
- `document.export delivery-rejected` × 1（#152）
- `file.grep` ENOENT × 2（#112、#113）
- `file.search` 越权 × 1（#28）
- `file.read unrecognized_keys: offset` × 1（#137）
- `project.apply target-not-found` × 1（#33）

**过程**

- #1–13：读 6 份 Skill 文档，以及工程骨架。
- #19–36：约 17 次调用都在试探格式。模型依次尝试 `from`、整页 content、insert、iframe、script 片段。#27 的写入内容原文就是"这是对页面结构 insert 的格式试探"。
- `view.observe` 集中在 07 页和 09 页，各被观察 9 次。

**宿主状态**

- `22-passive-crash-log.json`：18 条 `Render frame was disposed before WebFrameMain could be accessed`，栈经过 `ExecutionDesktopService.eventSink` 和 `ExecutionEngine.js:493 DisplayEventBuffer.append`。
- `23-crash-exact-errors.json`：两条 `Target crashed`。
- CDP `/json/list` 共 351 个 target，其中含模型打开的 `example.com`。
- 一个 electron 进程的 WorkingSet 为 2,542,870,528 B。
- 崩溃的是 renderer，不是 Main：#146–152 仍继续执行了。

**终态**

| 调用 | 结果 |
|---|---|
| #117 `document.export` | `written`，`exportedRevision 28`，磁盘生成 5,057,081 B 的 HTML |
| #148 `file.rename` | 成功 |
| #149 `project.save` | saved rev30，`dirty: false` |
| #150 `document.export` | 用初始旧句柄 `tf73894f…`，报 `target-conflict` |
| #151 `file.open` | 拿到新句柄 |
| #152 `document.export` | `delivery-rejected`，导出构建超时 |

两个工具失败没有解决，所以 run 记为 `partial`。

**更正**：我初稿说"改名导致句柄失效"，这是错的。第一次冲突 #114 发生在 rev28，远早于 #148 改名；被拒的是 run 开始时 system 消息里固定下发的初始句柄。

### 2.2 公共 MCP

**拓扑**

- 外部 Node 进程使用 SDK 1.30.0 的 `Client` 和 `StreamableHTTPClientTransport`，连接 `http://127.0.0.1:45726/mcp`。
- 模型循环复用生产代码 `OpenAIChatProvider`，调 TeamoRouter。
- system 有两条：通用客户端提示，以及 server instructions。
- 工具回执投影为 `content.text` 加 `isError` 后回传模型（见 `prepared/api-creation.mts`）。

**首轮中断**

- req 28 请求体 2,818,083 B，成功。
- req 29 请求体 3,978,326 B，`response-29.json` 返回 `http-400`，没有 body 原因。
- tool 56/58/61 三次 `project.apply` 回执的 `appliedChanges.changes` 分别为 1,016,949、1,041,291、1,078,492 字符，三条合计约 330 万字符，见 `large-receipt-fields.json`、`request29-contribution.json`。
- 判断：最可能是超出供应商的上下文或请求体上限，但 400 没给原因，这仍是强推断。续轮把请求体缩到 640,159 B 后成功，与这个推断一致，但不能反过来证明它。

**保存**

| 尝试 | 结果 |
|---|---|
| partial-save | harness 失败（`own QA Main page absent`），未到服务端 |
| partial-save-2 | `project.save` 返回 `unknown-tool` |
| partial-save-3 | `file.open` 之后目录里仍没有 `project.save` |
| partial-save-4 | 先 `tools.load content` 才保存成功：rev24，`fileVersion 409b6656…`，171,005 B |

首轮模型 61 次调用中，一次 `project.save` 都没有。

**续轮中断**

1. tool-78 `view.observe` 返回 `observation-failed`（观察宿主准备或截图无响应）。
2. tool-79 `view.observe` 于 02:45:35 发出，没有回执。
3. 02:45:47 Main 原生异常 `c000001d`。
4. 02:45:53 客户端报 `fetch failed`，进程 exit 1。
5. `main-lifecycle.jsonl` 记录 launch child pid 52412 的退出码为 3221225501（`0xC000001D`，非法指令）。

根因未定位，现场记录为 `unresolved`。

**版本差**

- 恢复 binding 为 `revision 32 / savedRevision 24`，binding version 与 save-4 的 `fileVersion` 相同。磁盘比最后提交落后 8 个 revision。
- 恢复 journal 516,224,613 B，保存文件只有 171,005 B。
- 一处未核实：save-4 的 `documentId` 是 `9d26d393…`，恢复 binding 是 `27e1a1bf…`，路径和版本都相同。可能是续轮新 Main 重新分配了身份。

### 2.3 产物内容

- **裸 HTML 原稿**：识别图、练习 1 图、并联实验图最右边的竖线直跨两条电源母线，形成无负载短路（`bare/output/observed-summary.md` 第 7 行，`parallel9-original-whole-circuit.png`）。
- **内置 saved30**：封面串联图用一个闭合 `rect` 当导线，底边 y140 跨过电池 x200/220；并联图 `rect` 左边跨过电池，右边 x380 从 y30 贯通到 y140（`comparison/REPORT.md`，`19-preview-current-real.png`）。
- 三路源码里的四组读数都正确，例如串联 6V 为 0.20A、2V/4V，并联 9V 为 0.90/0.45/1.35A。
- 核实范围：我读了上述记录和定位链，没有自己逐线复算 SVG 坐标，也没有查看 PNG。

---

## 三、问题分层

### 3.1 软件层（需修）

| # | 优先级 | 问题 | 证据 | 影响 |
|---|---|---|---|---|
| S1 | P0 | 写入回执回传全量变更、计算样式和原文字节 | 内置 #34/#35 的 `style` 是全量计算样式（`accent-color:auto; alignment-baseline:auto…`）；#31 的 `original.bytes` 序列化成 `{"0":60,"1":33,…}`；152 条回执合计 8,820,589 字符，其中 17 条含计算样式、2 条含字节对象；MCP 单条回执超过 100 万字符 | MCP 400、上下文峰值、492 MiB journal、Token 成本的第一来源 |
| S2 | P0 | 工程文件视图读回计算样式 | #32 `project.read` 返回 `<div style="position:static;…accent-color:auto;…">`；一段普通 HTML 被拆成大量"Web 内容"实例（规律页 30 多个） | 源码不可读、局部改动困难，放大 S1 |
| S3 | P0 | `view.observe` 返回错页或空帧，却标记为成功 | 同一 revision 不同页面返回相同字节数：`540781`（封面、02、07 页）、`544531`（rev28 的 02/03/07/09 页）、`28532`（04–07 页，疑似空白）；模型在 #97 `task.note` 中自行记录"空白或回退首页" | 大量无效重试；模型宣称封面"高清确认正常"，封面实际有短路 |
| S4 | P0 | 观察和预览实例累积；原生崩溃 | 351 个 CDP target；单进程 2.37 GiB；18 条 renderer 错误；`c000001d` 发生时正在执行观察 | Main 崩溃，续轮中断；可能与导出超时有关（未证实） |
| S5 | P1 | 初始句柄被本任务自己的编辑作废，报错文案误导 | system 下发的 `tf73894f…` 在 rev28 被判冲突，报错写"请重新发起任务" | 模型重复踩坑（#114、#150） |
| S6 | P1 | `file.*` 与 `project.*` 路径混淆；工程视图内无搜索工具 | 内置 #112/#113、MCP tool-66 均报 ENOENT | 两组独立踩到同一个坑 |
| S7 | P1 | `object.update` 的 target 语义不清 | #64–69 用回执中的 UUID，6 次 `invalid-target` | 模型放弃该工具，改走整页重做 |
| S8 | P1 | 读写不一致 | #23 committed/usable 后，#24 读回 `<body></body>`；#31 报 `content-apply-unresolved` | 直接引发格式试探 |
| S9 | P1 | MCP 目录暴露问题 | `project.save` 需先 `tools.load`；`compute.run` 报 `Podman 未就绪`（tool-54）；`mcp.resource` 取不到观察图（tool-30） | 外部客户端发现不了保存工具，也看不到截图 |
| S10 | P1 | 视觉能力未配置却发送图片 | `configuration-metadata.json` 中 `vision: null`，但有 21 条消息带 image part | 模型的"目视确认"无法成立 |
| S11 | P2 | 小的不一致 | `file.read` 不接受 `offset`（#137）；iframe 被 CSP 阻止（#34）；压缩请求（req 79，输入 5,312）的下一轮回弹到 518,153 | 每项浪费若干轮 |

**测试脚本侧（非产品问题）**：MCP 外部客户端没有上下文预算和压缩。但 S1 不修，任何外部客户端都会撞上同样的上限。

### 3.2 Skill 层（需修）

模型现场读到的是迁移线版本 `64c72ff…`，采用 `project.apply / intent` 写法。主仓库工作区的 `references/project-files.md` 仍是旧写法（`project.write/edit`、`slides/…` 路径、推荐 iframe），两边需要同步，避免把旧写法合回去。

| # | 缺口 | 证据 | 建议（一两句话或一个最小示例，不加阶段门） |
|---|---|---|---|
| K1 | 没讲清互动程序怎么放 | #19–36 约 17 次试探 | 给出 insert 一段含 `<script>` 的 HTML 即成为"HTML 程序"的示例；写明 iframe 会被 CSP 阻止 |
| K2 | 没区分路径命名空间 | S6 | 写明 `pages/…` 只用 `project.*`，`file.*` 只管工作区磁盘文件 |
| K3 | 没说清对象改动走哪条路 | S7 | 写明改 `.style.json`／`.data.json` 的方法，或修好后的 `object.update` 用法 |
| K4 | 没说观察不可靠时怎么办 | 07、09 页各观察 9 次 | 画面重复或明显是错页时停止重试，以源码核对为准，交付中注明"未经真实画面确认" |
| K5 | 缺示意电路画法提示 | 裸 HTML 与内置组犯了同类短路错误 | 按"节点 → 元件 → 节点"逐段画导线，不用外框矩形或贯通母线代替；画完沿每条回路确认都经过负载 |

### 3.3 模型层（不可控，只记录）

| # | 错误 | 证据 |
|---|---|---|
| M1 | 电路拓扑画错 | 裸 HTML 原稿 3 处，内置封面 2 处 |
| M2 | 重复使用已知失效的句柄 | #117 换新句柄成功后，#150 又用回 `tf73894f…` |
| M3 | 原样重试同一个失败调用 | #64–69，约 3 秒内 6 次 |
| M4 | 跑偏探索 | #28 搜工作空间外目录；#43–47 打开 `file://`、`data:`、`localhost`、`example.com`；#137 从 5 MB 文件中间读 |
| M5 | 交付时夸大 | 宣称封面"高清确认正常"；宣称实验页"有真实预测/揭示状态" |
| M6 | 小的顺序错误 | MCP tool-18 先写文件后建目录 |

---

## 四、方向建议

1. **P0 回执与工程视图减重（S1、S2）**
   - 回执只返回 revision、commit/usability、受影响对象路径和诊断，不回传 `appliedChanges` 的值和原文字节。
   - 正式数据和文件视图只保存作者写的样式（或与默认值的差异），不保存计算样式。
   - 这是收益最大的一项。验证只需用同规模页面各跑一次 apply，比较回执字符数和 journal 增量。
2. **P0 观察服务**
   - 截图必须对应请求的 `locationId + revision`；渲染未就绪就返回明确错误，不返回缓存帧或首页。
   - 单次调用结束后释放离屏实例。
   - `c000001d` 单独开卡定位，不与功能修复混在一起。
3. **P1 接口一致性（S5–S10）**
   - 本任务自己的编辑不让本任务的句柄失效；冲突回执里附上新句柄。
   - 工程路径误用在 `file.*` 上时给出导向提示；补一个工程内搜索工具。
   - `object.update` 接受工程路径。
   - 打开文档后默认暴露 `project.save`。
   - 按连接的视觉能力决定是否发图。
4. **P1 Skill 补 K1–K5**：只加短说明，与已合入能力同步，不加门。
5. **模型层**：不做专门约束。接口简化、报错写清之后，M2–M4 的试错会自然减少；M1、M5 靠 K4、K5 和最终的真实互动验收兜底。

## 五、证据边界

- **已核实**：内置 run 账本的 152 条工具记录（参数、回执、诊断、截图字节数）、MCP 两轮回执、保存回执、生命周期日志、两版 Skill 原文。
- **推断**：
  - HTTP 400 的根因（400 没有 body 原因）；
  - "截图字节数相同即同一画面"（没有逐像素比对）；
  - 崩溃与观察及资源累积的关系；
  - journal 膨胀与 S1 同源。
- **未覆盖**：没有读产品源码定位 S3、S5、S8 的具体代码位置；没有查看 PNG 像素；没有复算 SVG 坐标。

---

## 附录：修复任务提示词

```markdown
# 任务：修复三路创作验证暴露的软件与 Skill 问题

## 边界
- 开工前读 AGENTS.md、docs/development-plan/README.md、WORKING_PROTOCOL.md、TASK_BOARD.md，以及 ARCHITECTURE_CONTRACT.md 中 Runtime/Component、Published/Player、持久化、稳定身份相关条目和直接源码。
- 先确认当前集成线 HEAD（首轮 cut 417139828b49，续轮 3b5e2e34，后续已集成 24026cc5/8ab30bc8/db5cdf1f），写入任务卡。
- 先读 24026cc5（模型消息出口投影正式回执）的 diff，说明它对 S1 覆盖了什么、没覆盖什么，不重复实现。
- 不调用真实模型，不重跑三路验证。只做最小充分验证，不加防御门、兼容层或双轨状态。
- 修改已有文件时保留原行尾（仓库 CRLF/LF 混用）。共享文件同一时间只有一个 writer。不改 AGENTS.md，发布继续暂停。

## 现场证据（只读）
根目录 D:/果铃恢复候选/samples/20261006-ai-three-way/：
内置账本 profiles/builtin/workbench-v2/runs/8d076adc….json；builtin/output/22–30、configuration-metadata.json；mcp/output/、mcp/setup/large-receipt-fields.json、request29-contribution.json、partial-save-2/3/4；mcp/resume-1/output、setup/main-lifecycle.jsonl、comparison-status.json、recovery-preserved/manifest.json。

## 软件修复（每项：方向 / 最小证据）
S1 P0 回执减重：回执只保留 path、commit、usability、before/revision、persistence、受影响对象路径、diagnostics；不回传 appliedChanges 的值和 original.bytes。正式数据只存作者样式（或与默认值的差异），不存 getComputedStyle 全量结果；确认 journal 写入粒度。
  证据：用同规模页面（MCP saved24 08 页或内置 07 页）各跑一次 apply，对比修改前后回执字符数、style 字符数、journal 增量；保存重开后渲染一致。
S2 P0 文件视图只输出作者样式；调查静态 HTML 的拆分粒度，只报告不重做。
  证据：写入后读回的 style 等于写入值。
S3 P0 观察必须对应 locationId+revision；未就绪返回 observation-not-ready，不返回缓存帧或首页；identity 如实反映截图所在页面。
  先复现：连续观察两页，比较图片哈希。证据：两页图不同且 identity 正确；新插入页立即观察要么正确、要么明确报错。
S4 P0 观察/预览/导出的离屏实例在调用后释放，任务结束时整体回收（含 mcp.invoke 打开的页面）；eventSink 发送前检查 frame 是否存活。c000001d 单独开定位卡，不承诺根因。
  证据：连续观察 20 次，target 数与工作集曲线保持平稳。
S5 P1 本任务自己的编辑不让本任务句柄失效（与唯一 writer/CAS 语义对齐，先读合同）；冲突回执附新句柄，文案改为"重新 file.open"。
  证据：两次 apply 后用初始句柄导出成功；模拟外部修改得到带新句柄的冲突回执。
S6 P1 file.* 收到工程路径时，诊断指向 project.*；补工程内搜索工具，复用文件视图投影。
  证据：两种错误路径各得到正确导向；搜索 0.20A 有命中。
S7 P1 object.update 接受工程路径或回执中出现过的实例 ID（取改动小的方案）；报错说明合法 target 的来源。
  证据：用回执中的标识成功改一次 frame 宽度。
S8 P1 复现 #23 写入后 #24 读回空页、#31 content-apply-unresolved；修根因或给出可操作的诊断。
  证据：写入后读回反映已提交内容（或附说明）。
S9 P1 打开文档后基础目录包含 project.save；不可用后端不出现在目录或标注不可用；观察图片可通过资源接口取得，或作为 image content 返回。
  证据：公共 MCP file.open 之后即可看到 project.save；图片取回一次。
S10 P1 按连接视觉能力决定是否附图；不附图时回执写明"模型未看到画面"。
  证据：fixture 断言 vision 未知时请求不含 image part。
S11 P2 统一读取参数 offset/limit；S1 修好后复核压缩后体积是否回弹。

## Skill 修复（修改集成线实际加载的 orchestrate-courseware；主仓库旧版不合回）
K1 互动程序：insert 一段含 <script> 的 HTML 即成为 HTML 程序；iframe 会被 CSP 阻止。
K2 pages/… 只用 project.*，file.* 只管磁盘文件。
K3 对象改动的路径，以软件最终实现为准。
K4 画面重复或是错页时停止重试，用源码核对，交付中注明"未经真实画面确认"。
K5 示意电路按"节点→元件→节点"逐段画，不用外框矩形或贯通母线；画完沿回路确认都经过负载。只是表达提示，不加门。

## 交付
- 任务卡拆为：S1+S2 / S3+S4（c000001d 单独） / S5+S7+S8 / S6+S9+S10+S11 / K1–K5（排在软件之后）。
- 每项说明：结果、改动文件、最小证据（命令、退出码、修改前后数值），以及仍属推断的部分。
- 自动化最多证明 engineering candidate；不新增真实模型调用。
```
