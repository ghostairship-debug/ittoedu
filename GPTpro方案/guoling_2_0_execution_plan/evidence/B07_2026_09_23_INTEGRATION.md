# 2.0 工作台滚动集成记录（2026-09-23）

本记录只登记当前工程候选的实际运行结果。受控 HTTP 模型夹具证明果铃自己的 Engine、Gateway、文档与界面链路，不代表真实供应商、收费路由或 Owner 验收。执行目录为 `D:\果铃工作台`；本轮未提交、推送、部署或发布。

## 构建与实际界面

`npm run build:desktop` 在 OAuth/布局、静态素材、独立 Images 适配器集成后均 exit 0，原始记录见 `output/g20/b07/build-oauth-recovery-style-layout.log`、`output/g20/b07/build-static-assets-m10-m14.log`；后续 M04/M10 聚焦 Electron 用例前的桌面重建也各自 exit 0。CSS 附件输入区高度调整后，`npm run build:renderer` 亦 exit 0（`output/g20/b07/build-m14-composer-height.log`）。独立 Images 适配器的 `npm run typecheck` 通过，图像聚焦单元/集成 13/13、宿主服务选中用例 1/1。正式可安装包的验证另在 M13 门记录，不由此处的开发构建代替。

| 用例入口（均为 `npx playwright test ... --workers=1`） | 最终结果 | 直接证据和边界 |
|---|---:|---|
| `tests/e2e/g20NativeTextMeasurementUI.spec.ts` | 1/1 | `output/g20/native-measurement/run-wWNqQw/evidence.json`；真实 Electron/Canvas 文字测量、命名态、撤销重做与保存重开。 |
| `tests/e2e/g20AttachmentClipboard.spec.ts` | 1/1 | `output/g20/b07/clipboard/run-dcgRfd/evidence.json`；真实 Windows Ctrl+V 内存图片、CF_HDROP 双文件、粘贴后磁盘变化隔离、普通文本粘贴。剪贴板原内容由夹具恢复。 |
| `tests/e2e/g20ImageResultsUI.spec.ts` | 1/1 | `output/g20/s14/image-ui/run-pNaeb5/evidence.json`；独立 Images 端点的受控 HTTP 图像生成/编辑，预览、显式应用、替换、撤销重做、保存重开、停止后迟到字节。该用例本身不是实际 GPT 图片调用。 |
| `tests/e2e/g20SelectionContextUI.spec.ts` | 2/2 | `output/g20/m04/selection-feDwOo/body-evidence.json`、`output/g20/m04/selection-9BmrYc/object-evidence.json`；Markdown、Flow、Slides、Spatial 由真实界面选择并进入同一助手，冻结短目标后完成修改。尚未覆盖附件按钮焦点、切页及全部多选异常。 |
| `tests/e2e/g20SelectionContextUI.spec.ts` 聚焦修后用例 | 1/1 | `output/g20/m04/selection-WGnLV6/body-evidence.json`、`md-held-new-selection.png`、`flow-completed.png`；点击真实附件按钮并取消文件选择后，草稿和固定目标未丢；A 任务挂起时切到 Flow 文档 B 并人工选择，A 完成只修改 A，B 内容与当前选择保留；A 保存重开保持结果。旧版标签页被卡片遮挡的测试失败不计通过。M04-T02/T03 在这些场景通过；多选失效仍待独立用例。 |
| `tests/e2e/g20SelectionContextUI.spec.ts -g 'M04-T04\|M04-T05'` | 2/2 | `output/g20/m04/selection-Bsbt17/multi-invalid-evidence.json`、`output/g20/m04/selection-PaSvco/two-entries-evidence.json`；同页两对象选中、各自工具读写与 History，删除后旧目标和空选区拒绝且无额外写入；正文 AI 卡与主聊天对同一 Markdown 选区各得相同内容及撤销重做。另有 `g20MultiSelectionGateway` 等聚焦 6/6。受控本地模型夹具，未覆盖人工 UI 与 AI 的同操作对照（该对照另见 S04-T01 集成测试）。 |
| `tests/e2e/g20WorkspaceFilesTreeWindows.spec.ts` | 1/1 | `output/g20/m10/run-PP55kH/tree-actions.png`；隔离 Windows Electron 中完成树内新建文件/文件夹、复制、剪切粘贴、拖移、F2 重命名、Delete 回收站和右键菜单，磁盘与树结果一致；重命名输入及聊天输入的 Delete 等键未误操作树，外部改名后的展开和选中身份保留。M10-T01/T03 的 Windows 场景通过；T05 仍需独立验证。M10 文件服务/树聚焦 11/11。 |
| `tests/e2e/g20M10OpenFileMove.spec.ts` | 1/1 | `output/g20/m10/bindings/run-CL8IWp/moved-open-documents.png`；dirty Markdown 在编辑区写入并由冻结局部 AI 改写后，经树移动继续人工及 AI 编辑保存；含素材的 dirty V9 课件剪切粘贴移动后继续 AI 编辑保存，资源、History 和新绑定路径保留，旧路径没有重建。Markdown 文末追加范围映射在源代码中修复；测试桥一处 Electron 动态导入改为 `process.getBuiltinModule`。M10-T02 Windows 界面通过。 |
| `tests/e2e/g20M10ExternalChangesWindows.spec.ts` | 1/1 | `output/g20/m10/changes/run-AGGxSf/occupied-partial-result.png`、`external-and-retried-batch.png`；外部创建与目录改名后，树的展开及选择保持；Windows 实际占用文件的批量操作准确呈现部分成功与失败，解锁后重试成功。M10-T04 Windows 界面通过；失败文案仍带原生 EBUSY 和长路径，未影响结果准确性。 |
| `tests/e2e/g20M02MultiCourseTabs.spec.ts` | 1/1 | `output/g20/m02/multi-course-tabs/run-190UYU/evidence.json`、`both-tabs.png`；两份不同目录同名 V9 课件在隔离 Windows GUI 中同时打开，标签现显示最短可区分父路径；各自人工新增文字、保存、撤销/重做后，文档身份、对象数量、磁盘归档和素材字节互不混用，dirty 最终均清零。首次运行发现同名标签仅 hover 才可区分，已修 `WorkspaceDocumentTabs` 后聚焦 1/1，renderer 构建与类型检查通过。M02-T01 Electron 通过；此前 M13 正式包早于此标签修复，最终合包须重新构建验证身份。 |
| `tests/e2e/g20M02SaveAsAndCopy.spec.ts` | 1/1 | `output/g20/m02/save-as-copy/run-UmKYuq/evidence.json`、`reopened-save-as-and-copy.png`；隔离 Windows GUI 中已有 History 的课件人工编辑后 Save As，原 documentId、revision、Undo 保留且旧路径文件未变；资源树 Ctrl+C/V 复制到另一路径，副本以新 documentId/空 History 打开，可独立编辑、保存、撤销/重做。应用重启后两路径分别以 4/5 项内容和原素材、组件资源重开，dirty 均为 false。M02-T05 Electron 通过，E2E TypeScript 通过；正式包早于近期源码变化，最终合包需重建。 |
| `tests/e2e/g20S06RealTextStreaming.spec.ts` | 1/1 | `output/g20/s06/real-text-streaming/run-koaHcn/before-complete.png`、`after-complete.png`；隔离 Windows Electron 中真实选中 Markdown 正文，本地 SSE 先 read 再 text.replace，以五段推进中文、拆开的 emoji 代理对和跨行 JSON 转义。挂起完成信号时每段 EditSession sequence 前进、编辑区已有预览，而 canonical revision/Undo 均未变，工作区无候选；释放后正式 Gateway `applied`，revision/Undo 各 +1，源文真换行和最终正文无重复，3 次本地模型往返、0 页面/服务错误。首跑旧 dist 不接受新 `disclosedSettings` 而在请求前失败，重建当前源码后通过；测试断言从布局软换行改为直接检查源文真换行。S06-T01 Electron 通过，E2E TypeScript 通过；本地 SSE 不代表真实收费供应商。 |
| `tests/e2e/g20M02CloseDuringRun.spec.ts` | 1/1 | `output/g20/m02/close-during-run/run-Koe8L0/evidence.json`；隔离 Windows UI 中 AI 第一笔 text.replace 正式提交后，第二笔 SSE 挂起，文档 dirty。首次关闭选“继续编辑”保留标签与任务；第二次选“停止并关闭”，再“保存并关闭”，磁盘只含已提交第一笔，另一文件 revision/source 不变。旧 documentId 从列表消失，经 UI 重开得新身份；关闭后服务端尝试迟到完成，客户端流已关闭，零额外请求、写入或文档复活。M02-T04 Electron 通过，E2E TypeScript 通过；该用例未覆盖迟到事件已经进入客户端队列的同瞬间竞态。 |
| `tests/e2e/g20M08FailureCancelUI.spec.ts` | 1/1 | 隔离 Electron 界面三文件多选：缺失文件明确失败后补回并重试成功；8 MiB 文件显示实际 0–100% 中间进度，取消并移除后迟到读取不回队列；最终本地 HTTP 请求和持久会话均只含两份成功快照，三个原始文件字节保留。测试夹具最初两次因 Electron main evaluate 不支持 dynamic import / require 失败，改用 `process.getBuiltinModule` 后精确用例 1/1（26.7 秒）通过，E2E TypeScript 通过；没有产品源码修复或额外 Provider 请求。M08-T04 Electron 通过。 |
| `tests/e2e/g20MarkdownSelectionUI.spec.ts` | 3/3 | `output/g20/m04/selection-8d6bas/m05-complex-evidence.json`：CRLF 跨行引用、裸 URL 的选区经本地 AI 改写后精确对应源文；`selection-yzikqr/m05-full-contract-evidence.json`：标题加 emoji、可见首尾空格、列表缩进续行、链接标签、表格单元格五次真实选区→AI→源文/磁盘保存均保真，跨前段/分隔线/后段的不连续选区被明确拒绝，发送禁用且模型请求数 15→15、源文未变；`selection-qkauHK/m05-untitled-evidence.json`：未保存 Markdown 输入后立即选区 AI 修改，binding 始终 untitled，dirty 与 Undo/Redo 正确。三条用例最终各 1/1，首轮两次失败仅因测试手势/滚动坐标未覆盖目标，修正测试后通过，产品源码未改；映射/fidelity 单测 40/40、相关集成 3/3、E2E TypeScript 通过。M05-T02/T03 Electron 通过。 |
| `tests/e2e/g20LongWorkspace.spec.ts` | 1/1 | `output/g20/b01/long-workspace/run-0oC8E3/evidence.json`；10 文档含 2 课件、4 附件快照、10000 事件、30 次界面切换、10 次界面编辑保存。关闭应用重启后继续编辑保存并找回早期记录；前后历史游标均 10000，0 页面错误、0 Provider 请求。四次总 working set 约 1246/1215/1225/1277 MB，三轮未见单调泄漏趋势；最大单次切换 2.126 秒、保存 4.126 秒。`reopenMs=16775` 包含重新选择空间、编辑和检索，不是纯启动耗时。M14-T03 在该负载和机器上通过。 |
| `tests/e2e/g20ExportPreservation.spec.ts` | 1/1 | `output/g20/b01/export-preservation/run-z6FdQU/evidence.json`；HTML 导出取消保留旧文件、继续编辑时仍仅输出冻结 revision。不能代替全格式、正式包导出。 |
| `tests/e2e/g20ComposerConversationsUI.spec.ts` | 2/2 | `output/g20/m07/composer-ui/queue-wFYRAp/evidence.json`、`output/g20/m07/composer-ui/conversations-8R27Yb/evidence.json`；同一输入框的附件、队列删除、立即调整、停止、独立会话草稿与模型切换。Windows 原生中文 IME 未测。队列项最终按“回到最新”读取新事实。 |
| `tests/e2e/g20M11DocumentExperience.spec.ts --grep 'readonly second save'` | 1/1 | `output/g20/m11/exit-xccpAu/`；真实只读文件保存失败保留三稿并聚焦失败稿，验证简短人类可读错误。既有 M11-T05 通过状态不重复新增。 |

