# 架构合同：什么不能坏

> 本文是“必须守住的现状能力 + 已裁决但尚待修复的目标不变量”的唯一落点。只有改动命中相关架构边界时才补读对应条目，不要求普通任务通读全文。目标态条目会明确标出当前缺口，不能伪称已经满足。协议细节以 `src/shared/contracts/**`、Zod Schema 与源码为准；本文与源码冲突时修正本文。

## 1. 协议与版本边界

- Course Project V9 是唯一受支持的作者工程格式；不导入 V8 `.h5lesson`；不借重构创建 V10。
- V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。Table、Chart 与 Slide Native input 是 Owner 明确批准的三个新 strict discriminator 窄例外，不构成任意联合类型扩展授权。
- **1.9 Flow/共用文档特定例外（2026-09-15 Owner 决定，统一模型已切换并通过工程验证，完整交付见[实施方案](R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#44-043--050--060验收边界与当前候选缺口)）：**Owner 明确本次不保留兼容边界。按[统一正文合同](R19_SHARED_DOCUMENT_CONTENT_CONTRACT.md)直接以inlines/LaTeX替换Flow目标域，覆盖标题/段落/列表/表格/说明/章节及代码/链接表达；V9/Published严格定义、工厂与直接consumer在同一可运行批次切换，不保留旧正文/旧AST/旧工程读取转换。新课例/会话/材料记录不迁移旧格式。本例外优先于本次目标域的旧软冻结/兼容表述，不扩为删除其他Surface实际能力或创建V10。
- Published Course V2、Runtime API 2 / Surface Runtime API 3、Component API 4、Interaction Protocol V1 的版本边界保留。Table、Chart 与 Slide Native input 使用 Published V2 对等 strict 分支并与匹配 Player 成对交付，不为此升级 Published V3。
- Owner 2026-09-07批准导航分层并授权实施后，085独立窄合同增加TeacherControllerAction/InteractionAction的`step.next`与`step.previous`两个strict无参分支，V9/Published共用；不增加文档字段或第二顺序，不扩Native节点discriminator。旧动作继续可读，新动作在旧reader明确失败；scene.next/previous按已批准场景层级纠正，精确location/deep link/index接口不重解释。Runtime/Component仅additive可选步进方法，旧宿主feature-detect；实施与兼容反例见085合同。
- 项目 `id` 与单调 `revision` 语义保留；`globalLayerItems`、`surfaceLayerItems` 和三 Surface 保留；不新增 persisted `projectMode`。
- 按 Owner 2026-09-07 决定，1.8 起 AI 入口在普通内部生产构建默认显示，无需 dogfood 开关；对应版本门完成前，当前编辑器仍不得宣称 AI、聊天、Provider 或 internal/reserved 接口为可用工作流。AI 能力必须走正式 CLI harness、受管暂存、自动准入与宿主 canonical command 边界；1.8 基础聊天直接接 CLI 请求与候选结果，不建设 MCP，不能从旧接口名称直接接线。
- 1.1 在保持 V9 wire、Published V2 wire 和全部受支持行为不变的前提下，清零可执行代码、测试、脚本、示例、fixture、artifacts 与正式生成制品中的 V8 模型、Schema、旧 Player/Export payload 和旧测试工具链；历史 Markdown 与 Git 历史可保留旧名称。该清理不恢复 V8 导入，也不触发 V10。

### 1.1 内部生产信任模型

本产品运行于受控团队和受信代码环境。工程内 Runtime/Component、课件模块和批准后的自动生成代码视为可信生产扩展；网络声明、iframe、staging 和自动准入主要服务交付一致性、生命周期、资源闭包、诊断与错误隔离，不用于推导外部恶意插件模型。没有 Owner 新决定时，不新增多租户、公开插件市场、零信任审批或逐能力人工授权平台。长期 Provider Secret、原始 Electron Main、任意 OS 命令、远程脚本和未经合同批准的新宿主 API 仍不属于可信扩展授权。

## 2. Must Preserve / Must Achieve（25 组）

**零功能降级总则**：架构迁移只能替换实现和 owner，不能通过删除入口、测试、Surface、导出格式、动态 carrier、开发工作台或把真实内容静态化来完成清理。必须先交付并验证等价 V9/Published consumer，再删除旧 consumer；任一中间提交都必须可运行、可保存、可重开、可撤销、可预览并保持适用导出。当前支持能力缺失、结果错误或失败路径变得不诚实时，迁移必须停止并回滚。

### 产品能力

1. Slide、Flow、Spatial、Mixed 均可创建和编辑。
2. Flow 普通正文保持 FlowBlock 文档流；FlowComponentBlock 保持稿纸组件 carrier。图层面板与合成器以一个“正文”边界表示整份语义正文，页面浮层通过可选 `bodyPlane` 稳定处于正文下方或上方，旧工程缺字段时解析为正文上方；paragraph/heading 不进入 generic z-order，默认空 paragraph 不作为图层噪声暴露。当前不增加逐 paragraph 锚定。
3. Spatial 运行时可自由逛并支持镜头巡游，会话相机不写回工程。
4. Phaser 保持 Slide 编辑能力，不重新成为 V9 运行主路径。
5. 高级编辑、组件、Runtime、互动、媒体和代码能力不被删除；低频能力可渐进披露，但必须可发现、可保存、可撤销。
6. 全局层入口保持可发现；教师控制器保持全局单份、固定属于 Overlay，运行态会话拖拽不写回工程；2026-09-15 Owner 允许在场景作者页直接选中并编辑全局控制台，当前页面与场景状态保持不变，属性与变换仍写入同一份全局组件；全局层保留管理入口。作者页不执行播放动作。控制器在作者、试运行、Player 与 HTML 中始终高于当前 surface/scene/world 的 Native、Runtime、Component 内容，并只承担恢复、手动跳转、重播和临时越过；它可为课堂强制跳转绕过导航守卫，但课程主推进不得依赖它，也不得为它预留正文安全区。控制器与其他全局 Overlay 元素的关系仍由全局平面内排序决定。
   - 2026-09-14 经 Owner 批准：V9 与 Published V2 ComponentLayerItem 同步新增 strict 可选 role: 'teacher-controller'，仅全局 Overlay 单份。新建与恢复直接使用工程内嵌 Component API4 源码/素材；专用组件属性页管理参数、源码与恢复。2026-09-15 Owner 明确尚未生产且无兼容要求：删除 Native 控制台 discriminator、工厂、渲染器和专用编辑器，不保留转换入口或旧工程兼容分支；旧原生工程在 Schema 边界明确失败。教师控制台端口受角色、作者/捕获模式和生命周期约束，导航与观察状态仍归既有 Owner。无论透明/分散/背景融合外观，控制台独立于课件主动观察 zoom/pan、Flow scroll 与 Spatial camera；窗口尺寸、最大化切换和宿主可用区域变化仍按所在 Surface 正常适配，不能反向抵消 fit-to-window 或用整个应用窗口代替实际播放区域。源码恢复只位于属性中的折叠维护区，通过可撤销事务执行；播放画面不注入恢复按钮、隐式恢复快捷键或临时默认控制台，异常仍归组件诊断。

### 保存与运行

**Owner 2026-09-07确认并经r18-085–087实施：场景与步骤分层。** Slide页、Flow讲义与Spatial画布是内容场景；当前场景的明确呈现/讲解/镜头编排是步骤。上/下一步按整课连续序列推进，末步之后到下一场景首步、首步之前到上一场景末步，只有整课首尾停止；上一/下一场景直接跳过场景内部剩余步骤，进入相邻场景起始位置。同画布镜头不得继续被场景按钮逐个推进。目录、计数、键盘/翻页笔、交互和动态导航接口应消费同一导航语义Owner；场景/步骤切换与r18-077观察zoom/pan分离。精确location深链、合法重复进入、导航守卫及当前生命周期按[导航分层工作包](roadmap/1.8/r18-085-navigation-levels.md)明确兼容，不静默重解释既有API或创建第二持久序列。实现与直接证据见[导航结束记录](reviews/1.8-navigation-level-exit.md)；新增动作保持V9/Published strict合同。

7. Save 从已提交活动文字草稿的 V9 document、asset sidecar 和 component files 构建 archive；关闭脏判定与恢复快照使用同一份含草稿 canonical document。
8. 保存 single-flight 与"保存期间继续编辑仍为 dirty"行为保留。
9. RecoveryWriteCoordinator 的 debounce/cancel/snapshot 语义保留。
10. V9 Try-run / Full Preview 的 CoursePlayer + Published V2 主路径保留；HTML/Web 的 V2 主路径保留。
11. Player 不导入 renderer Store；Preview/Export 不反向写作者数据。
12. Component/Runtime 在保存、Player 和导出中使用一致的工程字节。
13. **Sessionless V9 是编辑错误状态**：会话缺失时返回可行动错误并允许重建，不读 `state.project` 或 V8 projection 继续导出，不静默改选另一个 nullable session；headless/script 场景必须显式接收合法 V9 输入。

### 编辑一致性

14. stable `authoringAddress` 不被临时 `hitId` 取代；禁止 DOM id、数组下标、临时 hitId 作为持久身份。
15. global/surface/scene/world owner 语义保留；跨 owner 操作不得暗中混用 viewport/world 坐标。有效合成严格分为“全局 Underlay → 当前 surface/scene/world 内容 → 全局 Overlay”，不存在全局项与本地项的逐项可编辑层级；全局排序只改变同一平面内的全局项关系。平面由带旧工程默认值的 V9 additive 可选字段持久化，不得从共享 `order` 相对本地内容最小值猜测。
16. contenteditable/IME composing 时不被无提示提交或切页覆盖。
17. 拖拽只在明确结束时形成逻辑提交。
18. 简洁/专业只是 UI 能力披露差异，不是不同工程真相；DeveloperTab 已有代码能力不得因模式整理消失。
19. 作者与交付的有效域必须闭合：任何作者端允许保存的状态都必须被 Preview、统一画布、Published Player 和适用导出接受。
   - Native materialized frame 与 authoring snapshot/patch 接受 V9 已允许的所有有限正尺寸；16px 只能作为创建/拖拽策略，不能成为同步协议门槛。零、负数与非有限尺寸继续拒绝，不通过放大合法小对象规避同步失败。
20. 公开入口必须诚实：属性、复制、粘贴、重复、拖放和错误反馈要么真实改变唯一工程并进入正确历史，要么明确不可用；禁止静默 no-op、伪成功和底层校验 JSON 直出。统一多选 Delete 必须从同一输入文档形成一次原子提交和一次选区更新，并同步清理 presentation overrides/order、互动引用与 Runtime `nodeBindings`；任何拒绝都必须零写入并返回真实失败。

### 可信扩展与网络

21. **Runtime/Component 是可信扩展，宿主能力与交付语义显式区分**：
   - 课件工程与组件包中的 Runtime/Component 代码均经审核；外部导入只是分发方式，不得据此把它们当作不可信代码；
   - 扩展可按真实 consumer 需要使用当前宿主明确提供的父页面、本地、桌面或其他能力。优先使用稳定宿主接口或同宿主执行语义，不为此建权限审批平台；
   - 现有 opaque-origin iframe 可继续承担视觉合成、生命周期和会话竞态隔离，但不是必须继承的信任/权限边界，也不得永久阻断已确认的宿主能力；
   - 外链图片、音频、视频、`fetch`、EventSource 与 WebSocket 是正式能力。工程的精确 `https`/`wss` origin 声明用于预览、发布、CSP、可移植性和诊断，不用来推导扩展不可信；
   - 远程脚本本轮不开放；长期 Provider Secret 不得持久化或写入 Published/导出物；单 HTML 的离线便携与在线轻量仍是不同导出语义。

### 工具与治理

22. contracts 和 ai-capabilities 的生成/check 保留；`.agents/skills` 两个课件工作流入口保留。
23. read-model boundary 与 forbidden-token 棘轮保留并只允许收紧。
24. 自动化最多证明 engineering candidate；未经明确教师验收不得宣称 accepted/发布。
25. 用户未提交修改不得被自动回退或覆盖。

## 3. 状态分类与唯一工程真相

### PPTX 导入 owner 映射（1.5）

导入文件创建独立 Slide Surface，源页序保持不变。母版/版式非占位装饰只进入该 surfaceLayerItems，以 include location visibility 限定引用页；同一源装饰只保存一个可编辑实例。占位符按 slide → layout（idx）→ master（type）继承几何和样式，页面正文始终属于 scene。共享装饰的 order 低于该页正文；不写课程 global 层，不扩 V9/Published Schema。隐藏母版图形与局部覆盖不得重复显示共享装饰。

可表达的共享底层 Native 在 PPTX 导出中进入对应母版；只有连续处于有效合成底部的共享内容可提升。前景、动态内容和背景图片遮挡例外保持按页输出，不能为了生成母版改变叠放。导入预览只在内存暂存，全部页与资产经同一 canonical transaction 提交；取消、失败和 stale 零写入。未支持项按页/对象报告，教师明确确认后才部分导入；不接外部渲染器，不自动生成图片后备，不把已有 Native 映射缺口冒充不可支持内容。 1.6旧`.ppt`是Owner批准的独立格式转换入口：允许调用已安装且已验证的兼容软件另存临时`.pptx`副本，再走同一原生导入事务；不覆盖原件、不执行宏/OLE，取消或转换失败零工程写入。这不恢复整页渲染后备，也不使普通PPTX依赖Office。

| 类别 | 示例 | 持久化 | 进 Undo |
|---|---|---:|---:|
| Canonical document | CourseProjectDocument | 是 | 是 |
| Binary sidecars | asset/component bytes | 是 | 是（delta） |
| Authoring identity | projectId/revision/location/surface/generation/owner | 否 | 否 |
| Surface selection | block/layer/path/camera selection | 否 | 通常否 |
| Draft/IME/drag | 文本、代码、表单、临时 frame | 不原样序列化 UI 会话；合法内容经提交或恢复物化进入工程快照 | 提交后才进入 |
| 未应用正文源文 | 未闭合公式、无效扩展等可恢复输入 | 1.9应用本地恢复稿，绑定课例/文件或工程目标与基准版本；不把非法结构写入V9 | 正式应用后进入对应历史 |
| Runtime/preview session | mount、会话相机、播放状态 | 否 | 否 |
| AI/CLI session and trace | CLI session mapping、消息、tool trace、usage、状态 | 应用本地版本化目录；不进工程 | 否 |
| AI staging workspace | 待准入 Component/Runtime 源码、manifest、诊断与候选资源 | 应用管理的本地暂存；准入前不进工程 | 否 |
| App UI | tab、dialog、path、status | 部分本地偏好 | 否 |

- 禁止把这些状态塞回一个无边界大接口；不新增第二套作者 Store、CourseAuthoringSession、History 或工程持久化模式。AI/CLI conversation session 是本地编排记录，不是第二作者会话、第二工程真相或第二历史。
- 内部实现可以用类型交集组合唯一 Store，但任何 Feature/Surface 不得接收或导出完整 `EditorState`、raw `get/set` 或 root Store hook；状态与 actions 必须由对应 Owner slice 持有。组合类型不是公共边界。
- 正常生命周期恰好一个活动 V9 Surface session（Slide/Flow/Spatial 互斥）；一次用户操作 = 一次逻辑提交 = 一条历史（文档 + 资源字节同事务）。
- 任何异步/延迟提交必须带创建时 target（projectId / sessionGeneration / location / surface / owner / item / revision），失败返回可识别 stale 结果，不写当前页面。
- 用户操作边界：pointer up 一次提交；IME composing 不提交；批量导入可为一条批量历史；自动恢复写盘与模式/Tab 切换不进 Undo。
- Native、Component、Runtime 的正式作者内容/参数，以及通过正式入口应用的源码和资源变更，均属于 canonical document / binary sidecars，必须随工程保存、恢复和重开，适用的 Undo/Redo 与 Player/导出保持同值。React 控件的局部状态只是实现位置，不能作为漏存教师修改的理由。合法活动文字草稿须参与脏判定、保存前提交和恢复快照物化；未通过校验或 IME 中不能提交时必须明确反馈并保留草稿。运行时临时交互会话与教师作者修改分别按各自所有权处理。

## 4. 模块 Owner 与负边界

| 模块 | Owns | 不 Own |
|---|---|---|
| Shared Contracts/Domain | V9/Published/Component/Runtime/Interaction 类型与纯规则 | Renderer 状态、UI、文件系统 |
| Editor Core | canonical port、authoring identity、resource delta/apply、authoring transaction/history、typed selectors | Zustand composition root、具体 Surface session/selection、Feature UI |
| App Composition | 唯一 Store 实例化、slice 接线、项目生命周期、exactly-one Surface router、跨 Feature use case 编排、错误反馈 | Feature planner、Surface writer 实现、Surface 内部模型、格式实现 |
| Slide | Scene/Layer placement、Phaser 编辑生命周期、Slide selection | Catalog、通用包生命周期 |
| Flow | FlowBlock、稿纸布局、正文合成边界、overlay placement、Flow selection | 把普通 block 变成通用图层或逐 paragraph z-order |
| Spatial | World item、camera/path/relation、Spatial selection | Player 会话相机写回工程 |
| Components | Catalog、package、props、authoring validation | Surface carrier/placement |
| Media | AssetMeta、sidecar bytes、引用与导入计划 | Surface 具体布局 |
| Runtime | Runtime definition、draft、validator、host contract | Player 反写作者文档 |
| Interactions | Rule、template、validator、authoring UI | Surface 私有布局 |
| Global Layers | global/surface ownership、严格 Underlay/Overlay 平面与平面内排序 | 全局项和本地项逐项交错排序；复制教师控制器到每个 Surface |
| Teacher Controller | 控制器作者与运行行为 | 独立持久化副本 |
| Preview | session build、mount/destroy/generation、fit | Export 格式实现 |
| Export | Published/static plan 到具体格式 | 修改作者 Store |
| Diagnostics | structural/authoring/export report | 每次键入全量分析 |
| Main/Preload | 文件、窗口、IPC、安全边界 | 作者业务模型 |
| Authoring Tools / 宿主提交 | 内部版本化工具、canonical target、候选校验、receipt、stale 与事务适配 | 模型规划循环、直接写 Store、绕过产品命令 |
| AI / CLI Harness | CLI 探测/启动/恢复/取消、标准事件、本地 session 映射、暂存协调 | authoritative project、Provider 凭据、重复实现 CLI 的 Agent loop |
| Repo Knowledge | 开发索引与 Context Pack | 产品运行时依赖 |

跨域操作不通过模块深层 import 完成，由用例层组合：`validate → Surface placement command → Core transaction → App feedback`；document + 资源字节同时变更必须是一条原子逻辑历史。方向性约束：Core 不 import 具体 Surface/Feature；Player 不依赖 renderer Store；authoring V9 → Published 单向。Composition root 可以 import 各 slice factory；slice、planner 和 Feature use case 不得反向 import composition root、`useEditorStore` 或完整 Store 类型。Feature use case 只接收所需的 target/read/commit/feedback 窄 port。

## 5. Surface carrier 矩阵

| 内容 | Slide | Flow 稿纸 | Flow overlay | Spatial | Global/Surface shared |
|---|---|---|---|---|---|
| Native | LayerItem | 对应 FlowBlock | LayerItem | LayerItem | ScopedLayerItem |
| Media | Native LayerItem ref | FlowMediaBlock | Native LayerItem ref | Native LayerItem ref | ScopedLayerItem |
| Component | ComponentLayerItem | FlowComponentBlock | ComponentLayerItem | ComponentLayerItem | ScopedLayerItem |
| Runtime | RuntimeLayerItem/scene runtime | Surface runtime 或明确 block/overlay 方案，不伪造普通 block | RuntimeLayerItem | RuntimeLayerItem/world runtime | ScopedLayerItem |

- 统一：CourseProjectDocument、projectId/revision、AuthoringTarget、Core transaction/history、asset/component 生命周期、preview/export producer 输入、authoringAddress 与 owner scope。
- 不统一：Slide scene/presentation state；Flow 文档流、嵌套、wrap 排版；Spatial world/camera/path/relation；各 Surface selection；Phaser/DOM/Spatial viewport 生命周期。
- Flow 普通 block 不进入 generic z-order owner；统一图层只呈现一个正文合成边界与其上下浮层，不把 paragraph 伪造成 LayerItem。Surface 公共入口最多提供 selector/command/placement/selection adapter/preview adapter/minimal UI entry，不建万能 SurfaceEditorService。

## 6. 模块级补充边界

- **Components**：Catalog snapshot 不是工程真相；四子域为 Catalog / Packages / Instances / Authoring。
- **Runtime/互动**：简洁模板与专业规则必须生成同一种标准 Interaction V1 规则；Automation UI 是界面不是第三套业务模型。
- **Media**：AssetMeta / sidecar bytes / carrier 三层在一次操作内一致但不混成一个对象；AssetMeta 当前无持久化 `contentHash`，不为跨会话去重新增 V9 字段。
- **全局层**：有效图层管线为 visibility filter → global Underlay（平面内排序）→ 当前本地合成（Flow 为 surface Underlay → 语义正文 → surface Overlay；Slide / Spatial 保留各自本地 carrier）→ global Overlay（平面内排序）→ rows/canvas/player；跨 owner `order` 不得泄漏成可编辑交错层级。
- **Player/Preview/Export**：V2 主路径（active document → `buildPublishedCourseV2Payload` → CoursePlayer）必须保护；无 publish sources 的 fallback 先做可达性证明，不新建 sessionless V9 read model。远程资源与 connect origin 都由工程声明派生，不能分别维护 CSP、Electron allowlist 和 Player 私有名单。Slide 对应 PPTX；Flow 对应 DOCX。一个 Published Flow Surface 输出为一份连续 Word 文档，普通作者浮层只出现一次；1.2 唯一重复例外是 global teacher-controller 同时满足 visibility all 与 `includeInStaticExports=true`，此时映射到 footer。
- **Table/Chart/Slide input**：三者是V9与Published V2匹配的strict分支。按当前Schema与本文件末尾已实现的1.3 domain，Native Table/Chart允许Slide scene/surface和Spatial world；Flow分别使用FlowTableBlock/FlowChartBlock正文，Flow overlay、Spatial shared和global不借此扩域；input仍只允许Slide scene。不得进入legacy SceneNode或改变presentation override合并语义。旧V9继续读取，旧strict reader遇新分支明确失败，不能静默丢弃或截图覆盖工程。路线批准不替代consumer证据；载体/适用导出仍按末尾domain及V9兼容策略逐项验收。
- **Native 作者态同步**：合法持久化内容、非持久化 render input、authoring patch parser、宿主 frame/type guard 与 painter 的接受域必须闭合。Table/Chart/input 不能因旧六类 render input 白名单而在新宿主中被拒绝，也不能用扩大 legacy SceneNode、`any` 强转或旁路原始 JSON 消息绕过校验。类型/校验共享同一正式 Native content 定义；ACK、stale、target 与失败定位语义保留。
- **颜色控件**：共享 ColorInput 持有局部未提交颜色，Surface/Feature adapter 持有 canonical 提交；控件身份只跟随实际编辑目标，不能跟随每次 revision 重建。连续调色预览与最终提交分离，取消/迟到/目标切换零误写，一次完成操作一条历史。1.2 的固定常用色不进入工程；1.3 项目色板复用 `designTokens.colors`，不另建主题状态或暗示当前对象已具有实时 token 绑定。
- **input.submit**：提交事件携带本次输入的原始值；Published controller 先按答案类型归一化并原子写入输入框声明的 course-state key，再对同一事件匹配规则、计算条件和执行动作。该值是事件时快照，不通过通用 Surface DOM 读值端口补读，也不改变 `course-state.set` 的 wire 或作者态 `InteractionEngine`。
- **Line/Background additive**：Line 只为既有 line/elbow shape 增加参数化可选几何；Background 只在 Course/Surface/Scene/state 既有 owner 增加兼容可选字段并使用一个共享优先级解析器。旧字段缺省行为不变，不使用 reserved-ID LayerItem 或第二 `backgroundState` 表达。
- **Diagnostics**：不预建 structural/contextual/authoring/export 框架矩阵，只处理已复现的债务。网络 finding 判断“声明与使用是否一致”，不得把合法外链本身定义为错误。
- **Secrets**：长期 API/AI Provider 密钥不属于 Course Project、Published payload、component package 或导出文件；只允许服务端代理、运行时用户输入或短期限域 Token。
- **模块与 UI**：局部问题仍优先抽首个真实 consumer 所需的最窄 seam；但命中巨石触发条件或 Owner 明确要求时，必须按正式 Owner 主动拆分，无需等待用户故障。不得以“不一次拆大文件”为由长期保留跨 Owner 状态和 writer，也不得借拆分创建设计系统、万能服务或无真实 consumer 的抽象。
- **EditorMode**：只有 simple/professional 两种；不建第三 `code` 模式、新 Code Workspace 入口或结构化 Diff。

### 6.1 主动模块化与巨石门

出现以下任一证据即进入主动模块化，而不是继续做局部代理：

- 一个实现单元持有三个及以上正式 Owner 的 state/writer；
- 出现依赖环、Core → Feature/Surface 反向依赖；
- 出现 wrong-owner 状态、跨 Surface 镜像或以某 Surface 命名却被其他 Surface 共写的资源状态；
- 完整 Store/State/raw hook 成为跨域公共 API；
- 同一热点阻断两个已批准开发 lane，或频繁造成独占写锁冲突；
- Owner 明确指定拆分。

“真拆分”必须同时满足：状态、actions、planner、transaction/use case 迁到真实 Owner；import graph/结构测试证明方向；root 只实例化和接线；旧 writer、双写、完整 Store Facade、第二 Store/Session/History 为零；直接 consumer 改用窄 selector/command port；当前保存重开、Undo/Redo、三 Surface、Preview/Player 与适用导出不降级。行数下降、文件新增、re-export 或测试只查文件名均不能单独证明完成。

`v1.1.1` 已完成 `editorStore.ts`、App/Workspace/Properties/Flow、Slide Published adapter 与 Course package builder 的既定 Owner 迁移；历史执行规格由 Git 历史保存，当前边界只看本合同、源码和 `FEATURE_CONSUMER_OWNER_LEDGER`。`buildPublishedCourse.ts`、V9 Schema/health、动态宿主和 Main/Preload 不做无 consumer 的机械拆分，后续出现真实第二 owner/consumer 时再进入同一门。

### 6.2 三表面整合的目标边界（2026-09-07，尚待实现）

[整合方案](THREE_SURFACE_ARCHITECTURE_INTEGRATION_PLAN.md)承接当前1.8的重复Native dispatch、Flow坐标割裂、Slide历史算法残留、包源码writer分裂和已支持段落语义的交付缺口；具体输入/输出、consumer迁移与退出门见方案C/F。以下为目标不变量，不表示当前源码已经达到：

- 共同Native内容Owner只负责内容规则，表面wrapper只应用一次frame/rotation/opacity并持有布局/selection；不统一为一个渲染器，不把Flow正文改为LayerItem。
- 三表面的基础document/resource历史算法归现有Core；Surface保留私有selection/session adapter，无第二Store/History。人工源码、fork、正式替换与AI包候选归同一Components Packages/Authoring准备/校验/事务；保持同版本异内容拒绝，宿主修订版本及全部实例引用一次更新。
- 既有Flow段落对齐/行距语义由正文Owner解析，编辑/Player/print/DOCX消费；不借整合引入高级排版Schema。
- 试运行/整课预览/HTML统一按以下目标边界：整课缩放优先从非Component/Runtime区域的手势/键鼠发起；动态区域优先内部逻辑，仅明确无冲突时转交，未知不接管。教师控制器展开时显示“缩放”按钮，打开缩小/倍率/放大/恢复面板；收起控制器同时隐藏缩放按钮并关闭面板，保留当前倍率和平移；播放区域底部横向、右侧纵向边条用于平移整个观察视图，Runtime铺满画面或占用内部拖拽时仍可操作。按钮、边条与手势共用同一临时view状态，控制器/边条固定且可达，缩小/resize后校正偏移；边条不重复修改Flow正文scroll，也不能只移动Spatial world而漏掉global Runtime。从外部或按钮发起整课缩放时，控制器以外全部内容和字体同比放大，控制器不变，答案/焦点/实例进度不重置。 保留原global Overlay排序/单实例，默认组件按钮调用唯一宿主观察端口，不把观察状态写为自定义课程动作；教师控制台 role 字段按本节批准的窄合同扩展；动态iframe不强制转发。100%到200%视觉文字约×2，不能反向字号/逻辑viewport/fit补偿；不改工程/历史、不重播。Spatial world先经既有camera投影，再与普通HUD共同应用一次观察zoom/pan；HUD不跟world相机漫游，但必须响应边条的整课观察平移。观察操作不再次写camera，命中/剔除使用组合逆映射；边条只表达当前视窗有限范围，不给无限世界制造总长度。Flow正文scroll与观察pan分别保留单一真相，具体范围/拖动/恢复规则见整合方案C.3。
- Flow几何的**D1已由Owner于2026-09-07批准方案A**：基准倍率1时正文与浮层采用1逻辑单位=1CSS px；窗口宽度决定正文响应式重排，paper项相对纸张布局原点随正文滚动，viewport项相对实际文档视口。主动观察缩放只在基准布局结果上应用共同矩阵，不反向调整排版宽度/字号或重建实例。接受旧Flow浮层初始投影大小/位置变化并复核旧课件，不修改持久frame数值；Slide/Spatial原页/HUD尺度保留。
- Spatial当前真实动态复用范围为global Canvas Runtime API2；本地world/surface Runtime的静态/标签呈现不等于完整执行。整合先补已支持global API2作者consumer，local/API3扩域需精确作者—运行—导出合同，不能以统一之名伪报支持。

## 7. 原生CLI、编辑器连接、暂存与会话边界

2026-09-14 设计接续：[AI 创作操作机制实施方案](AI_AUTHORING_MECHANISM_IMPLEMENTATION_PLAN.md)细化完整操作、前序依赖、发现/预检和恢复检查；新增机制尚未实施。候选字段仅在正式 strict 合同与实际 consumer 同批落地后才成为当前能力，本节既有原生权限、焦点、唯一事务与版本边界继续有效。

- **配置证据**：原生模型目录推荐值、应用按 CLI 保存的用户选择、原生有效配置与任务确认值分别管理。显式选择保存于应用本地版本化偏好目录，不进入课件；发送等待保存并冻结本轮选择，Codex 每轮显式传入所选 model/effort，默认强度仍继承原生语义。任务日志保存所选、发送及确认值，目录缓存不能冒充当前任务证据。
- **Codex 文件候选**：app-server 结构化 edit 结果允许 candidate 为 `{version:1,requestId,candidateFile:"candidate.json"}`。只有成功终态明确声明本轮引用才读取当前 request 根内固定文件；不扫描任意路径。文件内仍是正式候选，经原有身份、大小、realpath、资源和 canonical transaction 校验；旧文件、普通答复、失败或 Stop 不触发摄取。小候选可继续内联交付。

- **B0/B1冻结任务与后台应用（Owner 2026-09-11授权）**：纯浏览/换选不重定向已发出的AI任务；以原目标、工程revision、workspace、资源、task epoch及草稿一致性重校验。提交仍走唯一document/resource/History事务；教师已浏览或换选时保留当前位置/选择，未变化时采用事务结果选择，允许继续编辑替换后的新对象，不自动提交或覆盖另一页草稿。初始/修正/续轮观察的结构和图像必须同源于原目标；离屏证据只能来自正式候选/预览宿主，不能冒充live。工程变化、Undo/Redo、Save As、关闭、Stop及期限使旧候选失效，普通人工异步session约束不因此放宽。第二层media.apply展开既有媒体/内容/替换Owner；任务内文件复用仍受当轮root闭包摄取约束，具体strict输入见共同实施合同。

- **长期分工（Owner 2026-09-08）**：用户自行安装认证Codex、Claude、OpenCode；保留原生模型循环、文件/终端/网络、用户工具与连接、Skills和子任务。相同账号、配置、工作上下文和授权下，不因GUI包装默认降成只读、工具白名单或关闭终端。GUI承接原生权限请求与用户决定，不静默提权。应用做版本化adapter、会话、观察、候选摄取、回执、界面及自动准入，不预设迁往自建模型循环，不新建应用MCP/通用工具RPC平台；原生CLI已有用户连接仍保留。
- **阶段与体验**：1.8修当前工程AI基础；1.9以真实工作空间/独立课例为起点，042身份/保存、041整合工作台、045三格式课例材料、046–049共用正文/Flow/Word/文件共编、044双流程共同形成工作流。自动须成功读取实际采用材料，手动分别确认四阶段真实当前文件；构建前核对正文/附件版本，改稿使依赖旧稿的在途候选失效。外部Skill在044实际迁移前保留当前停点。2.0完成全部软件内QA/修复等步骤，长期专项不反向成为1.9前置。
- **观察与权限分开**：默认提供任务相关的不可变小观察、能力卡和必要材料，目标明确时不发送全量目录/源码。CLI可按原生授权继续查找文件、资料与Skills，观察scope不是OS权限沙箱。Task/Observation/Proposal/HostResult/UserInput由唯一Owner以strict版本合同管理；一个任务可收到多次观察和回执，由CLI决定下一步。极简/专业模式只组织入口，不建立第二工程、任务或历史，也不降低AI能力。
- **原生接线**：明确可执行文件与参数数组，不拼shell命令。保留或明确选择原生cwd、非秘密配置和运行所需环境；staging不能强制替代全部工作上下文。工具活动、授权、问题、取消、配置确认和错误按实际原生协议接回GUI。CLI管理认证，应用不复制凭据或在诊断输出secret；能力不足须诚实呈现，不伪装成功。
- **工程唯一写入路径**：编辑器消费strict typed candidate/dynamic manifest，通过结构化stdout/artifact或当前candidate staging返回；宿主重校验canonical target、revision、epoch与资源，经既有canonical commands和单一document/resource transaction提交。2026-09-14 Owner 明确选择/页面仅为输入焦点，不是授权边界；宿主工具是快捷通道。CLI 可编辑本轮冻结 V9 工作副本，经 project.document 正式制品入口回收完整文档及真实资源，复用 V9/归档闭包/动态准入检查和唯一 EditorTransaction；不受快捷命令字段覆盖限制。制品必须保留工程 ID/基线 revision，宿主只递增一次版本；禁止 raw Store 和第二 writer，snapshot 不暴露 live Store。原生文件工具完成不等于工程已应用；外部原生工具改变已打开工程的磁盘文件时，由既有打开/保存Owner处理必要的重载与保存冲突，重新取得工程事实再继续，不能静默覆盖内存或补造History receipt。
- **短传输与终态（2026-09-09）**：短操作仅是当前request内的strict投影，绑定canonical target/revision/sessionGeneration/epoch，宿主展开后仍经完整candidate和现有Facade/事务；不得引入第二工程协议、自然语言目标猜测；完整文件结果使用上述 project.document 入口，不向 live Store 发 patch。成功后finish须有实际committed或正式unchanged、必要证据和已保存回执，并贯通唯一任务状态/持久化；preview待应用不算完成，unchanged不增revision/Undo。必要observe/continue保留。已提交后记录失败只重试回执，不重提事务；无推理追加按真实原生能力，缺失时下次请求前送入，跨崩溃未知如实核实。绝对任务预算覆盖观察至提交前，等待不隐式延期。详细状态及失败合同见[共同实施合同](roadmap/1.8/IMPLEMENTATION_CONTRACT.md)。
- **任务输入与恢复（2026-09-14）**：本轮宿主提供的候选根/能力目录内真实文件读取视为任务输入，仅响应原生 allow_once，不为命令/写操作/其他目录设置自动授权；其他原生权限及显式拒绝保留。原生 CLI 在无显式代理环境配置时使用本机实际系统代理，保留 loopback 直连。编辑没有实际回执而只回复文字时记录可恢复失败，向同一原生会话反馈文件兜底路径；受原有期限/无进展预算、Stop 和只读意图约束。
- **候选摄取**：宿主只摄取当前candidate root内realpath闭合、身份相符且检查通过的内容；这不把CLI所有文件工具锁进staging。失败、Stop、stale、拒绝和迟到候选对当前未提交阶段零工程写入；先前已提交阶段保留并显示部分完成。candidate receipt与host commit receipt分开，只有后者证明应用事务成功。
- **动态准入**：Generated Component/Runtime先留暂存，经编译、协议、依赖、素材闭包、精确origin、生命周期、资源上限、静态后备与真实宿主smoke后才能注册/提交。Native、Recipe、Existing Component承担自身合同门。证据按代码、资源、配置、宿主依赖与修改影响复用；编译结果不能替代受影响互动验证。候选检查只调用当前任务必要的既有宿主动作与采样，在同一任务剩余时间和既有宿主超时内累计约束；不建设通用断言DSL，Native/props不强制附带独立检查计划。
- **扩展权限独立**：准入后的Component/Runtime获得当前正式可信扩展宿主能力，不能继承CLI终端或文件权限。Provider Secret、原始Electron Main、任意OS命令、未开放远程脚本及未经合同批准的新宿主API仍不授予扩展。
- **本地身份（1.9已实现，身份/首存/另存/删除/复制移动已获工程验证，完整双流程接续见[实施方案](R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#44-043--050--060验收边界与当前候选缺口)）**：按[课例与文件合同](R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)从真实目录创建时取得lessonId，对话归课例；工程修改仍绑定projectId/实际路径/revision/epoch。首次工程保存只绑定文件和更新编辑目标，课例对话不断。Save As建立新工程身份且不复制原目标会话/候选/句柄。四阶段正文和独立材料集在课例真实文件中，应用记录不保存第二正文；本版本课例移动可重关联记录，复制则新身份。旧格式记录不迁移，删除聊天不删除真实课例文件或恢复稿。
- **可见性与验收**：1.8起普通内部生产构建默认显示CLI/聊天，无需环境开关；CLI不可用时人工能力仍正常。入口开放不代表S3/S4通过。2.0可用有限外部开发基线比较质量，但教师的材料、设计、构建、QA、修复和导出无需另开外部AI/终端。速度目标、有限复测与证据复用见[开发计划](AI_ASSISTANT_DELIVERY_PLAN.md)。

## 8. 1.1 V8 清零棘轮与例外

- 1.1 执行期间，`state.project`（V8 投影）不新增 writer，V8 projection 不新增 consumer，raw `useEditorStore` 不新增 public API，旧模块 deep import 只允许下降；这些是迁移期约束，不是允许 V8 路径长期保留的例外。
- 1.1 完成时，`editorStore.ts` 是单一 Zustand composition root；Core resource/history、App lifecycle/UI、Slide/Flow/Spatial 与 Runtime/Media/Component/Interaction/Global-Teacher use case 已按 Owner 分离。`slideCandidateSidecar*` 等跨 Surface wrong-owner 状态、根级 selection/navigation/history 镜像和 Feature → root Store 反向依赖为零。
- 1.1 完成时，`src/**`、`tests/**`、`scripts/**`、`examples/**`、`artifacts/**`、fixture 与正式生成制品中不得再导入、导出或使用旧 projectTypes/projectSchema、schemaVersion 8 作者工程/archive、旧 Player/Export payload、旧测试工厂或独立 `ProjectDocument` / `SceneDocument` / `SceneNode` / `ExportPayload` token。Markdown 历史、最终评估材料、Git 历史、依赖和构建缓存不在机器清零范围内。
- 每个旧 consumer 必须先有行为等价的 V9/Published producer、consumer 和最近层检查，才可删除；不得靠删功能、删测试、删导出、静态化动态内容、修改断言或 silent fallback 达成零命中。
- 例外必须登记六要素：位置、原因、首个真实 consumer、替代目标、退出条件、Owner。
- Slide Native input 例外登记：**位置**为 Course Project V9 `NativeElementContent` 与 Published Course V2 的匹配 strict 分支；**原因**是在 Slide 中提供可编辑填写区且不要求 Runtime；**首个真实 consumer** 为 `r12-007-input-response-delivery` 的 Slide 作者态、Published controller 与 PPTX 投影；**替代目标**为标准 Native carrier 加 Interaction V1 条件，不另建 Runtime 或第二套互动模型；**退出条件**为 producer、Player、PPTX、诊断与能力索引成对交付且旧 reader fail loud，若无法满足则撤回该分支；**Owner** 为当前产品 Owner。
- Legacy 台账唯一真相是 `inventories/legacy-consumers.json`；检查器验证并收紧该台账，不建立第二份 allowlist。它只对 `reconciledProductCommit`、`reconciledScope` 与排除 inventory 自身的 product tree digest 标识的候选声明当前精确，避免提交身份自引用；后续迁移只能减少实际 consumer，台账在下一次 reconciliation 前是禁止删除用的安全上界。迁移 lane 不并行修改该 JSON；只有持有 `legacy-inventory` 专用写锁的单一 Owner 可原子刷新或更新删除状态。任务卡只引用记录 ID，不复制 consumer 清单；1.1 最终门要求无 unknown、confirmed consumer 为零并在复核后删除旧模块。
- 1.1 收敛 LEG-002 时，作者画布、当前位置试运行、整课 Player 与 capture 使用同一共享渲染语义，不把当前宿主偶然差异当成可选架构：文本 `auto-height` / `fixed` / `shrink` 以 `src/shared/textLayout.ts` 的既有规则为准；工程声明且已解析的字体在顶层文档和预览 iframe 安装同一字体 bytes；工程资产 ID 始终解析为 Course Project / Published asset closure 中的同一 bytes，只有明确 remote source 且未被工程 bytes 接管时才按声明 origin 获取，失败必须可见。该收敛是修复已知不一致，不授权改变文字、字体、素材或网络功能。

## 9. 已知架构陷阱（风险登记摘要）

Flow carrier 被统一层抹平；Core 循环依赖；第二套导航/状态真相并存；stale async 写错目标；history 双写；sidecar 快照内存膨胀；V2 主路径被 fallback 回退；raw Store Facade（把整个 Store re-export 当边界）；Facade 空壳（只搬文件不迁职责）；slice factory 接收完整 `EditorState/get()`；root re-export 全部 actions；多个 slice 各自维护 active document/dirty/history；为结构测试保留无效字符串；repo-index 自过期 / 非确定生成 / dirty 输入漏报。

## 10. 开发基础设施不变量

- `artifacts/ai-capabilities/`（回答"课件生成能做什么"）与 `repo-index/`（回答"开发修改该读什么"）不得合并为一份真相；两者都不进产品运行时。
- repo-index 是显式按需生成、可缺省且不 tracked 的本地导航缓存，不是默认 CI 门；生成时仍禁止写入 HEAD、时间戳、用户名或绝对路径，其缓存新鲜度只由 source/semantic/config/tool 四域 hash + schemaVersion + generatorVersion 判定，相同输入连续生成必须逐字节一致。
- 不引入第二套 TypeScript 编译器或 ts-morph；索引只维持 TS7 `unstable/sync` 薄适配层。
- 热点文件清单（Editor Store/History、App 保存恢复、Workspace/Properties、Published producer、contracts/Schema、main/preload、generated repo-index）是热点锁的锁对象。文件大小仍不是单独 CI 失败条件，但与跨 Owner writer、依赖环、wrong-owner state、raw Store 扩散或已批准 lane 冲突之一同时出现时，构成主动拆分证据；`editorStore.ts` 已由 Owner 指定为 1.1 必拆热点。
- 持续架构治理只保留三类证据：本合同的 Owner/方向、针对真实边界的 dependency ratchet、受影响行为的最近层测试。边界变化时更新现有 `FEATURE_CONSUMER_OWNER_LEDGER` 与直接 ratchet；不建立周期性架构评审会、评分卡、全仓依赖平台或第二份模块台账。

## 11. 术语要点

- `LayerItem`：Slide 场景 / Flow 浮层 / Spatial 世界的统一图层项，不含 Flow 普通正文。
- `FlowBlock` / `FlowComponentBlock`：Flow 稿纸正文与稿纸组件的 carrier。
- `ScopedLayerItem`：global/surface 共享层载体，含 location 可见性。
- `authoringAddress`：跨保存稳定的作者身份地址；`hitId` 是会话临时命中标识。
- `CourseAuthoringSession`：唯一活动编辑会话，演化不重建；`AuthoringTarget` 是异步提交的过期防护快照。
- `AI/CLI session`：应用本地保存的外部 CLI 会话映射和工具轨迹；不属于 Course Project，也不是第二个 `CourseAuthoringSession`。
- `AI staging workspace`：自动准入前的应用本地候选目录；其中内容不是 authoritative project，只有通过门禁并经产品事务提交后才成为工程事实。


### 1.3 Chart domain

Chart now also uses a strict Flow body block (`type: chart`, `chart`, `height`) and Spatial
world Native LayerItem. Published V2 uses the matching domain. Flow width follows reading
width; height is 160–1600 CSS pixels. Shared chart data and style rules have one owner;
Surface adapters own identity, target and history. Flow DOCX uses a static chart image plus
editable data, while Spatial exports use existing camera pages. Flow overlay, Spatial shared,
global and input domains are unchanged. This Chart contract did not expand Table; the
separately approved Table work below has its own contract. See the V9 compatibility policy for details.

### 1.6 Table merge contract

NativeTableContent 与 FlowTableBlock 增加可选 strict `merges: { rowIds, columnIds }[]`，Published V2 复用这两个正式 schema。缺省为空；不改变既有行、列、格身份或创建 V10。每个区域至少两格，ID 按当前顺序连续、存在且不重复，区域不得重叠。Flow 的独立列标题不参加正文合并；Native 合并不能跨表头/正文边界。

左上角是唯一正文锚点，覆盖格仍存在并保留身份/样式，但正文必须为空。人工合并把矩形内非空正文按行优先顺序以换行串接到锚点；Flow 富文本范围随拼接偏移。拆分只删除区域，正文留在锚点，覆盖格为空。修改覆盖格须先拆分，禁止隐藏正文 writer。

区域外的插删与整块移动继续允许；任何移除成员、插入内部或打乱区域顺序的结构编辑明确拒绝并零写入，提示先拆分。复制表格同时重建区域中的行列引用。作者操作使用各 Surface canonical transaction 与唯一历史，不建立第二合并状态。

作者/Player/HTML 只绘制、命中与朗读锚点，几何为跨度总和；PPTX 输出可编辑 colspan/rowspan，Flow DOCX 输出 gridSpan/vMerge；Spatial 继续静态相机投影。旧 strict reader 拒绝新增字段；新 reader 保持旧文件语义。合同交付本身不表示 consumer 已完成。

### 1.3 Table domain（2026-09-06 批准并实现）

Owner 要求三 Surface 表格均可插入、编辑、保存/恢复/重开、播放及按格式导出，执行边界见 [1.3 独立 Table 方案](roadmap/1.3/README.md)。Flow 沿用既有 FlowTableBlock 及字符串/富文本单元格，不另建正文表格模型；Spatial 允许 Native Table 位于 world，沿用 world 几何、层级和相机。共享内容操作和编辑控件不能共享 Surface writer，target、revision、草稿与历史仍由对应 Surface 持有。

Slide 保持原生可编辑 PPTX；Flow DOCX 保留可编辑 Word 表格和正文顺序；Spatial 沿用静态相机页并明确静态结果，作者工程的数据始终可编辑。Flow overlay、Spatial shared、global 和 input 不扩域。`r13-005` 必须先交付 V9/Published 对等有效域、兼容反例、能力差异与生成合同，再由 `r13-006`–`r13-008` 交付公共编辑与两个 Surface consumer；在此之前当前 Schema 的 Spatial Table 拒绝仍有效。

### Flow 宽度模式（1.8 窄 additive 合同）

`Flow.layout.widthMode?: 'fluid' | 'reading'` 在 V9 与 Published V2 对等且保持 strict。缺字段继续读取为既有 reading 模式，不静默迁移；新建 Flow 显式 fluid，属性命令变更参与保存和 Undo/Redo。旧 strict reader 必须拒绝新增字段。fluid 正文、媒体与组件消费实际内容容器宽度，reading 保留 readingWidth/wideContentWidth 上限。编辑、试运行、Player 与 HTML 共用宽度解析，观察 zoom/pan 不改变排版宽度；DOCX 消费固定纸张的可用宽度，不承诺与响应式屏幕逐像素一致。此字段不改变任何 Slide/Spatial 或既有 overlay paperSpace 语义。

2026-09-13 Flow 生成与播放视口补充：

- 新建项目、追加 Flow 和 Builder 消费同一正式 fluid 默认值；已有缺省 reading 的 Flow 在增补时不迁移。正常标题、正文、图片和局部互动使用正文 block；`native.content` 的 Flow overlay 可显式指定 `paperSpace: paper | viewport`，未指定时保持既有默认值/原值，提交消费 canonical paperSpace command。非 Flow 和教师控制器不接受此定位参数；工程 Schema 不新增分支。
- 生成 snapshot 提供已解析的 layout 和正文/稿纸/视口语义；当前观察提供实际 CSS px 容器、稿纸、正文宽度及 scroll/观察比例。这些测量是观察事实，不构成第二份布局状态。同一 Flow 的目录锚点共享一个正文 Surface，生成观察按 Surface 收集一次并保持冻结的活动锚点；新增标题后的反馈不复制成新页面目标，不扩大原任务授权。反馈观察新发现组件依赖时，可按需发现真实源码与精确目标并保留已创建实例配置；只改单个实例不得隐式修改共享包，用户明确要求共享源码变更时，通过当前正式目标与包更新 Owner 执行。初始或反馈目标列表本身不构成修改授权上限，执行仍需有效目标、版本和原生授权。Flow 默认正文、控制器使用共享 Noto Sans SC 字体链，HTML 导出收集该隐式字体并通过已有字体 Owner 打包。
- Flow 控制器由实际视口投影到安全区域底部居中，默认底距12 CSS px；作者 frame 的 x/y 不再直接指定 Flow 初始播放位置，宽度以上限偏好保留。窄窗按按钮行列重排，不整组缩小。编辑展示、生成观察与播放使用同一投影；既有会话保存手动偏移/折叠，自动越界纠偏只作用于显示，不回写工程或手动偏移。观察变换不缩放控制器、不重挂实例。Slide/Spatial 保留自身投影。
- `PlaybackViewSession` 逐轴从实际 pan range 派生边条显隐，0.5 CSS px 内的数值噪声不产生边条。平移条是按需浮层，不保留18 px正文空槽；隐藏时退出 Tab 和无障碍操作树，释放拖动与 capture。Flow 正文按自身 overflow 滚动，paper 浮层属于正文滚动范围，不再重复计入整课 pan bounds。
- 边条、原生滚动条避让和控制器读取同一 chrome 派生值；pan 末端可露出被浮层覆盖的有效内容。控制器宽度按最高观察倍率下的 chrome 预算稳定计算，位置按当前可见 chrome 避让，预算不占用正文宽度。正文 scroll 与观察 pan 各自保留单一状态，边条显隐和观察缩放不得触发正文基准宽度重排或清空交互状态。
