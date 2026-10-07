# R-A4 最终组合独立审查

审查者 R-A4；未参与被审实现或测试断言编写。只读产品、测试与既有原始证据，仅写本文件；本轮未执行测试、构建、真实模型调用或 GUI 操作。基线为 `afc65c9e`，首读集成为 `638b88f4`，原包最终产品增量审至 `6087a936`、测试增量审至 `bf4fb7c1`（E 汇合 `b7d1fcc3`）；原包随后合入 main `a8cea6c1`。Owner 继续剩余范围后，S09 尾项独立审至产品 `fe503968`、测试 `b54cf2e2`。以下保留滚动时点的定位与复审记录，当前结论及末尾最终收口优先。发行继续暂停。

**最终结论：本次独立审查发现并追踪的当前真实阻断均已闭合，没有未关闭的新 finding。R4-F1、R4-F2、R2-F1 已有对应修复与行为证据；T03 正常退出／fresh-file 冷恢复、T08 hidden export，以及最后 T08 paint 原像素／真实父组件开合／nested child 点击／模型与 History 保全／GUI 保存整例均通过。最后唯一 T08 运行 1 passed（48.6s）、exit=0；未增加时限或降低断言。结论支持本范围 engineering candidate 的已授权集成，不表示全部产品目标、安装分发、历史 native trap、真实图像供应商或 Owner accepted 已完成；简单改写的两次工具调用等明确边界见末尾。发行继续暂停。**

**后续 S09 尾项结论：`fe503968` 六文件独立 exact review 通过；`b54cf2e2` 的原两例实际 2 passed / 0 skipped / exit=0，相关 Electron 构建一次 exit=0。已持久创建事实的冷 ACK 查证，以及记回执失败保留已创建文件并保持 unknown，均有最低直接证据。无新增未闭 finding，可合入该尾项；缺记录的真正不确定窗口仍 unknown，不重新转换、创建或恢复写权限。**

## 实际范围

已读本包 EXECUTION_PROMPT、README、WORK_PACKAGES 的 K03/K04/A06、VALIDATION_REVIEW 相关条目，以及开发入口、当前状态、任务板、工作协议和架构合同中的正式 writer、资源、身份与停止边界。复用 R0/R1/R2/R3 已覆盖且相关实现未变的结论，不重复全量审查。

- K03：`4fdab4a9` / `51f9951e` 及公共接线 `e385b277`；读取 `courseInstanceEdits.ts`、专业 table/chart 算法、Gateway 和实际事务 consumer。
- K04：`638b88f4` / `9713f1ed` 的开放工具、明确正文写入与 `task.finish`，以及 Engine 的同轮顺序、settlement、恢复和续跑路径；最新 `382849dd` / `c0805338` 的精确范围恢复 helper 仍待 Engine 接线。
- 直接读取依据：Gateway 的原始内容观察、`read-basis-changed`、仅在真实模型新请求接收事实后的 acknowledge、最终 canonical expectation。
- 取消关闭：`b3e1442c` / `d4b7ba5a` 的每文档 lease，核 Gateway 各正式写入路径、ContentApply/资源提交到 Session。
- 组合续跑：实际 T09、Engine 原回执查询及未知副作用 guard；未把 fixture 测试视为真实付费图像执行。
- A06：沿用 R1 的 resource/journal 独立审查，并定点检查当前 Session 事务、共享资源与旧回执优先顺序没有被本轮 lease/转换破坏。

## R4-F1 / P2：中断中的 task.finish 被当作未知副作用，续跑无法正常收尾

观察点 `6afdf5ec`，在 `c0805338` 仍存在。位置：`ExecutionEngine.ts` 的 `possiblyInvokedTool`、`recover`、`execute` 中 `TASK_FINISH` 分支及 `settlementRecord`。原观察点行号分别为 1199–1202、2324–2329、1678–1686；之后插入诊断核验代码使行号移动。

明确场景：本轮 `text.replace` 已由正式 Session 提交；同一轮随后的 `task.finish` 已 checkpoint 为 `executing`，但在它的 returned receipt checkpoint 前应用中断。`task.finish` 只读既有回执并结束任务，本身没有外部写入。

恢复路径存在两处共同根因：

1. `recover` 只把未返回的 `user.ask` 归一为已结束；旧 `task.finish` 保持 `executing`，Gateway 没有可查询的正式 finish receipt。
2. `possiblyInvokedTool` 排除 question、tools.load、task.note，却没有排除 finish。续跑把它加入 `unresolvedToolNames`，新 finish 会被 `unresolved-prior-tool` 拦住。即使只补这个排除，finish 的 `otherTools.some(state !== 'returned')` 仍包含旧 executing finish，因此还会返回 `task-unfinished`。

影响是已保存的正文保持，但用户继续原任务后，软件把无副作用的旧结束请求当未查明动作，不能通过新的明确 finish 正常收尾。未声称数据损坏或当前全部任务不可用，定为用户可见恢复失败 P2。

修复应在原 run-control 恢复边界归一中断的 finish，保留真正外部动作的原回执和未知结果约束；不以关掉未知副作用防重放解决。最小补证为：持久记录中已有一条 committed text.replace，另有 executing finish → recover → 同任务只结束剩余工作；History 仍为一次正文修改，已提交写入未重放。静态定位已交 Root/G；本审查没有执行该反例。

## 已查组合的保留属性

### 专业局部数据与 Table→Chart

`componentDataPropertyFields` 仅对实际专业 property record（appearance/style/crop 等）合并提供的字段；数组与正文维持原完整字段语义。`object.update` 继续产出 `data.set` / `style.set` / `frame.set`，不是替换整个 instance，未要求模型补遗漏字段或人工位置。

转换读取当前真实表格，按类别列、数值列和 headerRowCount 取数据，复用 `replaceChartTableData` / `changeChartType` 生成专业图表及软件身份。返回同一实例的 definition/data edits，保留 instance 身份、frame、外层 style 与所在表面，进入同一 canonical command 和 History；没有把图表伪装为 implementation override。已有展示状态数据或子对象的明确丢失场景局部拒绝，不扩大为新格式门。

Gateway 在正式提交前纳入读取的表格/字段及其身份期望。直接读取表格后教师改数据，旧生成结果应得到 `read-basis-changed`；只移动 frame 不改变生成依据。新事实必须随真实新请求进入模型后才能 acknowledge，不能原命令自动重放。该范围和 T01 原证据相符；Table→Chart→解释→图像中断→续跑的整体仍取决于 T09。

### 聊天、正文与结束动作

bound content 的默认目标由宿主冻结；模型的普通解释/提问/进度只发布会话文字。正文以明确 `text.replace` 的正式回执为准，文件、图片与其他获授权工具仍留在同一任务可用目录。`task.finish` 没有文档目标参数，也没有第二个正文 writer。

同轮调度在写入与 finish 之间保顺序；finish 前交付本轮必要 observation，再读取 settlement，因此 `[text.replace, task.finish]` 不会先结束后提交。finish 在尚有后置 pending 操作时失败，不会跳过剩余工作。显式 finish 的业务失败计算排除 finish 自己，但当前恢复缺陷仍见 R4-F1。原无工具 stop 路径保持原完成/partial 计算，未把所有普通问答改成强制写入。

`382849dd` 新 helper 先查原 committed receipt，再按原 from 和实际解析后的新长度恢复选区，并对当前内容做精确匹配；没有把选择扩成整字段。截止 `c0805338`，Engine 尚无 `recoverBoundContentOutput` caller，故这里只记录 helper 的结构事实，不声称新显式写入的续跑已闭合。

### 取消关闭与正式停止屏障

detach A 时停止 A 当时的 lease，删除该文档目标、读取依据与句柄；run 的 B 目标保留。取消关闭后重新接入 A 会获得新的宿主 lease。操作在开始时捕获原 lease；晚到的旧操作若与当前 lease 不同，Gateway 拒绝，Session 最终也按 `runLeaseId ?? runId` 检查 stopped 集。

逻辑 runId、operationId 与 receipt 身份继续保留；Session 在停止判断前先查询已提交 receipt，所以旧成功回执仍可确认，且不二次写入。新 lease 不会复活旧授权。document lease 未变成模型可传的任意参数。当前 T04 尚未进入其核心写入，因为测试没先通过公共工程接口观察对象路径，见下节；静态对应原缺陷不等于真实 canceled-close 已通过。

### 单资源与日志 owner

本轮转换、明确 finish、lease 没有新增资源或 journal writer。Session 仍在持久 append 成功后更新正式 state，amendment 替换 History entry，资源新字节脱离外部别名，未变字节共享；公开读取继续隔离。沿用 R1/T10 在其相关实现上的最低资源、undo/redo、保存冷开证据；不因本审查角色变化而重复该矩阵。

## 原执行失败的准确解释与最低剩余证据

实际读取 E 原输出：`e-focus-d506.txt`（22 passed / 7 failed，另一个 image fixture 收集错误）、`e-repair-434.txt`（13 passed / 5 failed）、`e-diagnostic-6afd.txt`（1 passed / 2 failed）。计数只属于各自真实 cut；本审查未执行或修改测试。