先前失败均保留为调查记录，不计通过：M08 设置状态选择器过宽、首次服务范围说明被历史区覆盖；M04 旧夹具未点击首次发送说明；S14/M07 新事实位于保留的旧阅读窗口；M14 四附件使输入区盖住历史检索。相应测试操作或产品布局已修，只有上表列出的最终重跑计入通过。图像结果与会话历史仍按分页保留阅读位置，测试通过界面的“回到最新”读取新增记录。

## 工具与生命周期聚焦检查

- `g20NativeTextStyleGateway.test.ts` 1/1：`object.update` 正式窄样式、命名态/基础态隔离、单 History、真实测量、保存重开；未知键和任意 `nativeData` 拒绝。`g20NativeTextMeasurement` 与 `g20NamedLayerTools` 相关 5/5。
- `g20CourseDocumentBridge.test.ts -t S04-T01` 1/1（其余 8 项明确跳过）：同一 V9 起点分别经 renderer 作者工具 Facade/`CourseDocumentBridge` 与 AI `DocumentToolGateway` 执行页面背景字段更新，两个正式文档会话得到相同的 Surface 内容与资源、各一条 History；缺失素材在两侧均拒绝且 revision 不变，UI 撤销和 Gateway 文档撤销均恢复原内容及资源。此为跨 renderer/主进程内核的集成组合测试，不声称真实鼠标点击或图片视觉一致。
- `g20ToolGateway.test.ts -t S04-T04` 1/1（其余 27 项为明确跳过，不计通过）：同文档三项请求的第二项使用不适用的对象更新，第一、第三项虽合法仍零正式写入、零 History 和零持久记录；三项跨文档请求也零写入；合法三项只有一个 revision/History，撤销一次恢复原文。符合 S04-T04 的集成层范围。
- `g20ToolGateway.test.ts -t 'S04-T03|maps a disjoint human edit'` 2/2（其余 26 项明确跳过）：任务持有的 Markdown 短句柄只改冻结的 A 文档，B 文档不变；伪造句柄与附加内部字段拒绝，重叠人工修改后旧句柄返回 `target-conflict`。与上表 M04 聚焦 Electron 用例中“任务指向 A，切到 B 并新选区，任务仍只改 A”的实测合起来覆盖 S04-T03；核心 Gateway 不读取当前焦点。
- `g20ToolGateway.test.ts -t S04-T05` 1/1：同一真实 V9 `DocumentSession` 中，`text.replace`、`object.update` 文字颜色及 x/y 位置、Flow/Spatial 的 `owner.background` 经 Gateway 直接完成；结果一次 revision、一次 History，可一次撤销，资源闭包不变。`g20ExecutionDesktop.test.ts -t 'runs a real HTTP provider'` 1/1：真实 HTTP 工具回合经 `ExecutionDesktopService → ExecutionEngine → DocumentToolGateway → DocumentSession` 原位提交，下一次模型请求收到 `document-operation: applied` 正式回执；两次请求是模型工具协议必要的结果续轮，没有额外宿主候选审查轮，临时工作区没有 `candidate.json`。同文件缺少模型角色的保护用例也通过；该路径不涉及构建/导入仍保留的 staging。
- S11-T02 复用上一条未改变的本地 HTTP 执行证据：普通 Markdown `text.replace` 在正式 Engine/Gateway/DocumentSession 直接提交，且测试对隔离工作区递归检查 `candidate.json` 为零、模型请求严格为工具调用及回执续轮两次。当前 `ExecutionDesktopService`、`ExecutionEngine`、`DocumentToolGateway`、`DocumentHostService` 的普通编辑入口无旧 generation driver 或候选写入依赖；不把此结构证据扩到受控构建/Runtime/Component staging。现有测试无需因验收登记重跑；S11-T02 集成通过。
- `g20MarkdownRepeatedSelection.test.ts` 2/2：两段完全相同且含 emoji 的 Markdown，正文第二段结构 ID 映射到精确源文范围，第一段句柄写入被拒，Gateway 只改第二段；序列化、撤销重做均保持。另以 CRLF 跨行引用两个结构范围做同批一次提交，引用符与后文裸 URL 保留。M05-T05 集成通过；M05-T02 的 Electron 真实选区、局部 AI 与切源文观察见上表独立用例。
- `g20MarkdownFidelityGateway.test.ts` 1/1：同一含 CRLF、列表及缩进续行、强调、链接、引用、表格、两处相同短语和真实 sidecar SVG 的 Markdown，从正文结构位置六次映射选区并经正式 Gateway 原位替换；每次权威源文及序列化只改目标文字，未选标记、换行、图片引用和资源字节保留，每次单独 History，第二处重复短语精确定位。该用例从 layout 模式直接执行，无需先切源文；源文视图的真实界面观察另由上表 M05 聚焦 Electron 用例证明。S06-T02 集成通过，聚焦 1/1、TypeScript 通过；不将此用例本身称为 GUI 点击。
- `g20RoleComposition.test.ts` 1/1：四种模型角色配置经新 `ExecutionSettingsStore` 重开保持；文字与含实际 PNG 字节的截图分别发送到本地 Token Plan 文本连接与按量视觉连接，各自 HTTP 路径、Bearer 凭据、模型和原图 data URL 均可核对。图片生成/编辑在任务开始冻结不同 OAuth 账号与模型，之后修改下一轮配置不改变本任务的本地 Images generations/edits 请求；编辑参考图字节与授权原图一致，新任务读取新配置，缺失编辑角色明确失败。`npx tsc --noEmit --pretty false` 通过。此为确定性本地服务，S10-T06 工程通过；不替代 S14 的真实图片生产或真实供应商计费核对。
- `g20FrozenConnectionRouting.test.ts` 1/1：本地 HTTP 的首轮 Token Plan 连接在运行中更改配置后仍冻结原 endpoint、模型和凭据，工具续接不串账；切文档并重开会话后的下一轮只使用明确改选的按量连接。未登录的可选 OAuth 连接拒绝发送，未回退另一供应商。S10-T03 集成通过、TypeScript 通过；测试档位为配置事实，不冒称真实账号账单。
- `g20RedisclosureScope.test.tsx` 4/4、相关既有聚焦 4/4：首次范围告知、同范围连续发送、供应商/模型/同源不同 endpoint/整文档写权限变更重新告知；两次分别确认的 A+X 与 B+Y 不能拼出 B+X 授权。告知与本地确认不会写入 URL 凭据。用户确认后切换文本或视觉配置时 Main 在外发前拒绝，草稿与附件保留；排队图片角色变化在 Gateway 开始前阻断，零 HTTP 并恢复草稿。内置界面携带配置戳，直接内部调用未传戳时保持原合同；旧 v1 确认缓存不迁为 v2，升级后须重告知。S10-T05 安全层聚焦通过，项目 TypeScript 通过。
- `g20S12MultiBridgeAuthority.test.ts` 1/1：两个独立 HTTP MCP bridge 对同一未保存 Markdown 并发修改不相交范围，正式回执 revision 1/2，同一 DocumentSession/Registry 和连续 Journal/History；旧目标新票据返回 `target-conflict` 且 Journal 不变。关闭一条 transport 后另一条仍可读，重新 initialize 后仍使用同一 Session；两次 Undo/Redo 往返保留两笔修改。S12-T02 集成通过、TypeScript 通过；这是确定性 MCP carrier，两种真实 CLI 客户端另由 S12-T01 证明。
- `g20S12TicketRecovery.test.ts` 1/1：真实未保存 Markdown、正式 DocumentHost/MCP/Journal，在提交后、终态事件及 HTTP 回执前注入一次性屏障并由客户端 Abort，形成已提交但回执丢失。同票据 `operation.lookup` 和重发均返回 revision 1 的 `applied`，改载荷同票据返回 `operation-payload-mismatch`；Journal 始终 sequence 1、一个 operation/History。撤权后迟到写入 HTTP 401，正文、Journal 与 History 零新增。S12-T03 集成通过、TypeScript 通过；这是确定性 loopback 故障注入，不冒充真实 CLI 网络故障。
- `g20ExecutionDesktop.test.ts -t 'runs a real HTTP provider tool continuation'` 1/1：已完成一次真实本地 HTTP 模型工具调用和正式 Markdown 文档提交后，以同一持久目录新建桌面服务，三次读取会话、事件页与时间线；返回事实一致，文档快照及 revision 不变，Gateway `execute` 额外调用 0、模型 HTTP 额外请求 0。此为 S07-T05 的主进程集成回放，不声称关闭/重开 Electron 面板的 S07-T03 已通过；`npx tsc --noEmit --pretty false` 通过。
- `g20AttachmentSources.test.ts` 1/1：内存 `File` 经实际 `FileReader`、本地选择框的 PNG、资源树列出并授权的 PNG，进入同一个附件快照服务；三张同名 `same.png` 的来源分别为 paste/file/workspace，字节、尺寸、摘要及表示 provenance 各自对应，未误去重，原始磁盘文件不变。服务持久重读快照和图像表示字节一致；S08-T01 集成通过，不冒充截图视觉或模型真实发送。Electron 与项目 TypeScript 检查通过。
- `g20TwoImageExecution.test.ts` 1/1：两张不同 PNG 快照在附件输入框同时呈现为“尚未发送”，仅附件发送经真实 `ExecutionDesktopService` 编译并发往本地 HTTP OpenAI Chat 夹具的唯一请求。请求体含且仅含两份 `image_url`，逐份 base64 解码及 Sharp 全解码后与原始字节、尺寸一致；冻结选择走视觉角色，初始载荷记录两个 provenance/摘要与 `delivery=sent`、`readStatus=unknown`，界面不伪报模型已读取。S08-T02 的正式执行链在本地端点通过，不代表实际收费视觉供应商通过。
- `g20PdfPageCoverage.test.ts` 1/1：两页真实文字 PDF 只提取第 2 页，单页压缩 RGB 扫描 PDF 只提取第 1 页；正式 PDF.js 提取器给出可核对的页码、范围、来源与扫描页 `scanned-page` gap，扫描页没有伪造文字表示，其 400×200 页图可完整解码并采到蓝色像素。派生快照经真实 `ExecutionDesktopService` 发送到本地 HTTP 端点，请求仅含第 2 页文字与两份实际图像，第一页面文字未混入；初始载荷三项 locator 正确、已发送/已读取未知。S08-T03 集成通过；Node 测试只适配真实 PDF.js 所需 Canvas/内建方法，未模拟 extractor，尚非 Electron 沙箱或收费供应商验证。
- `g20ExecutionTimelineDelivery.test.tsx` 2/2：持久事件存储对内置与外部 MCP 两来源各三次同为 `running` 的增量保留，重开 Store 后 React 时间线每次调用一张工具卡，三段均显示、外部来源标识正确；内置最终快照替换旧段，另一卡不变。另有真实父项/子项 ID 的实时与最终重放，最终正文只保留新快照；未上报 token 时不显示用量项，明确上报子项 7 个输出 token 后只显示该值，未伪造输入/合计。后一用例满足 S07-T04 集成范围；S07-T01 的生产执行器和外部 MCP 适配器连续三次 running 更新见下条独立用例。
- `g20S07ToolIncrementDelivery.test.tsx` 2/2：内置路径由本地 HTTP SSE Provider 连续三片真实工具参数，经生产 `ExecutionEngine` 事件适配持久 append；外部 MCP 路径由实际 HTTP tools/call 经生产 `McpDocumentServer` 的接收、票据查验和执行准备三个宿主阶段持久 append。重开事件存储后 React 时间线两路径各仅一张 running 工具卡、保留三段，外部来源明确；正式终态沿用同 itemId 的 snapshot。增量只含已观察阶段和片段序号，原始文档正文与连接凭据未出现在事件中。S07-T01 的集成层通过，聚焦 2/2、项目与 Electron 类型检查通过；不冒充独立 Electron 界面实测。
- `g20ExecutionEngine.test.ts -t 'streams real HTTP arguments'` 1/1 与 `g20ExecutionTimelineDelivery.test.tsx -t S07-T02` 1/1：本地 HTTP Provider 交错输出公开 reasoning、普通 text、流式 `text.replace` 参数，宿主先在绑定目标显示正文预览，再以正式 Gateway 提交；正式 Markdown 源文只含工具 `content`，另文不变，一次撤销恢复。时间线中的 reasoning、回复、编辑预览、工具回执各在独立项中显示；最终回复快照不重复保留旧文字，也不把思考/预览混进回复或工具结果。S07-T02 集成通过，TypeScript 通过；不是对供应商私有完整思考的还原。
- `g20StreamingEditArguments.test.ts` 34/34 与 `g20ExecutionEngine.test.ts -t S06-T06` 3/3：目标字段晚到的 `text.replace` 分片先仅收到正文，目标未固定时编辑预览为空、正式文档 revision 为 0；补齐目标及完整参数后只正式提交一次，中文、emoji 与换行正确。重复 JSON key 和截断转义在分片后均返回 `invalid-tool-arguments`，没有正式写入、History 或提交事件。此为 S06-T06 的解析与主进程执行器集成验证；不将局部预览视作已提交。TypeScript 检查通过。
- `g20S06StopSnapshotReplay.test.tsx` 5/5：本地 HTTP SSE 的同序号工具 delta 重放被生产执行器去重、冲突重放被拒；EditSession 的快照乱序/重放没有重复文字，正式 DocumentSession 仅一次 History。中间分片缺失或冲突时零提交，尾段缺失仅在完成事件给出可核对的完整参数时补齐；完成后的迟到 delta/重复 complete 不再消费。停止后注入迟到事件，重开持久事件存储和 React 时间线都不复活草稿或运行。旧 `g20ExecutionEngine` 断言已改为检查安全进度、正式拒绝回执及零写入，相关聚焦回归 52/52、项目/Electron TypeScript 通过。S06-T04 集成通过；新序号重复同文本若造成最终参数不一致会失败，不猜测重复字符。
- `g20PayloadStageBudget.test.tsx` 2/2 与既有 disclosure 聚焦测试 1/1：真实 `ExecutionDesktopService` 经本地 HTTP 的首轮请求含运行上下文及 PNG 原图 base64，初始 manifest 与实际 HTTP body 的序列化字节数、digest、图像大小一致。随后文档读取与 `text.replace` 正式提交各产生单独动态阶段请求，阶段字节数及 digest 与实发内容一致，最终回执为已应用的文档操作。超过 1 MiB 的实际 PNG 在发送前被拒，草稿/附件仍在、HTTP 请求未增加。DOM 说明明确首轮内容、绑定范围与全文外发的区别、后续授权工具读取和显式引用清单的边界；同一范围确认后不重复弹出。S08-T04 集成通过，TypeScript 通过；未覆盖正式包 GUI 呈现或收费供应商。
- `g20AttachmentOutsideWorkspace.test.ts` 1/1：工作区外普通文件通过短时只读授权进入不可变托管快照，并经真实 `ExecutionDesktopService` 发给本地 HTTP 模型。原件改名且内容改变、原授权撤销后，历史再发送仍读取入站原字节，不混入新文件内容；模型尝试把新路径作为 `text.replace` 目标返回错误，磁盘原件没有被改写或在旧路径重建。工具目录未给出任意文件写工具。S08-T05 安全层聚焦通过，TypeScript 通过；本用例不涉及用户再次明确授予写权限后的文件操作。
- `g20HistorySafety.test.tsx` 1/1：真实 `ConversationStore` 与 `ExecutionEventStore` 持久化含脚本样式正文、旧工具命令和长输出 Blob；新实例重开后经实际 `ExecutionAssistant`/`ExecutionTimeline` 展开与搜索，内容仅作文本，无脚本/图片/危险链接节点或任务发送/执行。正式诊断导出默认明确不带对话，实际文件无正文/旧命令，二次重开仍安全。M09-T05 安全层通过、TypeScript 通过；现有产品无独立“历史导出”入口，此处的导出只指诊断报告，不冒充另一个用户功能或正式包 Electron GUI 运行。
- `g20ConversationDeletionSemantics.test.ts` 3/3：真实临时工作区的两份 Markdown 与共享附件分别删会话、回收文件；另一会话、用户原件和共享快照保留。删除前持久附件释放意图，删除后按存活会话引用清理仅该会话持有的快照/blob，同 digest 的跨快照共享 blob 在最后引用消失前保留；失败删除及中断重启后的意图均安全收敛。S10-T04 集成通过，项目 TypeScript 通过。此处只覆盖仍在会话提交、草稿或消息中有引用的托管附件；上传后从未绑定会话、或早已移除的历史孤儿没有可归属的持久 owner，未宣称全部清零。
- `g20ExistingMediaAssets.test.ts` 3/3：只读素材短句柄插入/同类型替换、身份和未指定字段保全、撤销/重开及伪造/过期/跨文档拒绝；旧 `g20ToolGateway` 命中媒体 3/3，其他 24 个未选中用例不计通过。
- `g20AudioTools.test.ts` 3/3：`audio.settings`、sound CRUD 和已有音频资源闭包；并非真实听音或新字节导入。
- `g20WorkspaceFilesTree.test.tsx` 4/4：watcher 较新列表不被迟到 refresh 覆盖。
- M01 统一恢复面板迟到刷新及 CourseDocumentBridge bootstrap 晚到：聚焦 3/3；Markdown 外部移动/另存/冲突的真实临时磁盘 7/7。UI 恢复完整用户路径仍需补。

