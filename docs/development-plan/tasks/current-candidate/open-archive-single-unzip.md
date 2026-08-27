# open-archive-single-unzip 大工程单次异步解压

- Status / Owner: queued /
- Risk / Hotspot: S2 / app-save-recovery
- Outcome / Why now: V9 打开链仍先用 `unzipSync` 完整探测、再异步完整解压；真实 App consumer 与 64 MiB 夹具约 563 ms 总时长/257 ms Renderer 阻塞的量化证据均未失效，需消除重复工作且保持打开结果不变。
- Write scope / Baseline: baseline `e4a3d07`；只允许修改 `src/renderer/project/courseProjectIo.ts`、`src/renderer/project/courseProjectArchive.ts` 及直接的 archive/open 性能测试或窄基准；禁止修改 V9 Schema、支持版本范围、保存格式或引入 worker/新持久状态。
- Acceptance: 一次异步完整解压同时完成格式识别与 V9 解析；合法工程文档/素材/组件字节保持一致，损坏、缺版本、非 V9 与 abort 仍诚实失败；同机同一 64 MiB 夹具多次采样的总时长与事件循环阻塞中位数相对评估基线下降，且 timer-before-resolution 提供确定性让出事件循环 oracle。
- Focused validation: archive/open 目标 Vitest（合法、损坏、unsupported、abort、timer yield）；同机 64 MiB 窄 benchmark 前后中位数；`npm run typecheck`。
- S2 safety / rollback: 只使用内存/临时 fixture，不读写用户工程；先保留现有错误分类与 AbortSignal 语义再消除同步探测，任何解析差异零落盘；可整体回滚到 `e4a3d07`。
