# IttoEdu 开发总纲

> 计划版本：19.0（2026-08-26：整合开发效率审计；repo-index 降级为可选本地缓存；冻结无真实需求的诊断扩展与投影重构；只保留三个有当前证据的 Ready 任务）
>
> 当前活动路线：第 5 节“审计收口与生产减负”；可领取工作只看 [任务板](docs/development-plan/TASK_BOARD.md) 与对应任务卡
>
> 产品 Owner 决策现状：架构稳定化与 2026-08-24 审计的 29 项修复已收口为 owner-waived `engineering candidate`（打包与性能测量豁免，记录为未执行项）；教师 `accepted` 只保留为最终产品与发布结论。既有 V8 课例均为测试产物、没有内容迁移或兼容义务；尚存文件按真实 consumer 删除，必要验证只重建最小 V9 fixture。Runtime/Component 均是经过审核的可信扩展，外部导入只是分发方式；不因“非内置”强制隔离或禁止宿主、父页面、本地与网络能力。

本文件是仓库唯一长期开发总纲。详细规则统一在 [docs/development-plan/](docs/development-plan/README.md)：[架构合同](docs/development-plan/ARCHITECTURE_CONTRACT.md)（什么不能坏）、[工作协议](docs/development-plan/WORKING_PROTOCOL.md)（怎么干活）、[任务卡模板](docs/development-plan/TASK_CARD_TEMPLATE.md)与[修复方案](docs/development-plan/REPAIR_PLAN.md)（已确认修复事实和历史证据）。历史阶段合同、审计报告、评估与已终态任务卡由 Git 历史保存，不再作为派工入口。

权威顺序：

```text
用户当前明确决定
> 正式 Schema、合同与兼容策略
> 当前源码和可复现运行结果
> 本总纲
> Ready 任务卡与自动任务板
> docs/development-plan 参考文件
> 可选的本地 repo-index
> 历史材料（Git 历史）
```

索引、计划或任务卡与源码冲突时，先修正文档或索引，不按过时文字强改代码。repo-index 只辅助定位，不能覆盖源码、合同和可复现行为，也不能阻断产品开发。

---

## 1. 产品目标

目标不是继续增加功能数量，而是把已有能力变成真正可用、稳定、可维护的软件：

- 编辑结果可信：不会写错课件、错页面或错对象；
- 撤销、重做、保存、恢复和资源文件保持一致；
- Slide、Flow、Spatial 与 Mixed 往返稳定；
- 试运行、整课预览和各导出读取同一份课程事实；
- 高频作者行为必须在真实 Chromium / Electron 中可完成，不能用 Schema、jsdom 或样式字符串通过代替真实选区、命中、布局和媒体结果；
- 所有公开控件、拖拽承诺和成功反馈必须对应真实 canonical 工程变化或真实可用能力；未接通时必须隐藏、禁用或明确说明；
- 面向 AI 的产品契约（能力索引、无界面校验）必须与实现一致，不得有假声明；开发导航索引只是可选工具，不属于产品契约；
- 远程图片、音视频与 API 必须成为可声明、可预览、可发布、可诊断的正式能力；
- 单 HTML 同时提供离线便携与在线轻量两种明确语义，不用“单文件”暗示必然离线；
- 软件内部重复状态、重复路径和无消费者旧实现持续减少。

本产品是 AI-native 轻量课件编辑器：工程/语义检查的主要消费者是 AI（CLI 与无界面链路），人类可视化诊断面板不再投入增强（Owner 裁决，2026-08-25）。

## 2. 当前产品与协议边界

- 作者工程：Course Project V9（软冻结；additive 可选字段独立合同提交并保持 `.strict()`）；发布：Published Course V2；Runtime API 2/3；Component API 4；Interaction Protocol V1。
- 不恢复 V8 `.h5lesson` 导入，不借内部重构创建 V10。
- 当前编辑器内没有可见 AI、聊天、Provider 或网络调用；internal/reserved 接口不得宣称为可用工作流；编辑器内 AI 统一延后到 2.0 以后。
- `artifacts/ai-capabilities` 有 Builder 真实 consumer，继续作为机器可发现的产品能力契约；repo-index 没有产品运行时 consumer，只保留显式、可重建、可缺省的本地导航能力，不跟踪其缓存，不设 freshness/golden/quality 门。
- 教师控制器只在"全局层（全课）"持久化编辑；页面作者态 inert；运行态拖动只写 Session；运行态可见的教师入口也只有这个工程内全局控制器，不再叠加独立的“逃生控件”。不实现逐页/逐 location 控制器位置。
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
14. **控制器作者与运行入口唯一**：页面 inert、全局层唯一持久化入口、运行态只写 Session；不得再渲染与全局控制器重合的独立教师逃生控件。
15. **实现任务必须由证据准入**：至少有可复现失败、真实 consumer 或可量化维护成本下降之一；阶段名称、架构理想和未来可能性不能单独立项。
16. **验证只证明待改属性**：先跑足以证伪的最小检查；未命中失效条件的既有通过证据继续有效，不把重复命令、重复 Reviewer 或生成后立即同义检查当质量。

