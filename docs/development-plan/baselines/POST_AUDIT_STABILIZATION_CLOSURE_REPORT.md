# 审计后稳定化收口报告

> 日期：2026-08-25（Asia/Shanghai）
>
> 审计版本：`5c512f9`（`PRODUCT_DEEP_AUDIT_2026-08-24.md`）
>
> 当前收口产品基线：`23f2d00`；Wave C 最终 spec：`97d35a5`
>
> 编号项结论：`29/29` 已有终态处置——`27 implemented / 1 skip / 1 deferred`
>
> 结果边界：已实现项最多为 `engineering candidate`；不是 `art candidate`、教师/产品 `accepted` 或发布就绪声明

## 1. 收口结论与证据边界

根审计的 29 个编号项已经逐项落到 Policy version 2 任务卡、产品提交或明确的 skip/defer 决定：全部 3 个 P0 均已实现并进入真实 Electron 波次；没有编号项无记录消失。`CROSS-03` 因当前没有真实 Flow/Spatial local Interaction carrier 而按计划以零产品改动跳过；`FLOW-12` 因需同时扩展 strict V9、Published V2 和多个 consumer 而明确延后，不能计作功能实现。

本报告只汇总已经绑定提交的 focused、集成和波次证据，不运行或重复产品测试、浏览器、typecheck、打包、导出或完整 `verify`。`implemented` 表示计划中当前合同内的目标已落地并有相应工程证据，不表示整体视觉或教师验收。`skip` 和 `deferred` 都是终态处置，但都不是功能实现。

当前 closure 候选的产品提交为 `23f2d00`。各早期证据仍按任务卡的精确 Invalidating paths 复用；后续仅命中 Flow 交互路径的修复不使 Controller/Spatial/History 等独立证据失效。审计关闭门卡仍应由 Integrator 在完成 V0 静态检查、更新任务卡状态后关闭，本报告本身不领取新的 ARCH-5 候选。

## 2. 波次证据锚点

| 锚点 | 固定边界 | 已有证据 | 可支持的最高结论 |
|---|---|---|---|
| Wave A | final freshness product `23f2d00`；unchanged gate-spec `60c130c`；原任务关闭 `53d6997` | 原相关 focused `28/28`、命中 consumer `15/15`；最终产品的 fresh desktop artifact 再跑真实 Electron `1/1`，`2.0m`，覆盖 Mixed 连续插入、Flow 原生拖选/空块几何、三 Surface 页面控制器 inert、越界/取消、保存重开和真实 Player 恢复入口 | `engineering candidate` |
| Wave B | product `58c1e45`；gate-spec `d051c37`；Properties closure `1893268` | fresh build/typecheck；刷新 cross-Surface history `2/2`；真实 Electron `1/1`，`5.1m`，覆盖控制器 Session/footprint、Spatial canonical owner/properties/clipboard/move guard、跨 Surface history/camera | `engineering candidate` |
| Wave C | product `23f2d00`；spec `97d35a5` | 最终命中 consumers `17/17 + 21/21`；fresh desktop build；单 app/profile/archive、单 test、恰好 3 个 step；真实 Electron `1/1`，约 `1m`；独立只读评审 `APPROVE` | 三个 scoped Flow 纵切为 `engineering candidate` |
| Cross-surface / diagnostics focused | products `a6fdba4`, `ac5f0e6`，集成边界 `a2f7386` / `b737820` | Surface×scope×carrier 文案/可拖矩阵、教师错误与原始 Diagnostics 分流；相应 focused、集成 typecheck 与独立评审通过 | `engineering candidate` |

Wave C 独立评审已确认 product `23f2d00` / spec `97d35a5` 无产品或测试阻塞；`stab-wave-c-flow-authoring` 已在 closure commit `2aba2fa` 同步 reviewer `APPROVE` 与 fresh desktop artifact `23f2d00` 的事实。该文档同步没有、也不需要重跑产品验证。

## 3. 29/29 审计编号终态映射

