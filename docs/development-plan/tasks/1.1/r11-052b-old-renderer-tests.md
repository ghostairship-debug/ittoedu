# r11-052b-old-renderer-tests 旧渲染器测试迁移

- Status / Owner: queued /
- Outcome / Evidence: 处理 `componentEventMountBuffer.test.ts`、`formulaCrossSurface.test.tsx`、`nodeMotionDirector.test.ts`、`playerComponentV4Render.test.ts`、`renderVideoNode.test.ts`、`teacherControllerActions.test.ts`、`playerSceneAssets.test.ts` 七个文件；保留的用户行为迁到 Published V2 host 测试；不得通过删除公式、视频、组件、动画或教师控制器能力来清零。
- Write scope: 上述七个旧测试文件、实际承接行为的 V2 测试（`publishedComponentMount.test.ts`、`formulaNode.test.ts` 或 published 侧、`coursePptxExport.test.ts`）。
- Write locks: none
- Acceptance: 整删 `componentEventMountBuffer`、`playerSceneAssets`；`nodeMotionDirector` 16 例全有 V2/编辑器侧覆盖故删重复；`playerComponentV4Render` 约 12 例删重复，previewPageProp/editorState 与 capture waitUntil 顺序迁入 `publishedComponentMount.test.ts`；`formulaCrossSurface` :155 迁公式渲染器确定性用例、:275 迁 PPTX 公式静态化用例到 `coursePptxExport.test.ts`，:198/:229 删；以下三项动工前须有 Owner 裁定（见 INTEGRATOR_HANDOFF 检查点“待 Owner 裁定事项”第 1–3 条）：`renderVideoNode.test.ts:312/:375/:396`（播放动作路由/`video:started`/音乐闪避无 V2 宿主）、`teacherControllerActions.test.ts` 唯一用例（scene.open-picker 无 V2 宿主处理）、hybrid renderMode（V2 无宿主/测试，`publishedComponentMount.ts:580` 硬编码 dom）；目标测试通过。
- Validation: 一条命令运行被改文件及实际新增用例所在的 V2 测试（不得运行全量）；不运行 `check:preservation`。
