> 历史资料（2026-09-11 归档）：保留原评估时点的结论，不作为当前执行指令；当前依据见[开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)。

# Kimi 最短路径评估

评估对象：根目录《AI编辑最短路径产品决策报告》（下称"原报告"）。
评估人：Kimi（Kimi Code CLI，Moonshot AI），独立评估，未参与原报告撰写。
评估日期：2026 年 9 月 9 日。
方法：(a) 通读原报告全部 311 行；(b) 对原报告引用的本地源码事实做独立抽查复核；(c) 对原报告引用的外部开源项目、官方文档与竞品资料做互联网检索核验；(d) 在核验基础上形成独立的同意、保留与补充意见。

## 一、总体结论

**我同意原报告的核心决策方向**：以"接口优先、AI 自主选择操作、宿主准确执行"为本轮改进主线，保留三 CLI 原生模型循环，不先做自动模型路由。这个判断与公开生态的实际形态一致——tldraw、Penpot、Cloudflare、Anthropic 近一年发布的能力全部指向"让工具更可发现、调用更短、上下文更相关"，而不是"换一个 Agent 平台"。

原报告的**证据纪律显著优于同类内部文档**：明确区分了"已核对事实"与"不能得出的结论"，对单一案例的归因限度、Cursor Router 收益的不可迁移性、WPS/飞象公开资料的推断边界都做了声明。这些声明不是套话——我在核验中没有发现任何一处外部引用被夸大使用。

但原报告有三处实质性薄弱点，详见第四节：(1) 核心证据只有一个任务样本，紧迫性叙事与归因精度不匹配；(2) 漏掉了一组成本极低、归因价值极高的对照实验；(3) 对 OpenCode 模型不可选问题，公开 issue 库中存在比"后台刷新超时"更直接的根因候选，原报告未检索到。

## 二、本地事实抽查复核（全部属实）

我独立打开了原报告脚注 [^L2][^L4][^L7][^L8][^L10][^L11] 指向的源码位置，逐项核对：

| 原报告断言 | 我的核验结果 |
|---|---|
| 能力卡按遍历顺序装入 5,200 字节预算，超出延迟加载 | 属实。`src/renderer/authoring/generation/generationCapabilities.ts:46` 确实以 `TextEncoder().encode(...).byteLength <= 5_200` 为界，按 `desired` Map 的插入（即页面遍历）顺序入卡，无相关性排序 |
| 聊天默认引用范围是 `page` 而非选中对象 | 属实。`src/renderer/ui/chat/CourseChatPanel.tsx:56`：`useState<GenerationReferenceScope>('page')` |
| 提交或拒绝后固定采集下一份观察并继续 CLI 执行 | 属实。`src/renderer/authoring/generation/generationTaskController.ts:156-160`：无论 `receipt` 是否存在，都 `captureNext` 并以 `continuation = true` 进入下一循环，没有"成功后结束"分支 |
| PNG 解码失败报"数据块校验失败" | 属实。`src/renderer/project/imageTransform.ts:65`：CRC 不匹配即 throw。值得注意：这是自写的严格 PNG 解码器（拒绝 16 位、APNG/acTL、CRC 错误的任何数据块），而图片**显示**走浏览器解码——浏览器对辅助块的 CRC 错误是宽容的。这独立证实了原报告"图片能显示但无法变换是读入链路兼容性问题"的诊断方向，且指明了最可能的机理：真实世界的 PNG 只要有一个 CRC 损坏的辅助块就会被此解码器整体拒绝 |
| 图片变换契约只有换色/裁剪/缩放 | 属实。`src/shared/imageTransformContract.ts:18-24`：`replace-color`、`crop`、`resize` 三个 strict 分支，无生成式编辑 |
| Codex 用量读取平面字段，而原生协议为分层结构 | **属实且比原报告所述更确定**。适配器 `src/main/localAgent/codexAppServer.ts:1148-1157` 直接读 `usage.inputTokens/outputTokens/cachedInputTokens` 平面字段；而仓库自己抓取的协议 Schema（`output/r18-codex-protocol/codex_app_server_protocol.v2.schemas.json:21636`）明确定义 `ThreadTokenUsage = { last: TokenUsageBreakdown, total: TokenUsageBreakdown, modelContextWindow }`，两层结构、均为必填。平面读取在这种 payload 上必然全部落 null——与真实会话 27 个用量事件全 null 的观测完全吻合。原报告谨慎表述为"版本映射疑点"，我的判断是：除非本机 Codex 实际 wire 版本旧于该抓取 Schema，否则这就是已定位的解析 bug，不只是疑点 |

