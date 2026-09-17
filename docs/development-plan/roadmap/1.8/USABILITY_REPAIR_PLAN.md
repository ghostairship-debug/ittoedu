# 1.8 可用性整改：视口、绘制、组件源码修改与剩余基线

2026-09-07，依据 Owner 最新反馈定位并更新方案。本轮只完成调查、隔离样例复现和开发文档更新，未实施下面的产品修复。已有工作区修改继续保留；前轮修复范围见 [聊天与 Flow 修复记录](../../reviews/chat-flow-usability-2026-09-07.md)。

当前安排由[三表面架构整合与路线调整方案](../../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md)统一承接：保留本页U01–U11/R01–R09编号、结果与证据，R01/R06可独立先交付；Flow坐标、Spatial重复绘制纳入正式Owner迁移，人工/AI包修改汇合后接线。新增15个1.8节点已进入manifest与版本规格，1.9–2.0新增扩张等待1.8整合与S3；没有实施下面的新修复，也没有新增active状态。

目标仍是删除页面不丢控制器、Flow顶部可编辑、同内容的编辑/运行/适用导出一致。新增调查确认人工同版本包源码writer与正式替换规则冲突，以及Flow段落对齐/行距到DOCX的投影遗漏，分别随共同包Owner和段落语义包闭合。Flow旧16:9浮层与响应式正文的政策冲突见整合方案D1：推荐响应式文档尺度，但未代Owner批准；不以字段未变宣称旧视觉不变，也不要求独立修复等待该选择。

Owner 随后明确：本次缩放需求针对**试运行与预览**。编辑态已有或缺少缩放不作为本项需求的完成依据；本计划不另行新增 Flow 编辑态缩放任务。

本轮Owner最终补充：整课缩放优先从非Component/Runtime区域的手势/键鼠发起；动态区域优先内部逻辑，仅明确无冲突时转交，未知不接管。教师控制器有独立可见的“缩放”按钮，展开缩小/倍率/放大/恢复面板；播放区域底部横向、右侧纵向边条用于平移整个观察视图，Runtime铺满画面或占用内部拖拽时仍可操作。按钮、边条与手势共用同一临时view状态，控制器/边条固定且可达，缩小/resize后校正偏移；边条不重复修改Flow正文scroll，也不能只移动Spatial world而漏掉global Runtime。从外部或按钮发起整课缩放时，控制器以外全部内容和字体同比放大，控制器不变，答案/焦点/实例进度不重置。 这是主动观察缩放；窗口resize的响应式排版另行处理。

同日继续补充：Flow 组件从浮层转入正文受阻，以及专业开发中组件 `Runtime.js` / `Manifest.json` 不能直接修改，分别纳入 U10/R08 与 U11/R09。本轮仍先定位和更新方案；人工代码编辑与 R05 的 AI 代码修改共用工程组件包的正式事务路径。

当前实施状态补充：U07/U08的Codex调用与OpenCode格式修复已完成，基础聊天及组件源码各两轮真实流程通过；修复前事实保留用于解释问题，当前证据见[CLI修复记录](../../reviews/1.8-cli-call-format-repair.md)。

## 1. 已定位的问题与证据

