# S2 高风险迁移任务卡

> 本卡是任务状态唯一真相；只有 Coordinator 可进入 integrating、wave-validated、done、rolled-back 或 product-decision。

## State and assignment

- Policy version: 2
- Risk tier: S2
- Task class: implementation | integration | wave-gate | phase-gate | final-candidate
- Necessity / skip condition:
- Complexity delta: subtractive | neutral | additive-exception
- Validation ceiling: V1 | V2 | V3 | V4
- Validation budget: N minutes
- Reviewer budget: 1 | 2
- Evidence reuse:
- Invalidating paths:
<!-- 仅当 Complexity delta 为 additive-exception 时，在其下一行增加独立字段：- Additive exception: 首个真实 consumer、替代目标和退出条件 -->
<!-- ceiling 必须按 class 选择：implementation=V1，integration/wave-gate=V2，phase-gate=V3，final-candidate=V4。Reviewer budget 为 2 只适用 wave/phase/final 门禁且已写明两个不重叠风险面的情况。Evidence reuse 只定义执行后的复用规则，Ready 时不填未来 commit。 -->
- Task ID:
- Phase / wave:
- Status: draft | ready | claimed | characterizing | implementing | target-green | reviewed | integrating | wave-validated | done | retrying | parked | rolled-back | product-decision
- Owner / Reviewer / Integrator:
- Claimed at / released at:
- Worktree / branch:
- Baseline HEAD:
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

只填本卡实际影响的合同/carrier/持久化维度；门禁卡可直接引用下层任务证据。

## Stable target / async policy

- 只列本卡实际影响的 project/revision/session/surface/item identity；
- 只列本卡实际影响的 stale result、user feedback、IME/draft/drag 行为。

未被改动的维度不列表，不逐项制造 `N/A` 证明。

## Current write path

只有实际改动写路径的 implementation/integration 卡才记从 UI 到 Store/resource/history 的真实路径；门禁卡引用已有证据。

## Current affected consumers

只列实际受影响的 Runtime/Preview/Player/Export、Build/Fixture/Release、Tests/docs/generated 和 Legacy record ID；若是 deletion-candidate，再按删除协议穷尽全部 consumer 类别。

## Replacement path

只有实际迁移或替代旧入口时填写。不得双写；如果需要暂留旧入口，说明其真实 consumer 和退出条件。局部高风险修复没有 replacement 时，写当前直接修复路径，不新建 adapter。

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
- Generated diff: `none`（默认）；只在 wave-gate 按统一重建规则允许
- Applicable target/integration tests / expected time: 只按 Task class 填当前 ceiling 所需的一组
- Max implementation retries: 2（默认）
- Max design attempts: 3（默认）

## Execution steps

1. 边界不清或迁移时才 characterization；已有可复现局部事实则直接使用。
2. 实施能完成一个 consumer/用户行为的最短变更；只有同卡首个真实 consumer 需要时才新增 seam/adapter。
3. `implementation` 只做 V1 target validation；`integration` / `wave-gate` 只做受影响 V2。
4. 实际命中热点时才由 Coordinator 接入；实际选择删除时才做 compatibility reduction。

## Must preserve

## Stop conditions

列出实际适用的 Schema、carrier、double-write、raw Store、第二热点或用户数据风险；未受影响的类别不制造逐项证明。

## Validation

只保留与 Task class 对应的一组验证：implementation=V1（1–3 个最相关目标命令；自动化不能直接观察结果时才补最小行为），integration/wave-gate=V2，phase-gate=V3，final-candidate=V4。代表工程、desktop/E2E 和性能只在本卡 Invalidating paths 使对应证据失效且 ceiling 允许时出现。

## Legacy/delete gate

只有本卡是 deletion-candidate 时引用 Legacy record，并证明精确删除目标 consumer=0。retained 项只记保留理由、Owner 和重访触发条件，不伪造 replacement/removal phase。

## Rollback

- Start point:
- Product/integration commit and real rollback boundary: 局部任务默认一个；只在纯实现与热点接入能独立回滚时拆分
- Old path remains（仅迁移）:
- User data copy/restore note（仅影响用户数据时）:

## Result evidence

- Affected consumer delta（若适用）:
- Product commit / behavior before-after:
- Validation results: 命令 + 结果 + 环境，与上述 product commit 绑定
- Known risks/findings:
- Semantic index impact: none | canonical-update
- Generated refresh: defer-to-wave-gate | not-required
- Next allowed task:

## Ready checklist（Coordinator）

- [ ] dependsOn done/wave-validated
- [ ] context fresh or Bootstrap verified
- [ ] 改写路径时有 current write path 证据，实际受影响的 consumer 有证据；只有 deletion-candidate 要求全类别穷尽
- [ ] Allowed/Required/Forbidden paths valid
- [ ] 实际需要的 hotspot locks available
- [ ] budgets and validation named
- [ ] rollback 明确；只有迁移时要求 old path state
- [ ] no related user dirty change
- [ ] no product escalation triggered

`claimed` 与终态/持久检查点需要状态提交；不为 characterizing/implementing/target-green/reviewed/integrating 等瞬态逐个提交。generated 不在每卡单独提交。
