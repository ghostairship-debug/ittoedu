# ARCH-3 剩余边二次准入报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 产品基线：`cf846e0`
>
> 决策规则：只有能消除一条完整 Surface 边或一份真实重复实现的行为保持型任务才准入

## 1. 结论

| 候选 | 当前事实 | 决定 | 实现卡 |
|---|---|---|---|
| Flow 共享浮层 mutation | `flowSharedAuthoringAdapters.ts` 有 `1` 条 Slide import edge、`2` 个在线 helper calls | admit；两个 calls 同卡迁 neutral | `arch-3-04` |
| `appendBlankFlowPage` | 生产引用 `0`，测试引用 `1`；现行路径已由 `addCourseFlowPage` 替代 | retained；ARCH-5 删除候选 | 0 |
| Spatial project mutation | 与 neutral helper 逐句同构；`7` 个 source consumers、`30` 个 calls | admit；保留领域 API 的零逻辑 alias | `arch-3-05` |
| Spatial content edit | `1` edge / `10` symbols；`3` 个 resolver 仅改名 re-export 且全仓 `0` consumer，其余为 draft/action types | retained | 0 |
| Store 与其他 generic consumers | 多数换 helper 后仍保留 Slide edge，或只会增加 neutral import | retained | 0 |

二次准入正好生成两张互不重叠的小型实现卡。它们不写 Store、App、Workspace、Properties、合同或 generated artifacts，可以并行。ARCH-3 不以跨边归零为 KPI；保留边有明确 owner、理由与重入条件。

## 2. Flow：准入在线共享浮层 mutation

### 2.1 当前事实

初次迁移后，审计的 Flow-named sources 仍有 `2` 条 Slide import edges 与 `3` 个旧 helper calls：

- `flowSharedAuthoringAdapters.ts`：一条 import、两个在线 calls；分别服务共享浮层 mutation 与 surface-overlay 逐页显隐；
- `createFlowCourseProject.ts#appendBlankFlowPage`：一条 import、一个 call，但生产引用为 `0`。

共享适配器的两个 calls 必须一起迁移。只迁其中一个既不消除 import edge，也会在一个文件中并存两种等价 mutation 名称。

准入 `arch-3-04-neutral-flow-shared-overlay-mutation`：只把共享适配器的两个调用改为 `commitCourseProjectMutation`，并在同一 focused test 文件补齐 surface-overlay 逐页显隐 characterization。预期 delta：

- 该文件 Slide edge `1 → 0`；
- 该文件旧 helper calls `2 → 0`，neutral calls `0 → 2`；
- 审计的 Flow-named 总量 Slide edges `2 → 1`、旧 calls `3 → 1`；
- revision/history、Schema parse、错误映射和 carrier 不变。

`appendBlankFlowPage` 不先做 import 现代化。`tests/unit/courseLocationCommands.test.ts` 已证明它缺少 `mixedPrintPlan` 同步而失败，正常新增 Flow 页由 `addCourseFlowPage` 完成。它在 ARCH-5 按删除门禁直接审计，删除时才自然消除最后一条 Flow-named Slide edge/call。

## 3. Spatial：准入 mutation 实现去重

`spatialAuthoringHistory.ts#commitSpatialProjectMutation` 与 `courseProjectMutation.ts#commitCourseProjectMutation` 都按相同顺序执行 structured clone、recipe、revision+1、updatedAt 和 Course Project Schema parse。该 Spatial 名称被 `7` 个 source files 消费，共 `30` 个 call sites；强制迁移所有调用既不改善用户行为，也扩大改动面。

准入 `arch-3-05-neutral-spatial-project-mutation-alias`：仅在 `spatialAuthoringHistory.ts` 将旧领域名变为 neutral helper 的零逻辑 compatibility alias，保持全部 consumer 与 call sites 原样。预期 delta：

- 同构 mutation 实现副本 `2 → 1`；
- Spatial history 独立 Schema import `1 → 0`；
- `commitSpatialProjectMutation` 名称、`7` 个 source consumers 与 `30` 个 calls 不变；
- Spatial history/session/selection/resource transitions 不变。

## 4. 明确保留的边界

### 4.1 Spatial content edit

`spatialWorldAuthoring.ts → v9SlideContentEdit.ts` 仍是 `1` 条 edge，导入 `10` 个 symbols。三个 resolver 在 Spatial 端只是重命名 re-export，当前全仓没有 consumer；其余七个是 content draft/snapshot/action 类型。现在抽 neutral types/policy 文件只会增加 seam 和 alias，不会连接新的在线行为，也没有已知 Slide/Spatial 编辑漂移。

重入条件：Spatial UI 开始真实消费共同 key/blur/selection policy；第三个 Surface 需要同一 draft contract；或出现可复现的 Slide/Spatial content-edit 行为漂移。

### 4.2 Store 与 generic consumers

- `editorStore.ts` 有 `16` 个旧 helper calls，其中 Flow 分支 `3` 个；只迁这三个会让旧 calls `16 → 13`，但 Slide edge 保持 `1 → 1`，并新增一条 neutral import，复杂度反增；
- `courseLocationCommands.ts`、`effectiveLayerCommands.ts` 当前各自只有一次通用 import rename 候选，没有行为失败；等对应课程结构或统一图层行为真实修改时再评估；
- `globalLayerCommands.ts`、Media、Teacher Controller 还依赖 Slide 常量、session/history/types，单换 mutation helper 不能消边。

## 5. ARCH-3 阶段门边界

两张实现卡完成后，阶段门只：

1. 复用所有仍新鲜的 focused test evidence；
2. 在 combined HEAD 运行一次 TypeScript；
3. 静态确认 Slide-named → Flow/Spatial 为 `0`，Flow-named → Slide 为 `1 edge / 1 call`（死 API），Spatial-named → Slide 为 `1 edge / 10 symbols`（已保留），neutral mutation 实现只有一份，三个 compatibility wrappers 均零逻辑；
4. 统一刷新/检查一次 repo-index 与 task board，并做 diff hygiene；
5. 报告 retained edges、重入条件与 ARCH-5 删除候选。

不新增易碎 dependency ratchet，不重复完整 unit、Electron E2E、desktop build、性能、Preview、Export 或代表工程。用户可见路径和持久化合同均未变化，这些宽证据没有因 ARCH-3 失效。