| 编号 | 当前结论与影响 | 定位证据 | 优先级 |
| --- | --- | --- | --- |
| U01 | Flow 浮层可以被拖到顶部坐标，但其绘制层与选框层被居中 16:9 区域裁剪，顶部正文区域因此无法正常放置、选中浮层。 | `FlowWorkspace.tsx` 的正文铺满实际视口；`flow/FlowOverlayAuthoringLayer.tsx` 的 `overlayPlaneStyle` 对全部浮层/选框使用固定 1280×720、居中缩放和 `overflow:hidden`。真实拖拽后对象位置已变，目标点仍命中标题。 | P1，用户可见创作受阻 |
| U02 | Flow 正文与浮层分别使用实际 CSS 排版和固定画布缩放；窗口变化时，文字与浮层相对尺寸、顶部间距发生变化。试运行与整课预览均有此根因。 | 正文共用 `flowBodyPresentation`，而 Published 浮层独立调用 `fitPublishedFlowLayers`。同一课例稳定后的两种窗口测量见下表。不是两条 Published producer，也不能只提高 z-index。 | P1，创作与播放结果不一致 |
| U03 | Flow paper-space 浮层的滚动和纸张偏移仍有独立坐标换算。 | 编辑侧 `overlayCardStyle` 在父层缩放前减去 CSS `paperScrollTop`；运行侧也减 `article.scrollTop`，且另加 `paperInset`。缩放不为 1 时滚动单位不一致；本轮源码已定位，尚未补长文滚动手势复现。 | 随 U01/U02 同批，避免保留同一根因 |
| U04 | Spatial 编辑态共享横幅的深色圆角卡片是独立绘制实现造成的，用户截图中的差异不是单纯位置偏移。 | `SpatialLocationWorkspace.tsx` 的 `renderHudLayer` 固定深底、白字、13px、圆角和居中；`spatialNativePaint` 将 Native 文本化为字符串。运行侧使用正式 Native painter，保留文本样式。 | P1，用户可见样式错误 |
| U05 | Slide/Flow 的试运行与整课预览缺少主动缩放，Spatial 运行态已有自由相机缩放；需要统一播放中的观察操作。 | `coursePlayerTryRun.ts`/`publishedStageFit.ts` 只按容器自动 fit，未提供用户 zoom；Flow 的 wheel 处理文档滚动，Slide 无对应播放 zoom 入口。Spatial runtime 已有相机缩放模型。已核实 Slide 编辑态的 100%→110% 按钮，但它与本项需求无关。 | P2，播放观察能力与一致性 |
| U06 | 工程包含完整组件包，但当前聊天快照未交付被选组件的源码工作副本，也未给出包替换所需的精确目标。 | `courseProjectArchive.ts` 保存/恢复包文件；`generationSnapshot.ts` 只有工程包元数据、目录摘要和实例 targets；`CandidateStaging.create` 只落请求及 Skills。`component.package` 已有整包替换、引用实例准入及资源事务，却要求精确 `componentPackageAddress`。 | P1，已嵌入组件的内部修改链路受阻 |
| U07 | OpenCode 新传输首轮生成/应用成功，第二轮非法 JSON 被正确拒绝；缺少候选标记也曾导致无候选。格式错误没有进入既有唯一一次修复机会。 | [前轮记录](../../reviews/chat-flow-usability-2026-09-07.md)；`CourseChatPanel.tsx` 在取得合法 candidate 后才进入 `captureGenerationRepair`，候选解析异常在其外部直接退出。 | P1，真实多轮编辑失败；严格拒绝本身正确 |
| U08 | 当前 Codex 真实请求超时；旧 exec 对照同样超时，不能据此认定新适配器独有故障，也不能宣称当前真实 Codex 通过。 | 前轮新旧传输对照及失败记录。Claude 当前完整纵切已通过。 | 外部服务/验收阻断，暂不定为产品 P1 |
| U09 | 删除 include 可见范围中的最后一个页面，会删除对应全局条目，历史用例中的教师控制器因此消失。 | 当前 `globalEditorStore.test.ts:410` 聚焦重现失败；`courseReferenceCleanup.ts/removeDeletedLocationVisibility` 对空 include 执行 `entries.splice`，`deleteSlideSceneFromDraft` 调用该清理。不是仅测试投影漏显。 | P1，删除操作意外影响全局控制器及其配置 |
| U10 | Flow 组件浮层已有“转回正文”入口，但普通插入没有后备图，转换因此被拒绝；缺少从实际组件自动生成后备图并完成转换的闭环。 | `FlowPropertiesPanel.tsx:802` 的按钮连接 `convert-overlay-to-document`；`flowSharedAuthoringAdapters.ts:798` 要求有效 `staticFallbackAssetId`。`insertComponentPackagesAtTarget` 未传入该资源，普通插入默认浮层；属性入口只调用同步转换，不提供生成后备图步骤。 | P1，受支持的组件正文创作流程受阻 |
| U11 | 专业开发将所有未标记 `editableCopy` 的工程包设为只读；Flow 正文组件还无法被面板解析为当前组件。 | `DeveloperTab.tsx:697` 仅以 `editableCopy === true` 开放两个代码框；`editableComponentPackage.ts/assertEditableComponentPackage` 在写入端再次拒绝。面板组件 target 只来自 `selectedNodeId + unifiedRows`，Flow 的 `selectSelectedNodeIds` 仅返回 overlay IDs，遗漏正文 block；创建副本也只查 LayerItem。 | P1，工程内组件源码的人工编辑受阻 |