聚焦源码检查 `npx tsc --noEmit --pretty false` 和 `npm run build:desktop` 均通过。测试结果只覆盖列出的选中用例。

## 真实 OAuth 连接

用户在独立的果铃工程配置中完成正式 ChatGPT OAuth：`output/g20/providers/oauth/login-status.json` 显示连接 revision 2、`hasCredential=true`、未保留监听；未复制其他客户端密钥。产品设置重读确认该连接未撤销，计费来源标为 subscription。**登录不是模型能力通过。**

`output/g20/providers/oauth/catalog-status.json` 由产品设置服务只读读取当前账号模型目录，含 `gpt-6-luna`；目录本身不证明能力。随后对该模型累计七次**分别明确执行**的一请求工具探针，每次无自动重试。前六次依次定位本地响应协议、媒体类型与完成事件空 `output` 的兼容问题，状态均为 `unknown`；原始简要结果保存在同目录 `tool-probe*.json`，本地诊断只保留失败位置，不保留供应商正文。修复后第七次 `tool-probe-empty-summary-output.json` 返回 `status=supported`、`probe-tool-observed`，参数完整且供应商报告实际执行模型 `gpt-6-luna`。这是该连接文本工具能力的真实通过，不代表视觉能力。DeepSeek 凭据后来由 Owner 授权提供，仅在一次性测试进程环境中读取；不保存于源码、证据或发布包。

## 真实 DeepSeek API 工具往返

`output/g20/providers/real-api-catalog-status.json` 记录 TeamoRouter 与 DeepSeek 官方 `/models` 均 HTTP 200，前者列出 44 个、后者 2 个模型，均含精确 `deepseek-flash`；两路实际账号计费档位未由目录确认。`output/g20/providers/real-api-tool-run.ts` 在一次性进程中读取凭据，不将密钥写入源码、测试制品或正式产品设置。独立工具执行中，TeamoRouter 首次 HTTP 400；按供应商文档去除未列出的 `n` 参数后再次 400，上游只返回泛化错误。官方 API 的首轮 HTTP 400 明确指出 `media.insert` 工具参数根 Schema 没有 `type: object`；在同源 ToolCatalog 对四个对象联合 Schema 补上根类型，且各分支仍严格校验，聚焦 6/6、TypeScript 通过。官方当时的下一次请求发生 transport unknown，文档未写入；后续当前实现的成功复核见下文，不追认该未知请求。

修复 Schema 后，`output/g20/providers/teamorouter-real-tool-status-pre-scoped.json` 的 TeamoRouter 路由单次运行完成：请求模型 `deepseek-flash`，供应商三次请求均回报实际模型 `deepseek-v4-1-flash-260910`；先 `read` 再 `text.replace`，工具结果为 `document-operation: applied`，第三次模型请求收到正式回执并结束。隔离 Markdown 从“旧文本”变为“新文本”，revision 1、Undo 深度 1，未生成候选文件。S05-T01 在 TeamoRouter 真实 API 工具同回合往返通过；该次运行不证明官方路由，后续复核见下文。三次请求分别约 81,595/81,738/82,013 输入 token，暴露当时完整工具目录发送成本偏高。任务记录的计费类型及实际收费均为 unknown，不把路由名称当账单凭据。

## 真实 OAuth 图片与正式文档写入

图片适配器按官方 Codex Images 合同直接请求 `images/generations` / `images/edits`，不把 Responses 文本执行模型混作图片执行者。当前账号订阅连接各发起一次独立的真实请求，均无自动重试或其他收费路径：`output/g20/providers/oauth/image-generation-status.json` 显示请求 `gpt-image-2`、`ready`、1254×1254 PNG、604 总 token；`image-edit-status.json` 显示原图作为实际 `images` 字节参考送达编辑端点、`ready`、1254×1254 PNG、2158 总 token，且原图仍可读取。两份结果分别为 `first-real-image.png` 和 `first-real-image-edited.png`，已人工查看，颜色从蓝色变为橙色并保持铃铛轮廓。供应商未回报实际图片模型，故 `actualImageModels` 为空；`gpt-image-2` 是请求模型。计费来源是 subscription，单次实际收费金额和任务查询能力不可得。

