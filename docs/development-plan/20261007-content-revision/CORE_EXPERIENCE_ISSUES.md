# 核心编辑体验问题：2026-10-07 Owner 反馈

<a id="startup-overview"></a>

## 启动概览

Root 开工先读本概览，再读本批问题及所链接补充。9 项均未修复；定位事实不等于真实窗口验收。实施以当前会话明确指令为准，发行继续暂停。

1. [文件关闭、显式保存、History 与悬浮按钮](#issue-01)。
2. [MD / Flow 表格与共同顶栏](#issue-02)，连同[分节答案互动未闭环](#supp-native-section)。
3. [文字光标、状态/镜头增删与公式输入](#issue-03)。
4. [快捷属性入口](#issue-04)，含 [Spatial 属性 rail 打不开](#supp-spatial-properties)。
5. [HTML 编辑范围与模式反馈](#issue-05)，含[编辑模式吞单击](#supp-html-click)。
6. [Flow 控制台收展、拖动与快捷动作](#issue-06)，含[试运行未启动 Runtime](#supp-flow-run)。
7. [旧正文恢复稿不匹配阻断当前保存/关闭](#issue-07)。
8. [三表面视口与同一控制台跳变](#issue-08)，与第 6 项同根收口。
9. [整窗关闭：放弃更改与恢复稿选择](#issue-09)，与第 1 项保存策略一起解决。

记录日期：2026-10-07。定位基线：`D:/果铃工作台` 当前 main `162aee26` 及已保全的未提交候选。下文保留源码因果、必要边界和最小验收方向；[Owner 原始反馈](#owner-feedback)作为来源，不是默认开工阅读段落。本次仅调整文档导航与阶段文案，不代表产品开发已开始。

## 已定位的直接原因与收口方向

<a id="issue-01"></a>

### 1. 文件关闭、保存、History 与悬浮按钮

- **关闭阻断有明确源码因果。** [App.tsx](../../../src/renderer/App.tsx) 对所有文档包装 `prepareCourseClose`，但后者只查询课件集合；普通文件查不到，GUI 在调用 Main 关闭前即返回失败。干净文件以及放弃修改后关闭也受影响。应按实际文档类型处理关闭前的有效输入，复用已有 Session。
- **TXT/MD 自动保存实际覆盖物理文件。** [documentFileSession.ts](../../../src/renderer/documentFiles/documentFileSession.ts) 的 `schedule` 对已有路径、非 HTML 文档在输入停止 800ms 后调用 `flush → documents.save`，撤销/重做也会安排保存。编辑事务与恢复日志已经独立存在。方向：显式保存为默认，自动保存由用户主动开启；保留自动恢复日志。
- **History 已有能力，按钮漏接。** [LessonDocumentEditor.tsx](../../../src/renderer/documentFiles/LessonDocumentEditor.tsx) 只有保存、另存为及条件 AI 撤销；TXT/MD/HTML 的键盘操作已接 `session.undo/redo`。应补可见入口，不重建 History。
- **悬浮按钮与隐藏编辑器的 portal 泄漏吻合，待实窗复证。** [WorkspaceContentHost.tsx](../../../src/renderer/lessonWorkspace/view/WorkspaceContentHost.tsx) 保持隐藏标签挂载，Markdown 没有把 active 传给 SharedEditor；[SharedDocumentEditor.tsx](../../../src/renderer/document/SharedDocumentEditor.tsx) 读取隐藏块的零矩形，[DocumentBlockHandle.tsx](../../../src/renderer/document/DocumentBlockHandle.tsx) 把按钮 portal 到 `document.body` 并夹到 `(4,0)`。方向：编辑浮层服从当前可见视图，保留文档和草稿状态。

最小验收方向：正常打开并编辑 TXT/MD/HTML，检查默认不覆写原文件、撤销/重做、保存和关闭；从有块手柄的 MD 切换标签并调整窗口，确认隐藏标签不遗留浮层。保存策略与关闭行为直接对应用户数据，不能只以按钮存在证明完成。

<a id="issue-02"></a>

### 2. MD / Flow 的表格和共同顶栏

[documentBlockCommands.ts](../../../src/renderer/document/documentBlockCommands.ts) 的共同块菜单只列段落、标题、引用、列表、代码、分隔线，没有表格，导致加号、斜杠菜单及正文菜单一起漏项。SharedEditor 的顶栏也缺表格；文件模式把源码切换放在三个点中，Flow 则直接显示。

表格解析、渲染和已有表格操作可复用。**Flow 外层轻工具栏确实已有表格插入**，经 [flowInsertCommands.ts](../../../src/renderer/ui/flow/flowInsertCommands.ts) 提交；不能把反馈写成 Flow 所有表格能力均不可用。

方向：在共同正文入口接入现有表格语义，显式统一正文/源码切换。最小验收：从实际顶栏或加号插表格、修改单元格、保存重开；不建设新的表格模型。

<a id="issue-03"></a>

### 3. 文字光标、状态/镜头和公式

- **光标可见性与落点。** [globals.css](../../../src/renderer/styles/globals.css) 设置近白 `caret-color:#f4f1ea`，而 [useSlideNativeTextEditor.tsx](../../../src/renderer/ui/workspaces/useSlideNativeTextEditor.tsx) 的编辑层是白底。双击入口传入了坐标，但文字分支没有按点击位置设置选区。Spatial 复用该 hook。此结论来自当前源码，不能推断为没有 contenteditable。方向：让光标可见并落在点击文字位置，复用现有输入/IME/草稿提交。
- **Slides 状态入口。** [SceneStateStrip.tsx](../../../src/renderer/ui/SceneStateStrip.tsx) 的 compact 分支省掉可见增删按钮，操作藏在右键；深度模式与正式 `surface.presentation.set` 已有能力。方向：轻编辑底栏露出新增及状态菜单。
- **Spatial 镜头入口。** [BottomSceneNavigator.tsx](../../../src/renderer/ui/BottomSceneNavigator.tsx) 轻编辑只有镜头导航，结构/属性栏被隐藏；深度模式已有捕获当前视角、增删镜头的 handlers。方向：露出“从当前画面添加镜头”及重命名/删除。
- **公式输入接口错接。** SharedEditor 当前只有 LaTeX 和说明；[FormulaAuthoringEditor.tsx](../../../src/renderer/ui/FormulaAuthoringEditor.tsx) 有模板、符号、预览，但其 props 与当前属性面板传入的 LaTeX 接口不一致，仍读取旧 AST。方向：模板/占位输入和即时预览，由软件生成现有 LaTeX，保留高级源码，不增加持久 AST 或写作 DSL。

最小验收方向：实际中段双击定位、输入中文、保存重开；从轻编辑入口完成一次状态/镜头增删；教师通过分式/根号等模板完成一个公式并重新编辑。

<a id="issue-04"></a>

### 4. 快捷属性入口

当前 [NativeSelectionContext.tsx](../../../src/renderer/workbench/NativeSelectionContext.tsx)、[FlowBlockQuickActions.tsx](../../../src/renderer/ui/flow/FlowBlockQuickActions.tsx) 和 SharedEditor 的真实快捷栏都无属性动作。完整属性面板已有几何、字体、图形、表格、图表和组件控件，但默认 light 把整栏隐藏，必须先找到深度编辑入口。

方向：快捷栏直接打开当前选择的已有属性面板。MD 必须绑定自己的当前文档/块，不能误用上一次课件对象的属性 context。最小验收：实际选中对象，从快捷栏打开并修改一个属性，切对象后仍指向正确目标，保存后值保留。

<a id="issue-05"></a>

### 5. HTML 轻编辑的可发现性

[htmlPreviewAgent.ts](../../../src/player/htmlPreview/htmlPreviewAgent.ts) 已提供候选目标、几何和动态节点信息；[htmlSourceLocator.ts](../../../src/main/workbench/htmlPreview/htmlSourceLocator.ts) 能判断是否准确映射到源码。但 [HtmlLightEditOverlay.tsx](../../../src/renderer/documentFiles/html/HtmlLightEditOverlay.tsx) 只把结果用于点击后的弹框，没有页面内可编辑虚线、悬停及选中标记。

现有模式按钮会变色、文案变成“完成编辑”，因此不能说完全没有模式状态；页面本身反馈确实不足。方向：复用现有几何和源码映射结果呈现编辑范围；DOM 候选本身不能被宣称一定可编辑。维持已有 human 正式事务，不造另一 writer。

最小验收：进入模式即可辨识可编辑范围；点击可编辑文字/图片能明确反馈，修改可撤销、可保存重开；退出模式后页面原交互正常。

<a id="issue-06"></a>

### 6. Flow 教师控制台

[FlowWorkspace.tsx](../../../src/renderer/ui/FlowWorkspace.tsx) 的编辑投影使用无导航端口且 inert 的 AuthoringChrome，缺 Slide 的独立收展入口；控制台本体仅选中，拖动绑在“移动”按钮；已有共享 NativeSelectionContext 没有在 Flow 挂载。

方向：复用控制台现有导航/选择/手势端口，让 Flow 具备直接收展、本体拖动及共同快捷动作，不另建控制台状态。最小验收：在 Flow 实际选中、拖动、收展控制台并试运行导航，保存重开后布局保留。

<a id="issue-07"></a>

### 7. 本轮新增截图：不匹配的正文恢复稿阻断当前保存

Owner 新附图显示：“发现其他版本的正文恢复稿，已保留在本机；请先恢复对应版本的 H5 演示。”子智能体只读定位、Root 核对触发源码，未运行或修复。

- [flowDocumentDraft.ts](../../../src/renderer/authoring/flowDocumentDraft.ts) 比较工程/表面/路径身份和内容 revision；不是软件版本不兼容，也不证明文件损坏。Main 已按同一存储身份读取，因此正常主要是旧稿 revision 与当前正文不一致。
- 留有未应用正文稿、随后工程版本变化，重新打开或激活对应 Flow 页可能触发。旧稿保留在本机；没有对应的直接查看/选择恢复入口，文案“请先恢复对应版本”缺可操作指引。
- [useFlowDocumentRecovery.ts](../../../src/renderer/app/useFlowDocumentRecovery.ts) 把自动恢复不匹配交给 `settle`，设置 `failed=true`，`flush()` 返回 false；[App.tsx](../../../src/renderer/App.tsx) 的 H5 保存前和关闭前均调用此 flush。当前编辑未被禁用，但保存/关闭可能因此失败；关闭红提示仅清文案，不清 failed。
- **必要边界与缺陷分开：** 不自动把旧稿覆盖新正文可防真实错恢复；将已经保留、并非当前输入的旧稿不匹配作为当前保全 IO 失败而拦保存/关闭，是核心可用性缺口。方向应是保留旧稿、明确可操作提示，让当前有效内容正常保存；不取消身份/版本保护、不自动覆盖或删除旧稿。

截图不能确定具体工程、两份 revision 或当前是否随后成功写入而清除 failed。最小验收方向：已有不同 revision 的旧正文稿时，打开当前有效工程，当前编辑可保存/关闭/重开，旧稿仍可保留；不能只验证“旧稿未自动恢复”便称恢复保护完成。

<a id="issue-08"></a>

### 8. 三表面视口与教师控制台跳变

Owner 实际观察：切换 Slide/Flow/Spatial 时，同一教师控制台位置、大小和样式不稳定。这是高频切换中的可见问题；尚未新做实窗测量。

只读定位已完成，未运行窗口或量化跳变：

- [SlideLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx) 使用设计尺寸的 page-fit，global overlay 随 stage 缩放；[SpatialLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx) 使用设计尺寸的 contain HUD，global overlay 随 HUD 缩放；[FlowWorkspace.tsx](../../../src/renderer/ui/FlowWorkspace.tsx) 则把控制台单独放在实际 viewport，通过 [flowViewportGeometry.ts](../../../src/shared/flowViewportGeometry.ts) 保持 CSS 像素尺寸、夹限边界。因此同一 authored frame 数值在三表面产生不同屏幕尺寸和边距，有明确消费差异，不必假设正式数据被改。
- Flow 作者态改挂 [TeacherControllerAuthoringChrome.tsx](../../../src/renderer/ui/TeacherControllerAuthoringChrome.tsx)，未传真实 navigation state/port。它不消费当前场景样式、折叠和原 session 拖拽偏移；共享控制台还按容器宽度换布局。Slide/Spatial 消费真实 runtime/navigation。此差异与第 6 项同根，应一起收口。
- 三表面共用默认控制台实现及主题注入，不能一概把颜色差异归为另一份 CSS。具体场景样式、容器宽度和反馈发生在编辑/试运行/Player 哪一层，仍需实际样本才能确定。

收口方向：同一控制台在当前实际可用视口中采用一致的显示尺度、边距/停靠规则和既有 navigation session；保留单份 global 身份、人工布局及教师显式设置的场景样式。内容的画布规格、流式阅读和空间相机继续按用途保留，不为控制台强改所有作品比例，不新建坐标或 dock 状态平台。最小验收方向是同一正常作品依次切换三表面，观察控制台位置、尺寸、折叠与操作；不扩比例/窗口/设备矩阵。

<a id="issue-09"></a>

### 9. 整窗关闭的放弃与待修改稿

Owner 要求整窗退出提供“放弃所有更改”，并讨论是否应取消“保存为待修改”的常规选项。

只读定位：实际按钮是 [createWindow.ts](../../../src/main/createWindow.ts) 中的“保存全部并关闭 / 保留恢复稿并关闭 / 取消”，`DocumentCloseChoice` 只有 save/preserve/cancel，**没有整窗放弃**。单标签已有 discard，不等于整窗接通。

[documentCloseCoordinator.ts](../../../src/main/workbench/documentCloseCoordinator.ts) 在显示选择前先请求 Renderer preserve；失败输入可能因此在选择前就阻断。preserve 只保全恢复资料和等待队列，不写目标文件；save 遍历 live dirty 文档正式保存。当前部分原始草稿依赖关闭前保全，不能只删按钮便宣称已经后台恢复；新增显式放弃也不能要求先成功保全所有被放弃的输入。

收口方向：常规退出提供“保存全部并退出 / 放弃未保存更改并退出 / 取消”。恢复稿继续承担自动恢复；尚未应用且无法直接保存的输入，可在具体问题发生时提供保留草稿的选择，不必占据每次退出的一级选项。显式放弃只处理本次未保存工程/文档及其对应输入、恢复状态，避免重开又恢复已明确放弃的修改；已保存作品、外部已生成成果与既有无关恢复资料不因此删除。最小验收围绕真实编辑后退出并重开核对结果，不测试所有草稿状态组合。当前未修改关闭流程或删除任何数据。

收口需注意两处直接行为：现单文档 `journal.discard` 未清对应 authoring 原始草稿及 Flow 恢复稿，不能单靠它证明整窗放弃已完成，也不能清空整个恢复目录；退出前应先停止本次仍会写回的输入/相关任务，再按归属处理被放弃的修改。当前 TXT/MD 的 800ms 自动保存已把部分修改写入物理文件，“放弃未保存”不会回退这些已保存版本，应与第 1 项显式保存策略一起解决。外部已生成图像、费用、已写导出和聊天历史不属于此次放弃范围。

## 同条核心操作链上已经发现的补充问题

- <a id="supp-flow-run"></a>**Flow 试运行未开始 Runtime 播放。** [FlowLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/FlowLocationWorkspace.tsx) 只切正文只读，未像 Slide/Spatial 调用 `runtime.setPlaying`；控制台依旧被判不可交互。属于第 6 项的实际闭环，不是另开测试矩阵。
- <a id="supp-spatial-properties"></a>**Spatial 属性栏关闭后打不开。** [SpatialWorkspaceConnector.tsx](../../../src/renderer/ui/workspaces/SpatialWorkspaceConnector.tsx) 的编辑内容入口只换 activeTab，没有打开已关闭的 rail。属于第 4 项入口接线。
- <a id="supp-html-click"></a>**HTML 编辑模式吞掉单击。** 文字候选的单击在可编辑判定前就拦截按钮/链接行为，但文字编辑要双击；容易出现既不能操作也没有编辑反馈。属于第 5 项。
- <a id="supp-native-section"></a>**原真实创作的分节答案互动未闭环。** 保存及导出保留 native section 的折叠语义和 6 个 childIds，但当前 Player 渲染为标题加常显子对象；实际点击不能展开/收起。已有真实失败证据和原作品，无需重复生图/计算/付费创作。该源代码修复方案尚未写入，不能标成已完成。

<a id="owner-feedback"></a>

## Owner 原始反馈（来源）

1. 左上角或其他区域偶发无关按钮；TXT、MD、HTML 文档标签无法关闭；TXT、MD 修改即自动保存，没有撤销/重做按钮。自动保存应由用户显式开启。
2. MD、Flow 正文顶栏及加号插入菜单缺表格；MD 顶栏的三个点仅用于切换源码，未与 Flow 统一。
3. Slides 文字没有可见光标；不能新增/删除场景状态，Spatial 镜头同样缺操作；公式输入应提供比 LaTeX 更容易使用的方式。
4. 所有快捷工具条缺属性入口，工作台编辑深度不足。
5. HTML 轻编辑无法明确判断可编辑范围和当前模式；希望像 WPS 编辑 PDF 一样，用虚线框标出可编辑区域。
6. Flow 教师控制台与另两个表面不一致：不能收展、移动依赖按钮、没有快捷工具栏。

截图依据：Owner 附图一显示工作空间左上角的 `+ / ⋮⋮` 与 HTML/TXT/课件标签；附图二显示 MD 顶栏的三个点、格式控件和公式入口，缺表格及常规 History 按钮。原附件位于 Owner 临时目录，不作为可长期依赖的工程资源。

后续新增反馈：

- 三表面视口比例不一致，切换时教师控制台位置跳变，大小与样式也有区别。
- 关闭整个果铃缺少“放弃所有更改”；Owner 同时质疑常规关闭中的“保存为待修改”是否必要。需要核对实际文案和行为，不把单标签的放弃能力当成整窗已有能力。

## 收口优先方向（非派发状态）

先恢复文件关闭/保存/历史和基本文字输入，再接齐表格、属性、状态/镜头及 Flow 控制台的正常操作，随后改善 HTML 编辑识别和公式模板；真实创作分节互动属于创作交付闭环。同时只释放有现成接口且不争写的核心叶子。这里记录方向，不冒充已派发实施任务。

已通过的计算、OAuth 和可控 provider 证据继续有效。私有端口、隐藏启动方式、额外 fixture 等支线停止扩展；保留已知失败和环境条件，不写成产品通过，也不自动抬成核心阻断。
