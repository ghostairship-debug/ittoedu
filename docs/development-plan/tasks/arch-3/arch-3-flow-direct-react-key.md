# S1 Task Card — ARCH-3 Flow Direct React Key

## State and assignment

- Task ID: `arch-3-flow-direct-react-key`
- Phase / wave: `ARCH-3 / Flow finding`
- Status: `draft`
- Owner / Reviewer / Integrator: `unassigned / Flow Reviewer / Coordinator`
- Claimed at / released at: `— / —`
- Worktree / branch: `pending / codex/architecture-stabilization`
- Baseline HEAD: `344b0cf`
- Claim commit: `pending`
- Context: `fresh repo:context required when ARCH-3 Flow seam is ready`
- Freshness / relevant dirty inputs: finding reproduced by ARCH-0A focused Flow integration
- Depends on: `ARCH-3 Surface seam ready; FlowWorkspace file lock available`
- Blocks: Flow/UI warning-free modularization gate
- Retry count: `0`

## Product outcome

Flow block roots retain stable React identity without emitting the `key`-prop spread warning, while IME, selection, keyboard, nesting, and DnD behavior stay unchanged.

## Current fact and evidence

`src/renderer/ui/FlowWorkspace.tsx` places `key` inside `frameProps` and spreads the object into the returned `<div>`. React warns during `flowWorkspace` and representative Flow integration. Removing the key entirely would break root/nested list identity.

## Non-goals

- No Flow render-tree extraction, UI redesign, command/history change, or cross-Surface refactor.
- No warning suppression or weakened console assertion.

## Scope and locks

### Allowed write

- `src/renderer/ui/FlowWorkspace.tsx` at the block-root key construction only
- `tests/unit/flowWorkspace.test.tsx`
- This task card

### Required read

- `tests/integration/architectureBaselineFlows.test.tsx`
- Existing Flow IME, selection, nested-section and DnD tests

### Forbidden write

- `Workspace.tsx`, Store, App, Properties, contracts, package/lockfile
- Flow commands/history/model and other Surface files

### Hotspot locks

- `FlowWorkspace.tsx` file lock only.

## Change budget

- Task timebox: `half Worker day`
- Main files: `1 product + 1 focused test`
- New public exports/dependencies/UI/Schema/generated changes: `no`
- Target validation: Flow workspace suite + representative Flow integration; under 5 minutes
- Max implementation retries: `2`

## Acceptance

- [ ] `key={blockView.blockId}` is applied directly to the returned root element
- [ ] No `key` remains in spread props and warning is absent
- [ ] IME composition/commit, DnD, selection, keyboard, data attributes and nested sections unchanged
- [ ] No hotspot/scope expansion

## Minimal validation

- `npx vitest run tests/unit/flowWorkspace.test.tsx`
- `npx vitest run tests/integration/architectureBaselineFlows.test.tsx`
- Console spy asserts no key-spread warning; `git diff --check`

## Rollback

- Start point: ARCH-3 Flow wave baseline
- Implementation commit: pending
- Old path remains: single JSX change can be reverted independently.

## Consumers and index

- Consumer delta: `0`; warning eliminated
- Legacy record IDs: none
- indexImpact: `regenerate`

## Result evidence

- Pending.

## Stop conditions

- Render tree/block identity changes, DnD/IME/selection behavior changes, or any need to touch Store/Workspace/Properties.

## Ready checklist (Coordinator)

- [ ] dependencies and Flow seam ready
- [ ] fresh context and file lock
- [ ] no relevant user dirty change
- [ ] validation/rollback complete
- [ ] no product escalation
