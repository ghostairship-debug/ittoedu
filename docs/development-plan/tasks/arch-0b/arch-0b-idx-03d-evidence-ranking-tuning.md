# S1 Task Card — ARCH-0B Evidence Ranking Tuning

## State and assignment

- Task ID: `arch-0b-idx-03d-evidence-ranking-tuning`
- Phase / wave: `ARCH-0B / quality tuning 2`
- Status: `done`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 03:05 Asia/Shanghai`
- Worktree / branch: `shared workspace, query-only scope / codex/architecture-stabilization`
- Baseline HEAD: `531d8d589391613b17414bbb0ed4f1dbd6fe68f0`
- Claim commit: `1d7027fa939b46059e7b4053273bf10096fc19f9`
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

- [x] Normal Components query does not rank Catalog boundary ahead of runtime consumers/tests
- [x] High-signal tests/contracts can enter Top 15 deterministically
- [x] GT-024 class excludes ComponentsTab Top 5 and keeps local snapshot/manager/shared/import/contract
- [x] GT-025 class retains local status/UI boundary
- [x] Both remain low/bootstrap/external-source-unavailable
- [x] No wrong-high/forbidden regression in focused tests
- [x] Corpus/expected/evaluator/semantic untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexQuery.test.ts`
- Normal Components + package-specific + ambiguous Catalog smoke
- Typecheck/diff; Coordinator full quality after semantic integration

## Rollback

- Start point: `135a43fe08802c8fcbfc13ca7923a6092fc91d5d`
- Implementation commit: `4e30c7d973a35f899a5b407861685531031714c5`
- Old path remains: safe wave-1 query with lower recall and one known forbidden relation.

## Consumers and index

- Consumer delta: development ranking only
- Legacy record IDs: none
- indexImpact: `toolHash regenerate`

## Result evidence

- Generic evidence order: normal Feature paths now exclude `catalogBoundaryFiles` entirely and preserve semantic order `canonical → entrypoint → highSignalFiles → highSignalTests → tests → runtimeConsumers → evidence`. Components runtime/verification paths remain available, but mutable Catalog snapshot/status/UI cannot displace them in ordinary Component authoring queries.
- External intent classification: source requests are classified as `package-source` when they contain a package identity/runtime-source intent and as `catalog-ambiguous` for latest/third-party mutable Catalog intent. Both remain `low`, Bootstrap-required and carry `external-source-unavailable`; neither invents an external repository or runtime file path.
- Package-source view: the query builds a local Components evidence view from semantic fields and generated Test facts. Its first five stable paths are Catalog snapshot, main Catalog manager, shared Catalog API, package import entrypoint and Component V4 contract. Component status/UI paths are excluded from this view and therefore cannot become a forbidden Top-5 result. Catalog/content-integrity tests follow before runtime consumers and documentation.
- Ambiguous-latest view: the query preserves the full local mutable boundary, ordering Catalog status, manager, snapshot and Components UI first, followed by shared API and the current Feature/consumer/owner ledger. Related Catalog status/package tests are attached; this is local metadata/authoring evidence only, not a guessed external source.
- Context Pack: Catalog boundary rows render only for the query-specific external view. Normal Components packs omit them; external packs label them as local Catalog boundary evidence. Associated high-signal tests remain ahead of runtime consumers/evidence under the same bounded budgets.
- Focused validation: `npx vitest run tests/unit/repoIndexQuery.test.ts --reporter=verbose` passed `14/14`. Capability tests cover normal Components exclusion/order, two package-source phrasings, two ambiguous-latest phrasings, exact five/four path prefixes, ComponentsTab exclusion, ledger/Test association, low confidence, Bootstrap fallback and no external-looking relevant path. All prior exact/changed/multi-intent/Legacy/wrong-high protections remain green.
- Static validation: root, Electron and E2E TypeScript checks passed; diff hygiene passed. Only `query.ts`, `contextPack.ts`, focused query tests and this card changed. Concurrent semantic recall work was read but not modified; corpus, expected, evaluator, generated, config/package, product/contracts/lockfile and other cards were untouched by this Worker.
- Full unchanged quality gate was intentionally left to the Coordinator after both semantic and query evidence waves are integrated and strict generated facts are refreshed.
- Coordinator integration gate subsequently passed twice on the unchanged corpus with signature `946bd025c438e57d55f3c5558d45ede4b75bed1a6591966eb7789846fd0d9a38`; broad Recall@15 is `85.38%`, Hit@5 is `100%`, and forbidden/wrong-high/fallback expectations all pass.

## Ready checklist (Coordinator)

- [x] corrected gap list fixed
- [x] query lock available
- [x] semantic writer disjoint
- [x] expected/evaluator read-only
- [x] no product escalation
