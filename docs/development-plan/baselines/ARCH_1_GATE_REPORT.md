# ARCH-1 Boundary and First Vertical Slice Gate Report

> Gate decision: **pass**
>
> Date: `2026-08-24 Asia/Shanghai`
>
> Scope: target-stable Slide image replacement, document/resource transaction, history, desktop persistence and Published delivery

## 1. Decision

ARCH-1 passes. The repository may proceed to ARCH-2's bounded cross-Surface Feature migrations because one complete user action now crosses App, Store, Core identity/transaction, Slide/Media, resource bytes, one history edge, save/reopen, current-location and full Preview, standalone HTML and Web delivery without a second Store, second history timeline, V8 double-write, Schema change or raw Store public facade.

This gate accepts one Slide behavior, not a generalized Media architecture. FlowBlock, Spatial world and Slide LayerItem carriers remain distinct; ARCH-2 must migrate one evidenced behavior at a time.

## 2. User-behavior result

| Required behavior | Result | Evidence |
|---|---|---|
| Same-target normal commit | pass | App captures before await; Store validates current V9 identity and commits captured image only |
| Same-owner A→B selection | pass | B remains selected while captured A changes |
| Cross-location delayed completion | pass | actionable stale feedback; document/assets/bytes/dirty/history unchanged |
| Cross-project policy | pass within reachability boundary | New/Open buttons and shortcuts are busy-blocked; direct projectId guard is zero-write tested |
| Deleted/changed/locked/owner/state/revision target | pass | stable structured rejection codes; no planner/transaction on failure |
| One user action / one history edge | pass | one mixed `editor-transaction` frame carries cloned resource delta |
| Undo/redo metadata + bytes | pass | inverse/forward delta; legacy→delta→legacy and branch histories stay aligned |
| Revision ABA | pass | actual Slide undo/redo advances the existing Course Session generation |
| Save/reopen | pass | undo copy equals original; redone copy contains distinct replacement asset and remains editable |
| Shared original asset | pass | intro keeps original ref/metadata/bytes while captured summary uses replacement |
| Current-location try-run | pass | CoursePlayer host renders exact replacement data URL at summary location |
| Full Preview | pass | navigation to summary renders the same replacement bytes |
| Standalone HTML | pass | Published V2 schema + exact data URL + visible file:// playback |
| Web package | pass | Published V2 schema + relative asset + byte-equal ZIP entry + visible file:// playback |
| Flow/Mixed bounded regression | pass | immutable-source save copies reopen; Flow and Spatial run surfaces are visible |

The desktop delay is a one-shot main-process dialog Promise injected only in the test process. Renderer, preload, IPC, main file reading and validation are real; native OS modal/trusted-input behavior is not claimed.

## 3. Boundary and dependency ratchet

The phase adds narrow existing-file entrypoints rather than a broad facade:

- Core identity: `CourseAuthoringTarget` and validation/result codes;
- Core transaction: `EditorTransactionPlan/Step` and cloned resource changes;
- Surface history: mixed bare snapshots and transaction frames, one timeline;
- Media/Slide plan: `planCourseImageReplacement`;
- App composition: capture before dialog and target-based Store commit;
- Store public action: typed target input/result only; no raw Hook export.

`architectureDependencyRatchet.test.ts` now fails if Core imports concrete Course/Components/UI modules, Slide history imports App/UI/Media/raw Store, Player imports renderer Store, the removed nodeId action returns, or the image use case bypasses planner/transaction history for old mutation writers.

Transitional facts remain explicit: `editorTransaction` and Slide history use the existing shared resource helpers in `store/history.ts`; `EditorState.project`, synthetic Store history and three mutually exclusive Surface histories remain under `LEG-001`. ARCH-1 proves a seam and a real consumer; it does not pretend the full target directory DAG already exists.

## 4. Validation

- `npm test`: `217 files / 1,338 tests` passed. The golden quality test timeout was raised from 30 to 90 seconds after the default full parallel suite produced a measured 48-second run; corpus, expected evidence, evaluator, thresholds and assertions were unchanged. Standalone golden runs remain below 20 seconds.
- Dedicated Electron E2E: `3/3` passed serially in `3.0 minutes` after independent dialog-safety and delivery reviews.
- Focused target/transaction/history/media/App/export: `12 files / 112 tests` passed.
- `npm run typecheck`: root, Electron and E2E projects passed.
- `npm run build:desktop`: Player, renderer and Electron builds passed. Existing bundle-size warnings remain informational.
- Representative fixtures: deterministic manifest and all three source SHA-256 values matched exactly.
- Validators: Slide-heavy, Flow-heavy, Mixed/Spatial sources and the redone Slide output all returned Schema 9, `status=valid`, `canExport=true`.
- Saved Slide output: five assets; standalone/Web preflight valid under deterministic CLI measurement.
- Real delivery pages: zero page errors, zero unexpected console errors and zero HTTP(S) requests. Expected warnings are classified rather than hidden.
- ZIP evidence extraction rejects empty/dot/traversal/absolute/backslash entries and verifies resolved containment.
- Electron runtime cleanup leaves no VS-06 profile and no associated Electron process.

