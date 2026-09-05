# 架构合同：什么不能坏

> 本文是“必须守住的现状能力 + 已裁决但尚待修复的目标不变量”的唯一落点。只有改动命中相关架构边界时才补读对应条目，不要求普通任务通读全文。目标态条目会明确标出当前缺口，不能伪称已经满足。协议细节以 `src/shared/contracts/**`、Zod Schema 与源码为准；本文与源码冲突时修正本文。

## 1. 协议与版本边界

- Course Project V9 是唯一受支持的作者工程格式；不导入 V8 `.h5lesson`；不借重构创建 V10。
- V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。Table、Chart 与 Slide Native input 是 Owner 明确批准的三个新 strict discriminator 窄例外，不构成任意联合类型扩展授权。
- Published Course V2、Runtime API 2 / Surface Runtime API 3、Component API 4、Interaction Protocol V1 的版本边界保留。Table、Chart 与 Slide Native input 使用 Published V2 对等 strict 分支并与匹配 Player 成对交付，不为此升级 Published V3。
- 项目 `id` 与单调 `revision` 语义保留；`globalLayerItems`、`surfaceLayerItems` 和三 Surface 保留；不新增 persisted `projectMode`。
- AI 路线为 1.6–1.9 默认隐藏、2.0 在内部生产构建中正式开放；对应版本门完成前，当前编辑器仍不得宣称 AI、聊天、Provider 或 internal/reserved 接口为可用工作流。隐藏能力也必须走正式 CLI harness、受管暂存、自动准入与宿主 canonical command 边界；1.8 起的 live authoring 还必须走 MCP，不能从旧接口名称直接接线。
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
6. 全局层入口保持可发现；教师控制器保持全局单份、固定属于 Overlay，运行态会话拖拽不写回工程；页面作者态控制器 inert，全局层是唯一持久化编辑入口。控制器在作者、试运行、Player 与 HTML 中始终高于当前 surface/scene/world 的 Native、Runtime、Component 内容，并只承担恢复、手动跳转、重播和临时越过；它可为课堂强制跳转绕过导航守卫，但课程主推进不得依赖它，也不得为它预留正文安全区。控制器与其他全局 Overlay 元素的关系仍由全局平面内排序决定。

### 保存与运行

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

| 类别 | 示例 | 持久化 | 进 Undo |
|---|---|---:|---:|
| Canonical document | CourseProjectDocument | 是 | 是 |
| Binary sidecars | asset/component bytes | 是 | 是（delta） |
| Authoring identity | projectId/revision/location/surface/generation/owner | 否 | 否 |
| Surface selection | block/layer/path/camera selection | 否 | 通常否 |
| Draft/IME/drag | 文本、代码、表单、临时 frame | 否 | 提交后才进入 |
| Runtime/preview session | mount、会话相机、播放状态 | 否 | 否 |
| AI/CLI session and trace | CLI session mapping、消息、tool trace、usage、状态 | 应用本地版本化目录；不进工程 | 否 |
| AI staging workspace | 待准入 Component/Runtime 源码、manifest、诊断与候选资源 | 应用管理的本地暂存；准入前不进工程 | 否 |
| App UI | tab、dialog、path、status | 部分本地偏好 | 否 |

- 禁止把这些状态塞回一个无边界大接口；不新增第二套作者 Store、CourseAuthoringSession、History 或工程持久化模式。AI/CLI conversation session 是本地编排记录，不是第二作者会话、第二工程真相或第二历史。
- 内部实现可以用类型交集组合唯一 Store，但任何 Feature/Surface 不得接收或导出完整 `EditorState`、raw `get/set` 或 root Store hook；状态与 actions 必须由对应 Owner slice 持有。组合类型不是公共边界。
- 正常生命周期恰好一个活动 V9 Surface session（Slide/Flow/Spatial 互斥）；一次用户操作 = 一次逻辑提交 = 一条历史（文档 + 资源字节同事务）。
- 任何异步/延迟提交必须带创建时 target（projectId / sessionGeneration / location / surface / owner / item / revision），失败返回可识别 stale 结果，不写当前页面。
- 用户操作边界：pointer up 一次提交；IME composing 不提交；批量导入可为一条批量历史；自动恢复写盘与模式/Tab 切换不进 Undo。

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
| Authoring Tools / MCP | 版本化 read/write tools、canonical target、receipt、stale 与事务适配 | 模型规划循环、直接写 Store、绕过产品命令 |
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
- **Table/Chart/Slide input**：三者是 V9 Native 和 Published V2 的匹配 strict 分支；当前 1.2 有效域为 Table/Chart 只允许 Slide scene/surface，input 只允许 Slide scene，均不进入 Flow/Spatial/global，input 也不暗示 PPTX 交互等价。不得进入 legacy `SceneNode`，不得改变既有 Native 或 presentation override 的合并语义。旧 V9 必须继续读取；旧编辑器或旧 Player 遇到新分支必须 fail loud，不能静默丢弃、替换成截图后覆盖作者工程或伪装成 Shape。1.3 已规划 Chart 单独扩展到 Flow/Spatial，正式新有效域及必要的 strict 分支先由 [1.3 跨 Surface 合同节点](roadmap/1.3/README.md)交付；该节点落地前上述拒绝继续有效，Table/input/global 不自动扩域。
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

