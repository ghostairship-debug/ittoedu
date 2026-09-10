> 历史资料（2026-09-11 归档）：保留原评估时点的结论，不作为当前执行指令；当前依据见[开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)。

# 独立评估报告：《AI 编辑最短路径产品决策报告》

> 评估模型：deepseek-v4-flash-vision-exp
> 评估对象：`AI编辑最短路径产品决策报告.md`（根目录，311 行，基准日 2026-09-09，基线提交 `c839c205e594ab61bfa01c22b4a4f28303862d8d`）
> 评估日期：2026-09-09（第四节“外部来源核验”原为空缺，已于同日二次搜索核查补全）
> 方法：① 对报告引用的 15 组本地代码/数据证据逐一用 read/pwsh 核对（含真实会话记录与 git HEAD）；② 通过搜索接口尽力核查报告引用的 15 组外部来源（开源提交、协议规范、官方文档）；③ 对照仓库既有 G01–G12 缺口清单、VS Code 基准评估（W01–W11）与当前开发路线判断一致性；④ 独立判断论证逻辑、风险遗漏与可执行性。
> 边界声明：本环境无法直接抓取 GitHub raw / arXiv / 官方博客原文（`web_fetch` 对多数域名受限），外部来源核查以搜索引擎返回的**源码片段、官方文档与仓库页面**为证据。本次补全（2026-09-09 二次核查）获得的片段证据级别高于首轮：多个关键文件（如 OpenCode `models-dev.ts`/`config-option.ts`、Continue `CompletionProvider.ts`、Aider `repomap.py`/`editblock_coder.py`、RouteLLM `controller.py`、LiteLLM `lowest_latency.py`、Cloudflare `@cloudflare/codemode`、Pi `skills.md`）均拿到**代码/文档片段级**佐证，可直接确认机制存在与方向正确；但仍**无法对报告引用的固定提交做逐行 diff**，凡涉及“精确到该提交的哪一行”的表述仍以“片段级可证/不可证”裁决，不与“逐行核实”混同。local 部分不受此限。

---

## 一、最终结论（先给判定）

**总判定：批准方向，有条件执行；不批准把报告当作可直接施工的规格。**

| 维度 | 判定 | 要点 |
|---|---|---|
| 问题定义 | 成立且证据扎实 | 9 分 30 秒改色任务的 3 轮时长、27 个空用量事件、186/336/16 秒分布、HEAD 提交、PNG CRC 拒绝、默认 page 范围、5200 字节预算、无 `--help` 分支等 15 组本地证据**全部属实（15/15）** |
| 外部借鉴 | 基本可靠，需注意两处 | 引用项目真实存在、机制描述与公开资料方向一致；tldraw 一行的许可结论（Agent 模板 MIT / SDK 自有许可、生产另受约束）方向正确但表述偏弱，SDK 4.0 已引入带许可证密钥执行的新许可模型，报告未展开；Excalidraw“MIT、未见独立 LICENSE”核查属保守表述 |
| 决策方向 | 同意为主体方向 | “接口优先、AI 选操作、宿主执行”与 Anthropic 工具设计、MCP 客户端最佳实践、Cursor Dynamic Context Discovery、JetBrains IDE 原生检索等 2026 年公开动向同向；“不先做自动路由”的归因理由成立 |
| 与仓库既有规划的一致性 | 高，但缺少互引 | 报告结论与 G01–G12、W01–W11、1.9“主要瓶颈优化”一致；但报告**零引用**仓库自己的缺口清单与基准评估，其“建议实施顺序”与 W09/W07/W01 高度重叠却未对齐，存在重复规划与口径漂移风险 |
| 可执行性 | 中高，需补三类输入 | 缺：与 roadmap 节点（1.8/1.9/2.0）与 W 包的对应关系、工作量/Owner/写域分配、可量化验收阈值（仓库已有 ≤12KB 能力说明、UI p95<300ms、本地状态<500ms 等目标，报告未引用也未给出等价物） |
| 风险控制意识 | 强 | 不建第二工程真相、不改 V9、不新增难度分类器、不关闭 PNG 校验、不虚报成功、不用“隐藏花括号”修 JSON 泄漏、明确“秒级”不是承诺——这类边界在同类决策报告中属少见的高水准 |
| 主要盲点 | 见第六节 | 对“步骤 2（接口与上下文改造）收益”缺乏独立预估与前置实验；对“失败根因（PNG 解码）与速度优化（上下文/接口）实为两条线”的区隔建议不足；未给“若 9 分半主要是模型服务端延迟”的停损判据 |

