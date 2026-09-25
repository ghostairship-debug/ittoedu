# 2.0 接续集成记录（2026-09-24）

本记录接续 `B07_2026_09_23_INTEGRATION.md`。起点为 `acceptance_cases.json` 的 164 项：109 passed、54 not_run、1 failed（S14-T03），以及 `task_registry.json` 的 28 项：4 verified、22 in_progress、2 planned。B07 中未命中相关实现、依赖或验收定义的通过证据继续有效。此处仅记录本轮新增证据，不把工程检查、人工修复副本或测试夹具当成真实模型首轮通过；未提交、推送或发布。

## M10-T05｜删除活动文档

`tests/e2e/g20M10DeleteActiveDocument.spec.ts` 在隔离 Windows Electron profile 中精确运行 1/1 通过，原始记录为 `output/g20/m10/delete-active/run-sdvgQF/evidence.json` 和 `deleted-untitled-draft.png`。本地模型夹具的写任务挂起时，取消删除保留文件、未保存稿和任务；确认后先停止写任务，再移入回收站。已打开文档保留为未命名 dirty 稿，revision 与 Undo 深度未丢，迟到工具参数没有写回或重建旧路径。冷启动恢复后通过界面打开该稿、另存到新路径；其他用户文件与会话仍在，窗口错误为零。首次重开检查在异步恢复完成前直接 `documents.read`，属于测试时序失败；改为等待宿主注册和可见文档后同一用例通过。此项使用本地夹具，没有收费供应商请求。

## S13-T01｜真实构建测试的初始化修复

旧 `output/g20/s13/real-api/last-failure.json` 只记录通用 `EXECUTION_FAILED`，没有可核对的请求或 usage，不能证明旧尝试是否发送网络或零费用。源码核对确认旧测试在新 profile 中绕过正式工作空间选择器，直接 `execution.workspace(path)`，因此会在模型发送前被宿主授权边界拒绝。`tests/e2e/g20ControlledBuildRealApi.spec.ts` 已改为通过正式选择器授权，并分离 connection、document、workspace、conversation、draft、send 阶段。无网络 Electron 预检 1/1：本地不可用 endpoint 的假连接完成 V9 打开、空间授权、会话与未发送草稿，submissions/runIds 均为空；权限服务既有聚焦 2/2 通过。真实用例发送前还会从所选供应商实时模型目录精确核对请求模型，并分别记录目录、请求、回执和未知费用。**S13-T01 仍为 not_run**，修好夹具不等于模型完成构建修复。

## S14-T03｜producer 定向修复

`src/core/tools/ToolTargets.ts`、`DocumentToolGateway.ts` 与 `ToolCatalog.ts` 现在从文档、Surface、页面、owner 和命名态发现专用背景句柄，同时保留只读、跨 Surface 与命名态的冻结授权边界。`HostToolServices.ts` 的图片请求目录只公布当前 GPT OAuth adapter 接受的选项；响应仍按实际栅格格式解码。Native 插入与更新的同源输入 schema 说明 padding、shrink 与背景不透明度，正式提交回执后对本次复现出的过小文字空间和透明背景发出模型可读提示；图片插入说明要求明确位置。没有改变 renderer 或工厂默认值，也没有自动搬动图片。

`tests/integration/g20S14ProducerTargets.test.ts` 的生产发现、授权、反馈与目录检查 7/7，通过相关回归 42/42。Astra 独立复核选定 producer 与图片拒绝 8/8；直接对照工具 schema 和纯 serializer，48 个合法组合共同接受、10 个不支持组合共同拒绝，网络和凭据调用均为零。此反馈覆盖原稿 `height=62,padding=24,fontSize=24,overflow=shrink,backgroundOpacity=0` 的已知失败模式，不等于通用文字可读性测量；图像目录是当前 OAuth adapter 的静态接受域，尚非未来供应商的动态能力投影。原 `run-jBhDpt` 的图片遮字与缩字失败、人工 salvage 副本及其单独视觉证据原样保留；**S14-T03 仍为 failed**，须用新的真实任务另验首轮与修复后结果。

## S13-T01｜同一执行器的真实 API 构建修复

`tests/e2e/g20ControlledBuildRealApi.spec.ts` 在正式工作空间选择器初始化修正、零网络预检通过后，使用 TeamoRouter 的 `deepseek-flash` 精确运行一次，Electron 1/1 通过，耗时约 5.4 分钟。原始 `output/g20/s13/real-api/run-9e45cc59-fdf3-462f-9510-2dba265b5754.json` 记录实时目录 44 项包含请求型号；20 次完成请求均回显实际 `deepseek-v4-1-flash-260910`，5 条 usage 事件保留。模型在同一 Engine 任务内先制造预定编译错误，读取日志后修复，重新编译、检查为 ready 并经 `build.import` 返回 applied；真实 admission 窗口出现。文档 revision 0→2、Undo 深度 1，撤销、重做、正式保存、关闭重开及组件源码校验通过，重开为 clean。账号计费类型及实际金额仍为 unknown，不由 token 用量推算。旧 `last-failure.json` 仍只代表先前初始化失败，不能与本次真实请求混作模型失败；本次没有重复同因付费请求、外部 CLI、提交或发布。

## M09-T03｜运行、应用与保存状态

`tests/integration/g20M09ThreeSuccessStates.test.tsx` 使用真实 Engine→Gateway→DocumentSession→持久事件→可见 Timeline：故障注入只让当前夹具的 Journal append 首次失败，正式应用返回 `recovery-write-failed`，正文、revision、Undo 和 commit 均未变化，过程如实显示“已运行／应用失败／保存未确认”。另一次工具正式应用后，通过外部磁盘改动触发真实保存冲突，外部文件保留、当前文档 dirty 且保存失败可见；定位回调到文档后由真实 Host Save As 写新路径，重开事件显示已保存。对已保存 revision 1 后 revision 2 保存失败的独立反例，旧工具卡保持“已保存”，新失败保存卡仍显示“保存失败”；同 revision 后续失败也不倒写历史成功或隐藏当前 `saveError`。先红后绿，聚焦及相邻 Timeline 7/7、类型检查通过；Astra 独立复核认可该 integration 范围。没有 Electron、模型网络或费用调用，不据此推断其他 M09 用例已通过。

## M02-T02｜无工作目录的新建、AI 修改与保存

`tests/e2e/g20M02UntitledCreation.spec.ts` 在独立 Windows Electron profile 聚焦 1/1，通过原始 `output/g20/m02/untitled-creation/run-TGhNOR/evidence.json` 与重开截图。无选择工作目录时，Markdown 和 V9 课件均先建立 untitled session，可立即人工编辑并经本地模型夹具 AI 修改；课件首次保存只弹 h5lesson 对话框，另一份 Markdown 保持 untitled/dirty 且磁盘无文件。当前 Markdown 的真实 Ctrl+S 只弹 md 对话框并保存 Markdown；特意保持后台课件 dirty，其内存有 2 个对象而磁盘仍为 1 个，未被顺带保存。两次首存 defaultPath 均位于当前 profile 的 `workbench-v2/space` 受管目录，最后分别保存并从全新 profile 经资源树重开，正文与课件文字一致、两者 clean、窗口错误 0。请求均来自 6 次本地 fixture，无收费模型。相关关闭流程单元 3/3、保存请求聚焦单元 13/13、类型检查和统一 `npm run build:desktop` 均通过。Astra 独立复核确认该用例范围；另发现既有 Ctrl+Shift+S Save As 快捷键在 Markdown 上可能先保存原件，已独立列为后续修复，不冒充本项已经覆盖。

## M08-T03｜三个附件入口的快照身份

`tests/e2e/g20AttachmentRoutesUI.spec.ts` 在当前统一桌面构建的隔离 Electron 窗口聚焦 1/1（25.5 秒），原始 `output/g20/m08/attachment-routes/run-1FWaHx/evidence.json` 与 `three-same-name-attachments.png`。三个同名、内容不同的 PNG 依次经文件选择、资源树真实拖入及 `@` 文件引用进入聊天；三份类型化快照的来源、digest 与表示字节分别匹配原件，原用户文件未改变，会话草稿持久化三个独立附件引用，正文输入为空，renderer 错误 0。E2E 类型检查通过；Astra 独立复核确认这覆盖三个实际 UI 入口，不以服务层调用代替。使用本地文件夹具，模型请求与费用均为 0。

## M06-T01 / S05-T06｜真实流式任务的部分证据

`tests/e2e/g20M06RealModelFirstVisible.spec.ts` 的首次启动 `output/g20/m06/real-first-visible/run-6OupnT/evidence.json` 在发送前因测试经 IPC 改设置而 UI 未同步失败：没有 submission、run 或 usage，不能当作供应商请求失败。修为现有 UI 模型设置路径后，真实冷轮 `run-MzBiOI/evidence.json` 使用 TeamoRouter 请求 `deepseek-flash`，8 个完成请求均回显实际 `deepseek-v4-1-flash-260910`；5 条 usage 事件合计输入 10,630、输出 1,254 token，账号计费类型与实际金额 unknown。真实 `text.replace` 内容参数渐进到达，正文草稿在正式工具完成前可见，renderer 接收 `edit.changed` 后双 RAF 可见 9.4 ms；正式操作 applied，revision 和 Undo 深度各加 1。该 9.4 ms 只覆盖 renderer IPC 接收至可见，不等于主进程收到可用正文至可见的完整目标。用户指令在浮层输入时被折为单行，模型随后生成单行；已提交后再次读取旧选区得到 `target-conflict`，最终 run 为 `partial`。测试按硬门停止，没有执行撤销、保存、热轮和停止轮；原始测试 result=`failed`、真实 run=`partial` 均保留，M06-T01 与 S05-T06 正式仍 `not_run`。新的转义提示词已通过本地输入夹具检查，尚未付费复测，不能回填旧运行。

## M02｜首存目录、另存与关闭保存

当前资源树选中目录以 `{workspaceId,directoryEntryId}` 经正式 IPC 传到主进程；首次保存时由现有 WorkspaceFiles resolve 实时验证授权、真实路径、entry 身份与目录类型。`Ctrl+Shift+S` 不再先保存旧路径；标签关闭与整窗关闭的“保存”也使用本次选中目录，取消仍保留 dirty 稿。Astra 独立复核 IPC、授权及取消重试边界后，统一桌面构建 `output/g20/b08/build-post-m02-close-20260924.log` exit 0。

隔离 Electron 中 `tests/e2e/g20M02CloseSaveDirectory.spec.ts` 1/1：选中 A/sub、主进程另授权 B 而 UI 仍显示 A 时，Markdown 和课件标签关闭保存均建议 A/sub；整窗关闭保存对话框取消后仍建议 A/sub 且草稿保留。`tests/e2e/g20M02UntitledCreation.spec.ts` 在修正测试对 binding 附加版本字段的过严相等断言及异步新建等待后，最终 1/1；原无目录 Markdown/V9 编辑、AI 修改、分别首存和重开继续通过，新增 Markdown `Ctrl+Shift+S` 原文件不变、同文档另存，及选中 A/sub 后首次保存落到 A/sub，证据见 `output/g20/m02/untitled-creation/run-A8tO6J/evidence.json`。两用例均使用本地夹具，无收费模型请求；之前的测试失败不计产品失败或通过。M02 其余既有用例证据继续有效。

## M07-T01/T02/T05｜同会话、中文输入与历史

`tests/e2e/g20M07SessionConsistency.spec.ts` 最终隔离 Electron 1/1，`output/g20/m07/session-consistency/run-U9Wacp/evidence.json` 记录同一会话在 Markdown 与课件间发送、本地模型请求从 `fixture-selection` 切到 `fixture-selection-2`、草稿保留、重命名并关闭文件后重开历史会话，实际请求 2 次、未重跑旧工具、文件不变、窗口错误 0。前两次仅因测试在范围弹窗出现前检查 `isVisible()`，以及错误要求 textarea DOM 节点跨设置面板严格同一而停止；修正为用户可见行为后通过。

`tests/e2e/g20ComposerImeWindows.spec.ts --grep M07-T02` 最终真实 Windows IME 1/1，`output/g20/m07/ime-windows/native-SUNmLh/evidence.json` 与物理候选截图证明微软拼音候选可见。Enter 预输入未发送；重输后 Space 实际选中“你好”，Shift+Enter 保留换行、第二行中文与 `@` 空间文件引用，最终恰好 1 次本地 HTTP 请求，文本块含“你好\n测试”和引用文件内容。旧失败分别源于把 IME 非 trusted 的 compositionend 当成仍组字，以及把请求的文本块数组误当单字符串；最终用例保留真实物理候选、原生键入与请求断言。无收费供应商调用。M07 六项验收现均有对应证据，任务登记为 verified；这不代表外部真实模型速度或 Owner 接受。

## S14-T03｜第二轮真实组合及现有结果续验

首次探针进程继承 `ELECTRON_RUN_AS_NODE=1`，Electron 在请求前无法启动；`run-Gb3bqJ/status.json` 为 `prepared-not-sent`、模型请求全 0，不计供应商失败。清除此环境变量后的 `output/g20/s14/real-combo/run-bg3drD/status.json` 使用 DeepSeek 官方 API `deepseek-flash` 视觉与文本，加既有 GPT OAuth 请求 `gpt-image-2` 生图；1 次视觉能力探针、13 次完成的文本请求、1 个 ready 图片作业。上次旧绝对超时未复现。模型先后遇到 6 个目标/操作拒绝，自纠其中 3 类，最终正式提交 8 条可编辑 Native 文字，revision 0→2；任务仍为 `partial`，不能称首轮干净通过。文本账号档位、实际金额、图片真实执行模型和单次收费额均 unknown，不从请求型号或 usage 反推。

原探针因要求 run=`completed`，在图片成果卡应用前停下。无模型续验 `output/g20/s14/real-combo/run-bg3drD/resume-x9obSQ/status.json` 锁定旧 run、13 个请求与唯一 ready 图片，新增模型请求 0；人工恢复课件、按原任务预留的 `{x:760,y:380,width:400,height:280}` 插入、正式保存并关闭重开，revision 3、clean、图片资源与渲染字节一致，来源截图和其他恢复稿未改。原任务生产约 223 秒，人工续验约 35 秒，跨次获得此制品墙钟约 663 秒。`reopened-course.png` 的真实画面显示标题与“叶绿体能量转换器”白字透明底落在白画布上不可见，“三种输入”浅蓝字也偏淡；归档 `project.json` 确认为模型设置的前景颜色。该制品虽可保存重开，视觉仍不合格，**S14-T03 保持 failed**。它既不是旧 `run-jBhDpt` 人工 salvage，也不能把当前人工续验算成模型首轮完成。

针对这个新发现的可见根因，同源 `native.insert`/`object.update` 工具说明和正式 Gateway 回执补了 `native-text-low-contrast` 非阻断反馈：透明 Native 文字在已知平面 Slide 背景上低对比时告知模型。Astra 用黑色卡片上的白字证明最初判断会误报，随后收窄为按精确状态的图层合成与相交范围保守判断；黑卡覆盖时不提醒、空白白底浅色字提醒，图片及复杂覆盖区留给真实画面。修后聚焦 9/9、TypeScript、Astra 反例重演通过，统一构建见 `output/g20/b08/build-contrast-20260924.log`。这只是 producer 修复，旧 run 的不可见文字不会自动改变；新真实组合仍须另验，不能据代码检查把 S14-T03 改成 passed。

## M09-T02｜长输出滚动与继续流的局部证据

`tests/e2e/g20M09LongOutputStability.spec.ts` 最终隔离 Electron 1/1，`output/g20/m09/long-output/run-HnDnkd/evidence.json`：5000 条持久记录、约 3 万字符命令输出，在上翻并展开旧详情时两次本地 SSE 请求继续产出正文、工具与用量；正式游标前进，新正文未因保持阅读位置而丢失。滚动位置 17795.5→17795.5、焦点与展开保持，用户点击“回到最新”后可见新内容；运行期间 busy 为 true、终态 false，当前可见项上界 100。前两次测试分别使用了重开后过期的文档引用、以及把“不自动滚到底”误判为新正文丢失；修测试后通过。`screenReader.status=not_observed` 明确说明尚未做真实读屏观察；**M09-T02 仍 not_run**，DOM/ARIA 不能替代该验收部分。无收费模型请求。

## M06-T01 / S05-T06｜新真实轮次的测试关联与首轮目标错误

`tests/e2e/g20M06RealModelFirstVisible.spec.ts` 的 `output/g20/m06/real-first-visible/run-It1Sdt/evidence.json` 实际已有真实 `edit.content-decoded`：第 5 个请求的 `text.replace` 内容包含换行和反斜杠，正式应用后文档 revision 0→1。原测试把第 1 个失败的 `text.replace` 当作应测请求，故在等待该请求的解码标记时超时；这不是流式标记丢失，也不是供应商请求失败。首个写调用误用只读 `selection` 句柄，返回 `invalid-tool-arguments`，模型后续检查并用 `writable` 句柄完成提交，真实 run 仍为 `partial`；撤销、保存和取消阶段因硬门未执行。当前正式 **M06-T01、S05-T06 仍 not_run**。

系统提示已明确初始 `selection` 只读，写入使用初始 `writable` 或 Gateway 在冻结授权内确认可写的派生句柄，最终以 Gateway 校验与回执为准。测试已改为关联实际 `applied` 的请求并保留首轮错误、真实 run 状态，不放宽 `completed` 门。聚焦 Engine 5/5、Electron/E2E TypeScript 通过；Astra 发现并促成修正了最初提示过窄的反例。新提示尚未做真实模型复测，既有 partial 不能追认通过。

## S14-T03｜第三轮真实组合与零模型续验

`output/g20/s14/real-combo/run-wNGVdx/status.json` 在官方 DeepSeek API 的 `deepseek-flash` 视觉/文本及既有 GPT OAuth `gpt-image-2` 图片角色下运行：1 次视觉探针、11 次完成文本请求、1 个实际 ready 图片作业，生产约 201 秒。模型正式提交 5 条 Native 文字，revision 0→2；首条透明浅色标题收到 `native-text-low-contrast` 反馈，模型随后把标题改成深色。用户可见截图 `failure.png` 的文字已清晰，内容与原截图主题相符。文本 usage 事件合计输入 994,152（其中缓存输入 908,544）、输出 9,191 token；账号档位、真实金额与图片实际执行模型仍 unknown，不据此估算收费。