---

## 4. 执行与验证：精简生产模式

2026-08-25 起 Policy version 2 退役，开发流程为精简生产模式，完整规则见 [工作协议](docs/development-plan/WORKING_PROTOCOL.md)。要点：

- 默认路径：确认问题 → 实现一个行为 → 最小充分验证 → product commit → 合入。领取与关闭不产生独立提交。
- 单一风险维度 S0/S1/S2：S0/S1 默认不建卡（验收写进请求上下文或 commit 描述）；S2、并发协调、热点写入、跨会话或交接才建卡（最多 7 字段、三态 queued/active/blocked，完成即删卡）。有未满足前置的未来任务不预建卡；前置完成后再创建。
- 为交接或较弱执行模型建立的卡必须同时写明：当前失败证据、允许与禁止写入范围、越界停止条件、可判断验收和 1–3 条精确检查；执行者不得从 Wave 标题自行扩展范围。
- Reviewer 风险触发（合同/保存恢复/Published/main-preload/删除旧路径等），不是固定角色；默认审 diff、反例和证据缺口，不机械复跑作者命令。一次生成已经验证写入结果时，不再紧接同输入的 `--check`；完整 E2E、build、`verify` 只在真实集成或发布门执行。
- 并发三层：调查无限并行；实现按互斥写入范围并行（隔离 worktree，不设固定数量上限）；热点与集成单写者串行小批量。热点清单：Editor Store/History、App 保存恢复、Workspace/Properties、Published producer、contracts/Schema、main/preload、generated repo-index。
- 验证同 SHA 去重：作者 focused checks / Reviewer 审 diff 反例 / CI related checks / Integrator 只补组合风险 / 发布门只对固定候选一次；证据按真实依赖闭包判断失效。完整 E2E、打包与 `verify` 只在集成/发布门运行。
- tracked 生成物只有在 fresh checkout 或产品/自动化真实 consumer 必须直接读取时才保留；否则作为显式 build output。repo-index 不满足该条件，能力索引满足。
- 护栏不精简：冻结合同、S2 强制审查、热点单写者、数据类任务用副本/fixture、自动化最多 `engineering candidate`。

---

## 5. 当前活动路线：审计收口与生产减负

本节以 `442d4e1` 为审计与任务基线。旧 Wave 的已完成事实继续由产品提交和 [修复方案](docs/development-plan/REPAIR_PLAN.md) 保存；它们不再产生后续任务。当前只处理已经存在的红灯和已经量化的维护负担，不借“继续重构”增加产品范围。

### 5.1 审计结论与裁决

- **repo-index 有有限导航价值，但当前实现已成为维护负担**：9 个 tracked 生成文件约 13.41 MiB、约 29,200 行；其专用核心与测试约 6,226 行，连同 semantic/golden 超过 9,000 行；约 70 个提交触及该系统，其中 56 个刷新生成物，近期样本约 21% diff 行来自索引。它没有产品运行时 consumer，`repo-index/contexts/` 也没有能证明查询改变实现决策的留存结果。裁决是保留显式 `repo:index` / `repo:context` 的可选导航能力，移除 tracked cache、golden/quality 自证循环和默认 CI freshness 门；不新建 watcher、数据库、自动缓存或另一套质量平台。
- **能力索引不是同一类负担**：`artifacts/ai-capabilities` 约 102 KiB，Builder 直接消费，必须保留。当前只收窄 `generation-evidence.json` 的来源清单到生成器、正式合同/Schema/常量/诊断 ledger 与 catalog audit 等直接输入；不改变能力声明，不把广泛 main/preload/Player/producer 文件继续当生成依据。
- **存在过度设计**：`W4-C1` 已交付 30 个诊断码且 CLI 有真实 consumer，保留并冻结；`W4-C2` 没有当前可复现失败，撤出活动路线。`PRJ-00B`、`PRJ-01`、`PRJ-02`、`PRJ-03`、`PRJ-04` 只有阶段名称和设想，没有当前失败/consumer/验收，全部取消预排；`PRJ-05` 仅在真实预览失败或 Owner 新决定时从当前事实重新建卡。
- **存在过度验证**：上一阶段多次串行执行作者检查、独立 Reviewer、集成复查、文档同步与索引刷新；同一风险面被重复覆盖。72 项单 worker E2E、完整 `verify`、重复生成/检查不再作为每张卡的认真度证明。审计判断，长耗时主要来自串行编排、重复审查、文档/索引循环，而不是本轮实现本身天然需要十几小时。

