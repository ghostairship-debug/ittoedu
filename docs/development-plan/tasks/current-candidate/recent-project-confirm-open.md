# recent-project-confirm-open 最近工程只记录成功打开

- Status / Owner: queued /
- Risk / Hotspot: S2 / app-save-recovery, main-preload
- Outcome / Why now: 主进程目前只验 ZIP 头便把所选路径写入最近工程，Renderer 随后才做完整 V9/素材校验；合法 ZIP 形状但无效的工程会持久污染最近列表，已有真实 consumer 与可复现用户可见错误。
- Write scope / Baseline: baseline `e4a3d07`；允许修改 `src/main/fileDialogs.ts`、`src/main/projectPersistence.ts`、相关 main IPC 注册、`src/preload/index.ts`、`src/shared/ipcTypes.ts`、`src/renderer/App.tsx` 及直接测试；禁止在 main 复制 V9 Schema、改变文件授权边界、保存语义或最近工程文件格式。
- Acceptance: 新选择路径只获得本次读取/后续保存所需的内存授权；仅在 Renderer 成功应用完整 V9 工程后确认记录/提升最近工程；schema-invalid、missing-asset、unsupported 与失败 recent reopen 均不新增/提升；合法打开与成功保存仍恰好记录一次，错误反馈不退化。
- Focused validation: main file-dialog/project-persistence 目标 Vitest；Renderer 打开时序目标测试；`npm run typecheck`。
- S2 safety / rollback: 使用临时 recent-projects fixture 与无效 archive 副本，不触碰真实最近记录；IPC ACK 必须窄且幂等，失败不落盘，路径授权与记录持久化分离；可整体回滚到 `e4a3d07`。