## 新增 U12 / R10：场景与步骤导航分层

Owner 2026-09-07确认“步负责场景内部播放次序，场景只负责场景跳转”。当前scene.next按location相邻项推进，Spatial camera和Flow anchor被当作场景；控制器缺独立step动作，Published翻页笔authored-command也落到相邻index。以上为实施前根因；现已由唯一导航投影及strict步骤动作修复。定为当前导航语义/操作结果问题，不因架构因素抬高为核心不可用。

完整结果、兼容边界、唯一Owner、写域和精确验收见[导航分层工作包](r18-085-navigation-levels.md)。R10衔接R01全局控制器保全、R02/03三表面生命周期和R04观察控制：同画布镜头走步骤，跨画布才换场景；步进到首末边界自动进入相邻场景，目录分层；重播回场景起始步骤，恢复视图只改zoom/pan。键盘/翻页笔/动态接口一并对齐，旧deep link和显式location跳转不丢。

DAG新增r18-085→086→087，r18-060另等087；r18-083已通过范围不作废。085–087已实施并通过真实Electron/离线HTML验证，见[导航结束记录](../../reviews/1.8-navigation-level-exit.md)；CLI修复独立记录。

### 实际窗口与拖拽证据

使用独立 Electron profile 与 `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson` 的副本；未操作教师原工程。浏览器 CSS viewport 为 1427×865，截图具有设备像素比，数值以下表 CSS px 为准。对应证据保留在仓库当前目录的 `output/viewport-diagnosis/`。

| 测量 | 编辑 / 当前位置试运行 | 整课预览同一 Flow 页，布局稳定后 |
| --- | --- | --- |
| Flow 实际视口 | (246,95)，847×721 | (0,0)，1427×865 |
| 浮层可绘制区域 | 顶部 217.28，高 476.44，缩放 0.661719 | 顶部 31.16，高 802.69，缩放 1.114844 |
| 标题 | 顶部 147，688×51.20 | 顶部 52，688×51.20 |
| 共享横幅 | 顶部 225.22，317.63×29.12 | 顶部 44.53，535.13×49.05 |

编辑时标题位于浮层裁剪上界之上。把“Flow 视口共享层”从 y=237.13 拖到 y=148.00 后，其对象 bounding box 确实移动，但落入父层 y=217.28 以上的裁剪区；目标位置 `elementFromPoint` 命中“证据链”正文。见 `../../../../output/viewport-diagnosis/flow-drag-clipped.png`（历史链接目标未保留）。

同一宿主中的 Flow 编辑与当前位置试运行，标题和横幅的几何在此样例中一致；整课预览的正文标题维持同样尺寸，横幅则增大约 68.5%。问题是正文和浮层不遵循共同的缩放规则，不能把窗口更大解释成所有差异都合理。见 `../../../../output/viewport-diagnosis/flow-edit.png`（历史链接目标未保留）、`../../../../output/viewport-diagnosis/flow-run.png`（历史链接目标未保留）、`../../../../output/viewport-diagnosis/flow-preview.png`（历史链接目标未保留）。

整课预览从课程起点开始，当前位置试运行从当前 location 开始；上述比较已将预览切到同一个 Flow location。首次切入后一个瞬间可读到未适配的原始浮层尺寸，等待布局帧后已缩放，不能将首帧数值写成永久失配。切场/激活后的首帧适配仍纳入 U02 验收。该 fixture 的图片在本次隔离宿主中出现资源加载错误，未将图片结果计入此轮判断。

Spatial 原因由 Owner 两张实际截图与直接 painter 源码共同确认。本轮未完成 Spatial 所有镜头、Shared/World 内容与动态 Runtime 的逐项实机复核；尤其截图中仅运行态出现的 Runtime 区域需在 U04 中核对编辑呈现合同，不能猜测为重复缩放，也不能静态替代运行结果。

### 历史失败的当前范围

