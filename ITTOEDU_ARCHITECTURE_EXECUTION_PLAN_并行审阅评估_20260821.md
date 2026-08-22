# ITTOEDU_ARCHITECTURE_EXECUTION_PLAN 并行审阅评估

> 评估日期：2026-08-21  
> 评估对象：`C:\Users\74755\Downloads\ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821.zip`  
> 代码仓库：`C:\Users\74755\Documents\HTML课件编辑器`  
> 代码基线：`main @ 690411d4a101b4020134712108262bddf08e0d2e`  
> 评估状态：**engineering proposal / execution not ready**  
> 总结论：**方向有条件通过；当前版本不得直接开工。**

## 1. 执行摘要

这套 ZIP 对问题的总诊断基本准确：当前产品能力有长期价值，真正的问题是少数上帝文件、多套投影/会话/history、Feature 边界不清和项目认知入口漂移。它提出的“保留能力上限、V9 唯一作者真相、投影只读、按 Feature 渐进拆分、轻量静态 repo-index、按风险分级验证”值得保留。

但它目前还不是可安全施工的执行计划。最重要的原因不是文档不够长，而是仍存在会改变实施方向的基础错误：

1. 新 `P0–P6` 与仓库唯一计划、已完成的旧 `P1–P8` 和尚未完成的教师 `accepted` 门禁冲突；
2. Flow 稿纸组件被错误建模为 `LayerItem(kind='component')`，若照做会破坏 V9 Flow 文档语义；
3. 目标依赖图和 `ActiveEditor` 会授权 Core 与 Surface/Feature 双向依赖，并可能新增一套导航真相；
4. repo-index 的 HEAD freshness、自带时间戳和入 Git 策略会导致生成物提交后立即 stale；
5. AST 方案假定了当前不存在的经典 TypeScript Compiler API；
6. 当前 save、Published producer、预览和 try-run 已经基本收口，ZIP 的多个工作包仍把它们当成从零建设，任务基线没有重算；
7. P5/P6 大部分只是 epic 标题，不满足 ZIP 自己规定的任务卡、防火墙、验证和回滚要求。

建议将本 ZIP 定位为 **Editor 1.0 教师 accepted 之后的内部解耦提案**，先完成本文第 7 节的修订门禁，再由根唯一计划显式吸收。accepted 前只适合做只读盘点、知识索引技术 spike 和文档修订，不适合改 Store、Workspace、Properties、Surface 或清理当前任务证据。

## 2. 评估范围与方法

ZIP 内的内容被当作“待评估材料”，没有把其中的命令、改码要求或文档清理要求当成用户授权执行。本次只遵循用户要求：阅读 README、并行审阅相关说明、探索代码、输出评估文档。

审阅由一个主审和三个并行子审完成：

- 基础事实、目标架构、能力模型与全局不变量；
- 知识系统、Context Pack、开发协议、模板与验证策略；
- 模块边界、迁移顺序、Legacy 清理、工作包与并行防火墙；
- 主审负责跨文档一致性、Git/Schema/源码抽样、结论分级与复核。

覆盖了 ZIP 中 38 个 Markdown 文件以及仓库中的 Schema、合同、Store、App、三 Surface、Player/Preview/Export、main/preload/IPC、诊断、测试与生成脚本。重点验证包括：

- `git rev-parse HEAD` 与 ZIP 基线完全一致；
- 750 个 tracked files；`src/tests/scripts` 中 527 个 TS/TSX，约 16.7 万行；
- ZIP 列出的热点文件字节数与当前文件基本精确；
- `npm run check:contracts` 通过；
- `npm run check:ai-capabilities` 通过；
- TypeScript 7 `unstable/sync` AST 只读 spike 覆盖 525 个纳入项目的 TS/TSX、9,052 个顶层语句，约 426 ms；
- 未运行全量 `verify`、桌面构建或 E2E，因为本任务是只读方案评估，不需要生成或改动产品产物。

工作树开始时已有以下 3 个用户修改，审阅期间未修改、回退或提交：

