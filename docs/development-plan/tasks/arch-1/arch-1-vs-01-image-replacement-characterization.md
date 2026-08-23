# S1 Task Card — ARCH-1 VS-01 Image Replacement Characterization

## State and assignment

- Task ID: `arch-1-vs-01-image-replacement-characterization`
- Phase / wave: `ARCH-1 / vertical slice preparation`
- Status: `target-green`
- Owner / Reviewer / Integrator: `Characterization Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / target-green 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, characterization-test-only scope / codex/architecture-stabilization`
- Baseline HEAD: `805d04879122702ab17ad7043fe41da1de62ba53`
- Claim commit: `d585e42656987dba767dc8749842ebd9b30f4334`
- Context: `bootstrap-manual explicitly approved for VS-01 only under ARCH-0B controlled-slice exception`
- Freshness / relevant dirty inputs: product/App/Store/session/history paths remained read-only; concurrent golden evaluator/package/index work was disjoint and was not read, modified, or staged
- Depends on: `ARCH-0A gate (done); ARCH-0B broad quality gate may remain in tuning because plan permits VS-01 characterization under strict Bootstrap`
- Blocks: `ARCH-1 VS-02 through VS-06`
- Retry count: `2` (test harness first needed the Player virtual-module stub, then needed Phaser-importing preview/export seams stubbed; product behavior was not changed)

## Product outcome

The exact current image-replacement race, correct-target behavior, history count, and save/preview/export expectations are reproducibly characterized before any hotspot integration.

## Current fact and evidence

`src/renderer/App.tsx` `selectAndImportImage('replace')` awaits the file dialog and only then calls `selectSelectedNode(useEditorStore.getState())`. It therefore resolves the current selection, not the selection that initiated the dialog. `src/renderer/store/editorStore.ts` `replaceImageAsset(nodeId, asset, bytes)` accepts no expected project/revision/session/location/owner target and mutates the current active media session. A page/project switch followed by another image selection can write the replacement to the wrong target.

Existing evidence:

- `tests/unit/assetTransactions.test.ts` covers metadata/bytes undo/redo on the normal path only.
- `tests/unit/courseAuthoringSession.test.ts` covers location/generation stale guards but the token lacks project identity and the replace flow does not use it.
- Existing E2E normal replacement/save-reopen coverage does not keep the image dialog pending across a location/project switch.

## Non-goals

- No App, Store, Session, History, contract, or runtime fix in this card.
- No test that treats the wrong-target write as desired behavior.
- No generalized command bus or all-media abstraction.

## Scope and locks

### Allowed write

- `tests/integration/imageReplacementRaceCharacterization.test.tsx`
- A narrowly scoped test-only helper in the same file if needed.
- This task card result fields.

### Required read

- `src/shared/contracts/course-project-v9/types.ts` relevant project/location/item identity
- `src/renderer/App.tsx` replace callback only
- `src/renderer/store/editorStore.ts` selector/session builder/replace action only
- `src/renderer/authoring/courseAuthoringSession.ts`
- `src/renderer/store/history.ts`
- The three named tests/flows above and one save/preview/export consumer.

### Forbidden write

- All product source, contracts/Schema, package/lockfile, generated index
- Other tasks, representative fixtures, inventories

### Hotspot locks

- None while test-only; App/Store/Session remain unlocked and read-only.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `0 product; 1–2 focused test files`
- Public exports/deletion/dependencies/UI/Schema/generated changes: `no`
- Target tests / expected validation time: `focused unit/integration plus one bounded E2E design proof, under 20 minutes`
- Max implementation retries: `2`

## Characterization

- Current success: capture and replace on the same target; metadata/bytes undo and redo together.
- Known failure: dialog opens on image A, active project/location changes, image B becomes selected, dialog resolves, replacement writes B/current session.
- Required stale cases: project changed; location/generation changed; owner changed; item deleted; revision policy conflict.
- Required preserved cases: cancel has no history; same stable target creates exactly one logical history; save/reopen and Published V2 consumers see the replacement.

## Implementation outline

1. Add a controllable deferred image-dialog result in a test harness.
2. Reproduce same-target success and wrong-target race without locking the bug as correct behavior.
3. Record before state, after state, history count, metadata/bytes, and user-visible error expectation.
4. Feed exact acceptance into VS-02 target and VS-05 hotspot cards.

