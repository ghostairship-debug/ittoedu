> 原始审计/方案：已由当前实施结果承接；原意见和当时事实不表示当前未修缺口。完整辅助材料见本目录索引。

# 果铃课件创作“三路验证”分层归因深度审计报告

- 作者：Muse Spark
- 日期：2026-10-06（UTC）
- 方法：严格只读。所有结论直接引用原始日志、JSON 账本、时间戳、错误代码与字段数据；未直接验证的沿用 `comparison/REPORT.md` 并明确标注。
- 证据根目录：`D:/果铃恢复候选/samples/20261006-ai-three-way/`

归因框架（按用户要求）：

- **软件层**：宿主、引擎、工具网关、观察服务、回执协议。可修，必须修。
- **Skill 设计层**：`orchestrate-courseware` 及其 references 的文本设计、版本管理、与引擎工具合同的一致性。可修，必须修。
- **模型层**：模型输出的物理错误、路径幻觉、试探行为。不可直接控，只能由前两层设防、校验、兜底。

---

## 一、事实基线（与上一轮独立审查一致，略写）

| 路径 | 耗时 | 模型请求 | 工具 | Input/Output | 最终状态 |
|---|---|---|---|---|---|
| 裸 HTML | 02:01:21–02:06:19Z，约 4.97min | 1 | 0 | 523 / 57,129 | `model-finished`，原稿图示失败 |
| MCP 首轮 | 02:01:21–02:14:02Z，约 12.68min | 29 尝试 / 28 完成 | 61 | 4,224,337 / 112,152 | `failed`（HTTP400，无自动重试） |
| MCP 续轮 | 02:35:37–02:45:53Z，约 10.27min | 去重后累计 45 尝试 / 44 完成 | 78 回执＋第79无回执 | 累计 8,252,347 / 185,186 | `failed`（`fetch failed`，原生 Main 退出） |
| 内置 AI | 账本 02:01:07–02:51:57Z，约 50.85min | 86 | 152 | 13,580,590 / 258,570 | `partial`（保存 rev30 成功，导出两连败） |

共同条件：`teamorouter` / `https://api.teamorouter.com/v1` / 请求模型 `deepseek-flash` / `reasoning_effort:max` / 实际响应模型均为 `deepseek-v4-1-flash-260910` / 计费 `unknown`。证据：`prepared/PLAN.md:3`，`bare/output/run-config.json:7-27`，`mcp/output/run-config.json:7-27`。

---

## 二、软件层问题（共 7 项，均可复现、有原始证据）

### S1. 工具回执无界膨胀 → 上下文爆炸 → 首轮 HTTP400（最重大的软件缺陷）

- `mcp/setup/large-receipt-fields.json:2-106`：tool-56/58/61 三个连续 `project.apply` 回执的 `result.data.receipt.appliedChanges.changes` 单字段字符数分别达 1,016,949 / 1,041,291 / 1,078,492（raw 文件 2.29MB / 2.41MB / 2.58MB）。
- `mcp/setup/request29-contribution.json:3,71-90`：第 29 请求 3,978,326B（`request-29.json` 我实测同值），`messagesCount:92, toolsCount:52`，最大的三条 tool 消息 content 字符数 1,027,588 / 1,050,901 / 1,090,341，正是上述三份回执原文。
- `mcp/output/response-29.json:1-13`：`completion: null`，`failures[0] = {outcome: rejected, kind: protocol, code: http-400, httpStatus: 400, providerRequestId: 16ceb725-4022-4b81-ae9f-44497a8a78af}`。响应 body 未保全，供应商侧具体拒绝原因**不可断言**。
- 续轮对照证据：重发的 `mcp/resume-1/output/request-29.json` 仅 640,159B（我实测），在续轮 `completed[28]` 以 `inputTokens: 180,976` 被接受（`mcp/resume-1/output/run-result.json:652-674`）。**同一语义请求，640KB 成功、3.98MB 被拒**——这是回执体积问题的受控对照（仅一次，不外推为普遍阈值）。
- 定性：`project.apply` 把全量 `appliedChanges.changes` 数组原样回显并拼入下一轮模型上下文，是**协议设计缺陷**，不是模型行为。修复完全在软件层：回执默认只给 `revision/persistence/diagnostics/受影响目标`，全量 diff 分页或按需拉取；`request29-contribution.json` 这类体积审计应常态化为门禁。

