# 产品测试失败基线（开发诊断）

这是本轮起终点比较记录，不接入build、verify、pretest或CI，不自动批准已知失败。产品修复和全量证据限制见[本轮结果](../20261024-regression-boundary-repair/RESULT.md)。

```powershell
npm run test:baseline:record -- output/test-baseline/start-e77963756.json
npm run test:baseline:check -- output/test-baseline/start-e77963756.json --output docs/development-plan/test-baseline/known-failures.json
```

默认`--workers 3`；如需调整可显式传入。范围直接读取`package.json`的`test:product`：Vitest unit/integration，保留原有`taskBoardGenerator.test.ts`、`aiCapabilities.test.ts`两个排除项；没有新增exclude或skip。每次先执行全范围，再将首轮失败文件各用独立进程复跑一次，passing siblings也记录；不会重试到绿。原始JSON与日志保存在当次`output/test-baseline/<时间>/`。

- `stable-failure`：同条在本轮两次实际失败；`flaky`：仅一次观察失败（包括首过、文件复跑时失败）。
- `passed`：已观察状态均明确通过；`not-passed`：skip等未通过状态，不计修复。
- `fixed`只用于原稳定失败现在明确通过且没有其它失败观察；原稳定转偶发单列。
- 消失、改名、skip、零匹配、文件加载遮蔽、重复同名不能自动相减，保留未决。文件／套件错误用`<file>`单列，与具体case分开统计。
- 子进程、全局、unhandled、缺失或不完整报告保留`issues`，不据个别通过忽略。退出0仅为证据足够且无新增稳定失败；1为新增稳定失败；2为运行／比较未闭合。均不代表全仓通过。

## 本轮实际记录

| 样本 | 文件／单文件复跑 | 具体case：通过／稳定失败／偶发／skip | 文件级稳定错误 |
|---|---|---|---:|
| 起点（本地10月24日23:57—25日01:08） | 1495／308 | 7843／561／16／10 | 7 |
| 冻结终点（25日01:20—02:44） | 1497／304 | 7874／541／14／10 | 7 |

Node24.14.0、Vitest4.1.10、workers3，HEAD均为e77963756840adfe84b156b9f38f8bfaab14fda5；dirty事实在JSON元信息。终点初轮为8439具体用例：7879通过／550失败／10skip。上表是两次实际观察合并后的分类，不把文件级错误混作case。

同次比较：newStable14、fixed34、becameFlaky0、masked0、unresolved36。未决是18个唯一键、6组同名的两方向比较记录，不能当成36个不同case。fixed只代表旧稳定本次明确通过，不能仅凭该标签认定34个产品回退皆由本轮修好。

两轮都有真实unhandled／全局错误；终点initial及retry-70／77／164／221／268保留issues，起点限制也未清除。两轮没有实际pending／still-running或明细计数缺口，但reportComplete均为false；本次check实际exit2，不能宣称比较闭合或无新增。终点initial的8个unhandled包括原4类和补齐端口后Slide旧失败展开的4个，不能全称起点同样错误。

**known-failures.json是补正前冻结终点的未批准诊断快照。** 新增14条中，12条已在样本后完成审查及相关源码／fixture补正，并有定点证据；repair18 automatic与offscreen activity两条保留未决。后续补正没有修改JSON或重新record。当前工作区与该快照的区别、每条归因、有效聚焦证据及Worker根目录未决统一见[综合结果§7](../20261024-regression-boundary-repair/RESULT.md#7-全量比较样本后补正与交付边界)。不能将旧快照当作最新工作区全部通过的证明或自动接受后两条。

## 冻结终点：失败文件前20

按具体稳定失败、偶发、文件级错误降序；数字是用例记录而非运行次数。完整fullName、occurrence及原始失败摘要仍在JSON。

| 文件 | 稳定失败case | 偶发case | 文件级稳定错误 |
|---|---:|---:|---:|
| `tests/unit/slideContentFirst20261022.test.tsx` | 14 | 0 | 0 |
| `tests/integration/auditAllGeometryBrowser.test.ts` | 13 | 0 | 0 |
| `tests/integration/g20M15ElementConversations.test.ts` | 10 | 0 | 0 |
| `tests/unit/g20M16ClipboardIpc.test.ts` | 9 | 0 | 0 |
| `tests/unit/mechanicalAuthoringComposition20261016.test.ts` | 9 | 0 | 0 |
| `tests/integration/g20ExecutionRecoveryScopes.test.ts` | 8 | 0 | 0 |
| `tests/integration/g20ExternalMcpService.test.ts` | 8 | 0 | 0 |
| `tests/integration/g20ImageToolStatusTruth.test.tsx` | 8 | 0 | 0 |
| `tests/integration/g20S05CompactionRecoveryBudget.test.ts` | 7 | 0 | 0 |
| `tests/unit/slideWorkspaceV10.test.tsx` | 7 | 0 | 0 |
| `tests/integration/auditAllPlayerBrowser.test.ts` | 6 | 0 | 0 |
| `tests/unit/g20M17BenchmarkClosure.test.ts` | 6 | 0 | 0 |
| `tests/integration/executionRepair20261012.test.ts` | 5 | 0 | 0 |
| `tests/integration/g20M12ConnectionRecovery.test.ts` | 5 | 0 | 0 |
| `tests/integration/productFollowup/T01/boundCapabilitiesAndBasis.test.ts` | 5 | 0 | 0 |
| `tests/unit/auditAllExportsIntegration.test.ts` | 5 | 0 | 0 |
| `tests/unit/componentPlatformW0SpatialPointer.test.tsx` | 5 | 0 | 0 |
| `tests/unit/flowNestedPropertiesRepair20261022.test.tsx` | 5 | 0 | 0 |
| `tests/unit/u14FlowPlacement.test.ts` | 5 | 0 | 0 |
| `tests/integration/auditExecutionFacts.test.ts` | 4 | 0 | 0 |
