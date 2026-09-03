# 1.1｜V9-only、主动模块化与零降级稳定底座

> 本目录是规划规格，不是任务状态。任何节点只有在前置结果仍成立、届时 HEAD 事实与规格一致、写锁无冲突时，才可按工作协议实例化；当前协调状态只看任务板。

## 交付结果

在不削弱 PM-01 至 PM-28 任一受支持行为的前提下，使 `src/**`、`tests/**`、`scripts/**`、`examples/**`、`artifacts/**`、fixture 与正式生成制品不再依赖 V8 工程模型、V8 Schema、旧 Player/Export payload 或 V8 测试工具链；同时把当前 `editorStore.ts`、App/Workspace/Properties/Flow UI、Slide Published adapter 与 Course package builder 按正式 Owner 拆分。1.1 不改变 V9 / Published V2 wire，不导入 V8，不创建 V10，不新增第二 Store/Session/History。

发布制品是 `v1.1.0` 源码标签和固定课例离线便携 HTML；不做安装包。

## 执行规则

1. 一次只执行一个规格；完成后停止，不自动领取后继节点。
2. 开始前读取当前总纲、任务板、规格的 Read first、直接 producer/consumer 和目标测试；不要按旧 SHA、历史行号或旧 ZIP 强行修改。
3. 先证明替代 consumer 的保存、重开、Player 或导出行为等价，再删除旧 consumer。Legacy 唯一机器台账是 `../../inventories/legacy-consumers.json`，不得创建第二份 allowlist。台账只对其 `reconciledProductCommit`、`reconciledScope` 与排除 inventory 自身的 product tree digest 声明精确；后续 lane 迁移不得并行修改共享 JSON，只允许实际 consumer 减少，因此旧 confirmed 集合是安全上界。发现漏记或新增旧 consumer 时立即停止并退回 r11-002；r11-053 在集成 HEAD 原子复核后，r11-054 才能删除模块。
4. 只写规格允许的路径。需要越界、需要改变 V9/Published wire、需要降级功能、consumer 未清零或基线事实已变时，停止并交回 Integrator 重裁。
5. 不使用 `any`、`.passthrough()`、silent strip、silent fallback、no-op、隐藏入口、静态占位或弱化断言实现绿灯。
6. 每个中间提交都必须可运行；不得以“最终任务会恢复”为理由暂时删除 UI、导出、Runtime/Component 或历史能力。
7. Focused validation 只列当前仓库真实存在的命令和测试文件。若命令失效，停止更新规格；不得自行换成未声明的大门掩盖漂移。
8. 自动化最多形成 `engineering candidate`；Owner 对固定课例与固定候选签署 `accepted`。
9. 模块迁移一次只迁一个 Owner 闭环：新模块接管 state/action/use case 的同一提交必须删除原 writer/实现；不得以完整 Store Facade、root re-export、raw `get()` 注入、同文件代理或“先双写后清理”作为中间方案。

## 任务图