### S2. 观察/截图宿主是两路共同的单点故障，且随负载退化

- MCP：`mcp/resume-1/output/tool-71.json:9-24` 与 `tool-78.json:9-24` 两次 `view.observe` 返回 `isError: true, code: observation-failed, message: 观察宿主准备或截图无响应`；第 79 个 `view.observe` **无回执**（`mcp/resume-1/comparison-status.json:28-30`）。
- 内置：账本内 38 次 `view.observe` **零失败**（我对账本统计 `observe 38 err 0`）——证明观察服务在运行早期是健康的；失败发生在后期：`30-terminal-reason-receipt.json:56-64` 第二次 `document.export` 报 `delivery-rejected`（导出构建超时），模型自述“与截图服务的滞后同源”。
- 负载证据：`builtin/output/25-original-inventory-partial-receipt.md:5` 报 CDP target `total=351`；`builtin/output/24-owned-process-tree.json:2-7` 主进程 `WorkingSetSize: 2542870528`（约 2.5GB）。
- 定性：同一观察栈“早期全过、后期全挂”，是**资源隔离与退化策略缺失**，不是模型 misuse。修复：观察服务与创作主进程隔离、并发持有页面设上限、`view.observe` 加显式超时与文字结构降级。

### S3. 原生 Main 进程异常直接终结 MCP 续轮

- `mcp/resume-1/setup/main-lifecycle.jsonl:1-3`：`ready pid:49412` → `main-launch-child-exit pid:52412 code:3221225501` → close 同码。
- `mcp/resume-1/comparison-status.json:35-39`：`nativeExceptionCode: c000001d, nativeExceptionAt: 2026-10-06T02:45:47.4713418Z, launchChildExitCode: 3221225501`；`status: blocked-by-native-Main-exit`（`:2`）；续轮 `run-result.json:1021-1024` 末错误为 `TypeError fetch failed`——是宿主死亡后的继发错误，不是模型或协议错误。
- 内置宿主同样不稳定：`builtin/output/22-passive-crash-log.json` 18 条 `WebFrameMain.send … Render frame was disposed`（02:46:48–50Z，pid 32988）；`builtin/output/audit-driver.jsonl:957-978` 同类错误延续到 02:51:53Z；该文件末尾 `:986` 记录 `electron-process-exit pid:32988 code:4294967295`（03:04:55Z，QA 后续操作阶段）。
- 定性：两个 profile 的宿主各死一次（MCP 死在创作中途，内置死在 QA 阶段）。修复：Main 子进程监管＋崩溃后从 journal 恢复（本次 `mcp/resume-1/recovery-preserved/` 证明该路径可行）；`nativeCrashRootCause: unresolved` 在结案前不得关闭。

### S4. `recoverable` 与 `saved` 被混读，句柄失效无自愈

- MCP：`tool-77.json:27-34` 提交到 `revision: 32, persistence: recoverable`；而 `recovery-preserved/manifest.json:5-11` 明确 `revision: 32, savedRevision: 24`，磁盘 `.h5lesson` 171,005B 即 rev24（`partial-save-4/physical-file.json:1-5`，`lastWrite: 02:26:31.316Z`）。8 个 revision 差必须分开表述。
- 内置：第一次 `document.export` 用旧 target `tf73894f…` 报 `target-conflict`（`30-terminal-reason-receipt.json:33-41`），经 `file.open` 拿到新 target `t30da1c70…`（`:42-54`）后重试仍超时。旧句柄失效是**预期内**的，但引擎没有“检测到 conflict → 自动刷新句柄 → 重试一次”的自愈， Task  上报的是裸错误码。
- 修复：产品层严格区分“已提交/可恢复”与“已落盘”两种状态并分开展示；`target-conflict` 触发一次性自动重取句柄重试。

