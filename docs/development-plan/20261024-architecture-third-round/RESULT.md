# 架构第三轮结果：P1-C / P5-A（2026-10-24）

**主类型检查增量已采用；P5-A计量完成，收益不足，未采用解析复用。** 已完成最小充分验证和独立增量评审。原有未提交成果保留，未commit、push、打Portable、发布或部署。

依据为[原方案§10](../../../output/architecture-audit-20261024/IMPLEMENTATION_PLAN.md#next-round-after-second)。本轮唯一软件增量是package.json的typecheck主段；未改变tsconfig、依赖、产品源码、测试过滤或已有正确断言。没有启动其他候补包。

## P1-C试验与采用

使用当前TypeScript7.0.2。实际CLI帮助确认incremental／tsBuildInfoFile可用；随后将当前src／tests／scripts复制到独立工作区，其余只读依赖沿同一安装解析。确定类型错误仅写在复制的 `src/shared/componentValue.ts` 中，未在主工作树制造错误。

同一副本、配置、安装及4651个文件，串行执行，结果如下。完整命令与compiler diagnostics见[计时JSON](../../../output/architecture-third-round-20261024/p1-timings.json)。

| 阶段 | 墙钟 | 退出与诊断 |
|---|---:|---|
| 原完整检查，首次记录 | 21.01秒 | 0，4651文件 |
| 增量首次建索引 | 14.07秒 | 0，4651文件 |
| 无改增量 | 1.37秒 | 0，4651文件 |
| 实际叶子加入确定类型错误，增量 | 14.84秒 | 1，`componentValue.ts(12,7)` TS2322 |
| 相同叶子错误，完整检查 | 14.48秒 | 1，同位置、同TS2322 |
| 叶子恢复，增量 | 1.60秒 | 0，旧错误消失 |
| 暖完整成功对照 | 12.06秒 | 0，4651文件 |

采用依据是暖完整12.06秒对无改增量1.37秒，主检查该条件下约减少89%等待；首次两项受预热等影响，不作为收益对照。叶子变化没有明确提速，但正确发现新错、修正后恢复，未牺牲诊断。该数据不等于三套typecheck总耗时或普遍开发提速。

最终入口为：

```text
tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo
  && tsc -p tsconfig.electron.json --noEmit
  && tsc -p tsconfig.e2e.json --noEmit
```

只改变主配置准备方式，保持原include／types／strict／noEmit、编译器原生失效及失败退出传播；Electron／e2e仍完整执行，未共享缓存。缓存位于现有忽略目录。未增加project references、自定义变化判定、忽略失败的fallback或新缓存平台。原完整主检查仍可直接运行 `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`。

实际在主树运行npm typecheck三段，0退出，见[全链日志](../../../output/architecture-third-round-20261024/typecheck-chain.log)。其后仅将主段默认配置写成显式 `-p tsconfig.json`，按package中的最终参数再执行主段，1.54秒／0退出，见[最终主命令](../../../output/architecture-third-round-20261024/p1-adopted-main.json)。其余两段命令未变，复用已通过证据，不额外重跑。首次实际采用时缓存目录尚未建立，全链仍完成真实检查。

## P5-A计量与不采用决定

在 `compileCoursePlayback`的真实调用上临时spy并调用原 `compilePublishedScriptModule`，仅统计Source JavaScript routing解析；上游仍使用实际 `InMemoryComponentCompilation`。排除共享builtin／webProgram／staticView既有复用，不把上游cacheHit计为新收益。

| 输入 | Source解析调用 | 唯一代码 | 重复解析 | 解析总时间／可省重复时间 |
|---|---:|---:|---:|---:|
| 受支持的Slide data-only状态fixture | 2 | 1 | 1 | 6.55ms／1.20ms |
| 既有咖啡runtime-first GLX，只读 | 3 | 3 | 0 | 45.62ms／0ms |

见[原始计量](../../../output/architecture-third-round-20261024/p5-baseline.json)和[运行日志](../../../output/architecture-third-round-20261024/p5-baseline.log)。fixture证明同override随展示版本重复解析的机制存在；实际咖啡工程使用三个不同的Source定义、无Source override，不存在这次复用机会。样本结论不能扩大为所有多状态Slide都无收益，但当前没有足够证据支持新增维护成本，因此按停止条件不采用，不为凑收益造大工程。

计量时静态builtin renderer刻意stub以隔离Source解析；记录的约46ms／489ms是这一探针中的编译时间，**不是正式导出耗时或真实播放验收**。发布和compiled diagnostics均为空，计量用例1项通过。没有缓存候选，故不追加两实例互动／CSS路由／取消矩阵，也不将它们标为新通过。

临时probe已移出tests入口，保存在[可复核探针](../../../output/architecture-third-round-20261024/source-parse-probe.test.ts)。`compileCoursePlayback.ts`及其他产品Source解析／运行代码保持原实现；没有留下诊断分支、全局缓存或常驻遥测，原GLX未保存／转换。

## 评审、保全与剩余

未参与实现的 `architecture_review`只读核候选、直接证据及保留义务，确认“第三轮独立增量评审通过，可收口”：主配置增量选择和三段检查成立；P5-A代表输入无充分收益，停止合理。无需追加GUI、Player构建或其他验证。

原始dirty差异／状态／未跟踪清单、相关before副本、隔离试验与日志统一在[本轮证据目录](../../../output/architecture-third-round-20261024/)。本轮结束核对见preservation.json；没有reset、stash、clean或覆盖既有成果。正确性证据使用实际诊断和行为，不以全仓Hash作门。

P1-C仅主入口已采用，不声称Electron／e2e增量化；P5-A为计量完成、未采用优化。其余P2-C广义优化、P2-D／E、P4、P5-B／C／D继续按原条件暂缓，首两轮有效证据复用。未跑无关全矩阵、GUI、构建或付费模型，原红例及发行边界保持。
