# IttoEdu 开发总纲

> 当前路线核实日期：2026-09-02。当前任务、数量和状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。
>
> 本文件只保存当前产品决定、边界和开发路线。已经完成、取消或被取代的内容在下一次路线更新时移出正文，由 Git 历史保留；不得在这里维护 changelog、完成卡清单或行号级历史源码快照。

## 1. 文档职责与权威顺序

本文件是仓库唯一长期产品与开发路线。详细规则各有唯一来源：

| 事项 | 唯一来源 |
|---|---|
| 当前产品决定、优先顺序与成功标准 | 本文件 |
| 技术不变量、模块 Owner、carrier 与协议负边界 | [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md) |
| 立项、风险、任务卡、并发、Reviewer、验证与 Git | [工作协议](docs/development-plan/WORKING_PROTOCOL.md) |
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

目标是让已有能力真正可用、稳定且可维护：

- 教师能完成编辑、保存、重开、试运行、整课播放和适用导出，并得到正确结果；
- Slide、Flow、Spatial 与 Mixed 往返稳定，各自保留正确的作者与运行语义；
- 试运行、Player 和导出读取同一份课程事实，公开控件与成功反馈不静默 no-op；
- 高频能力直接可达，低频能力可渐进披露，但必须可发现、可保存、可撤销；
- 面向 AI 的能力索引、无界面校验和课件 Skill 与真实实现一致；
- 远程图片、音视频与 API 是可声明、可预览、可发布、可诊断的正式能力；
- 重复 Store、Session、History、writer、consumer 和兼容路径持续减少，不以新增目录或抽象数量衡量进展。

当前协议与交付边界：

- 作者工程为 Course Project V9；发布为 Published Course V2；兼容 Runtime API 2/3、Component API 4 与 Interaction Protocol V1。
- V9 软冻结：已有字段、判别器和语义不得静默改写；additive 可选字段必须独立合同提交并保持 `.strict()`。不导入 V8 `.h5lesson`，不借重构创建 V10。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；`courseAiHandoff` / `courseAiPatch` 等 internal/reserved 接口不得宣称为可用工作流，也不得新增调用点。
- `artifacts/ai-capabilities` 是 Builder 的产品契约；repo-index 只是显式、可缺省、可重建且不 tracked 的本地导航缓存，不能覆盖源码事实或成为产品门。
- Runtime/Component 是经过审核的可信扩展。外部导入只是分发方式；真实 consumer 需要宿主能力时走稳定宿主接口或同宿主执行语义，不建权限审批平台。
- 远程资源和 API 按工程的精确 `https` / `wss` origin 声明开放。远程脚本暂不开放；长期 Provider Secret 不得写入工程、Published payload、组件包或导出 HTML。
- 单 HTML 明确区分离线便携与在线轻量；这是导出选择，不新增持久化 `projectMode`。
- 当前工作区第 5.1 节的确定性红灯已经清零，但已验收差异尚未形成 product commit 或固定候选并通过适用门，因此仍只能视为内部开发源码；候选固定并过门后，主要交付纯 Slide HTML，Flow / Spatial 以 HTML 为主，兼容导出与安装包不构成当前稳定发布承诺。仓库不保留历史 release 输出，安装包必须从明确固定的当前候选重新构建。
- 自动化最多证明 `engineering candidate`；真实课程的视觉、互动和教师复核决定 `art candidate` / `accepted`。

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

当前源码已兑现且不再作为待开发路线的事实：活动文字草稿进入保存、关闭脏判定与恢复快照；统一多选 Delete 是一次原子提交并清理引用；当前位置试运行携带当前命名状态；打开工程只完整解压一次；Published 静态捕获受统一截止时间约束；无效工程不会提前污染最近项目；在线轻量导出会诊断缺失的连接 origin；声明式课程状态支持 `exists` / `compare` / `set`；全局 Underlay / Overlay 已贯通合同、作者面、Slide、Flow、Spatial、Player 与 HTML，Flow 浮层可稳定处于正文下方或上方；教师控制器固定为 Overlay 兜底入口并可越过导航守卫。后续只有新的反例或相关实现变化才能重开这些事项。

## 4. 执行入口

- 开发执行只遵循 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)；本文件不复述其立项依据、风险等级、建卡条件、Reviewer、并发和验证规则。
- S2、并发、热点写入、跨会话或交接任务的实时状态只看 [任务板](docs/development-plan/TASK_BOARD.md)；普通 S0/S1 不在总纲中制造任务状态。
- 本节以下路线只表示优先顺序、启动条件和成功标准，不表示已经 Ready、已领取或已建卡。启动时必须用届时 HEAD 重新核对源码、合同、目标测试和互斥写入范围。
- 历史阶段名称、已完成卡和旧评估不能自动恢复任务；新实现必须满足工作协议的当前准入规则。

## 5. 当前开发路线

优先级以受支持场景中的用户可用性为第一轴：用户输入或数据错误高于核心流程阻断，核心流程阻断高于兼容导出、性能、维护卫生和预防性风险。

### 5.1 固定下一候选前的直接红灯

当前没有仍可复现的确定性产品或测试红灯。剩余工作是候选收口，不代表新的产品架构阶段：

1. **固定当前已验收差异**。把五个真实 consumer 生成制品、Published Slide 密集栈序测试修复及本次长期路线更新形成可整体识别、可回滚的 product commit 或紧凑提交组；不得纳入用户的 `.codex-remote-attachments/`，也不得为收口顺便修改产品实现。
2. **对固定候选执行一次适用门**。只在上述差异形成固定 SHA 后，按工作协议补齐尚未被有效证据覆盖的组合验证；同一候选、同一命令只执行一次。可缺省、未 tracked 的 repo-index 缓存即使本地 stale 也不是产品红灯；只有本次调查确需使用时才显式重建。

