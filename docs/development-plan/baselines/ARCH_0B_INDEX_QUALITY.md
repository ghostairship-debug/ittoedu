# ARCH-0B Repo-index Golden Task Quality Baseline

> Status: **hard gate failed — broad dispatch remains blocked**
>
> Corpus: `GT-001`–`GT-025`; controlled milestone: first 15 tasks.
>
> Current correctness-retry signature: `fe47d786c024aec000e28615c8ff35cfcdaae583c9b5de5b7490c12f8807f3fd`.
>
> Initial baseline signature: `c22c6fd5bf8c6b7a2898c7334c08f81e517c030a034b353ef3c3f7eeba66c46d`.

## 1. Fixed inputs and method

- Queries: `repo-index/golden-tasks/tasks.json`.
- Expected evidence: `repo-index/golden-tasks/expected.json`.
- Expected files were not changed after observing results.
- Ranked paths are unique and mode-aware: Feature queries start from semantic canonical/entrypoint; symbol/path/changed queries start from exact or dirty facts; ordered candidates and related consumer/test/edge evidence follow.
- Standard Hit@5 is task-level binary: a task passes Hit@5 when at least one `mustHitTop5` path appears in its Top 5.
- `canonicalRecallAt5` retains the stricter path-relation diagnostic and is not substituted for standard Hit@5.
- Recall@15 is the confirmed `requiredTop15` relation count divided by the expected relation count.
- Quality generation writes only two OS temporary directories and compares their byte hashes.
- Each query is executed twice; timings are excluded from the deterministic signature.
- Bootstrap comparison runs `git ls-files -- <expected paths>`, records only locator time and total expected read-path bytes, and compares those bytes with Context Pack bytes. It does **not** estimate human reading time.

Hard thresholds:

| Gate | Threshold |
|---|---:|
| Canonical Hit@5 | ≥ 90% |
| Required Recall@15 | ≥ 85% |
| High-confidence wrong | 0 |
| Forbidden path in Top 5 | 0 |
| Query P95 | < 2,000 ms |
| Generation | < 10,000 ms |
| Index/query determinism | required |
| Expected low-confidence fallback | all correct |

## 2. Controlled 15-task milestone — recorded first

| Metric | Result | Gate |
|---|---:|---|
| Canonical task Hit@5 | `13 / 15 = 86.67%` | **fail** |
| Canonical relation recall at 5 | `36 / 75 = 48.0%` | diagnostic |
| Required Recall@15 | `30 / 80 = 37.5%` | **fail** |
| High-confidence wrong | `0` | pass |
| Forbidden Top 5 relations | `0` | pass |
| Confidence/bootstrap expectation mismatches | `1` (`GT-002`) | **fail** |
| Expected low-confidence fallbacks | `1 / 1` | pass |
| Query P95 | `< 11 ms` | pass |
| Generation max | `< 1,300 ms` | pass |
| Index/query deterministic | `true / true` | pass |
| Context Pack bytes | `98,474` | informational |
| Bootstrap expected read-path bytes | `4,495,567` | informational |
| Context volume reduction | `97.81%` | pass |
| Bootstrap locator P95 / total | `< 66 / < 720 ms` | informational only |

Controlled zero-hit tasks: `GT-001`, `GT-002`. The other 13 tasks have partial canonical coverage. All 15 have at least one required-recall miss.

Controlled gate failed on `hitAt5`, `recallAt15`, and `confidenceOrBootstrapExpectation`.

## 3. Broad 25-task gate

| Metric | Result | Gate |
|---|---:|---|
| Canonical task Hit@5 | `21 / 25 = 84.0%` | **fail** |
| Canonical relation recall at 5 | `55 / 125 = 44.0%` | diagnostic |
| Required Recall@15 | `52 / 130 = 40.0%` | **fail** |
| High-confidence wrong | `0` | pass |
| Forbidden Top 5 relations | `0` | pass |
| Confidence/bootstrap expectation mismatches | `1` (`GT-002`) | **fail** |
| Expected low-confidence fallbacks | `4 / 4` | pass |
| `GT-024` / `GT-025` external Catalog fallback | `low + bootstrap-required` | pass |
| Query P95 | `< 11 ms` | pass |
| Generation max | `< 1,300 ms` | pass |
| Index/query deterministic | `true / true` | pass |
| Context Pack bytes | `165,905` | informational |
| Bootstrap expected read-path bytes | `7,189,215` | informational |
| Context volume reduction | `97.69%` | pass |
| Bootstrap locator P95 / total | `< 66 / < 1,210 ms` | informational only |

Broad zero-hit tasks: `GT-001`, `GT-002`, `GT-020`, `GT-025`. The other 21 tasks have partial canonical coverage. All 25 have at least one required-recall miss.

