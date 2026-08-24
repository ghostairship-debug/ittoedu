# S1 Task Card — ARCH-2 B1-13 W2-B1 Runtime / Interaction Validation Gate

> 本卡是任务状态唯一真相；only Coordinator integrates/closes the gate.

## State and assignment

- Task ID: `arch-2-b1-13-runtime-interaction-validation-gate`
- Phase / wave: `ARCH-2 / W2-B1 Runtime + Interaction validation gate`
- Status: `done`
- Owner / Reviewer / Integrator: `Coordinator / independent Runtime, Interaction and gate-process reviewers / Coordinator`
- Claimed at / released at: `2026-08-24 12:46 Asia/Shanghai / 2026-08-24 13:51 Asia/Shanghai`
- Worktree / branch: `primary validation workspace / codex/architecture-stabilization`
- Baseline HEAD: `ef08171`
- Claim commit: `d3c443e`
- Context Pack + manifest hash | bootstrap-manual: `feature:runtime + feature:interactions + feature:preview-player; fresh generated repo-index at ef08171; source 283cc037, semantic 2616aecc, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean tree after B1-12 close and deterministic repo-index refresh; no product writer lock`
- Depends on: `arch-2-b1-01 through arch-2-b1-12 done`
- Blocks: `ARCH-2 W2-B2 shared Global Layers / Controller, Diagnostics and Save / Recovery work`
- Retry count / last failure class: `0 / none`

## Product outcome

W2-B1 closes only when the user-visible Runtime authoring lifecycle and the standard Interaction V1 authoring/playback slice form an honest current Course Project V9 → Published Course V2 chain. Exact targets must never retarget or overwrite on stale input; each real authoring change must be one canonical transaction; Runtime definitions must round-trip into the read-only Published projection without claiming Published Runtime execution; supported Interaction playback must remain read-only; Slide, Flow and Spatial host ownership/gesture rules must remain exact; removed V8/raw writers must stay removed.

This gate validates and ratchets the completed behavior. It does not add another Runtime or Interaction format, broaden the supported trigger/action/template set, claim Flow/Spatial-local authoring, change Schema, or turn automated evidence into teacher acceptance.

## Non-negotiable success criteria

- Runtime assets, source, content, Properties and Slide scene/global template lifecycle all use stable V9 targets and current Surface transaction/history semantics.
- Runtime stale/locked/replaced/detached/occupied/no-op paths are zero-write; resource bytes and document bindings undo/redo together where applicable.
- Automation reveal-sequence template creation and its supported subsequent professional-field patches preserve one standard Interaction V1 rule and one transaction, with honest local/global availability; generic add/delete/duplicate/move/click-rule and Developer JSON adapters remain outside this migrated slice.
- Session-owned global and optional Slide-local Published controllers execute the supported `node.click` / enter-exit motion / whole-course navigation slice on eligible Slide local/global, Flow global/surface and Spatial global/surface/world native LayerItems.
- Published execution never writes the authoring Store or payload, never steals occupied/pass-through/camera/component/runtime/media/controller gestures, and tears down stale work across navigation/replay/restart/destroy.
- Exact legacy-consumer reductions from B1-01 through B1-12 remain true and are protected by a focused dependency/consumer ratchet.
- Focused union, full unit/integration candidate, all TypeScript projects, desktop build, targeted real Electron milestones, contracts/capabilities/task-board/repo-index gates and diff hygiene pass.
- Pipeline, functional outcome, visual outcome, accepted status and registered residual risks are reported separately.

## Scope and locks

### Allowed write

- New `docs/development-plan/baselines/ARCH_2_W2B1_GATE_REPORT.md`.
- Runtime/Interaction current-fact bullets in `docs/development-plan/baselines/ARCH_2_RESOURCE_SNAPSHOT_BASELINE.md`.
- Audited `MOD-09`, `MOD-10` and `MOD-13` rows only in `docs/development-plan/inventories/FEATURE_CONSUMER_OWNER_LEDGER.md`.
- `feature:runtime`, `feature:interactions` and directly affected `feature:preview-player` records in `repo-index/semantic/features.json`.
- Focused additive assertions in `tests/unit/architectureDependencyRatchet.test.ts` that freeze already-removed writers and required product seams.
- Current-fact updates to existing Runtime/Interactions/Player semantic records only when directly evidenced.
- This task card result fields, generated task board and generated repo-index outputs.

### Required read

- B1-01 through B1-12 task-card outcomes, independent review findings and validation evidence.
- Runtime exact-target planners/views/Store transactions/Workspace/Properties/Developer lifecycle and archive/Published projections.
- Interaction authoring view/planner/Store/UI, Published controller/session/DOM port and Slide/Flow/Spatial host lifecycle.
- Current contracts, capability index, representative E2E milestones, legacy consumer inventory and known MixedNavigator/large-world risks.

### Forbidden write

- Product behavior source, Course Project V9 / Published Course V2 / Runtime / Interaction contracts or generated contract artifacts.
- New Runtime template/API, Interaction trigger/action/carrier, Flow/Spatial-local authoring or Player ownership semantics.
- Package/lockfile, fixtures, export behavior, unrelated task cards or broader ARCH-2 modules.

