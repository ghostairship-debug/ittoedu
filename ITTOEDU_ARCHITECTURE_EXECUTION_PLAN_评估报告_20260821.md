# 《IttoEdu 统一架构、能力整合与项目知识系统执行方案》评估报告(详细版)

- 评估对象:`ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821.zip`(README + 清单 + 37 篇正文,共 39 篇 Markdown)
- 评估基准仓库:`C:\Users\74755\Documents\HTML课件编辑器`(IttoEdu 课件编辑器)
- 基线核对:方案声明基线 `main @ 690411d4a101b4020134712108262bddf08e0d2e`,经 `git rev-parse HEAD` 实测**完全一致**(仅 3 个 `artifacts/ai-capabilities/*` 生成物有未提交改动)。
- 评估方法:两轮子智能体并行作业。第一轮 6 个只读子智能体分片精读全部 39 篇并对照真实仓库核实;第二轮同一批子智能体(保留上下文)按指定维度深挖,为每篇产出带 zip 行号、原文摘引、仓库证据、修改建议、复核方法的问题清单。关键争议事实由主评估人直接复核仲裁(见 §8.3)。
- 评估日期:2026-08-21
- 本文档用途:供后续 AI 交叉审阅、评估与整合使用。全部问题条目可独立复核、独立修复。

## 使用指南

- **问题 ID 体系**:`F-*`(00-foundation)、`KS-*`(10-knowledge-system)、`MA-*`(20-modules 00–05)、`MB-*`(20-modules 06–10)、`EX-*`(30-execution)、`DV-*`(40/50/90);`G-*` 为跨文档全局性问题,是若干具体条目的归并,文末附引用关系。
- **严重度**(各子评估的"高/中/低"已归一化为):**关键** = 执行前必须解决,否则会误导施工或破坏现行治理;**重要** = 会造成返工、漏改或验收口径失真;**次要** = 措辞、口径、格式问题。
- **每条问题字段**:位置(zip 文档:行号)→ 原文摘引 → 类型 → 仓库证据(路径:行号)→ 修改建议(具体到应改成什么)→ 复核方法(后续 AI 独立验证手段)。
- zip 解压留档:`tmp/zip-eval/ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821/`(仓库内,可随时删除)。
- 统计:具体问题 **126 条**(F-01~22、KS-01~17、MA-01~19、MB-01~16、EX-01~21、DV-01~31)+ 全局性归并 8 项(G-01~G-08)。另核实"属实无问题"的断言 60 余条(不逐条列出,分部分章节保留关键项)。

---

# 一、总体结论与评分

**这是一份事实地基罕见扎实、技术方向正确、工程纪律良好的架构重构方案,但存在 4 个关键级缺陷(治理衔接缺失、索引生成器技术前提错误、repo-index 前史冲突、概念大面积悬空),不建议原样直接执行;按 §5 修订后可作为主要执行依据。**

方案核心主张——唯一可写 V9 文档真相、Feature 模块边界、三模式复用能力内核、静态 repo-index + Context Pack、P0→P6 渐进迁移——与仓库实际债务(9681 行 god store、4 套 history、双文档形状并存)和 AGENTS.md 既定约束(V9 软冻结、统一图层、不建 V10、渐进披露)高度对位。抽查的数十条现状断言(文件大小精确到 KB、字节级示例、Store 字段清单、IPC 分组、导出格式)几乎全部在基线提交上复现;文件迁移地图 26 行零死链。

## 分项评分汇总

| 文档部分 | 事实准确性 | 设计/可行性 | 第三维度 | 小计 |
|---|---|---|---|---|
| 00-foundation(6 篇) | 9 | 8(设计合理性) | 9(与项目约定一致性) | **8.7** |
| 10-knowledge-system(4 篇) | 7 | 7(设计合理性) | 6(相对现有机制增量价值) | **6.7** |
| 20-modules 前半(00–05) | 9 | 9(边界合理性) | 8(迁移规则可操作性) | **8.7** |
| 20-modules 后半(06–10) | 7 | 8(边界合理性) | 7(文件地图可用性) | **7.3** |
| 30-execution(4 篇) | 8(阶段划分) | 7(依赖与并行) | **3(与现有计划/任务体系衔接)** | **6.0** |
| 40/50/90(11 篇) | 6(与现状匹配度) | 7(流程务实性) | 7(不变量/风险覆盖度) | **6.7** |
| **综合** | | | | **≈7.3 / 10** |

---

# 二、全局性问题详述(G-01 ~ G-08)

> 本章 8 项是跨文档的结构性问题,每项归并第三章中的具体条目,供整合者优先处理。

## G-01(关键)治理衔接缺失:与"唯一计划"和现行任务体系零交接

**事实链(全部附原文行号)**:

1. 仓库现行治理:`AGENTS.md:12`(全文仅 12 行,该行为治理核心)——「长期开发方向只看根目录 [唯一计划](COURSEWARE_DEVELOPMENT_PLAN.md)(12.10:V9 Schema 软冻结;T0–T6、P1–P8、Q1–Q8、F1–F3、G0–G3 已合入 `main`;教师 `accepted` 前不得宣称发布)。……执行任务看 [Editor 1.0 任务包](docs/tasks/editor-1.0/00_INDEX.md);第三方工人先读 [工人协议](docs/tasks/editor-1.0/02_WORKER.md)。」
2. `COURSEWARE_DEVELOPMENT_PLAN.md:22`——「本文件是唯一长期总纲。可执行任务卡在 `docs/tasks/editor-1.0/`。」
3. `COURSEWARE_DEVELOPMENT_PLAN.md:120`——「Store/Workspace 大拆仍属 1.0 之后。」**本方案本质是 Store/Workspace 大拆,在唯一计划中的合法位置就是"1.0 之后",方案本可引用此句自证定位,但全文未引用。**
4. 方案包侧:全包 grep `COURSEWARE_DEVELOPMENT_PLAN` **零命中**;`00-foundation/00_READING_MATRIX.md:57` 把 `docs/tasks/editor-1.0/**` 划为"已完成的历史任务卡";`20-modules/10_CURRENT_TO_TARGET_FILE_MAP.md:33` 把它列为"默认排除,阶段后清理";`30-execution/03_LEGACY_CLEANUP_SEQUENCE.md:51-60,89` 把"旧任务与 reviews"列入 L4 清理。
5. DOC-01(`30-execution/01_PHASE_WORK_PACKAGES.md:125-138`)原文:「重写 `AGENTS.md` 为短入口;将 `PROJECT_COGNITION_INDEX.md` 替换为精简 `PROJECT_INDEX.md` 或改为自动入口;历史任务不再默认阅读;保留必要决策到 ADR。」——未点名 AGENTS.md 现行硬约束(唯一计划地位句、V9 软冻结句、教师 accepted 门禁句、Skill 路由两条)重写后落到哪里。

**影响**:直接执行会造成两套计划并存、两套任务格式并存;现行约束失去载体;L4 清理会删除 AGENTS.md 指定的现行任务入口。

**修改建议**(汇总为 DOC-01 改写要点,详见 §5-A1):
- 方案 README 增加"与唯一计划的关系"节:声明本方案是 `COURSEWARE_DEVELOPMENT_PLAN.md` 3.2 节预留的"1.0 之后"车道的执行子计划,唯一总纲地位不变。
- DOC-01 验收口径改为:重写后 AGENTS.md 必须原样保留唯一计划链接与地位句、V9 软冻结句、accepted 门禁句、Skill 路由两条。
- L4 清理增加门禁:唯一计划修订为指向新体系、且教师 accepted 状态不受影响之后,方可清理 editor-1.0。

**复核方法**:`grep -rn "COURSEWARE_DEVELOPMENT_PLAN" zip解压目录/`(当前应零命中);修订后应命中 README 与 30-execution。

## G-02(关键)概念大面积悬空:规划设施被当作现状

仓库中**不存在**、但方案多处按"既有设施"行文的概念:`repo:context` / `repo:index` / `repo:index:check` CLI、`repo-index/` 目录、Facade、ActiveEditor union、Binary Delta、Context Pack、"代码模式"(`EditorMode` 实际仅 `'simple' | 'professional'`,`src/renderer/store/editorStore.ts:1343`)。

**具体条目**:F-01、F-14、MA-15、MB-06、MB-10、MB-16、DV-01、DV-02、DV-05、DV-09、DV-10、DV-16、DV-18~DV-21、DV-23~DV-25、DV-29、DV-31。

**影响**:后续 AI 按文档施工时会去寻找不存在的命令、目录和模式,直接失锚;模板中含无法填写的字段(`Index status`、`Feature id`、HANDOFF 的 `Generated HEAD`)。

**修改建议**:全文扫一遍"现状/规划"语态,统一加状态标注(格式见 DV-29 的建议表头:`| 术语 | 含义 | 状态(现状/规划/部分) | 证据/引入处 |`);所有依赖 repo-index 的流程步骤注明"建成前降级为手工 Grep/Read";"代码模式"首次出现处统一脚注"目标新增第三档,当前对应 professional 模式的 DeveloperTab,不持久化"。

**复核方法**:`grep -rn "repo:context\|repo:index" package.json scripts/`(应为空,直到 IDX-02 落地);`grep -n "type EditorMode" src/renderer/store/editorStore.ts`。

## G-03(关键)索引生成器技术前提错误:typescript@7 无经典 Compiler API

**事实链**:`package.json:93` 依赖 `typescript: 7.0.2`(原生/Go 编译器);`node_modules/typescript/package.json:39` 主导出仅 `"./lib/version.cjs"`;`lib/` 全目录仅 getExePath/tsc/version 等 5 个文件;实测 `require('typescript')` 中 `createProgram`、`forEachChild` 均为 `undefined`。AST 能力仅存在于 `unstable` 子路径:`typescript/unstable/sync`(44 个导出,含 `Program`/`Project`/`Checker` 会话式 API)与 `typescript/unstable/ast`(409 个导出,含 scanner/`SyntaxKind`/类型守卫,但**无 `createSourceFile`/parse 入口**)。

方案 `10-knowledge-system/02_GENERATOR_AND_FRESHNESS.md:40` 写"使用现有 `typescript` 依赖",:50 写"不加入 `ts-morph`,除非 Compiler API 实现成本明显过高"——经典稳定 API 不是成本高,是**不存在**。

**影响**:IDX-02(AST 索引生成器,P0 最重工程量)按文档字面开工会在第一步卡住。

**修改建议**(KS-10):02 文档 L40-50 改写为明确三选一:(a) 用 `typescript/unstable/sync` 的 Project/Program + `unstable/ast` 工具集,锁定 7.0.2(平台二进制已被 optionalDependencies 钉死,`package.json:65-86`);(b) 新增 devDependency(typescript@5.x 或 ts-morph)专供索引器;(c) 放弃 AST,用 scanner/正则启发式(对 import/export/顶层符号足够)。删除"除非成本过高"例外条款。

**复核方法**:`node -e "const ts=require('typescript');console.log(ts.version,typeof ts.createProgram)"`(当前应输出 `7.0.2 undefined`)。

## G-04(关键)repo-index 前史冲突:已有未合入实现与"不建全量图"现行决策,方案只字未提

**事实链(经主评估人直接复核仲裁,见 §8.3)**:

- commit `0c12bb0d69268a00d407cddd9ea06c75ba202898`(2026-08-15,"docs: split roadmap and add project cognition index",amend 产生)**包含完整 repo-index 实现**:`repo-index/README.md`(27 行)、`manifest.json`(29 行)、`modules.json`(283 行,11 个 module,字段 entrypoints/keyFiles/responsibilities/dependsOn/mustNotDependOn)、`features.json`(250 行,11 个 feature,字段 status/productFiles/tests/invariants/nextEvidence,**无 aliases/writes/reads**)、`tests.json`(86 行,13 个 suite)。
- 该提交**不在 main 上**:`git merge-base --is-ancestor 0c12bb0 HEAD` 退出码 1;`git branch -a --contains 0c12bb0` 为空;`git log main --oneline -- repo-index` 为零。main 经 `e53c126` 只合入了 `PROJECT_COGNITION_INDEX.md` 而**未合入 repo-index/**(`git ls-tree -r e53c126 --name-only | grep -c '^repo-index/'` = 0),导致认知索引自进入 main 第一天起,其 5 处 `repo-index/*` 引用就是悬空的。
- 现行明示决策:`PROJECT_COGNITION_INDEX.md:14`(main 上)——「当前只维护 modules、features 和 tests,**不建设全量符号图、依赖图**、热点系统或知识图谱服务。」旧 `0c12bb0:repo-index/README.md:26` 同义:「不在当前阶段生成完整 import graph、循环依赖图、Git 热点或测试覆盖数据库。」manifest 的 `intentionallyOmitted` 列有 "full import graph / generated knowledge graph"。
- 方案 `10-knowledge-system/00_OVERVIEW_AND_DECISION.md:17,71-79` 把 repo-index 当全新命题,提出 symbols.jsonl + edges.jsonl 全量 import 图——**与上述现行决策正面冲突,却未援引、未反驳、未给出推翻理由**。

**影响**:决策篇效力受损;执行者可能同时触发"恢复已决策不做的事"和"重复已有底稿"两种浪费(旧 11 modules/11 features 本可作为 semantic 层初稿)。

**修改建议**(KS-01/KS-07):00 篇 §3 前增加"现状与前史"小节,写明 0c12bb0 五文件、未合入事实、现行"不建全量图"决策原文;明示本方案 = 恢复 semantic 层(以旧底稿起步)+ 就是否推翻"不建全量 import graph"单独写 ADR 裁决,两步分别给理由。

**复核方法**:`git show --stat 0c12bb0 | grep repo-index`;`git merge-base --is-ancestor 0c12bb0 HEAD; echo $?`(应为 1);`sed -n '14p' PROJECT_COGNITION_INDEX.md`。

## G-05(重要)导出双 producer 并存未识别,低估迁移面

**事实链**(完整证据见 §3.4 深挖 A):

- 五种导出均为**双轨分派**,分派条件 `activeCoursePublishSources()`(`App.tsx:129-137`,依赖 `selectActiveCourseProjectDocument`,editorStore.ts:9648-9652):有活动课程会话走 V2 producer(`buildPublishedCourseV2Payload`,`export/course/buildPublishedCourse.ts:534` + `buildCoursePackages.ts:291-311`),无会话 fallback 走 legacy producer(`buildExportPayload.ts:211-217` → `buildStandaloneHtml.ts:118-127` / `buildWebPackage.ts`,类型 `ExportPayload | PublishedLessonPayload`)。
- 具体分派行号:single-html `App.tsx:1053-1064`;web-package `:1105-1122`;pptx `:1139-1163`;pdf `:1183-1231`(V2 走主进程 `pdfExport.ts` 打印 `.page` DOM;legacy 走 `renderProjectSceneImagesWithRuntime` 栅格化);docx `:1239-1261`(仅 V2、仅 Flow,无 fallback)。
- Player 侧同为双入口:`src/player/payload.ts:147` `PlayerPayload = ExportPayload | PublishedLessonPayload` + `publishedLesson.ts:16` 降级转换(legacy);`player/surfaces/CoursePlayer.ts` + `publishedDynamicHosts.ts`(V2)。
- 仓库文档自身也有矛盾:`docs/PUBLISHED_LESSON_V1.md:3` 称 V1"由 Course Project V9(经 Published Course V2 producer)在导出边界编译产生",但代码中 `buildPublishedLessonPayload`(`buildPublishedLesson.ts:207`)独立从 `ProjectDocument` 构建,**并不经过 V2 producer**。

方案 `20-modules/07_PLAYER_PREVIEW_EXPORT.md:6-17` 把"HTML/网页包走 Published Course V2"当既有唯一链条;文件地图 export 行(:28)也未标注双 producer;术语表 `02_GLOSSARY.md:19` 称 V2 链"唯一";不变量 #35(:58)"唯一 producer"半成立。

**影响**:导出收口(EXPORT-01~03、PLAY-01~03)的工作量与删除清单被系统性低估;按文档施工会在 legacy 链上失锚。

**修改建议**(MB-03/MB-04/MB-15/DV-26/DV-30):07 篇 §1 补"现状"段(双轨+分派条件+fallback 触发时机);增加 legacy 退役路线(消费方清单:buildPptx、renderProjectSceneImagesWithRuntime/playerCapture、buildStandaloneHtml、buildWebPackage、player/payload.ts:147 联合类型);修正 `docs/PUBLISHED_LESSON_V1.md:3` 与代码的矛盾(二者必改其一);术语表与不变量 #35 改写为"双链现状 + V1 列入 legacy 并定义删除条件"。

**复核方法**:`grep -n "buildExportPayload\|buildPublishedCourseV2Payload" src/renderer/App.tsx`(应见 5 处分派)。

## G-06(重要)与现行任务协议体系双轨:任务协议、HANDOFF、验证防火墙、命名撞车

**事实链**(逐节对照见 §3.6 表 2.1):

- `40-development/01_TASK_PROTOCOL_AND_FILE_FIREWALL.md` 与现行 `docs/tasks/editor-1.0/02_WORKER.md` 大面积重复:文件防火墙(WORKER§2 两态 vs 协议§3 三态)、Schema 独立提交(WORKER:34/59 vs 协议§7)、越界停手(WORKER§5 vs 协议§8)。局部张力:WORKER:63"不拆整个 editorStore.ts/Workspace.tsx" vs 协议§4"热点文件可逐符号改"。
- HANDOFF 双模板:03_DONE 的 11 字段 vs WORKER:78-87 的 8 字段,各有独有字段,未裁定唯一。
- 验证防火墙宽窄不一:WORKER:37-54 默认连 `npm run typecheck` 都禁(全量仅 T6);方案 V2 允许阶段级 typecheck+build:desktop。两者**可兼容但角色未分清**(工人 vs 阶段整合者)。
- 阶段命名撞车:方案 P0–P6 vs 唯一计划历史车道 P1–P8(`COURSEWARE_DEVELOPMENT_PLAN.md:129-131`,P8 已合入)。
- worktree 策略不一致:WORKER:15 对单人第三方工人强制 isolated worktree;方案 02:123"小工作包在阶段分支上小提交即可"。

**修改建议**(DV-04/06/08/12/13/15/16):合并为两层——"任务设计规范"(并入 `docs/tasks/editor-1.0/01_SHARED.md`:结果导向、字段分两档、迁移五要素、行为检查单)与"工人执行纪律"(保留 02_WORKER.md,吸收 Read-only 中间态、热点符号清单、finding 四字段);HANDOFF 合一(14 字段);阶段改名 R0–R6 并在 README 声明与历史 P 车道无关;验证策略开头写明"V1 的 E2E/构建与 V2 全部仅限阶段整合者,工人仍守 WORKER 防火墙"。

**复核方法**:对照两文档节标题;`grep -n "verify\|typecheck" docs/tasks/editor-1.0/02_WORKER.md`。

## G-07(重要)模式与术语现状漂移:"代码模式"越位、"简洁"被写成"简单"、simple 模式能力矩阵未标注现状差异

- `EditorMode = 'simple' | 'professional'`(editorStore.ts:1343),无 code;UI 文案是"**简洁**/专业"(`TopToolbar.tsx:122-141`),方案通篇写"简单模式"。
- 能力矩阵(`00-foundation/04_CAPABILITY_MODES.md:21-32`)三行与现状有实质差异且未标注:
  - :27 组件使用"simple=推荐/已安装"——现状 simple **无任何组件入口**(`RightSidebar.tsx:103` 组件 Tab professional-only;`ElementsTab.tsx:88` 类目按模式分支)。这是对现状的产品扩张,需教师确认。
  - :24 高级属性"simple=折叠/更多"——现状是**直接不渲染**(PropertiesTab.tsx:680,717,758,2889,2895 等 5+ 处 professional 条件渲染),无折叠入口,已贴边 AGENTS.md"必须可发现"红线;矩阵方向是修复,但应注明现状为"隐藏"。
  - :32 "全局层/控制器=简化入口"混列两项:全局层入口两模式固定无门控(NodesTab 无任何 editorMode 引用,符合 AGENTS.md 固定入口),控制器添加则 professional-only(ElementsTab.tsx:118)——应拆两行,并加红线"不得给 NodesTab 全局层入口加模式门控"。
