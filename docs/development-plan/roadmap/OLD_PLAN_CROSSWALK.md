# 原方案 98 项任务交叉映射

本表是原 ZIP 退出仓库前的逐项迁移账。它只回答旧任务的处置，不恢复任务状态，也不表示任何新节点 Ready 或已完成；执行权威是[路线说明](README.md)与[机器清单](manifest.json)。

归类含义：

- `replaced`：旧结果由一个新节点直接替代。
- `merged`：旧范围被重裁后并入一个或多个新节点，或拆入真实依赖门。
- `retired`：旧任务已由当前事实完成、与已确认架构冲突，或不再需要独立执行；理由必须可审计。
- `optional`：旧范围移出核心发布闭包，只能由可选节点实现或有证据地放弃。

## 1.1

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r11-000-governance-route` | replaced | `r11-000-authority-contracts` | Owner 已在包外确认路线；新节点只把已确认决定写入正式权威，不允许任务自授权。 |
| `r11-001-fix-published-zindex-assertion` | retired | — | 当前候选已经修复并有测试证据；不重复立项，结果由不降级基线持续保护。 |
| `r11-002-refresh-current-generated-fixtures` | retired | — | 当前 V9 fixture、render-host 和能力索引已刷新；后续只在相关输入变化时按生成检查更新。 |
| `r11-003-fixed-baseline-gate` | merged | `r11-001-preservation-baseline`<br>`r11-061-no-regression-candidate` | 基线改为启动时核对当前 HEAD/工作树；行为基线与固定候选发布门分开。 |
| `r11-010-legacy-boundary-ratchet` | merged | `r11-002-legacy-inventory-zero-check`<br>`r11-060-zero-gate` | 不建立第二 allowlist；唯一 Legacy 台账负责只减不增，最终门再证明零 consumer。 |
| `r11-011-remove-renderer-v8-load-entry` | merged | `r11-051-v9-archive-only`<br>`r11-054-delete-legacy-modules` | V8 打开入口与 archive consumer 同批迁移，确认替代和零引用后才删模块。 |
| `r11-012-isolate-v8-migrator` | merged | `r11-051-v9-archive-only`<br>`r11-054-delete-legacy-modules` | 1.1 目标是可执行代码与测试工具链清零，不再为不受支持格式保留永久隔离层。 |
| `r11-020-slide-v9-hit-selection-read-model` | replaced | `r11-020-slide-effective-read-model` | 保留 Slide 命中、选区和缩略图结果，改由只读 V9 effective view 提供。 |
| `r11-021-slide-native-properties-v9` | replaced | `r11-021-slide-properties-editors` | 属性、动画、互动与开发面板统一迁到 V9 read/write 语义。 |
| `r11-022-slide-clipboard-delete-reorder-v9` | replaced | `r11-022-slide-actions` | copy/paste/duplicate/delete/reorder 作为一条 V9 command/history 结果交付。 |
| `r11-023-flow-viewstate-without-v8-project` | replaced | `r11-023-flow-viewstate` | Flow 单独迁移到只读 V9 session，保留其语义正文与导航边界。 |
| `r11-024-spatial-viewstate-without-v8-project` | replaced | `r11-024-spatial-viewstate` | Spatial 单独迁移，camera/path/relation 与 session-only camera 语义不被 Flow 泛化。 |
| `r11-025-remove-editorstate-v8-document` | replaced | `r11-025-editor-store-v9-only` | 删除 Store 中 project、clipboard/history 镜像的最终汇合点保持不变。 |
| `r11-026-retire-slide-editor-projection` | merged | `r11-025-editor-store-v9-only`<br>`r11-054-delete-legacy-modules` | 先迁完 UI/Store consumer，再按已复核清单删除零引用投影模块，不保留模糊 adapter。 |
| `r11-030-focused-validation-map` | retired | — | 精确验证、写锁、停止条件已内嵌每份 1.1 弱模型规格，不再建立独立验证真相。 |
| `r11-040-stability-release-gate` | merged | `r11-060-zero-gate`<br>`r11-061-no-regression-candidate`<br>`r11-062-owner-release` | 零旧代码、自动候选和 Owner accepted 被拆成三道不可互相冒充的门。 |

## 1.2

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r12-000-v9-native-variant-exception` | merged | `r12-000-native-contract` | 已确认 Table/Chart 为 V9 Native；合同节点同时固定 strict Schema、旧工程读取和旧 reader fail-loud。 |
| `r12-001-published-table-chart-adr` | merged | `r12-000-native-contract` | 已确认 Published V2 窄扩展，不再保留 V2/V3 的执行者架构选择。 |
| `r12-010-table-contract-and-factory` | replaced | `r12-010-table-core` | Table strict contract、稳定 ID、factory 与共享绘制进入一个核心节点。 |
| `r12-011-table-shared-render-and-published` | merged | `r12-010-table-core`<br>`r12-011-table-authoring-delivery` | 共享 renderer 属于 core，Published/Player/导出闭环与 authoring 一起验收。 |
| `r12-012-table-authoring-commands-history` | replaced | `r12-011-table-authoring-delivery` | 命令、一次操作一历史、保存重开和 UI 由同一用户纵切证明。 |
| `r12-013-table-authoring-ui` | merged | `r12-011-table-authoring-delivery` | UI 不再脱离 command/history/Player 单独宣称完成。 |
| `r12-014-table-export-diagnostics-capability` | merged | `r12-011-table-authoring-delivery`<br>`r12-050-native-closure` | 适用导出随纵切实现，全矩阵空白与 Capability 一致性在 closure 汇总。 |
| `r12-020-chart-contract-and-factory` | replaced | `r12-020-chart-core` | Chart 类型、稳定 category/series ID、factory 与 SVG 核心直接替代。 |
| `r12-021-chart-shared-render-and-published` | merged | `r12-020-chart-core`<br>`r12-021-chart-authoring-delivery` | renderer 核心与 authoring/Published 证据分层但成对交付。 |
| `r12-022-chart-authoring-commands-and-ui` | replaced | `r12-021-chart-authoring-delivery` | 数据编辑、类型切换、历史、保存和交付闭成一个用户结果。 |
| `r12-023-chart-export-diagnostics-capability` | merged | `r12-021-chart-authoring-delivery`<br>`r12-050-native-closure` | 导出与诊断跟随真实 consumer，Capability/矩阵完整性由 closure 收口。 |
| `r12-030-line-direct-draw-endpoints` | replaced | `r12-030-line-authoring` | 直接绘制、端点与箭头不依赖 Table/Chart，作为独立可交付轨。 |
| `r12-031-line-hit-snap-elbow` | merged | `r12-030-line-authoring` | 细线命中、吸附和折点属于同一 Line authoring 完成定义。 |
| `r12-040-background-asset-scope-authoring` | replaced | `r12-040-background-authoring` | Scene、命名状态、Slide Surface 及既有 Flow/Spatial 背景范围直接承接。 |
| `r12-050-native-closure-release-gate` | merged | `r12-050-native-closure`<br>`r12-060-release` | 能力矩阵闭合与源码标签发布分开，自动门不能冒充发布 accepted。 |