- T01 首轮 fixture 未把生产 `host.agentFiles` 注入 Engine，因此工具缺 file.read；后续 fixture 已对齐生产 owner。T09 首轮按 instance.name 猜工程路径，而投影按 definition.title 命名；已改用实际公共路径。两者首轮失败均未进入待证明产品行为。
- T07 的生成对象路径 500 字符上限是实际可用性问题，`19b9b30d` 去掉任意上限；不把长度/命名偏好重新补成 admission 门。
- T08 的 alpha 断言把逐字 span 渲染当单 span；source iframe 检查从 parent 读 opaque `sandbox=allow-scripts` 的 contentDocument。应按实际 DOM/iframe locator 观察，不能为测试改弱运行隔离。视觉最终仍须实际像素/呈现证据。
- T03 `currentDraftCopy` 的原失败是期待不存在的 `savedRevision: undefined` 字段；`71c50df9` 调整为真实公开保存状态，后续 diagnostic 单例通过。不能把这项 copy 用例的绿扩大为 GUI 正常退出及冷开 raw 恢复。
- T04 新诊断明确为 `invalid-operation: 对象路径尚未观察`。测试先取内部投影路径，随后直接 public object.update；原公共路径要求 project.list/read。应补真实公共观察后执行原 A/B/旧操作隔离动作，不删观察边界或降低 expected outcome。
- T06 新诊断在 provider 首轮 request.tools 断言处抛出、尚无执行 tool。`382849dd` 已把获授权 Office family 加入默认可见目录；此修复尚需原公共 Engine→真实 Office mutation→review/rollback 用例。尚未证明的是行为，不是架构清洁。
- T09 在图表转换/修改及正文 History 之后，于续跑 completed.status 失败；`e-repair-434.txt` 没有打印该次 failure/tools，不能猜测是图像重放、正文恢复还是 fixture 断言。需用该原例的真实回执定位并补证：生成只一次、已有图表/文字不重放、教师中间移动保留、只补缺少的 image insertion、保存冷开正确。

既有通过证据在对应实现/定义未变时继续有效。下一步只复审 R4-F1 的修复、K04 恢复 helper 的实际 caller，以及 T04/T09 原失败相关结果；不以最终 cut 为由重跑无关矩阵。本报告最多支持相关 engineering candidate，未替代真实模型协议、图像执行、视觉/互动、正常退出冷开或 Owner 接受。

## K04 修复补审（`f1d8af62` / `827eaf31`，集成 `ef56dd7c` / `a3b5a080`）

直接读取两项实际 diff，并在集成 `b084ec8e` 核对存在。R4-F1 保留上文原失败推导作为定位；本节更新其状态。

- `reconcileReceipts` 对中断中的 TASK_FINISH 本地改为 returned / `task-finish-interrupted`，不向 Gateway 执行或查询虚构业务副作用；`possiblyInvokedTool` 同时排除该纯控制动作。旧记录不再触发同名 unknown guard，也不再因 executing 状态挡住新的 finish。真正文档 executing/unknown 仍查询原 receipt，未确认时继续阻挡。原根因的两处均已消除。
- 已确认的 finish receipt 可直接完成仅回执续跑；该路径删除旧 contentOutput、清空 writable/selection，避免为已经完成的任务复活旧范围。只完成正文但尚无 finish 的复杂任务继续原工具循环，不再用一个 host text.replace 提前结束全部工作；历史单一 host 正文任务的原行为范围被明确限定。
- 未结束的 bound 任务通过 `recoverBoundContentOutput` 查原提交、对当前内容匹配、仅更新同一个绑定目标及其 writable/selection；没有扩成整字段。新 caller 与 helper 已在同一集成 cut。当前 helper 对原工具显式旧 target 的恢复仍依赖旧句柄存在；已向 G 提醒该冷启动边界，尚未执行，未把它列为已复现的新缺陷。
- 已读独立 T10 `taskFinishRecovery.test.ts`（`000f786b` / `ef9bed38`，集成 `9fb692d7` / `e1169247`）：它保存真实正文提交后的 crash slice，并分别覆盖纯 finish 和额外未知 write；断言正文只提交一次、未知 write 不被结算为成功。测试定义对应待证明属性，但本审查尚未读取到其成功执行输出，因此状态是“修复静态通过、原反例执行待确认”。

## 最终相关增量补审（固定 `0b016835`）

本节只覆盖 Root 再次交付的相关增量、直接 caller 和 E 已有原输出；没有重跑检查，没有扩大到全仓新审。以上较早状态保留作为来由，以本节最新证据为准。

### 冷启动身份、停止与未知结果

- `39765951` / `bc710aa2` 补齐显式旧 target 冷恢复：Engine 从该 write 已持久记录的 effectTargets 中取唯一原文档目标，Gateway 仍核同一 field/from、原调用的 applied/unchanged receipt 及当前精确正文。它不从旧句柄字符串猜范围。`28c31761` 允许同一 DocumentHost 下重启 Engine 复用已经 stopped、actor 相同且文档集合包含所需身份的 receipt owner；没有 beginRun、重建 writable、续新 lease 或原地取消 stopped。
- `b8f740f3` / `ea9a5ed9` / `ac0a9380` 实际释放停止后的 source body、contentReads、handles、cursors、image resources、授权 paths 和投影缓存。stop 先标记 stopped 并等待原取消/Session 屏障，随后清 author state；原正式 document receipt 和必要 pending/unknown/外部 receipt 仍可只读查证。停止后的 lookup/execute receipt 访问不会重新创建 lease/digest 运行缓存；真正新的调用仍受 stopped/权限检查。
- `2d23eb73` 在原 generate/edit 的相同 job 身份下采纳 image.status 的 ready receipt，软件重新签发资源而非重发生成。T09 的旧失败恰为仅从 generate 初始 pending receipt 寻找 ready 图片，此修复直接覆盖根因。
- `6ea5f30e` / `f6ddd19a` 由实际 HTML action owner 标记动作已经发出后的异常为 `html-action-outcome-unknown`；发出前的 assertCurrent 失败和明确 `applied:false` 不冒充未知写入，Engine 保留 owner 的实际 error code。未知结果仍留原操作回执，不自动重放点击/输入。

### 原文、公式与原生输入恢复

- `77ab68ba` 把默认正文作为标注为数据的原文传入，消除 JSON 字面量额外转义；只改变内容投影，不改变冻结目标/权限/正式写入。
- `7ea0297e` 在现有 HTML 文本解析器接受成对的一或二个反斜杠数学定界；不会全局 unescape，公式内部 LaTeX、普通反斜杠文字及 code literal 不被改写。独立 T01 在 `0b016835` 包含原失败 live tool input 的离线重放，该实际 source model 是 `deepseek-v4-flash-ga-260731`；它证明此输入的解析修复，不是 V4.1 路由验收，也没有新付费调用。
- `cb288c6d` / `a4f24606` / `5f67ad45` 将 Canvas 的未结束输入接到已有 raw recovery carrier；保留 project/instance/surface/命名状态、originalData 和确实编辑过的 frame/source baseline。restore 只恢复草稿，composing 变为 resumeRequired，收到真实新输入才可提交；prepare 不新增 writer，仍由现有 surface commit 进入 History。没有以恢复为由重排整页，未编辑 implementation 的数据 spot 不被无关 implementation 变化挡住。最近层 cold Host 用例已通过，真实 normal quit/cold GUI 显示仍不能由它代替。

### 真实 PPTX producer 与 headless capture

- `629fb62c` / `63bf1af2` 的公共 PPTX 路径读取已授权冻结字节，隔离 worker 调用既有 `createCourseFromPptx` → `parsePptxImport` / `planPptxImportTransaction` / V10 archive；原源文件字节随现有 converter 保留。转换结果继续由 AgentFileService / FileService 创建和打开，正式编辑仍由 Session；没有第二文件 writer 或静态截图替代专业实例。`7718380f` 只在真实 FileOperation success 时声称 saved，不把准备成功当写盘成功。
- 该 worker 在停止/关闭时销毁，转换后写盘前再次 assertActive，写盘 ACK 不明保 unknown。当前生产 `pptxImport` 没有配置可选的持久 `lookup`；同进程 retained receipt 可查，冷启动在创建之后、Engine ACK 之前的未知结果不能据此声称已自动查证。已向 Root 报此恢复能力边界；没有证据显示已损坏源 PPTX 或重复创建，也不将其升级为当前全流程不可用。
- `fe5b827d` / `5b16a093` 为 headless export 接入实际 Published capture：Main 核 worker sender/mainFrame、requestId 与 document/epoch/revision/project identity，复用 ViewObservationDesktopService；worker preload 不提供 workbench desktop API。build/compile/capture 共享本请求的停止信号，progress、cancel、reply 按同 identity，晚回复/窗口关闭释放原资源。输出仍复用既有 producer，捕获只针对当前输出内容；未重新引入全工程素材等待或新布局 owner。实际 hidden-window 捕获/取消用例已准备，但本次读到的 Vitest 输出没有执行该 Electron spec。

### Browser 任务授权的实际 consumer

