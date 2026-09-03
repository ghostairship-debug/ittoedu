# r11-052b-old-renderer-tests 旧渲染器测试迁移

- Status / Owner: blocked / Owner（待 V2 播放/目录/hybrid 补实现）
- Outcome / Evidence: 处理 `componentEventMountBuffer.test.ts`、`formulaCrossSurface.test.tsx`、`nodeMotionDirector.test.ts`、`playerComponentV4Render.test.ts`、`playerSceneAssets.test.ts` 五个文件已完成（整删 4 文件：componentEventMountBuffer、playerSceneAssets、nodeMotionDirector 16 例、formulaCrossSurface :198/:229；迁移 4 例：previewPageProp/editorState 与 capture waitUntil 顺序→`publishedComponentMount.test.ts`、公式确定性→`formulaNode.test.ts`、PPTX 公式静态化→`coursePptxExport.test.ts`；`playerComponentV4Render` 仅保留 hybrid 行）。剩余缺口待 Owner 已裁定的补实现卡落地后继续：`renderVideoNode.test.ts` 整文件 park（含 :312/:375/:396）、`teacherControllerActions.test.ts` 整文件 park、`playerComponentV4Render.test.ts` hybrid 行 park。
- Write scope: 上述七个旧测试文件、实际承接行为的 V2 测试（`publishedComponentMount.test.ts`、`formulaNode.test.ts`、`coursePptxExport.test.ts`）。
- Write locks: none
- Acceptance: 整删 `componentEventMountBuffer`、`playerSceneAssets`；`nodeMotionDirector` 16 例删重复（V2/编辑器侧已有等价覆盖，capture 失败 sticky 语义由 `runtimeHostV2.test.ts:769-806` 覆盖）；`playerComponentV4Render` 删重复并仅保留 hybrid 行（Owner 裁定产品缺口）；`formulaCrossSurface` :155→`formulaNode.test.ts`、:275→`coursePptxExport.test.ts`，:198/:229 删；`renderVideoNode.test.ts`（:312/:375/:396 播放动作路由/`video:started`/音乐闪避）与 `teacherControllerActions.test.ts`（scene.open-picker）按 Owner 裁定为产品缺口，整文件 park 待补实现，不在本卡删除；目标测试通过。
- Validation: 一条命令运行被改文件及实际新增用例所在的 V2 测试（不得运行全量）；不运行 `check:preservation`。