| Task | 结果 | Dependencies | Write locks | Spec |
|---|---|---|---|---|
| r11-000-authority-contracts | 锁定 1.1 执行权威 | — | contracts-schema | [spec](r11-000-authority-contracts.md) |
| r11-001-preservation-baseline | 建立不可降级行为基线 | r11-000-authority-contracts | generated-index | [spec](r11-001-preservation-baseline.md) |
| r11-002-legacy-inventory-zero-check | 刷新唯一 Legacy 台账与零门 | r11-001-preservation-baseline | contracts-schema,legacy-inventory | [spec](r11-002-legacy-inventory-zero-check.md) |
| r11-010-domain-contract-extraction | 抽取仍有效的领域合同 | r11-002-legacy-inventory-zero-check | contracts-schema | [spec](r11-010-domain-contract-extraction.md) |
| r11-011-v9-native-schema-independence | 解除 V9 Native 对旧 Scene Schema 的依赖 | r11-010-domain-contract-extraction | contracts-schema | [spec](r11-011-v9-native-schema-independence.md) |
| r11-012-published-v2-schema-independence | 解除 Published V2 对旧工程模型的依赖 | r11-011-v9-native-schema-independence | contracts-schema,published-producer | [spec](r11-012-published-v2-schema-independence.md) |
| r11-013-shared-native-consumers | 迁移共享 Native consumer | r11-012-published-v2-schema-independence | contracts-schema,workspace-properties | [spec](r11-013-shared-native-consumers.md) |
| r11-014-media-design-component-consumers | 迁移 Media/Design/Component consumer | r11-012-published-v2-schema-independence | contracts-schema | [spec](r11-014-media-design-component-consumers.md) |
| r11-020-slide-effective-read-model | Slide 使用只读 V9 effective view | r11-013-shared-native-consumers | workspace-properties | [spec](r11-020-slide-effective-read-model.md) |
| r11-021-slide-properties-editors | 属性与高级编辑器使用 V9 view/command | r11-020-slide-effective-read-model | workspace-properties | [spec](r11-021-slide-properties-editors.md) |
| r11-022-slide-actions | Slide 动作完全走 V9 command/history | r11-020-slide-effective-read-model | editor-store-history | [spec](r11-022-slide-actions.md) |
| r11-023-flow-viewstate | Flow 视图只读 V9 session | r11-013-shared-native-consumers | workspace-properties | [spec](r11-023-flow-viewstate.md) |
| r11-024-spatial-viewstate | Spatial 视图只读 V9 session | r11-013-shared-native-consumers | workspace-properties | [spec](r11-024-spatial-viewstate.md) |
| r11-026-slide-properties-modules | Slide 与全局属性形成真实模块边界 | r11-021-slide-properties-editors,r11-027-flow-authoring-modules,r11-028-spatial-authoring-modules | workspace-properties | [spec](r11-026-slide-properties-modules.md) |
| r11-027-flow-authoring-modules | Flow Workspace、文本、Overlay 与属性解耦 | r11-023-flow-viewstate | workspace-properties | [spec](r11-027-flow-authoring-modules.md) |
| r11-028-spatial-authoring-modules | Spatial Workspace 与属性形成独立模块 | r11-024-spatial-viewstate | workspace-properties | [spec](r11-028-spatial-authoring-modules.md) |
| r11-029-slide-workspace-modules | Slide Workspace、动态目标与画布控制器解耦 | r11-022-slide-actions,r11-027-flow-authoring-modules,r11-028-spatial-authoring-modules,r11-033-runtime-authoring-preview-v2 | workspace-properties | [spec](r11-029-slide-workspace-modules.md) |
| r11-025-editor-store-v9-only | Surface Store 清除 V8 镜像与旧 writer | r11-026-slide-properties-modules,r11-029-slide-workspace-modules | editor-store-history,workspace-properties | [spec](r11-025-editor-store-v9-only.md) |
| r11-034-app-project-lifecycle-module | App 打开、保存与 Recovery 形成生命周期模块 | r11-025-editor-store-v9-only,r11-051-v9-archive-only | app-save-recovery,workspace-properties | [spec](r11-034-app-project-lifecycle-module.md) |
| r11-035-app-delivery-module | App Preview、Preflight 与导出形成 Delivery 模块 | r11-025-editor-store-v9-only,r11-032-player-v2-only-entry | published-producer,workspace-properties | [spec](r11-035-app-delivery-module.md) |
| r11-036-app-import-input-modules | App 素材/组件导入与全局输入路由解耦 | r11-014-media-design-component-consumers,r11-025-editor-store-v9-only | editor-store-history,workspace-properties | [spec](r11-036-app-import-input-modules.md) |
| r11-037-editor-store-owner-modularization | 按 Owner 拆 Store 并清除最后旧工程真相 | r11-025-editor-store-v9-only,r11-032-player-v2-only-entry,r11-034-app-project-lifecycle-module,r11-035-app-delivery-module,r11-036-app-import-input-modules | editor-store-history,workspace-properties | [spec](r11-037-editor-store-owner-modularization.md) |
| r11-030-native-render-boundary | 建立非持久化 Native render input | r11-013-shared-native-consumers,r11-014-media-design-component-consumers | published-producer | [spec](r11-030-native-render-boundary.md) |
| r11-031-published-slide-player | Slide Player 直接消费 Published/V9 模型 | r11-012-published-v2-schema-independence,r11-030-native-render-boundary | published-producer | [spec](r11-031-published-slide-player.md) |
| r11-032-player-v2-only-entry | Player 入口只接受 Published V2 | r11-033-runtime-authoring-preview-v2,r11-041-pptx-v2-only,r11-042-pdf-v2-only,r11-043-html-web-v2-only | published-producer | [spec](r11-032-player-v2-only-entry.md) |
| r11-033-runtime-authoring-preview-v2 | 作者预览切换到 Published V2 | r11-014-media-design-component-consumers,r11-031-published-slide-player,r11-050-v9-fixture-foundation | workspace-properties,published-producer | [spec](r11-033-runtime-authoring-preview-v2.md) |
| r11-040-v9-health-preflight | 统一 V9 diagnostics 与导出预检 | r11-013-shared-native-consumers,r11-014-media-design-component-consumers | published-producer | [spec](r11-040-v9-health-preflight.md) |
| r11-041-pptx-v2-only | PPTX 只消费 Published V2/capture | r11-031-published-slide-player,r11-040-v9-health-preflight,r11-050-v9-fixture-foundation | published-producer | [spec](r11-041-pptx-v2-only.md) |
| r11-042-pdf-v2-only | PDF 只消费 Published V2 print/capture | r11-031-published-slide-player,r11-040-v9-health-preflight,r11-050-v9-fixture-foundation | published-producer | [spec](r11-042-pdf-v2-only.md) |
| r11-043-html-web-v2-only | HTML/Web Package 只携带 Published V2 | r11-031-published-slide-player,r11-040-v9-health-preflight,r11-050-v9-fixture-foundation | published-producer | [spec](r11-043-html-web-v2-only.md) |
| r11-050-v9-fixture-foundation | 建立 V9/Published 测试基础 | r11-011-v9-native-schema-independence,r11-012-published-v2-schema-independence | generated-index | [spec](r11-050-v9-fixture-foundation.md) |
| r11-051-v9-archive-only | 保存、打开与校验只支持 V9 archive | r11-050-v9-fixture-foundation | app-save-recovery | [spec](r11-051-v9-archive-only.md) |
| r11-052-supported-test-migration | 测试只证明受支持 V9/V2 行为 | r11-037-editor-store-owner-modularization | generated-index | [spec](r11-052-supported-test-migration.md) |
| r11-055-architecture-modularity-gate | 证明 Owner 模块化与依赖方向收口 | r11-037-editor-store-owner-modularization,r11-052-supported-test-migration | generated-index | [spec](r11-055-architecture-modularity-gate.md) |
| r11-053-legacy-inventory-reconciliation | 在集成 HEAD 原子复核 Legacy 台账 | r11-055-architecture-modularity-gate | contracts-schema,legacy-inventory | [spec](r11-053-legacy-inventory-reconciliation.md) |
| r11-054-delete-legacy-modules | 按复核清单删除零 consumer 旧模块 | r11-053-legacy-inventory-reconciliation | app-save-recovery,contracts-schema,legacy-inventory,editor-store-history,published-producer,generated-index | [spec](r11-054-delete-legacy-modules.md) |
| r11-060-zero-gate | 证明可执行作用域零遗留 | r11-054-delete-legacy-modules | generated-index | [spec](r11-060-zero-gate.md) |
| r11-061-no-regression-candidate | 固定 1.1 无回归候选 | r11-060-zero-gate | generated-index | [spec](r11-061-no-regression-candidate.md) |
| r11-062-owner-release | Owner 验收并发布 1.1 | r11-061-no-regression-candidate | none | [spec](r11-062-owner-release.md) |