**一句话建议：**按“先修事实错误与可观测性（第一步）→ 再做接口可用性（第二步）→ 后定收尾语义（第三步）→ 最后才谈模型层”的顺序执行是稳妥的；但请先把报告中的步骤映射到 W01/W02/W07/W09 与 1.9 节点，并补上“接口改造前后同一任务基线对比”的最小实验设计，否则第二步的最主要收益（如果存在的话）无法被证明，也无法防住“优化了上下文，瓶颈仍在下游”的白干。

---

## 二、报告核心主张压缩（评估对象的要点）

1. **问题：**一次“把图片红色改为绿色”真实操作耗时约 9 分 30 秒（3 轮：约 186/336/16 秒），且最终以“带绿色背景的文本对象替换原图片”告终——失败，且改变语义；用量事件 27 个全部为 null，无法归因。
2. **诊断：**6 个断点——默认 page 范围不聚焦选中对象；能力卡按遍历顺序吃满 5200 字节预算；`--help` 无帮助分支导致“怎么查查询器”；模型承担候选传输结构；提交后固定再进 CLI；图片工具正确边界未阻止错误替代。
3. **外部参照：**tldraw（语义动作+短引用）、Penpot（成员级文档+引用）、Excalidraw MCP（宿主状态引用）、Cloudflare Code Mode（词法检索+方法级描述）、Pi（缓存前缀+结构化终结）、Aider/Continue（目标相关上下文、并行准备）、RouteLLM/LiteLLM/Cursor Router（路由均不先行）。
4. **推荐行为：**一次选对操作（接口语义化）；首轮少量完整信息、长尾一次发现；模型只输出接口标识+参数，宿主展开身份；`afterCommit: finish|observe`；失败留在接口层；修 OpenCode 模型目录与 JSON 泄漏；先修用量/阶段可观测性。
5. **顺序与停止条件：**补证据→接口可用→收尾语义→（必要时）模型层；不再为引入框架而扩展系统。

（详见原文，此处不重复。）

---

## 三、本地证据核验（可复现，逐项核实）

**结论：15 组主张全部属实，仅个别行号小幅漂移。** 这是本报告对原文质量最有力的正面证据——原文作者要么真实运行过系统，要么做了诚实的源码级取证，且刻意区分了“可证事实”与“推断”。

| # | 报告主张 | 核实结果 | 关键证据（均为本次实际读取） |
|---|---|---|---|
| 1 | 聊天默认范围 page；正文清理依赖标签 | 属实 | `CourseChatPanel.tsx:56` 默认 `'page'`；23–32 行仅剥除 GENERATION_OPEN/CLOSE 与 GENERATION_RESULT_OPEN/CLOSE 两对标签；注意诊断详情仍显示原始事件（“隐藏”仅作用于正文渲染） |
| 2 | 按范围构造页面/对象/目标 | 属实 | `generationSnapshot.ts:47–78`：非 selection 加 create destinations；64 行 `scope!=='selection' \|\| selectedIds.includes(...)` 过滤 |
| 3 | 遍历顺序 + 5200 字节完整卡预算 | 属实 | `generationCapabilities.ts:12–51` 深度遍历收集 desired，46 行对累计 cards JSON 字节 ≤5200，超出进 deferred 延迟加载 |
| 4 | 能力分支读取；脚本无 --help 分支 | 属实 | `courseAgentCapabilities.ts:159` 判别器分支选择；生成的 `query.mjs` 中 `--help` 落入“未知查询参数”错误，确实不存在帮助分支 |
| 5 | 查询脚本支持 ID/操作/类型，无帮助分支 | 属实 | `generate-ai-capabilities.ts:938–943` 生成 query.mjs，`--id/--operation/--nativeType` 支持，未知键一律报错；产物在 `artifacts/ai-capabilities/query.mjs` |
| 6 | strict 候选、批量步骤、前序结果引用 | 属实 | `generationContract.ts:55–81`：strict + steps 批量 + superRefine 仅允许已完成前序 step/`$result` |
| 7 | 像素操作确定性、保留未选实例与源资产 | 属实 | `imageTransformContract.ts:17–29` 仅输入意图（无 V9 字段）；`imageTransformTool.ts:13–45` 只替换 update 目标的 assetId |
| 8 | PNG 数据块校验失败即拒绝 | 属实 | `imageTransform.ts:65` CRC 比对失败抛“PNG 数据块校验失败”（另有签名/长度/解压/过滤器校验，输出再解码回验 220–224 行） |
| 9 | 对象替换保留外框、丢失原图语义 | 属实 | `semanticReplacementTool.ts:85–159`：从旧项复制 wrapper 属性（frame/order/visible 等 119–134 行），kind/content 语义来自替换项 |
| 10 | 应用/拒绝后继续采集观察并执行 | 属实（行号偏早约 35–45 行） | `generationTaskController.ts:150–160`：receipt 或 rejected 后 `captureNext` → `expectedResult:'auto'` → continuation 循环 |
| 11 | Codex 输出需序列化 JSON 字符串；delta 先当正文；用量读平面字段而协议为 last/total 分层 | 全部属实 | `codexAppServer.ts:65`（`'A complete JSON serialization…'`）、1058–1071（delta 直推界面，1107–1111 才解析）、1148–1157（平面 inputTokens/outputTokens/cachedInputTokens）；`output/r18-codex-protocol/codex_app_server_protocol.v2.schemas.json` **21636 行**恰为 ThreadTokenUsage（`last`/`total` 均 $ref），差异成立 |
| 12 | 能力缓存、零回合探测、待应用 vs 已生效 | 属实 | `harness.ts:81–92` 缓存；97–113 零回合会话注释明确“no active task is reconfigured”；`NativeAgentConfiguration.tsx:25,42–44` 明确区分“下次发送/继续时应用”与“已生效” |
| 13 | 会话 3 轮、186/336/16 秒、27 个空用量事件 | **逐项吻合** | 真实记录文件存在：3 个 turn-ended（completed），usage 事件 27（12+14+1），轮次 186.0/336.0/16.4 秒 |
| 14 | 基线提交 c839c205… | 一致 | `git rev-parse HEAD` = `c839c205e594ab61bfa01c22b4a4f28303862d8d` |
| 15 | 相关文件/生成器存在 | 属实 | `src/renderer/authoring/generation/` 与 `scripts/generate-ai-capabilities.ts`、`scripts/query-ai-capabilities.mjs`、`artifacts/ai-capabilities/` 均存在（无 “capabilites” 拼写目录，原报告此事无涉） |

