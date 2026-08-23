# S1 Task Card — ARCH-0B Semantic Symbol Fallback Integrity

## State and assignment

- Task ID: `arch-0b-idx-03e-semantic-symbol-fallback-integrity`
- Phase / wave: `ARCH-0B / quality correctness retry 3`
- Status: `implementing`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 03:01 Asia/Shanghai / pending`
- Worktree / branch: `shared workspace, query-only scope / codex/architecture-stabilization`
- Baseline HEAD: `75d914f1419c4c0fc108498331e5cb2cd0edbca9`
- Claim commit: `pending`
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

- [ ] `matchedSymbols` and `matchedFiles` are both empty for a terminology-only symbol fallback
- [ ] matched Feature, confidence, Bootstrap policy, candidates and relevant paths remain correct
- [ ] a real exact Symbol query still reports its declaring file as exact
- [ ] unchanged controlled and broad golden gates pass
- [ ] repeated quality signatures are identical
- [ ] corpus/expected/evaluator/semantic remain byte-unchanged

## Minimal validation

- `npx vitest run tests/unit/repoIndexQuery.test.ts tests/unit/repoIndexGoldenTasks.test.ts`
- `npm run repo:index:quality` twice
- `npm run typecheck`
- diff hygiene

## Rollback

- Start point: `75d914f1419c4c0fc108498331e5cb2cd0edbca9`
- Implementation commit: `pending`
- Old path remains: terminology fallback falsely exposes broad Feature files as exact matches and the broad quality gate fails.

## Consumers and index

- Consumer delta: development query ranking only
- Legacy record IDs: none
- indexImpact: `toolHash regenerate`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] query hotspot available
- [x] fixed inputs read-only
- [x] current failure reproduced
- [x] no product escalation