`cb054918` / `e6cc60d9` / `1861fcc2` / `0ea35161` / `62eefe16` / `be5b9987` 的链是：Main 已冻结 webAuthorization → owned Electron DOM inspectAction → 具体一次 action grant → 执行时再次观察并消费同参数/同 snapshot/同动作事实。prepare、submit、upload、download 取真实元素/form/link 属性；未知动作不凭模型描述获得许可。页面 origin 和 destination origin 必须落在既有 scope，read-only、takeover、stop 和 generation 变化继续生效。

Main 与外部 consumer 复用同一个 BrowserActionApprovals owner，旧 blanket 每操作确认被已存在任务授权替代；这对应 Owner 的减少多余确认要求。实际 Electron Browser spec 尚未在本节证据中运行，故只给结构结论，未宣称可观察的提交/下载/上传已通过。

### 最新 E 证据与停止条件

`e/output/e-final-0b016.txt` 对应七个明确文件：T01 richBoundContent、T10 taskFinishRecovery、T04 cancelledCloseContinuation、T03 headlessFileReconcile、T03 slideCompositionColdRecovery、T09 computeUsableOutput、T09 compositeImageContinuation。11 个实际用例中 9 passed / 2 failed / 0 skipped；只 T10 两个变体失败。T04、T09 以及当前 rich input/Canvas 最近层原失败已能闭合其范围，不因本补审再重跑。

T10 此次已改用 fresh DocumentHost 并恢复正式 journal，正文/History 先前步骤通过，但它从一条实际 completed run 改写 running crash record，同时复用了已保存 completed 的 run.end event。recover 将 record 置 interrupted 后，`publishEnd` 正确报告“运行终态事件与恢复记录不一致”。这是模拟 crash slice 的两份事实不一致，不能通过删产品终态检查修补；应让 fixture 的 record 与 event 同处真实崩溃时点，再运行这两个变体。尚不把它记录为 R4-F1 行为通过。

同 cut 的组件生成 20 项、Player 和 Renderer build 输出成功；`e-build-0b016-electron.txt` 为实际类型失败，包含 coordinator 的不相容分支、诊断参数类型、recovered target 的宽类型、新增 file.observe/reconcile 映射缺项、可选 savedRevision 和 admittedSourceIds。该输出尚不能证明整个构建完成，也不能仅凭前两项构建绿降格为文档缺口。

本轮剩余动作限定为上述 T10 正确 crash 证据、明确 build 错误及真正尚缺的 Electron GUI/Browser/PPTX/headless 输出属性；已经通过的无关测试不再重复。本审查只更新 engineering 证据，不修改 main、不宣布发布或 Owner accepted。

## 最窄修复补审（固定 `867f9407`）

仅审 `716cdcc5`、`c26146e1`、`a947ec02`、`867f9407` 及其直接 consumer，不重审以上未变包。

- **原图片未知 ACK 查证：**`HostToolCoordinator.lookup` 以正式 operationId 得到固定 `image-${operationId}`，读取原持久 ImageGenerationService job，核 jobId/runId/generate-or-edit 类型和原 receipt 文档归属。Gateway 的 ownsReceiptDocument 只查当前 grant 文档与 detachedDocuments 的并集，不能转成 active/writable。workspace job 由原 job/run 身份绑定；此查询不调用 provider、不产生新 job，也不签发图片资源句柄。原 ImageGenerationService.read 可把冷中断 preparing/running 标为 unknown 并保存该状态，仍不重发；真正缺 job 返回 null，其他读取错误保留，未为通过测试假造失败或成功。
- **关闭草稿卡引用清理：**`releaseElementChanges` 复用原 tracker.dispose，在 shutdown drain、会话删除和 element draft 已持久恢复之后释放本服务 map 引用；打开中的卡片仍保留逆操作。baseline 重建失败前也先删旧已 dispose 引用。新增 runtimeCounts 数的是实际容器，不把 durable record 删除当缓存清理。
- **6 项类型修正：**coordinator 的 Markdown 分支原本已 return/throw，剩余只可能 HTML，保源文改为对应 `.html`；diagnostic token 比较是等值 some，语义不变；恢复输出使用既有 executionContentOutputSchema 确认 EditTarget，而非 any 断言；新 file.observe/reconcile 补真实 labels；没有 savedRevision 的结果不制造保存版本摘要；admittedSourceIds 缺省按空列表消费。未减少 writer/receipt 校验或改变权限。
- **T10 定义：**测试在真实 `runs.save` 等待点捕获 finish-executing record；此时正文 commit event 已存在，finish ACK / run.end 尚不存在，并复制该时刻已 flush 的事件前缀。正例不再倒改 completed；负例明确添加一条无 receipt 的未知写入，仍要求 partial、不重放正文。fresh Host 从正式 document journal 恢复，未删除产品终态一致性检查。

实际读取 `e/output/e-finish-867f.txt`：同 cut 单文件两用例 **2 passed / 0 failed**。这关闭 R4-F1 的两项性质：纯结束动作中断可继续完成；额外未知业务写入仍不能被 finish 掩盖，正式正文 History 保持一次。它是持久边界恢复证据，不是断电硬件测试或真实模型测试。

当前 Electron only build 与六项 Electron GUI spec 由 E 执行；本审查未重跑。结果到达后仅接原始证据，不提前把类型修正或 spec 定义当已通过。PPTX cold ACK unknown 的持久 lookup 能力边界保留，不为全绿弱化 unknown。

E 随后确认同 cut `node scripts/build-electron.mjs` 实际 **exit=0**。E 提供的 `e/output/e-build-867f-electron.txt` 在本审查读取时尚不存在，因此 exit=0 当前是 E 的实际执行报告，未写成我读取该文件所得。原 6 项类型错误的构建缺口据此关闭，Player/Renderer 无相关变化的原通过证据继续有效。`e-gui-867f.txt` 仍为运行中输出，已出现 T01 richCard 和 T03 visibleDraft 的失败进度，但尚未有最终错误段；此时不给失败根因和最终通过计数。

E 已补存原执行回执文件 `e-build-867f-electron.txt`（命令、exit=0、stdout/stderr empty），我已读取；没有重跑构建。先前文件不存在源于成功无输出时 Tee 未创建文件，不改变实际退出码。

## 既有审查 finding 汇合与简单快路边界

原 R2/R3 报告保持历史原文。本节用已合入的实际修复和原证据更新相应 finding，不把旧首段 open 状态重复当作当前产品阻断。

| Finding | 最新对应事实与结论 |
|---|---|
| R2-F1：内置工具仍等待非业务记录，退出 pending 无 consumer | 直接核 `77f31aa6`：Engine event 改为 EventStore.enqueue，display buffer 的 flush 只把有序 batch 交给原 EventStore，不再等待其磁盘 ACK；运行中 publishEnd 不在工具路径查磁盘 terminal event。正式 RunStore checkpoint、Session/Journal ACK 未脱离等待。`4ebf74e1` 已把实际 pending/lastFailure 接入关闭提示、托盘 tooltip、退出错误面板和 external status；退出按原 owner drain，记录失败仍是诊断，不重放业务。**原静态缺口已修复，条件性结论：待独立一例受控 pending append 的真实 Engine/tool/Stop 验证**，不声称已测生产磁盘延迟或全部辅助写入永不等待。 |
| R2-F2：取消关闭后 writable 句柄不能实际写入 | 本报告已核每文档新 lease 与旧 operation 捕获；`e-final-0b016.txt` 的 T04 原双文档公共路径用例已通过，A 可新写、B 保留、旧 A 授权仍停止。**对应缺陷关闭。** |
| R3-F1/F2：源码资产 ID 丢失、capture 早于可见资源 | 沿用 R3 对 `ed99f2f9` / `47e75e28` 的原接口和时序反例修复补审，不新作同义测试。这里不把其最近层修复证据扩大成后续所有 GUI/输出图像已通过。 |
| R3-F3：只信可选登记导致显式外链遗漏 | 直接核 `933925fd` 的 current HTML/CSS/modules consumer 解析和真实 buildPublishedCourseV3 调用；诊断只描述当前实际资源/API消费，过时 resourceSources 不再充当离线事实。只提供不阻断的网络/未知依赖诊断，原源码保留，offlineComplete 的注释也限定为准备证据，未宣称任意动态运行已穷尽。独立 T08 currentSourceDeliveryFacts 在 E `e-focus-d506.txt` 所属执行中 4 例通过：无登记显式图片、普通正文 URL、普通数据 URL、修改源文后旧登记失效。**该 producer 诊断缺陷关闭**，不宣称真实离线网络或程序播放已通过。 |
| R4-F1：纯 finish 中断被当未知副作用 | `e-finish-867f.txt` 两例通过，保真实未知写入，不重放已提交正文。**关闭。** |

简单改写的现状必须单列：`text.replace` 与 `task.finish` 是 **一次 provider 请求、两次工具调用、一次正式 History**。它证明同轮完成和对话/正文隔离，但 **没有满足 Owner 的“无额外工具调用”要求**，不能改称零额外调用。

