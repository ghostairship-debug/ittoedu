> 历史资料（2026-09-11 归档）：保留原评估时点的结论，不作为当前执行指令；当前依据见[开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)。

# Claude Fable 5.1 最短路径评估

评估对象：根目录《AI 编辑最短路径产品决策报告》（下称“原报告”）。评估日期 2026-09-09。已参照根目录另四份评估（Gemini 3.8 Flash、Kimi、Muse Spark 1.3、deepseek-v4-flash-vision-exp），本文只在它们之外补充新证据、指出可被证伪的判断，并给出修订后的实施顺序。

## 一、结论

1. **方向裁定成立，但成本定位需要修正。** “接口优先、AI 选操作、宿主准确执行、保留原生循环、暂缓自动路由”与本地源码、官方文档和实际记录一致。原报告列出的六个断点全部核实存在。但原报告与四份评估都把“用量为 null、无法量化推理与生成成本”当作前提，而 Codex 自己的原生会话记录（`~/.codex/sessions/.../rollout-*.jsonl`）完整保存了 27 次模型请求的 token 与时间。读它之后，九分半的构成可以直接分解，不需要重新跑任务。[^R1]
2. **最贵的两个问题原报告没有列出，且都是应用侧一行级改动：**
   - 每轮 `turn/start` 的 `outputSchema` 内嵌本轮 `requestId` 常量，而 OpenAI 官方文档明确结构化输出 Schema 属于缓存前缀。三轮首请求的缓存命中都是 0，共 202,442 个未缓存输入 token，占全部未缓存输入的 73.5%；第三轮为了得到一句 209 token 的“已完成”，重新处理了 108,874 个 token。[^L1][^O1]
   - 应用用默认模型创建线程后再在 `turn/start` 切到 `gpt-5.6-luna`，触发 Codex 注入 46,246 字符的 `<model_switch>` 开发者消息（完整的另一套模型指令），与 21,261 字符的线程基础指令并存于每次请求。`thread/start` 本身支持 `model` 参数。[^L2][^C1]
3. **“JSON 泄漏”的根因比原报告写的更深。** 整轮 `outputSchema` 使本轮所有 assistant 消息（含中途进展）都只能是 JSON 信封；记录里没有任何一条纯文本 assistant 消息。第一轮开始 17 秒时模型甚至先输出了一个把 `opacity` 改为 1 的无效 `kind:edit` 候选。这不是聊天组件少剥了几个标签，而是“整轮结构化输出”与“公开进展用自然语言”两条要求互相冲突。[^R2]
4. **PNG 失败的根因是测试夹具本身写错了 4 个字节，不是解码器过严。** `mixed-figure.png` 是维基百科 1×1 红色 PNG 示例的手工转写，IDAT 内 zlib 的 Adler-32 尾部被写成 `00 03 00 01`（正确为 `03 01 01 00`），而块 CRC 仍是正确数据的 CRC。像素数据完整，所以 `<img>` 能显示红色；但 Chromium 的 `createImageBitmap` 与 WebCodecs `ImageDecoder` 同样拒绝该文件。因此 Gemini 评估的“`createImageBitmap` 备轨”对本例无效，Muse/Kimi 评估的“辅助块 CRC 宽容”也无效（IDAT 是关键块）。[^F1][^F2]
5. **产品层面真正的教训是：宿主在第一轮开始前就知道这张图无法解码（`image-decode-failed` 诊断），却只写进一个文件，让模型在 76 秒后自己读到，仍然把 `asset.image.transform` 呈现为可用能力；拒绝回执只有一句“s1: PNG 数据块校验失败”。** 两轮探索、一次错误替换和模型自己用 `node zlib` 做二进制取证，都源于这一条信息没有成为“能力是否适用”的事实。[^R3]
6. **速度预期要按请求数和单请求下限算。** Luna + max 下，输出不足 500 token 的 14 次请求中位耗时 8.4 秒；6 次高推理请求（reasoning ≥ 1,000 token）合计 272.6 秒，占总时长 48%。即便接口改造把 27 次请求压成 1–2 次，本任务的下限仍是十几秒到四十秒量级，而不是“数秒”。要进入数秒，除了减少请求，还必须减少单请求推理量或使用更快的服务档（Codex `turn/start` 已有 `serviceTier` 参数）。[^R1][^O2]

