# G0C 交接说明

- 任务：G0C · 试运行宿主与导出包不再把稿纸指针吃掉
- 分支：`cursor/g0c-viewport-css-0ab9`

## 修改内容

1. `src/renderer/styles/globals.css`
   - `.flow-try-run-host` 增加 `pointer-events: auto;`，保持 `overflow: hidden`（720 孔径）。
   - `.workspace--flow .canvas-viewport` 增加 `pointer-events: auto;`，未更改为整页滚动或影响 Spatial 规则。
2. `src/renderer/export/course/buildCoursePackages.ts`
   - 在 `COURSE_PLAYER_CSS` 中增加：
     - `.flow-runtime-article{pointer-events:auto;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}`
     - `.flow-runtime-overlay{pointer-events:none}`
3. `tests/unit/flowTryRunCss.test.ts`
   - 新建单测验证 `.flow-try-run-host` 具备 `pointer-events: auto`、Spatial 保持 `touch-action: none`、以及导出播放器 CSS 包含 `.flow-runtime-article` 滚动与指针属性。

## 验证结果

- `npx vitest run tests/unit/flowTryRunCss.test.ts` 通过（2 tests passed）。
- `git diff --check` 无空白或格式问题。
