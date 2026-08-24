# S2 Task Card — Honest Spatial Properties

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: 审计 `SPATIAL-03` 已确认 Spatial Properties 暴露名称、透明度、播放初始状态和文字样式等控件，而当前 Spatial `updateNodes` 只持久化少量通用状态与 world 几何；若 claim 时每个仍可见控件都能真实修改当前 `CourseProjectDocument`、产生恰好一条 Spatial 历史且失败反馈诚实，则跳过实现并记录逐控件证据。
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将逐控件 canonical-delta、一次历史及 focused UI/Store 结果绑定 product commit；仅任务卡、报告、task-board 或 generated 变化时复用，命中下列产品或测试路径时失效。
- Invalidating paths: `src/renderer/ui/PropertiesTab.tsx` 的 Spatial node 属性分支；`src/renderer/store/editorStore.ts#updateNodes`; `src/renderer/course/effectiveLayerCommands.ts` 的单项与原子批量 effective-layer patch；`src/renderer/course/spatialEditorCommands.ts` 的 Spatial 属性错误映射；`tests/unit/editorStore.test.ts`; `tests/unit/spatialProductIntegration.test.tsx`
- Task ID: `stab-spatial-01-honest-properties`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Spatial Properties Worker / independent Spatial canonical-write reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace with Store/Properties single-writer firewall / codex/architecture-stabilization`
- Baseline HEAD: `ddbe070` (owner-aware insertion closed at `59f5fdc`; Flow Properties formatting handoff closed at `27ff341`)
- Context Pack + manifest hash | bootstrap-manual: exact-source Bootstrap traced every visible Spatial Properties control through `updateNodes`, the active Spatial history and effective owner carriers; repo-index refresh remains deferred to the next wave gate.
- Freshness / relevant dirty inputs: worktree and every allowed product/test path were clean at claim. Reproduction confirmed name, opacity, playback initial visibility and whole-node text style could be silently dropped, geometry was world-only, and a multi-selection update could create partial/multiple history writes.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: 可见控件当前可能制造“成功但工程未变”的假象；修复不得建立第二套 Spatial 属性状态、绕过 active Spatial history 或误改 global/surface/world owner。
- Retry count / last failure class: `0 / none`

## Product outcome

教师在 Spatial 属性面板修改任一可见属性时，要么当前 canonical Course Project V9 真实改变并进入一次可撤销历史，要么控件被隐藏/明确禁用并解释原因；不再出现 toast 成功但课件未变。

## Current fact, canonical write and non-goals

- 审计证据：`PropertiesTab.tsx` 暴露的属性集合大于 `editorStore.ts#updateNodes` 的 Spatial 持久化集合，名称、透明度、播放初始状态和多项整节点文字样式可被静默忽略。
- Canonical write: 所有支持的 patch 必须通过 active `SpatialAuthoringSession.history.present` 写回唯一 `CourseProjectDocument`，成功一次只追加一条现有 Spatial history；无效、锁定、wrong-owner 或 no-op 结果为零写入、零历史。
- 非目标：不新增属性模型、第二 Store/History、V10、V9 字段语义变化或通用 Properties 框架；不借本卡扩充新的视觉样式能力。

## Scope, locks and acceptance

- Allowed write: `PropertiesTab.tsx` 的 Spatial 属性可见性/禁用分支，`editorStore.ts#updateNodes` 的 Spatial 路由，必要的现有有效图层 patch 命令，以及上述两个 focused 测试。
- Required read: Course Project V9 LayerItem/Native 字段、Spatial view/selection、active history persistence 和当前 UI 控件清单。
- Forbidden write: Schema/contracts、Player/Published/export、Slide/Flow 属性行为、Clipboard、App 快捷键、依赖与 generated 文件。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [ ] 为每个仍可见的 Spatial 属性建立“UI 操作 → canonical 字段 delta → 一条 history → undo/redo”证据。
  - [ ] 当前 carrier/owner 不支持的属性不再可提交，且提示不声称成功。
  - [ ] 多属性批量提交仍是一次用户操作、一条逻辑历史；no-op 不制造 revision/history。
  - [ ] global/surface/world 项不会被错误路由到 world transform。
  - [ ] 无 Schema、Player、导出或跨 Surface 能力扩张。

## Minimal validation

- `npx vitest run tests/unit/editorStore.test.ts tests/unit/spatialProductIntegration.test.tsx`
- 检查代表性的名称、透明度、初始状态、文字样式、几何、locked/visible 六类控件 canonical delta，并运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: `pending`; 完成时记录 product commit、逐控件 before/after、focused 命令结果、Reviewer 结论和仍被禁用的属性。
- Outcome boundary: focused 自动化最多把该行为提升为 `engineering candidate`，不声称 Spatial 整体可用、视觉合格或教师 `accepted`。
- Rollback: 从 claim baseline 以一个可独立 revert 的产品/测试提交回退；无用户数据迁移，旧字段保持原样。
- Semantic index impact: `canonical-update` only if the actual write path changes.
- Generated refresh: `defer-to-wave-gate`
