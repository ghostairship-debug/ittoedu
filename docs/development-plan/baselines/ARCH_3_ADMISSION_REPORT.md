# ARCH-3 Surface 模块化必要性准入报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 产品基线：`eb224da`；ARCH-2 gate 与其后文档/生成物未改变 Surface product source
>
> 决策规则：只为真实跨 Surface consumer 建立最窄 seam，并在同卡接入首个 consumer

## 1. 结论

| Surface | 当前直接跨 Surface 依赖 | 决定 | 本轮实现卡 |
|---|---:|---|---:|
| Slide | Slide-named source → Flow/Spatial `0`；`slideAuthoringBackend.ts` → Flow/Spatial `0` | skip | 0 |
| Flow | Flow-named source → Slide `3` import edges / `4` call sites | admit one first consumer | 1 |
| Spatial | Spatial-named source → Slide `2` import edges；hit adapter 一条边携带 `6` 个 symbols | admit one first consumer | 1 |

本阶段不为 Slide 建 selector/command/placement/view-model 矩阵，也不因 Workspace、Properties 或 Store 较大建任务。Flow 与 Spatial 的两张卡写入范围互不重叠，可以并行；完成首 consumer 后必须重新准入剩余边，不自动迁完。

## 2. Slide：skip

当前 `14` 个 Slide-named source files 中，没有 Slide → Flow/Spatial import；语义入口 `slideAuthoringBackend.ts` 也没有该依赖。其他 Surface 借用 Slide-named donor 是对应 borrower 的边界债务，不是 Slide 自身的用户失败。

Skip condition：只有 Slide 行为本身开始读取 Flow/Spatial 内部实现，或出现明确 Slide consumer/用户失败/可量化理解范围下降时，才重新准入。目录不对称、文件大小与“阶段应有一张 Slide 卡”均不是证据。

## 3. Flow：准入一个 neutral project mutation 首 consumer

### 当前事实

- `flowEditorCommands.ts` 从 `slideEditorCommands.ts` 导入 `commitSlideProjectMutation`，`runMutation` 有 `1` 个调用；
- `flowSharedAuthoringAdapters.ts` 有同一 import edge 与 `2` 个调用；
- `createFlowCourseProject.ts` 有同一 import edge 与 `1` 个调用；
- donor `commitSlideProjectMutation` 只做 clone、recipe、revision+1、updatedAt 与 Course Project Schema parse，行为不依赖 Slide carrier/session/UI；
- 当前不存在等价 neutral helper。

因此准入 `arch-3-01-neutral-project-mutation-first-flow-consumer`：

1. 新建 `src/renderer/course/courseProjectMutation.ts`，把唯一实现移为 `commitCourseProjectMutation`；
2. `slideEditorCommands.ts` 保留零逻辑 compatibility alias `commitSlideProjectMutation`；
3. 只把 `flowEditorCommands.ts#runMutation` 切到 neutral name；
4. 不迁 `flowSharedAuthoringAdapters.ts` 或 `createFlowCourseProject.ts`。

精确预期 delta：

- `flowEditorCommands` Flow → Slide edge：`1 → 0`；
- 本报告盘点的 Flow-named sources → Slide edge：`3 → 2`；
- 本报告盘点的 Flow-named sources 通过 Slide name 调用该 helper：`4 → 3`；
- 实现份数保持 `1`，旧 export 只是 compatibility alias。

允许文件：

- `src/renderer/course/courseProjectMutation.ts`
- `src/renderer/course/slideEditorCommands.ts`
- `src/renderer/course/flowEditorCommands.ts`
- 只在缺少 characterization 时修改 `tests/unit/flowEditorCommands.test.ts`、`tests/unit/courseTreeView.test.ts`

禁止：其他两个 Flow consumer、Store/App/Workspace/Properties、Spatial、history、Schema/contracts、dependencies/generated。

最小验证：

```powershell
npx vitest run tests/unit/flowEditorCommands.test.ts tests/unit/courseTreeView.test.ts
```

