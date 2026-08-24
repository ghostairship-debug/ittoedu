# ARCH-2 跨 Surface 公共能力最终阶段门报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 产品候选：`eb224da`（其后没有产品源码变化；只有任务/门禁文档与本门 dependency-ratchet sentinel）
>
> 门禁范围：Policy v2 / V3 ceiling；复用有效证据，只补失效或未覆盖风险

## 1. 结论

ARCH-2 阶段门结论为 **pass / engineering candidate**。

本阶段已经证明：

- Media 与 Components 的资源变更使用一个 canonical Course Project V9 transaction，并进入当前 Surface history；
- Runtime authoring 与受支持的 Interaction V1 authoring/playback 使用已登记的 V9 → Published V2 路径，不双写作者工程；
- Flow/Spatial 的全课播放设置与教师控制器不再落入 Store 的 V9-disabled legacy no-op；
- 关闭的工程检查面板不再隐藏执行三项完整分析；
- Mixed 跨 Surface 导航在 release、activation、prepare 或 location 失败时补偿 Player host/location，成功前不提交 current/history；
- ARCH-2 最终同协议性能测量 `22/22` 行低于登记调查线，没有稳定、孤立的 B1/Mixed 性能回归。

本结论不是发布判定、视觉验收或教师确认。Spatial large-world 性能仍是明确未知，Published Runtime 的 Legacy execution 仍由 `LEG-002` 记录，教师/product `accepted` 未被自动化代替。

## 2. 为什么没有重跑完整套件

ARCH-2 计划把 V3 作为上限，不是固定全量清单。W2-B1 候选 `ce72775` 已有：

- Runtime focused：`24 files / 301 tests`；
- Interaction/Published focused：`17 / 182`；
- 代表 fixture：`3/3 valid`；
- full unit/integration：`247 / 1,720`；
- Electron：`30/30`；
- root/Electron/E2E TypeScript、contracts、AI capabilities 与当时 repo-index 均通过。

从 `ce72775` 到当前产品候选，产品变化只有下表五项；它们各自有绑定提交的最小充分证据，没有改 Runtime/Interaction authoring、Published controller、save/recovery、fixture、Electron journey 或合同。因此本门复用上述证据，没有再次运行 `npm test`、完整 E2E、desktop build、`verify` 或固定三份代表工程。

| 产品提交 | 实际行为 | 绑定证据 |
|---|---|---|
| `50df8fb` | Flow block key 直接传给 React，消除 warning | `flowWorkspace.test.tsx 12/12` |
| `68c2463` | Spatial PPTX SVG 以真实 media/relation 写入 | `coursePptxExport.test.ts 3/3`；独立 Export review approve |
| `cc39791` | ProjectHealthPanel 只在打开时挂载分析体 | `projectHealthPanel.test.tsx 1/1`；独立 UI review approve |
| `b5655ec` | 三 Surface global playback/controller 使用 canonical command + 当前 history | `globalEditorStore.test.ts 14/14`、root TypeScript；独立 Store review 在修复 Slide lock 后 approve |
| `eb224da` | Mixed 导航失败补偿旧 host/location | focused `13/13`、Published V2 Mixed `1/1`、root TypeScript；独立 Player review在修复 release failure 后 approve |

W2-A 与 W2-B1 的更早证据分别继续由 `ARCH_2_W2A_GATE_REPORT.md` 与 `ARCH_2_W2B1_GATE_REPORT.md` 负责。本报告不复制其完整测试明细。

## 3. W2-B2 准入与实际复杂度下降

W2-B2 先执行只读必要性准入，而不是按阶段名配任务：

| 候选域 | 准入决定 | 最终结果 |
|---|---|---|
| Global Layers / Teacher Controller | admit | 两个目标 Store action 的 legacy no-op fallback 降为 `0`；三 Surface 各用现有 persistence/history |
| Diagnostics | admit | closed Panel 自身 collector invocation `3 → 0`；App Toolbar 的一个 intentional summary consumer 保留 |
| Save / Recovery | skip / retained | 现有 App/Persistence snapshot、sidecar、component package、single-flight 与 atomic write 已有真实 consumer 和证据；无 bug、第三 consumer 或替代目标，不抽新生命周期 |

