# ARCH-0B Project Knowledge Index Gate Report

> Gate decision: **pass**
>
> Date: `2026-08-24 Asia/Shanghai`
>
> Scope: deterministic repository facts, semantic navigation, query/Context Pack, freshness and 25-task quality gate

## 1. Decision

ARCH-0B is accepted as the default development-navigation entry. Medium/high-risk and multi-agent tasks may use a fresh Context Pack for bounded navigation. This does not replace source, Schema, contracts or manual review: low confidence, stale/partially-stale state, relevant dirty inputs and unavailable external source graphs still require explicit manual Bootstrap.

No product runtime, Course Project V9/Published V2/Runtime/Component contract, dependency or user-visible workflow changed in this phase.

## 2. Quality gate

The fixed `GT-001`–`GT-025` corpus and expected evidence were not shortened or rewritten after observing results. The final command passed twice with the same timing-independent signature:

- Signature: `946bd025c438e57d55f3c5558d45ede4b75bed1a6591966eb7789846fd0d9a38`
- Controlled 15: Hit@5 `15/15 = 100%`; required Recall@15 `76/80 = 95%`
- Broad 25: Hit@5 `25/25 = 100%`; required Recall@15 `111/130 = 85.38%`
- High-confidence wrong answers: `0`
- Forbidden paths in Top 5: `0`
- Confidence/Bootstrap expectation mismatches: `0`
- Expected low-confidence degradation: `4/4`
- Query P95: below `15 ms`; generation max: below `1.31 s`
- Index generation and repeated queries: deterministic
- Context volume reduction versus explicitly enumerated Bootstrap read paths: `96.93%` on the 25-task gate

The last correctness change removed broad Feature files from `matchedFiles` when a Symbol query only matched a semantic terminology alias. It did not fabricate a Symbol, change confidence, remove semantic evidence or alter exact Symbol/path/changed behavior.

## 3. Determinism and freshness

The committed index is generated from four disjoint strict input domains: source, semantic, config and tool. Check mode rebuilds in temporary directories and validates byte identity, semantic paths, Markdown references, contract artifacts, project membership, LF normalization, and the absence of HEAD/time/absolute-machine data.

Query-time safety remains stricter than a global manifest:

- `fresh` plus no relevant dirty input is required before an S2 Context Pack is treated as current;
- `partially-stale` is informative but not sufficient for high-risk writes;
- relevant dirty input or semantic/config drift is `stale`;
- low confidence and external component-source intent remain Bootstrap-required.

Generated files are owned by the phase Integrator. Workers report `indexImpact` and do not hand-edit `repo-index/generated/**`.

## 4. Development workflow integration

`PROJECT_COGNITION_INDEX.md` now directs development work through:

1. `npm run repo:index:check`;
2. exact feature/symbol/path/changed queries where possible;
3. bounded Context Pack review;
4. explicit Bootstrap fallback when freshness or confidence is insufficient.

CI checks deterministic task-board generation and repo-index freshness. It also runs the fixed quality gate without duplicating the product `verify` or desktop package flow.

## 5. Validation evidence

Required phase-gate commands:

- `npm run repo:index:check`
- `npm run check:task-board`
- `npm run repo:index:quality` twice
- focused adapter/generator/query/semantic/golden tests
- `npm run check:contracts`
- `npm run check:ai-capabilities`
- `npm run typecheck`
- Markdown/path validation through generator check
- `git diff --check`

The final command results are recorded on the ARCH-0B gate task card after the final generated refresh. Full E2E, packaging and product experience review are intentionally reserved for their planned stage gates; ARCH-0B changes only internal development navigation.

## 6. Status separation

- Pipeline status: `pass` — deterministic generation/check, fixed quality corpus, focused tests, contracts, capabilities, typechecks and task-board check pass.
- Engineering status: `accepted for ARCH-0B` — broad development navigation is enabled with explicit safety fallback.
- Outcome status: `engineering candidate` — automated evidence demonstrates navigation quality; real future task use remains observable evidence for further tuning.
- Product/teacher accepted status: `not applicable / not claimed` — no courseware UI, playback, export or authored lesson changed.

## 7. Remaining risks

- Several individual tasks still have partial Top 5/Top 15 diagnostic gaps even though aggregate hard gates pass. Further tuning must be generic and bounded; expected evidence must not be edited to improve scores.
- The generated index is a committed snapshot, not a daemon. Input changes require Integrator regeneration.
- External Catalog packages are outside the V1 source graph; local package/status evidence cannot be presented as external source coverage.
- Context Packs guide reading and validation; they do not authorize concurrent writes to App, Store, Workspace, Properties, Published producer, contracts or generated-index hotspots.
