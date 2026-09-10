> 历史资料（2026-09-11 归档）：保留原评估时点的结论，不作为当前执行指令；当前依据见[开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)。

# Cursor Grok 4.6 对《AI编辑最短路径产品决策报告》的独立评估

**评估模型**：Cursor Grok 4.6\
**评估日期**：2026-09-09\
**评估对象**：根目录 [`AI编辑最短路径产品决策报告.md`](../../../AI编辑最短路径产品决策报告.md)\
**核对源码**：仓库 HEAD `c839c205e594ab61bfa01c22b4a4f28303862d8d`\
**方法**：先独立读方案与对应源码，再检索 2025–2026 官方文档、固定开源实现与公开论文；不以既有评估结论为前置，也不把外部产品的宣传速度当成可迁移指标。

本文件是评估意见，不是任务卡，不改变开发路线、架构合同或任务板状态。

---

## 1. 独立裁定

**原方案的核心方向成立，应当作为本轮产品决策。**

最短路径是：**把常用课件操作做成首轮即可调用的接口，由模型选操作、由宿主按现有命令执行并给出真实回执；失败停在原操作语义内，成功后不要固定再开一轮模型。** 自动选模型、自建 Agent 平台、让模型写任意 JS 去调课件 API，都不是当前瓶颈的正确解。

同时，原方案有一处必须守住、后续评估容易冲掉的纪律：

> 先固定 Luna + max，用同类真实任务验证**接口改造**能省多少无效推理。若单次原生服务响应仍慢，再比较模型或强度。不要同时改接口、改强度、改路由。

我不同意把“数秒完成改色”写成当前可签署的验收门槛，也不同意把推理强度钳制、API 级 Prompt Cache 断点、Canvas 重解码写成与接口改造同等优先级的本轮必做项。那些可能有用，但它们要么越出当前架构能控制的范围，要么会破坏归因。

**本轮真正最短的工程路径是：可观察性 → 选中优先的可调用接口 → 失败不改载体 → 成功可结束。模型层变化放在这四件事之后。**

---

## 2. 对原方案决策表的逐项意见

| 原方案建议 | 本评估 | 说明 |
|---|---|---|
| 优先改接口呈现与调用路径 | **同意，作为本轮主线** | 与 Anthropic 工具设计、OpenAI“少请求/少生成”、tldraw 语义动作一致；也符合本仓库“应用不复制模型循环”的合同。 |
| 常用接口直达，长尾一次发现 | **同意，但要改预算规则** | 方向对。当前实现的问题不是“完全没有按需加载”，而是 **5,200 字节按遍历顺序切卡**，选中对象的工具没有豁免权。 |
| 由 AI 选择操作语义，宿主不做自然语言难度分类器 | **同意** | 对象类型、选区、版本、可用工具已是产品事实。再加一层难度模型只会增加一次不可归因的往返。 |
| 减少模型输出中的固定身份与工程结构 | **同意作传输投影，不同意把它当成最大耗时来源** | 短投影能降格式错误和输出 token。OpenAI 官方延迟指南写明：砍一半**输入**通常只换来约 1–5% 延迟；砍一半**输出**才近似砍一半等待。完整 AuthoringTarget 更可能是正确性负担，而不是 186 秒的主因。 |
| 成功回执可以结束任务 | **同意，且这是控制器层最高杠杆改动之一** | 但结束不等于丢回执。回执必须进入应用会话；原生侧若不能“只追加、不推理”，只能等到下一次真实请求再带上。 |
| OpenCode 配置与聊天分流一起修 | **同意，这是可用性而不是速度优化** | 模型选不了、聊天里漏 JSON，会让教师无法判断“慢”还是“坏”。 |
| Auto / 专用推理入口暂缓 | **同意，而且 2026 年多轮路由研究进一步支持暂缓** | 见第 5.6 节。 |

---

## 3. 9 分 30 秒案例：独立源码核对

原方案用已发生会话、没有为报告重跑模型。这一点正确。我没有重放该会话，只核对它引用的代码路径是否真的会产生所述断点。

### 3.1 已核实、可以当作设计缺陷