**附加交叉检查（报告自身未引用、但强化其可信度）：**仓库 `docs/development-plan/reviews/1.8-ai-assistant-gap-register.md` 的 G01–G12 早已记录“图片不可见/G02 改色未闭环、G04 模型与强度缺口、G05 JSON 与进度泄漏、G07 上下文膨胀 127KB/13.6 万 tokens、G08 多轮零修改、G09 缺视觉验证”——与本报告问题陈述一致，本报告相当于在既有缺口清单上追加了一次“真实任务时序 + 空用量事件”的新证据，并给出了方向性决策，而不是提出全新发现。这一点**提高了**报告的可信度（问题不是临时编造），也**降低了**其“首创性”（结论与既存清单在工程上几乎同构）。

---

## 四、外部来源核验（尽力搜索的结果）

> 本节为原评估缺失部分，已于 2026-09-09 二次核查补全。证据等级：**[片段级]** = 搜索引擎返回了该文件/文档的实际代码或文字片段，可确认机制存在与方向正确；**[存在性级]** = 仅确认项目/页面/提交存在与公开内容方向，未能取到对应源码片段；**[未能直接读码]** = 无法对照固定提交源码。
>
> 总体结论：**15 组外部来源全部可证（存在性 15/15），其中 11 组达到片段级；未发现报告有“张冠李戴”或“引用不存在项目”的错误。** 报告外部部分最易被挑战的两处（tldraw 许可、Excalidraw LICENSE）均属“表述保守”而非“表述错误”。

### 4.1 分组核验结果

