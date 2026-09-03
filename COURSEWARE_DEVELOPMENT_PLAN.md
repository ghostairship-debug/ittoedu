# IttoEdu 开发总纲

> 当前路线核实日期：2026-09-03。当前任务、数量和状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。
>
> 本文件只保存当前产品决定、边界和开发路线。已经完成、取消或被取代的内容在下一次路线更新时移出正文，由 Git 历史保留；不得在这里维护 changelog、完成卡清单或行号级历史源码快照。

## 1. 文档职责与权威顺序

本文件是仓库唯一长期产品与开发路线。详细规则各有唯一来源：

| 事项 | 唯一来源 |
|---|---|
| 当前产品决定、优先顺序与成功标准 | 本文件 |
| 技术不变量、模块 Owner、carrier 与协议负边界 | [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) |
| 默认开发闭环、敏感变更、任务协调、验证与 Git | [工作协议](docs/development-plan/WORKING_PROTOCOL.md) |
| 当前 queued / active / blocked 任务 | [任务板](docs/development-plan/TASK_BOARD.md) 与对应任务卡 |
| 已完成修复和旧路线 | Git 历史 |

发生冲突时按以下顺序裁决：

```text
用户当前明确决定
> 正式 Schema、合同与兼容策略
> 当前源码和可复现运行结果
> 本总纲
> Ready 任务卡与自动任务板
> 其他参考材料
> Git 历史中的旧结论
```

索引或文档与源码冲突时，先修正文档或索引，不按过时文字强改代码。调查和工具调用必须能改变决定、实现或验收；否则停止。

## 2. 产品目标与当前边界

IttoEdu 是受控团队使用的内部生产工具。默认工程、Runtime、Component、课件模块和仓库代码来自受信团队或已经批准的自动生成流程；架构首先服务生产结果正确、可恢复、可维护和可并行开发。除非 Owner 明确改变分发或信任来源，不以多租户 SaaS、公开插件市场、任意第三方恶意代码或零信任终端作为默认威胁模型。Provider Secret、原始 Electron Main、任意 OS 命令、未开放远程脚本和用户数据损坏仍是明确边界。

目标是让已有能力真正可用、稳定且可维护：

- 教师能完成编辑、保存、重开、试运行、整课播放和适用导出，并得到正确结果；
- Slide、Flow、Spatial 与 Mixed 往返稳定，各自保留正确的作者与运行语义；
- 试运行、Player 和导出读取同一份课程事实，公开控件与成功反馈不静默 no-op；
- 高频能力直接可达，低频能力可渐进披露，但必须可发现、可保存、可撤销；
- 面向 AI 的能力索引、无界面校验和课件 Skill 与真实实现一致；
- 远程图片、音视频与 API 是可声明、可预览、可发布、可诊断的正式能力；
- 重复 Store、Session、History、writer、consumer 和兼容路径持续减少；跨 Owner 巨石命中正式触发条件后主动拆解，以明确职责、局部推理、并行开发和降低写锁冲突为结果，不以新增目录、抽象数量或单纯行数减少衡量进展。

当前协议与交付边界：

