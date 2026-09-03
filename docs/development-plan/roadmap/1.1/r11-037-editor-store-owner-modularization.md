# r11-037-editor-store-owner-modularization｜按 Owner 拆 Store 并清除最后旧工程真相

- Release / Dependencies: 1.1 / r11-025-editor-store-v9-only, r11-032-player-v2-only-entry, r11-034-app-project-lifecycle-module, r11-035-app-delivery-module, r11-036-app-import-input-modules
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01–PM-18, PM-25–PM-27

## 2026-09-03 Gemini 执行版

本节点以 [GEMINI_EXECUTION_PLAN.md](GEMINI_EXECUTION_PLAN.md) 的 `r11-037a` 到 `r11-037z` 为唯一实施拆卡。旧 W1–W9 大卡及其基于 `bb1f848` 的行号、consumer 数量和验证命令全部作废；尤其不能再按“3 个测试读取根 history”执行，当前基线实际有 24 个直接测试 consumer。

## Outcome / current evidence

`editorStore.ts` 仍同时持有死镜像、扁平结果类型、Surface persist 包装、宽 Feature ports、投影缓存与根级 selection/navigation 镜像；`crossSurfaceCommands.ts` 仍混有结构命令、lifecycle 与具体 Surface 分支。目标是在不改变 V9/Published wire和用户行为的前提下，让：

- `editorStore.ts` 只实例化 Zustand、组合 Owner、接分派表和导出命名 selector；
- 三 Surface slice 各自持有 state、selection、history、persist 和 Surface 命令；
- lifecycle、course structure、projection 与 Feature ports 各有单一 Owner；
- 根级 history、assetFiles、selection/navigation 镜像与 module-global bind 为零；
- `crossSurfaceCommands.ts` 只组装请求并分派，不实现具体业务。

## Fixed owner map

| Owner | 持有 | 不得持有 |
|---|---|---|
| `editorStoreKernel.ts` | canonical read、authoring identity、resource commit、跨 Surface persist 分派入口 | UI、Feature planner、完整 Store |
| `courseResourceState.ts` | sidecar、component packages、resource delta/apply | 根级 assetFiles 镜像 |
| 三个 `*AuthoringSlice.ts` | 各 Surface session/selection/history/persist/命令 | 其他 Surface state、App lifecycle |
| `courseLifecycleSlice.ts` | load/reopen、草稿物化、persistence snapshot/ACK | 文件选择和 IPC effect |
| `courseStructureSlice.ts` | 页面/场景/Surface 结构命令 | Surface 内容编辑 |
| `editorShellSlice.ts` | tab/mode/status 等 UI state | document/resource writer |
| `course/editorCanvasProjection.ts` | 三 Surface 画布投影与缓存 | Store hook、mutation |
| 四个 Feature authoring 文件 | 各自实际使用的窄 ports | 共享完整 `FeatureAuthoringPorts` |
| `crossSurfaceCommands.ts` | active Surface 判别、请求组装与分派 | persist、archive、具体 Surface mutation |

## Card sequence

严格顺序：

```text
037a dead text-edit mirror
→ 037b asset mirror/root forwards
→ 037c–037e root-history test consumers
→ 037f history mirror removal
→ 037g–037h type ownership
→ 037i–037k Surface persist ownership
→ 037l kernel persistence dispatch
→ 037m–037o Feature ports and facade removal
→ 037p structure owner
→ 037q lifecycle owner
→ 037r–037t Surface navigation/layer/action ownership
→ 037u teacher-controller injection
→ 037v projection owner
→ 037w EditorState composition
→ 037x–037z root selection consumers and mirror removal
```

每张卡的精确符号、写入文件、测试和停止条件均在拆卡蓝图中。本规格不再重复一套可能漂移的行号表。

## Write scope

仅允许每张当前任务卡明列的文件。整个节点允许新增且仅允许新增：

- `src/renderer/store/slices/courseStructureSlice.ts`
- `src/renderer/course/editorCanvasProjection.ts`
- 四个 Feature 文件内部的各自窄 ports 类型

禁止新增第二 Store/Session/History、共享 Feature Facade、兼容 writer、`services/` 或 `features/` 汇总目录；禁止修改 V9/Published wire、Main/Preload、格式 producer 和 Legacy inventory。

## Stop conditions

- 当前卡的起始 consumer 查询与蓝图不一致。
- 迁移需要保留旧 writer、re-export、包装代理或双写。
- 需要修改卡外 Owner、产品能力、Schema、导出语义或测试断言强度。
- 当前卡目标测试出现与迁移直接相关且无法在卡内解释的失败。

## Acceptance

- 037a–037z 全部完成，且每卡旧实现随迁移删除。
- root 不再拥有业务实现、宽 ports、history/resource/selection 镜像或 projection cache。
- Feature 不 import root Store 或完整 `EditorState`；module-global teacher controller bind 为零。
- Workspace connector 只读命名 selector/单 Owner view并组装 typed ports，不持有跨 Owner业务。
- 本节点结束时不宣称最终通过；结构门、全量测试与保全门统一交给 r11-055/061。

## Focused validation

- 每张卡只运行 [执行者指南](EXECUTION_GUIDE.md) 与拆卡蓝图指定的一条目标测试命令。
- 产品 TypeScript 发生变化时运行 `npm run typecheck`。
- 本节点禁止运行 `npm run test:product`、`npm run verify` 或 `npm run check:preservation`。

## Rollback / handoff

每卡一个可回滚提交；失败只回滚当前卡。完成后按蓝图实例化下一卡，不要求中途 Integrator 复查。