## 二、评估方法与证据来源

| 类别 | 做了什么 | 位置 |
|---|---|---|
| 原生记录 | 逐行解析 Codex rollout（280 行 JSONL）：27 个 `token_count`、3 个 `task_started/complete`、全部 user/developer/assistant 消息与工具调用 | `C:/Users/74755/.codex/sessions/2026/09/09/rollout-2026-09-09T10-28-36-01a083fe-e8bc-7313-b9f0-0d403238c3bc.jsonl` |
| 应用记录 | 核对原报告引用的会话 JSON：`turn-ended` 时间、观察 `capturedAt`、任务 `execution`、27 条全 null 的 `usage` | 原报告 [^L1] 同一文件 |
| 源码 | `codexAppServer.ts`（thread/start、turn/start、outputSchema、用量解析）、`generationCapabilities.ts`、`courseAgentCapabilities.ts`、`imageTransform.ts`、夹具生成脚本 | 见文末本地引用 |
| 可复现实验 | 用仓库能力数据实际计算能力卡字节数与 5,200 字节预算装入结果；计算 `codexTurnOutputSchema` 大小；对夹具 PNG 做 CRC/Adler-32/zlib 校验；在 Cursor 内置 Chromium 148 中同时测试 `<img>`、`decode()`、canvas、`createImageBitmap`、`ImageDecoder` | 临时脚本已删除，数据见正文 |
| 互联网 | OpenAI Prompt caching 指南与 Cookbook、OpenAI Fast mode、Codex 仓库 `model_switching` 测试与 issue #41491、W3C PNG 第三版、RFC 1950、维基百科 PNG 示例字节 | 见文末外部引用 |

未做：没有重新调用模型；没有核验 Claude、OpenCode 适配器；没有本机运行任何外部开源项目。

## 三、九分半的真实构成

### 3.1 按轮

| 轮 | 墙钟 | 请求数 | 请求区间合计 | 输入 token | 其中缓存命中 | 未缓存 | 输出 token | 其中推理 |
|---|---|---|---|---|---|---|---|---|
| 1 | 184.5 s | 12 | 175.0 s | 511,310 | 453,376（88.7%） | 57,934 | 7,713 | 4,368（56.6%） |
| 2 | 336.0 s | 14 | 329.0 s | 1,085,998 | 977,408（90.0%） | 108,590 | 14,851 | 10,364（69.8%） |
| 3 | 16.4 s | 1 | 8.4 s | 108,874 | 0 | 108,874 | 209 | 123 |
| 合计 | 568.1 s | 27 | 512.4 s（90.2%） | 1,706,182 | 1,430,784（83.9%） | 275,398 | 22,773 | 14,855（65.2%） |

- 轮间宿主时间：第一轮被拒后到第二轮开始 **29.7 s**；第二轮提交成功后到第三轮开始 **1.5 s**。同一套观察采集，失败路径比成功路径多出约 28 秒，来源未打点，需要阶段计时才能归因。[^R4]
- 每轮 Codex `task_started` 到该轮用户消息落盘之间还有 9.3 s / 7.0 s / 8.0 s 的原生侧准备时间（第一轮在此期间生成了 `<model_switch>` 与 8,246 字符的 `<recommended_plugins>` 注入），归属同样需要打点。
- “请求区间”包含区间内工具执行时间；原报告已核对命令自身合计约 7.1 秒，可忽略。

### 3.2 按请求

