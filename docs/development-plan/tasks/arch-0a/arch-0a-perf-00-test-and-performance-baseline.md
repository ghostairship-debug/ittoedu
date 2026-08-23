# S1 Task Card — ARCH-0A Test and Performance Baseline

## State and assignment

- Task ID: `arch-0a-perf-00-test-and-performance-baseline`
- Phase / wave: `ARCH-0A / wave 2`
- Status: `done`
- Owner / Reviewer / Integrator: `Validation Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / target-green 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, baseline evidence-only scope / codex/architecture-stabilization`
- Baseline HEAD: `941ee9275fed73964558c7ff4f68eecb30d61ced`
- Claim commit: `1899deb33eb9b7cef13a3ad2ccbe1018d5eca171`
- Context: `bootstrap-manual`
- Freshness / relevant dirty inputs: representative fixtures integrated and independently revalidated; concurrent `repo-index/generated/**` work remained disjoint and untouched
- Depends on: `arch-0a-rep-00-v9-representative-projects (done)`
- Blocks: ARCH-0A performance/manual-flow gate; product-code migration comparison
- Retry count: `2` (Node PPTX needed a measurement-only formula canvas shim; evidence filenames needed portable sanitization)

## Product outcome

The same machine, fixtures, samples, and observable operations define reproducible functional and performance evidence for later regression decisions.

## Current fact and evidence

Static checks and 202/1263 Vitest baseline are recorded, but no current representative-project open/save/reopen/play/export measurements, interaction protocol, or median/P95 evidence exists.

## Non-goals

- No product fix or performance optimization.
- No weakening/retrying of flaky assertions.
- No claim of visual acceptance or formal release.

## Scope and locks

### Allowed write

- `scripts/measure-architecture-baseline.ts` or a narrower read-only measurement helper
- `tests/integration/architectureBaselineFlows.test.ts` if a deterministic non-UI flow is missing
- `docs/development-plan/baselines/ARCH_0_PERFORMANCE.md`
- `output/architecture-baseline/**` run evidence (only curated small evidence may be committed)
- This task card.

### Required read

- Representative fixture evidence and builders
- Save/archive, history, Preview/Player, and export public paths
- Relevant focused tests and Playwright helpers

### Forbidden write

- Product source, contracts/Schema, package/lockfile
- Existing product tests except the new dedicated baseline integration file
- Store/App/Workspace/Properties/Published/main/preload/generated index

### Hotspot locks

- None; read-only measurement and dedicated tests only.

## Change budget

- Task timebox: `1 Worker day`
- Main source files: `0 product; at most 1 measurement helper + 1 dedicated test`
- Public exports: `0`
- Deletion/dependency/UI/Schema changes: `no`
- Target tests / expected validation time: `three fixture validations + focused integration + bounded desktop/manual samples; under 60 minutes`
- Max implementation retries: `2`

## Characterization

- Successful baseline: contracts/capabilities/typecheck/unit green at activated plan commit.
- Known gap: E2E/build/package and representative functional/performance evidence unclaimed.
- Required operations: new/open, save/save-as/reopen, undo/redo, switch location, drag commit, Flow IME, Preview mount/destroy, applicable exports, large Mixed/history observation.

## Acceptance

- [x] Environment/fixture/sample protocol fixed
- [x] Median/P95 or explicit qualitative metric recorded for every required operation
- [x] Functional red/green/unknown separated from performance
- [x] Repro commands and artifacts recorded
- [x] No product change or acceptance claim

## Minimal validation

- Three representative `validate:course-project` commands
- Focused baseline integration test
- One bounded desktop/manual sequence covering the three fixtures
- `git diff --check`

## Rollback

- Start point: representative fixture integration commit
- Implementation commit: `d290d4c49a8d48b42e67988fd6b10646e73c01e4`
- Old path remains: static/unit baseline remains valid.

## Consumers and index

- Consumer delta: `0`
- Legacy record IDs: reference only
- indexImpact: `regenerate` if new helper/test is added

## Result evidence