唯一未能核验的是 [^L1]（九分半改色任务的会话记录）：该文件在用户配置目录而非工作区内，我未读取。原报告基于它给出的时序与字符数数据我无法独立复查，这是本评估的证据边界之一。

## 三、外部来源核验（全部存在，引用方式基本诚实)

| 原报告引用 | 核验结果 |
|---|---|
| tldraw Agent：短对象引用、Move 等语义动作、动作/上下文/聊天职责分离 | 属实。官方 [Agent starter kit](https://tldraw.dev/starter-kits/agent) 与 [agent-template 仓库](https://github.com/tldraw/agent-template) 确认 AgentActionUtil 按动作粒度扩展能力 |
| Penpot MCP：成员级 API 文档、执行环境保留中间引用 | 属实。[Penpot 官方 MCP](https://help.penpot.app/mcp/) 已发布，独立旧仓已合并入主仓，与原报告"旧独立 MCP 已合并"的表述一致 |
| Excalidraw MCP：checkpoint 引用复用状态 | 属实，但原报告的边界声明尤其必要：官方 [excalidraw-mcp](https://github.com/excalidraw/excalidraw-mcp) 本质是"prompt in, diagram out"的一次性 widget 加 checkpoint 存储，社区实现（如 yctimlin/mcp_excalidraw）反而提供元素级 CRUD。原报告只借鉴"宿主状态引用"而非整体方案，取舍正确 |
| Cloudflare Code Mode：词法搜索 + 方法级 describe + 执行 | 属实。[官方博客](https://blog.cloudflare.com/code-mode-mcp/) 确认 search/execute 两工具承载 2,500+ 端点（约 1,000 token vs 传统 1.17M）。原报告额外指出的限制——搜索按英文分词、不能照搬处理中文——与公开实现描述一致，是负责任的使用方式 |
| Pi：渐进工具加载、缓存前缀、结构化终结 | 属实。[earendil-works/pi](https://github.com/earendil-works/pi) 确实存在且活跃，[release 记录](https://github.com/earendil-works/pi/releases)可见 deferred/message-anchored 工具加载的演进 |
| Aider：按目标组织上下文、短编辑格式 | 属实。[repo map 与 edit formats](https://aider.chat/docs/more/edit-formats.html) 为公开文档 |
| RouteLLM：首轮训练数据与多轮应用有边界、MF 路由器先过 embedding | 属实。[arXiv:2406.18665](https://arxiv.org/abs/2406.18665) 是基于 Chatbot Arena 偏好数据训练的单查询路由框架，原报告"不宜先行"的结论与论文适用范围相符 |
| LiteLLM：延迟路由是部署选择而非任务语义选择 | 属实。[官方文档](https://docs.litellm.ai/docs/proxy/load_balancing)确认 latency-based-routing 面向 deployment 级负载均衡 |
| Cursor Router / Fast Apply：公开参考但收益不可直接迁移 | 属实。[Router 博客（2026-08-06）](https://cursor.com/blog/how-cursor-router-works)确认其 Compass 复杂度预测器基于生产反馈训练；[Instant Apply](https://cursor.com/blog/instant-apply) 的 1000 tok/s 属于专用 apply 模型 + 推测解码。原报告拒绝把这两者当可安装方案，正确 |
| Anthropic：写有效工具、Tool Search Tool | 属实。[Writing effective tools for agents（2025-09-11）](https://www.anthropic.com/engineering/writing-tools-for-agents) 与 [advanced tool use（2025-11）](https://www.anthropic.com/engineering/advanced-tool-use) 均在原报告所述日期存在，Tool Search Tool 按需加载工具的官方数据（77K→8.7K token）支持"按需发现"方向 |
| OpenAI 延迟优化指南 | 属实，[developers.openai.com 该指南存在](https://developers.openai.com/api/docs/guides/latency-optimization) |
| OpenCode：models.dev 缓存/快照/后台刷新；ACP 配置选项 | 属实。[OpenCode 文档](https://opencode.ai/docs/cli/)确认其由 models.dev 驱动；ACP 的 [Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options) 存在且支持分组 |
| WPS AI / 飞象老师 | 存在。WPS 有[教师场景 AI 功能](https://home.wps.cn/topic/7875)，[飞象老师](https://baike.baidu.com/item/%E9%A3%9E%E8%B1%A1%E8%80%81%E5%B8%88/67851117)确有"教案生成互动课件"产品形态。原报告只用它们说明"竞争产品存在"而不推断其内部架构，分寸恰当 |

结论：原报告 15 组外部引用无一虚构、无一时点错误，且多次主动声明引用物的适用边界。这在内部决策文档中是不常见的高质量。

## 四、独立分析：薄弱点与遗漏

### 1. 核心证据是 n=1 的单任务样本，紧迫性叙事超出了归因精度

原报告全部问题诊断建立在一次九分半的改色任务上。它自己承认"不能精确分离服务端等待、推理、输出生成和通信"——这个承认是对的，但整份报告的优先级排序（接口呈现 > 上下文选择 > 终结轮次 > 模型层）实际上已经隐含了一个归因假设：**可避免的查接口与组装负担是主要耗时项**。这个假设没有被证实。

另一种同样自洽的解释是：Luna + max 配置下两次主力推理（186s、336s）本身就是高推理强度长输出的正常服务端耗时，本地 38 次命令合计 7.1 秒也支持"瓶颈不在工具执行"。如果这个解释为真，接口优化能把任务从三轮压到一轮，但单轮仍可能是分钟级——提速存在，却远达不到"数秒内得到结果"的产品目标。原报告附录 E 对此有一句"优化后剩余延迟是否主要来自原生服务，需要实测"，态度正确，但它被放在附录里，而它实际上是决定整个方案成败预期的头号未知数。

### 2. 漏掉了一组成本极低、归因价值极高的对照实验

原报告决定"先固定 Luna + max，验证接口变化"——作为实验控制这是对的。但在改任何接口之前，存在一组几乎零成本的对照：**用同一课件、同一改色任务，分别以 (a) 同模型低强度、(b) 另一 CLI/另一模型 各跑一次**。两次真实调用（可能还需要一两次重跑控制随机性）就能粗略分离"推理强度主导"还是"接口/上下文主导"，直接回答第四节第 1 条的头号未知数。原报告把这个比较放到了第四步（"若正常路径仍慢再比较"），这意味着要先投入第二、三步的全部接口改造工作量，才获得本该最先拥有的归因数据。我建议把该对照实验提前到第一步，与修复用量记录并行——修好的用量解析恰好能让这组对照产生精确的 token/耗时分解。

### 3. OpenCode 模型不可选：存在更直接的公开根因候选

原报告对"模型目录超时"做了细致的源码级反驳（缓存+快照机制使后台刷新失败不致空目录），这个论证我核验为成立。但它漏了一个更相关的公开事实：OpenCode 仓库存在 [issue #13644 — ACP sessions ignore model selection from ACP clients](https://github.com/anomalyco/opencode/issues/13644)，指出 ACP `session.ts` 的 create() 未正确处理客户端传入的 model 参数；ACP 生态中还存在适配器拒绝 `session/set_config_option` 导致会话立即失败的[相关报告](https://github.com/openclaw/openclaw/issues/81250)。也就是说，"ACP 通道上模型选择不生效/配置选项协商失败"是该版本的**已知生态缺陷类别**，比 models.dev 刷新超时更接近"界面无法选择模型"的直接根因。原报告建议的"记录各阶段返回、区分启动失败/解析失败/真实空目录"仍然正确，但排查清单应把这个 issue 类别列为高优先级候选。

### 4. `afterCommit: finish` 的完成声明机制需要一个未明言的兜底

附录 A 让模型在候选中声明"提交后完成"还是"提交后继续观察"，并声明宿主"只在真实提交成功且满足接口自身条件时遵循"。方向正确（把终止权交给最了解任务的一方，同时保留宿主否决权），但有一个未充分展开的风险面：模型对"无需观察"的判断本身会出错——例如换色任务声称 finish，但替换色实际命中了不该命中的共享实例。当前 `imageTransform` 契约层没有"影响面"字段让宿主独立判断是否需要观察。建议候选协议在引入 `afterCommit` 的同时，要求宿主回执携带结构化的影响摘要（改动对象数、是否触及共享实例、未请求字段是否变动），让"是否还需要观察"成为可复核的事实而非模型的单方面声明。原报告"改色没有改变形状"的验证项（图像尺寸/透明度保持）已经隐含这个需求，但没有落到协议字段层面。

### 5. 次要遗漏

- **上下文增长的成本没有量化**：三轮输入 1.74 万 → 1.77 万 → 2.10 万字符，说明每轮都携带累积历史。原生会话的 prompt cache 命中率未知（与用量解析 bug 修复直接相关），但"第一轮失败、第二轮换方案重发全部上下文"的失败模式，正是缓存失效最贵的路径。Pi 的"保持缓存前缀、不无意义重排工具"被原报告引用了，但建议落到自己系统时，还应包括"失败重试轮尽量复用前轮前缀"这条具体策略。
- **中文检索问题被识别但低估了其工作量**：原报告指出 Cloudflare 式英文分词不能照搬，建议用已有中文能力说明与别名。这可行，但"红色换成绿色""把图变绿一点""调成绿的"这类口语变体靠手工别名覆盖不全；好在规模小，结构化过滤（对象类型 × 操作枚举）确实能兜住大部分，我同意不建向量库的结论。

## 五、结论与建议

原报告是一份可以据此立项的决策文档：方向判断正确、引用全部属实、边界声明诚实、停止条件明确。它的主要风险不在内容错误，而在**执行顺序**——把最便宜的归因实验排到了最后。

我的建议调整（按优先级）：

1. **立即修 Codex 用量解析**（分层 `tokenUsage.last/total`）。已核实为字段层级不匹配，改动极小，且它是后续一切延迟归因的前提。
2. **把"同任务对照实验"提前到第一步**：固定任务与课件，跑 同模型低强度 / 另一模型 各至少一次，配合修好的用量记录，先回答"瓶颈在推理服务还是在接口路径"。这一步改变原报告第一、二步内部顺序，但不改变方向。
3. **OpenCode 排查清单加入 ACP 模型选择已知 issue 类别**（#13644 及 set_config_option 协商失败），不要只沿 models.dev 超时方向查。
4. 第二、三步按原报告执行；其中 `afterCommit` 机制补充**宿主回执携带结构化影响摘要**，作为完成声明的可复核依据。
5. 图片解码兼容性单独立项：自写严格 PNG 解码器对 CRC 错误辅助块的整体拒绝，与浏览器显示路径的宽容度差异，是"能显示不能变换"的最可能机理；修复方向是跳过/容错非关键辅助块，而非放宽对像素数据本身的校验。

如果第 2 步的对照实验显示分钟级延迟主要来自原生推理服务，则原报告第二、三步的接口改造应**照常进行但下调提速预期**——它消除的是无效往返与错误路径（这本身值得做，九分半任务的错误替代就是证明），而不是把短操作带进秒级。届时再按原报告第四步讨论模型层变化，证据基础就完整了。

## 六、本评估的证据边界

- 未读取 [^L1] 所指的用户配置目录会话记录（在工作区之外）；九分半时序、字符数、命令次数均按原报告转述采信，未能独立复查。
- 未复现原报告引用的各开源仓库固定提交的全部源码行；核验以官方文档、仓库主页、协议规范与公开 issue 为准。
- 未运行任何真实 CLI 任务；本报告不含新的性能测量。
- Codex wire 版本的实际 `tokenUsage` 形态仍需按原报告建议以真实记录终验；我的"已定位 bug"判断基于仓库自抓 Schema 与适配器代码的静态比对。
