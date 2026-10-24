# 统一选中、整体拖动、双击编辑方案

日期：2026-10-24。源码核对基线：`main`／`63992093a`；调查开始时工作区干净。状态：**方案与只读探索已完成；Owner随后明确“按照方案执行”，已按方案实施并完成本轮验收，见[RESULT](RESULT.md)。**

本文件是本轮唯一方案，保留目标、裁决、迁移与验收定义。原“只写方案”阶段已完成；当前Owner授权按本方案实施、相关检查和实际验证，最终实施及证据见[RESULT](RESULT.md)。下文“本轮仅方案／未来验收／不运行”等措辞保留为前置方案阶段的事实，后续执行以本段最新授权和RESULT为准。不修改用户作品原件，不调用付费模型，不commit／push／打包／发布；10月23日的本地提交授权不自动延续到本轮。

## 1. 目标与已确定决定

用户能够看懂当前选中了什么，直接拖动该对象，明确进入和退出内容编辑；工具条、选框、键盘和内部字段操作始终指向同一目标。

Owner已确定：

1. 单击选中；按下并拖动可直接完成选中＋整体拖动，无需先点一次。
2. 双击进入该对象的内容或内部层级；编辑期间内部拖动交给选字、单元格选择或当前专业输入。
3. Esc／“完成编辑”回到当前层级同一对象的选中态；边缘移动仅作为可用对象的辅助入口。
4. 选中目标统一实线框；移动、缩放、旋转各自按实际能力提供，不把可移动等同于可缩放。
5. 只呈现一个当前目标的快捷工具条；整体选择作用于对象／全文，内容编辑作用于实际文字范围、光标或单元格，作用范围明确可见。
6. 前轮定位到的缺条、双路径工具条、编辑后难拖、锁定无框、虚实线与拖动入口不一致等同类问题纳入同一修复范围。

这些决定替代旧方案中“普通单击文字直接输入”“边缘作为主要移动入口”的对应规则。历史方案和RESULT仍保存原事实及有效证据，不倒写为本轮已实现。参见[旧交互方案](../../archive/统一操作体验与分层编辑整合方案-2026-10-21.md)、[组件／Flow方案](../../archive/组件体系与Flow重新抽象设计方案-2026-10-22.md)、[前轮修复结果](../20261023-editing-regressions/RESULT.md)。

## 2. 适用范围与保留行为

适用于作品创作区域：Slide、Spatial、Flow正文与浮层、全局层、程序根视图、GLX内Web／Source及已有受管嵌套iframe、独立HTML文件的创作视图。原生文字、图片、公式、表格、图表、输入组件、形状、组和容器均按同一意图解释。

工作台按钮、工具条、菜单、属性输入、源码编辑器和对话框继续使用各自正常操作；独立Markdown／普通文档文件的正文仍按文档编辑语义输入，不把整篇文件改成对象选择器。试运行、Player和离线HTML继续执行作品业务交互。创作态的作品按钮／输入框不能因HTML标签是`button/input/a`就绕过作者选择，也不能因为双击而执行业务按钮或跳转链接。

保留正式组件树、稳定作者地址、DocumentSession、现有事务／History、资源和保存／恢复链；选择与模式变化不写工程。保留可见前景命中、锁定、全局／局部平面、多选、吸附、缩放投影、连续正文、人工布局和合法作者源码。复杂Canvas／WebGL内容只使用现有真实作者绑定、参数或源码能力，不承诺任意内部图元可编辑。

## 3. 统一操作规则

### 3.1 状态与手势

