# R0 独立重要接口审查

日期：2026-10-07。Reviewer：R-A0（未参与产品实现、设计落地或测试断言修改）。基线 `afc65c9e`；执行包从 `D:/果铃工作台/docs/development-plan/20261007-content-revision/` 读取。本文只裁决重要选择及具体证据缺口，不代表产品候选已验证、已合入或可发行。

## 结论

- **可继续实施**：I 的 K01/K02/K03/K06、U 的 TE03、H 的 S02、A02 的既有 sourceScopes 与 Flow paper owner 路线，以及 TE10 的既有替换 planner 迁移。均有当前 consumer 或已批准目标依据，不要求新增平台、DTO、逐包审批或全矩阵。
- **S03 自动授权分支尚缺接口证据**：同一 BrowserActionApprovals owner 是合适边界，但还需可读的可信授权 producer、冻结结果范围及内置/外部实际 consumer；单有“host 冻结 scope”的摘要不能证明不会把模型自报或 permission=full 当用户授权。仅该自动 grant 分支待补，S04 与无关任务继续。
- **H 草案两处必要修订已在新 diff 中确认**：升格后的 `mcp-stop`/signals 经 `app.quit()` 进入 GUI close；移除 windowLifecycleDesktop 重复 before-quit listener，避免取消后再次 X 被旧 quitRequested 影响。相应实际生命周期证据仍归 T04/候选 review。

## I：内容绑定、共同服务与能力披露

读取：`src/core/tools/ToolTargets.ts`、`ToolCatalog.ts`、`DocumentToolGateway.ts`；`src/shared/document/htmlText.ts`；`src/main/workbench/DocumentHostService.ts`、`workbenchToolServices.ts`、`execution/AgentFileService.ts`、`ExecutionEngine.ts`；作者窄接口说明。此时核心接口实施尚未形成固定候选。

当前 `readCourseInstanceText` / `sliceCourseInstanceText` / `courseInstanceTextEdit` 已持有真实字段与选区定位；`replaceCourseInstanceText` 会把所选富内容替成单文本段。Engine 的 `replace-text` 已有冻结目标、流式临时显示与最终一次应用。为富内容补适当 inline HTML 投影和同一 Gateway 应用，不需要第二内容模型或让模型填身份。保留最终 Session writer、版本/停止及未选字段保护。

当前 Office 服务已在 AgentFileService，但 Engine 私有追加工具/执行分支使外部共同 Gateway 漏接。实例归 DocumentHost、既有 parser/registration 绑定同服务，能在正确 owner 消除差异；只在 MCP 外加一份实现会留下重复规则。保持文件授权、observed binding、Stop、unknown 回执，不能因归并而丢失这些消费者。

当前 ToolCatalog 对 `courseAuthoring` 做减法，Gateway 把 loadedFamilies 作为可见名称集。移除方法读取对 read/save/inspect 的减法、分开 allowed 和 disclosed，有当前直接 consumer；精确调用自动接入仍必须检查真实 supports/grant。无需新目录同步平台。

最便宜的候选证据：一例真实 V10 富选区经冻结绑定应用，未选 link/style/math 身份及人工布局不变、一次 History；一个已存在 Office 操作沿人工/Engine/MCP 到同一 service；同 run 读 Skill 后原授权能力保留且未授权调用仍拒绝。可引用 T01/T02 同 cut 证据，不重复测试。`readHtmlDocumentText` 仅为 inline 投影，忽略媒体、不会自行表达任意块结构；候选不能把超出该槽位语义的结果静默压平。

## U：保存与未完成输入的生命周期

读取：`src/renderer/store/editorStore.ts`、`App.tsx`、`app/useCourseProjectLifecycle.ts`、`src/main/workbench/documentCloseCoordinator.ts`、`workbenchToolServices.ts`。当前 U 草案已把 advanced/property draft prepare 接入既有 flushDrafts，完整 durable recovery 接线仍在实施。

当前 Store 的 save/drain 是真实消费者；Main `DocumentDeliveryService.prepareDrafts` 已经通过 export port 的 `phase: drain` 到 GUI，因此继续复用该链合理，无须第二保存 IPC/History。当前 App 的 source dirty close gate 和 lifecycle 先 strict drain 再 preserve 会阻塞无效原稿保全；区分可提交与可保留正对应已批准结果。

必要边界：有效稿仍通过 bridge/Session 应用；无效 raw/诊断/原目标写入现恢复 owner 并等待写入结果后才退出；allSaved/dirty 必须包含 source/JSON/property 及 inactive document。不能只改窗口 close 而让 tab close 先被 strict drain 截断，或在 raw 尚未保存/恢复时显示 allSaved。

最低证据：有效 source/JSON 稿一次 Save 保存可见结果；无效 JSON 或数值 `-` 正常 preserve 退出后冷恢复原字符且不执行未完成副作用。两种属性可在同一实际副本链证明，不逐面板建重复矩阵。具体 durable API 和最终 diff 尚未到，R0 不把方向通过当生命周期通过。

## H：同一后台 Host 升格 GUI

