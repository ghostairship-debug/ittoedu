# IttoEdu 开发总纲

> 当前路线核实日期：2026-09-09。当前任务、数量和状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。
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
- V9 软冻结：已有字段、判别器和语义不得静默改写；additive 可选字段必须独立合同提交并保持 `.strict()`。Table、Chart 与 Slide-only input 是 Owner 已批准的三个 strict discriminator 窄例外，不构成任意扩展授权。不导入 V8 `.h5lesson`，不借重构创建 V10。
- 当前已实现本地 CLI Harness、生成内核、CLI 直连/Skills/基础聊天。按 Owner 2026-09-07 决定，1.8 起普通内部生产构建默认显示创作助手，无需 dogfood 开关；入口开放不代替 S3 实际验收。任何版本节点未真实完成前，`courseAiHandoff` / `courseAiPatch` 等 internal/reserved 接口仍不得宣称为可用能力。
- `artifacts/ai-capabilities` 是 Builder 的产品契约；repo-index 只是显式、可缺省、可重建且不 tracked 的本地导航缓存，不能覆盖源码事实或成为产品门。
- Runtime/Component 是经过审核的可信扩展。外部导入只是分发方式；真实 consumer 需要宿主能力时走稳定宿主接口或同宿主执行语义，不建权限审批平台。
- 1.7 起，生成的 Runtime/Component 必须先通过自动准入门；通过后可获得当前可信扩展已经正式具备的宿主能力，无需人工代码审核。该信任不会开放 Provider Secret、原始 Electron Main、任意 OS 命令、远程脚本或尚未进入正式合同的接口。
- 远程资源和 API 按工程的精确 `https` / `wss` origin 声明开放。远程脚本暂不开放；长期 Provider Secret 不得写入工程、Published payload、组件包或导出 HTML。
- 长期架构为完整原生CLI加GUI和编辑器连接。用户自行安装认证Codex、Claude、OpenCode；在相同账号、配置、工作上下文与有效授权下保留文件/终端/网络、用户工具/连接、Skills、子任务和模型循环。应用只做界面、原生请求与授权往返、观察、候选摄取、自动准入与canonical事务，不复制模型循环。按需小上下文不裁剪原生权限；应用不新建MCP/工具RPC平台，也不屏蔽用户原生CLI已有连接。2.x不预设迁往自建harness。
- AI 会话与工具轨迹保存在应用本地，按工程 ID 与规范化文件位置隔离；Save As 不复制会话。会话、材料与工具轨迹不进入 `.h5lesson`、Published、组件包或导出物；产品只承诺删除自身记录，不代替外部 CLI 删除其历史。
- 单 HTML 明确区分离线便携与在线轻量；这是导出选择，不新增持久化 `projectMode`。
- `v1.1.0` 是不可改写的 V9-only、主动模块化、零遗留与零降级已签署基线；`v1.1.1` 已闭合 Flow 选区字体/字号控件失焦和折叠光标待输入样式，并固定为新的维护版源码标签，不重打或移动 `v1.1.0`。1.1 的发布制品仍是对应源码标签和固定的 `examples/render-host-benchmark/render-host-benchmark-v2.html`，不含安装包。既有证据只在相关实现、依赖、测试、fixture 和验证定义未变化时复用；后续版本的发布身份仍由对应路线节点重新固定。
- 自动化最多证明 `engineering candidate`；真实课程的视觉、互动和教师复核决定 `art candidate` / `accepted`。
- 发布列车固定为：1.1（含 1.1.1 维护版）发布源码标签与固定课例离线 HTML；1.2–1.9 只发布内部源码标签；2.0 发布内部生产源码标签与固定课例离线 HTML。当前路线不承诺安装包。候选标签使用 `vX.Y.Z-rc.N`；无后缀 `vX.Y.Z` 只在 S1（1.3）、S2（1.5）、S3（1.8）、S4（2.0）四个 Owner 签署点创建并表示 `accepted`，该签署不表示对外发行。

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