**1. 默认引用当前页，能力卡不看选中。**

`CourseChatPanel.tsx` 把 `scope` 初值设为 `'page'`。`captureGenerationSnapshot` 在 `page` 范围下会把当前页全部对象放进 `context.pages`，并用 `selected` 布尔值做标记；但 `generationCapabilityContext(pages, purpose)` **根本不接收 `selectedIds`**。它深度遍历页面节点，按遇到顺序往 5,200 字节预算里塞完整卡，超出的进 `deferred`。

因此：教师选中一张图、说“换成绿色”，首轮仍可能先装入页面上先出现的文字编辑卡，把 `asset.image.transform` 挤出。原方案对这一点的归因成立。

**2. 查询脚本没有帮助分支。**

生成器把 `query.mjs` 写成：每个 `--key` 必须立刻跟一个值，未知键直接失败。`--help` 要么报“缺少查询参数值”，要么报“未知查询参数”。`discovery.json` 的 `usage` 只是一段说明文字，脚本本身不会打印它。原方案“一次查询不应再产生怎么查这个查询器的问题”成立。

**3. 提交后无条件续行。**

`generationTaskController.ts` 在应用或拒绝之后都会 `captureNext`，并把 `continuation = true`。代码里没有“本轮候选声明已完成则停止”的分支。第三轮 16 秒“再观察并说已完成”是控制器行为，不是模型必须发生的步骤。

**4. 用量解析读错层级。**

本仓库收录的 Codex App Server v2 schema 中，`thread/tokenUsage/updated` 的 `tokenUsage` 必有 `last` 与 `total`，用量在 `TokenUsageBreakdown` 里（含 `reasoningOutputTokens`、`cachedInputTokens`）。适配器却读 `usage.inputTokens` 这种平面字段。按当前 schema，这些值会一直是 `null`。原方案“记录不足以量化推理成本”成立，而且这是适配器缺陷，不是服务没给数据。

**5. 候选 JSON 会先当正文流出去。**

`item/agentMessage/delta` 在条目尚未被标为候选时，把增量当作 `kind: 'text'` 推给界面；聊天侧只按起止标签做事后裁剪。流式中途、取消、非最终消息都会漏出裸 JSON。结构化输出可解析，不等于适合显示。原方案成立。

**6. 图片工具合同本身不是“换色会改载体”。**

`asset.image.transform` 明确：只替换所选图片实例的资产，保留未选共享实例，保留 alpha，禁止模型生成替代 base64 或纯色遮盖。失败后改走 `selection.replace`，是模型在错误恢复中换了工具，不是换色工具的语义。原方案把这两件事分开，是对的。

### 3.2 已核实、但不能夸大的部分

**本地命令 7.1 秒解释不了九分半。** 原方案已写明有并行，不能把命令耗时加总当关键路径。我同意：墙钟时间几乎全在原生回合内部（推理、工具选择、等待服务）。接口改造的收益主要是 **减少回合数、减少探索性 Read/查询、减少失败后的错误工具调用**，不是把单次 `max` 推理变成毫秒级。

**初始请求约 1.7–2.1 万字符，不是整份工程源码。** 这与 `generationSnapshot` 的设计一致：按引用范围导出页面对象、能力卡、资源文件。OpenAI 延迟指南还指出，中等规模输入对墙钟影响通常很小。因此“压缩提示词长度”不应成为本轮主 KPI。

**PNG 失败的具体块类型，报告没有、源码也无法从文字“PNG 数据块校验失败”反推。** 解码器对 **每一个 chunk** 做 CRC，失败文案相同。可能是关键块，也可能是辅助块，也可能是导出工具写坏的 IDAT。在用同一份真实字节定位之前，不能把根因写成“第三方截屏辅助块”或“非致命 CRC 差异”。原方案在这里比后续发挥更谨慎：要求用同一输入调查，而不是先关校验。

**三轮不是三次底层模型请求。** 原方案已声明。Agent 回合内部还有多次工具调用。修接口后，成功路径的目标应是 **一个 Agent 回合、零次发现脚本、一次合法变换、宿主提交后停止**；不要把“回合数下降”单独当成成功。

