# v1.2–v2.0 正式开发路线

本目录以 [当前开发总纲](../../../COURSEWARE_DEVELOPMENT_PLAN.md)、[架构合同](../ARCHITECTURE_CONTRACT.md) 和 [工作协议](../WORKING_PROTOCOL.md) 为正式权威链，把 1.2–2.0 转成可执行任务 DAG。本文只定义路线和发布门，不保存 `queued`、`active`、`blocked` 等协调状态；当前协调状态仍只看 [任务板](../TASK_BOARD.md)。已完成的 1.1 / 1.1.1 执行路线由 Git 历史保存，当前保全事实由 `v1.1.1` 标签、保全基线和不可降级矩阵承载。

## 不可退化边界

所有版本都必须保留已经支持的人工能力：V9 工程、演示页 / 流式讲义 / 无限画布三 Surface、保存 / 恢复 / Save As、撤销 / 重做、预览 / Player、Runtime / Component、Builder、诊断，以及当前所有导出。新增的 AI、导入、生成或批量能力失败时，人工编辑仍能继续，且不得把半成品写进权威工程。

Course Project V9、Published Course V2、Runtime API 2/3、Component API 4 继续有效。V9 既有字段、判别器和语义软冻结；任何 additive 字段必须先形成独立合同并保持严格解析。不存在 V10 迁移，也不恢复 V8 导入。

## 启动与完成规则

任务节点只有同时满足下列条件才可按工作协议实例化：

1. 在当前工作树 HEAD 上复现该节点要补齐的行为，确认不是已经完成或已被替代的能力。
2. 表格列出的全部依赖已经通过其 Acceptance，并留有实质 diff / commit 与有效证据；可选节点永远不能成为核心节点的隐含依赖。
3. 按工作协议取得表格列出的写锁；存在重叠锁时不得并行写同一所有权面。
4. 涉及 Schema、Published、Surface、Runtime / Component、网络、导出、稳定身份或 AI 会话时，先落定对应合同。
5. 只有工作协议规定的多执行者、重叠写入、跨会话、交接或真实阻断场景才建任务卡；建卡时写明一个可观察结果、精确文件范围和最多三个最能证伪结果的目标测试。单执行者单会话节点直接执行，版本路线本身不预建状态。

节点完成必须同时满足：实现与合同一致、目标测试通过、受影响的保存 / 重开 / Player / 导出路径通过、诊断无新增错误、没有降低人工能力，并留下可由下一依赖节点复用的证据。自动化最多给出 `engineering candidate`；固定课例的真实视觉、互动和教师复核才能给出 `art candidate` / `accepted`。候选标签统一为 `vX.Y.Z-rc.N`，不携带 accepted 语义；无后缀 `vX.Y.Z` 只在对应 Owner 签署点创建。

## 实现 DAG

```mermaid
flowchart LR
    B["v1.1.1 已签署维护基线"]
    R12["1.2 Native 编辑、真实同步与基础取色"]
    R13["1.3 高频工作流、跨 Surface 图表与项目色板"]
    R14["1.4 Authoring Tool / Builder V2"]
    R15["1.5 素材、导入、QA"]
    R16["1.6 本地 CLI 会话内核（隐藏）"]
    R17["1.7 生成与本地编辑（隐藏）"]
    R18["1.8 MCP 与 Skills（隐藏）"]
    R19["1.9 内部 AI 工作台（隐藏）"]
    R20["2.0 内部生产 AI 作者工作流"]
    O["OpenMAIC 可选旁支"]

    B --> R12
    B --> R13
    B --> R16
    R12 -->|图表与色板节点前置| R13
    R12 --> R14
    R13 --> R14
    R14 --> R15
    R13 --> R17
    R14 --> R17
    R15 --> R17
    R16 --> R17
    R17 --> R18 --> R19 --> R20
    R14 -. optional .-> O
```

实现可在依赖和写锁允许时并行；版本标签仍按 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8 → 1.9 → 2.0 串行。1.6 的实现可从 `v1.1.1` 基线开始，但它的候选节点等待 1.5 发布完成。Owner accepted 只在 S1（1.3）、S2（1.5）、S3（1.8）、S4（2.0）四处签署。

## 版本规格与制品