本轮执行 `npx vitest run tests/unit/globalEditorStore.test.ts -t 'canonicalizes include/exclude' --reporter=dot`，结果为 1 失败、13 跳过，仍在删除 include 唯一引用页后找不到原控制器。历史独立 1.6 基线也出现同一失败，属于既有问题；本轮按 Owner 要求正式纳入整改。

过去全量结果中的另外三项已有结论：基准 HTML 随 Player 更新后其 7 项检查通过；Runtime 作者宿主和路线检查的两个超时均在唯一一次聚焦复跑中通过。保留当时证据，不恢复为三个当前缺陷，不延长时限或修改断言制造全绿。现有基线记录见 [开发记录](../../reviews/1.7-1.8-development-2026-09-07.md)。

### 组件转换与专业开发的补充定位

组件本身既支持 `ComponentLayerItem` 浮层，也支持 `FlowComponentBlock` 正文，不需要改成截图或新增一种载体。“转回正文”现在要求已有静态后备图，而正常从组件库插入的路径只创建默认浮层，没有取得该图；后续转换因而直接失败。已有后备图的组件可以走转换命令，不能把这个条件分支推广成“所有组件均无法转换”。修复应由宿主补齐真实实例的后备资源，然后保留可交互组件进入正文；后备图继续只用于正式静态用途。

组件代码也不是没有编辑器：Runtime.js 和 Manifest.json 两个文档面板都有草稿和应用逻辑，但 UI 与写入命令共同执行“必须先创建新 ID 的可编辑副本”的限制。创建副本会改当前实例的包引用，在 Slide 命名状态下还被禁用。已嵌入工程的包与外部目录源应分别处理，不能把源目录只读直接等同于工程内包不可编辑。

另有跨载体选择缺口：Flow 正文组件不属于普通图层，DeveloperTab 当前 target 解析与副本切换只覆盖 LayerItem。即使解决只读标志，正文组件仍需经过其 canonical block target 定位、修改和刷新；`validateEditableComponentPackage` 的实例作用域收集也需覆盖 Flow 正文。R09 因此不能只删 textarea 的 readOnly 或批量将元数据改成 editableCopy。

本次补充定位运行了 `flowSharedAuthoringAdapters.test.tsx` 的转换用例，以及 `developerMode.test.tsx` 的创建副本和拒绝直接改原包用例，3 项通过、33 项跳过；它们证明现有条件行为与限制，**不是新修复通过**。没有将此轮源码检查和目标单测称为真实专业面板端到端验证；点击、输入、转换失败提示和保存重开仍列在对应工作包的真实验收中。

## 2. 修复约束与成功标准