这个完成信号的边界有实际原因：在仍开放复杂任务工具的情况下，一次 text.replace 成功并不证明后续资料、图像或其他动作已结束；现 provider 的普通 assistant text 也没有可信的作品正文/对话承载区分。因此不能为了工具数漂亮而自动结束首写、把自由对话当作品或关闭其余工具。两调用并非理论上的唯一实现，而是当前接口作出的可核查选择；这一未满足项/取舍应明确报告。本审查不据此引入新的通用 DSL、执行架构或全局门，也不修改已通过的行为事实。

## 证据闭合更新（`35350db0` 与 T01 `1487a4d6`）

直接读取 `e/output/e-presentation-3535.txt`，明确为四用例 **3 passed / 1 failed**，并核三个绿色测试的实际定义：

- **R2-F1 关闭。**`executionRecordingProgress.test.ts` 只扣住实际 EventStore `.events` 文件第一次 writeFile，Document journal、RunStore 和其余真实 owner 保持原实现。Engine 在该写入未释放时取得 text.replace applied/returned checkpoint，正式正文与 History 已变更一次；Stop 在 pending 仍存在时返回 stopped。随后 flush 确实等待，释放后冷读事件只有一次 commit、一次 stopped terminal 且次序正确，正式 revision 未再增加。它直接证明所报等待依赖已消除；不表示生产磁盘性能测量、任意记录可丢弃或真实退出场景全部通过。
- **O06 关闭草稿卡清理证据通过。**`desktopRuntimeCleanup.test.ts` 走真实 ExecutionDesktopService 的卡片关闭和 shutdown：未发送 raw/input references 转入普通会话并保留，关掉的 tracker 释放，另一个仍打开卡的 undo/redo 继续工作，最终 queues/elementChanges/active runtime 为零。其受控模型 transport 内直接提交真实 Session 写入，适合证明 tracker 生命周期；不把它外推为 provider 工具协议测试。
- **原图片 ACK 丢失只读查证通过。**`imageLostAckReadonlyLookup.test.ts` 在实际 ImageGenerationService 已持久保存 ready 作业与 PNG 后仅丢失 ACK；detach、关闭文档、stop 后可查原 receipt，fresh Host + fresh ImageGenerationService 仍能查同结果和真实 24×20 PNG。生成次数始终 1，无 provideImage、资源句柄、恢复写权限或新文档。它是本地受控 provider 的持久作业证据，真实图像供应商与计费能力条件不变。

唯一红例是 **T02 presentationStateLifecycle**，失败位于第二次 duplicate。核固定 `35350db0` 测试：pageHandle 为 const，public read 返回的新 `data.target` 被丢弃，随后仍用最初观察的旧句柄写入。当前输出只证明到此为止，不证明后续 rename/delete/initial/thumbnail/clear、保存冷开已完成。独立 T 正在改用公共返回目标，不能为测试放松产品观察边界，也不能写“命名态全部通过”。

直接读取 T01 原日志 **`e/output/content-revision/playwright-T01-1487.log`**：**1 passed，49.8s，exit=0**。同时读取其 `Rich-GUI-golden-chain-facts-*.json` 与测试断言，证据链是实际 Electron UI 选择富文本 → AI 卡发送 → HTTP/SSE 适配器、Engine、Session → 正式 History 一次 → UI undo/redo → UI 保存 → 退出后新 Electron 进程打开。链接、公式身份、未选相邻对象、既有布局、正文排除对话说明均有断言，冷开 model 等于保存版本并实际显示新正文，page/server error 为空。内容由受控 provider 提供，真实供应商未测；有资料读取的这条例使用两次 HTTP 请求，不与前文“简单改写一次请求”混淆。本审查未把未留存独立 PNG 的附件声明称为自己已看截图。

T03 最新原日志为 **`e/output/content-revision/playwright-T03-1487.log`**：选择 Canvas 文字入口时 strict locator 匹配两个“双方可编辑 spot”按钮而失败，尚未输入 composition、更未到正常关闭/新进程恢复。因此这是具体测试定位问题，不能记为 raw 冷开产品失败，也不能记为该 GUI 性质已通过。需独立 T 选择原捕获对象上的实际入口后继续原验收，不为该问题改产品或重跑无关已绿链。

图片真实供应商、安装分发、计算供应商及其他未验收条件不因本节改变。相关绿色证据继续复用，只有上述真实未到达步骤或相关实现变化才补证。

## T03 数值草稿跨对象投影修复补审（`a7a39d9f`）

**静态补审未发现新的阻断；同值跨对象反例和原真实窗口冷开链尚待执行结果，不写成 T03 通过。**本次只核 `PropertyControls.tsx` 的 9 行新增、1 行替换及直接绑定／恢复消费者。Root 提供的现场反例是 text 与 canvas 的 X 均为 250，text 输入 `-` 后切换 canvas，属性标题已换目标但 X 仍显示旧 raw；该截图由 Root 观察，本审查未将其写成自己的视觉检查。

- 数值 `BufferedInput` 以现有 `bindingKey` 给内部 `BufferedPropertyInput` 定 key。真实绑定由 `usePropertiesAuthoringBinding.tsx:57` 产生，包含 document、epoch、surface、state、selected instance IDs 和 global scope，不含 revision 或当前数值。因此同值异对象仍更换会话，同对象普通数值／revision 更新不会据此重建。文本 type 不定 key，既有 composition、blur 与焦点逻辑未改。
- 旧会话卸载仍走 `usePropertyDraftFlush` 的既有 cleanup：dirty entry 保留原 binding、baseline、raw 与 onCommit 闭包，不能成为新对象的输入。新会话只从现有 registry 取同 document、原对象／surface／state／scope、同 label/kind 的记录；切回旧对象才能恢复 `-`。cold restore 沿用现有 epoch 重绑，不重放正式命令。
- incomplete raw 的数值校验仍返回 false 并保留输入，不转为 0。即使保留会话的 flush 被关闭流程消费，正式 patch 仍经 `liveTarget` 对原完整绑定复核，再进入原 kernel/Session 路径；新选中对象不获得旧草稿写入。`App.prepareCourseClose` 仍按 document 保全 registry，未新建持久层或旁路 writer。

需要补的证据仅为独立 T 的“同值异对象 → 新对象不显示旧 raw → 切回原目标仍有 raw，未提交”反例，以及相关 renderer 构建和 E 原 T03 正常关闭／新进程恢复链。原 T01 富文本绿色证据继续有效。本审查未运行测试或构建，也未修改产品源码／测试断言。

## 后台浏览器原生承载补审（`4a86478c`）

**发现 R4-F2：先后台创建任务浏览器、再打开工作台的受支持路径中，普通关闭选择“退出”仍可遗留隐藏窗口与宿主进程。定级 P2（用户可见退出行为）；这是明确源码链推导，尚非本人运行复现。**因此本补审不把退出性质记为通过，原 T05 的真实 POST、unknown deny、takeover/resume 也仍待 E 原用例结果。

触发与位置：`ElectronEmbeddedBrowser.ts:65–71` 在无 Main 窗口时创建 hidden BaseWindow，但 `bindWindow(undefined)` 没有可监听的主窗口；之后 `bindWindow` 只会在 `viewport` 调用时再次执行。`index.ts:187–204` 明确允许同一 headless 宿主升级为 GUI，未调用浏览器 viewport 的普通用户仍可能直接关闭工作台。在 `WindowLifecycle.beforeClose` 选择“退出”只返回 continue，不设置 `index.ts` 的 quitRequested；主窗口 `closed` 的 `index.ts:170–172` 因而不直接 stopHeadlessHost。原关闭链需等待 `window-all-closed`，新 BaseWindow 尚存在会保住窗口计数，且它没有新主窗口的 closed listener 来触发自己的 Stop。这与用户要求退出冲突，也可让尚活跃任务继续留在后台。

最小修复位置应是既有 Main 正常关闭 owner：在已通过文档／输入保全、主窗口真正 closed 后收口退出，或通过已有 owner 生命周期给后台 task browser 绑定后来出现的真实 GUI 窗口。不要为此添加第二宿主、轮询或全局浏览器平台。一次针对上述 headless → GUI → 普通关闭选择退出的进程／窗口销毁反例足以判断本 finding；当前 T05 finally 使用 taskkill 清理测试进程，不能证明此性质。显式 app.quit、MCP stop 和已在构造／viewport 绑定 Main 的普通路径不等同于这个缺口。

其余直接差异未发现新的静态阻断：一个原 WebContentsView 在私有 BaseWindow 和 Main.contentView 之间移动，未新建 page、Session、profile 或 Host；后台 parent 设置为 show:false，view 保持 native mounted/visible，仍调用原 CDP Input 链；public viewport 与 control 没有更换操作目标。hide 不自动夺回人工控制，resume 仍经旧 fresh snapshot；proxy、grants、unknown 副作用分类和 Stop 屏障未改。Stop 先封闭输入并 abort 待定操作，再从现 carrier 脱离，清理原 webContents/session，并在 finally 销毁 background、清空 refs/resources；background 自身 closed 回调由 stopped 保持幂等。普通主窗口隐藏到托盘／取消关闭没有 closed 事件，不会被本次 listener 当作退出。