| 类型 | 次数 | 合计 | 说明 |
|---|---|---|---|
| 输出 < 500 token 的“小请求” | 14 | 120.3 s，中位 8.4 s | 这是 Luna + max 在 4–9 万 token、缓存命中 93–97% 条件下的单请求下限，应用侧无法压缩 |
| 推理 ≥ 1,000 token 的“重请求” | 6 | 272.6 s（48.0%） | 两轮首请求（37.5 s、46.1 s，缓存命中 0）、第一轮候选组装（36.2 s）、第二轮替代方案的最后三次（32.5 s、52.1 s、68.2 s） |
| 其余 | 7 | 119.5 s | 中等推理的工具选择 |

第二轮最后三次请求合计 152.8 秒、6,310 个推理 token，产物是一个 2,273 字符的三步候选（插入空文本块、写 20 个 `textStyle` 字段、`selection.replace`）。原报告第 4 点“模型仍承担传输结构”成立，且成本可见：`destination.target` 约 400 字符在每一步原样重复，`textStyle` 全字段被整体复写。[^R2]

### 3.3 三轮首请求为什么缓存全失效

三轮首请求的 `cached_input_tokens` 都是 0，而轮内后续请求命中率 93–97%。轮 1 结束到轮 2 首请求只隔 37 秒，远小于 OpenAI in-memory 缓存 5–10 分钟的存活期，所以不是过期，而是前缀变了。

应用侧唯一每轮必变、且位于前缀的内容是 `outputSchema`：`codexTurnOutputSchema()` 在信封和候选两处写入 `requestId: { const: request.requestId }`，三轮的 requestId 分别是 `0e045c5f…`、`535c42ea…`、`39c5498e…`。OpenAI 官方文档：`text.format`（Structured Outputs）“Adds output-format instructions and the requested schema”到缓存前缀；“Put user input, request identifiers, timestamps, and other changing content after the reusable prefix”。[^O1][^L1]

代价：202,442 个未缓存输入 token（73.5% 的未缓存输入）；第三轮 108,874 个 token 全部重算，只为输出 209 个 token。修法：Schema 去掉 requestId 常量，保持跨轮、跨任务字节级一致；宿主本来就在 `decodeCodexStructuredOutput()` 里校验 `envelope.requestId !== request.requestId`，安全性不变。这是一行改动加一次 A/B（同任务、固定 Schema 前后比较首请求 `cached_input_tokens`），不需要新协议。

不能排除 Codex 侧也有前缀变化（例如原生注入）。但即使如此，应用侧这一条也是充分原因，先修它再看剩余。

### 3.4 两套系统指令

`session_meta.base_instructions` 是“基于 GPT-6”的 Codex 指令（21,261 字符），因为 `thread/start` 只传了 `cwd`，线程按目录默认模型创建；随后 `turn/start` 传 `model: gpt-5.6-luna`，Codex 按其 `model_switching` 测试所规定的行为注入 `<model_switch>` 开发者消息，内含目标模型完整指令（46,246 字符）。两者合计约 6.75 万字符，在 27 次请求的前缀中都存在。它们在缓存命中的请求里不贵，但在 3.3 的每轮首请求里被全额重算，也持续占用上下文。[^L2][^C1]

`ThreadStartParams` 有 `model`、`config`、`developerInstructions`、`serviceTier` 等字段；在 `thread/start` 直接传用户已确认的模型即可消除该注入。这是消费原生已授权配置，不是替用户改配置。[^L3]

## 四、原报告六个断点逐条核验