该任务为 S1 / implementation / subtractive / V1 / Reviewer 1。若需要复制实现、第二 mutation 机制或 Store 接线，立即停止。

## 4. Spatial：准入一个 neutral LayerItem hit policy 首 consumer

### 当前事实

`v9SpatialHitAdapter.ts` 从 `v9SlideHitAdapter.ts` 导入：

- `adaptV9SlideLayerItemHit`
- `hitTestV9SlideLayerItems`
- `marqueeHitV9SlideLayerItems`
- `v9SlideLayerItemBounds`
- `V9SlideHitBounds`
- `V9SlideHitTarget`

这些 symbols 实现的是 LayerItem bounds/hittability/旋转几何/逆序 point hit/marquee hit；Spatial 自己才增加 viewport/world coordinate space、scope 映射与 viewport-first priority。通用 policy 放在 Slide-named 文件迫使 Spatial 理解 Slide internals，但无需改变任何 Surface carrier。

因此准入 `arch-3-02-neutral-layer-item-hit-test-first-spatial-consumer`：

1. 新建 `src/renderer/phaser/layerItemHitTest.ts`，移动通用 bounds/hittability/adapt/point/marquee 实现；
2. `v9SlideHitAdapter.ts` 保留现有 Slide-named exports 作为零逻辑 alias，并保留 `editorPhaserPointerToWorld`；
3. `v9SpatialHitAdapter.ts` 改用 neutral API；
4. 不改变 Spatial viewport/world priority、coordinate/scope mapping 或 gestures。

精确预期 delta：

- `v9SpatialHitAdapter` Spatial → Slide edge：`1 → 0`；
- 全部 Spatial → Slide edge：`2 → 1`；
- Spatial 从 Slide hit adapter 导入的 symbols：`6 → 0`；
- Slide wrapper source importers：`4 → 3`；
- 通用实现保持 `1` 份，Slide wrapper 保持兼容。

允许文件：

- `src/renderer/phaser/layerItemHitTest.ts`
- `src/renderer/phaser/v9SlideHitAdapter.ts`
- `src/renderer/phaser/v9SpatialHitAdapter.ts`
- 只在缺少 characterization 时修改 `tests/unit/spatialWorkspaceAuthoring.test.ts`、`tests/unit/v9SlideViewportAdapter.test.ts`

禁止：`spatialWorldAuthoring.ts`、`v9SlideContentEdit.ts`、`EditorPhaserBridge.ts`、Store/App/UI、commands/history、Schema/contracts、dependencies/generated。

最小验证：

```powershell
npx vitest run tests/unit/spatialWorkspaceAuthoring.test.ts tests/unit/v9SlideViewportAdapter.test.ts
```

该任务同为 S1 / implementation / subtractive / V1 / Reviewer 1。若 neutral file 吸收 pointer conversion、Surface priority 或 Spatial scope，它已越界。

## 5. 首 consumer 后必须重新准入

本报告不授权批量迁移以下剩余边：

- Flow：`flowSharedAuthoringAdapters.ts` 的 overlay/location visibility 两个调用；
- Flow：`createFlowCourseProject.ts` 的 Flow page append 调用；
- Spatial：`spatialWorldAuthoring.ts → v9SlideContentEdit.ts` 的 keyboard/blur/selection policy 与 Slide-named draft/action types；
- `commitSpatialProjectMutation` 与 neutral mutation 的实现相似，但不是本轮直接 import target，也不是自动合并理由。

首任务完成后重新核对用户行为、consumer 数、测试与认知范围。剩余边可以继续 admit，也可以 retained；ARCH-3 不要求归零 KPI。

## 6. 阶段门预期范围

两个首 consumer 完成并复审余边后，ARCH-3 phase gate 复用两卡 focused evidence，只补 combined-head TypeScript、精确 import counts、compatibility wrapper 零逻辑检查、一次最终 repo-index generate/check 与 task-board/diff hygiene。

不运行完整 unit、Electron E2E、desktop build、性能矩阵、Preview/Export 或代表工程；这两张卡只移动纯实现与 import ownership，没有使这些证据失效。
