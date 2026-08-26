# IttoEdu 开发总纲

> 计划版本：21.0（2026-08-26：第 5 节三张 Ready 卡已交付、合入 main 并推上远端，活动路线收口、任务板 0 张卡；但**远端 CI 当前为红**——fresh checkout 上的打包时区依赖与示例缩略图字体依赖各自确定性失败；能力索引来源清单已手工修到 37 项仍有遗漏，另新增经核实的 A/B 档事实偏差与 consumer 诉求，全部待 Owner 定级，无 Ready 卡）
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

### 5.2 前一批产品红灯（已消除）

基线 `442d4e1` 上 `npx vitest run tests/integration/architectureBaselineFlows.test.tsx` 为 1/5 失败：三个固定 V9 archive 因合成 Component metadata 缺少完整 provenance 产生 `component-package-hash-missing` warning。已按"只补 deterministic fixture provenance"修复：`sha256` 对整包 `.h5component` 字节计算、`contentSha256` 保持内容 hash、两者不混用，并由单测钉死该区分。三个 archive 现为 `valid=true`、error 0、warning 0、`canExport=true`，双构建字节确定。collector、finding code/severity、Schema、CLI、导出与性能逻辑未改。

### 5.3 本批交付（三张卡已合入并删卡）

1. `repair-arch0-fixture-component-provenance`（S1）：消除上述红灯。
2. `tooling-repo-index-optional`（S2 / 热点 generated-index）：`repo-index/generated/**`、`golden-tasks/**`、`evaluateGoldenTasks.ts` 与其唯一测试 consumer 已删除，`repo:index:quality` 与 CI 的 freshness/quality 门已移除，净删约 31,440 行；`repo:index`、`repo:index:check`、`repo:context` 与 `repo-index/semantic/**` 保留为显式手动导航。独立 Reviewer 裁决 `APPROVE WITH FOLLOW-UP`：`.github` 唯一 workflow 经独立核验成立，workflow outputs 无悬空引用，semantic 全部 208 条路径引用有效，提交可干净 revert。
3. `tooling-capability-evidence-scope`（S1）：`sourceEvidence()` 的 sources 由 57 先收窄至 25，`artifacts/ai-capabilities/**` 除 `generation-evidence.json` 外逐字节不变。**当前清单是 37 项**——同日两次后续修复把漏掉的真实生成输入补了回来：`87d2af5` 补入 11 个 `src/shared/contracts/**` 合同实现，`c2442c2` 再补入 `src/renderer/project/archivePath.ts` 的值依赖。这两次修复消除了收口时记录的"provenance 对合同实现失明"反例，但清单仍靠手工维护，仍有已核实的遗漏（见 5.4 A 第 1 条）。

不自动恢复 W4/PRJ/NET/RTP 占位路线，也不再进行同类全仓审计；只有新的可复现失败、真实 consumer 或量化维护成本证据才能创建下一张实现卡。

### 5.4 收口后已核实的剩余问题（未立项，待 Owner 定级）

按不变量 15 分档，均为只读核实结果，**不得**据此自行建卡：

收口时记录的两项 A 档已在同日修复，只作留档、不再待处置：能力索引 provenance 对合同实现失明（`87d2af5` 把 11 个 `src/shared/contracts/**` 合同实现补入来源清单，改 `src/shared/contracts/interaction-v1/schema.ts` 现在会改变清单里的 sha256）；`docs/development-plan/inventories/legacy-consumers.json` 的 LEG-007 `currentFact` 过期（已改写为 `src/renderer/project/validateProjectArchive.ts` 随 LEG-010 删除后的事实）。

**A. 有可复现事实偏差**

