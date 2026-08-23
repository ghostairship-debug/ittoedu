# S1 Task Card — ARCH-0B IDX-02 Query and Context Pack

## State and assignment

- Task ID: `arch-0b-idx-02-query-context-pack`
- Phase / wave: `ARCH-0B / wave 3`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Coordinator / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `1899deb33eb9b7cef13a3ad2ccbe1018d5eca171`
- Claim commit: `pending`
- Context: `bootstrap-manual until IDX-01 is done`
- Freshness / relevant dirty inputs: refresh after deterministic facts integration
- Depends on: `arch-0b-idx-01-deterministic-facts-check (done)`
- Blocks: `arch-0b-idx-03-golden-task-gates`
- Retry count: `0`

## Product outcome

An Agent can query a fresh index by feature, symbol, path, changed files, or conservative text and receive a bounded Context Pack that states confidence, evidence, unknowns, and Bootstrap fallback.

## Current fact and evidence

Manual Bootstrap is the only trusted navigation. The deterministic facts task will provide source records and strict freshness but no query ranking or Context Pack.

## Non-goals

- No embeddings, vector/graph database, daemon, watcher, full call graph, or product runtime integration.
- No claim that free text is authoritative.
- No committed temporary Context Packs.

## Scope and locks

### Allowed write

- `scripts/repo-index/query.ts`, `contextPack.ts`, and narrowly related pure helpers
- `scripts/query-repo-index.ts`
- `tests/unit/repoIndexQuery.test.ts`
- `package.json` script `repo:context` only
- `repo-index/config.json` only to assign the query entrypoint to the strict `tool` domain
- `repo-index/contexts/.gitignore`
- This task card.

### Required read

- Strict manifest and generated facts from IDX-01
- `repo-index/semantic/**`
- All four knowledge-system documents
- `git status --porcelain` behavior for changed/dirty diagnostics

### Forbidden write

- Product source/contracts/lockfile
- generated facts, semantic, golden tasks, other task cards

### Hotspot locks

- None for query implementation; generated repo-index remains read-only.

## Change budget

- Task timebox: `2 Worker days`
- Main source files: `up to 5 tooling files + 1 test + package script`
- Public exports: narrow query/context DTOs only
- Deletion/dependency/UI/Schema/generated changes: `no`
- Target tests / expected validation time: `focused query suite + five CLI smoke queries + dirty/stale check, under 2 minutes`
- Max implementation retries: `2`

## Characterization

- Exact feature/symbol/path/changed queries should outrank free text.
- High-confidence output must cite current facts; low confidence must return candidates and `bootstrap-required`.
- Context files are temporary and cannot become task state.

## Acceptance

- [ ] Feature, symbol, path, changed, and conservative query modes work
- [ ] Runtime freshness/dirty diagnostics compare all strict domains
- [ ] Confidence, candidates, evidence, unknowns, and Bootstrap fallback are explicit
- [ ] Context Pack uses the required sections and small/medium/large byte+line budgets
- [ ] No complete source copy, absolute path, machine identity, or committed context output
- [ ] CLI P95 is below 2 seconds on the golden-query harness

## Minimal validation

- Focused query/Context Pack unit suite
- One smoke query for each exact mode and one low-confidence free-text query
- Stale/dirty fixture check
- `npm run typecheck`, task-board check, and diff hygiene

## Rollback

- Start point: IDX-01 completion commit
- Implementation commit: pending
- Old path remains: manual Bootstrap remains mandatory until IDX-03 passes.

## Consumers and index

- Consumer delta: adds development CLI only
- Legacy record IDs: none
- indexImpact: `toolHash regeneration by Coordinator`

## Result evidence

- Pending.

## Ready checklist (Coordinator)

- [ ] IDX-01 done and index fresh
- [ ] context and generated paths validated
- [ ] write scope/locks/budget valid
- [ ] no user dirty changes in relevant inputs
- [ ] no product escalation
