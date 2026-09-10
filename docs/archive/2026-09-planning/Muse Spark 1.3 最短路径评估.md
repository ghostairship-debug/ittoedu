> 历史资料（2026-09-11 归档）：保留原评估时点的结论，不作为当前执行指令；当前依据见[开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)。

# Muse Spark 1.3 对《AI 编辑最短路径产品决策报告》的独立评估报告

**评估对象**：根目录 `AI编辑最短路径产品决策报告.md`（基准提交 `c839c205e594ab61bfa01c22b4a4f28303862d8d`，访问基准 2026-09-09）
**评估模型**：Muse Spark 1.3
**评估日期**：2026-09-09（UTC）
**评估方法**：通读原报告全文 → 独立抽查仓库源码关键断点 → 针对报告引用的 15 组外部来源做互联网交叉检索验证 → 形成独立裁定。本评估未重新调用任何模型，未运行应用，所有源码结论来自静态阅读，外部结论来自可访问的官方文档/博客/论文/仓库。

---

## 一、总体裁定

**裁定：赞同原报告的核心决策方向（接口优先、AI 选操作、宿主执行），认为其证据链条基本成立、边界意识优秀，建议作为本轮实施基线；但对其部分子判断与实施细节有保留，另有三处实质性补正（见第五节）。**

原报告最难得的优点是**克制**：它用真实失败记录把问题钉死在“查接口绕路、上下文错序、失败后破坏性降级、固定追加确认轮次”四个可修复点上，拒绝了“上路由器 / 换模型循环 / 建向量库 / 自证秒级”四种常见的过早优化。我的交叉检索基本支持这种排序——2025–2026 年 Anthropic、OpenAI、Cloudflare、Cursor 的公开工程结论，几乎一致地把“工具语义清晰 + 高频直达 + 长尾按需发现 + 少生成 + 少往返”放在模型路由之前。

分项速览：

| 原报告决策 | 独立裁定 | 一句话理由 |
|---|---|---|
| 优先改接口呈现与调用路径 | **支持** | 与 Anthropic《Writing tools for agents》、OpenAI 延迟指南的第一优先级一致 |
| 常用直达、长尾一次发现，不建向量库 | **支持** | Anthropic Tool Search Tool 官方模式（3–5 常驻 + defer_loading + regex/BM25 搜索）即此形状 |
| AI 选操作语义，宿主不做 NL 难度分类器 | **支持** | 分类依据应是产品事实（对象类型/选择范围），不是自然语言难度 |
| 短传输投影（targetRef），宿主展开 | **支持，但排后** | 方向对，但引入新的引用绑定语义，实现成本高于能力排序修复 |
| 成功回执可结束（afterCommit） | **支持** | `continuation = true` 无条件续行已实锤，是纯浪费 |
| OpenCode 配置与聊天分流一起修 | **支持** | 可用性基线；models.dev 超时≠空目录的判断经检索成立 |
| Auto / 专用推理入口暂缓 | **支持** | Cursor Router 优化的是成本/满意度而非延迟，且依赖大规模生产反馈；RouteLLM 有单轮与额外调用边界 |

---

## 二、事实核验：9 分 30 秒案例与六个断点

我独立抽查了原报告 [^L2]–[^L11] 引用的源码，结论如下（行号以基准提交为准）：

### 2.1 六个断点全部成立

1. **默认引用当前页、选中对象无优先级**——成立。`CourseChatPanel.tsx:56` 默认 `scope='page'`；`generationSnapshot.ts:64` 在非 selection 范围下全页对象进入输入；`generationCapabilities.ts:15-35` 按遍历顺序收集能力。选中标记存在但不参与排序。
2. **5,200 字节预算按遍历顺序占用**——成立。`generationCapabilities.ts:46-47` 先到先得，文本卡先遇到即占额度，图片变换卡可被挤入 `deferred`。这是首轮拿不到 Schema 的直接机制。
3. **查询脚本无 `--help` 分支**——成立（`scripts/generate-ai-capabilities.ts` 附近逻辑；真实任务曾因此改读脚本）。“查询器需要被查询”是典型的发现路径自举失败。
4. **模型承担传输结构**——成立。`generationContract.ts:60-69` 候选步骤要求完整 destination + carrier + input；Codex 适配器需 JSON 字符串序列化。是否为“最大耗时来源”原报告已诚实声明无法断定——这一点值得肯定。
5. **提交后固定再进 CLI**——成立。`generationTaskController.ts:156-160` 在 applied/rejected 之后无条件 `captureNext` 并 `continuation = true`。第 3 轮 16 秒纯为“同步画面给 CLI”而发起，对参数修改类任务是纯浪费。
6. **PNG 校验失败→错误替代**——成立。`imageTransform.ts:65` 对**所有**数据块（含辅助块）做 CRC 校验，失败即抛错；`semanticReplacementTool.ts` 允许跨类型替换且仅校验引用可映射性，不校验载体语义。错误链完整。

