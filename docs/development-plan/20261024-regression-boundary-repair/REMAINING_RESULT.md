# R3 其余告警检查结果

**2026-10-25接续：** [核心路径实施及Python调查](../20261025-format-core-repair/RESULT.md)已修Source旧ACK和后续鼠标拖动，并核关闭保稿／菜单／PPT对应链。旧inline `watch:null`未实际生效的推断已在[新调查](../20261025-format-core-repair/PYTHON_INVESTIGATION.md)纠正；有效NoopWatcher反事实通过，但正式CA246未改未复跑。本文件的旧观察／raw保留历史时点，不据此继续排除watcher或宣称旧红已全清。

状态：本叶子分项检查完成；没有修改产品源码、UI、模式或操作路径，未 commit／push／发布。

## 已验证结果

| 原问题 | 实际结果／分类 | 用户影响与处理 |
|---|---|---|
| slideContentFirst — cancels queued object preview on pointer cancel and context change without a late commit | 通过；测试夹具缺新增端口 | 保留取消手势／上下文变化不晚提交断言，只补 mock 的 resolveSelection，默认 null。 |
| slideContentFirst — updates the hidden-object count from live instance visibility even when project identity stays the same | 通过；测试夹具缺新增端口 | 保留同一工程对象身份下隐藏计数实时刷新的断言。 |
| slideContentFirst — uses the final pan delta after a frame and discards a cancelled pan before further move events | 通过；测试夹具缺新增端口 | 保留最终平移量、取消后不继续处理移动／不提交断言。 |
| auditAllExportsDevCompute — CA246: the actual Vite module Worker runs local Python through the backend dev request policy | 候选聚焦 1/1 通过（17.984s）；根目录起点全量初轮及独立 retry-129 均 60s 超时，根目录本轮观察为稳定失败 | 候选确实执行到 Python 输出 42；不能据此覆盖根目录两次失败。当前停点未知，未改 timeout／断言／产品，也未归为选中 UX。 |
| g20DocumentJournal — G20 durable document journal reads legacy active journals and upgrades the next Session write without changing document content | 当前无法复现，完整文件 18/18 通过 | 原 active journal 读取与下次 Session 写升级、文档内容保留均实际通过；未修改。 |

### nativeText 端口核查

生产全仓 `useSlideNativeTextEditor` 调用只有 SlideLocationWorkspace、Workspace（Program）和 SpatialLocationWorkspace，均直接调用同一个 hook；该 hook 的唯一返回分支无条件包含 `resolveSelection`，没有另造生产 nativeText 端口。ProfessionalContentEditor 的同名变量是内置类型判断布尔值，不是编辑端口。因此当前缺方法来自本文件 `vi.mock`，无需生产可选链／兜底。

只改 `tests/unit/slideContentFirst20261022.test.tsx`：在现有 native mock 中补 `resolveSelection`，每例重置并返回 null；未改测试名、事件、成功断言或生产代码。完整文件复跑 **3 通过／14 失败**，恰好恢复原提示词列出的 3 条新增告警，其余 14 条仍失败（手势／hover／旧单击输入／paint callback 等）；原提示词已列其为既有失败，本叶子没有重新归因或扩面清零，未声称全文件通过。

## 原未归因 4 条

当前 4 条均复现，2376311b3 隔离工作树完整文件复跑均在相同位置失败（两版同为 5 通过／4 失败），属于这次架构／统一选中之前已有失败。保留原 fullName 及正确行为断言，没有改查询或放松参数使其通过。旧夹具阻断了后续行为证据，因此不能据本轮测试宣称这些核心操作已验证。