- 不变量 #10/#16/#17/#19/#20/#33/#43 共 7 条引用不存在的"代码模式"(DV-23)。

**修改建议**(F-14~F-17、MB-06、MB-10、DV-05、DV-19、DV-23):全文"简单模式"→"简洁模式"或注明映射;"代码模式"统一加"(规划,落地前对应 DeveloperTab)";能力矩阵三行按上文改写为"现状:X;目标:Y"两栏式。

## G-08(重要)文件迁移地图遗漏整棵子树

`20-modules/10_CURRENT_TO_TARGET_FILE_MAP.md` 已有 26 行零死链,但遗漏:`src/main/*`(16 个文件,含 pdfExport/previewWindow/ipc——PDF 导出与预览窗关键所在)、`src/preload/*`(2)、`src/renderer/diagnostics/*`(2)、`src/renderer/authoring/*`(12)、`src/shared/contracts/*`(8 子目录)、`src/renderer/styles/*`(2)。逐文件归属建议见 §3.4 深挖 B。

另:03 目标目录树未交代 `renderer/course/`(31 文件)、`authoring/`(12)、`phaser/`(9+)、`dev/`(1)的归宿(F-09);main 目标树未覆盖 pdfExport/diagnosticLog/security/applicationIdentity/errors(F-12)。

**修改建议**(MB-14、F-09、F-12):文件地图补 6 行(contracts 一行注明"整体保留不迁移");03 篇增设"现状→目标目录映射表"小节(可直接采用 §3.1 第二部分 A/B/C 三表)。

---

# 三、分部分详细评估与问题清单

## 3.1 00-foundation(6 篇)——事实准确性最高(9/8/9)

**核验结论**:基线 HEAD、V9 软冻结(`docs/contracts/V9_COMPATIBILITY_POLICY.md:6`)、8 个热点文件大小(与文档值误差 <1KB:editorStore.ts 352,665B/9,681 行、Workspace.tsx 145,079B/3,984 行、PropertiesTab.tsx 127,792B/3,114 行、globals.css 109,328B、InteractionEditor.tsx 85,296B、App.tsx 72,923B/1,895 行、FlowWorkspace.tsx 65,221B/1,869 行、editor.spec.ts 143,896B)、Store 多套状态(editorStore.ts:1404-1455)、双模式现状、组件 API 4、诊断混合面板等关键断言全部复现。Feature Matrix 两轮共抽查 20 行,17 行完全属实、3 行部分属实,无整行虚构。

**问题清单(F-01~F-22,无关键级)**:

### 00_READING_MATRIX.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-01 | :13 | 重要 | 概念悬空 | 「任何任务只强制阅读:……`repo:context` 输出的 Context Pack」——该命令不存在且未标注待建设 | package.json:9-57 无 `repo:*`;`repo-index/` 不存在;01:153 自述基线无此目录 | 加注:「`repo:context` 由 10-knowledge-system 建设;落地前本项以人工按 §2 矩阵选读代替」 | `grep -rn "repo:context" package.json scripts/` |
| F-02 | :27-28 | 次要 | 内部矛盾 | 选读列裸文件名 `07_PLAYER_PREVIEW_EXPORT.md`/`09_UI_COMPOSITION_AND_MODES.md`,同表其他引用均带目录前缀 | 同文件 :24-26 对照 | 补全 `20-modules/` 前缀 | `ls 20-modules/` 逐一比对 |

### 01_BASELINE_AND_CURRENT_FACTS.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-03 | :51 | 次要 | 事实错误(轻微) | Store 中并列存在「`project: ProjectDocument`;Course Project V9 文档」——无顶层 V9 document 字段,V9 文档承载于 slideBackend session 的 history.present 等内部 | editorStore.ts:1404-1455 | 改为「V9 文档(分散承载于 slide backend session 与 course authoring session 的 history.present 内)」 | `grep -n "CourseProjectDocument" src/renderer/store/editorStore.ts \| head` |
| F-04 | :63-68 vs 05:7 | 次要 | 内部矛盾 | 收口目标「一个 CourseProjectDocument / 一个 sidecar」vs 05 矩阵「V9 document + sidecars」复数;当前持久化实为 asset sidecar + componentPackages 双通道 | editorStore.ts:1427,1439-1443;`project/courseProjectArchive.ts` | 统一为「一个 asset sidecar + 一个组件包通道」,或在 01 §3 明确 sidecar 含两类负载 | 读 courseProjectArchive.ts 读写函数签名 |
| F-05 | :124 | 次要 | 事实遗漏 | 「Catalog 状态仍可能为 unavailable」——基线 HEAD 属实,但工作区未提交改动已翻为 available,未提示漂移 | `git show HEAD:artifacts/ai-capabilities/index.json` → unavailable;工作区 → available | 加注「截至基线 HEAD;工作区有未提交翻转,执行前需重新确认」 | `git diff artifacts/ai-capabilities/index.json \| grep catalogStatus` |
| F-06 | :153 | 次要 | 事实遗漏 | 「部分列出的源码路径已经失效」未点名,修复索引时需重新全量排查 | 实测失效:PROJECT_COGNITION_INDEX.md:101 的 v9SlideVerticalSlice.ts;:106 的 DeclarativeCourseState.ts | 补「已确认失效示例:v9SlideVerticalSlice.ts(:101)、DeclarativeCourseState.ts(:106)」 | 对认知索引 §4/§5 每个 src/ 路径跑 `test -f` |
| F-07 | :164-178 | 重要 | 事实遗漏 | §8 可复用基础清单遗漏 6 项重要现有设施(明细见下) | 见下方明细 | §8 增补 6 条 | 逐项 `test -e` 或查 package.json |

