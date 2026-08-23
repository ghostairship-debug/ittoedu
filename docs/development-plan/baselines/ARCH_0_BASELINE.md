# ARCH-0 Stabilization Baseline

> Captured: 2026-08-24 (Asia/Shanghai)
>
> Status: ARCH-0A focused phase gate passed and is `done`. See `ARCH_0A_GATE_REPORT.md`.

## Repository

- Activated-plan commit: `6c7616f4a8518be8e72cd26f5c5786bf7d7bdf63`
- Product-source comparison point retained by the plan: `690411d4a101b4020134712108262bddf08e0d2e`
- Implementation branch: `codex/architecture-stabilization`
- Rollback tag: `pre-architecture-stabilization-20260824-6c7616f`
- Working tree at capture: clean; no user-owned tracked or untracked changes
- Node: `v24.14.0`
- npm: `11.9.0`
- OS: `Microsoft Windows NT 10.0.26200.0`
- `package-lock.json` SHA-256: `77E3786A27451E7007D9B423E950FA1E817C0BB5CE71B3DB61095257BF8A76B2`
- External component catalog at capture: `available`, 4 experimental packages; license status unknown and not an architecture invariant

## Check classification

| Check | Command / evidence | Result | Classification |
|---|---|---|---|
| Contract generated artifacts | `npm run check:contracts` | pass; 4 artifacts current | non-blocking / green |
| AI capability generated artifacts | `npm run check:ai-capabilities` | pass; index current; external catalog available | non-blocking / green |
| Renderer/player + main/preload + e2e TypeScript | `npm run typecheck` | pass | non-blocking / green |
| Unit/integration | `npm run test` | pass; 202 files, 1263 tests; 206.58 s | non-blocking / green |
| Vitest Canvas messages | same unit run | repeated jsdom `HTMLCanvasElement.getContext()` not-implemented messages without failed tests | known-unrelated noise |
| Full E2E | not run in BSL-00 | no current result | deferred to representative-flow/stage gate; not silently classified green |
| Desktop build/package | not run in BSL-00 | no current result | deferred to affected integration/final candidate |
| Full `verify` | not run in BSL-00 | no current result | deferred by validation policy; baseline components above are recorded separately |
| Portable release artifact | `release/ittoedu-courseware-editor-portable-1.0.0.exe` absent | not available | known current delivery gap for ARCH-5, not a blocker for ARCH-0 |
| Release verifier input | `scripts/verify-release.ts` still contains a V8 benchmark assertion | legacy consumer | known current debt for ARCH-4/5 |

## Canonical evidence locations

- Baseline and budgets: this file
- Current task state: `docs/development-plan/tasks/<phase>/<task-id>.md`
- Generated task board: `docs/development-plan/TASK_BOARD.md` (must be generated; not hand-maintained)
- Feature/writer/consumer/owner facts: `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`
- Legacy deletion truth: `docs/development-plan/inventories/legacy-consumers.json`
- Representative V9 fixtures: `tests/fixtures/architecture-baseline/`
- Representative evidence and hashes: `docs/development-plan/baselines/ARCH_0_REPRESENTATIVE_PROJECTS.md`
- Performance evidence: `docs/development-plan/baselines/ARCH_0_PERFORMANCE.md`
- ARCH-0A phase decision: `docs/development-plan/baselines/ARCH_0A_GATE_REPORT.md`
- Strict development index: `repo-index/`
- Temporary Context Packs: `repo-index/contexts/` (ignored)

Follow-on files are authoritative only after their owning task reaches `done`; the current task board records that state.

## Legal V9 representative projects

`arch-0a-rep-00-v9-representative-projects` is done. Existing tiny V9 fixtures were retained as seed inputs; the representative archives below were generated from contract-native V9 factories and independently revalidated.

| Fixture | Surface mix | Required coverage | Build/source path | Hash | Status |
|---|---|---|---|---|---|
| Slide-heavy | Slide | states, layers, media, component, playback, static export | `tests/fixtures/architecture-baseline/slide-heavy.h5lesson` | `101b8e8186e1fbadbf9f083e5d3273eee9f1166fa3028478f290497537274a7b` | legal V9 / deterministic / focused coverage green |
| Flow-heavy | Flow | blocks, formula/table/code, IME behavior, FlowComponentBlock, DOCX/PDF | `tests/fixtures/architecture-baseline/flow-heavy.h5lesson` | `326b1c29d72358d01373af26cbc6f97f396a34ce40e0e057079bbdcd76beeea0` | legal V9 / deterministic / focused coverage green |
| Mixed/Spatial | Slide + Flow + Spatial | global/shared, controller, camera/path, component, Runtime | `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson` | `939a0d5520fe21a6608a4cb11b8487f87d223a1da15286965803eb4e2aaa66df` | legal V9 / deterministic / focused coverage green |