- **能力索引来源清单仍在手工复制依赖图，且仍有遗漏**：`src/shared/contracts/course-project-v9/schema.ts` 实打实地值导入 `src/shared/projectSchema.ts` 的 `formulaAstSchema`、`projectDocumentSchema`、`sceneNodeSchema` 三个符号，但该文件不在 37 项来源清单内；更糟的是 `tests/unit/aiCapabilities.test.ts` 把它写在"必须不出现"的断言里。清单已连续从 25 → 36 → 37 补了三次，仍在漏。命中不变量 13。**处置待 Owner 二选一**：(a) 从真实依赖闭包自动派生，或建一个漏不掉的窄合同；(b) 降低 provenance 表述强度，不再声称"输入未变"。执行者不得自行裁决，也不得继续手工追加路径。
- **能力索引部分产物并非由其声称的权威推导**：`scripts/generate-ai-capabilities.ts` 用手写对象字面量生成 `schemas/course-project-v9.json` 与 `schemas/published-course-v2.json`，并未从它标为 `sourceOfTruth` 的 Zod schema（`src/shared/courseProjectSchema.ts`、`src/shared/publishedCourseSchema.ts`）派生，因此两者可相对真实合同静默漂移。命中不变量 13。
- **打包时间戳的时区不确定性是全仓库缺陷**：打包库按**本地时钟**写 ZIP 的 DOS 时间字段。已提交的 4 份归档 fixture（`examples/sample-project.h5lesson`、`examples/sample-counter.h5component`、`examples/photosynthesis-interactive-lesson.h5lesson`、`examples/render-host-benchmark/render-host-benchmark-v9.h5lesson`）DOS 时间全是 08:00，即全部生成于 UTC+8 机器；三个不同生成器在 `TZ=UTC` 下都会报"fixture 已过期"。`tests/fixtures/architecture-baseline/**` 那三份已于 `c602bb2` 修复（业务时间与 ZIP 时间分离 + 跨时区回归断言），**`examples/` 与 render-host-benchmark 的四份仍未修**。
- **示例缩略图不可跨平台复现**：它由脚本用系统字体（微软雅黑 / Arial）现场栅格化，却又被要求与已提交字节逐字节相同；Linux 上这两个字体不存在。**处置待 Owner 决定**；候选之一是改为手工维护的输入资产——该 PNG 已内嵌进两个仍逐字节校验的归档，故这样不损失实质保证。
- `artifacts/ai-capabilities/diagnostics.json` 顶层并列两套互不兼容的诊断码：V8 的 `projectHealth` / `projectedProjectHealthForExport`（各 47 码）与 V9 的 `courseProjectValidation.projectHealth`（27 码），仅靠一行 `legacyRegistryScope` 字符串区分。

**B. 有真实 consumer 诉求**

- **真实用户导出缺陷（新发现，未修）**：产品导出代码用 `new Date('1980-01-01T00:00:00.000Z')` 作打包时间——`src/renderer/export/course/flowDocx.ts`（Word/DOCX 导出）与 `src/renderer/export/course/buildCoursePackages.ts`（课程包导出）。打包库按本地时钟解释该时刻，而 ZIP 的 DOS 年份字段以 1980 为基准：在 UTC 以西的时区（欧洲西部、南北美洲）其本地日期退到 1979 年，会写出负数年份。**这影响真实用户的导出结果，不只是测试**；仓库无任何测试覆盖，因为测试全在 UTC+8 跑。
- **声明式表达能力缺口（2026-08-26 真实课例验证）**：目标是"答对进阶、答错回讲解、累计答对 3 题解锁"。结论是 5 个教学环节中 **0 个可声明式表达、3 个完全无法表达**。因为没有可用的"变量"，一道 4 选项多选题被迫展开成 81 个图层项 / 17 个命名状态 / 80 条交互规则；7 个选项需 1024 条规则，超过 `limits.json` 的 `maxSceneInteractions: 1000` 而被 Schema 拒绝，即**声明式多选题上限为 6 个选项**。V9 已发布运行态只实现了交互合同的一个薄切片（13 个触发器只支持 1 个、2 个条件只支持 1 个、19 个动作只支持 7 个），且 Runtime/Component 在已发布路径的导航能力被硬编码为不可用，因此连 Runtime 兜底也走不通。**Schema 侧已有 `courseState` / `navigationGuards` 的完整骨架**（含比较条件与引用完整性校验，且是必填字段），2026-08-12 已有验证过的原型，缺的是运行时接线、作者命令与校验器覆盖。合同变更须 Owner 决策。
- **能力索引对 AI 作者沉默降级**：`components` 与 `runtime` 段都有 `publishedPlayback` 限定符（老实标注 `partial` 与未覆盖项），唯独 `interactions` 段没有，还写着 `full-rule-authoring`；索引全文不提 `courseState` / `navigationGuards`，而它引用的 schema 把两者列为必填。净效果是 AI 会生成通过校验、零告警、导出后静默失效的课件：上一条那份内含失效判题分支逻辑的 V9 工程，`validate:course-project` 给出 `status: valid`、error 0、**warning 0**、`canExport: true`。三个 `unsupported-*` 诊断码只存在于播放层，作者态 CLI 不检查。命中不变量 13。
- V8 项目健康仍是编辑器 GUI 的唯一诊断源（`App.tsx`、`ProjectHealthPanel.tsx`、`exportPreflight.ts` 消费 1216 行 V8 `collectProjectHealth`），而 V9 的 27 码 `collectCourseProjectHealth` 只有 CLI 一个消费者——教师所见与 CLI 报告是两套码（= active-debt LEG-006、LEG-007）。
- 纯 Slide V9 工程的 PPTX/PDF 导出仍绕 V8 投影（LEG-004、LEG-005）。
- 判题能力接了运行时未接交互：`RuntimeHost` 已挂 `ctx.assessment.evaluate` 并记证据，但 `INTERACTION_CONDITION_TYPES` 仍只有 `presentation.in` / `scene.in`，无判题分支，零课例使用。

