# 1.8 延迟修复与工程收尾记录

执行依据：[9 月 10 日方案](../roadmap/1.8/LATENCY_COMPLETION_PLAN.md)。本轮路径、计时、按钮事实反馈及 Windows 会话持久化修复已集成，文字、图片、排版、互动和 OpenCode T11 的受影响代表用例已通过。Owner 随后临时将 Claude Code 接入 DeepSeek 并要求完成该通道，新增真实文字预览已通过，解除此前的通道阻断，103 本次待补代表项已补齐。**1.8 尚未完成：060 同一候选现场复核、版本检查及 Owner S3 签署尚未执行。** 所有原始失败保留，没有提交、发布或 accepted 声明。

## 已落实的行为

- 本机 OpenCode 默认 `openai/gpt-5.6-luna`，现有认证类型为 OpenAI OAuth。真实原生新会话确认 OpenCode 1.18.26、该模型、effort `none`（配置请求为 `default`）；未修改 Provider 授权或其他 CLI 模型/强度。
- 初始能力卡已完整时直接消费；按需读取的 `request.json` 保存能力查询、Skills 和资源绝对路径。保留原生 cwd、权限和原有候选事务。真实文字首个修改后样本已不再重复 query，但仍发生根路径及 requestId 转抄错误，因此进一步将本轮目录交给原生进程环境，脚本读入实际请求身份。
- 既有 `AiTask.execution` 增加有界可选 timing 事实，区分请求准备、原生打开/发送、事件、候选解析与宿主结果登记。缺失边界保持未知，不把事件前等待称为推理或服务排队。
- `runtime.source.observeButton` 在完整准入后的独立候选窗口，以 Electron 鼠标点击精确、唯一、可命中的 DOM 按钮，记录点击前后文本及两帧；500ms 观察窗沿既有期限。不会操作教师 live session。续轮得到明确标注为候选宿主的紧凑事实，语义仍为 `requires-review`。
- 文件交付恢复已有终结标记。显式 `kind:edit` 却无当前候选时走已有一次格式修复；明确无法完成的答复继续诚实失败，不猜自然语言、不扫描错误目录。

## 本轮原始运行

