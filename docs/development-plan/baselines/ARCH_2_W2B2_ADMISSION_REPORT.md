# ARCH-2 W2-B2 剩余候选域准入报告

记录时间：2026-08-24（Asia/Shanghai）  
证据基线：`16c787f`，repo-index `fresh / high confidence / safe-for-S2`  
任务卡：`arch-2-b2-00-remaining-domain-admission`

## 1. 结论

| 候选域 | 决定 | 下一步 |
|---|---|---|
| Global Layers / Teacher Controller | `admit` | 修复 Flow/Spatial 全局“成品控制”合法 UI 静默 no-op；保留已经成立的 ownership/order/save/Player 边界 |
| Diagnostics | `admit` | 只创建一张“工程检查面板按需计算”实现卡；不迁移 V8 report ownership，不建设四层诊断框架 |
| Save / Recovery | `skip / retained` | 继续由 App/Persistence 拥有；没有可复现 bug、未服务 consumer 或明确替代目标 |

本次只读审计没有修改产品、测试、合同或 Legacy 台账。只有源码可确定复现的跨 Surface 成品控制 no-op 与关闭面板重复分析通过准入。

## 2. Global Layers / Teacher Controller：准入成品控制接线修复

### 当前纵切成立

- Course Project V9 Schema 对有效 location 组合检查跨 owner 的唯一 `layerItemId` 和唯一 `order`，且继续以 `globalLayerItems` / `surfaceLayerItems` / local storage 为 canonical carrier：`src/shared/contracts/course-project-v9/schema.ts` 的 scoped-layer refinements。
- `src/renderer/course/effectiveLayerProjection.ts#projectEffectiveLayers` 组合 global、surface、scene/world，按 authored `order` 与稳定 ID 排序，同时保留 source、owner 和 authoring address。
- `src/renderer/course/effectiveLayerCommands.ts` 只允许 owner 内排序；混合 owner 排序明确失败。`src/renderer/course/globalLayerCommands.ts` 阻止复制 Controller、阻止移出 global，并只把缺失 Controller 恢复到 global。
- `src/renderer/export/course/buildPublishedCourse.ts` 原样投影 scoped item 与 visibility。`tests/unit/courseProjectRoundTrip.test.ts` 对 committed V9 fixtures 执行 archive reopen + publish，并证明 controller 只在 global、scene 不产生副本。
- 三个运行 host 都消费 authored order：`src/player/surfaces/slide/SlidePublishedAdapter.ts`、`src/player/surfaces/flow/FlowSurfaceHost.ts`、`src/player/surfaces/spatial/spatialModel.ts`。
- Controller 拖动只改变 Player session 的 `sessionOffset`，不写作者工程：`src/player/renderTeacherController.ts`；现有 `flowSurfaceHost` unit 与 desktop recovery/Player evidence 保持该边界。

现有 focused evidence 包括 `effectiveLayerCommands.test.ts`、`effectiveLayerProjection.test.ts`、`v9GlobalLayerUiAdapter.test.tsx`、`flowUnifiedLayers.test.tsx`、`flowSurfaceHost.test.ts` 与 `courseProjectRoundTrip.test.ts`。本卡未命中其 Invalidating paths，因此复用既有结果，不重复运行。

### 可达反例与准入范围

`src/renderer/ui/PropertiesTab.tsx` 在 global scope 为 Flow/Spatial 展示“导航控制方式”、键盘导航、Presenter 与“添加或定位教师控制器”；`src/renderer/ui/ElementsTab.tsx` 也在专业 global scope 暴露教师控制器按钮。这是合法、可达的真实 consumer。

- `src/renderer/store/editorStore.ts#ensureTeacherController` 只显式处理 Spatial 与 Slide。Flow 会落入已禁止写入的 legacy `commit` no-op，随后仍显示“已添加画布内教师控制器”。
- `editorStore.ts#updatePlayback` 只显式处理 Slide。Flow/Spatial 的 `controls`、`keyboardNavigation` 与 `presenter` patch 同样落入 no-op，却仍显示“成品控制设置已更新”。

