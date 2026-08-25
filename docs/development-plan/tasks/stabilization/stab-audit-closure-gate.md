# S2 Task Card — Post-audit Stabilization Closure

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: docs
- Necessity / skip condition: 根审计的全部 29 个编号问题、三个条件性合同候选、性能风险和验证错配必须有终态证据或明确 skip/reject/defer 处置；任一项缺少映射或仍无处置时不得关闭。
- Complexity delta: subtractive
- Validation ceiling: V0
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 复用 Wave A/B/C、focused 任务、合同裁决和性能处置绑定固定候选的证据；closure 只检查覆盖、终态和证据 freshness，不重复产品测试、浏览器、typecheck 或打包。仅 closure 卡、报告、TASK_BOARD、repo-index 或其他 generated 变化不使产品证据失效。
- Invalidating paths: `PRODUCT_DEEP_AUDIT_2026-08-24.md`; `COURSEWARE_DEVELOPMENT_PLAN.md`; the state/result or product/test/contract invalidating paths of cards named in Depends on; excludes closure-only cards/reports, TASK_BOARD and repo-index/generated-only refreshes
- Task ID: `stab-audit-closure-gate`
- Phase / wave: `post-audit stabilization / audit closure`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Stabilization Integrator / Product-truth Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared root / codex/architecture-stabilization`
- Baseline HEAD: audit revision `5c512f9`; final integrated product `23f2d00`; Wave C closure `2aba2fa`; all named dependencies have an explicit terminal disposition.
- Depends on: `stab-wave-a-core-usability`, `stab-wave-b-ownership-controller`, `stab-wave-c-flow-authoring`, `stab-cross-01-surface-aware-insertion-affordance`, `stab-cross-02-interaction-properties-entry`, `stab-diagnostics-01-teacher-facing-command-errors`, `stab-flow-10-inline-formula-contract-and-vertical-slice`, `stab-flow-11-video-playback-contract-decision`, `stab-flow-12-image-editing-contract-decision`, `stab-perf-00-packaged-startup-baseline`
- Blocks: claim of a new ARCH-5 final-candidate card
- Retry count / last failure class: `0 / closure inventory in progress`

## Product outcome

审计稳定化只在每个已知风险都有可追溯处置、P0 为零且旧 pipeline 证据不再冒充当前用户结果时关闭；关闭后才允许领取新的固定最终候选。

## Scope and acceptance

- 建立审计 ID → 任务卡 → product commit/skip/reject/defer → focused/wave evidence → outcome status 的 29/29 覆盖表。
- 合同卡只需有明确批准、拒绝或延后；批准产生的新实现卡必须先完成，拒绝/延后不得留下占位字段或产品差异。
- 性能处置必须明确绑定下一次最终候选的唯一打包产物；本门不提前重复打包。
- 所有 P0 为零；作者工程可保存但 Preview/Player 拒绝为零；公开属性/复制/粘贴/重复 silent no-op 为零；三 Surface 页面作者态命中控制器为零。
- 任一依赖证据因 exact invalidating path 失效时，只补对应窄卡；本门不得运行完整 E2E、完整打包、全仓 verify 或导出矩阵。
- Pipeline、engineering candidate、用户结果、视觉与教师/product accepted 分开记录；最终发布/accepted 仍由产品 Owner 决定。

## Minimal validation

- 静态复核 29/29 覆盖、依赖卡终态/处置、候选提交和证据 freshness。
- `npm run check:task-board`
- `npm run repo:index:check`
- `git diff --check`

## Result and rollback

- Planned result: 输出审计关闭记录和下一张 ARCH-5 final-candidate 的精确输入；未满足时列出最小阻断卡并保持 draft。
- Rollback: 只回滚 closure 记录和状态；各产品修复、合同与性能处置维持独立回滚链。