| 文件／完整测试名 | 当前实际失败点 | 结论／用户影响与后续建议 |
|---|---|---|
| LessonWorkspaceShell — 2.0 workspace shell shows an unavailable unified assistant without a CLI fallback and still creates a real untitled document | 旧“Markdown 文档名”输入不存在，尚未到新建文档断言 | 既有失败；旧创建入口夹具已失配，后续未命名文档／菜单断言尚未验证。后续单独按当前正式新建入口迁移夹具，保留原数据／菜单能力断言。 |
| LessonWorkspaceShell — 2.0 workspace shell blocks close on a disk conflict and preserves the canonical draft and mounted editor without saving over the file | 未找到“此处保留当前稿”按钮，尚未到关闭／保留／不覆盖磁盘断言 | 既有失败；2376311b3 同样不存在该按钮文本，当前未到 close／preserve 断言，不能据此判实际数据丢失。后续单独查现有冲突恢复入口并验证保留／不覆盖磁盘，不能为旧查询新增产品 UI。 |
| g20M21TabMenu — M21 gives each file tab one right-click menu whose unavailable items say why | 前置创建文档查询旧“Markdown 文档名”输入失败，尚未到菜单断言 | 既有失败；旧创建入口夹具已失配，后续未命名文档／菜单断言尚未验证。后续单独按当前正式新建入口迁移夹具，保留原数据／菜单能力断言。 |
| g20M21PptxEntries — imports PPT through the empty content import menu, preserving actual parsing and the existing course callback | 回调已收到正确 {name, bytes}，另有 AbortSignal／foreground 参数，精确调用参数断言失败 | 既有失败；回调签名早于本批已含取消／前台生命周期参数，未证明实际解析丢失。后续补正确参数语义断言并继续原解析结果断言，不削弱结果要求。 |

## 证据与范围

- 起点聚焦：`output/test-runs/regression-boundary-repair/remaining-before.json`，6 文件、maxWorkers=2；CA246 和 journal 通过，Slide 17 条被缺方法遮蔽。
- Slide 复跑：`output/test-runs/regression-boundary-repair/slide-after-mock.json`，1 文件、maxWorkers=1，3 通过／14 失败。
- 历史对照：`output/test-runs/regression-boundary-repair/shell-historical-2376311b3.json`，ref 2376311b3，3 文件、maxWorkers=2，5 通过／4 失败，4 条与当前同点失败；历史产品和测试无修改。原始报告从历史工作树复制留存到候选 ignored output，便于总结果引用。
- Shell 当前：`output/test-runs/regression-boundary-repair/shell-current.json`，3 文件、maxWorkers=2，5 通过／4 失败。
- 隔离候选的 node_modules 是指向根目录的 Junction，首次三个 Shell 文件加载被 Vite `Denied ID .../pdf.worker.min.mjs?url` 阻断。仅在 ignored output 生成临时 merge 配置，`server.fs.allow` 加入 `realpathSync('node_modules')` 后实际加载，不修改正式 Vitest 配置、产品权限、全局 mock 或断言。该问题属于本次隔离运行环境，不归为产品回归。


## CA246 后续增量：候选通过与根目录稳定超时

新增根目录证据不能被候选聚焦结果替代：

| 观察 | 实际结果 |
|---|---|
| 候选 `remaining-before.json`、原配置、maxWorkers=2 | CA246 完整通过，17,984ms，执行真实 Worker／Python 输出 42及请求策略断言 |
| 根目录起点 `output/test-baseline/2026-10-24T15-57-58-625Z/initial.log` | 同名用例 60s 超时，测试耗时约67.65s；有 fork 终止超时 |
| 同起点独立 `retry-129.json`／`.log` | 同名用例再次 60s 超时，测试耗时约63.87s；有 `[vitest-pool]: Timeout terminating forks worker` |

只读核对：原 CA246 测试、PyodideComputeBackend、Vitest／Vite配置在根目录与候选没有文本差异；两处 compute manifest 的版本／资源路径／包列表相同，pyodide.mjs 和 wasm 均存在且尺寸相同。候选 node_modules 是根目录 D: 依赖的 Junction，候选 public/vendor/compute-runtime 为实际目录。尺寸和清单仅排查明显缺失，不声称已经证明整套 runtime 字节身份相同。

原测试只在 `page.evaluate` 被拒绝时汇总 requested／blocked／console；Vitest 外层 timeout 不会经过该 catch。现存日志没有 await 阶段或网络快照，因而尚不能判断是 server.listen、页面／Worker/Python、还是最后 server.close 等待。fork 终止超时也不能独自证明业务 Worker 是根因。共享 `.vite` 仅见 deps_temp/package.json，同样不足以认定缓存锁或并发根因。

