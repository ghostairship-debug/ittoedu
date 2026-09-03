# r11-052-supported-test-migration｜测试只证明受支持 V9/V2 行为

- Release / Dependencies: 1.1 / r11-037-editor-store-owner-modularization
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-02–PM-28

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。原规格表中的多数文件已在此前提交删除（`tests/helpers/projectV8.ts`、`courseProjectMigration.test.ts`、单元级 `player-payload.test.ts`、`courseRuntimeKernel*.test.ts`、`runtimeExport.test.ts`、`publishedLesson.test.ts`、`webPackageExport.test.ts`、`playerAppLayerOrder.test.ts`、`playerAuthoringHost.test.ts`），它们是历史处置，不恢复、不作为 Read first。下面的表按当前 `tests/**` 重算。

仍只允许三类分类：`supported-behavior-migrate`、`v8-success-delete`、`v8-rejection-retain`。执行者只判断一个断言属于哪一类和对应哪个 V2 替代用例，不得重新决定 V8 是受支持格式，也不得删除仍受支持的行为。

## Outcome / current evidence

- `check:preservation` 的 map/matrix 结构已有效（当前只因 PM-08 的一条行为测试失败，由 r11-029 返工卡处理），Wave E 只需保持两道门为绿。
- 旧渲染器簇 `src/player/renderNode.ts`、`renderVideoNode.ts`、`renderTeacherController.ts`、`ComponentEventMountBuffer.ts`、`NodeMotionDirector.ts`、`sceneAssets.ts` 在 src 中只被 `PlayerScene.ts` 链路引用（对每个文件运行 `grep -rlE "/NAME'" src --include="*.ts"` 排除自身后只剩簇内文件与 `PlayerScene.ts`）；V2 Slide 绘制在 `src/player/surfaces/slide/publishedNativeRendering.ts`，不 import 它们。因此这些模块是随 `PlayerScene` 一起死亡的旧渲染器，但它们**不在**台账 LEG-002 的 targets 中；r11-053 必须先把它们登记为 `file-absent` targets，r11-054 才能删除。本节点只处理它们的测试。
- `tests/unit/playerCapture.test.ts` 的 PlayerApp stub 成功用例由 r11-032 执行卡处理；本节点只核对 `grep -c "PlayerApp" tests/unit/playerCapture.test.ts` 为 0。

## Read first

- `tests/unit/publishedCourseState.test.ts`、`tests/unit/publishedCourseNavigation.test.ts`、`tests/integration/publishedRuntimeSlideHostIntegration.test.ts`、`tests/unit/slidePublishedNativeText.test.ts`（V2 替代用例的现有覆盖）
- 该波表中列出的旧测试文件
- `docs/development-plan/baselines/v1.1-preservation-map.json` 与 `docs/development-plan/roadmap/PRESERVATION_MATRIX.md`（只在 Wave E 读 PM-07 相关行）

## Exact targets

| 文件 | 当前事实 | 固定处理 |
|---|---|---|
| `tests/unit/playerSceneMotionLifecycle.test.ts`（5 个 `it`）、`tests/unit/playerSceneComponentEventBuffer.test.ts`（3 个 `it`）、`tests/unit/playerSceneAnimationMode.test.ts`（2 个 `it`） | 直接 `new PlayerScene`，构造 `schemaVersion: 8` 的 `ProjectDocument` 与 `ExportPayload` 成功路径 | 逐 `it`：行为已被 V2 host 测试覆盖 → `v8-success-delete`，交接写明覆盖它的 V2 `it` 名；未覆盖但仍受支持 → `supported-behavior-migrate` 到上面四个 V2 文件之一；无法判断 → 停止 |
| `tests/unit/componentEventMountBuffer.test.ts`、`tests/unit/formulaCrossSurface.test.tsx`、`tests/unit/nodeMotionDirector.test.ts`、`tests/unit/playerComponentV4Render.test.ts`、`tests/unit/renderVideoNode.test.ts`、`tests/unit/teacherControllerActions.test.ts`、`tests/unit/playerSceneAssets.test.ts` | import 旧渲染器簇 | 逐 `it` 三分类。`renderVideoNode.test.ts` 与 `formulaCrossSurface.test.tsx` 是 PM-07 的证据文件，Wave E 必须把 PM-07 改绑到 V2 替代测试（公式画布用 `publishedCourseNavigation.test.ts` 的 "paints slide formulas as math canvases" 用例；视频与文字用 `slidePublishedNativeText.test.ts` 或迁入的新用例）；不得删掉 PM-07 行为 |
| `tests/unit/componentPackageLifecycle.test.ts`（`ProjectDocument` ×2）、`tests/unit/informationRelease.test.ts`（×3）、`tests/unit/projectDiagnostics.test.ts`（×2）、`tests/unit/projectHealth.test.ts`（×1）、`tests/unit/coursePrintArtifacts.test.ts`（`ExportPayload` ×1）、`tests/unit/playerComponentV4Render.test.ts`（`ExportPayload` ×3） | 旧类型 token 命中，成功路径还是拒绝断言未核实 | 逐处判定：拒绝断言 → `v8-rejection-retain`，只保留 fail-loud 所需的最小字节或对象，不保留旧类型 import；成功路径 → 迁移或删除 |
| `schemaVersion: 8` 命中：`tests/fixtures/course-project-v9/rejection.ts`、`tests/integration/architectureBaselineFlows.test.tsx`、`tests/unit/buildPublishedCourseV2.test.ts`、`tests/unit/coursePptxExport.test.ts`、`tests/unit/coursePrintArtifacts.test.ts`、`tests/unit/courseProjectArchive.test.ts`、`tests/unit/courseProjectRoundTrip.test.ts`、`tests/unit/courseProjectTopLevelFields.test.ts`、`tests/unit/legacyInventoryChecker.test.ts`、`tests/unit/projectFormatIsolation.test.ts`、`tests/unit/publishedCourseProtocol.test.ts`、`tests/unit/renderPptxComponentSnapshots.test.ts`、`tests/unit/renderPptxRuntimeSnapshots.test.ts`、`tests/unit/validateProject.test.ts` | 多数是拒绝夹具 | 逐处确认为 `v8-rejection-retain`；任何用它构造成功路径的 → 迁移或删除 |
| `tests/e2e/window.d.ts` 中 `__H5_LESSON_PLAYER__` 的 `getCurrentSceneIndex`、`goToScene`、`replayScene`、`waitForCaptureReady` | 类型声明 | 以 `src/player/publishedCoursePresenter.ts` 是否仍暴露这些方法为准：仍暴露 → 保留；不再暴露 → 删除并同步使用它们的 e2e spec |
| `tests/unit/nodeExportHostFontWiring.test.ts:38`、`tests/integration/courseExportPreflightApp.test.tsx:339` 中的 `buildStandaloneHtml` 字样 | 禁止性正则 | 保留；属于 r11-002 扫描器表示法问题，交 Integrator，不在本节点处理 |