| # | 报告引用（项目/提交） | 报告主张 | 核验结果 | 证据等级 | 关键证据 |
|---|---|---|---|---|---|
| 1 | tldraw `e3b6f837`（agent 模板） | 短对象引用、Move 等语义动作、动作与聊天展示分离；Agent 模板 MIT、SDK 自有许可、生产另受约束 | **成立，且 4.0 许可比报告描述更强** | [片段级] | `templates/agent/README.md`、`client/actions/MoveActionUtil`、`AgentModeDefinitions`（parts/actions 分离）均存在；`agent-template` 仓库 LICENSE=MIT；**tldraw SDK 4.0（2025-09-18 发布）明确：生产部署需要 license key（trial/commercial/hobby），仅开发/localhost 免，且靠密钥强制执行**；五个 starter kits 均 MIT |
| 2 | Penpot `8fac9cf1` | 成员级接口文档、保存选择引用、执行中处理数据；主仓 MPL-2.0、旧独立 MCP 已合并 | **全部成立** | [片段级] | `mcp/packages/server/.../PenpotApiInfoTool.ts`（type/member 查询）、`ExecuteCodeTool.ts`、`initial_instructions.md` 均在；本地 MCP 五工具（execute_code / high_level_overview / penpot_api_info / export_shape / import_image）；**penpot-mcp 独立仓 2026-02-03 归档并入主仓**；Penpot 主仓 MPL-2.0 |
| 3 | Excalidraw MCP `157aa23c` | 宿主状态引用、差量交付、模型工具与 UI 内部工具分离；README 声明 MIT、核对树未见独立 LICENSE | **成立（摘要覆盖有限确属事实）** | [片段级] | `src/edit-context.ts` 存在：`setCheckpointId`、`save_checkpoint`、`computeDiff`（仅按 id+version 生成文本 diff）、2 秒 debounce、localStorage+服务端双写；README 为“Excalidraw MCP App Server”；官方仓主页未显示独立 LICENSE 徽章（第三方 fork 才标 MIT），保守表述成立 |
| 4 | Cloudflare Agents `94485788` | 普通词法搜索、方法级 describe、执行端筛选结果；开源可查、采用机制不等于引入部署依赖 | **成立（细节补充：搜索是 ranked search）** | [片段级] | `@cloudflare/codemode`：`runtime.search()`（ranked connector methods）/`describe()`（类型文档）/`execute()`；官方文档明示“progressive discovery through codemode.search()/describe()”；OpenAPI connector 由 host 侧读取 spec 并派生每操作一个类型化工具（**零 prompt tokens**）；snippets、`requiresApproval` 机制；官方 Code Mode MCP 博客存在 |
| 5 | Pi `6160683a` | 动态工具加载考虑缓存前缀；结构化输出将机器数据与可读内容分开；终结工具后模型续推 | **成立** | [片段级] | Pi 新增“message-anchored tool loading”（#6474）：`addedToolNames` + `tool_reference` + `defer_loading`，明确“keep late-added tools out of the cached prompt prefix”“preserve replay validity”，未支持模型有安全回退；`skills.md` 渐进披露（仅描述常驻、SKILL.md 按需读取） |
| 6 | Aider `5dc9490b` | 按明确目标组织上下文（RepoMap）、短编辑、具体错误反馈 | **成立** | [片段级] | `repomap.py`（`get_ranked_tags_map`、mention 个性化、图排名、token 预算）；`editblock_coder.py`（diff 格式、`find_original_update_blocks`、`find_similar_lines` 0.6 阈值）；`edit-formats.md`（whole/diff/diff-fenced/udiff/editor-diff）；Apache-2.0 |
| 7 | Continue `5522c6f4` | 并行准备、取消旧请求、缓存与流式后处理；只适用于 autocomplete | **全部成立** | [片段级] | `core/autocomplete/CompletionProvider.ts`：`AutocompleteLruCache`、`AutocompleteDebouncer`（默认 350ms，输入时取消前请求）、`Promise.all([getAllSnippetsWithoutRace, getWorkspaceDirs])` 并行准备、`StreamTransformPipeline` 流式后处理、AbortSignal 取消 |
| 8 | RouteLLM `0b64fdaf` | 首轮训练数据与多轮应用边界；常用路由器可能先请求 embedding | **全部成立（含源码注释级证据）** | [片段级] | arXiv `2406.18665` 论文存在；`controller.py` `_get_routed_model_for_completion` 原注释：“**Our current routers were only trained on first turn data, so more research is required here**”；README 明示 mf/sw_ranking 路由器仍需要 `OPENAI_API_KEY` 生成 embedding |
| 9 | LiteLLM `328a5f5d` | 延迟路由选择服务部署，与理解编辑接口不是同一问题 | **成立** | [片段级] | `litellm/router_strategy/lowest_latency.py`（TTFT/响应时间移动平均、max_latency_list_size=10）；`complexity_router`（heuristic/LLM 分类器、SIMPLE/MEDIUM/COMPLEX/REASONING 分层）；2026-07 Auto Router v2 把 semantic/complexity/adaptive 合并（报告所述“复杂度路由配置”仍有效） |
| 10 | Cursor Router / Instant Apply | 生产反馈训练复杂度与模型选择；Fast Apply 早期文章速度属特定文件应用与推理优化 | **全部成立** | [片段级] | “How Cursor Router works”（2026-08-06）：从**真实生产流量**构造数据集、Compass 复杂度评分、任务分类学、75% 单侧收益阈值、cache-aware；“Introducing Cursor Router”（2026-07-22）：600k+ 请求训练、AFC 在线 A/B；“Editing Files at 1000 Tokens per Second”（2024-05-14）：~1000 tokens/s、speculative edits、Llama-3-70b 微调——确属“特定文件应用 + 专用推理优化” |
| 11 | OpenCode `v1.18.26` models-dev | 磁盘缓存/内置快照优先、后台刷新失败仅记录并忽略、不会清空目录；默认远程地址已是 models.opencode.ai，日志仍保留旧名称 | **成立（且较新源码进一步证实）** | [片段级] | `packages/core/src/models-dev.ts`：`loadFromDisk → loadSnapshot → fetch` 链；refresh 用 `Effect.tapCause(...Effect.logError("Failed to fetch models.dev")) + Effect.ignore`（失败记录并忽略）；最新版本默认 `source = OPENCODE_MODELS_URL || "https://models.opencode.ai"`、缓存文件名 `models.json`；**注意**：报告所指 v1.18.26 具体行（#L150）未逐行核对，但逻辑在多个版本一致；另有更新 PR（#45363）“decouple model catalog refresh from persistence”进一步支持“刷新失败不清空、保留旧目录” |
| 12 | OpenCode `v1.18.26` ACP + ACP 官方 | ACP 返回扁平选项、正式协议支持分组、设置后返回完整配置状态 | **成立** | [片段级] | `packages/opencode/src/acp/config-option.ts`：`buildModelSelectOption`/`buildConfigOptions` 返回 `SessionConfigOption[]`（model/effort/mode 三个扁平选项，`type:"select"`）；ACP 官方 v1/v2：`SessionConfigSelectOptions = Ungrouped(...) \| Grouped(...)` 两种枚举，`session/set_config_option` 响应“always contains the complete configuration state”，category（model/model_config/thought_level）、modes 将弃用——报告“应兼容分组”的协议边界判断准确 |
| 13 | Codex App Server | delta 流式、结构化输出、用量事件独立、`tokenUsage.last/total` 分层 | **成立（本地 schema 已核验，外部再证事件流）** | [片段级] | app-server README：`turn/started`→`turn/completed`、per-item `item/started`→deltas→`item/completed`、**“Token usage events stream separately via `thread/tokenUsage/updated`”**；`v2.rs` 有 `Usage`（input/cached/output tokens）与 `TokenUsageInfo`；本地 `output/r18-codex-protocol/...schemas.json:21636` 的 `ThreadTokenUsage`（last/total 均 $ref）此前已直接读文件核验 |
| 14 | OpenAI Latency optimization / Anthropic tools | 少生成、少往返、明确工具语义、高频直达与冷工具发现取舍 | **成立（Anthropic 两条可直接对号入座）** | [片段级] | “Writing effective tools for agents”（2025-09-11）：namespacing、只返回高信号信息、token 效率、错误信息可操作；“Introducing advanced tool use”（2025-11-24）+ Tool Search Tool 文档：`defer_loading` 不破坏缓存前缀（“The prefix is untouched, so prompt caching is preserved”）、3–5 个高频工具不延迟、BM25/regex 搜索、85%+ 上下文缩减、>10K tokens/10+ 工具才值得；OpenAI latency optimization 页面存在但未取到正文片段（[存在性级]） |
| 15 | WPS 局部改写 / 飞象老师 | 官方资料仅支持产品能力说明，不能复原模型/接口/缓存/重试/提交链路 | **成立** | [片段级] | WPS 官方教程确认“AI 帮我改”：润色/改写/扩写/缩写/风格切换、**局部修改**（选中段落输入指令）、采纳/撤销；飞象老师 App Store 页（北京飞象星球科技有限公司）：“一句话即可生成专业级的交互教学动画与游戏化课件”，支持文字/语音/拍照生成、3500+ 学校/10 万教师——公开材料确实不足以复原内部架构 |