### 3.3 原方案对失败传播的判断，我同意并补一句

换色失败后用绿色文字块覆盖原图，是 **错误恢复越界**，不是换色算法算错。`selection.replace` 的职责是完整替换选中对象，它没有“禁止把 image 换成 text”的不变量。宿主按合同执行了一次合法替换，所以回执是成功，画面却不再是原图。

正确的产品语义是：

- **同一任务里，像素变换失败 ≠ 授权改载体。**
- **用户明确要求“换成秦始皇配图 / 换成另一张图”时，替换仍应可用。**

不要做成“图片对象永远不能被 replace”。那会误伤生成式换图和素材替换。护栏应挂在 **本轮失败恢复**，而不是永久禁用工具。

---

## 4. 外部证据：支持什么、不支持什么

检索截止 2026-09-09。下列判断只采用官方文档、可核对源码或带版本的论文；闭源产品宣传不作为机制证据。

### 4.1 支持“高频直达、长尾一次发现”

Anthropic *Writing effective tools for agents*（2025-09-11）把工具当成“确定性系统与非确定性 Agent 的合同”：名称要有边界，描述要写清何时**不要**用，错误返回要让模型知道下一步，而不是堆栈。Anthropic Tool Search（2025-11）进一步给出可执行规则：

- 工具选择准确率在大约 **30–50** 个同时可见工具之后下降，不是民间二次传播里的“15–30 指数劣退”。
- 保留 **3–5 个最常用工具始终加载**；其余 `defer_loading`，搜索命中后再展开完整定义。
- 搜索本身多一次往返，只在目录很大、省下的上下文和准确率超过这次延迟时才划算。

对本产品：课件编辑器并不面临“一次性塞 2,500 个 API”。真正对应关系是：

| Anthropic 规则 | 本产品应落地的形态 |
|---|---|
| 3–5 个热工具始终在场 | 与**当前选中对象类型**匹配的完整操作卡，不受 5,200 字节遍历预算驱逐 |
| 长尾搜索一次得到可调用定义 | `query.mjs --id …` 返回参数、限制、示例；`--help` 打印 usage，不再报错 |
| 搜索有额外延迟 | 改色、改字号、改位置不应走搜索 |

Cloudflare Code Mode 证明：面对 **2,500+** 端点，用 `search()` + `execute()` 可以把工具定义从约 117 万 token 收到约 1,000。这证明“目录与执行分离”有效。它 **不**证明本产品应该让模型写 JS 去改 V9 工程。Code Mode 的执行端是隔离 Worker；本产品的写入端必须是 canonical command + 唯一资源事务。原方案拒绝整体迁入，正确。

### 4.2 支持“语义动作，不要生成完整对象”

tldraw Agent 模板把 Move 做成 `shapeId + x + y`，几何由编辑器执行；选择、动作、聊天展示分职。官方模板同时保留完整图形 Update，默认模式仍可带截图。原方案的取舍准确：迁入短引用和动作/展示分离，不迁入 live Store，也不把三种 Surface 并成一个万能对象模型。

Figma 2026 的画布 Agent 公开行为是：**先选图层，再对选中层做 prompt-to-edit**，并强调用现有组件/变量，而不是另生成一套占位。闭源，看不到它的工具表。可借鉴的只有交互习惯：选中即焦点。不能据此推断他们用了哪种路由或缓存。

Excalidraw MCP 用 checkpoint 引用状态；其 `computeDiff` 公开实现主要覆盖增删和位移/缩放，**不覆盖纯颜色或纯文本**。原方案“不能当事实同步直接照搬”成立。Penpot 的 `penpot_api_info`（类型/成员级文档）+ `execute_code` 证明“查到即可用”，但其执行模型是 Plugin API 任意 JS，与本产品提交边界冲突。只迁“一次查到完整调用信息”，不迁 live 执行。

### 4.3 支持“少生成、少往返、成功可结束”

OpenAI *Latency optimization* 把延迟手段收成七条。映射到本产品：