- Protocol: Windows 11 x64 / Node 24; 21 measured samples after 5 warmups; `performance.now()`; three fixture hashes fixed. Machine/user identifiers and absolute paths are absent from reports and documentation.
- Measurement helper: `scripts/measure-architecture-baseline.ts`.
- Raw local report: `output/architecture-baseline/node-measurements.json` (Git ignored).
- Focused integration: `npx vitest run tests/integration/architectureBaselineFlows.test.tsx` passed 5/5, covering archive save/reopen, Slide transform + undo/redo, Flow composition commit + history, Mixed Published navigation and Flow Player mount/destroy.
- Three `validate:course-project` commands: all exit `0`, Schema 9, 0 errors, 0 warnings.
- Node performance: archive-open median 0.454–1.594 ms / P95 1.361–2.176 ms; save-reopen median 2.111–5.677 ms / P95 2.678–6.515 ms; Published V2 median 0.669–2.998 ms / P95 0.875–4.142 ms; web package median 37.890–77.044 ms / P95 50.419–91.272 ms.
- Cross-cutting: Slide transform+undo+redo 2.498/2.851 ms median/P95; Flow apply-text+undo+redo 0.408/0.569 ms; all four Mixed locations 2.131/2.949 ms; Flow DOCX 1.939/2.254 ms.
- One-shot actual exports: Slide-heavy PPTX `green-with-fallback-warnings` (3 slides); Flow print HTML + DOCX `green`; Slide/Mixed print artifacts `green-partial`; Mixed/Spatial PPTX `red` because two Spatial SVG images produced PptxGenJS base64-header errors; OS `printToPDF` remains `unknown`.
- Hidden Electron + agent-browser/CDP: 3/3 fixtures opened through real recent-project IPC; Mixed Slide→Flow→Spatial switched visibly; Slide/Flow/Spatial current-location previews mounted/destroyed; final renderer console/page errors were 0.
- Screenshots prove mount/reachability/Flow IME edit state only: `output/architecture-baseline/electron-slide-heavy.png`, `electron-slide-preview.png`, `electron-flow-ime-editor.png`, `electron-mixed-slide.png`. Visual quality remains engineering-fixture evidence, not art/outcome acceptance.
- Required-operation states: new `unknown`; open `green`; archive save/reopen `green`; native Save As `unknown`; undo/redo `green`; location switch `green`; transform command `green` but trusted pointer `unknown`; synthetic Flow composition `green` but real OS IME `unknown`; preview mount/destroy `green`; HTML/Web/DOCX `green` within provenance boundary; Mixed PPTX `red`; OS PDF `unknown`.
- Mixed history observation: 50 commits retained depth 50; heap delta +25,675,952 bytes without forced GC, recorded as qualitative only.
- Full protocol, metrics, thresholds, artifact list and conclusion boundary: `docs/development-plan/baselines/ARCH_0_PERFORMANCE.md`.
- Scope evidence: no product source, contract, package/lockfile, existing test or other task card changed; no full verify/E2E/package run and no `accepted` claim.
- Coordinator rerun: focused integration passed 5/5 and the 21/5 measurement helper completed; private-machine-field scan was clean. The Flow integration emitted the existing React key-prop spread warning, now recorded in the baseline instead of being suppressed or fixed outside the card's product-code firewall.

## Findings / next allowed task

- Mixed/Spatial PPTX is a reproducible red finding: Spatial SVG data URLs are rejected by PptxGenJS as lacking a base64 header. Create a later export-owner task; do not fix it in this baseline card.
- Native new/save-as, trusted pointer drag, real OS IME and OS PDF remain explicit `unknown`; they require bounded product/manual evidence rather than synthetic claims.
- Existing ignored Player/dist artifacts allowed visible evidence but do not prove current pipeline freshness.

## Ready checklist (Coordinator)

- [x] representative fixtures integrated
- [x] context refreshed
- [x] paths and commands validated
- [x] write scope clean and lock-free
- [x] retry/validation/rollback complete
- [x] no user dirty changes
- [x] no product escalation