| 用例 | 结果及可证明范围 | 原始目录（仓库根下） |
| --- | --- | --- |
| OpenCode Luna 文字修改前基线 | 一次完成；首次正确结果观测 36.319s，任务终态 36.307s；不是性能分布 | `output/r18-short-path/opencode-text-auto-2026-09-10T11-48-44-284Z` |
| 独立候选真实按钮 | 最终命名用例 1/1、32.8s；同步与 150ms 延迟正例、错误处理函数、目标失配及 public-props 旁路拒绝。已查看候选答案帧和 live 未变帧，答案完整可读 | `output/r18-button-observation/2026-09-10T12-05-40-922Z` |
| OpenCode 文字首个修改后样本 | 失败，零提交；模型把 `a73c-dcae` 抄成 `a73d-cdae`，在另一个目录输出。其短 V2 候选还误填完整 destination 对象，因此路径不是唯一错误。原失败保留，不计通过 | `output/r18-short-path/opencode-text-auto-2026-09-10T12-08-55-422Z` |
| OpenCode T11 首次新用例 | 产品首轮已正常提问且零写；测试遗漏“请提供新的课程标题”的合法表达，断言失败，尚未执行回答轮。已修测试，不计完整 T11 通过 | `output/r18-clarification/opencode-2026-09-10T12-13-08-215Z` |
| OpenCode 环境路径首样本 | 失败、零提交；模型原生 bash 的 workdir 填成无效字符串，命令尚未运行便失败，却答复候选环境路径不可访问。不是根目录传递是否有效的证据；后续以 high 做受控强度样本 | `output/r18-short-path/opencode-text-auto-2026-09-10T12-28-07-944Z` |
| OpenCode high 首次受控样本 | 失败、零提交；原生配置确认后，OpenAI 响应流报 TLS 证书验证失败，尚无正文、工具或候选。随后同端点无认证的 Schannel、Node、独立 Bun 探测均恢复正常，但不足以确定失败时具体根因 | `output/r18-short-path/opencode-text-auto-2026-09-10T12-30-50-688Z` |
| Claude 文字候选预览 | 失败、零提交；原生打开约 0.701s，后续 provider 503 报当前渠道无可用 `claude-sonnet-5`；没有产生可供滚动复核的候选预览 | `output/r18-short-path/claude-text-preview-2026-09-10T12-33-09-762Z` |
| OpenCode high 文字受控恢复样本 | 命名用例 1/1；一原生宿主轮、一提交，首次正确画面观测 73.689s，终态观察 73.661s，撤销/重做/保存重开通过；已查看标题居中、放大且内容正确的画面。3 次原生工具调用中 1 次引号语法错误后自行纠正，0 query、0 宿主格式修复、0 续轮；不是原生命令首遍无错。实际通过环境目录读取 request 并写入当前候选 | `output/r18-short-path/opencode-text-auto-2026-09-10T12-39-52-431Z`，同目录 `latency-audit.json` |
| OpenCode T11 澄清闭环 | 命名用例 1/1、2.4min（含双用户轮及验证）。首轮正常提问且零写；同一原生会话中的回答轮仅改标题一次，保存/Undo/Redo/重开通过。已查看实际问题和重开后标题，旧失败仍保留 | `output/r18-clarification/opencode-2026-09-10T12-42-31-883Z` |
| OpenCode high 互动首样本 | 任务 completed、一个实际 Runtime 源码提交、两原生宿主轮；模型主动请求 `observeButton`，候选宿主点击后出现正确答案，并经下一原生轮接收。用例误选同候选的 checked 结果比较 revision 而失败，未完成后续保存/Undo 验证。观察文本还混入 STYLE 内容，已由后续修复；原始失败保留，不计完整互动通过 | `output/r18-short-path/opencode-interaction-auto-2026-09-10T12-45-39-578Z` |
| OpenCode high 图片 | 命名用例 1/1、3.2min（含验证）；一宿主轮、一提交，终态观察 126.443s，画面/像素核对后首次正确观测 130.852s。选中图片变绿，透明区/白色图案及未选共享红图保全，Undo/Redo/重开通过；已查看真实绿色图片与共享红图画面 | `output/r18-short-path/opencode-image-auto-2026-09-10T12-52-47-905Z` |
| Codex Luna/max 整页排版 | 命名用例 1/1、8.6min（含验证）；首次正确观测 451.147s、终态观察 446.749s，零工具、一候选、一轮、一提交，Undo/Redo/重开通过；已查看标题居中、对象外框顶端对齐和原内容保留。耗时异常仍保留，不计提速 | `output/r18-short-path/codex-layout-auto-2026-09-10T12-56-40-701Z` |
| 独立候选公开文本修复 | 1/1、32.4s；真实点击前后文本现在分别为按钮+未显示提示、按钮+正确答案，CSS 和重复/隐藏内容排除，500ms 观察及 live 零操作继续成立 | `output/r18-button-observation/2026-09-10T13-09-38-987Z` |
| OpenCode high 互动再核对 | 失败、零候选和零提交；第 32 原生事件保存遇到 Windows 会话文件原子替换 EPERM，之后失败终态可保存到同一路径。这是本地记录持久化阻断，已增加有界原子替换重试，并在下一样本完成真实续验 | `output/r18-short-path/opencode-interaction-auto-2026-09-10T13-11-44-162Z` |
| PPTX 稳定可编辑复核工程 | 两个实际命名用例 2/2，SmartArt 34.7s、旧公式 39.5s；补存 `edited.h5lesson`，与 HTML/PPTX、保存重开和历史证据对应。已查看 Player 图示文字和三分之一；小夹具故意移动独立文字的位置，不以其最终位置作为成品版式验收 | `output/playwright/r18-diagrams`、`output/playwright/r18-equations`；旧制品备份 `output/r18-s3-preparation-20260910/previous-evidence` |
| OpenCode high 互动最终复核 | 命名用例 1/1、6.3min（含验证）；两宿主轮、一次继续、一个提交。私有按钮实际显示答案，简洁的前后文字进入第二原生轮，第二轮零工具且无文件重读；教师正常点击、Undo/Redo、保存重开通过，实际答案画面已查看。未操作教师 live session 的证据与测试之后的人工式点击分列 | `output/r18-short-path/opencode-interaction-auto-2026-09-10T13-21-41-927Z`，同目录 `latency-audit.json` |
| 051/052 完整真实源复核副本 | 正式导入、资源事务、归档保存和实际磁盘读回通过；SmartArt 4 导入页/46 Native/29 issues，旧公式 29 导入页/711 Native/27 可编辑公式/142 issues。完整 HTML 已打开并导航代表页，已查看 SmartArt 1–3 与公式第 4 页；保留不支持项，不声称全页视觉无损。初次准备脚本字段错误及其失败清单保留，修正后生成成功 | `output/r18-s3-preparation-20260910/preparation-result.json`、两份 `.h5lesson`/HTML/导入报告及 `html-review.json` |
| Claude Code / DeepSeek 文字预览 | 用户临时改接 DeepSeek 后，本次唯一新命名样本 1/1、1.7min（含验证）。模型 `deepseek-flash[1M]`，实际解析名 `deepseek-flash[1m]`，max，CLI 2.1.267；两次原生配置事实一致。42.777s 待应用且零提交，驱动审阅等待 13.382s；应用后一次提交并 finish，58.222s 终态、58.999s 首次正确挂载。5 次工具均 completed，零宿主格式修复、无第二原生轮，Undo/Redo/保存重开通过。已查看滚动后的前图/实际候选、应用后及撤销后画面 | `output/r18-short-path/claude-text-preview-2026-09-10T15-16-47-848Z`，同目录 `result.json`、`manual-review.json`、`latency-audit.json` |

