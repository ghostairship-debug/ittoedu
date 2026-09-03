# r11-032-player-v2-only-entry｜Player 入口只接受 Published V2

- Release / Dependencies: 1.1 / r11-033-runtime-authoring-preview-v2, r11-041-pptx-v2-only, r11-042-pdf-v2-only, r11-043-html-web-v2-only
- Write locks: `published-producer`
- Inventory access: read
- Preservation: PM-06, PM-09, PM-14–PM-21

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。本节点原规格的入口部分已完成，下面只保留仍需执行的残留。

## Outcome / current evidence

已完成：`src/player/index.ts#startPlayer` 只经 `parsePublishedCourseV2Entry` 严格解析 Published V2 并只挂载 `CoursePlayer`；旧 payload、旧全局变量与损坏 JSON 均 fail-loud（`tests/unit/publishedCourseProtocol.test.ts` 的 "Player bundle entry is Published V2 only" 与 `tests/integration/player-payload.test.ts`）。`src/player/payload.ts` 在 src 中已无 importer。

未闭合：本节点负责的最后一个正式产品 consumer。`src/renderer/export/playerCapture.ts:1` 仍 `import type { PlayerApp }`，并保留以 `PlayerApp` 为参数类型的旧捕获函数（当前已知 `waitForPlayerScene`:72、`waitForPlayerLoaderIdle`:84、`waitForPlayerCaptureReady`:118、`phaserSnapshot`:728、`capturePlayerStage`:746），它们在 src 中零调用，只被 `tests/unit/playerCapture.test.ts` 的旧成功用例消费。这正是台账 LEG-002 中 `playerCapture.ts#PlayerApp` 那条 consumer，也是 `check:legacy-inventory` 报出的 `src/renderer/export/playerCapture.ts:1#target-reference:LEG-002-player-app` 与 `tests/unit/playerCapture.test.ts:2#target-reference:LEG-002-player-app`。

交接文件曾提到的"Flow-only aggregate/Builder 无效输入必须 fail loud"在当前 HEAD 无法复现：`parsePublishedCourseV2Entry`、`createPublishedCourseSession` 与 `tests/unit/coursewareCaseBuilder.test.ts` 均无对应失败。该项只有在 Integrator 给出可复现的失败测试后才重新进入本节点；给不出即作废，不由执行者猜测实现。

## Read first

- `src/renderer/export/playerCapture.ts`（1–130 行与 726–760 行）
- `tests/unit/playerCapture.test.ts`
- `src/player/surfaces/CoursePlayer.ts`（42–70 行的 `isLegacyPlayerPayload` 与 `assertParsedPublishedCourseV2`）
- `docs/development-plan/inventories/legacy-consumers.json`（只读 LEG-002 记录）

## Exact targets

| 位置 | 动作 | 依据 |
|---|---|---|
| `src/renderer/export/playerCapture.ts:1` `import type { PlayerApp }` | 删除 | 最后一个产品级旧 Player consumer（对应记录见 Outcome） |
| `playerCapture.ts` 中所有以 `PlayerApp` 为参数类型的函数（执行时以 `grep -n "PlayerApp" src/renderer/export/playerCapture.ts` 的实际结果为准；多出的同类函数同样处理，少于五个则停止） | 删除整个函数 | 每个函数 `grep -rlE "\bNAME\b" src --include="*.ts" --include="*.tsx"` 排除本文件后为 0 |
| `settleCaptureFrames`、`createHiddenPlayerRoot`、`sizeHiddenPlayerStage` | 只有当上述删除后本文件内部也不再引用时才删除；仍被 V2 函数引用则保留 | 以 `npm run typecheck` 与本文件内 grep 为准 |
| 文件内注释中的 `PlayerApp` 字样（当前 :114–116、:929、:975–976、:1064、:1135） | 改写为"旧播放器输入"等不含该标识符的表述 | 零门按 token 扫描 |
| `tests/unit/playerCapture.test.ts` 中构造 `as unknown as PlayerApp` 的成功用例（当前 :19–29 的 stub 工厂、:40 与 :60 两个 `it`，以及 :224、:335 处 stub） | 删除只验证旧 PlayerApp 捕获函数的 `it` 与 stub；保留 :356、:420 两个拒绝用例，但把入参类型改为 `unknown`，不再 import `PlayerApp` | 052 三分类中的 `v8-success-delete` 与 `v8-rejection-retain` 已由本表固定 |

允许新建：无。

## Write scope

只允许修改 `src/renderer/export/playerCapture.ts` 与 `tests/unit/playerCapture.test.ts`。禁止修改 `src/player/**`、其他 `src/renderer/export/**` 文件、共享 inventory、Published wire。

## Execution

1. 对表中每个待删函数运行 `grep -rlE "\bNAME\b" src --include="*.ts" --include="*.tsx"`，排除 `playerCapture.ts` 自身后必须为 0；任一非 0 立即停止。
2. 先改测试：删除旧成功 `it` 与 stub 工厂；两个拒绝用例的入参改为 `unknown`；删除 `import type { PlayerApp }`。运行 `npx vitest run tests/unit/playerCapture.test.ts`，此时应仍通过。本卡是纯删除，没有"红"测试；以第 6 步的结构事实代替红→绿。
3. 删除产品文件中的旧捕获函数与 :1 的类型 import；按 typecheck 结果决定三个 helper 是否随之删除。
4. 改写注释中的 `PlayerApp` 字样。
5. `npm run typecheck`，再运行 Focused validation 第一条。
6. 结构事实：`grep -c "PlayerApp" src/renderer/export/playerCapture.ts` 为 0；`grep -c "PlayerApp" tests/unit/playerCapture.test.ts` 为 0；`npm run check:legacy-inventory` 输出中不再出现 `playerCapture.ts:1#target-reference:LEG-002-player-app` 与 `playerCapture.test.ts:2#target-reference:LEG-002-player-app`，其余观察项原样粘贴。

## Stop conditions

- 任一待删函数在 src 中仍有调用。
- 删除后 `npm run typecheck` 失败，且修法不是"继续删除同样零调用的 helper"。
- 需要改动 `src/player/**` 或 Published wire。
- 要求实现 Flow-only 项，但 Integrator 尚未给出失败测试。

## Acceptance

- 两个文件中 `PlayerApp` 命中均为 0；两个拒绝用例仍存在并通过。
- PDF/PPTX 捕获路径测试通过。
- `check:legacy-inventory` 的 LEG-002 观察项减少两条，其余不变。

## Focused validation

- `npx vitest run tests/unit/playerCapture.test.ts tests/unit/coursePrintArtifacts.test.ts tests/unit/renderPptxComponentSnapshots.test.ts tests/unit/renderPptxRuntimeSnapshots.test.ts tests/unit/publishedCourseProtocol.test.ts`
- `npm run typecheck`

## Rollback / handoff

单一提交，整体回滚。交接按指南第 6 节格式；"未做"栏写明 Flow-only 项状态。
