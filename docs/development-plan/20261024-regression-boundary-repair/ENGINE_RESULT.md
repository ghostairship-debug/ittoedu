# R4 取消提示与 OAuth 压缩覆盖结果

**2026-10-25语义纠正：** 普通任务的自动／逐步前置选择早已取消，当前由AI按任务与用户原话判断推进。下文repair18是离线强制模式问题及直接Desktop兼容协议覆盖，不能据名称推成现行常用UI入口或恢复选择器；原始失败及等待窗口证据仍保留。当前模型／renderer／协议核对及后续fixture方向见[MODE_CORRECTION](../20261025-targeted-followup/MODE_CORRECTION.md)，本次未改产品或测试。

本批只修改非 owner 取消拒绝提示及对应精确文本断言，补齐 OAuth 实际预算压缩覆盖。未修改权限、取消调用顺序、执行引擎或预算算法；未调用真实账号、付费接口或外部 CLI；未 commit、push、发布。

## 取消提示

`HostToolCoordinator.jobCancel` 仍先检查当前 run，再经原 `readableJobRef` 查证可读作业归属；非 owner 仍以 `job-not-authorized` 拒绝，不进入 `jobs.cancel`。提示改为：

> 当前任务只能读取其他任务的作业（包括只读和接续访问），不能取消；取消须由原所属任务发起

`ni02RecoveredJobArtifacts` 原有接续、只读、不同工作空间、停止后读取与保存边界均保留，两个依赖旧提示的断言同步。`g20ServiceToolDiscovery` 原有 owner 取消成功、非 owner 拒绝零取消调用和冻结只读授权断言未改。`g20ExecutionEngine` 接续拒绝取消断言保留，仅同步提示。

## OAuth 覆盖

已有 `archives whole OAuth rounds on actual wire and never resurrects old native payloads in later turns` 证明同协议 wire 的整轮投影归档，不证明实际预算压缩；保留原名和原断言。已有 `compresses actual serialized payloads only after all tools return and preserves both document grants and commit facts` 走通用 `openai-chat`，不能代替 OAuth 的组合覆盖。

新增 `compacts OAuth requests against their actual serialized budget without resurrecting native rounds or detaching tool outputs`：

- 使用 `chatgpt-responses` 连接和正式 `serializeChatGPTResponsesRequest`，每个实际请求均记录序列化 wire；模型响应是离线 fixture。
- 从首轮实际 wire 的剩余预算生成原生 reasoning 数据，使单轮可容纳、保留两轮产生预算压力，无强制压缩、算法 mock 或生产参数改动。
- 检查运行完成、`final.compacted.fromMessage > initialMessageCount`、压缩实际发生于至少两次请求后、宿主保留原目标。
- 第一轮原生标记确实进入第二次 wire，随后退出；后续所有 wire 不再复活该标记，Run 原始消息仍完整保存。
- 每次 wire 的 `function_call` 和 `function_call_output` 编号集合完全相等、调用编号不重复，并保留最新完整原生轮及其回执；每次 wire 的估算 tokens 均不超过当前真实协议预算。

## 最小充分验证

候选工作树：`C:\Users\74755\.codex\worktrees\regression-boundary-repair\果铃工作台`。Node `v24.14.0`，Vitest `4.1.10`。不重复全量或全 typecheck，组合验证由 Root 负责。

| 检查 | 结果 | 原始报告（工作树内） |
|---|---|---|
| Engine、ni02、服务发现三个完整文件，`--maxWorkers=2` | 71 例中 69 过；Engine 原有 57 例和服务发现 6 例全过。新增 OAuth 例的一个错误夹具断言失败；ni02 材料背景例失败 | `output/test-runs/regression-boundary-repair/engine-r4.json` |
| 新增 OAuth 例，`--testNamePattern='compacts OAuth requests against their actual serialized budget' --maxWorkers=1` | 修正新增断言后 1 例通过，57 例因明确过滤未运行，不能称这一跑为 Engine 全文件通过 | `output/test-runs/regression-boundary-repair/engine-r4-oauth-recheck.json` |
| ni02 完整文件，`--maxWorkers=1` | 7/7 通过；材料背景例 1975 ms，保存及冷开断言未改 | `output/test-runs/regression-boundary-repair/engine-r4-ni02-recheck.json` |
| 相关 diff 检查（保留 Engine 测试原 CRLF，`core.whitespace=cr-at-eol`） | 通过 | Git 检查 |

新增 OAuth 首跑失败来自新断言错误地将 provider call id 当作宿主压缩 facts 的 call id。改为检查 facts 保留原目标，其余预算压缩、wire、配对和原文保留断言不变；只复跑该新增用例，生产算法未改。

ni02 材料背景例首轮为 `STACK_TRACE_ERROR`，耗时 5029.9 ms，接近默认 5 秒上限；单 worker 完整文件复跑通过。本批观察为一次失败、一次通过，保留偶发记录，不把推测的并发/超时归因当成已证实根因，没有扩大 timeout、跳过用例或减少保存/冷开断言。

曾有一次启动携带当前 Vitest 不支持的 `--minWorkers` 参数，在收集用例前拒绝；移除该参数后才产生上述首轮报告，不计为测试观察。

## Root 终点新增观察：repair18 automatic（只读归因）