Broad gate failed on `hitAt5`, `recallAt15`, and `confidenceOrBootstrapExpectation`.

## 4. Initial pre-tuning per-task evidence gaps

`H5` below is the stricter retrieved/expected canonical relation count, retained as `canonicalRecallAt5`; task-level binary Hit@5 is reported separately above. `R15` is retrieved/expected relation count. No expected set was shortened to improve these numbers.

| Task | H5 | R15 | Confidence / bootstrap | Primary gap |
|---|---:|---:|---|---|
| GT-001 | 0/5 | 0/8 | low / yes | free text matched desktop IPC rather than Media/Editor target chain |
| GT-002 | 0/5 | 0/5 | low / yes | `activateCourseLocation` is not an indexed top-level symbol; expectation mismatch |
| GT-003 | 1/5 | 2/4 | high / no | Flow feature omits Properties/asset/sidecar and archive test links |
| GT-004 | 2/5 | 2/5 | high / no | wrap/paperSpace adapters and contract/tests do not reach Top 5/15 |
| GT-005 | 2/5 | 2/5 | high / no | Spatial try-run/Published contract and focused video tests absent |
| GT-006 | 4/5 | 2/6 | high / no | producer and three Surface host/test recall incomplete |
| GT-007 | 4/5 | 3/5 | high / no | DeveloperTab and runtime registry/developer tests under-recalled |
| GT-008 | 4/5 | 3/4 | high / no | InteractionEngine/test recall misses one required relation |
| GT-009 | 3/5 | 4/5 | high / no | authoring scope/NodesTab and V9 carrier contract under-ranked |
| GT-010 | 2/5 | 0/4 | high / no | exact App symbol expands to component files, not save/archive/history chain |
| GT-011 | 2/5 | 3/6 | high / no | desktop IPC and V9/lifecycle/createWindow evidence under-ranked |
| GT-012 | 4/5 | 2/6 | high / no | Published producer/contracts and producer test under-ranked |
| GT-013 | 1/5 | 1/5 | high / no | exact package symbol has ambiguous feature ownership; tests/scripts outrank V2 consumers |
| GT-014 | 3/5 | 3/6 | high / no | Published producer/print plan and contract/snapshot recall incomplete |
| GT-015 | 4/5 | 3/6 | high / no | preflight and Published/V9/IPC contracts under-ranked |
| GT-016 | 4/5 | 4/8 | high / no | V9 contracts and preflight/CLI tests under-ranked |
| GT-017 | 3/5 | 2/5 | high / no | DeveloperTab path does not pull contract schemas and target-edit tests into rank |
| GT-018 | 1/5 | 1/4 | high / no | exact helper remains in main file/test neighborhood; IPC/renderer consumers absent |
| GT-019 | 3/5 | 2/5 | high / no | createWindow/declaration and e2e/tsconfig evidence under-ranked |
| GT-020 | 0/5 | 0/5 | low / yes | compiler-boundary free text incorrectly selects Components candidate |
| GT-021 | 3/5 | 4/5 | high / yes | changed shared IPC files omit electron/e2e project memberships from ranking |
| GT-022 | 2/5 | 4/5 | high / no | build/example/course-I/O relations and one archive test under-ranked |
| GT-023 | 1/5 | 0/4 | high / no | exact dead candidate does not recall replacement CLI/package/Legacy evidence/tests |
| GT-024 | 2/5 | 2/4 | low / yes | external fallback is correct; local Catalog boundary paths/tests incomplete |
| GT-025 | 0/5 | 3/5 | low / yes | ambiguous fallback is correct; mutable Catalog/status/UI paths absent |

## 5. Stable successes

- No forbidden path entered any Top 5.
- No high-confidence query was classified as wrong by the fixed evidence rule.
- All expected low-confidence cases degraded correctly: `GT-001`, `GT-020`, `GT-024`, `GT-025`.
- Both external Catalog tasks returned `low` and `bootstrap-required`; no external source path was invented.
- Repeated complete quality runs produced the same timing-independent quality signature.
- Both temporary generations in each run were byte-identical.
- Query and generation performance have large margin under threshold.
- Context Pack volume is materially below the explicitly enumerated Bootstrap read-path volume.

## 6. Required bounded tuning, without changing expected evidence

The Coordinator should create finite tuning cards against query/index relationships, not this corpus:

1. Characterize symbol extraction/lookup for Store object methods such as `activateCourseLocation` (`GT-002`).
2. Add conservative journey/feature association for cross-feature image replacement without turning low confidence into a false single write path (`GT-001`).
3. Include TypeScript project memberships in changed/path ranking so shared IPC changes recall all three tsconfigs (`GT-020/021`).
4. Improve exact-symbol/path expansion from generated import/test edges to direct consumers and high-signal tests (`GT-003`, `GT-010`, `GT-013`, `GT-017`, `GT-018`, `GT-023`).
5. Return local Catalog boundary/status evidence while preserving low confidence and external-source exclusion (`GT-024/025`).

The 15-task controlled milestone and 25-task broad-dispatch gate remain closed until a later unchanged-corpus quality run passes every hard threshold.

## 7. Validation evidence

- `npx vitest run tests/unit/repoIndexGoldenTasks.test.ts` — 1 file / 4 tests passed.
- `npm run repo:index:quality` — run twice; both exited non-zero on the same hard gates and emitted identical signature.
- `npm run typecheck` — passed all three TypeScript projects.
- `npm run repo:index:check` — read-only expected stale: generated facts differ after adding package/corpus/evaluator/test inputs.
- `npm run check:task-board` — expected stale while this live task card is not integrated.
- Generated facts and task board were not refreshed by this Worker.

## 8. Evaluator correctness retry after semantic-signal tuning

This retry kept `GT-001`–`GT-025`, every expected relation, confidence expectation, threshold, query implementation and semantic input unchanged. The evaluator correction only stopped treating `matchedFiles` and `matchedSymbols` as exact results for Feature/free-text modes. Those arrays contain the full matched feature/candidate path set in those modes, so ranking them alphabetically ahead of semantic high-signal paths was incorrect. Symbol/path/changed modes continue to rank exact facts before semantic evidence; Feature/free-text modes now rank semantic canonical/entrypoint, ordered candidates, then related evidence. Paths remain unique.

Focused validation: `npx vitest run tests/unit/repoIndexGoldenTasks.test.ts` passed `1 file / 4 tests`.

### Controlled 15 after the correctness retry

| Metric | Result | Gate |
|---|---:|---|
| Canonical task Hit@5 | `15 / 15 = 100%` | pass |
| Canonical relation recall at 5 | `55 / 75 = 73.33%` | diagnostic |
| Required Recall@15 | `58 / 80 = 72.5%` | **fail** |
| High-confidence wrong | `0` | pass |
| Forbidden Top 5 relations | `0` | pass |
| Confidence/bootstrap expectation mismatches | `0` | pass |
| Expected low-confidence fallbacks | `1 / 1` | pass |
| Query P95 | `16.52 ms` | pass |
| Generation max | `1,270.98 ms` | pass |
| Index/query deterministic | `true / true` | pass |
| Context Pack / Bootstrap read-path bytes | `129,040 / 4,506,819` | informational |
| Context volume reduction | `97.14%` | pass |

Controlled zero-hit tasks: none. Partial canonical tasks: `GT-002/003/004/005/006/010/011/012`. Required-recall gaps remain in `GT-001/002/003/004/006/010/011/012/013/014`.

### Broad 25 after the correctness retry

| Metric | Result | Gate |
|---|---:|---|
| Canonical task Hit@5 | `25 / 25 = 100%` | pass |
| Canonical relation recall at 5 | `86 / 125 = 68.8%` | diagnostic |
| Required Recall@15 | `86 / 130 = 66.15%` | **fail** |
| High-confidence wrong | `0` | pass |
| Forbidden Top 5 relations | `1` (`GT-024`) | **fail** |
| Confidence/bootstrap expectation mismatches | `0` | pass |
| Expected low-confidence fallbacks | `4 / 4` | pass |
| Query P95 | `13.80 ms` | pass |
| Generation max | `1,270.98 ms` | pass |
| Index/query deterministic | `true / true` | pass |
| Context Pack / Bootstrap read-path bytes | `221,961 / 7,200,467` | informational |
| Context volume reduction | `96.92%` | pass |

Broad zero-hit tasks: none. Partial canonical tasks: `GT-002/003/004/005/006/010/011/012/016/018/019/020/021/022/023/024/025`. Required-recall gaps remain in `GT-001/002/003/004/006/010/011/012/013/014/017/018/019/020/022/023/024/025`. `GT-024` now correctly reaches the local Catalog boundary, but its fixed forbidden UI path also enters Top 5; that is reported as a real remaining gap rather than hidden by changing expected data.

The corrected run produced signature `fe47d786c024aec000e28615c8ff35cfcdaae583c9b5de5b7490c12f8807f3fd`; both temporary generations had hash `sha256:4201ce8aa87b0c8333e91d92641a0b40c72536b8634c21bdb5203fc28faed6a4`, and repeated queries inside the evaluator were deterministic. The hard gate remains closed on controlled/broad Recall@15 and broad forbidden Top 5. No further tuning was performed in this retry.