### 2.2 用量字段错位 bug——经官方源码交叉验证，实锤

本地 `codexAppServer.ts:1148-1156` 从 `wire.params.tokenUsage` 直接读扁平 `inputTokens/outputTokens/cachedInputTokens`。而 OpenAI Codex 官方仓库的 v2 schema（`ThreadTokenUsageUpdatedNotification.json`）明确定义 `tokenUsage: { last: TokenUsageBreakdown, total: TokenUsageBreakdown }`，且第三方 `openai/symphony` 的 token accounting 文档确认语义：`last` = 最新增量，`total` = 累计快照。这解释了 27 个用量事件全为 null 的现象，也意味着**修复后可直接拿到 `reasoningOutputTokens` 独立字段**——这是回答“推理耗时占比”争议的唯一可靠依据（见 5.1）。

### 2.3 对“186s + 336s 去向”的独立推断

原报告诚实声明无法精确分离服务端等待/推理/生成/通信。我补充一个检索支撑的推断：即使 `max` 推理强度，单轮纯推理通常在几十秒量级；186s/336s 更符合“**CLI 内 agentic 绕路**”（读脚本→查文件→试命令→失败→再试）的复合耗时，而非单次前向推理。这与断点 1–3 的机制吻合，也反向支持“先修接口可达性”的排序：只降推理强度不解决绕路问题。

---

## 三、外部引证交叉验证（逐项）