“根目录 ignored 历史 HTML 被默认全扫描”目前与静态配置不符：vite.renderer.config.ts:85 已指定 8 个 build.rollupOptions.input；已安装 Vite8 将其归一到 rolldownOptions，computeEntries 优先显式 optimizeDeps.entries 或 build input，只有两者都缺省才 glob **/*.html。不得以该假设先加 exclude；诊断将记录实际 resolved input 验证是否有运行时改写。

### 一次性探针：起点结束前准备，随后按下节单次执行

按 Root 要求仅写根目录 ignored output，未修改根目录 src／tests／正式 config：

- `D:/果铃工作台/output/test-runs/regression-boundary-repair/ca246-diagnostic.test.ts`
- `D:/果铃工作台/output/test-runs/regression-boundary-repair/vitest-ca246-diagnostic.config.mts`

该探针克隆同一真实链和全部原正确断言，保留 60s 原超时；逐 await、Vite 实际配置、请求／响应／失败、Worker、console、cleanup 即时写 events.jsonl，45s 看门狗落 watchdog.json 并关闭自身 browser／process／backend／server。配置直接覆盖 include 为这一文件、globalSetup=[]，不使用数组 merge 扩大范围。已仅用 esbuild 转译检查语法，没有执行测试／浏览器／服务。

需 Root 确认起点 308 文件复跑全部完成后，才在 D:/果铃工作台 单次执行：

```powershell
npx vitest run output/test-runs/regression-boundary-repair/ca246-diagnostic.test.ts --config=output/test-runs/regression-boundary-repair/vitest-ca246-diagnostic.config.mts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/regression-boundary-repair/ca246-diagnostic-vitest.json
```

探针日志目录会打印并采用独立时间戳。它用于定位，即使探针成功也不替换原两次超时，不宣称原测试已经修好。


### 起点全部复跑后：单次阶段探针实际结果

Root 确认 308 文件复跑全部完成、起点 JSON 已落盘后，已在根目录按上述命令 **仅运行一次**，没有重试或修改 Root／Candidate 产品、测试、正式配置。诊断用例失败；它没有替代原根目录两次 60s 超时，也没有把候选 18s 的通过洗成全局通过。

日志目录：`D:/果铃工作台/output/test-runs/regression-boundary-repair/ca246-diagnostic-1792861785807/`，含 events.jsonl、watchdog.json；Vitest 报告为同父目录 ca246-diagnostic-vitest.json。

| 阶段 | 自探针开始的时间与事实 |
|---|---|
| createServer／listen | 67ms createServer 完成；144ms listen 完成。实际 resolved buildInput 仍为8个HTML，未退到全目录HTML扫描 |
| Browser／page准备 | chromium.launch 1.52s完成；newContext 4.57s；newPage 8.68s；addInitScript 8.81s |
| page.goto(load) | 8.81s开始；compute.html被策略放行，约20.52s服务端HTTP200，20.67s浏览器收到 |
| Vite模块请求 | /@vite/client被放行、21.99s服务端收到；computeEntry.ts被放行、26.32s服务端收到；直至关闭前未记录两者响应 |
| 拒绝／console | 只有 /@react-refresh 被请求策略拒绝，console ERR_FAILED；没有证据表明它单独造成模块挂起，候选原用例采用相同策略仍曾通过 |
| 首个明确错误 | **page.goto 的 load 等待30s超时**，总50.36s记录；尚未进入 auditComputeRun 等待、Worker创建或Python执行 |
| 看门狗／清理 | 设置的45s计时器实际50.36s才调度到；workers=[]，随后自有Browser／backend process／Vite全部关闭，53.46s记录cleanup完成，54.13s finally完成；没有本次fork终止超时 |
| 清理产生的错误 | 服务器关闭时 computeEntry.ts 请求出现 ERR_EMPTY_RESPONSE，不把清理后的错误倒因为最初故障 |

可证实结论：这一次根目录探针的阻断在 **Vite页面模块服务／load等待边界，发生在业务Worker及Python之前**。不能据此报“Python计算失败”或把权限策略扩大；也不能认定已找到某个 Vite内部Promise、缓存、资源竞争或Node事件循环变慢的唯一根因。当前信息足以排除“这次Python执行慢”及“实际扫描了全部ignored HTML”两个解释，保留根目录原用例稳定超时、根因未闭合。

没有继续循环探测、改 timeout／expect／exclude 或追加全仓验证。下一步若需继续归因，应聚焦已请求但未响应的 Vite client／computeEntry 变换等待，不重写计算服务，也不以成功的候选聚焦结果覆盖根目录失败。


### 继续只读核对：Vite 文件 watcher 与目录差异

该假设与前述已否定的 HTML optimizer 全目录扫描不同，存在已证实的代码机制：

- 已安装 Vite `node_modules/vite/dist/node/chunks/node.js:25797` 在 `server.watch !== null` 时，以 root（外加 config/env/public）启动 chokidar watcher。当前正式 Vite 配置及原 CA246 createServer 没有覆写 watch。
- 同文件 `resolveChokidarOptions`（13229）默认忽略 .git、node_modules、test-results、cacheDir，以及 emptyOutDir 对应的 dist-renderer。没有自动把 .gitignore 里的 output／release／tmp／scratch／docs/archive/local 纳入忽略。
- `ignoreInitial:true` 只压制初始 add/addDir 事件；实际 `_handleRead`／`_handleDir`（约9447—9527）仍逐目录 readdirp 并递归 `_addToNodeFs`，不是“启动不遍历”。watcher 开始工作之后 createServer／listen 可以返回，故它与随后模块请求争用 FS／事件循环的机制成立。

本轮仅查看浅层目录，没有在 GUI 检查期间递归全仓统计：根 output 有 **458 个直接项／265 个直接目录**，候选 output 为 **6／5**。根另有 release（14直接项／12目录）、workspace、scratch、tmp、docs/archive/local 等候选没有的本地目录。它证明默认 watcher 输入范围不同，但不能单靠目录数证明性能成本、时间关联或唯一根因。

与新 GUI 证据的差异：imagePanelBrowser／flowFloatingBoundaryBrowser 用一次性 esbuild bundle 和 Playwright page.route 装配，**不创建 Vite root watcher**；其他现有实际 Vite browser fixture（flowManualFeedbackBrowser、imageDerivativeDeliveryBrowser）明确设 `server: { ..., hmr:false, watch:null }`。

最小必要处理建议：CA246 验证 dev module Worker／Python／请求策略，没有验证文件变更热重载；可先在一次性探针只将 `createServer.server.watch` 改为 null 做单变量对照，保留正式 Vite 载入、所有原断言、60s 和权限策略。若这项对照支持，再把它作为测试 fixture 的必要资源边界处理，不先改产品全局 Vite 配置或扩大 exclude，也不同时改 cacheDir／optimizer 以混淆归因。

依 Root 当前指令，此阶段 **没有运行新探针、没有修改产品／原测试／配置**，不会与 Root GUI 浏览器检查竞争。当前仍是“watcher 输入差异及机制已确认；它导致 CA246 稳定超时的因果关系待单变量证据”。


### watch:null 单变量诊断对照：仍失败，不落实为正式修复

Root 确认新 GUI 4／4 检查已经结束、没有并行 Root 浏览器测试后，授权只对 ignored 原探针制作副本。副本仅增加 createServer.server.watch=null；保留相同正式 Vite 配置载入、原4处正确expect、真实Worker／Python链、60s与阶段记录。原探针及原报告保持。

单次命令使用 `ca246-diagnostic-nowatch.test.ts`／`vitest-ca246-diagnostic-nowatch.config.mts`，输出 `ca246-diagnostic-nowatch-vitest.json`；配置仍明确单文件include、globalSetup=[]。**只运行一次，仍失败，没有循环重试。**

新日志目录：`D:/果铃工作台/output/test-runs/regression-boundary-repair/ca246-diagnostic-nowatch-1792862157105/`。

- server.listen 162ms完成，backend.start 163ms完成。
- chromium.launch 2.47s、newContext 8.63s、newPage 17.51s、addInitScript 23.51s才完成；随后开始page.goto。
- compute.html 39.60s服务端收到、42.53s服务端HTTP200，浏览器直到51.98s才记录收到响应。
- 45s看门狗实际50.48s调度到，仍在page.goto，workers=[]，当时没有console错误或被拒绝请求；清理时才出现后续模块请求。
- 自有资源关闭使page.goto在52.87s报Target closed，53.00s记录全部清理完成。尚未执行Worker／Python或抵达原成功断言。

结论：**关闭这个Vite文件watcher并没有消除根目录迟滞**。默认watcher会覆盖较多本地目录这一机制和路径差异仍成立，但本次反事实不支持把它认定为CA246的充分根因，不应据此直接把正式测试改成watch:null并宣布修复。迟滞同时出现在Chromium上下文／页面创建、脚本初始化和本机响应传输，不能再把全部现象缩成“计算模块变换慢”。事件调度、进程／机器资源或其他Vite等待的具体因果仍未知。

本次对照发生在Root已合入review候选后；原Worker／计算测试／正式Vite配置未变，其他候选修改和机器瞬时状态并非严格相同。因此它是一次最小必要诊断证据，不是性能定量实验或唯一根因证明。没有修改正式test／产品／Vite配置，也没有扩大为新矩阵。


## 终点新增稳定失败：offscreenSandbox 原生 HTML 活动快照

只读核对，没有运行测试／探针或修改产品、测试、超时、skip、UI／模式。

完整用例：`tests/unit/offscreenSandbox20261013.test.ts` — `keeps native HTML and owned srcdoc state while publishing cooperative activity snapshots; uncooperative timers remain live`。

| 原始观察 | 状态／失败点 |
|---|---|
| 起点 `2026-10-24T15-57-58-625Z/initial.json` | failed，250行 paused.late 为 undefined，约2.87s |
| 起点同目录 `retry-257.json`／`.log` | passed，约1.33s；所以起点分类 flaky |
| 终点 `2026-10-24T17-20-02-350Z/initial.json` | failed，同250行，约8.22s |
| 终点同目录 `retry-250.json`／`.log` | failed，同250行，约1.71s；该文件其余3条passed |

基线文件均位于根 output/test-baseline。known-failures.json 已正确保留 comparison.newStable：起点 flaky 变终点 failed／failed，属于**本次新增稳定失败**，不能用旧偶发记录抵消或写成“既有已知所以没有新增”。

### 失败的确切含义

250行断言是 `expect(paused.late).toEqual(paused.snapshot)`。前一行249的 **当前 snapshot 为 `{active:false,visible:false,playing:true}` 及 readonly 都已通过**。因此不是“当前 activity snapshot 为 undefined”；失败的是测试作者脚本另存的 late 值。

late 只在237行作者HTML的 `setTimeout(...,40)` 回调中赋值：读取 `window.__guolingRuntimeActivity` 后，非空才调用局部 activity 函数。宿主在 mount 完成后只执行246行 `page.waitForTimeout(70)`，没有观察该作者回调实际发生或其赋值时刻。mount确认的是既有realm／协议准备，不是作者定时器完成。

源码活动传递链：

1. SandboxComponentRuntime:1726 在 mount 启动时订阅并缓存正式 `__runtime.activity`，通知port；fixture立即切换inactive。
2. SandboxComponentRuntime:447 在内容realm处理mount消息时调用 setActivity；:88更新活动，:95转给 authoredDocument。
3. authoredDocumentBootstrap.installAuthoredDocumentPrograms.setActivity 发 `__runtime.activity`；installOwnedDocumentBridge（:280）定义只读 getter，activityEvent（:290）保存副本并向owned子文档转发。
4. 用例的作者40ms回调另读这个 getter；70ms宿主等待和“mount ACK”均不为该回调提供明确完成证据。

现存失败报告没有事件／定时器／赋值顺序trace，不能区分“回调尚未执行”与“回调已在activity赋值前读取undefined”。`record('html-cooperation', ...)` 位于后续断言全部完成之后，250行失败不会产出该次 paused／after／nestedBefore 的分项记录。不能拿历史成功时留下的输出充当本次失败trace。

### 与本轮修改的因果边界

核对相对HEAD的实际diff：该测试、SandboxComponentRuntime、src/components/web（含authoredDocumentBootstrap／contentRealmImplementation／ownedDocumentAuthoring）、player/lightEdit及相关browser helper没有本轮修改。fixture直接esbuild这些runtime并启动隐藏Electron BrowserWindow（backgroundThrottling:false），不挂载本轮 SharedDocumentEditor、HtmlPreviewPane、图片面板或工作区入口。没有找到本轮UI／source改动改变这条作者timer／活动传递链的直接因果证据。

这不足以把失败降格为“纯夹具漂移”或断言产品无问题；也不能仅凭源码未改证明运行环境与全部间接影响相同。当前可证实的是：采样时正式活动快照及只读性正确；作者延迟快照的预期未满足。后续原生HTML／owned srcdoc状态保留、协作暂停与未协作timer等断言在该失败case中尚未继续执行，不能签通过。

最终记录为：**新增稳定失败，原生HTML作者定时回调与activity时序未决，未确认本轮产品改动因果**。不改timeout／skip／断言，不提出新UI或额外模式，也不重跑来冲淡终点两次失败。
