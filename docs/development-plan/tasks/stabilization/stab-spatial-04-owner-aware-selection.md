# S2 Task Card — Owner-aware Spatial Layer Selection

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: 审计 `SPATIAL-02` 已确认统一图层投影可显示 global、surface、world 行，但 NodesTab 统一调用 `selectNode`，而 `selectSpatialLayers` 只接受当前 session scope，导致部分可见行无法选择；若 claim 时所有当前可见且公开承诺可编辑的 owner 行都有稳定 authoringAddress、可进入已有正确 scope 并真实选择对应 canonical item，其他行已隐藏、只读或有 skip evidence，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 12 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将可见行、authoringAddress、scope、selection 和无文档写入证据绑定 product commit；文档/任务板/generated-only 变化复用，命中下列图层、选择或 focused 测试时失效。
- Invalidating paths: `src/renderer/ui/NodesTab.tsx`; `src/renderer/store/editorStore.ts#selectNode/#setEditingScope`; `src/renderer/course/spatialEditorCommands.ts#selectSpatialLayers`; `src/renderer/authoring/spatialWorldAuthoring.ts` 的 scope/selection adapter；`tests/unit/spatialProductIntegration.test.tsx`; `tests/unit/spatialWorkspaceAuthoring.test.ts`
- Task ID: `stab-spatial-04-owner-aware-selection`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `done`
- Owner / Reviewer / Integrator: `Spatial Selection Worker / independent authoring-address reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with Spatial Store/selection firewall / codex/architecture-stabilization`
- Baseline HEAD: `68cfc91` (Wave A gate released and generated index fresh)
- Context Pack + manifest hash | bootstrap-manual: fresh query on `Spatial effective layers selectNode selectSpatialLayers authoringAddress owner scope` returned low confidence and required Bootstrap; the prepared manual Bootstrap reproduced global/surface row refusal through the exact Store/session path and identified the existing scope transition boundary.
- Freshness / relevant dirty inputs: worktree and every listed product/test path were clean at claim; repo-index source, semantic, config and tool inputs all matched.
- Hotspot lock release: Spatial Store/selection and the two focused test locks released after product commit `82e59fc`.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: 可见但不可选的行是伪入口；修复必须让选择只改变作者会话而不误写工程，也不能用临时 hitId 代替稳定 authoringAddress。
- Retry count / last failure class: `1 / independent review found that a rejected cross-owner additive click could first persist an open dirty text draft; preflight now occurs before any draft commit and the dirty-edit counterexample is covered`

## Product outcome

Spatial 统一图层中每一条当前可见且公开承诺可编辑的 owner 行都能定位到稳定 authoringAddress，并在已有正确 authoring scope 中选择真实 canonical item；没有真实入口/consumer 的 owner 不显示成可操作入口。

## Current fact, canonical write and non-goals

- 审计证据：有效图层投影包含三个 owner，NodesTab 却统一调 `selectNode`；Spatial command 根据 session scope 拒绝其他 owner，surface scope 类型存在但缺可达入口。
- Canonical write: 选择本身是 session-only，不修改 `CourseProjectDocument`、revision 或 history；后续属性/删除/变换必须通过选中行的稳定 authoringAddress 写向该地址所指的 canonical owner。
- 非目标：不新增选择 Store、持久化 selection、surface scope 入口、通用 scope 状态机、跨 Surface 多选或临时 hitId 合同；不为 owner 对称性改变 Slide/Flow 选择语义。

## Scope, locks and acceptance

- Allowed write: NodesTab 的 owner-aware 选择入口、Store 的 Spatial selection/scope 路由、现有 Spatial authoring adapter 和两个 focused 测试。
- Required read: effective layer projection、authoringAddress parser/builder、global/surface/world session scope 与选中项属性消费者。
- Forbidden write: Schema/contracts、Player/Published/export、Properties patch、Clipboard/duplicate、跨 owner move 实现、dependencies/generated。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [ ] 每个当前可见且公开承诺可编辑的 owner 至少一个行可被选择，选中 ID、scope、owner 和 authoringAddress 一致。
  - [ ] surface 若无真实入口/consumer，则隐藏、只读或以 skip evidence 关闭；不得新造 scope 入口满足对称矩阵。
  - [ ] 选择不改变 document/revision/history；失败不清空原选择或伪报成功。
  - [ ] 切换 owner 后 Properties/删除等消费者读取同一稳定地址，不出现“幽灵层”。
  - [ ] 当前无合法编辑路径的 owner 行不以可点击/可键盘聚焦形式出现，并解释限制。
  - [ ] 教师控制器仍服从独立的页面 inert / 全局层唯一作者入口决策。

## Minimal validation

- `npx vitest run tests/unit/spatialProductIntegration.test.tsx tests/unit/spatialWorkspaceAuthoring.test.ts`
- 检查当前公开可编辑 owner 的 selection/address、无 consumer owner 的处置以及零 document/history delta，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: product commit `82e59fc`. Unified global, surface and world rows resolve their stable authoringAddress through the canonical effective-layer target, switch only the existing in-memory Spatial scope for non-additive selection, and keep document/revision/history/dirty unchanged. Cross-owner additive selection rejects before `persistOpenSpatialContentEdit`, preserving the original scope, selection, editing node and dirty draft; valid selections commit any open edit first and then re-resolve against the fresh session. Surface owner remains visible because existing Properties/delete/lock/visibility consumers address it canonically; no new scope or hitId contract was added. At integrated product commit `a2f7386`, the nine-file focused stabilization run passed 9 files / 93 tests, `npm run typecheck` passed and `git diff --check` passed, with only registered jsdom Canvas warnings. The independent authoring-address Reviewer approved the repaired failure-zero-write boundary without rerunning tests.
- Outcome boundary: 只证明统一图层选择链为 `engineering candidate`；不证明跨 owner 移动、属性完整性或 Spatial 整体可用。
- Rollback: revert `82e59fc` to restore the old selection route; selection is session-only and requires no user-data migration.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
