# r11-052g-v2-scene-picker V2 教师控制器整课场景目录

- Status / Owner: queued /
- Outcome / Evidence: Native 合同、默认控制器和用户文档均承诺 `scene.open-picker`，但 `PublishedInteractionCourseSession.executeTeacherControllerAction` 当前对此返回 undefined；三个 Surface 的控制器因此点击无效。052f 完成后在非作者、非 capture 的 Published 整课会话挂载唯一 `ScenePickerOverlay`，不在各 Surface 复制实现。
- Write scope: `src/player/ScenePickerOverlay.ts`；`src/player/surfaces/publishedDynamicHosts.ts`；`tests/unit/scenePickerOverlay.test.ts`；`tests/unit/publishedCourseNavigation.test.ts`。原则上不修改 Slide/Flow/Spatial host；若中央 `executeTeacherControllerAction` 现有类型无法承载则停止并列出阻断，不扩范围。
- Write locks: published-producer
- Acceptance: 目录按 `MixedCourseNavigator.listCatalog()` 的 location 顺序/label 构建，打开时以当前 location 标亮；任一 Surface 的教师控制器都打开同一 overlay。选择复用教师控制器强制导航边界，可越过导航守卫并进入目标 location 自带初始 state，但不修改 Published payload、Course Project 或历史；任意导航、Esc、遮罩点击和 session destroy 都关闭目录并释放 DOM/焦点/监听。authoring/capture 不创建目录。完成时删除本卡，只把 `r11-052h-v2-component-hybrid` 改为 queued 并重新生成任务板。
- Validation: `npx vitest run tests/unit/scenePickerOverlay.test.ts tests/unit/publishedCourseNavigation.test.ts`；`npm run typecheck`。
