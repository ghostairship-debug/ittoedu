# S0 局部小修任务卡

> 仅用于无公共 API、persisted、async、history 或多热点影响的局部修复；写不清时升级 S1，不给简卡追加仪式。

## State and assignment

- Policy version: 2
- Risk tier: S0
- Task class: docs | implementation
- Necessity / skip condition:
- Complexity delta: subtractive | neutral | additive-exception
- Validation ceiling: V0 | V1
- Validation budget: N minutes
- Reviewer budget: 0
- Evidence reuse:
- Invalidating paths:
<!-- ceiling 必须按 class 选择：docs=V0，implementation=V1。Evidence reuse 只定义执行后的复用规则，Ready 时不填未来 commit。 -->
<!-- 仅当 Complexity delta 为 additive-exception 时，在其下一行增加：- Additive exception: 首个真实 consumer、替代目标和退出条件 -->
- Task ID:
- Phase / wave:
- Status: draft | ready | claimed | implementing | target-green | done | retrying | parked | rolled-back
- Owner / Reviewer / Integrator:
- Claimed at / released at:
- Worktree / branch:
- Baseline HEAD:
- Context / freshness: 局部源码/测试复现即可，不强制 Context Pack
- Depends on:
- Blocks:
- Retry count:

## Product outcome

一句话描述一个可观察的小修结果。

## Evidence, scope and acceptance

- Current fact:
- Allowed write: 默认 1 个 product 文件与 1 个 focused test
- Forbidden write:
- Non-goals:
- Acceptance:
- Change / retry budget: 默认 1 个实现提交、1 次重试

S0 不单设 characterization、Reviewer、Required read 清单或热点锁流程；如果正确性需要这些边界，升级为 S1。

## Minimal validation

`docs` 列 1–2 个文档/链接/生成视图检查；`implementation` 列 1–2 个目标命令或一个最小人工流程。不得运行无过滤全量测试、E2E、打包、`verify` 或完整性能矩阵。

## Result and rollback

- Change/product commit / behavior before-after: 在此绑定实际 commit，不回填到 Ready 字段
- Evidence key: change commit + command/result + environment
- Validation / remaining risk:
- Rollback:
- Semantic index impact: none | canonical-update
- Generated refresh: defer-to-wave-gate | not-required

`claimed` 与终态/持久检查点需要状态提交；不为 implementing/target-green 等瞬态逐个提交。