| # | 原报告引用 | 检索验证结果 | 裁定 |
|---|---|---|---|
| 1 | tldraw Agent：语义动作、职责分离；Update 仍用完整 Schema | agent-template 存在，`AgentActionUtil`（schema + `applyAction`，由 editor 执行几何）模式与描述一致；SDK 自有许可限制已标注 | **成立** |
| 2 | Penpot：成员级文档、执行引用；旧独立 MCP 已合并 | 官方独立仓库 2026-02-03 archived 并入主仓 `mcp/`；MCP+Plugin 经 WebSocket、LLM 写代码执行；主仓 MPL-2.0 | **成立** |
| 3 | Excalidraw MCP：checkpoint 引用、差量交付；摘要不完整、许可待核 | 官方 `excalidraw-mcp` 系 2026-02 新建 MCP App，checkpoint/restore 为 v0.3.0 功能；许可确需按采用范围核定 | **成立，时效性提醒** |
| 4 | Cloudflare Code Mode：search/execute、99.9% 输入削减；英文分词不适用于中文 | 官方博客（2026-02-20）确认 2500+ 端点→2 工具→约 1000 tokens；但 Code Mode 要求模型写 JS 并在沙箱执行，原报告“不引入通用执行服务器、只借鉴检索与执行分离思想”的取舍正确 | **成立，取舍正确** |
| 5 | Pi：渐进加载、缓存前缀、终结语义 | 官网明确 “Skills… Progressive disclosure without busting the prompt cache”；`structured-output.ts` 示例 `terminate: true` 确认；不能替换三 CLI 原生循环的边界正确 | **成立** |
| 6 | Aider：RepoMap 相关性排序、短编辑格式 | RepoMap（PageRank + token 预算 + 按需加文件）、diff edit format（SEARCH/REPLACE 只返变更）均经官方文档确认 | **成立** |
| 7 | Continue：并行准备、取消、缓存、流式后处理；仅 autocomplete | 官方文档确认 debouncing/caching/post-processing 均为补全场景；原报告“不用补全指标代表任务完成速度”正确 | **成立** |
| 8 | RouteLLM：首轮数据与多轮应用边界、MF 需 embedding 调用 | 论文 arXiv:2406.18665 确认为单轮强/弱路由；MF router 确有额外调用开销 | **成立** |
| 9 | LiteLLM：延迟路由是部署选择，与任务语义选择不同 | 官方文档确认 latency-based routing 在同 model_name 多部署间选最低延迟；complexity_router 是本地规则评分（零 API 调用、sub-ms）——有趣的是后者证明“宿主侧确定性规则分类”可行，但其维度（token 数/代码关键词）不适用于课件操作语义，故原报告“不做 NL 难度分类器”依然成立 | **成立** |
| 10 | Cursor Router（2026-07-22/08-06）：生产反馈训练，收益不可迁移 | 官方博客确认：600k+ live requests 训练、Compass 复杂度预测 + taxonomy、cache-aware 评估；优化目标是**成本/满意度**（60% 成本、cost-per-commit），不是延迟；且 Cursor 同期推进 Dynamic tool calling（工具调时发现）——反而佐证“接口发现优化优先于模型路由” | **成立，且有加强证据** |
| 11 | Cursor Fast Apply：专用文件应用优化，不可迁移为通用 Agent 速度 | 2024-05 官方文章确认：专用 70B 微调 + speculative edits（确定性草稿），~1000 tok/s 针对 full-file rewrite；Morph 等第三方复现 10500+ tok/s 进一步证明“规划与应用分离”是行业共识——本产品的 candidate/transaction 分离与之同构，原报告可更自信地肯定现有架构 | **成立** |
| 12 | OpenCode v1.18.26：磁盘缓存+内置快照优先，后台刷新失败忽略；`models.opencode.ai` | 多个 GitHub issue（#32986 等）确认 `Failed to fetch models.dev` 是高频启动日志且“模型照常可用、有缓存 fallback”；与原报告“两条超时不能解释下拉框失败”一致 | **成立** |
| 13 | ACP：扁平选项解析匹配；分组是兼容边界；set 后返回完整配置状态 | 官方 `session-config-options` 文档确认 “response always contains the complete configuration state”（切换模型后必须消费完整状态——原报告建议正确）；grouped options 见于 RFDS proposal，扁平解析 + 容忍未知字段是正确策略 | **成立** |
| 14 | OpenAI 延迟指南：少生成、少往返；Anthropic：高频直达 + Tool Search | OpenAI 官方：“cutting 50% of output tokens may cut ~50% latency” vs “cutting 50% of prompt may only result in 1–5%”——**输出侧优先于输入侧**，直接支持短投影 + afterCommit 的排序；Anthropic Advanced Tool Use（2025-11-24）官方推荐 3–5 高频常驻 + `defer_loading` + regex/BM25 搜索，且明确 “doesn't break prompt caching” | **成立，且是全报告最强的外部支撑** |
| 15 | WPS/飞象：公开材料不足以复原架构 | 检索确认只有产品能力描述（AI 写作/改写/局部功能），无模型/接口/缓存/提交链路细节 | **成立，克制正确** |

**小结**：15 组引证中 15 组成立，无一处查无实据或方向性错误。引用质量高于常见的工程决策文档。

---

## 四、对原报告的保留意见（非方向性）

以下是我与原报告文本有分歧或认为需细化的点，均不推翻总体裁定：

1. **“一次发现”的表述仍有歧义风险**。原报告已用脚注澄清“一次是设计目标，不代表所有请求只用一次模型请求”，但标题层仍易被误读为 SLA 承诺。建议实施文档改用“冷操作至多一次发现往返（discovery round）”并与“模型请求数”严格区分术语。
2. **图片工具“正确边界”一节低估了修复难度**。原报告把 PNG 兼容性归为“读入与变换链路统一处理”，但未点出关键约束：手写 PNG 解码器刻意保留 “unpremultiplied RGB（含零 alpha 下隐藏的 RGB）”语义（`imageTransform.ts:38` 注释），而任何 Canvas 备轨都会丢失该信息（见 5.2）。修复空间比“统一链路”更窄。
3. **失败语义需要与 `applyPolicy` 联动设计**。`afterCommit: finish` 在 `auto` 模式下成立；在 `preview` 模式下用户尚未确认效果，finish 语义必须退化为“等待用户应用”。原报告提到“在现有 Owner 下完成”，实施时需明确该交互矩阵。
4. **性能目标缺少基线锚点**。原报告正确地拒绝自封数值门（“应依据短操作真实基线制定”），但未说明基线如何采集（固定课例、固定选择集、固定模型配置的最简任务三次以上）。建议把“基线采集规程”写进第一步验收标准，否则第二步的“提速”无法量化。