基线与两个 default 修改后样本固定 OpenAI OAuth Luna/default。Codex Luna/max、Claude Sonnet/high 的旧记录不能与它混算提速。性能时间均沿各用例声明的观测边界，图片和排版的画面采样开销单列。

high 是独立的可靠性诊断样本，不与 none 计算提速。该文字样本原生打开 5.034s，UI 发送至候选解析 72.338s，候选解析至结果登记 95ms、至提交登记 133ms；模型成功写出候选后至宿主解析仍有 23.917s，包含原生回读和收尾，不是纯提交时间。当前数据不支持产品已整体提速的结论。

互动首样本的候选解析 192.223s、提交登记 196.001s，独立候选窗于 195.110s 实际点击、195.625s 读到答案；原生续轮 207.237s 发出至 226.154s 结束，0 工具调用、未再读取四个观察文件且没有后续提交。该次终态观察 227.620s；该次教师 live 普通点击没有成功证据，不能把私有窗口时间填入 `firstCorrectInteractiveMs`。原生工具仍有一次 query 的 shell 路径乱码和一次 node 引号语法错误，保留在 `latency-audit.json`。

互动最终样本私有点击读到答案为 199.774s、任务终态 248.359s、教师普通点击首次正确观测 261.849s；后者包含测试在终态后切换试运行的耗时，不证明这之前不可用。14 次工具调用包含一次 query 参数错误后纠正，0 宿主格式修复；第二轮直接使用干净的内联答案事实。单次存储修复后的成功不证明该次实际触发了重试分支，重试机制由真实 Windows 读锁用例直接验证。

图片有 5 次原生命令、2 次 Shell 语法错误，0 query、0路径定位错误、0宿主格式修复、0续轮；不是原生命令首遍无错。透明和白细节通过声明阈值，不扩张为所有像素逐通道完全相等。排版新旧均无工具/重试；配置事件至候选从旧 30.929s 变成 426.922s，新增 395.993s 均在不可细分的原生等待区间。实际初始提示从 14,664 缩至 13,857 字符，输入 token 也减少；CLI 0.153.4→0.154.0、reasoning 输出 516→2,588，不构成配对实验，也不能仅由 token 数判定等待成因。

## 本轮聚焦工程检查

- `generationCapabilityWorkspace` 的 19 个实际用例通过，覆盖初始完整卡、环境根、严格别名及文件交付标记；没有把 skipped 或零匹配记为成功。
- 候选环境传递的 8 个命名用例、timing 的 10 个用例通过；保留原生环境覆盖、同线程换候选根与旧记录兼容。
- Harness 缺候选的一次格式修复/重复失败停止及失败观察来源的 6 个命名用例通过；失败帧仍验证真实文件内容，不放宽 strict 合同。
- Renderer、Electron 与 E2E 类型检查通过；Renderer/Electron 按最后相关源码变化完成构建。能力目录在新增按钮 Schema 后生成，最终仅因来源证据变动刷新 generation-evidence，目录检查通过；没有据此重跑未变模型用例。
- 公开文本定向用例先证明旧实现输出 CSS/重复文本，再验证当前渲染树、动态答案、slot 与隐藏内容；真实按钮用例验证输出仅含所见按钮/答案，Renderer/E2E 类型检查及 renderer 构建通过。
- Windows 会话原子替换的 5 项检查通过，包括真实目标读锁释放恢复、持续占用保留旧 JSON、队列顺序和后续写恢复；总等待最多 385ms，不阻塞主线程，不扩到未受影响的工程保存 owner。具体占用进程未确认。Electron/E2E 类型检查及 Electron 构建通过。
- 103 两个组合证据命名用例 2/2 通过：formal unchanged + finish 在 Main 持久化并由新 Harness 重开后保持同一结果，revision 不增长且无第二原生轮；waiting-input 在原预算到期后终结、关闭 transport，晚回答/继续不能延长旧任务。使用正式 Harness/Repository/Schema 与脚本 adapter，属于确定性生命周期证据，未新增真实模型成功次数。

## 复用边界与待完成