## 7. CLI Agent、MCP、暂存与会话边界

- **内核分工**：用户自行安装并认证 Codex、Claude、OpenCode；CLI 保留各自的模型规划、Skills、子任务与工具循环。应用只实现版本化 `LocalAgentCliAdapterV1`、session harness、MCP Authoring Tools、暂存区、回执/时间线与自动准入，不复制模型规划循环或另建 Agent Runner。
- **进程边界**：CLI adapter 以解析后的明确可执行文件和参数数组提供 probe/start/resume/cancel；Windows 不拼接 shell 命令字符串。CLI 自行登录并保存凭据，应用不读取或保存其 API Key。
- **唯一写路径与版本分界**：CLI candidate 默认可通过结构化 stdout / artifact channel 返回；只有 adapter 确实启用通用文件工具时，文件工具才限定到应用管理的当前 session staging，并执行对应 conformance。无文件工具的 adapter 不因缺少文件系统沙箱而失败。文件工具始终不得直接写 `.h5lesson`、其他 session 或权威工程；staging 主要保证候选事务、恢复、清理和防止意外跨工程/半写入，不承担对受信 CLI 的通用 OS 沙箱证明。1.7 是 batch candidate pipeline：应用只提供不可变最小 context snapshot 或已确认 Markdown，CLI 不获得 Store 或 live project API，只输出 strict/versioned typed authoring intent envelope 或 dynamic package manifest；宿主重校验 target/revision，Native/Recipe/Existing Component 候选直接映射 1.4 canonical commands，只有 Generated Component/Runtime 额外进入动态准入，并以单一 document + resource transaction 提交，禁止 generic V9 patch/import。1.8 起，任何 CLI 发起的 live/interactive Course Project 读取与权威修改只能经过版本化产品 MCP 工具。update target 必须逐字段无损携带 canonical `CourseAuthoringTarget`；create target 使用独立 create-scope。CLI candidate receipt 与 host commit receipt 分离；stale、拒绝、坏候选、适用的准入失败和取消均零工程写入。
- **暂存和自动准入**：生成 Component/Runtime 源码、manifest、资源与诊断先进入暂存区。动态载体自动准入至少验证编译、协议、依赖、素材闭包、精确 origin、生命周期、资源上限、静态后备和真实宿主 smoke；未通过不得注册或写工程。Native、Recipe 与 Existing Component 候选不等待动态宿主门。内部稳定版默认不提供绕过准入的人工覆盖。
- **自动可信能力**：通过自动准入的 Component/Runtime 自动成为当前可信扩展，可使用当前正式提供给可信扩展的父页面、本地、桌面、网络和其他宿主接口，无需人工代码审核。该授权不包含 Provider Secret、原始 Electron Main 对象、任意 OS 命令、未开放远程脚本或未经合同批准的新宿主接口。
- **本地会话身份**：AI 会话、材料与 tool trace 保存于应用 `userData` 下的版本化目录，以工程 ID 与规范化文件位置共同标识。Save As 创建新的 workspace identity，不复制旧会话；可清除单个会话、当前工程或全部应用记录。它们不进入 Course Project、Published、Component、Runtime 或导出物；应用只能承诺删除自己的记录，CLI 自身历史由适配器能力另行说明。
- **版本可见性**：1.6–1.9 的 CLI/生成/Agent/Chat 能力默认隐藏，2.0 才在内部生产构建中正式显示；这不改变产品的内部生产分发边界。CLI 未安装、未认证、不可用或异常退出时，全部人工编辑能力必须正常工作。

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
