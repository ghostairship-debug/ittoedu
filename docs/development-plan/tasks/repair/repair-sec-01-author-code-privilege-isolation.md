# repair-sec-01-author-code-privilege-isolation 隔离作者代码与桌面权限

- Status / Owner: queued /
- Risk / Hotspot: S2 / workspace-properties
- Outcome / Why now: Published try-run 当前在主 renderer 执行 Runtime/Component `new Function`，同一 window 暴露 `desktopAPI`；改为复用现有 sandbox Player、bootstrap 与 authoring bridge，保留真实播放和未来声明式联网能力。
- Write scope / Baseline: baseline `b967c96`; `src/renderer/ui/Workspace.tsx`、`src/renderer/ui/coursePlayerTryRun.ts`、`src/renderer/preview/**`、必要的 Player bridge 文件及直接 unit/integration/E2E；禁止写 `src/main/**`、`src/preload/**`、Published producer 和 contracts/Schema，除非停止任务并重标热点。
- Acceptance: try-run 中 Runtime 与 Component 均实际执行且 `typeof window.desktopAPI === 'undefined'`；当前位置导航、组件互动、资源解析和退出/重建正常；编辑态 Runtime/Component authoring 不回退；不得把 HTTP(S)/WS(S) 永久写死为禁止。
- Focused validation: `npx vitest run tests/unit/runtimePreviewDocument.test.ts tests/unit/playerAuthoringProtocol.test.ts tests/unit/coursePlayerTryRunFit.test.ts`; `npx playwright test tests/e2e/authorCodeIsolation.spec.ts tests/e2e/editor.spec.ts --grep "当前位置试运行"`。
- S2 safety / rollback: 回滚起点 `b967c96`；使用 fixture 作者代码探测权限，不访问真实文件或 IPC；若隔离宿主无法覆盖当前 Player 行为，保留已有编辑态 iframe，回退本卡而不在主 renderer 加兼容执行分支。