本轮为独立只读源码／直接测试定义审查，未运行 Electron、网络、模型或测试。原 T01、真实 V4.1、公共 PPTX 与状态绿色证据不因该 backend 改动重跑；S08 权限与 ZIP 目录过滤属于独立测试夹具修正，不充作 browser 产品证据。

## 已有绿色证据接入（不重跑）

直接读取 `e/output/e-numeric-same-x-5b.txt`：按明确单例过滤执行 **1 passed / 3 skipped，exit=0**；不是整份 T03 四例通过。核该单例定义：A、B 的 X 都为 250，A 输入 `-` 后 B 显示 250，registry 只保留 A 的 raw；B 改为 260 仅调用 B 的 commit，切回 A 仍恢复 `-`，flush 失败且 A 不提交。这关闭 `a7a39d9f` 的数值跨对象投影缺陷最近层证据；`e-renderer-5b.txt` 末尾明确 **built / RENDERER_BUILD_EXIT_CODE=0**。原 T03 真实窗口冷开仍单列待证。

直接读取 `e/output/e-presentation-37cf.txt`：公共 V10 命名态 action / 正式 History / 保存 / cold reopen 原例 **1 passed，exit=0**。它接替此前 `35350db0` 的旧句柄测试中断；不扩大为所有 GUI 演示行为已验收。

直接读取 `e/output/e-live-v41.txt` 与 `e/output/content-revision/live-v41-final/evidence.json`：TeamoRouter `https://api.teamorouter.com/v1`，请求别名 `deepseek-flash`，四次请求的实际模型均为 **deepseek-v4-1-flash-260910**，同一代表任务 completed，undoDepth=1，材料数值使用、链接、公式身份、未选区域、保存冷开均为 true。账号计费仍记 unknown；这项证据属于已授权的实际文本工具任务，不外推图像供应商、全部任务、GUI 视觉或安装分发。本审查只读现成结果，没有新增模型请求。

## R4-F2 最小修复独立审查（H `91c7b5b9` → integration `ec208f43`）

直接核两文件 10+/3- 差异与 `createWindow`、`documentCloseCoordinator`、`WindowLifecycle`、Main 退出消费者，**源代码层根因已修，未发现新阻断；仍待原晋升退出行为反例，尚未将 finding 行为关闭。**

`windowLifecycleDesktop` 把原 `beforeClose()` 的 continue/handled 决策回传 Main；Main 只据 continue 记录退出意图，不在决策时直接 Stop。`createWindow.ts:254–286` 仍等 renderer 输入保全、document drain、保存／保留选择及取消检查全部成功后，才以 closeApproved 真正关闭。Main 原 closed 回调再进入 `stopHeadlessHost` 的任务停止、持久记录 flush、文档 drain、保存观察 settle 和 worker dispose。后台创建浏览器后才晋升 GUI、从未调用 viewport 的情形因此不再依赖 hidden BaseWindow 消失后才到来的 window-all-closed。

取消／失败不产生 closed，因此不触发 Stop；下一次普通 X 仍进入原生命周期决策，没有重新 requestQuit 或跳过提示。下一次决策为 handled（隐藏到托盘或取消）会把旧 Main 意图清为 false。托盘“退出”仍使用原 WindowLifecycle 一次性 requestQuit，再经同一关闭保护；显式 app.quit 不新增第二 before-quit listener。未晋升的 headless 常驻 MCP 不安装这个 GUI hook，也未新造正常窗口关闭事件，原常驻语义保持。

本修复没有修改 browser backend、文档保全断言、权限或工作台显示逻辑。E 仅需原计划中的一次相关 Electron 构建及 T 的晋升正常退出单反例；原 T05 POST/unknown/接管复验用于浏览器行为本身。已绿无关链继续复用。

## T03 / T08 实际载体观察修正（`d3315949` / `1bb5da56`）

**两处为等效测试观察修正，未发现断言放松；执行结果仍待 E 原单例。**T03 保持原 canvas instance 定位，把不会穿透 iframe 的 outer text 查询改为该实例内实际 sandbox `#component-root` 的 visible + innerText 精确原值；原输入法 raw、正常退出、新进程恢复、History 与未提交模型断言均未改。

T08 使用实际 top-page PNG，从 child-frame DOM rect 经 iframe 外框、border、X/Y 缩放和 screenshot/viewport 像素比例映射后裁剪；先滚动到可见，并检查整个 clip 在实际 PNG 范围内。它没有生成替代像素或改写页面。当前载体是轴向缩放，该映射未宣称支持任意旋转／倾斜 iframe。fixture 内容、取样 fractions、颜色误差 ≤8、红伪元素／alpha 字形像素 >5、源文与 Player 对照、Flow 局部编辑、原程序和人工位置、互动开合及保存断言均保持。Root 所看 whole-host 图只能支持先前取样地址问题的诊断，不能代替这些原阈值实际执行通过。

## T05 原实际浏览器反例通过（source `ec208f43`，E merge `0084b571`）

直接读取 `e/output/e-build-ec208f43-electron.txt`：`node scripts/build-electron.mjs`，**BUILD_ELECTRON_EXIT_CODE=0**。直接读取 `e/output/content-revision/playwright-T05-frozenTaskBrowser-ec208f43.log`：原用例 **1 passed（2.9s），exit=0**，不重跑。

同时读取 `e/output/productFollowup/T05/frozen-browser-NShZw0/facts.json` 和 checkpoint：真实局域测试服务只收到一次 POST `/submit`，正文 `name=Teacher+answer`，发生在 public viewport 打开之前；backend 创建记录只有原 WebContents id=2。未知动作出现一次 approval 并被拒绝，原断言保留 Unknown clicks 0。随后 Main viewport 展示同一原页面，control 返回 human，再 resume 返回 agent 和新的 snapshotId；run completed、endRun returned，paidCalls=0。这关闭“后台 native CDP 返回但真实 form POST 未发生”的原功能反例。

该证据证明真实 Electron 页面、原 Engine／冻结授权、Main viewport 和 control 状态链；测试仍使用受控本地模型与页面。它未操作完整 Renderer 浏览器面板，也未以真人键鼠实际填表来证明人工编辑，不能外推全浏览器能力。测试最终采用归属校验后的进程清理，故 R4-F2 的晋升正常退出仍由单独最窄反例收证。

T03 随后 test-only `e7e602ab` 仅将原 Canvas 捕获中心点从 mouse.click 改为 mouse.dblclick。直接核 `SlideLocationWorkspace.tsx:521–527`，公开双击捕获由 spotAt 找原编辑入口再 beginSpot，入口文字也是“双击编辑此处文字”；此改动未注入控制器、改选对象或弱化原 IME/raw/cold/History 断言。正确手势仍待原用例结果。

直接读取 `e/output/content-revision/playwright-T07-htmlSourcePublicAction-ec208f43.log`：**1 passed（3.8s），exit=0**。相关定义仍是公开 Engine 的 html.observe → html.click → 新鲜 html.observe；任务 workspace 权限允许已授权的预览动作，文档 writable=[] 保持，源文 revision/undo/redo=0、dirty=false，以及 Stop 后禁止另一新 click 的原断言保持。这是预览动作与源文不变证据，不表示扩展了源文写权限。

## Windows 测试启动／清理载体修正与实际中间证据

T04 新例 `867c0c90` 的定义覆盖原 R4-F2 触发：真实 headless MCP，SDK discover 创建 hidden BaseWindow、BrowserWindow 数为 0；同 profile 第二进程唤起原宿主 GUI、保留原 native window，从未打开 browser viewport；MCP 连接保留至普通 window.close 的自然退出断言后。强制清理只位于断言之后的 finally。首次 `playwright-T04-backgroundBrowserNormalClose-e7.log` 实际失败在等待 GUI 出现，尚未关闭，不能据此称 R4-F2 仍发生或已通过。

test-only `8022505d` 从原 Main 的 `process.execPath` 获取真实 Electron 路径再启动第二实例，修正把 Playwright Windows cmd wrapper 当 Electron 启动的错误；普通关闭、退出选择与自然退出断言未改。`1f9a629a` 的 T08 清理及 T04 同类清理，仍限 app.process/secondary 的自有 PID 与完整 profile 参数，允许参数位于 Windows launcher 的完整双引号片段中；不是按目录片段扫描／结束其他进程。

T08 export `ec208f43` 整例日志实际仍是 180s timeout，但直接读取 `headless-export-GIY13Q/facts.json` 和 checkpoint 后可缩小结论：事实文件位于所有正文断言之后，bluePixels=309344、PPTX generated、PDF generated/%PDF-/62708 bytes、cancel rejected 且无 complete、原模型保持 revision/History=0、export worker 已释放等断言均已越过。日志最后是 `cleanup.owned-process-tree.before profileMatches=false`、`cleanup.app.close.before`，没有 returned。**正文导出／取消性质证据通过，整例超时在测试清理，尚待修后原单例退出码；不称产品导出失败，也不伪称该整例绿色。**不因此重建产品或扩大验证范围。

## R4-F2 实际退出主体证据闭合（test `8022505d`，E `d86dac8d`）