Global Controls 独立审查发现并阻止了一个 Slide authoring lock 回归：最终 Slide restore 使用窄选项保留 lock；Flow/Spatial 继续保留既有 restore 时解锁语义，没有借本卡做未经产品裁决的统一。

## 4. Mixed 导航失败原子性

门禁审计发现，旧 `MixedCourseNavigator` 会先释放旧 Surface，再激活和定位目标；失败时 navigator bookkeeping 仍指向旧 location，但 Player 可能无 active host 或已激活目标。

最终补偿合同为：

- previous release 返回 `{ok:false}` 或抛错：目标不激活；根据 port truth 保持或恢复 previous location；
- target activation 失败：重新激活并定位 previous；
- target 已激活后 prepare/location 失败：先释放 target，再激活并定位 previous；
- same-Surface location 失败：只恢复 previous location，不 release/reactivate 同一 host；
- first start 定位失败：存在 release port 时释放已激活 target；
- 补偿成功仍抛原始 failure；补偿也失败则用 `AggregateError` 保留两个 cause；
- `#current`、history 与 `onNavigate` 只在全部 host 操作成功后提交；失败后正常 retry 仍只增加一个正常 history entry。

独立 review 首次拒绝了未检查的 previous-release 结果；最终修复后 approve。现有 `CoursePlayer` 与三个 Surface host 均未修改。

## 5. Dependency ratchet 与 Legacy consumer

组合候选上的原有 architecture ratchet 先通过 `11/11`。由于它没有精确保护 Global Controls 的新下降目标，本门只增加一个 source sentinel：

- `updatePlayback → updateDesignTokens` 切片必须使用 `updateCoursePlaybackSettings` 与 Spatial/Flow/Slide 三个当前 persistence adapter，且不得调用 `commit(`；
- `ensureTeacherController → addExternalComponentNode` 切片必须使用 `restoreDefaultTeacherController` 与三个当前 persistence adapter，且不得调用 `commit(`。

新增后 `architectureDependencyRatchet.test.ts` 通过 `12/12`。没有增加通用 facade、第二 history 或文件级架构框架。

`LEG-002` 静态核对：

```powershell
(git grep -n -I -F -- 'buildExportPayload' -- 'src/**' 'scripts/**' 'tests/**' 'examples/**' | Measure-Object).Count
```

结果仍为 `23`，与 ledger 的 `observedMatches: 23` 相同。从 `ce72775` 到当前产品候选没有修改 Legacy payload/runtime execution 路径；Player surface 变化只有 `MixedCourseNavigator`，未新增 `buildExportPayload`、`PlayerApp`、`CourseRuntimeKernel` 或 RuntimeHost 旁路。

因此 `LEG-002` 继续是 `active-debt / partial-existing`：Owner 为 Preview / Export / Player，Published V2 是 course delivery replacement，但 Runtime authoring preview、fixtures、portability、release 与 Legacy tests 仍有真实职责；ARCH-5 必须逐 consumer 复审，当前不能宣称真实 Published Runtime execution 或 consumer=0。

## 6. 最终同协议性能测量

协议保持不变：同 fixture，`5` warmups + `21` samples；median 调查线 `max(base×1.25, base+1ms)`，P95 调查线 `max(base×1.35, base+2ms)`。命令严格只运行一次，没有为了获得更好结果重跑：

```powershell
npm run build:player
npx tsx scripts/measure-architecture-baseline.ts --samples=21 --warmup=5
```

Player build 约 `1.92s`，bundle `1,844,916 bytes`；测量约 `9.37s`。结果如下：