`output/g20/providers/oauth/image-roles-status.json` 证明同一隔离工程配置已将已实测的 OAuth 连接与请求模型写入图片生成、图片编辑角色，配置后重读为 revision 2，原有对话/视觉角色原样保留。该配置没有模型请求，也不改变开发主路由的 DeepSeek 目标。

复用上述**同一份真实资源**，`output/g20/providers/oauth/real-image-document/status.json` 记录正式 DocumentHost/Gateway `media.insert`、`media.apply` 两次 `applied` 回执，图片对象身份保留，撤销/重做通过，保存到隔离 V9 文件并由新 Host 重开，结果资源摘要与真实编辑图片一致；此步 0 模型请求。`ui-status.json` 和 `real-image-reopened-ui.png` 记录新隔离 Electron 界面再打开该文件后实际显示橙色铃铛，渲染图片字节摘要与真实编辑结果完全一致，0 页面错误。受控 GUI 用例另证实结果卡片交互与停止后的迟到结果不会自动写文档。真实图片请求是产品服务入口的工程运行，正式文档写入与 GUI 重开是复用同一已生成资源的后续运行；不把它写成一次完整的用户点击过程，也不代替 Owner/教师视觉接受或全格式离线导出。

另外完成一次**完整真实工作台路径**，没有复用上述蓝/橙图片：`output/g20/providers/oauth/real-image-chat-ui/run-aYkvVy/model-status.json` 显示隔离空间中的一次聊天任务由实际 `gpt-6-luna` 完成 2 次文本请求，返回 `image.generate` 工具结果；同一运行发出 1 次 OAuth Images 生成请求，订阅计费来源，请求 `gpt-image-2`，1254×1254 PNG、626 总 token、结果 `ready`。首次自动化脚本误把折叠成果卡片当无结果，任务已完成，没有重发模型；之后在原会话展开已有卡片，预览绿色铃铛并明确插入绑定课件。`reopen-status.json`、`real-chat-image-reopened.png` 记录保存后的 V9 文件由全新隔离 Electron 配置打开并实际渲染，图片字节摘要与成果卡片完全一致，0 页面错误。前次界面自动化留下的未保存恢复稿仍在该隔离测试配置内，故最后重开使用新的只读验证配置；它不影响已保存文件。运行前的 GPT 对话角色已是 `gpt-6-luna`，整个测试未修改该角色；图片生成/编辑角色保持已验证 OAuth 连接。该链路是工程实测，尚非 Owner/教师视觉接受。

`g20ImageGeneration.test.ts` 选中超时用例 1/1（其余 5 项明确跳过）：一次已发出的请求无响应时记为 `unknown`、`charge=unknown`、`querySupport=unavailable`，同一任务重开仍不再次发起请求。其余已通过的停止后迟到资源集成用例与上表 GUI 用例一起覆盖 S14-T04 的取消、迟到字节保留且不自动应用；未声称能够查询供应商任务或确定未知请求的实际费用。

同一份绿色铃铛已保存课件还经过真实 Electron 的“单文件 HTML”导出，再由独立播放器窗口离线打开：`output/g20/s14/offline-real-image/run-vvGvQS/status.json` 记录导出文件 3,882,168 字节、真实生成图片字节嵌入 HTML、播放器图片完整加载为 1254×1254、0 渲染错误；`standalone-real-image.png` 是实际播放器画面。该步骤 0 模型请求，证明此图的离线显示不依赖供应商临时 URL。

S14-T05 的资源生命周期另由 `g20ImageGeneration`/`g20ImageResultsDesktop` 聚焦集成 10/10 和 `g20ImageResultsUI.spec.ts` 实际 Electron 1/1 验证；后者证据 `output/g20/s14/image-ui/run-YhqlyB/evidence.json` 使用本地 HTTP 模型夹具，完成图片预览、插入、撤销/重做、参考图编辑、原对象替换、保存重开和停止后迟到结果；删除会话后 3 份无引用生成 blob 清理，已保存 V9 文件与重开文档仍保留，页面/服务错误 0。真实 OAuth 图片的离线显示与上述夹具资源清理是两次独立实测，合起来覆盖当前 S14-T05 合同；不把夹具运行说成第二次收费图片请求。

S14-T06 在当前唯一拟支持的 GPT OAuth 图片连接 revision 2 上又完成一次无重试的真实透明背景请求：`output/g20/s14/transparent-real/transparent-status.json` 记录独立 Images generations 端点一次 POST，请求 `gpt-image-2`、`background=transparent`、`quality=low`，完成后返回 PNG 1304×1206，1,571,731/1,572,624 像素有透明度，原始图片见同目录 `transparent-result.png`。供应商实际回报 `quality=medium`，产品持久 job 将请求 low 与结果 medium 分开保留；未换模型、端点或收费路径。供应商未报告实际图片模型，产品不冒称请求模型就是执行模型；连接是 subscription，单次费用 unknown。结果卡目前不显示质量，因而也未误报 low；若未来要求用户在卡片上直接看到实际 medium，需单独补 UI。真实普通生成、单参考图编辑和透明背景已有各自证据；多参考图仍 unknown，未决定的独立图片 API 不声明支持。`g20ImageCapabilityHonesty.test.ts` 等聚焦 18/18 覆盖不支持参数、无编辑能力和未验证连接时的失败关闭，无自动换 API。按当前声明范围，S14-T06 的 real-model 能力诚实呈现通过；不把订阅计费类型当作单次实付金额。

## 正式包与全格式导出

最终源代码重建 `npm run build:desktop` exit 0，`npx electron-builder --win portable dir --x64 --publish never` exit 0；`npx tsx scripts/verify-release.ts --m13-package` 的专门打包门 13/13 通过，报告 `output/g20/m13/package-report.json`。Windows 目录版和 portable 版均可启动；正式包中的 preload、IPC、ExecutionDesktopService、AttachmentService 与该次编译产物一致，sharp 原生模块和两个 DLL 实际可解码 PNG，四个内置组件及缩略图闭包齐全，本机私有配置及旧客户端路径没有混入。目录版 GUI 成功导入示例组件、打开课件并生成示例 HTML/PDF/PPTX；此为 M13 包内运行依赖与版本一致性证据，不是全部发布门通过。

三表面四位置三素材的 `output/g20/m13/mixed-export-ready.h5lesson` 经正式目录包 GUI 导出单文件离线 HTML、在线轻量 HTML、web ZIP、PDF、PPTX、DOCX 六格式，详细路径、数量及限制见 `output/g20/m13/packaged-exports-d5gQkq/report.json`。三种网页交付在独立 Edge `file://` 打开、遍历四位置、图片加载，无外网请求和页面错误；PDF 四页、PPTX 三页和 DOCX Flow 正文由第三方解析器读取，结果见同目录 `third-party-office-readers.json`。原始 mixed-spatial 样本的全局横幅 480×44 文本溢出，被正式导出预检准确拒绝；只在 output 派生副本改为 720×80 后才导出，三表面与素材仍在。PPTX 只含 Slide 及两个 Spatial 静态镜头，Flow 单独进 DOCX；样本不含远程资产，在线 HTML 的远程保留没有证据；未用 Word/PowerPoint 桌面 UI 打开。M13-T04 的正式包与支持格式工程验收通过，未宣称原样溢出样本或所有导出语义均通过。

全量旧 `verify-release` 此前被过时 render-host 基准夹具阻断，旧宽泛包扫描对第三方文件另有误报，两者不计入上述 13/13。内置目录四包仍标 `license-unverified` / `maintainer-unassigned`，对外发布前须处理；本轮没有发布。

## 连接隔离、Scoped ToolCatalog 与双 API 复核

`tests/integration/g20S05ConnectionIsolation.test.ts` 使用本地 HTTP 模型夹具完成 2/2：同一产品连接和凭据被三轮连续任务复用，账户切换后原凭据不再进入新请求；改变 endpoint 或协议而不提供新凭据时拒绝发送，明确提供新凭据后只向新 endpoint 发送。`g20ExecutionSettingsPanel` 6/6 与 TypeScript 检查通过。此项验证产品连接选择、认证来源和实际 HTTP 请求，不声明底层 TCP socket 复用。S05-T02 按其产品语义通过。

`tests/integration/g20S05IdempotencyScope.test.ts` 2/2、TypeScript 检查通过：固定 Markdown 目标的另文档、另 run、范围外修改分别被拒；已提交工具调用的相同 callId 在关闭并恢复新 epoch 后仍取原 applied 回执，新的旧授权调用返回 stale-epoch。另在正式 journal 持久提交后模拟调用方丢失回执，`lookup`、相同 callId 重发及新的 DocumentHostService 磁盘恢复均复用同一 operationId/revision/History；同 callId 改 payload 拒绝，停止的 run 新调用拒绝。故障点是持久 ACK 后回执未送达，不代表真实网络或中途持久写失败，后者由既有 Session/Gateway 用例覆盖。S05-T03 按集成层要求通过。

`tests/integration/g20S05StopFactContinuation.test.ts` 1/1、TypeScript 通过：同一临时 DocumentSession 先提交 `AAA→FIRST`（revision/History 均为 1），第二次模型请求发送中停止。Provider 忽略 AbortSignal 后迟到的第二工具调用未入工具记录；直接注入旧 run 调用被 `run-stopped` 拒绝，文档保持 `FIRST BBB`。旧请求 `unknown` 且不自动重发。新 DocumentHostService 从 journal 恢复为新 epoch，Engine `recover()` 只读且 0 模型请求；显式 resume 先得旧 applied 事实并读取当前内容，再只改剩余 `BBB→SECOND`。最终 `FIRST SECOND`、revision/History 均为 2、恰好两个 document.commit 事件。此为确定性 Provider/持久化集成，不代表收费供应商或 GUI 停止体验；S05-T04 按集成层通过。

`tests/integration/g20S12TransportWorkspaceIsolation.test.ts` 与当前 `g20McpDocumentServer`、`g20McpClientRules` 合跑 4/4，TypeScript 通过。MCP 工具事件恢复与正式调用同源的 `input` 记录，不改变结构化回执、业务 schema 或 transport；显示层仍由 `readableExecutionData` 处理敏感字段。单个 loopback Server 中两个工作区/会话授权只见各自文档，跨目标、跨票据和错误 owner 拒绝；各自合法修改均是 revision/History 1；无/错误 bearer 返回 401，浏览器 Origin 403，伪 Host 404。证据 `output/g20/s12-transport-isolation/evidence.json` 不含 bearer/ticket。当前产品 UI 明示云端客户端无法直连本机服务；本用例没有实测公网扫描或真实远程云客户端，S12-T06 按当前仅开放的本机范围通过。S12-T01 的旧 Codex/OpenCode 真实客户端证据在正式业务 schema、读改和回执无实质变化后复用，没有重发收费 CLI；Claude/DeepSeek 客户端仍未测。

