# r11-052c-old-token-and-rejection-tests 旧 token 与拒绝夹具迁移

- Status / Owner: queued /
- Outcome / Evidence: 处理现存 `ProjectDocument`、`SceneDocument`、`SceneNode`、`ExportPayload` 与 `schemaVersion: 8` 测试命中；成功路径迁移或删除重复；拒绝路径只保留构造拒绝所需的最小对象/字节，不 import 旧 Schema 类型。
- Write scope: 词边界扫描命中的旧测试文件（删重复 4 文件：componentPackageLifecycle、informationRelease、projectDiagnostics、presentation 的测试；迁移 2 文件：interactionEditor.test.tsx→InteractionSceneView/InteractionLayerTarget，slidePreviewRebuildKey.test.ts→SlidePreviewIdentityNode/裸字面量；其余保留不动）。
- Write locks: none
- Acceptance: 删重复 4 文件的 V9 覆盖均已存在；迁移 2 文件到命名 Owner 视图/标识；保留不动 21 个（15 个拒绝路径已合规、6 个守卫/标题、legacyInventoryChecker 字符串夹具）；Owner 裁定（2026-09-03）：`src/shared/presentation.ts`、`informationRelease.ts`、`projectDiagnostics.ts`、`componentPackageLifecycle.ts` 四个孤儿模块补入 LEG 删除清单由 053/054 删除，本卡只删测试、不动产品模块；目标测试通过。
- Validation: 只运行实际修改的测试文件（一条 `npx vitest run ...` 命令，不得运行全量）；禁止改产品代码、Legacy scanner/inventory、排除项；不运行 `check:preservation`。
