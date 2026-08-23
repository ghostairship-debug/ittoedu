# S1 普通跨文件任务卡

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Task ID:
- Phase / wave:
- Status: draft | ready | claimed | characterizing | implementing | target-green | reviewed | integrating | wave-validated | done | retrying | parked | rolled-back | product-decision
- Owner / Reviewer / Integrator:
- Claimed at / released at:
- Worktree / branch:
- Baseline HEAD:
- Claim commit:
- Context: repo-index query + manifest hash | bootstrap-manual
- Freshness / relevant dirty inputs:
- Depends on:
- Blocks:
- Retry count:

## Product outcome

一句话描述用户或工程可观察结果。

## Current fact and evidence

当前实现、状态、源码/合同/测试路径；不得把目标写成现状。

## Non-goals

明确不改的产品行为、模块和未来能力。

## Scope and locks

### Allowed write
### Required read
### Forbidden write
### Do not read unless needed
### Hotspot locks（通常 0–1 个）

## Change budget

- Task timebox:
- Main source files:
- New/moved files:
- Public exports:
- Deletion allowed:
- Dependency/lockfile changes:
- UI copy/behavior changes:
- Schema/contract changes: no（默认）
- Generated diff:
- Target tests / expected validation time:
- Max implementation retries: 2（默认）

## Characterization

- Current successful behavior:
- Known failure:
- Async/stale/history/save/preview implications:

## Implementation outline

最短步骤，不写伪精确未来行号。

## Acceptance

- [ ] Product behavior
- [ ] Module boundary
- [ ] No duplicate truth/deep import
- [ ] No regression in named flow
- [ ] Budget and locks respected

## Minimal validation

列 1–3 个目标命令和一个最小人工流程。

## Rollback

- Start point:
- Implementation commit:
- Old path remains:

## Consumers and index

- Consumer delta:
- Legacy record IDs:
- indexImpact: none | regenerate | semantic-update

## Result evidence

- Behavior before/after:
- Validation results:
- Consumer delta:
- Remaining risks:
- Rollback commit:
- Next allowed task:

## Findings / next allowed task

## Ready checklist（Coordinator）

- [ ] dependsOn satisfied
- [ ] context fresh or Bootstrap verified
- [ ] evidence and paths valid
- [ ] write locks available
- [ ] budget/validation/rollback complete
- [ ] no related user dirty change
- [ ] no product escalation triggered