下一张卡把这一个 UI workflow 限定为：在 Flow/Spatial global authoring 中，添加/恢复单份 Controller 以及修改成品控制设置都写入当前 canonical V9 document，并各自产生一条现有 Surface history；反馈必须与写入结果一致。最短范围是 `globalLayerCommands.ts`、`editorStore.ts` 与 `globalEditorStore.test.ts`，不改 Properties/Elements、Schema、Player、Published producer 或 archive。

仍然保留：`Workspace.tsx` / `PropertiesTab.tsx` 的 V8-shaped projection 属 `LEG-001`，本波不为其单点造 seam；Schema 也不为假设外部重复 Controller 收紧。

## 3. Diagnostics：只准入按需计算小修

### 确定性复现

- `src/renderer/App.tsx` 永久挂载 `ProjectHealthPanel`，只通过 `open={projectHealthOpen}` 控制可见性。
- `src/renderer/ui/ProjectHealthPanel.tsx` 在 `if (!open) return null` 之前执行 `collectProjectHealth`、`analyzeInformationRelease` 与 `analyzeVisualDensity`。
- 因此面板关闭时，每次 project/component identity 变化仍执行三套完整分析。App 为 Toolbar 摘要另执行一次 `collectProjectHealth`，关闭面板时形成确定性的重复健康计算。
- 这直接违反 `docs/development-plan/20-modules/09_DIAGNOSTICS_AND_ANALYSIS.md` 的现行规则：完整作者分析只在打开专业面板时按需运行。

### 唯一允许实现

该卡只保证：面板关闭时 `ProjectHealthPanel` 自身的三个 collector 调用均为 0；App 为 Toolbar summary 保留的一次 `collectProjectHealth` 不在范围内。打开面板时必须基于最新工程计算，并保持既有 summary、定位和导出诊断行为。

最短范围：

- `src/renderer/ui/ProjectHealthPanel.tsx`
- 新增 `tests/unit/projectHealthPanel.test.tsx`

实现必须使用 open-only child/mount boundary，不新增 Diagnostics API，不修改 Store、App 生命周期、V8/V9 report、诊断码、导航或 `LEG-006` / `LEG-007`。若必须触及这些范围则停止并重做准入。

## 4. Save / Recovery：skip / retained

- `src/renderer/App.tsx` 的 manual save snapshot 包含 active V9 document、asset sidecar 与 component packages；保存期间编辑检测同时比较三者的身份。
- Recovery snapshot 同样覆盖三类输入，并由 `src/renderer/project/recoveryWriteCoordinator.ts` 提供 debounce、cancel 与 single-flight。
- `src/main/projectPersistence.ts` 校验 V9 ZIP、大小和哈希后原子写 package/metadata。
- manual save 与 recovery 是两个真实 consumer，但已共用 `saveCourseProjectDocumentAsync`；不存在需要再抽 Port、Service 或 session coordinator 的 consumer 缺口。
- `src/renderer/project/saveProject.ts` 是 `LEG-008` 保留的 V8 tooling/test adapter，不是当前产品保存入口，不在 ARCH-2 单点迁移。

现有证据包括 `recoveryWriteCoordinator.test.ts`、`projectPersistence.test.ts`、`projectFormatIsolation.test.ts`、desktop 自动恢复流程，以及 W2-B1 的完整 desktop `30/30`。当前没有已复现保存/恢复错误、未服务的第三个产品 consumer、明确旧产品入口替代目标或改变 IPC/archive 语义的理由。

复审触发器：可复现 edit-during-save/clear/write 或跨项目 recovery race；出现第三个共享 snapshot lifecycle 的产品 consumer；明确指定淘汰旧产品入口；或资源原地修改被证明绕过当前 identity 检测。

## 5. 分层结果与下一步

- Pipeline：`V0 pass pending final task-board/link/diff check`；未运行产品测试。
- Engineering：Save/Recovery 以可复核 skip/retained 结束；Global/Controller 与 Diagnostics 各准入一张最小实现卡；没有 speculative framework、第二份真相或产品扩张。
- Outcome：产品行为未在本审计中改变。
- Accepted：不适用；自动审计不产生教师接受结论。
- 下一允许任务：`arch-2-b2-01-cross-surface-global-playback-controls`；完成后执行 `arch-2-b2-02-project-health-panel-on-demand-analysis`，再进入 ARCH-2 phase gate。不得把本报告解释为 ARCH-2 已关闭。