同一模型响应中的首次 `native.insert` 改变了 scene-owner 内容足迹，其余 4 次插入和首次 `image.generate` 使用过期句柄，均在本地返回 `target-conflict`。模型刷新目标后批量完成文字，并再次调用 `image.generate` 成功；所以有 **2 次工具尝试，但仅 1 个图片 job 和 1 次实际图片请求**。另有一次无效 inspect，run 终态 `partial`；脚本按提示的“只调用一次”硬门在成果卡应用前停止，原记录保持 `failed`。Astra 独立复核证实 `read(owner)` 返旧句柄而 `inspect` 可刷新，以及图片准备在实际发图前错误复用了文档内容冲突条件，已分配互斥写域修 producer。

`output/g20/s14/real-combo/run-wNGVdx/resume-wa3Cil/status.json` 只接续这份终态结果，新增视觉/文本/图片模型请求均为 0；按原提示预留坐标从 ready 成果卡显式插图、正式保存并关闭重开，revision 3、clean，5 条文字和 1 张图片保持可编辑。`reopened-course.png` 实窗检查显示标题、三项输入和结论可读，图片未遮挡文字；源截图及另一个 dirty 恢复稿保留，页面错误 0。续验约 43 秒；这证明修复后的制品可用，**不把人工成果卡续验算作模型首轮干净完成，S14-T03 仍 failed**。首个续验尝试 `resume-oquwjK` 仅因状态 locator 同时匹配 ready 与格式提示而在插图前停止，修正精确定位后完成，无额外模型请求。

## M03-T02～T05｜轻量选择、同核往返、旧高级能力与试运行

M03-T02 复用 B07 已记录的 `tests/e2e/g20WorkbenchPropertyOwner.spec.ts` 聚焦 1/1 与 `output/g20/workbench-property-owner/run-3jARof/`：轻量模式对原有文字完成加粗、改宽和直接编辑，对图片完成替换，对两个对象多选删除并经 UI 撤销恢复；Flow 段落操作亦有同用例覆盖。验收定义与相关选择/编辑路径未变，不重跑该 Electron 用例。

本轮 `tests/e2e/g20ProEditorRail.spec.ts` 1/1（`output/g20/pro-editor-rail/e2e/run-CRaDoa/evidence.json`）：原有轻量修改和本地模型任务保持同一 documentId、History、选择与会话；切至非默认课件页面并缩放 110%，深度编辑和工作台往返后位置、缩放与正在运行的 run 保留，返回后可撤销重做。`tests/e2e/g20M03AdvancedAndRun.spec.ts` 的 T04 最终 1/1（`output/g20/m03/advanced-and-run/advanced-VyPQRG/evidence.json`）：从工作台进入深度编辑后修改既有 Component 题干、复制既有场景进入规则并更改全局层 plane，正式保存、关闭重开与 V9 模型一致。此前两次仅测试先重复点击已打开的属性页签、随后把仅在属性中维护的点击规则误找于互动面板；修正 UI 导航和样本为非点击场景规则后通过，原失败不计产品失败。T05 1/1（`output/g20/m03/advanced-and-run/try-run-YnCkQe/evidence.json`）：编辑态点击现有按钮仅选择，当前位置试运行点击实际导航到目标场景，DocumentSession revision/Undo 和正式内容不变。三条本轮用例均为隔离 Windows Electron、本地模型夹具或无模型；E2E 类型与 V9 fixture Schema 检查通过。M03-T01 的首次打开体验仍需 Owner 人工评价，不据此把 M03 整体记为 verified。

## 接手说明（2026-09-24 09:20 起）

Codex 会话于 09:19 切换给 Claude 接续。经会话日志核对，Codex 的 M11/S06/S14/M12 子代理均已结束（最后一个 M12 Sol 于 09:23 完成），之后没有残留写者。自 10:00 起按 Owner 要求不再并行派发子代理，开发、反例核对与登记由主代理串行完成；下文凡注明“主代理自核”的，均不是独立复核。

## S06-T03/T05、M11-T01/T02｜生成中人工编辑、生成中保存与最近 AI 撤销

以下前四组用例在 08:59 统一构建（`output/g20/b08/build-integrated-20260924.log`）的隔离 Windows Electron profile 中聚焦 1/1，均使用本地 HTTP 模型夹具，无收费请求，页面错误为 0。

- S06-T03：`tests/e2e/g20S06ConcurrentHumanEdit.spec.ts` 的 Markdown 与 Flow 两条各 1/1，证据 `output/g20/m04/selection-7wst6s/s06-t03-markdown.json`、`selection-dfWkFE/s06-t03-flow.json`。第二段生成挂起时，人工改第五段提交为 revision 1；继续 delta 与 complete 后正式提交为 revision 2，Undo 深度 2，回执 `applied`，本地请求各 2 次。人工段保留，生成目标映射正确。
- S06-T05 Markdown：`tests/e2e/g20S06SaveUndoSourceRecovery.spec.ts` 的 untitled Markdown 1/1，证据 `selection-4GyvhL/s06-t05-untitled.json`。生成中首存只写入 revision 1 的正式正文；完成后 revision 2，一次撤销回到原稿，重开 clean。
- M11-T01：`tests/e2e/g20M11DocumentExperience.spec.ts` T01 1/1，证据 `selection-2bNbX0/m11-t01-evidence.json`，是 Codex 将保存状态定位收窄到教学文档标题栏 `span[role="status"]` 后的复跑。保存失败显示“保存失败”、dirty 为真、原文件不变；重启后恢复稿标为“恢复稿 · 原文件未保存”。生成挂起时提示“生成部分尚未保存”，Ctrl+S 只把已确认正文写盘；另存后绑定到新路径，dirty 与 recovered 均为假。
- M11-T02：同文件 Markdown 与 Flow 两条各 1/1，证据 `selection-MbTkEW/m11-t02-markdown.json`、`selection-IAgTVA/m11-t02-flow.json`。按 AI→人工→AI 连续操作后，点“最近 AI 修改撤销”不覆盖其后的人工 B 修改，键盘撤销/重做顺序符合 History 栈顶规则，本地请求各 6 次。

S06-T05 Flow 此前两次失败。第一次由 Codex 修正测试在源文重建后的重新进入；复跑仍失败，只读诊断（trace 指针坐标与选区形状）确认为**产品缺陷**：轻量工具栏“当前选择操作”行为空时被 `:empty{display:none}` 收起。拖选开始时的首次选区上报使该行出现，编辑区在拖选途中下移约 39.5px，CodeMirror 按新布局换算后续指针，于是选中上方两行。源文 Ctrl+Z 会重挂载编辑器并清空选区，所以撤销后稳定复现。修复在 `src/renderer/documents/courseEditorChrome.css`：删除 `:empty` 隐藏，给该行 `min-height: 30px`，试运行态的 `[hidden]` 隐藏保留。这会带来**可见布局变化**：编辑态轻量工具栏即使未选中内容也保留约 35px 的选择行，供 Owner 知悉。同一修复也避免了 Slides 中“按下即选中”使画布在拖动途中下移。守卫 `tests/unit/courseLightToolbarStableHeight.test.ts` 先红后绿，`tests/unit/g20CourseEditorChrome.test.tsx` 同跑 4/4。统一构建 `output/g20/b08/build-m12-s06-20260924.log` exit 0 后，Flow 用例 1/1（1.7 分钟），证据 `output/g20/m04/selection-owAjgZ/s06-t05-flow.json`：生成预览不落盘；完成后一次撤销回到原文；源文 Ctrl+Z 引发重建后，再次拖选得到“先预测😀”并继续编辑；保存与重开一致；本地请求 3 次。修复本身由主代理自核，未经独立复核。

证据有效性：Astra 用当前源码重编 electron，与 08:59 产物逐文件对比，08:59 之后的 M12 改动只在带 `retryOfRunId` 的续作分支内生效；普通发送、原位浮层、保存与撤销路径未变。本节 CSS 修复只改变工具栏占位，不影响这些用例的正文、History 与磁盘断言，Flow 路径也已在新构建上由 S06-T05 Flow 重新走通。据此四组用例登记通过，S06 与 M11 的全部验收现均有证据。

## M12-T02｜连接失效后的保留与显式续作

Codex Sol 先后修复了续作期间教师新草稿被清空、partial run 局部续作被旧冻结范围误拒两类问题；派生子范围平移冻结坐标时拒绝续作。`tests/integration/g20M12ConnectionRecovery.test.ts` 8/8。接手后 Astra 独立复核，确认派生范围只认冻结签发或经刷新的句柄；跨会话续作被拒；并发点两次只产生一个 run；再次失败时教师新草稿保留；用户消息不重复；401/403、402、断连的原因分别准确且不含响应正文或凭据；停止后迟到工具零写入。复核同时发现一个**界面阻断**：界面恢复的文档引用与主进程提交记录值相同、仅键序不同（`selection`/`writable`），`JSON.stringify` 比较判为不等，带选区的原位浮层或手动选区任务续作被误拒，并显示误导提示；主进程接受同一请求。此外，教师清空恢复草稿后，界面比主进程更严。

修复在 `src/renderer/workbench/ExecutionAssistant.tsx`：文档与附件改为按键排序的规范化比较（数组顺序仍有意义）；续作条件对齐主进程，输入框文字与附件“为空或与原任务相同”可消费，文档引用须一致，其余情况仍保留新草稿并拒绝。`tests/unit/g20ExecutionAssistant.test.tsx` 新增两条界面级用例，临时换回旧逻辑时两条均失败，恢复修复后 11/11；M12 集成与相邻 `g20ExecutionSubmission`、`g20S05ConnectionIsolation`、`g20RedisclosureScope`、`g20HistorySafety` 共 6 文件 29/29，渲染层 `tsc` 0 错误。该修复由主代理自核，未经独立复核。

新增 `tests/e2e/g20M12ConnectionRecoveryUI.spec.ts`，在 10:05 统一构建上以隔离 Electron 1/1（1.2 分钟），证据 `output/g20/m04/selection-G7WMvj/m12-t02-ui-evidence.json`。本地 HTTP 模型三轮分别返回 401、402 和连接断开，界面依次显示“模型连接认证失败（HTTP 401）”“模型服务拒绝本次额度或付款（HTTP 402）”“模型连接中断，本次请求结果尚未确认；不会自动重发。”。输入框保留原文字，第一轮还保留附件；等待 2 秒无自动重发。恢复后点“连接恢复后继续此任务”，恰好产生一次续作请求，其提交记录的 `retryOfRunId` 指向原失败 run，run 状态依次为 failed→completed；每段文字只有一条用户消息，受理后输入框与附件清空。第一轮带固定的 Markdown 正文选区（`markdown-range`），正是上述阻断路径。续作请求体含原文字与附件正文，全程 6 次请求、1 个会话、文档 revision 不变、页面错误 0。

剩余风险：供应商以 HTTP 429 加 `insufficient_quota` 表示额度不足时仍显示为“限流”，因为 Provider 按设计不读取错误正文，若要按白名单错误码识别，需要单独做网络与凭据边界评估。恢复出的草稿仍可用“发送”作为新任务再发，这属于用户显式操作，会新增一条消息和一个 run。`g20FrozenConnectionRouting.test.ts` 在清理阶段偶发 ENOTEMPTY（后台 timing 写入与不带重试的 `fs.rm` 竞争），断言本身通过，属于既有测试清理问题，不是本轮回归。M12-T01/T04（安装包）与 T05（真实声明连接）仍 not_run。

## M06-T01 / S05-T06｜真实流式正文：冷轮、热轮与停止轮

10:05 统一构建上，`tests/e2e/g20M06RealModelFirstVisible.spec.ts` 共运行三次，均在 `G20_M06_REAL_API=1` 下经 TeamoRouter（`https://api.teamorouter.com/v1`）请求 `deepseek-flash`；产品实时目录 44 项含该型号，各请求回显的实际模型均为 `deepseek-v4-1-flash-260910`。账号计费类型与实际金额 unknown。

- `run-F5zAJi`：冷轮 `completed`，4 次请求，工具依次为 inspect×2、read×2、`text.replace` applied，首轮零工具错误，解码到可见上界 10.6 ms，一次撤销/重做往返通过。热轮发送时测试停止：`sendInline` 每次都要求“发送前的服务与范围说明”，而同一服务与范围已确认过，产品按规则不再弹出，属于测试假设错误。已改为首轮必须出现并确认，后续同范围必须不出现，以提交记录为准并断言对话框计数为 0。
- `run-F9lMkT`：冷轮上界 8.7 ms，`text.replace` 一次 applied；但模型用了一个此前从未返回、少一位十六进制字符的句柄调用 `read`，Gateway 返回 `invalid-target` 且零写入；模型随后改正，run 为 `partial`，测试硬门在冷轮停止。据此把门槛收窄为：run `completed`，或 `partial` 且所有失败均为被拒的 read/inspect、恰好一次正式 `text.replace`。首轮错误写入 `firstPassToolErrors`，不隐藏。
- `run-s5fbst`（最终 1/1，3.6 分钟）：冷轮 `completed`，4 次请求零工具错误，正文在任务完成前渐进可见（`progressive`），renderer 收件到可见 9.3 ms，主进程解码可用正文到双 RAF 可见的保守上界 **10 ms**；替换内容含中文、emoji、真实换行与反斜杠，一次正式提交，revision 0→1，一次撤销/重做往返通过，显式保存完成。热轮 `completed`，上界 **9.6 ms**，工具为 read×2 与一次 `text.replace`；其派发到首个模型内容约 109 秒，冷轮为 6.5 秒，记录为供应商侧等待，不归因于宿主。停止轮在首个正文片段后点“停止生成”，run 为 `stopped`，第二个请求 `aborted`；文档 revision 4→4、Undo 深度 2→2，停止后内容没有复活。关闭重开后内容与磁盘一致，页面错误 0，截图 `saved-reopened.png`。

冷轮 4 条 usage 合计输入 8,787（缓存 5,504）、输出 1,282（推理 770）token；热轮本次没有采到 usage 事件（0 条），属于证据采集缺口，不据此推算用量。此次收窄的门槛在最终运行中没有生效（`firstPassToolErrors` 为空）。M06-T01 的“任务结束前原位置有新文本、宿主收到内容后 ≤200 ms 可见”与 S05-T06 的“真实片段经解析进入草稿、完整校验后提交、一次撤销、取消后不复活”均由同一真实运行证实，登记通过。这只证明该路由与该型号，不代表其他供应商或 Owner 体验接受。

## S10-T01｜文件与会话正交

新增 `tests/e2e/g20S10OrthogonalUI.spec.ts`，在 10:05 统一构建上以隔离 Electron 1/1（52.6 秒），证据 `output/g20/m04/selection-MqrcUz/s10-t01-evidence.json`，使用本地 HTTP 模型夹具。同一空间依次打开 `selection.md`、`flow.h5lesson`、`spatial.h5lesson`；会话甲发送 1 条消息后留下未发送草稿，新建会话乙也留下草稿；随后交替切换文件、切换会话，并关闭 `spatial.h5lesson`。每一步都断言当前会话、活动标签、标签数、输入框草稿与显示模型：新建或切换会话时标签页与活动标签不变；切换文件时当前会话、草稿与模型不变；关闭文件只减少标签。模型始终显示空间的下次任务配置 `fixture-selection`，不随文件分叉。持久记录中，会话甲草稿为“甲的草稿”、用户消息为“甲的问题”，会话乙草稿为“乙的草稿”、无消息。最终恰好剩两个文件会话（`toStrictEqual`），另有一个启动前就存在、未进标签栏的 clean 未命名会话，单独记录；三份文件字节不变，请求 1 次，页面错误 0。首次运行因模型区域文字含“切换模型”按钮而断言写法不当，第二次运行发现 `toEqual` 会忽略数组末尾的 `undefined`，已改为只比较文件会话并用 `toStrictEqual`，以最终运行为准。

## 命名统一与既有失败（顺带记录）

Flow 的三条提示仍称“排版视图 / 切回排版 / 正文排版”，与按钮“正文 / 源文”不一致，现统一为“正文”（`src/renderer/ui/FlowWorkspace.tsx`，`tests/unit/flowContextSelection.test.ts` 的常量同步）。该单测文件中的 3 条源文守卫用例在改动前后均失败（6 过 3 败）：`createNewFlowProject()` 之后 store 中已没有它们依赖的 Flow 会话，夹具渲染为空，与本次文案改动无关。已把其中的旧按钮名“排版”更正为“正文”，并先展开“正文格式”面板，但 store 初始化尚未修复，记为既有失败，本轮不计通过。

## S14-T03｜第四至第六次真实组合与零模型重开

10:05 统一构建上，`output/g20/s14/real-combo/probe-combo.cjs deepseek-official` 使用 DeepSeek 官方 API（`https://api.deepseek.com/v1/chat/completions`）请求 `deepseek-flash` 负责视觉与文本，使用既有 GPT OAuth 连接（`https://chatgpt.com/backend-api/codex/images/generations`）请求 `gpt-image-2` 负责生图。每次运行前都由新连接自己的视觉探针实测为支持（1 次请求）。运行前的零模型界面预检 `run-TaceWX` 通过。