| 当前状态／动作 | 目标行为 |
|---|---|
| 未编辑时单击对象 | 立即选中，显示其框和快捷条；不开输入、不修改内容、不等双击计时器 |
| 未编辑时按住对象主体并移动 | 复用现有约3屏幕像素的拖动阈值；超阈值后按当前能力移动或重排，未超阈值仍为单击 |
| 已选对象再次单击 | 保持选择；不会因“第二次单击”隐式进入编辑 |
| 同一目标双击 | 两次点击期间不产生变换；进入现有内容编辑或下一内部层级，直接给当前输入owner稳定落点 |
| 内容编辑中单击／拖动 | 在该输入范围内放光标、选字、选单元格等；不同时启动外层整体移动 |
| 编辑中按Esc／完成 | 当前输入沿原owner应用成功，或按既有明确保留稿出口退出后，回同层级同目标选中态；不丢稿、不自动升父级 |
| 编辑中点击另一个作品对象／空白 | 沿现有输入owner安全交接，然后选择新目标／清选择；不自动编辑新目标，不按旧坐标重新命中 |
| 点击快捷条、打开颜色／字体菜单 | 保持当前操作范围和输入关系；工具条焦点转移不是退出编辑 |
| 保存、ACK、失焦交接 | 沿原owner完成既有flush／保存／交接，不将settle当成显式“完成后回原目标”，不恢复旧选择或抢焦点；工具条／弹层及投影切换产生的假失焦不退出，真实离开输入按现有ACK／保稿结果结束或保留draft |
| 拖动中Esc／pointercancel／失去capture | 清当前手势预览和捕获，恢复变换前显示，不提交变换；不把“取消拖动”等同于丢弃文字稿 |
| 无变化释放／普通单击 | 无几何写入、无空History；完成拖动按最终坐标形成一次逻辑提交 |

显式“编辑”菜单、属性里的“在画布编辑”、键盘等效编辑入口，以及新增文字后直接输入，都属于明确编辑意图，继续可用并进入同一启动／结束路径。它们不恢复普通单击自动编辑的旧特例。真实交接失败保留原输入；未知结果沿原操作查证，不重放提交。这里不新增“保存必须退出”或“保存必须保持编辑”的产品规则。

### 3.2 层级与选择范围

- 组／容器在当前层级先选整体、拖整体；双击进入内部层级，再对子对象应用同一规则。真正容器复用现有上下文；普通组目前缺少该scope，按§5.1补在既有view／Bridge内的最小临时组上下文。退出内容编辑回子对象选择，再执行返回上层才选父对象。删除仅为原生文字设置的直接穿透组特例，保留明确图层定位／选择父级入口。
- 表格／图表先作为整体对象；双击进入现有单元格、标签或数据编辑范围后，内部单击和范围拖选正常工作，不要求每个单元格再次双击。
- 多选时整体移动作用于当前集合；双击一个成员时先明确该成员为当前目标再编辑。修饰键多选、框选和既有键盘操作保留，不误开输入。
- 精确author-field可以处于“选中而未编辑”状态；Esc无需一律`selectInstances(ownerId)`。只有用户明确选择父组件才抬升目标，不能将内部字段框下的移动暗中变成搬父组件。
- 容器进入／退出沿已有`enterContainer/leaveContainer`和路径UI；普通组不调用该API冒充容器。Flow自然阅读布局组仍在同一正文中，双击进入连续正文编辑，不为了统一手势另建容器、Surface或第二棵树。

### 3.3 选框与能力

| 实际能力 | 选中框／拖动表现 |
|---|---|
| 只可选、锁定、没有独立几何的内部字段 | 实线框；无变换点和move光标；锁定或能力限制可明确查看 |
| 自由移动对象／有独立作者geometry的字段 | 主体拖动；边缘可作辅助移动热区。按下前即可给出正确光标，屏幕热区不随缩放变成细线 |
| 可缩放／旋转 | 只显示真实支持的方向和手柄；每个缩放方向使用正确光标，线条保留端点／折点 |
| 正在编辑内容 | 当前对象选中关系仍有实线反馈；输入区域由当前输入owner管理。整体拖动优先经Esc／完成后从主体发起，边缘辅助若启用也必须指向该对象 |
| Flow正文段落、阅读组、随文对象 | 主体拖动改读序，显示语义插入线；只有既有宽度／环绕能力时提供对应尺寸控件，不显示无作用的八方向自由变换点 |
| Flow浮层／随段落浮层／全局项 | 使用同一选择和手势规则，保持paper／viewport／paragraphAnchor及各自投影坐标 |