### 3.1 教师控制器与 Mixed（7/7）

| 审计 ID | 终态 | 任务卡与产品处置 | Focused / wave 证据 | Outcome |
|---|---|---|---|---|
| `CTRL-01` | implemented | `stab-ctrl-03-collapsed-hit-footprint`；`a2f7386`，折叠 DOM/hit footprint 收敛为可见胶囊 | 集成 focused `93/93`；Wave B 三 Surface pass-through/恢复 `1/1` | `engineering candidate` |
| `CTRL-02` | implemented | `stab-ctrl-03-collapsed-hit-footprint`；`a2f7386`，Flow TOC 只平移 article，不带走 viewport controller | 集成 focused `93/93`；Wave B 1280×720 TOC 开关恢复入口在安全区 | `engineering candidate` |
| `CTRL-03` | implemented | `stab-ctrl-05-mixed-runtime-session`；`b737820`，全课 collapse + Surface-scoped offsets + 原子 restart | 集成 `165/165`；Wave B Mixed Slide→Flow→Spatial 与 restart | `engineering candidate` |
| `CTRL-04` | implemented | `stab-ctrl-01-authoring-bounds-and-recovery` + `stab-ctrl-06-safe-default-collapsed`；`fcb09b1`, `acab5a2`，页面 inert 真实预览，新建/缺失恢复默认折叠且显式旧值不迁移 | ownership/bounds `8/8`、集成 `42/42`、factory/reopen `15/15`；Wave A 页面/全局作者语义；Wave B 默认运行态 | `engineering candidate` |
| `CTRL-05` | implemented | `stab-ctrl-01-authoring-bounds-and-recovery`；`fcb09b1`，唯一 Global Layer writer 安全夹取、`pointercancel` 零提交、旧数据显式重置 | focused/integration `42/42`；Wave A 四边、取消、保存重开及真实 Player | `engineering candidate` |
| `MIX-01` | implemented | `stab-mix-01-effective-order-allocation` + Wave A repair `stab-mix-03-slide-effective-order-allocation`；`0602e23`, `0f7053e`，统一 course-wide allocator | Spatial order `14/14`、Slide repair `18/18`；Wave A 默认 Slide→Spatial 两种 world item→Slide，保存后 order 唯一 | `engineering candidate` |
| `MIX-02` | implemented | `stab-mix-02-cross-surface-history-continuity`；`3a73bdc` + reviewer repair `2e6be4f`，复用唯一 canonical history，camera 保持 Session-only | integration `2/2`；Wave B 第三组真实 Electron，已回填 fulfillment | `engineering candidate` |

### 3.2 Flow（12/12）

