# S2 Task Card — ARCH-2 A-02 Flow / Spatial Resource-Aware History

> 本卡是任务状态唯一真相；只有 Coordinator 可 integrate or close it.

## State and assignment

- Task ID: `arch-2-a-02-cross-surface-resource-history`
- Phase / wave: `ARCH-2 / W2-A Core History consumer seam`
- Status: `done`
- Owner / Reviewer / Integrator: `History Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, Flow/Spatial history-only scope / codex/architecture-stabilization`
- Baseline HEAD: `d6b56a2`
- Claim commit: `1de9d64`
- Context Pack + manifest hash | bootstrap-manual: `feature:editor-core, feature:flow and feature:spatial; fresh/high/safe-for-S2; source 35e2be08, semantic d9f5f3a2`
- Freshness / relevant dirty inputs: `Flow/Spatial history files clean; Store/App and Slide history locked out`
- Depends on: `ARCH-1 VS-03 resource delta done; A-00 read-only audit complete`
- Blocks: `Media and Components cross-Surface Store integrations`
- Risk statement: `History is a hotspot; a second timeline or mixed-frame misalignment can detach binary resources from the document.`
- Retry count / last failure class: `0 / none`

## Product outcome

Flow and Spatial can carry the existing `EditorTransactionStep.resourceChanges` through their one current history, including exact undo/redo transitions, while preserving legacy document-only entries.

## Scope and locks

### Allowed write

- `src/renderer/course/flowEditorSlice.ts`
- `src/renderer/course/spatialAuthoringHistory.ts`
- One new shared pure history helper under `src/renderer/authoring/` only if it removes exact duplication
- New focused Flow/Spatial history tests
- This task card result fields

### Required read

- Slide mixed-frame donor implementation
- `editorTransaction.ts`, `history.ts`
- Flow/Spatial undo/redo command consumers

### Forbidden write

- Store/App/UI, Media/Components planners, Slide command/backend
- Surface document carriers, contracts/Schema, package/lockfile
- Fixtures and repo-index generated/semantic

## Must preserve

- One existing history per Surface; no resource timeline or Store.
- Bare legacy entry behavior, 100-step cap and branch-after-undo semantics.
- Resource frames clone deltas and expose forward/inverse transition without applying resources themselves.
- Flow blocks and Spatial world carriers remain untouched.

## Validation

- Focused new Flow/Spatial mixed-history tests.
- Existing Flow/Spatial command suites plus Slide history resource regression.
- `npx tsc --noEmit` and `git diff --check`.

## Rollback

- Pure history commit can be reverted before any Store consumer lands; no persisted format or user data changes.

## Result evidence

- Pure implementation commit: `d7f8032`.
- One shared value helper now lets the existing Flow and Spatial histories mix legacy document entries with cloned editor-transaction resource frames; it adds no Store, Session, resource timeline or carrier conversion.
- Both domains expose transaction commit, forward/inverse undo/redo transition, type guard and legacy-entry count. Flow keeps its same-reference no-op; Spatial keeps its previous commit semantics; cap and branch behavior remain 100/clear-future.
- Worker regression passed 33 Flow/Spatial/Slide files / 179 tests plus typecheck and dependency ratchet. Independent review passed its 30-file / 165-test Surface run and found no blocker.
- Consumers migrated: `0` by design. Store integration must read transitions before history movement and use the legacy counts to align compatibility snapshot stacks.
