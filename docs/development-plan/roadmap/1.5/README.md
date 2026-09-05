# 1.5：材料、PPTX 与内容质量

## 结果与边界

教师可以在应用本地保存、检索、引用和删除材料，把受限 PPTX 原子导入为可编辑内容，复制参考样式骨架并替换槽位，并在发布前检查数学、答案、图表正文和来源定位。材料缓存不进入 Course Project 主合同；进入课程的可见引用必须是普通可携带内容。

OpenMAIC 只是一条可选研究 / 桥接旁支。任何核心任务、版本退出门或发布制品都不得依赖它。

S2 Owner 验收 1.4–1.5 后发布 `v1.5.0` accepted 源码标签，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r15-005-workspace-identity` | 定义材料域与 AI 会话域共享的 WorkspaceIdentityV1 | — | 否 | `contracts-schema` | `WorkspaceIdentityV1 = projectId + normalizedPath` 严格解析；同 ID 不同路径互不可见，Save As 产生新身份；它是材料域与 AI 会话域共用的唯一 workspace key，不承载任一域的私有语义，也不存在第二套定义 |
| `r15-000-material-contract` | 定义本地材料记录、工程关联、引用与删除语义 | `r15-005-workspace-identity` | 否 | `contracts-schema`, `main-preload` | 版本化本地材料记录按 `r15-005-workspace-identity` 关联并严格解析；材料原文、索引和 trace 不进 CourseProject、Published 或导出；删除行为与课程可见引用保留策略可判定；本节点只定义材料域私有语义，不重复定义 workspace identity |
| `r15-010-material-repository` | 应用本地材料可导入、读取、检索、定位和删除 | `r15-000-material-contract` | 否 | `main-preload` | 导入受支持文本 / 文件后可按标题、正文和来源检索并打开原位置；重启应用后仍可用；删除一个材料、当前工程材料不影响其他工程；损坏索引可重建且不改权威工程；本节点在现有 `tests/unit/coursewareAuthoringRunner.test.ts` 增加并通过材料仓库隔离 / 删除用例 |
| `r15-020-material-tools-citations` | Authoring Tools 可引用材料并写入可见、可携带来源 | `r15-010-material-repository`, `r14-020-slide-tools`, `r14-021-flow-tools` | 否 | `main-preload`, `store-kernel` | 从检索结果插入内容时，正文和来源定位写成普通 V9 内容；删除本地材料后已写引用在保存重开、Player 和导出中仍可见；stale target 零写入；引用插入可一次 Undo |
| `r15-030-pptx-import` | 受限 PPTX 解析、资源限制、不支持项报告与 document + sidecar 原子提交 | `r14-060-release` | 否 | `app-save-recovery`, `store-kernel` | 正常 fixture 导入为可编辑页面 / 对象；超文件大小、超解压比、损坏关系和不支持对象分别停止并报告页码 / 类型；任一 document 或 sidecar 写入失败时两者均不提交；导入可整体撤销；本节点在现有 `tests/unit/courseProjectArchive.test.ts` 增加并通过 PPTX document + sidecar 原子事务用例 |
| `r15-040-style-remix` | 复制参考页可编辑骨架并用明确槽位替换内容 | `r13-060-release`, `r14-060-release` | 否 | `store-kernel`, `generated-index` | Remix 预览列出骨架来源、槽位映射与容量处理；确认后创建无身份冲突的普通 V9 内容；修改副本不影响来源；缺槽位 / 超容量返回定位结果且不留下半页；保存重开与 Player 一致 |
| `r15-050-content-qa` | 数学、答案一致性、图表正文一致性和来源定位进入可导航 QA | `r14-060-release` | 否 | `diagnostics`, `generated-index` | 四类预置错误分别产生可跳转 finding；数学检查区分解析错误与渲染警告，答案检查比较题目与 evaluator，图表检查比较数据与正文主张，来源检查定位缺失引用；检查只读且不因 OpenMAIC 缺席降级；本节点在现有 `tests/unit/courseProjectHealth.test.ts` 增加并通过四类内容 QA 用例 |
| `r15-060-release` | Owner 验收 S2 工具与素材并发布 v1.5.0 accepted 源码标签 | `r15-020-material-tools-citations`, `r15-030-pptx-import`, `r15-040-style-remix`, `r15-050-content-qa` | 否 | `none` | Owner 在同一固定课例完成 S2 工具与素材验收：覆盖 1.4 的三 Surface/global Authoring Tools、Builder V2、动态载体三硬门，以及 1.5 的材料导入/检索/引用/删除、PPTX 导入、Remix 与四类内容 QA；检查保存重开、Undo、Player、HTML、适用导出和失败零写入，晋升 1.4–1.5 已验收行为到保全矩阵，签署 accepted 后创建 `v1.5.0` 源码标签；OpenMAIC 缺席不阻塞 |
| `r15-900-openmaic-review` | 评估 OpenMAIC 与当前合同的可复用边界并形成采用 / 不采用记录 | `r14-060-release` | 是 | `none` | 记录许可证、进程 / 数据边界、可复用接口、与 V9 / Authoring Tool 的冲突及退出成本；结论可以是不采用；不改核心合同、不写发布门、不阻塞 `r15-060-release` |
| `r15-901-openmaic-bridge` | 在评估通过时提供隔离桥接原型 | `r15-900-openmaic-review`, `r15-040-style-remix` | 是 | `app-save-recovery` | 原型只经已批准材料 / import / Authoring Tool 边界交换数据；禁用或卸载后核心工作流和固定课例不变；失败零写入；没有任何核心节点依赖本节点 |

并行 frontier：材料链、PPTX 导入、Style Remix、内容 QA 和 OpenMAIC 评估可并行。`r15-050-content-qa` 与 `r15-060-release` 明确不依赖 `r15-900-*` / `r15-901-*`。

## 接口与数据合同

- `r15-005-workspace-identity` 单独定义共享 `WorkspaceIdentityV1 = projectId + normalizedPath`；材料域和后续 AI 会话域都依赖它，各自不得重复定义 workspace key。
- 本地材料目录使用版本化 metadata + content / index，并以共享 WorkspaceIdentity 为 owner；材料缓存、搜索索引、解析 trace 均不写入 `.h5lesson`。
- 课程中的引用是普通 V9 可见内容，至少保留显示标签和来源定位；本地原材料被删除后，已经提交的课程正文 / 引用仍由工程自身保存。
- PPTX importer 先在临时 staging 完成 ZIP 结构、压缩比、关系、媒体和对象白名单检查，再以 document + sidecar 单一事务提交；不支持项报告不得被“尽力忽略”。
- Style Remix 复用的是重映射身份后的可编辑骨架与明确槽位，不复制隐藏 Recipe / runtime 状态。
- 内容 QA 返回 severity、rule ID、canonical target、message、evidence 与修复建议；QA 不自行更改答案或正文。
- OpenMAIC 桥接不得取得 CourseProject 私有写入口，也不得成为材料、Remix 或 QA 的默认实现。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/editorTransaction.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/coursewareAuthoringRunner.test.ts tests/unit/coursewareCaseBuilder.test.ts tests/unit/assessmentEvaluators.test.ts
npm run test:product -- tests/unit/courseProjectArchive.test.ts tests/unit/coursePptxExport.test.ts tests/unit/assetReferences.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线的统一验证与 S2 Owner 发布门；OpenMAIC 测试不得加入核心命令链。