优先级仍以受支持场景中的用户可用性为第一轴。路线的完整任务图、发布制品、不可降级矩阵和次旗舰执行规格位于 [`docs/development-plan/roadmap/`](docs/development-plan/roadmap/README.md)；路线节点不是协调状态，只有满足依赖、届时事实与写锁后才按协议实例化，当前 `queued / active / blocked` 仍只看任务板。

### 5.1 当前阶段：关闭1.8已核实编辑缺口，再贯通创作至2.0

2026-09-14 产品方向与工程候选专题：[教师控制台组件化与课件内深度定制方案](docs/development-plan/TEACHER_CONTROLLER_COMPONENT_PLAN.md)。默认控制台以内置组件形式嵌入工程，源码与素材随课件保存，支持纹理图片、透明分散控件及背景融合；宿主保持唯一导航和观察状态。role 合同及三 Surface/源码/导出路径已实现。2026-09-15 Owner 明确暂无生产兼容要求，删除原生控制台与转换路径，默认工厂直接创建组件，属性页统一管理组件设置。独立定位与源码事务验证通过；真实 Luna 经反馈修复已完成自动提交、保存重开、纸纹及目录布局验证，教师美术验收未完成，详见专题实施记录。复杂视觉/局部互动优先组件，原生按高频直接编辑收益补强；本专题不自动启动全部原生改造。

