# 工程修复与网络基础方案

> 日期：2026-08-25
>
> 当前质量审计基线：`3780090`；Gate R0 文档/流程基线：`b967c96`。
>
> 状态：**Gate R0 已关闭；初始 Wave 0 实现已合入，质量复核发现 4 项 Ready 补修，当前状态只看任务板**。自动化结果仍只达到 `engineering candidate`。
>
> 排除范围：skill 重构、黄金样例、真实课例生产、声明式数据条件、行内公式和具体 AI Provider 接入。本方案只建设修复项以及未来远程媒体/API/AI 都依赖的网络基础。

## 1. Owner 已裁决的产品边界

1. 既有 V8 课例均为测试产物，没有内容迁移、兼容或视觉保真义务。应删尽删；仍有真实测试/verifier consumer 时，仅用当前产品工厂重建最小 V9 fixture。
2. Runtime/Component 作者代码不得取得编辑器桌面权限：无 `desktopAPI`、Node、任意 Electron IPC、本地文件、保存、恢复或导出能力。
3. “低桌面权限”不等于“离线”。外链图片、音频、视频、HTTP API、WebSocket 与未来 AI API 是正式产品能力，应通过工程声明开放。
4. 远程脚本暂不开放。Runtime/Component 执行代码仍随课件或组件包发布；远程媒体和 API 不因此受限。
5. 单 HTML 有两种不同承诺：
   - **离线便携**：资源内嵌，文件较大；
   - **在线轻量**：保留远程资源 URL，文件较小且依赖网络。
   模式属于导出选择，不新增持久化 `projectMode`。
6. 长期 API Key 不得进入 Course Project、Published payload、组件包或导出 HTML。需要密钥的 AI/API 只能使用服务端代理、运行时用户输入或短期限域 Token。
7. 工程/语义诊断以 AI 和 CLI 为主消费者。现有 GUI 面板不另建可视化能力；若继续公开，就必须读取同一份 V9 结果，否则隐藏或退役。

## 2. 已核实的当前事实

### 2.1 作者代码与桌面权限同上下文

- `src/player/RuntimeRegistry.ts:285-293` 与 `ComponentRegistry.ts:77-81` 使用 `new Function` 并传入当前 `window`；
- `src/preload/index.ts:99-177` 在主 renderer 暴露完整 `desktopAPI`；
- `Workspace.tsx:779/1361` 的 Published try-run 直接 mount 在主 renderer；
- 编辑态已有 `sandbox="allow-scripts"` iframe、token-bound bootstrap 和 Player authoring patch 协议。

因此 SEC-01 的最短路径是复用现有隔离 Player/bridge，让 try-run 不再在主 renderer 执行作者代码；不是新建一套 BrowserWindow、Provider 或通用权限平台。

### 2.2 当前网络能力被四层封死

- V9 `AssetMeta` 只表达本地 `path/byteLength`，没有远程交付来源；
- Published producer 对每个资产强制要求本地 bytes；
- 单 HTML 与网页包 CSP 不允许远程 `img/media/connect`；
- Electron preview partition 使用空 origin 集合，HTTP(S)/WS(S) 全部拦截；
- 旧 `inspectSourceNetworkUse` 把 `fetch`、WebSocket 与外链媒体统一当作外部网络问题。

这些机制与 Owner 最新方向冲突。后续诊断只能报告**未声明或不安全的访问**，不能 blanket 禁止网络。

### 2.3 Wave 0 的真实用户缺陷

- **UI-01**：Slide 选择路径把 surface owner 折叠为 scene，surface 行可见但选中后 Properties/canvas 丢失目标；
- **CMP-01**：Flow/Spatial 组件包删除走空 `commit`，仍提示成功并返回 `true`，usage 判断还依赖残缺 V8 视图；
- **EXP-01**：package preflight 对缺失 asset 元数据 `continue`，producer 随后抛错，形成 `canExport=true` 假绿；
- **CAP-01**：能力索引声明宽泛 `project-health`，CLI 尚未提供对应的全工程语义能力。

### 2.4 诊断与缓存计划的事实修正