| 原报告断点 | 核验 | 补充 |
|---|---|---|
| 1. 默认引用当前页，选中对象不是最高优先级 | 成立。任务 `readScope` 为 `location` 级；观察含整页对象 | 本例页面很小，观察正文约 1.2–1.4 万字符，不是主要成本 |
| 2. 预展开能力按遍历顺序占 5,200 字节 | 成立，且不充分。实际卡片大小：`native.content edit` 3,562 B、`asset.image.transform` 3,433 B、`content/image` 3,659 B、`insert/text` 4,871 B、`teacher-controller` 4,381 B。把选中对象排在最前，5,200 字节也只能装下 1 张卡（3,435 B），其余 5 张仍延后 | 排序修复必须与预算或卡片精简同做：要么预算随观察体积浮动（本例观察不到 15 KB），要么卡片拆出 references/示例按需取 |
| 3. 查询脚本 `--help` 不走帮助分支 | 成立。第一轮 #1–#5 五次命令都在读 `request.json`、`query.mjs` 源码、`discovery.json`、诊断文件，用于弄清如何查询 | 第一轮首个正确候选出现在第 12 次请求（02:31:42），此前 11 次工具调用没有一条是执行编辑 |
| 4. 模型承担传输结构 | 成立，见 3.2 | 输出 Schema 本身 5,599 字节、14 个 `$defs`，每轮进入前缀 |
| 5. 提交后固定再进 CLI | 成立。第三轮 16.4 秒墙钟，其中 8.4 秒模型 + 约 8 秒原生准备 | 若 3.3 修复，第三轮只剩约 8 秒与 1 万余新 token；“成功后完成”声明省的是这部分 |
| 6. 失败后错误替代 | 成立。第二轮候选把 image 换成空文本块，并新增 `cornerRadius: 18`、`fontSize: 8`；第三轮回复“位置和尺寸保持不变” | 本夹具是 1×1 纯色像素放大显示，所以模型的“纯色红色图形”判断视觉上不算错。用它作为“语义漂移”的唯一样本会高估护栏的普适性，需要一张真实照片作对照样例 |

## 五、其他四份评估的可证伪之处

| 评估 | 主张 | 本文核验 |
|---|---|---|
| Gemini 5.4 | `createImageBitmap()` / 离屏 canvas 双轨重载可“从物理根源消灭”本次失败 | **证伪一半。** 在 Cursor 内置 Chromium 148 上，夹具字节：`<img>` 加载 1×1、`decode()` 成功、canvas 读出 RGBA(255,0,0,255)；但 `createImageBitmap(blob)` 抛 `InvalidStateError`，`ImageDecoder` 抛 `EncodingError`。只有 `<img>`+canvas 一条路可行，且如 Muse 所述会丢失透明区 RGB 语义。修正 4 字节后五条路径全部成功 [^F2] |
| Gemini 5.1 | 按意图钳制推理强度，单轮 60–180 s 压到 3–8 s | 数字无来源。本记录中小请求中位 8.4 s 已是 max 强度下的下限，钳制能压的是 6 次重请求的 272 s；且 OpenAI 文档指出请求级 `reasoning.effort` 变化会改写前缀，按轮切换强度会再引入缓存失效 [^O1] |
| Gemini 5.3 | 能力卡放进前缀会破坏缓存，需“8 KB 固定卡片集” | 方向对，但本记录里破坏缓存的不是卡片（卡片在用户消息里，位于前缀之后），而是 Schema。先修 3.3，再谈卡片排序 |
| Muse 5.2、Kimi 五-5 | 根因最可能是辅助块 CRC 偏差，修复应是“辅助块宽容、关键块严格” | **证伪。** 出错的是 IDAT（关键块）内 zlib 尾部与块 CRC；辅助块宽容不会改变结果。该修复方向对真实素材仍有价值，但不是本例根因 [^F1] |
| Kimi 四-1、四-2 | n=1；应先做低强度/其他模型对照 | 同意。补充：对照实验必须以原生 rollout 的 `token_count` 为口径，而不是应用侧 `usage`（当前全 null）；并且在 3.3、3.4 修复之前跑对照会把缓存失效误记为模型慢 |
| Kimi 四-4、DeepSeek 六-2 | `afterCommit: finish` 需要宿主回执带结构化影响摘要 | 同意。第二轮回执 `affected` 已含 created/updated/deleted 与地址，可直接扩展为“是否跨载体、是否触及共享实例” |
| DeepSeek 六-5 | 未讨论 Claude 适配器 | 同意，且本文 3.3、3.4 的两项修复都是 Codex 专属，不会迁移到其他两个 CLI |
| DeepSeek 五-2 | 断点无严重度排序 | 本文第七节按“记录中可归因的秒数与 token”给出排序 |