| OpenAI 原则 | 本产品能做的 | 本产品做不到或不该做的 |
|---|---|---|
| 更快地处理 token | 无。推理在原生 CLI 服务端 | 不要假装应用能加速 Luna |
| 更少输出 token | 短投影、禁止固定总结轮、工具描述写清边界 | 不要靠“提示模型别思考”代替配置 |
| 更少输入 token | 选中优先、不塞无关源码 | 不要指望靠砍 1.7 万字符把 186 秒打下来 |
| **更少请求** | 首轮可调用 + `afterCommit: finish` | 这是墙钟上最大的可控项 |
| 并行 | 已有批量候选步骤 | 不必为一次改色上执行服务器 |
| 让用户少空等 | 通道分流、真实阶段、流式人类进展 | 流畅进度条不能代替正确画面 |
| 能不用模型就不用 | 换色/裁剪/缩放走确定性像素工具 | 不要让模型研究 PNG 二进制 |

Pi 的结构化终结（工具返回后结束、机器结果与可读文字分开）以及“动态改工具集合可能打穿缓存前缀”的工程经验，支持原方案的 `afterCommit` 与“不要无意义重排工具”。Pi 是另一套 harness。本产品不能也不应换成 Pi API。

Aider 的短编辑格式、按当前文件组织上下文、失败给具体反馈，支持“改参数不必读实现源码”。Continue 的补全缓存/取消，不能代表课件任务完成时间。

### 4.4 明确不支持本轮就做的事

**Auto / 路由器。** Cursor Router 用生产流量训练复杂度与任务分类，且官方把 Fast Apply（约 1000 token/s 的专用整文件应用）和 Router 分成两件事。Fast Apply 是“已知原文件、应用补丁”的推测解码，不是 Agent 完成一次换色的端到端时间。RouteLLM 公开实现有首轮训练与多轮应用的边界，部分路由器还先打 embedding。ACL 2026 的 MTRouter 进一步指出：多轮 Agent 中途换模型会丢掉 prompt/KV 缓存，需要大量轨迹数据，且缺在线适应。本产品既没有课件操作的标注轨迹，也不拥有模型循环。原方案把 Auto 放后面，比“先上路由再修接口”科学。

**推理强度自动钳制。** 2025–2026 研究确认 reasoning 模型会在简单题上 overthinking：长思考对简单任务可慢 5–20 倍且没有稳定精度收益。Claude 文档也写 `effort: max` 会一直想，`low` 才为速度跳过简单题。**这些事实成立，但不能推导出本轮应由宿主按 `intent === 'edit'` 偷偷改用户已选的 Luna + max。** 原因有三：

1. 当前失败路径包含工具缺失、PNG 报错、错误替换。强度不是已分离出的主因。
2. 仓库适配器已经把 effort 做成 **用户可见的原生配置**，并要求后续任务使用原生确认值。任务中途改强度，等于同时改两个变量。
3. 应用不拥有模型循环。能做的是：修好用量里的 `reasoningOutputTokens`，用同一配置对比接口改造前后；若单回合仍有大量 reasoning token 且结果正确，再单独立项比较 `max` 与 `low`。

**专用低延迟服务 / 自建 harness。** 与架构合同第 7 节直接冲突。外部 Code Mode、Tool Search Tool、MCP 执行沙箱都是 **API 宿主能力**。本产品的宿主是 Codex / Claude / OpenCode 原生循环。正确类比不是接入 Anthropic `defer_loading`，而是把 `artifacts/ai-capabilities` 的 discovery/query 做到“一次即可调用”。

### 4.5 中文检索

Cloudflare 开源搜索按英文字母数字分词。直接搬到“换成绿色”会失败。原方案“先用中文能力说明、操作别名和结构化过滤（按 nativeType / operation / id）”正确。本产品已有 `--id`、`--operation`、`--nativeType`，应先让这条路可调用，而不是先上向量库。

---

## 5. 与根目录另一份评估的主要分歧

同目录已有一份并行评估。下面只记录我会明确反对、以免实施时被带偏的点。未列出的部分（接口优先、修用量、分流 JSON、暂缓 Auto）我同样支持。