`tests/integration/g20ScopedToolCatalog.test.ts` 2/2、既有 Engine 12/12、MCP 2/2 与 TypeScript 检查通过：运行开始时按冻结的文档类型和可写目标选取同源 ToolCatalog 子集；Markdown 本地 HTTP 三轮使用同一五工具目录，模型 `read` 后一次 `batch` 正式提交；未广告工具及 batch 子操作在 Gateway 提交前拒绝。V9 Flow 局部只提供对应工具，整文档保留完整目录，MCP 无参目录不收窄。完整 V9 目录仍大；Markdown 图片工具因当前 Gateway 无正式资源交付而不广告，不能据此宣称 Markdown 图片插入已实现。

该相关实现变化后，分别在一次新的隔离 Markdown 文档上复核真实 API。`output/g20/providers/deepseek-real-tool-status.json`：DeepSeek 官方 `https://api.deepseek.com/v1` 请求及实际模型均为 `deepseek-flash`，HTTP 200、三次请求，`read`、`inspect`、`text.replace` 回执依次到达，最后为 `document-operation: applied`；源码“旧文本”变“新文本”、revision 1、Undo 深度 1，三次输入 token 1,237／1,487／1,912。此前同路由的传输失败记录保存在 `deepseek-real-tool-status-pre-scoped.json`，当时 outcome unknown；本次成功证明当前路径可用，不追认旧请求是否收费或到达。

`output/g20/providers/teamorouter-real-tool-status.json`：TeamoRouter 请求 `deepseek-flash`，实际模型三次均回报 `deepseek-v4-1-flash-260910`，HTTP 200，同样 `read`、`inspect`、`text.replace` 后正式 `applied`，revision 1、Undo 深度 1，输入 token 1,239／1,540／1,802。旧完整目录基线在 `teamorouter-real-tool-status-pre-scoped.json`，其三次输入 token 为 81,595／81,738／82,013；本次是不同独立运行，不能把差额解释为模型质量或总任务效率改善。两条路由的账号套餐与单次实付金额仍 unknown，运行凭据只进一次性进程环境，未写入源码、测试或发布物。S05-T01 原先的 TeamoRouter 通过证据保持有效；本次补足官方路由及工具目录成本的实测，不把 S11-T03 固定任务集对照算通过。

## Runtime 运行隔离与构建状态文案

`tests/integration/g20M13RuntimeLiveIsolation.test.ts` 使用实际 Published Runtime API 3 挂载计分交互：live 会话得分 1 后，失败候选与通过候选的私有宿主检查均未更改 live 的公开状态或当前工程；通过候选在另一个播放会话中单独运行得分 2。`tests/integration/g20M13BuildStatusTruth.test.tsx` 从 Engine 事件到 Timeline 可见文本验证三种正式 read 回执：`build.check` failed 和 `build.compile` `ok:false` 显示工具“失败”、任务“部分完成”，ready 则显示“已运行”，三者均不冒称文档已应用。此前 Engine 将失败的构建 read 回执当作完成；已按真实状态修正。两测试合跑 4/4，TypeScript 通过，证据在 `output/g20/m13/runtime-live-isolation/evidence.json` 和 `output/g20/m13/build-status-truth/`。Runtime 用 JSDOM，画面捕获/PNG 是替身，不证明独立 OS 进程、真实像素或 Electron 鼠标；文案测试注入正式构建回执，未把整条 ControlledBuildService 再串一次。按 M13-T02 的集成层要求登记通过，真实视觉仍待对应 GUI 用例。

## Owner 新增界面要求的登记边界

Owner 已确认 `mid_term/WORKBENCH_EDITOR_LAYOUT.md` 的工作台三栏、左上资源/左下会话、底部场景及所属状态、四类插入和按需属性、右助手隐藏时原处 AI、专业编辑器侧按钮。2026-09-23 的旧窗口审计 `output/g20/ui-layout-audit/REPORT.md` 与截图仅证明当时源码差异：左栏无会话、右侧 AI 内含会话、底部仅当前场景状态条、专业右面板常驻。新增 M01-T06、M03-T06/T07/T08、M04-T06、M07-T06、M10-T06 均登记 `not_run`；原 M01-T01–T05 等旧通过项只继续覆盖各自原定义。M01 因新增未验收界面项从 `verified` 回到 `in_progress`。新 UI 源码与聚焦测试正在并行集成，不用参考图或方案校验冒充窗口验收。

## 正式登记边界

本轮可将 S04-T01/T02/T03/T04/T05、S05-T01/T02/T03/T04、S06-T01/T02/T04/T06、S07-T01/T02/T04/T05、S08-T01/T02/T03/T04/T05、S10-T03/T04/T05/T06、S11-T02、S12-T02/T03/T06、M02-T01/T04/T05、M04-T01/T02/T03/T04/T05、M05-T02/T03/T05、M08-T01/T02/T04、M09-T05、M10-T01/T02/T03/T04、M13-T02/T04/T05、M14-T03、S14-T01/T02/T04/T05/T06 登记为 `passed`，均引用本记录和上述原始制品。M07-T03/T04 与 M11-T05 早先已通过，不重复计数。M01 因本次新增界面验收从 `verified` 调整为 `in_progress`；M13、M14、S14 均保持 `in_progress`，其余待验收项保持 `not_run`。特别是 Owner 新界面真实窗口验收、S14 的 DeepSeek 组合和其他能力边界、M14 其余系统和显示场景、Owner/教师艺术验收、全格式导出和正式发布门未通过。

## 同日后续集成增量：工作台和受控构建

在单独写域的并行开发归还后，`npm run typecheck` 三套 TS 检查及 `npm run build:desktop` 均 exit 0。新增 S11 Main 侧计时的聚焦测试 2/2、连同 S05 恢复 8/8 通过；目前未直接观测 renderer 点击/首帧或磁盘保存耗时，S11-T01 仍为 `not_run`。

- `tests/e2e/g20WorkbenchOwnerLayout.spec.ts` 与 `g20BottomSceneOwner.spec.ts` 在隔离 Windows Electron 中 2/2 通过；最终整桌面重建后的 Owner 三栏用例又 1/1 通过，截图在 `output/g20/owner-layout/run-ahBi2s/three-columns-with-course.png`。课件文件名已由标签承载，保存状态和“深度编辑”并入单行工具栏；重复的“当前位置”和第二个“试运行”入口移除，画布自身保留运行开关。右侧当前会话、底部输入区常驻模型选择可见并可打开直选列表；历史搜索/外部客户端位于“更多”。底部卡片跨场景选所属状态后的实窗截图为 `output/g20/m03-bottom-scene/run-kcBhpw/02-cross-scene-owned-state.png`。两项截图是工程视觉证据，仍待 Owner 视觉复核。
- `tests/e2e/g20S09WorkspaceBoundaryWindows.spec.ts` 在完整构建后 1/1 通过：Windows 回收站注入 EACCES 时原件保留且逐项错误可见；工作区 junction 指向外部被拒，伪造非主窗口 IPC 被拒，合法目录创建成功。聚焦 `g20WorkspaceFiles`/Markdown 资源移动集成 19/19 亦通过。S09-T04 的 Windows 行为已证；S09-T05 的 UNC 样本尚未实测，不能据 junction 与伪造 sender 直接记全项通过。
- `tests/integration/g20MixedBuildExecution.test.ts` 三反例均通过：文字正式提交后停止构建、模型预算耗尽、同一构建 job 编译失败后修复并正式导入。`g20MixedBuildExecution + g20ExecutionEngine + g20S11ExecutionTiming` 合跑 17/17 通过，保留历史工具失败事实但按最终导入结算。`tests/e2e/g20MixedBuildPartial.spec.ts` 真实 Windows 窗口 1/1，原始记录 `output/g20/s13/mixed-build-partial/run-3rYPx1/evidence.json`：本地 HTTP 夹具在 text.replace `applied`、build.create/write/compile 后、build.check 前挂起；UI 停止后 run 为 `stopped`，已提交正文可撤销重做并保存重开，组件未导入，摘要说明已保留/未完成。此 GUI 停点不证明 admission 执行中取消；该后者有前述服务层隔离证据。S13-T05 按当前取消/预算场景已证。
- `tests/e2e/g20ControlledBuildDelivery.spec.ts` 在源码桌面构建中 1/1 通过，`output/g20/s13-delivery/run-XJL4v3/evidence.json` 与 `offline-component-runtime-clicked.png`：受支持外部 Component 包经 build.create/write/compile/check/import 正式受控路径，撤销重做、保存及 UI 关闭重开一致；正式单 HTML 导出 2,274,711 字节，断网 Chromium 中 Runtime 和 Component 实际点击成功，外部 HTTP 请求、播放器与 renderer 页面错误均为 0。最初两个夹具失败分别是未点首次服务范围确认及错误要求原始后备图字节在 HTML 中逐字保留；修夹具后未改产品源码即通过。此运行使用源码 Electron，尚未在最新正式打包产物中复核，S13-T06 的 `package` 层验收仍未完成。

随后六个相关 UI 文件的并行 GUI 回归共 13 条，首轮 5 通过、8 失败。已定位一处真实产品阻断：右助手隐藏时，首次就地 AI 的服务范围弹窗随隐藏的右栏一起不可见；修复和重验进行中。专业编辑器按钮首次打开 AI 面板的显隐规则也已修源码，尚待真实窗口重验。其余失败按界面/测试手势逐项复核，不能沿用首轮旧通过结论替代这些新增布局场景。

## 同日追加：Owner 专业模式与 Windows 路径边界

Owner 进一步明确专业编辑器模式的工作台绿栏、文件标题行、文件标签栏均退出画面，编辑器自身工具栏贴顶并提供“返回工作台”；无选区时误显的白色横条实际是空的 `NativeSelectionContext` 容器，不是滚动条。`tests/e2e/g20ProEditorRail.spec.ts` 在更新后的源码桌面构建中 1/1 通过，原始 `output/g20/pro-editor-rail/e2e/run-fZgWzD/evidence.json` 及 `02-professional-collapsed.png`、`04-professional-ai.png`、`05-professional-resources.png`、`07-back-workbench.png` 记录三层高度回收、无选区空壳不露出、专业右侧 AI/资源/会话浮层及返回后的同一 DocumentSession/History/任务/草稿。第一次实窗曾发现专业 AI 浮层 `display:flex` 但网格轨道宽 0，已按完整工作区重新定位；旧失败保留在 `output/g20/pro-editor-rail/e2e/run-58W6C7/failure.json`，不可计通过。修复后的窗口截图是工程视觉证据，Owner 对最终视觉效果仍待复核。M03-T08 的当前 Electron 合同已证。