- 第四次 `run-yYXRAG`：模型探查后正式提交背景与一批 Native 文字，画面 `failure.png` 中文字清晰、对比充分、未占图片区，没有 `target-conflict`，只有一次模型自己的 `invalid-target`。第 8 次文本请求已收到 HTTP 200，但流在中途断开，分类为 `transport`、结果 unknown（宿主的空闲与总时长计时器触发时报 `timeout`，与此无关），产品未自动重发。模型因此没有走到生图，run 为 `partial`，按 `image-generation-count-not-one` 记为失败。文本 usage 输入 611,472（缓存 524,544）、输出 6,628 token。
- 第五次 `run-pfWlvv`：在发送正式任务前停止。第四次未保存的同名课件被恢复为标签，同名时标签显示最短可区分父路径，探针按精确文件名定位失败。本次只有 1 次视觉探针，正式任务的文本与图片请求为 0。探针改为只匹配“本次运行目录前缀 + 文件名”或纯文件名的标签；零模型界面预检 `run-Bdgdzj` 在两份旧恢复稿同时存在时通过，两份原文件摘要不变。
- 第六次 `run-mwguLD`（第四次传输中断后唯一的生产重跑）：run `completed`，8 次文本请求全部完成，首轮 `cleanToolPass` 为 true，失败工具、自我纠正与提示均为 0。模型经 inspect/listChildren 读取目标后，以一次 `batch` 正式提交 6 条 Native 文字（标题、阳光、二氧化碳、水、叶绿体能量转换器、能量转化与产物结论），首轮缩字风险为 0，与预留图片区 `{x:760,y:380,width:400,height:280}` 的重叠均为 0；随后恰好 1 次 `image.generate`，对应 1 个 ready job 与 1 次实际图片请求。OAuth 返回 1499×1049 PNG，带 `size-differs` 提示，实际执行模型未回报（null），计费类型为订阅，金额 unknown；图片 usage 为输入 396、输出 629（图像）token。探针按提示声明的坐标从成果卡显式插图，文字模型未变，并正式保存（dirty 为 false）。随后关闭标签的按钮名同样带父路径，探针在此停止。关闭按钮定位已按同一规则修正，供后续使用。生产约 154 秒，探针全程约 244 秒。文本 usage 输入 702,591（缓存 699,008）、输出 6,457（推理 3,550）token；文本账号档位与金额 unknown。
- 零模型重开 `run-mwguLD/reopen-6kfSyW`：新增 `output/g20/s14/real-combo/reopen-saved.cjs`，以全新隔离 profile 启动，确认没有任何模型连接，授权该轮工作空间后从资源树重开已保存课件。结果为 revision 2、clean；6 条文字的 id、位置与文字和模型首轮提交逐字一致；图片图层位于声明坐标，资源摘要一致；深度编辑中实际渲染来源（`data:` URL）的字节摘要与生成资源相同；保存文件字节未变，页面错误 0，模型请求 0。首两次核验只因渲染进程 CSP 不允许 `fetch` 读取 `data:` URL 而中断，改为直接解码后通过。

`reopened-course.png` 的真实画面由主代理检查：标题、三项输入、转换器标签与结论均清晰可读，无缩字、无遮挡；插图（叶片、阳光、水与氧气）位于右下预留区，主题相符、比例未变形。构图略偏左，结论卡下方留白偏多，属于审美层面，留待 Owner/教师评价。本次模型首轮成果没有任何人工修改；人工介入仅限测试设计预先声明的“按指定坐标显式插图”，以及事后在隔离 profile 中的零模型重开核对。据此 **S14-T03 按工程候选登记通过**。这不同于旧 `run-jBhDpt` 的人工排版修复副本，也不同于第二、三次 `partial` 结果的人工续验，那些仍不计首轮通过。Owner/教师的视觉教学接受、真实计费与图片实际执行模型仍为未知或待定。

## M05-T01/T04｜正文默认可编辑、命名与不完整源文

新增 `tests/e2e/g20M05ModeUI.spec.ts`，在 10:05 统一构建上以隔离 Electron 1/1（1.1 分钟），证据 `output/g20/m04/selection-2jGyYN/m05-mode-evidence.json`，使用本地模型夹具，模型请求 0，页面错误 0。

- T01：打开普通 Markdown 默认即“正文”，正文编辑区可编辑，源文编辑区不存在；模式按钮为“源文”，文档区域内不出现“排版”。鼠标拖选“先预测😀”后，原位目标卡的“AI 指令”可用；点击“乙段：保持原样。”后按 Home 与 Shift+End，得到整行键盘选区，目标卡同样可用，且无“暂时无法精确对应源文”提示。
- T04：在正文把“保持原样”改为“人工修改”后切到源文，内容一致；在末尾写入未闭合代码块 `js`/`unfinished`，出现诊断“第 6 行：代码或对象围栏未闭合”。此时点“正文”被拒并停在源文，草稿逐字保留。文件绑定的 Markdown 会在短延迟后自动写盘，读取草稿时已为 clean；显式保存后磁盘与草稿逐字相同，未被补全或删字。关闭后重开，因源文不完整直接进入源文并显示诊断，内容不变。补上闭合围栏后诊断消失，可回到正文，正文显示修改与代码块，保存后磁盘与会话一致。

中间三次失败均属测试衔接问题：键盘整行选区未收起时，在已选文字内按下鼠标会拖动选区而不是新建选区；选区收起后目标卡正在关闭时去点其中的按钮；以及对 CodeMirror 插入换行结果的预期串推算错误。已依次改为先按 End 并等目标卡关闭，再以会话草稿为准比较字节。Flow 中残留的“排版”提示已统一为“正文”（见上一节）。

## M09-T01｜真实任务的思考、工具与差异展开

新增 `tests/e2e/g20M09RealTaskCards.spec.ts`，以 M06 最终真实运行 `output/g20/m06/real-first-visible/run-s5fbst` 为材料：复制其 profile（跳过浏览器缓存目录），用副本启动 Electron，并经正式选择器授权原工作空间路径。`workspaceId` 首次注册时随机生成，之后按根路径复用，因此能对上原会话。整个过程不发送任何请求，只读展示。最终 1/1（28.5 秒），证据 `output/g20/m09/real-task-cards/run-rEynt6/m09-t01-real-task-evidence.json` 与 `expanded-cards.png`。

用例经产品自身的事件与 run 接口读出冷轮 run `4f240749…`（TeamoRouter `deepseek-v4-1-flash-260910`，工具依次为 inspect×2、read×2、`text.replace`）的持久化事实，再在界面上按 `runId` 定位卡片并展开核对。4 段真实推理（887、37、1,768、31 字）逐段在“模型提供的思考”卡片中完整可读；3 段回复分别在“回复”卡片中，且不含任何推理段落（思考不混正文）。`text.replace` 工具卡展开后，“参数”显示模型实际发出的 JSON，其 `content` 与 `target` 和 run 记录逐字一致；“工具输出”为 `applied`；“实际差异”为 `{before:"先预测😀", after:<新正文>}`，与宿主提交一致。结束时 run 文件数 3→3，原工作空间文件字节不变，页面错误 0。

前三次失败均属测试问题：在未等卡片 `open` 生效时就查找详情区；按摘要元素匹配工具名，而工具名其实在卡片其他位置；把卡片显示的原始 JSON 当成逐行解码文本比较。已改为精确定位、轮询展开并解析 JSON 后逐字比较。外部 MCP 一侧“只核对请求与回执”沿用 B07 证据：`g20S07ToolIncrementDelivery.test.tsx` 经生产 `McpDocumentServer` 的真实 HTTP tools/call 只呈现工具事实并标明外部来源；`g20ExternalMcpService.test.ts` 证明外部 run 不产生伪造的 reasoning、usage 或 run.end。据此 M09-T01 登记通过。M09-T02 的真实读屏与 M09-T04 仍 not_run。

## S11-T01｜真实任务的全程计时

对 S14 第六次真实组合 `run-mwguLD`（run `b1834cdb…`，含截图附件与一次 GPT OAuth 生图）的持久化计时做只读审计，未发任何请求。任务计时文件含 87 个标记，另有保存计时 3 个标记，渲染进程与主进程各一个时钟实例，跨时钟只分别计量、不直接相减。

- 渲染进程：点击发送到 `renderer.send.invoked` 为 2,011 ms，包含确认“发送前的服务与范围说明”。发送到首次可见为 4,011 ms。
- 主进程准备：收到提交到提交准备完成 5.0 ms（其中附件 1.4 ms），Engine 准备 50.5 ms、载荷编译 21.0 ms；收到提交到首个 `request.prepared` 共 117.4 ms，各段均有独立标记，没有藏在请求准备之前。
- 模型：8 次请求各有 prepared、dispatched、first-event、first-content、finished 标记；派发到首事件 745–1,222 ms，派发到完成 2.4–72.3 s，合计约 111.9 s；12 次工具各有起止标记，另有 `document.applied`。
- 外部生图：参考图准备 0 ms、Provider 准备 0.6 ms、fetch 到响应头 37.3 s、响应头到完成 2.2 s、本地资源处理 37.9 ms。
- 收到提交到 `run.ended` 152.5 s；显式保存开始到结束 300 ms，另有保存事实确认标记。

以上满足“准备开销不藏在 requestPrepared 前，模型、宿主、外部用时口径清楚”，S11-T01 登记通过。这是单次真实样本，不作为性能承诺；B07 所补的图片与保存计时接线由这次真实运行首次覆盖。

## Owner 决定（2026-09-24）

- **M13-T03 课件内摄像头/麦克风**：Owner 确认需要。先前一度按“工作台本身不需要设备采集”的误解修订了定义，经澄清已恢复原定义：课件内的摄像头/麦克风按逐次授权开发，授权、拒绝与离线都要有清楚状态，不靠解除整体安全边界；工作台本身不新增采集入口。`mid_term/M13.md` 已同步，该用例 not_run，进入开发。
- **读屏**：暂不做。M14-T02 去掉屏幕阅读器与“流式不重复播报”，保留中文 IME 与键盘焦点要求；M09-T02 去掉真实读屏与“不反复整段播报”，保留滚动、焦点、分页读取与 busy 状态要求。
- **M14-T04 显示缩放**：采用程序内模拟 125%/150% 缩放的口径，不改系统设置。
- **S05-T07 套餐与按量**：TeamoRouter 与 DeepSeek 官方两条路由为按量计费；GPT OAuth 为订阅套餐，正是用例要求的真实套餐连接，因此该用例不属条件缺口（先前误记的 blocked 已撤回，恢复 not_run）。据此更正本记录与 B07 中两条 DeepSeek 路由的“账号计费类型 unknown”：计费类型为按量（Owner 陈述），实际金额仍 unknown，不由 token 用量推算。GPT OAuth 计费类型为订阅，单次金额 unknown。

## M09-T02｜长输出稳定（按修订定义）

按 Owner“读屏暂不做”的决定，M09-T02 去掉了真实读屏要求。`tests/e2e/g20M09LongOutputStability.spec.ts` 在当前桌面构建（`output/g20/b08/build-flow-wording-20260924.log`）上重跑，1/1，证据 `output/g20/m09/long-output/run-TS8lSp/evidence.json`。预置 5,000 条持久事件与约 3 万字符命令输出；上翻并展开旧详情时，两次本地 SSE 请求继续产出正文、工具与用量。滚动位置 17795.5→17795.5，焦点与展开保持；可见项上界 100，已分页读取 24,000 字符；交错期间 busy 为真，任务结束后为假。本地夹具，无收费请求。先前 03:19 的通过记录早于今天的几处改动，本次在当前构建上复核，结果一致，登记通过。

## M13-T03｜课件内摄像头/麦克风的逐次授权

按 Owner 确认的需求实现。课件 Runtime/Component 属受信扩展，直接运行在编辑器页面中，调用标准 `getUserMedia` 时请求会落到主进程会话的权限处理器，此前一律拒绝。改动如下：

- `src/main/security.ts`：`mediaCaptureTypes` 只把非空、仅含 audio/video 的 `media` 请求识别为设备请求。`configureRestrictedSession` 新增可选的 `requestMediaCapture` 回调：有回调的会话逐次询问，回调失败或返回非 true 一律拒绝；没有回调的会话，例如无界面的候选准入窗口，照旧拒绝。同步权限检查、屏幕共享（`setDisplayMediaRequestHandler`）与 HID/USB 等设备处理保持拒绝，不做持久授权。
- 新增 `src/main/mediaCapturePrompt.ts`：只在发起请求的应用窗口上弹出原生确认框，写明请求的设备，默认与取消均为“拒绝”，另一个按钮为“允许本次使用……”，每次请求单独询问。`src/main/createWindow.ts` 仅在主窗口的默认会话上接入该回调。
- `tests/unit/g20MediaCapturePermission.test.ts` 3/3：请求解析；有回调时逐次询问并在拒绝或失败时拒绝；其他权限、检查、设备与屏幕共享不变；无回调会话不询问直接拒绝。相关 `chatClipboardPermission`、`dynamicBehaviorObservation` 同跑通过，共 7/7。主进程 `tsc` 0 错误，统一构建 `output/g20/b08/build-m13-media-20260924.log` exit 0。

新增 `tests/e2e/g20M13MediaPermission.spec.ts`，以 Chromium 假采集设备（`--use-fake-device-for-media-stream`）代替硬件，只替换主进程 `dialog.showMessageBox` 的应答，隔离 Electron 1/1（26.8 秒），证据 `output/g20/m13/media-permission/run-DzuJ45/m13-t03-evidence.json` 与 `try-run-media.png`。课件中放置真实的 Runtime API 2（DOM 模式）按钮面板，在“当前位置试运行”中操作：

- 允许：确认框写明“当前课件请求使用摄像头和麦克风。”，课件显示“设备已开启：audio+video”。
- 拒绝：再次询问（不记忆上次授权），课件显示“设备未开启：NotAllowedError”。屏幕共享请求直接得到 NotAllowedError，未弹框。
- 离线：以 CDP 网络模拟离线，课件显示“网络不可用：离线”；此时再次允许，设备仍能开启；恢复后显示“网络可用”。

共弹出 3 次确认，页面错误 0，无网络或模型请求。首次运行点不到课件按钮：DOM 模式 Canvas Runtime 的宿主层按设计不接收指针，可交互元素需自行声明 `pointer-events: auto`，已在测试用 Runtime 中补上。导出后在浏览器中播放时，设备权限由浏览器自己的提示处理，本次未单独验证。`tests/unit/windowCloseRecovery.test.ts` 有 6 条失败，撤掉本次改动后依然 6 败 3 过，是 M02 改变关闭保存流程后遗留的既有失败；已为其 Electron 替身补上 `app.getPath`，其余断言待按新流程更新，本轮不计通过。据此 M13-T03 登记通过。

## M14-T04｜窄窗口与显示缩放（程序内模拟口径）

按 Owner 选定的口径，新增 `tests/e2e/g20M14NarrowScale.spec.ts`，以 `--force-device-scale-factor` 模拟缩放，不改系统设置（本机系统缩放为 200%，强制缩放叠加其上）。两档各 1/1，共 2.1 分钟，本地模型夹具。

- 125%：窗口设为 1024×700，实际视口 1044×756 CSS 像素，DPR 1.25，证据 `output/g20/m04/selection-v8iVOM/m14-t04-evidence.json`。
- 150%：窗口设为 860×620，实际视口 878×668，DPR 1.5，证据 `output/g20/m04/selection-5XJNpB/m14-t04-evidence.json`。

每档先在常规尺寸下完成连接与打开文件，再切到窄窗口，依次完成五个操作：修改正文后保存，添加附件，发送并确认范围说明，停止运行中的任务，打开课件进入深度编辑后用“返回工作台”返回。每次点击前都检查控件完全位于视口内，且中心点命中的正是该控件（无遮挡、无死区、无不可达入口）。页面无横向溢出。窗口在宽窄之间来回切换后，输入框与文档区仍是同一个 DOM 节点，草稿保留，文档身份不变（布局未重建）。每档请求 1 次，页面错误 0。实际视口比设定值宽约 2%，是强制缩放叠加在系统 200% 上按物理像素取整所致，已如实记录。

首跑的两次失败均属测试问题：`page.evaluate` 中的 `document` 被外层同名变量遮蔽，以及把“深度编辑”当成 Markdown 文档也有的入口。当前只有课件文档提供深度编辑，内嵌的返回按钮名为“返回工作台”；旧 M01 用例中的“返回轻量编辑”是早期名称，现已不存在。据此 M14-T04 登记通过。

## S05-T07｜套餐与按量区分（按 Owner 认可的做法）

Owner 认可：真实套餐连接为 GPT OAuth 订阅，真实按量连接为 DeepSeek；两者各正常调用一次，核对认证、计费、endpoint 与用量；“额度或限流不足时不偷切按量 API”用本地 429/402 夹具验证，不去耗尽真实订阅。

- **本地部分**：新增 `tests/integration/g20S05PlanQuotaNoFallback.test.ts` 2/2。真实 `ExecutionDesktopService`，Token Plan 文本连接与已配置、已验证但未被选中的按量连接同时存在，套餐依次返回 429、402，run 分别失败为 `rate-limit`（HTTP 429）与 `quota`（HTTP 402），各只有 1 次请求，按量端点收到 0 次。订阅 OAuth 的生图角色经真实 `ChatGPTImageProvider` 与 `ImageGenerationService` 依次得到 429、402，job 失败为 `rate-limit` 与 `quota`，出处仍为订阅账号，没有请求其他连接。两处失败信息与设置视图中均无“剩余/余额”一类编造数字（产品本身不保存也不显示剩余额度）。该测试先红：图片 Provider 原把 402 归为 `protocol`，与文本 Provider 的 `quota` 不一致，会让套餐额度不足显示为协议错误。已在 `src/main/workbench/images/ChatGPTImageProvider.ts` 把 402 归为 `quota`，随后转绿；相关 `g20RoleComposition`、`g20ImageGeneration`、`g20ImageCapabilityHonesty` 同跑通过，主进程 `tsc` 0 错误，构建 `output/g20/b08/build-s05-image-quota-20260924.log` exit 0。
- **真实部分**：新增 `output/g20/s05/plan-vs-metered/probe.cjs`，证据 `output/g20/s05/plan-vs-metered/run-NQewOE/status.json` 与 `after-run.png`。在工程 OAuth profile 中临时保存 DeepSeek 官方连接并按实际设为按量计费，经产品设置界面选为对话模型，生图角色保持 GPT OAuth。发送一次“只调用一次 image.generate 生成蓝色圆形图标”的任务。输入框显示“deepseek-official · deepseek-flash · 按量付费”；范围说明同时列出 `deepseek-flash` 与 `gpt-image-2`、按量与订阅，且无剩余额度数字。run `completed`：文本连接记录为 api-key、metered、`https://api.deepseek.com/v1`，2 次请求完成（官方 API 回显 `deepseek-flash`），usage 输入 169,593（缓存 168,704）、输出 599（推理 312）token；恰好 1 次 `image.generate`，job ready，记录为订阅、`https://chatgpt.com/backend-api/codex/images/generations`、请求 `gpt-image-2`、实际执行模型未回报、金额 unknown，图片 usage 输入 182、输出 2,058（图像）token，带 `size-differs` 提示。页面无剩余额度数字、页面错误 0；结束后恢复原角色并撤销临时连接。实际金额 unknown，不从 token 推算。

前两次尝试均在发送前停止，没有模型请求：一次因为经 IPC 直接写角色配置时，输入框标签不会刷新（界面只随自己的设置操作刷新，属于探针未走真实路径）；一次因为先操作设置界面时，启动出现的恢复稿面板挡住了按钮。改为先恢复草稿、再经设置界面选择后通过。第一次尝试时应用关闭被未保存恢复稿的确认框卡住，已强制结束该测试实例（用户原有进程未动），探针改为销毁窗口后退出。据此 S05-T07 登记通过。