**1. 不要把 15–30 工具“指数劣退”写进本产品依据。**\
Anthropic 平台文档写的是 **30–50** 个同时可见工具后选择准确率下降。本产品首轮问题不是工具太多，而是 **该在场的卡被遍历预算挤走**。对策是选中匹配卡豁免，不是按 15 这个数再砍一刀。

**2. 不要把改色验收写成 15 秒 / 8 秒。**\
在 Luna + max 未做对照、用量仍为 null 时，这些数字没有基线。原方案写“数秒内得到结果、慢请求不进入分钟级探索”可以作产品愿望；签署门槛应在接口改造后、同一配置下用真实样本再定。若改造后单回合仍要一两分钟，应报告“剩余延迟在原生服务”，而不是继续压缩上下文。

**3. 不要把 reasoning effort clamping 提前到与接口改造并行。**\
这是原方案第四步的内容。提前做会让“接口是否变快”无法回答。

**4. 不要把 OpenAI/Anthropic 的 `prompt_cache_breakpoint` / `cache_control` 当成应用可直接下发的开关。**\
前缀稳定是对的：能力说明应按语义版本固定顺序，动态选区、截图、草稿放后面。但缓存命中发生在原生 CLI 向其服务商发请求之时。应用只能稳定 **送给 CLI 的观察**；不能在 adapter 里伪造 Responses API 断点。Pi 能做 cache-friendly 动态工具，是因为它就是那层 harness。

**5. 不要用 Canvas / `createImageBitmap` 当“无损备轨”。**\
当前 PNG 路径明确保留未预乘、零 alpha 下的 RGB，并拒绝 16 位以免静默丢精度。浏览器解码可能预乘、应用色彩配置、丢掉辅助块。这可以让“能显示的图也能变换”，也可能让像素与作者资产不再是同一份。调查顺序应是：用失败文件定位是哪一个 chunk；对非关键辅助块可跳过并记录；IHDR/IDAT/PLTE/tRNS 仍应失败可见。Canvas 只作为 **显式降级选项**，并在回执中写明“已规范化重编码”，不能默认为无损。

**6. 跨载体熔断不要做成永久禁 replace。**\
见 3.3。合法“把这张图换成生成图”必须继续走替换或生成能力。要拦的是：变换工具失败后的自动续行，在没有新的用户意图时改 `kind`。

---

## 6. 原方案需要补强、但不需要改方向的点

### 6.1 5,200 字节预算的规则错了，不只是排序错了

即使改成“选中对象优先填充”，只要预算硬切完整卡，一张稍长的图片变换卡仍可能被挤出。更稳的规则：

1. **与当前选中对象直接匹配的工具完整卡：必进，计入但不驱逐。**
2. 其余常用卡按相关性填剩余预算。
3. 长尾只给短目录（id + 一句用途 + query 示例）。
4. 能力语义文本按 `semanticVersion` 固定顺序，避免同一版本下无意义重排。

这仍不是向量检索，也不需要第二份手工接口真相。生成器已经是唯一来源。

### 6.2 `afterCommit` 是会话协议，不是 V9 字段

原方案已写明。实施时必须同时规定：

- `finish` 只在 **真实提交成功且接口自身条件满足** 时生效。
- 失败、部分完成、过期 target、用户点“修正”仍继续。
- 需要视觉判断的生成图默认 `continue` 或由模型显式选择，宿主不根据“看起来像不像秦始皇”做语义验收。
- 结束前仍要把 host-result 写回原生会话；不能为了省 16 秒把回执只留在 GUI。

### 6.3 短传输投影的范围

附录 A 的示意可以做。但：

- 只覆盖已有稳定工具（颜色、几何、已开放组件参数、图片像素变换）。
- 不适合短投影的（Generated Component / Runtime 源码、复杂 create）继续走完整合同。
- `targetRef` 绑定 request/epoch/revision，过期必须可见失败。
- 展开后仍走同一套 canonical command，禁止 JSON Patch 和 raw Store。

### 6.4 错误返回要写成“下一步合同”

Anthropic 和多篇 2026 工具实践都强调：错误是工具接口的一半。PNG 失败应返回：哪个资源、是否提交（必须是未提交）、同一操作能否恢复、禁止用文字/矩形覆盖、需要用户重导出还是宿主可规范化。相同失败不无限重试。