悬停提示与已选中框职责分开：提示可轻描边；选中后的实线必须由正式当前选择决定，不能仍以hover开关控制。当前主目标只有一套可操作框／手柄；父级如需提示仅作上下文，不再竞争当前工具条和手势。

HTML的可移动性取决于现有独立作者geometry，不用`flow/flex`或文本类型一刀切禁止。混合富文本中没有独立geometry的text run可选、可编辑，但不能给假手柄或改写其父框。保持现有合法translate／size等源码写回能力，不建设任意CSS排版平台。

## 4. 已定位问题与同类扩查

本表“源码确认”表示当前producer／consumer、分支或状态矛盾可由源码确定，不等于已进行本轮GUI复现。用户报告的不可拖和缺条为当前体验反馈；本轮没有运行软件、测试或构建。源码行号对应上述基线。

### 4.1 源码确认的断点和规则分叉

| 编号 | 当前事实与用户影响 | 源码依据／修复归属 |
|---|---|---|
| U01 | Slide内部字段传了authorSpot，却漏authorBounds；内部几何仍在旧bounds分支，新consumer取不到anchor，工具条不渲染 | [Slide:1117](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[NativeSelectionContext:232](../../../src/renderer/workbench/NativeSelectionContext.tsx)、[SelectionQuickBar:79](../../../src/renderer/editing/quickbar/SelectionQuickBar.tsx)。接准确字段边界，不拿父组件框冒充 |
| U02 | 原生文本整体格式与内部编辑分别使用TextFormatActions和PM正文工具条，控件、位置及作用域不同 | [对象格式控件](../../../src/renderer/editing/quickbar/TextFormatActions.tsx)、[SharedDocumentEditor:1260](../../../src/renderer/document/SharedDocumentEditor.tsx)。共用展示和动作语义，保留全文／范围的正确命令适配 |
| U03 | textEditing统一隐藏外条，普通string字段又不创建内部文字条，造成编辑中无条 | [NativeSelectionContext:451](../../../src/renderer/workbench/NativeSelectionContext.tsx)、[ProfessionalContentEditor:118/145](../../../src/renderer/ui/workspaces/ProfessionalContentEditor.tsx)、[professionalContentFields:12](../../../src/renderer/authoring/professionalContentFields.ts)。按实际编辑能力给动作，不把plain字段伪装成任意富文本 |
| U04 | Slide编辑时隐藏整体和内部框；专业输入区域停止传播，外层又将其排除，主体无法转整体拖动 | [Slide:155/710/1192](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[ProfessionalContentEditor:119](../../../src/renderer/ui/workspaces/ProfessionalContentEditor.tsx)。按选择／编辑意图分流，而非靠隐藏框仲裁 |
| U05 | 文本单击进输入，内部图片进局部变换，普通对象进整体变换；原生文字还会穿透组选择 | [Slide:754](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[targets:33](../../../src/renderer/componentPlatform/surfaces/slide/targets.ts)、[workspaceSlideAuthoring:69](../../../src/renderer/ui/workspaceSlideAuthoring.ts)。退出普通pointer自动开draft和类型特例 |
| U06 | 已有边缘move热区大多未启用；`data-handle=move`还可能被handle真值分支当resize；编辑中直接露内部柄会进入外层authoring | [Overlay:28](../../../src/renderer/ui/workspaces/SlideLayerSelectionOverlay.tsx)、[Slide:803/829](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)。明确drag／resize／rotate分发，先固定目标owner，不能只传movable或删除隐藏条件 |
| U07 | Slide画框前过滤锁定对象，锁定对象可选却无框；Spatial仍画框仅隐藏柄 | [Slide:658](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[Spatial:596](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)。选择可见性与能否变换分开 |
| U08 | 内部字段虚线仅在hover时变实线，没有消费正式选择 | [globals.css:1152](../../../src/renderer/styles/globals.css)。选中态统一由当前目标投影 |
| U09 | Spatial八方向缩放点均使用nwse-resize；文字边缘也优先走输入，没有Slide的边缘例外 | [Spatial:489/597](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)。统一命中优先级和能力光标 |
| U10 | Flow普通浮层仍为上方移动按钮＋右下单缩放点，控制台为另一套边缘／多点变换 | [Flow:647/974](../../../src/renderer/ui/FlowWorkspace.tsx)。统一主要拖动入口与chrome，保留坐标／锚点owner |
| U11 | Source／Web单击、双击跨realm事件绑定到同一个handler，文字均激活编辑 | [Slide:553/602](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[useComponentAuthorInteraction:229/283](../../../src/renderer/ui/workspaces/useComponentAuthorInteraction.tsx)。必须区分select与edit，不能只改React双击 |
| U12 | realm仲裁器pointerdown立即进入selecting，move只扩文字选区；外层pointer消息缺少整体拖动生命周期 | [ownedDocumentAuthoring:110/226/385](../../../src/components/web/ownedDocumentAuthoring.ts)、[SandboxComponentRuntime:241/1431](../../../src/player/components/runtime/SandboxComponentRuntime.ts)。复用现有桥接和可见命中，补接同一手势的必要phase／pointer事实 |
| U13 | 独立HTML创作视图单击即创建文字／图片编辑层，移动靠顶部专用按钮、缩放仅右下点；iframe与宿主都有选中标识 | [htmlPreviewAgent:314/497](../../../src/player/htmlPreview/htmlPreviewAgent.ts)、[HtmlPreviewPane:379/430](../../../src/renderer/documentFiles/html/HtmlPreviewPane.tsx)。独立文件也接同一操作语义，使用准确目标几何，退出竞争的选框 |
| U14 | 独立HTML取消／关闭只清React selected，controller与iframe选择／文字隐藏未同步；完成又clearSelection丢掉选择 | [HtmlPreviewPane:351/440/450](../../../src/renderer/documentFiles/html/HtmlPreviewPane.tsx)、[htmlPreviewAgent:677](../../../src/player/htmlPreview/htmlPreviewAgent.ts)、[authoringDom:695](../../../src/components/web/authoringDom.ts)。沿输入owner恢复原文绘制并保留选中；“实际文字消失／残框”的视觉后果仍待验证 |
| U15 | 精确字段选中后键盘nudge按派生instanceIds写frame.set，可能搬动承载组件而非所见字段 | [键盘路由:105](../../../src/renderer/app/useEditorKeyboardRouter.ts)、[Bridge:364](../../../src/renderer/documents/CourseV10DocumentBridge.ts)、[crossSurfaceCommands:302](../../../src/renderer/composition/crossSurfaceCommands.ts)。键盘复用与鼠标相同的目标／能力解析，不以派生ID冒充整个对象选择 |
| U16 | Spatial按input/button/a等标签一律让出作者命中，作品输入控件在创作态可能绕过选择／拖动／双击／右键 | [Spatial:81/319/489/512](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)、[input runtime:14](../../../src/components/input/runtime.ts)。区分作品运行控件与当前作者输入，保持run语义 |
| U17 | Slide无lostcapture分支；Flow普通浮层drag不存pointerId且未完整接lostcapture／Esc；Spatial没有同一拖动阈值 | [Slide:1019](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[Flow:881/932/963](../../../src/renderer/ui/FlowWorkspace.tsx)、[Spatial:382](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)。收敛开始／完成／取消；不把静态差异直接宣称为已复现粘连或空History |
| U18 | 外部点击、blur、保存flush及显式完成散落多处分支；单纯清draft并不能保证框／条／焦点一致 | [Slide:829](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[Flow:612](../../../src/renderer/ui/FlowWorkspace.tsx)、[ProfessionalContentEditor:128](../../../src/renderer/ui/workspaces/ProfessionalContentEditor.tsx)。按结束意图区分，不一律升父、不让保存抢回旧选择 |
| U19 | 普通组被现有container路径明确省略；只选中子对象不能维持进入组后的层级，空白取消选择会丢失组上下文。新规则不能直接复用enterContainer处理group | [containerEditingContext:12/42](../../../src/renderer/documents/containerEditingContext.ts)、[Bridge:569](../../../src/renderer/documents/CourseV10DocumentBridge.ts)。在原view／Bridge补最小临时组scope，正式树和容器合同不变 |

### 4.2 仅有静态候选、尚未复现或需先核可达性的项目

| 编号 | 当前证据边界 | 后续处理 |
|---|---|---|
| C01 | Spatial异步命中可能在pointerup已结束后仍进入begin并再次capture，存在该静态路径，尚未复现异常 | [Spatial:374/488](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)。迁移时复用既有pending.ended模式，结束后不重新capture；用一条定向反例核对 |
| C02 | 富字段AI卡跳转的dataPath分支仅string时恢复interactionSelection，rich时可能只设manual／开卡；实际视觉未复现 | [ElementCardIndicator:47/61](../../../src/renderer/workbench/elementCards/ElementCardIndicator.tsx)、[ElementTextCards:180](../../../src/renderer/workbench/elementCards/ElementTextCards.tsx)、[ToolTargets:35](../../../src/core/tools/ToolTargets.ts)。核真实目标编码和路由，修已有定位owner；不放宽authorField的string合同，不凭dataPath猜类型 |
| C03 | 用户描述两套工具条；源码确定选中／编辑走两套，但正常分支有互斥，未证实稳定同时重叠 | 统一条仍属确定范围；若有同时叠加，再以实际入口定位，不把静态双路径说成已复现双条 |
| C04 | 旧WebCompositionAuthoringContent也有专用拖动按钮／单缩放点，但只找到Dialog及只读预览引用，Dialog生产可达性未成立 | [残留实现:193/243](../../../src/renderer/composition/WebCompositionAuthoringContent.tsx)。先确认可达consumer；未到达不重建旧组合平台，不据名称删除 |

U01、U03等主要接线断点在`76101357`已有；本轮核对不能以提交时间将其归因为卫生整理。上述清单是本轮有限源码覆盖，不声称全部历史UI或全部任意程序均已审计。

## 5. 根因与架构选择

共同根因是当前正式选择、是否正在输入、几何能力和事件意图没有被各直接consumer一致消费：有的按组件类型、有的按DOM标签、有的按是否有draft、有的只看派生instanceId。结果是框、工具条、鼠标和键盘各自认定不同目标。

选择保留现有交互／输入owner并集中解释意图，完成直接consumer迁移；不另建选择平台、全局工具条管理器或持久化phase。

| 选项 | 裁决 |
|---|---|
| 仅补缺失anchor、打开movable、隐藏一条工具条 | 不足：保留单击输入、realm绕过、错误目标微移和多套退出逻辑；move还可能被当resize |
| 引入第二selection store、统一万能Surface编辑器、逐段PM | 不采用：已有目标／输入／布局owner可表达所需语义，会引入双轨状态并损害连续正文 |
| 用当前选择＋当前输入事实，复用同一意图与能力派生，迁移现有consumer并退出旧分支 | 采用：统一用户规则和命中优先级，保留合法布局与持久化职责 |

### 5.1 当前事实与职责

`CourseInteractionSelection`已有objects／author-field／document，`contentEdit`或当前文档输入关系表达是否编辑，阶段直接消费这些事实；坐标、DOM range、mount generation和pending pointer保持临时视图状态，不复制正式选择。

普通组的持续内部层级是已确认缺口（U19）：在现有course view／Bridge内增加一个临时`activeGroupId`，父级路径按正式树派生，不同时维护第二份路径／子树。当前组中命中直接子项；点击空白仅清选择，不退出该组；返回上层沿正式父组收缩并选中刚退出的组。文档／Surface／真实容器切换时由原上下文owner清理或重解该事实，失效组回当前合法容器范围。实际容器继续沿现有路径与进出API；自然Flow阅读组不使用自由组scope拆开正文。此项不写Schema、工程或History。

| 决定 | 单一来源与消费者 |
|---|---|
| 当前目标／层级 | 既有interactionSelection、DocumentSelection、container editing context及原view内最小临时组scope；框、条、键盘、右键、属性、图层定位和AI跳转都消费精确目标 |
| 可移动／缩放／旋转／重排／编辑 | 从现有frame／author geometry／文档布局命令／锁定和输入能力派生；DOM边界用于画框，不凭有边界就推断可变换 |
| 选择／进入编辑／变换意图 | 在现有作者事件入口共同解释；Surface与realm适配输入事实，不分别制定“什么类型单击就编辑” |
| 内容输入、IME、flush、保稿 | 保留当前专业编辑器、文档编辑器和HTML draft owner；工具条只发明确范围命令，不另写内容 |
| 几何／读序提交 | FreeTransformGesture、AuthorSpotTransformGesture、文档block move及各原placement owner；最终canonical transaction／DocumentSession |

### 5.2 快捷工具条收敛

共用SelectionQuickBar的展示、定位和控件语义；不靠两个独立toolbar互相隐藏。当前目标及输入owner提供动作和范围，原生全文格式与PM范围格式通过窄适配执行相同含义的命令。定位使用目标实际边界，编辑中的DOM几何消失时由原owner重新定位当前地址，不拿父框偷换。

对象选中时文字动作作用于全文；进入内容编辑后作用于当前范围、光标或单元格。状态与混合格式真实回显，快捷条及颜色弹层的焦点不丢选区。plain string只显示现有可用操作和明确限制，不通过插入HTML伪造富文本能力。属性／AI／选择父组件等合法入口保留，移除竞争的局部移动条、重复正文格式条及误导提示。

### 5.3 手势与跨realm交接

主体优先级为：当前作者输入内的专业操作 → 显式缩放／旋转／辅助边缘 → 当前层级对象主体选择／拖动 → 空白框选／观察操作。选择态的作品运行控件不属于“当前作者输入”。

共同过程采用已有pending／dragging及capture生命周期：首次按下捕获可见目标的稳定作者地址、当前层级和pointer事实；异步命中／输入ACK后重解同一地址，不按旧坐标重新找对象。已释放的手势只完成合法单击或最终proposal，不重新capture。超阈值才变换，手势完成一次提交，取消只清预览。无目标、原目标消失或确切拒绝按已有反馈结束，不静默改投父组件或重放未知提交。

受管realm在作者脚本前保留同步事件裁决；把select、gesture start/update/end/cancel和edit意图区分后沿现有桥接传递必要事实。坐标仍由现有frame映射处理，不新建嵌套iframe协议平台。编辑态才让文字拖动扩选；运行态仍让页面自身按钮、输入和程序正常工作。

## 6. Flow与HTML的正确边界

### Flow

保持一个SharedDocumentEditor、一个PM正文与正式阅读布局树。单击段落／阅读组复用现有`selectBlock → NodeSelection → DocumentSelection.object`；新增的是进入输入的指针／模式仲裁，不新增选择格式，也不声称当前段落单击已经如此工作。双击把稳定落点交回同一PM。进入正文编辑后，连续跨段选择、Enter、IME、Undo均保持，不要求每段反复双击。选中态只仲裁获光标／开始输入，**不能用现有readOnly开关代替**：该开关还会关闭工具条、对象选择和段落拖柄。

主体拖动复用`DocumentBlockHandle`现有读序move与`documentBlockDropTarget`的跨组／列落点语义；拖柄保留为辅助及菜单入口，不再是唯一拖动方式。宽度／环绕沿`flowLayout`命令，浮层沿`flowPlacement`及paragraphAnchor，转浮层仍是独立显式操作。不得因拖动统一而写自由frame、拆PM或把阅读组重新变成整体原子编辑器。

依据：[Flow:169/669](../../../src/renderer/ui/FlowWorkspace.tsx)、[editorSession:302/630](../../../src/renderer/document/editorSession.ts)、[SharedDocumentEditor:1427/1515](../../../src/renderer/document/SharedDocumentEditor.tsx)、[落点算法](../../../src/renderer/document/documentBlockDrop.ts)、[布局与放置命令](../../../src/core/course/courseFlowEdits.ts)。

### HTML与程序字段

独立HTML继续区分预览运行与创作；GLX Web／Source继续复用原bridge和源码写回，嵌套／Blob carrier保持资源与文档归属。选中字段时先真实显示原文和实线框，只有开始输入才需要现有文字抑制；结束输入必须恢复该绘制并保留选择。不能用卸载React层代替清理controller／iframe输入状态。

具有独立geometry的text／image继续使用现有作者变换；没有独立geometry的混合text run不能移动父节点。Canvas／WebGL和未知程序内部只选择已注册作者字段；其余通过整体／参数／源码显式编辑，不以双击自动试运行充当编辑。

## 7. 直接消费者与旧分支退出

| 责任范围 | 必须一起迁移的现有入口 | 必须退出的旧决定 |
|---|---|---|
| 共同选择、条与框 | interactionSelection、NativeSelectionContext、SelectionQuickBar、TextFormatActions、ProfessionalContentEditor | 按textEditing一刀隐藏、纯string无条、hover冒充选中、对象／内部两套独立格式UI |
| Slide与Spatial | 两个LocationWorkspace、现有native text editor／author interaction、Overlay／workspace authoring | 普通pointer自动编辑、文字穿透组、标签一律豁免、handle真值分发、锁定过滤选框、各自光标／阈值／取消分支 |
| Flow | FlowWorkspace、SharedDocumentEditor／editorSession／DocumentBlockHandle／documentBlockDrop | 仅拖柄可重排、浮层仅移动按钮、readOnly冒充选中态、正文与局部工具条竞争 |
| 程序根／Web／嵌套realm | ProgramWorkspace、useComponentAuthorInteraction、ownedDocumentAuthoring、SandboxComponentRuntime及现有嵌套转发 | pointer／double-click同处理器、选择态拖动只选字、消息丢失手势结束、运行控件穿透 |
| 独立HTML | HtmlPreviewPane／controller、htmlPreviewAgent、CanvasPlainTextEditor、authoringDom | selected即开输入、专用移动条／单点规则、只清局部selected、选中时即隐藏文字 |
| 旁路命令 | 键盘router／crossSurfaceCommands、右键、属性显式编辑、图层／容器导航、AI卡跳转 | 用instanceIds冒充精确目标；普通定位隐式编辑；保存或ACK抢回旧目标 |

只读资产预览和未证明可达的旧组合Dialog不自动纳入产品重写。实际需要迁移的consumer必须从当前调用链确认；不能留公开可达旧手势与新入口并行，也不为字符串出现就重做历史实现。

## 8. 后续实施切片（本轮不执行）

1. **S1 共同语义与显示闭合**：在现有owner明确选择／编辑意图、目标能力和退出意图，补Slide准确边界及普通组最小临时scope，统一条／框投影。先让单击、双击、显式编辑、Esc／完成在真实Slide装配闭合；不以加一个空统一层交付。
2. **S2 自由对象与同目标命令**：接Slide／Spatial／组／全局层的主体拖动、正确手柄和取消；键盘微移及旁路命令接同一目标，退出类型／标签特例。保持原几何owner和单次提交。
3. **S3 Flow读序与浮层**：将正文选择／输入和主体重排接同一PM；浮层使用共同选框和手势，保layout／placement／锚点。S2／S3共享文件仍单writer，只有非重叠叶子才并行。
4. **S4 realm与独立HTML闭合**：沿原桥接迁移select／drag／edit、修HTML输入退出与原文绘制；验证创作不触发业务、运行仍正常。不能留“主画布已改、iframe仍单击编辑”的中间状态作为完成。
5. **S5 直接入口复核与记录**：核图层、右键、属性、显式新增文字、AI定位及快捷键；C01／C02只在相关真实路径反证，C04先判可达。移除已替代旧分支、提示与错误断言，集中独审实际候选和消费者，不重审未变有效证据。

未来最终结果在本目录新增RESULT后由当前状态指向；计划只保目标／裁决，不提前写“已实施”。实际结构候选按[工作协议§3.1](../WORKING_PROTOCOL.md)由未参与候选实现者集中review；本轮只读计划复核不等于未来实现独审。

## 9. 最小充分未来验收

本节仅定义实施后如何证明结果，**本轮不运行**。从实际用户入口选少量组合样本覆盖必要consumer；低层检查先证伪目标／命中和状态转换，真实渲染证明框、条和手势。失败或新相关变化才扩验，不机械全矩阵、不调用付费模型。

| 场景 | 必须成立的结果 |
|---|---|
| Slide真实装配：原生文本＋图片＋组内字段＋锁定对象 | 单击不开输入；主体拖动移动当前对象；双击编辑无先行位移；一个工具条；锁定仍有框无手柄；Esc回当前层级，再拖不搬父对象 |
| 文字／表格／图表范围 | 全文与局部格式范围准确、混合值真实；内部选字／cell拖选不拖外框；快捷条弹层不退出输入；显式编辑／新增文字立即输入仍可用 |
| Spatial实际consumer＋全局项 | 主体与方向键操作同一目标；作品input/button在创作态先选中；方向光标正确；观察缩放／HUD坐标不改变提交目标 |
| Flow组合样本：连续正文＋阅读组／分栏＋随文对象＋浮层 | 一处PM保持跨段输入；主体拖动改读序并显示正确列内插入线；宽度和浮层锚点正确；单击框选不被readOnly误关 |
| 独立HTML与受管nested／Blob代表样本 | 单击只选；有geometry对象主体可拖；无geometry字段不搬父；双击可编辑；Esc／完成恢复原文绘制并保留选择；只有一套可操作框／条 |
| 手势生命周期定向反例 | 复用现有阈值；pointerup早于hit／ACK仍不重新capture；取消／lostcapture／Esc清预览不提交；最终坐标不丢，无变化无空History |
| 作品业务与正式持久化 | 创作选择不执行链接／按钮；试运行正常。用实际副本完成相关文字／几何变更、UndoRedo、保存及新进程冷开；一次代表性离线运行确认作者UI不进入交付 |

现有测试的具体盲区与允许调整：

- [preciseNativeSelection20261022:27–29](../../../tests/unit/preciseNativeSelection20261022.test.tsx)手工传authorBounds，不能覆盖真实Slide漏接；需要真实Workspace装配反例，而非再给mock补一个正确值。
- [nativeCellEscapeCompletion20261022:62–88](../../../tests/unit/nativeCellEscapeCompletion20261022.test.tsx)只看输入层移除／提交，没有退出后的正式选择、框和后续拖动；补相应行为，不用消失断言代替完整退出。
- [componentAuthorInteraction20261022:64–86](../../../tests/unit/componentAuthorInteraction20261022.test.tsx)把pointer事件立即编辑写成期望。实施时依Owner本次明确行为变化调整为pointer选中／double-click或显式edit才输入；保留地址、IME、ACK和保稿等仍正确的断言。
- 复用[Flow既有浏览器装配](../../../tests/helpers/currentFlowBrowserHarness.tsx)、原实际DOM／realm夹具和保存owner；不为本轮造第二套fixture平台。类型检查、生产构建只按真实受影响consumer准备一次，通过后不因评审者更换重跑。

## 10. 本轮交付与仍未证明的事项

本轮完成标准仅为：Owner决定准确落盘，当前相关producer／consumer和同类问题有可追溯源码证据，未来切片能关闭同根旧分支，必要验收直接对应用户行为，导航明确“方案未实施”。文档只做链接、结构和差异范围检查。

未实施任何U项；C项视觉／时序后果没有本轮实机证据；没有证明全对象体验已经统一、性能改善、全部历史问题关闭或Owner接受。用户工程、恢复稿和已有未提交成果不作清理；AGENTS与正式合同不改写，当前历史结果不洗绿。计划只读复核已纠正“普通组可直接复用容器scope”及“保存／失焦一定不退出”两处过宽表述，不能将这次计划复核当成代码候选审查。
