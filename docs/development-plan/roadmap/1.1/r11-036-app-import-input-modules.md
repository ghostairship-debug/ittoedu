# r11-036-app-import-input-modules｜App 素材/组件导入与全局输入路由解耦

- Release / Dependencies: 1.1 / r11-014-media-design-component-consumers, r11-025-editor-store-v9-only
- Write locks: `editor-store-history`, `workspace-properties`
- Inventory access: `read`
- Preservation: PM-01, PM-03–PM-15, PM-17

## 2026-09-03 执行版（基于 HEAD bb1f848）

通用规则、术语与交接模板见 [执行者指南](EXECUTION_GUIDE.md)。原规格的模块迁移步骤已经完成，不再执行；下面只保留剩余缺陷。

## Outcome / current evidence

已完成：`src/renderer/app/useMediaImport.ts`（562 行）、`src/renderer/app/useComponentLibrary.ts`（488 行）、`src/renderer/app/useEditorKeyboardRouter.ts`（109 行）已从 `App.tsx` 分出并接线。`useComponentLibrary` 在文件读取与校验之后、提交之前都有 `assertFreshIdentity`（:213、:266、:385），本节点只核对不修改。

剩余缺陷全部在 `useMediaImport.ts`：

1. **解码之后没有再核对。** 三条导入路径都在文件对话框返回后核对了 identity（图片 :344、声音 :430、视频 :482），随后 `await prepareSelection(...)` 解码（:345、:431、:483），解码结束直接提交：`tryInjectCandidateMedia` → `commitCandidateMedia`（:374、:441、:512）、`commitMediaBatchImport` → `placeImageNodes`/`placeVideoNodes`（:391、:529）、`importSounds`（:455）。这些提交函数不携带目标修订，解码期间的文档变化会被写进新文档。`replace` 路径在 `readImageDimensions`（:316）之后也没有再核对，只是 `replaceImageAtTarget` 的 target 自带修订号才没有写错。
2. **identity 缺少位置维度。** `MediaImportIdentity`（:32–35）只有 `projectId` 与 `revision`；`App.tsx:68–72` 的 `captureCourseIdentity` 也只返回这两项。用户在导入进行中切换到另一页时修订号不变，`add` 模式会把素材放到新页面。

## Read first

- `src/renderer/app/useMediaImport.ts`（全文）
- `src/renderer/App.tsx:60–75`（`captureCourseIdentity`）与 `:285–300`（`useMediaImport` 的 ports 实现）
- `src/renderer/store/editorStore.ts:2123–2128`（`selectActiveCourseLocationId`）
- `src/renderer/app/useComponentLibrary.ts:110–140`（只读，作为已闭合的对照）

## Exact targets

| 位置 | 改动 |
|---|---|
| `useMediaImport.ts:32–35` `MediaImportIdentity` | 新增 `readonly locationId: string | null` |
| `:168–174` `sameIdentity` | 同时比较 `projectId`、`revision`、`locationId` |
| `selectAndImportImage` `replace` 分支 | 在 `readImageDimensions`（:316）之后、`replaceImageAtTarget`（:318）之前插入 `assertFreshIdentity(started, portsRef.current.captureIdentity(), '无法替换图片')` |
| `selectAndImportImage` 批量分支 | 在 `prepareSelection`（:345–354）之后立刻插入 `assertFreshIdentity(started, portsRef.current.captureIdentity(), '图片批量入库已取消')`，位于 `importIntoCapturedLibrary`（:362）、`tryInjectCandidateMedia`（:374）与 `commitMediaBatchImport`（:391）之前 |
| `selectAndImportAudio` | 在 `prepareSelection`（:431–440）之后立刻插入 `assertFreshIdentity(started, portsRef.current.captureIdentity(), '声音批量入库已取消')` |
| `selectAndImportVideo` | 在 `prepareSelection`（:483–492）之后立刻插入 `assertFreshIdentity(started, portsRef.current.captureIdentity(), '视频批量入库已取消')` |
| `src/renderer/App.tsx:68–72` `captureCourseIdentity` | 返回值增加 `locationId: selectActiveCourseLocationId(state)`；该函数同时被 `useComponentLibrary` 的 ports 使用，多出的字段与 `ComponentLibraryIdentity` 兼容，不改组件库 |

允许新建：执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准）（红→绿测试）。不允许新建其他文件、类型、函数。

## Write scope

只允许修改 `src/renderer/app/useMediaImport.ts`、`src/renderer/App.tsx`（仅 `captureCourseIdentity` 与其 import），新建 执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准）。禁止修改 Store、`assetManager.ts`、`mediaBatch.ts`、`v9AssetAdapter.ts`、`useComponentLibrary.ts`、`useEditorKeyboardRouter.ts`、共享 inventory。

## Execution