## 1.3

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r13-000-recipe-contract-and-catalog` | replaced | `r13-000-recipe-contract` | Recipe 版本、catalog 和展开为普通 V9 的单一合同保持。 |
| `r13-010-page-recipe-cover` | replaced | `r13-010-cover-recipe` | 封面页 Recipe 直接迁移，不增加持久化 DSL。 |
| `r13-011-page-recipe-concept` | replaced | `r13-011-concept-recipe` | 概念页 Recipe 直接迁移并保留可编辑内容槽。 |
| `r13-012-page-recipe-worked-example` | replaced | `r13-012-worked-example-recipe` | 例题页 Recipe 直接迁移并保留知识获得路径。 |
| `r13-020-interaction-recipe-step-reveal` | replaced | `r13-020-step-reveal-recipe` | step reveal 继续展开为命名状态/普通互动。 |
| `r13-021-interaction-recipe-choice-feedback` | replaced | `r13-021-choice-feedback-recipe` | choice feedback 继续使用成熟声明式能力或既有组件。 |
| `r13-022-interaction-recipe-classify-sort` | replaced | `r13-022-classify-sort-recipe` | classify/sort 保留移动端、Player 和可编辑闭环。 |
| `r13-030-reference-page-clone` | replaced | `r13-030-reference-clone` | 只复制可编辑骨架和槽位，不复制隐藏运行态真相。 |
| `r13-040-batch-find-replace` | replaced | `r13-040-batch-replace` | 查找、预览、一次事务替换和 carrier 覆盖直接承接。 |
| `r13-041-batch-design-token-application` | replaced | `r13-041-token-apply` | Design Token 对选中/当前页/全课的应用保持单一事务语义。 |
| `r13-050-fast-v9-diagnostics` | replaced | `r13-050-fast-diagnostics` | 局部 Schema、布局、引用和导出风险继续使用稳定 target。 |
| `r13-060-design-production-release-gate` | replaced | `r13-060-release` | 真实课例 closure 与源码标签在新版发布节点统一收口。 |

## 1.4

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r14-000-authoring-tool-wire-contract` | merged | `r14-000-target-wire`<br>`r14-001-tool-receipt` | canonical target 无损 wire 与 receipt/revision/stale/transaction 分成两个明确合同。 |
| `r14-010-read-and-inspect-tools` | merged | `r14-020-slide-tools`<br>`r14-021-flow-tools`<br>`r14-022-spatial-tools`<br>`r14-023-course-global-tools` | 读取能力按真实 Surface/owner 分配，不再用 generic page 模糊覆盖。 |
| `r14-011-page-and-deck-write-tools` | merged | `r14-020-slide-tools`<br>`r14-021-flow-tools`<br>`r14-022-spatial-tools` | page/deck 操作拆成 Slide、Flow 正文和 Spatial 语义工具。 |
| `r14-012-native-atomic-write-tools` | merged | `r14-020-slide-tools`<br>`r14-021-flow-tools`<br>`r14-022-spatial-tools` | Native 写入跟随 canonical owner，不建立跨 Surface 的错误通用层。 |
| `r14-013-component-runtime-code-tools` | merged | `r14-010-component-registry-identity`<br>`r14-011-dynamic-asset-closure`<br>`r14-012-lifecycle-visible-failure`<br>`r14-030-dynamic-code-tools` | 三项动态 Carrier 门成为代码工具硬前置，关闭旧缓存、漏素材和假成功。 |
| `r14-014-course-logic-global-background-tools` | replaced | `r14-023-course-global-tools` | global/background/network/course logic 按正式 owner 集中交付。 |
| `r14-015-tool-receipts-stale-and-undo` | replaced | `r14-001-tool-receipt` | receipt、revision、stale、history 与 resource transaction 进入版本化合同。 |
| `r14-020-courseware-case-builder-api-v2` | replaced | `r14-040-builder-v2` | Builder v2 只消费产品工具/Facade，不扩散内部 module bag。 |
| `r14-021-refactor-external-builder-skill` | merged | `r14-040-builder-v2`<br>`r14-050-weak-model-vertical` | Skill 改造由一个真实课例和较弱模型纵切驱动。 |
| `r14-022-weak-model-external-builder-benchmark` | replaced | `r14-050-weak-model-vertical` | 固定模型、课例、成功阈值和局部修订形成可比较 benchmark。 |
| `r14-030-authoring-tools-release-gate` | replaced | `r14-060-release` | 三 Surface 工具、Builder v1 兼容和动态门证据在发布节点汇总。 |