## Owner 决定：验收清单收敛（2026-09-24）

Owner 审阅剩余 26 条 `not_run` 的过度设计清单后回复“基本按建议来”，唯一例外是保留内置 AI 的提问能力，并要求以弹出的选项卡提问，而不是只用文字。据此：

- **删除**：S11-T03（多模型组合与外部对照，属评测研究）、REL-T09（性能报告；关键计时已由 S11-T01 真实任务证明）、S12-T04 与 REL-T12（内置任务中途交给外部 AI 接手）。外部客户端直接读写同一文档、票据与撤权仍由已通过的 S12-T01～T03 覆盖。授权面板中已实现的交接包入口保留，不再作为 2.0 发布承诺。
- **合并**：REL-T01 并入 M12-T01（安装包首次使用），REL-T03 并入 M12-T05（只验 2.0 实际提供的 DeepSeek 两条路由与 GPT OAuth），REL-T04 并入 S11-T05（普通编辑调用链审计），REL-T07 并入 M14-T01（一次独立用户试用），REL-T10 并入 M14-T05（一次发布前范围核对）。
- **简化**：S07-T03 只验收起再展开 AI 面板后任务不重跑、记录不重复不丢失；S05-T08 不在 Owner 真实账号上做 OAuth 刷新与退出，改用本地模拟凭据；REL-T05/T06 复用已通过的故障注入、越权与非可信内容证据，只补未覆盖处。
- **保留并改写 M09-T04**：内置执行器原先没有“向用户提问”的工具，也没有子任务。按 Owner 决定开发选项卡式提问；按“没有就删”的原则删除子任务要求。

删除项登记在 `task_registry.json` 的 `removed_acceptance`，需求追踪同步移除；REQ25 改为“同源 MCP 跨客户端、单 writer 与撤权”。已通过用例的定义和状态均未改动。收敛后共 155 条用例。`AGENTS.md` 与 `delivery/TESTING.md` 中外部 CLI 授权示例的 REL-T12 改为 M12-T05，授权范围不变。

## M09-T04｜内置 AI 选项卡提问（按修订定义）

**实现。** 执行器新增一个只给内置 AI 用的 `ask_user` 工具，定义在 `src/shared/workbench/userQuestion.ts`：一个问题、2–6 个不重复的选项，可单选或多选。它不进入 ToolCatalog/Gateway，外部 MCP 的 `tools/list` 看不到它。系统提示补充一句：需要用户在明确方案中做决定时调用它，不要只用文字提问后结束任务。

- **执行器（`ExecutionEngine`）**：模型调用 `ask_user` 后，任务保持 `running`，run.state 显示“等待你的选择”，工具卡为 `waiting` 并带上问题。问题先登记、后发事件，所以立即回答或立即停止都能对上这一问。`answer()` 只接受当前 run 的这一问，拒绝越界、单选多选不符、空回答和错误的调用编号；已接受的同一回答可以重复确认，其他迟到的回答一律拒绝。
- **停止、关闭文档与崩溃**：停止或关闭绑定文档时，问题以“任务已停止，问题未获回答”结束，模型收不到编造的回答。崩溃恢复会把未回答的问题结算为 `question-unanswered`；显式继续时，它作为“未回答”事实交给模型，而不是当成未知副作用，所以模型可以再次提问。无效的提问不会让任务变成“部分完成”。
- **桌面层**：`answer` 请求经 IPC schema 与 preload 传递；回答被拒时返回 `execution-answer-rejected` 和具体原因。
- **界面**：输入框上方弹出“AI 需要你选择”选项卡。单选点一下即回答，多选选好后提交，另有“其他（自己填写）”。选项卡不抢焦点；提交后先锁定，等任务自己的事件关闭它。时间线保留只读的“AI 提问”记录，状态为“等待你选择”“已回答”（标出你的选择）或“未回答”。活动提示显示“N 个任务等待你的选择”，等待中的任务不计为忙碌。外部来源的事件不会生成选项卡。

**验证。**

- `tests/integration/g20M09UserQuestion.test.ts`，7/7：
  - 等待中点选后，同一 run 继续，并按所选修改文档。
  - 越界、单选多选不符、空回答、错误调用编号都被拒绝，期间不发模型请求；已接受的回答可重复确认。
  - 等待中停止：问题以未回答关闭，请求数不变，文档不变。
  - 无效提问作为错误返回给模型，任务仍为 completed。
  - “其他”补充文字与多选原样传给模型。
  - 崩溃恢复后问题结算为未回答，显式继续后可以再问。
  - 桌面 `answer` 请求能让任务续作。
  - 关闭绑定文档后任务停止，迟到的回答被 `execution-answer-rejected` 拒绝；模型只收到 1 次请求，文档不变。

  首轮运行暴露了一个真实竞态：事件先于问题登记，立即回答会被拒。改为先登记、后发事件后复测通过。
- `tests/unit/g20QuestionCard.test.tsx`，5/5：
  - 选项卡按钮点选即调用回答，不抢焦点。
  - 时间线记录只读，等待计数正确。
  - 多选加补充文字；主进程拒绝时保留卡片并显示原因。
  - 任务结束后不显示卡片；已回答的记录标出所选项。
  - 外部事件不生成卡片。
- `tests/e2e/g20M09QuestionCard.spec.ts`，实窗 1/1。使用本地 SSE 夹具，配合真实 Engine/Gateway；证据在 `output/g20/m04/selection-eLqSUS/m09-t04-evidence.json`，截图为 `question-card.png`、`question-card-narrow.png`、`after-close.png`。
  - 选中文字发送后弹出选项卡；等待期间持续 1.5 秒，请求数不变。
  - 点“详细版”后，同一任务把选区改写为“详细版改写”。
  - 等待中点“停止”：卡片关闭，记录显示“未回答”，没有新请求。
  - 等待中关闭 selection.md（选择“停止并关闭”“保存并关闭”）：卡片关闭，经 preload 发出的迟到回答被拒，文件只含第一轮修改。
  - 900×640 窗口下，两个选项都在视口内且可点中，页面无横向滚动。
- `tests/e2e/g20M09RealQuestion.spec.ts`，真实模型 1/1。证据在 `output/g20/m09/real-question/run-fOfgb4/evidence.json`，截图为 `real-question-card.png`。
  - **路由**：TeamoRouter，请求 `deepseek-flash`，5 次请求的实际型号均回显 `deepseek-v4-1-flash-260910`；实时模型目录 44 项，含所请求型号。
  - **过程**：指令为“动手前先问我要简洁版还是详细版”。模型先 read、inspect，再调用 `ask_user`，第 10.6 秒弹出选项卡，问题是“把选中的句子改写成适合初二学生的讲解，你要哪种版本？”，两个选项各带说明。点选“简洁版”后，同一 run 继续 read 与 text.replace（applied），最终 completed。
  - **用量**：输入 11,843 token（其中缓存 8,448），输出 994 token（其中推理 470）。按量计费，金额 unknown。
  - **收尾**：结束时撤销了临时连接。本次调用属于执行器的 API 工具调用，在 S05 授权范围内。
- **模型输出观察（不算应用缺陷）**：改写结果末尾多了一个句号（“……电源电压。。”）。原因是选区不含原句号，模型又自带了一个。
- **回归**：
  - `npm run typecheck` 三套 exit 0；统一构建 `output/g20/b08/build-m09-question-2-20260924.log` exit 0。
  - 在新构建上重跑 `g20M09LongOutputStability` 与 `g20M14NarrowScale`（两种缩放），3/3。
  - 新增 `ask_user` 后，`g20ScopedToolCatalog` 的模型工具清单预期已更新，负载仍小于 10,000 字节。
  - g20 单测与集成共 149 个文件，其中 16 个有失败。逐个核对，均为既有问题或并发下的偶发失败：
    - 清理阶段 ENOTEMPTY。
    - `g20AttachmentExecution`：附件服务新增了窗口参数，测试未更新。
    - `g20AttachmentOutsideWorkspace`：无文档任务的模型目录现在只有 `ask_user`，此前为空。测试伪造的 text.replace 在两种情况下都会被 Provider 以 incomplete-tool-call 拒绝。
    - `g20ExecutionTimelineDelivery`：按时间排序使卡片顺序变化。
    - `g20S12MultiBridgeAuthority`：重连后读取返回 target-conflict。
    - `g20ImportBoundaries`：ExecutionEngine 早已直接导入 ToolCatalog。
    - 另有 `g20DocumentJournal`、`g20WorkspaceFilesTree`、`g20WorkbenchSessionRail`，以及 `flowContextSelection` 的 3 条。
  - 全量 vitest（560 个文件）有 622 条失败，主要是 1.x 旧编辑器测试（如“课程文档服务尚未连接”），失败堆栈无一涉及本次新代码。
- **过程说明**：新功能的测试与实现同批编写，没有单独留存“先红”记录；上面的竞态修复有红到绿的过程。

据此 M09-T04 登记通过。M09 五项用例现已全部 passed，任务级状态未改动。

## Owner 决定：通用 Agent 的权限与输入框（2026-09-24）

- **定位**：果铃工作台的内置 AI 定位为通用 Agent。权限分四档：完全访问 / 完全访问（工作空间）/ 修改前询问 / 只读，默认“完全访问（工作空间）”，位于输入框左下。AI 可以自己打开、修改、新建工作空间内的文件；在“完全访问”下也可以读写工作空间外的文件。所有修改仍经正式编辑通道，可撤销；档位随任务冻结，由主进程强制执行。
- **取消服务说明弹窗**：发送前不再弹“发送前的服务与范围说明”。右下的模型选择器始终显示服务商、模型与计费，发送时照常冻结路由。S10-T05 原定义“按范围再告知”随之作废，改写为“发送不弹说明、配置清楚可见”，已恢复 not_run，待新界面重新验证。
- **输入框重做**：左侧“+”（添加附件、引用工作空间文件、引用当前选区），左下权限，右下模型与发送。去掉“允许修改已绑定文档”复选框、“选择范围”、“移除文档引用”以及单独的附件和引用按钮。引用改以标签显示，可逐个移除；运行中回车排队，排队消息可“立即执行”。
- **按需加载的核对结论**：1.x 的“小初始提示 + 能力卡按需读取”只用于 CLI，已随 CLI 退役。2.0 只做到“按范围裁剪工具”，S04 第 3 步的两半都没有落地：“初始上下文给当前内容/选择的必要信息”和“完整资源与工具细节按需读取”。S04 原有 5 条验收没有覆盖这一步，所以此前登记的 verified 有覆盖缺口。补两条验收：S04-T06（选区内容随任务）、S04-T07（课件工具说明按需）。只读测量（`output/g20/perf/tool-payload-20260924.json`）显示：整份课件可改时，模型每次收到 53 个工具、约 246 KB 的工具说明，其中 `batch` 约 115 KB、`document.insert` 约 63 KB；选中一个课件对象时是 16 个工具、约 19 KB；Markdown 选区时是 6 个工具、约 4 KB。
- **新增验收**：S04-T06、S04-T07、S10-T07（四档权限）、M07-T07（输入框布局）；REL-T06 的预期改为按权限档位检验边界。S04、S10、M07 因新增 not_run 用例改回 in_progress。
- **顺序**：第一批做权限、输入框和选区内容随任务；第二批做会话归属和文件工具（含工作空间外读写，S08-T05“额外写入须明确授权”按权限档位解释）；第三批做课件工具说明按需；最后是剩余验收。会话归属已定两点：点文件时右侧当前会话不动，只筛选列表；文件夹向下包含其中所有文件的会话，文件只显示自己的会话。

## 第一批｜四档权限、输入框重做与选区内容随任务

**实现。**

- **四档权限（S10-T07）**：定义在 `src/shared/workbench/executionPermission.ts`，默认“完全访问（工作空间）”。档位写入提交记录和 run.input，随任务冻结，由主进程执行：
  - 只读：`ExecutionDesktopService` 在准备提交时去掉全部可写范围，模型拿不到修改工具。
  - 修改前询问：每个修改工具调用（含 `batch`、`build.import`）先登记待批准，再发 `approval` 事件，任务显示“等待你批准修改”。批准前不执行。可选允许、本任务都允许、拒绝。拒绝时给模型返回 `user-denied`，文档不变，任务不算部分完成。停止任务时，待批准的修改以 `run-stopped` 结束，不执行。
  - 完全访问（工作空间）：工作空间内不询问；触及工作空间外的已引用文档时先询问，原因标为“目标在工作空间外”。
  - 完全访问：不询问。
  - 批准经 IPC `approve` 请求提交；无效的决定返回 `execution-approval-rejected`。
- **输入框（M07-T07、S10-T05）**：
  - 去掉“发送前的服务与范围说明”弹窗及其确认代码和测试；去掉“允许修改已绑定文档”复选框、“选择范围”和单独的附件、引用按钮。
  - 输入框左侧“+”菜单：添加附件（图片或文档）、引用工作空间文件、引用当前文档、引用当前选区。引用以标签显示，可逐个移除。
  - 底栏一行：左下是权限按钮，显示简称，如“工作空间”；完整名称在菜单和无障碍名称里。右下是模型摘要（服务商 · 模型 · 计费），点它打开模型菜单；位置不够时截断，悬停显示全文。最右是发送。
  - 排队消息可“立即执行（先停止当前任务）”；“修改前询问”时弹出修改请求卡，显示原文和改后的文字。
  - 档位按工作空间保存在本机。
- **选区内容随任务（S04-T06）**：首轮冻结引用的每个选区条目都带上 `content`（最多 4,000 字符的快照）和可写句柄 `writableTarget`。超过上限时标记 `truncated: true` 并附 `nextCursor`，模型可从快照结束处续读。显式续作不带快照，先观察当前文档。写入仍由 Gateway 校验：发送后选区被人改动，基于旧快照的写入会被拒。

**测试中发现并修复的问题。**

1. “+”和权限菜单点不到：输入区可滚动，弹层被裁剪，点击落到上方历史区。改为固定定位，仍紧跟按钮，DOM 顺序不变，键盘可达。
2. 关闭文档后发送被拒，却显示成“未确认执行器是否收到”：Electron contextBridge 只保留 Error 的 message，name 与 stack 在页面侧重建（已用实窗探针确认），所以页面按 `error.name` 判断错误码从来没生效。`g20ComposerConversationsUI` 的这条用例自 09-23 起一直失败。改为主进程与页面共用一张固定文案表 `src/shared/workbench/executionInputMessages.ts`，按文案识别。
3. 窄窗口下，正文的“当前编辑目标”卡盖住右侧提问卡：卡片现在限制在编辑器区域内。
4. 底栏折成两行，模型名被挤成“f…”：改为单行，权限按钮用简称，模型摘要本身作为模型按钮。
5. 路由变化时的拒收文案仍提“范围说明”：改为“模型或服务配置在发送时已变化”。

顺带修复两处过时测试（与本批无关）：`g20ExecutionUI` 仍用旧工具栏按钮名“会话”“文件”；`g20MixedHistory` 仍按旧工具说明“分页列出文档页面”找工具。

**验证。**

- 单测与集成：
  - `tests/unit/g20PermissionComposer.test.tsx` 3/3：修改请求卡与三种决定；“+”菜单四项，没有选区时说明原因并保留草稿；排队消息“立即执行”按原档位以停止并接续发送。
  - `tests/unit/g20ExecutionAssistant.test.tsx` 11/11：没有服务说明；发送时冻结所显示的路由和所选档位；只读在发送时去掉写入；发送后再改档位不影响已发任务。
  - `tests/unit/g20ExecutionInputRefusal.test.ts` 1/1：经过 contextBridge 后只剩 message，仍能识别“目标文档已关闭”的拒收。
  - `tests/integration/g20S10PermissionModes.test.ts` 7/7，覆盖以下场景：
    - 修改前询问的允许、拒绝、本任务都允许，等待批准时停止；
    - 工作空间档对工作空间内外的区别，完全访问不询问；
    - 选区快照随首轮请求，一次修改两轮请求完成；
    - 发送后选区被改动，旧快照写入被拒；
    - 选区超过 4,000 字符时快照截断，用 `nextCursor` 从 4,000 处续读余下 2,000 字；
    - 只读由主进程强制，不提供修改工具。
  - 回归：`g20M09UserQuestion` 7/7、`g20ScopedToolCatalog` 2/2、`g20QuestionCard` 5/5、`g20PayloadStageBudget` 通过。
- 实窗新用例 `tests/e2e/g20S10PermissionComposer.spec.ts` 1/1：本地 SSE 夹具，配合真实 Engine/Gateway。证据在 `output/g20/m04/selection-Bj633y/permission-composer-evidence.json`，截图为 `permission-composer.png`。
  - 布局：“+”在输入框左侧；权限按钮在输入框下方偏左，模型和发送在右，均可点中。没有复选框、“选择范围”和单独的附件按钮。
  - “+”菜单四项均可点中，权限菜单四档，默认勾选“完全访问（工作空间）”。
  - 修改前询问：批准卡显示“原文：先预测😀 / 改为：先猜想😀”。等待期间把档位切到“完全访问”，卡片仍在，请求数和文档都不变；点“允许”后才写入。再一轮点“拒绝”，文档不变，模型收到 `user-denied`。
  - 只读：冻结引用没有写入范围，模型工具里没有 text.replace 和 batch，文档不变。
  - 工作空间档：直接写入，不弹卡片。
  - 每次修改都只用两轮模型请求（allow 2、deny 2、只读 1、工作空间 2），选区内容已随任务送达，模型没有先读取。全程没有出现服务说明。
- 迁移后的实窗用例（去掉服务说明确认，改用“+”菜单、引用标签和“立即执行”）。分两批跑，首轮合计 42/46。失败的 4 条中 3 条是过时测试、1 条是文件被占用，修正或重跑后全部通过；重跑用的是最终构建 `output/g20/b08/build-batch1-permission-20260924.log`（exit 0）：
  - 第一批 16/18。失败的 2 条是过时测试：`g20ExecutionUI` 的旧工具栏按钮名、`g20MixedHistory` 的旧工具说明，修正后 2/2。
  - 第二批 26/28。`g20MixedBuildPartial` 同样是旧工具说明，修正后通过。`g20M02CloseDuringRun` 那次保存时文件被占用（EACCES），重跑通过。
  - 另外重跑 `g20ComposerConversationsUI` 2/2、`g20M09QuestionCard` 1/1、`g20M14NarrowScale` 2/2、`g20S10OrthogonalUI` 1/1、`g20WorkbenchOwnerLayout` 1/1。
  - 第一批跑在底栏改为单行之前的构建上。底栏改动后，受影响的用例（窄窗口、正交、布局、权限）已在新构建上重跑；第二批和最后三条重跑跑在底栏改动之后。最终构建只多了截断选区的 `nextCursor`，由集成用例覆盖。
  - 未重跑 `g20ComposerImeWindows`：它需要驱动本机真实输入法，会抢系统焦点。其中 `@ 引用空间文件` 的改动只是改走“+”菜单。
  - 三个真实模型探针（S05、S14、OAuth 生图）的脚本已同步到新界面，未重新运行。