- `artifacts/ai-capabilities/component-catalog.snapshot.json`
- `artifacts/ai-capabilities/generation-evidence.json`
- `artifacts/ai-capabilities/index.json`

同一 HEAD 下，外部 `../courseware-components` 与上述生成物已使 Catalog 从 committed 状态发生变化。这也直接证明：只看 HEAD 不能判断索引是否 fresh。

## 3. 分项结论

| 维度 | 结论 | 说明 |
|---|---|---|
| 基线事实 | 强 | SHA、热点文件、多 session/history、实时 health、认知索引漂移均得到源码验证 |
| 架构原则 | 强 | 唯一 V9 真相、只读投影、纯命令、渐进拆分、Surface 不强行统一均合理 |
| 当前状态重基线 | 弱 | 多项已经完成的 save/preview/producer 仍被列为待建，真实静态导出缺口反而未聚焦 |
| 数据/能力模型 | 有阻断 | Flow block 与 LayerItem 混淆；代码能力与第三种全局模式混淆 |
| 目标依赖设计 | 有阻断 | Core 与 Surface/Feature 的双向依赖、selection 类型和用例组合层未闭合 |
| repo-index 方案 | 值得做但合同错误 | 规模与性能路线可行；freshness、确定性、TS7 API、查询质量门槛需先修 |
| 迁移安全 | 不足 | 缺完整 write-path/consumer/fixture/release 矩阵，ActiveEditor 与 Legacy 删除门槛过早 |
| 工作包可执行性 | 不通过 | P5/P6 多为标题；部分 facade 设计违反自身 DoD |
| 验证与验收 | 部分通过 | 风险分级合理；缺 pre-refactor 教师视觉基线、性能/IME/a11y 和明确 outcome 状态 |
| 治理一致性 | 不通过 | 与根唯一计划、现有任务编号、AGENTS 权威入口和 accepted 门禁冲突 |

## 4. 已验证的强项

### 4.1 基线和问题诊断可信

ZIP `README.md:3` 的 SHA 与当前 `git rev-parse HEAD` 完全一致。`00-foundation/01_BASELINE_AND_CURRENT_FACTS.md:27-69` 对热点和多状态真相的描述也得到验证：

- `src/renderer/store/editorStore.ts`：352,665 bytes；状态同时含旧 `project`、通用 `history`、Slide backend/projection、sidecar past/future、Flow/Spatial session 和 `courseAuthoringSession`，见 `editorStore.ts:1405-1453`；
- active V9 文档仍从 Spatial/Flow/Slide 各自 `history.present` 中择一，见 `editorStore.ts:9645-9652`；
- App 随 `state.project` 和组件包变化实时运行 health，见 `src/renderer/App.tsx:424-446`；
- `PROJECT_COGNITION_INDEX.md:14,110,157,161` 声称存在的 `repo-index/README.md`、`modules.json`、`features.json`、`tests.json` 实际均不存在。

因此“需要降低实现耦合和 AI 重复全仓阅读成本”不是臆测。

### 4.2 产品与协议护栏方向正确

以下原则应原样保留：

- Course Project V9 是唯一 persisted 作者协议，不借内部重构创建 V10；
- 投影、Workspace snapshot、Published payload 和 Player input 只读；
- 不从 Player DOM/Canvas 或 Phaser proxy 反建作者工程；
- 简单/专业界面不拥有不同的数据真相；
- 高级能力可以渐进披露但不能无替代删除；
- Slide、Flow、Spatial 只统一 Core 合同，不强行统一内部模型；
- Catalog、工程包、实例和组件 Authoring 是不同子域；
- Preview/Export 不反向修改作者文档；
- Legacy 删除必须先确认消费者、persisted 义务、Player/Export/Builder 和替代路径。

对应 ZIP 证据主要见 `00-foundation/02_GOALS_PRINCIPLES_NON_GOALS.md`、`20-modules/00_MODULE_MAP.md`、`30-execution/03_LEGACY_CLEANUP_SEQUENCE.md` 和 `90-appendix/00_GLOBAL_INVARIANTS.md`。

