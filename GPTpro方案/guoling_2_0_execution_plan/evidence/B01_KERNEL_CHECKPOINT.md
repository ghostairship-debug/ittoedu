# B01 内核检查点证据

**证据窗口：** 2026-09-23 至 2026-09-23（Asia/Shanghai；部分叶子进程跨过本机午夜）  
**范围：** B01 的 Session、Driver、Journal、renderer Projection、真实 Main 与 Electron IPC 分层工程证据，以及 S02/S03 正式用例逐案归档。本文不把 B01、S02、S03 记为完成或 `verified`。

## 当前结论

内核到真实 Electron IPC 已形成可执行纵向切片：每文档 Session、Markdown/V9 Driver、恢复日志、renderer 未确认投影、真实 Main `DocumentHostService` 以及 preload/IPC 都有针对性通过证据。最终 Electron IPC 用例在真实主进程中同时打开两份 V9 和一份未保存 Markdown，完成独立修改、撤销、renderer reload、Save As 与磁盘重开。

截至本次逐案审计，S02/S03 的 10 项正式用例中，已有 **7 项用例具备直接行为证据并登记 `passed`**：S02-T01、S02-T02、S02-T05、S03-T01、S03-T02、S03-T04、S03-T05。其余 3 项仍为 `not_run`：S02-T04、S03-T03 缺完整 Electron 通过证据，S02-T03 缺真实 Engine。S02、S03 和 B01 仍在实施，本证据仍是 **engineering checkpoint**，不能替代完整产品门或 Owner 验收。

## 实际执行证据

