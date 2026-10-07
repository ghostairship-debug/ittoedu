# R2 独立审查：跨进程与生命周期

审查者：R-A2，未参与本候选产品或测试实现。2026-10-07。

结论：S01/H/S04 的已完成叶子可继续汇合；当前不能把 R2 整包记为通过。A08 尚未完成内置 caller 与 pending 状态接线；文档级停止有一个取消关闭后重新取得可写句柄的具体漏例。S03、上传 file owner、外部 GUI 控制和安装分发仍是未完成汇合/条件验证，不能由近层绿色外推。发行与产品 accepted 继续暂停。

## 固定范围与依据

- 基线 `afc65c9e`；实际集成 diff 先核至 `bd87467e`，补核至 `13f27033346ab214d7b38976c440bf3768031fc3`。写本报告前再次确认该 cut，未使用滚动未提交源码作通过依据。
- 叶子：S01 `203f7643`；H `926e5aa2`、`cd28cbcd`、`b78570ce`（后二者集成对应 `ec06689c`、`900c19b0`）；G `56de0ba6`、`bb708c06`；A08 `a8cb2100`；S04 `98fd71b7`、`d35cc382`，另核 `d4a7f74f` 的上传说明。
- 已读主目录开发入口、当前状态、任务板、工作协议 §1.1/§3.1/§4、架构合同 §0/§3/§7、执行包 S01–S04/A08、VALIDATION_REVIEW R2/T04/T05，并核直接 producer/consumer、原失败和独立测试源码。
- 原 A08 事实来自主目录 `docs/archive/local/evidence/20261007-product-audit/records/audit-claims.json` 的 ASTRA-F06/MCP-03：非业务事件 pending 是已证明等待依赖，生产磁盘永久挂起/延迟幅度未证明；正式 Journal ACK 是另一边界。该限定在本审查中保留。

## 具体发现

### R2-F1：A08 内置执行仍被非业务记录阻塞；pending/drain 尚无可见 consumer

当前直接链：`ExecutionEngine.ts:471` 的 checkpoint 先 await `DisplayEventBuffer.flush()`；`:484` 的 event 先 flush，再 await `events.append()`。`:1539`/`:2335` 在实际 gateway 调用之前等待 tool running 事件；`:1867` 等回执 checkpoint、`:888` 的 Stop 同样经过等待。`DisplayEventBuffer.ts` 的 flush 等待 append tail，首个 display 也主动 flush。因此 A08 新 queue 并未覆盖已明确要求的内置 caller。慢或未 settle 的显示记录仍能延迟工具开始、业务结果后续处理和停止完成；不由此声称已测到生产性能退化。

`ExecutionDesktopService.ts:202` 已将外部 appendEvent 接到 `events.enqueue()`，这一改善有效；但 `ExternalMcpService.ts:519` 仍在工具前 await conversation 的首次读/写。因此不得把外部 timeline 落盘解耦扩大为所有辅助记录都已脱离关键路径。

`ExecutionEventStore.ts:105` 已提供 getPendingState，但当前 src 没有调用者；`:111` flushPending 只等待 pending。Desktop shutdown `:185` 和 Main `index.ts:100-101` await flush，正常窗口已完成关闭后才进入 Main shutdown。现实现没有用户可见的 pending/drain/失败状态，不能称 A08 的 stop/quit 可见性目标已完成。

维度：条件性性能/可用性和本包未完成，非当前普遍 P0/P1。建议按 A08 当前范围完成 caller 接线与最薄状态呈现，保留 Session/Journal 的真实 durable ACK；不要增加 TTL、通用记录平台或任意超时丢弃。最低证据：一条受控 pending 非业务 append 的内置真实工具链，证明工具/正式回执不被它卡住；同一反例检查 Stop 状态与记录顺序。未修改或执行新测试。

### R2-F2：取消关闭后，旧 run 可重新取得 writable:true 句柄，但永远不能提交该文档

这是源代码已定位的确定分支，尚未运行新反例：

1. `documentCloseFlow.ts:19-26` 在询问 dirty 保存/取消之前调用 stopWritableTasks；教师同意停止，但随后取消保存/关闭，文档继续保留原 DocumentSession。
2. H 的 `ExternalMcpService.stopForDocument` 调到新 `DocumentToolGateway.stopRunDocument`（`:566-582`）。后者移除该文档 grant/handles，并 await 该 Session.stopRun(runId)，其他文档留在同一 MCP run。
3. 再次 file.open 同路径，Registry.open 返回仍打开的同一个 Session；`attachRunDocument`（`:327-353`）重新添加可写 grant，返回 writable:true，file owner 发新 target。
4. `DocumentSession.ts:177` 永久检查该 runId 在 stoppedRuns 中；`:284-293` 停止已持久化，重新 attach 没有对应解除。因此后续真实修改仍返回 cancelled/run-stopped。

成功关闭后重新打开文件会得到新 documentId，不是本 finding。用户同意停止旧任务本身有效，问题是后续入口重新宣称可写、让客户端反复拿不能写的句柄；不能以移除 Stop 屏障修复。应由现有 owner 明确旧授权已停止，或完成受授权的文档级新任务接续，同时保住 B 的正常目标。