### 4.3 轻量 repo-index 与当前仓库规模匹配

当前约 527 个 TS/TSX、16.7 万行，已经超过单靠手写 Markdown 导航长期保持准确的舒适区；同时又远未达到需要 Neo4j、向量数据库或常驻服务的规模。JSON/JSONL、全量重建、显式 Feature 语义和小型 Context Pack 的路线符合“最短充分路径”。

产品能力索引 `artifacts/ai-capabilities/` 与编码知识索引 `repo-index/` 分离也合理，前者回答“产品能生成什么”，后者回答“改这项代码应该读什么”。

### 4.4 渐进迁移与文件防火墙值得保留

“先 facade、再迁消费者、最后删旧入口”“同一热点同一时间只由一个任务修改”“Allowed/Read-only/Forbidden”“一次只迁一个职责”和分级验证都适合单人 + 多 Agent。现有仓库已有可复用先例：

- `tests/unit/readModelBoundary.test.ts:6-19`；
- `tests/unit/editor10ForbiddenTokens.test.ts:6-45,70-135`；
- `docs/tasks/editor-1.0/02_WORKER.md:13-54`；
- `scripts/generate-ai-capabilities.ts` 的 deterministic generate/check 模式。

本方案应扩展这些门禁，不应从零再造平行机制。

## 5. 执行前阻断项

### B0-01：计划治理、激活时间与阶段编号冲突

**事实**

- ZIP `README.md:119-139` 和 `30-execution/00_ROADMAP.md` 定义新的 `P0–P6` 并建议顺序执行；
- `30-execution/01_PHASE_WORK_PACKAGES.md:125-132` 的 DOC-01 还拟重写 `AGENTS.md`、替换当前认知入口；
- 根 `AGENTS.md:12` 指定 `COURSEWARE_DEVELOPMENT_PLAN.md` 为唯一长期计划；
- 根计划 `COURSEWARE_DEVELOPMENT_PLAN.md:39,114-120,273-280` 明确旧 `P1–P8` 等已合入，当前只剩真实课例复核与教师 `accepted`；
- 根计划 `:169,269` 明确 Store/Workspace 大拆属于 1.0 之后。

**风险**

新 P1 与已完成的旧 P1 含义完全不同。Agent 很容易误领、重做历史任务或让大重构干扰唯一剩余的教师验收。未经治理决策重写 AGENTS 还可能删除当前必须保留的 Skill 路由、V9 冻结和验收约束。

**必须修订**

1. 将 ZIP 标为 `proposal / post-Editor-1.0 architecture`；
2. 阶段改为 `ARCH-0…ARCH-6` 或 `RFX-0…RFX-6`；
3. 增加 `GATE-00`：教师 accepted/发布基线前，只允许只读盘点和索引 spike；
4. 根唯一计划显式链接或吸收本路线后才生效；
5. DOC-01 只精简派生导航，不能自行改写 AGENTS 的不可协商约束。

### B0-02：Flow 稿纸内容被错误归一为 LayerItem

**事实**

- ZIP `00-foundation/05_INITIAL_FEATURE_MATRIX.md:13,19` 把文本/公式/组件实例概括为 Native/Component `LayerItem`；
- `20-modules/04_COMPONENTS.md:30-37,94-102` 明确把所有组件实例和创建结果写成 `LayerItem(kind='component')`；
- 真实 V9 中 Flow 稿纸组件是 `FlowComponentBlock`，见 `src/shared/contracts/course-project-v9/types.ts:279-315`；
- 根计划 `COURSEWARE_DEVELOPMENT_PLAN.md:190-193` 明确“Flow 普通 block 不当 z-order 图层；嵌入稿纸组件仍是文档块，视口浮层组件才进统一图层”。

**风险**

照文档实施会改变 persisted 语义、Flow 排版、阅读顺序、DOCX/PDF 和作者体验，是会直接写坏产品的模型错误。

**必须修订**

将 Native/Media/Component 的实例表示改为 Surface-specific carrier：