- Schema-invalid 工程走 `unreadable/projectHealth:null/exit 2`；成功分支 Schema issues 恒为空，不能用“成功分支映射 17 码”兑现 CAP-01；
- AI finding 缺稳定 ID-based Diagnostic Target；数组 path 重排后不可可靠修复；
- 投影缓存不能只用 `history.present`：Slide 还需 surface，Flow 需 location/scope，Spatial 需 location/surface/scope/edit；
- V9 Schema 已覆盖大量结构完整性，缺口是 post-load 语义、启发式、生命周期和交付 preflight，不是“V9 100% 无检查”。

### 2.5 V8 测试产物仍未清退

当前仍有四个 `schemaVersion: 8` 的 `.h5lesson`，以及 photosynthesis、incline-motion、render-host benchmark 相关源码/产物。文档不得再称“已清退”。处置顺序必须是：先识别活 consumer → 建最小 V9 替代 → 重写行为 oracle → 删除全部旧内容。

### 2.6 集成后完成质量审计（baseline `3780090`）

- **CAP-01 通过**：能力索引已收窄到 CLI 实际兑现的 surface-level inspect，没有发现需重开的反例。
- **UI-01 原验收未满足**：Slide backend 已能进入 surface scope，但候选投影仍把所有非 global owner 写成 scene，Store 恢复也把 surface 映射回 scene；命名状态下 surface 行还会携带 `stateId`，而属性命令拒绝带 `stateId` 的 surface target，导致 Properties 修改无 canonical commit、无法验证 undo。
- **EXA-02 原 fresh-checkout 验收未满足**：当前 `core.autocrlf=false` 工作树上的生成/check 与测试均通过，但仓库未固定相关输入的 EOL，三个生成器会直接嵌入 checkout 文本；`core.autocrlf=true` 的 Windows fresh checkout 仍可能产生不同字节。现有单测也没有实际执行 lesson/render 两条无写入 check。
- **EXP-01 合法输入 parity 已修，畸形输入仍会原生崩溃**：source-facts resolver 把“issues 全为 custom”的 Schema 失败视为可安全 raw-walk；例如 native image `content.data=null` 时，preflight 与 producer 都会泄漏 `Cannot read properties of null` 的原生 `TypeError`，而不是 Schema/合同诊断。
- **CMP-01 删除事务已修，使用位置定位仍会假成功**：Flow component 没有同 ID 的 `flow-block` location 时，UI 既未激活有效 location，也未选中 Flow block，却无条件显示“已定位组件使用位置”。有效 V9 不要求每个 Flow block 都有独立 location。

本基线上 typecheck、generator checks 与全量 Vitest（255 files / 1822 tests）均通过；这些绿色结果没有覆盖上述反例，不能作为产品完成证据。未量化的组件 usage 扫描复杂度暂不建卡，只有出现可复现性能风险后再准入。

## 3. 目标安全与网络模型

| 能力 | 作者 Runtime/Component | 执行规则 |
|---|---|---|
| `desktopAPI`、Node、文件、任意 IPC | 禁止 | 隔离执行上下文，不能靠源码扫描代替 |
| 外链图片/音频/视频 | 允许 | 资源记录声明 URL；Player/CSP 按声明放行 |
| `fetch` / EventSource / WebSocket | 允许 | 工程声明精确 `https`/`wss` origin；未声明拒绝 |
| 系统权限、下载、剪贴板、设备 | 默认禁止 | 有真实 consumer 时逐项新增窄能力 |
| 远程脚本/import | 本轮禁止 | 执行代码继续随课件发布，避免供应链运行时漂移 |
| 长期 Provider Secret | 禁止持久化/导出 | 代理、运行时输入或短期 Token |

最小实现原则：

- 资源 URL 是数据，不要求每个 Runtime 自己写加载器；
- 工程网络声明是唯一 allowlist 事实，Electron 与导出 CSP 都从它派生；
- 编辑器主 renderer 继续保持原网络边界，只有隔离 Player 获得课程声明的 origin；
- 不建审批状态机、权限仪表盘或通用插件系统；
- CORS 不可被本地代码绕过：仅播放可允许远程媒体；参与 Canvas、缩略图、PDF/PPTX 捕获时必须可验证 CORS，或使用本地 fallback/明确降级；
- 在线轻量导出失败时给出远程依赖清单，不伪装成离线产物。

## 4. 执行路线

### Wave 0：安全、契约诚实与直接用户行为