## 六、其他新发现

### 6.1 整轮结构化输出与自然语言进展互斥

记录中本轮全部 assistant 消息都是 `{"version":1,"requestId":…,"kind":…}` 信封，包括“我先按当前选中对象核对可用的原生图像能力与技能卡……”这类进展。无论这是 API 层 `text.format` 约束到每条消息，还是模型模仿提示词格式，结论相同：只要 `outputSchema` 覆盖整轮，应用要求的“公开进展用自然语言”就不可能被满足，聊天面板收到的必然是 JSON。[^R2]

更严重的是第一轮 02:29:04 的首条消息：一个 `kind:edit`、`native.content edit {"opacity":1}` 的候选，`candidateId` 与最终候选相同。宿主最终采用的是 02:31:42 的那条，所以没有造成写入；但协议必须明确“只有 turn 终态的最后一条消息是候选，其余 `kind:edit` 一律丢弃且不显示”，否则同类消息迟早被当成结果。

两个可选方向，都不改变 V9 与 canonical transaction：

- A. 保留 Schema（按 3.3 做成跨轮不变），宿主按消息项缓冲信封、以增量 JSON 解析把 `reply` 字段流式渲染成文字，非终态 `kind:edit` 丢弃。改动集中在 `codexAppServer.ts` 消息投影与聊天组件。
- B. 候选改走 staging 文件通道（原报告已提到其他 CLI 用此方式），最终消息恢复纯文本，不再传 `outputSchema`。同时消除 3.3 与本节两个问题，但失去 API 层的 Schema 强制，需依赖宿主已有的 zod 校验与有界格式修复。

B 更彻底，A 改动更小；选择前应各做一次真实任务对比可读性与格式错误率。

### 6.2 宿主知道却没告诉模型的事

第一轮开始前，观察管线已写出 `original-image-diagnostics.json`：`{"assetId":"mixed-figure","code":"image-decode-failed","message":"这张图片无法完整解码，未作为 image 附件发送。"}`。但：

- 提示词正文没有这条诊断，模型在第 5 次工具调用（02:30:03，距轮开始 76 秒）才读到；
- 能力上下文仍把 `asset.image.transform` 列为对当前图片可用，模型在候选 summary 里甚至写了“当前资源诊断标记源图像无法完整解码，若宿主无法解析则本候选未完成”，然后照常提交；
- 拒绝回执只有 `"summary":"s1: PNG 数据块校验失败"`，没有错误码、资产 ID、是否可恢复、建议动作；
- 第二轮模型用 `Format-Hex`、`ZipFile`、`node -e zlib` 自己确认了 zlib 流损坏（#7–#12），再决定替换。

这正是原报告“失败处理留在对应接口，不让模型现场修工具”的反面实例。最小改动：观察中每个资产的解码诊断直接作为该资产上“哪些工具不可用及原因”的字段呈现，拒绝回执沿用现有 `AuthoringToolFailure` 码系带出资产 ID 与恢复选项。这不需要新协议，只是把宿主已有事实提前投影。

### 6.3 夹具本身应修

`scripts/build-architecture-baseline-fixtures.ts` 第 112–114 行 `PNG_BYTES` 的 IDAT 载荷是 `08 d7 63 f8 cf c0 00 00 00 03 00 01`，存储 CRC `18 dd 8d b0`。CRC 与维基百科示例中正确载荷 `08 d7 63 f8 cf c0 00 00 03 01 01 00` 一致，说明转写时把 Adler-32 的四个字节 `03 01 01 00` 写错了。`00 ff 00 00`（过滤字节 + 红色像素）的 Adler-32 计算值为 `0x03010100`，与正确载荷一致；对夹具载荷计算 CRC 为 `0x67f0f7e7`，与存储值不符；Node `zlib.inflateSync` 报 `incorrect data check`。[^F1][^F3]

