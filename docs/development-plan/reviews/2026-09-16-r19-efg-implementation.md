# R19 E/F/G 批次实施记录（2026-09-16）

> 范围：R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md 第 6 节 E–G 产品工作包的工程实施。本记录只覆盖工程候选与免费证据；三通道有界真实验证（方案 6.4）尚未启动，050/060 结论不变。

## 1. 基线与并行组织

- 开工基线：A–D 未提交集成状态固化为本地分支 `r19/efg-baseline`（commit `f382eed6`，不含历史改写，main 仍指向 `c42cef38`）；未提交 diff 另存 `output/r19-efg-coordination/baseline-uncommitted-20260916.patch`。
- 三个隔离 worktree 并行：E（`r19/efg-e`，`.worktrees/r19-e`）、F（`r19/efg-f`，`.worktrees/r19-f`）、G（`r19/efg-g`，`.worktrees/r19-g`），写域按方案 6.5 不重叠；共享生成物与集成归 ROOT。
- ROOT 顺序集成：`r19/efg-integration` 依次合并 E（`52b1d5e5`）、F（`9ecc03c9`）、G（`b9a7ebeb`），零冲突；随后重新生成 ai-capabilities 并提交。

## 2. E：常规交互组合与导航目标（52b1d5e5）

- `slide.interaction` 新增 `compose` 窄分支（`src/renderer/authoring/tools/slideInteractionTool.ts`）：模型只表达触发（click / input-submit / scene-enter / state-enter / presenter）、条件（inStates / courseState）与效果列表（set-state / show / hide / next-step / previous-step / next-scene / previous-scene / go-to-scene / set-course-state）；产品生成规范规则（步骤 id、after-previous / with-previous 分组、presentation.set 与导航各自独占收尾组），经既有 `addSlideSceneInteractionRule` 命令提交。
- 目标解析：节点 id/唯一 label、状态 id/唯一名称、跨 Surface Slide 场景 id/名称、courseState 声明校验，均给精确中文错误。
- 导航语义保持：next-step 先走当前页步骤、next-scene 跳过剩余步骤、go-to-scene 精确目标且仍限 Slide；跨 Surface 顺序目的地经既有播放语义实现。
- `presentation.set` 支持条件复用 `publishedInteractionSupport.ts` 同一判断，7 种不支持组合在作者边界明确拒绝、零写入。
- discovery 卡暴露 compose 并附语义 description（推荐）。
- 证据：`tests/unit/slideInteractionCompose.test.ts`（新，371 行）覆盖静态结构、事务只改指定对象、保存重开、Undo/Redo、7 种拒绝零写入、真实点击播放（显隐同步、步骤推进、scene.next 跳步骤、跨 Surface 到达 Flow 位置）。
- 更正：排查中曾疑“Player 二次点击失效”，证实为测试时序假象（导航门闩计数在宏任务释放），非 Player 缺陷，不新增反例。

## 3. F：正常候选交付与可恢复反馈（9ecc03c9）

- `src/main/localAgent/harness.ts`：模型声明交付 marker 但 `candidate.json` 缺失时，回合不再终态 protocol failure；`readCandidate()` 新增 `missing-candidate-delivery` 诊断（具体原因、预期产物、下一步），沿既有 `rejected → continue()` 链有界原生续接（formatRepairs 计数、>1 阻断、原预算原任务、已提交保留）。
- `scripts/candidate-helper.ts`：`ready-for-host` 输出新增当前请求 `declaration` 字段并改写 message，模型不再手抄组装 marker；`prechecked` 仍明确未交付。三事实（prechecked / ready-for-host / committed）在输出与诊断中可区分。
- 核对后确认无需重建：单次提交幂等/冲突拒绝、Stop/过期/身份失效零提交与迟到归档、暂存 realpath 闭包、controller 既有 rejected 续接链。
- 证据：`tests/unit/localAgentHarnessV2.test.ts` 88/88，含更新后的 missing 场景与新增“一次有界原生续接恢复声明缺文件”用例（同外部会话、新候选根、taskId/deadline 不变、零提交零回执）。

## 4. G：反馈核对、冻结验收输入与免费反例（b9a7ebeb）

- 反馈链缺口清单：`output/r19-efg-coordination/feedback-gap-checklist.md`。静态→对象、合同→交付两侧已通；缺口集中在播放期→反馈：G1 播放期诊断在试跑/预览被丢弃（`coursePlayerTryRun` 未注入 `reportDiagnostic`）、G2 observe 无期望对照、G3 committed 与可播放执行无回执关联、G4 缺可复用“点击→实际目的地”验收驱动。G1–G3 共用同一补接线点，待后续批次决策。
- 冻结有界共同目标：`output/r19-efg-coordination/bounded-goal/`（slide-heavy 课例逐字节副本、纯教师语言任务输入、运行前冻结的 acceptance.json：R1 初始视图、R2 两态图形可区分、R3 点击显隐、R4 实际点击目的地练习页、R5 只认 committed 回执 + 保存重开保持）。
- 免费反例：`tests/unit/r19EfgBoundedGoalCounterexamples.test.ts` 10/10——presentation.set 合法执行与 5 种不支持变体整规则拒绝（Player 诊断与共享支持函数逐字一致）、真实 fixture 播放序列与 step/scene 目的地语义、prechecked 被宿主结果 schema 拒绝、未交付结果零提交。

## 5. 汇合验证（集成后实际运行）

- 三套 tsconfig `tsc --noEmit`：通过。
- `vitest run tests/unit/slideInteractionCompose.test.ts tests/unit/r19EfgBoundedGoalCounterexamples.test.ts tests/unit/authoringSurfaceTools.test.ts tests/unit/nativeEditCapabilities.test.ts`：4 文件 39/39。
- `vitest run tests/unit/localAgentHarnessV2.test.ts`：88/88。
- `npm run generate:ai-capabilities`：77 个能力文件再生成并提交（E 的 discovery/schema 与 F 的 helper core 变化已吸收）。
- 已知基线红（非本批新增，F 在未改动基线上原样复现）：`generationCapabilityWorkspace.test.ts` 4 个 “wire prompt under 12 KiB” 失败；`check:ai-capabilities` 缺兄弟仓库组件目录快照。均与本批 diff 无关，保留待归属批次处理。

## 6. 未启动与边界

- 方案 6.4 三通道有界真实验证未启动：冻结任务包已就绪，Codex/Luna、OpenCode/Luna（支持则 Fast）、Claude/DeepSeek 各一项，独立副本、运行前冻结验收，结果用于收敛产品缺口，不替代 050。
- G1–G4 反馈链接线点未实施（只读核对结论，待与 E compose 实际运行结果一并决策）。
- 本批为 engineering candidate；不创建版本标签、不发布、050/060 与 Owner accepted 保持独立。
- 三端构建（Main/Renderer/Player）本批未重跑：E/F/G 改动均由 typecheck 与聚焦测试覆盖，构建证据待三通道验证批次按变化准备一次。