1. 先写红测试 执行卡指定的 hook 级测试文件（放在 `tests/unit/` 下，文件名以执行卡为准），用 `renderHook` 与全部为 `vi.fn` 的假 ports；`vi.mock('../../src/renderer/project/assetManager', ...)` 用 `importOriginal` 保留其余导出，只把 `readImageDimensions` 替换为返回一个手动 deferred 的函数。共用 arrange：`identity` 为可变对象，初值 `{ projectId: 'p1', revision: 1, locationId: 'L1' }`，`captureIdentity` 返回它的拷贝；`captureLibraryTarget` 返回 `{ projectId: 'p1', documentRevision: 1 }`；`readMediaLibrarySnapshot` 返回 `{ assets: {}, files: {} }`；`readCandidateMediaContext` 返回 `{ assets: {}, sidecar: emptyCourseAssetSidecar() }`；`selectImages` 返回 `{ accepted: [{ name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]), sha256: 'h1' }], rejected: [] }`；`runBusy` 为 `async (op) => { try { return await op() } catch (error) { errors.push(error); return undefined } }`；`commitCandidateMedia`、`placeImageNodes`、`importAssetsAtTarget` 为 `vi.fn`。
   - `describe('useMediaImport stale results')`
   - `it('does not commit an image batch when the document changes during decoding')`。act：调用 `selectAndImportImage('add', { x: 10, y: 10 })` 不 await；等待 `readImageDimensions` 被调用；把 `identity.revision` 改为 2；resolve deferred 为 `{ width: 10, height: 10 }`；await 调用结果。assert：`commitCandidateMedia`、`placeImageNodes`、`importAssetsAtTarget` 调用次数均为 0；`errors[0]` 的 message 或 title 含 `工程已发生变化`。
   - `it('does not commit when the active location changes during decoding')`。同上，但只把 `identity.locationId` 改为 `'L2'`，其余不变；assert 相同。
   运行 `npx vitest run <执行卡指定的测试文件>`，两条必须失败，失败点均是 `commitCandidateMedia` 被调用 1 次。粘贴输出。
2. 按 Exact targets 修改 `useMediaImport.ts` 与 `App.tsx`。
3. 再运行第 1 步命令，两条通过；粘贴。
4. `npm run typecheck`。
5. 运行 Focused validation 第一条。
6. 结构事实：`grep -c "assertFreshIdentity(" src/renderer/app/useMediaImport.ts` 为 8（1 处定义 + 7 处调用）；`grep -cE "left\.locationId === right\.locationId" src/renderer/app/useMediaImport.ts` 为 1；`grep -c "locationId: selectActiveCourseLocationId" src/renderer/App.tsx` 为 1；`grep -cE "useEditorStore|from '\.\./store/" src/renderer/app/useMediaImport.ts` 为 0；`grep -c "assertFreshIdentity(" src/renderer/app/useComponentLibrary.ts` 仍为 4（只读核对，值变化即停止）。

## Stop conditions

- 第 1 步的两条测试有任一在修改前就通过。
- 修复需要改 Store 动作签名、`assetManager.ts`、`mediaBatch.ts` 或组件库 hook。
- 现有 `assetTransactions.test.ts`、`courseMediaLibraryImportVerticalSlice.test.ts`、`imageReplacementVerticalSlice.test.ts` 任一变红。

## Acceptance

- 两条新测试有完整的红→绿证据。
- 三条导入路径与替换路径在每个 `await` 之后、每次提交之前都核对包含位置的 identity；不一致时零写入并报可操作错误。
- PM-13 的 focused 测试通过；组件库与键盘路由文件无改动（`git show --stat` 证明）。

## Focused validation

- `npx vitest run tests/unit/assetTransactions.test.ts tests/unit/editorActionRouting.test.ts tests/integration/mixedCrossSurfaceHistory.test.tsx tests/unit/readModelBoundary.test.ts tests/integration/courseMediaLibraryImportVerticalSlice.test.ts tests/integration/imageReplacementVerticalSlice.test.ts tests/unit/useMediaImport.test.tsx`
- `npm run typecheck`

2026-09-03：本节点已按上述执行版完成并提交（`tests/unit/useMediaImport.test.tsx` 两条红→绿，失败点均为 `commitCandidateMedia` 被调用 1 次），测试文件已追加到第一条命令。结构事实的两处基数修正：`useMediaImport.ts` 的 `assertFreshIdentity(` 为 9（1 处定义 + 8 处调用；执行版少算了 `replace` 分支原有的一处），`useComponentLibrary.ts` 的计数在 `bb1f848` 与本节点提交后都是 2（定义 + :213 一处调用，:266/:385 不经该函数），该文件与 `useEditorKeyboardRouter.ts` 均无改动。

## Rollback / handoff

单一提交，整体回滚。交接按指南第 6 节格式。
