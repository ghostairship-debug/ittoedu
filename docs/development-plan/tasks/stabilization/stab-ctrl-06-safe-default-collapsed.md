# S1 Task Card — Safe Default Collapsed Controller

> Audit coverage: `CTRL-04`; execute only after authoring and runtime safety are green.

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: implementation
- Necessity / skip condition: New/missing-controller creation still defaults to expanded; skip only if both paths already default collapsed while explicit saved `true` and `false` remain unchanged.
- Complexity delta: neutral
- Validation ceiling: V1
- Validation budget: 8 minutes
- Reviewer budget: 1
- Evidence reuse: Bind the focused factory/recovery result to the product commit; docs/task-board/generated-only changes reuse it unless a listed factory/command/test path changes.
- Invalidating paths: `src/renderer/project/createProject.ts`; `src/renderer/project/createCourseProject.ts`; `src/renderer/course/globalLayerCommands.ts`; `tests/unit/courseProjectArchive.test.ts`; `tests/unit/effectiveLayerCommands.test.ts`
- Task ID: `stab-ctrl-06-safe-default-collapsed`
- Phase / wave: `post-audit stabilization / B-ownership-controller`
- Status: `claimed`
- Owner / Reviewer / Integrator: `Controller Default Worker / Default Preservation Reviewer / Stabilization Integrator`
- Claimed at / released at: `2026-08-25 / not released`
- Worktree / branch: `shared integration workspace with Controller Factory firewall / codex/architecture-stabilization`
- Baseline HEAD: `c9c290a` (ctrl-05 session dependency closed at `b737820`)
- Context: `bootstrap-manual`; inspect blank-project controller factory, missing-controller recovery and explicit-value reopen paths before writing.
- Freshness / relevant dirty inputs: worktree and listed factory/command/test paths were clean at claim; all three dependencies are done and their runtime/authoring behavior must be preserved.
- Depends on: `stab-ctrl-01-authoring-bounds-and-recovery`; `stab-ctrl-03-collapsed-hit-footprint`; `stab-ctrl-05-mixed-runtime-session`
- Blocks: `stab-wave-b-ownership-controller`
- Retry count: `0`

## Product outcome

New projects and genuinely missing-controller recovery start collapsed; existing explicit controller choices are never migrated or overwritten.

## Canonical boundary

- Factory emits the existing required V9 boolean only for a new controller.
- Existing-controller restore/reopen preserves explicit `defaultCollapsed: true|false` exactly.
- Runtime/authoring behavior is supplied by dependencies; this card changes no host, preview, contract or migration path.

## Scope and acceptance

- Allowed write: controller factory default, missing-controller creation call only if needed and the two named focused tests.
- Required read: blank project and existing/missing restore branches.
- Forbidden write: Schema, load migration, fixtures-only masking, Player/Workspace/Properties, dependencies and generated files.
- Hotspot lock and order: one writer for `createProject.ts`/`globalLayerCommands.ts`, after all three dependencies release shared paths.
- Acceptance:
  - [ ] New blank project and missing-controller recovery emit `defaultCollapsed: true`.
  - [ ] Existing explicit `true` and `false` survive restore/reopen with no migration/history write.
  - [ ] Strict V9 parsing and Published copy semantics remain unchanged.

## Minimal validation

- `npx vitest run tests/unit/courseProjectArchive.test.ts tests/unit/effectiveLayerCommands.test.ts`
- `git diff --check`

## Result and rollback

- Start point: dependency commits at claim.
- Product commit and rollback: pending; one factory/recovery commit and one revert boundary.
- Result evidence: pending focused new/missing/explicit-value results.
- Outcome conclusion boundary: V1 establishes at most `engineering candidate`; Wave B owns integrated behavior.
- Stop condition: any required legacy migration or contract coercion becomes a separate product decision.
- Semantic index impact: `canonical-update`
- Generated refresh: `defer-to-wave-gate`