- 作者工程为 Course Project V9；发布为 Published Course V2；兼容 Runtime API 2/3、Component API 4 与 Interaction Protocol V1。
- V9 软冻结：已有字段、判别器和语义不得静默改写；additive 可选字段必须独立合同提交并保持 `.strict()`。不导入 V8 `.h5lesson`，不借重构创建 V10。
- 当前实现尚无可见 AI、聊天或 Provider。1.6–1.9 只允许在默认隐藏入口后建设本地 CLI Harness、生成内核、MCP/Skills 与 Chat dogfood；2.0 才在内部生产构建中正式开放。任何版本节点未真实完成前，`courseAiHandoff` / `courseAiPatch` 等 internal/reserved 接口仍不得宣称为可用能力。
- `artifacts/ai-capabilities` 是 Builder 的产品契约；repo-index 只是显式、可缺省、可重建且不 tracked 的本地导航缓存，不能覆盖源码事实或成为产品门。
- Runtime/Component 是经过审核的可信扩展。外部导入只是分发方式；真实 consumer 需要宿主能力时走稳定宿主接口或同宿主执行语义，不建权限审批平台。
- 1.7 起，生成的 Runtime/Component 必须先通过自动准入门；通过后可获得当前可信扩展已经正式具备的宿主能力，无需人工代码审核。该信任不会开放 Provider Secret、原始 Electron Main、任意 OS 命令、远程脚本或尚未进入正式合同的接口。
- 远程资源和 API 按工程的精确 `https` / `wss` origin 声明开放。远程脚本暂不开放；长期 Provider Secret 不得写入工程、Published payload、组件包或导出 HTML。
- 首发 Agent 集成只支持用户自行安装并自行认证的 Codex、Claude 与 OpenCode。CLI 保持自身规划循环；编辑器只提供本地 session harness、受管暂存区、自动准入、宿主 canonical command 提交边界和 1.8 起的版本化 MCP Authoring Tools，不复制一套模型 Agent 内核。
- AI 会话与工具轨迹保存在应用本地，按工程 ID 与规范化文件位置隔离；Save As 不复制会话。会话、材料与工具轨迹不进入 `.h5lesson`、Published、组件包或导出物；产品只承诺删除自身记录，不代替外部 CLI 删除其历史。
- 单 HTML 明确区分离线便携与在线轻量；这是导出选择，不新增持久化 `projectMode`。
- 当前产品定位为内部生产工具；当前 HEAD 尚未通过 1.1 的零遗留、不可降级、主动模块化与 Owner 固定课例验收，因此不得把当前任意提交冒充 `v1.1.0` 候选。既有证据只在相关实现、依赖、测试、fixture 和验证定义未变化时复用；任何版本的发布身份都由对应路线节点重新固定。
- 自动化最多证明 `engineering candidate`；真实课程的视觉、互动和教师复核决定 `art candidate` / `accepted`。
- 发布列车固定为：1.1 发布源码标签与固定课例离线 HTML；1.2–1.9 只发布内部源码标签；2.0 发布内部生产源码标签与固定课例离线 HTML。当前路线不承诺安装包。每个版本由 Owner 对固定候选与固定课例签署 `accepted`，该签署不表示对外发行。

## 3. 产品级不变量

详细技术规则只在架构合同展开；本节只保留会直接改变产品路线的稳定决定。

1. **唯一工程真相**：所有持久化编辑最终只修改一个 `CourseProjectDocument`；不新增第二套 Store、Session、History 或持久化模式。
2. **会话与事务闭合**：正常生命周期恰好一个活动 Surface 会话；一次用户操作形成一次逻辑提交，异步操作始终识别创建时目标和 revision。
3. **Surface 保留语义**：Slide 使用 LayerItem；Flow 正文使用 FlowBlock / FlowComponentBlock；Flow 浮层与 Spatial 世界使用各自正确载体，不用“统一”抹平正文、稿纸、世界或镜头语义。
4. **模式由工程事实推导**：纯 Slide、纯 Flow、纯 Spatial 与 Mixed 从 `locations` / `surfaces` 自动得出，不新增 `projectMode` 或“四模式”字段；三种 Surface 都必须有直接创建入口。
5. **Slide 作者与试运行同宿主**：编辑状态和当前位置试运行共用同一 Renderer 文档中的 Published V2 Slide 宿主；authoring 保持 inert，并复用版本化 direct patch / ACK / error / Runtime target / Component target 语义。
6. **全局平面与所有权排序正交**：有效合成顺序恒为“全局 Underlay → 当前 Surface / 场景 / 世界内容 → 全局 Overlay”。全局元素与本地内容之间不存在可编辑的逐项层级关系；图层选项卡只编排同一全局平面内的全局元素。
7. **控制器是唯一兜底入口**：教师控制器只在全局层持久化并固定属于 Overlay；页面作者态 inert，运行态拖动只写 Session。它必须始终高于当前 Surface / 场景 / 世界中的 Native、Runtime 和 Component 内容，但只承担恢复、手动跳转、重播和临时越过，不作为课程默认推进工具，也不复制第二个逃生控件；它与其他全局 Overlay 元素的关系仍由全局平面内排序决定。
8. **Flow 结构与合成分责**：paragraph、heading 等继续是可重排、可访问、可导出的语义 FlowBlock，但不伪装成普通 z-order 图层；图层面板以一个“正文”合成边界表达整份正文，Flow 浮层可稳定位于正文下方或上方。本轮不扩成逐 paragraph 锚定系统。
9. **统一图层保留稳定身份**：Native、Runtime、Component、教师控制器及 global/surface 项进入有效图层；跨保存身份使用 `authoringAddress`，临时 `hitId` 不得成为持久事实。
10. **Preview / Player / Export 只读**：不从 Player DOM、Canvas、Phaser proxy 或 Published payload 反建作者工程，也不让扩展直接写 Editor Store。
11. **教师能力不缩水**：现有高级编辑、组件、Runtime、媒体、互动和代码能力不得因界面精简、架构调整或权限假设被删除或永久禁用。
12. **有效域闭合**：作者端允许保存的状态必须被统一画布、试运行、Published Player 和适用导出接受；静态格式无法表达的内容必须诚实提示或回退。
13. **公开入口诚实**：属性、复制、删除、拖放、检查、导出和错误反馈要么真实改变唯一工程并进入正确历史，要么明确不可用。
14. **AI 契约诚实**：能力索引和课件 Skill 不得把 internal/reserved、partial playback、静态后备或未验证 carrier 宣称为完整可用能力。
15. **模块所有权闭合**：Editor Core、App Composition、Slide、Flow、Spatial 与各 Feature 的状态、writer、planner 和 use case 必须由正式 Owner 持有；组合根只能实例化和接线，不承载业务实现。主动拆分不得新增第二 Store/Session/History、完整 Store Facade、兼容双写或万能 Surface 服务。