## Acceptance

- [x] Normal same-target path and one-history/resource behavior characterized
- [x] Cross-location wrong-target path reproduced; project New/Open UI reachability during pending dialog explicitly classified as busy-blocked rather than fabricated
- [x] Deleted item, owner, project, location/generation and exact revision-policy expectations explicit
- [x] Save/Published/HTML expectations tied to existing V9/Published path; Preview remains the existing read-only V2 endpoint for later VS-06 proof
- [x] No product change or weakened assertion; future stale behavior is an expected-failure test, not a passing assertion for the bug

## Minimal validation

- `npx vitest run tests/integration/imageReplacementRaceCharacterization.test.tsx tests/unit/assetTransactions.test.ts tests/unit/courseAuthoringSession.test.ts`
- `npm run typecheck`
- `git diff --check`

## Rollback

- Start point: `805d04879122702ab17ad7043fe41da1de62ba53`
- Implementation commit: not created; Worker was instructed not to commit
- Old path remains: current bug remains reproducible until VS-05 integrates the fix.

## Consumers and index

- Consumer delta: `0`; test evidence only
- Legacy record IDs: `LEG-001` and `LEG-003` read-only reference
- indexImpact: `regenerate`

## Result evidence

- Added `tests/integration/imageReplacementRaceCharacterization.test.tsx`; it renders the real App replace callback with a deferred `desktopAPI.selectImage`, real Store/V9 archive/Published/HTML paths, and only test-shell mocks for heavy UI/Player imports.
- Normal same-target: revision and history each increase exactly once; image A changes while B stays unchanged; replacement metadata and bytes are present; undo removes/restores the original reference/metadata/bytes and redo restores the replacement.
- Save/read endpoints: an in-memory V9 archive reopens with the replacement bytes; `buildPublishedCourseV2Payload` exposes the replacement data URL and the standalone HTML contains that same Published asset URL. No product save/export code was modified.
- Cancel: document snapshot, revision, asset/file IDs, history depth, sidecar depth and error state remain byte/structurally unchanged.
- Current cross-location diagnostic: dialog opens on `slide-intro-hero` A; location switches to summary and B is selected; dialog resolves; current implementation leaves A unchanged, writes the new asset to B, changes revision `1→2`, history `0→1`, full sidecar snapshot depth `0→1`, and reports no stale error.
- The future-correct assertion is `it.fails`: stale completion must report an actionable error, leave A/B and asset/file IDs unchanged, and add no history. When VS-05 fixes the behavior, Vitest must report this expected-failure as an unexpected pass; the test must then be converted to a normal regression test.
- Project-switch reachability: while `selectImage` is pending, the real App `busy` state disables New and Open; a user-visible project switch through those controls is currently unreachable. Project identity is still recorded as a required VS-02/VS-05 guard for non-UI/reentrant paths.
- Future stale contract matrix is recorded without claiming current guards exist: `project-mismatch`, `session-stale`, `owner-mismatch`, `item-missing`, and `revision-conflict` under exact revision policy.
- Validation: focused run passed `3 files / 15 tests`, plus `1 expected fail`; renderer/player, main/preload and e2e TypeScript projects all pass.
- Scope: only this integration test and this card changed; no product, contract, package, index, fixture, inventory or other task-card write.

## Findings / next allowed task

- VS-02 and VS-03 may proceed in parallel after Coordinator review: VS-02 owns stable target/stale codes; VS-03 owns the one-history resource-delta plan.
- VS-05 must not preserve the current B-write as desired. It must flip the `it.fails` contract to a normal passing regression and remove full sidecar snapshot growth for this replacement action.
- Desktop project-switch race should not be fabricated while App busy blocks New/Open; VS-05 direct integration must still enforce project identity, and VS-06 must recheck UI reachability.

## Ready checklist (Coordinator)

- [x] ARCH-0A minimum gate satisfied
- [x] ARCH-0B exception explicitly approved for VS-01 characterization under fresh manual Bootstrap
- [x] exact test harness path named
- [x] write scope and validation rechecked
- [x] no related user dirty change
- [x] no product escalation triggered
