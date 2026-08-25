# repair-net-h1-v9-preview-network 真实 V9 预览按工程声明联网

- Status / Owner: active / codex/repair-net-h1
- Risk / Hotspot: S2 / main-preload, app-save-recovery
- Outcome / Why now: 有 active V9 工程时，“当前位置试运行”和“整课预览”都在主 renderer 通过 `mountPublishedCourseTryRun` 运行；当前主 session 只放行开发服务器 origin，预览 payload 也总把工程素材投影为 Data URL，导致已声明的远程素材和 `network.connectOrigins` 在真实预览路径仍被拦截。
- Write scope / Baseline: baseline `ddab68b2173af79ba6d72922786303bc6f8c3bf0`；仅允许写 `src/shared/ipcTypes.ts`、`src/preload/index.ts`、`src/preload/desktop-api.d.ts`、`src/main/ipc.ts`、`src/main/security.ts`、`src/main/createWindow.ts`、至多一个新建的 main 预览网络策略模块、`src/renderer/App.tsx`、`src/renderer/ui/coursePlayerTryRun.ts`，以及这些行为的窄幅 unit/integration/Electron E2E；禁止修改 V9/Published Schema、Published producer/导出 CSP、远程脚本策略、独立 preview window 的无 source fallback 语义、Store/History、其他两卡文件及 Integrator 独占的计划/能力/generated 输出。
- Acceptance: active V9 的当前位置与整课预览只把实际 Published 引用且带 `remote.url` 的工程素材投影为原 HTTPS URL，并把这些素材的精确 origin 与 `project.network.connectOrigins` 通过受信任 IPC 应用于主 session；只接受合同允许的精确 `https`/`wss` origin，无 wildcard/userinfo/远程 script/secret；本地或无 remote 的工程素材和组件素材仍走内存 URL；声明 origin 可加载、未声明 origin 被主 session 拒绝，CORS/TLS 不被绕过；工程 A→B、关闭工程或卸载预览后 A 的动态 origin 失效，开发服务器基础 origin 不丢；当前位置与整课预览共享同一策略，不能只修独立 preview partition；至少一个真实 Electron 网络测试证明允许、拒绝与撤销。
- Focused validation: `npx vitest run <新增网络策略/IPC测试> tests/unit/coursePlayerTryRunFit.test.ts`; `npm run typecheck`; `npm run build:player && npm run build:renderer && npm run build:electron && npx playwright test <新增真实V9预览网络Electron spec>`。
- S2 safety / rollback: 只使用临时 V9 fixture 与本机 mock HTTPS/WSS 服务，不访问真实远端、不写用户工程；IPC sender、origin 与工程切换均 fail closed，策略更新失败不得扩大放行集合；回滚起点为 baseline，若 Electron session API 无法可靠撤销旧 origin，停止并报告而不是永久累加权限。
