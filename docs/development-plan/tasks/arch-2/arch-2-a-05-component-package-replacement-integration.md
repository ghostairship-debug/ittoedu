# S2 Task Card — ARCH-2 A-05 Cross-Surface Component Package Replacement Integration

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID: `arch-2-a-05-component-package-replacement-integration`
- Phase / wave: `ARCH-2 / W2-A Components Store integration`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Coordinator / independent Components reviewer / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / pending`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `2b0d97c`
- Claim commit: `pending`
- Context Pack + manifest hash | bootstrap-manual: `feature:components and feature:editor-core; fresh/high/safe-for-S2; source 7534beb6, semantic d9f5f3a2, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree; App and Editor Store locks exclusively held by Coordinator; A-04 persistence seam done`
- Depends on: `A-02, A-03 and A-04 done`
- Blocks: `ARCH-2 W2-A resource gate`
- Risk statement: `A late package target, missing Flow block, or non-atomic package resource update can leave V9 version locks invalid or execute bytes that do not match metadata.`
- Retry count / last failure class: `0 / none`

## Product outcome

Manual replacement and Catalog update capture one installed package in one Course Project before asynchronous package reads, then atomically replace its V9 metadata, executable package and every instance version in the current Surface history—or reject the stale/incompatible result without changing any project/resource state.

## Current behavior

- Slide-only replacement can work but uses a complete component-package map snapshot.
- Flow/Spatial active replacement falls into the empty V8 `commit()` compatibility shell and can report success without changing V9.
- Mixed replacement misses recursive `FlowComponentBlock`, which can make the V9 version lock invalid.
- App manual and Catalog paths share `replaceComponentPackage`, but neither passes a project/revision target captured before asynchronous package work.

## Stable target / conflict policy

- Target contains exact project ID, document revision and package ID; location/selection changes are allowed because replacement is project-scoped.
- Manual flow captures before `selectComponentPackage`; confirmation retains the same target.
- Catalog update captures before `readComponentCatalogPackage` and keeps its existing source/version/archive hash checks.
- Project/revision/package drift, same-version hash conflict, internal package inconsistency or unsupported existing scope returns zero write.
- No-op creates no history/dirty/snapshot change.

## Replacement path

```text
App capture project/revision/package
→ existing importComponentPackageAsync / Catalog trust checks
→ A-03 pure V9 planner
→ createEditorTransactionStep
→ A-04 current Slide / Flow / Spatial project-resource transaction seam
→ one existing history frame, one componentPackageChanges delta
→ undo/redo restores metadata + executable package + all instance versions
```

## Scope and locks

### Allowed write

- `src/renderer/App.tsx` manual/Catalog replacement target plumbing only
- `src/renderer/store/editorStore.ts` replacement actions and removal of old V8 planner/retarget fallback
- New component replacement Store/App integration tests
- Targeted updates to existing component package management/Catalog tests
- This task card result fields

### Required read

- A-03 planner and its all-carrier/package-integrity tests
- A-04 `persistProjectResourceTransaction` and three Surface resource undo/redo
- App manual confirmation and Catalog add/update flow
- Three representative package archives and Published V2 component reference traversal

### Forbidden write

- A-03 planner, Component V4/V9 contracts or import parser
- Surface carrier/placement/history modules, Media/Runtime/Interactions/Global Layers
- Catalog main/preload/IPC/trust/source implementation
- Published producer/Player hosts, package/lockfile, representative fixtures
- semantic/generated repo-index and other task cards

## Must preserve

- `FlowComponentBlock` remains a recursive document block; no conversion to LayerItem.
- Every carrier keeps ID, props, fallback, geometry, order, visibility and ownership; only component version changes.
- Manual and Catalog update continue sharing one Store commit path and current confirmation/trust UX.
- A delta frame does not grow component or sidecar full snapshot stacks.
- One undo/redo restores exact before/after executable files and V9 document in lockstep.
- Save/reopen and Published Course V2/API 4 are read-only validation endpoints.

## Stop conditions

- Any V9/Component API/Published Schema change or props migration is required.
- Catalog trust/source behavior changes.
- More than one revision/history entry or a second package timeline is introduced.
- Flow package replacement still uses overlay fallback or misses a nested block.
- Full package snapshot depth grows for the replacement action.
- Asynchronous result reads target identity only after await.

## Validation

### Target

- New Store integration: Slide-heavy, Flow-heavy and Mixed/Spatial package replacement; one transaction; no full snapshots; all carriers; one undo/redo; save/reopen; Published V2 API 4.
- New App race: manual deferred package dialog and Catalog deferred read reject stale revision with zero write; normal routes share target action.
- `npx vitest run tests/unit/courseComponentPackageTransactions.test.ts tests/unit/componentPackageManagement.test.tsx tests/unit/componentCatalogReplacement.test.ts tests/unit/componentCatalogStatus.test.ts tests/integration/componentCatalogV8Matrix.test.ts <new integration tests>`
- A-04 media/resource regressions plus root/Electron/E2E typechecks.

### Representative / delivery

- Use copies/in-memory Slide-heavy, Flow-heavy and Mixed/Spatial archives with `com.ittoedu.baseline.evidence-panel`; never overwrite fixtures.
- Reopen archive with replacement package files, build Published V2, and prove recursive Flow block and all referenced API 4 packages remain mountable.
- Re-run deterministic fixtures and V9 validators. Performance comparison remains W2-A gate-owned.

## Consumer / reduction gate

- V8 `planComponentPackageReplacement` production consumers: `1 → 0`.
- Store-local `retargetCourseComponentInstances` callers/helper: `1 → 0`.
- replacement empty legacy `commit()` fallback: `1 → 0`.
- product `componentPackageChanges` producers: `0 → 1`.
- Replacement full-package snapshot behavior: `1 → 0`; structural snapshot fields remain for import/delete/editable actions.

## Rollback

- Start point: `2b0d97c` plus this claim commit.
- Pure A-03 and A-04 resource-history commits remain if independently green.
- Revert App/Store integration as one unit; all tests use memory or copied archives.

## Result evidence

- Pending implementation, independent review and representative validation.

