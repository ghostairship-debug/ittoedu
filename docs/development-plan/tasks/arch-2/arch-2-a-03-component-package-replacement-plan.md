# S2 Task Card — ARCH-2 A-03 Component Package Replacement Plan

> 本卡是任务状态唯一真相；只有 Coordinator 可 integrate or close it.

## State and assignment

- Task ID: `arch-2-a-03-component-package-replacement-plan`
- Phase / wave: `ARCH-2 / W2-A pure Components command`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Components Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `shared workspace, new Components planner-only scope / codex/architecture-stabilization`
- Baseline HEAD: `d6b56a2`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:components; fresh/high/safe-for-S2; source 35e2be08, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `new planner and test paths clean; Store/App/Surface histories locked out`
- Depends on: `ARCH-1 VS-03 resource delta done; A-00 read-only audit complete`
- Blocks: `ARCH-2 component replacement Store integration`
- Risk statement: `Missing one carrier leaves V9 package version locks invalid; changing a carrier would silently degrade Flow content.`
- Retry count / last failure class: `0 / none`

## Product outcome

Replacing one installed component package produces one immutable V9 document/package-resource transaction that retargets every existing instance version without changing its ID, props, fallback, position, ownership or Surface-specific carrier.

## Canonical contract and carrier

- Package metadata: `CourseProjectDocument.componentPackages`.
- Resource: existing `ComponentPackageData` via `ComponentPackageHistoryChange`.
- Layer carriers: ComponentLayerItem in global/surface shared, Slide scene and Spatial world.
- Flow paper carrier: recursive `FlowComponentBlock`, never converted to LayerItem.
- Schema/API change allowed: `no`.

## Scope and locks

### Allowed write

- New `src/renderer/components/courseComponentPackageTransactions.ts`
- New `tests/unit/courseComponentPackageTransactions.test.ts`
- This task card result fields

### Required read

- Component V4 manifest/package types and current package validation helpers
- Existing V8 replacement planner only as observed behavior
- Published component reference traversal for complete carrier coverage
- `editorTransaction.ts` and `history.ts`

### Forbidden write

- Store/App/Catalog/UI/DeveloperTab, Surface histories or placement commands
- Published producer/Player, contracts/Schema, package/lockfile
- Fixtures and repo-index generated/semantic

## Must preserve

- Exact project/revision, ID/version/hash and supported-scope validation.
- Nested Flow sections are traversed recursively.
- One package delta before/after; non-empty document revision is exactly +1.
- No props migration, trust/source change, placement or API 4 change.
- Inputs and package bytes are detached from output.

## Validation

- `npx vitest run tests/unit/courseComponentPackageTransactions.test.ts tests/unit/historyResourceChanges.test.ts tests/unit/editorTransaction.test.ts`
- Existing component package/content-integrity tests.
- `npx tsc --noEmit` and `git diff --check`.

## Rollback

- Pure planner can be reverted before Store integration; no persisted files or user data are modified.

## Result evidence

- Pending Worker implementation and independent review.

