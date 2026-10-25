# Python／Vite 定位与用户影响（2026-10-25）

本次两次新探针已完成：原配置控制页面的常量读取耗时 22.7 秒、业务 Worker 尚未开始；真正生效的 `NoopWatcher` 对照中，该读取仅 6ms，真实 Worker／Python 完整通过，诊断总耗时约 4.83 秒。强支持根目录 watcher 相关的工作 Node 启动压力；尚不能在有缓存、插件配置与运行时点差别的条件下宣称无条件唯一根因。正式本地资源映射的 Python 作业另有可复用的实际成功记录。

Root 正式 CA246 原文件本轮未改、未复跑；历史稳定超时仍保留，**未签原文件通过**。本轮只完成定位与影响研究，局部 fixture 修复属于下文建议。

只读核对还发现前轮 `watch:null` 反事实的配置会在 Vite 合并时丢失，必须纠正“已经关闭 watcher 仍失败”的旧结论。原始失败报告全部保留；没有修改产品、正式测试、正式配置、timeout 或策略，没有 commit／push／发布。

## 用户实际会在哪里遇到

调用链是 `compute.run`（`WorkbenchServiceTools.ts:107`）→ `HostToolServices.runCompute`（:565）冻结输入与创建作业 → `ComputeJobService` → `PyodideComputeBackend` → 真实 Worker。它服务 AI 读表统计、数据分析、CSV／JSON 及图表生成；用户通过作业状态／日志取回计算结果，正式文件交付仍归现有 File owner。

`workbenchToolServices.ts:243–248` 明确分两条载体：

| 场景 | 实际入口与资源 | 现有结论 |
|---|---|---|
| 打包产品，或无 `VITE_DEV_SERVER_URL` | `dist-renderer/compute.html`，Main 私有 `https://guoling-compute.invalid` 本地映射；没有 Vite 服务 | 已有真实 Electron／Worker／Python／产物交付成功事实，见下节 |
| 带 Vite 的开发工作台 | 本机 HTTP `compute.html`，开发模块及相同计算 Worker | CA246 根目录曾稳定超时，本轮仍有准备及通信迟滞 |
| 普通选中、正文编辑、人工保存与播放器运行 | 没有找到它们直接依赖 `compute.run` 的调用链 | 不能把这个开发诊断故障推成全编辑器／播放器不可用；本次也未重验这些无关路径 |

若计算初始化确实停住，当前 `ComputeJobService:211–212` 在拿到可取消句柄后标 running 并等待 `process.done`，相应统计／图表成果会被阻断；不会凭空交付 ready。Stop 经 `cancelOnce` 调用实际 process.cancel，初始化阶段也已有句柄，取消不依赖 Python 执行完成。每个实际计算任务新建私有窗口与 Worker，并载入现有 manifest 的库；没有跨作业复用 Python 实例。本次不改变这些语义。

没有使用频率／用户遥测，不能声称它是高频、低频或普遍故障。准确范围是“调用内置计算的任务可能受影响”，不能把使用频率未知解释为影响很小。当前没有证据证明正式计算也受到 CA246 同因阻断。

## 可复用的正式生产路径证据

Root 现存 `output/productFollowup/T06/teacherLocalCompute/grades-qZ1J0v/` 的 `compute-facts.json` 与 `compute-checkpoint.jsonl` 记录：2026-10-25 01:33（本地时间；UTC 10-24 17:33），在前轮 Vite 两次诊断失败之后，真实 Electron Main 运行生产本地映射链。

- `teacherLocalComputeHarness.cjs` 直接调用当时 `dist-electron/main/workbench/compute/PyodideComputeBackend.js` 和 `ComputeJobService.js`，使用真实 preload／renderer，没有 mock 计算结果或 Writer。
- `backend.start` 到正式 ready 约 12.1 秒，实际加载 NumPy／pandas／Matplotlib，班级均值 90／80、总均值 85，exitCode=0；CSV 56B、中文 PNG 12,646B、probe JSON 可通过正式 artifact owner 读取。
- 真实 `DocumentHostService.artifactDeliveries` 对 CSV 和 PNG 返回 written。输入只读、宿主文件不可见及网络拒绝也有该次实际 probe 事实。
- 同批 `stop-BoMTw1/stop-facts.json` 记录真实取消 49ms，随后 execution missing、0 活窗口、0 延迟输出；此证据只覆盖该批停止样本。

