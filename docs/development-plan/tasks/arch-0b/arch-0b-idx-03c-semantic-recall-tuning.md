# S1 Task Card — ARCH-0B Semantic Recall Tuning

## State and assignment

- Task ID: `arch-0b-idx-03c-semantic-recall-tuning`
- Phase / wave: `ARCH-0B / quality tuning 2`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Semantic Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, semantic-only scope / codex/architecture-stabilization`
- Baseline HEAD: `531d8d589391613b17414bbb0ed4f1dbd6fe68f0`
- Claim commit: `commit containing this wave claim`
- Context: `unchanged corpus correctness signature fe47d786 + per-task required-recall gaps`
- Freshness / relevant dirty inputs: ranking tuning is disjoint; corpus/expected/evaluator read-only
- Depends on: `arch-0b-idx-03a done; corrected quality evaluator at 531d8d5`
- Blocks: unchanged-corpus quality rerun 2
- Retry count: `0`

## Product outcome

Existing Feature records recall a bounded set of canonical contracts and high-signal tests required to verify the current behavior, without adding more Features or copying complete expected sets.

## Current fact and evidence

After tuning wave 1, task Hit@5 is 100% but Recall@15 is 72.5%/66.15%. Remaining misses cluster around V9/Published contracts, save/preview tests, Flow media/product tests, compiler configs, desktop/E2E, Legacy compatibility proof and local Catalog tests.

## Non-goals

- No query/ranker/evaluator/corpus/expected/generated/config/package/product change.
- No new Feature, call graph, or per-task exact ordering.

## Scope and locks

### Allowed write

- `repo-index/semantic/features.json`
- `tests/unit/repoIndexSemantic.test.ts`
- This task card

### Required read

- Corrected quality report/signature and current per-task missing relations
- FACT/MAP, Legacy ledger and current test/contract paths

### Forbidden write

- query/context/evaluator/corpus/expected/generated/config/modules/package/product/contracts

### Hotspot locks

- Feature semantic only.

## Change budget

- Task timebox: `1 Worker day`
- Feature count fixed at 22; no new aliases unless needed for current terminology
- `highSignalFiles` max 12, `highSignalTests` max 8, Catalog boundary max 5
- No dependency/UI/Schema/generated change
- Max implementation retries: `2`

## Implementation outline

1. Add shared V9/Published contract paths to the Features that consume them.
2. Add sparse current high-signal tests for image/save/preview/Flow/delivery/desktop/Legacy/Catalog.
3. Add renderer/player/vitest/playwright configs to Repo Knowledge evidence.
4. Add local Catalog ledger/tests without changing external-source status.

## Acceptance

- [ ] Feature count/alias uniqueness unchanged
- [ ] Every added path exists and is justified by current module/consumer evidence
- [ ] Signal budgets remain bounded
- [ ] Image/Flow/Save/Preview/Delivery/Desktop/Repo/Legacy/Catalog recall classes covered
- [ ] Corpus/expected/query/evaluator untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexSemantic.test.ts`
- Path/budget/alias/diff checks
- Coordinator full unchanged quality after ranking tuning

## Rollback

- Start point: `68163868df08abb6aab647971429af513cfee87c`
- Implementation commit: pending
- Old path remains: wave-1 semantic is safe but below recall gate.

## Consumers and index

- Consumer delta: semantic validation signals only
- Legacy record IDs: read-only evidence
- indexImpact: `semantic-update + regenerate`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] corrected gap list fixed
- [x] semantic lock available
- [x] expected/query read-only
- [x] no product escalation