### 4.2 本次补全对首轮结论的增量修正

1. **tldraw 许可警告应升级（首轮评估已点出，现获确认）。** 报告只说“SDK 自有许可，生产使用另受约束”；实际 tldraw SDK 4.0 已把约束升级为**许可证密钥强制执行**（生产无 key 不可用，开发/localhost 豁免），且 2025-09-18 发布。本产品若只采用模板的“动作/引用模式”而非 SDK 本体，风险仍低；但若未来引入 tldraw SDK 渲染，必须把“license key + watermark 条款”计入成本。报告的“表述偏弱”判断成立，且这不是原文错误。
2. **Cloudflare“普通加权词法检索”表述需细化。** 官方文档口径是“ranked search”（`codemode.search()` 返回 ranked connector methods），并非“普通”检索；更重要的是其 OpenAPI connector 在 host 侧派生类型（零 prompt tokens）——这与报告“按需发现要以‘得到后即可调用’为终点”的诉求高度同构，可作为本产品“常用操作完整投影 + host 侧生成”的又一佐证。不改变报告结论，只是引用更精确。
3. **Pi 的证据点比报告更“实”。** Pi 的动态工具加载（message-anchored tool loading，2026 年 PR #6474）明确围绕“不破坏缓存前缀”设计，并保留了不支持模型的回退——这正好支持报告“不断删除已加载工具/重排工具集不一定更快，保持缓存前缀更稳”的判断；且其“结构化输出示例将机器数据与可读内容分开”与报告 Codex 分流建议同构。
4. **RouteLLM 两处引用均为“注释级”实锤。** “首轮训练数据”不是泛泛的边界提醒，而是 `controller.py` 源码内注释（`only trained on first turn data, so more research is required here`）；“embedding 请求开销”是 README 明确要求（mf/sw_ranking 路由器需 OpenAI embedding key）。报告把这两点列为“自动路由不宜先行”的依据，证据强度足够。
5. **OpenCode models-dev 的“超时≠根因”推断在新版本仍成立且有加强。** 除缓存/快照优先外，2026 年还出现 PR #45363（catalog 刷新与持久化解耦、失败保留旧目录、启动用文件缓存+内置快照），说明该方向是 OpenCode 的持续设计，不是某一版本的偶然行为。
6. **一个未解点如实保留：** ACP v2 文档中 `SessionConfigSelectOptions` 的分组形态（`Grouped(Vec<SessionConfigSelectGroup>)`）与 OpenCode `config-option.ts` 返回的扁平 `SessionConfigOption[]` 形态，二者是“v1/v2 不同版本 API”还是“同一 API 的可选形态”，搜索层面无法区分到版本级；这正落在报告“这是应兼容的协议边界，不能当成本次已证明的根因”的稳妥表述之内，无需修正。
7. **Excalidraw 许可的“保守表述”获支持。** 官方 `excalidraw/excalidraw-mcp` 主页未见独立 LICENSE 徽章（标 MIT 的是第三方 fork），报告“README 声明 MIT；核对树未见独立 LICENSE，直接复用前需核定”是审慎且正确的表述。