- Flow in-flow paper content：`FlowBlock` / `FlowComponentBlock`；
- Flow overlay、Slide、Spatial、global/surface shared：相应 `LayerItem`；
- Components Feature 拥有包生命周期与通用 props 合同；
- 各 Surface 拥有 placement/insert command 和具体载体。

### B0-03：目标依赖图、ActiveEditor 与事务目标没有闭合

**事实**

- `00-foundation/03_TARGET_ARCHITECTURE_AND_DIRECTORY.md:98-115` 同时写 `app → core → surfaces/features`、`surfaces → core`、`features → core`；
- `10-knowledge-system/01_DATA_MODEL_AND_FILES.md:94-99` 还允许 Core 依赖 `renderer-features-pure`；
- `20-modules/01_EDITOR_CORE.md:27-49` 让 Core 的 `ActiveEditor` 直接携带 `SlideSelection`、`FlowSelection`、`SpatialSelection`，自然要求 Core 依赖 Surface 类型；
- 现有 `src/renderer/authoring/courseAuthoringSession.ts:8-18,84-146` 已有 location/surface/revision/generation/selection 真相，ZIP 没有决定复用还是替换；
- ZIP 的 transaction 类型没有 generation/revision target，虽然文字声称会校验 target/revision；当前 generation guard 是防止异步提交写错页面的实际机制；
- 当前 scope 实际包含 global/surface/scene/world，见 `courseAuthoringScope.ts:18,39-70`，并不能由统一的旧 `EditingScope = 'scene' | 'global'` 覆盖。

**风险**

Core 与 Surface/Feature 会形成循环；CORE-02 可能制造新的第四/第五套导航真相；异步媒体、文本或代码草稿可能在切 location 后提交到错误目标。仅迁三个低风险动作不足以安全执行 CORE-07 的 session 降级。

**必须修订**

1. 先写 `STATE-00 ADR`，区分 persisted document、undoable history、binary sidecar、authoring navigation、draft/IME、runtime session、App UI；
2. 明确 `CourseAuthoringSession` 是演化为 ActiveEditor 还是被替换，禁止两个统一导航真相长期并存；
3. Core 只拥有稳定 identity/transaction port，不依赖具体 Surface selection 实现；
4. `commitTransaction` 显式接收 `project/revision/sessionGeneration/surface/location/scope/itemIds` target 并拒绝 stale callback；
5. 将依赖改成无环 DAG：shared/domain → Core ports；Surface/Feature adapters → Core；App/use-case composition 组合它们。

### B0-04：repo-index freshness 与确定性合同自相矛盾

**事实**

- `10-knowledge-system/01_DATA_MODEL_AND_FILES.md:29,202-216` 建议 `generated/` 入 Git，并在 manifest 中记录当前 HEAD 和 `generatedAt`；
- `10-knowledge-system/02_GENERATOR_AND_FRESHNESS.md:80-96,122-131` 又让 check 比较 HEAD 和重算输出，V1 甚至可只按 HEAD 判断；
- 在 HEAD A 生成 `manifest.head=A`，提交生成物会产生 HEAD B，生成物立即被自己判 stale；反复 amend 也不能解决；
- 当前工作树已经证明 HEAD 不变时输入和外部 Catalog 事实仍会改变；
- 若 `generatedAt` 使用当前时间，任何逐字节 `--check` 都会失败；
- 现有正确先例用 `generatedAt: null` 保证确定性，见 `scripts/generate-ai-capabilities.ts:1118-1128` 和 `tests/unit/aiCapabilities.test.ts:704-715`。

**必须修订**

- freshness 权威使用排除 `repo-index/generated/**` 后的 `sourceTreeHash + semanticHash + generatorVersion`；
- HEAD 只作诊断信息，不参与严格 fresh 判定；
- `generatedAt: null` 或移到不受 check 的日志；
- 查询时检测同 HEAD 的 dirty inputs；
- `fresh/partially-stale/stale` 是查询结果，不持久化为静态真相；
- 相同输入连续两次生成必须逐字节一致，Windows/Linux 排序与路径大小写必须有测试。

