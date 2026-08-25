# IttoEdu 开发总纲

> 计划版本：17.8（2026-08-26：LEG-005A 已删除正常 V9 生命周期不可达的 PDF source-null Runtime raster并独立审查通过；RTP-04 active，CMP-03 因共享 Slide Published host 排队）
>
> 当前活动路线：第 5 节“工程修复与网络基础——Gate R0 → Wave 0–5”；详细证据与开工顺序见 [修复方案](docs/development-plan/REPAIR_PLAN.md)
>
> 产品 Owner 决策现状：架构稳定化与 2026-08-24 审计的 29 项修复已收口为 owner-waived `engineering candidate`（打包与性能测量豁免，记录为未执行项）；教师 `accepted` 只保留为最终产品与发布结论。既有 V8 课例均为测试产物、没有内容迁移或兼容义务；尚存文件按真实 consumer 删除，必要验证只重建最小 V9 fixture。Runtime/Component 均是经过审核的可信扩展，外部导入只是分发方式；不因“非内置”强制隔离或禁止宿主、父页面、本地与网络能力。

本文件是仓库唯一长期开发总纲。详细规则统一在 [docs/development-plan/](docs/development-plan/README.md)：[架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)（什么不能坏）、[工作协议](docs/development-plan/WORKING_PROTOCOL.md)（怎么干活）、[任务卡模板](docs/development-plan/TASK_CARD_TEMPLATE.md)、[修复方案](docs/development-plan/REPAIR_PLAN.md)（当前路线的详细证据与批次）。历史阶段合同、审计报告、评估与已终态任务卡由 Git 历史保存，不再作为派工入口。

权威顺序：

```text
用户当前明确决定
> 正式 Schema、合同与兼容策略
> 当前源码和可复现运行结果
> 本总纲
> docs/development-plan 详细执行文件
> 自动生成的 repo-index 与任务板
> 历史材料（Git 历史）
```

索引、计划或任务卡与源码冲突时，先修正索引或任务卡，不按过时文字强改代码。

---

## 1. 产品目标

目标不是继续增加功能数量，而是把已有能力变成真正可用、稳定、可维护的软件：

- 编辑结果可信：不会写错课件、错页面或错对象；
- 撤销、重做、保存、恢复和资源文件保持一致；
- Slide、Flow、Spatial 与 Mixed 往返稳定；
- 试运行、整课预览和各导出读取同一份课程事实；
- 高频作者行为必须在真实 Chromium / Electron 中可完成，不能用 Schema、jsdom 或样式字符串通过代替真实选区、命中、布局和媒体结果；
- 所有公开控件、拖拽承诺和成功反馈必须对应真实 canonical 工程变化或真实可用能力；未接通时必须隐藏、禁用或明确说明；
- 面向 AI 的契约（能力索引、无界面校验、开发索引）必须与实现一致，不得有假声明；
- 远程图片、音视频与 API 必须成为可声明、可预览、可发布、可诊断的正式能力；
- 单 HTML 同时提供离线便携与在线轻量两种明确语义，不用“单文件”暗示必然离线；
- 软件内部重复状态、重复路径和无消费者旧实现持续减少。

本产品是 AI-native 轻量课件编辑器：工程/语义检查的主要消费者是 AI（CLI 与无界面链路），人类可视化诊断面板不再投入增强（Owner 裁决，2026-08-25）。

## 2. 当前产品与协议边界

- 作者工程：Course Project V9（软冻结；additive 可选字段独立合同提交并保持 `.strict()`）；发布：Published Course V2；Runtime API 2/3；Component API 4；Interaction Protocol V1。
- 不恢复 V8 `.h5lesson` 导入，不借内部重构创建 V10。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；internal/reserved 接口不得宣称为可用工作流；编辑器内 AI 统一延后到 2.0 以后。
- 教师控制器只在"全局层（全课）"持久化编辑；页面作者态 inert；运行态拖动只写 Session。不实现逐页/逐 location 控制器位置。
- 打包分发当前不是交付目标；恢复打包时须随新的固定候选补齐打包、性能与签名证据。
- Runtime/Component 是经过审核的可信扩展。它们可按真实 consumer 需要使用当前宿主提供的父页面、本地、桌面或其他能力；实现优先走稳定宿主接口或同宿主执行语义，不建权限审批平台。不同导出/嵌入环境可用能力不同，不得把桌面专属能力伪装成通用网页承诺。
- 远程资源和 API 按工程声明开放。精确 `https`/`wss` origin 声明服务于预览、发布、CSP、可移植性和诊断，不用来推导扩展代码不可信。远程脚本不随本轮开放，若确有 consumer 另立合同。
- 单 HTML 导出至少区分：离线便携（资源内嵌、文件较大）与在线轻量（远程资源保留 URL、依赖网络）。模式是导出选择，不新增持久化 `projectMode`。
- 静态 HTML 无法安全保存长期 API Key。AI Provider 凭证只能走服务端代理、运行时用户输入或短期限域 Token；不得写入工程、Published payload 或导出 HTML。
- 其余现状硬约束（25 组 must preserve、模块 Owner、carrier 矩阵、棘轮）见 [架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)。