合同拆分后，Editor、Archive/Test 与 Published lane 可按无冲突写锁并行；Player、作者预览、Export 与 package producer 因共享 `published-producer` 必须在该 lane 内串行领取。Editor 先完成 Properties/Flow/Spatial/Slide 四个 UI owner 纵切，再由 r11-025 清除 Surface 旧镜像；App 生命周期、Delivery、导入/输入三支随后可按锁推进，r11-037 才最终拆 Store composition root 并删除最后旧工程真相。任何一步都不保留双写。所有 lane 只交接预期减少的 LEG endpoint，不并行写共享 inventory。r11-055 在集成树证明真拆分后，r11-053 才原子复核 inventory；r11-054 只按精确零 consumer 清单删除。发布顺序不等于人为串行实现。

## 2026-09-03 接手审计裁决

本节记录当前路线的 failure return，不是任务板状态，也不改变上表的稳定 DAG。上一份 handoff 中“r11-000–055 已完成、直接继续 053 → 054”的判断已经失效；现有实现有大量可复用成果，但下列节点必须按原规格重新满足退出条件：

| 返回规格 | 审计事实 | 当前裁决 |
|---|---|---|
| [000 authority](r11-000-authority-contracts.md) | `check:development-roadmap` 在审计时因 25 个失效路径失败，且现有 checker 混淆可执行证据与历史/删除目标 | 重新验收路线裁判；先分类引用，再修 checker 或规格，不靠删引用求绿 |
| [001 preservation](r11-001-preservation-baseline.md) | `check:preservation` 为 `malformed-map`；PM-15、PM-21 仍指向已删除测试 | 在 002 前修复当前 map/matrix 与完整路线门；052 后续改变 evidence 时由 052 同任务同步更新 |
| [002 legacy gate](r11-002-legacy-inventory-zero-check.md) | v3 已固定 token、target-definition、source→file-target reference、candidate identity 与 schema 2 report；当前 379 relations 无 new/unmatched | 本轮已闭合；后续 lane 只允许实际 relation 单调减少，不并行改 inventory |
| [010 domain contracts](r11-010-domain-contract-extraction.md) | V9 schema 仍复制 Asset/Component/Design/Media/Playback schema，Media/Component owner 对象 strictness 未闭合 | 返回本节点，先冻结当前 accepted-value/default set，再由正式 Owner strict schema 接管 |
| [012 Published schema](r11-012-published-v2-schema-independence.md) | Published parser 仍反建 `CourseProjectDocument` 并调用 authoring schema | 返回本节点，改为直接验证 Published V2 与中性不变量，禁止 Published→authoring hydration |
| [013 shared Native](r11-013-shared-native-consumers.md) | `assetReferences` / `presentation` 的 live V9 consumer 与 `SceneStateStrip` 仍依赖 Legacy Project/Scene | 返回本节点迁移 live V9 consumer；Legacy helper 保持 Legacy-only，交 052/054 删除 |
| [027 Flow modules](r11-027-flow-authoring-modules.md) | Flow leaf/context 仍接收完整 document，父层可提交旧 revision 预计算 result 覆盖当前工程 | 返回本节点建立 current-session typed command port；stale callback 必须零写入 |
| [028 Spatial modules](r11-028-spatial-authoring-modules.md) | Spatial leaf 仍接收 whole-session host，Workspace 组合 world/session persist | 返回本节点改为 typed atomic command port；whole-session get/set 为零 |
| [026 properties](r11-026-slide-properties-modules.md) | 新属性叶子模块可保留，但 `PropertiesTab.tsx` 仍持有属性业务、raw Store mutation 与多 Surface command 接线 | 返回本节点收口 root/context，不重写已成立叶子或属性语义 |
| [030/031 Published Slide](r11-031-published-slide-player.md) | 正式 Published Native/CoursePlayer 路径已成立；旧 `PlayerScene`/renderer 是死 Legacy 路径 | 修正规格并复核现实现；禁止现代化死路径，旧模块/测试交 052/054 |
| [033 authoring preview](r11-033-runtime-authoring-preview-v2.md) | 唯一产品 caller 已移至 `SlideLocationWorkspace`，原规格仍指向 `Workspace.tsx` | 修正 exact target 后复核；Workspace 保持不得重新取得 preview lifecycle |
| [029 workspace](r11-029-slide-workspace-modules.md) | 新 Workspace 叶子可保留，但 `Workspace.tsx` 仍构造命令 facade 并内联三个 Surface connector | 返回本节点，使 root 只做 exactly-one 路由 |
| [040 diagnostics/preflight](r11-040-v9-health-preflight.md) | live saved report 仍名为 `ExportPreflightReport` 且声明 `schemaVersion: 8 | 9` | 返回本节点迁为 V9-only report 合同并保持 code/severity/target/message 与排序 |
| [041 PPTX](r11-041-pptx-v2-only.md) | 产品 PPTX shared/text helper 仍依赖 `SceneNode/projectTypes` | 返回本节点使用窄 render frame 与 native-v1；旧 builder 交 052/054 |
| [037 Store owners](r11-037-editor-store-owner-modularization.md) | 产品回归已绿，但 `editorStore.ts`、宽 Feature ports 与 `crossSurfaceCommands` 仍承载业务、镜像或万能服务责任 | 返回本节点完成真实 Owner 迁移，不整体回滚 slices/owners |
| [052 tests](r11-052-supported-test-migration.md) | 已迁测试很多，但仍有成功路径构造 V8 工程/旧 payload，删除测试与 PM/路线证据未闭合 | 重新完成逐 case 分类与 replacement；同一任务同步 map/matrix，不能把失效证据留给 001 |
| [055 architecture gate](r11-055-architecture-modularity-gate.md) | 当前结构测试可在 root 明显违反合同时通过 | 撤销既有 pass；以 import/AST/精确 symbol 和违规 fixture 重建原子门 |
| [053 reconciliation](r11-053-legacy-inventory-reconciliation.md) | 旧 inventory digest 已过期，且上游裁判与 owner 验收无效 | 当前不具备启动条件；旧 reconciliation 与 deletion list 作废 |
| [054 deletion](r11-054-delete-legacy-modules.md) | 依赖尚未重新成立 | 未解锁；不得删除旧模块 |
| [060 zero gate](r11-060-zero-gate.md) | 依赖尚未重新成立 | 未解锁；不得写 zero evidence |
| [061 candidate](r11-061-no-regression-candidate.md) | 依赖尚未重新成立 | 未解锁；不得写 candidate evidence 或宣称 1.1 candidate |
| [062 Owner release](r11-062-owner-release.md) | 只接受同一固定 engineering candidate 的 Owner 实测签署 | Owner only，不自动执行 |