### B0-05：IDX-02 的 TypeScript API 路线写错

**事实**

- ZIP `10-knowledge-system/02_GENERATOR_AND_FRESHNESS.md:38-50` 假定可直接使用现有 TypeScript Compiler API；
- 仓库固定 `typescript: 7.0.2`，见 `package.json:93`；
- 当前包根导出只有 `version/versionMajorMinor`，经典 `createSourceFile` 和 `ScriptTarget` 不存在；`node_modules/typescript/package.json:39-40` 显示编程入口是 `typescript/unstable/sync` 等；
- 只读 spike 证明 `unstable/sync` 可以遍历现有项目且远低于 10 秒阈值，因此技术上可行，但升级风险和 API 形态与文档不同。

**必须修订**

IDX-02 前先做解析器 spike，并在方案中明确：

- 锁定 TS 7.0.2；
- 用薄适配层隔离 `typescript/unstable/sync`；
- 加 API smoke、alias、barrel、type import、dynamic `import()`、行号和跨平台测试；
- 未经单独依赖审批，不新增 `ts-morph`、第二套 TypeScript 或其他大型解析依赖。

### B0-06：工作包没有按真实当前状态重基线

**已经完成的事实**

- Save 已直接读取 active V9 document + asset/component sidecars，见 `src/renderer/App.tsx:324-338,614-640`；
- 整课 preview 与三 Surface try-run 已通过同一 `buildPublishedCourseV2Payload` 和 CoursePlayer 路线；
- HTML/Web package 已复用该 producer；
- `src/player/**` 对 renderer store 的只读搜索为 0；
- 现有 `course/read-model/index.ts`、read-model boundary test 和 forbidden-token ratchet 已存在。

**真正未完成的事实**

- Slide-only PPTX 仍走 V8 projection；
- PDF fallback 和 preflight 仍会读取/合并 V8 `state.project`；
- `projectCandidatePreviewDocument` 仍构造 `schemaVersion: 8` 的 projection；
- Project Health 仍主要消费 V8 `ProjectDocument`。

**风险**

P3/P4/P5/P6 的 save、RUN-03、FLOW-04、SPATIAL-04、PLAY-01、EXPORT-01 等会重复争夺 producer；真实的 Slide 静态导出/诊断 V8 consumer 反而没有成为清晰 critical path。

**必须修订**

P0 的 MAP-01 必须允许关闭或重写旧工作包，并给每项标记 `existing / preserve / partial / missing / legacy-consumer`：

- Save、Published V2、try-run、full preview、HTML/Web：`existing, preserve`；
- Slide PPTX/PDF/preflight 和 V8 health：独立 `EXPORT-V9-*` / `DIAG-V9-*` 迁移卡；
- Runtime task 只拥有 Runtime 字段映射；Player task 只拥有 mount/destroy/generation；Export task 只拥有格式 adapter；
- Published producer 只能有一个串行 owner。

### B0-07：P5/P6 是 epic，不是可派发任务；FAC-01 还违反自身边界

**事实**

- `30-execution/01_PHASE_WORK_PACKAGES.md:1-4` 声称工作包可直接派给编码 AI；
- 同文件 P5 的 `SLIDE-01…PROPS-01` 和 P6 的 `PLAY…FINAL` 基本只有标题，见约 `:440-502`；
- 这违反 `40-development/01_TASK_PROTOCOL_AND_FILE_FIREWALL.md` 和 `50-templates/TASK_CARD_TEMPLATE.md` 对 baseline、目标符号、读写路径、防火墙、消费者、删除条件、验证、回滚的要求；
- FAC-01 `30-execution/01_PHASE_WORK_PACKAGES.md:160-175` 要从公共入口 re-export Store hook；
- 自己的 DoD `40-development/03_DONE_ROLLBACK_HANDOFF.md:80-87` 又说 facade 仍暴露整个 Store 不算完成。

**必须修订**