| 审计 ID | 终态 | 任务卡与产品处置 | Focused / wave 证据 | Outcome |
|---|---|---|---|---|
| `FLOW-01` | implemented | `stab-flow-01-real-text-selection`；`f19e6c2`，恢复真实 pointer selection 并隔离外层手势 | focused `20/20`、集成 `42/42`；Wave A 原生拖选，Wave C 在最终产品再次覆盖 native range/mixed format | `engineering candidate` |
| `FLOW-02` | implemented | `stab-flow-04-stable-context-toolbar` + `stab-flow-09-toolbar-neighbor-hit-isolation`；`27ff341`, `0999b1c`；Wave C 发现的命令 click 隔离 `d6c95fc` 纳入最终产品 | toolbar/product/workspace `35/35`，neighbor consumer `15/15`；Wave A 邻块命中；Wave C 稳定工具栏/格式纵切 | `engineering candidate` |
| `FLOW-03` | implemented | `stab-flow-07-media-layout-widths`；`01eb6b0` + direct-consumer amendment `9af07fb`，Editor/Player 共用三档投影 | focused `40/40`；Wave C 比较 Editor/真实 Player 三档 actual bounding rect | `engineering candidate` |
| `FLOW-04` | implemented | `stab-flow-08-video-authoring-basics`；`8be6f70`，Store invalidator 后集成于 `2e6be4f`；真实预览、controls、同类替换、alt/caption/layout/wrap | 本卡 `14/14`、direct consumers `29/29`；Wave C 真实媒体/Player 纵切 | 当前合同内基础能力为 `engineering candidate`；高级视频字段另行 `deferred`，不是本行已实现内容 |
| `FLOW-05` | implemented | `stab-flow-08-video-authoring-basics`；`8be6f70` / `2e6be4f`；真实预览、替换、alt、题注、布局、环绕与正文顺序 | 本卡 `14/14`、direct consumers `29/29`；Wave C 真实图片/Player 纵切 | 当前合同内基础能力为 `engineering candidate`；高级 crop/focal 另行 `deferred`，不是本行已实现内容 |
| `FLOW-06` | implemented | `stab-flow-05-content-outline-and-overlays`；`03cd27a`，正文大纲与浮层层级分离 | focused `9/9`、direct consumer `3/3`、集成 `154/154`；Wave C 内容/浮层纵切 | `engineering candidate` |
| `FLOW-07` | implemented | `stab-flow-04-stable-context-toolbar`；`27ff341`，caret/range/whole-block 使用同一真实格式推导，低频能力渐进披露 | focused `35/35`；Wave C range-only 写入、exact runs 与历史 | `engineering candidate` |
| `FLOW-08` | implemented | `stab-flow-04-stable-context-toolbar`；`27ff341`，unset/uniform/mixed 由当前 draft/canonical range 推导，Properties/toolbar 共享事实 | focused `35/35`；Wave C mixed 状态与保存结果 | `engineering candidate` |
| `FLOW-09` | implemented | `stab-flow-05-content-outline-and-overlays`；`03cd27a`，owner 与 coordinate placement 分开标注 | focused/集成 `154/154`；Wave C 验证正文顺序与 overlay z-order 正交 | `engineering candidate` |
| `FLOW-10` | implemented | `stab-flow-01-real-text-selection`；`f19e6c2`，空 rich-text root 具稳定 full-width 非零几何 | focused/integration `42/42`；Wave A 空块与首字符前后真实 Chromium 几何 | `engineering candidate` |
| `FLOW-11` | implemented | `stab-flow-03-formula-edit-entry`；`7b0676c`，稳定 outer target，first-click select / second-click edit，并提供“编辑公式”入口 | focused `27/27`、集成 `165/165`；Wave C 两次真实 click + 显式入口 | `engineering candidate` |
| `FLOW-12` | deferred | `stab-flow-10-inline-formula-contract-and-vertical-slice`；decision commit `b193ebd`，未修改合同、产品或测试 | audit revision `5c512f9` + V0 合同边界复核，独立 reviewer `APPROVE` | **未实现**；继续使用独立公式块或低复杂度纯文本/Unicode，满足量化阈值后重开 |

### 3.3 Spatial（6/6）

| 审计 ID | 终态 | 任务卡与产品处置 | Focused / wave 证据 | Outcome |
|---|---|---|---|---|
| `SPATIAL-01` | implemented | `stab-spatial-03-owner-aware-insertion`；`59f5fdc`，world 保留真实插入，unsupported surface/global 不再伪承诺 | focused `15/15`、direct consumer `19/19`、集成 `65/65`；Wave B owner insertion | `engineering candidate` |
| `SPATIAL-02` | implemented | `stab-spatial-04-owner-aware-selection`；`82e59fc`，统一行用稳定 authoringAddress 切换既有 scope，失败零写入 | 集成 focused `93/93`；Wave B global/surface/world 选择与 scope | `engineering candidate` |
| `SPATIAL-03` | implemented | `stab-spatial-01-honest-properties` + `stab-spatial-06-property-autofit-isolation`；`d2e40d4`, `58c1e45`，公开属性真实写 canonical，非布局 patch 不再暗改几何 | properties `80/80`、default auto-height counterexample `16/16`；Wave B 真实 UI 与 undo/redo，已回填 fulfillment | `engineering candidate` |
| `SPATIAL-04` | implemented | `stab-spatial-02-copy-paste-duplicate`；`120243d`，Spatial-first clipboard/duplicate command，失败零写入 | focused `88/88`、direct consumers `31/31`；Wave B duplicate/Ctrl+C/V/D canonical 结果 | `engineering candidate` |
| `SPATIAL-05` | implemented | `stab-spatial-05-cross-owner-move-guard`；`093963c`，Store invalidator 后集成于 `2e6be4f`；viewport↔world 四方向拒绝且同坐标 owner 保持可用 | focused `21/21`；Wave B 提示、零写入与安全 reorder | `engineering candidate` |
| `SPATIAL-06` | implemented | `stab-diagnostics-01-teacher-facing-command-errors`；`ac5f0e6`，教师短提示与原始本地 Diagnostics 分流 | Store `65/65`、集成 `165/165`；Wave B 错误提示/严格诊断 sentinel | `engineering candidate` |

