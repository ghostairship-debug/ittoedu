# r11-052-supported-test-migration｜测试只证明受支持 V9/V2 行为

- Release / Dependencies: 1.1 / r11-037-editor-store-owner-modularization
- Write locks: `generated-index`
- Inventory access: read
- Preservation: PM-02–PM-28

## Outcome / current evidence

旧 Player/Export/Runtime/Archive tests 中仍代表受支持行为的断言改用 r11-050 的 V9/V2 fixture；只刻画 V8 成功路径的 tests/helper 被删除。V8 fail-loud 拒绝仍有独立最小测试。

## Integrator audit / reopened（2026-09-03）

r11-051 的 V9 save wrapper 复核仍成立，已删除的 `tests/helpers/projectV8.ts` 和大批 Legacy success suites 不得恢复；现有 replacement tests 与 `npm run test:product` 全绿也是可保留证据。但本节点尚未闭合：

- `playerSceneMotionLifecycle.test.ts` 与 `playerSceneComponentEventBuffer.test.ts` 仍直接构造 `schemaVersion: 8` 的 `ProjectDocument` 和旧 `ExportPayload`，验证 Legacy `PlayerScene` 成功路径。
- `playerSceneAnimationMode.test.ts` 仍直接验证拟删除 `PlayerScene` 的成功实现；即使不命中当前 token，也必须判断其行为是否已由 CoursePlayer/Published V2 replacement 覆盖。
- PM-15 仍引用已删除的 `courseRuntimeKernel*.test.ts`，PM-21 仍引用已删除的 `webPackageExport.test.ts`；`check:preservation` 因此为 `malformed-map`。
- 当前 scanner 自身不完备，Exact targets 不能再被视为封闭全集。执行时必须用修正后的 r11-002 scanner 与直接 import/dependency closure 补齐全部旧 PlayerScene/CourseRuntimeKernel/PlayerApp/V8 type success tests。

仍只允许三类：`supported-behavior-migrate`、`v8-success-delete`、`v8-rejection-retain`。已删除旧 test 是历史处置记录，不是 Read first 路径；若 replacement 证据不等价，返回对应产品 owner，不恢复旧成功路径。r11-001 已在 r11-002 前建立当前有效 map/matrix；本节点只要改变测试路径、命令或 input closure，就必须在同一变更把逐 case `old test → classification → V9/V2 replacement → PM ID` 映射写回 preservation map/matrix，并保持两道 checker 为绿。正常 evidence 迁移不再返回 r11-001；只有 preservation checker/schema 本身需要改变时才停止并返回该 Owner。

## Read first

- `scripts/check-legacy-consumers.ts`
- `docs/development-plan/inventories/legacy-consumers.json`
- `tests/unit/playerSceneMotionLifecycle.test.ts`
- `tests/unit/playerSceneComponentEventBuffer.test.ts`
- `tests/unit/playerSceneAnimationMode.test.ts`
- `tests/unit/playerCapture.test.ts`
- `tests/unit/publishedCourseProtocol.test.ts`
- `tests/unit/publishedCourseState.test.ts`
- `tests/unit/publishedCourseNavigation.test.ts`
- `tests/unit/coursePackageExport.test.ts`
- `docs/development-plan/baselines/v1.1-preservation-map.json`

## Exact targets