## 3. 统一架构的不变量

1. **一个可写工程真相**：所有持久化编辑最终只修改一个 `CourseProjectDocument`。
2. **恰好一个活动编辑会话**：Slide、Flow、Spatial 三种后端互斥激活。
3. **一次用户操作，一次逻辑提交**：文档、素材字节和组件资源同步进入一条撤销历史。
4. **延迟操作必须认原目标**：异步回调不能在切页后写入新页面。
5. **Surface 保留各自语义**：Slide 用 LayerItem；Flow 正文用 FlowBlock / FlowComponentBlock；Flow 浮层和 Spatial 世界用各自正确载体。
6. **Preview/Player/Export 只读**：不从 Player DOM、Canvas 或 Published payload 反建作者工程。
7. **Core 不依赖具体 Surface**：跨模块动作由应用用例组合。
8. **不新增第二套 Store、Session、History 或持久化模式**。
9. **不以目录移动证明解耦**：只有责任、消费者和返工实际减少才算完成。
10. **已有教师能力不得缩水**：低频能力可渐进披露，但必须可发现、可保存、可撤销。
11. **作者与交付的有效域必须闭合**：作者端允许保存的状态必须被 Preview、统一画布、Published Player 和适用导出接受。
12. **公开入口必须诚实**：禁止静默 no-op、伪成功和底层校验 JSON 直出。
13. **面向 AI 的契约必须诚实**：能力索引声明的检查、文档路由和能力状态必须与实现一致。
14. **控制器作者范围唯一**：页面 inert、全局层唯一持久化入口、运行态只写 Session。

---

## 4. 执行与验证：精简生产模式

2026-08-25 起 Policy version 2 退役，开发流程为精简生产模式，完整规则见 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)。要点：

- 默认路径：确认问题 → 实现一个行为 → 最小充分验证 → product commit → 合入。领取与关闭不产生独立提交。
- 单一风险维度 S0/S1/S2：S0/S1 默认不建卡（验收写进请求上下文或 commit 描述）；S2、并发协调、热点写入、跨会话或交接才建卡（最多 7 字段、三态 queued/active/blocked，完成即删卡）。有未满足前置的未来任务不预建卡；前置完成后再创建。
- Reviewer 风险触发（合同/保存恢复/Published/main-preload/删除旧路径等），不是固定角色；默认复用证据不重复执行相同命令。
- 并发三层：调查无限并行；实现按互斥写入范围并行（隔离 worktree，不设固定数量上限）；热点与集成单写者串行小批量。热点清单：Editor Store/History、App 保存恢复、Workspace/Properties、Published producer、contracts/Schema、main/preload、generated repo-index。
- 验证同 SHA 去重：作者 focused checks / Reviewer 审 diff 反例 / CI related checks / Integrator 只补组合风险 / 发布门只对固定候选一次；证据按真实依赖闭包判断失效。完整 E2E、打包与 `verify` 只在集成/发布门运行。
- 护栏不精简：冻结合同、S2 强制审查、热点单写者、数据类任务用副本/fixture、自动化最多 `engineering candidate`。

---

## 5. 当前活动路线：工程修复与网络基础——Gate R0 → Wave 0–5

唯一详细台账见 [修复方案](docs/development-plan/REPAIR_PLAN.md)。本节只记录依赖顺序和 Owner 已裁决边界，不复制任务状态。本轮仍不含 skill 重构、黄金样例、真实课例生产、声明式数据条件或行内公式；新增范围只有 Owner 已明确要求的远程资源、API 与轻量在线导出。V9 继续软冻结，网络字段只能走 additive 可选合同。