### 5.2 当前唯一产品红灯

`npx vitest run tests/integration/architectureBaselineFlows.test.tsx --reporter=verbose` 在基线为 1/5 失败：三个固定 V9 archive 都因合成 Component metadata 缺少完整 provenance 产生 `component-package-hash-missing` warning；报告仍为 `valid=true`、`canExport=true`、error 0。修复只补 deterministic fixture provenance，不改 collector、finding code/severity、Schema、CLI、导出或性能逻辑；若做不到，任务必须 blocked，而不是扩大范围把 warning 隐藏掉。

### 5.3 唯一 Ready 工作

1. [`repair-arch0-fixture-component-provenance`](docs/development-plan/tasks/repair/repair-arch0-fixture-component-provenance.md)：修复上述红灯，先恢复固定架构基线的 warning 0。
2. [`tooling-repo-index-optional`](docs/development-plan/tasks/repair/tooling-repo-index-optional.md)：按 S2 删除 tracked cache、golden/quality consumer 与默认门，保留可选手动生成/查询。
3. [`tooling-capability-evidence-scope`](docs/development-plan/tasks/repair/tooling-capability-evidence-scope.md)：只缩小能力索引证据输入，保持其他能力制品逐字节不变。

三张卡写入范围互斥，可由不同写入者并行；`tooling-repo-index-optional` 涉及旧路径删除，必须独立 Reviewer 审查 consumer 与回滚。三张卡完成后不自动恢复 W4/PRJ/NET/RTP 占位路线，也不再进行同类全仓审计；只有新的可复现失败、真实 consumer 或量化维护成本证据才能创建下一张实现卡。

## 6. 当前路线成功门槛

- ARCH-0 三个固定 V9 archive 均 `valid=true`、error 0、warning 0、`canExport=true`，保存重开行为不变，重复构建字节确定；
- `git ls-files repo-index/generated` 为空，缓存被 ignore；默认 package/CI 不再执行 repo-index freshness、golden 或 quality 门；从缺失缓存开始，显式 `repo:index` 与一次精确 `repo:context -- --path ... --size small` 可用且不弄脏工作树；
- `artifacts/ai-capabilities` 继续可供 Builder 消费；除 `generation-evidence.json` 外的能力制品字节不变，来源清单只含直接生成输入并明确排除 broad main/preload/Player/producer 文件；
- W4-C1 的 30 个诊断码、V9 Schema、CLI/Player/Export 行为与教师能力无变化；页面不新增控制器，也不恢复独立教师逃生控件；
- 每张实现卡只执行卡内 1–3 条 focused checks；Reviewer 无新风险不复跑同命令；本批不因文档或可选索引变化执行完整 E2E、完整 build、`verify`、打包、性能或签名门；
- 未由当前失败、真实 consumer 或量化收益支撑的新增抽象、缓存、诊断码、任务卡和验证平台：0。

## 7. 当前路线之外的方向

skill 重构、黄金样例、真实课例生产、声明式数据条件与编辑器内 AI 交互仍由 Owner 另行启动。Wave 1 只建设这些未来能力都需要的网络、资源和凭证边界，不接入具体模型或 Provider。表达能力类合同继续由真实 consumer 证据准入。

## 8. 当前状态与领取入口

建卡任务（S2/并发/热点/跨会话）的状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。普通 S0/S1 直接走精简生产路径；未来任务在前置未满足时不预建卡。当前卡统一放在 `docs/development-plan/tasks/repair/**`，完成即删除。

当前任务板应为 3 张 queued 卡，对应第 5.3 节。执行者只需读取本总纲的不变量、自己的任务卡及卡中点名的源码/测试，不得通读旧 Wave 后自行补范围。优先修复 ARCH-0 当前红灯；另两张工具任务因写入范围互斥可并行，但 generated-index 始终只有一个 writer。完成三张卡后暂停并报告剩余真实问题与时间估算；不得自动继续 `W4-C2`、`PRJ-00B～05`、RTP-05、NET-C1 或其它 carrier 扩展。

历史纪要：ARCH-0A/0B（治理与 repo-index）、ARCH-1（首个事务纵切）、ARCH-2（跨 Surface 公共能力）、ARCH-3（Surface 模块化）、ARCH-4（交付链收口）、ARCH-5（清理与最终候选）、2026-08-24 深度审计的 29 项稳定化，均已终态收口。Policy version 2 与 REPAIR 初版已被当前方案取代；已提交过的历史材料可由 Git 历史读取，未提交的一次性评估只保留其已吸收结论。