### 6.5 可观察性是性能工作的前置，不是附属

至少要能分开：启动、快照准备、原生请求开始、首个公开输出、工具起止、候选完成、宿主提交、画面稳定；用量要能读 `last` 与 `total`，并单独列出 `reasoningOutputTokens` 与 `cachedInputTokens`。没有这些，任何“已经变快”的声称都无法审核。

OpenCode 的 `Failed to fetch models.dev` 在 1.18 系源码和后续修复里，通常是后台刷新失败，目录仍可来自磁盘缓存或内置快照。原方案不把这两条超时直接当成下拉框根因，正确。界面失败要按：进程启动 → initialize → 建会话 → 读目录 → 解析选项 → 待应用 vs 原生已确认，逐段记日志。

---

## 7. 建议的实施顺序（评估意见，非任务状态）

与原方案四步对齐，只把验证门写得更硬。

**第一步：能看见、能显示、图片失败不毁工程。**

- 修正 Codex 用量映射到 `tokenUsage.last` / `total`。
- 候选走数据通道，聊天只显示人类进展；覆盖流式、取消、重开。
- 用本次失败 PNG 定位 CRC；修复解码兼容性，但关键块失败仍不得提交。
- OpenCode 能力获取按阶段归因，缓存标明待确认。

停止条件：同类失败不再产生绿色文字块；聊天不再泄漏候选 JSON；日志里能看到 reasoning/cached token 是数字还是零。

**第二步：首轮就能调用该调用的接口。**

- 选中匹配卡必进；查询一次返回可调用信息；`--help` 可用。
- 常用操作短投影；模型不再为改颜色抄完整 target。
- 正常参数修改不读实现源码。

停止条件：用附录 D 的“已选中文字改色/字号”“同页大量无关对象”“有效 PNG 换色”做局部协议检查。尚未要求 P95。

**第三步：结束语义与失败收敛。**

- `afterCommit: finish | continue`。
- 失败恢复不得擅自改载体。
- 迟到/过期候选不能覆盖手动编辑。

**第四步：只有这时才动模型层。**

固定 Luna + max，对比接口改造前后的 **请求到正确画面** 时间。若正确路径仍是分钟级，再单变量比较强度或模型。独立推理入口涉及服务、凭据和合同，必须单独决策。

---

## 8. 验收口径：我支持原方案的表，并收紧替代证据

| 待证明属性 | 直接证据 | 仍不应采用的替代证据 |
|---|---|---|
| 首轮可调用 | 选中图片改色无需 `query.mjs` / 读工具源码；冷操作一次 `--id` 即可 | 提示词变短、卡数变少 |
| 改色保真 | 仍是 native/flow image；像素尺寸与透明度符合工具合同；未选实例不变 | 外框 560×320 没变 |
| 正常任务是否变快 | 同一模型与强度下，请求到正确画面的墙钟时间 | Agent 回合数、进度条更顺 |
| 失败收敛 | 同一坏 PNG：零提交、零覆盖、有结构错误 | 任务状态是 completed |
| 配置生效 | 原生确认的 model/effort 与下一任务一致 | 下拉框能点 |
| 显示诚实 | 流式/取消/重开无候选泄漏；成功文案与回执一致 | 最后一条气泡看起来像人话 |
| 生命周期 | 受影响路径的 Undo/Redo、保存重开、试运行/导出 | 新跑一轮无关 CLI 矩阵 |

明确属性修改的产品愿望可以是“数秒级、不掉进分钟级探索”。在用量修复和同配置对照之前，我 **不建议** 把 8 秒或 15 秒写成门。生成式改图与源码修改必须分开统计。

---

## 9. 结论

原方案把问题找对了：不是缺一个更聪明的路由器，而是 **接口不能直接用、焦点不在选中对象、失败后换工具改载体、成功后还要再推理一轮，并且我们甚至读不到 token 用量。** 现有 V9、canonical command、批量候选、图片变换合同和原生 CLI 分工，已经够承接这次优化。