- `npm run typecheck` 三套 exit 0（`output/g20/b08/typecheck-batch1-20260924.log`）。

**提速 A 真实测量（S04-T06 / S05-T06 路径）。** 同一真实用例 `g20M06RealModelFirstVisible` 在新构建上重跑一次。路由为 TeamoRouter，请求 `deepseek-flash`，实际回显 `deepseek-v4-1-flash-260910`，按量计费。证据在 `output/g20/m06/real-first-visible/run-jiPCvt/`，计时用 `output/g20/perf/analyze-m06-timing.py` 从主进程计时标记读出：

| 轮次 | 之前（09-24 10:45，run-s5fbst） | 之后（本次，run-jiPCvt） |
|---|---|---|
| 冷轮 | 4 次请求：inspect×2、read×2、text.replace；接收到最后回复 19.9 秒（模型 19.6 秒） | 2 次请求：直接 text.replace；6.6 秒（模型 6.5 秒） |
| 热轮 | 4 次请求：read×2、text.replace；161.4 秒（其中一轮供应商等待 110 秒） | 2 次请求：直接 text.replace；15.2 秒（模型 15.0 秒） |

两轮都一次 applied，宿主开销约 0.15 秒。时间受供应商波动影响，只作这一次对照；可以确定的是模型请求从 4 次减为 2 次。

同一次运行的停止轮没有走到“停止生成”这一步。模型先 read，再把一次 text.replace 包在 `batch` 里一次提交，没有使用直接的 text.replace，所以没有正文流式可供停止，脚本在等待首段正文时超时。这是模型选择工具的差异，不是产品回归。停止轮的实窗证据仍以 10:45 那次为准，本地 `g20M06InlineGeneration` M06-T03 在本批也已通过；为免同因重复付费，没有重跑。观察：单项修改被包进 `batch` 会失去边生成边显示，留到第三批整理工具说明时处理。

**登记。** S10-T05、S10-T07、M07-T07、S04-T06 登记 passed。S10、M07 此前只因新增这些用例从 verified 改回 in_progress，现在用例全部通过，恢复 verified。S04 还有 S04-T07（第三批）未跑，保持 in_progress。当前 159 条用例：142 passed、17 not_run；任务 13 verified、15 in_progress。

## 第二批｜会话归属与文件工具权限

**Owner 范围。** 点文件时不切换右侧当前会话，只筛选左下会话列表；文件夹范围包含其下全部文件会话，文件范围只显示该文件会话；只有空的新会话自动取得当前归属，已有内容的会话不改归属。归属随应用内文件夹/文件改名、移动更新；文件删除后会话保留并标注已删除。行内显示所属路径。文件会话发送时默认引用归属文件，但归属本身不授权写入，实际读写仍按四档权限执行。会话归属以本节作为集成行为记录，不新增 acceptance ID，也不借用第一批用例。

**会话归属实窗。** `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20ConversationHomesUI.spec.ts --workers=1` 1/1（Windows Electron，约 1.1 分钟；截图 `output/g20/m04/selection-qDnLUn/conversation-homes.png`）：根会话和文件会话按范围筛选；文件夹显示其下两个文件会话；选中文件或文件夹时右侧当前会话与未发送草稿保持不变；归属于文件的任务默认带该文件引用；应用内改名更新行内路径，删除文件后归属会话仍保留并显示已删除。测试用本地 SSE 模型夹具，未产生付费请求。

**文件树实窗。** `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20WorkspaceFilesTreeWindows.spec.ts --workers=1` 1/1（Windows，约 46.9 秒；截图 `output/g20/m10/run-y8sHHs/tree-actions.png`）：新建、复制、移动、拖放、改名、删除与树身份/选中状态均通过。

**文件工具与归属持久化。** 聚焦 Vitest 命令与结果：`npx vitest run tests/unit/conversationStore.test.ts tests/integration/g20WorkspaceFilesDesktop.test.ts` 7/7；`npx vitest run tests/integration/g20ExecutionDesktop.test.ts` 4/4；`npx vitest run tests/integration/g20AgentFileTools.test.ts` 13/13；`npx vitest run tests/unit/g20WorkspaceFilesTree.test.tsx` 7/7。文件工具覆盖从归属文件列出、在归属位置新建并通过 FileService 打开、归属文件夹不存在时回到工作空间根目录；只读不写；工作空间档不能写外部路径；完全访问可访问外部文件；询问档和工作空间档的外部新建先批准；外部默认新建需单次明确授权；新增用例覆盖工作空间外 list/search 权限与动态 `file.open` 工具族刷新；既有附件权限不会因再次打开同一文件而扩大。会话存储覆盖归属跨改名、移动、删除标记及重开保持。

实现中发现文件变更 watcher 可能先于归属 metadata 持久化，导致列表行短暂保留旧路径。`WorkspaceFilesDesktopService` 在归属持久化后主动再发文件变更事件；针对该竞态运行 `npx vitest run tests/integration/g20WorkspaceFilesDesktop.test.ts` 3/3。此为前述 store/desktop 7/7 中 desktop 部分的修复后复验，合计仍按 7/7 计，不重复累计。

**会话栏回归。** 更新前 `tests/e2e/g20M07SessionRailManagement.spec.ts` 的旧前提与文件范围筛选语义不符，首次运行失败；夹具改为先在全空间创建会话 A，再验证文件范围隐藏 A、右侧仍保持 A，并回根目录继续原生命周期断言。修订后 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20M07SessionRailManagement.spec.ts --workers=1` 1/1（约 1.1 分钟），证据 `output/g20/m07/session-rail-management/run-TeHU2Y/evidence.json`，本地 fixture provider，请求 2 次、文件保留、页面错误 0。首次失败不是代码行为未满足验收的证据，原始记录 `output/g20/m07/session-rail-management/run-275e6s/failure.png` 保留。

**S08-T05 登记说明。** 保留原验收定义与既有 `passed` 状态，保留 B07 中工作区外参考文件快照证据，并追加本节作为 Owner 决定后“额外写入须明确授权”按四档权限解释的文件工具证据。此补充证明上述文件工具路径的权限行为，不把会话归属单独冒充成 S08-T05 验收，也不新增验收 ID。S08 五项验收均为 `passed`，本批补齐其未完成的文件工具权限实现和集成证据后，任务级状态更新为 `verified`。

**收尾验证。** 本轮聚焦 integration/unit 用例均通过（conversation store/desktop 7/7、ExecutionDesktop 4/4、AgentFileTools 13/13、文件树 unit 7/7；WorkspaceFilesDesktop 修复后复验 3/3），三条相关 Windows 实窗均通过。`npm run typecheck` 三套 exit 0，`npm run build:desktop` exit 0。命令结果由本批执行记录报告；除上述 Playwright 截图与 M07 证据 JSON 外，typecheck/build 未提供独立日志文件。该段为第二批收尾快照；S07-T03 随后的剩余验收结果及最新总计见本节之后。

## 剩余验收｜S07-T03 断连补拉

`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20S07ReconnectCatchup.spec.ts --workers=1` 在 Windows Electron 本地 SSE 夹具 1/1 passed，16.5 秒。会话先有两轮完整记录，再开始第三轮流式回复；折叠/展开助手面板及 renderer reload 后，模型 POST 仍为 3 次、run ID 不变，6 条消息顺序正确，事件 item key 唯一，cursor tail 只含后续事件。持久记录在 `output/g20/s07-reconnect/run-Lo16S0/profile/workbench-v2/conversations/conversations-v2.json`。

首次尝试失败来自夹具在保存连接设置后额外 reload，导致页面在后续操作前关闭；移除这个预运行 reload 后通过，未改产品源码。首次失败记录对应 `output/g20/s07-reconnect/run-PfTY7a`。S07-T03 登记 passed，S07 五项验收现均 passed，任务状态更新为 verified。

截至本节，登记共 159 条验收：143 passed、16 not_run、0 failed；任务 15 verified、13 in_progress。

## 第三批｜课件工具说明按需

**工程检查。** 聚焦命令 `npx vitest run tests/integration/g20ScopedToolCatalog.test.ts tests/integration/g20AgentFileTools.test.ts tests/integration/g20ToolGateway.test.ts tests/integration/g20ExecutionEngine.test.ts tests/integration/g20HostToolServices.test.ts` 66/66；另单独复跑 `npx vitest run tests/integration/g20AgentFileTools.test.ts` 13/13，覆盖工作空间外 list/search 权限和动态 `file.open` 工具族刷新。`npm run typecheck` 三套 exit 0，`npm run build:desktop` exit 0。初始 V9 目录工具说明为 8 个、6,594 B；展开内容工具族后为 15 个、89,297 B；`batch` schema 989 B。既有 full-catalog 基线约 246 KB、其中 batch 约 115 KB。数字来自当前工具载荷测量，不能替代真实模型首轮正确率验收。

**相关实窗回归。** 最终构建上 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20S10PermissionComposer.spec.ts --workers=1` 1/1（约 2.2 分钟），证据 `output/g20/m04/selection-axKeUI/permission-composer-evidence.json`。`g20MixedBuildPartial` 首次因夹具直接调用新语义下未披露的 `build.create` 失败；夹具先请求 `tools.load(build)` 并把请求轮数由 9 调为 10 后，`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20MixedBuildPartial.spec.ts --workers=1` 1/1（10.7 秒），证据 `output/g20/s13/mixed-build-partial/run-GByzDG/evidence.json`。它在 compile 后停止，未准入组件没有进入正式课件，且保存、撤销/重做、重开断言通过。首次失败是夹具未遵循新工具发现语义，保留为夹具更新记录。