2026-09-14 机制实施：常规操作完整输入、候选依赖组合、同源能力条件、候选预检与恢复/结果检查，以及 Codex 原生快速模式已落地当前纵切，详见[实施方案第 9 节](docs/development-plan/AI_AUTHORING_MECHANISM_IMPLEMENTATION_PLAN.md#9-2026-09-14-开发批次与新增快速模式)及[实测记录](docs/development-plan/reviews/2026-09-14-authoring-mechanism-implementation.md)。三家 CLI 的自然跨页图形任务首次候选均经原生操作完成并保存重开；早期失败与文件路线样本保留。B2–B4 完整布局/数据/互动/批量仍归 1.9，原生 CLI 与唯一事务不变，Owner 验收独立。

2026-09-14：根据 OpenCode/Claude 真实任务复核及 Owner 明确决定，[开放修改与 CLI 文件兜底增补](docs/development-plan/R18_USER_EXPERIENCE_REPAIR_PLAN.md)已完成实现与聚焦工程验证：选择仅为输入焦点，快捷工具之外的实际 V9 文件结果经正式入口纳入唯一事务；已修复无候选早停、任务输入权限、系统代理与真实工具进度。原生 OpenCode 拒绝后文件兜底、Claude 跨页独立图形/保存重开已有真实证据；[修复记录](docs/development-plan/reviews/2026-09-14-native-editing-repair.md)区分首次错误、续跑成功与剩余原生延迟。旧证据按原范围保留，未宣称速度全解或 Owner S3。

2026-09-12：按Owner授权的[1.8真实使用修复方案](docs/development-plan/R18_USER_EXPERIENCE_REPAIR_PLAN.md)，背景与原生失败恢复、Flow失焦/版式、完整可读聊天及已核实高频入口已完成本轮工程开发与验证，见[集成记录](docs/development-plan/reviews/2026-09-12-r18-user-experience-integration.md)。当前为engineering candidate，等待Owner S3；此前B0/B1证据按原范围保留，原生CLI、单一工程事务及1.9归属保持。

2026-09-12：按[常规任务三层方案](docs/development-plan/AI_COMMON_TASK_EXECUTION_PLAN.md)完成本轮1.8 B0/B1工程实现和受影响真实验证：精确场景导航、默认选区与冻结目标、跨页后台事务/草稿/Stop、文字公式窄编辑、图片准备/语义应用及输入计时。原课件Luna/medium换图与已有图片连续编辑均有真实保存恢复证据，首轮缺陷和后修复分别记录于[B0/B1验收记录](docs/development-plan/reviews/2026-09-12-r18-b01-integration.md)。60项定义冻结但未计分；B2–B4归1.9，Owner S3、历史未验边界与正式版本标签独立保留。

2026-09-11晚间Owner真实使用仍出现Luna换图失败、slide-heavy三场景仅显示两项及默认编辑范围问题。根据后续产品讨论形成[常规任务三层执行与修改方案](docs/development-plan/AI_COMMON_TASK_EXECUTION_PLAN.md)：B0/B1关闭当前导航、目标、异步和常规应用阻断；B2–B4分批补齐常见第二层，以固定代表集及后续真实使用分别验证前两层覆盖80%以上。当前仅生成方案，尚未执行新批次；既有底座和有效证据复用，普通换图与整体速度不能凭下午Astra简化夹具通过宣称完成。

2026-09-10 Owner授权的[延迟修复与工程收尾方案](docs/development-plan/roadmap/1.8/LATENCY_COMPLETION_PLAN.md)已实施路径、计时、实际按钮反馈及会话文件临时占用修复；OpenCode本机默认为OpenAI OAuth Luna。文字、图片、排版、互动、普通T11及确定性边界已有本轮通过，旧有效证据和完整PPTX复核副本已汇合。Owner随后临时改接DeepSeek，Claude Code文字预览/应用/恢复已补验通过，解除此前通道阻断；[最终工程验收](docs/development-plan/reviews/2026-09-10-final-acceptance.md)已完成约定范围和实际失败修复，同候选E2E原范围100通过、24条件跳过，新增恢复／隔离2项通过；版本检查通过。Owner S3及报告所列未验边界仍独立，未发布。[实施记录](docs/development-plan/reviews/2026-09-10-latency-completion.md)分列新旧配置、失败和耗时，不能宣称1.8完成或整体提速。

2026-09-07 Owner实际使用证实图片不可见/改色未闭环、选区替换受阻、候选与模型/模式/反馈缺口、Flow控制器不可达。S3存在实质可用性阻断，不是仅等待签署。Owner要求助手至少达到VS Code Codex/Claude Code插件相应工作流体验，并实时理解当前课件；外部Build Skill同步按需发现/读取。

执行依据为[当前至2.0开发计划](docs/development-plan/AI_ASSISTANT_DELIVERY_PLAN.md)、[共同实施合同](docs/development-plan/roadmap/1.8/IMPLEMENTATION_CONTRACT.md)和各版DAG/独立规格。本轮专题取舍保存在[AI编辑最短路径统一方案](AI编辑最短路径产品决策报告.md)。089–104相关实现已集成，已有Flow新导出、共享组件全实例、104外部片段和Native文字自动尺寸的有效证据；不从9月8日四项审查或旧W包重新启动整批。9月9日授权批次已集成图片正例/诊断、Codex初始化/用量/消息、目录与发现、短目标/资产引用、条件终结及失败帧/预算/回执接线，实际结果和未完成事实见[实施记录](docs/development-plan/reviews/2026-09-09-short-path-implementation.md)。103/050继续汇合受影响真实三CLI证据；S3尚未签署，当前协调只看任务板。

- 1.8：先并行关闭图片、配置/可读消息、发现/提示的已核实缺口并补最小计时；在090共同合同下接齐短传输、结构化错误与100条件终结/预算/回执，保留合法多阶段续行。随后以准确小修改、整页关系调整和实际交互修改分别验证；既有组件patch/多步候选先用好，不重建。103复用有效证据并补受影响有限三CLI/双入口门，原050、PPTX、三表面、导航及S3保留；未命名与完整双流程归1.9。
- 1.9：042未命名/首次保存、045材料结构与分片、044内置自动/手动和按阶段Skills；041聊天首页、项目/会话列表、极简/专业与局部AI，043继承同一任务预算和真实回执，050按连续课例瓶颈推进增量观察、静态证据/不可变资源复用或更细源码补丁。上述优化需直接耗时/失败证据，不全部预设必建。051 PPTX并列，060汇合。
- 2.0：021实际交付内置Skills，022材料/数据控制，020把材料、教学设计、呈现、生成、修改、实际运行检查、修复和导出全部在软件内闭环；025有限有效对照、040三CLI及速度质量汇合，041 PPTX并列，050/S4签署后发布同一源码与冻结HTML。

Owner于2026-09-08最终决定分阶段完成1.8–2.0，不将全部功能压入1.8。自动创作必须上传且成功读取材料，优先模板/设计；手动依次确认教学简报、策划、呈现简报、脚本。默认极简，专业模式保留完整人工能力及相同AI。常见Native秒级、代表动态分钟级、标准整课30分钟内作为阶段目标，以真实固定课例衡量。2.0起教师无需外部AI、终端或Builder完成检查/修复。完整体验、创作策略、质量和2.1媒体/2.2运行时服务见[产品与创作优化方案](docs/development-plan/AGENT_AUTHORING_LONG_TERM_PLAN.md)。

已有[三表面工程整合](docs/development-plan/reviews/1.8-surface-integration-exit.md)、[场景/步骤导航](docs/development-plan/reviews/1.8-navigation-level-exit.md)和[CLI调用/格式修复](docs/development-plan/reviews/1.8-cli-call-format-repair.md)证据按已验证范围保留，不能外推普通AI编辑已可用。Flow D1方案A已由Owner批准：正文响应式布局与浮层统一CSS尺度，主动运行缩放单独应用；不重问该选择，089仅在相关新失败或证据失效时补修。

高频准确编辑与复杂批量/交互编辑并列验收，主指标为请求到首次正确可用结果；固定实际模型/强度/服务档比较，auto/preview与用户等待分列。不得默认降低用户强度、用坏PNG对有效PNG计算提速，或以少量样本宣称P95。自动路由、专用应用模型、直连API及新增付费服务仍需实际瓶颈证据和新的产品决定，不是当前依赖。

缩放需求仍只针对当前位置试运行与整课预览：教师控制器的独立缩放按钮、横纵平移边条和可达性保留；动态内部输入优先且不重挂实例，Flow正文scroll不重复，Spatial观察包含HUD。Slide/Flow/Spatial作者模型、V9、单一Core历史/资源事务与既有导出都保留，不创建万能Surface或第二工程。

r18-060/S3必须同时等待新增103双入口可用性、原050当前三CLI、051/052 PPTX、083三表面及087导航。PPTX媒体/效果在1.9继续、生产验收在2.0继续，不能因AI重排被遗漏。当前协调只沿既有任务卡记录阻断与新方案，不预建一批active卡，也不把历史实施授权当本轮已执行事实。

### 5.2 1.2–1.5：人工创作与外部 Builder 生产力

- **1.2 Native 编辑闭环**：在保留 Flow 正文文档流语义的前提下，补齐 Flow 原生文字/图片/图形浮层的直接作者能力与共享图形属性，并让作者浮层进入一份连续 DOCX；普通浮层只出现一次，只有 global teacher-controller 同时满足全程可见与允许静态导出才进 footer，PDF/打印不随之改变。Slide scene 增加声明式 input：提交时先把归一化答案原子写入已声明状态键再求规则，保存重开、Player 与可编辑 PPTX 静态填写区闭环；Slide surface、Flow、Spatial、global 禁止 input。Table、Chart 是仅限 Slide scene/surface 的 V9 Native strict 窄分支；Line 使用可选参数化几何，Background 在 Course/Surface/Scene/state owner 上按唯一继承算法形成完整纵切。
- **1.3 Recipe 与设计生产力**：Recipe 立即展开为普通 V9 内容，不形成第二 DSL；分类用“选中项目→选中目标组”的声明式路径，排序的真实可见重排使用当前 Component 载体并公开可编辑参数，不要求先完成通用组件化；同时交付参考页骨架、批量替换、项目色板/Design Token 范围应用与快速诊断。Chart 跨 Surface 合同、共享编辑、Flow 图表与 Spatial 图表四个必选节点复用同一图表数据与视图；新增 `r13-005`–`r13-008` 表格合同、共享编辑、Flow 正文和 Spatial 世界表格四个必选节点，沿用 FlowTableBlock 与 Native Table 既有模型，先明确兼容和适用导出，再开放 consumer。真实编辑、保存/恢复/重开、播放、导出及能力声明在 S1 前闭合；Component 的作者内容/参数及正式应用的源码资源修改同样必须持久化，活动文字草稿不能遗漏。input、Flow overlay、Spatial shared 和 global 不随本次表格扩域。
- **1.4 Authoring Tools 与 Builder v2**：update target 无损承载 canonical target；create 使用独立 scope；覆盖 Slide、Flow 正文和 Spatial world/camera/path/relation。代码工具开放前必须闭合 Component Registry 身份、direct project asset closure 与生命周期可见回退三项动态 carrier 门。
- **1.5 材料、PPTX 与内容 QA**：先建立 `WorkspaceIdentityV1 = projectId + normalizedPath` 共享基础节点，材料域与后续 AI 会话域分别依赖它；再交付应用本地材料缓存、可见引用、PPTX 原子导入、Style remix 与内容一致性检查。PPTX 在 S2 前须补齐母版/版式/占位符、常用可编辑对象与普通表格映射，未支持项须明确提示并由教师确认，达到普通教学课件可继续创作的边界。OpenMAIC 只是可选旁支，不得阻塞发布核心路径。

各版本只发布源码标签，不生成发布 HTML。

### 5.3 1.6–2.0：本地 CLI 驱动的 AI

- **1.6 Local CLI Harness**：探测、启动、流式事件、恢复、取消和本地会话隔离；Codex、Claude、OpenCode 自行登录，1.6 阶段 AI 默认隐藏（1.8 起按 Owner 决定开放入口），CLI 缺失不影响人工编辑。
- **1.7 生成内核**：Native → Recipe → Existing Component → Generated Component → Runtime 载体阶梯；CLI 只接收不可变最小 snapshot 并向 session staging/structured stdout 输出严格 typed candidate，宿主通过 1.4 canonical commands 原子提交；CLI 无 live 工程接口，自动准入失败时工程零写入。
- **1.8 当前工程AI与效率基础**：修实际阻断，接齐原生CLI必要能力与当前结构/画面/运行反馈、按需能力、窄修改；普通内部构建显示入口，103与原三CLI/PPTX/三表面/导航汇合S3。
- **1.9 聊天创作工作流**：未命名/首存、材料结构/分片、内置自动/手动、聊天主工作台、极简/专业与局部AI；恢复、长任务和连续课例优化。
- **2.0 内部生产闭环**：内置Skills、全课QA与修复、设置/数据/无障碍，标准任务速度质量与完整CLI对等；S4后发布内部生产源码与冻结HTML。

1.6–1.9 只发布源码标签；1.8 起 AI 入口默认显示；2.0 发布源码标签和固定课例离线 HTML，不做安装包。

### 5.3.1 PPTX 人工能力增强的版本节点

[PPT/PPTX 能力增强计划](docs/development-plan/PPTX_IMPORT_ENHANCEMENT_PLAN.md)与各版任务DAG同步：1.5/S2前修真实课件的小尺寸画布同步失败、分组文字继承与126次普通对象首因跳过；1.6增加旧PPT借助本机兼容软件另存为PPTX的导入入口，补下标/透明图片/翻转文字，并完成合并表格闭环；1.7补括号标注/自由路径/渐变与常见图表；1.8/S3补旧OLE公式可编辑映射与简单SmartArt；1.9补内嵌媒体/简单效果；2.0/S4做实际生产验收。各阶段有正式必选节点及发布依赖，不编造日期。

这些人工能力始终可见，不依赖 AI/CLI，作为对应版本的并列交付线进入发布依赖。整页自动图片后备及其渲染后端继续取消；Owner另行明确允许.ppt经已安装兼容软件另存为.pptx，作为1.6格式转换入口，普通PPTX不依赖该软件；复杂对象明确提示后允许部分导入，教师可自行另存图片补入。母版通常映射到导入 Slide Surface 的共享层及精确可见范围，占位符实例留在 scene；全课程全局层与 PPTX 母版不能机械等同。1.5 基本可用性不能全部推迟到后续版本。

### 5.4 发布顺序、并行与证据

版本发布门按 1.1.1 → 1.2 → … → 2.0 顺序通过；版本内DAG只保留开工硬前置；窄接口稳定后先并行实现独立叶子，真实consumer接线和完整Acceptance再汇合。路线写域与当前批次占锁分开，同一粗锁由唯一Owner持有并委派非重叠叶子，共享实体文件顺序集成。OpenMAIC 等 optional 节点不得出现在核心依赖闭包。

每个新增能力的适用人工 UI、产品命令或 Authoring Tool、保存重开、Player、导出、诊断和能力索引证据须闭合；按本次受影响路径补检并复用有效结果，不要求每个局部节点重新生成整课或重复完整矩阵；版本节点的自动化与目标测试只形成 `engineering candidate` 和 `vX.Y.Z-rc.N`。只有 S1–S4 的 Owner 对合并范围固定课例签署后，才晋升对应行为到不可降级矩阵并创建无后缀 accepted 标签；同时证明没有新增 raw Store consumer、跨 Owner deep import / 运行时依赖环、第二 Store/History/Session/writer 或重复 registry/catalog。验证仍遵循最小充分原则，不建设架构评分平台。

### 5.5 独立兼容与供应链风险

- Spatial / Mixed 的静态格式表达完整度，只按新路线中明确适用的纵切验收，不以删除格式或静态化动态内容消除差异。
- 根级 Error Boundary、Canvas 告警、Lint、内存峰值等仍须以真实失败或量化收益立项，不从旧评估标签自动恢复。巨石文件不按行数机械拆分，但出现以下任一情况即允许并应主动立项，无需等待线上故障：混合三个及以上正式 Owner 的持久状态或 writer；出现依赖环或 Core 反向依赖 Feature；以某 Surface 命名的状态被其他 Surface 共写；完整 Store/State 被跨域传递；同一热点持续阻塞已批准 lane 的并行；或 Owner 明确指定必须拆分。文件大小、import fan-in/fan-out 和 raw consumer 数量只是发现信号，不单独构成完成标准。
- 供应链告警保持独立维度；新增生产依赖必须记录许可证、体积、漏洞差量、lockfile 与可重复构建证据，不用降级或未经审核的 fork 换取绿灯。

## 6. 暂缓与非目标

- 不创建 V10，不恢复 V8 导入，不建立 V9/V8 双轨或迁移 UI。
- 完整原生CLI加GUI为长期方向，不预设自建模型循环、Provider插件平台、通用工作流/权限平台或应用另造OS命令通道。原生CLI已有终端、网络、工具与授权按原生能力保留；Runtime/Component不能继承这些CLI权限。
- 1.6–1.7 阶段 AI 默认隐藏；按 Owner 已明确决定，1.8 起普通内部生产构建默认显示创作助手，入口开放不代替 S3 验收。未完成的 internal/reserved 接口仍不能被宣传成可用能力。
- 不因内部生产工具的主动模块化建设多租户隔离、公开插件权限市场、零信任审批平台、通用 capability broker 或假设性恶意扩展沙箱；只有分发范围、信任来源或宿主能力边界真实变化时才重新裁决威胁模型。
- 不让 OpenMAIC、安装包、未证实的兼容矩阵、判题结果自动桥、图数据库、向量库、CRDT 或协同预研进入核心发布关键路径。
- 不在交互协议中加入拖放/放置触发器或顺序动作；分类使用声明式点击路径，排序使用当前 Component 载体。只有真实教师反馈要求拖放手势时才单独立项。
- 不从历史周次、Phase、风险标签、量化评分或“企业级”表述自动建立任务；只有正式路线节点在启动时满足当前事实和工作协议，才可实例化。
- 已完成路线、发布纪要和旧审计证据不回填本文件；需要追溯时使用 Git 历史及最终综合评估报告。
