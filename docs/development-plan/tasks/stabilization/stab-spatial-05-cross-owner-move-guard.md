# S1 Task Card — Guard Spatial Cross-owner Moves

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: 审计 `SPATIAL-05` 已确认图层跨 owner 拖放会在 global viewport 与 surface/world 坐标之间移动同一 frame 而不换算，导致视觉跳位；若 claim 时所有 world↔viewport 拖放已在提交前被拒绝、UI 明确解释且同 owner reorder 保持可用，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 9 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将跨坐标 owner 零写入、说明文案和同 owner reorder 结果绑定 product commit；文档/任务板/generated-only 变化复用，命中下列拖放、命令或 focused 测试时失效。
- Invalidating paths: `src/renderer/ui/NodesTab.tsx`; `src/renderer/store/editorStore.ts#moveCandidateLayerOwner`; `src/renderer/course/effectiveLayerCommands.ts#moveEffectiveLayerOwner`; `src/renderer/course/spatialEditorView.ts#spatialLayerCoordinateSpace`; `tests/unit/effectiveLayerCommands.test.ts`; `tests/unit/v9GlobalLayerUiAdapter.test.tsx`
- Task ID: `stab-spatial-05-cross-owner-move-guard`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Spatial Layer Guard Worker / independent coordinate-semantics reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace with Store/Nodes single-writer firewall / codex/architecture-stabilization`
- Baseline HEAD: `3a73bdc` (cross-Surface canonical history integrated; worktree clean)
- Context: `bootstrap-manual: exact-source trace from NodesTab DnD through moveCandidateLayerOwner/moveEffectiveLayerOwner to spatialLayerCoordinateSpace`
- Freshness / relevant dirty inputs: `At 3a73bdc, a world item can still move to global with unchanged frame and one history entry; global is viewport while surface/world are world coordinates. NodesTab collision snapping only protects teacher-controller ownership and can hide the actual cross-coordinate target. Focused baseline remains the two named suites.`
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Retry count: `0`

## Product outcome

教师不能再把 Spatial 项无换算地从 world/surface 坐标空间拖进 global viewport（或反向）并造成跳位；产品在拖放前阻止该动作并解释原因，而同 owner 层级排序继续正常工作。

## Current fact, canonical write and non-goals

- 审计证据：NodesTab 允许跨 owner drop，`moveEffectiveLayerOwner` 保留原 frame；global 使用 viewport 坐标，surface/world 使用 world 坐标。
- Canonical write: 被拒绝的跨坐标 owner move 对唯一 `CourseProjectDocument`、revision、history、selection 都是零写入；合法同 owner reorder 继续通过现有 effective-layer command 一次提交。
- 非目标：不建立通用坐标转换系统、不添加 world↔viewport authored transform、不修改 Schema，也不禁止同一坐标空间内已经安全且有证据的操作。

## Scope, locks and acceptance

- Allowed write: NodesTab 跨 owner drop guard/反馈、现有 effective-layer owner move 的拒绝边界、必要的 Store reason 映射及两个 focused 测试。
- Required read: Spatial global/surface/world 坐标定义、effective layer owner/address、同 owner reorder。
- Forbidden write: 新坐标抽象、camera/session transform、Schema/contracts、Properties/Clipboard、Player/Published/export、Slide/Flow DnD、dependencies/generated。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [ ] world/surface↔global 拖放在 preview/commit 前被拒绝并显示教师可理解原因。
  - [ ] 拒绝路径 document/revision/history/selection 均不变，且不显示“已移动”成功状态。
  - [ ] global 内、world 内及其他已证明同坐标空间的 reorder 保持一次 canonical 写入和 undo/redo。
  - [ ] 不新增通用坐标系统或隐式 frame 换算。

## Minimal validation

- `npx vitest run tests/unit/effectiveLayerCommands.test.ts tests/unit/v9GlobalLayerUiAdapter.test.tsx`
- 检查一次被拒绝的跨 owner drop 和一次合法同 owner reorder，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: `pending`; 完成时记录 product commit、零写入拒绝证据、合法 reorder 结果和 Reviewer 结论。
- Outcome boundary: 只证明不安全跨 owner 移动已被诚实阻止；不声称已支持坐标转换或 Spatial 整体 `accepted`。
- Rollback: 一个可独立 revert 的产品/测试提交恢复旧拖放路径；无合同或用户数据迁移。
- Semantic index impact: `canonical-update` if the command boundary changes.
- Generated refresh: `defer-to-wave-gate`
