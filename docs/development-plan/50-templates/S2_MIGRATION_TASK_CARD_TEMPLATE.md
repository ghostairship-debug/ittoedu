# S2 高风险迁移任务卡

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Task ID:
- Phase / wave:
- Status: draft | ready | claimed | characterizing | implementing | target-green | reviewed | integrating | wave-validated | done | retrying | parked | rolled-back | product-decision
- Owner / Reviewer / Integrator:
- Claimed at / released at:
- Worktree / branch:
- Baseline HEAD:
- Claim commit:
- Context Pack + manifest hash | bootstrap-manual:
- Freshness / relevant dirty inputs:
- Depends on:
- Blocks:
- Risk statement:
- Retry count / last failure class:

## Product outcome

一个高风险但原子的用户/工程行为；不得直接填写阶段 Epic。

## Current status and evidence

`existing/preserve | partial | missing | legacy-consumer`

## Canonical contract and carrier

- Contract/type and evidence:
- Surface-specific carrier:
- Persisted fields affected:
- Schema change allowed: no（默认）

## Stable target / async policy

- project identity:
- revision policy:
- session generation:
- surface/location/owner:
- item identity:
- stale result/user feedback:
- IME/draft/drag behavior:

不适用时必须写明原因，不得留空。

## Current write path

从 UI 到 Store/resource/history 的真实路径。

## Current consumers

### Runtime/Preview/Player/Export
### Build/Fixture/Release
### Tests/docs/generated
### Legacy record IDs

## Replacement path

不得双写；说明旧入口作为 adapter 保留到何时。

## Scope and locks

### Allowed write
### Required read
### Forbidden write
### Do not read unless needed
### Hotspot locks（Coordinator 集成时独占）

## Change budget

- Task timebox:
- Main source files:
- New/moved files:
- Public exports:
- Move/delete:
- Dependency/lockfile changes:
- UI copy/behavior changes:
- Schema/contract changes: no（默认）
- Generated diff:
- V1 target tests / expected time:
- V2 integration tests / expected time:
- Max implementation retries: 2（默认）
- Max design attempts: 3（默认）

## Migration steps

1. Characterization
2. Pure seam/adapter
3. One consumer or one user behavior
4. Worker target validation
5. Coordinator hotspot integration
6. Related integration/desktop validation
7. Compatibility entry reduction

## Must preserve

## Stop conditions

至少包含 Schema、carrier、double-write、raw Store、第二热点、代表工程数据风险。

## Validation

### V1 Worker target（1–3 个命令 + 最小人工流程）
### V2 Coordinator integration
### Representative project / performance

## Legacy/delete gate

引用 Legacy record；精确删除目标 consumer=0 前保留什么。

## Rollback

- Start point:
- Pure implementation commit:
- Hotspot integration commit:
- Generated commit:
- Old path remains:
- User data copy/restore note:

## Result evidence

- Consumers migrated/remaining:
- Behavior before/after:
- Validation results:
- Known risks/findings:
- indexImpact:
- Next allowed task:

## Ready checklist（Coordinator）

- [ ] dependsOn done/wave-validated
- [ ] context fresh or Bootstrap verified
- [ ] current write path and all consumer categories evidenced
- [ ] Allowed/Required/Forbidden paths valid
- [ ] required hotspot locks available
- [ ] budgets and validation named
- [ ] rollback and old path state clear
- [ ] no related user dirty change
- [ ] no product escalation triggered