下表中的“落盘日志”来自 root 工作区 `D:\果铃工作台\output\g20\b01\`；“叶子原始记录”来自对应代理的实际工具输出，没有为整理本文重跑测试。2026-09-23 读取时，Driver、Journal、Projection 的叶子实现及测试文件与 root 当前副本逐文件 SHA-256 相同。

| 层 | 实际命令与 cwd | 实际结果 | 可追溯证据 |
|---|---|---|---|
| 纯 Session / Registry | `D:\果铃工作台`：`npx vitest run tests/unit/g20DocumentSession.test.ts --reporter=verbose` | 2026-09-23 01:43:31；1 file，**10/10 passed**，588 ms | `output/g20/b01/document-session.log`；源码 `src/core/documents/DocumentSession.ts`、`src/core/documents/DocumentRegistry.ts`；测试 `tests/unit/g20DocumentSession.test.ts` |
| 纯 Driver | `D:\g20-worktrees\drivers`：`npx vitest run tests/unit/g20DocumentDrivers.test.ts --maxWorkers=1` | **8/8 passed**（5 个 `it` 定义，其中 V9 strict archive `it.each` 展开 3 项）；原始交接没有保留准确墙钟时间或 duration，不补造 | b00_boundary 叶子原始工具输出；源码 `src/core/drivers/MarkdownDriver.ts`、`src/core/drivers/CourseV9Driver.ts`；测试 `tests/unit/g20DocumentDrivers.test.ts`。无独立日志文件 |
| Driver 编译边界 | `D:\g20-worktrees\drivers`：`npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node src/core/drivers/MarkdownDriver.ts src/core/drivers/CourseV9Driver.ts` | exit 0，无输出 | b00_boundary 叶子原始工具输出。无独立日志文件 |
| Driver 相邻回归 | 同一 drivers 叶子的 `effectiveLayerCommands` 与 `componentPackage` 两个既有测试文件 | **34/34 passed**；压缩交接只保留了文件名和数量，完整 argv/墙钟未保留，所以仅作相邻回归佐证 | b00_boundary 叶子原始工具输出。无独立日志文件 |
| Journal 初版 | `D:\g20-worktrees\journal`：`npx vitest run tests/unit/g20DocumentJournal.test.ts`；随后 `npx tsc -p tsconfig.electron.json --noEmit` | 2026-09-23 01:33:34；1 file，**3/3 passed**，508 ms；tsc exit 0 | b01_journal 叶子原始工具输出；源码 `src/main/workbench/documentJournal.ts`；测试 `tests/unit/g20DocumentJournal.test.ts`。无独立日志文件 |
| Journal Markdown 增量 | `D:\g20-worktrees\journal`：`npx vitest run tests/unit/g20DocumentJournal.test.ts -t 'Markdown|literal'`；随后 `npx tsc -p tsconfig.electron.json --noEmit` | 2026-09-23 01:37:15；**2 passed、2 skipped**，505 ms；tsc exit 0。与前次合并后是 **4 个唯一 Journal 用例均有通过证据**，没有声称最后一次整文件 4/4 | b01_journal 叶子原始工具输出。无独立日志文件 |
| renderer Projection | `D:\g20-worktrees\drivers`：`npx vitest run tests/unit/g20DocumentProjection.test.ts --maxWorkers=1` | 本机 2026-09-23 01:54:46；1 file，**6/6 passed**，521 ms | b00_boundary 叶子原始工具输出；源码 `src/renderer/documents/DocumentProjection.ts`；测试 `tests/unit/g20DocumentProjection.test.ts`。无独立日志文件 |
| Projection 编译边界 | `D:\g20-worktrees\drivers`：`npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node src/renderer/documents/DocumentProjection.ts tests/unit/g20DocumentProjection.test.ts` | exit 0，无输出 | b00_boundary 叶子原始工具输出。另有两个精确文件 `git diff --check` exit 0；无独立日志文件 |
| 真实 Main / FileService | `D:\果铃工作台`：`npx vitest run tests/integration/g20DocumentHost.test.ts --reporter=verbose` | 2026-09-23 01:45:54；1 file，**2/2 passed**，608 ms | `output/g20/b01/document-host.log`；源码 `src/main/workbench/DocumentHostService.ts`；测试 `tests/integration/g20DocumentHost.test.ts` |
| Electron Main 构建 | `D:\果铃工作台`：`npm run build:electron`（展开为 `tsc -p tsconfig.electron.json`） | 2026-09-23 01:46:20；exit 0 | `output/g20/b01/build-electron.log` |
| 真实 Electron IPC | `D:\果铃工作台`：`node node_modules/@playwright/test/cli.js test tests/e2e/g20DocumentKernel.spec.ts --grep "G20 B01 real main IPC" --workers=1 --reporter=list,json --output=output/g20/b01/kernel-ipc-playwright` | 最终运行开始于 2026-09-23 01:47:19；**1/1 passed**，用例 2.243 s，总计 2.822 s；0 skipped / 0 unexpected / 0 flaky | `output/g20/b01/kernel-ipc-results.json`、`kernel-ipc.log`、`electron/run-6NNhLt/ipc-evidence.json`；测试 `tests/e2e/g20DocumentKernel.spec.ts` |

Journal 开发过程中 2026-09-23 01:31:36 的早期 3 项运行曾有 2 项失败；修复后 01:31:51、01:33:01 与上表最终初版均为 3/3。这里只把修复后的结果作为当前实现证据，不把开发中失败算作通过。

## 各层已经直接证明的行为

- **Session / Registry：** operationId 幂等及同 ID 异载荷拒绝、stale revision/epoch、停止屏障、日志失败零正式提交、保存 revision 快照、两份 V9 与未保存 Markdown 隔离、同文件单 writer、dirty close 决策、并发 Save As binding、restore 身份预占。
- **Driver：** Markdown BOM/CRLF/原始语法保真、UTF-16 splice 与资源字节所有权；V9 production strict archive/资源闭包、非当前页对象 patch、身份与 revision 保护、与 renderer 属性规则同源且不依赖挂载视图。
- **Journal：** 原子恢复资源/History/回执、残缺尾截断与完整损坏拒绝、捕获 revision 保存与外部写冲突、Markdown 资源闭包和失败保留、含坏扩展 JSON/悬空链接的原文及本地资源 Save As 保真。
- **Projection：** 快速输入先投影再串行 ACK、重复/旧事件处理、外部 revision 冲突保留完整草稿、History group 转发、丢 ACK 后 lookup 再续链且不重复提交、异步 preview 期间外部提交、单文档断连不阻塞另一文档。
- **真实 Main：** 实际临时磁盘上的保存、外部文件冲突、Save As、重开、明确丢弃，以及应用重启后恢复已提交草稿/History/operation receipt，并拒绝旧窗口 epoch。
- **真实 IPC：** `src/main/ipc.ts` 的 `documents:operate`、`src/preload/index.ts` 的窄 API 与真实 Electron Main 接通。最终附件记录 3 个不同 documentId、4 次 changed 事件、revision `[2,3,1]`、保留 History `[1,0,1]` 与实际 `正式另存.h5lesson` 路径；保存后的 archive 中目标对象 label 也由测试从磁盘重开核对。

## 首次 Electron 失败及修复后证据

首次执行于 2026-09-23 01:46:51，**1/1 failed**，必须保留这条记录。失败断言把 `api.list()` 的数组顺序当成稳定合同，再把 reload 后按 `result.ids` 读取的数组与它逐项比较；三个 documentId、内容和状态均仍存在，但 untitled Markdown 的位置从首项变为末项。失败位置是当时 `tests/e2e/g20DocumentKernel.spec.ts:45`：`expect(afterReload).toEqual(result.snapshots)`，完整差异见 `output/g20/b01/kernel-ipc-first-run.log`。

测试随后改为按 `documentId` 匹配 snapshot，不再假定 list 顺序。修复后的同一精确筛选在 01:47:19 开始、01:47:21 结束并 **1/1 passed**。这是测试顺序假设修复，当前证据没有把首次失败隐藏成首跑成功，也没有据此声称默认 UI 已迁移。

## 检查点初版时默认 UI 尚未迁移（历史）

当前 `src/renderer/documents/DocumentProjection.ts` 已存在，但对 root 源码的引用搜索显示产品 renderer 没有实际创建它；引用仅出现在 `tests/unit/g20DocumentProjection.test.ts`。同时 `src/renderer/main.tsx`、`src/renderer/ui/*` 等默认路径仍直接依赖 `src/renderer/store/editorStore.ts` 的单课程状态。真实 Electron IPC 用例通过 `window.desktopAPI.documents` 直接驱动窄接口，并没有经默认编辑器的 tab、画布、正文输入、AI 入口、保存状态或任务 UI。

该段记录检查点初版时的源码事实。后续默认 Markdown 与 Course UI 已开始接入 Main Session，见 02:55 增量；这项接线进展不自动使正式 Electron/真实 Engine 用例通过。

## 检查点初版的 S02 / S03 缺口（历史）

| 用例 | 当前支持证据 | 正式验收仍缺 |
|---|---|---|
| S02-T01 多文档隔离 | Session 纯内核与真实 IPC 同时维护两份 V9 + 未保存 MD，并有独立 revision/History | 按正式步骤经默认 UI 分别修改背景、正文、对象并交叉撤销；核对完整资源/History 与默认 UI 无串写 |
| S02-T02 非前台页面操作 | Driver 能按显式 locationId 修改第三页且不依赖视图 | 默认 UI 保持第一页焦点/缩放，实际工具修改第三页，切页后观察内容；核对 ViewState 不增加内容 revision |
| S02-T03 未保存编辑 | untitled Session 与 IPC 已证明无路径可提交和恢复 | 默认 UI 新建未保存 MD/课件后的 **真实 AI/ToolGateway** 读取；证明先 drain 当前稿、不要求 projectPath 或磁盘保存 |
| S02-T04 渲染器重建 | IPC 用例 reload 后三个 snapshot、dirty 与 History 保持 | 默认内容视图销毁/重建与 Projection 重订阅；特别是 **任务状态/租约恢复**、未确认输入和默认 UI 状态，当前直调 IPC 没有覆盖 |
| S02-T05 旧版本人工请求 | Session stale 检查及 Projection ACK/冲突/草稿保留已有针对性证据 | 默认 UI 中人工连续输入与真实 AI 写入并发，按正式序列重放 ACK/拒绝；观察可恢复输入与无静默覆盖 |
| S03-T01 幂等与回执丢失 | Session 同 operationId 重放/异载荷拒绝；Projection lookup 后续链 | 经正式 Gateway/IPC 的提交成功后丢 ACK、查询/重发闭环及执行包 evidence 绑定；当前 registry 状态仍未更新 |
| S03-T02 崩溃点矩阵 | Journal 覆盖 torn tail、corruption、资源/rename 失败与重启恢复 | 按定义在资源写、日志写、状态切换、保存替换分别杀进程的 fault-injection 矩阵；证明每点只有旧/新完整状态 |
| S03-T03 AI 与人工撤销交错 | Projection History group、Session undo/redo 与磁盘重开构件分别通过 | 默认 UI 中 **真实 AI→人工→AI**，连续撤销/重做、保存重开；核对内容与资源且撤 AI 不抹掉后续人工修改 |
| S03-T04 停止屏障 | Session 持久停止屏障及恢复后拒绝迟到写已通过 | 真实两项工具排队、停止和迟到结果，经默认 UI 如实显示“首项保留、后项拒绝”的部分完成状态；任务恢复不自动重跑 |
| S03-T05 保存版本准确 | Session 证明保存 r 时 r+1 仍 dirty；Main/Journal 有实际磁盘保存证据 | 在已迁移默认 UI 完成保存回执和副本重开，观察磁盘是 r、当前是 r+1 dirty，且三态文案不误报“全部已保存” |

以上是检查点初版的缺口清单；下方新增证据覆盖的用例可独立更新。不能用局部工程通过一次性改成 S02/S03 `verified`。

## 2026-09-23 02:10 增量

本机 `Get-Date -Format o` 和 UTC 时钟核对为 2026-09-23 +08:00；上表代理原报告中的 09-24 已校正为本次运行日期。

- `npx vitest run tests/integration/g20DocumentHost.test.ts --reporter=verbose`：4/4 passed，日志 `output/g20/b01/file-reconciliation.log`。新增外部修改采纳的内存/磁盘双版本检查、History 保留、已移动文件不复活；原生保存窗口确认以外的请求不能提供覆盖授权。原生 dialog 尚待默认 UI 实际验证。
- `npx vitest run tests/unit/g20DocumentSession.test.ts -t 'original trusted tool request' --reporter=verbose`：1 selected passed、10 excluded；日志 `output/g20/b01/tool-request-replay.log`。宿主计算原 tool call 摘要，重启后原回执可查、同 ID 异载荷拒绝，不覆盖后续人工编辑。10 个排除项不计本次通过，保留此前有效证据。
- `npx vitest run tests/integration/g20DocumentCrash.test.ts --reporter=verbose`：5/5 passed；日志 `output/g20/b01/crash-matrix.log`。每项启动真实 Node 子进程，在资源准备后/日志追加前、日志半写、日志已 fsync 而内存未切换、保存原子替换前、替换后分别 SIGKILL，随后用正式 Journal+Driver+Session 恢复。恢复只有旧/新完整正文、素材、History 和回执；重复读取没有再执行操作；目标文件只有替换前/后版本，新正文引用的图片字节完整。
- 恢复素材与正文位于同一个二进制日志记录，因而不存在另一个可独立成功的“恢复素材文件提交”；第一个杀进程点覆盖编码准备与日志提交之间。文件保存图片则由后两个点覆盖素材闭包与正文替换边界。
- 崩溃测试首轮 5 项全部在进入故障点前失败：测试 worker 的顶层 await 不适配当前 CJS；改为 async main 后五个实际故障点全部通过。首轮日志保留 `output/g20/b01/crash-matrix-first-run.log`，不计为产品成功。

S03-T02 以规定的实际进程故障证据登记 `passed`。其他用例当时仍待逐案审计；03:13 的审计结果见下文，B01 仍在实施。


## 2026-09-23 02:55 +08 集成增量（仍未通过完整 B01）

- 默认 Markdown 与 Course UI 正式写入已走 Main Session；课程开/新建/保存/恢复、正式工具等待 ACK、每文档撤销已接线。生命周期14项真实Registry+Driver用例由b00_boundary验证通过；测试patch已集成。纯blank factory已真迁core，5项既有factory/controller检查通过（39项未选不计通过）。
- Main固定另存与普通保存排队、文件移动/冷恢复绑定、移动失败回滚与新建保存竞争修复。`output/g20/b01/move-startup-integration.log` 中MainHost5+DocumentFiles6共11通过；含自动starter干净基线、显式新建仍dirty、单MD移动copy/cancel附件闭包与共享源保留。该日志另含旧Spatial背景测试11项中的4通过/7失败，失败旧setup仍调用已移除renderer writer，正在迁真实Host，未计其通过。
- 两个明确筛选的默认Electron A/C于02:34启动，最终0通过/2失败；A已完成Markdown实存与会话截图但在关闭原生dirty框阻塞，C在创建课件界面未出现处失败。证据`output/g20/b01/default-ui-results.json`及`default-ui/`。初始blank误dirty已修复，但尚未完成重建/复测；后台脏文档关闭遗漏也已定位，由全live关闭协调修复中。
- S04前三工具批已集成，14项Gateway+3项旧Flow planner聚焦回归为子代理当前证据；原生插入/媒体继续，Engine/MCP未接通，不能标S04完成。S09句柄文件服务已接Main，Explorer/UI接线中。S05仅已开始Provider边界，无付费模型或OAuth探针。


## 2026-09-23 03:13 +08 正式 S02 / S03 用例审计

本节只归档本轮前已经执行的证据，没有重跑测试。正式 case 状态按实际 `test_layer` 判定；integration/fault-injection 可以由内核、Gateway、真实磁盘或独立进程故障证据通过，不额外强加默认 UI 步骤。Electron 与 real-engine 用例则不能由相邻层替代。

| 用例 | 状态 | 本次可追溯证据与判定 |
|---|---|---|
| S02-T01 多文档隔离 | **passed** | `document-session.log` 的 10/10 中，`tests/unit/g20DocumentSession.test.ts` 精确用例同时创建两份 V9 与一份未保存 Markdown，分别修改、交叉撤销，核对不同 documentId、独立 revision/History 与资源不串写。`g20ToolGateway.test.ts` 的 strict V9 batch 在同一正式 Session 中同时修改对象 opacity 与背景色，只生成一条 History，撤销后 surface 与资源均恢复；真实 IPC 的 `kernel-ipc-results.json` 又以两份 V9 + 未保存 Markdown 验证隔离、reload 和磁盘重开。三组证据合并覆盖正式步骤中的背景、正文、对象和交叉撤销。 |
| S02-T02 非前台页面操作 | **not_run** | `default-ui-repaired-results.json` 中 A/C 两个既定修复用例通过，但同批新增 G20 default 用例失败，不计为该正式用例。后续 G20 default 运行虽已走到第三页对象修改、撤销/重做和切页，仍在保存 dirty 断言失败；此前也有一次页面 3 不可点击失败。没有一个完整通过的 Electron case 同时证明第一页焦点/缩放不变、第三页显示新内容及只变内容版本。 |
| S02-T03 未保存编辑 | **not_run** | 未执行真实 Engine 对未保存 Markdown 与课件的 AI 文档工具读取；Session `drain()`、Gateway 和默认 UI 接线均不能替代 `real-engine` 层。 |
| S02-T04 渲染器重建 | **not_run** | `kernel-ipc-results.json` 已证明直连 IPC 后 reload 可保留三份 snapshot、dirty 与 History；尚无完整 Electron 通过证据同时覆盖默认内容视图销毁/重建、任务状态和重订阅，故不提升为 passed。 |
| S02-T05 旧版本人工请求 | **passed** | `document-session.log` 中精确 S02-T05 用例验证旧版本人工请求拒绝、调用方载荷冻结、失败订阅者隔离和未确认草稿保留；Projection 6/6 中验证快速输入串行 ACK、重复/旧事件忽略、外部冲突保留完整草稿及单文档断连不阻塞另一文档；Gateway 的并发人工编辑用例验证非重叠映射、重叠冲突。合并后直接覆盖确定投递、ACK 重放/拒绝、无重复/静默覆盖和可恢复草稿。 |
| S03-T01 幂等与回执丢失 | **passed** | `document-session.log` 的精确 S03-T01 用例证明同 operationId 只提交一次且异载荷拒绝；Projection 6/6 的 lost-ACK 用例先查询 receipt 再续链且 host 写入不重复；`tool-request-replay.log` 的 1 selected pass（10 excluded 不计）证明原 trusted tool request 重启后回执可查、异载荷拒绝且不覆盖后续人工编辑；Gateway 的 durable-ACK/lost-receipt 用例证明恢复后重发仍只有一条 undo。 |
| S03-T02 崩溃点矩阵 | **passed** | `crash-matrix.log`：真实 Node 子进程分别在资源准备后/日志追加前、日志半写、日志已 fsync/状态未切换、保存替换前、保存替换后 SIGKILL，**5/5 passed**；恢复仅出现旧或新完整内容、资源、History 与回执。`crash-matrix-first-run.log` 保留首轮 CJS 顶层 await 导致的 5 项失败；修复 worker async main 后才取得最终结果，首次失败没有被隐藏。 |
| S03-T03 AI 与人工撤销交错 | **not_run** | Projection/Session 已分别证明 History、undo/redo 和磁盘重开构件，但没有精确 Electron 用例完成 AI A→人工 B→AI C、连续撤销/重做、保存重开及内容/资源核对。 |
| S03-T04 停止屏障 | **passed** | `document-session.log` 的精确 S03-T04 用例先提交第一项，再持久化 stop，拒绝第二项迟到操作，恢复后仍拒绝且保留第一项内容/History/receipt；Gateway durable-ACK/lost-receipt 用例返回第一项真实 `applied` 结果、同 call 重放不重复、后续 call 明确 `run-stopped`。integration 层已如实区分保留项与拒绝项。 |
| S03-T05 保存版本准确 | **passed** | `document-session.log` 的精确 S03-T05 用例在保存 revision r 时继续提交 r+1，核对磁盘序列化字节严格等于 r、当前 revision 为 r+1、`savedRevision` 仍为 r 且 `dirty=true`。这是正式 integration 层所要求的版本事实；默认 UI 当前保存失败另属 Electron 产品门，不改变该内核用例的结果。 |

状态汇总：S02/S03 共 10 项，**6 passed / 4 not_run / 0 failed / 0 blocked / 0 skipped**。`task_registry.json` 中 S02、S03 保持 `in_progress`；工程用例未全 passed，因此没有把任务提升为 `verified`，也没有把 B01 宣称完成。

本轮同时按当前实际开工状态把 S06、S07、S10 登记为 `in_progress`；S04、S05、S09 原有 `in_progress` 保持，S08 仍为 `planned`。这只是实施状态，不代表任何对应 acceptance case 已通过，也不绕过依赖或完整验收。

### B01 剩余最小正式门

经 03:20 的可见画布复验，S02-T02 已补齐。B01 至少还需要三项精确正式证据：S02-T04 的默认内容视图重建、任务/dirty/History 保持与重订阅，S03-T03 的 Electron AI→人工→AI 撤销/重做、保存重开与资源核对，以及 S02-T03 的真实 Engine 对未保存 Markdown/课件先 drain 后读取。


## 2026-09-23 03:20 +08 默认 Course UI 可见画布复验

`default-documents-completed.json` / `.log` 的前一次最终运行已是 **1/1 passed**，但 `run-XqFMC3/third-page-applied.png` 与 `reopened-third-page.png` 中页面侧栏遮挡了画布正文；该运行只证明行为断言通过，不能声称视觉可见。本次只修改 `tests/e2e/g20DefaultDocuments.spec.ts` 的观察时序：点击第三页后关闭“关闭面板”，等待 `document.fonts.ready` 与两个 animation frame，确认真实 canvas 可见后截图；后续切换和重开时按需重新打开导航。没有修改产品源码，也没有重跑 A/C。

实际命令：`node node_modules/@playwright/test/cli.js test tests/e2e/g20DefaultDocuments.spec.ts --workers=1 --reporter=list,json --output=output/g20/b01/default-documents-visible-playwright`（运行前仅从测试进程环境移除 `ELECTRON_RUN_AS_NODE`）。结果：**1/1 passed**，用例 52.6 s，总计 53.2 s，0 skipped / 0 unexpected / 0 flaky；JSON 为 `output/g20/b01/default-documents-visible.json`，控制台日志为 `default-documents-visible.log`，产物目录为 `default-documents/run-IU2DLA/`。

本次实际查看了 `run-IU2DLA/third-page-applied.png` 与 `run-IU2DLA/reopened-third-page.png`：两张截图的页面/图层侧栏均已关闭，画布完整可见，正文都清楚显示“第三页的修改已到达”。自动断言同时证明：外部 Main 操作回执 `revision 1→2` 且 `status=applied`；提交后第一页仍为 `aria-current=page`、canvas bounding box 完全不变；切到第三页后 Main snapshot 为新文本；撤销恢复原文、重做恢复新文；切到 B 后第一页、切回 A 后第三页各自保持；保存后 archive 第三页为新文本；reload 后重新打开 A/第三页仍显示新文本。

因此 **S02-T02 从 `not_run` 更新为 `passed`**：它的 Electron 正式步骤与期望已有同一条完整通过链和可见截图。**S02-T04 保持 `not_run`**：该用例虽证明默认视图 reload 后重新订阅并显示已保存文档，但 reload 前已经保存为 clean，且没有活动任务；它没有完整证明任务、dirty 与 History 在内容视图销毁/重建中同时保持，不能用相邻证据补成通过。

更新后 S02/S03 共 10 项：**7 passed / 3 not_run / 0 failed / 0 blocked / 0 skipped**。S02、S03 仍为 `in_progress`，B01 未完成；真实 Engine 仍未执行。

## 2026-09-23 04:32 +08 渲染器重建与执行入口集成

S02-T04 现为 **passed**。`tests/e2e/g20KernelLifecycle.spec.ts` 实际启动 Electron 和本地 HTTP 模型夹具，在正式输入框发送任务后保持响应未结束，执行页面 reload；主进程保留同一 documentId、未保存正文、revision 1、undoDepth 1、运行中任务和会话 run 索引。重新打开该文档后实际正文视图显示原脏内容；释放响应后完成，HTTP 请求仅 1 次，没有重新请求模型。证据：`output/g20/b01/kernel-lifecycle-first.log` / `.json`，**1/1 passed，16.6 秒**，对应 Playwright 目录 `kernel-lifecycle-playwright-first`。这是 Electron 生命周期行为，不是真实供应商验收。

S02/S03 当前 **8 passed / 2 not_run**；尚缺 S02-T03 的真实 Engine 未保存 Markdown/课件双目标读取，以及 S03-T03 的 Electron AI A—人工 B—AI C 撤销/重做、保存重开资源核对。B01 仍未完成。

`tests/e2e/g20ExecutionUI.spec.ts` 的正式设置、输入框和真实 HTTP 夹具闭环 **1/1 passed，37.0 秒**：未配置时保留草稿；设置连接、读取模型目录、配置角色；打开工作空间并读取未保存 Markdown；流式预览期间正式正文未变，完成只增加一次 AI History；停止第二次任务后迟到内容未写入。证据：`output/g20/b03/execution-ui-fixed-preview.log` / `.json`、`execution-ui/run-ci99ZX/evidence.json` 及两张界面截图。截图已实际查看；预览样式仍有 Markdown 原符号/继承标题字号问题，右侧内层栏宽也需修复。这些局部验证不等于 S05/S06 真实模型或最终视觉通过。

M01/M02/M07、S12/S13/S14 已有产品实现和聚焦检查，M03/M10/M12 稳定叶子开始实施，均登记 `in_progress`，不据此将其完整验收场景置为 passed。外部 MCP 的官方 SDK 往返不是两种 CLI；本地图片字节夹具不是 GPT 实际生图；纯构建检查不是最终真实动态宿主准入。TeamoRouter/DeepSeek 开发环境凭据缺失；产品 GPT OAuth 已通过设置发起正式浏览器登录，尚未取得登录成功证据。两项环境输入已向 Owner 请求，其他开发继续。


## 2026-09-23 05:05 +08 B01 最后两项行为证据

S02-T03 与 S03-T03 现为 **passed**。`tests/e2e/g20MixedHistory.spec.ts` 用真实 ExecutionEngine、生产 Gateway/Registry/Journal 和可控本地 HTTP 响应执行两轮各 5 次工具请求：AI A 实际读到未保存的 Markdown 与课件标题并修改，人工 B 通过正式 DocumentHost IPC 编辑，AI C 读取 B 后继续。两份文档分别按 B→A→初始未保存内容连续撤销，按 A→B→C 重做；随后保存、关闭、重新打开，Markdown 源文与课件标题均为 C，photo/diagram/voice/clip 资源及引用保留。原始样本媒体含合成短字节，本项证明资源保留，不证明音视频可播放。

最终观察命令为 `npx playwright test tests/e2e/g20MixedHistory.spec.ts --reporter=list,json --output=output/g20/b01/mixed-history-rendered-playwright`。结果 **1/1 passed，23.7 秒，0 skipped**，日志与 JSON 为 `output/g20/b01/mixed-history-rendered.log` / `.json`。产物 `output/g20/b01/mixed-history/run-xRlR3V/evidence.json` 记录 10 次 HTTP 请求、双文档 History 及资源；实际查看 `reopened-ai-human-ai.png`，Published 编辑宿主已 ready，课件可见“AI C 课件标题”，不是只截加载占位。

先前同一行为链 `mixed-history-view-ready` 已通过，但截图仍在准备画布。最终只补真实宿主 ready、字体和两帧观察等待，没有产品代码变更。此前 workspace 按钮、分页 read DTO 和源文视图挂载时序的测试错误分别保留在 `layout-and-b01-history`、`mixed-history-current`、`mixed-history-read-contract` 中，不将其首次失败隐藏。

这是正式 real-engine / Electron 层证据，响应源明确是 fixture-controlled-http，不冒充 TeamoRouter 或 GPT 实际模型。至此 S02/S03 共 **10 passed / 0 not_run**，两任务登记 `verified`；B01 工程定义已闭合，B02–B12 以及全 2.0 Goal 继续。后续共享内核相关变更仍按其影响补必要验证。
