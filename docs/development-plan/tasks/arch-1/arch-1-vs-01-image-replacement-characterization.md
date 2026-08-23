# S1 Task Card — ARCH-1 VS-01 Image Replacement Characterization

## State and assignment

- Task ID: `arch-1-vs-01-image-replacement-characterization`
- Phase / wave: `ARCH-1 / vertical slice preparation`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `6dc493d5f8cc0ab4c7552c731546e19ada1c410b`
- Claim commit: `pending`
- Context: `bootstrap-manual; replace with fresh repo:context manifest after ARCH-0B gate`
- Freshness / relevant dirty inputs: source evidence read-only at 6dc493d; recheck after ARCH-0A/0B integration
- Depends on: `ARCH-0A representative/FACT minimum gate; ARCH-0B context safety minimum gate`
- Blocks: `ARCH-1 VS-02 through VS-06`
- Retry count: `0`

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

- A dedicated focused unit/integration characterization test and test-only fixtures/helpers.
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

- [ ] Normal same-target path and one-history/resource behavior characterized
- [ ] Cross-location and cross-project wrong-target path reproduced
- [ ] Deleted item and revision-policy expectations explicit
- [ ] Save/Preview/export expectations tied to existing V9/Published path
- [ ] No product change or weakened assertion

## Minimal validation

- Focused characterization unit/integration command (to be named after context refresh)
- Existing `assetTransactions` and `courseAuthoringSession` focused tests
- `git diff --check`

## Rollback

- Start point: final ARCH-0A/0B gate commit
- Implementation commit: pending
- Old path remains: current bug remains reproducible until VS-05 integrates the fix.

## Consumers and index

- Consumer delta: `0`; test evidence only
- Legacy record IDs: pending FACT/MAP reference
- indexImpact: `regenerate`

## Result evidence

- Pre-characterization finding only; task remains draft until gates and fresh context are available.

## Ready checklist (Coordinator)

- [ ] ARCH-0A minimum gate satisfied
- [ ] ARCH-0B minimum context gate satisfied or explicitly approved fresh Bootstrap
- [ ] exact test harness paths named
- [ ] write scope and validation rechecked
- [ ] no related user dirty change
- [ ] no product escalation triggered