Successful visual evidence is in ignored `output/arch-1-vs-06/run-52340/`: stale pending/rejected, replace/undo/redo, current-location try-run, full Preview, standalone HTML, Web package, Flow run, Mixed Flow and Mixed Spatial.

## 5. Same-protocol performance comparison

Protocol remained Node `performance.now`, 5 warmups and 21 samples against the exact three fixture hashes and Node 24.14. Investigation thresholds remain median `max(1.25×, +1 ms)` and P95 `max(1.35×, +2 ms)` on two consecutive breaches. This run has no first breach.

| Operation | ARCH-0 median / P95 ms | ARCH-1 median / P95 ms | Result |
|---|---:|---:|---|
| Slide archive open | `1.230 / 2.176` | `1.150 / 2.760` | within threshold |
| Slide save + reopen | `3.546 / 5.278` | `3.310 / 4.090` | within threshold |
| Slide Published V2 | `1.588 / 2.917` | `1.490 / 2.440` | within threshold |
| Slide standalone HTML | `5.909 / 7.578` | `5.610 / 7.390` | within threshold |
| Slide Web ZIP | `37.890 / 50.419` | `37.350 / 42.960` | within threshold |
| Flow Web ZIP | `54.930 / 79.038` | `35.830 / 57.520` | within threshold |
| Mixed Web ZIP | `77.044 / 91.272` | `65.750 / 71.120` | within threshold |
| Slide transform + undo + redo | `2.498 / 2.851` | `2.220 / 3.030` | within threshold |
| Flow text + undo + redo | `0.408 / 0.569` | `0.320 / 0.390` | within threshold |
| Mixed navigate all locations | `2.131 / 2.949` | `2.070 / 2.550` | within threshold |

Functional one-shot export states remain unchanged: Slide PPTX green with fallback warnings; Flow print/DOCX green; Mixed print partial; Mixed/Spatial PPTX remains red with two base64-header errors.

## 6. Findings closed during the gate

VS-06 found that the offline Web CSP allowed only self stylesheets while the current Player correctly uses dynamic `element.style` geometry. Chromium emitted four CSP errors. VS-06A added `style-src 'unsafe-inline'` for styles only; Web `script-src` remains `self + unsafe-eval` without inline scripts, `default-src` remains none, `connect-src` remains self, and standalone CSP is unchanged. Real file playback and focused security assertions pass.

The Slide-heavy fixture's shared banner height 44 triggers real-layout text-overflow preflight although deterministic CLI fallback reports no HTML/Web error. E2E changes only the loaded in-memory copy to height 80 before delivery export; the immutable source remains byte-identical. This is evidence of measurement-mode difference, not a fixture rewrite.

## 7. Remaining risks and next-phase constraints

- `LEG-001` remains nonzero: derived V8 projection, synthetic history and legacy snapshot subsequences still exist.
- Native OS picker modality/trusted input is not automated; the stale guard is proven at the injected async boundary plus real IPC/file read.
- Tiny deterministic fixture PNGs can emit WebGL bad-image warnings; Flow direct rendering emits the registered React key-prop spread warning. Unexpected warnings fail VS-06.
- Mixed/Spatial PPTX remains red and blocks ARCH-4 delivery closure; ARCH-1 did not invoke or alter it.
- Real OS IME and OS PDF remain unclaimed.
- App, Store, Workspace, Properties, Published producer, contracts and generated index remain exclusive integration hotspots.

## 8. Status separation

- Pipeline status: `pass` — full unit/integration, focused tests, typechecks, desktop build, dedicated E2E, fixtures, validators and index gates pass after final refresh.
- Engineering status: `accepted for ARCH-1` — stable target and one document/resource timeline are integrated with a dependency ratchet and rollback path.
- Outcome status: `art candidate` — Coordinator visually reviewed real editor, run, Preview, HTML/Web, Flow and Spatial evidence.
- Teacher/product accepted status: `not claimed` — no teacher acceptance was requested; later phase/final review remains required.

## 9. Rollback

The product hotspot is one reversible commit (`c85d6e0`), with pure VS-02–04 seams independently revertible. Web CSP fix is separately reversible (`c6cb941`). No persisted migration, representative-source modification or user-data rewrite is required. Generated index and gate/report commits can be regenerated or reverted independently.