| 项 | 结果 | 写入热点 |
|---|---|---|
| `CAP-01` | 立即移除/收窄未兑现的宽泛 `project-health` 声明；实现完成后再恢复 | 非热点 generated artifact |
| `SEC-01` | try-run 作者代码进入现有 sandbox Player；`window.desktopAPI === undefined`；不把网络能力永久封死 | Workspace/Properties |
| `UI-01` | 重开原卡：surface owner 在 backend/projection/Store/命名状态中一致，Properties 写入一次 canonical history 并可撤销 | Editor Store/History |
| `CMP-01` | 删除事务与 V9 usage guard 已合入；完成事实由 product commit 承载 | Editor Store/History |
| `CMP-02` | Flow 使用位置即使没有同 ID location，也必须路由到所属 surface 的有效 location 并选中 block，不能先报成功后静默 no-op | 非热点 UI；若需 Store 必须停卡重标 |
| `EXP-01` | 合法 V9 的静态前置 parity 已合入；完成事实由 product commit 承载 | Published producer |
| `EXP-02` | Schema-invalid V9 先走结构诊断，不进入不安全 raw source-facts 遍历 | Published producer |
| `EXA-02` | 重开原卡：fresh checkout 的生成/check 对 LF/CRLF 与 `core.autocrlf` 稳定，lesson/render 边界有实际测试 | 测试/生成脚本 |

### Wave 1：网络基础纵切

1. **NET-R1 远程资源合同**：V9 以 additive 可选字段声明远程交付 URL，同时保留现有本地 bytes 作为作者缓存/离线来源；既有 V9 文件逐字节语义不变。真正 remote-only 作者资产以后按 consumer 再开，不用伪造 `path/byteLength`。
2. **NET-P1 工程网络合同**：项目声明允许的 `https`/`wss` origins；禁止 wildcard、userinfo、非网络 scheme；凭证值不进入合同。
3. **NET-E1 在线轻量单 HTML**：producer 在在线模式保留 remote URL，并从资源/连接声明生成最小 CSP；离线模式维持 data URL。
4. **NET-H1 隔离预览联网**：隔离 Player 使用课程 origin 策略；主 renderer、文件/IPC 权限不随之开放。
5. **NET-C1 媒体与捕获降级**：播放、Canvas、缩略图、PDF/PPTX 分别给出可执行结果；CORS 不满足时使用本地 fallback 或明确报告。
6. **NET-AI 边界**：只定义凭证与调用边界，不接入具体 AI Provider；长期密钥零持久化、零导出。

NET-R1 与 NET-P1 共享同一 V9 合同热点，并共同表达“课程声明远程依赖”这一行为，因此合并为一张合同卡。E1/H1/C1 在合同落地后按真实接口创建，不预建依赖卡。

### Wave 2：Validation Report 与 Diagnostic Target

- 先裁决 schema-invalid 的 status/exit/部分报告与 `reportVersion`；
- 定义 ID-based `DiagnosticTarget`，Schema-invalid 仅保留 best-effort raw path；
- 建逐码 ledger：rule、severity、target、consumer、测试；
- CAP-01 只有在实际 collector 接线后才恢复 `project-health` 声明。

### Wave 3：V8 测试产物清退与发布门

- 完成 EXA-02 后，删除 incline-motion 全链以及所有 V8 `.h5lesson`；
- photosynthesis 与 benchmark 不做内容迁移；活测试需要什么，只用当前工厂重建什么；
- `verify-release.ts` 的 controller、DOM、navigation、Published oracle 全部改为 V9/V2；
- 不用 V8→V9 migrate 兜底，不复活退役保真门；
- 巨型生成物只有存在 fresh-checkout consumer 时才 tracked，否则转显式 build output。

### Wave 4：V9 全工程诊断

按 Runtime / Interaction / Component / Controller-Media 拆分 `collectCourseProjectHealth`。网络源码分析改成 declaration parity：已声明 origin 是合法依赖，未声明访问、危险 scheme、Secret 字面量和捕获不确定性才产生 finding。新启发式先 warning；GUI 不另建产品。

### Wave 5：合成与旧投影退出

`SEM-B3` 共享合成与三方契约测试 → 有证据的 Slide preflight parity → `PRJ-00A` 去冗余 → 测量后决定 `PRJ-00B` context-aware cache → `PRJ-01` 收窄 → `PRJ-02～05` 按用户行为拆分。任何统一宿主必须沿用 SEC/NET 的隔离与 origin 策略。