读取：H worktree 的 `src/main/index.ts`、`windowLifecycle.ts`、`windowLifecycleDesktop.ts`、`external/ExternalMcpService.ts`、`externalDesktopService.ts` 及 direct baseline `workbenchToolServices`、`DocumentHostService.bootstrapCourse`、document close coordinator。观察的是工作中 diff，非固定提交。

`installWorkbenchToolServices` 的 installed guard、闭包 context 和 `bootstrapCourse` 返回 live V10 已提供同 owner 路径。将同一 context 的 headless 改为 false、注册成熟 GUI consumer 而不重建 Registry/Session 能保未保存工作与 History，结构方向可推进。

已发现并由作者修订的具体问题：

1. 原草案 headless 创建的进程升格后，mcp-stop/signals 仍直调 stopHeadlessHost，stopped=true 后 app.quit 会绕过 GUI 草稿保护。新 diff 已改为 app.quit。
2. index 和 windowLifecycleDesktop 各注册 before-quit，第二个 listener 可在第一次 close 消费 requestQuit 后重新置位，取消保存后下一次 X 会绕开正常 ask/tray。新 diff 已删除后者，只保单一 Main quit owner。

最低证据：后台改未保存 V10 → 同 profile GUI 同 PID/History 看见并继续编辑；SDK detach 保宿主；app.quit → 取消保存 → 普通 X 仍走正常 close 选择。pendingCalls 判断空闲长效连接不是忙，符合实际状态。无需新 TTL、会话平台或重放表。实际同宿主/取消动作尚待 T04，不能从静态 diff 声称通过。

## A02：合成 scope 与 Flow 背景

读取：`measurement/browserCapture.ts`、`prepareMeasurementDocument.ts`、`ElectronHtmlDesignMeasurement.ts`、`src/core/contentApply/assembly/htmlAssembly.ts`、`application/html.ts`、`applyService.ts`；FlowWorkspace 与 componentPlatform document/print 消费者。首候选 `78cdfc8d` 的后续合成 scope 尚在实施。

capture.sourceScopes → retainedMeasurementScopeHtml → retainedSource → guoling.web 已经是现存链。当前群组空 shell 与外置 children 会使 group opacity/filter 不能作用于后代，非 context positioned 父也不能凭新 wrapper 保跨父 z 绘制顺序。按真实 computed 效果保最窄共同 source scope 是当前保真问题的合理修正，不新增持久化 schema，不需重造 stacking algorithm。普通独立可映射内容继续原 orderedChildren/专业映射。

Flow 的正文背景 owner 是 `flow.layout.paperBackgroundColor`：`FlowWorkspace.tsx:413` 和 componentPlatform document/print 输出均消费它。整 surface redo 的可等价纯色只写该 owner 有直接依据；把同一 rgba 再写 surface.background 会重复叠加。局部 insert 不得借输入 root paint 改全页背景；复杂 root paint 保响应源文，不逐块复制背景。

最低证据：一页真实 V10 绘制比较覆盖题号/伪元素、重叠整体 opacity、必要的跨父 z 关系与 Flow 背景；测量失败保源码与用户取消零 commit 分开。复用 T07/T08 代表样例，字符串包含 CSS 不足以证明绘制。保源码不是允许丢资源、样式祖先或把静态结果称完整编辑性。

## 追加重要选择

### TE10 替换 planner：结构可推进

已读 `afc65c9e..8eed8d33` 的 `core/components/library/replacement.ts`、旧 renderer 文件、人工 `useComponentLibrary` 与 insertion 算法。原函数整体迁 core，renderer re-export 保现 consumer，仍经 `prepareComponentLibraryInsertion` 的 definitionBindings 并过滤 instance.insert，未新造替换规则。新的公共 asset.update 是直接消费需求；工程 definitionId 与库 packageId 不恒同，目标捕获与实际所选归档身份校验保护当前更新对象。

这里只确认职责迁移。公共 Gateway 接线与独立行为证据尚未提供，不能把该 cut 称人/内置/外部能力完成；用一例更新保 instance data/frame/override 和同 Session 撤回来核候选即可。

### A06/A07：内部共享方向可形成窄草案

已读 Session execute 与 CourseV10Driver、Journal append/checkpoint 基线。小编辑复制整 History/资源且重复验证同 candidate 有直接代码依据；Session 内部 copy-on-write 保未改资源引用、公有 read/commit/persistence 边界 detach、Journal 保单 record 完整恢复方向可推进。

必须保留的当前边界：historyGroup/amend 的 `previous.after/operationId/revision` 在持久化失败时不能污染旧 state；替换字节后旧 History 仍有旧内容；外部输入/恢复模型与产生的 candidate 仍在相应 owner 验证。拟新增的受信 applyValidated 只对已验证 Session-owned model有意义，不能把“受信”暴露给不受控 caller 或形成免验通用入口。

此项尚无实际 diff。先用改字资源复用、替换资源后 undo/redo/recover、append失败保持旧state的最近层证据决定；不因尚未测得残余成本立即扩大为增量资源 Journal/新缓存平台。后续固定候选另审。

## 本次证据限制

本次仅只读协议/合同、基线、direct consumers、工作中或明确 cut 的 diff，并与作者核对范围；没有运行产品、付费调用、构建或改写测试断言。未修改主树。后续 R1–R4 按实际候选与已有最小证据审查，既有无关绿证据继续有效。发行暂停。