版本边界：这些是当时实际编译产物的行为事实，不冒充本轮重新启动的安装包。当前上述 compute 源码、renderer compute、preload、`jobWait.ts`、runtime manifest 与依赖锁没有相关 dirty diff；直接计算源文件最近的 Git 提交早于该记录。现有 dist 在 10-25 15:48 被重新生成，不能把 mtime 或文件存在当成运行通过。没有发现会使已有生产行为证据失效的相关源变更，所以按 Root 决定复用，不机械重跑同一生产链，也不新增 Hash／制品身份门。

## 原开发失败保持

- 候选工作树原聚焦 CA246 通过，17,984ms，真实 Python 输出 42。
- Root 起点 `output/test-baseline/2026-10-24T15-57-58-625Z/initial` 与 `retry-129` 同名用例均 60s 超时，另有 fork 终止超时。候选通过不能替代 Root 失败。
- Root 前轮 ignored 阶段探针停在页面准备／load，未进入业务 Worker；显式 8 个 build HTML 输入否定了“缺省 glob 扫描全部 ignored 历史 HTML”的解释。
- 原始报告与阶段事实保留在 `20261024-regression-boundary-repair/REMAINING_RESULT.md` 和 `20261025-targeted-followup/EDGE_RESULT.md`；其中 watcher 反事实判断由本报告下节纠正，不覆写原始 raw。

## 本次第1次新实验：控制 HTTP 页面与进程调度

Root 安排该次唯一运行窗口，其他实现分支暂停实跑。该控制实验只运行一次，没有重试；随后另一次经确认的有效 watcher 对照见下节：

```powershell
node output/test-runs/format-core-repair/python/run-dev-control.mjs
```

探针在 ignored `output/test-runs/format-core-repair/python/`：`dev-control.test.ts`、`vitest-dev-control.config.mts`、准备脚本与外部 runner。配置明确只 include 该文件、globalSetup=[]。正式 Vite 配置、原计算策略、原四处成功／策略 expect 和 60s 测试上限保留。控制页面只在安装 compute 路由之前访问；计算导航安装原策略后执行，没有放行额外 URL。

承载 Vite／Vitest 的工作 Node 和外部父 Node 分别记录 heartbeat 与 event-loop-delay。工作进程 45s 诊断看门狗关闭自身资源；父进程有独立 60s 诊断上限，只管理自有 Vitest 子树，不改变产品时限。原正常 Vite 启动行为未增改。

raw 目录：`output/test-runs/format-core-repair/python/dev-control-1792917825648/`，含 `events.jsonl`、`parent-events.jsonl`、`watchdog.json`、`vitest.json`、`runner-result.json`。

| 自用例开始 | 实际阶段 |
|---|---|
| 2–19ms | 极小独立 HTTP 服务 listen；Node 自身 fetch 12ms 完成，200 |
| 21–115ms | 原 Vite createServer／listen 完成 |
| 116–1,956ms | Chromium launch |
| 1,956–9,788ms | browser.newContext，约 7.8s |
| 9,789–19,702ms | newPage，约 9.9s；此时尚未请求控制页或 compute 页面 |
| 19,704–20,035ms | 控制页面导航 331ms；服务端 19,845ms 收到、19,846ms 返回 200 |
| 20,036–42,764ms | 读取控制页面已存在的 `window.diagReady=42`，约 **22.7s**；尚未安装计算策略、未访问 compute、无业务 Worker |
| 42,765–42,953ms | 安装原 compute 请求策略及原 InitScript |
| 42,954–44,245ms | compute 导航；策略放行，Vite 服务端 44,245ms 完成 200 |
| 45,386ms | 45s 看门狗执行，此时仍 page.goto，workers=[]、blockedUrls=[]、errors=[] |
| 47,398ms | 自有 browser／backend process／Vite／控制 HTTP 全部清理；外部 runner 48,741ms 收到 code1，未触发外部 kill |

