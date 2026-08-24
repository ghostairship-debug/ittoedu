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
- Invalidating paths: `src/renderer/store/editorStore.ts#duplicateNode/#duplicateSelectedNodes/#copySelectedNodes/#pasteNodes`; `src/renderer/App.tsx` 的 Ctrl+C/V/D 路由；`src/renderer/ui/NodesTab.tsx` 的重复入口；`tests/unit/editorStore.test.ts`; `tests/unit/spatialProductIntegration.test.tsx`
- Task ID: `stab-spatial-02-copy-paste-duplicate`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `draft`
- Owner / Reviewer / Integrator: `Spatial Clipboard Worker / independent Spatial history reviewer / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `assigned at claim`
- Baseline HEAD: `record at claim`
- Context Pack + manifest hash | bootstrap-manual: `query Spatial clipboard/duplicate/App shortcuts at claim`
- Freshness / relevant dirty inputs: `verify the audit paths and related user changes at claim`
- Depends on: `stab-wave-a-core-usability`
- Blocks: `stab-wave-b-ownership-controller`
- Risk statement: 修复必须复制正确 owner 的真实 LayerItem/资源引用并复用 active Spatial history；不能把临时 selection 或 legacy clipboard 当作保存成功。
- Retry count / last failure class: `0 / none`

## Product outcome

Spatial 中的图层“重复”和 Ctrl+C/V/D 对真实可复制对象产生可预测结果：复制捕获正确 canonical payload，粘贴/重复创建新 ID 的真实工程项、保留正确 owner、更新选择并各产生一次历史；失败完全零写入。

## Current fact, canonical write and non-goals

- 审计证据：`duplicateNode` 只有 Slide/部分 global 分支，快捷键仍调用旧 Store 方法；Spatial 可出现状态提示或选择变化但 `SpatialAuthoringSession.history.present` 不变。
- Canonical write: copy 只读取当前 canonical item 并形成有 owner/address 的临时 clipboard；paste/duplicate 通过 active Spatial command/persistence 写回唯一 `CourseProjectDocument`，新 ID、order、资源与交互引用按现有合同处理，一次操作一条历史。
- 非目标：不建设系统剪贴板协议、跨工程粘贴、跨 Surface 通用 clipboard、批量资源迁移或第二套历史；不改变 Slide/Flow 语义。

## Scope, locks and acceptance

- Allowed write: 上述 Store clipboard/duplicate 方法的 Spatial 分支、App 快捷键的 Surface-aware 调度、NodesTab 的 Spatial duplicate 入口、必要的窄 Spatial clipboard command 和两个 focused 测试。
- Required read: effective layer owner/address、LayerItem duplicate/order 规则、Spatial selection/history、组件/素材引用完整性。
- Forbidden write: Schema/contracts、系统剪贴板/main/preload、Player/Published/export、Properties 行为、Slide/Flow clipboard、dependencies/generated。
- Hotspot lock: Spatial 的 Store / Properties / Clipboard / History 由同一 Coordinator/Integrator 串行接入；五张 Spatial 卡可并行调查、实现纯命令和编写独立测试，只有命中 Store / Nodes / Properties 的接入提交必须串行。
- Acceptance:
  - [ ] 单项图层重复与 Ctrl+D 创建新稳定 ID，进入原 owner，order 唯一并选中新副本。
  - [ ] Ctrl+C 不修改工程/历史，只捕获来自当前 canonical selection 的 payload；Ctrl+V 真实写入工程且只产生一条历史。
  - [ ] undo/redo 精确移除/恢复副本及选择；资源、组件和相关引用不悬空。
  - [ ] locked、不可复制、stale、wrong-owner、空 clipboard 或容量失败均为零 document/revision/history/selection 写入，并给出诚实反馈。
  - [ ] 不调用 V9 禁用的 legacy `commit`，不创建第二 clipboard truth。

## Minimal validation

- `npx vitest run tests/unit/editorStore.test.ts tests/unit/spatialProductIntegration.test.tsx`
- 最小真实快捷键序列：Spatial 选中 world item → Ctrl+C → Ctrl+V → Ctrl+D → undo/redo，核对 canonical ID/owner/selection；运行 `git diff --check`。不运行全量 `verify`、完整 E2E 或 `build:desktop`。

## Result and rollback

- Result evidence: `pending`; 完成时记录 product commit、copy/paste/duplicate 的 canonical before/after、失败零写入证据和 Reviewer 结论。
- Outcome boundary: 只证明 Spatial clipboard/duplicate 纵切为 `engineering candidate`；不证明跨工程/跨 Surface 粘贴或教师 `accepted`。
- Rollback: 一个可独立 revert 的产品/测试提交恢复旧路由；clipboard 为会话态且无用户数据迁移，回滚不得重写现有项目。
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
