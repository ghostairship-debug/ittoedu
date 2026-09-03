# r11-037z-root-selection-tests-and-removal 根选区测试迁移与字段删除

- Status / Owner: queued /
- Outcome / Evidence: 迁移测试对五个根镜像字段（`activeSceneId`、`activePresentationStateId`、`selectedNodeId`、`selectedNodeIds`、`editingScope`）的读取，然后删除五个根字段及 `kernel.readSelection/syncSelection` 镜像写入；不删除各 Surface 自有 selection。
- Write scope: 届时直接命中的测试、`src/renderer/store/editorStore.ts`、`src/renderer/store/editorStoreKernel.ts`、三个 Surface slice。
- Write locks: none
- Acceptance: 起始条件先核验——五个字段在 `src/renderer` 中除 root 声明/初始化/同步写和命名 selector 外零直接 consumer，否则停止并列出遗漏；四个 Workspace 连接器不再通过完整 project/root mirror 拼业务对象；已知结构测试可以在 055 被诚实修复，而不是靠白名单；目标测试通过；类型检查无错误。
- Validation: 把实际改动的测试文件合并为一条 `npx vitest run ...` 命令（不得运行全量）；产品 TypeScript 改动后运行 `npm run typecheck`。
