# 架构第五轮结果：Electron／e2e noEmit增量（2026-10-24）

**两套均有明确无改等待收益，诊断对照通过，已依次采用Electron、e2e的原生增量检查。原三段检查及失败传播完整保留。** 本轮仅改变 `package.json` 的typecheck后两段；主配置沿用第三轮实现，未追加其他工作包，未commit、push、打Portable、发布或部署，原有未提交成果保留。

依据为[原方案§12](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-fourth)。实际使用现有TypeScript7.0.2，不改tsconfig、编译器、依赖、产品源码、测试源码、检查过滤或正式emit构建。

## 隔离试验与取舍

按Electron→e2e顺序，当前src／tests／scripts及根配置复制到同一[隔离副本](../../../output/architecture-fifth-round-20261024/typecheck-workspace-v2/)，只读依赖沿原安装解析。两套分别使用新的trial build-info；确定类型错误只注入副本的实际纳入叶子，并在finally恢复，没有向主树注入错误。

- Electron：`src/main/workbench/execution/modelGenerationRetry.ts(33,7)`，实际覆盖1681文件。
- e2e：`tests/e2e/unifiedSelection20261024.spec.ts(321,7)`，实际覆盖2205文件；没有执行该测试或启动浏览器。

| 阶段 | Electron | e2e | 退出／诊断 |
|---|---:|---:|---|
| 原完整检查，首次记录 | 7.05秒 | 5.40秒 | 均0 |
| 增量首次建索引 | 3.43秒 | 6.40秒 | 均0 |
| 无改增量 | 0.55秒 | 0.79秒 | 均0 |
| 暖完整成功对照 | 3.13秒 | 5.18秒 | 均0 |
| 叶子加入确定错误，已预热增量 | 1.53秒 | 0.78秒 | 均1，各自单条TS2322 |
| 相同叶子错误，完整检查 | 3.02秒 | 4.76秒 | 均1，与各自增量同位置、同诊断 |
| 恢复叶子，增量 | 0.60秒 | 0.79秒 | 均0，旧错误消失 |

完整参数、退出与compiler diagnostics见[Electron计时](../../../output/architecture-fifth-round-20261024/electron-timings.json)、[e2e计时](../../../output/architecture-fifth-round-20261024/e2e-timings.json)；[试验脚本](../../../output/architecture-fifth-round-20261024/noemit-experiment.mjs)及每阶段日志保留在同目录。

采用依据是**各套同条件暖完整与无改增量**：Electron约减少82%等待，e2e约减少85%。首次建立索引有成本，e2e首次增量还慢于首次完整；原初次记录受预热影响，不作收益对照。叶子错误样本也保持诊断并更快，但不推广为所有叶子修改提速。上述结果不代表一次新的三段全链计时，也不代表用户运行性能或全局开发效率。

试验准备最初使用fs.cpSync时在复制开始后退出1，未运行编译器，留下空试验目录；保留该尝试，换用第三轮已用的显式逐文件复制到v2后再开始有效计量。没有以修改工程配置、主树或验证定义绕过准备问题。

## 实际采用与最小充分验证

最终 `package.json` 保留原顺序和三个noEmit检查，通过 `&&` 传播失败：

```text
tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo
  && tsc -p tsconfig.electron.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/electron-noemit.tsbuildinfo
  && tsc -p tsconfig.e2e.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/e2e-noemit.tsbuildinfo
```

主／Electron／e2e各用独立文件，均位于现有忽略的output目录；不与正式emit共用，不放在会被dist清理的位置。`scripts/build-electron.mjs`仍按原配置执行正式emit，未修改也未运行；未把incremental写入配置影响其行为。原完整noEmit方式仍可直接执行。

采用Electron后，按该段最终精确参数在主树运行：首次cache不存在，2.75秒／0退出并创建cache，见[实际Electron记录](../../../output/architecture-fifth-round-20261024/electron-adopted.json)及[日志](../../../output/architecture-fifth-round-20261024/electron-adopted.log)。随后才开始e2e试验；e2e采用后以同样方式首次无cache运行，3.66秒／0退出，见[实际e2e记录](../../../output/architecture-fifth-round-20261024/e2e-adopted.json)及[日志](../../../output/architecture-fifth-round-20261024/e2e-adopted.log)。

主段及其输入没有相关变化，复用第四轮已通过的主配置检查，不再运行一次完整三段链或重新测主配置。逐段新证据与原主段证据分开记录，不把它们写成这次完整npm typecheck的执行记录。

[入口核对](../../../output/architecture-fifth-round-20261024/entry-verification.json)确认：三段仍存在，主段完全保持，后两段仅追加原生增量及独立cache参数，package其他字段与本轮before语义一致。三套配置和正式emit脚本无diff；include／types／strict／skipLibCheck／noEmit、编译器原生失效和失败退出传播保持。无需新增永久测试复刻编译器或自定义“无改即成功”判断。

## 独审、保全与收口

未参与本轮实施的architecture_review只读核对实际增量、参数／诊断对照、cache隔离、收益与保留义务，确认“第五轮独立评审通过，可收口，无剩余阻断项”：两套采用有充分依据，检查义务未减，最终无cache执行及复用主段证据足够；无需再跑完整链。逐段结果不能表述为新测得全链耗时，初始空目录复制失败不影响后续有效试验。

本轮前的dirty patch、全部未提交路径、package／配置／emit脚本副本，以及隔离试验和最终采用日志保存在[证据目录](../../../output/architecture-fifth-round-20261024/)。没有reset、stash、clean、覆盖原工程或清理已有cache。package使用局部修改，保留第三轮主段及其他未提交成果。

本轮只涉及noEmit检查入口，未运行GUI、E2E、Player、构建或付费模型，未重跑第四轮两条或其他历史红例。检查范围不缩减，未变证据复用；没有新增产品行为验收结论。P1-C本次选中两段已完成，P2-D等剩余条件方向保持暂缓，不追加工作包。
