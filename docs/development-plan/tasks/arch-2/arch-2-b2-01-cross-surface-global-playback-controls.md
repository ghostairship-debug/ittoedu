# S2 Task Card — Cross-surface Global Playback Controls

> 本卡是任务状态唯一真相；只有 Coordinator 可写状态、接入 Store 热点并关闭任务。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: integration
- Necessity / skip condition: Flow/Spatial 的合法 global Properties/Elements UI 当前调用 `ensureTeacherController` / `updatePlayback`，但 Store 只有 Slide/部分 Spatial 分支，剩余路径落入明确 no-op 的 legacy `commit` 后仍报告成功；若 claim 时这些操作已写入当前 canonical V9 document、各产生一条对应 Surface history 且反馈诚实，则跳过实现并记录现状。
- Complexity delta: subtractive
- Validation ceiling: V2
- Validation budget: 15 minutes
- Reviewer budget: 1
- Evidence reuse: 执行后绑定 product commit 的 focused Store test 与 root TypeScript check；仅任务卡、报告、task-board 或 generated 变化时复用，命中下列产品/测试路径或 TypeScript/Store 测试配置时失效。
- Invalidating paths: `src/renderer/course/globalLayerCommands.ts`; `src/renderer/store/editorStore.ts`; `tests/unit/globalEditorStore.test.ts`; root TypeScript or Vitest configuration
- Task ID: `arch-2-b2-01-cross-surface-global-playback-controls`
- Phase / wave: `ARCH-2 / W2-B2 Global Layers and Teacher Controller`
- Status: `done`
- Owner / Reviewer / Integrator: `Global Controls Worker / independent Store reviewer / Coordinator`
- Claimed at / released at: `2026-08-24T17:29:30+08:00 / 2026-08-24T17:52:12+08:00`
- Worktree / branch: `C:/Users/74755/Documents/HTML课件编辑器-worktrees/arch2-b2-global-controls / codex/arch2-b2-global-controls`
- Baseline HEAD: `b25ad58`
- Context Pack + manifest hash | bootstrap-manual: last generated index at `16c787f` was fresh/high; subsequent commits through `b25ad58` changed only admission docs/task state, so product paths were manually verified against current source
- Freshness / relevant dirty inputs: clean root worktree; no concurrent Store/global-layer writer
- Depends on: `arch-2-b2-00-remaining-domain-admission` done
- Blocks: ARCH-2 W2-B2 gate and phase gate
- Risk statement: a global UI currently reports success without a V9 write; the repair must use the active Flow/Spatial/Slide history rather than restore legacy mutation or create a second playback/controller truth.
- Retry count / last failure class: `1 / independent review caught a Slide authoring-lock regression; the final commit preserves the prior Slide lock behavior and was approved on re-review`

## Product outcome

In Flow or Spatial global authoring, a teacher can add or restore the one course Teacher Controller and change canvas/none, keyboard-navigation or presenter settings; the active canonical V9 document, current Surface history and user feedback stay consistent.

## Current status and evidence

`partial / reproducible no-op`: `PropertiesTab.tsx` and `ElementsTab.tsx` expose the actions across V9 Surfaces. `editorStore.ts#ensureTeacherController` handles Spatial and Slide but lets Flow reach the forbidden legacy `commit`; `updatePlayback` handles Slide only, so Flow/Spatial patches reach the same no-op while both methods still set success text.

## Canonical contract and carrier

- Contract/type and evidence: `CourseProjectDocument.playback` and `CourseProjectDocument.globalLayerItems` in Course Project V9.
- Surface-specific carrier: one global Native LayerItem with `nativeType=teacher-controller`; ordinary Flow blocks remain unrelated.
- Persisted fields affected: `playback.controls`, `playback.keyboardNavigation`, `playback.presenter`, global controller visibility/lock/initial-visibility only when the requested controls require it.
- Schema change allowed: no.

## Stable target / async policy

The action is synchronous and targets the currently active V9 document/revision. Each real change must enter exactly one active Slide, Flow or Spatial history; failures/no-op must not claim a write.

## Current write path

`PropertiesTab` / `ElementsTab` → `editorStore.ensureTeacherController` or `updatePlayback` → Slide command or partial Spatial command; Flow and remaining Spatial paths → legacy `commit` no-op → unconditional success message.

## Current affected consumers

- Product UI: global Properties and professional Elements tabs.
- Authoring sessions: Slide, Flow and Spatial; Slide current behavior is preserve-only.
- Tests: `tests/unit/globalEditorStore.test.ts` currently proves the Slide path but not Flow/Spatial.
- Legacy: `LEG-001` remains retained; this card only removes these two methods' dependency on its no-op fallback.

## Replacement path

Use the existing global-layer document command semantics and the existing per-Surface persistence/history adapters. A narrowly named playback command may be added to `globalLayerCommands.ts` only if it is consumed by this Store integration in the same commit; no raw Store facade or second history is allowed.

## Scope and locks

### Allowed write