Vitest 实际报告 1 failed，47,400ms。失败是诊断清理关闭 page.goto；不是原用例跑满 60s 的重测，也没有抵达原四处成功断言。看门狗之后才出现的 React refresh 拒绝不能倒因为之前的控制页面迟滞。

### CPU、RSS 与调度事实属于谁

`process.cpuUsage()`、`process.memoryUsage().rss` 和内部 heartbeat 在 **承载 Vite／Vitest 的 Node 进程**记录；它们不是 Chromium 进程树的 CPU／内存，也不是 Python 资源。CPU 数值包含该 Node 进程线程的累计 user/system 时间，不能单凭它定位到具体函数。

- 工作 Node 的 heartbeat 最长相隔 12,803ms，RSS 从第一秒约 233MiB 上升到最高 1,975MiB；这种增长在 compute 导航前已明显出现。
- 外部父 Node 同期 heartbeat 最大间隔 1,025ms，event-loop-delay 最大约 33.7ms。它反对“整台机器统一长暂停”的解释，但不能排除局部资源竞争、进程优先级或其他机器因素。
- 独占运行前一次轻量 OS 观察显示 16 逻辑核、总物理内存约 32,253MiB、空闲约 16,317MiB、CPU 瞬时负载 38%。它与探针不在同一采样区间，不能拿来证明历史或本次的资源根因。

可证实的是：主要迟滞已出现于计算内容无关的浏览器操作，并伴随开发工作 Node 的局部重负载／调度延迟。尚不能在 Vite watcher、依赖优化、原生扫描、GC、driver 通信或外部进程影响之间确定唯一原因；没有 CPU profile 或对应热点 trace。

## 更正前轮 watcher 反事实

前轮 `ca246-diagnostic-nowatch.test.ts` 只是 inline 传入 `server.watch:null`，日志未记录实际 resolved watch。当前安装 Vite 8.1.5 的 `mergeConfigRecursively`（`node_modules/vite/dist/node/chunks/node.js:2839`）对 override 的 null 直接跳过；`resolveConfig:35619` 则用 `mergeConfig(配置文件, inline配置)`。正式 renderer 配置已有 server 对象，因此该 null 在递归 merge 时被丢掉；后续 `serverConfig.watch !== null`（:25797）仍选择真实 watcher。

本次没有启动服务或浏览器，只调用已安装 Vite 的纯 `mergeConfig` 导出函数，按两侧实际 server 形状复现，结果 `hasWatch:false`、`watchIsNull:false`。原始输入／结果在 `output/test-runs/format-core-repair/python/watch-merge-fact.json`。

**此前把“输入写了 null”等同“watcher 已关闭”，证据不充分且按当前合并实现不成立。旧反事实不能用来排除 watcher，也不支持它就是根因。** 这更正前轮 REMAINING_RESULT／EDGE_RESULT 的相应推断；两个失败 raw 和本次失败均保持原样，没有借更正宣布通过。

## 有效 watcher 单次反事实：真实 Worker／Python 已通过

Root 确认上一分支浏览器检查结束后，再给一次独占窗口。仅运行 `node output/test-runs/format-core-repair/python/run-dev-control-resolved-nowatch.mjs` 一次，无重试；新 raw 在 `output/test-runs/format-core-repair/python/dev-control-resolved-nowatch-1792918421018/`，旧 raw 保留。

区别仅限 ignored 诊断：增加 post `configResolved` 插件，将合并后的 `config.server.watch` 设置为 null；在服务创建后与 listen 后记录实际实现并检查。仍使用同一控制页、内外 Node heartbeat、正式 Vite 输入与优化选项、原请求策略、真实 Python 42 与原四处 expect，60s／45s诊断设置均不变。