| 版本 | 规格 | 用户结果 | AI 可见性 | 标签 / 制品 | Owner 签署 |
| --- | --- | --- | --- | --- | --- |
| 1.2 | [执行包](1.2/README.md) | Flow 图文/图形浮层与连续 DOCX、Slide input、Table/Chart 真实作者同步、Line、Background、常用色/连续调色与统一图表入口 | 无 AI | `v1.2.0-rc.N` 源码 | S1 在 1.3 统一签署 |
| 1.3 | [README](1.3/README.md) | 高频页面/互动配方、分类、Component 排序、克隆、批量替换、项目色板/Token、Flow/Spatial Chart 与快速诊断 | 无 AI | `v1.3.0` 源码 | S1 创作力 |
| 1.4 | [README](1.4/README.md) | 三 Surface 与动态载体统一进入可验证 Authoring Tool / Builder V2 | 无 AI | `v1.4.0-rc.N` 源码 | S2 在 1.5 统一签署 |
| 1.5 | [README](1.5/README.md) | 共享 WorkspaceIdentity、素材、PPTX 导入、风格 Remix 与内容 QA | 无 AI | `v1.5.0` 源码 | S2 工具与素材 |
| 1.6 | [README](1.6/README.md) | Codex / Claude / OpenCode 本地 CLI 会话内核 | 默认隐藏 | `v1.6.0-rc.N` 源码 | S3 在 1.8 统一签署 |
| 1.7 | [README](1.7/README.md) | 单页、整课、局部编辑与动态载体的自动生成 / 修复 | 默认隐藏 | `v1.7.0-rc.N` 源码 | S3 在 1.8 统一签署 |
| 1.8 | [README](1.8/README.md) | 产品 MCP Authoring Server、CLI profiles 与课件 Skills | 默认隐藏 | `v1.8.0` 源码 | S3 AI 内核 |
| 1.9 | [README](1.9/README.md) | 内部聊天工作台、工具轨迹、Stop / Undo / stale 防护 | 默认隐藏 | `v1.9.0-rc.N` 源码 | S4 在 2.0 统一签署 |
| 2.0 | [README](2.0/README.md) | 三种 CLI 的内部生产 AI 作者工作流和数据边界 | 内部正式开放 | `v2.0.0` 源码 + 固定课例离线 HTML | S4 AI 产品 |

`v1.1.0` 标签保持不可变；`v1.1.1` 已经 Flow 文字格式维护闭环与 Owner 验收创建新源码标签，并重新固定同一课例的离线 HTML。1.2–1.9 不发布离线 HTML，2.0 恢复固定课例离线 HTML；本路线不发布安装器。无后缀版本号绝不同时表示“仅自动化通过”和“Owner 已验收”。

## 跨版本接口与数据合同

- **Native 内容**：Table、Chart 与 Slide-only input 是获批的 V9 Native strict 窄增量；Published Course V2 只做匹配读取与运行所需的窄增量。input 的提交值先原子写入已声明状态键再求规则条件，只映射 PPTX；Flow 作者浮层进入一份连续 DOCX。线条和背景沿用既有对象 / Surface 所有权，不另建旁路状态。
- **Chart 与取色版本边界**：1.2 闭合真实 Native 作者同步、图表选择入口和共享常用色/连续调色；1.3 先独立固定 Chart 的 Flow 正文与 Spatial world 合同，再迁移共享编辑器并交付两个 Surface，两个 delivery 都必须进入 S1 依赖闭包。项目色板复用 `designTokens.colors`，通过明确范围预览/应用配色；不提前创建持久化主题绑定。1.2 当前 Chart 容器限制在后续合同落地前保持。
- **1.2 复审修复门**：当前收尾按 [1.2 执行指南](1.2/EXECUTION_GUIDE.md) 闭合作者增量、正确 owner/state 写入、input 及表格/图表/颜色的已确认可见缺口；未通过的共享能力不能被 1.3 图表/色板 delivery 当作完成前置。1.3 无关节点仍可按自己的依赖推进，S1 不替代 1.2 基础修复及 engineering candidate 验证。
- **Recipe 互动**：分类使用声明式“选中项目→选中目标组”；排序的真实可见重排使用当前 Component 载体并公开可编辑参数，不扩拖放/放置触发器或顺序动作，也不要求先完成通用组件化。
- **Authoring target**：所有写操作解析为 canonical target，至少包含工程稳定身份、Surface、容器、对象 / 内容路径与版本前提；工具回执必须报告实际落点和新版本。
- **动态载体**：Component 注册身份固定为工程 / package / version / source / content；动态引用资产必须进入 Published 闭包；实例异常必须隔离并销毁旧实例，显示可见错误或 fallback。
- **CLI 内核**：`LocalAgentCliAdapterV1` 是 Agent core 边界。应用只负责进程 / 会话 harness、staging、自动准入、产品命令适配和 1.8 起的 MCP 工具，不重写模型规划循环。
- **工程写入**：1.7 的 CLI 只接收不可变最小 snapshot 并输出 strict typed candidate/dynamic manifest；它没有 live project API，宿主重校验后通过 1.4 canonical commands 原子提交。1.8 起 CLI 发起的 live read/write 只能通过产品 MCP Authoring Tools。candidate 可默认经结构化 stdout / artifact channel 返回；只有 adapter 启用通用文件工具时才要求文件工具只写当前 session staging。Native/Recipe/Existing Component 不等待动态宿主准入，Generated Component/Runtime 才执行静态与宿主 gate；拒绝、Stop、stale 或适用的准入失败不得进入工程。
- **WorkspaceIdentity 与本地会话**：1.5 的共享基础节点唯一规定 `projectId + normalizedPath`；材料域和 AI 会话域分别依赖它，不相互承载私有语义。会话和工具轨迹按该身份隔离；Save As 创建新身份且不复制旧会话。它们可按会话 / 工程 / 全部删除，不进入 `.h5lesson`、Published payload、Component / Runtime 包或任何导出。
- **可信扩展边界**：自动 gate 通过后可获得当前已批准的可信 Runtime / Component 宿主能力；仍不得获得 Provider secret、原始 Electron Main、任意 OS 控制、未批准脚本或未批准宿主 API。