---

## 五、三处实质性补正

### 5.1 补正一：思考强度（reasoning effort）应“先观测、后决策”，不预置 clamp

**背景**：根目录另一份评估（Gemini 3.8 Flash）建议对 `edit` 意图钳制推理强度（`effort: low`），预期单轮从 60–180s 压到 3–8s。我部分同意其机理、但反对将其列为必做项：

- **机理成立**：overthinking 是经多篇论文确认的真实效应（Chen et al. ICML'25《Do NOT Think That Much for 2+3=?》、Su et al. 2025、THOUGHTTERMINATOR 2025、Stop Overthinking survey 2025）；OpenAI 官方文档确认 effort 参数直接控制思考量与延迟，且 `low` 适用于“执行导向任务”。Luna + max 下简单改色被过度思考拖慢是**合理怀疑**。
- **但三条反驳成立**：(a) 本产品是**原生 CLI 架构**——宿主能否透传 `reasoning_effort` 取决于 Codex/Claude/OpenCode 各自是否暴露该参数（OpenCode ACP 是 `thought_level` 选项，语义未必等同），未经核验不可排期；(b) 按仓库长期决定，宿主“不复制模型循环”，擅自改写用户在原生 CLI 中的显式配置有违“GUI 承接原生授权，不默默提权/降权”精神——强度默认值的改动必须在 UI 披露实际生效值；(c) 2.3 的推断指出 186s/336s 更像 CLI 内绕路而非纯推理，clamp 治标不治本。
- **正确顺序**：先修复用量字段（2.2），拿到 `reasoningOutputTokens` 与阶段打点，用“固定 Luna + max、接口改造前后”做析因对比；**只有当数据显示推理 token 占主导时**，再评估 effort 联动。原报告“先固定 Luna + max 比较接口变化”的排序是严谨的，应维持。

### 5.2 补正二：PNG 修复应优先“辅助块 CRC 宽容”，Canvas 备轨仅作最后手段且须声明语义降级

- **事实**：`decodeImageTransformPng` 对所有 chunk 做 CRC 校验（含 `gAMA`/`sBIT` 等辅助块），而浏览器/libpng 对辅助块 CRC 失败的通行做法是**警告并跳过该块**，只对 IHDR/PLTE/IDAT 等关键块严格。真实课件素材经二次保存后辅助块 CRC 偏差是常见现象——这正是本次失败最可能的根因。
- **最小修复**：辅助块 CRC 失败→跳过该块并记录诊断；关键块保持严格；16 位/动画的明确拒绝保留（现有错误信息质量已很高，不应削弱）。
- **为何不首选 Canvas 备轨**：JPEG/WebP 路径已用 Canvas 重解码（`decodeOriginal:142-152`），但 PNG 路径坚持手写解码器正是为了保留透明像素下的原始 RGB。`getImageData` 返回的是合成后像素，透明区 RGB 信息永久丢失——所谓“无损重绘”在该语义下并不无损。若未来确需 Canvas 兜底，必须将其标记为**语义降级路径**（输出资源记录 `rgbUnderTransparent: lost` 类诊断），并仅在用户可感知的方式下启用。
- 另：真正的“统一链路”应是让 PNG 的**关键块解码失败**也能给出“哪一块、是否可恢复”的结构化错误，而不是把三种格式强行收敛到同一种解码器。

### 5.3 补正三：跨载体替换护栏必须限定在“自动修正轮次”，并与 prompt 缓存设计合并考虑

