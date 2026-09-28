# g20-b18-b3-m23-pagination 分页、适配、占位的页面内逻辑

- Status / Owner: queued / 主会话激活后指派 6Sol/xhigh
- Outcome / Evidence: 尚无 `src/player/htmlPreview/`。目标：`body > section`（允许外包一层 `<main>`）分页；固定画布页整页适配、流式长页滚动、镜头编排页自跑；缺 `src` 的三类媒体显示带说明的占位。
- Write scope: `src/player/htmlPreview/htmlPreviewPagination.ts`、`htmlPreviewPlaceholders.ts`、`htmlPreviewGeometry.ts`（均新）、`tests/integration/g20M23HtmlPagination.test.ts`（新，真实 Chromium）。禁止：import renderer Store、写源文、创建/重载 iframe、改 `htmlDocumentRoots.ts`。详细边界见 `B18_执行卡.md` §3 B3。
- Write locks: published-flow
- Acceptance: 输出端口固定为 `mountPagination(document, sections, onState)` → `{navigate, readView, restore, destroy}` 与 `mountPlaceholders(root)` → `{refresh, destroy}`；嵌套 section 不成为页；注释与 script 字符串里的 `<section>` 不成为页；未分页 HTML 整页显示；翻页只隐藏、不删 DOM、不重跑 script、不卸载整份文档；方向键仅在无输入框/textarea/contenteditable/IME composing 且页面未消费时翻页；缺 `src` 按 alt（img）与 title（audio/video）生成占位，缺描述时用可读媒体类型名，尺寸遵循原布局。
- Validation: `npm run typecheck`；`npx vitest run --config output/tmp/vitest.fsallow.config.mts tests/integration/g20M23HtmlPagination.test.ts`。门槛：B0-b（共享扫描器落定，消费其 section spans）。