## 1.5

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r15-000-material-source-contract` | replaced | `r15-000-material-contract` | 本地材料、来源事实/推断/创作区分和生命周期合同直接承接。 |
| `r15-010-material-ingest-read-search` | replaced | `r15-010-material-repository` | ingest/read/search/delete 进入应用本地 repository，不进入 CourseProject。 |
| `r15-020-material-context-authoring-tools` | replaced | `r15-020-material-tools-citations` | 检索与可携带可见 citation 成对交付，避免来源只留在 trace。 |
| `r15-030-pptx-import-minimum` | replaced | `r15-030-pptx-import` | 受限解析、大小/解压比、document+sidecar 原子事务和 unsupported 报告成为完成条件。 |
| `r15-040-style-remix-from-reference` | replaced | `r15-040-style-remix` | 复制可编辑骨架再替换槽位，不建立不可编辑风格快照。 |
| `r15-050-openmaic-bridge-and-license` | optional | `r15-900-openmaic-review`<br>`r15-901-openmaic-bridge` | OpenMAIC 先做固定上游、许可证/SBOM 与真实需求审查；可 waiver，绝不阻塞核心发布。 |
| `r15-060-content-correctness-checks` | replaced | `r15-050-content-qa` | 数学、答案、图表正文和来源定位进入分学科内容 QA。 |
| `r15-070-materials-quality-release-gate` | merged | `r15-060-release` | 核心发布只依赖材料、PPTX、remix、内容 QA；OpenMAIC 从门中移除。 |

## 1.6

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r16-000-provider-security-adr` | retired | — | 已确认首发采用用户自行安装/认证的本地 CLI，不建立编辑器直连 Provider/BYOK 架构。 |
| `r16-010-provider-core-and-ipc` | retired | — | Provider adapter 被 LocalAgentCliAdapterV1 与明确进程启动器替代；产品不实现模型 API 内核。 |
| `r16-011-provider-secret-storage` | retired | — | Codex、Claude、OpenCode 自行登录和保存凭据，应用不得读取或保存 API Key。 |
| `r16-020-provider-cancel-timeout-retry` | merged | `r16-030-cli-lifecycle` | cancel、异常退出、超时/恢复改为 CLI session 生命周期，不擅自重试模型请求。 |
| `r16-030-ai-log-redaction` | merged | `r16-020-local-session-store`<br>`r16-030-cli-lifecycle` | 本地会话/事件分类与诊断脱敏按应用记录和 CLI 边界分别定义。 |
| `r16-040-internal-provider-gate` | merged | `r16-031-hidden-manual-isolation`<br>`r16-040-release` | AI 默认隐藏且三套 CLI 不可用时人工编辑无回归，作为 1.6 发布硬门。 |