- 将 P5/P6 所有标题先拆成真实卡；每卡列具体符号、旧/新 entry、consumer 清单、最小测试、删除门槛和 rollback commit；
- Surface 迁移改为：串行 seam → 三 Surface 新模块可并行且热点只读 → 单一 integrator 接入 Workspace/Properties → 串行删旧分支；
- 公共 facade 只导出 narrow selectors、typed hooks/commands 和 transaction ports；raw Zustand hook 不从公共 index 导出；
- 若迁移期必须保留，命名 `legacyUseEditorStore` 并通过 ratchet 禁止新增消费者。

## 6. 其他高优先级缺口

### H1：把当前事实、目标完成条件和迁移期例外分开

`90-appendix/00_GLOBAL_INVARIANTS.md` 把“三 Surface 已共用 Core history”“Workspace 只路由”“诊断不实时全算”“repo-index 已有效”等尚未成立的目标状态列成全局不变量，而 `00-foundation/01_BASELINE_AND_CURRENT_FACTS.md` 又承认现状相反。

建议语义索引明确三类：

- `current-must-preserve`：现在已经成立且任何任务都不能破坏；
- `target-acceptance`：阶段完成后才必须成立；
- `transitional-allowance`：迁移期允许存在、带删除任务和期限。

每条 semantic edge/invariant 还应带 `origin: generated | semantic`、证据路径和 schema version，避免目标意图冒充源码事实。

### H2：Legacy 和文件地图缺完整消费者/构建/release 证据

`20-modules/10_CURRENT_TO_TARGET_FILE_MAP.md` 对热点职责判断大体正确，但遗漏或过于宽泛：

- 已存在的 `courseAuthoringSession` 和 `course/read-model/index.ts`；
- main/preload/IPC、安全/trust/path/hash 校验；
- global/effective layers 与 teacher controller 的跨 Surface owner；
- Runtime、Interaction、Media、Diagnostics 的 player/preview/authoring 入口；
- 真正 V9 合同源 `src/shared/contracts/course-project-v9/{types,schema}.ts`；旧顶层文件只是 re-export；
- 仍使用 V8 archive/projection 的 build fixtures、release verification 和测试。

“删除旧 Project”必须拆成：Store 可写旧字段、只读 projection、V8 fixture/release pipeline、仍被 V9 合同复用的旧命名共享原语。最后一类不能按文件名直接删除。

MAP-01 应生成“文件 → 职责 → owner → 协议读写 → 生命周期 → runtime/build/test/release consumer → 替代路径”的矩阵；每个 CLEAN 卡附 zero-reference 搜索、replacement path、persisted 兼容说明和目标行为测试。

### H3：跨切 owner 仍未决定

至少需要补充以下 owner/ADR：

- global/surface/effective layers 与 teacher controller；
- IPC channel parity、main/preload trust 和 component catalog 安全边界；
- recovery single-flight、cancel、revision 与原子写；
- “代码能力保留在 DeveloperTab”还是新增独立 Code Mode；
- Component/Media 与 Surface placement 的原子 use case 放在哪一层。

尤其“代码模式”当前并不存在于 `EditorMode`。源码只有 `simple | professional`，Developer 是 professional 下的 tab，见 `editorStore.ts:1336-1345` 和 `RightSidebar.tsx:59-68,117-122`。独立 Code Mode 是新产品设计，不应在 semantic index 中伪装成当前事实。

### H4：repo-index 还需最小可靠性合同

建议 V1 只做：

- File；
- static/type/dynamic import 与 re-export；
- 顶层导出符号与行号；
- npm scripts；
- test 文件与 test 名称；
- 直接摄取已有 contract manifest；
- 少量高信号 Feature：当前 entrypoints、canonical files、tests、invariants、aliases。

暂缓 recent-change 权重、全量 reads/writes/renders/produces 人工图、二层扩展和精确 token 计数。

查询可靠入口优先 `--feature`、`--symbol`、`--path`、`--changed`；自由文本只作 best-effort，输出 confidence 和候选 Feature。至少用 25 个真实历史任务做黄金集，而不是只用 4 个示例“看起来合理”地验收。建议门槛：

