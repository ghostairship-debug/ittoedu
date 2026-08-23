# S1 Task Card — ARCH-0B Query Impact Tuning

## State and assignment

- Task ID: `arch-0b-idx-03b-query-impact-tuning`
- Phase / wave: `ARCH-0B / quality tuning 1`
- Status: `done`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, query-only scope / codex/architecture-stabilization`
- Baseline HEAD: `8a0d223e8d668849d4c5db3f5c7bb84e42000687`
- Claim commit: `fb9f4a63dc68eba549f0de0b39fef5f14fb2b099`
- Context: `fixed GT quality baseline c22c6fd5 + independent query-gap audit`
- Freshness / relevant dirty inputs: semantic tuning is disjoint; corpus/expected/evaluator immutable
- Depends on: `arch-0b-idx-03 golden baseline implementation at 8a0d223; IDX-02 done`
- Blocks: unchanged-corpus quality rerun
- Retry count: `0`

## Product outcome

Exact, changed and low-confidence multi-intent queries conservatively expand current Feature, direct graph, test and TypeScript-project evidence without inventing symbols or turning ambiguity into false confidence.

## Current fact and evidence

Quality baseline shows GT-001 multi-intent paths collapse to one weak Feature, GT-002 non-top-level terminology returns nothing, exact symbol/path loses evidence when multiple Features share a file, changed shared files omit project tsconfigs, and external Catalog queries omit local boundary metadata.

## Non-goals

- No corpus/expected/evaluator/semantic/generated/config/package/product change.
- No full call graph, raw source grep, hardcoded GT IDs/paths, or confidence inflation.

## Scope and locks

### Allowed write

- `scripts/repo-index/query.ts`
- `scripts/repo-index/contextPack.ts` only if needed to render associated Feature/high-signal evidence
- `tests/unit/repoIndexQuery.test.ts`
- This task card

### Required read

- Fixed quality gap report and evaluator ranking (read-only)
- Current generated edges/File projects/Test facts
- Concurrent semantic field contract (coordinate message boundary; do not edit)

### Forbidden write

- semantic/corpus/expected/evaluator/generated/config/package
- product/contracts/lockfile/other cards

### Hotspot locks

- Query/context implementation single owner only.

## Change budget

- Task timebox: `1.5 Worker days`
- Main files: `query + optional context + focused test`
- Public DTO additions: only narrow associated-feature/high-signal fields required by Context Pack
- Product/dependency/UI/Schema/generated changes: `no`
- Target validation: focused query suite + targeted GT categories; under 3 minutes
- Max implementation retries: `2`

## Implementation outline

1. For missing exact Symbol, resolve an exact semantic terminology alias with an explicit non-Symbol reason; never fabricate Symbol facts.
2. For low-confidence free text, aggregate a bounded set of near-top Feature candidates and keep Bootstrap required.
3. Score exact path/symbol Feature association by canonical/entrypoint/high-signal/consumer role instead of dropping all ambiguous associations.
4. Add direct unique edge/test neighbors and File `projects` tsconfig membership to impact paths, especially changed mode.
5. For external source intent, rank semantic local Catalog boundary signals before generic component runtime paths while remaining low-confidence.

## Acceptance

- [x] GT-001 class returns Slide/Media/Core journey evidence but remains low/bootstrap
- [x] `activateCourseLocation` resolves via terminology evidence with no fabricated Symbol and matches expected confidence policy
- [x] Repo Knowledge query recalls three tsconfigs; changed IPC includes project memberships
- [x] Exact symbol/path consumers/tests expand one bounded graph hop with unique paths
- [x] External Catalog queries rank local boundary metadata and remain low/bootstrap/external-source-unavailable
- [x] No high-confidence wrong/forbidden regression in focused fixtures
- [x] Corpus/expected/evaluator/semantic untouched

## Minimal validation

- `npx vitest run tests/unit/repoIndexQuery.test.ts`
- Targeted GT-001/002/020/021/024/025 smoke using temporary fresh index
- Three TypeScript configs and diff hygiene
- Coordinator alone runs the full unchanged quality gate after both tuning tasks

## Rollback

- Start point: `4539b37a3d793991e1bd32cadefaceda21236b49`
- Implementation commit: `135a43fe08802c8fcbfc13ca7923a6092fc91d5d`
- Old path remains: current conservative query remains safe but broad quality blocked.

## Consumers and index

- Consumer delta: development query evidence only
- Legacy record IDs: none
- indexImpact: `toolHash regenerate`

## Result evidence

- Semantic terminology fallback: a missing exact Symbol may resolve only when exactly one current Feature alias/terminology matches. The result cites that Feature at high confidence, leaves `matchedSymbols=[]`, records that no Symbol fact exists, and never invents a declaration. Current `activateCourseLocation` resolves to the evidence-backed Preview/CoursePlayer Feature and its Store/layout/try-run tests.
- Feature association: exact symbol/path and changed queries score every associated Feature by canonical, entrypoint, high-signal, Catalog-boundary, consumer, test and evidence role. A unique strongest association becomes the matched Feature; bounded alternatives remain `associatedFeatures` and candidates instead of disappearing on ambiguity.
- Impact expansion: exact and changed seeds add one bounded unique graph hop ordered by tested-by/contract/re-export/import strength, generated related tests, and each File fact's TypeScript `projects`. Shared IPC/preload changes therefore expose root/Electron/e2e configs plus main/renderer/test impact while remaining stale/Bootstrap-required for dirty inputs.
- Multi-intent safety: low-confidence text aggregates at most six near-top Features and bounded evidence without setting one matched writer. Semantic exact terms, Han phrase overlap, multi-module journey breadth and high-signal filename anchors improve relevance, while four-or-more-token ambiguity remains `low` when another candidate is close. The current image-replacement journey returns App/Store/authoring target, Media bytes/history and Slide evidence but cannot authorize writing.
- Repo Knowledge: compiler-boundary text ranks the semantic Repo Knowledge boundary first and recalls `tsconfig.json`, `tsconfig.electron.json`, `tsconfig.e2e.json`, package/config/adapter/test evidence while remaining conservative low-confidence Bootstrap output.
- External Catalog: query-specific Components views put `catalogBoundaryFiles` and `highSignalTests` ahead of generic runtime placement, remain low-confidence/Bootstrap with `external-source-unavailable`, and expose only local snapshot/manager/status/UI facts—never an external package source path.
- Context Pack: associated Feature current status, high-signal files/tests, Catalog boundary paths, carriers, candidate entrypoints and consumers are rendered explicitly. Low-confidence associated entrypoints are labelled non-authoritative; all existing size/freshness/output constraints remain intact.
- Focused validation: `npx vitest run tests/unit/repoIndexQuery.test.ts --reporter=verbose` passed `14/14`. Capability fixtures cover exact terminology without a Symbol, bounded multi-intent aggregation, compiler/tsconfig routing, dirty shared IPC project impact, exact one-hop relation expansion, four external-source phrasings, Legacy/normal-V9 ranking and all prior query safety behavior. Tests use real task-class wording but do not import corpus, expected data or task IDs.
- Static validation: root, Electron and E2E TypeScript checks passed; diff hygiene passed. Only `query.ts`, `contextPack.ts`, focused query tests and this card changed. Semantic, corpus/expected/evaluator, generated, config/package, product/contracts/lockfile and other cards were not written.
- Full quality gate was intentionally not run by this Worker; the Coordinator must rerun the unchanged corpus/evaluator after integrating both semantic and query tuning waves and rebuilding the strict index.
- Coordinator quality review with the corrected mode-aware evaluator removed all zero-hit and confidence/Bootstrap mismatches: controlled/broad Hit@5 became 100%, wrong-high remained 0 and low-confidence remained 4/4. Recall@15 and one external forbidden relation remain separate second-wave evidence-order/semantic work; they do not invalidate this task's bounded impact capabilities.

## Ready checklist (Coordinator)

- [x] fixed quality gaps available
- [x] query lock available
- [x] corpus/expected/evaluator read-only
- [x] semantic writer disjoint
- [x] no product escalation
