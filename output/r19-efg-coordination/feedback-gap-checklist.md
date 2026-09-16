# G 工作包 · 反馈链缺口核对（只读盘点，2026-09-16）

核对问题（方案 6.3 G）：把“已明确的期望状态、显隐和目的地”与实际结果对照并反馈到对应对象/动作，现有接线具体到哪里、缺口是什么。只报告，不修改现有实现。行号基于集成本基线 f382eed6。

## 现有接线（已存在、可复用）

| 环节 | 位置 | 实际能力 |
|---|---|---|
| 支持条件单一判断 | `src/shared/publishedInteractionSupport.ts` | `publishedPresentationSetUnsupportedReason` 给出 presentation.set 不支持的具体中文原因；trigger/condition/action 支持集同源 |
| 静态健康检查 | `src/shared/courseProjectHealth/interaction.ts`（如 :358 `published-interaction-action-unsupported`） | 与 Player 共用同一支持判断；诊断带 ruleRefs/路径，`src/renderer/diagnostics/projectHealthNavigation.ts` 可跳到对应对象 |
| 导出预检 | `src/renderer/export/exportPreflight.ts` | 健康诊断以 `project-health:` 前缀进导出报告（error/warning/info 汇总） |
| Player 绑定期拒绝 | `src/player/interactions/PublishedInteractionController.ts:195-259` | 不支持的 presentation.set 整规则拒绝，发 `unsupported-action` 诊断（含共享函数的同一原因），不装点击绑定、不静默丢动作 |
| Player 执行期失败 | 同上 :792-800、:876 | 导航/动作返回 false 或抛错时发 `navigation-failed` 等诊断，带 ruleId/stepId/nodeId |
| 工程观察（observe） | `src/renderer/authoring/generation/authoringObservation.ts` + `src/shared/authoringObservation.ts` | 观察含 structure / image（强制真实截图）/ runtime-evidence 三类文件；`publishedDynamicHosts.ts:480-492 readObservationState()` 提供当前 locationId/stateId/stateVersion |
| 提交后反馈循环 | `src/renderer/authoring/generation/generationTaskController.ts:303-330` | committed 后按 afterCommit observe/finish 重新观察并把结果回喂原生会话 |
| 预检 vs 交付 | `scripts/candidate-helper.ts:68-73`、`src/shared/localAgentTaskContract.ts:129-153`、`src/shared/localAgentTaskGuards.ts:55-75` | `prechecked`/`ready-for-host` 与宿主 `committed` 三事实区分；合同规定只有正式应用结果可声明 afterCommit、完成必须 committed/unchanged+finish |

## 缺口清单

### G1 · Player 播放期诊断在应用内试跑/预览被丢弃（最主要缺口）

- **现有机制位置**：`PublishedInteractionController` 的诊断只走可选回调 `reportDiagnostic`（`PublishedInteractionController.ts:42`）；`createPublishedCourseSession` 的 services 里 `reportDiagnostic` 来自 `options.services`（`publishedDynamicHosts.ts:1601-1607`）。
- **缺口**：应用内试跑/预览入口 `src/renderer/ui/coursePlayerTryRun.ts:149-165` 创建 session 时不传 `services.reportDiagnostic`，全仓库 Renderer 侧也没有任何 player services 的 `reportDiagnostic` 接线（仅 ErrorBoundary/渲染诊断走 `diagnostics:report` IPC，`src/main/ipc.ts:781`）。结果：规则被 Player 跳过、点击导航未执行等警告在教师试跑和模型 observe 的宿主里都不可见；“合法结构但播放不执行”只能等人工 QA 发现。
- **建议补接线点**：`coursePlayerTryRun.ts` 创建 session 时注入 `reportDiagnostic`，汇入既有 `diagnostics:report` IPC 或预览诊断条；诊断已带 ruleId/stepId/surfaceId，可直接映射到对象/动作。

### G2 · 观察不含交互诊断，也没有“期望 vs 实际”对照字段