`tests/e2e/g20WorkbenchOwnerLayout.spec.ts` 在上述专业模式修正前的同轮完整桌面构建中再通过 1/1，原始 `output/g20/owner-layout/run-ahBi2s/three-columns-with-course.png` 连同用例验证左上资源、左下会话、中央文档、右助手、文件/会话独立显隐与多文件；专业模式后续改动只作用于 `editorFocus`，工作台三栏仍在专业往返用例返回截图中恢复。M01-T06 工程窗口合同已证。`g20BottomSceneOwner.spec.ts` 原完整构建 1/1，`output/g20/m03-bottom-scene/run-kcBhpw/` 的六张截图和实际导航记录覆盖八场景的所属状态、横向滚动、Flow 标题/章节、Spatial 世界/镜头、返回 Slide 且 DocumentSession revision/History 不变；底栏导航实现未再改，M03-T06 工程窗口合同已证。

Windows S09-T05 另以真实 `\\localhost\D$` 授权工作区运行 `tests/e2e/g20S09WorkspaceBoundaryUnc.spec.ts` 1/1，脱敏持久原始证据 `output/g20/s09/unc-workspace-boundary/evidence.json`：UNC 根 realpath 保留 UNC 身份，外部 junction、未授权 sibling、伪造 entry、非法上级目录名与非主窗口伪造 IPC 被拒；合法 mkdir/create-text 在 UNC 与本地同址回读一致，外部原件未变。配合前述 junction/回收站 1/1，S09-T05 当前合同中的本机 UNC、越界与伪造请求已证；远程服务器共享、其他凭据与长路径别名未测，不扩大此项结论。S09-T03 真正 C/D 跨卷移动仍在实现和验证中。

M04 选区回归在隐藏助手披露层 portal 修复后，Markdown/Flow 原处目标冻结与同一 History 1/1、Markdown 主聊天与原处同目标 1/1；另三条仍失败，包含专业模式按钮状态与旧测试动作不符以及多选成功后的旧“删除所选”入口。它们正在按实窗 trace 修正，M04-T06 未登记通过。M07-T06 会话列表复测发现关闭课件后旧冻结文档引用发送被主进程泛化异常挡住，当前仍由唯一代理修结构化提示和显式移除失效引用；M03-T07 Slide 的实际画布渲染与命中尺度不一致，Spatial 四类插入与资源保存重开 1/1 已通过，Slide 正在修同一尺寸源。上述失败不因其他同文件用例通过而自动转绿。

## 同日追加：目录资源与真实跨卷部分失败

`tests/integration/g20S09DirectoryMoveResources.test.ts` 在真实临时目录中 1/1 通过，原始 `output/g20/s09/directory-move-resources/evidence.json`：含相对图片的 Markdown 连同课件所在目录移动后，两份打开文档的 binding 指向新路径，dirty revision/History 保留；保存、全新 Host 重开与图片读取成功，外部原件未被移动，旧源目录消失。按 S09-T02 的 integration 合同登记通过。

`tests/integration/g20S09CrossWorkspaceMoveWindows.test.ts` 在设备 ID 不同的本机 C:/D: 实盘上 5/5 通过；`output/g20/s09/cross-volume-move/integration-evidence.json` 记录同批正常项、复制校验失败项与源件占用 `EBUSY` 删除失败项分别回报 `success`、`failed`、`partial`。失败源件保留，未验证的目标不发布，已验证但源件未删的副本保留且原件可继续保存；`source-changed-evidence.json` 证明复制后源件变化时不删除原件；`partial-directory-evidence.json` 与 `partial-directory-cold-repair-evidence.json` 证明递归删除部分成功及冷启动后逐子项修复 binding，不在旧路径复活已移动文件；`nested-root-noop-evidence.json` 证明两个授权工作区同指物理路径时不自复制/自删除。按 S09-T03 的 Windows 跨卷和部分失败合同登记通过。文件树交互另有 S09-T01/T03 聚焦 Electron 用例待实窗运行，不能由集成层结果推定窗口已通过。

## 同日追加：多跳续作的正式事实

`tests/integration/g20S05CompactionRecoveryBudget.test.ts` 使用真实 DocumentHost/Gateway/RunStore 与本地 HTTP 夹具，和已有 S05 恢复/ExecutionEngine 聚焦项串行合跑 9/9，`npx tsc --noEmit`、Electron TS 检查通过。此前续作只从直接前驱重建事实，一旦中间续作超时，首轮已提交正文会从下一轮模型上下文消失；现从持久 run 链重建原目标、每次正式提交、待决工具和未知模型请求。原始 `output/g20/s05/t09/compaction-recovery-budget.json` 记录压缩、一次超时、一次断连、实际执行后丢 read ACK、重启及三次显式续作：7 次模型请求，故障请求各仅一次，无旧工具重放；最终 revision/Undo 均为 2，正文 `FIRST SECOND`，最大序列化请求 6071/35000 字节。`unresolved-side-effect.json` 记录两跳后的同类 text.replace 被拒，Gateway 只执行旧调用一次、revision 0。默认并行测试曾出现旧用例临时目录异步清理竞争 `ENOTEMPTY`，串行重验 9/9；未改旧测试或事件存储，未发付费模型请求。按 S05-T09 的 integration 合同登记通过；真实供应商恢复效率仍属单独实测。

**后续独立复核撤销 S05-T09 通过结论。** `output/g20/s05/t09-review/evidence.json` 的三个本地无付费反例证实：同轮 read 回执丢失后，仍为 `pending`、从未调用的后续 text.replace 被错误当未知副作用永久封锁；旧 direct text.replace 未知时改用 batch 包装，以及旧 batch 未知时改用 direct，均能绕过按外层工具名的续作防重放。后两条证明防线失效，不声称两次物理提交。正式状态暂改 `failed`，由 S05 唯一写域代理修复并重验；前述 9/9 继续作为其明确覆盖的场景证据，不能代表整个 T09 合同已通过。

**修复与复核后恢复 S05-T09 通过。** `pending` 在 Gateway 首次调用前的持久 checkpoint 明确表示尚未调用，仍列入未完成事实但不封锁新的副作用；只有 `executing` 或返回 `tool-outcome-unknown` 才封锁。历史与当前调用经同一 `effectNames` 展开非递归 batch 的正式 mutation 名称，防 direct↔batch 绕行。`g20S05CompactionRecoveryBudget.test.ts` 新增五个实测反例，和原恢复聚焦项串行合跑 14/14：未执行 write 在 fresh read 后成功提交，执行结果未知的 direct/batch 两向均在 Gateway 前被拦，文档 revision 与执行次数实际核对。独立 Astra 只读复核重演原三反例均转为预期结果，并核对正式 ToolCatalog 的 38/38 当前 mutation 名称与 batch Schema（不支持递归 batch），未发现新的阻断项。证据为 `output/g20/s05/t09/pending-not-invoked.json`、`text.replace-to-batch.json`、`batch-to-text.replace.json`、对应 `returned-*.json` 及原压缩恢复结果；TypeScript 两套通过。当前通过结论限于本地故障注入的 integration 层，不声称供应商网络中真的双写过。

## 同日追加：普通诊断与凭据边界

M12-T03 使用全为假值的本地 HTTP 供应商回声，复现视觉探针曾把模型回复或 `actualModel` 中的假凭据写入能力记录，再修为固定安全文案、过滤实际使用凭据的回声及异常模型字段。`output/g20/m12/t03/README.md` 汇集配置加密/设置读取/持久 JSON/诊断默认不附客户正文及预览导航的聚焦 19/19；主窗口顶层 IPC sender guard 单例 1/1，旁项明确跳过；`tests/e2e/g20M12PreviewPrivacy.spec.ts` 的实际 Electron 准入预览独立 profile 1/1，窗口内无 `desktopAPI`、设置接口、`ipcRenderer` 或 `require`。E2E 类型检查通过，无真实凭据读取或付费请求。按 M12-T03 security 合同登记通过。Electron 用的是当时已有 dist，新的探针修复由源码聚焦测试覆盖；整课预览与编辑器同处 renderer，此项不外推为整课预览独立沙箱证明，也不替代后续打包制品验收。

Owner 授权的两个开发 API 密钥已保存到 Windows User 环境变量，测试进程按需读取；产品连接仍用独立安全存储。针对 S13 新构建的 `output/g20/s13-package/win-unpacked` 全目录，用一次性进程从用户环境读取两条密钥，仅在内存中按完整字节串流扫描 136 个打包文件、约 660,879,269 字节，两个精确密钥在包中均 0 次出现；命令只打印匹配次数，未输出或写入密钥值。这证明此工程包没有包含这两条具体密钥，不等同于以后任何新包的自动保障。

## 同日追加：右助手收起时就地 AI

`tests/e2e/g20SelectionContextUI.spec.ts` 的 M04-T06 在更新 renderer 的隔离 Windows Electron 中 1/1 通过，原始 `output/g20/m04/selection-ctPQTV/inline-ai-assistant-hidden.json` 与前后截图记录：专业模式右侧 AI 收起，Slide 命名状态对象在原处浮层输入并提交，三次本地夹具模型请求沿唯一任务执行，正式 `document-operation: applied`，revision/Undo 从 0 到 1，页面错误 0；没有转去右聊天才能完成。根因是 Phaser 对浮层按钮的 window `mousedown` 仍作画布输入，导致选中锚点在 click 前跳走；浮层阻断鼠标兼容事件冒泡后实际按钮提交。Markdown/Flow 原处冻结的聚焦组合另 1/1 通过。M04-T06 的当前 Electron 合同已证；M04-T01/T02/T03 的 Slide/Spatial 组合在 Spatial 指针选中阶段仍有可重复缺口，正在单独修，不借 T06 的通过覆盖它。

随后 `SpatialLocationWorkspace` 把指针反算改为实际绘制的 stage DOM 矩形并在 layout commit 同步测量 viewport，解决专业模式切换后画面尺寸和指针尺寸错帧。原 Slide/Spatial 组合实窗 1/1、额外真实鼠标拖拽聚焦回归 1/1，证据在 `output/g20/selection/spatial-painted-hit-fix-playwright/` 与 `spatial-pointer-drag-playwright/`；命名态目标冻结、Spatial 世界对象提交、frame 位移和 Undo 均实际观察。M04-T01/T02/T03 此前各自已通过的状态因此无需因本次界面变化撤销，Owner 视觉复核仍独立。

## 同日追加：正式打包受控构建与离线交付

`tests/e2e/g20ControlledBuildDelivery.spec.ts` 在最新源码桌面与由当前 dist 新建的 Windows `win-unpacked` 包各 1/1 通过，日志 `output/g20/s13-delivery/source-after-order-fix.log`、`packaged-after-order-fix.log`，打包原始 `run-Ew0E5m/evidence.json`。源端首次失败是夹具把 order=1 的 Component 接在 order=20 的 Runtime 后，正式 V9 Schema 正确拒绝；夹具改为按 order 插入且写入 scratch 前用正式 Schema 校验，产品源码未因此改。新用例在 `build.import` 前暂停并读取正式文档，revision/Undo/组件包/资源/实例均不变；受控检查后才正式导入。导入后可撤销/重做，保存后全新实例重开一致；约 2.27 MB 单文件 HTML 在断网 Chromium 中 Component 与 Runtime 实际点击成功，外部请求、页面/renderer/服务错误均为 0。包内 `app.asar` 的主入口、ControlledBuildService、ExecutionEngine、ExecutionDesktopService 和 renderer 入口与此次 dist 逐项一致；进程 `isPackaged=true` 且路径为该新包。按 S13-T06 的 package 层合同登记通过，未将其等同于独立用户发布/安装全门通过。

