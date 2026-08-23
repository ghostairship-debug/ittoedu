# S1 Task Card — ARCH-1 VS-05B Image Replacement Index Fact Refresh

## State and assignment

- Task ID: `arch-1-vs-05b-image-replacement-index-fact`
- Phase / wave: `ARCH-1 / vertical-slice knowledge integration`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:28 Asia/Shanghai / done 2026-08-24 03:30 Asia/Shanghai`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `8914750`
- Claim commit: `50155e2a9f7fe95f9892eb688bf47adb8043d288`
- Context: `fresh image-replacement Context Pack exposed a semantically obsolete currentFact after VS-05`
- Freshness / relevant dirty inputs: `clean generated index; semantic record is structurally fresh but conceptually stale`
- Depends on: `arch-1-vs-05 target-green`
- Blocks: `VS-06 fresh desktop-validation Context Pack`
- Retry count: `0`

## Product outcome

The development index describes the target-stable atomic Store/App path that now exists and clearly leaves real desktop validation to VS-06, instead of routing the next task through the removed nodeId-only behavior.

## Scope and locks

### Allowed write

- `repo-index/semantic/features.json` image-replacement record only
- `tests/unit/repoIndexSemantic.test.ts` current-fact/signal assertion only
- This task card and generated task board
- Coordinator-generated `repo-index/generated/**` after semantic validation

### Forbidden write

- Product source/tests, contracts, golden corpus/expected/evaluator/thresholds, other semantic records, package/lockfile

## Acceptance

- [x] currentFact states captured target + one document/resource history frame
- [x] targetState states desktop/Preview/HTML/Web evidence still pending VS-06
- [x] current action aliases and new vertical-slice test are discoverable within existing budgets
- [x] semantic test, unchanged golden quality and deterministic index checks pass
- [x] a fresh Context Pack reports the new fact

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- `npm run repo:index:quality`
- `npm run repo:index && npm run repo:index:check`
- Context Pack smoke and diff hygiene

## Rollback

- Start point: `8914750`
- Implementation/generated commit: `aec3e2d4e17b236ea0701128ec7501c5a9b273ab`
- Old path remains: generated facts are fresh, but the image-replacement semantic currentFact incorrectly describes the deleted async nodeId writer.

## Result evidence

- Replaced the removed `replaceImageAsset` alias with `captureImageReplacementTarget` and `replaceImageAssetAtTarget`; currentFact now states the captured target, exact V9 identity validation, mixed Slide transaction frame and cloned byte delta. TargetState reserves real Electron/Preview/HTML/Web closure for VS-06.
- The new vertical-slice integration test is discoverable through generated test relations and Suggested Minimal Validation without displacing a fixed high-signal path. The bounded semantic signal arrays remain within their existing budgets.
- `repoIndexSemantic` passed `1 file / 5 tests`. The first attempted high-signal insertion honestly failed the unchanged broad Recall@15 gate at `83.85%`; it was removed rather than weakening expected evidence. The final unchanged quality gate passed at controlled `95%` and broad `85.38%`, with signature `19141b754f449dff77d307ff6f9231833ca0768ee7355ce36bbf6e80bbe8db4c`.
- Deterministic generation/check passed with `667` inputs, `5,660` symbols, `14,064` edges and `1,522` tests. A fresh/high/safe-for-S2 Context Pack reports the new current/target facts and lists `imageReplacementVerticalSlice.test.ts` in suggested validation.

## Ready checklist

- [x] VS-05 target-green
- [x] semantic/generated locks available
- [x] fixed quality corpus read-only
- [x] no product escalation