- canonical file Hit@5 ≥ 90%；
- 必需合同/高信号测试 Recall@15 ≥ 85%；
- 查询 P95 < 2s，全量生成 < 10s；
- 无高置信结果时必须降级为候选；
- 相同输入排序和输出逐字节一致。

V1 明确不做跨仓索引，却以“组件目录版本更新”作为验收；真实 Catalog 默认在 `../courseware-components`。应把验收限定为编辑器侧 Catalog consumer/package lifecycle，或只摄取已有能力生成器的外部 Catalog 摘要，不声称能导航外部源码。

### H5：验证需要加入 outcome、性能和交互护栏

风险分级验证方向正确，但还需补：

- accepted 前先保存三份代表工程、截图/录屏和教师视觉/互动基线；
- 明确区分 pipeline status 与 outcome status；自动化最多证明 engineering candidate；
- 大型 Mixed 工程的 selector、history 内存、undo latency、drag commit、save/reopen 性能基线；
- keyboard、focus、DnD、contenteditable、IME composing 和 stale callback characterization；
- UI/Surface 重组后的视觉、拖拽手感、Flow 排版、Spatial 自由逛与 Component/Runtime 实际互动；
- 最终门禁显式包含 `check:contracts`、`check:ai-capabilities`、`repo:index:check`，不要假定当前 `npm run verify` 已包含全部门禁。

### H6：任务协议需要按风险分级，避免制造新的文档噪声

当前 `docs/tasks/editor-1.0` 已有大量任务卡和 handoff。若每个单文件小修都强制完整任务卡、handoff、semantic 更新，会重新制造本方案想排除的历史噪声。

建议：

- S0：明确单文件小修——不建持久卡，目标测试 + diff；
- S1：跨文件/公共入口——简版卡；
- S2：热点、Schema、迁移、多 Agent——完整卡、防火墙、handoff。

generated index 只由阶段整合者统一刷新；子 Agent 只报告 `indexImpact`，避免并行冲突。

### H7：文档卫生和 bootstrap 问题

- `00-foundation/00_READING_MATRIX.md:34` 引用不存在的 `40-development/02_CODE_CLEANING_POLICY.md`；
- 阅读矩阵和标准工作流要求任何任务先跑 `repo:context`，但它到 IDX-04 才会存在，P0 形成 bootstrap 循环；
- `PACKAGE_MANIFEST.md` 声称 37 份文档，而 ZIP 实际有 38 个 Markdown（若刻意不计 manifest，应明确）；
- Context Pack 说 4k/8k/16k token，但当前无 tokenizer；V1 应使用确定字符/字节预算并标注为估算；
- Feature 内 aliases 与独立 `aliases.json` 是双维护真相；
- `git diff --check` 不覆盖未跟踪文件；“目标文件 TypeScript 编译”在当前 package 中也没有可执行命令。

## 7. 建议的最短充分修订路线

### GATE-00：先确定本方案何时生效

1. 完成当前教师课例复核与 `accepted`，或由产品 owner 明确批准提前进入 post-1.0 重构；
2. 在根唯一计划中登记本方案；
3. 全部阶段和任务使用 `ARCH-*` 命名；
4. 保存 pre-refactor 代表工程、自动化结果和视觉/互动基线。

### ARCH-0A：只修方案事实与任务基线

1. 修正 Flow block/LayerItem、当前两模式、CoursePlayer/Phaser 边界；
2. 拆分 current invariant、target acceptance、transition allowance；
3. 完成 write path、consumer、fixture、release、owner 矩阵；
4. 给每项标记 existing/preserve/partial/missing/legacy-consumer；
5. 关闭重复工作包，重写实际 critical path。

### ARCH-0B：做可验证的 repo-index MVP

1. 定义严格 semantic/generated schema 和 provenance；
2. 使用 deterministic sourceTreeHash，解决 dirty worktree 与自引用；
3. 用 TS7 unstable API 薄适配层；
4. 先完成 File/import/export/top-level symbol/test/script/contract；
5. 用黄金任务集验收；不先做完整人工知识图谱。