当前恢复顺序是：`r11-029 返工卡 → r11-032 → r11-034 → r11-035 → r11-036 → r11-037（W1–W9）→ r11-052（A–E）→ r11-055 → r11-053 → r11-054 → post-delete r11-055 → r11-060 → r11-061 → Owner r11-062`。r11-000/001/002 与 010–043 中已闭合的节点不重开；scanner 对旧渲染器簇的命中交 r11-053 登记，对负向正则 token 的命中交 r11-002 表示法修正，不塞进匿名阶段。r11-054 的 post-delete gate 语义必须原样；若需改变 assertion/helper/fixture、ledger 边、baseline 或产品/测试，须返回 055，并从 053 重新固定 identity。r11-062 仍只由 Owner 验收。共享写锁节点继续串行，055/053/060/061 保持原子门。

**不要新增 `r11-*` ID。** 返工返回上表已有 failure owner，在同一规格内按 owner/case 分波；不创建匿名“053 前清债”阶段，也不把旧 handoff 的候选删除路径当作 054 授权。跨会话真正开始执行时按工作协议实例化当下首个节点并生成任务板；本路线文件不记录 queued/active/blocked。

跨会话接手先读已审计改写的 [INTEGRATOR_HANDOFF.md](INTEGRATOR_HANDOFF.md)。

