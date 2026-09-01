# 架构合同：什么不能坏

> 本文是“必须守住的现状能力 + 已裁决但尚待修复的目标不变量”的唯一落点，供 S1/S2 任务按需补读。目标态条目会明确标出当前缺口，不能伪称已经满足。协议细节以 `src/shared/contracts/**`、Zod Schema 与源码为准；本文与源码冲突时修正本文。

## 1. 协议与版本边界

- Course Project V9 是唯一受支持的作者工程格式；不导入 V8 `.h5lesson`；不借重构创建 V10。
- V9 已有字段、判别器和语义软冻结；additive 可选字段必须独立合同提交并保持 `.strict()`。
- Published Course V2、Runtime API 2 / Surface Runtime API 3、Component API 4、Interaction Protocol V1 的版本边界保留。
- 项目 `id` 与单调 `revision` 语义保留；`globalLayerItems`、`surfaceLayerItems` 和三 Surface 保留；不新增 persisted `projectMode`。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；internal/reserved 接口不得宣称为可用工作流。

## 2. Must Preserve / Must Achieve（25 组）

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

## 3. 状态七分类与唯一工程真相

| 类别 | 示例 | 持久化 | 进 Undo |
|---|---|---:|---:|
| Canonical document | CourseProjectDocument | 是 | 是 |
| Binary sidecars | asset/component bytes | 是 | 是（delta） |
| Authoring identity | projectId/revision/location/surface/generation/owner | 否 | 否 |
| Surface selection | block/layer/path/camera selection | 否 | 通常否 |
| Draft/IME/drag | 文本、代码、表单、临时 frame | 否 | 提交后才进入 |
| Runtime/preview session | mount、会话相机、播放状态 | 否 | 否 |
| App UI | tab、dialog、path、status | 部分本地偏好 | 否 |

- 禁止把七类塞回一个无边界大接口；不新增第二套 Store、Session、History 或持久化模式。
- 正常生命周期恰好一个活动 V9 Surface session（Slide/Flow/Spatial 互斥）；一次用户操作 = 一次逻辑提交 = 一条历史（文档 + 资源字节同事务）。
- 任何异步/延迟提交必须带创建时 target（projectId / sessionGeneration / location / surface / owner / item / revision），失败返回可识别 stale 结果，不写当前页面。
- 用户操作边界：pointer up 一次提交；IME composing 不提交；批量导入可为一条批量历史；自动恢复写盘与模式/Tab 切换不进 Undo。

## 4. 模块 Owner 与负边界

| 模块 | Owns | 不 Own |
|---|---|---|
| Shared Contracts/Domain | V9/Published/Component/Runtime/Interaction 类型与纯规则 | Renderer 状态、UI、文件系统 |
| Editor Core | canonical port、authoring identity、transaction/history、typed selectors | 具体 Surface selection、Feature UI |
| App Composition | 项目生命周期、跨 Feature use case、路由、错误反馈 | Surface 内部模型、格式实现 |
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
| Repo Knowledge | 开发索引与 Context Pack | 产品运行时依赖 |

跨域操作不通过模块深层 import 完成，由用例层组合：`validate → Surface placement command → Core transaction → App feedback`；document + 资源字节同时变更必须是一条原子逻辑历史。方向性约束：Core 不 import 具体 Surface/Feature；Player 不依赖 renderer Store；authoring V9 → Published 单向。

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
- **Player/Preview/Export**：V2 主路径（active document → `buildPublishedCourseV2Payload` → CoursePlayer）必须保护；无 publish sources 的 fallback 先做可达性证明，不新建 sessionless V9 read model。远程资源与 connect origin 都由工程声明派生，不能分别维护 CSP、Electron allowlist 和 Player 私有名单。
- **Diagnostics**：不预建 structural/contextual/authoring/export 框架矩阵，只处理已复现的债务。网络 finding 判断“声明与使用是否一致”，不得把合法外链本身定义为错误。
- **Secrets**：长期 API/AI Provider 密钥不属于 Course Project、Published payload、component package 或导出文件；只允许服务端代理、运行时用户输入或短期限域 Token。
- **UI**：只有已准入迁移的首个真实 consumer 需要时才抽最窄 seam；能局部修复就不造 seam，不一次拆大文件。
- **EditorMode**：只有 simple/professional 两种；不建第三 `code` 模式、新 Code Workspace 入口或结构化 Diff。

## 7. 迁移期棘轮与例外

- `state.project`（V8 投影）不新增 writer；V8 projection 只读且不新增 consumer；raw `useEditorStore` 旧 UI 允许存续、新 public API 禁止导出；deep imports 在现有基线上只允许下降。
- 例外必须登记六要素：位置、原因、首个真实 consumer、替代目标、退出条件、Owner。
- Legacy 台账唯一真相是 `inventories/legacy-consumers.json`；任务卡只引用记录 ID，不复制 consumer 清单。

## 8. 已知架构陷阱（风险登记摘要）

Flow carrier 被统一层抹平；Core 循环依赖；第二套导航/状态真相并存；stale async 写错目标；history 双写；sidecar 快照内存膨胀；V2 主路径被 fallback 回退；raw Store Facade（把整个 Store re-export 当边界）；Facade 空壳（只搬文件不迁职责）；repo-index 自过期 / 非确定生成 / dirty 输入漏报。

## 9. 开发基础设施不变量

- `artifacts/ai-capabilities/`（回答"课件生成能做什么"）与 `repo-index/`（回答"开发修改该读什么"）不得合并为一份真相；两者都不进产品运行时。
- repo-index 是显式按需生成、可缺省且不 tracked 的本地导航缓存，不是默认 CI 门；生成时仍禁止写入 HEAD、时间戳、用户名或绝对路径，其缓存新鲜度只由 source/semantic/config/tool 四域 hash + schemaVersion + generatorVersion 判定，相同输入连续生成必须逐字节一致。
- 不引入第二套 TypeScript 编译器或 ts-morph；索引只维持 TS7 `unstable/sync` 薄适配层。
- 热点文件清单（Editor Store/History、App 保存恢复、Workspace/Properties、Published producer、contracts/Schema、main/preload、generated repo-index）是热点锁的锁对象；文件大小只是风险信号，不是机械拆分门禁。

## 10. 术语要点

- `LayerItem`：Slide 场景 / Flow 浮层 / Spatial 世界的统一图层项，不含 Flow 普通正文。
- `FlowBlock` / `FlowComponentBlock`：Flow 稿纸正文与稿纸组件的 carrier。
- `ScopedLayerItem`：global/surface 共享层载体，含 location 可见性。
- `authoringAddress`：跨保存稳定的作者身份地址；`hitId` 是会话临时命中标识。
- `CourseAuthoringSession`：唯一活动编辑会话，演化不重建；`AuthoringTarget` 是异步提交的过期防护快照。