这意味着“本次 PNG 失败输入”不能作为 W05 “红图改绿”验收样例的真实素材；应修正夹具并重建基线，另用真实导出的 PNG（含透明、含内容图）验证。`imageTransform.ts` 对关键块的严格校验是正确的，不应为此放松。

### 6.4 能力数据规模

生成的能力数据共 55 个条目、文件总计 747,089 字节。它只是发现索引，不应也未曾整体进入提示；但每张卡 2–5 KB 决定了“首轮少量完整信息”能放几张。原报告“常用接口直达、长尾一次发现”的边界应以字节数落地：例如首轮预算随观察体积浮动到 12–16 KB（G07 目标 ≤ 12 KB 是对整段能力说明的上限，可据此细分），或卡片主体与 references 分离。

## 七、修订后的实施顺序

按“记录中可归因的收益 / 改动量”排序，第一步全部是可在一天内完成并可用 rollout 数据验证的改动。

| 序 | 改动 | 归属 | 记录中的直接依据 | 预期收益（本任务口径，估计） |
|---|---|---|---|---|
| 1a | 用量解析改读 `tokenUsage.last/total`，同时记录 `reasoningOutputTokens`、`cacheWriteInputTokens` | W01/W09 | 27 条 usage 全 null | 后续一切归因的前提 |
| 1b | `outputSchema` 去掉 requestId 常量，保持跨轮字节一致 | W01/W09 | 3 轮首请求 cached=0，202K 未缓存 token | 每轮首请求少重算 3.5–10.9 万 token；首请求时延预计从 37–46 s 降到轮内水平（需 A/B） |
| 1c | `thread/start` 直接传已确认 `model`（及 effort） | W01 | 46,246 字符 `<model_switch>` | 每请求前缀减少约 4.6 万字符；消除双份指令 |
| 1d | 修夹具 4 字节并重建基线；另备真实 PNG 样例 | W05 | 6.3 | 使 W05 验收样例有效 |
| 1e | 解码诊断投影为资产级“工具不可用”事实；拒绝回执带码、资产 ID、恢复选项 | W05/W06 | 6.2 | 本例第一轮可在读到观察后直接停下或询问，避免第二轮 336 s |
| 1f | 阶段打点：turn/start 发出、原生首请求、首个公开输出、候选终态、宿主应用/拒绝、观察采集 | W09 | 29.7 s 与 7–9 s 两处未归因空档 | 归因 |
| 2 | 原报告第二步（选中对象优先、常用操作完整投影、查询一次返回可调用信息、短传输投影） | W02/W03 | 第一轮 11 次工具调用无一编辑；卡片 2–5 KB | 减少请求数；本例 12→约 2 |
| 3 | 原报告第三步（完成声明 + 影响摘要、失败收敛、非终态候选丢弃、6.1 的 A/B 选型） | W06/W07 | 第三轮 16.4 s；JSON 信封 | 去掉固定验证轮；聊天可读 |
| 4 | 用 1a 数据决定模型层：若小请求 ~8 s 下限仍不可接受，比较 effort、`serviceTier`（Codex 已有参数；OpenAI Fast mode 文档称对 gpt-5.6-sol 最高 2.5× 速度、按 token 加价）与模型，且必须在 UI 披露实际生效值 | W09 | 3.2 | 只有这一步能把“十几秒”推向“数秒” |

停止条件与原报告一致，补两条：1b 的 A/B 若显示首请求缓存仍为 0，说明 Codex 侧还有前缀变化，应记录为原生事实并停止在应用侧继续压缩；步骤 2 开工前先用 1a 数据复算“请求数 × 单请求下限”，若下限已经超出产品目标，先做步骤 4 的比较而不是继续深化接口。