当前源码已兑现且不再作为待开发路线的事实：活动文字草稿进入保存、关闭脏判定与恢复快照；统一多选 Delete 是一次原子提交并清理引用；当前位置试运行携带当前命名状态；打开工程只完整解压一次；Published 静态捕获受统一截止时间约束；无效工程不会提前污染最近项目；在线轻量导出会诊断缺失的连接 origin；声明式课程状态支持 `exists` / `compare` / `set`；全局 Underlay / Overlay 已贯通合同、作者面、Slide、Flow、Spatial、Player 与 HTML，Flow 浮层可稳定处于正文下方或上方；教师控制器固定为 Overlay 兜底入口并可越过导航守卫。后续只有新的反例或相关实现变化才能重开这些事项。

## 4. 执行入口

- 开发执行只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；本文件不复述其默认闭环、敏感触发器、协调和验证规则。
- 多执行者、重叠写入、跨会话、交接或真实阻断任务的实时状态只看 [任务板](docs/development-plan/TASK_BOARD.md)；单执行者单会话工作不制造任务状态。
- 本节以下路线只表示优先顺序、启动条件和成功标准，不表示已经满足实例化条件、已领取或已建卡。启动时必须用届时 HEAD 重新核对源码、合同、目标测试和互斥写入范围。
- 历史阶段名称、已完成卡和旧评估不能自动恢复任务；新实现必须满足工作协议的当前准入规则。

## 5. 当前开发路线

优先级仍以受支持场景中的用户可用性为第一轴。路线的完整任务图、发布制品、不可降级矩阵和弱模型规格位于 [`docs/development-plan/roadmap/`](docs/development-plan/roadmap/README.md)；路线节点不是协调状态，只有满足依赖、届时事实与写锁后才按协议实例化，当前 `queued / active / blocked` 仍只看任务板。

### 5.1 1.1：V9-only、主动模块化与零降级稳定底座

1.1 是下一开发阶段。目标不是删除教师能力，而是在保持当前全部产品行为的前提下，使可执行代码、测试、脚本、示例、fixture 与正式生成制品不再依赖 V8 工程模型、Schema、Player/Export payload 或测试工具链；同时完成当前 Editor Store 与 UI/交付热点的真实 Owner 拆分，使 `editorStore.ts` 收敛为唯一 Zustand 组合根。

执行顺序为：正式合同与行为基线 → 以 `inventories/legacy-consumers.json` 建立只减不增的保守上界与扫描门 → 抽取仍有效的 Native/Design/Media 等领域合同 → 使 V9 Native 与 Published V2 Schema 独立 → 按写锁迁移 Editor、Published/Preview/Export/Diagnostics 与 Archive/Test lane → 清零 V8 镜像与双轨 writer → 抽取 Core resource/history → 依次迁移 Slide、Flow、Spatial state/action → 迁移 App router/lifecycle 与 Feature use case → 拆分 UI 与交付热点 → 以依赖棘轮证明组合根只接线 → 单一 writer 在集成候选原子复核 inventory → 按精确零 consumer 清单删除旧模块 → 固定候选执行零遗留、模块化、不可降级和发布门 → Owner 签署。

