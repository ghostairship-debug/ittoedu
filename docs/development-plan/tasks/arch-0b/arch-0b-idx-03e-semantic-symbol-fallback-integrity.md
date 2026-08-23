# S1 Task Card — ARCH-0B Semantic Symbol Fallback Integrity

## State and assignment

- Task ID: `arch-0b-idx-03e-semantic-symbol-fallback-integrity`
- Phase / wave: `ARCH-0B / quality correctness retry 3`
- Status: `done`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:01 Asia/Shanghai / done 2026-08-24 03:05 Asia/Shanghai`
- Worktree / branch: `shared workspace, query-only scope / codex/architecture-stabilization`
- Baseline HEAD: `75d914f1419c4c0fc108498331e5cb2cd0edbca9`
- Claim commit: `857e341df96d4cb0496769887d0c4197c80aa8f5`
- Context: `unchanged-corpus signature 21e23085; broad Recall@15 108/130`
- Freshness / relevant dirty inputs: `clean baseline; corpus/expected/evaluator/semantic immutable`
- Depends on: `arch-0b-idx-03c and arch-0b-idx-03d target-green`
- Blocks: `arch-0b-idx-03 broad quality gate`
- Retry count: `0`

## Product outcome

A symbol query that has no generated Symbol fact but has one exact semantic terminology alias returns Feature evidence without relabelling the Feature's entire file set as exact symbol matches.

## Current fact and evidence

`querySymbol` already says that it does not fabricate a Symbol fact, but its terminology fallback currently fills `matchedFiles` with every Feature path. The mode-aware quality ranker therefore treats an alphabetically ordered broad Feature set as exact symbol evidence before canonical, high-signal and verification paths. `activateCourseLocation` demonstrates the inconsistency: `matchedSymbols` is empty while nineteen Feature files are ranked as exact.

## Non-goals

- No golden corpus, expected evidence, evaluator, thresholds or semantic record change.
- No symbol fabrication, confidence inflation, generated-index change or GT-specific path order.
- No product, contract, package or dependency change.

## Scope and locks

### Allowed write

- `scripts/repo-index/query.ts`
- `tests/unit/repoIndexQuery.test.ts`
- This task card

### Required read

- `scripts/repo-index/evaluateGoldenTasks.ts`
- Fixed `GT-002` task and expected evidence

### Forbidden write

- evaluator, corpus, expected, semantic, generated, config, package, product, contracts

### Hotspot locks

- Query fallback only.

## Change budget

- Task timebox: `0.25 Worker day`
- Main files: one query branch and one focused assertion
- Max implementation retries: `1`

## Implementation outline

1. Keep unique terminology fallback Feature matching, candidate paths and relevant paths unchanged.
2. Return no `matchedFiles` when no exact Symbol exists; these files are semantic evidence, not exact facts.
3. Lock the invariant with the existing `activateCourseLocation` query test.
4. Rerun the unchanged 25-task gate twice; accept only if all hard gates pass deterministically.

## Acceptance

- [x] `matchedSymbols` and `matchedFiles` are both empty for a terminology-only symbol fallback
- [x] matched Feature, confidence, Bootstrap policy, candidates and relevant paths remain correct
- [x] a real exact Symbol query still reports its declaring file as exact
- [x] unchanged controlled and broad golden gates pass
- [x] repeated quality signatures are identical
- [x] corpus/expected/evaluator/semantic remain byte-unchanged

## Minimal validation

- `npx vitest run tests/unit/repoIndexQuery.test.ts tests/unit/repoIndexGoldenTasks.test.ts`
- `npm run repo:index:quality` twice
- `npm run typecheck`
- diff hygiene

## Rollback

- Start point: `75d914f1419c4c0fc108498331e5cb2cd0edbca9`
- Implementation commit: `a6f2fe7c598fa5c3febc1271cbd901ac818bb442`
- Old path remains: terminology fallback falsely exposes broad Feature files as exact matches and the broad quality gate fails.

## Consumers and index

- Consumer delta: development query ranking only
- Legacy record IDs: none
- indexImpact: `toolHash regenerate`

## Result evidence

- The terminology-only branch now leaves `matchedFiles` empty, matching its existing empty `matchedSymbols` contract; Feature candidates and relevant paths remain the only semantic evidence channel.
- The existing `activateCourseLocation` fixture now asserts both empty fact collections while retaining `feature:preview-player`, high confidence, no Bootstrap requirement and its verification paths. The exact `buildPublishedCourseV2Payload` Symbol fixture remains exact-first.
- `npx vitest run tests/unit/repoIndexQuery.test.ts tests/unit/repoIndexGoldenTasks.test.ts --reporter=verbose` passed `2 files / 18 tests`; all three TypeScript projects passed.
- The unchanged quality corpus passed twice with signature `946bd025c438e57d55f3c5558d45ede4b75bed1a6591966eb7789846fd0d9a38`: controlled Recall@15 `76/80 = 95%`, broad Recall@15 `111/130 = 85.38%`, Hit@5 `100%`, wrong-high/forbidden/expectation mismatch `0/0/0`, low fallbacks `4/4`.
- Both generations in each run were byte-identical at `sha256:3d59047375b490120cd08090f37fe6fdfce7fbf94baab622f57110517789a0f0`. Corpus, expected, evaluator, semantic, thresholds, product and contracts were unchanged by this task.

## Ready checklist (Coordinator)

- [x] query hotspot available
- [x] fixed inputs read-only
- [x] current failure reproduced
- [x] no product escalation