### 3.4 跨模式（4/4）

| 审计 ID | 终态 | 任务卡与产品处置 | Focused / wave 证据 | Outcome |
|---|---|---|---|---|
| `CROSS-01` | implemented | `stab-cross-01-surface-aware-insertion-affordance`；`a6fdba4`，仅 Slide 保留真实 external drag，Flow/Spatial 去除伪 draggable/payload | Surface×scope×kind focused，集成 `93/93`；独立 reviewer `APPROVE` | `engineering candidate`；不声称 Flow/Spatial 已支持 drop |
| `CROSS-02` | implemented | `stab-cross-01-surface-aware-insertion-affordance`；`a6fdba4`，相同卡片明确自由节点/文档块/浮层/世界元素 carrier | 同上，保留的单击仍走原 canonical command | `engineering candidate` |
| `CROSS-03` | skip | `stab-cross-02-interaction-properties-entry`；baseline `d2371aa` 零产品改动。Flow/Spatial 返回 `no-local-interaction-carrier`，Properties 已有诚实限制与 Automation 入口，Automation 显示 unavailable | V0 静态复核 + 独立 skip-evidence reviewer；不存在可保存的 local carrier consumer | **未新增能力**；skip condition satisfied，不造空面板或第二写路径 |
| `CROSS-04` | implemented | `stab-ctrl-01-authoring-bounds-and-recovery`；`fcb09b1`，三 Surface 页面控制器 inert/pass-through，仅 Global Layer 可持久化编辑 | focused/integration `42/42`；Wave A 页面命中穿透、全局编辑、取消与 Player | `engineering candidate` |

终态计数核对：教师控制器/Mixed `7 implemented`；Flow `11 implemented + 1 deferred`；Spatial `6 implemented`；跨模式 `3 implemented + 1 skip`。合计恰好 `27 implemented + 1 deferred + 1 skip = 29`。

## 4. 三项 Product Owner 决定：全部延后，均未实现

三项决定统一记录于 decision commit `b193ebd`，都只完成 V0 静态合同边界与独立 scope review，没有产品提交、Schema/Published producer 变更或预造实现测试。它们的 `Status: done` 表示“裁决记录完成”，不表示能力完成。