追加日期：2026-10-25。本节只读取 Root 已有报告、脚本和直接源码，没有额外执行测试，没有修改产品、测试、模式或操作路径。

`tests/integration/executionRepair20261012.test.ts` 的 `repair18 persists the real first mode choice automatic and accepts ordered UI switching without changing frozen input`：

| 观察 | 结果 |
|---|---|
| 起点 `output/test-baseline/start-e77963756.json` | 同名用例 `passed / passed` |
| 终点 `output/test-baseline/2026-10-24T17-20-02-350Z/initial.json` | `failed`，504.4 ms；在测试 83 行调用 `answer` 时收到“这个问题已回答或已关闭，不能再次回答。” |
| 同次诊断的独立文件进程 `retry-13.json` / `.log` | 同名用例再次 `failed`，488.5 ms、同错误与同调用点；完整文件 13 例中 8 过、5 失败 |

因此 automatic 按当前约定是**本轮新增稳定失败观察**，不能写成偶发、已修复、终点无新增或因其他证据而抵消。该用例两次耗时均不足 1 秒，不是本节有证据支持的 5 秒测试超时。

同一 `it.each(['automatic','stepwise'])` 的 stepwise 在起点原始 `2026-10-24T15-57-58-625Z/initial.json` 通过，但在该次 `retry-13.json` 已于相同测试 83 行 / Engine 1341 行失败（238.9 ms），起点基线保留为 `passed / failed` 的偶发。终点 stepwise、自然语言显式选择和显式恢复三条 repair18 则均通过。这个历史同点失败证明参数族早已有该问题的观察，**不改变 automatic 自身在起终点的分类**，也不能单凭参数族相同就认定唯一根因。

### 可证的等待窗口

1. 测试 81 行仅轮询 `engine.read(...).tools.some(ask_user && state==='executing')`，82 行读出 callId 后立即在 83 行回答。它没有等待面向 UI 的 `waiting` / `question` 事件。
2. [ExecutionEngine.ts:548](../../../src/main/workbench/execution/ExecutionEngine.ts#L548) 对活跃 run 直接返回内存 record 的副本；因此这个轮询也不意味着 checkpoint 已结束。
3. [ExecutionEngine.ts:1498](../../../src/main/workbench/execution/ExecutionEngine.ts#L1498) 先将该工具置 `executing`，再等待 checkpoint 和已有 steering acceptance，1503 行才注册 `active.question`。这形成了“read 已能看见 executing，question 尚未注册”的真实异步窗口。
4. [ExecutionEngine.ts:1334](../../../src/main/workbench/execution/ExecutionEngine.ts#L1334) 的 `answer` 要求有效的 `active.question` 和匹配 callId；条件不满足且没有相同已接受答案可复用时，1341 行抛出本次报告的消息。Desktop `operate` 的 answer 分支（1359—1360 行）只转发并包装该错误。
5. 当前 `ask` 源码在注册 question 之后才发出 run-state waiting 和带问题的工具 waiting 事件（1506—1507 行）。因此测试读取内部 executing 的条件早于实际问题展示信号，不能直接把该失败描述成用户已经看见问题后仍无法回答。

以上是可产生该错误的机制证据。现有 JSON / log 没有记录本次 answer 时的 `active.question`、checkpoint / registration 时间线，不能据此断言这次就是该窗口、它是唯一原因，或实际 GUI 具有同样提前回答路径。后续应先核对 fixture 是否应等待真实 question-ready / waiting 事件，再核真实 UI 消费者是否也会在注册前触发回答；不能通过改模式、扩大重试或直接删除拒绝边界掩盖现象。本轮未实施这些后续修改。

### 与 R4 改动的因果边界

- **取消提示：** [HostToolServices.ts:531](../../../src/core/tools/HostToolServices.ts#L531) 的本批产品变化只在 `jobCancel` 的非 owner 拒绝分支改变字符串。该 repair18 fixture 只产生 `ask_user`，`ExecutionEngine.execute` 在 2266 行先分流到 `ask`，其 answer 走 Desktop → Engine.answer → 会话推进偏好 owner；没有通往 `jobCancel` 或该字符串的业务调用。这个直接路径证据支持“R4 取消文案不直接造成该 answer 拒绝”，不是仅凭文件没改得出的判断。
- **OAuth fixture：** 新覆盖位于另一文件 `g20ExecutionEngine.test.ts`，使用独立 `mkdtemp('g20-engine-')` 和内存 fixture provider；repair18 通过 `desktopFixture` 创建 `desktop-repair-` 独立目录与 `openai-chat` 离线 transport。两文件没有导入对方 fixture。当前 Vitest 默认 `isolate:true`，仓库配置未覆盖；基线脚本对失败文件另起进程，已读取的 `retry-13` 明确只收集该完整文件，仍出现同错。因此没有证据支持“新 OAuth fixture 的进程内状态遗留直接污染此用例”。
- **诊断脚本：** `scripts/test-failure-baseline.ts` 使用既有 `test:product` 的两条 exclude，初轮 `maxWorkers=3`，随后按文件另起一次进程；没有重写问题调用、重命名/过滤这个用例或调整 answer 服务。
- 以上没有排除系统负载、磁盘调度或其他因素对异步窗口命中率的间接影响；现有报告也没有证明此类因果。保留新增稳定失败和机制未决，由 Root 在总结果单列，不以本节分析洗绿。