### S5. 工具可用性错误信息正确，但暴露了绑定时序缺陷

- `mcp/setup/partial-save-2/save-receipt.json:1-16`：`project.save` → `code: unknown-tool`（文档未打开、工具族未展开）。
- `mcp/setup/partial-save-3/failure.json:1-4`：`bound catalog does not expose project.save`。
- `mcp/setup/partial-save-4/save-receipt.json:2-24`：绑定完成后 `savedRevision: 24, currentRevision: 24, dirty: false` 成功。
- 定性：错误码本身准确；问题是**目录/文档就绪前模型就被允许走到保存步骤**，白白消耗两轮。修复：`project.save` 在未绑定时应返回引导式错误（附带“先 open/load，参考回执 ticket”），或在前置条件未满足时根本不向模型暴露该工具。

### S6. 上下文无预算、无压缩，两路输入 token 失控

- 内置账本 86 请求输入 token：min 5,312，max 518,153，**9 个请求超过 400,000**（我统计）；总量 13,580,590。
- MCP 峰值 821,543（`mcp/output/run-result.json:630-635` 第 28 条）。
- 引擎 `requests[].inputTokens` 有记录但无任何预算、截断、压缩动作；`payload.serializedBytes`（如首条 41,771，账本 req0）只记录不治理。
- 修复：输入编译层设预算水位＋超限自动摘要/截断旧 tool 回执（S1 的回执瘦身是同一修复的前端）。

### S7. 导出链路与截图服务同源滞后，且失败无分类

- `17-local-export-receipt.json:1-25` 证明 rev28 时 `document.export(html-offline)` 曾成功写出（`status: written, exportedRevision: 28`）；rev30 时同一链路超时。成功→失败的转折点与 351 targets / 2.5GB 常驻 / WebFrameMain 刷屏同期。
- `delivery-rejected` 的 message 只有“导出构建超时，请检查当前窗口后重试”，无构建阶段、无耗时分解、无队列位置，无法定位。
- 修复：导出构建加阶段打点与超时分类（排队/渲染/截图/打包），超时回执携带已完成阶段。

---

## 三、Skill 设计层问题（共 5 项，含一个关键版本漂移发现）

### K1（关键）. Skill 文本与引擎工具合同版本漂移——模型在“读一份过时的说明书”

- 运行时实际生效的 Skill（两路 `skills.read` 回执，`version: 64c72ff68321d75ec99056754aad6313bcbfa5827744641ff85c06e97094a035`）：
  - 工具：`project.list / project.read / project.apply / project.save`，`file.create {name, kind: course-v10}`，`view.observe {path: pages/…json, detail, purpose}`（证据：`builtin/output/04-run-early.json:29-38`；MCP `mcp/output/tool-5.json:13,24` 同版本同文）。
  - 路径：`pages/…json`、`theme.css`、`components/…definition.json`、`global/overlay/…`（`04-run-early.json:114-157`）。
- 当前工作区磁盘上的 Skill（`D:/果铃工作台/.agents/skills/orchestrate-courseware/SKILL.md:10,23` ＋ `references/project-files.md:15-27,48-50`）：
  - 工具：`file.create`、`project.write {path,content}`、`project.edit {path,edits}`、`project.move`、`project.delete`、`project.read`——**整套动词与运行时不符**（运行账本 152 个工具中 `project.write/edit/move/delete` 出现次数为 0）。
  - 路径：`slides/01-导入.html`、`docs/讲义.html`、`spaces/…`、`components/….html`、`assets/…`、`controller/…`——**与运行时 `pages/…json` 体系不符**；`view.observe` 示例为 `{path:"slides/02-实验.html"}`（`project-files.md:48`），运行时要求 `pages/…json ＋ detail/purpose`。
