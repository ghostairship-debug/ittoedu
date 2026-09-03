# r11-037b-asset-mirror-and-root-forwards 删除根级 assetFiles 镜像与 root re-exports

- Status / Owner: queued /
- Outcome / Evidence: 根级 `assetFiles` 镜像是冗余字段，素材真实来源是 sidecar；删除根级 `assetFiles` 镜像、无用局部函数和 root re-export，不碰历史事务中的 `HistoryResourceState.assetFiles`。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/store/editorStoreKernel.ts`、`src/renderer/store/courseResourceState.ts`、`src/renderer/store/slices/slideAuthoringSlice.ts`、`src/renderer/store/slices/flowAuthoringSlice.ts`、`src/renderer/store/slices/spatialAuthoringSlice.ts`，以及直接 import root re-export 的编译错误 consumer
- Write locks: editor-store-history
- Acceptance: `CourseResourceState` 只保存 sidecar/component packages；`selectMediaAssetFiles` 从活动会话 sidecar 派生，无会话返回既有空常量；删除 `activeCourseDocument`、无用教师控制器 import 和 root `export {...} from`，consumer 直接指向 Owner。
- Validation: `npx vitest run tests/unit/assetTransactions.test.ts tests/unit/crossSurfaceResourceHistory.test.ts`；`npm run typecheck`。