2026-09-03 当前检查点为 `ee1f87e`。`r11-036b`、`r11-037a–037z`、`r11-052a` 和 `r11-052b` 的无争议部分已经完成，工作树干净；当前只有 `r11-052c-old-token-and-rejection-tests` 可执行。052b 剩余旧测试不是可直接删除的重复：源码与正式合同共同证明 Published V2 尚缺 Slide 视频动作/事件、视频与背景音乐会话协作、教师控制器 `scene.open-picker`，以及 Component API 4 的 Slide scene-local `hybrid` 宿主。四项必须先形成等价 V2 consumer，随后才能删除旧测试。纯 Flow 课程的兼容格式仍是 DOCX，PPTX 只适用于含 Slide 场景或 Spatial 镜头的课程。

剩余实施统一遵循 `docs/development-plan/roadmap/1.1/EXECUTION_GUIDE.md` 与 `GEMINI_EXECUTION_PLAN.md`，当前唯一顺序为：`r11-052c → r11-052e-v2-video-playback → r11-052f-v2-video-background-audio → r11-052g-v2-scene-picker → r11-052h-v2-component-hybrid → 收口 r11-052b → r11-052d → r11-053 → r11-054a–054d`。任务目录可以保存这条依赖链上的 blocked 卡，但任一时点只能有一张 queued 卡；每卡只跑一条最近层测试命令，并在产品 TypeScript 变化时跑 `typecheck`。实施阶段不运行全量产品测试、保全门、Legacy zero、verify、候选 Hash 或字节比较。全部实施完成后由 Codex 一次执行 `r11-055 → r11-060 → r11-061` 的最终结构审查、Legacy 零检查、全量产品测试与保全检查，再交 Owner 执行 `r11-062`。旧 W1–W9、052 A–E、053/054 candidate digest 与旧 deletion list 均不再授权执行。

052c 删除四个重复测试时不删除对应产品模块。`src/shared/presentation.ts`、`informationRelease.ts`、`projectDiagnostics.ts`、`componentPackageLifecycle.ts` 已由 Owner 裁定为 LEG-011 删除闭包：053 必须把它们纳入精确删除目标并重新证明 consumer 为零，054 才能删除；若 053 发现任一非删除闭包 consumer，必须停止并回到 Owner，不另开悬空清理路线。

硬约束：

- 任何中间状态都必须保留新建、打开、保存、另存、恢复、Undo/Redo、三种 Surface、Mixed、Preview/Player、Runtime/Component、Builder、诊断与当前全部导出；不允许先降级再于末尾恢复。
- 先交付并验证等价 V9/Published consumer，后删除旧 consumer；旧模块只在唯一台账的 confirmed consumer 为零后删除。
- 1.1 不改变 V9 或 Published V2 wire，不导入 V8，不创建 V10，不通过静态占位、no-op、隐藏入口或弱化测试实现清零。
- 已经完成且仍有有效证据的修复不重新立项；每个任务启动时仍以届时 HEAD、工作树、源码和直接测试核实事实。
- 每个中间提交保持唯一 writer 和完整可运行行为；不得先建立新 slice writer、保留旧 writer，再留给后续任务清理。re-export、同文件代理、完整 `EditorState` / raw `get()` 注入或只搬代码不算完成。

1.1 最终门与 Owner 签署完成后才可发布 `v1.1.0` 源码标签与固定课例离线 HTML，不做安装包；当前暂停点不发布。

### 5.2 1.2–1.5：人工创作与外部 Builder 生产力

- **1.2 Native 编辑闭环**：Table、Chart 是 V9 Native 的显式 strict 新分支，并在 Published V2 中成对窄扩展；Line 与 Background 分别形成可保存、可撤销、可运行、可导出的纵切。
- **1.3 Recipe 与设计生产力**：Recipe 立即展开为普通 V9 内容，不形成第二 DSL；交付参考页骨架、批量替换、Design Token 与快速诊断。
- **1.4 Authoring Tools 与 Builder v2**：update target 无损承载 canonical target；create 使用独立 scope；覆盖 Slide、Flow 正文和 Spatial world/camera/path/relation。代码工具开放前必须闭合 Component Registry 身份、direct project asset closure 与生命周期可见回退三项动态 carrier 门。
- **1.5 材料、PPTX 与内容 QA**：应用本地材料缓存、可见引用、受限 PPTX 原子导入、Style remix 与内容一致性检查。OpenMAIC 只是可选旁支，不得阻塞发布核心路径。

各版本只发布源码标签，不生成发布 HTML。

### 5.3 1.6–2.0：本地 CLI 驱动的 AI

