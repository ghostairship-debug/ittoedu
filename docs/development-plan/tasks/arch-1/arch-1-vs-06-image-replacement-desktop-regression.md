# S1 Task Card — ARCH-1 VS-06 Image Replacement Desktop Regression

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Task ID: `arch-1-vs-06-image-replacement-desktop-regression`
- Phase / wave: `ARCH-1 / first vertical slice validation`
- Status: `implementing`
- Owner / Reviewer / Integrator: `Validation Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:30 Asia/Shanghai / pending`
- Worktree / branch: `primary validation workspace / codex/architecture-stabilization`
- Baseline HEAD: `45bd0ac4374e307b22b19c306341c0bc28f48e14`
- Claim commit: `pending`
- Context: `fresh/high/safe-for-S2 image-replacement Context Pack; source 5f300412, semantic d084e338, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean build inputs; representative sources unchanged; exclusive Electron/E2E runtime and output lock held`
- Depends on: `arch-1-vs-05 target-green; arch-1-vs-05b semantic current fact done`
- Blocks: `ARCH-1 first vertical-slice wave gate`
- Retry count: `0`

## Product outcome

In a real Electron run, stale dialog completion never writes the wrong image, while normal replacement supports one undo/redo, save/reopen, Preview and actual HTML/Web delivery from the same replacement bytes.

## Current fact and evidence

- Current `tests/e2e/editor.spec.ts` normal image flow imports, immediately replaces and saves/reopens, but does not hold the file dialog pending across a location/project change.
- It does not prove one V9 history/resource entry or link the replacement to current-location Preview and HTML/Web output in one journey.
- ARCH-0A separately proves three representative fixtures, bounded Preview and HTML/Web generation, but not after the VS-05 replacement integration.
- Project switch may be disabled while App is busy. Desktop evidence must characterize reachability rather than inject an impossible user path.

## Non-goals

- No product fix, source refactor, contract or dependency change.
- No full E2E, full `verify`, packaging, release, PPTX or PDF work.
- No synthetic event presented as trusted pointer or real OS IME evidence.
- No modification of source representative fixtures; all saves/exports use output copies.

## Scope and locks

### Allowed write

- `tests/e2e/imageReplacementVerticalSlice.spec.ts`
- One new test-only Electron helper if necessary under `tests/e2e/` or `tests/helpers/`
- `output/arch-1-vs-06/**` ignored run evidence
- This task card result fields

### Required read

- VS-01 deferred-dialog characterization and VS-05 integration evidence
- Current E2E launch/dialog/save helpers in `tests/e2e/editor.spec.ts`
- `tests/integration/imageReplacementVerticalSlice.test.ts`
- Three ARCH-0 representative fixture manifests/evidence
- V9 archive reader and Published V2 HTML/Web package reader
- ARCH-0A performance thresholds and Mixed PPTX registered red boundary

### Forbidden write

- All `src/**` product files, contracts/Schema, package/lockfile
- Existing product tests; failures return to VS-05 or an explicit follow-up card
- Representative fixtures, inventories, baselines, repo-index generated/semantic
- VS-01–05 or any other task card
- TASK_BOARD and generated evidence outside the task's ignored output directory

### Do not read unless needed

- Full release/package verification and historical E2E bodies unrelated to image replacement
- PPTX/PDF implementations
- Historical Editor 1.0 tasks

### Hotspot locks（通常 0–1 个）

- No source hotspot. Hold an exclusive Electron/E2E runtime and `output/arch-1-vs-06` evidence lock.

## Change budget

- Task timebox: `1 Coordinator day`
- Main source files: `0 product`
- New/moved files: `1 E2E spec; at most 1 test helper; no moves`
- Public exports: `0`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `ignored output only; task state by Coordinator`
- Target tests / expected validation time: `one dedicated spec plus focused prior tests, under 45 minutes`
- Max implementation retries: `2`

## Characterization

- Current successful behavior: immediate normal replacement visibly changes the canvas and survives save/reopen.
- Known failure: no desktop evidence exists for deferred wrong-target rejection or the complete V9 asset/history/Preview/HTML/Web chain.
- Async/stale/history/save/preview implications: use a controllable native dialog promise; capture target before pending; never overwrite fixture; verify stale path has no history/dirty/resource mutation and success path has one undo/redo step.
- Stable target/revision policy: VS-05 exact project/revision/generation/surface/location/owner/item policy is authoritative. The E2E must not weaken it to make a race pass.

## Implementation outline

1. Launch a fresh background Electron build and patch only the test process's native dialog with a controllable deferred result.
2. Run stale location flow; attempt project switch only through reachable product UI and record busy-blocked reachability honestly.
3. Run same-target success, undo, redo, save to a copied archive, reopen, and verify canonical bytes/reference.
4. Mount current-location Preview and export standalone HTML plus Web ZIP; parse Published V2 resources to prove replacement bytes.
5. Run bounded Flow-heavy and Mixed/Spatial open/save-reopen/current-location Preview regressions.
6. Record console/page/external-request diagnostics and preserve baseline Mixed PPTX red without invoking PPTX/PDF.

## Acceptance

- [ ] Cross-location deferred completion shows actionable stale feedback and changes no image, bytes, dirty state or history.
- [ ] Cross-project policy is tested through reachable UI or explicitly recorded UI-unreachable while VS-05 direct integration proves projectId guard.
- [ ] Normal replace changes captured A only, creates one undo step, undo restores original bytes/ref, redo restores replacement.
- [ ] Save copy/reopen preserves replacement and remains editable.
- [ ] Current-location Preview, standalone HTML and Web ZIP consume the replacement bytes through Published V2.
- [ ] Slide-heavy completes the full slice; Flow-heavy and Mixed/Spatial complete bounded save/reopen/Preview regressions.
- [ ] Source fixture hashes remain unchanged; no product/test scope expansion or Mixed PPTX claim.
- [ ] Budget and exclusive desktop lock respected.

## Minimal validation

- `npm run typecheck && npm run build:desktop`
- `npx playwright test tests/e2e/imageReplacementVerticalSlice.spec.ts`
- Re-run the VS-02–05 focused unit/integration commands plus `npx tsx scripts/build-architecture-baseline-fixtures.ts --check`.
- Run three `validate:course-project` commands against the unchanged representative sources and the saved Slide output copy.
- Manual evidence: inspect the replacement Preview and exported HTML/Web package; console/page errors and external requests must be zero.
- Do not run full `npm test`, full E2E, `verify`, packaging, PPTX or PDF.

## Rollback

- Start point: `pending reviewed VS-05 integration commit`
- Implementation commit: `pending test-only commit`
- Old path remains: if desktop validation fails, preserve evidence and return VS-05 integration for repair or rollback; pure VS-02–04 commits may remain if independently green.
- Test outputs are disposable copies; never restore by overwriting source fixtures or user files.

## Consumers and index

- Consumer delta: `0 product; adds one bounded E2E consumer`
- Legacy record IDs: `LEG-001 and LEG-003 reference only; no deletion. Mixed PPTX red remains under export-owner records.`
- indexImpact: `regenerate`

## Result evidence

- Behavior before/after: `pending`
- Validation results: `pending`
- Consumer delta: `pending`
- Remaining risks: `pending`
- Rollback commit: `pending`
- Next allowed task: `ARCH-1 wave gate only after this card is reviewed/wave-validated`

## Findings / next allowed task

- Pending. Product failures must create/return to the owning implementation card; this validation card may not fix them.

## Ready checklist（Coordinator）

- [x] dependsOn satisfied
- [x] context fresh or Bootstrap verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