F-07 明细(§8 应增补的现有设施):
1. **shared/contracts 八子合同体系 + 生成物**:`src/shared/contracts/`(component-v4、course-project-v9、design-v1、interaction-v1、media-v1、native-v1、published-course-v2、runtime)+ `artifacts/contracts/*.schema.json` + `check:contracts` 保鲜(package.json:29)。§8 只提了 Component/Runtime contracts。
2. **Player 独立构建链**:`vite.player.config.ts` + `build:player`(package.json:21)+ `dist-player/player.iife.js` + `src/renderer/virtual-player-bundle.d.ts` 虚拟模块约定;导出与预览均依赖(App.tsx `loadPlayerBundle()`)。
3. **`.agents/skills` 双 skill**:orchestrate-courseware、build-courseware-project + `install:courseware-skills`(package.json:10)——AGENTS.md 规定的教师工作流入口,也是"AI 课件能力索引"Feature(05:34)的真实消费者。
4. **发布链**:electron-builder.yml、scripts/verify-release.ts(`verify:release`,package.json:55)、build:icons、release/ 产物。
5. **示例与 fixture 构建链**:build:examples、build:lesson-demo、build:component-catalog-matrix(package.json:36-52)+ examples/*.h5lesson/.h5component——迁移期回归基线。
6. **tests 分层与 helpers**:tests/{unit,integration,e2e,helpers,fixtures,prototypes} + tests/setup.ts(与 F-10 直接相关)。

### 02_GOALS_PRINCIPLES_NON_GOALS.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-08 | :130-135 | 次要 | 概念悬空 | 「可暂时收进实验区」——实验区无落地载体定义(目录?状态字段?构建排除?) | 00-foundation 内无定义;05:44 仅补"应有明确入口和成熟条件" | 补载体定义:「实验区 = features/ 下状态为 `experimental` 的 Feature,不挂默认 UI 入口,样例保留在 examples/」 | 检查 30/40 章是否另有定义 |

### 03_TARGET_ARCHITECTURE_AND_DIRECTORY.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-09 | :56-87 | 重要 | 遗漏/设计缺陷 | renderer 目标仅列 app/core/surfaces/features/project/preview/export/ui/styles/,未交代 course/(31 文件)、authoring/(12)、phaser/(9+)、components/(6)、dev/(1)、diagnostics/(2) 的归宿 | `ls src/renderer/course/`(31 文件)、`ls src/renderer/authoring/`(12 文件) | 增设"现状→目标目录映射表"小节(可直接采用下方差异表) | 对映射表逐行 `test -d` |
| F-10 | :142 | 重要 | 治理冲突 | Feature 模板含 `tests/` 目录,与顶层 tests/{unit,integration,e2e} 三分约定双轨,未说明取舍 | package.json:17-19;`ls tests/` | 二选一并写死:feature 内 tests/ 仅放纯函数单测,集成/E2E 归顶层;或删模板 tests/ 改在 05 矩阵补 tests 列 | `grep -rn "tests/" docs/tasks/editor-1.0/00_INDEX.md \| head -3` |
| F-11 | :48-55 | 次要 | 事实遗漏 | shared 目标目录是 50+ 扁平文件的大改名,未提文档/索引/能力卡同步成本与批次策略 | `ls src/shared/`(50 扁平 .ts);PROJECT_COGNITION_INDEX.md:98-99 引用扁平路径 | 补「改名需同 PR 同步认知索引 §4 与 artifacts 生成物」;建议 common/ 最后一批 | `grep -rn "shared/courseProjectTypes" docs/ PROJECT_COGNITION_INDEX.md \| wc -l` |
| F-12 | :41-46 | 次要 | 事实遗漏 | main 目标树未覆盖 pdfExport.ts、diagnosticLog.ts、security.ts、applicationIdentity.ts、errors.ts | `ls src/main/`(17 文件) | 目标树补 platform/ 或 services/,或显式标注"暂留 main/ 根" | 对照 `ls src/main/` 检查覆盖率 |
| F-13 | :166-181 | 次要 | 设计缺陷(轻微) | legacy-read-adapters/ 未指定落位;现有投影分散在 store/(slideEditorProjection.ts)、course/(effectiveLayerProjection.ts、flowOverlayProjection.ts) | `ls src/renderer/store/`、`ls src/renderer/course/ \| grep -i projection` | 明确「新建目录集中归集」或「原地改名留标记」之一;建议后者(原地加 legacy 命名+删除任务号) | 检查 30-execution 阶段包是否回答落位 |

**03 目标目录 vs 现状逐项差异表(可直接并入方案 03 篇)**:

A. src/main/(17 个扁平文件):index.ts→保留;createWindow/previewWindow/windowVisibility→windows/;ipc/protocols/fileDialogs→ipc/;projectPersistence/appState→persistence/;componentCatalogManager/componentCatalogScanner→catalog/;**pdfExport/diagnosticLog/security/applicationIdentity/errors→目标树未覆盖(F-12)**。

B. src/shared/(50 扁平 .ts + contracts/):contracts/ 已存在(8 子合同);course-project/←courseProjectTypes/Schema/Model.ts;published-course/←publishedCourseTypes/Schema.ts、publishedLessonTypes.ts;component/←8 个 component*.ts + builtInComponentCatalog.ts;runtime/←runtimeTypes/Schema、surfaceRuntimeTypes;interaction/←interactionTypes/Schema;common/←其余约 30 文件(geometry、textRuns、assetReferences、projectHealth、informationRelease、visualDensity、assessmentEvaluators 等)。风险:认知索引等直接引用扁平路径(F-11)。

C. src/renderer/(12 子目录 + App.tsx/main.tsx):app/←App.tsx 拆分(新建);core/←store/4 文件 + authoring/ 部分(新建+拆分);surfaces/slide/←Workspace.tsx slide 分支 + phaser/ + course/slideEditor*、v9Slide*、slideInteraction*、slideAuthoringBackend;surfaces/flow/←FlowWorkspace + course/flowEditor*、flowDocumentModel、flowOverlayProjection、flowSharedAuthoringAdapters + authoring/flowTextEdit、flowOverlayAuthoring;surfaces/spatial/←course/spatial*(6+2)+ authoring/spatialWorldAuthoring + SpatialCameraPanel/SpatialPathEditor + Workspace spatial 分支;features/components/←components/ 6 文件;features/runtime/←authoring/runtimeAuthoringContext、runtimeTargetEditSession + preview/runtimePreview*;features/interactions/←course/slideInteraction* + InteractionEditor + SimpleEntranceAnimationEditor;features/media/←project/assetManager、mediaBatch、v9AssetAdapter + course/v9MediaAudioCommands + MediaTab;features/global-layers/←course/globalLayerCommands、effectiveLayerCommands/Projection;features/teacher-controller/←TeacherControllerAuthoringChrome + shared/teacherController*;features/diagnostics/←diagnostics/ 2 文件 + ProjectHealthPanel;project/、preview/、export/、ui/、styles/ 同名已存在;**dev/v9CandidateSmokeInject.ts 目标未提归宿**。结论:renderer 侧最大决策空白是 course/(31 文件)与 authoring/(12 文件)在 core/surfaces/features 三方之间的切分。

### 04_CAPABILITY_MODES.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-14 | :10 | 次要 | 概念悬空 | 「`type EditorMode = 'simple' \| 'professional' \| 'code'`」以"核心定义"口吻给出,未标注现状仅两值 | editorStore.ts:1343 | 类型定义下加一行现状注 | `grep -n "type EditorMode" src/renderer/store/editorStore.ts` |
| F-15 | :27 | 重要 | 事实遗漏 | 矩阵「组件使用\|推荐/已安装\|…」——现状 simple **无任何组件入口**,这是产品扩张,需教师确认 | RightSidebar.tsx:103;ElementsTab.tsx:88 | 该行 simple 列改「现状:无入口;目标:推荐/已安装(待产品确认)」 | `grep -n "components" src/renderer/ui/RightSidebar.tsx` |
| F-16 | :24 | 重要 | 事实遗漏 | 「高级属性\|折叠/更多」——现状 simple 是**直接不渲染**(5+ 处 professional 条件渲染),已贴边 AGENTS.md 可发现性红线;矩阵方向是修复但应注明现状 | PropertiesTab.tsx:680,717,758,2889,2895;ElementsTab.tsx:296 | 改「现状:隐藏;目标:折叠/更多(修复可发现性)」 | `grep -cn "editorMode === 'professional'" src/renderer/ui/PropertiesTab.tsx` |
| F-17 | :32 | 次要 | 事实遗漏 | 「全局层/控制器」混列——全局层入口两模式固定无门控(NodesTab 无 editorMode 引用,符合 AGENTS.md 固定入口),控制器添加 professional-only | RightSidebar.tsx:30-34,113;ElementsTab.tsx:118 | 拆两行;加红线「不得给 NodesTab 全局层入口加模式门控」 | `grep -n "editorMode" src/renderer/ui/NodesTab.tsx`(应持续为空) |
| F-18 | :90 | 次要 | 概念悬空(轻微) | 代码模式流程含「计算 Diff」——DeveloperTab 现状是整对象 JSON 校验后整体写回,无 diff 机制 | DeveloperTab.tsx:329-372 | 注明「diff 为新增能力;落地前允许整对象替换式提交,但不得绕过统一 command/history」 | 检查代码模式落地任务验收标准是否含 diff |

**04 能力暴露矩阵逐行对照现状(12 行全查)**:高频元素=直接(符合)、三 Surface=直接(符合)、常用属性=直接(符合)、高级属性=折叠/更多(**现状为隐藏**,F-16)、常用动画=模板(符合,PropertiesTab.tsx:3016 + editorStore.ts:7311-7360 写标准 InteractionRule)、互动规则=常用入口(基本符合,措辞略超前)、组件使用=推荐/已安装(**现状 simple 无入口**,F-15)、Runtime=不默认显示(符合)、Component Runtime=不默认显示(符合)、诊断=操作点提示(符合,TopToolbar.tsx:244-277)、导出预检=自动提示(符合,App.tsx:1276-1293)、全局层/控制器=简化入口(需拆行,F-17)。

### 05_INITIAL_FEATURE_MATRIX.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| F-19 | :16 | 次要 | 事实错误(轻微) | 教师控制器入口列「Nodes/Properties/Player」——真实添加入口在 ElementsTab(professional-only),chrome 挂在 Workspace/FlowWorkspace | ElementsTab.tsx:279-285;Workspace.tsx:132;FlowWorkspace.tsx:77 | 入口列改「ElementsTab(添加)/Workspace·FlowWorkspace chrome/Nodes/Properties/Player」 | `grep -rn "TeacherControllerAuthoringChrome\|add-teacher-controller" src/renderer -l` |
| F-20 | :36 | 次要 | 概念悬空 | 历史任务/评估「Canonical Data:Git 历史/ADR」——ADR 非仓库现有实践(docs/ 仅 1 处 reviews 提及,无目录/模板/编号) | `grep -rln "ADR" docs/ --include="*.md"` 仅 1 命中 | 改「Git 历史/docs 归档」或加注「ADR 为规划机制」 | `ls docs/**/ADR* 2>/dev/null` |
| F-21 | :11-12 | 次要 | 事实遗漏 | Spatial「spatial commands/UI」、Mixed「course navigation」过笼统 | course/spatial* 6 命令文件 + authoring/spatialWorldAuthoring.ts;courseTreeView.ts、courseEditorLayout.ts、courseLocationCommands.ts + ScenePanel | 入口列各补 1-2 锚点文件 | `grep -n "spatialSession" src/renderer/ui/Workspace.tsx \| head -3` |
| F-22 | :15 | 次要 | 治理冲突(潜在) | 全局层/共享层状态「advanced」与 AGENTS.md「四态左栏固定入口」存在解读张力 | AGENTS.md;NodesTab.tsx 无模式门控 | 状态列加注「入口四态固定可见;advanced 仅指高级配置项」 | 检查后续任务卡 AC 是否保留左栏固定入口 |

**05 矩阵追加抽查 10 行小结**:7 行完全属实(课程树/公式图形/组件包/Runtime/动画模板/结构检查/试运行),3 行部分属实(F-19/F-20/F-21),无整行虚构。

## 3.2 10-knowledge-system(4 篇)——诊断准确但有重要盲区(7/7/6)

**核验结论**:对仓库规模(527 个 ts/tsx、12 个 >46KB 文件、168 个测试文件)、路径漂移论断、ai-capabilities 分工定位的描述全部属实;数据模型/新鲜度设计与现有 `generation-evidence.json` 机制同构;Context Pack token 预算现实(medium 档实测约 1.5k–4k token,8k 是宽松上限)。但存在 2 个关键级问题(KS-01 前史冲突、KS-10 技术前提错误,详见 G-03/G-04)。

**问题清单(KS-01~KS-17)**:

### 00_OVERVIEW_AND_DECISION.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| KS-01 | :17,:71-79 | **关键** | 事实遗漏 | repo-index 被当全新命题,遗漏 0c12bb0 已有实现与"不建全量图"现行决策(完整事实链见 G-04) | `git show --stat 0c12bb0`;PROJECT_COGNITION_INDEX.md:14 | §3 前增"现状与前史"小节;明示本方案=恢复 semantic 层+推翻"不建全量图"决策,分别给理由 | `git merge-base --is-ancestor 0c12bb0 HEAD; echo $?`(应为 1) |
| KS-02 | :62-69 | 重要 | 事实遗漏 | §3 对 ai-capabilities 描述遗漏其已具备的 hash 证据链与 `--check` 流水线挂载 | package.json:26-27,33,35;generation-evidence.json 含 inputs.sourceFiles[38] 逐条 sha256;generate-contracts.ts:14-16 有现成 sha256 工具 | 补一句「repo-index 生成器应复用同一套脚本骨架(tsx+zod+sha256+原子写入),只替换扫描与查询层」 | `node -e "const e=require('./artifacts/ai-capabilities/generation-evidence.json');console.log(Object.keys(e))"` |
| KS-03 | :140 | 次要 | 概念悬空 | 成功标准 7「AI 不再默认读取全部历史任务和几个超大文件」不可量化验收 | 无度量机制;超大文件可具体化(editorStore.ts 352,665B 等) | 改可测口径:「抽样 N 个任务,AI 读文件数从基线 X 降至 ≤15,且不含 docs/tasks/** 与 >100KB 源文件」 | 检查该标准是否含基线数值与抽样方法 |

### 01_DATA_MODEL_AND_FILES.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| KS-04 | :96 | 次要 | 事实错误 | Module 示例 `"publicEntrypoints": ["src/renderer/core/index.ts"]` 不存在,与 00:136 成功标准「所列路径全部存在」自相矛盾 | src/renderer/ 下无 core/;真实入口链为 main.tsx(认知索引:49-55) | 改真实路径或标注「示意,非真实仓库路径」 | `ls src/renderer/core/index.ts`(应不存在) |
| KS-05 | :57-58 | 次要 | 事实错误 | Symbol 示例 startLine 120/endLine 390 杜撰;实际 `ComponentsTab` 从 :391 开始(L42 的 bytes=26330 反而精确属实,示例半真半编) | ComponentsTab.tsx:391、:165 | 行号改真实值或删数字留字段名 | `grep -n "export function ComponentsTab" src/renderer/ui/ComponentsTab.tsx` |
| KS-06 | :29,:208-209 | 重要 | 治理冲突 | `generated/` 建议入 Git 且 manifest 含 head/generatedAt 时钟字段,与现有证据体系字节级确定性约定冲突;当前 ai-capabilities 三文件 dirty 即此类噪音实证 | generation-evidence.json 的 note 原文「为保持相同输入的字节级确定性,证据不写入时钟或绝对路径」且 generatedAt:null;`git status --short artifacts/` | 二选一:(a) 去掉 generatedAt/head 保持字节确定,新鲜度由 `--check` 运行时输出;(b) generated/ 不入 Git,改 CI 缓存或随 release 发布快照 | `node -e "const e=require('./artifacts/ai-capabilities/generation-evidence.json');console.log(e.generatedAt,e.note)"` |
| KS-07 | :171-173 | 重要 | 设计缺陷 | semantic/modules.json 与认知索引 §4 人工模块地图、旧 0c12bb0 modules.json 形成多份人工边界,无单一真相声明 | PROJECT_COGNITION_INDEX.md:94-110;旧 modules.json 11 个 module(字段 entrypoints/keyFiles/responsibilities/dependsOn/mustNotDependOn) | 声明 semantic/modules.json 为唯一机器可读真相,认知索引 §4 改由它生成;以旧 11 模块为初版底稿 | `git show 0c12bb0:repo-index/modules.json` 对照 |
| KS-08 | :102-109 | 次要 | 事实遗漏 | Contract 节点未提可直接复用的 6 份机器可读 schema | artifacts/ai-capabilities/index.json 的 artifacts 键含 component-api4/course-project-v9/interactions/published-course-v2/runtime-api2/runtime-api3 六份 schema+sha256;生成器 generate-contracts.ts(209 行) | contracts.json 直接引用上述路径+哈希,V1 只补 IPC types 入口(src/main/ipc.ts) | `ls artifacts/ai-capabilities/schemas/` |
| KS-09 | :125-144 | 次要 | 概念悬空 | 12 种边的生成来源(自动/人工)未标注;reads/writes/renders/produces/legacy_of 只能来自人工 semantic,任何现存实现都无此来源 | 旧 features.json 字段无 writes/reads | 边表增「来源」列(AST 自动/人工/脚本派生)+人工边维护触发条件 | `git show 0c12bb0:repo-index/features.json \| head -40` |

### 02_GENERATOR_AND_FRESHNESS.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| KS-10 | :40,:50 | **关键** | 技术前提错误 | 「使用现有 typescript 依赖」+「不加入 ts-morph,除非 Compiler API 实现成本明显过高」——typescript@7.0.2 经典 Compiler API 不存在(详见 G-03) | node_modules/typescript/package.json:37-51;lib/ 仅 5 文件;实测 createProgram undefined | L40-50 改写为三选一(unstable/sync / 新增 ts-morph / scanner 启发式),删例外条款 | `node -e "const ts=require('typescript');console.log(ts.version,typeof ts.createProgram)"` |
| KS-11 | :100-118,:131 | 重要 | 设计缺陷 | 新鲜度与 `--check` 无强制挂载点,靠人工自觉;仓库已有现成挂载先例 | package.json:33(build 首步 check:ai-capabilities)、:35(verify 同);ai-capabilities dirty 即无强制必漂移的实证 | `repo:index:check` 挂入 build/verify(与 check:contracts 并列);indexImpact 降级为提示 | `grep -n '"build"\|"verify"\|check:' package.json` |
| KS-12 | :96 | 重要 | 设计缺陷 | 「V1 直接按 HEAD 判断」漏报工作树脏态陈旧;本仓库工作树常态 dirty | `git status --short` 常态非空;generation-evidence.json 判据本来就是输入文件 sha256 而非 HEAD | 改「HEAD 相同→抽验涉及 Feature 的 canonicalFiles hash;HEAD 不同→partially-stale」,或把 `git status --short -- src tests scripts package.json` 非空作为 partially-stale 信号 | 构造实验:不改 HEAD 改动任一 src 文件后查询,观察是否仍报 fresh |
| KS-13 | :9-16 | 次要 | 治理冲突 | 新增 `repo:*` 五个 script,与既有 `generate:*/check:*` 命名风格关系未声明 | package.json:26-29 | 沿用 `generate:repo-index`/`check:repo-index`,或一句话声明 `repo:*` 是查询类命名空间 | 对照 package.json scripts 全表 |

### 03_QUERY_AND_CONTEXT_PACK.md

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| KS-14 | :56-71 | 重要 | 设计缺陷 | 评分权重为任意常数且「recent related diff +20」需查询时解析 git 历史,成本未入预算(与 02:154-155「查询低于 1 秒至数秒」有张力) | 02:145 测试策略第 7 条可用于固化权重期望但 03 未引用 | 权重表移入可配置 JSON;git 历史查询给缓存/限时策略;排序黄金用例写进生成器测试 | `time git log --name-only -20` 粗测成本 |
| KS-15 | :33-40,:151-160 | 重要 | 设计缺陷 | 种子匹配依赖的 aliases.json 从零冷启动;旧 features.json 无 aliases 字段;中文任务短语与英文符号无字面重叠(实证:「图片替换」→`replaceImageAsset`,App.tsx:465-466) | 认知索引 §5(:114-131)16 行人工任务表可作 alias 底稿 | V1 验收加「§5 的 16 个任务行全部可经 alias/路径种子命中」;首批 50-100 词条;:158「任务结束后回填 alias」升级为 DoD 项 | `git show 0c12bb0:repo-index/features.json \| grep -c alias`(应为 0) |
| KS-16 | :147 vs 00:135 | 次要 | 内部矛盾 | 「不嵌源码」与「默认约 8k Token」之间无度量口径;实测 medium 档约 1.5k-4k | 03:132-137 档位数 | 改区间口径(medium 1.5k–5k、large ≤12k)或给估算公式 | 用真实 medium Pack 过 tokenizer |
| KS-17 | :83-84 | 次要 | 概念悬空 | Pack 模板只有 fresh 样例,缺 partially-stale/stale 警告格式(00:139 成功标准 6 与 02:93-94 三档定义无对应展示块) | 02:93-94 | 模板 `## Index Status` 节补两档样例 | 对照 02:93-94 检查模板覆盖率 |

**已核实属实(非问题)**:00 篇 L17 路径漂移论断(实测漂移 ≥10 处,见下);01 篇 File/Feature 示例的路径、字节数、canonicalFiles、测试文件全部存在;03 篇 `updateCourseSound` 示例(v9MediaAudioCommands.ts:903,消费方 editorStore.ts:156,6917)、组件库七层区分示例与真实文件一一对应;L160「禁止因查询失败自动全仓库读取」与认知索引 L24 现行协议一致。