---

## 五、论证质量：优点与弱点

### 5.1 诚实性与严谨性（强）

1. 全程区分“已核对事实”与“结论”，明示“字符数≠token 数”“Agent 回合≠模型请求”“合计 7.1 秒不能当作串行关键路径”——这是同类报告中罕见的自我设限。
2. 明确声明“没有为本报告重新调用模型”、外部项目“未在本机运行延迟基准”、“性能目标与迁入方案均为建议，不能视为已实现或已验收”。
3. 证据边界表（附录 B 的许可/边界列、附录 D 的验证样例、附录 E 的“WPS/飞象老师只支持产品能力说明”）处理了“把别人快解释成用了某框架”的常见谬误。
4. 对不可证伪的说法保持中立：Auto 路由“后续评估”，不先入为主。

### 5.2 论证中的薄弱点

1. **单案例外推边界没有量化。** 全文的“慢”建立在一次 9 分半任务上，且该任务本身是失败路径（失败后扩大探索）。报告承认“不能称为成功修复”，但没有给出“慢的主要构成是模型的失败探索，而不是正常路径的慢”这一替代假说的权重分析。若正常路径（如改字号）本身只有 20 秒，则整份“断点清单”的边际收益就要重估。
2. **断点严重度无排序。** 6 个断点从“500 行代码的 UI 焦点问题”到“全新协议投影”，改善成本差 1–2 个数量级；报告按“问题发现顺序”罗列，未按“单位工作量可消除的无效时间”排序。作为决策报告，这是最需要补的一页。
3. **收益不可证的步骤 2 被放在承重位置。** 报告自己承认“不能无条件断言这些字段就是最大耗时来源”，而 9 分半任务中可实测的确定性事实只有：本地命令合计约 7.1 秒、输出 3 轮 186/336/16 秒。若剩余的 ~8.5 分钟主要是模型推理与原生服务等待，则“少生成字段/少往返”只能省它自身那一部分，且省下的或许是推理端已并行或在缓存内的成本。步骤 2 没有“先做 1 天最小实验证明收益非零”的门。
4. **与仓库既有目标脱钩。** 仓库基准评估已给出“简单任务初始文本能力说明≤12KB（当前约119KB）”“本地状态反馈<500ms”“可读事件到 UI 的 p95<300ms”等目标；报告建议的“数秒内得到结果”是不加定语的产品口号，既没引用既有目标，也没说明二者关系（一个 UI 反馈、一个端到端），容易在验收口径上打架。
5. **对“接口优先”缺乏对照实验设计。** 报告验证表（待证明属性）质量很高，但没有给出对照：同一任务在“改接口前/后”各跑 N 次的基线协议（报告说“先用局部协议和工具行为检查，再进行有限的真实调用”，这一步方向对，但没有写谁、几组、什么条件、什么判据决定“步骤 2 有效”）。
6. **OpenCode 一节只给出诊断方向，未给出决策。** 报告正确推翻了“models.dev 超时=下拉框失败根因”，但随后只列“建议在现有配置链路上完善”的观察项，没有回答“如果能力获取链路各阶段都正常、列表仍然空/不可选，下一步裁决是什么”。对一份决策报告，这是结论缺位（虽然诚实）。