- `src/renderer/course/globalLayerCommands.ts`
- the `updatePlayback` / `ensureTeacherController` integration slices in `src/renderer/store/editorStore.ts`
- focused additions in `tests/unit/globalEditorStore.test.ts`

### Required read

- `src/renderer/ui/PropertiesTab.tsx` and `src/renderer/ui/ElementsTab.tsx`
- active Flow/Spatial/Slide persistence helpers and current global-layer commands
- Course Project V9 playback/global-layer types and teacher-controller consistency helpers

### Forbidden write

- UI source, Schema/contracts, History/Session primitives, Workspace, App, Properties/Elements behavior or copy, Player/Preview/Published/export, archive/recovery, dependencies and unrelated Store methods/tests

### Do not read unless needed

- frozen Editor 1.0 tasks, removed plans and unrelated Feature implementations

### Hotspot locks

- Editor Store / History integration: Coordinator-exclusive; no other Store writer may run concurrently

## Change budget

- Task timebox: 45 minutes
- Main source files: 2
- New/moved files: 0
- Public exports: at most one narrow global playback command with this Store as its first consumer
- Move/delete: remove only the two affected legacy fallback branches if fully replaced; do not delete the legacy `commit` helper in this card
- Dependency/lockfile changes: no
- UI copy/behavior changes: persistence and feedback correctness only; no layout/copy redesign
- Schema/contract changes: no
- Generated diff: none; defer repo-index refresh to the ARCH-2 gate
- Applicable target/integration tests / expected time: one focused Vitest file plus root TypeScript check, under 15 minutes
- Max implementation retries: 2
- Max design attempts: 2

## Execution steps

1. Add failing Flow/Spatial assertions proving the two exposed Store actions currently do not change the active V9 document/history.
2. Route Controller restore and playback patches through current canonical commands and the active Surface persistence adapter, preserving Slide behavior.
3. Prove exact document fields, one history step, undo/redo where applicable, and honest feedback; do not migrate unrelated legacy Store consumers.

## Must preserve

- exactly one global Controller; no Flow block or Surface-local counterfeit
- owner/order/address, Controller consistency and Slide current behavior
- one action → one existing Surface history; no dual write or synthetic history
- no Store/Player/Published coupling and no Schema change

## Stop conditions

Stop and re-scope if correctness requires Schema/contract edits, UI changes, a second Store/history path, a new session coordinator, raw Store export, Published/Player changes or broader `LEG-001` migration.

## Validation

- `npx vitest run tests/unit/globalEditorStore.test.ts`
- `npx tsc --noEmit`
- Inspect the exact consumer diff and run `git diff --check`; do not run full unit/E2E/desktop suites.

## Legacy/delete gate

`LEG-001` is retained. Expected delta is only: Flow/Spatial calls from `ensureTeacherController` / `updatePlayback` to the legacy no-op fallback become `0`; all other registered legacy consumers remain out of scope.

## Rollback

- Start point: `b25ad58` plus this claim commit
- Product/integration commit and real rollback boundary: one product commit, independently revertible
- Old path remains: legacy no-op helper remains for separately scoped consumers; the affected methods must not use it after success

## Result evidence

- Affected consumer delta: the two target methods' calls into the V9-disabled legacy `commit` fallback fell to `0`; the exposed UI consumers and all other `LEG-001` consumers remain unchanged.
- Product commit / behavior before-after: root product commit `b5655ec` (isolated-worker source `3f25f0e`). Before, Flow controller restore and Flow/Spatial playback updates reported success without changing the canonical document/history. After, one narrow document command is persisted through the active Slide/Flow/Spatial adapter; a real change creates one current history entry, no-op creates none, and undo/redo restores the exact playback/global-layer state.
- Validation results: the initial focused regression reproduced `3/13` expected failures; final `npx vitest run tests/unit/globalEditorStore.test.ts` passed `14/14`, `npx tsc --noEmit` passed, and commit diff check passed. Independent Store review first requested a Slide lock fix, then approved final `3f25f0e` after the locked no-op/restore/undo/redo regression was added.
- Known risks/findings: Slide preserves an intentional authoring lock. Flow/Spatial retain the pre-existing `restoreDefaultTeacherController` behavior that unlocks on restore, so lock behavior is not made artificially uniform in this card; any product decision to unify it requires separate evidence. No Schema, UI, Player, Published, dependency or unrelated Store change was made.
- Semantic index impact: none
- Generated refresh: defer-to-wave-gate
- Next allowed task: the ARCH-2 gate-discovered Mixed navigation failure-atomicity card, then the ARCH-2 phase gate.

## Ready checklist（Coordinator）

- [x] dependsOn done/wave-validated
- [x] context fresh or Bootstrap verified
- [x] current write path and affected consumers evidenced
- [x] Allowed/Required/Forbidden paths valid
- [x] Editor Store hotspot lock available
- [x] budgets and validation named
- [x] rollback clear; no user data writes
- [x] no related user dirty change
- [x] no product escalation triggered