开源和官方资料支持这个方向，也划出了边界：没有框架能保证任意 CLI、任意模型、任意图片编辑实时完成；Cloudflare / Penpot / Anthropic 的“让模型写代码执行 API”与本产品唯一写入路径不兼容；Cursor Fast Apply 的速度不能翻译成本任务墙钟时间。

我的独立补充只有三条，且都服从原方案的归因纪律：

1. **选中匹配的完整卡必须豁免遍历预算**，否则“按需加载”会继续把热路径变成搜索路径。\
2. **失败恢复不得改载体**，但不要永久禁止合法替换。\
3. **先修复用量和通道，再谈快；先固定模型与强度，再谈 Auto 或 clamping。** 若接口收敛后仍然慢，应如实报告原生服务延迟，而不是继续叠加框架。

按这个顺序做，最短路径是可执行的。打乱顺序，尤其是把模型层优化提前，会重新失去对“到底什么变快了”的解释权。

---

## 来源（访问基准 2026-09-09）

### 本仓库

- [`AI编辑最短路径产品决策报告.md`](../../../AI编辑最短路径产品决策报告.md)
- [`docs/development-plan/ARCHITECTURE_CONTRACT.md`](../../development-plan/ARCHITECTURE_CONTRACT.md) 第 7 节（原生 CLI、候选摄取、唯一写入路径）
- `src/renderer/authoring/generation/generationCapabilities.ts`
- `src/renderer/authoring/generation/generationSnapshot.ts`
- `src/renderer/authoring/generation/generationTaskController.ts`
- `src/renderer/ui/chat/CourseChatPanel.tsx`
- `src/renderer/project/imageTransform.ts`
- `src/renderer/authoring/tools/imageTransformTool.ts`
- `src/renderer/authoring/tools/semanticReplacementTool.ts`
- `src/main/localAgent/codexAppServer.ts`
- `scripts/generate-ai-capabilities.ts`（生成 `query.mjs`）
- `output/r18-codex-protocol/v2/ThreadTokenUsageUpdatedNotification.json`

### 外部

- Anthropic, *Writing effective tools for agents*, 2025-09-11. https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, *Introducing advanced tool use* / Tool Search Tool. https://www.anthropic.com/engineering/advanced-tool-use ；https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
- Anthropic, Thinking / effort. https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost
- OpenAI, *Latency optimization*. https://developers.openai.com/api/docs/guides/latency-optimization
- OpenAI, *Prompt caching*. https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI, Codex configuration（`model_reasoning_effort`）. https://developers.openai.com/codex/config-advanced
- Cloudflare, *Code Mode: give agents an entire API in 1,000 tokens*. https://blog.cloudflare.com/code-mode-mcp/
- tldraw Agent starter kit. https://tldraw.dev/starter-kits/agent
- Penpot MCP. https://help.penpot.app/mcp/
- Excalidraw MCP `edit-context.ts`（变化摘要覆盖范围）
- Pi, Extensions / dynamic tool loading / structured output. https://pi.dev/docs/latest/extensions
- Aider, Repo map & edit formats. https://aider.chat/docs/repomap.html ；https://aider.chat/docs/more/edit-formats.html
- Cursor, *How Cursor Router chooses the right model*. https://cursor.com/blog/how-cursor-router-works
- Cursor, *Editing Files at 1000 Tokens per Second*. https://cursor.com/blog/instant-apply
- Figma, Design Agent / prompt-to-edit（产品行为，非内部机制）. https://www.figma.com/blog/the-figma-agent-is-here/
- RouteLLM. https://arxiv.org/abs/2406.18665
- MTRouter, ACL 2026. https://aclanthology.org/2026.acl-long.2045.pdf
- TRACE / overthinking, ACL 2026. https://aclanthology.org/2026.acl-long.773/
- OptimalThinkingBench. https://arxiv.org/pdf/2508.13141
- OpenCode models catalog issues（后台刷新失败 ≠ 空目录）. https://github.com/anomalyco/opencode/issues/10766

外部项目未在本机做延迟基准。上文凡涉及“秒级”“P95”的表述均为评估意见，不是已验收结果。