## 同日追加：DeepSeek 官方视觉与组合任务停点

TeamoRouter 的前一次随机三格视觉探针状态为 `unknown`，0 正文/图片请求；能力探针随后修正仅完整同序英文色形对和等价分隔可通过，同时移除任意供应商回复的持久预览以防凭据回声。使用 Owner 授权、Windows User 环境变量中的 DeepSeek 官方 API 凭据，最新桌面构建的 `output/g20/s14/real-combo/run-42peW1/status.json` 记录一次真实 `deepseek-flash` PNG 视觉探针：`supported`、`probe-vision-observed`、供应商回报实际模型 `deepseek-flash`，官方实时目录 2 个模型且包含请求 ID；文本任务和 OAuth 图片各 0 请求。后续工作台自动化被已有未保存恢复稿面板遮挡，没有发生产任务，profile 已恢复、测试连接已撤销。新增零付费 UI 预检 `run-tXzZ7D/status.json` 在恢复面板等待时发现 page/context 关闭，仍 0/0/0 请求；正在定位页面生命周期与恢复稿操作，未在相同原因下盲目重发付费探针。S14-T03 组合链保持 `not_run`，不能以视觉探针单项通过冒充全链闭环。

## 同日追加：强杀进程后的正式恢复

`tests/integration/g20M11InterruptedRecovery.test.ts` 与独立 Node 子进程夹具在 Windows 上对三个持久化屏障实际强杀，串行 3/3；`output/g20/m11/t04/generating.json`、`applied-unsaved.json`、`saving.json` 保存原始观察。生成中只出现临时预览 `HALF PRODUCT`，重开正式 revision/Undo 均 0；已应用未保存时 Journal 恢复 revision/Undo 1 和正文 `APPLIED`，原磁盘文件仍旧版；保存中在 `fs.rename` 前杀进程，重开恢复稿是新正文、原文件仍完整旧版，人工保存后成功写新文件。RunStore 中断标记为 `interrupted`/unknown，sentinel Provider 在所有恢复路径调用 0 次；没有自动重跑付费任务或把临时片段当正式提交。TS 主进程、renderer 与子进程夹具检查通过。按 M11-T04 fault-injection 合同登记通过，未将此项扩写成整个 Electron 退出/重装链通过。

**独立审查新反例后撤销 M11-T04 的整项通过。** `output/g20/m11/t04-review/after-rename-evidence.json` 以真实子进程 SIGKILL 卡在目标文件 `rename` 已成功、DocumentSession 保存 ACK/Journal 尚未追加的窗口：磁盘已经是新正文，重开 Journal 恢复正文及 Undo/Redo 正确，但仍用旧 `binding.version` 判 dirty/recovered，用户再点保存得到 `file-conflict`。这是已证的保存恢复可用性缺口，未发现数据丢失；正式状态暂改 `failed`，前三个通过屏障继续有效但不覆盖此窗口，正在修复并补同一 fault-injection 用例。

## 同日追加：真实多模型课件结果与图片工具结算

S14-T03 已执行到实际保存重开，故从 `not_run` 改记 `failed`，不能用技术闭环遮盖作品错误。`output/g20/s14/real-combo/run-jBhDpt/resume-pWlvjW/status.json`、`reopened-course.png`、同目录课件与原始 RunStore 记录可复核：DeepSeek 官方实际 `deepseek-flash` 视觉探针支持，文本请求 8 次完成，报告输入 705,216、输出 8,170、缓存输入 619,008 token；GPT OAuth 图片首个调用被本地能力检查拒绝（`not-sent`、0 HTTP POST），模型自纠后的第二个任务只发 1 次实际图片 POST，ready PNG 1536×1024、2,024,457 字节，图片接口报告输入 284、输出 601 token。请求图片模型 `gpt-image-2`，供应商未证明实际图片模型；图片连接计费标记为 subscription，实际金额未知，DeepSeek 本次计费类型及金额未得可核对账单，不能声称“低成本已证”。

同一 run 的已有 ready 图片经真实 UI 仅插入一次，随后保存、关闭并重开；文档 clean revision 2，有 7 个 Native 文字对象和 1 个 Native 图片，图片资源与解码字节一致，原截图及另一份未保存恢复稿未变。续跑没有任何新模型或生图请求。原 RunStore 结算仍为 `partial`，原模型 run 约 188 秒；从首次脚本启动到最终重开证据约 32 分 30 秒，包含人工式诊断与续跑，不能当模型速度。至少有一次模型自纠和一次显式插图/保存干预。实际重开截图中，图片遮住右侧 Native 文字，部分文字小到不可读，图内文字为栅格；因此当前内容可读性与 Owner 视觉验收未通过。原截图的三个控件成为静态文字，是这次测试提示明确要求“三项输入”用 Native 文字且没有定义点击结果所致；不能据此单独判模型遗漏已要求的互动，后续若验互动须明确行为并实际点击。后续只针对可复现质量缺口修复，不把保存链路重复付费重跑。

独立审查同时发现首次失败的 `image.generate` read 回执被执行事件标为 `completed/已收到正式结果`，尽管图片卡自身显示 failed。已在 `executionOutcome.ts` 按 `image.generate/edit` 的服务任务状态统一工具事件、计时与任务结算；ready 仅显示“图片已生成，尚未应用到文档”，普通 `read` 和 `image.status` 查询不按业务字段误判。未知图片服务结果仍可能在上游执行，Engine 在本 run 及续跑中阻止换新调用编号自动重发生成/编辑。`tests/integration/g20ImageToolStatusTruth.test.tsx` 对 failed、unknown、stopped、ready、普通 read、状态查询及未知结果重复调用做生产 Engine→持久事件→可见 Timeline 聚焦回归；与原构建状态及 S05 上下文恢复回归同时运行 16/16 通过，TypeScript 检查通过。该修复尚未用新的付费图片请求重演，原真实失败记录作为事实证据保留。

## 同日追加：保存恢复反例修复与外部磁盘写入

M11-T04 在原先 rename 后强杀反例外，独立 Astra 审查又以真实 SIGKILL 复现了**干净文档 Save As 的目标文件已发布、Journal ACK 未记录**：重启仍绑定原路径，会把后续保存写回原文件。`documentJournal.ts` 的 save intent 恢复现核对 documentId/epoch、原 binding、捕获 revision、目标完整文件及引用附件 version；只有磁盘版本精确匹配才补认新的 savedRevision/binding，较新 durable 保存记录、外部正文/附件变化都不被旧 intent 覆盖。聚焦故障注入先红后绿 11/11，`DocumentHost` 与 Markdown Save As 9/9，Electron 类型检查通过；原始用例在 `output/g20/m11/t04/*.json`。独立审查另补干净文档覆盖已有目标时的 post-rename SIGKILL，恢复后新绑定与重复恢复幂等，再次编辑只写新目标、原文件未变（临时复核夹具 `C:/Users/74755/AppData/Local/Temp/g20-m11-review-clean-overwrite-fZfcP6`）。据此 M11-T04 的 fault-injection 工程验收恢复 `passed`；不推断 Windows 断电目录持久性或 Electron 恢复界面也已验收。

S12-T05 的 `tests/integration/g20S12ExternalDiskChangeWindows.test.ts` 使用独立 Windows Node 进程直接改写磁盘文件，果铃在有未保存教师稿时保持 revision/History/正式回执不变；保存发出 saving→failed/file-conflict，磁盘外部稿与本地未保存稿均保留。重启恢复本地稿仍遇冲突，Save As 写新路径且不覆盖外部文件；显式选择磁盘版本生成新的 History，Undo 可回到原稿。M11 Journal 修改后重跑 2/2，通过 S12-T05 的 Windows 文件边界用例；未把这条宿主服务证据外推成可见 Electron 冲突提示或外部 CLI 客户端完整链路。

## 同日追加：长记录前台性能与计时口径

S11-T04 的固定样本在可见前台 Electron 中 1/1 完整执行，原始 `output/g20/s11/long-record/run-Oya29n/evidence.json`、`history-and-documents.png`：10,000 条持久事件、40 场景、256 KiB Markdown，经 10 轮编辑/保存/切换/工具展开及 blob 读取、旧历史搜索/前一页、关闭重开后全部保留；事件游标前后同为 10,000，0 页面错误、0 模型请求。双 RAF 可见回显：聊天输入 21.8 ms（1 次）、课件切换 p50/p95 80.6/224.5 ms（10 次）、Markdown 切换 24/136.7 ms（10 次）、正文输入 39.9/265 ms（10 次）、工具展开 26.7 ms、blob 26.9 ms、旧历史搜索 64.2 ms、前页 31.1 ms。Electron workingSetSize 原始计数 Browser 258892→489388、Tab 322456→580560，十轮波动不可外推为长期无泄漏；此前透明后台窗口约 3 秒的 RAF 节拍是测量环境问题，只保留为功能证据，不算用户前台延迟。S11-T04 的性能测量和无删功能保全项据此登记 `passed`。

S11-T01 仍为 `not_run`。对真实 `run-jBhDpt` 的只读 timing 审计找到点击/send、附件准备、Engine/payload 编译、8 条模型请求准备/派发/首事件/首内容、9 条工具起止、首显、一次正文提交和 run end 共 64 个标记；第一条 request.prepared 位于点击后约 2124 ms，其中点击到 send 约 2010 ms，不能把这段隐藏在 requestPrepared 前当模型延迟。输入图 274,446 字节，图片工具可见约 40.56 秒区间。图片 API 自身 dispatch/首事件、逐请求完成、save.started 与同一主任务中图片应用/保存/重开计时尚未连齐；后续保存落在另一 task 的两个 save 标记中。当前只能据实分段，不称全程计时验收通过。

S14 首次生成稿保留原样。`output/g20/s14/salvage/salvage-copy.ts` 通过正式 DocumentHost/Gateway 对副本一次 batch、一次 History 修改 6 个已有 Native 对象，复制品 `output/g20/s14/salvage/run-jBhDpt/截图生成原生课件-排版修复.h5lesson` 保存、关闭、新 Host 重开并通过 8 对象矩形正面积相交 0、7 文字与 1 图片及图片资源字节不变；原始首次结果未改。此为结构修复，真实窗口的换行、可读性和 Owner 视觉结果待验证，不把人工副本重写成首轮模型正确。

图片工具结算又经独立 Astra 复核：真实 `ImageGenerationService.stop()` 可返回 `status=unknown, stopped=true, failure.outcome=unknown`，先按停止态判定会放行新调用编号重复付费请求。已改为未知副作用优先于停止展示，既阻断同次运行，也把风险带入继续运行的 no-replay 集合；补停止后未知及新编号测试，图片工具状态、M13 构建状态、S05 恢复目标回归合计 18/18 通过，无新增网络请求。

## 同日追加：会话管理与重命名后的文档绑定