## 2026-09-03 执行版重基

Codex 检查点（HEAD `bb1f848`）之后，剩余节点按 [执行者指南](EXECUTION_GUIDE.md) 的规则改写为可直接执行的“2026-09-03 执行版”：每张卡钉死 file:line 的符号表、允许新建清单、结构事实命令与红→绿证据要求，执行者不做架构判断；上表 037/052 行的“当前裁决”由对应规格的执行版替代。裁决：`r11-025` 以证据闭合，其 history 镜像残留归 `r11-037` W1；检查点上 `check:preservation`（PM-08 夹具）与 `check:legacy-inventory`（7 项未登记观察）为红，由 `r11-029` 返工卡先修；`r11-032` 只剩 `playerCapture.ts` 的 PlayerApp 引用，Flow-only 项待 Integrator 给出失败测试否则作废；`r11-034`、`r11-035`、`r11-036` 各为一处已钉死的缺陷修复；`r11-037` 拆为 W1–W9；`r11-052` 重算为 A–E。`r11-055`、`r11-053`、`r11-060`、`r11-061` 的判读与结构门编写只由 Integrator 执行，不派通用执行者；`r11-054` 在 053 给出精确清单后可派。首批执行卡位于 `docs/development-plan/tasks/1.1/`。

检查点上 `test:product` 的 7 文件 / 10 项失败已于 2026-09-03 定责并修复（① 校验器整体状态不再计入不适用格式的错误，纯 Flow 课程的 PPTX 预检项本身保留 error；②③⑤ 为测试侧缺陷；④ ratchet 白名单为预期红，待 037/055 收口），逐组结论与证据见 [INTEGRATOR_HANDOFF.md](INTEGRATOR_HANDOFF.md) §0；修后仅剩 ④ 一项预期红。

## 交接格式

执行者只报告：可观察结果；实际修改文件；focused checks；不可降级矩阵证据；剩余限制；回滚点；新解锁但未执行的 ID。没有实质 diff 时说明节点已满足或已漂移，由 Integrator 决定废止或重裁，不制造空提交。
