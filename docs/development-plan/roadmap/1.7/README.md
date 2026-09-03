# 1.7：生成与本地编辑内核（默认隐藏）

## 结果与边界

本地 CLI Agent 通过 **batch candidate pipeline** 生成单页、整课和局部修改候选，并按 Native → Recipe → Existing Component → Generated Component → Runtime 的载体阶梯选择实现。应用向一次请求提供不可变的最小上下文快照或已确认 Markdown；CLI 通过结构化 stdout / artifact channel，或在 adapter 启用文件工具时通过当前 session staging 输出严格候选，拿不到 Renderer Store 或 live project read/write API。应用不接管 CLI 的规划循环，也不在 1.7 提前开放 MCP；真正写入者是宿主对 1.4 canonical command 的单事务重放。

Native、Recipe 与 Existing Component 的 strict intent 可在核心 parser/commit 边界完成后直接进入产品命令；不得等待动态代码门。Generated Component / Runtime 源码先进入应用管理的 staging，只有静态准入与真实宿主 smoke 全部通过才自动成为当前受支持的可信扩展；不需要人工代码 review，也不提供跳过 correctness gate 的稳定版开关。失败候选对权威工程零写入。

AI 入口默认隐藏。发布制品只有源码 tag，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r17-000-generation-contract` | 定义生成请求、载体阶梯、候选、准入回执与原子提交协议 | `r13-060-release`, `r14-060-release`, `r15-060-release`, `r16-040-release` | 否 | `contracts-schema`, `main-preload` | 单页 / 整课 / 局部修改请求严格解析并包含 canonical target / create-scope + revision 以及不可变最小 context snapshot；候选只能是版本化 typed authoring intent envelope 或 dynamic package manifest；每个候选声明所选载体及为何未选更低阶载体；CLI candidate receipt 与 host commit receipt 分离；合同不包含 generic V9 patch、应用自建 planning step / model loop 或 live project API |
| `r17-010-staging-workspace` | 为每个 session / candidate 建立事务 staging、摄取与确定清理语义 | `r17-000-generation-contract` | 否 | `main-preload` | 宿主只摄取当前 session/candidate root 内 realpath 仍闭合的文件；绝对外部引用、`..`、外链 symlink、其他 session 与 `.h5lesson` 不进入候选/资源事务；结构化 stdout adapter 无文件边界 conformance；启用文件工具的 adapter 证明工具配置指向当前 staging，但不把它宣称为通用 OS sandbox；cancel/failure/success 与启动扫描能确定清理孤儿，staging 不被 save/Published/export 自动收集；在现有 `tests/unit/scopedValidationWorkflow.test.ts` 增加摄取/清理故障用例 |
| `r17-011-static-admission` | 自动检查编译、协议、依赖、资产闭包、origin、资源上限与静态 fallback | `r17-010-staging-workspace` | 否 | `main-preload`, `contracts-schema` | 合法 Component / Runtime 候选分别通过；语法 / 类型失败、未批准依赖、缺资产、错误 origin、超包大小 / 资源上限、缺 fallback 各自给出确定 finding；失败后 registry、工程和 Published 均不变；本节点在现有 `tests/unit/componentContentIntegrity.test.ts` 增加并通过静态 gate 用例 |
| `r17-012-host-smoke-admission` | 在真实 Component / Runtime 宿主执行 mount / update / interaction / destroy smoke | `r17-011-static-admission` | 否 | `published-producer`, `main-preload` | 合法候选在编辑器与 matching Player 宿主完成生命周期和最小互动；timeout、泄漏、throw、销毁后回调、越权 host API 分别失败；旧实例被隔离；失败不注册、不写工程，不允许人工覆盖；本节点在现有 `tests/unit/componentLifecycleGuard.test.ts` 增加并通过真实宿主故障注入用例 |
| `r17-013-host-candidate-commit` | 宿主把严格生成候选映射为 1.4 命令并原子提交 | `r17-000-generation-contract` | 否 | `contracts-schema`, `main-preload`, `editor-store-history` | strict parser 拒绝未知版本、未知 intent、raw V9 patch/import 和不完整 target；重新解析 canonical target/revision，逐项映射 1.4 tool/command args，以单一 document+resource transaction 提交；Native/Recipe/Existing Component 不调用 dynamic admission，dynamic manifest 只有在 r17-011/012 回执通过后才允许提交；stale、cancel、坏 envelope、适用的 admission fail 零写入；两类 receipt 分离，一次 Undo 恢复 document 与资源 |
| `r17-020-single-page` | CLI Agent 生成一页候选并由宿主提交 | `r17-013-host-candidate-commit` | 否 | `main-preload`, `editor-store-history` | 固定需求生成一页 typed intent candidate，回执记录载体阶梯选择；提交前预览，宿主经 r17-013 提交后仅一个历史事务；保存重开、Player、HTML 和诊断通过；cancel / stale 结果零写入；本节点在现有 `tests/unit/coursewareAuthoringRunner.test.ts` 增加并通过单页生成用例 |
| `r17-021-whole-course` | CLI Agent 从已确认两份 Markdown 生成整课 | `r17-020-single-page` | 否 | `main-preload`, `editor-store-history`, `generated-index` | 固定 teaching plan + presentation script 生成包含演示页、Flow、Spatial、教学推进和至少一项互动的 V9 工程；不修改输入 Markdown；失败步骤可由 receipt 定位；最终可保存重开、Player 和 HTML |
| `r17-022-local-edit` | CLI Agent 为 canonical target 生成局部修改候选 | `r17-020-single-page` | 否 | `main-preload`, `editor-store-history` | 对当前选择、当前页和整课范围分别发起请求；CLI 只收到该请求的不可变 snapshot，不能 live 读取工程；宿主只提交 preview 中的 target；教师在运行期间改动导致 revision 变化时返回 stale 且零写入；成功修改一次 Undo 恢复原状 |
| `r17-023-generated-carriers` | Generated Component / Runtime 候选经 gate 后由宿主注册 | `r17-012-host-smoke-admission`, `r17-020-single-page` | 否 | `contracts-schema`, `published-producer`, `editor-store-history` | 固定 Component 与 Runtime 需求各生成一个 dynamic package manifest；源码和资产只在 staging，gate 全过后由宿主注册精确 identity 并与 document 作为一次资源事务提交；编辑器、Player、单 HTML 离线运行；gate fail、stale 与 cancel 零注册 / 零工程写入；Provider secret、原始 Electron Main、任意 OS、未批准脚本 / host API 始终不可用 |
| `r17-030-single-repair` | 对风险页执行有界、可停止的局部自动修复 | `r17-021-whole-course`, `r17-022-local-edit`, `r17-023-generated-carriers` | 否 | `main-preload`, `editor-store-history` | 默认自动预算一次 repair；修复后重跑同一 gate，无可观察进展或预算耗尽即停止并保留 finding；用户明确再次请求可开启新预算，不递归自循环；候选只在最终通过时原子写入，过程可审计 |
| `r17-040-generation-benchmark` | 固定用例量化载体选择、成功率、延迟、失败零写入和人工可编辑性 | `r17-030-single-repair` | 否 | `main-preload` | 固定集覆盖 Native、Recipe、Existing Component、Generated Component、Runtime 及五类失败候选；报告每例选阶、首次通过 / 一次修复 / 停止、耗时、写入数；所有通过产物可 UI 编辑，所有失败工程字节语义不变 |
| `r17-060-release` | 固定课例通过生成 / 编辑 / 动态载体人工闭环并发布 1.7 源码 tag | `r17-040-generation-benchmark` | 否 | `none` | Owner 在受控 dogfood 入口完成单页、整课、局部修改、Generated Component、Runtime、Stop/stale 和失败 gate；保存重开、Undo、Player、单 HTML 与诊断通过；把 strict candidate/唯一 commit/dynamic gate 行为晋升到保全矩阵，证明无 raw Store/UI 依赖、第二 writer/catalog 后签署 `accepted` 并发布源码 tag |

并行 frontier：合同后，核心 host commit 与 staging/dynamic admission 分开推进；单页 Native/Recipe/Existing Component 只依赖核心 commit，可先形成整课和局部修改样板。Generated Component/Runtime 在静态+宿主 gate 后汇合；版本仍交付用户已决定的完整动态载体能力。

## 接口与数据合同

- 生成请求包含 request ID、session owner、canonical target / create-scope、document revision、已确认输入、允许载体、资源预算与不可变最小 context snapshot。CLI 自己规划候选；应用不存储或执行模型计划图。CLI 不得获得 Store 或 live read API；应用只摄取显式 candidate channel 的结果，不把“不摄取 staging 外文件”宣传成 CLI 进程的 OS sandbox。
- 候选只允许是 strict/versioned typed authoring intent envelope 或 dynamic package manifest，连同资产引用、origin、fallback 和 CLI candidate receipt 写入当前 staging/structured stdout；禁止 generic V9 patch、archive import 或内部 Store dump。
- 宿主在 preview 与 admission 后重新校验 target/revision，把每项 intent 映射到 1.4 canonical command，并以一个 document + resource transaction 提交；host commit receipt 与 CLI candidate receipt 分离。1.8 才首次向 CLI 开放可交互的 live MCP read/write catalog。
- 载体阶梯顺序固定：Native、Recipe、Existing Component、Generated Component、Runtime。选择更高阶载体必须在 receipt 中指出低阶载体不能满足的可观察需求。
- 自动可信表示 gate 后可使用当前正式开放给可信 Runtime / Component 的父页面、本地、桌面和网络接口；不包括秘密、原始 Main、任意 OS、未批准脚本或未批准 API。
- 静态 gate 与真实宿主 smoke 只对 Generated Component/Runtime 是必需条件；stable build 没有跳过 correctness gate 的自动信任选项。自动 repair 默认一次且无进展即停，用户显式新请求可以继续，不递归 self-review。

## 精确验证入口

核心实现只使用以下当前已存在的精确测试入口；对应节点在表格 Acceptance 指定的现有文件中增加命名用例：

```text
npm run test:product -- tests/unit/componentContentIntegrity.test.ts tests/unit/componentLifecycleGuard.test.ts tests/unit/assetReferences.test.ts
npm run test:product -- tests/unit/coursePackageExport.test.ts tests/integration/runtimeRegistry.test.ts tests/integration/player-component-registry.test.ts
npm run test:product -- tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts tests/unit/scopedValidationWorkflow.test.ts
npm run test:e2e -- tests/e2e/render-host-benchmark.spec.ts
```

版本候选再执行总路线统一验证；恶意、超限、编译失败、生命周期失败和缺资产五类 fixture 必须证明工程零写入。
