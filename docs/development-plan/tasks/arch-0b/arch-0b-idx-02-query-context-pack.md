# S1 Task Card — ARCH-0B IDX-02 Query and Context Pack

## State and assignment

- Task ID: `arch-0b-idx-02-query-context-pack`
- Phase / wave: `ARCH-0B / wave 3`
- Status: `retrying`
- Owner / Reviewer / Integrator: `Query Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / retry 1 opened 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, query-tool-only scope / codex/architecture-stabilization`
- Baseline HEAD: `305eb648141230471a9975bf3fa3facf97a0d0aa`
- Claim commit: `8dd03b868c054af4a3723d84e0ac2e1dfefd7000`
- Context: `fresh repo:index manifest + completed 21 Feature / 17 Module semantic`
- Freshness / relevant dirty inputs: clean worktree; generated facts/check fresh; concurrent ARCH-0A gate writes are excluded task/report paths and disjoint
- Depends on: `arch-0b-idx-01-deterministic-facts-check (done); arch-0b-idx-01b-semantic-coverage (done)`
- Blocks: `arch-0b-idx-03-golden-task-gates`
- Retry count: `1` (Coordinator review requires realistic external-package source fallback coverage and restricts absolute Context Pack output to OS temporary paths)

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

- [x] Feature, symbol, path, changed, and conservative query modes work
- [x] Runtime freshness/dirty diagnostics compare all strict domains
- [x] Confidence, candidates, evidence, unknowns, and Bootstrap fallback are explicit
- [x] Context Pack uses the required sections and small/medium/large byte+line budgets
- [x] No complete source copy, absolute path, machine identity, or committed context output
- [x] CLI P95 is below 2 seconds on the golden-query harness

## Minimal validation

- Focused query/Context Pack unit suite
- One smoke query for each exact mode and one low-confidence free-text query
- Stale/dirty fixture check
- `npm run typecheck`, task-board check, and diff hygiene

## Rollback

- Start point: IDX-01 completion commit
- Implementation commit: `not created; Worker was instructed not to commit`
- Old path remains: manual Bootstrap remains mandatory until IDX-03 passes.

## Consumers and index

- Consumer delta: adds development CLI only
- Legacy record IDs: none
- indexImpact: `toolHash regeneration by Coordinator`

## Result evidence

- Modes and precedence: mutually exclusive `--feature`, `--symbol`, `--path`, `--changed`, and `--query` modes are implemented with `--size small|medium|large` and optional `--output`. Feature exact matching accepts `feature:` suffix, name and NFKC-normalized aliases; symbol/path exact modes avoid free-text ranking. Free text uses only semantic aliases, symbol/path/test substrings and conservative scoring. Transitional Legacy candidates receive a penalty unless Legacy/V8 is explicit, so normal Published V2/HTML/Preview facts remain ahead of Legacy fallbacks.
- Confidence safety: weak/ambiguous text and external `courseware-components`/Catalog-source requests return `low`, candidates, explicit unknowns and `bootstrap-required`; external source navigation is never claimed. Exact ambiguous symbols remain medium with Bootstrap instead of selecting one file silently.
- Freshness: query startup recomputes all four strict domain hashes and the complete per-file inventory, compares both with the generated manifest/inventory, and obtains dirty paths from `git status --porcelain=v1 -z` using `spawnSync` with argument arrays and no shell. Results distinguish `fresh`, `partially-stale`, and `stale`, list all dirty plus query-relevant dirty inputs, and expose `safe-for-S2`; partial/stale is never treated as fresh for S2.
- Context Pack: all 13 required sections are always present. Content is limited to repository-relative paths, semantic short summaries, stable symbols/lines, ordered reading paths, high-signal consumers/tests, invariants, exclusions, validation commands and unknowns; it never copies source bodies or persists an absolute path, machine identity, time or repository revision. Size budgets are strict upper bounds (`20/50/100 KB`, `350/800/1600` lines) and are not padded. Six real small CLI outputs measured approximately `4.1–6.7 KB` with all 13 sections.
- Output safety: stdout is the default. Repository-local `--output` is accepted only under ignored `repo-index/contexts/`; OS-temporary absolute output is supported. Focused tests prove output stays outside committed paths and `.gitignore` remains authoritative.
- Query coverage: focused tests cover all modes, mutual exclusion, NFKC exact aliases, exact symbol/path priority, normal V9 over Legacy, changed/dirty paths, external Catalog fallback, unmapped low confidence, fresh/partial/stale/relevant-dirty assessment, shell-safe unusual filenames, every Context Pack section/budget, temporary output and cached performance.
- Performance: cached index load measured `141.84 ms`; 100 exact Feature queries measured `P50 1.155 ms`, `P95 1.865 ms`, maximum `5.301 ms`. Six independent full CLI processes completed in approximately `0.97–1.05 s`, below the `2 s` gate.
- Validation: `npx vitest run tests/unit/repoIndexQuery.test.ts --reporter=verbose` passed `9/9`; six feature/symbol/path/changed/free/external CLI smoke commands exited `0`; all three TypeScript projects, task-board check in claimed state and diff hygiene passed.
- Expected index impact: `package.json` adds only `repo:context`; `repo-index/config.json` assigns `scripts/query-repo-index.ts` to the tool domain; no lockfile/dependency change occurred. The current read-only `repo:index:check` correctly reports stale generated facts because the query/config/package/tool inputs and `bf768ac` static-plan input postdate the current manifest. Per scope, generated files were not rebuilt; Coordinator must regenerate after integration.
- Remaining gate: manual Bootstrap remains authoritative until IDX-03 golden-task gates pass. Coordinator must review/integrate and refresh the derived task board after this card's status transition.
- Coordinator review finding: package-identity/“latest third-party component source” queries were low-confidence but did not attach the local Components boundary/external-source unknown required by the planned golden tasks; absolute `--output` outside the repository was also accepted at any filesystem path rather than only under the OS temporary directory. Retry 1 must add realistic GT-024/025 fixtures and enforce the documented output boundary.

## Ready checklist (Coordinator)

- [x] IDX-01 done and index fresh
- [x] context and generated paths validated
- [x] write scope/locks/budget valid
- [x] no user dirty changes in relevant inputs
- [x] no product escalation