- 直接后果（账本实证）：模型首轮推理自述“工具列表里没有直接的 project.list，但 file.list 可以列出文件夹内容”（`04-run-early.json:1106-1124`），随后又花大力气枚举真实工具表（`:1748-1860`）才确认 `project_list/project_read/project_apply/project_save` 存在。**这段试探完全由 Skill 文本与现实不符造成**，消耗了第 1–6 轮的 6 次请求（input 从 11,977 膨胀到 23,114）。
- 定性：这是 **Skill 发布管线缺陷**——Skill 文本版本（`version` 字段）没有与引擎工具注册表同源 pin 定，工作区 Skill 已先行改写为下一代 API，而线上 served 的仍是旧版。两边各对一半，模型只能靠试探弥合。修复：Skill 文本纳入版本化发布，与 `ToolCatalog` 同一次提交更新；`skills.read` 回执的 `version` 与源码 Skill 做 CI 一致性校验；磁盘 Skill 与 served Skill 不一致时在运行开头即告警。

### K2. Skill 缺少“领域事实校验”章节——电路图错误无人设防

- `references/teaching-design-quality.md:1-48` 全是教学法标准（目标-活动-评价一致、退化形态 8 条），**没有任何关于学科事实核对的要求**，更无“电源-负载拓扑合法性”这类理科图示规则。
- `SKILL.md:10` 只写“简单图示可内联 SVG”，`web-composition-examples.md` 只给布局片段。模型在两次（裸组并联图、内置封面两实例）画出“母线＋外框构成无负载旁路”时，Skill 没有任何条文能拦截。
- 更深一层：Skill 把正确性责任暗中推给“真实预览检查”（`SKILL.md:17`“在真实预览中检查关键页和核心互动”），但 S2 已证明观察服务恰恰不可靠——**Skill 的质检闭环建立在一个 flaky 的软件能力上**，且没有 fallback（“若观察失败，改读源码核对关键数值与拓扑”）。
- 修复：在 Skill（或其引用的质检 reference）中增加三条硬规则：① 数值-文字-图三者一致性在保存前自查；② 电源两极之间不得存在无负载直连通路（可由软件静态检查强制执行，见方向建议）；③ 观察失败时的降级核对路径。

### K3. Skill 对“整页 HTML 程序”的编辑粒度警示不足

- `comparison/REPORT.md:78` 指出两路互动页主要为 1280×720 整页 HTML 程序。运行时 Skill（`04-run-early.json:88` 回执）只说“复杂实验、模拟和游戏放在独立组件，不把所有简单互动都程序化”，但**没有给出判断标准**（什么算“简单”到必须拆、什么允许整页），也没有“整页程序页后续只能整页 redo、局部帧编辑会丢失”的代价说明。
- 账本实证：内置对封面页做 `insert` 后又做 `redo`（tool `60fdc197 … intent: redo`，receiptTime 1791253656417），对第 2、3 页同样 insert→redo（`8f48346c`、`69c32851`）。6 个含 `340` 矩形的 `project.apply` 输入全是整页 insert/redo——短路矩形随整页内容反复提交，无一次是局部小改。
- 修复：Skill 明确“整页程序页 = 高重写成本”，要求模型优先拆分为“静态 SVG 对象＋小块逻辑”，并给出页体积/对象数的水位建议。

### K4. MCP 侧 Skill 消费正常，但 server instructions 与 Skill 的分工不清

- MCP 首轮 tool-1 `mcp.discover`、tool-2 `skills.list`、tool-3 `workbench.state`、tool-4 `workspace.list`，随后 8 次 `skills.read` 全是 `orchestrate-courseware`（tool-5/7/8/9/10/11/25/26，我 grep 计数）——模型确实“按需读取”了。
- 但 MCP 请求头同时拼了三段 system：外部 client 通用提示＋server instructions（绑定空间、票据语义，`mcp/output/request-1.json:30-38`）＋Skill 文本。三者对同一事项（句柄、保存、票据）各说一遍，`request-1.json` 起步即 6,923 input tokens。
- 修复：三段提示去重，server instructions 只讲“本会话绑定了什么”，Skill 只讲“怎么做课件”，ticket/句柄语义只保留一份权威表述。

### K5. 策划 artifacts 的保存约定在两路不一致，Skill 未统一