最终构建上 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20M06InlineGeneration.spec.ts --workers=1` 4/4 passed（约 2.9 分钟）：覆盖正文停止后拒绝迟到工具结果、Flow 正文提交、正文提交与后续人工编辑可分别撤销并保存重开，以及只提供最终参数的模型不被呈现为正文流式生成。此为 deterministic fixture 实窗，不代表真实模型 S04-T07 通过。

**S04-T07 真实模型观察，尚未通过。** 首次 full-legacy 证据为 `output/g20/perf/s04-t07-prepared.json` 与 `output/g20/perf/s04-t07-real-1790250635837.json`。TeamoRouter `deepseek-flash`，实际模型回显 `deepseek-v4-1-flash-260910`，按量，费用 unknown。共 6 次请求，每轮约 247,862 B、53 个工具；模型先调用 `read`、`inspect` 等无关工具，第 6 轮的 `text.replace` applied，标题结果正确，但整体 run 为 partial，首轮工具正确率未达预期。

随后在同一 TeamoRouter / 模型与按量路径执行一次精简目录的真实对照，证据 `output/g20/perf/s04-t07-resume-1790251189450.json`：实际模型回显均为 `deepseek-v4-1-flash-260910`；6 次请求每轮 6,719 B、8 个工具。模型在前两轮调用 `inspect`，随后读回执，直到第 5 轮才请求 `tools.load(content)`；6 轮结束无文档提交，run 为 failed，标题未改。相较 full-legacy，单轮工具载荷缩小约 97.29%，但目标任务完成结果退步。准备时记录的初始精简目录为 8 个工具、6,594 B；展开内容族后为 15 个工具、89,297 B；`batch` schema 989 B。负载缩减不构成正确率或任务成功证据。

因此 S04-T07 继续 `not_run`，不把任一真实运行登记为通过，也不因同一失败路径重复付费重试；对象编辑组未测。后续只有在设置或可证伪假设改变后再运行。未切换到 DeepSeek 官方或其他收费路径。

本批后登记总计仍为 159 条：143 passed、16 not_run、0 failed；任务 15 verified、13 in_progress。S04-T07 状态未变。

## 剩余验收的局部工程证据

以下结果只覆盖各自验收的一部分，因此 acceptance status 保持 `not_run`，任务状态与总计不变。

- **S05-T05 模型能力不足可见**：验收前置条件是工具、视觉、正文增量三类能力中**一项**不支持。`tests/e2e/g20S05CapabilityVisible.spec.ts` Windows Electron 本地 fixture 1/1（20.5 秒）验证 vision unknown：界面明确拒绝本次图片请求，PNG 附件和草稿保留，模型 POST 为 0，Token Plan 的连接、模型与计费设置未变；没有伪造视觉能力、静默切换路由或绕行外部候选。正文增量另有本节已通过的 `g20M06InlineGeneration.spec.ts` final-only 用例证明 UI 将完整工具操作呈现为 operation-level 更新，没有宣称正文流式。按单项能力缺失的原验收合同，这两项证据满足 S05-T05，登记 `passed`。tools unknown 分支未单独覆盖，作为未测分支保留，不扩大成额外门槛。
- **REL-T05 崩溃与磁盘失败**：结合既有通过证据 B07:205、B08:25，交叉核对 `g20M11InterruptedRecovery` 的真实 SIGKILL（无虚假的 provisional restore）、`g20ReleaseCrashRecovery` 2/2（双 dirty 文档、嵌入资源、活动操作的幂等恢复）、`g20DocumentCrash` 替换前后保存、M11 ACK/dirty/asset，以及 M09 磁盘 EIO 可见错误。覆盖草稿、提交、保存阶段的数据恢复、已提交操作不重放与未保存状态准确，REL-T05 登记 `passed`。边界：此结论只针对合同列出的崩溃/磁盘失败阶段，不宣称覆盖所有附件导入阶段。
- **REL-T06 权限与非可信内容**：聚焦安全 crosswalk 串行运行 8 个文件共 31/31；只读零写入、修改前询问和工作空间档的跨根批准、完全访问经正式编辑通道、跨根/跨文档句柄、停止或过期后写入、实时及持久化 HTML 不执行、凭据与敏感日志不泄露均有证据。此前并行运行曾为 29/31；修复陈旧 `g20AttachmentOutsideWorkspace` fixture 后串行 31/31，另该 fixture 单项 1/1。REL-T06 登记 `passed`，范围为验收约定的安全边界集成，不代表整体发布批准。

**S04 选区授权收敛的离线回归。** 修复后 `g20SelectionWithinGrant` 的 Gateway/Engine 聚焦测试 8/8；选区目标在冻结授权范围内时可签发有限 writable target，授权外或只读句柄仍不能扩大权限，过期对象仍拒绝写入。最终构建上 `Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20S10PermissionComposer.spec.ts --workers=1` 1/1；`npm run typecheck` 三套与 `npm run build:desktop` exit 0。该结果补充 S04 选区在已有授权内生效的工程证据，不改变 S04-T07 的真实模型验收结论。

**S04 工具发现性修复。** ToolCatalog/Gateway/Engine 已加入按 scope 呈现的 `tools.load` 描述，`text.replace` 的说明限定为 content-only，避免对象任务被引导到正文工具。聚焦用例 7/7，`npm run typecheck` 三套通过，最终 `npm run build:desktop` exit 0；相应 Windows Electron E2E 正在运行，尚无结果可登记。S04-T07 继续 `not_run`，待 demand-only object retest 与 Astra review。

**M12/REL-T08 package 阶段边界。** 当前软件仍在开发中，Owner 决定暂不进行安装器、portable 或 package 验收工作；本轮 package 探索停止并延期到后续发行准备。此前已经取得的 REL-T08 局部扫描/资源信息按上文保留为观察，不表示当前有进行中的打包任务，也不要求 clean-VM 验收。M12-T01/T04 与 REL-T08 保留原验收合同及 `not_run`，`required_for` 改为 `release-preparation`，不作为当前 2.0 开发完成门；正式发行仍须补验。

**S04-T07 新一轮 paired text 检查点，尚未完成。** `output/g20/perf/s04-t07-pair-text-1790252093056.json` 显示 full-legacy 首个工具直接调用 `text.replace`，目标产物正确且非目标内容保留；第 3 次请求发生 transport failure，run 为 partial，harness 在执行 demand 侧前停止。当前只记为 full-legacy 子结果，不据此通过 S04-T07。独立 demand-only continuation harness 正在准备；没有重跑完整 full-paid 路径。

**paired text 的 demand-only continuation。** `output/g20/perf/s04-t07-pair-demand-resume-1790252455992.json` 为同一实际模型的独立 demand 侧续测：第一轮 `inspect`×2 均有效；单轮 schema 6,719 B，相比 full-legacy 的 247,862 B 减少约 97.29%；目标标题已应用，非目标语义保持。运行 6 次请求后因预算在额外 read 后为 partial；期间有一次 `native-text-too-complex` 中间错误。full-legacy paired 侧也以第 3 次 transport failure partial 收尾；对象编辑分支仍未测。S04-T07 保持 `not_run`，等待对象组验证与 Astra review；不重复已完成的 full paid call。

**paired object 结果，等待裁定。** `output/g20/perf/s04-t07-pair-object-1790252672608.json`：full-legacy 首轮 `inspect` 后调用 `object.update` 并 applied，共 3 次请求完整结束；demand 首轮 `inspect`×2 后才加载 `content,layout`，再调用 `object.update` 并 applied，共 6 次请求后因预算为 partial。两侧对象标题和颜色正确、目标正文及非目标语义保持；首轮调用均有效。工具 schema 分别为 247,862 B 与 6,719 B（约减少 97.29%）。Demand 的首轮响应速度较慢，尽管窄准确性结果通过；两侧完成度也不等价（full 完成，demand partial）。S04-T07 保持 `not_run`，等待 Astra 对产品/性能权衡的裁定，不把对象局部成功外推为整项通过。

**S11-T05 有界子证据。** `g20S11BoundaryConvergence.test.ts` 1/1：人工与 AI 编辑共享同一 DocumentSession/History，可撤销并保存重开；静态 core import 检查未发现 UI/CLI 依赖。S11-T05 仍为 `not_run`，因为合同还要求全部 S 任务有证据，S04-T07 尚未闭合；此处只登记子证据，不宣称整项通过。

## S05-T08 与 REL-T08 登记补充

**S05-T08 可选 OAuth 与 API 独立。** 按 Astra crosswalk，复用 B07 的 TeamoRouter 真实 API 工具任务（无需 OAuth 或 CLI），以及正式 OAuth 登录后 `gpt-6-luna` 工具探针的真实证据（B07:70–72，实际模型为 `gpt-6-luna`、文本工具 supported）。当前产品连接/能力 metadata 由 `output/g20/providers/oauth/login-status.json`、`catalog-status.json` 与第七次 `tool-probe-empty-summary-output.json` 支持。OAuth refresh/logout 只用本地模拟凭据验证，聚焦集成合计 5/5（`g20OAuthDesktop` 为核心 OAuth desktop 流程；不在 Owner 真实账号上刷新或退出）。API 历史计费类型仍为 `unknown`，不据此推断金额或账号类型；OAuth 登录只证明文本工具能力，不推断视觉能力，图像能力另有独立 B07 证据。路由与能力声明保持独立，未静默改变计费路径。S05-T08 登记 `passed`，S05 九项验收现全部通过，任务状态更新为 `verified`。

**REL-T08 分发包局部检查，未通过/未完成。** portable 与 directory 两种构建均 exit 0，运行时资源核对 12/12，当前 compiled files 与源码一致。23 条 broad-rule scan hits 的初步分诊包括第三方 test/dev 文件、二进制里可能出现的构建机路径，以及一个 diagnostic filename false positive；没有一项目前证明实际凭据泄露，但路径类命中若无安全 excerpt 仍无法确认，保持 unresolved。运行时 notice 目前只在源码验证，尚未证明随 package 提供。另有 4 个 built-in 组件许可证未知且 maintainer 未指派；应用元数据为 `UNLICENSED`，分发条款仍未审查。上述发布包与许可核对仍不足以通过 REL-T08，状态保持 `not_run`。这些发现是未完成的 package/release 核对，不证明当前产品用户流程不可用，不提升为当前产品 P0/P1。

## M13-T01 三表面保全实窗证据

`Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; npx playwright test tests/e2e/g20M13ThreeSurfacePreservation.spec.ts --workers=1` Windows Electron 实窗 1/1。课件三表面的文字、媒体与结构操作经正式 DocumentHost IPC；Slide rule 走同一正式通道，Flow/Spatial global rule 在应用 UI 中当前文档活动时执行。每组操作 Undo×5、Redo×5 后通过 UI 保存、关闭并重开，检查资源与状态仍在。与既有 `g20WorkbenchMediaOwner`（各表面的 UI 入口覆盖）及 `g20M03AdvancedAndRun`（Slide interaction 覆盖）合并对照 M13-T01 合同后，登记 `passed`。边界：新 IPC 实窗本身不独立证明每个 planner/control 或视觉效果；Flow/Spatial interaction 是共享 global 能力，不是本地 surface 专属能力。该裁定针对本项 engineering 验收，不代表 Owner 视觉接受。

S05-T05 按其单项能力缺失合同登记 passed。tools unknown 分支仍未单独覆盖，不影响该 case 的本次结论。此后 REL-T05/06、S05-T08 与 M13-T01 按上述 bounded crosswalk 登记 passed；S11-T05 仍 not_run。当前登记快照为 159 条验收，148 passed、11 not_run、0 failed；17 个任务 verified、11 个 in_progress。S04-T07 对象组/Astra review 与 M13 后续结果未闭合前，不做最终刷新与任务板生成。

## 后续裁定｜工具发现与基础设施

**S04-T07 真实模型有界对照。** 继上文完整目录、按需目录的文本与对象对照之后，按相同 TeamoRouter `deepseek-flash` / 实际 `deepseek-v4-1-flash-260910`、按量路径补做对象任务的 demand-only continuation，记录为 `output/g20/perf/s04-t07-object-demand-resume-1790253699318.json`。首轮请求 `tools.load(layout)` 与 `inspect` 均为合法发现，第二轮 `object.update` applied；标题、颜色、非目标正文和非目标语义保持，未错误使用 `text.replace`。本次 4 次请求完成，先前 demand 对象组 6 次请求为 partial，full 对象组 3 次请求完成；按需首轮工具 schema 为 7,175 B，完整目录为 247,862 B。文本组两侧目标产物正确，但运行均为 partial，不能写成等价完成或速度提升。结合工具说明聚焦 7/7、文本及对象真实任务结果，S04-T07 按其有界验收合同登记 `passed`，S04 七项均通过，任务 `verified`；不由此宣称所有任务首轮更快或整体时延更低。

**S11-T05 同源边界。** `g20S11BoundaryConvergence.test.ts` 1/1 证明人工与 AI 使用同一 DocumentSession/History，撤销并保存重开；core import 核对未发现 UI/CLI 依赖。当前构建上的 Windows Electron `g20MixedBuildPartial.spec.ts` 1/1（10.2 秒）、`g20MixedHistory.spec.ts` 1/1（22.9 秒），串行日志为 `output/g20/b08/e2e-after-tool-discovery-final.log`。先前两次失败来自 E2E 夹具用描述文字猜测哈希工具名；夹具改用 canonical 工具名后通过，产品源码未因失败修改。结合 S04-T07 及其余 S 任务已有证据，S11-T05 登记 `passed`、S11 为 `verified`；这证明合同中的同源路径与当前真实混合链，不扩大为全部产品或发行包验收。

**分发范围复核。** M12-T01/T04、REL-T08 仍为 `not_run` 且延期至后续发行准备；当前 M12-T05 的真实连接、M14 的独立用户路径与范围核对、M13 的导出，以及 REL-T05/T06/T11 核心行为继续按各自用例验收。历史包扫描记录不自动通过延期项，也不阻断当前开发候选。

## M03-T01｜首次打开的轻量内容区

当前桌面构建上的 Windows Electron `tests/e2e/g20M03FirstOpenLight.spec.ts` 1/1（14 秒），截图为 `output/g20/m03/first-open-light/run-QAyPAr/first-open.png`。首次打开课件呈现以中央内容为主的默认轻量界面，没有完整属性树；普通文字可直接轻改，正式 DocumentSession/V9 保存一致。root 与 Astra 已目视核对截图与实窗结果，按 M03-T01 原 manual 合同登记工程 `passed`；M03 八项均通过，任务 `verified`。这项工程证据不代替 Owner 对最终体验的接受，也不代替 M14 的独立用户试用。

## M14-T02｜键盘与焦点的有界验收

6 Sol 修正 `ExecutionAssistant` 的权限选择、模型同选与成功切换后的焦点返回，并使 `WorkspaceFilesTree` 的 Enter 重命名排除 `isComposing` 和键码 229。当前桌面构建 Windows Electron `tests/e2e/g20M14KeyboardFocus.spec.ts` 2/2：受控 composition 的两种 Enter 不改名，普通 Enter 可改名；聊天键盘操作不误发或误删，弹层焦点正确。证据为 `output/g20/m04/selection-q62iOo/m14-t02-keyboard-focus.json`、`output/g20/m04/selection-WRlrS8/m14-t02-model-switch-focus.json`；三套 typecheck 与 `build:desktop` 通过，构建记录 `output/g20/m14-keyboard-build.log`。这次文件框输入法事件是受控合成，不冒称原生 IME；中文真实候选、Enter/Space/Shift+Enter 复用 B08 前文的微软拼音实窗证据与 B07 的 trusted composition/粘贴证据，相关 composer 实现未变。第二条模型切换本地 probe 有 1 次 HTTP 请求，付费请求为 0，不能写成全组 0 模型请求。按 Astra 的有界裁定，M14-T02 工程 `passed`；M14 其余当前未运行用例与 Owner 最终接受仍分开。


## 后续开发｜结束文案、请求预算与混合编排

**失败与已应用修改的并列说明。** `executionOutcome.ts` 对只读工具失败且同任务已有正式修改的情况给出谨慎结束文案：说明已应用的内容与仍未完成的工作。`invalid-target` 仍使任务保持 `partial`，没有因为同一文档的 A 部分已修改就把 B 部分的错误改报成功；同文档 A/B 反例及 Engine 聚焦 18/18 通过，Astra 已复核。此项补足用户可见结算的边界，沿用 M09-T03 既有通过状态，不将其扩大为任意模型输出都能正确总结。

**预算耗尽后显式继续。** 请求预算耗尽有稳定错误码，自动队列暂停；界面可由用户手动继续同一任务的剩余工作，沿用已提交事实，不自动重复付费请求。聚焦检查 46/46、三套 typecheck、`build:desktop` 均通过；`g20M12ConnectionRecoveryUI.spec.ts` Windows Electron 1/1，新 `g20BudgetContinuationUI.spec.ts` 实窗 1/1，记录 `output/g20/m04/selection-uoOT1u/budget-continuation-ui-evidence.json`。该受控本地 SSE 场景请求为先 24 次、继续后 1 次，首段达到预算上限，后段沿 `retryOfRunId` 继续并完成；两段 run ID 不同，属于同一任务续跑链。首轮旧夹具失败经修正后复验通过，不作为产品成功或真实模型证据。S05-T09/M09-T03 状态和原验收范围不变。

**REL-T11 受控完整编排。** `output/g20/rel-t11/fixture-ZQUqTr/evidence.json` 对应本地夹具实窗 1/1：同一 run 完成材料读取、创建多页课件、直接修改、生成与插入图片、受控构建故障后的修复、正式导入、保存重开和离线 HTML 互动；付费请求为 0。它证明当前构建中的编排路径可跑通，不证明低成本 API 与高能力对照的真实模型产出、首轮正确性或费用；REL-T11 继续 `not_run`。

**测试时间边界。** Owner 取消真实 REL harness 的全任务 20 分钟总 test 墙钟及 13 分钟 poll 墙钟限制，产品 2.0 不设置全任务 20 分钟上限。动态准入的单候选 20 分钟限制与单请求保护仍保留。这里记录测试口径调整，不把未执行的真实 REL-T11 试验记为通过。

## REL-T11｜首轮授权真实混合任务

一次已授权的真实路径使用 TeamoRouter `deepseek-v4-flash` 按量文本连接及 GPT OAuth `gpt-image-2` 订阅图片连接；没有走 DeepSeek 官方 API，也没有自动续费或自动重试。恢复证据为 `output/g20/rel-t11/real-4ul0ka/recovered-evidence.json`。同一内置 Engine run 共发 4 次文本请求：前三次 `completed`，实际模型均回显 `deepseek-v4-flash-ga-260731`；第四次 HTTP 200 后以 `protocol unsupported-tool-type` 收束，结果未知，回显 `deepseek-v4-flash-0731`。`file.create` 已成功，但图片请求 0、正文/对象编辑 0、受控构建 0，任务终态为 `partial`；终态耗时 62,583 ms，实际费用 `unknown`。不能把文件创建当成课件完整交付，更不能把本次真实混合任务记为通过，REL-T11 继续 `not_run`。

本次没有持久化原始 Provider 响应片段，无法断言具体不支持的 type，也无法确定第四次模型 ID 回显不同的原因。Astra 后续定位到独立的 nullable delta 兼容缺口；该兼容修复经过局部测试，但修复后的第二次 `deepseek-v4-flash` 真实试验仍报同类 `unsupported-tool-type`，因此停止同路由重复付费。此后按实时目录纠正到 V4.1 的运行见下一小节；空协议诊断不能证明 Provider 问题已彻底解决。旧 harness 在 `partial` 后等待不存在的互动按钮，随后 Ctrl+C 导致 `finally` 未执行；局部等待已修正，但此样本隔离 Electron/profile 的复合停止与清理命令在 CreateProcess 阶段被自动策略以 `Rejected(... blocked by policy)` 拒绝，命令没有执行，也没有改用绕过手段。临时 profile 与进程目前仍保留，不能宣称已清理。

### V4.1 型号纠正后的真实续测

此前两次实际选用的 `deepseek-v4-flash` 均回显 2026-07-31 型号（一次 `unsupported-tool-type`）；第二次在 nullable tool-call delta 修复后仍触发同类错误，因此停止同路由重复付费。根据实时目录把文本型号纠正为首选 `deepseek-flash` 后，实际模型回显 `deepseek-v4-1-flash-260910`。证据：`output/g20/rel-t11/real-3MoHnJ/evidence.json`。这次 24/24 文本请求均完成，共 32 次工具调用，历时 288,714 ms，最终因请求预算到顶为 `partial`；账单类型按连接声明为 TeamoRouter 按量、GPT OAuth `gpt-image-2` 订阅，实际费用仍未知。协议诊断列表为空，但这不能证明 Provider 协议问题已彻底修复。

已观察到两个位置保存并重开后均 clean；图片生成 ready 且有 1 个资源；两次 `batch` 修改均 applied；离线 HTML 导出打开后 0 个 pageerror。任务仍未完成：图片未插入课件；仅发生 1 次故意的构建编译失败，之后没有修复；没有 check、import、Runtime 或互动验收。运行以预算 partial 结束，不能将上述局部产物/行为视为 REL-T11 通过，也不改任何既有 passed 状态；REL-T11 保持 `not_run`。

### 无费续跑与局部修复证据

后续只做本地无费聚焦验证，Engine 事实摘要仍保留原 run 的 `image ready` 与 build compile error。沿同会话祖先动态 `file.create/open` 取得事实后，以当前权限重开，再由新 run 使用图像短句柄完成 `media.insert applied`，聚焦用例 2/2；整个链路 `image.generate` 只调用 1 次。`ImageGenerationService`/Gateway 聚焦检查 2/2。产品 `hostContinuationImages` 结构化重签 provenance 聚焦用例无费 2/2。

构建续接边界已按 Astra review 收敛：旧 build job 不跨 run 续用；新 run 从当前基线新建 scratch，并重新 compile、check、import。本轮未完成旧源码自动带入；验收不得把旧 job 失败与新 job 成功拼接为修复证据。

Harness 最新聚焦验证通过：REL evidence + recovery 11/11；同一 run/job/path 选取完整 failed → fixed → ready/import 链，并通过双 job 反例；E2E typecheck passed。Harness 局部更新加入私有受限 profile、显式的一次性付费 gate 与全分页 usage 读取；无费测试 3/3。当前稳定源码下 `npm run typecheck`、`npm run build:desktop` 均通过；`g20BudgetContinuationUI` 实窗 1/1。本次 V4.1 实测的隔离 profile 已删除，`real-3MoHnJ` 原 run 不可继续；早先 0731 样本的遗留 profile/进程仍按前文记录保留。本轮未发新付费请求。这些 harness 与局部工程证据不补成原 run 的保存状态，也不构成 REL-T11 通过，仍保持 `not_run`。

### V4.1 新样本｜一次显式预算续跑

新授权真实样本记录在 `output/g20/rel-t11/real-Q68IPQ/evidence.json`；续跑记录为 `output/g20/rel-t11/real-Q68IPQ/continuation-evidence-1790263899243.json`。首 run 使用 TeamoRouter `deepseek-flash`（文本按量）与 GPT OAuth `gpt-image-2`（订阅），实际文本型号均为 `deepseek-v4-1-flash-260910`：24 次请求、36 次工具调用，因 24 次请求预算耗尽以 `partial` 结束。图片生成状态为 ready、1 个资源；`media.insert` 已 applied。两页课件均保存并重开为 clean。首 run 后通过手动 UI 导出 HTML；离线打开观察到 0 个 `pageerror`，没有运行时互动断言。

随后执行了唯一一次显式付费续跑，继续原冻结任务：续跑本身 24 次请求、38 次工具调用，仍因 24 次预算耗尽而失败；两段累计 48 次请求、74 次工具调用。实际文本型号仍为 `deepseek-v4-1-flash-260910`。续跑期间 `build.compile` 调用 1 次，结果为故意构造错误下的 `Unexpected token ';'`；错误没有修复，也没有完成 check、import、Runtime 或互动验证。手动 UI 导出与模型 run 分开记录，导出打开后 0 个 `pageerror` 不能替代互动验收。协议诊断列表为空；这只表示证据没有诊断项，不据此推断其他工具错误的共同根因或 Provider 协议已修复。费用为 `unknown`。

本次显式续跑额度已用完；隔离的私有 profile 已清理。早期 0731 样本遗留 profile/进程仍按前文记录保留，本次没有处理。上述样本仍为未完成的真实模型部分结果，不构成 REL-T11 通过，也不改变任何既有 passed 状态；REL-T11 保持 `not_run`。

### Provider 配额 429 分类补充

三个 Provider 共用有界 HTTP 错误分类：`insufficient_quota` 与 `billing_hard_limit_reached` 归为 `quota`；按分钟窗口的限速响应仍归为 `rate-limit`。`tests/unit/g20ProviderHttpFailure.test.ts` 聚焦检查 32/32，三套 typecheck 与 `npm run build:desktop` 通过。Windows Electron `g20M12ConnectionRecoveryUI` 本地 HTTP 1/1，五轮覆盖 401、402、quota 429、rate 429 与断连，证据为 `output/g20/m04/selection-I8XXih/m12-t02-ui-evidence.json`；测试未发付费请求。该记录仅描述分类实现与本地恢复路径证据，不据此登记 M12-T05 通过。

## 2026-09-25 跟进｜请求预算、首次试用与模型选择

**请求循环保护。** Owner 决定取消执行任务的固定请求/工具次数预算。当前默认 `maxRequests` 与 `maxToolCalls` 均为 `null`；显式设置正整数的调用方仍可使用单次上限。执行器加入最近 8 个已完成工具轮次的无进展检测：忽略新生成的只读句柄和 `unchanged` 操作 ID 等不代表任务进展的差异，识别相同或交替重复的轮次后以 `execution-no-progress` 收束。它是重复循环保护，不是费用上限，也不能证明任意变化输出都没有循环；费用仍须通过所选连接自身控制。无费本地 Engine/UI 检查、三套 typecheck、`build:desktop` 与 Windows Electron 证据已完成。**独立的无费本地预算/循环 harness 检查运行 26 个请求、125 次工具调用；这是本地测试，不是 M14 试用，也不是付费模型请求。**此前 REL-T11 的两个 24 次上限样本（累计 48 次请求、74 次工具调用）是旧实现下的历史结果，不因默认值改变而重放或改记成功；预算/循环 harness 本身没有发起付费请求。

**首次打开弹窗与空会话错误。** 空会话图片列表请求曾把空 `conversationId` 传入主进程 schema，产生 recoverable Zod 错误；短生命周期启动还断开 stderr 管道，使 `console.error` 的 EPIPE 在主进程显示错误弹窗。调用方现要求存在且匹配的会话身份后才读图片列表；主进程 broken-pipe 诊断改为尽力写入私有诊断日志，不再向断开的 stderr 写错误。针对性检查 8/8、三套 typecheck、桌面构建和 `g20M03FirstOpenLight` 实窗 1/1 通过。个人试用记录在 `output/g20/m14-personal-trial-20260924/observations.md`。这份证据定位并消除了该弹窗的触发链，不把任意主进程错误都归为 EPIPE。

**模型配置与发现体验。** 常用路径调整为先配置 API 连接或登录 ChatGPT OAuth，然后在输入框选择当前模型与连接声明支持的推理强度；目录从连接读取并按连接修订号缓存，API 连接不会被伪造推理强度选项。OAuth 登录可从模型选择入口直接进入。图像连接在需要图像能力时单独选择；视觉默认跟随当前文本选择，除非用户显式配置独立视觉角色。底层仍保留冻结任务所需的角色与实际路由记录，选择器不在失败时静默切换供应商、模型或计费方式。聚焦检查合计 53/53、三套 typecheck、`build:desktop` 通过；本地实窗确认模型菜单可直接进入 OAuth 登录设置。源码开发启动增加显式 `npm run start:engineering`，将应用指向已存在的 `Guoling-2.0-engineering-oauth` profile；普通默认 profile 与工程 OAuth profile 是两个目录，旧启动方式不会自动读取另一目录，因此干净/隔离 profile 显示未配置并不表示原凭据被清除。该工程 profile 随后用于本节记录的两次真实 GPT OAuth Luna 试用。随后整合工作空间切换器、模型选择布局和临时文件过滤修正后，相关聚焦检查 21/21、三套 typecheck 和 `build:desktop` 均通过。新构建实窗确认长历史列表下“选择其他工作空间文件夹…”和“新建工作空间”操作均可见，切换器截图为 `output/g20/m14-engineering-trial-20260925/switcher-final-fixed.png`；模型选择器截图 `output/g20/m14-engineering-trial-20260925/model-picker-final-fixed.png` 显示当前 Luna、Sol/Astra 中文用途说明、连接声明的推理强度及 OAuth/设置入口。当前 OAuth 目录缓存未记录可选推理强度，因此界面只显示“默认”；一次只读元数据读取尝试未取得原始字段，暂不能区分供应商省略与字段形状未解析，不能补造未确认的选项。文件树在新构建重启后未再显示 UUID 原子写入临时文件行。

**2026-09-25 最终构建模型配置实窗复核。** root 在最终 `build:desktop` 后实际桌面窗口核对 `output/g20/model-config-trial-20260925/run-vG03sV/evidence.json`：模型点选为 `gpt-6-luna` / OpenAI OAuth / 订阅，能力探测未启用，登录入口可见且保存 profile 未变。`optional-image-service-collapsed.png` 显示图片服务默认折叠，摘要标明可选或已配置，不再占用普通 API 接入页；高级四角色配置仍默认折叠。选中 OAuth Luna 后，未保存的能力验证按钮处于禁用状态。该次 12/12 UI 单测、最终 `build:desktop` 与实窗点验通过，另见 `composer-model-picker.png`、`advanced-model-selection.png`。这是配置 UI 证据，不代表 OAuth 附件真实任务验收通过或模型能力验证完成。

**恢复稿稍后处理。** recovery-defer 聚焦检查 3/3 通过；在真实工程 profile 桌面窗口点击“稍后处理”后，两个恢复稿收起为左下角“恢复稿（2）”入口，草稿仍保留。该操作已在最终整合构建重启后复核。

**M14-T01 Owner 指定 root 亲自试用（工程 passed）。** 2026-09-25 在已配置 `Guoling-2.0-engineering-oauth` 工程 profile 与独立副本工作空间中，使用 GPT OAuth `gpt-6-luna` 完成截图理解和课件选区编辑。将课件截图粘贴进输入框并发送只读问题后，模型描述了左侧资源/会话列表、中间课件编辑区和右侧新会话面板，并明确指出截图不能确认重叠文字、其他页面内容与运行状态；任务没有写文件。随后选中 Flow 标题“讲义标题”，通过“引用当前选区”随任务发送，要求只替换标题；主界面显示“修改已应用”，标题变为“分数的认识”，正文和其他页面保持不变。保存后关闭并从工作空间重新打开课件，标题与正文仍正确。

同一试用中创建“整理后”文件夹，把课件拖入后，会话归属随文件移动并按新位置筛选；最终构建复核后，课件仍从 `整理后/分数课件.h5lesson` 重开，标题“分数的认识”保持正确。Markdown 编辑自动保存；外部改名后，应用保留打开稿并提供“另存当前稿”，保存为 `备课笔记-恢复.md` 后，恢复稿保留本地内容、外部改名文件保留外部标记，两份内容互不覆盖。截图 `output/g20/m14-engineering-trial-20260925/paste-ready.png`、`recovered-markdown.png`、`switcher-final-fixed.png` 与 `model-picker-final-fixed.png`，步骤记录见同目录 `observations.md`。试用发现的长历史切换器遮挡固定操作和 UUID 临时文件行均已修正；新构建实窗确认固定操作可见且重启后文件树不显示临时文件。**按 Owner 指定试用者口径，M14-T01 登记工程 `passed`。本轮没有取得未参与实现者独立试用证据，不代表 Owner 最终接受；M14 更宽旅程和整体收口仍由其他用例单列。**

**剩余真实路径边界。** REL-T11 仍为 `not_run`：两个旧请求预算样本及已有无费续接不能拼接成新的完整真实任务；后续新样本另列。M12-T05 需要的 DeepSeek 官方路由不在本轮授权范围内，保持未验收；不能由本地 HTTP 错误分类或 API 供应商目录证据替代。本记录不调整验收注册表或任务状态。

### 2026-09-25 最终构建与新样本

**推理强度点选。** 对当前 OAuth 模型目录缓存未记录强度的精确 `gpt-6-luna`、`gpt-6-sol`、`gpt-6-astra`，模型选择器提供有来源标注的官方模型档位作为后备，同时保留“默认”；实时目录若声明强度（包括明确空数组）则优先，未知模型没有推测选项。当前账号链路尚未对各强度实际发请求验证，界面写明“官方模型选项，当前连接未验证”；显式选择会原样发送，不自动降档或换路由/计费。修复 `max` 在类型、目录解析、存储与 OAuth Responses 发送白名单中的遗漏，七档目录解析/保存/重读聚焦 3/3。模型档位依据 OpenAI 官方 Luna、Sol、Astra 模型文档；[App Server 文档](https://learn.chatgpt.com/docs/app-server)说明账号和客户端可用项应以实时返回为准。最终桌面构建后真实界面 `output/g20/m14-engineering-trial-20260925/model-picker-efforts-final.png` 可见“默认/关闭/低/中/高/极高/最高”和连接提示；root 点选“高”后 `aria-pressed=true`，又恢复“默认”，未发起模型请求。

**REL-T11 新样本。** 取消默认 24 次上限后先用无费 scripted provider 重现旧边界：第 24 轮返回失败编译回执，第 25 轮能读到错误并在同一 job 修复、check/import；共 28 次模拟请求，聚焦 1/1。随后仅启动一次新的完整真实任务，证据 `output/g20/rel-t11/real-ZvgM9u/evidence.json`：TeamoRouter `deepseek-flash`（实际 `deepseek-v4-1-flash-260910`，按量声明）加 GPT OAuth `gpt-image-2`（订阅声明），11 次文本请求、17 次工具、约 78 秒，实际费用 unknown。图片 ready、有 1 个资源；课件两处位置保存重开 clean；`slide.create` applied。第 11 次文本请求在 dispatch 后约 7.4 秒以 `transport`/unknown partial 结束，没有 HTTP 状态或首个事件证据；图片尚未插入、构建编译 0 次、互动未完成，UI 手动导出不能替代模型完成。此失败不是 24 次预算，亦没有证明模型在编译错误后会修复。REL-T11 保持 `not_run`，保留同任务 `resume.json`，在原因未查清前不因同因再次付费续跑。

**传输诊断与收尾。** 新的私有诊断仅记录失败阶段、固定异常类别/代码和 HTTP 响应是否到达，不记录请求正文、凭据、URL、异常正文或堆栈；本地 fetch 前/读流失败聚焦 2/2，6Astra 窄审无阻断。该修正不能反推上述已发生的 `transport` 根因。最终相关六文件 Vitest 60/60、三套 typecheck 和 `npm run build:desktop` 通过；七档持久化追加聚焦 3/3，最终构建再次通过。验收登记保持 159 项 153 passed/6 not_run，其中当前 2.0 为 156 项 153 passed/3 not_run（M12-T05、M14-T05、REL-T11），另外三项只属后续发行准备。M14-T01 已按 Owner 指定亲自试用口径工程 passed；M14 整体仍 in_progress。未调用 DeepSeek 官方 API，未建安装包/portable，未提交、推送或发布。

### 2026-09-25 续查：真实连接与传输失败

**REL-T11 失败边界复核。** 原始 run 第 10、11 次文本请求体分别为 91,752 与 95,371 B；`image.generate` 回执只有资源短句柄与元数据，没有图像字节/base64。Engine 在 dispatch 前已经完成请求序列化。第 11 次在约 7.4 秒后、收到 HTTP 响应头或首个模型事件前收束；`cancellationRequested=false`，窗口在 partial 后仍完成保存、重开和导出，故不能把本次失败归于用户取消或测试退出。旧样本没有原始异常类别；现有证据既不能确认供应商体量阈值，也不能区分本机网络、代理或上游断连。新的私有诊断只能用于未来同类事件，不能反推这一次。未续跑付费任务，REL-T11 仍 `not_run`。

**M12-T05 的 OAuth 正文增量与停止。** root 在已有工程 OAuth profile 和独立副本 Markdown `OAuth流式取消验收.md` 上亲自执行一次 GPT OAuth `gpt-6-luna` 订阅任务，冻结的选区为原文 0–20，权限为工作空间。证据 `output/g20/m12-oauth-stop-20260925/evidence.json`：实际模型回显 `gpt-6-luna`，恰好 1 次文本请求、0 个已完成工具；`edit.changed` 出现 2 字非空片段，编辑预览在视口内形成非空内容，随即由界面“停止”按钮中断；run=`stopped`，请求以 `chatgpt-aborted`/unknown 结束，没有自动重试。停止后等待迟到窗口，正式文档 revision=0、Undo 深度=0、原文未变；关闭重开仍是原文。截图为同目录 `stopped.png`。这一轮证明此账号/模型的正文增量到达前端及停止后零正式写入；探针记录 DOM 预览与视口几何，未保留停前屏幕帧，不能据此精确证明浏览器已绘出完整片段。它不证明断连后的真实恢复，也不替代 TeamoRouter、DeepSeek 官方与外部 MCP 的各自证据；M12-T05 仍 `not_run`。没有调用 DeepSeek 官方 API。

**Owner 对官方 API 的授权纠正。** 2026-09-25 Owner 明确说明 DeepSeek 官方 API 可以用于本轮补验；上文“本轮不发官方 API”的交接限制不再适用。已发生的 OAuth 试用仍只有 OAuth 一条真实路由，后续官方补验须单独记录实际模型、按量计费与请求数，不与 TeamoRouter 样本混写。

**编辑目标遮挡修复。** root 在上述 OAuth 实窗试用发现，编辑器的“已保留目标”浮卡越过编辑区，遮住 AI 输入区发送按钮。`SharedDocumentEditor` 现在把展开与保留浮卡都限制在编辑器与其滚动祖先的可见交集，随滚动和尺寸变化重算。聚焦单测 5/5、三套 typecheck、桌面构建、无费 Electron `g20SelectionContextUI` 1/1 通过；root 在 1427 与 900 像素宽的重启后工程实窗确认浮卡位于编辑区内，900 像素宽时发送按钮中心命中 `BUTTON`。截图 `output/g20/m12-oauth-stop-20260925/retained-fixed.png`、`expanded-narrow-fixed.png`、`retained-narrow-fixed.png`。6Astra 窄审无阻断。该结果只覆盖此处可见遮挡，不代替 M14-T05 的全范围核对。

**M12-T05 的 DeepSeek 官方正文增量与停止。** root 新建按量 `https://api.deepseek.com/v1` 连接，在产品里读取目录得到 `deepseek-flash` 和 `deepseek-v4-pro`，通过输入框模型搜索点选 `DeepSeek-V4.1-Flash`；发送前输入框显示 `deepseek · deepseek-flash · 按量付费`。独立 Markdown 与新会话引用当前选区，发送一条只修改选区的改写任务，证据 `output/g20/m12-oauth-stop-20260925/official-evidence.json`：冻结 provider=`deepseek`、protocol=`openai-chat`、实际模型 `deepseek-flash`，1 次按量请求、0 个已完成工具。`edit.changed` 首次非空为 1 字；预览元素在视口内出现非空内容后由 UI 点击“停止”，约 4 ms 后记录 `edit.aborted`，run=`stopped`、失败类别 `aborted`。正式文档 revision=0、Undo 深度=0，关闭重开仍为原文；截图 `official-stopped.png`。这证明该官方连接的正文增量到达前端、停止后没有正式写入；没有证明真实断连恢复或完整工具链，M12-T05 保持 `not_run`。此前 TeamoRouter 样本继续按其自身连接记录。