- **Gate R0（已关闭）**：网络方向和精简流程已经裁决；原基线 `b967c96` 中“外部作者代码=低权限代码”的信任前提已被 Owner 本次明确替代。初始任务的完成事实由 product commit 承载，当前状态只看任务板。
- **Wave 0 契约诚实与直接用户行为**：`CAP-01` 移除了未兑现的宽泛 `project-health` 声明；`UI-01`、`CMP-01`、`EXP-01` 及其集成后补修已由 product commit 承载。`SEC-01` 基于错误信任前提，未合入产品代码并已取消。
- **Wave 0 集成后质量补修（审计基线 `3780090`）**：`CAP-01` 维持关闭；`UI-01`、`EXA-02`、`EXP-02` 与 `CMP-02` 已由各自 product commit 收口，完成事实见 Git 历史与当前修复方案，不再以过期的 Ready 文案派工。
- **Published Runtime parity（独立 S2 纵切）**：RTP-01/02 已证明 Slide scene-local 与 Flow surface-local API 3 DOM playback；RTP-03 又接通教师可从开发工作台真实创建的 Slide scene-local API 2 DOM/Phaser/hybrid，并覆盖跨 generation、暂离/恢复、失败隔离及 Phaser 核心资源销毁。API 2 的宿主动作、presentation 与节点解析仍是明确的 partial context；Spatial、global scope、非 Flow 共享层与捕获继续按真实 consumer 逐项准入，不接回 Legacy Player。
- **Wave 1 网络基础纵切**：远程资源交付、工程网络声明、在线轻量单 HTML 与真实 V9 当前位置/整课预览联网均已落地。预览只投影实际 Published 引用的远程工程素材，main session 以可撤销 lease 精确裁决 origin，并以每文档随机 capability 拒绝 reload 前旧文档迟到的 set/release；静态 CSP 不开放远程脚本，CORS/TLS 仍由浏览器执行。后续只按真实 HTTP/WebSocket 与捕获 consumer 准入 API/CORS 降级；长期密钥不进入静态课件。
- **Wave 2 诊断合同**：Validation Report 与 Diagnostic Target 分别定约，再实现逐码 ledger。原“成功分支映射 17 码”控制流不可达，继续否决。
- **Wave 3 V8 测试产物清退与真实发布门**：生成物/fresh checkout 前置已经关闭；无 consumer 的 incline-motion 全链已删除，photosynthesis 也已由三 Slide Course Project V9 archive + Published V2 离线交互 oracle 替代并删除专属旧组件链。仓库仍保留 sample 与 render-host benchmark 两个有活 consumer 的 V8 `.h5lesson`；sample、benchmark/release 与 portability 都先被 Published Phaser Component parity 阻塞，只能在替代行为门就绪后逐项建卡，不迁移旧课例设计。
- **Wave 4 V9 全工程诊断**：CLI 是主消费者；现有 GUI 面板要么读取同一份 V9 结果，要么隐藏/退役，不单独建设可视化诊断产品。网络诊断只报告未声明 origin、无效 URL、CORS/捕获不确定性和凭证泄露风险，不再把所有外链视为错误。
- **Wave 5 合成与旧投影退出（条件准入）**：共享合成层与契约测试 → 有证据的 Slide 预检 parity → `PRJ-00A/B` → `PRJ-01` → `PRJ-02～05` 按用户行为拆分。宿主统一必须保留 Runtime/Component 的可信扩展语义、生命周期、真实宿主能力和工程网络声明。

上一批三个互斥 S2 已按 photosynthesis V9/V2 oracle → Slide API 2 Published playback → 真实 V9 预览联网的顺序合入并通过固定候选 `7d17fed` phase gate；独立 Reviewer 发现并关闭了 Phaser 核心销毁、overlay A→B 授权残留与跨文档迟到 IPC 三类 P1。最新 consumer 审计确认 RTP-04 session-global API 2 Runtime 与 CMP-03 Slide Phaser Component 均 Ready；二者共享 Slide Published host，当前只激活 RTP-04，CMP-03 排队并在 RTP-04 合入后重置 baseline。`f3fd31f` 的正常 V9 生命周期表征又解锁 LEG-003，产品提交 `63fbf66` 已删除 HTML/Web/full-preview 的 V8 回退及其专属 desktop preview IPC/window/protocol，并经独立审查通过。网络/CORS/捕获因没有真实作者消费链继续 No-Ready。

已删除/降级项：`HYG-02` 删除（8 处均为合法 unchanged guard）；`HYG-01/03/05` 降级或移出产品路线；`NAV-01` P2 登记。已完成治理项：`CAP-02`、`CAP-03`、`HYG-04`。