## 统一验证与发布门

任务表的 Acceptance 是逐项退出门，不能用未命名的替代性检查、通配符或只比较 Hash 替代行为证明。正式路线出现的每个 `tests/` 路径在路线落地时必须真实存在，路线检查器逐项验证；未来节点默认在版本文档指定的现有文件中增加命名用例。若确需新测试文件，先在该节点的实质 diff 中创建文件并同步更新路线，不能预先把未创建路径写成可执行入口。常规候选至少执行这些仓库现有命令：

```text
npm run check:contracts
npm run check:ai-capabilities
npm run typecheck
npm run test:product
npm run verify
git diff --check
```

是否需要执行到 `verify` 由工作协议的风险和发布阶段决定；单个节点先运行其版本文档列出的精确目标测试。当前 `verify:release` 强制检查 Portable/win-unpacked/app.asar，而本路线 1.1–2.0 均不交付安装器，因此不得把它用作版本通过门；源码候选使用 `verify`，其中已经包含 `check:examples`、固定 HTML 准备和真实浏览器互动，不得在输入未变时重复执行同一 example check。离线 HTML 版本还需由 Owner 真实打开冻结后的同一文件。每版发布节点还必须满足：

1. 所有非可选节点逐项通过 Acceptance；可选节点未完成时明确记录，但不得阻断发布。
2. 固定课例通过人工创建 / 编辑、保存、重开、运行 / Player、适用导出、诊断检查；涉及三 Surface 或动态载体的版本覆盖相应载体。
3. 自动化证据与版本发布制品匹配；不依赖历史提交哈希识别制品。
4. 候选节点在自动化与本版目标测试通过后创建 `vX.Y.Z-rc.N`，不签署 accepted；S1–S4 签署点由 Owner 观察合并范围内固定课例的真实视觉和互动后签署 accepted，再创建无后缀 `vX.Y.Z`。
5. 只在 S1–S4 的同一 accepted 候选把覆盖版本已验收的新行为晋升到 `PRESERVATION_MATRIX.md`，并更新受影响的 `FEATURE_CONSUMER_OWNER_LEDGER` / dependency ratchet；证明没有新增 raw Store consumer、跨 Owner deep import / 运行时依赖环、第二 Store/History/Session/writer 或重复 registry/catalog。未改变的证据按工作协议复用，不建设架构评分或常设治理流程。

四份固定验收清单在对应签署点节点实施时创建：`docs/development-plan/acceptance/S1-authoring.md`、`S2-tools-materials.md`、`S3-ai-core.md`、`S4-ai-product.md`。每份使用“编号步骤 + 预期结果 + 通过/不通过”，当前不预建空文件。

## v1.1.1 维护基线与后续模块化边界

`v1.1.1` 已在 Legacy 清零之外完成已证实热点的主动治理：`editorStore.ts` 按 Core/App/Slide/Flow/Spatial/Feature owner 拆分，App/Workspace/Properties/Flow 按组合与 Surface UI 拆分，Slide Published adapter 与 Course package builder 各形成真实消费边界。后续版本必须保持组合根只接线、依赖棘轮不倒退且保存/历史/Surface/Player/导出行为不降级；不按 LOC 建门，不创建第二 Store、万能 Facade、通用 Surface DSL 或无真实 consumer 的平台。

`buildPublishedCourse.ts`、V9 Schema/health、动态宿主、Flow/Spatial host 与 Main/Preload 暂不机械拆分：先冻结跨 Owner 增长；出现第二正式 consumer/owner、方向反转或已批准 lane 冲突时，按架构合同同一触发门拆分。已完成阶段的执行顺序和回滚点只从 Git 历史追溯。