### ARCH-1：修无环边界并复用现有门禁

1. STATE-00/ActiveEditor ADR；
2. public API 不导出 raw Store hook；
3. 扩展现有 read-model/forbidden-token ratchet；
4. 建立串行热点 owner 和 Surface seam；
5. 补 global layers/controller、IPC/security/recovery owner。

### ARCH-2：先迁真实旧投影消费者

1. Slide PPTX/PDF/preflight 改读 V9/Published；
2. Project Health 逐规则迁到 V9 structural/authoring/export 分层；
3. 决定 V8 fixtures/release benchmark 的保留或替代；
4. 在消费者清零前不删 `state.project` 或 projection。

### ARCH-3：一个高风险纵切验证 Core 设计

选择一个低风险但完整的用户动作，必须同时证明：

```text
stable target
→ Surface-specific command
→ one Core transaction/history
→ sidecar/component delta（若涉及）
→ undo/redo
→ save/reopen
→ preview/export consumer
```

纵切通过后再扩大 command/history 迁移；不能用三个小试点直接证明所有旧 session 可以降级。

### ARCH-4 以后：Surface seam、迁移、清理、最终验收

按照“串行 seam → Surface 内部并行 → 单一 integrator 接线 → 串行删除”的顺序展开真实任务卡。所有旧写入消费者、静态导出、诊断、fixture/release 和测试迁移清零后，才进入 CLEAN。最终报告必须分别给出 pipeline status 与 outcome status；教师 `accepted` 只能来自明确验收。

## 8. 文档转为可执行计划前的验收清单

- [ ] 根唯一计划已登记本路线，且激活门禁明确；
- [ ] 新阶段/任务不再复用已完成的 P/T/Q/F/G 编号；
- [ ] Flow block 与 LayerItem 的载体模型已修正；
- [ ] current/target/transitional 三类事实已拆分；
- [ ] 依赖 DAG 无 Core ↔ Surface/Feature 环；
- [ ] ActiveEditor/CourseAuthoringSession 取舍和 stale target 合同已有 ADR；
- [ ] repo-index freshness 不依赖自引用 HEAD，生成完全确定；
- [ ] TS7 AST API 路线、适配层和跨平台测试已写入方案；
- [ ] 所有工作包已按当前源码标 existing/partial/missing；
- [ ] P5/P6 已展开为真实任务卡；
- [ ] raw Store hook 不从公共 facade 导出；
- [ ] main/preload/IPC/security/recovery/global-layer/controller 有明确 owner；
- [ ] V8 static export/diagnostics/fixtures/release consumers 有迁移或保留决定；
- [ ] Schema 软冻结直接引用兼容策略，本轮架构卡默认 forbidden；
- [ ] repo-index 至少通过 25 个黄金任务和确定性/freshness 门禁；
- [ ] 缺失文档引用与 P0 bootstrap 例外已修复；
- [ ] pre-refactor 工程、性能、视觉/互动基线已保存；
- [ ] 每个高风险卡有具体符号、consumer、验证、删除条件和 rollback commit。

## 9. 最终建议

**建议保留并继续修订这套 ZIP，不建议废弃；但不要按当前 README 启动 P0→P6。**

最安全、也最短的下一步不是立即拆 `editorStore.ts`，而是：

1. 把方案纳入根唯一计划并改成 post-accepted 的 `ARCH-*` 路线；
2. 修正 Flow 载体、依赖 DAG、ActiveEditor/stale target 和 repo-index freshness 四个基础合同；
3. 用当前源码重算任务状态，聚焦真实 V8 consumers；
4. 先交付一个确定、可复现、可量化命中的 repo-index MVP；
5. 再用一个完整纵切验证 Core transaction/history，而不是用目录搬迁证明架构完成。

完成这些修订后，这套文档可以从“方向正确的工程方案草案”升级为“可派发、可验证、可回滚的执行基线”。
