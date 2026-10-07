# 教师免 WSL 计算执行端独立复审

2026-10-07。R4 沿用 [已通过的设计审](R4_REVIEW.md#免-wsl-计算替代设计审main-8cea17c6仅方案未实施)，本文件只审 Owner 随后授权的实际实现与对应最小证据。Reviewer 未参与产品、资产或测试实现，不执行构建、真实模型和付费调用；当前仅写此证据文件。发行继续暂停。

**当前结论：免 WSL 计算域与受控 provider 的 B 完整创作／交付链独立 review 通过，C1/C2 均关闭，无未闭计算 finding。**实际源码、真实 CSV/中文 PNG、成果写盘、ready 冷开及最终 exit=3 证据已齐；启动 Stop 与冷 pending 不重放复用前述有效证据。B 原例已 1 passed／14.6s，包含公开保存／导出、独立内容浏览器真实点击与作者 History 保全。结论限于 engineering candidate；真实供应商 LIVE 和 fresh Windows 目录候选尚在执行，安装与发行未接受，不从受控链外推。

## 当前直接 consumer 与保留行为

- `WorkbenchServiceTools.ts:17,44,76`：公开参数仍为 code、sources、outputNames；来源由软件读取和冻结。cwd=`/job/output`，`/job/work` 为同目录别名，`GUOLING_INPUT_DIR`／`GUOLING_OUTPUT_DIR` 保留。省略 outputNames 时发现实际成果；单个坏文件诊断不能吞掉其余有效成果。ready 不表示已写入用户文件。
- `HostToolServices.runCompute:343–371`：原 operationId 派生 jobId，来源冻结后再次核运行可写；pendingCompute／computeJobs 归原 run，停止后等待已启动作业并取消。`stop` 先置 stopped，再取消实际后端；`readComputeArtifact` 仍要求运行可写。只需去除实际存在的旧“固定镜像”提示，不新造调度或审批层。
- Main `workbenchToolServices.ts:309–335,450–458`：compute 来源走原 AgentFileService 的授权文件读取；成果走原 ArtifactDelivery/File writer；停止先撤回授权并 abort，再取消计算。后端替换不改变这些正式 owner。
- `ComputeJobService`：相同作业／请求复用记录；已 ready 可回读，冷 preparing/running 保持 unknown、不重跑。输出真实读取、相对路径范围、有效文件和逐项诊断、原成果身份校验继续归当前 owner。新执行端只收冻结输入并返回输出 bytes，不获得用户磁盘、Main、Provider Secret 或网络权限。

## 本次复审只接收的最小证据

I 的实际 diff 及直接 caller 用于判断 owner、路径别名、session/Worker 权限和停止生命周期是否保持；player_export 的实际离线 runtime／完整依赖／Agg 中文字体打包结果用于判断是否消除了教师安装前置。T_lifecycle 的真实 Electron/Pyodide CSV→均值 90/80、总均值 85、中文 PNG、输入只读、host sentinel／网络不可达、真实 terminate/settle 与冷 unknown 证据，和 T_content 代表性 V10 保存冷开／必要成果消费证据，按实际变化复核；不以目录、字符串、跳过或假后端当真实执行成功。

既有绿色证据在实现未变时复用；无全任务总时限、全矩阵、通用 Hash 门或新执行平台要求。只在实际失败或新代码暴露具体行为缺口时追加最近层反例。候选和行为证据未到达前，不提前将实现记为 ready、合入或 Owner accepted。

## 实际候选静态复审

已直接读全部新增 carrier／preload／worker／HTML 文件及相应 diff；Git diff 未列出的新文件也逐份读取。新增 `ComputeBackend` 仅包含当前 caller 消费的 start/availability/inspect/stop 端口及字节结果，无新增作业注册或调度状态。`ComputeJobService` 仍是作业与 scratch 唯一 writer：返回的相对输出逐项落原 output，随后执行原 artifact、诊断与保存链。原 requestDigest 表达式未改；v1 已完成记录仍能读，跨 backend 的冷 pending 只变 unknown，不查询新 worker 后猜测旧执行成功。

`PyodideComputeBackend` 使用独立无缓存 session，无 Node/worker Node/subframe Node，窄 preload 只转本次 input/result。webRequest 声明仅允许具体入口、runtime 与编译 assets，开发请求也限本机实际路径；但真实 Worker 的 file fetch 绕过该声明，见 C2，不能将此静态设置视为文件隔离成立。IPC 检查本窗口 mainFrame、executionId、sent/settled；未新增网络或 host-file 端口。每作业新 module Worker；WORKERFS 输入来自冻结 Blob，`/job/work` symlink 到 `/job/output`，cwd 与环境变量保留；补入 sys.path 和 `__file__`，保持输入旁模块与脚本位置含义。

cancel handle 在初始化完成前返回；Stop/dispose 同步进入一次性 finish，destroy 实际窗口并 resolve done，晚到 IPC 由 settled 忽略。Main 仅默认接线和原 dispose 扩展；安装入口已有 installed guard，未引入第二执行器 owner。新记录 v2 只明确现后端与执行身份；保留 v1 reader 是既有已完成作业可读需求，不是新格式课件兼容层。

离线资产清单实际为 Pyodide 314.0.7、Python 3.14.2、NumPy/pandas/Matplotlib 和 lock 的依赖闭包，另有 Noto Sans SC OTF、OFL 及依赖许可。开发准备脚本下载固定 release，wheel Hash 仅核官方 lock 的制品身份；运行时载入本地资源，未接 pip/CDN 或自动下载。Vite 的 public 复制和已有 builder `dist-renderer/**` 承载运行资源；实际离线执行仍须 T/E 原结果证明，文件存在不单独视为通过。

### C1：正常 Python 退出可能被误判失败（当前可用性，待修证）

读到的 `computeWorker.ts` 直接 `await runtime.runPythonAsync(input.code)`；外层 catch 统一保留 exitCode=1，且输出收集位于其后。真实原支持脚本 `写 summary.csv；sys.exit(0)` 在 python3 以 0 成功结束；Pyodide 的 SystemExit 若进入该 catch，会误报失败并跳过已经生成的成果。I 已确认此为要保留的正常脚本语义，Root 已指定同最近层实际验证和窄修。此项不要求恢复 OS subprocess、任意原生扩展或扩大运行平台；修复完成及实际 API 反例未到前，不记关闭。

### capability 生成的直接附带修复

`scripts/generate-ai-capabilities.ts` 三处 `z.toJSONSchema` 改为 `{io:'input'}`，仅表达目录发布的可提交 JSON。直接源码的 color normalize transform 及正式 parser 不变；没有 any 化，也没有以生成 JSON Schema 替换正式校验。目录中的 color 仍是 string，highlightColor 是 string|null；其余非法色值仍归 canonical parser 拒绝。

已读取 E 原日志：首次 `generate-capabilities.log` 因 transform 无法表达而 exit=1；该窄修后的 `generate-capabilities-input-schema.log` 实际生成 108 文件、exit=0。已读首份 `build-renderer.log`（11.24s、exit=0）和 `build-electron.log`（exit=0）；这两份属于其记录的先前 working cut。后续相关源码／generated 变化的最终准备与真实行为结果按对应新日志记录，不据此重复无关构建或提前宣称最终 cut 全绿。

## 首次实际行为证据与最窄剩余

直接读取 E `output/teacher-runtime-evidence/teacher-local-compute.log`：3 匹配、0 跳过，Stop 与原 T09 有效成果例两项通过，CSV 主例失败；exit=1。失败发生在 harness `service.wait(45_000)` 超出原单次等待 0–30000ms 合同，窗口尚未 loaded，未到 Python 或 SystemExit，不能据此认定计算或中文字体失败。T 仅需修正这个读取等待调用，产品无需改变等待合同；已绿 Stop/T09 不重跑。

直接读 `output/productFollowup/T06/teacherLocalCompute/stop-aVlVKa/stop-facts.json`：真实编译 carrier 已 loaded，active execution 由 running→missing，取消与 done 共 25ms，outcome.cancelled=true，窗口 destroyed=true、存活窗口=0、实际 output 为空。由同例原 running 持久记录复制并 fresh Electron 查询，`pending-reopen-facts.json` 为 unknown，同请求 start 仍 unknown，starts=0、observations=[]、窗口=0。此证据证明真实初始化阶段停止与冷恢复不重放；未声称此时 Python 用户循环已经执行。

主例仍保留 worker 内真实 pyfetch 到 loopback 和宿主 file URL 的拒绝、真实 HTTP server 计数 0、输入不可写、Node/preload 不存在、数值与中文 PNG、原产物 writer 与 ready 冷开。另已指出实际 Electron43 的 getLastWebPreferences 返回中缺失 nodeIntegrationInWorker 字段，不能要求该反射字段字面等于 false；应保留原始观察、按是否实际启用解释，并继续保留真正 worker 的无 Node 断言。此为测试反射 API 的事实，不修改产品隔离或放宽实际行为。

相关 generated 修复后的 `build-renderer-input-schema.log`（5.10s、exit=0）与 `build-electron-input-schema.log`（exit=0）也已读取。C1 尚未关闭，后续仅对相关 worker 修复准备所需 renderer；不重复 Electron 或其他无变化构建。

### C2：真实 Python Worker 能读宿主 file URL（实际宿主权限缺口，未关闭）

直接读取 `teacher-local-compute-csv-waitfix.log` 与 `grades-lKR7KZ/compute-facts.json`：修正 harness 后唯一 CSV 主例实际进入 Pyodide，第 40 行因 **Worker fetched host_file** 失败。测试通过 worker 的 `pyodide.http.pyfetch(file://...host-sentinel.txt)` 并读取 response.string()，成功到达原本不允许的宿主文件；不是 Python 虚拟 FS 猜测或被 mock 的网络结果。此时 sandbox/contextIsolation=true、Node=false，renderer 的外网 fetch 被拒绝，仍不足以阻止 worker 的本地文件读取。原隔离 session 的 webRequest allowlist 没有封闭这条实际路径。

该项属于已证实的宿主权限边界缺口，应阻断本执行端就绪判断，但不伪称全部 CSV 计算算法不可用。修复限定在当前 compute carrier 的真实 file/custom content protocol 边界，复用本地资源路由和独立 session；不增加 OS 沙箱、全权限平台或逐次审批。Electron 明确 protocol handler 必须注册到相应 session，见[官方 protocol 文档](https://www.electronjs.org/docs/latest/api/protocol)。候选需保持原宿主 sentinel 与 Worker fetch 断言，用同一主例证实拒绝后继续完成 CSV/图表；不得删除断言或把 file URL 改成必然不存在的地址。

该次 1 匹配失败；另一 Stop 用例由 `-t` 明确排除，不作为本次新通过或失败。没有重跑已绿 Stop/T09。由于失败先于 SystemExit、绘图和成果收集，本次不能关闭 C1 或认定中文图／ready 冷开成功。

### C2 实际协议修正复审

第一份只在私有 session 添加 file protocol handler 的窄候选没有解决问题：`teacher-local-compute-file-protocol.log` 的同一 Worker 反例仍为 **Worker fetched host_file**。该候选静态可尝试，但实际结果不支持关闭；已知 file-origin Worker loader 路径不能再靠同类拦截重试。

随后实际 Backend 改为生产固定 `https://guoling-compute.invalid/compute.html` 来源。只在当前 compute 私有 session 的 https handler 映射明确 entry、assets 与 vendor 运行时；URL origin 必须匹配，路径先 decode/resolve 约束，再以 realpath 核对固定 entry 或 runtime/assets 实根，Main 仅通过 net.fetch 读取该已映射文件并保留内容类型。Worker 收到的 runtimeBaseURL 同为该网页 origin，其他地址拒绝；没有任意远程 HTTPS 透传、DNS 依赖、全局注册或 defaultSession 改动。开发入口仍是既有 loopback HTTP。

已直接复审这份冻结 actual source：旧 file handler 已删除，没有双轨；权限与 lifecycle、输入／输出端口保持。该方向对应真实失败根因，源码可接受，仍须原 host sentinel Worker fetch 被拒绝及完整主例证明后才关闭 C2。

### 代表性 V10 创作链的定义修正

首份 B 原结果已在 Main 默认计算服务得到 90/80/85，但新测试随后给 Flow 正文对象发送自由 frame 宽高，得到合法的 invalid-operation；未到导出／冷开。该对象无自由 frame，不能为测试放宽产品 Flow 语义。

已读 T_content 窄 test-only 修正：从 project.read 取得真实表格列并保原身份，人工修改列宽 260/160、字号 20 和 opacity 0.9；后续仍断言完整 table instance 等于 human.after，明确检查这些人工字段，并保留保存／冷开模型断言。该改动选择当前 Flow 表格真实支持的局部编辑，未删除人工保全目标；产品无变化，可继续原 B 用例，尚未据此记通过。

## C1/C2 原主例实际收口

HTTPS 来源首次原反例已越过 HTTP/file 两项拒绝断言，实际打印 90/80/85；随后 `grades-LVs7ID` / `teacher-local-compute-private-origin.log` 明确记录 SystemExit:0 被旧外层 catch 错当 exitCode=1，证实 C1。I 的实际窄修使用 Python `eval_code_async` 并捕获真正 `SystemExit.code`：None/0 返回 0，整数返回实际码，其他值写 stderr 并返回 1；其余异常保持 failed。新 globals 带 __main__/__file__，sys.path/argv 和模块绘图配置继续生效，top-level await 保留；没有异常字符串猜测或模型新参数。

同时复核新增 outer catch 一行 `reply.exitCode = 1`：防止已置 0 后输出收集异常被误报 ready。这只更正异常分支，未改主成功路径。该行晚于下列成功 build，后续最终 Renderer 准备须带入；不会据此重跑无变化的 CSV/Stop/T09。

直接读取 `teacher-local-compute-python-exit.log`：**唯一匹配主例 1 passed，case 6.78s、总 7.02s、exit=0**；另一 Stop 用例明确由 -t 排除。读取 `grades-sEd6hb/compute-facts.json` 与 `ready-reopen-facts.json`，并实际查看 delivered/班级均分.png：

- 真 NumPy 2.4.6／pandas 3.0.2 算出一班 90、二班 80、总均分 85；最终 ready/exitCode=0。标题“班级成绩均分”、横纵轴和两班中文可见，无方框；蓝柱 90、绿柱 80。PNG 600×360、12646 bytes，CSV 56 bytes。
- Worker 的 HTTP 与真实宿主 file fetch 都为 AbortError；同例服务器 0 请求断言已经到达。输入只读且原 CSV/host sentinel 不变，实际 worker 无 Node/preload；cwd、work alias 和两个 GUOLING 环境变量符合原公开合同。
- 原 ArtifactDelivery writer 将 CSV 和 PNG 分别 written，非仅 scratch；三个成果有真实登记，越界相对输出被原 owner 拒绝。fresh Electron ready 冷开 starts=0、无窗口创建、回读同一 summary，没有重算。

以上关闭 C1 和 C2；不把最初静态配置或失败的 file 协议补丁当通过依据。对应 Renderer `build-renderer-python-exit.log` 为 5.24s、exit=0；Main 保持已准备的 HTTPS/realpath carrier。剩余唯一 exit=3 定义已独立读：真实 Python 先打印、生成虚拟文件后正常退出 3，要求 failed/exitCode=3、无 artifact、后续代码未执行、日志不伪装 Traceback/SystemExit、readArtifact 拒绝；无 mock 或产品时限变化，等待 E 原结果。

## 计算域最终收口

已直接核最终源码 `computeWorker.ts:66` 含显式错误 exit=1；读取 E `build-renderer-exit-failure.log` 为 **4.93s、exit=0**，`teacher-local-compute-exit3.log` 为 **1 匹配、1 passed、0 跳过，case 4.19s、总 4.37s、exit=0**。`exit3-eZzYVp/facts.json` 的真实 compiled Worker 返回 failed/exitCode=3、reason=计算进程退出码3、artifacts=[]，日志仅保留退出前 stdout，readArtifact 明确 artifact-not-ready。没有将非零退出改成成功或丢成笼统未知，也没有重跑原 CSV、Stop、T09。

实际部署变化限定为：Main 默认后端从必须安装 WSL/Podman 改为随包 Pyodide 独立网页 origin/Worker；既有作业／scratch、输入授权冻结、正式成果 writer、公开参数、路径别名、冷恢复与停止保留。没有新增全局 protocol、通用调度平台、软件总时限、模型参数格式或收费路径。该候选已满足本次计算域最小充分验证，可用于后续本地候选包和代表性作品链。

仍应明确保留：

- 本次验证使用已构建的 Electron 开发载体及真实运行资源，不代替无源码／无 Node／无 WSL 的安装或目录候选验证；Root 正在安排该独立边界，本文不提前记通过。
- B 代表性 V10 链后续保存、冷开、导出与实际互动由其实际结果另记；其 Flow 人工布局定义修正和 public save 选择，不因 A 计算域通过自动变成全链通过。受控文本 provider 也不等于真实模型教学质量验收。
- Python 的 OS 子进程、任意未预装原生扩展与外网仍不是新端承诺；numpy/pandas/Matplotlib、输入材料与成果范围以本报告实际样本为证。未声称完整 CPython 兼容。
- 当前证据来自 main `162aee26` 上本批实际 working candidate 和对应 E 构建；本审查未执行 Git 提交／合入、打包或发布，不把 source ready 写成 commit/安装接受。发行仍依 Owner 原决定暂停。

## Windows 目录候选：独立定义复核

已读取实际 `package-windows-dir.log`：保留根 `electron-builder.yml`，临时 `package-config.cjs` 仅覆盖输出目录与本地 Electron distribution；`npmRebuild: false` 来自原配置。builder 使用 `--win dir --x64 --publish never`，实际 exit=0，形成 `windows-dir-candidate/win-unpacked`。这证明候选生成，不能单独证明产品入口或计算运行。源码、构建和目录候选的证据层次继续分开；未安装、未发布。

已完整只读复核 T 独立的 `teacherPackagedCompute.ps1`。脚本仅以 Windows 自带 PowerShell 和随包 `resources/mcp-bootstrap/Connect-Guoling.ps1` 进入真实产品；helper 自定位相邻 exe，无源码 import、内部 Handler 调用或新 Schema。测试进程与子进程的 PATH 排除 Node/tsx/WSL，使用隔离 profile、非源码 cwd，结束后恢复原环境；这不是对用户全局环境的改动，也不把 PATH 本身当计算通过证据。

原定义依次要求公开 MCP catalog 和正式 ToolResult、实际 job ready/exit=0、三次 artifact.save written 后读取物理 CSV/PNG/probe，再由 owned PID 的可见窗口/UIA 正文和 PrintWindow、同 profile/原 documentId、DELETE A 后 B 真实调用、原 native“退出”及 owner 自然 exit=0 证明入口延续。CSV 的 90/80/85 和实际 PNG 尺寸／像素是行为判断，中文可辨仍须直接查看图像。超时只是测试诊断，不重放 compute/artifact 写入、不强制杀进程、不修改产品时限；未确认副作用时仅查 operation.recent。

该定义对本次目录候选边界充分，无需扩大为全部安装、CLI、模型、课程或权限矩阵。原结果尚未到达时保留 pending；即使总 exit=0，也只关闭实际运行到达的这条入口／计算链，不能关闭其他验收。若因 native UI Automation 条件得到 exit=2，仅保留先前已实际到达的 MCP/计算分段，不记全链通过。

### 首次目录候选实际结果：连接 helper 尚未返回

已直接读取 `packaged-compute-run.log` 及 `packaged-compute-044f5e88b5224644aebb1b2d94ba3b86/{checkpoint.jsonl,facts.json}`。实际 UTC 06:00:52.378 到达 `headless.connect.before`，06:02:22.512 在 helper 的 `WaitForExit(90000)` 诊断处失败；未取得 ready，未重放，也未杀进程。facts 为 failed，mcp/compute/gui/detach/naturalExit 均 false，gaps 为空、收费调用为 0。

本次未进入公开 MCP 或计算，更未到 native UI Automation；不能归为 UI 条件限制或计算行为失败，也不能用 builder exit=0 关闭入口。当前可确认目录候选生成，随包 helper／被启动产品未按期完成 ready 交接，根因仍待入口 owner 根据这一原运行定位。已有源码载体上的实际计算／隔离／Stop 证据继续有效，但打包后的计算和 GUI 延续仍待证；不因该未定位的启动失败扩大重测、重建或放宽产品合同。

### 连接 helper 的 EOF 窄修复审

已直接读 Main `index.ts` 的真实 `--mcp-connect` 分支及 `installedMcpBootstrap.ts`：成功返回一条 `JSON.stringify(reply) + newline` 后 connector 退出 0，resident Main 独立持有生命周期。旧随包 PowerShell 在真实 `WaitForExit()` 后仍取 `ReadToEndAsync().Result`，把持续 resident 所持管道 EOF 当成回执边界；进程退出和收齐 EOF 是两件事。Root/S01 对原运行提供的进程事实为 resident 29624 的 connector 父 23104 已退出、helper 30196 仍活且 listener 可达；这是待原自然关闭进一步佐证的定位，不能冒称 ready 已被调用者消费。

已独立核实际 helper diff：stdout/stderr 改取 `ReadLineAsync()`；仍先等真实 connector 退出，非零 exit 先于 stdout 消费明确失败，stderr 仅已完成时读取首行、不等 resident EOF；成功仍要求完整 JSON 和 `status=ready`，原 workspace/profile/permission/ownership 事实原样返回。Main 的单行回执合同支持这一消费方式，没有内部 Handler 旁路、软件新时限或假 ready。显式 UTF8 解码与输出保真实中文路径；定位顺序、参数和环境清理保持。静态复审通过，原包运行必须消费新 helper 后另记行为结果。

同时只读复核 T 的 `cleanup-packaged-first.ps1`：仅对已确认原 exe/PID/profile 作一次真实 GUI 升格及原 native“退出”，再观察 owner 退出和旧 helper 是否随后解除等待；无新连接 helper、强制退出或其他进程处置。它是原失败的清理／因果佐证，不是目录候选验收，也不能用其脚本 exit=0 代替事实中的 `normalExit` 与 `ownerExitCode`。

本次实际 `natural-cleanup-facts.json` 为 cleanup-failed：helperAliveBefore=true，secondaryExitCode=0，但脚本在 owned PID 下未找到可见编辑器，尚未发送 native close。记录 `acceptance=false`、`forced=false`；没有 owner 自然退出或旧 helper 随之释放的事实，因此 EOF 定位目前由源码和进程状态支持，未取得该因果佐证。第二实例的 exit=0 也不能独立证明 GUI 已显示。原 fixture 留待 Root 定位，不扩大关闭目标或改用强退来伪造正常退出。

### 同一原进程的第二次普通前台打开

Root/H 新增原窗口观察：owned PID 29624 已有标题“果铃编辑器”的 Chrome_WidgetWin_1，正常屏幕坐标但 visible=false；renderer 在首次清理时已创建。独立读取现源码可见 bootstrap 启动 resident 用 `windowsHide:true`，新编辑窗口仅在 ready-to-show 中 `show()` 一次，原窗口再次打开则走 `openMainWindow` 的 `show()`。微软 [ShowWindow 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-showwindow) 明确首调用可采用启动方 STARTUPINFO 的显示设置；结合本次观察，这是 `windowsHide` 影响首次升格的具体假设，不是计算后端或 renderer 未创建的推断。

E 保留首次结果后只执行第二次普通同 profile 打开。已直接读新 `natural-cleanup-facts.json`：这次已有 `mainTitle=果铃编辑器`，证明脚本到达原 PID 的 visible window，支持首显示状态假设；随后仍为 cleanup-failed，停于找不到 owned native 关闭对话框，未有 owner 退出／旧 helper EOF 解除结果。两次清理均不计入口验收；源码仍须使首次正常前台打开直接可见，不能将要求用户再开一次当产品修复。

随后 H 在同一原 PID 上实际只读 native/UIA：标题“关闭果铃”的 #32770 对话框已经 visible，UIA parent 是原编辑器；RootElement.Children 仅含编辑器而其 Descendants 可找到对话框。故第二次清理的这一停止点是测试 locator 层级漏检，不能认定产品没弹出关闭对话框。H 继续观察真实“退出”控件为 CCPushButton／ControlType.Pane 且无 supportedPatterns，原 InvokePattern 假设也不适用本载体；应按已观察的 owned native 控件执行普通点击，不用 UIA pattern 类型决定产品成败。只消费现已打开的对话框，不需重发 SC_CLOSE 或替换产品 handler。

已直接独立复审 H 的实际 Main diff：只移除 `installedMcpBootstrap.ts` resident `spawn` 的 `windowsHide:true`，保留 `--headless-mcp`、detached、stdio:ignore、环境／cwd、ready file、错误与退出恢复处理。headless 本身不创建主编辑窗，启动层无需给这个 GUI exe 注入隐藏首窗的状态；真正前台打开仍由原成熟窗口 owner 完成。该修复处于已观察根因边界，无新的全局显示配置或第二次 show workaround，静态通过；首次普通升格的实际表现仍由修后原目录例证明。

### 原生点击定义与原失败进程释放的实际结果

已只读复核最终 T native carrier：helper 两个 reader 显式 UTF8；关闭框由已验证 owned editor 的 Descendants 查同 PID／精确 title。退出若有真实 InvokePattern 则消费，否则按已识别 HWND 的 PID、标题、可见／可用、实际矩形及命中点属于同一对话框核定后，SendInput 发普通鼠标按下／抬起；DPI context 退出时恢复。仍保留自然 `WaitForExit` 与真实 `ExitCode=0` 断言，不调用内部 handler、不 force、不放宽正文／documentId／MCP。该窄修纠正实际 native 载体假设，不新增产品准入门。

Reviewer 已直接查看 `packaged-first-current.png`：成熟 Main 中 `connection-example.md` 正文真实显示，“关闭果铃”对话框和“退出”按钮清晰可见；之前两次清理未完成不能再描述为 renderer 未加载或产品未弹关闭框。

已读本次 `close-packaged-first-dialog.ps1` 及 `close-existing-dialog-facts.json`／原 log：仅消费原已开对话框，无新启动、SC_CLOSE、连接或业务写入。真实 carrier=native-mouse-SendInput 后 owner 的 WaitForExit 已通过，`helperSettledAfterResidentExit=true`；这直接支持旧 helper 的等待依赖 resident 管道关闭。记录仍为 cleanup-failed／脚本 exit=1，因为 ownerExitCode 与 helperExitCode 都为 null，无法满足 normalExit=true。不能把 null 改写为非零产品退出，也不能冒称自然 exit=0。原进程已结束，需在后续原目录例提前保留真实进程句柄取得退出码；不为补旧清理取码再运行业务、覆盖事实或重复计算。

随后直接读取 T 的零业务 `process-handle-observation.json`：唯一普通测试子进程实际 exit=7，启动者与预持句柄观察者都读到 7，未预持句柄的 GetProcessById 观察者只读到 null，并有“Process was not started by this object”取码错误；productProcessesStarted=0、forced=false。该实验定位旧 cleanup 的取码缺口。最终 T 仅在取得实际 owner 后立刻读 `owner.Handle` 保留内核句柄，仍要求真实自然退出码 0，未将 null 接受为成功。此 test-only 窄修静态通过，不回填旧退出码。

## B 代表性作品：无 GUI 投影阻断正式文档导出的窄修

直接读取 `creation-chain-controlled-public-save.log` 和 `output/content-revision/creation-chain/run-08J7yJ/facts.json`：公开 `project.save({})` 返回 saved，saved/currentRevision=8、dirty=false；随后 `file.open(saved.path)` 保留 documentId `292fe8ae-b9dd-43b4-afe9-6f688e8f7102`，返回实际 writable 新 target。`document.export` 消费这个新 target 时仍被 delivery-rejected“准备导出的目标文档已关闭或重开”拒绝。保存已成立，此次失败不能再归为旧句柄或人工改动未保存；导出／冷开／互动尚未由此通过。

独立读 `CourseV10DocumentBridge.publish/activate/close` 与 `editorStore`：GUI 的 documents 只来自已经 attach 的 projection Map，不是 Main 的正式文档目录；经工具创建的合法文档未 activate 时可没有 GUI projection，因而没有该投影的待提交输入。真实 GUI close 原路径先保全／drain，再关闭并 release 对应草稿，未被本次更改。

I 在 `DocumentExportRenderer.prepareRootDrafts` 的唯一实际 hunk 将缺 GUI projection 改为直接返回；已有 projection 的 epoch/kind 拒绝、真实 drainCourseDocument、drain 后 documentId/epoch 复核全部保留。Main `workbenchToolServices` 在请求前已取得正式 Session 并 drain、校验 epoch/kind；`DocumentDeliveryService.export` 在 GUI drain 后再次读取 Main 正式 snapshot、校验 epoch/kind，Renderer build 继续核 frozen document/epoch/revision/project identity。故该改动只去掉 GUI 投影冒充正式文档存在性的门，没有取消正式身份校验、绕过草稿、创建第二 writer 或要求模型切换 GUI。

该窄修独立静态通过，待一次相关 Renderer 准备及原 B 行为结果；不重跑无关计算绿例，不以此提前关闭完整作品链。

### B 已越过导出门；Undo/Redo 测试应验证内容恢复与版本递增

已直接读取 `creation-chain-controlled-formal-export.log` 与对应 `Creation-public-receipts-and-cold-reopen-facts-0aebe11245ea5639fc5de37337c69b0909189a14.json`。Engine status=completed，paidCalls=0、providerRequests=0；公开 project.save 为 revision 8／dirty=false，HTML 和 DOCX 的公开导出均真实 written，文件位于 `run-1CAAlg/workspace`。这些实际结果关闭“缺 GUI projection 阻断 Main 正式课件导出”的 finding。DOCX 对程序内容记录实际初态图面的静态输出诊断，源码和专业数据仍保留于工程，未静默声称全部动态。

本次测试整体仍 exit=1：第一后置失败为 redone.project 与早先 saved.project 完全深等，仅 revision 8 与 10 不同。实际 facts 的 saved/undone/redone/cold 版本分别为 8/9/10/10，cold dirty=false。源码 `DocumentSession` 对有变化的 undo/redo 同样递增 revision；`CourseV10Driver.withRevision` 明确禁止版本倒退。执行 Undo/Redo 后又保存，再冷开得到 revision 10 符合当前合同，不能为旧测试让版本回到 8。

T 的实际窄改已独立只读复核：分别断言 Undo 为 saved+1、Redo 为 saved+2、project 与 Session revision 一致；仅排除 revision 后，全部业务内容仍深等原 saved；冷开完整 project 改为深等真实 redone。原资源、图片数量、人工表格全部字段、PNG/DOCX 结构、真实 Player 点击／图像解码及不改变作者 History 的断言全部保留。该改动纠正观察合同，无产品改动、伪造版本或删减 consumer。原运行尚未执行到 PNG/DOCX 专项及 Player，完整 B 仍待原例通过这些后置检查。

### 目录候选第二次入口结果与安全诊断

已读 `packaged-compute-final.log`：新 fixture `packaged-compute-ead6d1ff5d3d40a6b335ac3b7fe673d1` 的 helper 这次已正常 settle 但 exit=1，MCP/compute/GUI/detach/naturalExit 仍全 false。`packaged-existing-owner-diagnostic.log` 记录仅对实际 owner 8124 作一次连接诊断，零工具／计算调用；helper stdout/stderr reader 均完成，失败消息为未返回 ready，owner 仍活。外层 stdout 为空只证明 helper 失败时没有交付回执，不能猜测其内部第一行内容。

S01 为该具体缺口增加的实际错误诊断已静态复审：仅输出行长度、是否空白、解析结果类型及 ready/failed/absent/other 状态类别；JSON 解析异常不带原始回执行，防止凭据被错误文本带出。成功协议、读行、真实 connector exit 及 status=ready 要求未变。仍待实际内部首行形状，不盲目重试业务或把任意输出当成功。

### 实际空白首行与 helper 最终窄修

已直接读取 `packaged-direct-connector-bytes.log`：对原 owner 8124 的唯一直接连接诊断真实 exit=0，stdout 666 bytes；三行依次为空行、633 字符的合法 JSON（status=ready 且实际 PID 匹配）、空行，stderr 0 bytes。owner 仍活，工具／计算调用均为 0。这才证实 helper 的第一行判定失败原因；不是根据外层空 stdout 推测。

S01 最终实际 diff 已独立通过：只在 `IsNullOrWhiteSpace` 时顺续读行；第一条非空行继续走原 JSON 解析及 status=ready，非空无效内容立即失败，null 明确报 EOF before JSON。真实 connector exit=0、UTF8、参数／定位及持续 owner 保留；消费到完整回执即返回，不等尾部 EOF、不添加软件时限。此变更仅是已观察的 JSON 前导空白消费，不是宽松搜索任意成功输出。行为结果仍待随包 extraResource 更新后的原入口例。

### B 后置证据推进至真实 Player 点击

已读 `creation-chain-controlled-monotonic-history.log` 及持久 `run-CqdvuU/facts.json`：Engine completed、paid/providerRequests 均 0，8→9→10 和冷开 10／dirty=false；本次已通过 Undo/Redo 内容、冷开、PNG 500×300／1254×1254，以及 DOCX zip/XML 中表格／公式／媒体的原断言。Reviewer 实际查看 `run-CqdvuU/workspace/均分图.png`：中文标题、两班、均分轴均可辨，90／80 柱与总体 85 虚线实际可见。HTML/DOCX written 回执继续成立。

第一失败现为原测试真实 `summary.click()` 后答案仍 hidden；后续 Player 图片解码、截图和不写作者 History 检查未到，完整 B 仍不通过。刷新此前陈旧 Player/Renderer 后的 `creation-chain-controlled-current-player.log` 仍同位置失败，不能只以旧构建解释。两个 MiniProbe 的原日志则停于其额外 `scrollIntoViewIfNeeded` 的稳定性等待，均未执行 click；这些诊断自己添加的前置门不能作为产品点击失败的新证据。仅去掉额外诊断等待、保留原真实 click 后观察实际命中，可继续定位；不据此修改 Player 源码、放宽答案可见断言或重复创作／计算链。

### 隐藏 Player 测试载体的配置差异

已直接读取 B 被动 `run-2pynn7/player-click-diagnostics.json`：测试手建 Player 窗口 visible=false／backgroundThrottling=true，同次 Main 窗口为 false／false；click 后父文档收到 5 个 trusted 事件、目标均为 IFRAME，实际 child 0 事件且 details.open=false，无 pageError。点击前两图片已经 complete，实际尺寸 500×300／1254×1254；当前失败不能归为图片尚未解码。

去掉额外 scroll 门的隔离 Mini `run-iKBI9F/facts.json` 实际原 click 返回，child 11 个 trusted 事件含 toggle、open=true，无 pageError；该载体同样隐藏，不能称可见窗口验收，也不能代替 B 通过。其 backgroundThrottling=false 与原 B 不同，给出具体下一验证假设。

已独立读取生产 `HeadlessDocumentExportWorker.ts`、`TaskHtmlPreview.ts`：二者的真实隐藏 BrowserWindow 均显式 backgroundThrottling=false；Main 的隐藏 E2E 窗口也同样配置。T 只给 spec 自行创建的隐藏 Player 补这一字段，原真实 summary.click、隐藏→可见／open、图片解码顺序、全部业务与 History 断言及被动诊断保持，没有 force、JS click、直接显示或产品代码改动。该测试载体对齐独立静态通过；是否足以解决本次实际失败仍以原 B 完整结果为准。

### helper 空白修复的实际 attached 回执

已直接读 `packaged-existing-owner-skip-empty.log`：同一原 owner 8124 的一次 helper 连接 exit=0，UTF8 JSON 回执 ready，PID/workspace/profile 均匹配，mode=headless、ownership=attached、workspaceMismatch=false；owner 仍活，零工具／计算。这关闭“实际前导空白使 helper 拒绝有效回执”的具体失败，但仅证明已有 owner 的 attach，不能写为 fresh owned、打包后计算或完整 GUI 延续通过。新目录候选还需消费已准备的当前 Renderer／Player 与最终 helper，再运行原 full 例；既有绿色计算证据不因此失效。

### 离线 HTML 按正式交付边界使用独立内容浏览器

原 B 补 backgroundThrottling=false 后的 `creation-chain-controlled-player-throttling.log` 仍失败，不能将上一配置假设写为已证根因；也没有充分证据把工作台默认 session 中测试自行增设窗口的行为定为新产品缺陷。用户实际取得的是公开写出的离线 HTML，应在独立内容环境运行；当前合同 §0.4 明确分享内容不继承工作台文件、登录、Node 或 privileged preload 能力。无需为一个非产品入口重写生产 Player、关闭严格校验或继续猜测默认 session 的全部差异。

已独立只读复核 T 的最终实际 spec hunk：authoring app 仍是原 Main singleton／Engine/default tools，真实计算、人工改动、保存冷开和公开 HTML/DOCX 导出原样保留。只在最后消费阶段，于同 case 临时目录写一个最小 CJS 浏览器入口，独立 ElectronApplication／userData，用 sandbox/contextIsolation、nodeIntegration=false、无 preload 的正常可见窗口，`loadFile` 消费本次公开 written 回执对应的实际 htmlPath。没有工作台模块、第二 DocumentHost、writer、provider、计算或新工程，也不依赖临时诊断脚本；敏感模型环境项不传入该消费者。

原 trusted locator click、答案隐藏→可见／details.open、两图解码尺寸、截图和被动诊断均保留；Player 操作后的作者 project／History／dirty 仍向原 authoring Main 读取并断言不变。该 hunk 独立静态通过，正常浏览器可见验证处于 Root 已授权范围。完整 B 仍待此原 spec 实际通过；此前隔离 Mini 结果只作定位，不能代替该全链结果。

A02 后续指出 `app.setPath(userData)` 要求目录已经存在；已独立核本地 Electron 声明及 T 最终补件：launch 前 `mkdirSync(consumerProfile)`，tiny Main 使用同一个本次独立目录。此项为该消费者实际启动所需准备，不是新产品门；最终定义保持可接受。

## B 受控 provider 完整链最终实际收口

已直接读 `creation-chain-controlled-independent-player.log`：原唯一测试 **1 passed（14.6s）**，冻结后的 consumer/profile 定义未再改动。持久 `run-LoMdHf/facts.json` 与 Root 保存到 [稳定证据目录](teacher-creation-controlled-20261007/) 的 facts/run.log 均为 actual Main singleton／Engine/default tools、status=completed、paidCalls=0、providerRequests=0。工程 documentId 为 `b591716b-3846-410a-a285-f9508e0de1c3`。

直接事实与原断言共同证明：读取教师材料→真实 compute 90/80/85→原 artifact.save 写出 CSV/PNG→公开 project 工具创建／装配原生可编辑表与图及现有铃铛素材→保留人工 actor 经 Gateway object.update 的完整表格实例（列宽 260/160、字号 20、opacity 0.9）→project.save 与 file.open→HTML/DOCX written→task.finish。既有源码、资源和正式 writer 没有被测试内部 handler 替换。Undo/Redo 用原 canonical API 检查 8→9→10 和业务恢复，再保存并由新 DocumentHost／Registry 读取真实 archive，冷开 revision 10、dirty=false；这是其实际验证层级，不冒称鼠标点击 Undo/Redo 或完整新 Electron 冷启动。

原 PNG 格式／尺寸、DOCX 原生表格／公式／media 与两图实际解码都通过。独立内容浏览器只 loadFile 本次公开 written HTML，真实 visible=true，背景节流保持普通浏览器默认值；直接读 `player-click-diagnostics.json`：child 从 open=false、0 事件变为 open=true，收到 6 个 trusted 事件（pointerdown、mousedown、pointerup、mouseup、click、toggle），pageErrors=[]。原 hidden→visible 断言、图片解码、作者 Main project／History／dirty 保全断言全部到达通过。

Reviewer 已实际查看 [点击后 Player](teacher-creation-controlled-20261007/player-after-click.png) 对应原图：答案“一班 90，二班 80，总体 85”展开可见，原生图与计算图继续显示；此前实际查看的中文计算图与本次 PNG 原检查一致。此处是 B 原测试及真正输出的完整结果，不借 MiniProbe 代替，不改变旧失败日志，也不把旧测试自行添加的默认 session 窗口当正式交付入口。

因此本次 **B controlled engineering chain 通过**。仍未证明：真实供应商单次 LIVE 结果、fresh Windows full packaged 入口／计算／GUI 延续、安装分发接受及教师教学／艺术接受。它们保持独立 pending；不新增模型请求、生图或同义矩阵来重复已有绿色证据，发行继续暂停。

## fresh Windows 例的身份与正文观察顺序复核

T 对旧 owner 8124 的实际截图判断为当前不是教师目标正文，不能据此删除真实 body marker 断言或直接声称 UIA 无法读正文。已独立读取最终 `teacherPackagedCompute.ps1` 的唯一顺序改动：验证 visible window 所属 PID 后，先执行原已有 GUI attached 回执身份全检，以及原 B session／20 秒 workbench.state 的 activeDocument、原 documentId/path、dirty=false 断言；随后仍执行原 30 秒 UIA Name/Text/Value 搜索、PrintWindow 与真实教师正文 marker。

原检查块只移动、没有重复或增加业务调用，所有参数／等待时间保持；`facts.gui=true` 仍在身份与正文两组断言全部通过之后，DELETE A 后 B 存续与 native 自然 ExitCode=0 断言不变。该窄改独立静态通过，使下一原例能区分实际选错文档与正文观察缺口，不是放宽验收或提前证明 full packaged 通过。

## LIVE 的 task.finish 结算阻断：定向只读复核

直接读取 `run-25n5QX/runs/ded49e5f65d2cc520ef89e173348c112c548d93d1ba07eeef4af88056bbbc43f.json`，最新持久状态为 partial、102 个 provider requests、131 条工具记录。本文只核对既有源码与回执，没有再调用模型，也没有改写此失败记录。首个 task.finish（工具下标 80）之前，project.save（64）已确认 currentRevision=savedRevision=14，同一课件的离线 HTML（68）与 DOCX（70）均有 written 回执。

直接根因是结束控制与历史失败清零绑在一起：`ExecutionEngine` 的 task.finish 分支使用 `hasUnresolvedToolFailure`，任一未被有限等价匹配恢复的历史失败都会返回 task-unfinished 并继续模型回合。实际早期 project.apply 的 file-content-required（25）、media.insert 的 invalid-target（38）、project.apply 的 target-not-found（40）没有 effectTargets，改正参数或改走可用装配路径不会进入同参数／同目标恢复规则；DOCX 的错误 destination 为目录（66、69），后来正确文件路径的 written 回执也不等于原目录字符串。25 后的 26 已在同 body 路径得到 committed/usable 正式回执，不能把旧拒绝继续描述成正在写入。

同时存在必须如实披露的实际缺口：view.observe（55）明确 purpose=required，返回截图后 observationFailure 为“任务接受时没有冻结可用的视觉模型”；后来的 html.observe（90）才是 diagnostic。不得把这两者合并为视觉验收通过。compute.run（91）及终态 job.wait（92）的 KeyError blocks 是第二次 task.finish 之后追加的诊断失败，后续修正代码的新作业（94→95）已 ready；该计算失败不是首轮结束阻断的起因，也不应再被当成仍在运行的作业。

方案建议已交给 G／Root：由现有 Engine 区分“接受结束请求”和“全部结果完成”，允许已结束但仍有明确缺口的任务如实收为 partial，保留失败回执和未视觉验证说明，避免增加一串根据附近成功洗白旧失败的匹配规则。真实未知副作用、当前未返回调用和仍在运行的作业继续保留原必要边界。此段是根因及方案意见，尚不是 G 最终实现通过或 LIVE 完成证明。

## 下一次 LIVE 的正常 Stop 操作入口

已独立静态读取 T 的 `contentRevisionCreation.spec.ts` 第 134–159 行：测试仅把同一次实际 Engine 的 runId 和调用 public engine.stop 的闭包挂在 `globalThis.__contentRevisionCreationDiagnosticStop`，记录 requested/returned 的短回执；该入口不加入模型工具、上下文或 catalog，没有第二 writer，也不重放业务操作。engine.start/wait 的 finally 按同对象身份删除入口，原 instruction、供应商、验收断言全部保留。该窄改静态通过，可供下一次已有新修复假设且授权的 LIVE 正常停止；本次 run 自然落入 partial，不能记为该 Stop 已经实测通过。

## 结束控制必须保留本任务内自动修正的因果边界

G 第一版三文件候选虽然保留历史失败与真实 partial，但会让同一模型响应里刚失败的 text.replace 加 task.finish 直接结束，破坏原 T01 `boundCapabilitiesAndBasis.test.ts` 第 177–200 行的两回合自动修正。Root 指出后，Reviewer 已直接读源码与原断言确认该回归；第一版候选不能按通过交付，也不能改原 T01 为要求教师重新发送或恢复任务。

接受的最窄修正是依据实际回执所在 request 判断：同 response 新产生且仍未解决的失败／必要验证缺口，模型尚未收到，不构成失败后的明确结束决定；软件应先把真实回执送回模型，允许其在原任务修正。已经由前一 response 返回的确定缺口，后续 task.finish 则可以如实结束 partial。此规则不是固定重试次数，不存第二套“已读”状态，也不扩大历史成功恢复匹配。异步计算必须使用使原 job 变为终态 failed 的实际 job.wait 回执 request，不能只使用更早 compute.run 的 request，否则 wait 与 finish 同 response 仍会漏过该边界。

已独立读取 T 最终 `terminalJobFinish.test.ts` 两例定义：真实 Engine/default tools/V10 Session/ComputeJobService/HostJobService，只有 backend 执行结果受控。第 1 回合提交正文，第 2 回合启动计算，第 3 回合实际 job.wait 加过早 finish 必须返回 task-unfinished，第 4 回合按真实 assistant call id 配对读到 failed wait 回执后才主动 finish。正例要求 read.partial、run.partial、具体同 job 的 failed 项、无第 5 次 provider 请求、backend 只启动一次、正文 History 只有一次；pending 负例继续拒绝结束。该定义通过，只证明结算合同，不重复声称真实 Python runtime；原 T01 自动修正和 T10 unknown 写入恢复语义保持不变。最终实现与实际测试结果仍待复核。

## fresh packaged 测试外层的 EOF 等待修正

原 Connect-Product 在 helper 的实际 WaitForExit(90000) 与 ExitCode=0 检查之后，仍读取 stdout ReadToEndAsync.Result；驻留 owner 继承的管道句柄尚未关闭时，成功回执已经输出也可能继续等待 EOF。旧次只有 headless.connect.before、helper 已不在进程列表与 owner 存在，是定位该控制流的证据，不能单独代替 helper 的真实退出码或本轮通过回执。

已独立读取 T 最终 `teacherPackagedCompute.ps1` 第 53–99 行：启动 stdout 唯一读者改为 ReadLineAsync，保持真实 WaitForExit(90000) 后的 ExitCode=0 必须成立；新增 helper.exited 只保存退出码与 Task 状态。首异步行完成后才跳过合法空白行读取下一完整行，解析首条非空 JSON，不等待全流 EOF，也没有同一 reader 上的并发 ReadToEnd。stderr 仍仅在完成时读取作诊断，JSON 失败只报告字符数，不输出包含 bearer 的原行。原 ready/token、同 PID/profile/workspace、同 activeDocument/正文和 native 自然退出码 0 断言全部保持。该观测窄改静态通过，不新增产品门、时限或业务调用；下一次完整 fresh packaged 实际结果仍独立待验。

## G 最终结束候选独立静态收口

已完整读取 `ExecutionEngine.ts`、`executionOutcome.ts` 与仅更新 finish 描述的 `TaskNoteTools.ts` 最终差异。候选只从原 unresolved 工具与新文件保存事实派生具体 remaining，不改原失败回执、不扩成功恢复匹配。已确认终结失败的 job 只在结束控制中归类为 failed，仍保留在 partial 的完成度结算中；同 kind/id 最新 owner 观察仍为 pending/unknown 时继续阻断。

同 response 刚发生的失败使用实际致因回执 requestId，先回给模型；异步 job 使用 terminal wait/status 的回执而非旧启动回执。同一个已失败 job 的重复查询沿用首次确定终结失败的回执作为因果，避免“模型已经知道失败，却因复查又被迫继续一轮”。这一调整保持最新 unknown/pending 的阻断，不用旧 failed 遮盖。全部失败已由前回合返回后，显式 finish 可以 read.partial 并结束取下一 provider 响应，仍保留具体缺口。

冷恢复 partial 的短路只接受直接 previous 本次自身最后一条已返回 partial finish、previous 为 interrupted/application-interrupted 且当前无 pending/unknown；不使用祖先 partial ACK，也不把正常 partial 用户继续变成只读终态。新恢复结果继续 partial，不走原 completed 赋值。最终候选独立静态通过；T01 原自动修正、T10 真实 owner 终态／因果／pending 及既有 unknown 含义的行为证据仍交 E 定向执行，此处不先报运行通过。

## 原 LIVE 的 tools.load 不构成核心能力隐藏依赖

独立读取原 LIVE 的持久工具记录及 facts.requests 实际 catalog：唯一 tools.load 位于下标 16，families 为 content/layout；此前已经实际读取资料、运行计算、交付 artifact、创建课件并 project.apply。第一请求的实际目录 63 项包含 file.list/read/create、compute.run、job.wait、artifact.save、project.list/read/apply/save。初始尚无正式文档时，对象与文档导出工具未出现是该时点事实，不能改写成初始已具备。

file.create 之后、tools.load 之前的 requestIndex 6 已由软件自动提供 79 项目录，包含 text.replace、object.update、media.insert、view.observe、listChildren、document.export；发送 load 的 requestIndex 7 已有同一组能力，下一请求仍为 79 项。故本次 load 没有承担核心工具发现／授权前置。验收可最窄移除“任意 tools.load 出现即失败”，改为核对真实初始文件／计算／工程核心目录，以及本次创建后的实际可达证据；继续保留用户明确禁止的新 image.generate/edit。不注入预加载、隐藏参数或模拟目录，也不另设只许加载特定 family 的新门。该判断基于原 LIVE 原始记录，不是为修改失败结果而伪造数据。

## 原 LIVE 产物的零付费续验定义

已独立读取 T 最终 spec 的 resume 分支：`CONTENT_REVISION_CREATION_RESUME_FROM` 与新 LIVE 互斥，重开原 profile／singleton，恢复实际原文档 journal，使用原 RunStore/events，经 public engine.resume 继续原 run／conversation／instruction，只替换为受控 provider 返回一次实际 catalog 内的 task.finish。没有供应商目录 GET、新模型网络请求、重算、生图、材料复制或重新建课。新 facts 分别保存原供应商 partial／原请求数及本次软件 closure partial，明确不声称修后供应商完整通过；closureTools 必须只有 task.finish，providerRequests=1，paidCalls=0。

原实际 savedPath 与公开 written 路径继续被消费，CSV 90/80/85、可编辑原生表图、中文 PNG、铃铛素材、冷开语义／资源、DOCX 原生内容、独立内容浏览器的真实答案点击和两图解码、作者工程／History／dirty 保全断言保持。LIVE 分支不注入受控人工布局，也不重做旧已通过的受控 Undo/Redo。tools.load 的窄修使用实际记录中的目录，保留禁止新图像调用。该续验定义独立静态通过，实际软件 closure 与旧产物验收结果待 E 执行后分别记录。

T10 终态正例最终第 4 回合在已经读到真实 failed wait 后，先 job.status 查询同一旧 job 再 finish；仍限定 4 次 provider 请求、一次 backend 启动、一次正文 History，直接覆盖“复查已失败作业不得重置为未读新失败”的窄问题。未增加新测试族。

最终 direct consumer 补件已复核：`runEndSummary` 的 partial 消息改为读取上述派生 completion issue.message，不再从原 compute.run 的 preparing 回执直接显示“仍在运行”。原回执、恢复匹配和完成状态均不变；已知终结失败可在最终 UI 摘要中如实陈述。该窄改独立静态通过，三源文件审查收口，剩余仅 E 的相关行为结果。

## Windows GUI 出现后 MCP 默认工作区漂移

Root／E 的真实候选已走到 MCP、计算及三项 written，随后 GUI ready 身份复合断言失败；本段不据此宣布完整包通过。独立源码核对确认：`bindHeadlessMcpWorkspace` 是 setInitialWorkspace 的唯一生产 caller，先对 CLI 指定根授权并登记；旧 setInitialWorkspace 只存 lastWorkspaceId。GUI 初始化另有 ui.workspaceId 时，currentWorkspace 优先使用 UI 值，因而 connectionInfo 和新 openSession 默认绑定会离开原 CLI 显式范围；现有已绑定 session 的 grant 没有因此变化。

已独立审查 H 唯一 `ExternalMcpService.ts` 的实际三处窄改：新增 initialWorkspaceId；仅在原 setInitialWorkspace 的 readWorkspace 验证通过后记录它，同时保留原 lastWorkspaceId；currentWorkspace 有该显式初始值时直接返回，否则完整保留原 UI→last→recent 选择。connectionInfo/openSession 后续原 readWorkspace/workspaceRoot/bind 校验继续生效，初始根不存在或不能授权时明确失败，不静默猜另一个根。session.workspace.switch 仍只修改本 session 的新授权与 run，并停止其旧 run；不会重写宿主初始根，workbench.state 仍显示真实 GUI 状态。

该 one-file 候选独立静态通过。initial 与 last 分别表达显式宿主默认范围和最近会话选择，不新增作者状态／writer、端口或注册平台，也不替 GUI 改写工作区。待 T/E 的 seed A→GUI B、单 session 显式切 B／peer A 保留与无 seed GUI-only B 对照；原真实窗口同文档与正文断言仍必须验证，不因默认 MCP 范围修正而略过。

## 工作区回归定义与已有 Windows 证据的聚焦续验

T04 首轮三例在 MCP 入参解析处报 unrecognized_keys arguments／path 缺失，尚未证明工作区行为失败。独立读取当前 `ExternalMcpService.ts` 第 346–353 行确认公开 tools/call 的 params.arguments 本身就是业务对象，历史共用 helper 额外套一层 arguments 已不对应当前目录。T 最终只在新增 `externalCliWorkspacePersistence.test.ts` 内用 SDK 直接发送 flat arguments；未放松产品 strict schema，未修改共用历史 helper。切换 B 后先 file.open 得到不同 documentId 并成功 read 新 B 目标，才检查旧 A target 被拒绝，避免把未绑定文档而不可达的工具误作句柄失效证据。B 目录真实写入／A 不存在该文件、peer A canonical 编辑、新会话默认 A、无 CLI seed 时 GUI B 对照保持。该三例定义补审通过，原解析失败日志保留，实际运行另记。

已独立读取 `teacherPackagedCompute.ps1` 的 ReuseWorkspace／ConnectionPort 最终分支：先检查原 facts 的真实 MCP、compute 与三个 written 及文件存在，使用新 profile 消费原 workspace；scope 明确为 gui-reuse-explicit-port，computeExecuted=false、compute=false，不重复 compute.run 或 artifact.save，也不把旧计算写成本次新通过。默认完整计算分支及其原断言保留。

为避免占用无关开发 owner 的 45123，复用分支通过公开 --headless-mcp／--workspace／--port／--user-data-dir／--mcp-ready-file 启动本次进程；0 只在测试中获取临时端口。ready 文件位于当前 TEMP 的正式 guoling-mcp-connect-* 目录，读取后只移除明确的 ready.json／ready.tmp 与空目录；解析失败只报固定安全信息，不持久化 bearer。随后真正执行原分发 self-locating helper，要求它 attached 到刚启动的同 PID／endpoint／token，仍通过实际 initialize、tools/list、file.open。没有向 helper 注入连接回执或绕开产品授权。

本次续验继续要求 GUI promotion 同 PID／profile／workspace、公开 file.open 与 GUI activeDocument 同身份且正文可见、DELETE A 后原 B 会话与文档仍可达，以及保留 live Process.Handle 后经实际原生退出按钮获得 ExitCode=0。该聚焦续验定义独立静态通过；它补原 85d 候选已完成计算之后的 GUI／detach／自然退出证据，不单独代表完整包或默认端口链的新一次全程通过。实际结果仍待 E。

## 原 LIVE 分节答案的当前消费缺口

Root 转交原产物续验的具体失败：save15／Published 保有原生 section 的 title、collapsedByDefault=true 与六个 childIds，但真实点击标题后仍是 SECTION／H2，没有 SUMMARY，也没有内容显隐变化。Reviewer 已独立读取直接源码确认该实现缺口：`document-block/index.ts` 第 42 行仅渲染 h2，mount 只 replaceChildren；`modelProjection.ts` 第 77–83、122 行由 host 分别挂载相邻 content 与 children。仅把组件内部标签换为 details，仍不会收起其 sibling 子树。旧 FlowSurfaceHost 的 details 分支不是该 V10 Player 的当前 consumer，不能据其已有行为否定真实失败。

API 5 的正式 context 当前没有 ChildSlot 端口。既有 target.presentation.visibility 使用逐目标末写生效的 lease，并优先于目标原始 playbackInitialVisibility；用于分节会干扰子对象自有显隐，且后续子互动可能揭开关闭中的父内容，不能当作等价修复。设计审支持的实际边界是：组件持有临时展开状态，projection 继续持有原 childIds 的子树与 Flow 布局，并对整个分节内容容器实施结构收展；不能越 root 查询相邻 DOM、改作者数据或重挂子实例。具体最小候选仍由 I 提案后独立审查。

原失败 HTML 自包含当时的 Player。后续当前 runtime 修正不能冒称旧文件已经改变；应保留原失败文件，从同一原工程经正式导出获得新 written 后再核实际点击。无需新增模型、重算、重做教学内容或用受控 disclosure 替换原生 section。