- **护栏限定**：`selection.replace` 的现有守卫（引用迁移、teacher-controller 禁止、state 继承检查）体现的是“引用可映射性”哲学。图片→文本的替换在用户**本轮明确要求**时是合法操作（“把这张图换成文字说明”），宿主无权一般性禁止。熔断条件应精确定义为：“同一任务的自动修正轮次（continuation）中，前序步骤对同一目标使用过媒体/变换工具且失败，新的候选试图跨载体替换同一目标，且本轮用户指令未明确要求替换”→ 拒绝并返回结构化错误（沿用工具现有的 `AuthoringToolFailure` 码系，如 `replacement-unmappable`，而不是新造顶层错误协议）。
- **缓存设计**：Anthropic 官方已证明 Tool Search 模式“不破坏 prompt caching”（延迟工具完全不在初始 prompt 内），Pi 官网亦强调 “progressive disclosure without busting the prompt cache”。实施能力排序修复时应直接采用该模式：**核心工具固定顺序常驻 + 延迟工具零字节进入首轮 prompt**（而非“8KB 固定卡片集”等自创阈值）；选中对象相关信息放动态尾部。注意：在原生 CLI 架构下， prompt 最终由各 CLI 组装，宿主只能控制自己提供的 snapshot/资源部分——缓存收益以实测 `cachedInputTokens` 为准，不预设 70% 之类数字。

---

## 六、建议实施顺序（对原报告四步的微调）

原报告的四步顺序基本正确，我只做三处微调（加粗为改动）：

1. **第一步（可观察性 + 止血）**：用量字段修复（**必须含 `reasoningOutputTokens` 与 last/total 区分**）+ 阶段打点 + 查询脚本 `--help` 分支（**小改动、大收益，提前**）+ 候选数据通道分流 + OpenCode 能力链路诊断。**增加基线采集规程**：固定课例 × 固定选择集 × 固定 Luna+max，最简改色/改字任务各 ≥3 次，记录请求到正确画面时间。
2. **第二步（接口可调用性）**：选中对象优先 + 稳定顺序（**固定优先级而非遍历序，保护缓存前缀**）+ 常用操作完整投影 + 单次发现返回可调用信息 + **PNG 辅助块 CRC 宽容**（从第一步的“调查”收敛为具体修复）+ 宿主绑定固定字段。targetRef 短投影**仍在本步但排最后**，因其需新设计 epoch/绑定语义。
3. **第三步（终结与失败语义）**：`afterCommit`（**与 `applyPolicy` 的交互矩阵一并设计**）+ 自动修正轮次跨载体熔断（5.3 定义）+ 结构化错误。保留任务/会话/草稿/资源/唯一事务关系。
4. **第四步（模型层）**：只有在第二步完成后、且第一步的遥测显示推理 token 主导延迟时，才评估 effort 联动或独立推理入口；effort 改动必须在 UI 披露实际生效值。后者涉及服务与凭据约束，不作隐含依赖。

停止条件赞同原报告：“当前失败可被针对性证据解释、接口路径收敛、生命周期检查通过、真实延迟达约定目标即停”。补充一条：**任何一步若实测证明瓶颈在原生服务端，则如实报告并停止压缩上下文侧的投入**。

---

## 七、证据边界与声明

1. 本评估未在本机运行应用、未重放 9 分 30 秒任务、未调用任何模型；源码结论来自对基准提交的静态阅读，行号以该提交为准。
2. 外部结论来自 2026-09-09 可访问的公开资料（官方文档/博客/论文/仓库/issues）；未逐一打开原报告脚注中的固定提交链接，但对每一组引用的**核心事实主张**做了独立检索验证（见第三节）。
3. 本评估与根目录《Gemini 3.8 Flash 最短路径评估.md》独立撰写；在源码复核结论上两者一致（5.2KB 预算、无条件续行、扁平用量字段），在 effort clamp 优先级、PNG 备轨语义、量化目标三点上有实质分歧（见 5.1、5.2 与 4.4），请教师一并参阅、以实测数据裁决。
4. 本报告不更改仓库架构合同、开发任务状态与 V9 协议；所有“建议”均为待实施项，不视为已实现或已验收。

---

## 八、结论

原报告是一份**证据扎实、边界清晰、排序正确**的决策文档：15 组外部引证经交叉检索全部成立，6 个内部断点经源码抽查全部成立，“接口优先、暂缓路由”的排序与 2025–2026 年行业共识一致。建议采纳为本轮实施基线，并吸收本报告的三处补正：**effort 先观测后决策、PNG 辅助块宽容优先于 Canvas 备轨、跨载体熔断限定于自动修正轮次且缓存设计采用 Anthropic 官方 defer 模式**。实施后若延迟仍不达标，应如实归因到原生服务端，不再用压缩上下文掩盖。