| Legacy consumer | Fixed classification | Replacement / retained assertion |
|---|---|---|
| `tests/helpers/projectV8.ts` | delete after every import below is zero | 不建立 V9 同名万能 helper；使用 r11-050 fixed sources |
| `projectArchive.test.ts`, `asyncArchive.test.ts` 中 r11-051 未处理的剩余 case | r11-051 已迁走两条 `saveProject` / `saveProjectAsync` wrapper 断言；本任务迁移其余 generic zip/security/async assertions，再删除 V8 success suites | `courseProjectArchive.test.ts`；不得重新 import `saveProject.ts` |
| `componentContentIntegrity.test.ts` | migrate input, retain assertions | V9 archive + component bytes |
| `courseProjectArchive.test.ts`, `editorStore.test.ts`, `projectFormatIsolation.test.ts`, `validateProject.test.ts` | retain only fail-loud V8 rejection via minimal raw bytes | unsupported 与 corrupted 分类不变 |
| `courseProjectMigration.test.ts` | delete V8 success/migration cases；若含现行 rejection，迁到 format-isolation target | 产品不导入 V8 |
| `formulaNode.test.ts`, `textEmphasis.test.ts` | migrate supported round-trip assertions to V9 archive, delete V8 archive setup | 文字/公式语义不减 |
| `player-payload.test.ts` | delete Legacy payload success；保留最小旧 payload rejection | `publishedCourseProtocol.test.ts` / V2 success |
| `courseRuntimeKernel.test.ts`, `courseRuntimeKernelLifecycle.test.ts` | migrate supported state/navigation/lifecycle assertions, then delete old-kernel-only cases | `publishedCourseState.test.ts`, `publishedCourseNavigation.test.ts` |
| `export.test.ts`, `runtimeExport.test.ts` | split-migrate supported HTML/PPTX/PDF/dynamic assertions | `coursePackageExport.test.ts`, `coursePptxExport.test.ts`, `coursePrintArtifacts.test.ts` |
| `publishedLesson.test.ts` | migrate asset closure/Unicode/published behavior, delete Legacy PublishedLesson success | `buildPublishedCourseV2.test.ts`, `publishedCourseProtocol.test.ts` |
| `webPackageExport.test.ts` | migrate supported package assertions, delete Legacy payload cases | `coursePackageExport.test.ts` |
| `playerAppLayerOrder.test.ts`, `playerAuthoringHost.test.ts` | migrate still-supported plane/host/lifecycle assertions onto CoursePlayer / V2 session; delete `new PlayerApp` + `createProject` success | `publishedCourseProtocol.test.ts` / `publishedCourseNavigation.test.ts` / 现有 CoursePlayer tests；不得为迁测试复活 `PlayerApp.ts` |
| `playerCapture.test.ts` | keep fail-loud old-payload rejection via minimal raw bytes，不在 import/type/assertion 文案保留旧 identifier；migrate remaining capture timing/size assertions off legacy type stub | 现行 `buildPublishedCourseV2Payload` 路径；删除只证明旧 Player stub 的 success |
| `bundledFontExportEmbedding.test.ts`, `nodeExportHostFontWiring.test.ts`, `asyncWebPackage.test.ts` | migrate supported HTML/Web/font assertions onto `buildPublishedCourseStandaloneHtml` / `buildPublishedCourseWebPackageAsync`；delete `buildStandaloneHtml` / `buildWebPackageFromProject*` / `PublishedLessonPayload` success | `coursePackageExport.test.ts` |
| `playerSceneMotionLifecycle.test.ts`, `playerSceneComponentEventBuffer.test.ts`, `playerSceneAnimationMode.test.ts` | migrate still-supported motion/event-buffer/transition semantics to CoursePlayer/Published V2 host；delete Legacy `PlayerScene` success setup | `publishedCourseState.test.ts`, `publishedCourseNavigation.test.ts` 与现有 V2 runtime/host tests；若缺等价行为退回 Player owner |
| `componentEventMountBuffer.test.ts`, `formulaCrossSurface.test.tsx`, `nodeMotionDirector.test.ts`, `playerComponentV4Render.test.ts`, `playerSceneAssets.test.ts`, `renderVideoNode.test.ts`, `teacherControllerActions.test.ts` | 对 scanner/dependency closure 发现的旧 renderer success 按行为逐 case 迁移或删除 | 对应 Published V2 Native/Runtime/Component/teacher-controller 最近层测试；不得继续直接 import 旧 renderer |
| e2e 中旧 Player bridge 类型/调用 | supported behavior 迁到 Published V2/CoursePlayer fixture；旧 bridge-only setup 删除 | 现有 Published course e2e；不得为类型方便保留 Legacy module |
| 修正后的 r11-002 scanner 或直接 dependency closure 新发现的 test | 按同一三分类逐 case 处理，不因“表外”跳过 | 最近的 V9/V2 product owner + 同层 replacement test |

表中 classification 已固定。执行者只判断一个断言属于表中哪条 replacement，不得重新决定 V8 是受支持格式或删除仍受支持行为。

## Execution waves

每波同一变更内完成 migrate+delete 旧 success，跑该波 focused tests 后再开下一波。已删除的旧文件不得恢复，只复核其 replacement 与证据闭包。

| Wave | Files | Focused validation |
|---|---|---|
| A Residual Player/Runtime | 三个 `playerScene*`、`componentEventMountBuffer`、`formulaCrossSurface`、`nodeMotionDirector`、`playerComponentV4Render`、`playerSceneAssets`、`renderVideoNode`、`teacherControllerActions` 及 scanner/dependency closure 新发现的 Legacy Player/Runtime/e2e tests | `npx vitest run tests/unit/publishedCourseProtocol.test.ts tests/unit/publishedCourseState.test.ts tests/unit/publishedCourseNavigation.test.ts` + 对应现有 V2 Native/Runtime/Component/host test |
| B Archive/Export replacement audit | 复核已删除 Archive/Runtime/HTML tests 的受支持断言已在现存 replacement 中同层覆盖；只修真实缺口，不恢复旧测试 | `npx vitest run tests/unit/courseProjectArchive.test.ts tests/unit/coursePackageExport.test.ts tests/unit/coursePptxExport.test.ts tests/unit/coursePrintArtifacts.test.ts tests/unit/playerCapture.test.ts` |
| C Scanner closure | `tests/**` 中旧成功 import/type/constructor 为零；V8 只剩最小非法 bytes rejection；逐 case 交接表完整 | `npx vitest run tests/unit/legacyInventoryChecker.test.ts tests/unit/editor10ForbiddenTokens.test.ts tests/unit/readModelBoundary.test.ts` |
| D Behavior close | 所有 replacement 与产品行为在同一工作树通过 | `npm run test:product` |
| E Evidence close | 在同一变更更新受影响 PM 的 old path、classification、replacement command、input closure 与矩阵引用；不得留下 stale 引用 | `npm run check:development-roadmap` 与 `npm run check:preservation` |