103 原合同要求每 CLI 三次独立关键链并保留失败，允许修复后复核受影响证据；没有另立“三次 clean first pass”要求。九个槽位的失败、续接和最终结果须分列，不能以修复后的闭合结果声称初次成功，也不能因一次无关失败抹掉全部有效证据。

| 既有范围 | 复用来源与限制 |
| --- | --- |
| 三 CLI 九个独立关键槽位 | `output/r18-development-20260908/STATUS-20260908-2350.md` 及同目录 Claude 2/3、OpenCode 2/3 coordinator/final closure；OpenCode 1 的 `output/r18-native-authoring/opencode-1-2026-09-08T11-22-47-923Z/attempts/failed-correction-2026-09-08T15-05-02-289Z/manual-review.json`。原失败仍保留，OpenCode 2 凹凸视觉歧义仍交 Owner |
| T03/T08/T09 与 050 | Codex remaining rev17、Claude rev16、OpenCode rev14 的保存、撤销、重开、正确源导出结果继续有效；不把测试者点击充当自动按钮反馈 |
| PPTX 051/052 | [9 月 7 日开发记录](1.7-1.8-development-2026-09-07.md)；SmartArt/OLE/公式/Native 映射的原适用范围保留，未触及其 consumer |
| 三表面 083 | [集成出口](1.8-surface-integration-exit.md)的实际窗口、资源/History、保存重开及离线 HTML；Word 视觉、物理触控等原限制保留 |
| 导航 087 | [导航出口](1.8-navigation-level-exit.md)的 Mixed 3+2+3 步、目录、重播、缩放和离线结果；本轮未改导航/Player 源码 |

Claude 旧候选整卡截图 `y=-262.6` 只证明取图未覆盖卡片，不证明界面不可达。当前 `.chat-scroll` 支持滚动；新用例分别滚动查看原图与实际候选宿主，再到应用按钮。允许分段阅读，不要求两幅内容同时可见，也不先改 UI。

103 的 9 月 9 日确定性证据继续有效：[实施记录](2026-09-09-short-path-implementation.md)分别记录候选/Controller、Main、超时恢复、聊天/观察；不能把各组数量相加为独立总数。当前仍存在的命名用例覆盖 preview 待应用与到期、canonical 提交前期限、回执持久化失败只补记录、重开不补造结果及原绝对期限跨续轮。旧 Codex 真实预览 `codex-text-preview-2026-09-09T10-43-55-196Z` 保留共享提交链的有效证据，不能替 Claude 新滚动预览签字。新增两项组合覆盖与这些证据一起复用，不另开付费矩阵。

此前 Claude Sonnet/high 预览的 503 失败继续保留：9 月 9 日成功与该失败的实际模型均为 `claude-sonnet-5`，不能解释成模型别名升级。**用户随后明确临时接入 DeepSeek，授权完成 Claude 通道**，本次沿该配置执行唯一受阻用例 `R18 short path claude text preview: first usable and finish without another native turn`，已完成原图/候选分段阅读、零写待应用、应用后 finish 与恢复。原生目录、配置 ACK 和随后配置事实记录于当前样本；未修改用户凭据、全局配置或产品源码，也没有通过换配置改写旧失败。

Claude 通道的本次待补项已补齐，原有效三 CLI 有限槽位与确定性边界按前述范围汇合，可移交 060。新样本只证明 Claude Code / DeepSeek 的文字预览闭环；不外推临时后端的图像理解能力，也不与旧 Sonnet/high 或其他模型混算速度。42.777s 至 58.222s 含 13.382s 的驱动审阅等待，应单列；58.999s 是首次采样到正确挂载的结果，不能把它称为纯模型耗时。原生 turn 也不等于内部模型请求次数。

预览的“零写”限定为应用前零宿主提交、无 completion、磁盘工程 revision 0；原生工具仍可在其已有权限内读写临时脚本。一次 Undo/Redo 核对完整 project 语义，重开核对档案和 completed 任务，没有再次执行挂载标题判定。`receiptDelivery=pending` 与当前 `afterCommit.finish` 合同一致：宿主已依据真实提交完成任务，不需要再起原生总结轮；该字段不证明回执已回投原生历史。独立审计未发现影响本次工程通过结论的异常。

[S3 复核入口](2026-09-10-s3-review-entry.md)已列实际工程、HTML、完整 PPTX 导入报告及旧范围；所有工程独立保存，不携带聊天历史。当前代码为 `c839c205` 基础上的未提交工作树，最终同一候选及三 CLI 会话/隔离现场由 060 在依赖有效后准备；尚未执行发布阶段全量 verify 或 Owner 签署。已通过范围与实测失败均留在本轮记录，1.8 不能标完成。