## 八、证据边界

- 全部时序与 token 来自同一次已发生任务的原生记录，n=1；分解结论可复现，但不能外推分位数。
- “Schema 变化导致缓存失效”是官方文档支持的充分解释，尚未用 A/B 在本产品上验证；“Codex 把 text.format 约束到每条消息”与“模型模仿提示词格式”两种机制未区分，但对结论无影响。
- 29.7 s 与每轮 7–9 s 的归属未打点。
- 浏览器实验环境为 Cursor 内置 Electron 42 / Chromium 148，Electron 应用主进程与渲染进程版本可能不同，需在产品自身环境复测。
- 未核验 Claude、OpenCode 适配器；OpenCode 模型选择问题沿用 Kimi 评估指出的 issue 线索，本文未复核。
- 所有“预期收益”是基于本次记录的估计，不是承诺。

## 九、引用

### 原生与应用记录

[^R1]: Codex rollout：`C:/Users/74755/.codex/sessions/2026/09/09/rollout-2026-09-09T10-28-36-01a083fe-e8bc-7313-b9f0-0d403238c3bc.jsonl`。`token_count` 事件的 `info.last_token_usage.{input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens}`；`task_started/task_complete` 时间；CLI 0.153.4，`originator: courseware_editor`。
[^R2]: 同上文件中 `response_item/message role=assistant` 全部条目（02:29:04、02:29:14、02:29:18、02:31:42、02:32:40、02:32:42、02:37:29、02:37:47、02:38:05），以及三条 `kind:edit` 候选原文。
[^R3]: 同上文件 02:30:03 `custom_tool_call_output`（`original-image-diagnostics.json` 内容）、02:32:19 第二轮用户消息中的宿主回执 `{"status":"rejected","summary":"s1: PNG 数据块校验失败"}`、第二轮 #7–#12 工具调用。
[^R4]: 应用会话记录 `C:/Users/74755/AppData/Roaming/ittoedu-courseware-editor-v8-rebuild/local-agent/v2/d4cea5d0c4158a3e30fccf5708e466dd9c9f531f36e1fffd5f6a9ec7d0c1a339/2df4263f-3190-4132-bf5a-cdfc304be66f.json`：`events` 中 `turn-ended`（1788921102414）与下一 `configuration`（1788921132075）；`observations[].capturedAt` 1788920915587 / 1788921131383 / 1788921468834；`tasks[0].goal` “帮我把这个颜色改为绿色”，`applyPolicy: auto`。

### 本地源码

[^L1]: [`src/main/localAgent/codexAppServer.ts:58-92`](../../../src/main/localAgent/codexAppServer.ts)（`codexCandidateOutputSchema` / `codexTurnOutputSchema` 两处 `requestId: { const }`）；[`:602-604`](../../../src/main/localAgent/codexAppServer.ts)（每轮 `params.outputSchema`）；[`:112`](../../../src/main/localAgent/codexAppServer.ts)（宿主已校验 requestId）；[`:1148-1160`](../../../src/main/localAgent/codexAppServer.ts)（`thread/tokenUsage/updated` 读取平面字段 `usage.inputTokens` 等，而原生结构为 `tokenUsage.last/total`）。
[^L2]: [`src/main/localAgent/codexAppServer.ts:513`](../../../src/main/localAgent/codexAppServer.ts)（`thread/start` 只传 `cwd`）与 [`:597-601`](../../../src/main/localAgent/codexAppServer.ts)（`turn/start` 传 model/effort）。
[^L3]: [`output/r18-codex-protocol/codex_app_server_protocol.v2.schemas.json`](../../../output/r18-codex-protocol/codex_app_server_protocol.v2.schemas.json)：`ThreadStartParams` 含 `model, config, developerInstructions, baseInstructions, serviceTier`；`TurnStartParams` 含 `outputSchema, serviceTier, serviceTierForTurn`。
[^L4]: [`src/renderer/authoring/generation/generationCapabilities.ts`](../../../src/renderer/authoring/generation/generationCapabilities.ts)（5,200 字节预算与遍历顺序）；[`src/shared/courseAgentCapabilities.ts:159`](../../../src/shared/courseAgentCapabilities.ts)（`readCourseAgentCapability`，本文用它计算卡片字节数）；[`src/shared/generated/courseAgentCapabilities.json`](../../../src/shared/generated/courseAgentCapabilities.json)（55 条目）。
[^L5]: [`scripts/build-architecture-baseline-fixtures.ts:107-117`](../../../scripts/build-architecture-baseline-fixtures.ts)（`PNG_BYTES`）；[`src/renderer/project/imageTransform.ts`](../../../src/renderer/project/imageTransform.ts)（关键块 CRC 校验）。
[^L6]: [`docs/development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md:106-118`](../../development-plan/AI_ASSISTANT_VSCODE_BENCHMARK_ASSESSMENT.md)（W01–W11 工作包）；[`docs/development-plan/reviews/1.8-ai-assistant-gap-register.md:23`](../../development-plan/reviews/1.8-ai-assistant-gap-register.md)（G07）。

