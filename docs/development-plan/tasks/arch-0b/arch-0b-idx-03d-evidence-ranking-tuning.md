# S1 Task Card — ARCH-0B Evidence Ranking Tuning

## State and assignment

- Task ID: `arch-0b-idx-03d-evidence-ranking-tuning`
- Phase / wave: `ARCH-0B / quality tuning 2`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / —`
- Worktree / branch: `shared workspace, query-only scope / codex/architecture-stabilization`
- Baseline HEAD: `531d8d589391613b17414bbb0ed4f1dbd6fe68f0`
- Claim commit: `commit containing this wave claim`
- Context: `corrected mode-aware quality signature fe47d786 + fixed GT-024 forbidden evidence`
- Freshness / relevant dirty inputs: semantic recall tuning is disjoint; corpus/expected/evaluator immutable
- Depends on: `arch-0b-idx-03b done; corrected quality evaluator at 531d8d5`
- Blocks: unchanged-corpus quality rerun 2
- Retry count: `0`

## Product outcome

Feature evidence ranks verification contracts/tests before low-signal docs or unrelated Catalog UI, while package-specific and ambiguous Catalog queries retain distinct safe local boundaries.

## Current fact and evidence

The corrected evaluator now shows Hit@5 100%, but generic `featurePaths` includes Catalog boundary on every Components query and puts tests after consumers/evidence. GT-024 exact package-source includes forbidden ComponentsTab, while many required tests/contracts fall outside Top 15.

## Non-goals

- No semantic/corpus/expected/evaluator/generated/config/package/product change.
- No GT-specific path table or confidence inflation.

## Scope and locks

### Allowed write

- `scripts/repo-index/query.ts`
- `scripts/repo-index/contextPack.ts` only if display order must match evidence classes
- `tests/unit/repoIndexQuery.test.ts`
- This task card

### Required read

- Corrected quality report and current semantic optional fields
- GT-024 package-source versus GT-025 ambiguous Catalog behavior

### Forbidden write

- semantic/evaluator/corpus/expected/generated/config/package/product/contracts

### Hotspot locks

- Query/context only.

## Change budget

- Task timebox: `1 Worker day`
- Main files: query + optional context + focused test
- No public/dependency/UI/Schema/generated change
- Max implementation retries: `2`

## Implementation outline

1. Generic Feature ranking excludes `catalogBoundaryFiles`; external intent opts in.
2. Order bounded evidence as canonical/entrypoint/high-signal files, high-signal tests/tests, consumers, docs/evidence.
3. Distinguish exact package-source from ambiguous/latest Catalog intent.
4. Package-source Top 5 excludes UI and includes import/contract boundary; ambiguous Catalog may include status/UI.

## Acceptance

- [ ] Normal Components query does not rank Catalog boundary ahead of runtime consumers/tests
- [ ] High-signal tests/contracts can enter Top 15 deterministically
- [ ] GT-024 class excludes ComponentsTab Top 5 and keeps local snapshot/manager/shared/import/contract
- [ ] GT-025 class retains local status/UI boundary
- [ ] Both remain low/bootstrap/external-source-unavailable
- [ ] No wrong-high/forbidden regression in focused tests
- [ ] Corpus/expected/evaluator/semantic untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexQuery.test.ts`
- Normal Components + package-specific + ambiguous Catalog smoke
- Typecheck/diff; Coordinator full quality after semantic integration

## Rollback

- Start point: `135a43fe08802c8fcbfc13ca7923a6092fc91d5d`
- Implementation commit: pending
- Old path remains: safe wave-1 query with lower recall and one known forbidden relation.

## Consumers and index

- Consumer delta: development ranking only
- Legacy record IDs: none
- indexImpact: `toolHash regenerate`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [x] corrected gap list fixed
- [x] query lock available
- [x] semantic writer disjoint
- [x] expected/evaluator read-only
- [x] no product escalation
