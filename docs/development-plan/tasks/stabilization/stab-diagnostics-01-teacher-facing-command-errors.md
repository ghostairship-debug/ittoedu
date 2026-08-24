# S0 Task Card — Teacher-facing Spatial Command Errors

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: implementation
- Necessity / skip condition: 审计 `SPATIAL-06` 已确认 `persistSpatialResult` 会把底层 command/Zod reason 原样写入 `errorMessage`，教师可看到 `code/path/message` JSON；若 claim 时可复现失败已显示具体、可恢复的教师提示，且原始 reason 同时进入现有 Diagnostics/日志而不出现在主 UI，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 5 minutes
- Reviewer budget: 0
- Evidence reuse: 执行后将教师提示、原始 reason 诊断记录和 focused Store 结果绑定 product commit；文档/任务板/generated-only 变化复用，命中下列呈现/日志/测试路径时失效。
- Invalidating paths: `src/renderer/store/editorStore.ts#persistSpatialResult`; `tests/unit/editorStore.test.ts`
- Task ID: `stab-diagnostics-01-teacher-facing-command-errors`
- Phase / wave: `post-audit stabilization / D-cross-surface`
- Status: `draft`
- Owner / Reviewer / Integrator: `Diagnostics Fix Worker / none / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `assigned at claim`
- Baseline HEAD: `record at claim`
- Context: `query persistSpatialResult and renderer diagnostic reporting at claim`
- Freshness / relevant dirty inputs: `verify the audit paths and related user changes at claim`
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-audit-closure-gate`
- Retry count: `0`

## Product outcome

Spatial 命令失败时，教师只看到说明发生了什么以及如何恢复的短提示；完整 command/Zod reason 保留在现有诊断日志供排查，主界面不再直接暴露 JSON、字段 path 或内部结构。

## Current fact, canonical write and non-goals

- 审计证据：`persistSpatialResult` 当前把 `result.reason` 直接赋给 `errorMessage`，order 冲突等失败会把完整 Zod JSON 暴露给教师。
- Canonical write: 本卡不增加工程写入；所有失败仍保持 document/revision/history/selection 零写入。原始 reason 只调用既有 `window.desktopAPI.reportDiagnostic` 通道，不进入 Course Project。
- 非目标：不重做全局错误中心、不吞掉 reason、不改变 Zod/command 结果、不新增遥测/网络服务，也不借此修复具体业务错误。

## Scope, locks and acceptance

- Allowed write: `persistSpatialResult` 的教师提示映射及调用既有 `window.desktopAPI.reportDiagnostic` 的窄分支，和 `tests/unit/editorStore.test.ts` 的 focused 断言。
- Required read: Spatial command reason 形状、UI errorMessage consumer，以及现有 `window.desktopAPI.reportDiagnostic` renderer contract。
- Forbidden write: Schema/contracts、业务命令成功路径、ProjectHealth 模型、网络/遥测、main/preload API 变化、dependencies/generated。
- Hotspot lock: Store 接入由 Coordinator 独占；本卡不得与 Spatial Store/History 卡并行写 `editorStore.ts`。
- Acceptance:
  - [ ] 已知 Zod/command 失败在主 UI 显示短、具体、可恢复的中文提示，不含 JSON、`code` 或字段 `path`。
  - [ ] 原始 reason 和足够上下文进入现有本地 Diagnostics；日志失败不得覆盖主错误或抛出新的用户错误。
  - [ ] 失败保持 canonical document/revision/history/selection 零写入，成功路径完全不变。
  - [ ] 不新增错误状态机、诊断 Store 或远程上报。

## Minimal validation

- `npx vitest run tests/unit/editorStore.test.ts`
- 复核一个结构化 Zod reason 和一个普通 command reason 的 UI/日志分流，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: `pending`; 完成时记录 product commit、两个 reason 的 UI/日志 before/after、focused 命令结果和 Coordinator 检查。
- Outcome boundary: 只证明 Spatial command 错误呈现为 `engineering candidate`；不证明具体错误已修复或整个 Diagnostics/产品 `accepted`。
- Rollback: 一个可独立 revert 的产品/测试提交恢复原呈现；诊断日志是本地追加记录，不迁移或重写用户工程。
- Semantic index impact: `canonical-update` for the Store error-presentation path.
- Generated refresh: `defer-to-wave-gate`