## 5. 当前 Ready 任务

任务状态仍只看自动生成的任务板。本次质量审计只创建或重开已经可复现、前置已满足的卡：

1. `repair-ui-01-slide-surface-owner-selection`
2. `repair-exa-02-generation-boundary`
3. `repair-exp-02-malformed-v9-source-diagnostics`
4. `repair-cmp-02-component-usage-locate`
5. `repair-sec-01-author-code-privilege-isolation`
6. `network-contract-01-remote-dependencies`

`CAP-01` 维持关闭；`CMP-01` 与 `EXP-01` 的已合入核心行为不重开，分别由更窄的 `CMP-02`、`EXP-02` 承担相邻反例。原任务完成事实继续由 Git 历史保存。

Validation Report、Diagnostic Target、在线导出、隔离联网、CORS 捕获和 V8 删除卡都在前置完成后再创建。

## 6. 并发安排

- 通道 A：SEC-01，限定 Workspace/隔离 Player，不预先写 main/preload 或 Published producer；
- 通道 B：UI-01，独占 Editor Store/History，收口 surface owner 与命名状态写入；
- 通道 C：EXP-02，独占 Published producer；
- 通道 D：EXA-02，限定生成边界、EOL 规则与直接测试；
- 通道 E：NET-R1/NET-P1 合同作为一个原子提交，避免同一 Schema 的两次串行往返。
- 通道 F：CMP-02，只处理已复现的 Flow 定位 UI，可与 UI-01 并行；若实证必须写 Store，停卡并重标 `editor-store-history`，等待通道 B 释放热点。

每个通道使用隔离 worktree。若 SEC-01 实证必须修改 main/preload、Published producer 或合同，先停止并重标 hotspot，不能越界写入。

## 7. 成功门槛

- 作者代码可触达 `desktopAPI` 的路径：0；
- 已声明远程资源/API 被 blanket 拦截：0；未声明 origin 可重复放行：0；
- 长期 API Key 进入工程或导出物：0；
- 能力索引与 CLI 实现不一致：0；
- surface owner 在 backend/projection/Store/authoringAddress 中不一致：0；命名状态下 surface 属性修改缺 commit 或 undo：0；
- Flow 组件 usage 定位在未激活所属 surface 的有效 location、未选中 block 时报告成功：0；
- Schema-invalid V9 的 preflight/producer 泄漏原生 `TypeError`：0；同一输入的 `project-schema-invalid` code/首个 Zod issue path 漂移：0；合法 V9 静态前置的 shared code/path 漂移：0；
- 连续两次测试准备造成 tracked 工作树漂移：0；LF/CRLF 或 `core.autocrlf=true/false` 导致 fixture 字节漂移：0；
- V8 `.h5lesson` 与无 consumer 的旧课例链：0；
- 新增语义码直接以 error 阻断既有工程：0；
- 热点并行写冲突：0；
- 自动化最多声明 `engineering candidate`。

## 8. 已否决路线

- 把“不可信作者代码”等同于“禁止外部网络”；
- 在主 renderer 中继续执行作者代码，仅靠 IPC sender 检查或源码正则防护；
- 开放网络的同时暴露 `desktopAPI`、Node 或通用 IPC；
- 把长期 AI/API Key 写入工程、组件、Published payload 或单 HTML；
- 用 `connect-src *`、任意 wildcard origin 或远程脚本换取实现便利；
- 在成功分支映射不存在的 17 个 Schema issue；
- 单键 `history.present` 投影缓存；
- CLI 复用有损 V9→V8 投影喂旧分析器；
- 迁移或精修旧 V8 课例内容；
- 只把生成物 ignored 而不保证 fresh checkout；
- blanket 消灭“未变化”、无阈值性能优化、GUI 诊断增强；
- 新建权限审批平台、图数据库、证据平台或 Provider 插件框架。

## 9. Gate R0 关闭证据

1. 总纲、架构合同、网络边界和精简任务机制已形成固定提交 `b967c96`；
2. Gate 关闭当时的首批 7 张卡均记录该基线，初始任务板为 `queued: 7`；完成事实与后续重开由 Git 历史记录，当前状态只看任务板；
3. typecheck、14 项治理测试、合同/能力/任务板/repo-index freshness 与 repo-index quality 已通过；
4. 后续实现只从任务板领取，不从 Wave 标题直接派工。