**深挖 B1:commit 0c12bb0 完整盘点**(G-04 的事实基础):2026-08-15 20:41 +0800,amend 产生;新增 PROJECT_COGNITION_INDEX.md(210 行)+ COURSEWARE_DEVELOPMENT_PLAN.md + **repo-index/ 五件**(README 27 行、manifest.json 29 行、modules.json 283 行/11 module、features.json 250 行/11 feature、tests.json 86 行/13 suite)。**不在 main 上**(merge-base 退出码 1、无分支包含、main 从未触碰 repo-index 路径);main 经 e53c126 只带走认知索引,repo-index 引用自第一天起悬空。旧 README 维护边界原文:L25「不收录局部变量或全部导出符号」、L26「不在当前阶段生成完整 import graph、循环依赖图、Git 热点或测试覆盖数据库」、L27「生成物不能成为架构真相」、L20「JSON 只记录真实存在的路径和命令」(后被违反)。注意:旧 tests.json 引用的 `verify:full`/`prepare:e2e`/`test:compat` 等命令与 v9SlideVerticalSlice.test.ts 在当前 main 均已不存在——**人工命令映射同样会漂移**,这反而支持方案把 tests.json 改为自动生成。

**深挖 B3:PROJECT_COGNITION_INDEX.md 全量漂移清单(10 项确认 + 1 项存疑)**:

| # | 行号 | 引用 | 现状 |
|---|---|---|---|
| D1-D4 | :14,:110,:157,:161 | `repo-index/README.md`、`modules.json`、`features.json`、`tests.json` | 全部不存在(main 从未有过) |
| D5 | :61 | 「Store 里仍有 `v9-slide-candidate`/`V8SlideBackend` 过渡命名」 | src 零匹配,已清理 |
| D6 | :66-67 | `buildV9SlideWorkspaceSnapshot`→`WorkspaceSlideAuthoringInput` | 两符号零匹配;后继为 buildSlideAuthoringSnapshot(slideAuthoringBackend.ts:67,201)与 createSlideWorkspaceAuthoringController(workspaceSlideAuthoring.ts:394) |
| D7 | :101,:117,:177 | `src/renderer/course/v9SlideVerticalSlice.ts` | 不存在,src 零引用(3 行 4 处) |
| D8 | :106 | `src/player/DeclarativeCourseState.ts` | 不存在;仅存 tests/prototypes/declarativeCourseStatePrototype.ts |
| D9 | :168 | `npm run verify:full` | package.json 无此 script |
| D10 | :6,:19 | 「COURSEWARE_DEVELOPMENT_PLAN.md 12.8」 | 计划已 12.10(:3) |
| D11(存疑) | :190-194 | donor 文件清单(CourseStudioApp.tsx 等) | 全部不在 git 树;作为警示尚可,建议改写为「donor 概念(不在本仓库文件树中)」 |

反向抽查(证明漂移非全文性):L49-55 入口链、L98-107 模块地图(除 D7/D8)、L116-131 §5 表全部符号、L7/L8/L166 docs/tasks 文件、L4/L5 历史基线提交,均有效。

**深挖 B5:冷启动 alias 缺口量化**:起点为零(旧 11 features × 0 alias;方案示例 feature id media-assets/flow/components 与现存标识符不对应);对齐 §5 的 16 类高频任务需 ≥16 feature × 3-6 条中英 alias ≈ 首批 50-100 词条;无 alias 时种子落到优先级 5 关键词匹配,中文任务短语分词后命中率极低,预期冷启动期大多数自由文本查询进入 :151-160 失败路径;收敛速度取决于回填是否强制(应从建议升级为 DoD)。**现成缓解资产**:§5 表 16 行 + 旧 11 features + 旧 13 test suites 可直接转写为 features/aliases/tests 三份 semantic 初稿,冷启动成本主要是转写而非创作。

## 3.3 20-modules 前半(00–05)——事实与边界双优(9/9/8)

**核验结论**:20 余条现状断言几乎全部落实(三 session 链式推断 editorStore.ts:889-897、undo 三分支 :9501-9548、可写 V8 投影 derivedV8ProjectFromFlow/Spatial :1242/:1191、sidecar 整体快照 :1441-1445、App.tsx 54 处 desktopAPI 直调等);与 AGENTS.md 全部硬约定零冲突。主要口径问题:个别"迁移目标"已是现状;「现有 Immer/Patch 基础」掩盖 3/4 history 实为整文档快照。

**问题清单(MA-01~MA-19)**:

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| MA-01 | 00:5-23 | 重要 | 遗漏 | 模块表无「现状成熟度」维度;CORE-03/04 是 03/05 篇多个完成标准的隐式前置,未标注 | selectActiveCourseProjectDocument(editorStore.ts:9648)已被保存路径使用,Editor Core 已部分起步 | 模块表加「现状状态」列;注明 Editor Core 是 Surfaces/Interactions 迁移前置 | 对照下方 CORE 逐步状态表抽查 |
| MA-02 | 00:28-35 | 次要 | 可操作性 | 8 条迁移规则无冲突裁决;规则 8(消费者清零才删)+规则 2(一次一职责)会拉长旧文件存活期,无上限/检查点 | 规则 6 与 V9 软冻结一致(schema.ts:1178 z.literal + .strict()) | 补「每个迁移步骤结束必须可独立编译、可独立验收」检查点规则 | 审阅 CORE-01~07 每步是否满足 |
| MA-03 | 01:81 | 重要 | 事实偏差 | 「建议保留现有 Immer/Patch 基础」——Immer patches 只覆盖 V8 路径;V9 三套 session history 全部是整文档快照 | store/history.ts:22-37、editorStore.ts:375,1951(V8 patches);slideEditorCommands.ts:23-27、spatialAuthoringHistory.ts:19-23、flowEditorSlice.ts:53-89(均 `past: CourseProjectDocument[]`) | 改为「V8 路径已有 patches 基础;V9 三套 session history 当前为整文档快照,统一到 patches 前需先接受快照或先做快照→patch 迁移」 | `grep -n "past:" course/slideEditorCommands.ts course/spatialAuthoringHistory.ts course/flowEditorSlice.ts` |
| MA-04 | 01:212-215 | 重要 | 遗漏 | CORE-05 只点名 sidecar 快照,漏同处 componentPackages past/future 快照与 Spatial/Flow 的 sidecarDirection 同步机制 | editorStore.ts:1441-1443(sidecar)、:1444-1445(componentPackages)、:9510,:9538(sidecarDirection) | CORE-05 扩写覆盖三者 | 读 editorStore.ts:1438-1446、:9501-9548 |
| MA-05 | 01:186-223 | 重要 | 现状滞后 | CORE-01~07 未给现状基线;CORE-01 的 selectActiveCourseProjectDocument 已存在并被保存路径消费,CORE-03 在 Slide 已有事实原型 runV9DocumentMutation | editorStore.ts:9648、App.tsx:326-327;editorStore.ts:3425-3469 | §7 每步开头加「现状:…」行;CORE-01 注明「已存在,补齐其余 4 个」;CORE-03 注明「以 runV9DocumentMutation 为原型推广」 | 对照下方 B.1 表 |
| MA-06 | 01:155-160 | 次要 | 遗漏 | Selection 目标正确,但现状 `selectedNodeId/selectedNodeIds`(editorStore.ts:1412-1413)的退役路径未点名 | slideEditorCommands.ts:30-32 注释与目标一致 | CORE-02/07 补「selectedNodeId(s) 降级为 ActiveEditor.selection 的 selector 输出」 | `grep -n "selectedNodeId" store/editorStore.ts` 统计消费点 |
| MA-07 | 02:100-115 | 次要 | 现状滞后 | IPC 目标分组已大体是现状:32 通道 8 前缀分组、DesktopAPI 类型集中 | shared/ipcTypes.ts:112-144(166 行);main/ipc.ts:184-194 统一注册 | 改写为现状确认+真实差异(component 与 component-catalog 是否并组、app:* 更名 window、调用点收拢进 hooks) | 对照下方 B.3 表 |
| MA-08 | 02:25-35 | 重要 | 遗漏 | hooks 列表漏 9 处 desktopAPI 调用:素材导入 5 处、诊断导出 1 处、窗口/脏状态/保存请求 3 处 | App.tsx:669,685,740,750,790(素材)、:1354(诊断)、:1367,1510,1517(窗口) | 目标结构补 useAssetImportActions.ts;诊断导出并入 useExportActions;窗口相关入 useProjectLifecycle 或新增 useWindowLifecycle | 对照下方 B.3 归类表(覆盖 33/42) |
| MA-09 | 02:7-17 | — | (确认属实) | App.tsx 职责清单逐项落实;单一全局 busy 属实 | App.tsx:559-613,614,341-360,841,944,1067,1092-1303,1352,96-99,1625;busy :375,:474 | 无需修改;可补「文件 1895 行」增强说服力 | `wc -l src/renderer/App.tsx` |
| MA-10 | 03:55 | 重要 | 遗漏 | 「Workspace.tsx 中 Slide 逻辑迁入 Surface」——Spatial 命中也在其中(:139 import、:934-935 调用),FlowWorkspace 由 Workspace 内部渲染(:131,:1397);Workspace 已是事实上的三 Surface 切换器 | Workspace.tsx:39,41,139,131;934-935;1397 | 改「Slide 与 Spatial 命中/画布逻辑分别迁入对应 Surface;Workspace 保留路由与 FlowWorkspace 挂载」 | 对照下方 B.4 清单 |
| MA-11 | 03:60 | 次要 | 现状滞后 | 「preview rebuild key 不等于 document revision」列为迁移重点——已是现状 | workspaceSlidePreviewRebuild.ts:44-63(基于 id/type/component 版本/sidecarFileIds 的身份 key) | 移入「保留」清单或改守成条款「迁移中不得退化为 revision」 | 读该文件 :44-63 |
| MA-12 | 03:133-136 | 次要 | 现状滞后 | Spatial 相机 session-only 列为迁移重点——已是现状 | spatialAuthoringHistory.ts:43-45;addSpatialCameraFrameFromSession 显式命令 | 同 MA-11 | 读 spatialAuthoringHistory.ts:37-46 |
| MA-13 | 03:143-158 | 次要 | 可操作性 | Workspace 纯路由目标未量化(8 类接线约 20 处引用需迁移);Slide/Spatial 共用 Phaser host、Flow 纯 DOM 的不对称未体现 | 下方 B.4 清单 | §5 补「Slide/Spatial 分支共享 Phaser host 组件,Flow 分支直接挂载 FlowWorkspace」 | 确认 Workspace.tsx:1397 与 :3039 差异有着落 |
| MA-14 | 04:207 | 次要 | 措辞夸张 | 「删除旧 ComponentsTab 巨型接线」——584 行称"巨型"失真(同仓 Workspace 3984 行) | `wc -l src/renderer/ui/ComponentsTab.tsx` = 584 | 改「删除 ComponentsTab 中 catalog/installed/instance 三域混合的接线(584 行)」 | 同左 |
| MA-15 | 04:119-145 | 重要 | 概念映射 | 「代码模式」通篇一等概念,未说明与 DeveloperTab 的升级关系 | editorStore.ts:1343;App.tsx:1645-1648;DeveloperTab.tsx:25-26 | §4 开头加映射注:「代码模式＝professional 模式 DeveloperTab 的独立化/升级」 | `grep -n "EditorMode" store/editorStore.ts` |
| MA-16 | 04:55-77 | 次要 | 遗漏 | 四子域目录未覆盖 executeComponentRuntime.ts(编辑态执行)与 shared/componentPackageLifecycle.ts(跨 packages/instances);player 侧 publishedComponentMount.ts 无归属说明 | 下方 B.5 映射表 | 目录树明确 lifecycle/usage 归属;executeComponentRuntime 归入 authoring/ 或注明属运行时宿主 | 对照 B.5 逐文件找家 |
| MA-17 | 05:102 | 次要 | 事实偏差(措辞) | 禁止「DeveloperTab 维护独立 Runtime 副本」——非字面副本,实为「读 V8 投影、写双路」 | DeveloperTab.tsx:66-85,:175;editorStore.ts:5518-5533(V9)、:5535-5538(V8) | 改「DeveloperTab 读 V8 投影、经 store wrapper 双路写入;迁移后只读 canonical、只走 runtime command」 | 读 DeveloperTab.tsx:160-208、editorStore.ts:5515-5597 |
| MA-18 | 05:107-126 | 次要 | 现状滞后 | 诊断两类未区分已有/新增:硬错误 schema 层已有(id 去重 :471-475、checkInteractionReferences :1285);建议类全新增 | course-project-v9/schema.ts:471-475,:1285 | §5 每类标注现状 | `grep -n "checkInteractionReferences" shared/contracts/course-project-v9/schema.ts` |
| MA-19 | 05:163 | 次要 | 差距量化缺失 | 完成标准「Automation UI 不依赖 Store 内部结构」无可检查口径;现状 16 个直绑订阅 | AutomationTab.tsx:11-51(清单见下方 B.6) | 补口径:「订阅从 16 个降为 facade 的 ≤4 个(selectors+commands 各一入口)」 | 对照 B.6 计数 |

**深挖 B.1:CORE-01~07 逐步现状核对表**(可直接并入 01 篇 §7 作"现状基线"):

| 步骤 | 状态 | 证据 | 真实剩余工作量 |
|---|---|---|---|
| CORE-01 canonical selectors | **部分完成** | selectActiveCourseProjectDocument 已存在(editorStore.ts:9648),保存路径已消费(App.tsx:326-327),store 内部 ~15 处调用;其余 4 个 selector 无匹配 | 小-中:补 4 个 selector;难点在「新代码只用这些入口」的纪律 |
| CORE-02 ActiveEditor union | **未做** | 全仓无 ActiveEditor 类型;身份靠三 session 链推断(:889-897、:9501-9548、App.tsx:1570-1602) | 大:定义 union+旧 session 映射层+逐 Surface 切换;选择状态散在 session.selection 与 selectedNodeIds 两处需收编 |
| CORE-03 统一 transaction facade | **部分完成(仅 Slide)** | runV9DocumentMutation(:3425-3469)被十余处复用;Flow 走 persistFlowResult、Spatial 走 persistSpatialResult、V8 走 commit,四路并行 | 中:推广形状到 Flow/Spatial,纳入 assetChanges/componentChanges(现 V8 已有此概念,store/history.ts:14-20) |
| CORE-04 统一 history | **未做** | 4 套并存(B.2) | 大:先定 patches vs 快照统一形态(MA-03),再迁 3 套快照 |
| CORE-05 sidecar delta | **未做** | :1441-1445 四组快照 + sidecarDirection(:9510,:9538) | 中:需同时覆盖组件包快照与 sidecarDirection(MA-04) |
| CORE-06 移除可写旧 project | **未做,保存侧已脱钩** | 字段仍在(:1406);值由 derivedV8ProjectFromFlow/Spatial 生成;保存已不读它(App.tsx:326);消费者仍多:DeveloperTab.tsx:175、AutomationTab.tsx:18、App.tsx:1685-1692 | 中-大:消费者清点迁移是主体;字段删除是最后一步 |
| CORE-07 移除冗余 sessions | **未做** | 三 session 仍是各自 Surface 写入真相(:1447-1453、:1430) | 大:依赖 CORE-02/03/04,是收官步骤 |

**深挖 B.2:History 精确清单**:

| # | 实现 | 位置 | 形态 |
|---|---|---|---|
| 1 | store HistoryState | store/history.ts:34-37(entry :22-31,pushHistory :44-77) | immer patches + inversePatches + component/asset 显式 delta(V8 路径) |
| 2 | SlideAuthoringHistory | slideEditorCommands.ts:23-27,98-107,110-119(limit=100) | 整 CourseProjectDocument 快照 |
| 3 | SpatialAuthoringHistory | spatialAuthoringHistory.ts:19-23 | 整文档快照 |
| 4 | FlowEditorHistory | flowEditorSlice.ts:53-89 | 整文档快照 |
| 5 | sidecar/组件包撤销栈 | editorStore.ts:1441-1445 | 完整快照数组 |

结论:01 篇 §4 目标形态与 #1 一致且合理,但"现状=patch 基础"的暗示不准确,统一成本被低估(MA-03)。

**深挖 B.3:IPC 现状 vs 目标差异**:现状 32 通道 8 前缀(ipcTypes.ts:112-144):project:×8(目标未提 `peek-archive`,App.tsx:1390-1392 用于恢复决策)、asset:×6(一致)、component:×2 + component-catalog:×4(现状分两个前缀,文档并一组,需裁决)、export:×4(一致)、preview:×1(目标 6 组无 preview,最近于 window 组)、app:×5(与 window 组命名差异)、diagnostics:×2(目标未提 report 上行通道)。App.tsx 42 处 desktopAPI 调用的 hooks 覆盖率 33/42,缺口 9 处集中素材导入与窗口生命周期(MA-08)。

**深挖 B.4:Workspace.tsx(3,984 行)接线点清单**:Phaser 生命周期(import :39;gameRef :1470;挂载 :3039)、Slide 命中(:41;:3577)、Spatial 命中(:139;:934-935)、Slide authoring controller(:47;:1543)、预览 producer(:56-57;:1595,:2036,:2183 等)、rebuild key(:52;:1655)、内容编辑草稿(:43-46;:3408,:3917-3918)、动画预览总线(:40;:1937)、Flow 挂载(:131;:1397)——共 8 类约 20 处引用点。「纯路由」改造需把这些移入 Surface 模块,Workspace 保留路由+Flow 挂载+Phaser host 容器。

**深挖 B.5:组件四子域映射缺口**:Catalog 子域的 Source 抽象不存在(04:156 要求保持简单,方向一致);Installed Packages 子域的 shared/componentPackageLifecycle.ts(usage :173、删除决策 :216、替换计划 :71)跨两域未指定归属;Instances 子域**无统一 commands.ts**——实例命令分散在三个 Surface 命令文件(v9SlideContentCommands.ts、flowSharedAuthoringAdapters.ts、spatialEditorCommands.ts),正是文档 §6 要消除的现状,属实;Authoring 子域的 drafts.ts 无对应(草稿是 DeveloperTab 局部 useState);executeComponentRuntime.ts 无归属;player 侧 publishedComponentMount.ts 仅 §7 文字描述。

**深挖 B.6:AutomationTab 直绑 store 现状基线**(AutomationTab.tsx:11-51,共 16 个订阅):读取 6(selectActiveScene、selectEditingNodes、editingScope、selectedNodeId、activePresentationStateId、**project**——V8 投影字段,CORE-06 必改消费者);场景规则命令 5;全局规则命令 5;UI 命令 3(setActiveTab/setCanvasMode/updateNodes——updateNodes 旁路互动边界)。建议验收口径:16 → ≤4。

## 3.4 20-modules 后半(06–10)——路径级全对,机制级三处实质偏差(7/8/7)

**核验结论**:文件地图 26 行全部真实存在零死链;素材三层结构、五种导出、DOCX 仅 Flow、Player 不依赖 renderer store(grep 零命中)、诊断三类划分与代码接缝对应,均属实。实质偏差:双 producer 遗漏(G-05)、"代码模式"越位(G-07)、文件地图遗漏子树(G-08)。