直接读取 `e/output/productFollowup/T04/background-close-s0vtnB/{facts.json,checkpoint.jsonl}`：实际 Main PID **20176**，headless 时 BrowserWindow=[]、hidden BaseWindow id=1；由实际 Electron exe 第二实例唤起后仍是同一 Main PID，GUI id=2 且原 BaseWindow id=1 保留。未调用浏览器 viewport，普通 window.close 弹出原“隐藏到托盘／退出／取消”，选择退出 response=1；随后自有启动载体 PID **19488** 自然 exitCode=0 / signalCode=null。二者是不同 PID，不能把启动载体误称 Main。

自然退出断言位于 SDK detach 和任何强制清理之前，原 MCP 会话保持到断言后；随后的 detach 已因宿主结束 fetch failed。Playwright 的 app 对象也已关闭，随后 finally 再调用 app.process() 时 `_object` 不存在，正是 `playwright-T04-backgroundBrowserNormalClose-d86dac8d.log` 唯一失败位置。**因此 R4-F2 的原 headless → GUI 未开 viewport 普通退出缺陷已有行为证据，关闭；此次 runner 仍为 1 failed / exit=1，不写成整例通过。**独立 T 的后续最窄修正仅缓存启动进程对象给 finally 使用，原自然退出断言不需要弱化，不新增产品改动或阶段门。

随后直接读取 `playwright-T04-backgroundBrowserNormalClose-60c9560f.log`：**1 passed（4.0s），exit=0**；缓存原进程对象后，原正常退出单例的 runner 清理缺口也关闭。直接读取 `playwright-T08-headlessExportWorker-d86dac8d.log`：**1 passed（3.5s），exit=0**，原 hidden export/PPTX/PDF/cancel 同例已整例通过。上述结果不需重复。

## T03 冷开 History 断言裁决（仅核当前正式来源）

当前 T03 冷开入口是工作空间文件按钮 dblclick，不是恢复中心的 restore。`DocumentHostService.openFile:290` → `DocumentRegistry.open:60–63` → `DocumentSession.create:79–83` 从正式文件创建新 saved Session，past/future 为空；Registry.open 该行为相对 `afc65c9e` 未变。相反，显式 durable restore 经 `DocumentSession.restore:93` clone 原 state，保留 past/future；既有 `creationV10RecoveryRouting.test.tsx` 明确验证恢复稿原 History 可用。不能把两种入口混成“跨冷恢复不支持 Undo”。

因此当前 fresh-file cold open 的 undoDepth=0 属既有正确行为，原 `toBe(before.undoDepth)` 的 1 并非该入口合同。仍必须证明恢复 raw 没有产生正式历史、原对象／坐标未变以及有效源码保存冷开不丢失。我只读实际失败样本 `visible-recovery-C3O8dm/workspace/drafts.h5lesson`：project.revision=0，`components/code/main.js` 仍为原 `42`，不是测试编辑后的 `85`；原测试退出选择保留恢复稿，未公开保存这个有效源码，所以不能直接宣称新文件打开应持有未保存的 85。

最窄正确测试语义是先通过公开保存把有效源码 85 建成正式基线，再制造未完成 raw，正常保留关闭后从正式文件冷开；要求 fresh History=0、raw 不产生新 History、原目标 raw/坐标保持、85 源码仍存在且可继续编辑。或者若要测完整 durable History，就明确使用恢复中心入口。不能只把 1 改 0 而删除有效源码断言，也不需新增跨冷 Undo 产品机制。独立 T 正按前一种语义修测试，仍待实际结果。

已核 test-only `4dccc104`：通过真实 Ctrl+S 先等待 dirty true → false、saving=false、History 仍一次，再读取正式 archive 验证 main.js=85；随后才输入 JSON／数值／Canvas IME raw。cold 断言改为 undo/redo=0、revision=saved.revision、dirty=false，并增加 canonical source=85、原 text.data 保持；原 Canvas/frame/raw/UI source 断言均在。因此是按正式入口校正所证明性质，未以删断言遮住源码丢失，仍待 E 结果。

T08 `d4c02dcf` 复用实际 iframe→screen 映射，改成真实 page.mouse.click 原 summary 中心点，未调用 DOM.click、改 details.open 或弱化开合断言。`playwright-T08-paintAndFlow-60c9560f.log` 实际已越过原颜色／字形阈值，但点击后 `#answer p` 仍 hidden，**仍为 1 failed**；当前只可据执行顺序认可原像素性质，不可称真实互动已通过。原 owner 继续区分实际命中点与交互路径，本审查不改变该失败断言。

## T03 正式 GUI 冷恢复整例闭合（test `4dccc104`，E `768cd0ad`）

直接读取 `playwright-T03-visibleDraftColdRecovery-4dccc104.log`：**1 passed（1.2m），exit=0**，以及 `visible-recovery-1LexjZ/facts.json`。saved/before 的原 document/epoch 相同，revision=1、undoDepth=1、dirty=false；fresh-file cold open 为新的 documentId/epoch，revision 仍为 1，undo/redo=0、dirty=false。原 text frame `[1,0,0,1,250,40]` 与 Canvas 原 data/frame 保持，paidCalls=0、normalQuit=true。

原实际断言已全部通过：公开 Ctrl+S 正式 archive 源码 85，随后 JSON 半稿、数值 `-`、Canvas IME raw 正常保留关闭并在新进程回到原目标；原 text.data、Canvas model、位置未被 raw 改写，cold canonical source 和源码输入框均仍为 85。此前关于跨冷 History 的入口误设已按正式合同修正，未添加 Undo 持久能力或删掉内容保全要求。该链无需再跑。

## T08 真实命中证据确认空子层遮挡（diagnostic `9919fe46`）

直接读取 `e/output/content-revision/t08-paint/run-hRVVh4/evidence.json`：原点击点 `(801.0543, 424.5775)` 在 child document 中 `summaryHit=true`，首命中 SUMMARY、随后 DETAILS，目标 open=false；但 top-page 首命中是空 DIV、pointerEvents=auto，屏幕框 `(413,176.8906,788,495.4728)`，同框组件 iframe 位于第二项。点击后子页 events=[]、open=false。这把当前失败定位到外层实际遮挡，而非 details 的浏览器默认行为或教师人工浮层；仍未代表修复通过。

独立核 `modelProjection.ts:77–82,94,111,121,218–219`：stage 按 content、children 顺序 append，Flow viewport resize 给后置 children 同一几何，空 children 默认接收指针，符合该命中证据。最小修复可以只让这个结构容器 pointerEvents=none。真实 nested 节点的 outer 在 flow 和 free 两分支均显式 auto，仍可命中并向原 outer 冒泡；children 本身无业务事件绑定，runtime target 仍为 outer，不需改布局、绘制、模型、状态或人工覆盖层。

本次诊断 run 的整体仍是 test/teardown timeout、exit=1。已足以支持修实际 container 根因；不再以重复改点击点或放宽开合断言代替修复。修后仅接原 T08 一例的实际像素、开合与保存结果，以及相关 Player/renderer 构建。

### 空子层最小修复 exact review（X `c49cc6b6` → integration `6087a936`）

直接核实际提交只有 `modelProjection.ts` 新建 children 时一行 `children.style.pointerEvents = 'none'`，**无新增静态阻断**。后续 Flow/free/resize 只设置该层几何，不覆盖 pointerEvents；真实子节点 outer 两分支仍 auto，runtime bind 的 content 与 bindTarget 的 outer 不变，子节点事件继续正常冒泡。没有几何、布局、内容、模型、源码脚本、绘制顺序或断言改动，和已读取的实际首空 DIV 遮挡证据对应。

这是当前实际根因的本地修复，不是新 pointer 平台或 owner 迁移。E 接一次相关 Player/Renderer 构建、原 T08 真实开闭和独立 nested child 单例即可；本审查仍不把一行源码通过写成行为通过，结果待补。

### 同一 T08 的真实 nested child 补证定义（test `c715` → integration `2c90a9d9`）

直接读完整 diff 和测试：原 Flow 源文／Player 像素阈值、clip、pseudo、alpha、人工布局／导入 program 保全、父 iframe 实际鼠标开／闭与公开保存断言均保留。另一个 Slide 通过正式 group.childIds 持有 guoling.web 子对象，进入该页后以同一屏幕映射与 page.mouse 点击原生 summary，再查正文可见；canonical model、revision、undoDepth 必须保持。导入 program 的 iframe locator 绑定正式 instance，避免新增表面的 iframe 混入。没有 DOM.click、设置 details.open、放宽可见性／像素断言或产品 CSS 注入。

清理只改本 fixture，缓存启动时自有进程，要求完整 profile 参数相等或在 Windows wrapper 完整引号片段中出现，才停止该 PID 的进程树；动作位于正文断言后。未修改已绿色的 T04 或共享 helper，也不能用此强制清理证明自然退出。该增量无新增静态阻断；等待 E 该唯一用例的实际退出码与事实文件。

### 修复后 T08 行为事实与整例时间边界（E `2c90a9d9`）