2026-09-02 当前工作区的直接证据是：`check:ai-capabilities`、`check:sample-examples`、`check:render-benchmark:fixture` 与任务板检查通过；`sample-project.h5lesson` 和 `render-host-benchmark-v9.h5lesson` 均通过无界面 V9 校验并允许适用导出；`publishedPhaserComponentSlideHostIntegration.test.ts` 以实际 DOM 密集栈序证明组件低于哨兵，12 项全部通过。此前通过的类型检查、合同、102 个字体切片检查及 12 个聚焦文件共 144 项测试未命中相关失效条件，继续有效。当前确定性红灯为 0；五个刷新后的 tracked 生成制品、一个测试修复与本次总纲更新仍是未提交的已验收工作区差异，不能在形成 product commit 或紧凑提交组并完成固定候选门前宣称候选可发布。过往完整测试总数和量化评分不作为当前候选门依据。

### 5.2 条件性动态 carrier

只在实际课程进入对应交付范围时启动，每项单独验收：

- **DOM Component Registry 身份完整**：缓存键必须区分同 ID 新版本、新源码和另一工程定义；切换工程或更新包后不得继续运行旧定义。
- **Published 素材闭包覆盖 direct project asset API**：Runtime `ctx.assets.projectUrl(assetId)` 与 Component `ctx.projectAssetUrl(assetId)` 引用的已保存素材必须进入 Published payload。
- **生命周期异常真实回退**：DOM Component 与 Runtime 的 `resize`、`setVisible`、`updateProps` 等异常不得保持 `ok: true` 和冻结旧画面；宿主进入可见失败并使用静态后备或占位。

### 5.3 课程逻辑合同边界

- `courseState`、`navigationGuards`、专业作者命令、Published 播放和 HTML 携带已经端到端存在，不重新立项。
- 当前声明式窄切片只包含 `course-state.exists` / `course-state.compare` 条件和 `course-state.set` 动作；不增加 increment/delete、表达式、工作流引擎或判题结果自动桥。
- 教师控制器可绕过导航守卫用于课堂强制跳转；这不改变其“兜底而非主路径”定位。
- “导出时隐藏教师控制器”属于无人监督自学场景的独立产品决定，不并入当前控制器修复。

### 5.4 兼容项与独立风险

以下事项不阻断第 5.1 节当前候选收口，只在真实交付、性能目标或新证据触发时启动：

- Spatial / Mixed PDF、PPTX 的 shape、formula、video、`surfaceLayerItems`、背景和动态静态表达完整度；
- 根级单一 Error Boundary、巨石 UI 文件、JSDOM Canvas 告警、Lint 缺失和大素材导出内存峰值目前只有结构或预防性风险，没有已复现的受支持核心流程失败；只有出现真实失败、量化收益或 Owner 决定时才按当时事实立项，不按评估中的 High / Phase 标签自动提级。
- 供应链风险单独登记，不冒充当前产品不可用：当前 `npm audit` 为 9 项（8 high / 1 moderate），`npm audit --omit=dev` 只剩 `pptxgenjs@4.0.1 → image-size@1.2.1` 的 2 项 high。其余告警位于 dev/build/test 依赖闭包，可在独立依赖更新中处理；`image-size` 当前建议修复实际要求把 `pptxgenjs` 降到 1.1.5，不作为可接受补丁。保持告警、不 suppress、不采用未经审核的 fork；上游出现兼容修复后重新评估。

### 5.5 验证与候选门

- 每个切片按工作协议选择最小充分验证：保存看 archive 保存重开，视觉看真实渲染，动态 carrier 看真实 Player，结构与合同看解析和目标测试。
- 保存/恢复、删除历史、Schema/contracts、Published/Player、main/preload 与导出语义的风险、Reviewer 和门时机只按工作协议裁决。
- 多个相关切片固定为一个候选后，再按工作协议执行适用的集成或发布门，不为每个切片重复完整验证。
- Hash 或字节比较只在制品身份、完整性或确定性本身属于合同时使用。
- 安装包不参与当前源码候选的证明；只有明确要发布安装包时才在固定候选上重新构建并验证，不因过去生成过二进制宣称当前版本已打包。

## 6. 暂缓与非目标

- 编辑器内 AI、聊天、模型、Provider 和通用 Patch 工作流统一延后到 2.0 以后；不得从 internal/reserved 接口外推当前能力。
- skill 重构、黄金样例、真实课例批量生产和判题结果自动桥只在 Owner 明确启动时进入路线，不因历史 Wave 名称自动恢复。
- 不预建 Interaction V2、Provider 插件平台、权限审批平台、V10、用户数据迁移、图数据库、向量库、Watcher、复杂 Evidence registry 或治理 dashboard。
- 未被真实课程使用的 Runtime/Component carrier、Mixed 动态静态捕获和兼容导出不为“完整矩阵”自行扩面。
- 不从历史评估的周次、Phase 标签、量化评分或“企业级”表述自动建立 UI 拆分、Canvas Mock、Lint/Hooks、覆盖率门、Web Worker、CRDT 或协同预研任务；这些方向必须重新满足当前工作协议的立项依据。
- 已完成路线、发布纪要和旧审计证据不回填本文件；需要追溯时使用 Git 历史。