维度：特定取消分支的用户可见恢复失败，建议 P2。最低证据：在 T04 现双文档 fixture 中，A 停止后保留 Session（等价于取消关闭），重新 file.open 并尝试一个实际修改；核得到诚实可恢复结果，同时 B 仍可写。现 T04 只读 B 且成功关 A，没有覆盖该分支。该反例与旧绿不同，不要求重跑未变矩阵。

## 可继续推进的已审叶子

| 范围 | 实际 producer → consumer 与保留行为 | 当前结论 |
|---|---|---|
| S01 SDK detach | SDK terminateSession DELETE → ResidentMcpServer.dropSession/handler.terminate → ExternalMcpService.stopRun；client.close 在 finally，重复 detach 共享 Promise；不调用宿主 stop | 叶子可推进。T04 真实 loopback 已覆盖两个 client、DELETE 后 owner 仍监听 |
| S01 bootstrap | packaged `--mcp-connect` → runProductMcpBootstrap → detached product `--headless-mcp` → Main ready 文件 → shared parser；ready 带真实 profile/workspace/permission/ownership/mismatch，exit 0 本身不算 ready；工程 launcher 仍保 owned stop | 实现方向与 owner 一致。安装 helper 分发未接、实际安装载体未测，不能称安装版自发现完成 |
| H 长效生命周期 | Main headless 与 GUI 共用同一个 context/DocumentHost；second-instance promote 只安装 IPC/窗口；headless 标志变更由同 context 被闭包读取；active pending 才算 busy；closeSessions generation 防晚到 initialize 建活 run | 已读实际链，未发现需要退回旧第二宿主的理由。真实同 PID/Registry/dirty 工程 GUI 接续仍未测 |
| H 请求 scope | callTool 入场冻结 run/task/workspace；catalog/resolveRunTool 后 assertActive；execute 显式旧 run；HTML children 使用该调用 map；旧操作回放只匹配相同 run | 修复跨 workspace 异步误投方向正确，保 scope/停止/最终 writer 边界。未用 trace 作为业务提交证明 |
| H 单文档停止 | 新 stopRunDocument 删除 A 的 grant/handles，保 B；Session.stopRun 阻晚到 canonical commit | 成功关闭分支可推进；R2-F2 取消分支待处理 |
| G 正常退出 | Desktop.closing 阻新 submission/startNext；Engine.closing 在入口与准备结束再检查；active run 用原 stop；队列、bindings、received MCP 请求和文档 drain 延续原 owner | 基本停止责任清楚；A08 等待链及真实正常退出/冷开未闭环，不撤保存保护 |
| S04 resume 修复 | 同 backend 先关闭 human control 后 snapshot 失败，catch 真正 setBackendControl(true)，只有成功后标 human；恢复失败保 transition，重复 takeover 可重试 | T05 两条模拟 backend 反例与原失败对应，修复叶子可推进；真实 WebContents 键鼠仍未测 |
| S04 上传叶子 | readUpload 返回 file-owner 冻结字节 → scratch 私有副本 → 实际 invoke；派发前再次检查 stop/control/snapshot；重入查同 operation 的结果 | T05 两条 injected file owner 反例覆盖允许/拒绝及不重复上传；真实 file owner producer 尚未接，不能称外部路径上传完成 |

## 明确的未完成汇合与条件证据

- **S01 分发**：当前 `electron-builder.yml:11-25` files/extraResources 不包含 `resources/mcp-bootstrap`。脚本存在于源码，不会按当前配置随产品分发。Main packaged CLI 已接，但产品发现入口/Skill 消费及实际无源码、无 Node 的 bootstrap 尚未证明。最低后续为现 owner 补分发 hunk，再在已有可用产品载体做一次实际 ready/HTTP；本审查不启动打包或发行。
- **S03**：冻结 grant producer、内外 consumer 与新能力端口仍在 I/Root/browser 汇合。`13f27033` 的 Engine approvalReason 仍把 browserWrite 一律 ask，External 的通用确认也不是 concrete browser grant。这里是明确在做的未完成范围，不假报审过或制造重复逐动作权限门。
- **S04 上传**：`workbenchToolServices.ts:138-143` 创建 ManagedBrowserMcpService 时未注入 readUpload，且 managedBrowserGrantForRun 仍用 workspaceRoot。T05 的注入只能证明 leaf 合同。真实授权来源读取、realpath/封存及拒绝应由当前 file owner 接入，不扩大读取参考为网页写授权。
- **S04 外部人工接续**：外部 run 定位、viewport/control 到同 WebContents 与需要人工时同 profile 显示 GUI 仍待真实 consumer 汇合；不得把 service/backend mock 两绿当真实 GUI 已可输入。
- 已读 E `output/e-focused-c234c618.txt`：31 cases 中 26 passed/5 failed，失败清单在 T03/T06/T07/T09；按派发证据 T04 为真实两文档 loopback 1 绿、T05 为 4 绿。日志使用失败详细报告，未列每个绿色 case；本审查同时核了对应测试源码与范围。新 scope 变更后的适用证据由 T/E 决定，不机械重跑无关绿。

本次只读审查并只写本文件；保留同目录 R_S_REVIEW.md 原文。未修改产品/测试、未运行构建/真实模型/GUI/安装或完整矩阵。最终产品接受仍归 Owner。
