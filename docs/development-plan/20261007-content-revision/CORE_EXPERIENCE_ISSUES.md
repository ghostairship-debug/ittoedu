# 核心编辑体验问题：Owner 反馈与统一记录

<a id="startup-overview"></a>

## 启动概览

更新：2026-10-08。Owner 已明确全文启动 [START_PROMPT](../20261008-core-experience-unified/START_PROMPT.md)，本轮产品分批实施已开始；独立审题/review与真实验证持续推进，不逐阶段确认。决策依据为 [CORE_EXPERIENCE_UNIFIED_SOLUTION](CORE_EXPERIENCE_UNIFIED_SOLUTION.md)；原 9 项、直接补充、React P0、静态审计真实问题及新增缺口均纳入，原暂缓分类不作为排除依据。实际候选/集成/真实carrier分别记录，不因派发勾完。发行继续暂停。

后续实施的唯一入口为[可执行计划包](../20261008-core-experience-unified/README.md)，七批拆包、写域/依赖和最新GPT Pro六项补充均在其中；本文保留问题来源，不成为第二排程。

原 9 项及本轮统一包已分批实施并独立审查，当前产品源码 `95ce7eaf`。独立 T 的正式 GJS 结构／样式、HTML/H5 编辑及保存冷开、HTML→H5→普通 HTML 单次应用往返已通过；三路原 Luna/medium 续作课堂核心操作与相应冷开通过，内置最终 saved10。真实 HTML/ZIP 字体加载和主题更新通过；后续普通 HTML 正文裁切已修并实载体通过：字体加载完成后复用现有测量队列，显示视口24px，正式frame仍23px。原 probe 的限制、0bb正常出口失败及Root被反证的resolveSource假设均保留。最后多状态跨表面粘贴按Owner选择直接拒绝，定向2/2及H独立review通过；普通对象不受无关页面状态影响。没有本轮剩余实施叶或产品写锁。首次 partial、错误图、缺图和失败不回填，当前结果与证据边界以 [IMPLEMENTATION_RESULT](IMPLEMENTATION_RESULT.md) 及 [CURRENT_STATUS](../CURRENT_STATUS.md) 为准，不记 Owner accepted。下文保留启动历史及问题来源。