| Fixture / operation | 本次 M/P95 ms | W2-B1 M/P95 ms | 调查线 M/P95 ms | 结果 |
|---|---:|---:|---:|---|
| Slide open | 1.169 / 1.827 | 1.459 / 2.489 | 2.230 / 4.176 | pass |
| Slide save+reopen | 3.486 / 4.499 | 3.807 / 5.844 | 4.546 / 7.278 | pass |
| Slide validate/preflight | 3.742 / 6.356 | 3.776 / 5.631 | 4.933 / 7.626 | pass |
| Slide Published V2 | 1.579 / 3.000 | 1.579 / 2.402 | 2.588 / 4.917 | pass |
| Slide standalone HTML | 6.189 / 7.912 | 6.234 / 9.195 | 7.386 / 10.230 | pass |
| Slide Web ZIP | 43.883 / 48.739 | 42.915 / 47.345 | 47.363 / 68.066 | pass |
| Flow open | 0.401 / 0.488 | 0.392 / 0.682 | 1.454 / 3.361 | pass |
| Flow save+reopen | 1.549 / 2.375 | 1.604 / 2.175 | 3.111 / 4.678 | pass |
| Flow validate/preflight | 1.588 / 2.421 | 1.564 / 2.112 | 2.916 / 5.129 | pass |
| Flow Published V2 | 0.453 / 0.945 | 0.581 / 1.041 | 1.669 / 2.875 | pass |
| Flow standalone HTML | 4.667 / 6.432 | 4.412 / 5.806 | 5.984 / 8.702 | pass |
| Flow Web ZIP | 38.463 / 53.604 | 52.521 / 108.620 | 68.663 / 106.701 | pass |
| Mixed open | 0.630 / 0.875 | 2.090 / 2.593 | 2.594 / 3.761 | pass |
| Mixed save+reopen | 2.679 / 3.348 | 8.028 / 8.451 | 7.096 / 8.795 | pass |
| Mixed validate/preflight | 2.868 / 4.273 | 9.333 / 11.100 | 6.353 / 10.980 | pass |
| Mixed Published V2 | 1.247 / 2.126 | 3.889 / 4.706 | 3.998 / 6.142 | pass |
| Mixed standalone HTML | 5.456 / 6.427 | 14.896 / 18.000 | 11.848 / 14.692 | pass |
| Mixed Web ZIP | 39.215 / 41.903 | 108.822 / 114.169 | 96.305 / 123.217 | pass |
| Slide transform+undo+redo | 1.264 / 1.605 | 4.315 / 4.703 | 3.498 / 4.851 | pass |
| Flow text+undo+redo | 0.233 / 0.306 | 0.629 / 0.867 | 1.408 / 2.569 | pass |
| Mixed navigate all locations | 1.145 / 1.892 | 4.113 / 5.528 | 3.131 / 4.949 | pass |
| Flow DOCX | 1.111 / 1.493 | 3.147 / 4.676 | 2.939 / 4.254 | pass |

最终为 `22/22 below registered investigation lines`。B1 相邻行与无关控制组同时恢复，W2-B1 的 `8/22` amber 更符合当时环境/进程方差；没有稳定、孤立的 Mixed/B1 regression，因此不准入缓存、虚拟化或性能架构卡。本结果只关闭登记的工程调查，不构成发布性能承诺。

## 7. Spatial large-world：明确 retained unknown

现有证据覆盖远坐标、camera/semantic culling 与手势/session camera，但不覆盖 large-N：

- Schema 的 `20,000` world-item 上限是合同容量，不是性能承诺；
- 当前 mixed-spatial fixture 只有 `4` 个 world items；
- Spatial host 会收集全部 entries，并为 off-camera item 保留 wrapper，只切换 display。

没有约定目标规模、设备和时延线，也没有复现冻结、明显掉帧或交互失败。本阶段因此不虚构 virtualization 卡，也不把小 fixture green 写成 large-world accepted。重访触发器是：产品给出目标规模/设备/交互预算，或真实项目复现卡顿/掉帧/timeout；届时先建 characterization，再决定是否优化。

## 8. 分层状态与下一步

- Pipeline：`pass`（绑定 focused evidence、ratchet、performance 与最终 deterministic checks）。
- Engineering：`ARCH-2 pass / engineering candidate`。
- Functional outcome：本阶段准入的 Media、Components、Runtime/Interaction slice、Global Controls、Diagnostics 与 Mixed failure behavior 均 green。
- Performance outcome：`green against registered ARCH-0 investigation lines, 22/22`；不是发布 SLA。
- Visual outcome：既有 `art candidate` 不提升；Spatial large-world 未评价，自动化没有产生教师视觉结论。
- Teacher/product accepted：`not claimed`。

ARCH-3 只允许从最新源码重新做 Slide/Flow/Spatial 必要性准入；没有真实跨边界 consumer 或可量化理解范围下降的 Surface 可以零张实现卡结束。不得把本阶段 pass 当作预建三套 Surface seam 的授权。