### 外部来源（访问日期 2026-09-09）

[^O1]: OpenAI，[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)：“`text.format` (Structured Outputs) — Adds output-format instructions and the requested schema”；“Keep system or developer instructions, shared reference material, examples, tool definitions, and structured output schemas stable. Put user input, request identifiers, timestamps, and other changing content after the reusable prefix”；“`reasoning.effort` — Request-level changes can alter reasoning instructions”；in-memory 缓存“Typically 5 to 10 minutes inactive”。另见 [Prompt Caching 201](https://developers.openai.com/cookbook/examples/prompt_caching_201)：“Tools, schemas, and their ordering contribute to the cached prefix - they get injected before developer instructions”。
[^O2]: OpenAI，[Fast mode](https://developers.openai.com/api/docs/guides/fast-mode)：Priority processing 于 2026-07-30 更名 Fast mode，`service_tier: "fast"` 或 `"priority"`，gpt-5.6-sol 最高 2.5× 速度，按 token 加价，缓存折扣仍适用。
[^C1]: openai/codex，[`codex-rs/core/tests/suite/model_switching.rs`](https://github.com/openai/codex/blob/2230d644/codex-rs/core/tests/suite/model_switching.rs)：模型在线程内切换时向下一请求注入含“The user was previously using a different model.”与目标模型指令的 `<model_switch>` 开发者消息；[issue #41491](https://github.com/openai/codex/issues/41491) 记录了该消息重复包含会话级指令的问题。
[^F1]: W3C，[Portable Network Graphics (PNG) Specification (Third Edition)](https://www.w3.org/TR/png-3/)：IHDR/PLTE/IDAT/IEND 为关键块；块 CRC 覆盖类型与数据；IDAT 拼接为一个 zlib 数据流。IETF，[RFC 1950](https://www.rfc-editor.org/rfc/rfc1950.txt)：zlib 尾部 Adler-32 为未压缩数据校验，s1 初值 1、模 65521。
[^F2]: 本文实验（Cursor 3.19.13，Electron 42.10.0，Chromium 148.0.7778.280）：夹具字节 `<img>` load ok 1×1 / `decode()` ok / canvas RGBA 255,0,0,255 / `createImageBitmap` InvalidStateError / `ImageDecoder` EncodingError；修正 `03 01 01 00` 后五项全部成功。
[^F3]: Wikipedia，[PNG](https://en.wikipedia.org/wiki/Png_file) “Examples” 一节给出的 1×1 红色像素 IDAT 逐字节解释：`08 D7` zlib 头、`63 F8 CF C0 00 00` 解码为 `00 FF 00 00`、`03 01 01 00` Adler-32、`18 DD 8D B0` CRC。夹具 CRC 与之相同，Adler-32 不同。