已读 `e-build-6087a936-player.txt`、`e-build-6087a936-renderer.txt`，相关两项构建各一次且 exit=0。已读 `playwright-T08-paintAndFlow-2c90a9d9.log`，该唯一用例实际 **1 failed / 60s timeout / exit=1**，不能写成绿色。

`run-xFKo92/evidence.json` 显示 source/player 红、蓝、clip 角／内部四组颜色完全相等，pseudo 内容一致；红字形像素 91／40、alpha 字形 125／49，保持原阈值。原父组件开／闭为 false→true→false，nested child 为 false→true；三个点击的 top 首命中均为 IFRAME，子页均收到 trusted pointer/mouse/click/toggle，事实文件记录原开合与 nested 成功。原空层遮挡行为已修，真实子对象仍接收鼠标。

trace 的总时限在 nested-child-before 截图附近达到，后续异步事实仍写入，因此不能仅凭最后 facts 把末尾 canonical model／History／公开保存断言视为全部到达。当前剩余是让该唯一整例在足够完成既定观察的局部时限内返回，或移除冗余诊断；不需要新增产品修复、降低行为断言或重跑其他已绿链。清理 facts 的 profileMatches=true，只处置 PID 25852 自有 launcher 树。

### 移除已闭合的重复诊断（test `ae3` → integration `bf4fb7c1`）

exact diff 仅移除 source/player outer、whole-host、每次点击前后等重复诊断 PNG，以及像素 capture 后的第二次 geometry measure；原 10 个屏幕像素 capture／定位数据、全部阈值、真实鼠标开合／nested click、formal model／History 与 GUI 保存断言保持，60s 时限和 retry 也未改。最后新增一张 nested open 的实际 PNG；noSyntheticHistory、saved facts 均放在相应断言通过之后，避免上一轮仅凭异步事实误判末尾完成。该最窄 test-only 差异无新增阻断，继续等 E 原唯一用例最终结果，不重建产品。

## 最终收口（产品 `6087a936` / 测试 `bf4fb7c1` / E `b7d1fcc3`）

直接读取 `e/output/content-revision/playwright-T08-paintAndFlow-bf4fb7c1.log`：原同次 exec 的启动／收尾输出备份，session 50219、retries=0、**1 passed（总计 48.6s，case 47.6s）、exit_code=0**；不是重跑。同一唯一 output 目录的原生 `.last-run.json` 为 status=passed、failedTests=[]。相关 Player／Renderer 构建已各一次 exit=0，后续只有 test-only 变化，未重新构建产品或扩大矩阵。

直接读取 `e/output/content-revision/t08-paint/run-ZbfB6L/evidence.json` 与 `nested-child-open.png`：

- 原四组 source／Player 颜色完全一致，pseudo 一致，alpha color 正确；红字形像素 91／40、alpha 字形 125／49，均满足未改的阈值。
- 父 iframe false→true→false，nested child false→true；三个点击 top 首命中均为 IFRAME，收到 11／22／11 条 trusted 指针／鼠标／toggle 记录。PNG 实际显示嵌套子对象标题及展开后的正文，不只依赖 DOM 声称可见。
- 通过正式断言后才写入的 noSyntheticHistory 为 revision=2、undoDepth=2、modelUnchanged=true；通过 GUI 保存及 dirty 检查后 saved.dirty=false。人工 frame `[1,0,0,1,430,180]` 与导入 program 在原局部编辑断言中保持。

至此原空结构层遮挡、真实子节点仍可接收指针、原绘制语义、Flow 局部编辑保全以及正式保存的最后缺口均已闭合。R4-F1 纯 finish 中断、R4-F2 后台浏览器晋升后普通退出与 R2-F1 非业务记录阻塞均保留前文各自原始证据，不因最终收口再跑。没有新增未闭合的当前可用性 finding；实现作者未承担本独立审查，R4 未编辑产品、测试或断言。

仍须准确保留的条件与未满足项：

- **发行与安装分发**：继续暂停；源码／构建／隔离 Electron 证据不能外推为安装器、已安装载体自发现或产品发布验收。
- **真实外部环境与图像**：受控计算和本地图像作业证据不能代替当前 Podman 实机路径、GPT OAuth 真实生成／编辑、实际图像执行者及计费验收。正确 V4.1 代表文本任务已通过，但账号计费仍 unknown，不外推其他供应商或全任务。
- **历史 native trap 与全仓遗留**：本包未证明历史 native trap 根因完全消失或长期无泄漏；相关构建通过不等于全仓类型、旧 V9 测试全部清零。
- **PPTX 冷 ACK**：原包收口时无持久 lookup 的缺口已由下文 S09 尾项补齐。已有成功创建事实可冷查原历史回执；旧运行缺记录或真正创建→回执持久化中断仍保 unknown，不从当前文件存在推定成功，不重放未知写入。
- **简单改写调用数**：仍是一次 provider 请求、`text.replace` 与 `task.finish` 两次工具调用、一次正式 History。Owner 的“无额外工具调用”没有由当前协议满足；本次通过不能改称零额外调用，也不以此新造 DSL 或执行平台。
- **证据等级**：这些结果支持本范围 engineering candidate；完整教学效果、全量真实视觉／互动质量和 Owner accepted 继续由相应实际验收决定。合入 main 与文档同步属于后续集成动作，本报告不提前声称已完成合入。

## 后续 S09 冷 ACK 定向设计审（main `a8cea6c1`，尚无实现 diff）

Owner 明确继续剩余范围后，本节仅审 PPTX 创建回执的持久化尾项，不重开已收口全包。直接核 `WorkspaceFiles.createFile:224–250` / `coordinate:454–510` / `runOnce:668–678`、`AgentFileService.createPreparedFile:341–365`、Main `workbenchToolServices.ts:282–304`、`HostToolServices` import/lookup、Gateway.lookup 与 Engine.reconcileReceipts。

**设计可推进。**现 WorkspaceFiles replay 仅内存；DocumentFileCoordinator 的绑定 intent 只用于 rename/move/trash，成功即删除；RunStore 只有 Engine 收到结果后才有 returned 内容。它们均不能直接证明本次正式 createFile 已成功而 ACK 丢失的因果事实。保存／HTML 导入 store 可参考其原子持久写模式，但字段与生命周期不同，不需将其改成通用平台或让 PPTX 走 artifact 第二次保存。最窄改动是在原创建 owner 内记录本 consumer 的紧凑成功事实，并接已有 pptxImport.lookup。

必要边界：

1. 在 `coordinate` 完成成功后、`createFile` 成功 ACK 前记录；不能在仍可 rollback 的 perform 中提前记成功，也不能只在调用者收到 ACK 后才记。记录持久化失败但文件已创建时仍为 unknown，不回滚已创建文件、不经 runOnce.catch 误报普通“目标未创建”。
2. 透传 Gateway 已有 requestDigest 到 import 与 lookup，绑定 runId／operationId／requestDigest。WorkspaceFiles 当前摘要含随机 workspaceId／entryId，不能用于跨进程身份核对。该摘要只证明原操作身份，不是文件正确性的 Hash 门。
3. lookup 返回原历史创建成功与 issues；目标后来修改、删除不推翻原创建事实，不回写、不重建，也不拿当前相同文件内容推定原操作。回执需明确是历史事实、当前内容未重验；旧 documentId／entryId 不变成新活句柄，继续使用须经 file.open/read 的当前观察。
4. lookup 不运行 converter、不创建／保存文件、不 open/attach、不复活权限；Stop 后可只读查证，原 beforeCommit 活性屏障仍控制新写入。持久化原已发生事实不因 Stop 丢弃。
5. 没有完成记录的旧运行、或真正 create→record 中断窗口继续 null/unknown；不为关闭所有不确定窗口增加预备状态机或第二 writer。

最小独立反例为：真实唯一创建成功后丢失 ACK，Stop 后由 fresh Host 原 lookup 取回成功回执，converter／create 仍各一次；同例改动或删除目标后只读再查仍是历史事实，无新文件、Registry 或写授权。此处只批准必要边界；持久化 exact diff 与独立 T1 实际结果仍须到达后审，不将设计结论记为已实现或已验证。

### S09 exact 补审（I `fe503968`，parent `a8cea6c1`）

直接核六文件 110+/23- diff 及唯一实际 caller，**无新增静态阻断**。`WorkspaceFiles.createFile` 在 coordinate 成功结束后才聚合结果、去掉 entryId/sourceEntryId，随后将成功因果事实写临时私有文件、flush、rename，最后返回 ACK；不在可 rollback 的 perform 内记录。新 `WorkspaceCreationOutcomeUnknown` 穿过 runOnce.catch，AgentFileService 转既有 AgentFileOutcomeUnknown，Main 返回 tool-outcome-unknown；该新增记回执失败路径不会删除已经创建的目标，也不会落入“目标未创建”的普通 failed 分支。

Gateway 已有 requestDigest 经 HostToolCoordinator 完整传给 import/lookup；私有回执核 runId、operationId 与原摘要，不用当前文件字节推定旧操作。DocumentHost 注入自身数据目录，新增持久化只在本 PPTX consumer 提供 creationReceipt 时生效，不改变其他创建/整理动作。Main 在 converter 前查原记录；Agent prepared 入口同样先查，底层冷 replay 缺活 entryId 时返回历史回执，不打开当前文件版本。