### 2026-09-25 DeepSeek 官方完整混合任务

新增显式 `G20_REL_TEXT_ROUTE=deepseek-official` 路线，只在新的独立 REL-T11 试验中使用 `DEEPSEEK_API_KEY`、`https://api.deepseek.com/v1`、目录中的 `deepseek-flash` 按量文本连接；GPT OAuth `gpt-image-2` 仍为订阅图片连接。默认 TeamoRouter 路线不变，旧 TeamoRouter resume manifest 不允许切到官方路由。发送前的目录、凭据、OAuth 有效性、冻结路由与计费断言均通过；三套 typecheck 和 Playwright 用例发现检查无费通过，随后以 `G20_REL_REAL_API=1` 且 retries=0 只启动一次新的真实任务。

证据 `output/g20/rel-t11/real-Hw2tDU/evidence.json`：同一 run 约 13.8 分钟，42 次官方文本请求、61 次工具调用，实际文本模型 `deepseek-flash`，费用仍为 unknown。前 41 次文本请求 completed，第 42 次在已收到 HTTP 200 后以 `transport`/unknown 结束，run=`partial`，没有自动重试或人工续费。真实图片生成 ready、资源数 1；旧采集器只按 `media.insert` 回执给出 `mediaLinked=false`，但解包保存的 `.h5lesson` 可见第二场景正式图片节点引用一份内嵌的 1536×1024 PNG，故课件确有图片插入。由于旧样本的完整 run 记录已随私有 profile 清理，现有摘要不能把该 PNG 的字节与此次生成资源强关联，`mediaLinked` 也不能反改为通过。指定课件的 `slide.create`、导航与两次 batch 已提交，保存重开 clean，达到两处位置。Runtime 候选第一次 `build.compile` 因 `Unexpected token ';'` 失败，第二次编译修复了这处错误；之后又写入源码，尚无 `build.check` ready 或 `build.import` applied，正式课件 Runtime 数为 0。手动 UI 导出后的 HTML 打开无页面错误，但没有互动验证，不能代替 Agent 完成任务。首轮还多创建 3 份草稿课件，计入效率与正确性问题。`firstPass=false`、完整修复未证实、人工介入为 UI 导出，REL-T11 继续 `not_run`。

第 42 次失败不同于先前 TeamoRouter 样本的响应头前失败：本次已经收到 HTTP 200，但当前留存的回执只给 `transport`，不能从中断定网络断流、响应解析还是其他读流问题。此次实测 harness 把“官方连接不允许付费 resume”和“终态后清理私有 profile”绑在一起，致使新私有传输诊断随 profile 删除，无法补造原始异常类别。先修诊断留存和无费故障夹具，不因同一未知原因再次发起付费重跑；M12-T05 的真实断连恢复与 REL-T11 完整成功仍缺证据。

**无费取证修复。** 后续实测 harness 已将“允许付费续跑”和“失败证据留存”分离：官方新任务 partial/failed/interrupted 或结果未知时保留用户私有 ACL profile，但不生成可续跑的虚假承诺；已有一次性续跑若在发送前失败，保留原 profile 与 manifest，真正发起续跑后才消费 manifest。清理前仅导出传输阶段、固定异常类别/码、是否收到响应和 HTTP 状态，并区分诊断不存在与读取失败，不复制正文、密钥、URL、原始异常或堆栈。重开课件后的采集器现可识别 batch 内插图操作，并用生成资源与正式图片素材的 SHA-256 核对强关联；旧样本缺完整 run，不能追认。无费聚焦 13/13、三套 typecheck 通过；6Astra 对私有留存、路径校验与白名单窄审无阻断。未重跑付费请求，也不能以新取证能力反推已删除的官方样本日志。

### 2026-09-25 M12-T05 真实连接恢复续作尝试

**三路无费预检。** `output/g20/m12-real-recovery/teamorouter-wA4O5R/evidence.json`、`official-bJiiIg/evidence.json`、`oauth-pAvSND/evidence.json` 均记录 `zero-paid-preflight` 通过。三路故障注入均在 provider native fetch 前触发（`firstRequestNativeFetch=false`），只证明选择的路由进入了本地 Engine 故障与输入保留路径，不算真实供应商请求或恢复。OAuth 另有 `oauth-pAvSND/oauth-preflight.json`：会话 ready、未过期、账号匹配且来源隔离；这也不是模型请求。各路 before-paid 快照分别保存在同名目录中。

**DeepSeek 官方按量续作尝试一｜夹具误拦。** `output/g20/m12-real-recovery/official-X6tLis/failure.json` 与 `before-paid-continuation.json` 记录冻结的官方 `deepseek-flash` 连接。第一次真实续作请求已完成并调用只读 `read`/`inspect`；紧接的第二个 POST 被预检故障夹具误拦（夹具的允许标记在第二请求时仍为关闭），run 失败。实际费用未知，不能算恢复完成。

**DeepSeek 官方按量续作尝试二｜请求完成但任务仍 partial。** 修正夹具后，`output/g20/m12-real-recovery/official-LSACZ3/failure.json` 与 `before-paid-continuation.json` 记录同一官方连接的续作请求 9/9 completed、工具调用 10 次，但最终 run=`partial`。附件正文已经进入用户消息，模型仍误判附件内容；`file.list` 的观察门阻断了继续路径，`file.open` 对 `.txt` 的请求超出当前工具合同，另有其他句柄错误。按量实际费用未知。该轮没有完成课程任务，也没有证明修复后恢复成功。