### 5.3 与仓库规划的对照

| 报告内容 | 仓库既有对应 | 一致性 | 差异点 |
|---|---|---|---|
| 先修用量/阶段记录 | W09 性能（阶段计时与延迟诊断）、G07“分阶段测量” | 一致 | 报告没引用 W09 |
| 选中对象优先、按需发现、5200B→按相关性 | W02 当前状态观察、W09、G07 | 一致 | 报告没给出 ≤12KB 目标对齐 |
| afterCommit finish/observe | W04 一般编辑、W02 执行后验证 | 一致 | 报告把“人工应用预览+自动应用”之外的收尾语义讲得更细，是增量 |
| OpenCode 模型/强度、JSON 分流 | W01 原生交互、W07 教师交互、G04/G05 | 一致 | 报告对 ACP 分组兼容与零回合会话的描述更具体 |
| 自动路由不先行 | W09“依据实测与插件比较分位数；无证据不全归因” | 一致 | 报告补充了 RouteLLM/embedding 开销等外部依据 |
| 图片工具兼容性修复 | W05 图像路径验证、G01/G02 | 一致 | 报告明确“不能关闭 PNG 校验”，与“禁止静态化避差”的仓库红线一致 |

**结论：与仓库无冲突，且红线一致（不建第二工程真相、不改 V9、不开放 raw Store、失败零写入、不虚报成功）。主要缺陷是缺少互引与任务化——报告像一份“写给 Owner 的独立建议书”，而不是“挂在 W 包上的增量规格”。**

---

## 六、发现的遗漏与风险（独立视角）

1. **风险：步骤 2 是与 9 分半失败最无关的一大块。** 直接证据显示失败路径是“PNG 校验拒绝 → 模型转向替换操作 → 替换语义错误”。修复链是：工具兼容性（第一步）→ 错误返回语义（第三步的失败处理）→ 候选语义约束（第二步的接口语义化，防止再选替换）。真正直接决定“改色不再失败”的是工具修复与错误语义，接口/上下文改造是让“未失败路径更快”；报告步骤顺序正确但未点破“第二步与任务成功的因果关系最弱、工作量最大”，决策者应知悉。**补充一个独立交叉验算**：本次失败任务的初始请求只有约 1.74–2.10 万字符（报告明示字符数≠token 数，仅作量级参考，另附画面），而 G07 记录的 127KB 上下文膨胀（tools 87KB+dynamicCapabilities 32KB）是**另一次更早会话**的测量；即本次 9 分半的“慢”不能归因于上下文爆炸（本来就不大），这与“第二步收益主要来自上下文减量”的隐含预期相左，进一步支持给第二步设门。
2. **风险：`afterCommit: 'finish'` 的边界。** 报告声明“只对成功提交生效，不对错误/未提交生效”，且保持“回执留在会话、下次请求包含”，并承认“若 CLI 无‘不触发推理追加消息’能力，则在下次请求提供”。这是诚实且正确的。但实操中“finish 后宿主即结束本轮”会把“普通属性修改成功但缺少必要视觉校验”的责任转移给模型自觉；报告用“需要视觉/互动判断才继续”回应，而“是否需要”依然是模型判断——这里没有比“模型总是判断”更强的手段，只做了语义化。建议在候选 schema 上把“观察请求”做成显式字段（observe: {surfaces, runtime} 之类），而不是纯自然语言承诺。
3. **风险：目标引用 `selection:1` 的稳定性。** 报告已写“仅在同请求与版本内有效”，并拒绝历史会话指向；方向正确。但“选中对象在任务运行中被用户改选”这一最现实场景（仓库 T07 用例）没有在技术附录 A 中定义“epoch 漂移时的行为”（挂起？失败？重定向？），只在 D 表列了检查点。建议补一行语义：运行中目标变化 → 旧候选失效（stale，零写），状态可见。
4. **风险：OpenCode 模型目录的“后台刷新超时”推断附带条件。** 报告引用的是 v1.18.26 源码逻辑（磁盘缓存+内置快照优先、刷新失败忽略），结论“不能认定超时即下拉框失败根因”是稳妥的；但这是**某一版本某一实现**的行为，且报告也说“实际 wire 事件仍需核定”。建议把“本机 OpenCode 版本与内置快照版本”作为证据补进实施第一步（W01 能力探针），避免该推断被当作已定论。
5. **遗漏：没有讨论 Claude adapter。** 报告涉及 Codex（投影/用量）与 OpenCode（ACP/目录），Claude 仅在“保留原生循环”与外部参考中带过。仓库 W01 明确要求三 adapter 能力逐项实测；若 Claude 也缺图片输入/中途输入/模型与强度控制，接口改造要在三处分别落地，成本不是 1×。报告应至少声明“本报告结论对 Claude adapter 的适用性未核实”。
6. **遗漏：成本与安全维度几乎没有**——不是必需，但 9 分半任务在 token 层面的成本（27 个 null 用量事件无法计费）意味着“修可观测性”同时是“成本可归因”前提；报告把它当速度问题写，建议在第一步里加一句成本记录目标（每任务 token/费用），这对后续 Auto/路由决策（报告明确推迟）是前置条件。
7. **许可领域的表述强度不平衡。** 附录 B 对 Excalidraw（未见独立 LICENSE）与 tldraw（生产另受约束）都有提醒，方向正确；但对 tldraw SDK 4.0 的“许可证密钥执行 + 新 starter kit 许可模型”未展开（2025-09 发布），而对“本产品”借鉴的是模板动作与引用模式（通常不涉及 SDK 本体）。采用“机制”而非“代码”的边界报告已声明，此处只需在实施时重新核验许可证，不必在报告中展开。
8. **遗漏：量化的“一次发现”成本。** 报告给长尾查询的目标是“一次返回用途、参数、限制、目标必需信息和示例”，这是本产品自己生成器可保证的，构成其独特优势；但报告没有估算“生成器维护成本”（每次协议变化需重生成 8KiB 发现入口 + N 张卡）与“冷查询失败率目标”（如 ≤5%），建议在第二步加一个可测约束。