若 V9/V2 路径无法保持同一受支持行为，**停止**并退回最近产品 owner；不要改产品来迎合旧测试，也不要只删断言。

## Write scope

只允许修改/删除 Exact targets 表中 legacy tests/helper，修改表中明确列出的 replacement tests，并读取 r11-050 fixture；允许在同一变更更新 `docs/development-plan/baselines/v1.1-preservation-map.json` 与 `docs/development-plan/roadmap/PRESERVATION_MATRIX.md` 中受本任务影响的 evidence command/input closure，不改变 PM 语义；`tests/unit/readModelBoundary.test.ts` 只允许删除已失效 legacy test consumer 的直接声明，不得改变结构边。`tests/unit/courseProjectIo.test.ts` 只允许清理当前 EOF 空行噪声，必须是机械、零语义 diff。禁止改其他 `tests/**`、产品代码、共享 inventory、fixture contract，禁止弱化/删除受支持行为断言、改变 timeout/retry 掩盖失败或把 V8 success test 更名后保留。

## Execution

1. 先核对 r11-051 handoff仍成立；随后按 **Execution waves A→B→C→D→E** 处理。把每个 case 标为 `supported-behavior-migrate`、`v8-success-delete` 或 `v8-rejection-retain`，不得新增第四类。在交接按 LEG ID 与 PM ID 列出旧 path#symbol、分类、replacement 与精确查询，不修改共享 inventory。
2. supported case 使用 V9 source/Published producer，保持原断言关注的行为，不直接手写第二份 Published payload。
3. V8 rejection 使用最小非法 archive/payload bytes，只断言 fail-loud，不调用 `createProjectV8Fields`。
4. 只有 replacement 测试在同一候选通过后，才删除只验证 V8 成功解析、迁移、Player 或导出的 case；不以覆盖率数字代替行为审查。
5. 不要改 `architectureDependencyRatchet.test.ts`（037/055）；`readModelBoundary.test.ts` 只允许删除已失效旧 test consumer 的直接声明，不得放宽结构边。新/留 tests 不得再 import 旧模块；若现有 ratchet 变红，停止交 Integrator，不要放宽正则。
6. 对每个删除/改名测试记录受影响的 PM evidence command 与 input closure，并在同一变更更新 preservation map/matrix；任何 map/route 引用仍指向已删路径，或 `check:preservation` / `check:development-roadmap` 未通过时，本节点不得向 r11-055 交接。

## Stop conditions

- 不能判断旧断言是否仍代表受支持行为。
- V9/V2 路径无法实现同一行为，表明前置产品 lane 未完成。
- 需要修改产品代码或降低断言强度才能迁移。

## Acceptance

- `tests/helpers/projectV8.ts` 及其 unit/integration imports 为零。
- unit/integration 不再 `new PlayerApp` / `buildStandaloneHtml` / `createProjectV8Fields`（fail-loud 字节例外）。
- `projectArchive.test.ts` / `asyncArchive.test.ts` 未重新 import `saveProject.ts`，r11-051 已迁移的 V9 wrapper 断言仍在 `courseProjectIo.test.ts` 通过。
- 所有保留的功能断言使用 V9/V2；V8 只有明确拒绝测试。
- Exact targets 每一行都有逐 case 处置记录；PM-02–PM-28 的受支持行为断言数量/层级不因删旧 tests 下降。
- 修正后的 scanner 与直接 dependency closure 不再发现 Legacy PlayerScene/CourseRuntimeKernel/PlayerApp/V8 type 成功测试；三个 `playerScene*` 残留均有明确迁移或删除记录。
- 所有受影响 PM 的 replacement command/input closure 已在同一变更写入 map/matrix；`check:preservation` 与 `check:development-roadmap` 均通过后，r11-055 才可开始。
- `tests/unit/courseProjectIo.test.ts` 的既有 EOF 噪声已机械清理，且无断言或运行语义变化。

## Focused validation

- Waves A–C：该波表格中的命令（不要每波跑 `test:product`）
- Wave D：`npm run test:product`
- Wave E：同任务更新 evidence 后运行 `npm run check:development-roadmap` 与 `npm run check:preservation`

## Rollback / handoff

按 test case 分类回滚；不得恢复已删除 V8 success 产品路径。交接列出无法迁移的 case、它保护的 PM ID 和前置缺口。
