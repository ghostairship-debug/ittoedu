# 2026-09-16 R/E/F/G 首次选路与原因驱动恢复实施记录

范围：[产品可用性方案第 6 节](../R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md#6-refg-批次首次选路原因驱动恢复与真实结果验证)的 R/E/F/G 四个产品工作包。本批只做产品代码与免费/真实宿主检查，未运行三通道付费自然任务；050/060 与 Owner accepted 保持独立。未提交、未建标签。

## R. 首次按真实能力选择路径（ROOT）

- 新增 `src/shared/courseAgentApplicability.ts`：`publishedInteractionPlaybackExclusions()` 由 interaction-v1 合同类型清单减去 `PUBLISHED_INTERACTION_PLAYBACK_SUPPORT` 支持表计算排除分组（同源：创作边界、健康诊断、Player 与本投影共用同一张表），每组带原因与经核实的可行替代；`generationApplicabilityProjection()` 输出紧凑投影与三路径选路规则。无第二能力 registry、无新授权。
- `src/renderer/authoring/generation/generationCapabilities.ts`：`generationCapabilityContext` 返回新增 `applicability` 字段并在 instruction 中指向它。
- `src/main/localAgent/profile.ts`：wire prompt 剥离 `applicability`（与 instruction 同一处理），完整投影留在暂存 `request.json` 并经 `requestDetails.fields` 公布 `context.capabilities.applicability`；适用性正文不重复注入 wire，但入口字段仍占用传输字节，不称“零新增字节”。
- 检查：`tests/unit/courseAgentApplicability.test.ts` 3/3（排除清单与"合同−支持表"完全同源；presentation.enter/presentation.in 首次排除且替代本身受支持；首次上下文携带投影）。

## E. 常规交互组合与导航目标

- `src/renderer/authoring/tools/slideInteractionTool.ts`：compose 输入 Schema 移除 `state-enter` 触发与 `inStates` 条件及两处映射（insert/replace 的完整 interaction-v1 规则 Schema 保留，工程表示能力不变）；工具描述补充限制与替代（click/presenter 触发 + 末尾 set-state；course-state.compare/exists；scene.in）。`locationItems` 改为只纳入 `entry.applicable` 条目，另一位置 visibility 排除当前页的 global/surface 图层不再参与重名判定，真实歧义仍报多义。
- 能力产物已重新生成并经 `--check` 确认一致（77 个文件）。
- 检查：`tests/unit/slideInteractionCompose.test.ts` 6/6（新增：两分支 Schema 拒绝、描述含替代；exclude 不误判/include 仍多义；既有点击播放、保存恢复、Undo/Redo 保留）；`tests/unit/aiCapabilities.test.ts` 12/12。

## F. 正常交付与按失败原因恢复

- incomplete 结构化：编辑 answer 缺交付时挂正式 `failure`（code `missing-candidate-delivery` 含预期产物与下一步），沿既有 rejected→有界续接链；`src/shared/generationResult.ts` additive、`harness.ts`、`generationTaskController.ts`。
- 同因判重：评审修正为 `failureReasonKey(failure, candidate)`，绑定具体 producer code、目标及失败字段值，移除外层步骤下标与目标的 revision/sessionGeneration；不以错误文字、摘要或 raw stepId 判重。`lastReasonKey` 仍是 optional 字段；新键使用 v2 前缀，旧任务字段可以读取。不能识别具体原因的包络错误只沿原有语义候选键判断停滞。
- 恢复扩面：`generationRecovery()` 覆盖 `unknown-tool`/`candidate-media-file`/`invalid-target`/`missing-candidate-delivery`/`dynamic-host-failed` 族；裸 `tool-failed` 不给建议。`executeAuthoringTool` 透传 cause 具体 code，receipt 合同不变。
- Stop/过期/身份失效零旧提交等边界经核对已有测试覆盖，未改逻辑。
- 检查：`tests/unit/localAgentHarnessV2.test.ts` 90/90、`tests/unit/generationTaskController.test.ts` 45/45、`tests/unit/localAgentTaskContract.test.ts` 19/19，及 generationRecovery/authoringToolReceipt/generationPreparationFailure/candidateChangeKey/generationFailureFeedback 全过。

## G. 可操作的观察与验证反馈

- G1：`src/renderer/ui/coursePlayerTryRun.ts` 新增 `onInteractionDiagnostic` 窄入口，经既有 `services.reportDiagnostic` 注入真实 Player；每会话 50 条有界环形缓冲，destroy 清理。
- G2：`src/renderer/authoring/generation/authoringObservation.ts` 观察宿主旁挂诊断读取口（序号式“自上次成功 capture 以来”），记录累计逐出数；观察包完成容量与 Schema 检查后才确认消费，失败重试保留诊断，首次捕获前溢出也标记 truncated。`capture()` 产出 `observation/interaction-diagnostics.json`（role runtime-evidence，含 code/ruleId/stepId/nodeId/phase/message 与 ageMs），随既有观察链回到原任务；纯反馈，不创建候选。
- G4：`src/renderer/authoring/tools/dynamicCandidateAdmission.ts` buttonCheck 增加可选目的地期望（`expectLocationId`/`expectStateId`），点击后只核对明确指定的字段并记录 matched，不把省略的状态替换为起始状态；缺省时保持只观察路径。证据中的期望字段可选，原有完整期望记录仍可读，`.strict()` 保留。
- ROOT 接线：Slide/Spatial 试跑与整课预览三处生产挂载经 `reportTryRunInteractionDiagnostic`（coursePlayerTryRun 导出）接通诊断采集并转发应用诊断日志，G1→G2 在真实观察链贯通。
- 检查：`tests/unit/coursePlayerTryRunDiagnostics.test.ts` 3/3、`tests/unit/authoringObservation.test.ts`（含新增诊断用例）全过、`tests/unit/dynamicButtonDestinationCheck.test.ts` 3/3、`tests/integration/publishedInteractionSlideHostIntegration.test.ts` 35/35。

## 汇合验证

- 三套 `tsc --noEmit`（主/electron/e2e）全过；`generate:ai-capabilities --check` 一致。
- 合并命名检查 11 个文件 210/210 通过；相邻套件（generationSnapshotFocus/Preflight、generationFailureFeedback、candidateChangeKey、localAgentTaskContract）全过。

## 基线红与遗留（如实保留）

1. **基线已红，非本批引入**：`tests/unit/generationCapabilityWorkspace.test.ts` 的 4 个 12 KiB wire prompt 预算用例在本批开工前的未提交集成基线上即失败（实测基线 codex prompt ≈ 17.2 KB）。本批未新增失败（shape-to-image 守卫仍过）。该预算回归归集成 Owner 处置，是 6.4 开测前值得核对的事实。
2. Flow 试跑走 `FlowSurfaceHost`（无 services/reportDiagnostic 通道），Flow 交互诊断未接；Slide/Spatial/整课预览已通。
3. G4 显隐断言未做：现有 DOM/观察设施无法在目的地检查点表达实例显隐；只核对 location/state。
4. `HostEvidenceRecorder`（Runtime act/assessment 证据，console 通道）未接入观察链。
5. G3 未建新 join 代码：诊断自带 ruleId/stepId/nodeId，与回执 affected 同轮回到任务即完成关联；如实测证明模型无法利用再补。
6. 无精确 failure 的 rejected 不再清空上次精确原因，但本次仅按语义候选变化判断；committed/unchanged 清空原因键。不同参数/目标修正允许重判，opaque 错误不被冒充为同一个已知能力缺口。
7. 本批全部免费/真实宿主证据；模型是否自然首次选对路径未验证。下列评审修正通过工程检查，三通道自然任务（Codex/Luna、OpenCode/Luna、Claude/DeepSeek 各一项冻结有界目标）仍待按 6.4 核对所需反馈范围并冻结计分字段后运行。

## 独立评审后的 6 项修正

- R：补齐正式支持表中已由 Player 实现的音视频动作/触发器；Player 删除私有支持清单，使用共享判断。类型级支持包含 conditionalActions，合法 presentation.set 不再被排除；完整规则继续执行原有条件守卫。
- F：交换合法步骤与失败步骤不再改变原因身份；Harness 实测三次等价拒绝到达既有停滞门。compose 的节点/状态解析提供具体 code/path，三次逐项修正得到三个原因，全部修正后经真实事务提交；参数值实质变化可在同一原生任务继续，opaque 失败回退到原有候选变化判断。
- G：附件超限导致 capture 失败后不丢诊断；真实会话首次 60 条诊断保留 50 条并报告 truncated；后续逐出与重复捕获正确。只指定 location 或 state 时仅核对对应字段，不阻断准入。
- 本轮验证：主程序、Electron、E2E 三套 `tsc --noEmit` 通过；重新生成 77 个能力文件，索引 16179 / 16384 字节。合并 13 文件 291 项通过：courseAgentApplicability、slideInteractionCompose、localAgentHarnessV2、generationTaskController、coursePlayerTryRunDiagnostics、dynamicButtonDestinationCheck、authoringObservation、candidateChangeKey、generationRecovery、localAgentTaskContract、aiCapabilities、publishedInteractionController、publishedInteractionSlideHostIntegration。
- 这 6 项的评审反例已作为正式回归落盘；无提交、标签、发行或新真实模型任务。上文初次实施的检查数量是历史记录，不代替本轮修正后的结果。

## ROOT 续行：传输修复与冻结自然任务验证

2026-09-16 Owner 继续授权后，按 6.4 使用原 `output/r19-efg-coordination/bounded-goal/` 任务包，未修改教师输入、R1–R5 或允许变化范围。三通道均从冻结工程创建独立课例副本；模型输入只有原教师要求，未追加内部工具、协议或修正提示。原 R/E/F/G 免费证据继续有效；本目标的 Slide 诊断、显隐与目的地由真实 Player 验证，Flow 诊断及通用显隐检查字段仍未扩展。

### 两项实际传输问题

1. `profile.ts` 的初始提示把同一创建推荐按目标/carrier 重复展开约 5.6 KiB，导致此前 4 个 12 KiB 预算用例失败。现在首轮保留派生 `createToolIds`，完整推荐、目标索引与条件保留在同一 `request.json`，并通过 `requestDetails.fields` 指向。已有工具完整 Schema、当前对象与素材路径保留。文字/图片 × 编辑/计划的四项各覆盖三适配器，均回到原预算内；未提高预算。
2. OpenCode 的自然任务实际出现 `Ripgrep JSON record exceeded 65536 bytes`。`candidateStaging.ts` 原本把请求序列化为单行，现改为多行 JSON，解析内容相同、wire prompt 不变。对同一冻结任务的原始暂存文件执行真实 `rg --json candidateHelper`：匹配记录由 **126687 字节降至 701 字节**，解析对象等价，详见 `output/r19-refg-validation/native-search-records.json`。此修复在任务原始请求已经暂存后落地，未改变正在运行的请求，未把这次结果宣称为修复后模型提速证据，也未重新付费测试。

验证：能力工作区 **28/28**（包含原四项预算及原生搜索长度反例）通过；主程序与 Electron 类型检查通过。自然任务前完整桌面构建通过；后续暂存格式变更又通过 28 项及 Electron 类型检查。无代码提交、标签或发行。

### 自然任务结果

证据目录：`output/r19-refg-validation/`，每轮保存配置、原生记录、首条候选、宿主结果、工程副本、实际 Player 截图及 `score.json`。时间是首次任务启动至原生完成，不含人工验收；首次交付正确性、工具恢复与宿主拒绝续跑分别记录。模型未产生结构化路由决定记录，路径由实际首条候选及原生工具轨迹判读，不称为已实现完整路由遥测。

| 通道 | 实际配置 | 原生耗时 / 回合 / 提交 | 首次交付与实际结果 |
|---|---|---|---|
| Codex | `gpt-5.6-luna` / medium / priority，原生已确认 | 129.855 秒 / 1 / 1 | 参数编辑 + `slide.interaction compose`，直接写 staged candidate 文件，未运行 helper。R1/R2/R4 通过，R3 失败，保存重开保留同一结果，R5 行为要求未通过。 |
| OpenCode | 原生目录 `openai/gpt-5.6-luna-fast`；`api.id=gpt-5.6-luna`、`serviceTier=priority`，会话确认 medium | 376.868 秒 / 1 / 1 | `project.document` 完整 V9 文件路径。本地 helper 因草稿路径不存在拒绝一次，模型自行改正后提交；R1–R5 全过，既有进入规则及未指定内容保留。计为任务内修复后正确，不是首次无拒绝成功；无宿主拒绝续跑、无人工修正，不补算快捷组合覆盖。 |
| Claude | 原生 `deepseek-flash[1M]`，resolved `deepseek-flash[1m]` / medium；配置 origin 为 `https://api.deepseek.com`，没有 Fast 控件 | 604.724 秒 / 1 / 1 | 参数编辑 + `slide.interaction compose`，helper 预检和交付均一次通过；R1–R5 全过，既有进入规则及未指定内容保留。首次候选正确；查阅时发生原生工具错误，不称全程无错误首过。 |

计分经完整本地工具记录复核：OpenCode 的 `candidate-precheck` 拒绝在序号 216，草稿路径修正后的预检/交付分别在 218/220，同一候选原因没有重复；原生超长搜索错误另有 4 次（同因重复 3 次），不可隐藏在“一个宿主回合”中。Claude 的预检/交付为 206/257，没有候选拒绝，但有 3 条失败的查阅/终端结果。Codex 有一次读取相对路径失败，候选直接交付，正确性仍失败。`score.json` 分开记录 firstCandidateCorrect、firstDeliveredCandidateCorrect、localHelperRecovery、hostRejectionRecovery、nativeToolFailures 与搜索重复；最初只按宿主提交计分的临时结论已纠正。

OpenCode 的原生 `explorer` 尝试解析插件默认 `opencode/deepseek-v4-flash-free`，在本地报 `Model not found`，没有获得该模型输出；主会话实际使用 Luna。不能据主会话配置称原生子任务路由也已验证。后续运行前须同时核对子任务默认模型；本次保留失败，不修改用户全局配置或换模型补跑。

速度口径：表中记录 task.startedAt 到原生 completed，包含该任务的准备/模型/工具等待，不含随后独立 Player 验收。未独立捕获宿主提交耗时及严格的首次正确时间戳，费用未知，不能用上述原生耗时冒充完整 time-to-correct。三项最终制品均已保存并重开；Codex 的 R5 失败指重开后互动仍错，不是保存丢失。三条回执均为 committed；receiptDelivery 为 pending 是原生回执送达状态，不能称工程未提交。

Codex 的失败不是候选漏交付：两项 `node.enter` 被排在 `presentation.set` 前，而基础态将两个目标设为 `visible:false`；实际 Player 报 `motion-failed`，该动作组失败使后面的状态切换未执行。教师“下一步”可进入证据态，颜色为 `#22c55e / #ef4444`，点击标注也能直接到练习页。未改这份候选或追加模型任务追绿。原 fixture 的 `scene.enter` 同时有一条已存在的隐藏图片动画失败，单独保留，不计作模型新增问题。

验收脚本曾先假定 shape 使用 SVG、误将控制器目录按钮也选为 scene，并在图片动画未结束时过早读取透明度；这些脚手架问题均按实际 Canvas/DOM 修正。颜色改读真实 Canvas 像素，场景限定正式 Slide 宿主，显隐等待实际动画完成。初始错误记录保留为 `harness-*.json`，不计模型错误；没有更改候选、冻结输入或验收要求。

下一步按真实缺口收敛：Codex 暴露了 `show` 动画与状态控制显隐之间的可行性条件，结构准入和主动结束没有发现该结果错误；先在正式能力/组合/反馈边界定位，不修改冻结候选追绿。OpenCode 的原生搜索失败还涉及聚合 `discovery-data.json`，本次多行修复仅证明 request.json 入口；不能声称消除了所有能力文件搜索超限。Claude 大量查阅后才交付，最终正确不能代替效率目标通过。Flow 诊断、通用显隐断言及其他 050 真实教师链缺口继续保留，未转移给 2.0。

以上只证明这一个有界任务的结果，不能覆盖三路径全部能力、1.9 普通教师整课成功率、050/060 或 Owner accepted。三份测试应用已正常关闭；未追加付费任务、修改原输入、提交代码或发布。