M07-T06 的 `tests/e2e/g20M07SessionRailManagement.spec.ts` 在独立 Electron profile 中 1/1 通过（约 1 分钟），原始 `output/g20/m07/session-rail-management/run-u2LqCH/evidence.json`、`session-rail.png`。左侧两条会话可新建、搜索、重命名、切换与删除；收起右助手再恢复仍指向同一会话，草稿保留，续作共两个 run、fixture HTTP 请求恰好两次。关闭两个文档后 tab 为零，删除 B 会话后 A 留存，两份 Markdown 文件原文仍在，窗口错误 0。按左栏管理及文件/会话正交的实际窗口合同登记 M07-T06 `passed`；此项使用本地 fixture，无真实供应商请求。

S09-T01 的 `tests/e2e/g20S09TreeRenameSave.spec.ts` 在独立 Windows Electron profile 中 1/1 通过（17.9 秒），原始 `output/g20/s09/tree-rename-save/run-Xnwhdz/evidence.json`、`renamed-and-saved.png`。一份 dirty Markdown 和一份打开的 V9 课件在资源树内重命名后，原先签发的宿主 AI 工具句柄继续应用，Undo/Redo 有效；两者只写新路径，旧路径消失，V9 从新路径重读，冻结会话引用及草稿在刷新后保留。按重命名后继续 AI 编辑、保存和身份保持的 Electron 合同登记 S09-T01 `passed`；AI 调用使用直接 Gateway 夹具传输，无模型网络或费用。

M10-T06 的 `tests/e2e/g20M10ExplorerDensity.spec.ts` 在当前布局的独立 Electron 窗口补拖拽后单条 1/1（约 1.1 分钟），原始 `output/g20/m10/explorer-density/run-iDeSpi/evidence.json`、三张截图和 `run.log`。资源管理器顶部只有“新建”“刷新”，右键可新建、复制、剪切、粘贴、重命名与移到回收站，Enter 打开文件；真实文件 drag 到子目录、目录拖入自身后代被拒且原路径不变、目录 drag 回根并保留子文件。图片、视频和音频在树内可见；同轮已通过的 M03-T07 Slide/Flow/Spatial 3/3 从资源树 dragTo 画布、受管资源和 V9 保存重开的实际证据继续适用，不因 M10 入口密度变化而重跑。两部分共同覆盖 M10-T06 的 Electron 合同，登记 `passed`。未调用收费模型。

S14-T03 的首次真实模型产物 `run-jBhDpt` 仍保持原始 `failed` 结论。其修复副本另在全新隔离 Electron profile 实际打开，`output/g20/s14/salvage/run-jBhDpt/visual-T4vPSN/status.json` 和 `salvage-desktop.png` 记录 1280×720 画布、7 个原生文字与 1 张原生图片均完整显示，屏幕图层矩形正面积重叠 0，标题、副标题、三项输入标签与左下说明可读，窗口错误 0；文档为 clean revision 3。该次只打开检查，原稿和副本文件摘要均未变，模型与生图请求 0。这证明人工修复副本的当前视觉布局达到工程候选，不把它写成模型首轮正确、互动课件验收或 Owner/教师已接受；原任务只要求三项 Native 文字，未要求标签点击反馈，图片中的文字仍为栅格。

S14 首轮质量独立只读归因另发现两项待修的生产工具接入缺口：`ToolTargets.childTargets` 从 document/surface/location/owner 均未暴露 course-background，模型无法从文档句柄发现 Gateway 要求的背景句柄，首轮错误尝试 owner.background；图像工具 schema 暴露 `moderation`、JPEG/WebP 与 xhigh/max 等当前冻结 OAuth provider 会拒绝的参数，首轮 `moderation:auto` 是本地未发送失败。三项 Native 标签的 `height=62,padding=24,fontSize=24,overflow=shrink` 导致实际约 11px，且只写 `backgroundColor` 未写默认 0 的 `backgroundOpacity`，所以透明；渲染器按合同执行，不以改 renderer 默认值掩盖。当前结果卡已允许明确 frame，但默认建议仍不避让既有对象。上述是后续 producer/能力投影修复线索，不改变原始 `failed`、人工副本视觉结果或任何未实跑状态。

S11-T01 的新计时接线在 `ImageGenerationService` 保留参考图准备、provider 准备、fetch 调用、响应头、上游终态和本地资源处理的主进程同钟标记，Engine 投影真实 job ID、逐请求终态，DocumentSaveEvents 记录保存开始/结束；非流式图片不伪造首内容，提示词、凭据和原始响应不进入诊断 timing 或模型上下文。独立 Astra 用无付费反例又发现停止撤权后图片时间丢失、资源落盘失败误叠加上游 unknown、停止等待凭据时实际未发送被记 unknown；原代理已修并补聚焦用例，S11 8/8、既有图片 7/7 与主/Electron TypeScript 检查通过。Astra 再独立重演原三个最小反例均通过：ENOTDIR 不再重复上游终态，凭据解析期间停止后 fetch=0 且保留 not-sent，图片 fetch 后停止仍保留 6 个原始标记而 revision 不变。上述证明当前接线和故障归因的确定性本地层行为，不会反向补齐旧真实 run 的缺失标记；S11-T01 正式 `not_run` 保持至新的真实任务验证。

## 同日追加：原位正文生成的本地实窗闭环

统一桌面构建 `output/g20/b07/build-closeout-20260923.log` exit 0。M06 修复 `EditSession` 开始时原正文尚显示、但受保护选区被缩到零宽提示点而可被人工覆盖的问题：显示锚点与 protectedFrom/To 分离，ProseMirror/CodeMirror 的过滤、位置映射和光标避让继续保护原目标，非目标人工编辑仍可进行。聚焦单元 7/7，通过主/E2E TypeScript。

`tests/e2e/g20M06InlineGeneration.spec.ts` 在上述统一构建的独立 Electron 窗口 4/4（约 3 分钟），原始 `output/g20/m04/selection-5YJxVD/m06-stop.json`、`selection-pN4OTU/m06-flow.json`、`selection-F1rrkN/m06-undo.json`、`selection-Wc4QEq/m06-final-only.json`。Flow 正文在本地 SSE complete 之前原位呈现，正式 Gateway 仅一次提交、revision 0→1，工作区没有外部 candidate/replacement；Markdown 原位路径由同轮既有实窗正文流证据覆盖，故 M06-T02 登记 `passed`。停止后迟到工具尾包不应用，原人工修改与 revision/History 保留，M06-T03 `passed`。一组生成仅一组 History，随后人工修改另成一组，按序 Undo/Redo 后保存重开原文一致，M06-T04 `passed`。只最终输出参数的本地模型用例 UI 明示“仅完整操作更新”，只在完整 text.replace 后提交，无打字动画/聊天片段伪流；已配置流式路径的原位预览在 T02 可见，M06-T05 `passed`。以上均为本地 SSE 与正式宿主事务的工程行为，M06-T01 真实支持模型首片到可见≤200ms 仍 `not_run`，不以本地夹具代替真实模型性能。

S13-T01 的真实 API 用例原计划经同一执行器生成、故意编译失败、读诊断后修复并正式导入。`ControlledBuildService` 现对 Component 内容校验值不符给出当前真实 digest 和 `project.json` 修复指向，本地聚焦 1/1、E2E TypeScript 通过。唯一一次以 TeamoRouter、请求模型选择 `deepseek-flash` 启动的 Electron 尝试在组合初始化约 1.4 秒处收到通用 `EXECUTION_FAILED`，没有 runId、工具/准入收据或 usage；临时 profile 被测试 finally 清除，无法证明是否发出供应商请求或绝对零费用，不能推断实际使用模型。`output/g20/s13/real-api/last-failure.json` 保留该尝试。代理没有重发付费请求，现已把测试拆成 connection/open/workspace/conversation/draft/send 阶段并在失败时保留脱敏诊断，供后续有可证伪新假设时继续；此轮没有完成 S13-T01 正式真实模型合同，仍为 `not_run`。

M08-T05 的焦点与混合粘贴在统一构建的隔离 Electron 窗口最终 1/1 通过，`output/g20/m08/paste-focus/run-WA6OVo/evidence.json`、`focus-and-three-attachments.png`：正文粘贴只进正文，聊天文本只进聊天；HTML 图片+文字在聊天保留文字“混合说明”且仅形成 1 个图片附件，Windows CF_HDROP 双文件后共 3 个附件且用户原文件不变。真实 Windows IME 合成中的 compositionstart 与 Ctrl+V paste 都记录为 trusted、聊天输入保持焦点，文字进聊天、正文不变、附件数不增，renderer errors 0。此前两次同用例红来自 Windows 前台恢复/抢焦点测试夹具，已修 helper 的焦点线程附着与清理后绿；产品源码未再为测试而改。相关单元 4/4、主与 E2E TypeScript 通过。按电子窗口合同登记 M08-T05 `passed`，不外推为其他输入法及 Owner 视觉接受。

## 同日追加：工作台四类插入与画布内就地属性

M03-T07 的真实 Electron 聚焦用例总计 5/5：`g20WorkbenchPropertyOwner.spec.ts` 1/1（`output/g20/workbench-property-owner/run-3jARof/properties-after-reopen.png`）、`g20ImageResultsUI.spec.ts` 1/1（先前 `output/g20/s14/image-ui/run-7xocrE/evidence.json`）、`g20WorkbenchMediaOwner.spec.ts` Slide/Flow/Spatial 3/3（`output/g20/workbench-property-owner/media-regression-playwright`）。分别观察文字、图片、视频、音频插入与资源树拖入、现有文字直接编辑、图片替换/裁剪、音视频播放设置、尺寸/层级、Flow 段落和音频替换、多选删除、同一 History 撤销重做以及 UI 保存、关页、资源树重开后资源字节一致；AI 生成原生图片回到工作台后使用相同选中属性入口。E2E TypeScript 通过，原有效媒体证据未因新增布局重复全套运行。

视觉复核发现旧 `NativeSelectionContext` 把长属性浮层按整个窗口钳位到 y≈8，覆盖顶部空间栏和文件工具栏。现按实际 `<main class="workspace">` 画布矩形和浮层实测大小选上下/侧边位置，过高时浮层内部滚动；定向单测 6/6。最新 `g20ImageResultsUI.spec.ts` 在统一桌面构建中 Electron 1/1，截图 `output/g20/s14/image-ui/run-nD68as/ai-native-light-properties.png`，同目录 `ai-native-popover-bounds.json`：浮层 `(x377.97,y419,w340,h285)`，画布 `(x245,y209.5,w817,h502.5)`，工具栏底 y208.5，四边均在画布内；从浮层打开就地 AI、填写要求并确认发送可用。图片结果卡同次展开按需落位，填写 X760/Y380/宽400/高280，正式 `media.insert` 回执后 Native frame 与输入一致，撤销/重做、保存关页后树上重开一致，`image-result-placement.png` 为实际卡片截图。替换路径仍使用原 `media.apply`。据此 M03-T07 的功能及这处已发现视觉缺陷登记 `passed`；课件艺术质量和 Owner 视觉接受仍独立。