---

## 七、对决策者的建议（独立意见）

1. **采纳核心方向**：接口优先、AI 选操作、宿主准确执行、先修可观测性——与行业公开动向一致，且与仓库 W 包无冲突。
2. **把报告挂到既有规划上**：第一步 ≈ W01/W05/W09 的合并前置；第二步 ≈ W02/W09；第三步 ≈ W04/W07；第四步 ≈ W09 的后续。在正式合同中引用本报告为“决策依据”而非“规格”。
3. **给步骤 2 设门**：在实施接口改造前，先跑“同一短操作（改色/改字号/改组件参数）x 3 次”的现有基线（记录：请求到正确画面出现时间、稳定分位数、失败率、上下文字节数）；接口改造后同协议复测。若上下文从当前约 119KB 降到仓库既有目标 ≤12KB 而端到端时间无显著下降（例如下降 <20%），停止接口深化，转向 W09 的阶段诊断（区分宿主准备/CLI 启动/首个事件/首个正文/工具执行/准入/应用），并如实报告“瓶颈在模型与原生服务”。
4. **采纳后生效一个“诚实墙”**：任何提交成功回执不得声称视觉/语义正确（报告已正确主张），且“改色后画面稳定”应在宿主侧用真实画面观察（W02 三层观察）而不是等模型自述——这是报告推荐行为中最值得先落地的一条，因为它同时保护用户、模型与验收。
5. **OpenCode 与 Codex 的修复放第一步**（模型不可选、JSON 泄漏属于可用性缺陷，不属速度优化）——与报告一致，但建议同时记录三 adapter 的行为矩阵，避免只修 Codex+OpenCode、留下 Claude 隐性退化。
6. **不立即做自动路由**——同意报告；其前置（每任务 token/成本/延迟可归因）在第一步修完用量解析后才成立，顺序正确。

---

## 八、总评

**这份报告是高质量的中层决策文档：证据可复现（15/15 属实）、推理诚实（大量自我设限）、边界清晰（不建第二真相、不改 V9、不虚报成功），外部参照的选取与粒度（项目+提交+机制+许可边界）在同侪中属上乘。** 它的主要不足不是内容错误，而是“决策不够完整”：缺与仓库既有 W/G 规划的互引、缺步骤间收益的因果权重、缺步骤 2 的量化门槛与停损判据、缺 Claude adapter 适用性声明。

按原样执行是安全的（不会破坏工程），但预期收益最大的步骤 2 恰好是其中最昂贵且证据最弱的一环；因此**建议以“先修证据与已知错误 → 用最小实验给步骤 2 设门 → 收尾语义 → 模型层后置”的方式批准**，并把本报告追加到 W01/W02/W07/W09 的决策依据中，而不是作为独立路线执行。

---

## 附：证据等级说明

- [本地可复现]：本次直接读取源码/记录/HEAD，可复现。
- [片段级]：搜索引擎返回了对应文件/文档的实际代码或文字片段，可确认机制存在与方向正确；未能对报告引用的固定提交做逐行 diff。
- [存在性级]：仅确认项目/页面/提交存在与公开内容方向，未取到对应源码片段。
- [报告自证]：仅原文声明，本环境无法独立验证（如“9 分半”之外的原始事件流细节、外部分数）。
- 本评估未访问任何外部隐私数据；会话记录仅核对计数与时长。