## 1.7

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r17-000-generation-request-contract` | replaced | `r17-000-generation-contract` | 生成意图、carrier 阶梯、零写入失败和 authoritative 写边界统一成版本化合同。 |
| `r17-010-single-page-generation` | replaced | `r17-020-single-page` | 单页生成从暂存、准入到工具事务形成可撤销纵切。 |
| `r17-020-course-plan-generation` | merged | `r17-000-generation-contract`<br>`r17-021-whole-course` | 结构计划是整课生成输入，不新增第二持久化计划真相。 |
| `r17-021-course-build-orchestrator` | replaced | `r17-021-whole-course` | 逐页生成、失败隔离、恢复和零错写直接承接。 |
| `r17-030-generated-component-runtime-path` | merged | `r17-010-staging-workspace`<br>`r17-011-static-admission`<br>`r17-012-host-smoke-admission`<br>`r17-023-generated-carriers` | 生成代码先入暂存，静态与真实宿主门通过后才成为可信扩展。 |
| `r17-040-risk-preview-single-repair` | replaced | `r17-030-single-repair` | 风险页只允许一次定位修复，失败后工程仍零写入。 |
| `r17-050-weak-model-generation-benchmark` | replaced | `r17-040-generation-benchmark` | 固定课例与模型分别测 Native/Recipe 和动态 carrier 上限。 |
| `r17-060-internal-generation-gate` | replaced | `r17-060-release` | 单页、整课、局部修改、generated carrier 与失败 fixture 汇总为隐藏发布门。 |

## 1.8

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r18-000-agent-tool-registry` | merged | `r18-000-mcp-authoring-server`<br>`r18-011-write-tool-mapping` | 工具版本/Schema/权限由产品 MCP 暴露，写调用映射到既有产品命令。 |
| `r18-010-agent-runner-and-session` | retired | — | CLI 本身是 Agent 内核；编辑器不复制规划、子任务或模型工具循环。 |
| `r18-020-product-skill-manifest-loader` | merged | `r18-020-neutral-agent-profile`<br>`r18-030-course-skills`<br>`r18-031-editing-craft-skills` | 一个中立 Profile 生成三种 CLI 配置，Skills 保留各 CLI 原生宿主方式。 |
| `r18-021-course-design-build-skills` | replaced | `r18-030-course-skills` | course-design/course-build 继续复用确认后的策划与产品 authoring tools。 |
| `r18-022-editing-visual-interaction-qa-skills` | replaced | `r18-031-editing-craft-skills` | editing/visual/interaction/qa/remix 能力按载体阶梯和确定性诊断交付。 |
| `r18-030-agent-human-concurrency` | replaced | `r18-041-human-concurrency` | revision/session generation 变化使旧调用 stale 且零写入。 |
| `r18-040-agent-skill-weak-model-benchmark` | replaced | `r18-050-three-cli-benchmark` | Codex、Claude、OpenCode 各自用同一固定生成/编辑课例比较。 |
| `r18-050-internal-agent-skills-gate` | replaced | `r18-060-release` | MCP、Profiles、Skills、暂存文件边界与三 CLI 证据在隐藏发布门收口。 |