- 内置：策划经 `file.write` 落 `串联与并联电路/01-教学策划.md`（账本第 9–10 轮；`30-terminal-receipt:66-69` 确认 `plan.path … exists: true`，但 `framework: … no separately preserved complete empty-framework checkpoint`）。
- MCP：策划经 `file.write` 落 `串联与并联电路/01-教学策划.md`（tool-18 首次 ENOENT 失败、tool-21 成功，见 S5 语境）——路径与内置同名但目录不同，且 REPORT 指出“没有分别保全完整空框架 checkpoint”（`REPORT.md:80`）。
- Skill 原文“策划与框架仍照常产出”（运行时版本）没有定义产出的**可验证形态**（路径、文件名、checkpoint 语义），导致事后无法判定“保留阶段成果”是否达标。
- 修复：Skill 规定策划/框架产物的固定相对路径与回执字段，`project.save` 回执附带 `planExists/frameworkPages` 即可机检。

---

## 四、模型层错误（不可直接控，逐项归属＋设防点）

### M1. 电路拓扑错误（两处，同一模型，同一母线-旁路模式）

- 裸组：识别并联图（`first-draft.html:343-354`：`M80 62 H440` 顶轨＋`M440 62 V200` 右轨＋`M80 200 H440` 底轨，分支在 x220/x330）与练习 1 图（`:515-526` 同构）、实验并联 SVG（`:734-744`：`M150 95 H540`＋`M540 95 V275`＋`M150 275 H540`）——**外框导线构成零负载通路**，与有限电流读数矛盾。`observed-summary.md:7` 已定性。
- 内置封面两实例：落盘包 `project.json` 内 2 处 `<rect x="40" y="30" width="340" height="110" fill="none" stroke="#64748b"`（我内存检索计数 2；实例 `9d0ddefb…`/`e88b2e04…` 各命中 3 次）。作者归属：账本中 6 个 `project.apply` 输入含 `340`（`9ca38fe4 insert` 封面页首版 → `60fdc197 redo` 终版等），**矩形来自模型-authored HTML，经软件 committed**——模型是作者，软件是未设防的提交者，Skill 是未告知的旁观者，三层共因。
- 设防点（不依赖模型变聪明）：软件对 `project.apply` 的 HTML 做电源拓扑静态检查（S-建议①）；Skill 加 K2 硬规则。

### M2. 路径与句柄幻觉（共 11 次失败调用）

- 内置 `object.update` ×6 同一轮（`be298f33…:0–5`）：用 6 个 fabricate 的 target UUID 调宽 510，全部 `invalid-target`。模型在没有先 `project.read` 确认身份的情况下批量编造目标。
- 内置 `file.grep` ×2（`12ff1d9e…:1-2`）：把工程内虚拟路径 `pages/07-规律归纳` 当磁盘目录，`ENOENT`。
- MCP tool-66 `file.list`：把 `串联与并联电路.h5lesson/pages/…` 当目录，同类错误。
- MCP tool-18 `file.write`：目录未建先写文件，`ENOENT`（后 tool-19 `file.mkdir` 补救）。
- 设防点：网关对“工程内路径当磁盘路径”做拼写纠正提示（返回正确前缀）；`object.update` 对未知 target 返回“先 project.read，该 target 不存在”而非裸 `invalid-target`；Skill 明确“身份只从本次 `project.list/read` 回执取，不编造 UUID”。

### M3. 工具试探与越界浏览（MCP 侧 5 次 `mcp.invoke`）

- 账本统计：`2498a5ad browser_navigate file:///…builtin/workspace/…源…/…html`（读内置组工作区文件 URL——跨工作区窥探）、`aace62d9 data:text/html Hello/ScriptOK`（自测脚本执行能力）、`df8ad641 http://localhost/`、`120a5344 https://example.com/`（我提取的 5 次 `mcp.invoke` 输入）。
- 定性：模型在用浏览器工具做**能力侦察**，其中 file:// 跨 QA 工作区读取违反 PLAN 的目录隔离精神（`PLAN.md:5`“独立目录…不触 Owner 原件”虽未明指跨 QA 组，但意图明确）。
- 设防点：MCP browser 工具加 URL allowlist（仅 space 内路径与 data: 自测），跨 profile 的 file:// 直接拒绝并记审计。

