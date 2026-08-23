# IttoEdu 当前项目认知入口

> 状态：repo-index 默认开发导航；低置信、过期或相关 dirty 时人工 Bootstrap
>
> 更新日期：2026-08-24
>
> 唯一总纲：[COURSEWARE_DEVELOPMENT_PLAN.md](COURSEWARE_DEVELOPMENT_PLAN.md)
>
> 详细执行方案：[docs/development-plan/](docs/development-plan/README.md)

当前仓库已落地静态、确定、可检查的开发 repo-index，覆盖 renderer/player、main/preload 和 e2e 三套 TypeScript 工程。开发任务默认先检查索引新鲜度，再用确定性查询生成有界 Context Pack；低置信、全局或相关输入过期、相关文件 dirty，以及外部 Catalog 源码查询必须明确降级到人工 Bootstrap。索引只辅助导航，不能覆盖源码、Schema、合同或用户决定。

## 1. 权威与当前路线

1. 用户当前决定、Schema、合同和源码高于任何索引。
2. 当前开发主线是立即稳定化与模块解耦，不等待教师 accepted。
3. docs/tasks/editor-1.0/**、T/P/Q/F/G 和旧评估只作历史证据，不再领取。
4. Course Project V9 软冻结；不支持 V8 .h5lesson，不创建 V10。
5. 产品能力索引 artifacts/ai-capabilities/ 回答“课件生成能做什么”；待建 repo-index 回答“开发修改应读什么”，二者不得混为一份真相。

## 2. 默认 repo-index 流程与人工 Bootstrap

中高风险、跨模块和多智能体任务按以下顺序开始：

1. 运行 `npm run repo:index:check`，确认受提交索引与当前严格输入一致；
2. 优先使用 feature、symbol、path 或 changed 查询，自由文本只作保守兜底；
3. 阅读 Context Pack 的 Freshness / Dirty Inputs、confidence、canonical carrier、write path、consumers、tests、unknowns 和建议验证；
4. 只有 `fresh` 且无相关 dirty 输入的高/中置信结果，才可作为 S2 任务的导航起点；
5. `partially-stale`、`stale`、`low`、`bootstrap-required` 或外部源不可用时，转入下述人工 Bootstrap；
6. 任务结束按 `indexImpact` 由阶段 Integrator 统一重建，不允许 Worker 手改 `repo-index/generated/**`。

当前查询命令：

~~~bash
npm run repo:context -- --feature components --size medium
npm run repo:context -- --symbol buildPublishedCourseV2Payload --size small
npm run repo:context -- --path src/renderer/App.tsx --size medium
npm run repo:context -- --changed --size medium
npm run repo:context -- --query "Flow 图片替换保存重开" --size medium
~~~

需要保存 Context Pack 时，相对输出只能位于被忽略的 `repo-index/contexts/`；仓库外绝对输出只能位于操作系统临时目录。单文件 S0 小修可直接使用人工 Bootstrap。人工定位按以下顺序读取：

1. 当前任务卡和一个相关合同；
2. 精确类型、函数、Store action 或 UI 文案；
3. canonical writer；
4. 一个直接运行/预览/导出 consumer；
5. 1–3 个相关测试；
6. 仍不足时才扩展到相邻模块。

默认不读取全部历史任务、全部评估、整个 editorStore.ts 或全部 E2E。合同默认只读，不得因文件防火墙禁止读取。

任务 Context Note 至少记录：

~~~
产品行为
Canonical carrier
当前 writer
运行 / 预览 / 导出 consumers
必须保护
最小验证
未知项
热点 owner
~~~

## 3. 当前模块入口

| 产品区域 | 当前主要入口 | 必须保护 |
|---|---|---|
| V9 合同 | src/shared/contracts/course-project-v9/ | Schema 9、revision、三 Surface carrier |
| Published | src/shared/contracts/published-course-v2/、src/renderer/export/course/ | V2 主路径只读 |
| 编辑状态 | src/renderer/store/editorStore.ts | exactly-one-active V9 session、dirty、选择和现有命令 |
| 编辑身份 | src/renderer/authoring/courseAuthoringSession.ts、courseAuthoringScope.ts | location/generation stale guard、owner、authoringAddress |
| 历史与资源 | src/renderer/store/history.ts | 文档和素材/组件资源同步撤销 |
| Slide | src/renderer/course/、src/renderer/phaser/、src/renderer/ui/Workspace.tsx | 场景、状态、LayerItem、编辑命中 |
| Flow | src/renderer/course/flow*、src/renderer/ui/FlowWorkspace.tsx | FlowBlock 顺序、FlowComponentBlock、IME、wrap/paperSpace |
| Spatial | src/renderer/course/spatial*、Player spatial host | 世界 items、自由逛、路径、会话相机 |
| Media | src/renderer/project/、Store media actions | AssetMeta、sidecar bytes、保存重开 |
| Components | src/renderer/components/、src/shared/contracts/component-v4/ | package/instance 分离、API 4、三 Surface 正确载体 |
| Runtime/互动 | src/shared/contracts/runtime/、interaction-v1/、src/player/ | API 2/3、规则合同、隔离运行 |
| 全局层/控制器 | V9 合同、courseAuthoringScope.ts、effective-layer 相关实现 | global/surface owner、控制器不复制 |
| 保存/恢复 | src/renderer/App.tsx、src/renderer/project/、src/main/ | V9 archive、single-flight、Recovery |
| 预览/Player | src/renderer/preview/、src/player/surfaces/ | CoursePlayer、mount/destroy、三 Surface hosts |
| 导出 | src/renderer/export/、src/main/pdfExport.ts | HTML/Web V2、PPTX/PDF/DOCX 适用语义 |
| 诊断 | src/shared/projectHealth.ts、src/renderer/diagnostics/ | 诊断只读、错误可行动 |
| UI 外壳 | src/renderer/App.tsx、Workspace.tsx、PropertiesTab.tsx | 最终只保留路由和组合 |
| Main/Preload | src/main/、src/preload/ | IPC parity、文件和安全边界 |
| 开发工具 | scripts/、tests/、artifacts/ | 确定生成、最小验证、release consumers |

路径包含通配前缀时表示检索方向，不表示一个可直接打开的具体文件。

## 4. 首批高风险用户旅程

1. 替换图片 → 撤销/重做 → 保存重开 → 预览 → HTML/Web。
2. 文件对话框打开期间切页/切项目，旧操作不得写入新目标。
3. Slide / Flow / Spatial / Mixed 往返，位置、选择和编辑/运行状态可预期。
4. 导入媒体或组件后，元数据和文件字节同步保存与撤销。
5. 当前页试运行与整课预览使用同一 Published V2 主路径。
6. HTML/Web、PPTX、PDF、DOCX 对不支持内容给出明确说明，不静默丢失。
7. 新建、打开、Recovery、保存期间继续编辑与关闭流程保持数据安全。
8. 全局层、Surface 共享层和教师控制器保持正确 owner。

这些旅程已进入 repo-index 的 Feature/semantic 导航、任务 Context Pack 和阶段验证入口；最终事实仍以当前源码与合同为准。

## 5. 当前真实债务

- 一个活动 V9 session 与可写/派生混合的 V8-shaped state.project 并存；
- Slide、Flow、Spatial 有三套 session/history 实现，但正常运行时互斥，不是三份同时活动的工程真相；
- Store、App、Workspace、Properties、FlowWorkspace、InteractionEditor 和全局 CSS 责任过多；
- HTML/Web、纯 Slide PPTX、PDF raster/preflight、Project Health 和部分 fixtures/release 仍有 Legacy consumer；
- repo-index 是提交内快照，源码、semantic、config 或 tool 输入变化后必须由单一 Integrator 重建；相关 dirty 文件仍会使 S2 Context Pack 不安全；
- 外部组件 Catalog 当前可用，但属于外部输入，状态必须在每次基线时检查。

## 6. 常用只读检查

~~~
git status --short --branch
npm run repo:index:check
npm run check:task-board
npm run check:contracts
npm run check:ai-capabilities
npm run typecheck
npm run test -- --run <target>
~~~

完整 verify、完整 E2E 和桌面打包只在计划规定的阶段门运行，不作为普通任务默认动作。

## 7. 课件创作入口

- 教学编排：.agents/skills/orchestrate-courseware/
- V9 课件构建：.agents/skills/build-courseware-project/
- 产品能力发现：artifacts/ai-capabilities/index.json

仓库没有 agent-kit CLI。课件创作能力索引与开发 repo-index 是两个不同系统。

## 8. repo-index 当前合同与质量状态

ARCH-0B 门禁已在不修改 25 题 corpus、expected、阈值或最终 evaluator 的前提下通过：Hit@5 `100%`，受控 Recall@15 `95%`，广泛 Recall@15 `85.38%`，高置信错误与禁入 Top 5 均为 `0`，四个预期低置信场景全部正确降级。当前合同：

- `repo-index/generated/manifest.json` 以 source、semantic、config、tool 四域 hash 判断全局新鲜度，不持久化 HEAD、时间、用户名或绝对路径；
- `npm run repo:index` 只由阶段 Integrator 执行，`npm run repo:index:check` 只读重建并逐字节比较；
- 自动事实覆盖文件、顶层符号、import/export、合同、脚本、测试和三套 tsconfig；人工 semantic 只维护少量 Feature、Module、carrier、不变量和排除项；
- 相同输入连续生成必须逐字节一致，路径必须存在，Markdown 引用和合同产物必须可验证；
- Context Pack 的 `fresh / partially-stale / stale` 是查询时状态；相关 dirty 输入、低置信或外部源码不可用必须输出未知项和 Bootstrap 要求；
- repo-index 回答“开发修改应读什么”，`artifacts/ai-capabilities/` 回答“课件生成能做什么”，两者不得合并为一份真相。

质量基线与阶段结论见 `docs/development-plan/baselines/ARCH_0B_INDEX_QUALITY.md` 和 `ARCH_0B_GATE_REPORT.md`。中高风险与多智能体任务必须先生成 Context Pack；单文件 S0 小修仍可使用人工 Bootstrap。