- **1.6 Local CLI Harness**：探测、启动、流式事件、恢复、取消和本地会话隔离；Codex、Claude、OpenCode 自行登录，AI 默认隐藏，CLI 缺失不影响人工编辑。
- **1.7 生成内核**：Native → Recipe → Existing Component → Generated Component → Runtime 载体阶梯；CLI 只接收不可变最小 snapshot 并向 session staging/structured stdout 输出严格 typed candidate，宿主通过 1.4 canonical commands 原子提交；CLI 无 live 工程接口，自动准入失败时工程零写入。
- **1.8 Agent/MCP/Skills**：首次向 CLI 暴露交互式 live MCP read/write Authoring Tools 与回执，CLI 保留自己的规划循环；CLI 发起的 authoritative project 读取/修改只能由产品 MCP 工具完成。
- **1.9 Chat/Dogfood**：隐藏的 Chat shell、工具时间线、Stop/Undo/Preview、会话恢复删除与真实课例 dogfood。
- **2.0 内部生产 AI**：在内部生产构建中正式开放设置、生成、编辑、Agent 与内置 Profile，补齐发送上下文提示、可访问性、失败恢复和固定课例 Owner 验收；不把它描述成面向外部不受信用户的公开发行。

1.6–1.9 只发布源码标签且 AI 默认隐藏；2.0 发布源码标签和固定课例离线 HTML，不做安装包。

### 5.4 发布顺序、并行与证据

版本发布门按 1.1 → 2.0 顺序通过；版本内与前置能力之间按真实依赖和写锁形成 DAG，不再把所有任务串成一条单链。OpenMAIC 等 optional 节点不得出现在核心依赖闭包。

每个新增能力必须同时证明人工 UI、产品命令或 Authoring Tool、保存重开、Player、适用导出、诊断和能力索引；进入版本候选时把本版已完成行为晋升到不可降级矩阵，并证明没有新增 raw Store consumer、跨 Owner deep import / 运行时依赖环、第二 Store/History/Session/writer 或重复 registry/catalog。验证仍遵循最小充分原则，不建设架构评分平台。自动化只形成 candidate，Owner 对固定课例的真实结果拥有各版本唯一 `accepted` 签署权。

### 5.5 独立兼容与供应链风险

- Spatial / Mixed 的静态格式表达完整度，只按新路线中明确适用的纵切验收，不以删除格式或静态化动态内容消除差异。
- 根级 Error Boundary、Canvas 告警、Lint、内存峰值等仍须以真实失败或量化收益立项，不从旧评估标签自动恢复。巨石文件不按行数机械拆分，但出现以下任一情况即允许并应主动立项，无需等待线上故障：混合三个及以上正式 Owner 的持久状态或 writer；出现依赖环或 Core 反向依赖 Feature；以某 Surface 命名的状态被其他 Surface 共写；完整 Store/State 被跨域传递；同一热点持续阻塞已批准 lane 的并行；或 Owner 明确指定必须拆分。文件大小、import fan-in/fan-out 和 raw consumer 数量只是发现信号，不单独构成完成标准。
- 供应链告警保持独立维度；新增生产依赖必须记录许可证、体积、漏洞差量、lockfile 与可重复构建证据，不用降级或未经审核的 fork 换取绿灯。

## 6. 暂缓与非目标

- 不创建 V10，不恢复 V8 导入，不建立 V9/V8 双轨或迁移 UI。
- 不建设第二套模型规划循环、Provider 插件平台、权限审批平台、通用工作流引擎、长期 Provider Secret 存储或任意 OS 命令通道。
- 1.6–1.9 不在普通内部生产构建中显示 AI；2.0 以前 internal/reserved 接口仍不能被宣传成可用能力。
- 不因内部生产工具的主动模块化建设多租户隔离、公开插件权限市场、零信任审批平台、通用 capability broker 或假设性恶意扩展沙箱；只有分发范围、信任来源或宿主能力边界真实变化时才重新裁决威胁模型。
- 不让 OpenMAIC、安装包、未证实的兼容矩阵、判题结果自动桥、图数据库、向量库、CRDT 或协同预研进入核心发布关键路径。
- 不从历史周次、Phase、风险标签、量化评分或“企业级”表述自动建立任务；只有正式路线节点在启动时满足当前事实和工作协议，才可实例化。
- 已完成路线、发布纪要和旧审计证据不回填本文件；需要追溯时使用 Git 历史及最终综合评估报告。
