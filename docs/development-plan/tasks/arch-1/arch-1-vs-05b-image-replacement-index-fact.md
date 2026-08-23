# S1 Task Card — ARCH-1 VS-05B Image Replacement Index Fact Refresh

## State and assignment

- Task ID: `arch-1-vs-05b-image-replacement-index-fact`
- Phase / wave: `ARCH-1 / vertical-slice knowledge integration`
- Status: `implementing`
- Owner / Reviewer / Integrator: `Coordinator / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:28 Asia/Shanghai / pending`
- Worktree / branch: `primary integration workspace / codex/architecture-stabilization`
- Baseline HEAD: `8914750`
- Claim commit: `pending`
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

- [ ] currentFact states captured target + one document/resource history frame
- [ ] targetState states desktop/Preview/HTML/Web evidence still pending VS-06
- [ ] current action aliases and new vertical-slice test are discoverable within existing budgets
- [ ] semantic test, unchanged golden quality and deterministic index checks pass
- [ ] a fresh Context Pack reports the new fact

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- `npm run repo:index:quality`
- `npm run repo:index && npm run repo:index:check`
- Context Pack smoke and diff hygiene

## Rollback

- Start point: `8914750`
- Implementation/generated commit: `pending`
- Old path remains: generated facts are fresh, but the image-replacement semantic currentFact incorrectly describes the deleted async nodeId writer.

## Result evidence

- Pending.

## Ready checklist

- [x] VS-05 target-green
- [x] semantic/generated locks available
- [x] fixed quality corpus read-only
- [x] no product escalation