## 1.9

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r19-000-internal-chat-shell` | replaced | `r19-000-chat-shell` | Chat shell、run 状态与 Stop 直接迁移，仍不改变人工画布主路径。 |
| `r19-010-chat-context-references` | replaced | `r19-010-context-references` | 当前选择、当前页、整课和材料按需读取，不灌入整工程。 |
| `r19-020-chat-tool-timeline` | replaced | `r19-020-tool-timeline` | 工具读写目标、receipt、结果和可撤销性保持可见。 |
| `r19-021-chat-markdown-formula-rendering` | replaced | `r19-021-safe-markdown-formula` | Markdown/公式安全渲染且不执行消息 HTML/脚本。 |
| `r19-030-chat-confirmation-and-undo-ux` | replaced | `r19-030-stop-undo-stale` | Stop、Undo、确认、迟到结果和 stale 零写入统一成可见交互。 |
| `r19-040-internal-dogfood-privacy` | merged | `r19-040-session-persistence-deletion`<br>`r19-050-internal-dogfood` | 会话恢复/删除语义先独立闭合，再用真实课例 dogfood。 |
| `r19-050-internal-workbench-gate` | replaced | `r19-060-release` | 生成、编辑、审计、取消、撤销、隐私证据汇总为隐藏源码标签门。 |

## 2.0

| 旧任务 ID | 归类 | 新路线节点 | 理由 |
|---|---|---|---|
| `r20-000-public-ai-governance` | replaced | `r20-000-public-governance` | 公开范围改为三套本地 CLI、MCP 与内置 Profile，不扩展 V10 或任意 Skill 市场。 |
| `r20-010-provider-settings-ui` | merged | `r20-010-cli-setup-ui`<br>`r20-011-first-use-risk-notice` | 不保存 Provider Secret；UI 只做 CLI 探测/路径/安装登录指导和首次外发风险说明。 |
| `r20-020-public-generate-and-edit-flows` | replaced | `r20-020-public-authoring` | 教师公开生成/局部修改保留 Stop、Undo、stale 零写入和手工独立性。 |
| `r20-030-public-built-in-skill-controls` | replaced | `r20-021-profile-controls` | 用户选择内置中立 Profile/Skills，不安装任意代码。 |
| `r20-040-public-materials-and-privacy-controls` | replaced | `r20-022-materials-privacy-controls` | 显示发送范围并删除应用自有会话/材料记录，不虚假承诺删除 CLI 历史。 |
| `r20-050-release-docs-accessibility-compatibility` | replaced | `r20-030-docs-accessibility` | 文档、键盘、失败恢复、V9/AI/数据边界和无 CLI 手工路径一起验收。 |
| `r20-060-teacher-acceptance-and-release` | merged | `r20-040-three-cli-acceptance`<br>`r20-050-owner-acceptance`<br>`r20-060-release` | 三 CLI 固定课例、Owner accepted、源码标签与离线 HTML 发布分账；不调用安装包门。 |

## 覆盖声明

本表应由路线检查器证明恰好覆盖原方案 98 个唯一 task ID。任何新增、删除、重复或改名都必须先更新本表和机器校验；原 ZIP 删除后，本表保留历史去向，但不成为第二套 backlog。