Build/check commands and the capability matrix are canonical in `ARCH_0_REPRESENTATIVE_PROJECTS.md` and `tests/fixtures/architecture-baseline/manifest.json`.

## Manual flows

Bounded functional/performance/manual evidence is complete in `ARCH_0_PERFORMANCE.md`; its green/red/unknown classification remains authoritative. The required-flow list is retained as the comparison map for later affected stages:

- create/open/save/save-as/reopen;
- undo/redo and resource-history consistency;
- switch project/location during delayed actions;
- Slide, Flow IME, Spatial, and Mixed navigation;
- media/component/runtime/interaction authoring;
- global/surface-shared/controller ownership;
- Try-run and Full Preview;
- applicable HTML/Web/PPTX/PDF/DOCX behavior with explicit unsupported-content feedback.

## Performance protocol

`arch-0a-perf-00-test-and-performance-baseline` is done. The fixed sample count, fixture hashes, median/P95 values, qualitative interaction boundaries and regression investigation thresholds are canonical in `ARCH_0_PERFORMANCE.md`.

## Writer/consumer/owner starting counts

`arch-0a-map-00-writer-consumer-owner-ledger` is done. Canonical evidence is in `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md` and `legacy-consumers.json`:

- 19 current module areas and the first 7 high-risk journeys;
- 10 Legacy records: 5 active debt, 2 reachability-unproven, 2 retained compatibility, 1 dead candidate;
- 116 confirmed consumer relations across all seven deletion-proof categories;
- 104 unique confirmed `path#symbol` endpoints;
- 23 tracked renderer files importing the Store at this baseline.

Counts are generated from the JSON relation arrays using the reproduction command stored in `startingCounts`; Markdown prose is not a second count authority.

## Phase and wave budgets

Budgets bound a wave and trigger re-planning; they never authorize scope reduction, weaker validation, or an incomplete user outcome.

| Phase / wave | Timebox | Max cards | Max S2 | Hotspot budget | Validation budget | Retry budget |
|---|---:|---:|---:|---|---|---|
| ARCH-0A bootstrap | 3 Coordinator workdays | 8 | 2 | task state only; no product hotspot | governance/index checks + three representative fixture validations + targeted manual evidence | 1 repair + 1 independent diagnosis per card |
| ARCH-0B MVP | 5 Coordinator workdays | 10 | 1 | generated repo-index, Coordinator only | adapter/unit + deterministic double-run + check + 25 golden tasks | 1 repair + 1 diagnosis; max 3 parser designs |
| ARCH-1 vertical slice | 10 Coordinator workdays | 8 | 4 | Store/History, App, Workspace serialized by Integrator | 1–3 target tests/card; affected typecheck; one desktop slice; 3 representative regressions | 1 repair + 1 diagnosis; max 3 designs |
| ARCH-2 W2-A | 10 Coordinator workdays | 12 | 4 | Store/History plus one Feature integration lock at a time | affected unit/integration + representative save/preview/export | 1 repair + 1 diagnosis/card |
| ARCH-2 W2-B | 10 Coordinator workdays | 12 | 4 | App/save, Workspace/Properties, Published producer serialized | affected type/integration + desktop smoke when required | 1 repair + 1 diagnosis/card |
| ARCH-3 seam | 5 Coordinator workdays | 6 | 3 | Store + Workspace/Properties Integrator only | seam/boundary tests + three Surface read paths | 1 repair + 1 diagnosis/card |
| ARCH-3 Surface waves | 10 Coordinator workdays/wave | 12 | 4 | no Worker hotspot writes; Integrator wiring serialized | per-Surface command/UI/save/preview/export + input semantics | 1 repair + 1 diagnosis/card |
| ARCH-4 delivery | 10 Coordinator workdays | 12 | 4 | Published producer, App export, main/preload serialized | format-target tests + representative artifacts + visual/editability review | 1 repair + 1 diagnosis/card |
| ARCH-5 cleanup/final | 10 Coordinator workdays | 12 | 4 | deletion batches and generated index serialized | consumer-zero proof + full V4 candidate suite once | 1 repair + 1 diagnosis/deletion batch |

## Blocking unknowns

- Exact current full E2E/fresh desktop build/package status remains intentionally unclaimed under the ARCH-0A V3 policy; affected product stages own those checks.
- Mixed/Spatial PPTX is a registered red baseline. Native Save As, real OS IME, trusted pointer input and OS PDF are registered unknowns. Their scope and non-blocking/ later-gate decisions are canonical in `ARCH_0A_GATE_REPORT.md`.
- ARCH-0B context-safety status is separate from this baseline and remains governed by its own task cards and phase gate.

ARCH-0A itself has no hidden blocker for the controlled ARCH-1 characterization/vertical slice after Coordinator gate integration. This statement does not authorize broad migration before the separate ARCH-0B gate and does not convert any red/unknown outcome into green.