## Execution waves

每波一张执行卡；同一波内先完成 migrate 再删除旧成功用例，跑该波命令后才交接。

| Wave | 内容 | Focused validation |
|---|---|---|
| A | 上表前两行的 10 个文件逐 `it` 处理；A 可按文件拆成两张卡 | `npx vitest run tests/unit/publishedCourseProtocol.test.ts tests/unit/publishedCourseState.test.ts tests/unit/publishedCourseNavigation.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts tests/unit/slidePublishedNativeText.test.ts` |
| B | 上表第三、四行的 token 命中逐处分类 | `npx vitest run tests/unit/courseProjectArchive.test.ts tests/unit/projectFormatIsolation.test.ts tests/unit/validateProject.test.ts tests/unit/coursePackageExport.test.ts tests/unit/coursePptxExport.test.ts tests/unit/coursePrintArtifacts.test.ts tests/unit/componentPackageLifecycle.test.ts tests/unit/informationRelease.test.ts tests/unit/projectDiagnostics.test.ts tests/unit/projectHealth.test.ts` |
| C | 扫描闭合：`grep -rlE "from '.*player/(PlayerScene|PlayerApp|renderNode|sceneAssets|NodeMotionDirector|ComponentEventMountBuffer|renderVideoNode|renderTeacherController|CourseRuntimeKernel|payload|publishedLesson)'" tests` 为 0；`grep -rlE "\bProjectDocument\b" tests` 与 `grep -rlE "\bExportPayload\b" tests` 只剩交接中逐个列出的拒绝用例与门测试 | `npx vitest run tests/unit/legacyInventoryChecker.test.ts tests/unit/editor10ForbiddenTokens.test.ts tests/unit/readModelBoundary.test.ts` |
| D | 全量行为 | `npm run test:product` |
| E | 在同一变更更新 `v1.1-preservation-map.json` 与 `PRESERVATION_MATRIX.md` 中受影响 PM（至少 PM-07）的证据命令与输入闭包；不改 PM 语义 | `npm run check:development-roadmap` 与 `npm run check:preservation` |

## Write scope

只允许修改或删除 Exact targets 表中的测试文件，修改表中列出的 V2 替代测试文件（只增用例），并在 Wave E 更新两份 preservation 文件中受影响 PM 的证据命令。`tests/unit/readModelBoundary.test.ts` 只允许删除已失效旧测试 consumer 的直接声明，不得改变结构边；`tests/unit/architectureDependencyRatchet.test.ts` 不改。禁止改产品代码、共享 inventory、fixture contract，禁止弱化或删除受支持行为断言、改 timeout/retry 掩盖失败，或把 V8 成功用例改名后保留。

## Stop conditions

- 不能判断旧断言是否仍代表受支持行为。
- V9/V2 路径无法实现同一行为，说明前置产品 lane 未完成，退回最近产品 owner。
- 需要修改产品代码或降低断言强度才能迁移。
- 任一门测试变红。

## Acceptance

- Wave C 的三条 grep 结果与交接列表一致。
- 所有保留的功能断言使用 V9/V2；V8 只剩明确拒绝用例。
- 每个被删或被迁的 `it` 都有 `旧文件#it → 分类 → V2 替代 it 或"拒绝保留" → PM ID` 一行记录。
- PM-02 到 PM-28 的受支持行为断言数量与层级不因删旧测试下降；PM-07 已改绑到 V2 替代测试。
- `check:preservation` 与 `check:development-roadmap` 通过后，r11-055 才可开始。

## Focused validation

- Wave A–C：该波表格中的命令
- Wave D：`npm run test:product`
- Wave E：`npm run check:development-roadmap` 与 `npm run check:preservation`

## Rollback / handoff

按测试用例分类回滚；不得恢复已删除的 V8 成功产品路径。交接除指南第 6 节格式外，附逐 `it` 处置表，并列出 r11-053 需登记的旧渲染器簇六个路径。
