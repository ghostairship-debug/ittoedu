# g20-b18-b2-m23-preview-service main 预览服务、文件闭包与网络

- Status / Owner: queued / 主会话激活后指派 6Sol/xhigh
- Outcome / Evidence: 尚无 `src/main/workbench/htmlPreview/` 目录，无 `courseware-preview` 特权协议，主 CSP 的 `frame-src` 只有 `blob:`。目标：令牌绑定的独立预览响应、协议资源、每文档网络租约与完整失效路径（不含 UI 正式写入）。
- Write scope: `src/main/workbench/htmlPreview/HtmlPreviewService.ts`、`HtmlPreviewService` 同目录的 `htmlPreviewProtocol.ts`、`htmlPreviewResponse.ts`、`htmlPreviewResources.ts`（均新）、`tests/unit/g20M23PreviewProtocol.test.ts`（新）、`tests/integration/g20M23PreviewLifecycle.test.ts`（新）。禁止：`previewNetworkPolicy.ts` 语义、订第二个 `webRequest` listener、`protocols.ts`/`security.ts`/`index.html`（主会话接线）。详细边界见 `B18_执行卡.md` §3 B2。
- Write locks: main-preload
- Acceptance: `courseware-preview://app/<token>/file/<relative-path>` 响应 GET/HEAD；token 高熵且不含磁盘路径；`realpath` 闭合校验拒绝 NUL、反斜线、盘符、UNC、重复编码逃逸与符号链接越界；响应头带执行卡 §0 引用的独立 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`；release、关标签、文档关闭、Save As 换绑都撤销租约。node mock 通过不算 M23-T01，T01 是 security 层需真 Electron，由 B5 承担。
- Validation: `npm run typecheck`；`npx vitest run --config output/tmp/vitest.fsallow.config.mts tests/unit/g20M23PreviewProtocol.test.ts tests/integration/g20M23PreviewLifecycle.test.ts`。B0 已落地：扫描器与分页索引 `8710085d`，预览合同与路由 `40fc144a`，工具端口 `ab2f2286`。本卡实现 `HtmlPreviewHost`（`src/shared/workbench/htmlPreview.ts`）；`protocols.ts` 特权注册、`security.ts` 子框架窄分支与主 CSP 仍由主会话接线，到达即停在 open_issues。