以上仅能说明官方路线的一次实际续作有 9 个成功请求，不能把工具链和局部任务成功拼成 `completed`。之后发生的真实续作与无费修复见下节；本记录不据局部成功把 M12-T05 登记为通过。

### 2026-09-25 M12-T05 后续真实续作与无费修复

**TeamoRouter 真续作通过。** `output/g20/m12-real-recovery/teamorouter-8jqFl1/evidence.json` 记录先前一次传输结果未知后，对同一冻结连接执行一次续作：第二 run=`completed`，4 次请求实际模型均为 `deepseek-v4-1-flash-260910`，返回 5 个工具结果（`read` 两次、`listChildren`、`file.list`、`file.open`）。模型正确引用随消息附带材料中的“蓝卡”正文，且 `documentUnchanged=true`，没有文件写入。该样本证明此路由该任务的续作与只读工具链完成；不能外推到视觉/生图或所有声明能力，实际费用字段为 `unknown`。

**DeepSeek 官方续作仍 partial。** `output/g20/m12-real-recovery/official-w9qZLL/failure.json` 记录续作共 9/9 请求 completed，最终答案正确引用“蓝卡”材料，但 run=`partial`。`inspect` 返回指向同一文档的新签 root 后，模型已完整 `read` 新 root；随后 Engine 仍错误拒绝 `file.open`，因为旧实现只认原句柄。越界 `list/search` 被正确拒绝。产品侧观察门现已有无费修复证据，但这次真实样本没有重跑验证修复效果。实际费用 `unknown`，不因同因再发付费续作。

**GPT OAuth 续作语义验收失败。** `output/g20/m12-real-recovery/oauth-LNtNBL/failure.json` 记录续作 run=`completed`、3/3 请求 completed；消息 payload 实际含附件正文，模型回答却称材料正文没有显示，故内容验收失败而非任务结果正确。订阅声明，实际费用字段 `unknown`。没有同因付费重跑。

**后续无费产品修复与检查。** 观察门聚焦 11/11；PayloadCompiler 文本附件来源标记双协议聚焦 4/4；执行设置高级区现支持四角色从模型目录点选，并修正旧能力误标。UI 单测 12/12、root `build` 与 `typecheck` 通过，`g20ExecutionUI` Electron 用例 1/1。上述修复尚未用新的真实续作证明官方与 OAuth 恢复内容正确。无费聚焦既有 13/13 仍为原证据，不登记 14/14；未因同一原因重跑已部分完成或内容错误的收费样本。M12-T05、REL-T11、M14-T05 状态均不因本记录改变。

### 2026-09-25 M12-T05 修复后官方 DeepSeek 续作补充

`output/g20/m12-real-recovery/official-sUjx3R/evidence.json` 记录同一冻结官方 DeepSeek 连接（请求模型 `deepseek-flash`、按量计费）的修复后续作。首轮故障注入未向供应商转发请求（`faulted=1`、`forwarded=0`）；随后显式从同一原始 run 续作，第二阶段 `completed`，实际发送 2 次 `deepseek-flash` 请求。续作只读调用 `read` 两次，正确使用附件《参考材料.md》的独有正文“观察之后再解释，解释时在蓝卡记录证据”，并明确文档 `unchanged`，没有文件写入。`actualCharge=unknown`。

这是官方路线在该任务上的一次修复后真实恢复成功证据；不能外推为 M12-T05 整体通过。TeamoRouter、官方 API、GPT OAuth 的完整声明能力矩阵，以及视觉/图像、取消和其他未覆盖边界仍须按现有证据分别判断；不改 `acceptance_cases.json` 或 `task_registry.json` 状态。

### 2026-09-25 M12-T05 OAuth 续作的按量边界

附件正文来源标记修复后，按同一“显式继续、同一冻结 OAuth 连接、无自动重试”的新假设只执行一次 GPT OAuth 续作。证据 `output/g20/m12-real-recovery/oauth-3pu0Jl/failure.json`：首轮故障注入 `faulted=1`、`forwarded=0`，未向供应商发送；点击继续后向 ChatGPT OAuth 转发 1 次请求，但供应商返回 HTTP 429，续作终态 `failed`，没有取得模型正文或附件语义结果。账号/计费仍为订阅声明，实际费用 `unknown`；没有切换 DeepSeek、没有自动重试，工作空间与附件均未写入。该轮只证明恢复请求到达 OAuth 连接并如实暴露额度/限流失败，不能补成 OAuth 内容、流式或取消能力通过；不因 429 再重复收费请求，`M12-T05` 保持 `not_run`。

### 2026-09-25 第三批按需工具聚焦复跑

第三批按需工具实现的两项聚焦集成测试复跑为 **33/33**。首次运行的唯一失败发生在 Windows 临时目录清理：`ExecutionEventStore` 最后一段事件写入与测试 teardown 同时结束，触发 `ENOTEMPTY`，工具目录断言本身均通过。测试清理加入限定临时目录的有限重试后复跑通过；`npm run typecheck` 三套通过。只读测量仍为 Markdown 4,006 B、课件初始目录 6,624 B，展开内容工具族后 89,327 B，`batch` 989 B、`document.insert` 63,467 B；`document.insert` 仍只在可插入的工具族展开后提供。

**2026-09-25 修复后官方 DeepSeek 实测续作：** `output/g20/m12-real-recovery/official-ECixWe/evidence.json` 记录首轮故障注入 `faulted=1`、`forwarded=0`；显式继续后沿同一官方连接执行 `deepseek-flash`，共 2 次请求、2 次 `read`，run=`completed`。模型正确引用当前选区与附件《参考材料.md》的独有正文，文档保持 `unchanged`，`actualCharge=unknown`。该证据只补齐官方 DeepSeek 的恢复成功边界，不将 M12-T05 整体改为 `passed`；TeamoRouter、GPT OAuth 及视觉/图像、取消等其他声明能力仍按现有证据分别判断。未修改 `acceptance_cases.json` 或 `task_registry.json`。

**2026-09-25 TeamoRouter 正文增量与 UI Stop 实测：** `output/g20/m12-teamorouter-visible-stop/run-xElEkc/evidence.json` 记录 TeamoRouter 按量声明连接，请求模型 `deepseek-flash`，供应商实际模型 `deepseek-v4-1-flash-260910`，共 1 次请求。正文产生非空 `edit.changed` 增量，预览在视口内可见后由用户点击“创作助手/停止”；run 以 `stopped` / `aborted` 结束，未发生正式工具提交。关闭重开后原文、revision 与 Undo 深度均不变。实际费用 `unknown`。该证据仅覆盖此路由的一次正文增量可见与 UI 取消边界，不证明其他连接能力或 M12-T05 整体通过；M12-T05 继续 `not_run`。

**后续真实模型路由决定：** Owner 确认当前 GPT OAuth 额度已用完，后续真实模型验证改用已授权的 DeepSeek 官方 API 或 TeamoRouter。既有 GPT OAuth 图片生成、编辑证据继续复用；不再为图像能力重复请求 OAuth。DeepSeek 文本连接不因此被记作图片执行者。REL-T11 的两次真实混合任务仍为 `partial`，不能把分段生图证据拼成一次完成的混合任务；M12-T05、REL-T11 均保持 `not_run`。在相同 `transport` 原因没有新假设时，不重复发起付费任务。

### 2026-09-25 TeamoRouter 旧版图片接入及适配器方案决定

Owner 确认 GPT OAuth 图片额度已用尽，并授权使用 TeamoRouter 图片 API。真实记录 `output/g20/s14/teamorouter-image-real/run-BT65dv/evidence.json`：通过 TeamoRouter 旧版供应商专用接入，从 live catalog 选择请求模型 `gpt-image-2`，完成 1 次 `image.generate`，得到 1 张 ready PNG（1086×1448）；图片经预览后插入课件，保存、关闭重开后仍存在，生成结果与重开后的资源字节一致。实际收费为 unknown，供应商没有回报实际图片模型，不能从请求型号推断执行模型。

产品最终方案现从供应商专用图片 API 接入收敛为通用 OpenAI Images API 子集适配器与 GPT OAuth 专有适配器。连接显式选择图片协议，模型、凭据和计费均冻结，不自动切换。以上 TeamoRouter 实测仅证明旧版专用接入的这条生成与资源闭环；当时通用适配器代码仍在实施，不能据此声称新泛化实现已经实测。S14 当前验收状态保持不变。本次文档同步未发起付费请求。

### 2026-09-25 通用图片协议收敛与当前范围澄清

通用 `OpenAIImagesApiProvider` 已替代 TeamoRouter 专用图片类：API Key 连接显式保存 `imageProtocol=openai-images`，从冻结的 HTTPS base URL 固定追加 `images/generations` 或 `images/edits`；供应商名和模型 ID 不进入白名单。TeamoRouter 只是连接预设，另一服务可使用自身地址、路径、密钥与模型；GPT OAuth 保留独立适配器。连接身份与凭据版本严格核对，不因图片失败自动改路由或重发。旧版冻结 TeamoRouter 任务没有该协议字段时拒绝新的付费图片请求，已有结果仍可读取；新任务按显式协议运行。

最终源码的相关 Vitest 为 7 文件 33/33，通过三套 `npm run typecheck` 和 `npm run build:desktop`。本地 HTTP 夹具覆盖另一供应商地址 `vendor.invalid/tenant/openai`、自选模型 `vendor-illustrate-v2`、单原图 multipart 编辑、429/未知传输结果不重复发送，以及连接保存重开、OAuth 隔离。`tests/e2e/g20OpenAIImagesSettingsNoFee.spec.ts` 在当前桌面构建 1/1：使用假 Key 保存自定义 HTTPS Images API 连接与生成/编辑角色，关闭重开设置后协议、地址和型号保留；未发送图片请求。上述是无费协议/产品检查，不代表第二家真实供应商实测；此前 `run-BT65dv` 的真实 TeamoRouter 生图发生在旧专用适配器上，不能改写成通用适配器的真实请求。图片能力仅对已验证的具体路线声明。

Owner 当前不发布。`REL-T10` 发布前范围核对从 `M14-T05` 解绑，单列为 `release-preparation` / `not_run`；`M14-T05` 只核当前开发范围，保持 `not_run`，不借范围改写掩盖 `M12-T05` 与 `REL-T11` 的未完成证据。安装、便携、卸载与正式分发包检查继续留在发行准备，不作为当前开发完成门。

### 2026-09-25 通用图片协议的 TeamoRouter 真实实窗

第一次 `tests/e2e/g20TeamoRouterImageReal.spec.ts` 运行在免费 `GET /models` 预检报 `model-discovery-failed`，`output/g20/s14/teamorouter-image-real/run-aOSzvh/evidence.json` 明确记录 `imageJobs=0`、`result=not-sent`。同机 PowerShell 与普通 Node 随后只读目录均 HTTP 200 且包含请求型号。按目录瞬时失败的假设原样复跑一次，不把第一次记成付费生图失败。

第二次实窗 1/1 通过，证据 `output/g20/s14/teamorouter-image-real/run-UNKWoG/evidence.json`：目录 live，TeamoRouter 按量 API Key 连接显式 `imageProtocol=openai-images`，请求型号 `gpt-image-2`；内置执行器经通用 `guoling-openai-images-api` 发出 1 次 `image.generate`，生成 1254×1254 PNG，资源 `ready`。图片卡片预览、明确插入课件、保存关闭、重开后的课件图片资源与生成结果一致，界面 0 pageerror；文本控制模型由本地夹具提供，真实付费模型请求仅为该图片请求。供应商返回 1675 total tokens 与 request ID，未回报实际图片模型或金额，故执行模型与实付费用保持 `unknown`。此证据证明最终通用适配器的 TeamoRouter 生成闭环；不证明另一真实供应商或参考图编辑已在该最终适配器上实测。没有自动重试、切换 OAuth 或增加第二次图片请求。

**M12-T05 剩余边界复核。** 按原验收的“声明能力”口径复用已有证据：三条文本路线的真实工具、正文流与 UI Stop 均已覆盖；TeamoRouter 与官方 API 的受控故障后显式续作已完成。未实测视觉/图像能力继续显示未知，不作为虚假稳定能力。新增通用图片实测补齐 TeamoRouter 图片生成，但不补齐 GPT OAuth 的原任务正确续作：旧样本虽 completed 却误读附件，修复后的唯一请求返回 HTTP 429，未产生模型正文。额度耗尽不算产品缺陷，也不算成功；Owner 指定后续改用 DeepSeek，不为同因再请求 OAuth。故 M12-T05 仍 `not_run`，当前具体外部证据缺口只有 OAuth 正确续作，不能笼统写成所有连接能力未验。REL-T11 的真实混合任务可以在已验证的文本与图片路线先行执行，不以 M12-T05 总项通过为启动前置。

**OAuth 附件误读归因与验收口径修正。** 对 `oauth-LNtNBL` 留存的原 run 只读复核发现：续作用户消息的第二文本块包含完整附件正文；附件清单为 1，`delivery=sent`，读状态未知。最终回复引用了只存在于该附件的“蓝卡记录证据”，却称材料没有显示。这证明模型至少摄取了附件独有内容，不能归为软件漏传；更像模型对内容来源的语义误判。旧文本块未标来源也可能增加歧义，后续 `PayloadCompiler` 已加入文件名和正文边界，双协议无费测试证明序列化完整；修复后 OAuth 只收到 HTTP 429，因此不声称模型内容正确性已复验。按 Owner 当前决定，主 API 路由的声明能力继续以真实任务闭环验收；可选 OAuth 当前额度不可用时保留其文本工具、正文流、停止及图片生成/编辑既有成功证据，修复后续作内容正确性明记 `unknown/quota-unavailable`，不把该格写成通过或稳定，也不因它重复请求 OAuth。M12-T05 的计划源与状态调整另由同步更新记录；这段不改写上述运行原始结论。

**Owner 对软件层验收的进一步裁定。** M12-T05 评的是连接和软件行为，不要求模型每次都理解附件正确。`oauth-LNtNBL` 的 3 次 OAuth 文本请求及同任务续作完成，附件已进入用户消息，模型输出还引用附件独有内容；错误回答单列为模型内容质量，不作为连接或递送失败。修复后的 429 说明当前额度不可用、产品如实报告并未切换收费路径，不能倒扣旧成功证据。M12 软件层据已有三路文本/工具/正文流/停止、两路 DeepSeek 续作、OAuth 续作和两种图片接入的真实证据判定；未实测视觉能力继续为 unknown。此裁定不声称模型回复内容每次正确，也不把 429 当成功请求。

**REL-T11 的 42 请求样本性质。** `real-Hw2tDU` 中的 42 是同一长任务先后发出的 42 次文本模型请求，不是同一请求反复重试：前 41 次完成，共有 61 次工具调用；第 42 次收到 HTTP 200 后以 `transport/unknown` 结束。任务已创建/修改课件并生成图片；构建候选第一次因语法错误编译失败，随后修正并再次编译，但后续又改过源码，最终没有 `build.check ready`、`build.import applied` 或互动验证。模型多建草稿、迭代较多，反映任务效率与模型操作质量；最后一次传输错误的根因因诊断未留存不能归于模型、网络或产品中的某一方。测试目的在于暴露这些事实，不为了登记通过而缩短验收或拼接不同 run。

### 2026-09-25 M12 软件验收与 M14 终局审计排期

Owner 明确 M12-T05 只判软件连接能力：实际连接、附件递送、同任务显式续作、结果/错误状态及用户文件边界。`oauth-LNtNBL` 的 3 次请求和续作完成，原附件确实传入且被模型引用；模型误判附件来源属于内容质量观察，不作为连接层失败。GPT OAuth 既有文本工具、正文流/停止、图片生成/编辑证据有效；修复后 429 是额度状态，未伪装成功或改走 API。TeamoRouter 通用 Images API 的 `run-UNKWoG` 另证实新 API 图片路线真实生成、插入及保存重开；DeepSeek 两路文本/工具/续作已有各自证据。未实测能力保持 unknown。按此口径 M12-T05 登记 `passed`，M12 工程节点 `verified`；不宣称模型回答必然正确或附件来源标记修复已获 OAuth 复验。

Owner 同时决定 M14-T05 的人工范围核对暂不执行，排在新增 M15–M19 完成后；M14-T01～T04 的工程证据不回退，M14 工程节点登记 `verified`。M14-T05 保持 `owner_required=true` / `not_run`，正式发行核对仍是另列延期的 REL-T10。当前计划刷新与校验通过：33 个任务中 28 verified、5 planned；178 条验收中 154 passed、24 not_run，其中后续发行准备 4 条，新增 M15–M19 的 18 条仍从 not_run 起。工程 verified 与终局 Owner 接受明确分离。

### 2026-09-25 REL-T11 原任务续作诊断

`output/g20/rel-t11/real-ZvgM9u/continuation-evidence-1790320889021.json` 是同一会话、同一冻结路由的显式续作：TeamoRouter 文本加 GPT OAuth 图片，未改走其他图片计费路径。续作运行 `b1b3e508-47be-4a2a-b81e-e28d37ec9179` 发出 76 次文本请求，其中 75 次完成、第 76 次在正式停止时中断；执行 100 次工具调用。21 次 `image.generate` 均得到 `image-http-429`，并非同一文本请求重试 21 次。图片 Provider 每次只发一次请求，但模型以新调用编号重复发起；本次没有新的图片成果。停止后 run 为 `stopped`，无后台进程；一次性 `resume.json` 已被消费，隔离 profile 和 journal 保留供调查。

原 run 曾得到一张 `ready` 图片，但保存重开后的文档 ID 改变；续作自动重签因要求新旧文档 ID 相等而失败，提示旧图不可用。续作中确有一次 `build.compile` 失败后修复、一次 `build.check ready`，但随后模型继续写入同一候选使 ready 制品失效，后续多次检查失败；第二个构建 job 在创建 10 分钟后报 `build-budget`，因为旧计时把模型思考、图片请求与其他工具等待计入构建期限。最终 `build.import` 0 次、`media.insert` 0 次、正式课件 2 个位置、Runtime 0、资源 0；保存重开 clean、离线 HTML 可打开，但互动未形成。该样本的构建和图片阻断事实不能由“网络断了”概括，也不能登记 REL-T11 通过；仍为 `not_run`。测试的目的和结果是暴露软件边界及模型迭代行为，不靠缩短任务或拼接运行达成通过。