| 观察 | 原配置控制 probe | 实际 noop 对照 |
|---|---|---|
| watcher 生效事实 | 正式配置未覆盖 watch；新对照的 override 前实际记录 `hasWatch:false/watchIsNull:false`。按 Vite `watch !== null` 工厂分支会启 root chokidar；原 probe 未记录 constructor/getWatched，因此不追认已有原 watcher OS 句柄快照 | override 后 resolved null；创建服务前后实际 constructor=`NoopWatcher`，getWatched={}，方法实现为 return{}；listen 后仍相同 |
| Chromium context／page | 7,832ms／9,913ms | 8ms／54ms |
| 控制 HTTP 导航／常量读取 | 331ms／22,728ms | 53ms／6ms |
| 工作 Node heartbeat／最高 RSS | 最长 12,803ms／1,975MiB | 最长 1,015ms／1,326MiB |
| 外部父 heartbeat | 最大 1,025ms | 最大 1,028ms；两次均没有全局长暂停事实 |
| compute 页面／业务 Worker | 45s诊断清理时尚无 Worker | compute 导航222ms，735ms实际创建 Vite module Worker |
| Python／断言 | 未进入，不签任何输出 | 691–4,672ms执行真实 Python；exitCode0、stdout42、stderr空、未取消；原环境模块放行及 dev无关路径／生产dev路径拒绝三处策略断言也全部抵达 |
| 结束与资源 | failed，47,400ms；诊断清理产生 Target closed | 1／1 passed，4,833ms；4,832ms自有资源全清，无watchdog／外部kill |

该诊断只要求 stdout42，产物列表是空数组；不能把它写成新生成图表／保存验收。CSV／中文 PNG／正式文件 written 的产品证据来自前述有效生产作业，各自范围保持。

### cache／插件／运行时点变量

两次使用同一 `D:/果铃工作台/node_modules/.vite`，没有删除共用缓存。本次 `cache-before.json` 仅有前一 probe 留下的 `deps_temp_b860ef6d`（目录内1项）和 vitest；没有已提交 `deps/_metadata.json`。`cache-after.json` 显示实际生成 deps 303项及完整 metadata，说明通过时仍完成了依赖优化，不是直接复用已有完整 deps。

Vite 优化选项、显式8个HTML输入、策略及源 Worker 保持；但新增诊断插件名会进入 Vite `getConfigHash`（:31941），属于额外配置身份变量。上一控制 probe 没有 cache-before 快照，OS 文件／磁盘缓存、期间少量源码编辑及机器时点也未形成严格冻结实验。因此结论限定为：**真实禁用 root watcher 与工作 Node 调度和计算准备恢复形成强对照，支持 watcher 相关启动压力；不是无条件唯一根因或普遍速度倍率。** 两次较大的 Node RSS 也说明依赖优化负载仍然存在，不能声称关闭 watcher 后没有其他开发成本。

## 是否值得修与最小方向（本次只建议）

值得消除 CA246 这个可重复的开发验收阻断，优先级属于开发维护／验证可靠性；现有证据不足以抬为正式产品 Python 核心不可用。当前正式计算成功及实际取消事实有效，使用频率无遥测也保持。

最小方向是 **仅为 CA246 的一次性 compute 测试载体关闭文件变更监听**，在测试拥有的配置装配处确保设置真实生效。它只验证既有 dev module Worker、内置 Python 与请求策略，不验证源码热更新；本次真实 noop 下原正确断言已完整通过。正式 fixture 修复须保留当前 TS computeEntry／Worker、完整本地资源、原策略、原60s及原四处断言，精确覆盖该属性即可，不用把控制页或全套诊断平台永久接进正式测试。

不默认关闭工作台全局 HMR，也不修改正式 Vite 全局配置。完整开发工作台需要热更新；若之后有用户实际开发启动问题，应另按真实监听范围定位要排除的生成目录，并核其是否承担现有预览／作者内容更新，再决定局部范围。不能用本用例的 noop 诊断代替对全局开发体验的产品取舍。

截至本次结束，没有实施这个正式 fixture 建议，没有新增 CPU profile／额外矩阵、生产重跑、全仓或类型检查。两个新实跑均已释放窗口、清理自有资源；用户工程、其他进程与原有证据未动。
