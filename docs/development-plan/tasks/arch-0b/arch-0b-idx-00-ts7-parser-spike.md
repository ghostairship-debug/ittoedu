# S1 Task Card — ARCH-0B IDX-00 TypeScript 7 Adapter Spike

## State and assignment

- Task ID: `arch-0b-idx-00-ts7-parser-spike`
- Phase / wave: `ARCH-0B / wave 1`
- Status: `done`
- Owner / Reviewer / Integrator: `Tooling Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / 2026-08-24 01:10 Asia/Shanghai`
- Worktree / branch: `shared workspace, repo-index tooling-only write scope / codex/architecture-stabilization`
- Baseline HEAD: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Claim commit: `0d8c610d6ec0cf1c4b919b784adf3178ed968a4c`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: clean baseline; fixture and inventory workers have disjoint scopes
- Depends on: `arch-0a-bsl-00-baseline-and-budgets (done)`
- Blocks: `arch-0b-idx-01-deterministic-facts-check`
- Retry count: `0`

## Product outcome

A thin, deterministic TypeScript 7 adapter proves that the repository's three TypeScript projects can be indexed on Windows without leaking unstable compiler objects into the rest of the tool.

## Current fact and evidence

The repository pins TypeScript `7.0.2`. The package root does not expose the traditional compiler API; `typescript/unstable/sync` and `typescript/unstable/ast` exist. No repo-index adapter or current index command exists.

## Non-goals

- No complete repo-index schema, generator, query CLI, or semantic data.
- No product runtime, contract, package, lockfile, or generated output change.
- No second TypeScript or ts-morph dependency.

## Scope and locks

### Allowed write

- `scripts/repo-index/typescriptAdapter.ts`
- `scripts/repo-index/model.ts` only for the stable adapter DTO interfaces needed by the spike
- `scripts/repo-index/fixtures/**`
- `tests/unit/repoIndexTypeScriptAdapter.test.ts`
- This task card result fields.

### Required read

- `tsconfig.json`, `tsconfig.electron.json`, `tsconfig.e2e.json`
- `node_modules/typescript/dist/api/sync/api.d.ts`
- `node_modules/typescript/dist/ast/**` declarations as needed
- Representative renderer/player/shared, main/preload, and e2e files.

### Forbidden write

- `src/**`, contracts/Schema, `package.json`, `package-lock.json`
- `repo-index/semantic/**`, `repo-index/generated/**`, generator/query entrypoints
- other task cards and ARCH-0A evidence

### Do not read unless needed

- Product feature internals unrelated to parsing and historical task bodies.

### Hotspot locks

- None; generated repo-index lock is not acquired because this card emits no committed generated index.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `2 tooling files + fixtures + 1 focused test`
- New/moved files: `within Allowed write only`
- Public exports: `stable internal adapter DTO + factory only`
- Deletion allowed: `no`
- Dependency/lockfile changes: `no`
- UI copy/behavior changes: `no`
- Schema/contract changes: `no`
- Generated diff: `no`
- Target tests / expected validation time: `one focused Vitest file; adapter real-project smoke under 10 seconds`
- Max implementation retries: `2`; maximum parser designs: `3`

## Characterization

- Current successful behavior: `typescript/unstable/sync` and `/unstable/ast` are importable under Node 24.
- Known failure: no stable wrapper, multi-project union, import/export/symbol/test extraction, or determinism proof exists.
- Async/stale/history/save/preview implications: not applicable; development-only tooling.

## Implementation outline

1. Encapsulate every unstable TypeScript import in `typescriptAdapter.ts`.
2. Load all three configs, normalize relative `/` paths, union shared files, and retain project membership.
3. Extract static/type/dynamic imports, exports/re-exports, top-level high-signal declarations, line/JSDoc, and literal test names.
4. Prove aliases/barrels/type imports/dynamic imports, Windows normalization, de-duplication, dispose, and identical repeated scans.
5. Record a technical verdict; if the unstable API cannot meet V1 reliably, use a deterministic scanner fallback without new dependencies.

## Acceptance

- [x] Three projects covered with shared-file de-duplication
- [x] Renderer/player/shared, main/preload, unit/integration/e2e coverage proven
- [x] Required import/export/symbol/test cases extracted
- [x] Windows path and repeated output stable
- [x] Unstable API imports isolated to one file
- [x] No product/dependency/generated change

## Minimal validation

- `npx vitest run tests/unit/repoIndexTypeScriptAdapter.test.ts`
- Manual smoke: print project/file coverage counts twice and compare stable serialization.
- `git diff --check`

## Rollback

- Start point: `6893d25449511ef281c9399d6dd740d126a25bb6`
- Implementation commit: `ed892ea5088166bab6a94053b66167a619f47f63`
- Old path remains: manual Bootstrap remains the only trusted development navigation.

## Consumers and index

- Consumer delta: `0 product consumers`; establishes generator input adapter.
- Legacy record IDs: none
- indexImpact: `none until IDX-01 integrates the adapter`

## Result evidence

- Technical verdict: `typescript/unstable/sync` plus `typescript/unstable/ast` satisfies the V1 spike. `API.updateSnapshot({ openProjects })` loads all three projects, and the official SourceFile AST/type guards provide the required imports, exports, top-level declarations, lines, JSDoc and literal test calls. No scanner fallback, second parser, dependency, or ADR is needed.
- Stable boundary: only `scripts/repo-index/typescriptAdapter.ts` imports `typescript/unstable/*`; `model.ts` exposes plain DTOs and the stable adapter interface, so unstable AST objects do not escape.
- Focused validation: `npx vitest run tests/unit/repoIndexTypeScriptAdapter.test.ts --reporter=verbose` passed `3/3` tests.
- Real-project smoke: the current shared workspace produced `541` de-duplicated repository TypeScript files (`tsconfig.json=525`, `tsconfig.electron.json=90`, `tsconfig.e2e.json=115`; memberships overlap by design). Two independent full adapter loads/scans serialized identically; latest timings were `976.9 ms` and `926.3 ms`.
- Coverage evidence: renderer/player/shared, main/preload, unit/integration/e2e prefixes were all present; `src/shared/projectTypes.ts` retained membership in all three projects.
- Type validation: `npx tsc --noEmit --pretty false` passed.
- Hygiene: recursive unstable-import isolation assertion passed; `git diff --check` and explicit trailing-whitespace scan produced no findings. Product source, package/lockfile, contracts, semantic/generated index, generator and query files were unchanged by this task.
- Coordinator review: DTO boundary, official API lifecycle, Windows normalization, de-duplication, extraction rules, and recursive unstable-import isolation were reviewed. The focused suite was independently rerun against the shared workspace (542 files after concurrent task additions) and passed 3/3; root TypeScript and diff hygiene also passed.

## Findings / next allowed task

- IDX-01 parser prerequisite is integrated and done. It may consume the stable DTO/factory; generated index ownership remains with the Coordinator.

## Ready checklist (Coordinator)

- [x] dependsOn satisfied
- [x] Bootstrap context verified
- [x] evidence and paths valid
- [x] write locks available
- [x] budget/validation/rollback complete
- [x] no related user dirty change
- [x] no product escalation triggered