1. **共同视口语义。** Flow 的文档视口覆盖实际可用区域；正文、paper-space、viewport-space 浮层和选框从同一视口/滚动/缩放映射取得坐标。y=0 的顶部必须可绘制和可命中，不再将全部浮层局限于另一个居中的 16:9 子区域。既有 frame 与 paperSpace 仍是唯一持久数据，不新增第二套位置字段或将 Flow 扁平化为 Slide。实际布局尺度和旧共享项影响必须先按整合方案D1裁决；未批准前不能改frame解释或自动补偿旧数据。
2. **共同内容呈现。** 同一项目、location、state/camera、滚动位置与可用视口下，编辑内容、当前位置试运行、整课预览和 HTML 的文本样式、相对尺寸、位置、裁剪与图层顺序一致。不同窗口由同一规则适配；视图缩放只改变观察尺度，不能使正文和浮层各按一套比例移动。编辑选框、工具栏等作者辅助层不属于交付内容。
3. **渲染复用至真实 consumer。** Spatial shared/global 的 Native 绘制复用正式内容语义与现有 painter；组件继续挂载真实组件，Runtime 使用正式编辑/运行载体。保持 global Underlay → 当前 Surface 本地合成 → global Overlay；Flow 正文继续是语义文档流，不变为普通图层。
4. **缩放发生在试运行与整课预览。** 整课缩放优先从非Component/Runtime区域的手势/键鼠发起；动态区域优先内部逻辑，仅明确无冲突时转交，未知不接管。教师控制器有独立可见的“缩放”按钮，展开缩小/倍率/放大/恢复面板；播放区域底部横向、右侧纵向边条用于平移整个观察视图，Runtime铺满画面或占用内部拖拽时仍可操作。按钮、边条与手势共用同一临时view状态，控制器/边条固定且可达，缩小/resize后校正偏移；边条不重复修改Flow正文scroll，也不能只移动Spatial world而漏掉global Runtime。从外部或按钮发起整课缩放时，控制器以外全部内容和字体同比放大，控制器不变，答案/焦点/实例进度不重置。 Flow普通滚动、动态内部手势/输入保留，控制器面板不改变课程按钮配置；恢复观察视图不是重播。
5. **组件源码可修改。** AI 可以读取所选工程组件的完整源码/资源工作副本，形成候选，再经已有准入与唯一事务替换。实例参数修改与工程共享组件包修改需在引用/预览中明确影响范围；修改共享包时列出受影响实例。工程内完整嵌入不等于自动交付给 CLI，不能继续以“没有文件访问”为笼统拒绝。
6. **失败可恢复且不多写。** 沿用最多一次局部候选修复预算，格式错误也获得结构化诊断；普通问答不强求候选。Stop、stale、Save As、关闭工程、资源缺失与第二次失败均零工程写入。仅当前 staging 可摄取，不开放 CLI 直接改 `.h5lesson`、live Store 或任意工程目录。
7. **正文组件与人工代码编辑同样可用。** Flow 页面组件可通过可见操作转入正文，必要后备资源由宿主准备，转换前后仍是可交互组件。专业开发允许编辑当前工程内包的 Runtime.js/Manifest.json 草稿并校验应用；列出共享包影响实例，创建独立副本用于只修改某个实例，不再是编辑工程包的唯一路径。外部目录源不被回写；正文组件、页面浮层、Slide/Spatial 与 global 的选择均解析到正确包和正式 target。

## 3. 分批工作包

