# G3D Handoff · Flow 浮层 paperSpace 单测锁定

## 变更说明

在 `tests/unit/flowSharedAuthoringAdapters.test.tsx` 中补全并锁定了 `paperSpace: 'paper'` 相关断言：
1. **插入浮层 (`insertFlowSharedMedia`)**：断言图片浮层与视频浮层新建的内容层具有 `locateCourseLayer(doc, id)?.item.paperSpace === 'paper'`。
2. **文中媒体转为浮层 (`convertFlowMediaBlockToOverlay`)**：断言转为浮层后的图层具有 `locateCourseLayer(doc, overlayId)?.item.paperSpace === 'paper'`。
3. **文中组件转为浮层 (`convertFlowComponentBlockToOverlay`)**：断言转为浮层后的组件图层具有 `locateCourseLayer(doc, componentOverlay)?.item.paperSpace === 'paper'`。
4. **教师控制器 (`classifyFlowTeacherControllerRole`)**：断言全局控制器图层没有 `paperSpace: 'paper'`（保持 undefined / 视口）。
5. **未弱化任何既有拒绝测试用例**（段落不能转浮层、音频不能转浮层等）。
6. **未修改任何 `src/**` 文件**。

## 验证结果

- `npx vitest run tests/unit/flowSharedAuthoringAdapters.test.tsx`: 1 passed, 6 passed (6 tests total)
- `git diff --check`: 无 whitespace 错误或格式问题