- **现有机制位置**：观察文件 schema 只有 structure/image/runtime-evidence 三种 role（`authoringObservation.ts` shared schema）；runtime-evidence 只来自 Runtime/Component 行为证据（`generationBehaviorResources.ts`、`dynamicBehaviorObservation.ts`）。
- **缺口**：Native 交互规则的绑定跳过、导航失败不在观察内；observe 回包也没有“期望 locationId/stateId/显隐 vs 实际”的结构化对照——模型只能自行看截图推断，与“已明确的期望状态、显隐和目的地”对照靠模型自觉。G1 落地前即使接了诊断，observe 也拿不到。
- **建议补接线点**：观察的 runtime-evidence 扩展（或新增受控 role）纳入当前宿主会话的交互诊断摘要；`readObservationState()` 已有 locationId/stateId，任务侧若声明了期望目的地（如有界任务包的 R3/R4），可在回喂文本中并排给出期望与实际，不需要通用语义评分器。

### G3 · “已提交”与“可播放执行”之间无回执关联

- **现有机制位置**：canonical 事务回执只记录结构事务结果（`localAgentTaskContract.ts` generationCommitReceiptSchema）；播放期跳过只进 G1 的可选诊断。
- **缺口**：候选 `committed` 后，没有任何机制把“该候选新增/修改的规则在 Player 被跳过”反馈到对应规则/动作；教师看到“已提交成功”但互动实际不执行时，产品上无入口指向原因。静态健康检查能覆盖一部分（同一支持判断），但动态执行失败（如导航守卫拦截、goToScene 目标缺失）只有运行期才知道。
- **建议补接线点**：G1 的诊断流落地后，G 验收用同一诊断流核对 committed 候选的受影响规则（试跑一次受影响场景即可）；不需要改提交合同。

### G4 · 目的地语义有定义、有试用导航端口，但无可复用的“点击→断言实际目的地”检查链

- **现有机制位置**：step/scene 语义在 `src/player/navigation/coursePlaybackSequence.ts:130-145 adjacentPlaybackTarget`；能力说明同源（`publishedInteractionSupport.ts:40-45 navigationSemantics`）；`src/renderer/ui/locationTryRunNavigation.ts` 是教师控制器 UI 的只读导航视图。
- **缺口**：此前“真实点击并断言实际 locationId/stateId”靠一次性 QA 脚本（如 final-closeout 的 same-artifact-state-switch），不是可复用产品接线；`createLocationTryRunNavigation` 只读不算执行点击。G 的验收需要每个模型制品核对受影响的真实结果，目前没有固定入口。
- **建议补接线点**：复用 `createPublishedCourseSession` + `getPlaybackProgress()`/`readObservationState()` 写验收驱动（本批已在 `tests/unit/r19EfgBoundedGoalCounterexamples.test.ts` 覆盖纯函数层目的地语义）；真实宿主点击检查待 E/F 可运行后按任务包 R3/R4 启用。

### G5 · 只预检未交付：合同侧已封死，续接反馈属 F

- **现有机制位置**：helper 干跑回执明确 `delivery: not-delivered`（candidate-helper.ts:70-71）；宿主合同无 `prechecked` 状态、未交付不能声明 afterCommit（localAgentTaskContract.ts:147）；`acceptAiHostResult` 只在 committed/unchanged+finish 时完成（localAgentTaskGuards.ts:71）。
- **缺口**：合同与守卫已不承认“只预检”，新增反例测试已锁定（反例 3）。剩余的“模型只跑 --check 后宿主是否有界续接并给出具体原因”属 F 工作包（`localAgent/harness.ts` 续接路径），G 不复制模型循环，只在 E/F 落地后用任务包 R5 验证效果。
- **建议补接线点**：无（G 侧）；真实效果验证挂在任务包 R5。

## 结论

现有接线覆盖了**静态→对象**（健康检查/导出预检带路径可跳转）与**合同→交付**（预检/提交三事实），主要缺口集中在**播放期→反馈**：Player 运行期诊断在应用内被丢弃（G1），observe 拿不到交互诊断与期望对照（G2），提交回执与播放执行无关联（G3）。三者共用同一个补接线点（G1 的诊断注入），落地后 G4 的验收驱动和任务包 R1–R5 即可在真实宿主上核对，不需要新建第二反馈通道或通用评分器。