以下保留原整改编号和具体用户结果；实际包拆分、依赖、Owner、允许写域、删除路径及停止条件以[整合方案F/G](../../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md#f-可执行工作包)和[1.8正式DAG](README.md)为准。路线节点不是queued/active协调状态，实际启动按[工作协议](../../WORKING_PROTOCOL.md)处理，不能按本页旧批次标题推导全串行依赖。S3仍需真实教师复核。

### 第一批：保住数据，恢复画布与交付呈现

**R01 — 删除页面后的全局可见性与控制器保全（U09）**

- 正式安排：独立`r18-071-controller-preservation`，无前置；Owner：course document/history。
- 写入边界：`src/renderer/course/courseReferenceCleanup.ts`、`courseLocationCommands.ts`、控制器相关 canonical commands 及直接目标测试；不改 AI/视口。
- 结果：删除唯一引用页后控制器的稳定身份、内容、按钮配置和资源仍在，按既有有效位置规则修复可见范围，exclude 空集回到 all；一次撤销精确恢复删除前状态。核对其他全局项和 PPTX surface 共享装饰的既有清理语义，不能把所有空 include 一概改为全课显示或自动删除控制器。若正式合同与既有测试存在真实产品语义冲突，先记录具体条目再裁决，不以删断言解决。
- 验证：`globalEditorStore.test.ts` 与 `courseLocationCommands.test.ts` 的删除/引用/历史用例；再用副本实际设置控制器仅某页可见、删除该页、撤销/重做、保存重开，检查控制器及配置。直接检查 canonical 数据，不只检查投影结果。

**R02 — Flow 统一视口、纸张滚动和命中（U01/U02/U03）**

- 正式安排：吸收至`r18-074-flow-layout-authoring`，先完成共同Native内容Owner并取得D1几何政策的Owner决定；R01无技术依赖。Owner：Flow authoring/Published，单writer负责两端consumer。
- 写入边界：`FlowWorkspace.tsx`、`ui/flow/FlowOverlayAuthoringLayer.tsx`、`ui/workspaces/FlowLocationWorkspace.tsx`、共享 viewport 计算 owner、`FlowSurfaceHost.ts`、`publishedStageFit.ts` 及对应测试。若需调整共同呈现合同，将精确规则写入架构合同；不新增 V9 字段。
- 结果：一个可测试的转换入口承担 viewport、paper origin、scroll 和 zoom 的正反换算；正文、paper/viewport 浮层、选择框和手势统一消费。编辑与运行不能保留两份公式。保留正文折叠、目录定位、富文本、图表、组件实例和教师控制器行为；不能通过增加标题上方空白或放开溢出覆盖整个应用来掩盖裁剪。
- 验证：`stageViewportTransform.test.ts`、`flowWorkspace.test.tsx`、`flowSurfaceHost.test.ts` 中最相关的坐标/滚动用例；真实 Electron 在当前 847×721 内容视口与另一种宽高比下执行顶部拖动、滚动后 paper 浮层定位及选择，再比对同页编辑/试运行/整课预览。保存重开、Undo/Redo 和 HTML 按受影响位置复核，正文 DOCX 保留现有语义。

**R03 — Spatial Native 共享绘制与视口收口（U04）**

- 正式安排：共同Native Owner `r18-073`之后由`r18-075-spatial-native-authoring`闭合Native，`r18-076-spatial-runtime-authoring`单独补global Canvas API2作者consumer；不等待R02的Flow实现。Owner：Spatial authoring，动态挂载规则归Player Runtime。
- 写入边界：`ui/workspaces/SpatialLocationWorkspace.tsx`、现有 Native painter 及必要共享绘制入口、`player/surfaces/spatial/` 与直接目标测试。保持 Surface/World/HUD 的各自 owner，不把 HUD 缩放叠加到世界相机。
- 结果：移除Native固定卡片/文本化，内容接共同painter，Spatial仅负责world/HUD wrapper与命中，保留字体、颜色、对齐、透明度、旋转和尺寸。Runtime截图必须核对精确carrier：当前正式可复用的是global Canvas API2；local world/surface Runtime在Player也仍为标签/静态后备，不能写成已具备完整运行能力。global API2接现有owner/target，其他范围按明确能力缺口记录，不靠截图假通过或自动扩新协议。
- 验证：`spatialWorkspaceAuthoring.test.ts` 与相关 `spatialSurfaceHost.test.ts` 用例；使用 Owner 同一 Mixed/Spatial 工程，在同镜头/同可用视口对照编辑、试运行、整课预览，实际选择/拖动共享横幅、切镜头、操作组件、保存重开并检查 HTML。

**R04 — 三Surface试运行/预览缩放平移、动态内部优先与控制器/边条兜底（U05，汇合U01–U04）**

- 正式安排：r18-077-playback-view-controls，依赖R02布局和R03当前Native/global API2范围，Owner为Player Viewport；控制器与固定横纵边条通过同一窄port接入。
- 写入边界：既有Player view/gesture adapter及teacherControllerDom/RuntimeSession/Layout的必要呈现与接线，三workspace仅连接；不新增扩展手势协议或工程字段。
- 结果：整课缩放优先从非Component/Runtime区域的手势/键鼠发起；动态区域优先内部逻辑，仅明确无冲突时转交，未知不接管。教师控制器有独立可见的“缩放”按钮，展开缩小/倍率/放大/恢复面板；播放区域底部横向、右侧纵向边条用于平移整个观察视图，Runtime铺满画面或占用内部拖拽时仍可操作。按钮、边条与手势共用同一临时view状态，控制器/边条固定且可达，缩小/resize后校正偏移；边条不重复修改Flow正文scroll，也不能只移动Spatial world而漏掉global Runtime。从外部或按钮发起整课缩放时，控制器以外全部内容和字体同比放大，控制器不变，答案/焦点/实例进度不重置。
- 验证：按整合方案C.3/F的起始区域与焦点规则验证，特别覆盖内部自带缩放/拖拽、未知实例不接管和全屏global Runtime控制器按钮/边条；放大后仅靠边条可查看四边/四角，缩小/resize后偏移可恢复。Flow正文scroll不重复修改，Spatial观察pan移动普通HUD但world漫游不移动HUD；按钮/边条与普通区域手势改变同一view状态，恢复不重播。真实手势硬件未验不得以按钮/合成事件代替。

### 第二批：打通组件正文转换、人工源码编辑与 AI 多轮修改

**R08 — Flow 组件浮层与正文的完整转换（U10）**

- 正式安排：`r18-080-flow-component-conversion`，依赖R02的Flow定位/滚动接口，复用组件实例capture与document/resource事务。Owner：Flow placement用例，capture仍归Components，单writer。
- 写入边界：`FlowPropertiesPanel.tsx`、`FlowPropertiesContextBuilder.ts`、`flowAuthoringSlice.ts` 的转换接线、`flowSharedAuthoringAdapters.ts` 的转换 planner、组件插入/实例 capture owner 与直接目标测试；不新建 Flow carrier 或放宽 V9 后备图字段。
- 结果：选中页面组件后可见“嵌入正文”，明确放入哪个段落/小节位置；有有效后备图时直接复用，没有时由真实当前组件实例生成并校验，随后在一次事务中保存资源、创建正文组件并移除原浮层。保留包版本、props、素材、可表达的排版及相关引用，避免重复实例或丢失用户配置；转换后的选择落到新正文块。反向转换复用现有命令，核对当前实现重新分配实例 ID 后的引用清理和内容保全。全局共享项不能被此动作默默移入某一页，维持明确作用域提示。
- 验证：`flowSharedAuthoringAdapters.test.tsx` 的有/无后备图、目标过期、转换往返和事务失败用例；真实 Electron 从组件库普通插入浮层后直接嵌入指定正文位置，操作组件、重排/滚动、转回浮层、Undo/Redo、保存重开。HTML 保持互动，DOCX 的既有静态投影只出现一次；capture 失败或迟到时原浮层及工程资源不变，不用包缩略图冒充当前实例后备图。

**R09 — 专业开发直接编辑工程组件包（U11）**

- 正式安排：先`r18-078-component-package-revision`统一包修订/全部实例collector/校验/事务，再`r18-079-developer-package-targets`接专业面板；不必等R08转换才能解析已有正文target。Owner：Component Packages/Authoring，DeveloperTab只维护草稿和显示。
- 写入边界：`DeveloperTab.tsx` 的组件 target/草稿/应用、`editableComponentPackage.ts`、`commitComponentPackageAuthoring.ts`、`courseComponentPackageTransactions.ts` 及必要的正式 target adapter；与 R05 使用同一个包 replacement owner，避免人工修改和 AI 修改两套校验、历史或资源 writer。
- 结果：工程包Runtime.js/Manifest.json可直接编辑；共享修改列影响实例，独立副本仍为显式选择。不能只删editableCopy gate：当前人工路径原位改同版本字节，正式replacement拒绝同版本异内容，必须由宿主统一生成工程内修订version、更新全部引用并一次提交，删除旧writer/漏Flow的collector；细则见整合方案C.4。Flow正文、浮层、Slide/Spatial/global均解析canonical target；面板await真实receipt，切文件/切组件/Cancel/stale/失败保留草稿，后备资源与新内容一致。
- 验证：`developerMode.test.tsx`、`componentPackageManagement.test.tsx` 及 target/transaction 目标反例；真实专业面板分别输入并应用 Runtime 文字/行为修改和 Manifest 合法默认配置修改，覆盖普通工程包及 Flow 正文组件。检查当前和其他引用实例、一次 Undo/Redo、保存重开、Preview/HTML；非法 JSON、坏 JS、遗漏 entry/资源与过期目标零写入，切换文档后草稿准确。不以只放开代码框或改写旧拒绝断言作为完成证据。

**R05 — 交付工程组件源码上下文并原子回写（U06）**

- 正式安排：`r18-081-component-source-context`，依赖R09共同包owner与专业面板已证明的target边界、既有staging；不等待新模型或MCP。Owner：generation snapshot/Main staging，包修改仍由唯一Components owner完成。
- 写入边界：`generation/generationSnapshot.ts`、对应 request/profile 合同、`main/localAgent/candidateStaging.ts`/harness、`tools/componentPackageTool.ts` 的必要接线、组件快照资源读取及聊天引用/预览。包替换继续复用 `courseComponentPackageTransactions`，不建立第二 writer。
- 结果：从被选实例解析实际使用的工程包及当前版本，快照提供 manifest、源文件、样式/资源及必要依赖闭包；只读源快照和候选工作副本分离且位于当前 session staging。提供精确包目标、资源身份和 revision；修改前能看见共享包影响的实例。文件型 adapter 明确开通当前 staging 能力；stdout 型交付等价内容/严格候选，超过预算明确提示，不偷偷截断。保留未修改包文件，替换后检查全部受影响实例和资源闭包，形成一次历史事务。
- 验证：最近层采用`editorTransaction.test.ts`的snapshot/destination/prepare/apply与后序失败零写，以及`diagnosticLog.test.ts`的candidate/staging/harness；profile或CI条件测试不再充当源码/事务证据。真实聊天读取并修改已有包内部布局，保留未改文件、实例props和共享影响；Undo/Redo/重开/HTML正确，缺资源/过期/准入失败零写。当前stdout profile未启用文件candidate摄取，须选择完整等价stdout交付或明确开通当前staging文件profile，不能假称已有。

**R06 — 非法候选的唯一一次格式修复（U07）**

- 正式安排：独立`r18-082-candidate-format-repair`，复用既有generation repair预算；与R05实际重叠chat/harness写锁时串行，不需等R05实现。Owner：CLI result + chat generation lifecycle。
- 写入边界：generation result 解析、Main candidate 返回诊断、`generationRepair.ts`、`CourseChatPanel.tsx` 与直接协议测试。
- 结果：非法JSON/字段错误，以及有明确candidate-required结果合同但缺标记，产生结构化诊断并复用一次预算/原target基线；无标记是否要求candidate按整合方案F的request/result判别，不能凭scope=local-edit或选了对象猜测。纯问答无candidate仍可成功。第二次失败、Stop/stale/并发编辑立即终止，保留可读回复与错误；不自动提交、不增加模型循环。
- 验证：非法引号→一次修复成功、遗漏标记、第二次失败、修复中 Stop/stale 等针对性进程 fixture；真实 OpenCode 同一课例首轮生成、第二轮局部改动、应用、Undo、保存重开/HTML。记录首轮原始结果与修复回执，不能把 fixture 当成真实 OpenCode 通过。

### 第三批：剩余外部验证与 S3 汇合

**R07 — 当前原生传输的三 CLI 验证与验收更新（U08）**

- 正式安排：沿用`r18-050-three-cli-benchmark`，已增加R05/R06正式节点前置；S3/r18-060另等待r18-083整合结束和原PPTX两节点。Codex连接恢复可独立检查，外部阻断不冻结人工和架构包。Owner：CLI adapter/交付证据。
- 写入边界：只在新证据指出产品问题时修改具体 adapter；否则更新真实基准与 S3 记录。未经要求不修改用户模型、全局认证或 Provider 配置。
- 结果：Codex 的当前原生传输完成真实生成与继续修改；若服务仍不可用，明确保留外部阻断。OpenCode 在 R06 后补齐失败纵切；Claude 已通过且未受改动影响的证据继续有效，只有 R05/R06 改到其路径时定向复核。三 CLI 均以宿主 receipt、实际工程和导出为准。
- 验证：先一条最小实际连接/文字请求区分外部可用性，再运行缺失的真实聊天纵切；同一外部失败不无限重试。所有可用性批次与 1.8 既有必选 PPTX 节点的有效证据汇合后，才回到 S3 教师复核；不凭此文档或自动化创建 `v1.8.0 accepted`。

## 4. 调度与交付

执行按正式依赖图：R01/R06可先交付；共享Owner落定后R02与R03按独立写域推进；R09共同包修订→专业面板→R05源码快照，R08在Flow布局后闭合；R04在布局和当前动态host边界后接播放控制。R07补缺失的当前三CLI证据，与整合工程结束和原PPTX门一起汇合S3。完整逐项映射在[整合方案G](../../THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md#g-与现有整改方案逐项映射)。共享文件同一时刻只由一个writer修改，独立并行实现用隔离worktree；这些路线节点不自动创建任务卡。

每批交付说明只记录：已修复行为、实际证据、未覆盖项和下一批。针对性检查已足够决定实现时停止扩查；同一代码/依赖/验证定义下的有效证据继续复用。当前已有 Flow 媒体、AI 传输及 Skills 的混合工作区不整体提交，本轮也不提交或发布。
