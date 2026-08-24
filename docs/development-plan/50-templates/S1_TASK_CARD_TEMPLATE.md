# S1 普通跨文件任务卡

> 本卡是该任务状态的唯一真相；任务板由本卡派生。

## State and assignment

- Policy version: 2
- Risk tier: S1
- Task class: docs | implementation | integration | wave-gate | phase-gate | final-candidate
- Necessity / skip condition:
- Complexity delta: subtractive | neutral | additive-exception
- Validation ceiling: V0 | V1 | V2 | V3 | V4
- Validation budget: N minutes
- Reviewer budget: 0 | 1 | 2
- Evidence reuse:
- Invalidating paths:
<!-- 仅当 Complexity delta 为 additive-exception 时，在其下一行增加独立字段：- Additive exception: 首个真实 consumer、替代目标和退出条件 -->
<!-- ceiling 固定按 class：docs=V0，implementation=V1，integration/wave-gate=V2，phase-gate=V3，final-candidate=V4。S1 docs/implementation/integration 的 Reviewer budget 上限为 1；2 只用于 wave/phase/final 且写明两个不同风险面。Ready 时 Evidence reuse 不填未来 commit。 -->
- Task ID:
- Phase / wave:
- Status: draft | ready | claimed | characterizing | implementing | target-green | reviewed | integrating | wave-validated | done | retrying | parked | rolled-back | product-decision
- Owner / Reviewer / Integrator:
- Claimed at / released at:
- Worktree / branch:
- Baseline HEAD:
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
- Generated diff: none for implementation; defer indexed refresh to wave-gate
- Target tests / expected validation time:
- Max implementation retries: 2（默认）

## Characterization（仅在边界不清时）

行为已经由 focused test/复现直接界定时删除本节，不为 S1 身份单建 characterization 流程。适用时只填：

- Current successful behavior / known failure:
- Relevant async/stale/history/save/preview implications:

## Implementation outline

最短步骤，不写伪精确未来行号。

## Acceptance

- [ ] Product behavior
- [ ] Module boundary
- [ ] No duplicate truth/deep import
- [ ] No regression in named flow
- [ ] Budget and locks respected

## Minimal validation

列 1–3 个最相关目标命令；只有自动化不能直接观察结果时才加一个最小人工流程。不得把同一套件拆成多行规避预算。

## Rollback

- Start point:
- Implementation commit:
- Old path remains:

## Consumers and index

- Consumer delta（仅实际影响 consumer 时）:
- Legacy record IDs（仅迁移/deletion-candidate 时）:
- Semantic index impact: none | canonical-update
- Generated refresh: defer-to-wave-gate | not-required

## Result evidence

- Actual change/product commit and evidence key: change commit + command/result + environment
- Behavior before/after:
- Validation results:
- Consumer delta:
- Remaining risks:
- Rollback commit or start point:
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
