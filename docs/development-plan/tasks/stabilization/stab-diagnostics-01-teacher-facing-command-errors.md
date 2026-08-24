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
- Status: `done`
- Owner / Reviewer / Integrator: `Diagnostics Fix Worker / none / Coordinator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with Store diagnostic firewall / codex/architecture-stabilization`
- Baseline HEAD: `1347c0b` (owner-aware selection closed; Store lock released)
- Context: generated repo-index is intentionally stale after first-wave product commits; exact-source manual Bootstrap must trace `persistSpatialResult`, both reason shapes, `errorMessage` consumers and the existing local `reportDiagnostic` contract before writing.
- Freshness / relevant dirty inputs: worktree and the two allowed product/test paths were clean at claim; product baseline includes Spatial selection commit `82e59fc` and must preserve its failure-zero-write boundary.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-audit-closure-gate`
- Hotspot lock release: Store diagnostic lock released after product commit `ac5f0e6`.
- Retry count: `1` (the first test spy shape did not satisfy TypeScript; production behavior was unchanged and the focused harness was corrected.)

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
  - [x] 已知 Zod/command 失败在主 UI 显示短、具体、可恢复的中文提示，不含 JSON、`code` 或字段 `path`。
  - [x] 原始 reason 和足够上下文进入现有本地 Diagnostics；日志失败不得覆盖主错误或抛出新的用户错误。
  - [x] 失败保持 canonical document/revision/history/selection 零写入，成功路径完全不变。
  - [x] 不新增错误状态机、诊断 Store 或远程上报。

## Minimal validation

- `npx vitest run tests/unit/editorStore.test.ts`
- 复核一个结构化 Zod reason 和一个普通 command reason 的 UI/日志分流，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Product commit / result: `ac5f0e6` (`fix(spatial): separate teacher errors from diagnostics`); `persistSpatialResult` maps structured validation and ordinary command failures to bounded recoverable Chinese messages while retaining the raw reason in the existing local `reportDiagnostic` channel. Synchronous throws and rejected diagnostic promises are swallowed without replacing the teacher message, and failed commands remain zero-write.
- Validation evidence: the focused `editorStore.test.ts` run passed 65/65 at the product commit. At integrated product commit `b737820`, the 11-file stabilization run passed 165/165, `npm run typecheck` passed and `git diff --check` passed; only registered jsdom Canvas diagnostics remained.
- Review evidence: reviewer budget is `0`; the Coordinator inspected both reason shapes, bounded context, raw diagnostic preservation, diagnostic-failure isolation and the unchanged success/zero-write boundaries.
- Outcome boundary: 只证明 Spatial command 错误呈现为 `engineering candidate`；不证明具体错误已修复或整个 Diagnostics/产品 `accepted`。
- Rollback: `git revert ac5f0e6` restores the former presentation; diagnostic logs are local append-only records and no user project is migrated or rewritten.
- Semantic index impact: `canonical-update` for the Store error-presentation path.
- Generated refresh: `defer-to-wave-gate`