**C. 文字口径落差（无代码 consumer）**

- `repo-index/semantic/features.json` 与 `modules.json` 仍有 golden 时代措辞；`docs/development-plan/ARCHITECTURE_CONTRACT.md` 的 repo-index freshness 不变量表述与"缓存不再 tracked"存在落差；`REPAIR_PLAN.md` 的相关行属历史证据，按协议第 9 节应保留不改。

## 6. 当前路线成功门槛（本批达成情况）

- ✅ ARCH-0 三个固定 V9 archive 均 `valid=true`、error 0、warning 0、`canExport=true`，保存重开断言通过，重复构建字节确定；
- ✅ `git ls-files repo-index/generated` 为空且缓存被 ignore；默认 package/CI 不再执行 repo-index freshness、golden 或 quality 门；从缺失缓存开始 `repo:index` 可重建、`repo:context -- --path ... --size small` 返回可读上下文且不弄脏工作树；
- ✅ `artifacts/ai-capabilities` 继续可供 Builder 消费；除 `generation-evidence.json` 外能力制品逐字节不变，来源清单已排除 broad main/preload/Player/producer 文件。**但**"只含直接生成输入"仍未完全达成——清单已由手工修到 37 项，`src/shared/projectSchema.ts` 这条真实值依赖仍缺，见 5.4 A 第 1 条；
- ✅ V9 Schema、CLI/Player/Export 行为与教师能力无变化；页面不新增控制器，也未恢复独立教师逃生控件；
- ✅ 每张实现卡只执行卡内 focused checks；Reviewer 只补作者未覆盖的 CI/YAML 与任务板风险面，未复跑作者命令；本批未执行完整 E2E、完整 build、`verify`、打包、性能或签名门。集成层在合并 SHA 上补跑一次 `typecheck` 与一次 `vitest run` 作为组合风险验证；
- ✅ 未由当前失败、真实 consumer 或量化收益支撑的新增抽象、缓存、诊断码、任务卡和验证平台：0；
- ⚠️ **远端 CI 当前为红**：fresh checkout 上打包时间戳的本地时区依赖与示例缩略图的系统字体依赖各自产生确定性失败（见 5.4 A 第 3、4 条）。合并前的本地验证跑在 UTC+8 且已装微软雅黑的 Windows 机器上，因此没有暴露这两项；两项的处置都待 Owner 定级。

## 7. 当前路线之外的方向

skill 重构、黄金样例、真实课例生产、声明式数据条件与编辑器内 AI 交互仍由 Owner 另行启动。Wave 1 只建设这些未来能力都需要的网络、资源和凭证边界，不接入具体模型或 Provider。表达能力类合同继续由真实 consumer 证据准入。

## 8. 当前状态与领取入口

建卡任务（S2/并发/热点/跨会话）的状态只看自动生成的 [任务板](docs/development-plan/TASK_BOARD.md)。普通 S0/S1 直接走精简生产路径；未来任务在前置未满足时不预建卡。当前没有活动卡（`docs/development-plan/tasks/` 已随三张卡删空，Git 不跟踪空目录）；新建卡时统一放在 `docs/development-plan/tasks/<wave>/`，完成即删除。

当前任务板为 0 张卡：第 5 节三张 Ready 卡已全部交付、合入并删卡，活动路线收口。**当前没有 Ready 工作**。远端 CI 为红不改变这一点：它命中的是第 5.4 节 A 档第 3、4 条，处置方式本身待 Owner 决定，不得据此自行改 fixture、脚本或门禁。第 5.4 节的剩余问题都是只读核实结果，未立项；建卡前须由 Owner 就 A 档反例（尤其能力索引 provenance 清单增删与缩略图资产形态）与 B 档 consumer 诉求（尤其真实用户导出的负数年份缺陷与声明式表达合同）先行定级。执行者只读本总纲的不变量、自己的任务卡及卡中点名的源码/测试，不得通读旧 Wave 后自行补范围。不得自动继续 `W4-C2`、`PRJ-00B～05`、RTP-05、NET-C1 或其它 carrier 扩展。

历史纪要：ARCH-0A/0B（治理与 repo-index）、ARCH-1（首个事务纵切）、ARCH-2（跨 Surface 公共能力）、ARCH-3（Surface 模块化）、ARCH-4（交付链收口）、ARCH-5（清理与最终候选）、2026-08-24 深度审计的 29 项稳定化，均已终态收口。Policy version 2 与 REPAIR 初版已被当前方案取代；已提交过的历史材料可由 Git 历史读取，未提交的一次性评估只保留其已吸收结论。