实际 lookup 只读私有因果记录，返回 saved/path/operation/issues/fallback 及 historical=true、currentContentVerified=false；没有 documentId、target 或原 entry/sourceEntry 句柄，不读、还原或重写用户文件。Gateway 已有 lookup 在 stopped 判断前，查询链不 assertActive、不 open/attach；新创建仍保原 preflight 和 beforeCommit 活性屏障。缺失记录返回 null，损坏事实保持 unknown，同 op 不同 requestDigest 拒绝；已确定的成功不会因目标后来改动/删除而消失。

本轮只读审查，未跑构建或测试。实现静态通过不等于冷 ACK 行为已闭合；仍只接独立 T 原反例及 E 实际输出，旧绿不复跑，前文其他条件不变。

### S09 两例定义与实际收口（tests `bdbfa557` / `b54cf2e2`，产品 `fe503968`）

独立读取新增 `tests/integration/productFollowup/T06/pptxLostAckColdReceipt.test.ts` 两例及 E 原输出：

- 主例运行真实 Engine/Gateway、AgentFileService 和 WorkspaceFiles，实际创建可解析课件；在 Gateway 成功返回而 Engine 原 checkpoint 仍 executing、尚无 tool result 时捕获真实 crash slice，再 hold ACK 并 Stop。fresh Host/Engine 原 lookup 将工具收敛到 historical saved，不调用模型或 converter，不创建／打开文件，不恢复 Registry、handles 或 operation leases；新 write 仍 run-stopped。同调用不同摘要拒绝；目标经人工替换及删除后，查询仍只返回原事实，未恢复旧内容或重建目标。
- 第二例只在私有 creation-receipts 目录的 rename 注入 ENOSPC，目标文件的实际创建不拦截。断言底层 WorkspaceCreationOutcomeUnknown 和外层 AgentFileOutcomeUnknown 均成立；目标课件仍可解析且保留，无 open/Registry。fresh Host 查不到完成记录而返回 null，没有冷重建或误报普通 failed create。

直接读取 `e/output/content-revision/s09-tail/pptxLostAckColdReceipt-b54cf2e2.log`：固定 cut `b54cf2e2`，指定 Node/Vitest 单文件命令一次，**1 file / 2 passed / 0 skipped，exit=0，总 5.97s**。直接读取同目录 `build-electron-fe503968.log`：固定产品 `fe503968`、唯一 `node scripts/build-electron.mjs` 调用 **exit=0**。产品到测试 cut 未再改变，无其他构建或原绿色用例重跑。

证据限定：主例 converter 和 HostToolServices.pptxImport port 为受控 fixture，ACK hold 为故障注入；它证明真实持久创建 owner、Engine 原切片恢复与只读回执路径，不宣称重新测过实际 converter/Main/GUI。原真实 converter／可编辑保存／Main GUI 绿色证据在未变实现上复用，Main 新 lookup 接线由本 exact review 核对。ENOSPC 例证明新回执写入失败的错误边界，不宣称真的耗尽磁盘或硬件断电。原件、已有目标、Stop／权限和单一文件 writer 均未扩大。

**该 S09 尾项可完成已授权集成，无新增未闭 finding。**旧记录、创建→回执完成前中断、无法读取或损坏回执仍保持 unknown，不根据当前路径／字节猜测原操作成功，不重跑转换、二次保存或重建授权。安装分发／发行暂停、Podman/真实 OAuth 图像与计费、历史 native trap、全仓旧类型和简单改写两次工具调用等未触及条件继续保留。本次只写审查报告，未代实施者运行测试或修改源码／断言，也不提前声称尾项已经合入 main。

## 免 WSL 计算替代设计审（main `8cea17c6`，仅方案，未实施）

Owner 已卸载 WSL，并明确教师不能以安装 WSL 为前置；本节为“如何修改好”的具体建议核对，未启动产品修改、新包下载、构建或测试。直接读当前 `ComputeJobService`、`PodmanComputeBackend`、Main 接线、`WorkbenchServiceTools`、attachment sandbox carrier、Vite 与安装包文件入口，以及现有计算行为用例。

**建议采用 I 提出的随包 Pyodide 薄执行端。**Main 目前确实固定实例化 `PodmanComputeBackend` 并默认 Ubuntu，后端必须调用 `wsl.exe`／Podman；因此安装依赖是当前真实原因。以独立 sandbox hidden renderer 内的 module Worker 执行 Python，可去掉此依赖，保留现有唯一作业、scratch、来源冻结、产物登记及正式文件 writer。无需第二作业系统、通用执行注册表、pip/CDN 运行时安装或 OS 沙箱平台。该结论仅为设计可用，不表示新执行端已就绪，也不授权发行。

必要改动与保全范围：

1. `ComputeJobService` 只把 Podman 名义类型改为当前直接消费的薄端口；仍由它维护作业身份、请求摘要、日志、停止、状态与输出诊断。Main 替换实例并接现有 dispose；sources 冻结、artifact 登记及 File writer 不另开路径。历史 ready 可读，历史 preparing/running 冷查仍 unknown、不在新后端重跑；不能靠保留名为 container 的字段假称还存在容器。
2. 执行 carrier 复用 attachment 的独立 session、权限/下载拒绝、无 Node 的 BrowserWindow 与窄 IPC 模式，不能仅抄默认 session 的 PPTX producer。允许范围只到实际本地入口与运行时资源，Python/JS 互操作也不能绕过该网络边界；不传 Main、文件 API、Provider Secret 或通用 preload。输入为软件冻结的 bytes，WORKERFS 只读挂载；输出仅以相对名和 bytes 返回，Main 在原 scratch/output 内落地并交回现 owner。
3. **保留公开路径语义**：`WorkbenchServiceTools.ts:44` 明确规定 cwd=`/job/output`、`/job/work` 是同一目录别名，并提供 `GUOLING_INPUT_DIR`、`GUOLING_OUTPUT_DIR`。旧 Podman 也如此挂载。MEMFS work/output 不能变成两个独立目录，否则写 work 或普通相对文件会漏交成果；该别名与环境变量须保留。`compute.run` 的 code/sources/outputNames 不变。内部非 Python program/argv 入口明确 unsupported，不能悄悄按 Python 解释；无需为未公开的任意 OS 命令建立新实现。
4. 运行时、标准库、numpy/pandas/matplotlib 及实际依赖使用一个固定版本完整随包，载入地址固定为本地资源；新增 compute HTML/renderer/module Worker、窄 preload 与 Vite 入口属于当前 consumer 所需。现 builder 已包含 `dist-renderer/**`，不需新分发平台。Pyodide npm 包本身不含 Python wheels，不能以安装 npm 包冒称离线依赖已齐；官方部署说明见 [Pyodide 使用与部署](https://pyodide.org/en/stable/usage/index.html)。
5. 中文 PNG 需随包提供 Agg 可读的中文 TTF/OTF 和对应许可证、并实际选择该字体；现分片浏览器 WOFF2 不能仅凭名称视为可供 Matplotlib 使用。Stop/dispose 终止实际 Worker/窗口、结算 done 并忽略迟到输出；启动中取消同样要闭合，不能只更新 UI 状态。每次作业隔离自己的虚拟文件与执行状态，不把上个作业的文件或 Python globals 留给下个作业。

**能力取舍须明确给 Owner。**本地 CSV、数值计算、numpy/pandas 汇总与常用 Matplotlib 绘图是建议保全范围；WASM 不等同完整系统 CPython。旧后端用例确有真实 subprocess 子进程能力，新端不能声称保全任意 OS 进程、原生扩展、threading/multiprocessing 或系统工具；官方明确这些浏览器运行限制，见 [Python 兼容性](https://pyodide.org/en/stable/usage/wasm-constraints.html)。Worker 的隔离与异步执行是实际推荐部署方式，见 [module Worker 用法](https://pyodide.org/en/stable/usage/webworker.html)。这些差异应以能力说明和具体错误表现呈现，不转成安装 WSL 的隐性回退。

最小验证建议保持 I 的单一样本：CSV 一班 80/100、二班 70/90 得均值 90/80、总均值 85，真实中文 PNG 实看；同次证明冻结输入只读、宿主 sentinel 不可见、外网不可达、仅收相对输出。补最近层 Stop 与冷 preparing/running→unknown 不重放，旧 ready 不重跑；保留原坏辅助文件逐项诊断与有效成果交付。这里列的是未来验收属性，本轮没有运行证据；不重复已绿主包、既有模型或 CLI 矩阵。

口径更新：前文 Podman 实机缺口属于原实现，不能把再次安装 WSL 当教师验收前置；新方案仍须实现和实测。历史 OAuth ready 证据由 Root 查证，本报告“真实 OAuth 未验证”在当前后续任务仅指当前 V10 入口复验尚待实际证据，不能泛称历史从未接通。简单改写仍为一次 provider 请求、两次工具、一次 History；没有当前性能或可用性反例，不据工具数新造执行平台或提升成发行阻断。发行仍依 Owner 原决定暂停。