| 决定 | 与 29 项关系 | 当前替代目标 | 量化重开条件 |
|---|---|---|---|
| Flow inline formula | 对应编号项 `FLOW-12`，因此是 29 项中唯一的 `deferred` | 独立 `FlowFormulaBlock`；低复杂度内容可用纯文本/Unicode，但不得宣称为可编辑、可访问的 inline formula | 至少 `3` 份真实课件分别出现不可接受的“文字—公式—文字”需求，并有评审记录证明两种替代均失败；随后另建 additive contract 与 consumer integration 卡，预先覆盖稳定 ID/AST/a11y、编辑历史、保存重开、Player、打印、PPTX |
| Flow advanced video | 与已实现的 `FLOW-04` 当前合同内基础能力相关，但不是额外审计编号；属于附加条件性合同决定 | 继续使用预览、native controls、替换与基础布局；复杂编排先做现有 Runtime/Component 有界验证 | 至少 `3` 份真实课件需要 poster、受控 start/end 或等价高级策略，且 Runtime/Component spike 失败；先形成 autoplay、键盘/读屏可访问性和不支持导出目标的降级政策，再建合同/consumer 卡 |
| Flow advanced image | 与已实现的 `FLOW-05` 当前合同内基础能力相关，但不是额外审计编号；属于附加条件性合同决定 | 继续使用预览、替换、alt、题注与基础布局；预处理素材或显式使用 Slide 自由节点 | 至少 `3` 份真实课件需要保存重开一致的 crop/focal，且预处理素材与 Slide 自由节点均不可接受；先定义 Editor/Player/导出一致性矩阵、替换语义和降级政策，再建合同/consumer 卡 |

因此，不能把 `27 implemented` 写成 `30 implemented`，也不能把高级视频/图片的未实现内容混入已经完成的 FLOW-04/FLOW-05 当前合同基础纵切。三项延后均符合 Product Owner“难度大、风险高可先延后”的授权；达到重开阈值前不创建字段、兼容层或占位 UI。

## 5. 性能与验证错配处置

打包体积/source map 是审计风险，但不是 29 个编号项之一。`stab-perf-00-packaged-startup-baseline` 已完成的是**测量入口处置**，不是性能通过结论：下一张固定 ARCH-5 最终候选必须只打包一次，并从同一产物采集冷启动、首个可编辑画布、峰值内存、portable/app.asar/source map 和隐私事实；越过登记阈值才创建一个 exact lazy-boundary 实现卡。本审计收口不提前打包，也不以提高 warning limit 或 `manualChunks` 宣称解决。

验证层级错配已通过三条集中真实 Electron 波次处理：Wave A 守住核心创建/文本/控制器作者语义，Wave B 守住 Controller Session 与 Spatial canonical owner/history，Wave C 守住公式、格式/信息架构和当前合同媒体。focused 与波次自动化只能证明 `engineering candidate`；真实视觉、实际课程质量、教师 `accepted` 和最终发布仍留给新的 ARCH-5 固定候选及 Product Owner。

## 6. Integrator 关闭结果与下一步

`stab-audit-closure-gate` 已完成 V0 收口：

1. Wave C 复用 `2aba2fa` 已同步的 reviewer/fresh-artifact 结论，没有重复产品验证；
2. 首次独立 closure review 发现 `23f2d00` 命中 Wave A 的 `FlowWorkspace.tsx` invalidator，因而拒绝旧证据；随后在最终产品 fresh artifact 上只刷新 unchanged Wave A gate，`1/1`、`2.0m`，最终 reviewer `APPROVE`；
3. 所有依赖卡状态与本报告一致，且没有剩余未处理的 Invalidating path；
4. 任务板与 repo-index 已各生成一次，最终 freshness/diff 检查通过；本门没有运行产品测试、完整 E2E、typecheck、打包、导出或完整 `verify`；
5. 审计门关闭后可以领取新的 ARCH-5 固定最终候选；性能测量、唯一完整 V4、唯一打包产物与人工结果复核均属于下一阶段。

最终状态分层：

| 维度 | 当前结论 | 边界 |
|---|---|---|
| Audit mapping | `29/29 terminal` | 27 实现、1 skip、1 deferred；额外两项高级媒体决定 deferred |
| Pipeline | dependency/wave evidence `pass`；closure V0 `pass` | 最终 task-board/repo-index/diff checks 通过；本报告没有重复产品验证 |
| Engineering | scoped outcomes `engineering candidate` | 由任务卡 focused + Wave A/B/C 证据支持 |
| Visible outcome | 待新 ARCH-5 真实产品复核 | 自动化不能授予 art candidate |
| Accepted / release | `not claimed` | 仍需 Product Owner；性能、打包、签名与真实课程结果在下一固定候选报告 |