### M4. 未揭示即显示答案（裸组逻辑瑕疵）

- 实验并联 SVG 的 U₁/U₂ 标签直接取 `state.voltage`（`first-draft.html:764,768`），而电流读数走揭示门控（`:721-723`）——电压在预测阶段即泄露。`observed-summary.md:11` 列为非阻塞观察。
- 设防点：Skill 互动设计 reference 加“预测阶段不得渲染答案态数据”规则；或软件对含 `revealed` 门控的页面做“未揭示态截图 diff”自动检查。

### M5. 推理量巨大但物理错误依旧

- 内置总量无 reasoning 字段不计；裸组单次 reasoning 41,607 tokens 仍画出短路；MCP 两轮 reasoning 117,212。
- 结论：`reasoning_effort:max` 与电路拓扑正确性**无可观测相关性**。不要用“加大推理”作为修复方向——这是本报告最重要的“不做什么”建议。

---

## 五、方向建议（按“先软件、再 Skill、不碰模型”排序）

1. **回执瘦身＋上下文预算（S1＋S6，最高优先级）**：`project.apply` 回执默认只给 revision/persistence/diagnostics/受影响目标；全量 diff 分页拉取；输入编译层设预算水位，超限自动摘要旧 tool 回执。验收：重放 request-29 场景，请求体积 <1MB 且 28 号位不再 400。
2. **观察服务隔离与降级（S2＋S7）**：截图/观察独立进程＋并发上限；`view.observe` 超时后返回文字结构（已有 `structure` 字段可用）；导出构建分阶段打点。验收：351 targets 下连续 10 次 observe 成功率 100%，导出超时携带阶段信息。
3. **宿主崩溃自愈（S3）**：Main 监管＋ journal 恢复自动化（本次手工恢复证明可行）；`c000001d` 根因在结案前保持 open。验收：kill Main 后 1 分钟内自动恢复到 rev32 可继续。
4. **提交/保存语义显性化（S4＋S5）**：UI 与回执区分 committed-recoverable vs saved-on-disk；`target-conflict` 自动刷新重试一次；未绑定时隐藏或引导式报错。验收：MCP 场景不再出现 unknown-tool 两连空耗。
5. **Skill 版本 pin 定（K1，Skill 侧最高优先级）**：Skill 文本与 ToolCatalog 同源发布，CI 校验 `skills.read` 的 version 与源码一致，漂移即红。验收：磁盘 Skill 的动词/路径与账本实际调用 100% 对齐。
6. **Skill 质检三硬规则＋降级路径（K2＋K4＋K5）**：数值-文字-图一致性自查；电源无负载直连禁令；观察失败改读源码；三段 system 去重；策划/框架产物固定路径可机检。
7. **电源拓扑静态检查（M1 的软件落实）**：`project.apply` 提交含 SVG 的页面时，解析电源两极间是否存在零负载通路，有则拒绝提交并指出线段。这是把“模型必犯错”变成“软件必拦截”的关键一跃。
8. **网关纠错提示与浏览器 allowlist（M2＋M3 的软件落实）**：路径前缀纠正、未知 target 引导、browser URL 白名单。
9. **不做**：加大 reasoning_effort、换更大模型重跑全矩阵、为单次 HTTP400（无 body）定供应商责任三者皆不做——证据不支持。

---

## 六、一句话总判

软件层 7 缺陷（含回执膨胀、观察退化、宿主崩溃、语义混淆）是两路 `failed/partial` 的**直接原因**；Skill 层 5 缺陷（含版本漂移、缺质检规则）是**放大器**，让模型多花了数百万 token 试探并带病提交；模型层 5 类错误（含两处短路图）是**既定事实**，修法不在模型而在前两层的拦截与校验。先修 S1/S2/S3＋K1/K2，再谈重跑。
