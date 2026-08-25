# S1 Task Card — Surface-aware Insertion Affordance

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: 审计 `CROSS-01` / `CROSS-02` 已确认 ElementsTab 对 Slide、Flow、Spatial 共用“可单击添加，也可拖入画布”和 draggable payload，但只有 Slide 有真实外部 drop receiver，且同名文本/图片/视频实际分别创建自由节点、文档块/浮层或世界元素；若 claim 时拖拽承诺只出现在有真实 drop consumer 的 Surface，且插入文案明确 carrier 语义，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V1
- Validation budget: 10 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将三种 Surface 的可拖状态、提示文案和单击插入 carrier 结果绑定 product commit；文档/任务板/generated-only 变化复用，命中下列 UI/receiver 或 focused 测试时失效。
- Invalidating paths: `src/renderer/ui/ElementsTab.tsx`; `src/renderer/ui/Workspace.tsx` 的 `application/x-courseware-element` drop receiver；`src/renderer/ui/FlowWorkspace.tsx` 的 block DnD 边界；`tests/unit/editorFormattingUi.test.tsx`; `tests/unit/flowProductIntegration.test.tsx`; `tests/unit/spatialProductIntegration.test.tsx`
- Task ID: `stab-cross-01-surface-aware-insertion-affordance`
- Phase / wave: `post-audit stabilization / D-cross-surface`
- Status: `done`
- Owner / Reviewer / Integrator: `Surface Insertion UX Worker / independent Surface-semantics reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with ElementsTab/UI Shell firewall / codex/architecture-stabilization`
- Baseline HEAD: `68cfc91` (Wave A gate released and generated index fresh)
- Context: fresh `repo:context` query on `ElementsTab drag payload Slide Flow Spatial receivers insertion carrier` returned low confidence and required exact-source manual Bootstrap before writing.
- Freshness / relevant dirty inputs: worktree and every listed product/test path were clean at claim; repo-index source, semantic, config and tool inputs all matched.
- Hotspot lock release: ElementsTab/UI Shell lock released after product commit `a6fdba4`.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-audit-closure-gate`
- Retry count: `1` (independent review found the first candidate ignored global editing scope; the Worker replaced the Surface-only promise with a tested Surface × scope × kind capability matrix and re-review approved it.)

## Product outcome

Elements 面板只承诺当前 Surface 真正支持的操作：Flow/Spatial 没有真实 drop receiver 时不再显示可拖或产生 draggable payload；单击插入仍直接可达，并清楚说明将创建自由节点、文档块、浮层还是世界元素。

## Current fact, canonical write and non-goals

- 审计证据：ElementsTab 统一设置 `application/x-courseware-element`，Slide Workspace 接收该 payload；Flow 仅处理内部 block reorder，Spatial 无对应 receiver。
- Canonical write: 本卡不新增写路径；所有保留的单击/拖放动作继续调用现有 Surface command/Store，并只写唯一 `CourseProjectDocument` 的真实 carrier。没有 receiver 的 drag 为零 payload、零工程写入。
- 非目标：不为 Flow/Spatial 新增 drop 实现、不统一三种 Surface 的载体、不把 Flow block 改成自由 LayerItem，也不修改 Schema/Store/history。

## Scope, locks and acceptance

- Allowed write: ElementsTab 的 Surface-aware draggable、提示和 carrier 文案，必要的只读 Surface capability selector，以及三个 focused UI/integration 测试。
- Required read: Slide drop receiver、Flow internal reorder、Spatial Workspace pointer boundary和三种 Surface 的实际 insert command。
- Forbidden write: 新 Flow/Spatial drop receiver、Store/History、Schema/contracts、媒体文件对话框、Player/Published/export、dependencies/generated。
- Hotspot lock: ElementsTab / UI Shell 由 Coordinator 串行接入；不得与同文件的其他插入或全局层任务并行写。
- Acceptance:
  - [ ] Slide 保留已有可拖行为和 MIME payload；Flow/Spatial 无真 receiver 的卡片不再 draggable，也不显示“可拖入”。
  - [ ] 三种 Surface 的文本/图片/视频/图形提示与实际 carrier 一致，差异是可发现的。
  - [ ] 单击插入仍走原 canonical command，并保持原 history/save 语义。
  - [ ] 不以伪 drop handler 或统一 carrier 消除文案问题。

## Minimal validation

- `npx vitest run tests/unit/editorFormattingUi.test.tsx tests/unit/flowProductIntegration.test.tsx tests/unit/spatialProductIntegration.test.tsx`
- 核对 Slide/Flow/Spatial 三种 rendered draggable 状态和 carrier copy，运行 `git diff --check`；不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: product commit `a6fdba4`. Slide scene/global entries retain the only real `application/x-courseware-element` drag path and identify free-node versus global-layer carriers. Flow page entries are click-only document blocks/page overlays; in Flow global scope shapes identify the real global carrier, text/formula explicitly disclose their existing page-block behavior, and unsupported image/video actions are disabled. Spatial world entries are click-only world items, while Spatial global entries are disabled and zero-write because no insertion command exists there. Surface-specific global notices agree with the buttons, and every retained click still calls the original Store/App command. At integrated product commit `a2f7386`, the nine-file focused stabilization run passed 9 files / 93 tests, `npm run typecheck` passed and `git diff --check` passed, with only registered jsdom Canvas warnings. The independent Surface-semantics Reviewer approved the corrected Surface/scope/carrier matrix without rerunning tests. Current outcome is `engineering candidate`; no Flow/Spatial drop support is claimed. Freshness refresh: later product commit `59f5fdc` made Spatial insertion guidance ownership-aware and invalidated the earlier copy oracle. Test commit `9fa0181` now asserts the current global-to-world guidance; its exact focused case passed `1 / 1` in `2.95s`, while the retained integration assertions continue to prove disabled/unavailable/zero-write behavior. This replaces the stale UI-oracle citation without changing the original behavior boundary.
- Outcome boundary: 只证明插入 affordance 与当前能力一致；不声称 Flow/Spatial 已支持 drag-and-drop，也不证明整体视觉 `accepted`。
- Rollback: revert `a6fdba4` to restore the former copy/draggable flags; no persisted data is involved.
- Semantic index impact: `canonical-update` only if a stable Surface capability selector is introduced.
- Generated refresh: `defer-to-wave-gate`