1. [文件关闭、显式保存、History 与悬浮按钮](#issue-01)。
2. [MD / Flow 表格与共同顶栏](#issue-02)，连同[分节答案互动未闭环](#supp-native-section)。
3. [文字光标、状态/镜头增删与公式输入](#issue-03)。
4. [快捷属性入口](#issue-04)，含 [Spatial 属性 rail 打不开](#supp-spatial-properties)。
5. [HTML 编辑范围与模式反馈](#issue-05)，含[编辑模式吞单击](#supp-html-click)。
6. [Flow 控制台收展、拖动与快捷动作](#issue-06)，含[试运行未启动 Runtime](#supp-flow-run)。
7. [旧正文恢复稿不匹配阻断当前保存/关闭](#issue-07)。
8. [三表面视口与同一控制台跳变](#issue-08)，与第 6 项同根收口。
9. [整窗关闭：放弃更改与恢复稿选择](#issue-09)，与第 1 项保存策略一起解决。

最新 Owner 反馈及当前只读定位范围见[视口、初态与轻编辑机制补充](#owner-mechanism-followup)和[HTML 导入编辑能力严重回退](#owner-html-import-regression)。这两项补充优先于下文历史收口顺序，不表示已修复或已完成验收。

原记录日期：2026-10-07。启动定位基线为 `162aee26` 及已保全候选；后续经 `f65767c2`，核心体验源码已提交为 `423a96dc`。下文保留原时点因果、必要边界和最小验收方向；[Owner 原始反馈](#owner-feedback)作为来源，不是默认开工阅读段落。最新有限事实由本概览、统一方案和实际回执承接，详细历史见 [IMPLEMENTATION_RESULT](IMPLEMENTATION_RESULT.md#核心体验本轮进展)。

## 启动历史：直接原因与原收口方向

以下为原启动基线，不代表每条仍是当前源码。现行默认 `autoSave:false`，保存/关闭已有新协调与恢复诊断；后续残余应沿现行 consumer 处理，不重新照旧根因设计服务。

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
- <a id="supp-native-section"></a>**原真实创作的分节答案互动：启动失败已有限定后续证据。** 启动 Player 曾常显 6 个子对象、不能展开/收起；后续同一 rev15 Published 数据与资源由新 Player 实际点击得到 `0→6→0→6`，同 DOM、公式/图像及缩放正常，见 [原回执](evidence/core-experience-20261007/native-section/verification.md)。保留原失败，不再写尚未修复；也不外推所有重播/初态生命周期通过。原作品未改写，无须重复生图/计算/付费创作。

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

<a id="owner-mechanism-followup"></a>

## 最新机制反馈：视口、初态与轻编辑

Owner 2026-10-07 要求先探索分析，未授权本轮直接修改产品。截图中教师控制台在工作台画布不可见，在完整编辑器可见；要求三表面、工作台、编辑器、当前位置试运行与整课预览统一视口比例和坐标机制。“回到编辑画面”应为“回到初始画面”；轻编辑应复用导入后完整编辑能力，轻的是界面，不是能力。

当前源码只读定位，尚未操作截图中的作品复现：

- 控制台共享几何抵消包含应用 fit 的父变换；Slide 按整个 canvas-viewport 夹取，却在 overflow:hidden 的 canvas-stage-stack 内绘制，夹取与裁切区域不同。Spatial 工作区和 Published 镜头消费真实容器/设计尺寸的口径不同；Flow 控制台测量高度与扣除格式栏后的实际播放区不同；整课预览仍自行适配。先前有限三表面样例通过不能证明所有入口视口统一。
- 当前返回动作重建 World，但不完整恢复展示步骤、镜头、滚动及控制台会话偏移。暂停/继续保留现场；回到初始画面需要由现有生命周期 owner 协调初态恢复，保全已提交的作者修改，不误当整课首页或工程回滚。
- H5 轻/完整位置已经共享 Workspace、DocumentSession、commands 和 History；light 强制隐藏结构/属性父 slot，部分打开属性动作还强制切 deep。应按需展开同一成熟工具，而非重新建设弱编辑内核。原 HTML 文件预览与导入后的 V10 表示另有实际边界，需沿既有导入装配、局部源码映射和正式事务复用，不双写或反复整课重导。

Owner 既定控制台要求继续有效：三表面沿原 Slides 逻辑默认收起，选中后由快捷工具条控制收展；Flow 具备同一手柄缩放能力。发行继续暂停。

<a id="owner-html-import-regression"></a>

## 最新优先问题：HTML 导入编辑能力严重回退

- **Owner 定级：P0，核心导入后编辑能力不可用。** 输入为 `C:/Users/74755/Desktop/课例/Starter-Unit-1-Hello-standalone.html`，原文件保全。Owner 实测 V9 可发现并编辑图文，仅有覆盖图片文字点选穿透至图片等少量问题；当前版本导入编辑器后成为整页单一 Runtime，图文无法被发现和编辑。
- **本轮动作：记录后优先聚焦验证与定位，参考 V9 真实 producer/consumer，不修改产品代码。** 区分保真运行载体、可编辑对象装配和运行 DOM 的源码映射；不能把能播放、保存或笼统“动态程序应整体保留”当作完整编辑能力等价。
- **待证属性：** 当前正式导入的实例结构、可编辑目标与点击/编辑路径；原文件原始呈现与图文目标；V9 对同一来源的可编辑链以及当前分叉的直接根因。只用此文件及必要的聚焦证据，不重新全量审计，不付费创作，不操作 Owner 正在使用的窗口。
- **Root 隔离实证：** 使用原文件调用当前正式 `HtmlImportDesktopService -> Gateway.applyComponentContent -> DocumentSession`，再挂载与编辑器相同的 `ComponentPlatformRuntime + prepareSandboxComponent + webContentRealmSource`，开启 `htmlAuthoring:true`，包含当前正式模块编译与资源绑定投影。导入 applied rev1，唯一内容实例为 `guoling.html-program`、无 childIds；运行页面有 33 个可见文本节点与 1 张解码成功图片，但 `authorSpots=[]`、运行诊断为空。实际切到 Conversation 2 后标题和内容变化，目标仍为 0。隔离工程正式保存 dirty=false；这证明导入/播放/保存成功与内部图文可编辑并不等价，不冒充已经修复或完整编辑器 GUI 验收。
- **直接根因一：** [SandboxComponentImplementation.ts](../../../src/renderer/components/SandboxComponentImplementation.ts:367) 的 `collectHtml` 同步遍历 live/original/projected 三棵 DOM，385 行仅递归存在静态原文对应子节点的运行节点。原文件 body 只有空 `div#root`，React 生成后代没有原始对应节点，图文报告全部漏掉；MutationObserver 重扫仍受同一条件限制。
- **直接根因二：** 同文件 772-776 行只登记能经 `locateHtmlSourceTarget` 定位原 HTML valueSpan 的作者目标。当前地址仅映射静态 HTML 文本/src，没有 V9 动态文字覆盖规则的对应正式数据和运行消费链。只放开扫描或增加 UI 框仍不能完成可保存编辑。
- **V9 对照：** 已只读核对历史基线 `027d588a3933b977cb0ef6ed9288d7aaa82d4e87` 与保留的旧 consumer。V9 同样保留整页 Runtime，但 `DomTextOverrides.samples` 从真实运行 DOM 采样，`RuntimeAuthoringTargetRegistry.collectAutoTargets` 自动发现文字/图片；文字经正式 overrides 在 React 重绘后继续生效，图片按实际 URL 回到受管资源绑定。当前内容 realm 改为 sandbox/MessageChannel，不能直接恢复旧 parent 跨 iframe 读取；应在现有内容 realm/bridge 恢复发现和持久化编辑语义，继续 V10 单一 writer，不恢复旧格式兼容、不静态拆散 React 程序。
- **证据与边界：** [复现说明](../../../output/html-import-p0-20261007/VERIFICATION.md)、[脱敏聚焦回执](../../../output/html-import-p0-20261007/verification.json)、[真实程序画面](../../../output/html-import-p0-20261007/imported-runtime.png)。本轮只更新问题记录、生成隔离诊断脚本和证据；没有修改产品源码、原 HTML 或 Owner 窗口，没有付费调用。V9 本轮为源码对照，未重新运行 V9 GUI；原文字覆盖图片点选穿透问题仍是 Owner 报告，不在本次复现中冒称已验证或已修复。

### GPT Pro 报告核对与深编辑讨论（只读分析，未实施）

Owner 要求记录上轮结论，再分析提供的 GPT Pro 报告，以及 GrapesJS/Moveable 选型、响应式与自由布局映射、第三方内容的人类/AI 对象级编辑。附件为分析材料，不替代 Owner 的执行指令。上轮真实 React 复现证据未受相关实现变化影响，继续有效，不重复运行。

- **库未实际交付，不等于能力可以省略。** 正式依赖和 active 源码没有 GrapesJS、Moveable/Selecto；GJS 仅在 `output/architecture-spike/grapesjs-20261004` 隔离原型初始化。方案内的可替换/可不引入是文档事实，不能据此倒推 Owner 已确认取消某条关键路线或等价能力。后续基线把 N00b/L08 归并为 affine/DOM 几何和测量装配证据，实际 V10 的完整几何只覆盖正式 instances；没有证明保留 HTML 内部能力被等价替代。统一方案保留普通 HTML 投影接入范围，不用“React 不靠 GJS 修”推导整条路线退出，也不恢复额外机械选型门。
- **报告主因成立，静态与动态缺口须分开。** 静态 HTML 的 sourceScope 扩到 body 时返回单 Web、children=[]；Flow coupled 也会保留完整 HTML。当前静态文本/图片仍有精确源码轻改，因此不能称所有静态保留块都完全不可编辑；缺失的是内部结构、布局和几何操作。React 程序还缺运行 DOM 图文发现和持久化编辑地址。普通 relative 容器满足 paint-order 上溯条件，但收窄每条保留规则是否保真仍需对应局部证据；报告该分支列 sticky 不精确，因为 createsContext 已先将 sticky 判为独立上下文。
- **布局映射没有形成完整当前 consumer。** 当前测量装配只在可拆对象上形成自由 frame，source-retained/program 不产生同等子实例。既有 compositionToFree、compositionResize、正常流/Flex/Grid 重排算法仍由旧 WebComposition 编辑器调用，未进入 V10 保留块操作。浏览器从 CSS 得到矩形不等于矩形可以唯一反推响应式约束；应区分设计尺寸首次/明确重作装配与已有工程局部编辑。普通课件画布对象默认自由布局，不让候选响应式规则反复重装配整页或覆盖人工位置，具体 Owner 纠偏见下段。
- **临时内部模型可以复用库，正式内容不能双写。** 建议在当前组件内容上建立可丢弃的内部对象/结构投影，复用旧布局机械算法和专业控件；普通 HTML 可用 GJS 承担局部组件/结构编辑，Moveable 只在适用区域提供手势输入，正式坐标仍归既有几何。关闭独立保存/History，事件转为局部语义操作，ACK/外部修改回到同一投影。GJS 不自动反向编辑任意 React bundle，动态内容仍需在现有 realm/bridge 建立真正可持久化的作者绑定。无需重做 V10，但内部作者目标、Web 数据与运行消费合同需要补齐，不能保证只加 UI 或任何持久字段都无需调整。
- **当前 AI 与人工内部对象能力不一致。** 当前 active AI ToolTarget 和 project 文件投影主要到正式 instance/dataPath/源码文件；单 html-program 只有 sourcePath=[] 的根映射。人工静态 authorSpot.sourceRegion 没有进入相同 AI 观察/目标/局部操作链，内部容器 style/insert/remove/reorder 也没有对应目标。仅恢复人工点选不等于第三方 AI 对象编辑完成；让 AI 改整页 HTML 或自行填写 DOM 编号不是修复。
- **目标一致性应落在同一对象地址与应用器。** 软件识别对象、维护身份与作者位置、捕获当前范围及版本，人工和内置/外部 AI 使用同一内容/样式/几何/结构语义操作。AI 负责选中对象的新内容、素材或修改意图；软件负责编码、源修改、资源登记、布局转换、正式事务、撤销、保存及重开。原生字段、静态 HTML 源、可映射程序源码/数据和动态内容规则各用实际 adapter，但不建立第二工程/History，也不承诺任意程序逻辑都可从运行 DOM 无损反推。

### Owner 纠偏：默认自由布局与第三方 AI 能力边界

- **有效交互要求：** 第三方课件画布中可编辑的普通对象默认自由拖拽、缩放，重排不是默认交互。上一轮提出 Flex/Grid 优先重排、用户明确要求后才自由定位的建议不符合 Owner 既定方向，撤回该默认建议。这不等于把富文本的每个 span 拆成独立对象，或把任意 React/Canvas 程序静态拆散；组件内部排版与 Flow 阅读顺序不因此被偷偷改写。
- **当前 AI 事实：** 不按原生/第三方来源二分。第三方导入后成为正式 V10 instances 的内容已有对象级 AI 操作；保留为单个 Web/HTML 程序的内部对象尚未打通同等观察、目标与应用链，主要仍是外层实例、数据字段或源码块级修改。显式字符串字段范围和人工 sourceRegion 精准写回不等于内部对象级 AI 编辑完成，也不能笼统称所有第三方内容都只能整文件修改。
- **软件转换方向：** AI 可用响应式 HTML/CSS 表达新建或明确重作范围的候选。软件在统一设计视口、字体/资源就绪且仍在原容器时测量全部受影响对象，解析父级变换、对象边界与裁剪，再批量装配为正式自由 frame/内部作者几何；禁止边拆边测造成累计位移。人工布局是应用后的当前几何 owner，AI 局部改内容不重测重排整页、不覆盖已有 frame。
- **精确与单一 owner：** 原响应式容器、约束及作者对象映射可保留为明确转换/重作的依据，不成为第二套同时驱动画面的布局真相。正向转换必须保持同一设计尺寸的呈现；反向根据保留的关系与约束应用，不能从裸矩形唯一猜出未知 CSS 语义。是否引入具体库和内部作者数据实现仍是待细化建议，不冒充已交付。

以上为核对后的事实与建议边界，不构成新产品实现、库安装或发行授权；下一实施验收需以同一真实第三方作品的人工局部编辑、AI 局部编辑、保全邻项、撤销及保存重开为结果单位，不以库名、内部节点数量或单独序列化成功代替完成。

### 2026-10-08 收敛方向：Runtime 内部对象级定位与编辑

- **Owner 目标：** React 课例、其他课例与组件的内部对象也可定位和编辑。普通独立对象默认自由拖拽、缩放；不要求每个 Runtime 都达到原生专业节点的全部人工能力，复杂修改可以交给 AI。用户面对的是同一对象级编辑体验，而不是先辨认原生/Runtime 再切换修改路径。此段记录讨论后的主方案，不表示本轮已开始产品实施。
- **主方案复用现有入口，不建设新平台：** 在 API5 `authoring.register`、既有目标 registry、坐标映射和 canonical transaction 上补齐内部对象作者地址与实际支持的内容/样式/几何操作。人工命中与 AI 观察得到同一对象；模型提供内容或意图，软件完成目标捕获、适配、资源及正式提交。当前运行 spot id/mountGeneration 只承担命中和生命周期，不能直接作为跨保存、重挂载的对象身份。
- **已存在的基础与未交付部分：** `runtime.ts:73` 当前 spot 只有 text/image、dataPath/sourceRegion 和观察 localBounds。`SlideLocationWorkspace.tsx:285` 已把局部 bounds 经组件 frame/父矩阵投到画布，但选中/拖拽仍是外层实例。`freeTransformGesture.ts:21,50` 已有父矩阵、拖拽/缩放、临时预览和一次手势一次历史，提交却硬编码 instance frame.set。应复用其几何计算，扩充内部目标的提交适配，不把内部目标 ID 冒充 instanceId。
- **DOM/React 默认获得基础能力：** 在现有内容 realm 内恢复动态 DOM 图文发现，并为可定位文字块、图片、卡片/容器建立持久化作者绑定。普通内容由软件处理，不要求第三方作者先手工登记私有标记。内部位置/尺寸写入所属组件的正式作者数据或已有源/数据绑定，并由同一运行投影消费；React 重绘、切回对应状态或重新挂载后继续应用。不能仅写当前 DOM style，也不能把 observed localBounds 当作者布局保存。
- **自由化与运行布局边界：** 必须在原容器内整体测量所需对象及受影响的直接布局邻项，再在该局部范围建立自由作者几何；不能只把一个 Flex 子项改 absolute，导致邻项补位，也不展开整页 React。布局 owner 明确唯一；运行动画与作者几何按既有组合语义分工，不把任意动画帧永久冻结进工程，不用持续争抢程序 style.transform 的方式实现保存。
- **组件共用入口但保留专业语义：** DOM/SVG 组件可自动发现可确认的普通目标；有专业数据的文字、表格、图表等优先使用其字段与专用 adapter，不把每个 span、表格格子或图表柱子都自动拆成可任意游离的对象。Canvas/WebGL/Phaser 等应通过同一个作者入口暴露内部对象、局部几何和数据绑定，宿主提供选择、手势与 AI 应用；不承诺从像素自动还原未知程序对象。程序保真运行，不以暂缺内部绑定为由拒绝或静态化。
- **AI 复杂修改仍沿同一目标：** 内容、结构、行为需要源码/算法修改时，选中对象连同真实上下文、所属组件数据与源进入既有 AI 路径。软件负责实例级或已授权共享范围的应用，保留未选内容与人工几何；不能让 AI 另改整份外部 HTML 后重新导入覆盖。没有内部对象地址的区域不能冒充已实现对象级修改。
- **最小充分验收：** 先以当前真实 React 课例证明内部图文可选、文字/图片可改、对象可拖可缩、邻项不意外重排，正式撤销及保存重开后保留；再证明同一内部对象的 AI 修改保留人工布局，并验证与该目标相关的一次 React 重绘/状态切回。一个通过同一 register 入口暴露内部对象的非 DOM 组件用于证明组件适配。复用已有效导入/播放证据，不机械扩展全矩阵，不将选中框、DOM 临时效果或单独保存成功当完成。

### 2026-10-08 Owner 已确认：审计相关三项产品语义

Owner 对本会话三个选择问题的直接答复是以下决定的依据。`D:/果铃审计/20261007-v9-v10-static` 的源码证据与建议分类仍分开处理；不能将另一个会话的 A/B/C/D、暂缓或产品解释视为 Owner 已决定。

- **R06，作者编辑锁：** 画布、属性和 AI 的作者修改均遵守锁定，需先解锁；运行互动与动画不受此作者锁影响。各入口必须使用同一锁语义，不保留属性或 AI 绕过锁的路径。
- **R05，完整作者对象复制：** 普通复制/创建副本保留完整作者语义，包括状态、互动及对象所属依赖，不默认为当前状态画面快照。软件维护新身份和引用映射。另设“复制当前画面”在本轮仅为建议，不因本答复自动批准新增命令。
- **R26，独立页面宿主化、耦合程序保真保留：** 第三方 HTML 创建课件时，明确独立的页面组织为宿主页；真正耦合的 React/程序保留整体与运行行为，不为强制分页破坏可用内容。程序保留整体不豁免内部对象级编辑目标，也不成为拒绝导入的理由。
- **原答复边界：** 当时只确认上述三项，R08/R22/R23 尚未答复；后续已由 Owner 按下段明确接受。阶段授权以最新会话指令为准，不因行为决定自动启动产品或解除发行暂停。

### 2026-10-08 Owner 排程纠偏：原暂缓项也需统一修复

- **有效范围要求：** 审计报告中的暂缓排期不是 Owner 的意思。原暂缓项及其他已成立的真实缺陷、已承诺能力缺口也要修，纳入同一修复排程；不能只修 A 类、默认排除 D 类或 V10 新增能力缺口。源码疑点仍按证据确定，产品行为差异仍先明确语义，不把所有旧行为差异直接当作必须恢复。
- **实现要求：** 尽可能从正确职责与整体架构消除共同根因，必要时调整抽象，不按记录编号逐个加局部补丁；规模服从问题，也不为“最优架构”重建平台或第二 writer/History。复用 V10 既有 canonical transaction、专业数据和算法，按共同 owner 分批、共享文件单 writer、重要结构独立 review，贯彻最小充分验证。
- **原讨论边界：** Owner 当时要求先解释 R08/R22/R23；这些建议在下面后续答复已确认。本轮最新指令仍是先统一分析、收敛解决方案，不启动产品代码；发行继续暂停。

### 2026-10-08 Owner 已接受剩余建议并要求统一方案

- **R08：** 设计尺寸、窗口 fit 与观察 zoom 分离；默认保留人工坐标，等比适配为用户主动操作，当前/选定/整课页面范围独立。比例不同时等比放入允许留白，不拉伸、不裁切。
- **R22：** “保存当前画面”得到固定镜头，“跟随对象”另有明确操作；当前保存 pose 后被目标 fit 完全忽略属于待修错误。跟随加偏移不是本轮修复前置。
- **R23：** 普通快捷默认适配当前有效可见内容，另保留适配全部；可见包括屏幕外但当前未隐藏且适用的对象，适配不改变显隐。
- **当前工作：** Owner 明确要求对统一问题记录、静态审计与 `CORE_EXPERIENCE_ISSUES_REVIEW_423a96dc.md` 补充意见进行统一分析，参考专业实现收敛最优解决方案。附件为评审材料，不是新增执行指令；方案见 [唯一入口](CORE_EXPERIENCE_UNIFIED_SOLUTION.md)。持久内部地址、两个保存 adapter、编辑发现与常态消费、几何语义及七批共同 owner 统一承接全部真实问题。
- **后续架构评估：** Owner 又提供 `ARCHITECTURE_CONSOLIDATION_REVIEW_423a96dc.md` 要求评估统一架构思路。其共同运行宿主、外层 presentation、正文共同用例、视图生命周期及五维解耦已并入同一方案；这是基于真实重复职责的必要整合，不另建万能编辑器。控制台按共同 HUD 投影，不继承三表面内容各自 fit；正式作者 frame 和各视图状态仍有原归属。持久绑定作用域、重挂载解析与先人工覆盖后 AI 续改的有效值协调也已补齐；方案审查不等于产品实现验收。

## 收口优先方向（非派发状态）

原启动顺序保留为历史；后续以统一方案的七个职责批次和真实 React 纵向链路组织，非重叠就绪叶可并行，不逐编号打补丁、不因旧暂缓分类遗漏问题。当前只是方案和文档，没有派发产品实施。

已通过的计算、OAuth 和可控 provider 证据继续有效。私有端口、隐藏启动方式、额外 fixture 等支线停止扩展；保留已知失败和环境条件，不写成产品通过，也不自动抬成核心阻断。