## Validation plan

### V1 focused union

- Runtime pure planners plus asset/source/content/property/template vertical slices, race/lock/no-op/history/lifecycle, archive and Published projection.
- Interaction authoring planner/Store/UI plus Published controller/session/DOM port and Slide/Flow/Spatial host lifecycle/gesture/navigation suites.
- Dependency ratchet with exact zero/nonzero consumer assertions.

### V2 final candidate

- Clean full `npm test` candidate.
- `npm run typecheck`.
- One full `npm run test:e2e` desktop gate; its pretest hook builds Player, renderer, Electron and registered fixtures. The existing Electron milestone proves Interaction template operations plus Runtime template/source/Properties; professional Interaction patching remains mounted-test evidence, and no reveal-template playback is claimed because its `scene.enter` trigger is outside the supported controller slice.
- Deterministic representative-fixture checks, all three validators and an ARCH-0-compatible architecture performance measurement because Published session and Spatial DOM lifecycle changed.
- `npm run check:contracts`, `npm run check:ai-capabilities`, `npm run check:task-board`, `npm run repo:index:check`, `npm run repo:index:quality`, and `git diff --check`.

## Consumer / legacy gate

- Retired Runtime raw writers/helpers from B1-09 through B1-12 remain exactly zero; `courseRuntimeToDocument` remains read-projection-only.
- Runtime asset replacement has one product target-based path and no direct Workspace import/update fallback.
- Automation reveal-template creation and supported subsequent field patches use the typed V9 planner/transaction path; no synthetic Flow/Spatial local writer returns. Existing generic rule and Developer JSON adapters remain explicitly nonzero outside this slice.
- Published controller/session have only Player/Preview/packaged read-only consumers; Player remains independent from renderer Store modules.
- Legacy `InteractionEngine` is not deleted or falsely claimed zero until its separate exact consumer gate is satisfied.

## Failure policy

Any product correctness failure blocks this gate. The gate card records the failure and opens a separately scoped fix card before product code changes; documentation, ratchet or generated-index drift may be repaired inside this card. No threshold is relaxed to obtain a pass.

## Rollback

- Start point: `ef08171` plus this claim commit.
- Gate report, additive ratchet and generated-index commits are independently reversible; B1-01 through B1-12 remain separately rollbackable.
- No user project, persisted migration, external resource or production data is written.

## Result evidence

- Gate evidence commit: `ce72775` (`test(arch-2): integrate W2-B1 gate evidence`).
- Consumer/ratchet result: `11/11 passed`; nine retired raw Runtime symbols remain `0`, `courseRuntimeToDocument` remains exactly `3` read-projection references, all five Runtime use-case slices retain their expected planner/transaction/resource seams, Automation template/update retains the typed path, raw update-rule UI consumers remain exactly DeveloperTab + PropertiesTab while Automation generic add/delete/duplicate/move stays explicit, and Published session/three-Surface/Legacy consumers remain exactly bounded.
- Validation results: Runtime focused `24 files / 301 tests`; Interaction/Published focused `17 / 182`; architecture fixtures `2 / 9`, deterministic fixture check `4/4 OK`, validators `3/3 valid`; full unit/integration `247 / 1,720` with `--maxWorkers=4`; root/Electron/E2E typecheck, contracts and AI-capabilities checks passed; full Electron Playwright `30/30` passed in `24.8m`; repo-index deterministic with controlled Hit@5 `100%` / Recall@15 `95%`, broad Hit@5 `100%` / Recall@15 `85.3846%`, and zero forbidden/high-confidence-wrong results.
- Pipeline / functional / visual / accepted: `pass / engineering candidate`; `green for the scoped W2-B1 functional chain`; `existing art candidate, no teacher visual acceptance`; `accepted not claimed`.
- Known risks/findings: performance remains `investigation amber` because `8/22` operation rows produced `12` individual median/P95 crossings; Published Runtime is still static fallback while actual Runtime execution remains `LEG-002`; reveal-template `scene.enter`, generic Interaction adapters and Legacy `InteractionEngine` remain outside this playback slice; there is no Electron author-then-play `node.click` test; MixedNavigator failure atomicity, large-world Spatial visual/performance, broader authoring-session revision lag and real teacher/product acceptance remain final-gate work.
- indexImpact: `gate report and Runtime/Interaction dependency ratchet add indexed test/doc facts; refresh repo-index after close`.
- Next allowed task: `ARCH-2 W2-B2 shared Global Layers / Controller, Diagnostics and Save / Recovery work`.

## Ready checklist (Coordinator)

- [x] B1-01 through B1-12 are done and indexed
- [x] current repo-index is fresh and worktree is clean
- [x] aggregate product chain and non-goals are explicit
- [x] Allowed/Required/Forbidden paths are bounded
- [x] validation, failure and rollback policies are explicit
- [x] no product hotspot writer is needed for the gate
- [x] no Schema, paid dependency, destructive or product-owner escalation is triggered