## 6. 当前路线成功门槛

- 能力索引声明与 CLI 实现不一致处：0；未兑现能力先收窄，完成实现后再恢复声明；
- Wave 0 用户可达缺陷（surface 选择、组件删除/定位假成功、preflight 假绿）未闭合数：0；
- Runtime/Component 文档或新实现把“外部导入”误当“不可信代码”并强制低权限执行：0；
- Published V2 在合法 Runtime carrier 上只画 fallback、没有执行真实 Runtime 的路径：按独立纵切逐项归零；当前只宣称 Slide scene-local API 2 DOM/Phaser/hybrid、Slide scene-local API 3 DOM 与 Flow surface-local API 3 DOM 三个 slice，不冒充完整宿主上下文或全 carrier parity；
- Slide surface 的 backend、projection、Store owner token 一致；命名状态下修改 surface 属性产生且只产生一次 canonical V9 commit，undo 后可恢复；
- Schema-invalid V9 不进入不安全 source-facts 遍历，preflight/producer 共享 `project-schema-invalid` code 与首个 Zod issue path，抛出的原生 `TypeError`：0；合法 V9 的缺 metadata/bytes/component closure 仍保持共享稳定 code/path；
- Flow 组件使用位置只有在所属 surface 的有效 location 已激活且 block 真实选中后才报告成功；无法解析的 Flow 使用位置假成功：0；
- 连续两次 `pretest:e2e` 后 `git status --porcelain` 非空：0；fresh checkout 上 `npm test` 因缺生成物失败：0；`core.autocrlf=true/false` 两种 checkout 的生成结果字节漂移：0；
- `verify:release` 在"GUI 打开示例"段失败：0（含 oracle 重写，不只换 opener）；
- 在线轻量单 HTML 能保留声明的远程图片/音视频 URL，并生成最小必要 CSP；离线便携模式继续内嵌资源；
- 预览与发布宿主按工程声明正确处理 `https`/`wss` origin，且不因网络策略破坏已明确提供的宿主能力；
- 工程、Published payload 与导出 HTML 中长期 Provider Secret：0；
- 网络静态诊断把“未声明访问”与“已声明远程依赖”分开，不再 blanket 禁止 `fetch` 或外链媒体；
- 公开操作假成功（空 commit 后报成功、静默 no-op）：0；
- 新增语义码以 error 回归阻断既有离线便携或网页包导出：0；新在线轻量模式只阻断其自身无法形成精确 CSP 的输入，诊断迁移验收使用 added/removed/changed 对照表；
- 已有教师能力缩水：0；热点并行写冲突：0；
- 流程量化验收见工作协议第 12 节（S0/S1 治理提交 0、同 SHA 重复验证 0 等）。

## 7. 当前路线之外的方向

skill 重构、黄金样例、真实课例生产、声明式数据条件与编辑器内 AI 交互仍由 Owner 另行启动。Wave 1 只建设这些未来能力都需要的网络、资源和凭证边界，不接入具体模型或 Provider。表达能力类合同继续由真实 consumer 证据准入。

## 8. 当前状态与领取入口

建卡任务（S2/并发/热点/跨会话）的状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。普通 S0/S1 直接走精简生产路径；未来任务在前置未满足时不预建卡。当前卡统一放在 `docs/development-plan/tasks/repair/**`，完成即删除。

当前任务板以 RTP-04 为 active、CMP-03 为 queued；CMP-03 因共享 Slide Published host 等 RTP-04 合入。LEG-005A 已让 PDF 预检后 source 消失明确失败并删除不可达 Runtime raster，合法纯 Slide raster、Mixed V2、PPTX capture 与 PDF preflight 均保留。CMP-03 通过后再分别审计 sample、benchmark/portability/release 的最小 V9/V2 替代，不打包成“大清退”；其余纵切继续按 consumer 证据准入。

历史纪要：ARCH-0A/0B（治理与 repo-index）、ARCH-1（首个事务纵切）、ARCH-2（跨 Surface 公共能力）、ARCH-3（Surface 模块化）、ARCH-4（交付链收口）、ARCH-5（清理与最终候选）、2026-08-24 深度审计的 29 项稳定化，均已终态收口。Policy version 2 与 REPAIR 初版已被当前方案取代；已提交过的历史材料可由 Git 历史读取，未提交的一次性评估只保留其已吸收结论。
