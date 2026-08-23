# S2 Task Card — ARCH-2 B1-02 Interaction Authoring View / Transaction Plan

> 本卡是任务状态唯一真相；only Coordinator integrates/closes it.

## State and assignment

- Task ID: `arch-2-b1-02-interaction-authoring-plan`
- Phase / wave: `ARCH-2 / W2-B1 pure Interactions authoring`
- Status: `done`
- Owner / Reviewer / Integrator: `Interactions Worker / Coordinator / Coordinator`
- Claimed at / released at: `2026-08-24 Asia/Shanghai / done 2026-08-24 Asia/Shanghai`
- Worktree / branch: `shared workspace, new interactions-only scope / codex/architecture-stabilization`
- Baseline HEAD: `db21bb6`
- Claim commit: `995d411`
- Context Pack + manifest hash | bootstrap-manual: `feature:interactions; fresh/high/safe-for-S2; source 16556796, semantic 2616aecc, config 103c4aa4, tool 0895bc33`
- Freshness / relevant dirty inputs: `clean product tree; new interaction paths clean; Store/UI/Player locked out`
- Depends on: `ARCH-2 W2-A gate done`
- Blocks: `Interaction Store/Automation/Properties integration`
- Risk statement: `UI-generated templates currently split one action into multiple commits, while Flow/Spatial local editors can report success against a carrier that does not exist.`
- Retry count / last failure class: `0 / none`

## Product outcome

One pure Interactions Feature exposes honest local/global availability and plans “create a common template, then professionally edit the same rule” as standard Interaction V1 document transactions without a second rule format or V8 projection.

## Carrier and view contract

- Local rules exist only in `SlideSceneDocument.interactions`.
- Global rules use `CourseProjectDocument.globalInteractions` from every Surface.
- Flow/Spatial local view returns typed `no-local-interaction-carrier`; it never returns an empty writable list.
- Scene references remain Slide scene IDs; Flow locations/Spatial frames are not relabelled as scenes.
- Schema change allowed: `no`.

## First behavior

- Template: existing “enter scene then reveal in sequence”.
- One plan simultaneously sets chosen nodes' `playbackInitialVisibility='hidden'` and adds one standard `InteractionRule`.
- A later update plan edits that same stable `ruleId`.
- Each non-empty plan is exactly one revision/history step with empty resource delta.

## Scope and locks

### Allowed write

- New `src/renderer/interactions/interactionAuthoringView.ts`
- New `src/renderer/interactions/interactionAuthoringCommands.ts`
- New `src/renderer/interactions/interactionTemplates.ts`
- New focused tests for those modules
- This task card result fields

### Required read

- Interaction V1 contract/schema and existing Slide interaction commands
- `InteractionEditor` template semantics and current rule limits
- Course V9 Slide/global carriers and `EditorTransactionPlan`

### Forbidden write

- Store, AutomationTab, InteractionEditor, Properties/Developer/Simple editor
- Player/Published hosts/producer, contracts/Schema
- Surface histories/carriers, package/lockfile, fixtures, repo-index

## Validation

- typed views for Slide local/global and Flow/Spatial local unavailable;
- template plan atomic visibility+rule, stable ID, stale/project/location/duplicate/lock/limit/schema failures;
- professional update keeps rule ID and only changes requested standard fields;
- no-op/input immutability/revision+1;
- focused tests plus existing interaction schema/Slide command tests and `npx tsc --noEmit`.

## Rollback

- Pure modules have no product consumer until the integration card and can be reverted independently.

## Result evidence

- Pure implementation commit: `8d271b8`.
- Local view reads the actual V9 Slide scene and materializes named-state overrides; Flow/Spatial local returns typed unavailable. Global view remains writable from every Surface and exposes only real Slide scene/state references.
- The existing reveal-sequence template becomes one standard Interaction V1 rule plus effective base/state initial-hidden changes in one revision/empty-resource plan. Professional update preserves that same rule ID and returns true no-op for identical patches.
- Carrier-aware validation prevents cross-Surface duplicate-ID lock bypass, dangling scene/state/sound/motion references and unknown templates. Global state references use rule `scene.in` OR candidates or all Slide scenes, not the active editor Surface.
- Final focused/Slide regressions passed 45 tests; independent review passed 5 files / 55 tests and TypeScript after closing named-state, reference, duplicate-ID, animation and global-state blockers.
- Consumers migrated: `0` by design. Store/UI integration must generate existing `presentation.in` (and global Slide `scene.in`) conditions and route one plan through the current transaction seam.
