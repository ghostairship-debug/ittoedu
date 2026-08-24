# S2 Task Card — Spatial Copy, Paste and Duplicate

> 本卡是任务状态唯一真相；任务板只从任务卡生成。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: 审计 `SPATIAL-04` 已确认图层“重复”与 Ctrl+C/V/D 可能落入 Slide/Legacy 路由，造成空操作或选择/toast 变化而 canonical Spatial 工程不变；若 claim 时 duplicate、copy payload、paste 与 duplicate-selected 已全部使用当前 Spatial carrier，且成功/失败、ID、owner、selection、history 均有证据，则跳过实现。
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后将 clipboard payload、canonical delta、选择和 history 结果绑定 product commit；文档/任务板/generated-only 变化复用，命中下列方法、快捷键或 focused 测试时失效。
- Invalidating paths: `src/renderer/course/spatialClipboardCommands.ts`; `src/renderer/store/editorStore.ts` 的 Spatial clipboard state、persist/backend/location/load seams 与 `duplicateNode/#duplicateSelectedNodes/#copySelectedNodes/#pasteNodes`; `src/renderer/App.tsx` 的 Ctrl+C/V/D 路由；`src/renderer/ui/NodesTab.tsx` 的重复入口；`src/renderer/course/effectiveLayerCommands.ts` 的 target/locate/address helpers；`src/renderer/course/globalLayerCommands.ts` 的 ID/order helpers；`src/renderer/course/spatialRelationCommands.ts#planSpatialGraphAfterWorldCopy`; `src/renderer/course/spatialAuthoringHistory.ts`; `src/renderer/course/spatialEditorCommands.ts#selectSpatialEditorLayers`; Course V9 interaction/resource reference constraints；`tests/unit/editorStore.test.ts`; `tests/unit/spatialProductIntegration.test.tsx`
- Task ID: `stab-spatial-02-copy-paste-duplicate`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `done`
- Owner / Reviewer / Integrator: `Spatial Clipboard Worker / independent Spatial history reviewer / Coordinator`
- Claimed at / released at: `2026-08-25 / 2026-08-25`
- Worktree / branch: `shared integration workspace with Store/Nodes single-writer firewall / codex/architecture-stabilization`
- Baseline HEAD: `7ae0797` (history/media/move lanes closed; product baseline includes `2e6be4f` and `093963c`; worktree clean)
- Context Pack + manifest hash | bootstrap-manual: exact-source trace from App/Nodes entrypoints into the four Store methods, V8 projection/disabled commit fallback, effective owner/address/order helpers, Spatial graph-copy policy and current history selection contract.
- Freshness / relevant dirty inputs: Product/test commit `120243d` is the fixed implementation candidate and was clean immediately after commit. App and Nodes retain their stable public entrypoints; Store now dispatches all four Spatial operations before the V8 fallback. Any later change to an Invalidating path requires narrow refresh before Wave B/closure.
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: 修复必须复制正确 owner 的真实 LayerItem/资源引用并复用 active Spatial history；不能把临时 selection 或 legacy clipboard 当作保存成功。
- Retry count / last failure class: `1 / independent review found retained clipboard across camera context, missing live-lock paste recheck and incomplete external-reference preflight; all three repaired before approval`

## Product outcome

Spatial 中的图层“重复”和 Ctrl+C/V/D 对真实可复制对象产生可预测结果：复制捕获正确 canonical payload，粘贴/重复创建新 ID 的真实工程项、保留正确 owner、更新选择并各产生一次历史；失败完全零写入。

## Current fact, canonical write and non-goals

- 审计证据：`duplicateNode` 只有 Slide/部分 global 分支，快捷键仍调用旧 Store 方法；Spatial 可出现状态提示或选择变化但 `SpatialAuthoringSession.history.present` 不变。
- Canonical write: copy 只读取当前 canonical item 并形成有 owner/address 的临时 clipboard；paste/duplicate 通过 active Spatial command/persistence 写回唯一 `CourseProjectDocument`，新 ID、order、资源与交互引用按现有合同处理，一次操作一条历史。成功操作选中新副本；Spatial 历史切换继续使用既有“undo/redo 清空选择”合同，不新增选择历史。
- 非目标：不建设系统剪贴板协议、跨工程粘贴、跨 Surface 通用 clipboard、批量资源迁移或第二套历史；不改变 Slide/Flow 语义。

## Scope, locks and acceptance

- Allowed write: 上述 Store clipboard/duplicate 方法的 Spatial 分支、App 快捷键的 Surface-aware 调度、NodesTab 的 Spatial duplicate 入口、必要的窄 Spatial clipboard command 和两个 focused 测试。
- Required read: effective layer owner/address、LayerItem duplicate/order 规则、Spatial selection/history、组件/素材引用完整性。
- Forbidden write: Schema/contracts、系统剪贴板/main/preload、Player/Published/export、Properties 行为、Slide/Flow clipboard、dependencies/generated。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [x] 单项图层重复与 Ctrl+D 创建新稳定 ID，进入原 owner，order 唯一并选中新副本。
  - [x] Ctrl+C 不修改工程/历史，只捕获来自当前 canonical selection 的 payload；Ctrl+V 真实写入工程且只产生一条历史。
  - [x] paste/duplicate 选中新副本；undo/redo 精确移除/恢复副本文档并按既有 Spatial 合同清空选择；资源、组件和相关引用不悬空，不为 redo 新增第二套选择历史。
  - [x] locked、不可复制、stale、wrong-owner、空 clipboard 或容量失败均为零 document/revision/history/selection 写入，并给出诚实反馈。
  - [x] 不调用 V9 禁用的 legacy `commit`，不创建第二 clipboard truth。

## Minimal validation

- `npx vitest run tests/unit/editorStore.test.ts tests/unit/spatialProductIntegration.test.tsx`
- 最小真实快捷键序列：Spatial 选中 world item → Ctrl+C → Ctrl+V → Ctrl+D → undo/redo，核对 canonical ID/owner/selection；运行 `git diff --check`。不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: Product/test commit `120243d` adds one session-only `SpatialClipboardPayload`, a narrow canonical command module and Spatial-first branches in the four existing Store entrypoints; App/Nodes product source did not need modification. The two named focused files passed `88/88`; six direct-consumer files passed `31/31`; `npm run typecheck` passed all three TS projects; `git diff --check` passed on the exact committed bytes. Tests prove same-owner multi-copy, unselected row duplicate into its exact owner, stable project-wide IDs/orders, +20/+20 unlocked copies, scoped visibility, Runtime binding remap, one cross-rule action-ID map with transitive completion follower, world-only relation copy, unchanged paths/semantic zoom, one revision/history entry, repeated paste after ordinary edits, undo/redo document restoration with cleared selection, and zero-write failures for empty/stale/wrong-owner/locked/controller/capacity/dangling-reference cases. Camera/location transitions clear the clipboard while same-context mutations retain it. Independent review first rejected three context/lock/reference gaps; the repaired candidate received `APPROVE` without rerunning duplicate suites.
- Outcome boundary: 只证明 Spatial clipboard/duplicate 纵切为 `engineering candidate`；不证明跨工程/跨 Surface 粘贴或教师 `accepted`。
- Rollback: Revert product/test commit `120243d`; clipboard is Session-only and introduced no Schema, archive or user-data migration, so rollback does not rewrite existing projects.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
