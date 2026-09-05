# r12-030-line-authoring｜Line 支持直接绘制、端点、折点、吸附与细线命中

- Release / Dependencies: 1.2 / none
- Write locks: `contracts-schema`, `store-slide`, `props-slide`, `workspace-shell`, `authoring-slide`, `published-slide`, `export-pptx`, `diagnostics`
- Inventory access: none

## Outcome / current evidence

既有 Native shape 只有 frame/style，`line` 与 `elbow-arrow` 的点位由 renderer 固定比例生成，无法保存端点或折点。按 [共享实施合同](IMPLEMENTATION_CONTRACT.md) §6 先落 `lineGeometry?` additive contract，再交付一个 command/gesture/view 纵切。

## Read first

- `src/shared/contracts/native-v1/types.ts`
- `src/shared/contracts/native-v1/schema.ts`
- `src/shared/canvasShapeRenderer.ts`
- `src/renderer/course/v9SlideContentCommands.ts`
- `src/renderer/course/effectiveLayerCommands.ts`
- `src/renderer/ui/properties/SlideNativePropertiesPanel.tsx`
- `src/renderer/ui/Workspace.tsx`
- `src/player/surfaces/slide/publishedNativeRendering.ts`
- `src/renderer/export/course/buildCoursePptx.ts`
- `tests/unit/v9SlideContentCommands.test.ts`
- `tests/unit/stageViewportTransform.test.ts`
- `tests/unit/coursePptxExport.test.ts`

## Write scope

允许修改 shape contract/fixture、共享 line point resolver/renderer、Slide draw tool/command/properties、Published Slide、PPTX/preflight/health 与现有目标测试。第一提交只含 additive contract 和旧默认 fixture；不得新建 Native discriminator、通用 path editor 或改变其他 shape 几何。

## Execution

1. 先独立提交 `lineGeometry?` strict contract、shape/kind matching refine、旧缺省 fixture 与兼容政策；旧对象读取不物化字段，其他 shape 携带字段定位拒绝。
2. 实现唯一 point resolver：straight 两点，elbow 由 start/end/axis/position 生成四点；canvas、DOM/SVG、hit test、PPTX fallback 全部调用它。
3. 实现 direct-line/direct-elbow 工具状态。pointermove 只预览，pointerup 调一个 command 同时写 frame+geometry；Esc 取消，失焦/切 Surface 清理 preview 且零历史。
4. 实现 start/end/elbow handle；使用现有 viewport 与 rotation transform，重算至少 16×16 bbox 并归一化点。Alt 禁用、8 screen-px edge/center snapping 按合同执行。
5. hit stroke 使用 `max(12/viewportScale,borderWidth)`，视觉 stroke 不变；locked/hidden 目标不出现 handle，1 px 线可独立选择。
6. 保存重开、Undo/Redo、Published/HTML 使用同一几何。PPTX straight 为原生 line；elbow 用同一 points 生成 SVG 并输出 `pptx-static-elbow` warning。

## Stop conditions

- 需要任意点数组、贝塞尔/path 判别器或改变其他 Shape 字段语义。
- pointermove 必须连续写历史，或旋转坐标无法由现有 transform 唯一解析。
- elbow 导出只能静默变形/消失，或缺省旧 line 视觉不能保持。

## Acceptance

- 可见 Slide 工具直接绘制 straight/elbow，拖 start/end/elbow、吸附与 Alt 禁用均确定。
- 一手势一事务；Undo/Redo、保存重开、Player、HTML 几何一致；旧 shape fixture 视觉不变。
- 1 px 视觉线可选中；PPTX straight 原生、elbow 静态后备有精确 warning。

## Focused validation

- `npm run test:product -- tests/unit/v9SlideContentCommands.test.ts tests/unit/stageViewportTransform.test.ts tests/unit/slidePublishedCaptureStacking.test.ts`
- `npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/coursePptxExport.test.ts tests/unit/courseProjectHealth.test.ts`
- `npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts`

## Rollback / handoff

合同提交可单独回滚且恢复旧固定几何；delivery 必须按 resolver→command/gesture→Published/export 整体回滚，不保留第二点位算法。交接 `r12-050-native-closure` 时附旧缺省、straight、两种 elbow axis、旋转和 1 px fixture。