**问题清单(MB-01~MB-16)**:

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| MB-01 | 06:17 | 重要 | 事实错误 | 素材元数据列表含「content hash」——AssetMeta 无持久化 hash 字段;hash 仅导入时算用于查重,不落盘 | projectTypes.ts:474-484;course-project-v9/schema.ts:987-998(assetMetaSchema 无 hash 且 .strict());assetManager.ts:53,69 | 改「导入时计算的内容 hash(仅用于当次查重,不持久化)」;若要持久化,属 additive optional 合同变更,需单独合同提交(见深挖 C) | `grep -n "contentHash\|sha256" src/shared/projectTypes.ts src/shared/contracts/course-project-v9/schema.ts` |
| MB-02 | 06:116-124 | 次要 | 接口描述失准 | blob registry 接口写 release/releaseAllForDocument;实际为 create/get/has/revoke/revokeAll/dispose,无 document 维度 | blobUrlRegistry.ts:23-73 | 对齐现状命名,或注明 per-document 需新增键约定 | Read blobUrlRegistry.ts 对照签名 |
| MB-03 | 07:6-17 | **关键** | 重大事实遗漏 | §1 唯一生产链图未提双 producer 并存(完整证据链见 G-05 与深挖 A) | App.tsx:1052-1064;buildCoursePackages.ts:291-311;buildExportPayload.ts:211-217;player/payload.ts:147;docs/PUBLISHED_LESSON_V1.md:3,26 | §1 增「现状」段;链条图标注「(目标)」;增 legacy 退役路线(深挖 A 四点) | `grep -n "buildExportPayload\|buildPublishedCourseV2Payload" src/renderer/App.tsx` |
| MB-04 | 07:100-102 | 重要 | 以偏概全 | 「HTML/网页包使用 Published Course V2」只对活动课程会话成立;fallback 仍用 legacy | App.tsx:1105-1122、1053-1064;分派条件 activeCoursePublishSources():129-137 | 补「当前仅活动课程会话走 V2;无会话 fallback 用 V1/ExportPayload,目标为退役该 fallback」 | 同 MB-03 |
| MB-05 | 07:76-94 | 次要 | 现状失准 | 「应通过一个轻量 mount helper 收口」——helper 已存在 | serializedSessionMount.ts:40-74(cancel/幂等 destroy/onReady);Workspace.tsx:777,1339,2105 已使用;generation 跟踪 :1691 | 改「将现有 beginSerializedSessionMount 提升为 preview feature 公共 mount 边界,收敛 Workspace 内联接线;不新增通用状态机库」 | Read serializedSessionMount.ts |
| MB-06 | 08:24 | 重要 | 事实错误 | 诊断运行时机含「代码模式应用」——模式不存在,实为 professional 下 DeveloperTab 的「校验并应用」 | editorStore.ts:1343;DeveloperTab.tsx:63,82,120;App.tsx:1647 | 改「开发者页签应用草稿」或加注「代码模式是目标新增,当前对应 DeveloperTab」 | `grep -n "EditorMode" src/renderer/store/editorStore.ts` |
| MB-07 | 08:53 | 次要 | 目标现状混写 | Export Preflight 列「PDF/PPTX/DOCX 降级」——ExportPreflightTarget 无 docx | exportPreflight.ts:24-28 | 改「PDF/PPTX 降级(DOCX 预检为待补目标)」 | Read exportPreflight.ts target 联合类型 |
| MB-08 | 08:82-92 | 次要 | 目标现状未分界 | 「简单模式不显示'工程检查'概念」——当前简洁模式经「更多」菜单仍可见工程检查入口 | TopToolbar.tsx:244-282(:266-268 aria-label、:277 文案)、:343-347 | 补现状注记「本节为目标展示规则」 | Read TopToolbar.tsx:244-350 |
| MB-09 | 08 全篇 | 重要 | 遗漏 | §6 迁移顺序第 1 步「为当前检查分类」无现状清单;多个现有设施未点名 | diagnosticCodes.ts(105 行,权威码表)、projectDiagnostics.ts(156 行)、assetReferences.ts(452 行)、componentPackageLifecycle.ts(402 行)、teacherControllerConsistency.ts(224 行)、diagnostics/projectHealthNavigation.ts、installRendererDiagnostics.ts、CopyableSummaryDialog.tsx | §1 后插入「现状设施映射表」(可用深挖 D 表) | `ls src/shared \| grep -i "diagnos\|health\|assetRef\|teacherController"` |
| MB-10 | 09:82,:88-98,:111 | 重要 | 现状失准+术语漂移 | 「Code 模式」「简单模式」——模式仅两档;UI 文案是「简洁/专业」 | editorStore.ts:1343;TopToolbar.tsx:122-141 | (a) 全文「简单模式」改「简洁模式」;(b) 代码模式首次出现处加脚注「目标新增第三档;会话级 UI 状态,不持久化(符合 AGENTS.md 不新增持久化 projectMode 红线)」 | `grep -n "简洁" src/renderer/ui/TopToolbar.tsx` |
| MB-11 | 09:137 | — | (佐证项) | 「Properties 不直接调用大量 Store action」诊断成立,附 5 组实例佐证 | PropertiesTab.tsx:784-786,1507-1511,2026-2029,2102-2103,2357-2359,2787-2790,2800;全文件 20+ 订阅点 | 无需改文档;可补「当前 PropertiesTab 直接订阅超过 20 个 store action」 | `grep -n "useEditorStore((state) => state\." src/renderer/ui/PropertiesTab.tsx` |
| MB-12 | 10:25 | 次要 | 归属偏窄 | `phaser/*` 整行归 surfaces/slide/phaser——目录还含 v9SpatialHitAdapter.ts(Spatial 命中) | `ls src/renderer/phaser/`(8 文件) | 拆两行或行内注明「含 Spatial 命中适配,迁移时按 surface 拆分」 | 同左 |
| MB-13 | 10:24 | 次要 | 措辞失真 | 「移除 candidate/V8 语义」——slide*/v9Slide* 文件中 candidate 命中绝大多数是 `.find((candidate) =>` 变量名;真正 candidate 语义在 store 层 | slideEditorCommands.ts:300,304,308,313(变量名);editorStore.ts:430-441,842,852,1072-1079(真语义);v9SlideClipboard.ts:22(唯一 V8 注释残留) | 改「配合 editorStore slideCandidate* 会话退役,清理候选编辑语义」,移到 editorStore 行更贴切 | `grep -n "slideCandidate" src/renderer/store/editorStore.ts` |
| MB-14 | 10:7-35 | **关键** | 重大遗漏 | 表整体遗漏 src/main/*(16 文件)、src/preload/*(2)、renderer/diagnostics/*(2)、renderer/authoring/*(12)、shared/contracts/*(8 子目录)、styles/*(2) | 逐目录 `ls` 实测 | 补 6 行(归属建议见深挖 B);contracts 一行注明「整体保留不迁移」 | 逐目录对照表行 |
| MB-15 | 10:28 | **关键** | 关键决策缺失 | export 行未标注双 producer 并存这一该目录最重要迁移决策点 | buildExportPayload.ts(291 行)+buildPublishedLesson.ts 为 legacy;course/buildPublishedCourse.ts + buildCoursePackages.ts 为 V2 | 迁移方式改「producer 与格式 adapter 分开;legacy 随 V2 全量接管后退役(顺序见 07 篇补写)」 | `ls src/renderer/export src/renderer/export/course` |
| MB-16 | 10:3,:43 | 重要 | 依赖不存在设施 | 「路径变化后由 MAP-01 和索引生成器更新」「每次移动后更新 repo-index」——repo-index/ 与生成器均不存在 | `ls repo-index` 不存在;scripts/ 15 脚本无索引生成器;全仓仅认知索引 :14,32,110 提及(且其引用本身悬空) | 前置新任务「建立 repo-index/ 与索引生成脚本」,并把修复认知索引悬空引用列为同任务验收项 | `ls repo-index`;`grep -rn "repo-index" --include="*.md" .` |

**深挖 A:双 producer 完整证据链**(G-05 事实基础):

- Legacy producer:`export/buildExportPayload.ts:211-217`(入参 ProjectDocument+assets+components,:38-48)+ `buildPublishedLesson.ts`(buildPublishedLessonPayload,:207);产物 `ExportPayload`/`PublishedLessonPayload`(shared/publishedLessonTypes.ts)。
- V2 producer:`export/course/buildPublishedCourse.ts` buildPublishedCourseV2Payload(:534);打包器 buildCoursePackages.ts:291-311(buildPublishedCourseStandaloneHtml 内嵌 V2 payload+playerBundle)、:384-399 分发。
- 五种导出分派(行号):single-html App.tsx:1053-1055(V2)/:1057-1064(legacy);web-package :1111-1112/:1113-1118;pptx :1139-1140/:1158-1163;pdf :1183-1195(V2 经主进程 pdfExport.ts 打印 .page DOM)/:1225-1231(legacy 栅格化);docx :1239-1261(仅 V2 仅 Flow,无会话直接 throw :1242-1243)。
- Player 侧:legacy=payload.ts:34-35,147 + publishedLesson.ts:16 + global.d.ts:12-14(`__H5_LESSON_PAYLOAD__`);V2=surfaces/CoursePlayer.ts + publishedDynamicHosts.ts:54,63,93,102,200,280-285 + publishedCoursePresenter.ts:1,24。
- 仓库文档矛盾:PUBLISHED_LESSON_V1.md:3 称 V1 经 V2 producer 编译产生,代码并非如此(二者必改其一);:26 把 legacy 轨定位为「PDF/PPTX 内部捕获链路」。
- 07 篇需补写四点:① §1 现状段(双轨+分派条件+fallback 时机,含 candidate 预览态);② 修正或标注 PUBLISHED_LESSON_V1.md:3 矛盾;③ legacy 退役路线(消费方清单:buildPptx、renderProjectSceneImagesWithRuntime/playerCapture、buildStandaloneHtml、buildWebPackage、payload.ts:147 联合类型与 publishedLessonToExportPayload;删除顺序=消费者归零再删);④ Player 双入口(PlayerApp legacy / CoursePlayer V2)合一计划;⑤ §7 预检补 docx target。

**深挖 B:文件地图遗漏子树归属建议**(MB-14 明细):

- `src/main/`(16):index/createWindow/appState/applicationIdentity/windowVisibility/security/errors→02 App Shell;protocols→02+06;ipc→02 IPC;fileDialogs→02+07;projectPersistence→02;previewWindow→07;pdfExport→07;diagnosticLog→08;componentCatalogManager/Scanner→04。
- `src/preload/`(2):index.ts、desktop-api.d.ts→02(桥接层)。
- `src/renderer/diagnostics/`(2):projectHealthNavigation→08(问题定位路由,ProjectHealthPanel.tsx:17 消费);installRendererDiagnostics→08(renderer 错误上报主进程)。
- `src/renderer/authoring/`(12):authoringReadiness/courseAuthoringScope/courseAuthoringSession→01 Core;stageViewportTransform→01 或 surfaces 共享;componentTextEditSession→04;runtimeTargetEditSession/runtimeAuthoringContext→05;flowOverlayAuthoring/flowTextEdit→surfaces/flow;spatialWorldAuthoring→surfaces/spatial;v9SlideContentEdit/v9TeacherControllerAuthoring→surfaces/slide。
- `src/shared/contracts/`(8 子目录+index.ts):整体保留不迁移;additive 变更走单独合同提交(AGENTS.md 软冻结)。
- `src/renderer/styles/`(2):globals.css、variables.css→随 Feature 迁移逐步拆分(09 §7)。

**深挖 C:AssetMeta hash 影响面**(MB-01):AssetMeta 在 persisted schema 内(course-project-v9/schema.ts:1184 `assets: z.record(z.string(), assetMetaSchema)`,:998 .strict())。按 AGENTS.md 软冻结,加 `contentHash: z.string().optional()` 属 additive optional、政策可行,但因 .strict(),含新键的工程在旧版编辑器校验会失败(AGENTS.md 已声明不承诺旧编辑器打开含新键的课)。建议:优先改文档描述现状;仅当出现跨会话查重/增量同步需求时才走 additive 字段+合同提交。

**深挖 D:08 三类诊断与现有文件映射**:A 结构完整性=projectHealth.ts(1,216 行)+diagnosticCodes.ts(105 行权威码表)+assetReferences.ts(452)+componentPackageLifecycle.ts(402)+teacherControllerConsistency.ts(224)+projectDiagnostics.ts(156,视频互动专项)+courseProjectSchema 校验+CLI scripts/validate-project.ts(package.json:30);B 作者分析=informationRelease.ts(213)+visualDensity.ts(141),两者同时被 exportPreflight.ts:9 复用;C 导出预检=exportPreflight.ts(无 docx target)+buildCoursePackages.ts collectCoursePackageExportPreflight+exportSize.ts+两个 Dialog;展示/定位层(文档完全未提)=projectHealthNavigation.ts+installRendererDiagnostics.ts+CopyableSummaryDialog.tsx。注意:validate-project.ts 当前反向 import `src/renderer/export/*`,08 篇提出的 shared/validation 下沉确有必要。

## 3.5 30-execution(4 篇)——技术逻辑正确,治理衔接崩盘(8/7/3)

**核验结论**:阶段顺序符合稳妥重构逻辑;工作包着手对象真实,甚至发现方案未点名的佐证(migrateProjectV8ToCourseProjectV9 仍被 loadProject 调用而 main 侧已拒非 V9——空转死代码,courseProjectModel.ts:1128、editorStore.ts:4252、projectPersistence.ts:97-99);V9 软冻结、不建 V10、不恢复 V8 导入等红线全部遵守。**但治理衔接仅 3/10(G-01)**。

**问题清单(EX-01~EX-21)**:

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| EX-01 | 00:19-24 | 重要 | 依赖遗漏 | 依赖图缺 DOC-01 节点;DOC-01 验证依赖 IDX-02/03 产出 | 02:9-21 图无 DOC 节点 | 图补 BSL/MAP→IDX→DOC-01(DOC-01 路径校验须在 IDX-03 后) | 工作包 ID 与图节点做差集 |
| EX-02 | 00:200-208;01:502 | **关键** | 治理冲突 | P6 退出条件「人工核心流程可用」/FINAL-03 与教师 accepted 门禁无对接;zip 全包 grep `accepted\|教师验收` 仅命中 ADR 模板状态枚举 | COURSEWARE_DEVELOPMENT_PLAN.md:116,183,197(五处重复 accepted 门禁) | P6 退出条件追加「本验收不替代教师 accepted;若 P0 启动时 1.0 未获 accepted,全部 P0–P6 在独立分支进行,不得移动待验收基线」 | `grep -rn "accepted\|教师" 方案包/` 应命中正文而非仅模板 |
| EX-03 | 00:216;01:25 | 重要 | 衔接缺口 | 「P0 开始一次基线完整 verify」与现行验证防火墙冲突未声明 | 00_INDEX.md:143、02_WORKER.md:41-42 禁止中间任务跑 verify 等;npm run verify 真实存在(package.json:35) | 路线图注明「自 P0 起 editor-1.0 验证防火墙对 refactor/* 分支不再适用,适用 40-development/02」,明确新旧纪律边界 | 对照两文本确认无双重约束状态 |
| EX-04 | 00:129 | 次要 | 格式 | 「-旧投影不可写」缺空格,Markdown 列表断裂 | — | 改 `- 旧投影不可写` | markdownlint |
| EX-05 | 01:137;00:28-29 | 重要 | 验证不可执行 | DOC-01 验证 `repo:index:check`、P0 退出条件 `repo:index`/`repo:context`——scripts 不存在 | package.json grep 零命中;无 repo-index/ 目录 | IDX-02「允许」清单列死新增键名(repo:index、repo:index:check、repo:context);DOC-01 验证排在 IDX-02 合入后 | `node -e "console.log(Object.keys(require('./package.json').scripts))"` |
| EX-06 | 01:125-138 | **关键** | 治理冲突 | DOC-01 重写 AGENTS.md/替换认知索引,未声明现行约束迁落地(完整原文见 G-01) | AGENTS.md:12 承载唯一计划/V9 软冻结/accepted 门禁;:3-4 承载 Skill 路由 | DOC-01 验收口径:「重写后 AGENTS.md 必须原样保留唯一计划链接与地位句、V9 软冻结句、accepted 门禁句、Skill 路由两条;唯一计划总纲地位不变」 | 重写前后 diff AGENTS.md 逐句核对 |
| EX-07 | 01:3 | 次要 | 衔接缺口 | 任务卡模板在 zip 内、未入仓,编码 AI 无仓内模板可复制 | 50-templates/ 仅存在于 zip;docs/tasks/ 下无模板 | P0 增「模板入仓」步骤(docs/tasks/ 或 repo-index/templates/) | `ls docs/tasks/ \| grep -i template` |
| EX-08 | 01:261-264 | 重要 | 与现存设施重叠 | DIAG-02「纯校验拆分复用到 CLI」——validate-project.ts 已存在且已共享纯函数 | scripts/validate-project.ts;package.json:30;shared/projectHealth.ts 已是 shared 层(App.tsx:24) | DIAG-02 写明「以 validate-project.ts 为现存 CLI 入口扩展,不新建第二套 CLI」 | 读 validate-project.ts 输入面 |
| EX-09 | 01:73-92 | 次要 | 与现存设施重叠 | IDX-02 未声明复用现有 generate+check 双命令模式 | package.json:26-28;generate-ai-capabilities.ts、generate-contracts.ts | IDX-02 约束「沿用 generate:*/check:* 双命令与快照模式」 | 对比三份 generate 脚本约定 |
| EX-10 | 01:333-335 vs :508-515 | 重要 | 内部矛盾 | CORE-06 一卡要统一 document patch+asset delta+component delta,必超「1-8 个主要源码文件」上限 | 必触及 editorStore.ts:942-943,7065-7066,1440-1444 及测试 | 预拆 CORE-06a(document patch)/06b(asset delta)/06c(component delta) | 派卡前 `git diff --stat` 试算 |
| EX-11 | 01:348-350 | 重要 | 依赖遗漏 | MEDIA-01(sidecar 收口)依赖 CORE-06 未声明;02 图无 MEDIA 节点 | editorStore.ts:1440-1441 注释「Undo/redo restores this with session history」 | 卡内加 depends_on: CORE-06;图补 MEDIA 节点挂 CORE 下 | 对照两文档 |
| EX-12 | 01 全文 | 重要 | 依赖遗漏 | 全部 74 个工作包卡无 depends_on 字段(如 COMP-03 跨三 Surface 未声明边) | placement command 分散于 slideEditorCommands.ts、flowEditorCommands.ts、spatialCameraCommands.ts | 模板加强制字段 depends_on/touches_modules | 逐卡核对涉及文件所属模块与图边集 |
| EX-13 | 02:9-21 | 重要 | 依赖遗漏 | 依赖图缺 7 个节点:DOC-01、TESTMAP-01、UI-01、STYLE-01、MEDIA-01、WORKSPACE-01、PROPS-01 | 01 文档实有 74 个工作包(P0=7、P1=8、P2=9、P3=8、P4=14、P5=14、P6=14) | 补节点及边:DOC→IDX;TESTMAP→IDX+MAP;UI/STYLE 挂 APP/DIAG 旁;MEDIA→CORE;WORKSPACE/PROPS 挂三 Surface 汇合点 | ID 差集对照 |
| EX-14 | 02:9-21 | 重要 | 依赖遗漏 | 遗漏边(系统检查):RUN-03→PLAYER/EXPORT;COMP-03→三 Surface;INT-01..03→SLIDE;APP-02→PLAY-02(返工边);EXPORT-03→DIAG;FLOW-04→EXPORT;DOC-01→IDX-02/03;MEDIA-01→CORE-06;TESTMAP-01→IDX-02 | 逐条证据见下方清单 | 逐条补边 | 同下 |
| EX-15 | 02:76-84 | 次要 | 事实漂移 | 热点清单列 courseProjectTypes.ts/courseProjectSchema.ts——两文件现仅 1 行 re-export(T1-A 已迁合同源至 contracts/**) | `wc -l` 两文件=1 行;00_INDEX.md:43,54;真正热点是 contracts/course-project-v9/**;其余 5 热点属实(editorStore 9,681 行、Workspace 3,984、PropertiesTab 3,114、App 1,895、buildPublishedCourse.ts 592) | 热点行改 `src/shared/contracts/course-project-v9/**` | `wc -l src/shared/courseProjectTypes.ts src/shared/courseProjectSchema.ts` |
| EX-16 | 02:123 | 次要 | 衔接缺口 | 「小工作包在阶段分支上小提交;多 Agent 并行再用 worktree」与现行协议不一致 | 02_WORKER.md:15 对单人第三方工人即强制 isolated worktree | 写明「P0 起 refactor/* 阶段分支取代 cursor/<task> 模式」或保持 worktree 强制不变 | 对照两文本 |
| EX-17 | 03:11 | 次要 | 事实漂移(部分) | L0 举例「candidate、V8 backend 等已不反映真实架构的名称」——candidate 属实(slideCandidate* 在 editorStore 出现 136 次);V8 backend 已零命中(T3 已收口) | `grep -rni "v8backend\|v8 backend" src` = 0;00_INDEX.md:133 | 删「V8 backend」,保留 candidate 并点名 slideCandidate* 字段块 | 同左 |
| EX-18 | 03:64-74 | 重要 | 门槛遗漏 | 删除七问缺「恢复副本/保存时 session 冲刷」一问(深挖证据见下) | RecoveryWriteCoordinator(recoveryWriteCoordinator.ts:25-127);App.tsx:334-338 快照仅 {project,assetFiles,componentFiles};markSaved 内 persistOpenSpatialContentEdit 冲刷(editorStore.ts:4256-4261);**全仓无 zustand persist 中间件** | 七问增第八问:「是否影响恢复副本快照字段与保存时 session→document 冲刷路径?」 | grep RecoverySnapshot 字段;读 markSaved/loadCourseProject;确认无 persist 中间件 |
| EX-19 | 03:41-49 vs 01:492 | 次要 | 具体性不足 | L3 现成候选未点名:migrateProjectV8ToCourseProjectV9 空转死路径(全仓仅 editorStore.ts:4252 一处调用) | courseProjectModel.ts:1128;projectPersistence.ts:97-99 已拒非 V9 | CLEAN-03 示例对象列入该函数及调用点 | `grep -rn "migrateProjectV8ToCourseProjectV9" src` |
| EX-20 | 03:51-60,:89 | **关键** | 治理冲突 | L4 把 editor-1.0 划为可清理,未给「唯一计划先修订交接」前置条件 | AGENTS.md:12;02_WORKER.md:9「权威看板:00_INDEX.md 合入状态」 | L4 增门禁:「COURSEWARE_DEVELOPMENT_PLAN.md 修订为指向新体系、教师 accepted 状态不受影响之后,方可清理 editor-1.0」 | 清理 PR 检查唯一计划是否同批修订 |
| EX-21 | 03:87 | 重要 | 遗漏 | 推荐顺序第 7 项「旧测试夹具」可能误伤 T0 合同门禁夹具;「不应删除」清单未覆盖 | tests/fixtures/course-project-v9/*.h5lesson 是 T0 round-trip 门禁资产(00_INDEX.md:28) | 「不应删除」补「现行 Schema 合同夹具与快照(tests/fixtures/course-project-v9/**、artifacts/contracts/**)」 | `ls tests/fixtures/course-project-v9/` 对照清理清单 |

**EX-14 遗漏边逐条证据**:
1. RUN-03→PLAYER/EXPORT:01:412「作者数据只经 Published producer 进入 Host」直接摸 src/player/ 宿主。
2. COMP-03→SLIDE/FLOW/SPATIAL:三 Surface placement command 分散于 course/slideEditorCommands.ts、flowEditorCommands.ts、spatialCameraCommands.ts;COMP-03(P4)改的文件正是 P5 要迁移的文件,并行必撞车。
3. INT-01..03→SLIDE:互动规则命令实际位于 course/slideInteractionCommands.ts。
4. APP-02→PLAY-02(返工边):preview mount 现位于 App.tsx:404-409(coursePreviewSessionRef/coursePreviewMountChainRef),P2 提取一次、P6 再改一次。
5. EXPORT-03→DIAG:preflight 分层(01:486)消费诊断分层产出;现状 exportPreflightReport 与 projectHealth 同在 App.tsx:24/:412-413 接线。
6. FLOW-04→EXPORT:「Flow export 与 authoring 共用模型」(01:456)直接改导出链。
7. DOC-01→IDX-02/03、MEDIA-01→CORE-06、TESTMAP-01→IDX-02+MAP-01:见 EX-05/11/13。

**EX-18 深挖:序列化边界事实**:无 zustand persist 中间件(`grep "from 'zustand/middleware'" src` 零命中;editorStore.ts:9137 的 persist( 是业务函数 persistGlobalLayerScenePlane)——store 字段增删**没有磁盘持久化边界**;恢复链=RecoveryWriteCoordinator(去抖 1800ms,App.tsx:346)→快照仅 {project(V9 canonical), assetFiles, componentFiles}(App.tsx:334-338)→saveCourseProjectDocumentAsync 压缩→desktopAPI.writeRecoveryProject 落盘;session/history 字段不进恢复副本,故 CLEAN-02 不直接触磁盘格式。**真正风险点**:markSaved 先调 persistOpenSpatialContentEdit() 把 live session 写回 canonical 再落盘(editorStore.ts:4256-4261),CORE-07/CLEAN-02 若改 session 生命周期而不动这段 flush 时序,会造成「编辑内容在保存时丢失」。

**教师验收时序事实补强(EX-02)**:Q1–Q8 修复已合入但未获 accepted(计划 :205「当前剩余是教师视觉复核与 accepted」;00_INDEX.md:57-70 列「已合入 main—禁止重做 Q1–Q8」);accepted 门禁在计划 :9,:10,:20,:114,:116,:183,:197,:275-278 共 8 处重复;方案基线 2026-08-21 晚于计划 12.10(2026-08-19),即方案制定时 1.0 仍处未 accepted 状态。后果:若按方案从 P0 立即开工,P3 起改写 editorStore/Workspace 等待验收基线文件,教师复核的将是移动目标;FINAL-03 自设验收与教师 accepted 无对接。

**74 工作包总表**(标记:⚠=依赖未声明;♻=与现存设施重叠;✖=验证引用不存在脚本;🔥=触及热点需串行):

- P0(7):BSL-01 行为基线(⚠EX-03)/MAP-01 Feature Matrix(⚠依赖 IDX-01 未声明)/IDX-01 repo-index 骨架/IDX-02 AST 生成器(♻EX-09,产出 package scripts)/IDX-03 语义关联+路径校验/IDX-04 Context Pack 查询器/DOC-01 文档收口(⚠✖🔥,EX-05/06,治理高风险)。
- P1(8):BOUND-01 边界棘轮;FAC-01~06 六类 facade;TESTMAP-01(⚠依赖 IDX-02+MAP-01 未声明)。
- P2(9):APP-01(🔥App.tsx)/APP-02(🔥⚠与 PLAY-02 返工边)/APP-03(🔥);DIAG-01/DIAG-02(♻EX-08)/DIAG-03(🔥);COMP-01;UI-01(🔥TopToolbar/RightSidebar);STYLE-01(⚠图中无节点)。
- P3(8):CORE-01(🔥)/02(🔥)/03(🔥串行)/04(🔥)/05(🔥)/06(⚠EX-10 超规模)/07(🔥串行);MEDIA-01(⚠EX-11)。
- P4(14):MODE-01..03;COMP-02/COMP-03(⚠EX-14)/COMP-04/COMP-05;RUN-01/RUN-02/RUN-03(⚠);INT-01/INT-02/INT-03(⚠);DIAG-04。
- P5(14):SLIDE-01..04(🔥;SLIDE-03 受 WORKER:61「Phaser 只服务 Slide 编辑」约束;SLIDE-04→CORE-07);FLOW-01..04(⚠FLOW-04→EXPORT);SPATIAL-01..04;WORKSPACE-01(🔥3,984 行);PROPS-01(🔥3,114 行)。
- P6(14):PLAY-01..03(⚠PLAY-02 返工边);EXPORT-01..03(⚠EXPORT-03→DIAG);CLEAN-01..05(⚠EX-19/20/21 门禁缺失);FINAL-01..03(⚠EX-02 不替代教师 accepted)。

## 3.6 40-development / 50-templates / 90-appendix(11 篇)——方向务实但双套协议与概念悬空(6/7/7)

**问题清单(DV-01~DV-31)**(类型图例:悬空=依赖不存在设施;冲突=与现行约定矛盾;重复=与现有文档重叠;表述=措辞/范围;超前=把规划能力写成现状约束):

| ID | 位置 | 严重度 | 类型 | 摘引/说明 | 证据 | 修改建议 | 复核方法 |
|---|---|---|---|---|---|---|---|
| DV-01 | 40/00:30 | **关键** | 悬空 | 「`npm run repo:context -- "<任务描述>"`」是流程核心命令但不存在 | package.json:9-57 无 repo:*;scripts/ 14 文件无对应物 | 改「(依赖 10-knowledge-system 建成后可用;建成前降级为:Grep 定位符号 + Read 目标文件 + 读对应 tests/unit)」 | `grep -n "repo:" package.json` 应为空 |
| DV-02 | 40/00:11-18,146 | 重要 | 悬空 | 闭环图第 2、7 步(生成 Context Pack/更新索引)依赖 repo-index | 无 repo-index/ 目录 | 闭环图加注「第 2、7 步在 repo-index 建成前跳过」 | 检查仓库根 repo-index/ |
| DV-03 | 40/00:122-128 | 次要 | 表述 | commit 前缀约定 refactor(index): 等与现仓库风格不符 | git log 现风格为 `merge: G2C-TC …`、`checkpoint …` | 声明「自本方案生效起新提交采用 type(scope) 前缀,历史不回溯」 | `git log --oneline -20` 对比 |
| DV-04 | 40/01:17-36 | 重要 | 重复 | 15 个必填字段与现行任务卡字段标准并存(现卡无 Baseline SHA/Index impact) | 02_WORKER.md 全文;G2C_TOOLBAR_FONT.md、G2A_ADDITIVE_SCHEMA.md | 字段清单迁入 01_SHARED.md 作任务卡规范,分「必填/重卡才填」两档 | 抽查 3 张 docs/tasks 卡 |
| DV-05 | 40/01:92 | **关键** | 超前 | 「simple/professional/code 哪些模式可见」——code 模式不存在 | editorStore.ts:1343 | 改「simple/professional;(code 建成前此栏填 N/A)」 | grep EditorMode 类型联合 |
| DV-06 | 40/01:56-68 | 重要 | 表述 | 热点文件「可逐符号改」与 WORKER:63「不拆整个 editorStore.ts/Workspace.tsx」的兼容关系未说明 | 两文本对照 | 补「逐符号修改 ≠ 整体拆分;WORKER 禁令优先」 | 对比热点条款 |
| DV-07 | 40/01:112 | 重要 | 表述 | 「本轮默认不做 Schema 任务」——「本轮」未定义;仓库已有 additive Schema 卡先例 | G2A_ADDITIVE_SCHEMA.md:6(合同变化:是,已合入) | 改「本方案重构期(P0–P6)默认不做;历史 G2A 式 additive 合同提交不受此限」 | 读 G2A 卡 |
| DV-08 | 40/01:116-127 | 次要 | 重复(部分互补) | finding 四字段 vs WORKER§5 只管「停」不管「记」 | WORKER:68-74 | finding 格式并入 WORKER§5 作停手后 HANDOFF 固定小节 | 见 2.1 表 |
| DV-09 | 40/02:59 | **关键** | 悬空 | 「路径检查 + repo:index:check」命令不存在 | 同 DV-01 | 同 DV-01 降级写法 | 同 DV-01 |
| DV-10 | 40/02:97 | 重要 | 悬空 | 「boundary report」不存在 | package.json/scripts/ 无 boundary 类命令 | 标注「P1 交付物,建成前跳过」 | `ls scripts/` |
| DV-11 | 40/02:28 | 重要 | 表述 | 「或 1 个目标 E2E」——E2E 最小单位是 spec 文件(仅 3 个),且 pretest:e2e 先全量构建 | tests/e2e 仅 editor/componentCatalogMatrix/render-host-benchmark 3 个 spec;package.json:18 | 改「或 1 个目标 E2E spec(需已有构建产物;无产物时先 build:desktop + fixtures)」 | `ls tests/e2e`、读 package.json:18 |
| DV-12 | 40/02:36-41 vs WORKER:37-54 | 重要 | 冲突(宽窄) | V2 阶段级 typecheck/build:desktop 与 WORKER 默认禁止的兼容靠角色划分,方案未写 | WORKER:41-42,48,54 | 写明「任务级验证遵从 WORKER 防火墙;V2/V3 仅由阶段整合者执行,不下放工人」 | 见 2.2 量化表 |
| DV-13 | 40/02:34,45,86-132 | 重要 | 冲突(命名) | 方案 P0–P6 与唯一计划历史车道 P1–P8 撞名 | COURSEWARE_DEVELOPMENT_PLAN.md:129-131(P8 已合入) | 阶段改名 R0–R6 或「阶段 A–G」,README 顶部声明与历史 P 车道无关 | 对比两阶段表 |
| DV-14 | 40/02:136-141 | — | (核对通过) | 「不通过提高 retries 掩盖 flaky」与现状一致 | playwright.config.ts 无 retries 配置 | 无需修改 | `grep retries playwright.config.ts` |
| DV-15 | 40/03:62-76 | 重要 | 重复 | Handoff 11 字段 vs WORKER:78-87 八字段,各有独有字段,未裁定唯一 | WORKER 独有「允许列表外改动」「未验证(交给 T6)」「停下来的原因」 | 合并为唯一 14 字段模板;WORKER§6 改为引用 | 见 2.3 表 |
| DV-16 | 40/03:39-43,83 | 重要 | 悬空(概念) | 「facade」全文使用但仓库无此概念与 features/ 目录 | `grep -i facade src` 零命中;renderer 现有子目录无 features/ | 首次使用前定义「Facade = 目标目录的 index.ts 窄出口」并给仓库内示例 | 同左 |
| DV-17 | 50/ADR_TEMPLATE 全文 | 次要 | 超前 | 仓库无 ADR 目录与先例 | docs/ 仅 contracts/reviews/tasks | 指定存放处(建议 docs/adr/)并声明「仅跨 Feature 或改合同的决定才写 ADR」 | `ls docs/` |
| DV-18 | 50/FEATURE_MANIFEST:3 | **关键** | 悬空 | 整模板依附 `repo-index/semantic/features.json`(不存在) | 同 DV-02 | 整模板标注「repo-index 建成后启用」 | 同 DV-02 |
| DV-19 | 50/FEATURE_MANIFEST:16;50/TASK_CARD:44-53 | **关键** | 超前 | modes 含 code、模式矩阵有 code 行 | editorStore.ts:1343 | 同 DV-05;模板 code 行加「(规划)」 | 同 DV-05 |
| DV-20 | 50/FEATURE_MANIFEST:18-19 | 重要 | 超前 | 示例路径 `src/renderer/features/<feature>/index.ts` 不存在 | `ls src/renderer`(无 features/) | 示例改现状真实入口或标注「目标结构」 | 同左 |
| DV-21 | 50/TASK_CARD:3-6,94-96;50/HANDOFF:36-37 | **关键** | 悬空 | 「Index status」「索引影响」「Generated HEAD」字段依赖不存在设施 | 同 DV-02 | 统一标注「repo-index 建成前填 none」 | 同 DV-02 |
| DV-22 | 50/TASK_CARD 全文 | 重要 | 表述(体量) | 13 节 108 行模板对单人小任务过重 | 真实卡 G2C_TOOLBAR_FONT.md 仅 49 行完成已合入任务 | 拆轻卡(≤一句话/允许/禁止/逐步/最小验证)与重卡(迁移型/Schema 型填全 13 节)两档 | 对比两卡行数与字段命中(2.3) |
| DV-23 | 90/00:18,30-34,53,69 | **关键** | 超前 | 不变量 #10、#16-20、#33、#43 共 7 条引用不存在的「代码模式」 | editorStore.ts:1343;code 模式仅存在于 00-foundation/04:130 规划 | 统一加前缀「(code 模式建成后生效;当前约束对象为 simple/professional 与 DeveloperTab)」 | grep EditorMode 定义 |
| DV-24 | 90/00:25 | 重要 | 超前 | #14「Document patch 与 binary delta 同事务」——binary delta 无对应物 | `grep -i binarydelta src` 零命中;现状见 tests/unit/assetTransactions.test.ts | 标注「binary delta 为规划实现;当前等价约束:文档 patch 与 sidecar 引用变更同事务」 | 同左 |
| DV-25 | 90/00:73-79 | 重要 | 超前 | #45-50 Knowledge System 六条约束对象全部待建;#45 已有现行等价物 | WORKER:5「与源码冲突时以源码为准」 | 整节加「自 repo-index 建成起生效」;#45 注明现行等价 | 同 DV-02 |
| DV-26 | 90/00:58 | 重要 | 表述(半成立) | #35「Try-run 与 Full Preview 共用 Published producer」——V2 链成立但 legacy V1 链仍在服役 | 共用证据:coursePlayerTryRun.ts:46、flowLocationTryRun.ts:18、spatialLocationTryRun.ts:22;legacy 证据:buildPublishedLesson.ts:207 被 buildStandaloneHtml.ts:136、buildWebPackage.ts:327,481 调用 | 改写「Course 试运行/预览/课程导出共用 buildPublishedCourseV2Payload;legacy V1 链列入 legacy 清单并定义删除条件」 | grep buildPublishedLessonPayload src |
| DV-27 | 90/01:8 | 重要 | 超前 | 风险「Code 模式旁路」对象不存在;DeveloperTab 才是现实现象 | editorStore.ts:1343;App.tsx:1647 | 风险名改「DeveloperTab/未来代码模式旁路」;发生方式补「现状 DeveloperTab 写入路径是否已全部走 command 需先盘点」 | 读 DeveloperTab.tsx 的 store 调用 |
| DV-28 | 90/01:5-22 | **关键** | 遗漏 | 18 条风险漏 6 条(补全文本见 2.5) | 见 2.5 | 补 R-A~R-F | 对照 2.5 |
| DV-29 | 90/02:5-25 | 重要 | 表述 | 术语表实际 21 行(非 22),约 1/4 为规划词且无状态标注 | 见 2.6 全表 | 加「状态」列(现状/规划/部分),格式见 2.6 | 按 2.6 逐词 grep |
| DV-30 | 90/02:19 | 重要 | 冲突(与现状) | 「Published Producer…唯一转换链」——「唯一」不成立 | DV-26 双链证据 | 改「…V2 的转换链(buildPublishedCourseV2Payload);旧单课另有 legacy V1 链(buildPublishedLessonPayload),待定义删除条件」 | 同 DV-26 |
| DV-31 | 90/02:7,10,12,20-22 | 重要 | 超前 | ActiveEditor/Facade/Binary Delta/Context Pack/Semantic Index/Generated Graph 六词仓库无对应物 | grep ActiveEditor/-i facade/binaryDelta src 均零命中 | 由 DV-29 状态列解决,不必删词 | 同 DV-29 |

**深挖 2.1:任务协议 ↔ 02_WORKER.md 逐节对照结论**:协议§1(结果导向)、§6(行为型检查单)为 WORKER 无的新增价值;§2(15 字段)有重复风险,应进 01_SHARED.md 并分两档;§3(三态防火墙)比 WORKER 两态更细,建议把 Read-only 中间态并入 WORKER§2;§4(热点符号)与 WORKER:63 有张力(DV-06);§5(迁移五要素,「删除条件」概念 WORKER 没有,价值高)建议并入;§7(Schema)双方一致,协议的四说明(默认值/旧工程/旧编辑器/fixtures)可并入 WORKER§4 作 additive 检查单;§8(finding 格式)并入 WORKER§5。WORKER 独有 §0 禁止重做/§1 worktree/§3 验证防火墙/§6 HANDOFF。**总结论:两者定位不同(WORKER=执行纪律,协议=任务设计规范),应归并到 01_SHARED.md / WORKER 对应节,而非第三份协议并存。**

**深挖 2.2:验证策略 ↔ package.json 映射**:V0 git diff --check(✅);V0「目标文件 TS 编译」→ 只有全量 typecheck(分钟级,与「目标文件」语义有差距);V1 vitest 1-3 个(✅,tests/unit 196 个文件);V1 E2E(⚠️ 仅 3 spec 可选,pretest:e2e 全量构建冷启动成本高);V1 索引生成器测试(❌ 待建);V2 typecheck/相关测试/build:desktop(✅ 分钟级);repo:index:check(❌ DV-09);boundary report(❌ DV-10);V3 npm run verify(✅ package.json:35,数十分钟级);verify:release(✅ :55)。与 WORKER 防火墙差异:E2E/typecheck/build 三项方案更宽,**限定给阶段整合者即可兼容**;WORKER:49「每 commit 最多跑一次收口验证」方案缺,建议吸收。

**深挖 2.3:模板 ↔ 真实任务卡字段映射**(样本 G2C_TOOLBAR_FONT.md 49 行、G2A_ADDITIVE_SCHEMA.md 105 行):一致的有一句话目标、防火墙两态、逐步算法、最小验证;模板有而现卡无的(Baseline SHA、Feature id、Index status、模式×Surface 矩阵、§11-13)多数依赖不存在设施;**现卡有而模板无、建议吸收的五项**:「工人先读」链接、Read 次数上限(:29「全程最多 8 次 Read」)、Git 分支命名约定、「合同变化:是/否」行、「状态:可领取/已合入」行。HANDOFF 合并建议:以 03_DONE 11 字段为骨架补 WORKER 三字段,合一为 14 字段。

**深挖 2.4:50 条全局不变量三态统计**(逐条证据表略,要点):✅ 现状已成立 26 条(#1-9、#13、#15、#18、#21-22、#25-31、#34、#36-42 等,证据如 AGENTS.md 各条款、authoringAddress.ts:55、spatialWorldAuthoring.ts:201、player 独立构建、diagnosticCodes.ts 等);🔵 规划目标 14 条(#11-12、#14、#19-20 部分、#23-24、#32、#44-50);⚠️ 冲突/需修正 10 条——其中引用「代码模式」7 条(#10、#16、#17、#19、#20、#33、#43),#35 双 producer 半成立,#23/#24 属「现状不成立的重构目标」口径(Workspace.tsx 现状有 20 处 sidecar 引用,远超「只路由」)。建议文档把 🔵/⚠️ 条目标注「目标态」,与「护栏现状」分节。

**深挖 2.5:风险登记册 18 条评注 + 应补 6 条**(可直接补入的文本):

- 18 条逐条评注:全部技术风险诊断准确;注意 :19「Published producer 分叉」**不是风险而是现状**(双链已在运行),应升级为「现存 legacy:定义 V1 链删除条件」;:15「历史文档污染」有现实实例——WORKER:41 引用 `npm run verify:full`,但 package.json 无此 script(仅 logs/z1-verify-full.log 留存);:7/:10 的控制措施依赖待建设施,应标依赖。
- 建议补入的 6 条:

| 编号 | 风险 | 发生方式 | 影响 | 控制 |
|---|---|---|---|---|
| R-A | 计划权威冲突 | 方案 P0–P6 与唯一计划并存;P 编号与历史车道 P1–P8 撞名(PLAN:129-131) | AI 工人误领已合入任务、按错误优先级施工 | README 与 AGENTS.md 互加权威声明;阶段改名 R0–R6;领任务前必查 00_INDEX.md 合入状态 |
| R-B | 教师验收时序 | Q1–Q8 处教师视觉复核期未获 accepted(PLAN:116,205),大重构移动验收基线 | 教师复核结论失效 | 验收前只做教师不可见的纯内部解耦;行为型重构排到 accepted 后;每阶段代表课例视觉复核 |
| R-C | Windows 打包/发布回归 | 重构触及 src/main、src/preload、resources/ 或资源路径 | 单测全绿但 dist:win 产物损坏 | 涉及 main/preload/resources 的卡最小验证强制加 verify:w3-portability;收口跑一次 dist:win |
| R-D | repo-index 烂尾 | 知识系统半途而废 | 40/50 章流程与模板成死重 | 流程写明「无索引降级模式」;模板索引字段标 optional;P0 设中止检查点 |
| R-E | 工具链前提未基线化 | typescript 7.0.2 + vitest 4 + vite 8 + electron 43 组合新,任一升级即全链路漂移 | 基线验证不可复现 | P0 记录 lockfile 哈希与三工程 tsc 耗时;依赖升级必须独立任务卡并复跑 V3 |
| R-F | 双 Published producer(现存) | V1/V2 双链并存均被导出路径调用 | 「唯一转换链」误导;改 V2 漏评估 V1 消费 | V1 链写入 legacyPaths 并定义删除条件;术语表与不变量 #35 按 DV-26/DV-30 改写 |

**深挖 2.6:术语表 21 词状态标注**:现状词 14(Canonical Document、Projection、Surface、Sidecar、Catalog、Installed Package、Component Instance、Component Authoring、Runtime、Interaction Rule、File Firewall 等,均有仓库证据);规划词 7(ActiveEditor、Facade、Binary Delta、Context Pack、Semantic Index、Generated Graph、Legacy Read Adapter);部分/需修正 2(Feature——概念通用但 src/renderer/features/ 不存在;Published Producer——概念成立但「唯一」不成立)。建议表头格式:`| 术语 | 含义 | 状态(现状/规划/部分) | 证据/引入处 |`。

---

# 四、问题登记册汇总(按严重度,一行式索引;详情见第三章对应条目)

## 关键(12 条)

| ID | 一句话 | 位置 |
|---|---|---|
| KS-01 | repo-index 前史(0c12bb0 未合入实现 + 「不建全量图」现行决策)未援引,全量 import 图与之正面冲突 | 10/00:17,71-79 |
| KS-10 | 索引生成器假设的经典 TS Compiler API 在 typescript@7.0.2 不存在 | 10/02:40,50 |
| MB-03 | 导出唯一生产链未提 PublishedLesson V1 / Published Course V2 双 producer 并存 | 20/07:6-17 |
| MB-14 | 文件地图遗漏 src/main、src/preload、diagnostics、authoring、contracts、styles 六棵子树 | 20/10:7-35 |
| MB-15 | 文件地图 export 行未标注双 producer 这一关键迁移决策 | 20/10:28 |
| EX-02 | P6/FINAL-03 验收与教师 accepted 门禁无对接 | 30/00:200-208;01:502 |
| EX-06 | DOC-01 重写 AGENTS.md 未声明现行约束迁落地 | 30/01:125-138 |
| EX-20 | L4 清理 editor-1.0 缺「唯一计划先修订」前置条件 | 30/03:51-60,89 |
| DV-01 / DV-09 | 流程核心命令 repo:context / repo:index:check 不存在且无降级说明 | 40/00:30;40/02:59 |
| DV-05 / DV-19 / DV-23 | 任务协议、模板、7 条不变量把不存在的「代码模式」当现状约束 | 40/01:92;50 两篇;90/00 多行 |
| DV-18 / DV-21 | FEATURE_MANIFEST 整模板、任务卡/HANDOFF 索引字段依附不存在设施 | 50-templates 三篇 |
| DV-28 | 风险登记册漏计划权威冲突、教师验收时序、打包风险等 6 条 | 90/01:5-22 |

## 重要(约 45 条,按主题归并)

- **治理/衔接**:F-07(可复用基础漏 6 项)、F-10(tests/ 双轨)、F-15(simple 组件入口扩张未标注)、F-16(高级属性可发现性现状为隐藏)、KS-06(generated/ 入 Git 与字节确定性冲突)、KS-07(modules 多份人工边界)、KS-11(--check 无强制挂载)、KS-12(HEAD 判据漏报脏工作树)、KS-14(评分权重任意+git 查询成本)、KS-15(alias 冷启动缺口)、EX-03(验证纪律切换点)、EX-08(DIAG-02 与现有 CLI 重叠)、EX-18(删除门槛缺 recovery/冲刷一问)、EX-21(合同夹具有误伤风险)、DV-04/06/07/12/13/15/16(协议双轨系列)、DV-20(features/ 路径悬空)、DV-22(任务卡过重)、DV-24/25/26/27/29/30/31(超前/半成立条款)。
- **模块事实**:MA-01(模块表无现状成熟度)、MA-03(Immer/Patch 覆盖面)、MA-04(CORE-05 漏组件包快照与 sidecarDirection)、MA-05(CORE 步骤无现状基线)、MA-08(hooks 漏 9 处调用)、MA-10(Workspace 还含 Spatial/Flow 接线)、MA-15(代码模式与 DeveloperTab 映射)、MB-01(AssetMeta 无持久化 hash)、MB-04(双轨分派以偏概全)、MB-09(诊断现状清单缺失)、MB-10(简洁/简单术语漂移)、MB-16(地图依赖不存在设施)。
- **执行依赖**:EX-01、EX-05、EX-10(CORE-06 超规模)、EX-11、EX-12(74 卡无 depends_on)、EX-13(图缺 7 节点)、EX-14(漏 9 条边)。

## 次要(约 60 条)

其余条目均为措辞夸张、示例杜撰、格式、轻微口径问题(如 MA-14「巨型」、KS-04/05 示例、EX-04 列表断裂、F-02 路径前缀等),不影响方向,但会侵蚀读者信任,建议随修订一并清扫。完整清单见第三章表格。

---

# 五、修改建议汇总(按执行优先级)

## A 级:执行前必改(不改就会误导施工或破坏治理)

1. **A1 治理衔接(G-01/EX-06/EX-20)**:README 增「与唯一计划的关系」节(定位 = COURSEWARE_DEVELOPMENT_PLAN.md 3.2 节预留的「1.0 之后」执行子计划);DOC-01 验收口径改为「AGENTS.md 重写后原样保留四类句子」;L4 增「唯一计划修订 + accepted 不受影响」门禁。
2. **A2 教师验收对接(EX-02)**:P6/FINAL-03 注明不替代教师 accepted;P0 启动时若 1.0 未 accepted,全部工作在独立分支,不移动待验收基线。
3. **A3 索引生成器技术前提(G-03/KS-10)**:02 文档 L40-50 改写为三选一(unstable/sync 锁定 7.0.2 / 新增 ts-morph / scanner 启发式),删例外条款;并在 P0 加「技术验证先行」步骤。
4. **A4 repo-index 前史(G-04/KS-01)**:00 篇增「现状与前史」节;以 0c12bb0 的 11 modules/11 features 为 semantic 底稿;是否推翻「不建全量图」单独写 ADR 裁决。
5. **A5 概念悬空清扫(G-02)**:全文按「现状/规划/部分」三态标注;repo:* 命令、repo-index、Facade、ActiveEditor、代码模式、Context Pack 首次出现处统一标注;模板悬空字段统一「建成前填 none」;术语表加状态列(2.6 格式)。
6. **A6 双 producer(G-05/MB-03/15)**:07 篇 §1 补现状段 + legacy 退役路线;文件地图 export 行标注;术语表与不变量 #35 改写;顺带裁决 docs/PUBLISHED_LESSON_V1.md:3 与代码的矛盾。
7. **A7 文件地图补全(G-08/MB-14)**:补 6 棵子树行(归属建议见 §3.4 深挖 B);03 篇增「现状→目标目录映射表」(§3.1 差异表可直接采用)。
8. **A8 协议归并(G-06)**:任务设计规范并入 01_SHARED.md、执行纪律保留 02_WORKER.md(吸收 Read-only 态、热点符号、迁移删除条件、finding 格式);HANDOFF 合一 14 字段;阶段改名 R0–R6;验证策略写明「V1 的 E2E/构建与 V2 全部仅限阶段整合者」。

## B 级:执行中应改(影响工作量估算与验收口径)

9. **B1**:01 篇 §7 CORE-01~07 每步加「现状基线」行(§3.3 B.1 表直接可用);MA-03 的 patches 覆盖面改写;MA-04 CORE-05 扩写。
10. **B2**:02 篇 hooks 结构补 useAssetImportActions 等(MA-08);IPC 节改写为现状确认+真实差异(MA-07)。
11. **B3**:能力矩阵三行改「现状/目标」两栏式(F-15/16/17);04 篇 EditorMode 定义加现状注(F-14)。
12. **B4**:知识系统落地件:--check 挂入 build/verify(KS-11);新鲜度改输入 hash 口径(KS-12);alias 首批 50-100 词条 + 回填升级 DoD(KS-15);generated/ 入 Git 决策二选一(KS-06)。
13. **B5**:依赖图补 7 节点 9 边(EX-13/14);任务卡模板加 depends_on/touches_modules 强制字段(EX-12);CORE-06 预拆 a/b/c(EX-10);删除七问增第八问(EX-18);「不应删除」补合同夹具(EX-21)。
14. **B6**:风险登记册补 R-A~R-F(2.5 文本直接可用);不变量 🔵/⚠️ 条目标注「目标态」分节(2.4)。
15. **B7**:诊断现状设施映射表补入 08 篇(MB-09,深挖 D 表可用);AssetMeta hash 描述改现状(MB-01);ExportPreflightTarget 补 docx 或标注待补(MB-07)。

## C 级:可选打磨

16. 术语统一:「简单模式」→「简洁模式」(或注明映射);热点清单改为 contracts/course-project-v9/**(EX-15);清理夸张措辞(MA-14 等);修复格式(EX-04);示例路径/行号改真实值(KS-04/05);00_READING_MATRIX 补 20-modules/ 前缀(F-02);F-05 catalogStatus 漂移加注;「实验区」补载体定义(F-08);legacy-read-adapters 落位二选一(F-13)。

---

# 六、整合路线图建议(给后续整合 AI)

1. **第一步(门票)**:完成 A1+A2+A8 的治理三件——权威声明、验收对接、协议归并与阶段改名。此后方案才具备在仓库内合法执行的身份。
2. **第二步(技术排雷)**:A3 的索引器技术选型用 1 个 spike 任务验证(unstable/sync 可行性),A4 的 semantic 底稿转写(旧 11 modules/features + 认知索引 §5 的 16 任务行→aliases)可在同一阶段完成;P0 设中止检查点(对应 R-D)。
3. **第三步(事实修订)**:A5/A6/A7 + B 级事实类条目一次性修订文档包,修订后重跑本报告 §七 的复核命令集抽检。
4. **第四步(执行)**:按修订后的 R0–R6 推进;每阶段末用代表课例做视觉复核(对应 R-B);CLEAN 系列卡执行前逐张过「删除八问」。
5. **可直接照做的部分**(无需等修订):P0 的 Markdown 路径检查器(直接对症已证实的 10 处漂移)、P1 facade 先行、P3 的迁移次序、tests.json 自动生成替代人工命令映射、验证分层 V0–V3、50 条不变量中 ✅ 的 26 条。

---

# 七、交叉审阅指南(复核命令集)

```bash
# 基线与热点规模
git log -1 --format=%H                       # 应为 690411d4a101b4020134712108262bddf08e0d2e
wc -c src/renderer/store/editorStore.ts src/renderer/ui/Workspace.tsx src/renderer/ui/PropertiesTab.tsx
# G-04 repo-index 前史
git show --stat 0c12bb0 | grep repo-index
git merge-base --is-ancestor 0c12bb0 HEAD; echo $?    # 应为 1(不在 main)
git branch -a --contains 0c12bb0                       # 应为空
git log main --oneline -- repo-index | wc -l           # 应为 0
git ls-tree -r e53c126 --name-only | grep -c '^repo-index/'   # 应为 0
sed -n '14p' PROJECT_COGNITION_INDEX.md                # 「不建设全量符号图、依赖图」
# G-03 typescript 前提
node -e "const ts=require('typescript');console.log(ts.version,typeof ts.createProgram)"   # 7.0.2 undefined
sed -n '37,51p' node_modules/typescript/package.json
# G-02 概念悬空
grep -rn "repo:context\|repo:index" package.json scripts/    # 应为空
grep -n "type EditorMode" src/renderer/store/editorStore.ts  # 仅 simple|professional
ls repo-index 2>&1                                       # 应不存在
# G-05 双 producer
grep -n "buildExportPayload\|buildPublishedCourseV2Payload" src/renderer/App.tsx
grep -rn "buildPublishedLessonPayload" src
# 治理证据
sed -n '12p' AGENTS.md
sed -n '22p;116,120p;205p' COURSEWARE_DEVELOPMENT_PLAN.md
grep -rn "COURSEWARE_DEVELOPMENT_PLAN" tmp/zip-eval/     # 当前应零命中(修订后应命中)
# 认知索引漂移抽查
test -f src/renderer/course/v9SlideVerticalSlice.ts; echo $?   # 1(不存在)
grep -rln "v9SlideVerticalSlice\|DeclarativeCourseState" src   # 无输出
grep -n '"verify:full"' package.json                           # 无输出
```

**审阅要点清单**:① 每条问题的「仓库证据」是否仍可复现(仓库在演进,行号会漂移,符号名更稳定);② 修改建议是否与 AGENTS.md 现行约束冲突(尤其 V9 软冻结、全局层固定入口、教师工作流三禁);③ A 级条目是否已全部落入方案修订稿;④ 方案修订后重跑上方命令集抽检;⑤ 注意本报告自身的时效——若仓库 HEAD 已不同于 690411d4,先按方案 README §4 第一步更新基线事实再引用本报告数字。

---

# 八、附录

## 8.1 评估方法与分工

两轮并行子智能体(均只读,未修改/创建/删除仓库任何文件,未运行构建/测试):第一轮 6 个分片(00-foundation / 10-knowledge-system / 20-modules 00-05 / 20-modules 06-10 / 30-execution / 40+50+90)精读+核实;第二轮同批细化,产出带 zip 行号的问题清单与深挖数据。全部结论附 `路径:行号` 证据;zip 文档行号来自对解压文件的真实 Read。

## 8.2 数据与材料来源

本报告全部表格(目录差异、能力矩阵对照、CORE 现状、history 清单、IPC 差异、Workspace 接线、组件映射、诊断映射、双 producer 证据链、74 工作包总表、协议逐节对照、验证映射、模板字段映射、50 条不变量三态、风险评注与补全、术语状态)均来自上述两轮核验的原始记录,关键数字均经至少一次命令复核。

## 8.3 争议仲裁记录

第二轮中,execution 分片子智能体对「0c12bb0 含 repo-index 实现」提出异议(称该提交仅新增认知索引与计划、且为 HEAD 祖先)。主评估人直接复核:`git show --stat 0c12bb0` 明确列出 repo-index/ 五件(README 27、manifest 29、modules 283、features 250、tests 86 行);`git merge-base --is-ancestor 0c12bb0 HEAD` 退出码 1(非祖先);`git branch -a --contains` 为空。**仲裁结论:knowledge-system 分片的原始认定成立,KS-01/G-04 维持关键级。** 该分歧本身印证了 G-04 的价值:这段前史在仓库中极易被误读。

## 8.4 时效与留档

- zip 解压留档:`tmp/zip-eval/ITTOEDU_ARCHITECTURE_EXECUTION_PLAN_20260821/`(可随时删除)。
- 本报告数字基于 HEAD=690411d4;仓库演进后请以符号名/命令复核为准。
