# S05 / M07 / M14 工程增量证据（2026-09-23）

本文只记录本轮实际执行结果。可控 HTTP Provider 不是收费供应商，组件检查不是 Electron/Windows 验收，局部长历史检查也不是完整 M14 压力场景。

## 正式用例结论

| 用例 | 结论 | 当前证据边界 |
|---|---|---|
| S05-T05 模型能力不足可见 | 保持 `not_run` | 能力探针、精确事实持久化和设置 UI 已有工程检查；尚未在 Electron 中以实际对应操作验证缺项提示或已配置视觉路径，未调用真实模型。 |
| M07-T03 发送失败重试 | `passed` | 真实 `ExecutionDesktopService`、提交存储、Engine 与附件存储在临时磁盘运行；模拟首次 ACK 丢失后查询并用相同 submissionId/载荷重试，只产生一个 run 和一次 Provider 请求，附件引用与原始 bytes 保留；不同载荷复用同 ID 被拒绝。Provider 为本地可控 SSE，不宣称真实扣费验证。 |
| M07-T04 排队与立即调整 | `passed` | 真实 Service/Engine/Gateway 与临时磁盘运行；运行中排入 A/B，位置为 1/2，删除 B，调整先停止旧 run；旧 Gateway 迟到写返回 `run-stopped`，调整完成后 A 顺序启动并通过 `continuedFrom` 保留事实链。Provider 为本地可控 SSE，满足 real-engine 层，不代表真实供应商。 |
| M14-T03 长会话多文档 | 保持 `not_run` | 10000 条持久事件、搜索/重开/损坏检测、10000 项 Timeline 有界 DOM，以及 45 条用户消息分页/会话位置恢复已有局部检查；正式场景还要求 10 文档（含 2 课件）、多附件、连续切换/关闭重开及实际延迟和内存趋势。`g20LongWorkspace.spec.ts` 已存在但本轮没有执行证据。 |

## S05 能力探针工程检查

命令（cwd `D:\果铃工作台`）：

```text
npx vitest run tests/integration/g20ModelCapabilityProbe.test.ts tests/integration/g20ExecutionSettings.test.ts tests/unit/g20ExecutionSettingsPanel.test.tsx -t 'records only observed|applies persisted capability|runs one explicit probe' --reporter=verbose --maxWorkers=1
```

结果：3 个文件，3 个选中用例通过，8 个未命中用例跳过。实际覆盖：本地真实 HTTP/OpenAI Chat Provider 两个小请求分别观察 vision/tools；探针事实按 connection revision、model、parameters 精确匹配，配置变化回到 unknown；设置面板明确一次小请求及实际 provider/model/Token Plan 路径。`npx tsc -p tsconfig.electron.json --noEmit` 与 `npx tsc -p tsconfig.json --noEmit` 均 exit 0。

源码与测试位置：`src/main/workbench/providers/ModelCapabilityProbe.ts`、`src/main/workbench/providers/ExecutionSettingsStore.ts`、`src/renderer/workbench/ExecutionSettingsPanel.tsx`、`tests/integration/g20ModelCapabilityProbe.test.ts`、`tests/integration/g20ExecutionSettings.test.ts`、`tests/unit/g20ExecutionSettingsPanel.test.tsx`。

## M07 T03/T04 工程检查

2026-09-23 06:01:11（本机 +08），cwd `D:\果铃工作台`：

```text
npx vitest run tests/integration/g20ExecutionSubmission.test.ts -t M07
```

结果：1 个文件通过，2 个选中用例通过，1 个未命中用例跳过，2.02 秒。原始证据是执行代理工具输出（exec chunk `b3c083`），没有另存日志文件。测试源码：`tests/integration/g20ExecutionSubmission.test.ts` 的正式命名 `M07-T03`、`M07-T04` 两项。

补充边界：`tests/e2e/g20ComposerConversationsUI.spec.ts` 仅确认可收集 2 项，未运行，因此不把本记录扩写成 Electron Composer 通过；T03/T04 的正式登记分别依据其 integration / real-engine 定义。

## M14 核心与分页局部检查

2026-09-23 05:50:43 / 05:54:00（本机 +08），cwd `D:\果铃工作台`：

```text
npx vitest run tests/integration/g20LongExecutionHistory.test.ts tests/unit/g20LongExecutionTimeline.test.tsx tests/unit/g20ExecutionTimeline.test.tsx
```

结果：3 个文件、5/5 通过。随后 fold 优化后于 05:55:07 精确重跑 `tests/integration/g20LongExecutionHistory.test.ts`，1/1 通过。原始证据是执行代理工具输出，没有另存日志文件。该测试输出机器、10000 条真实持久事件写入/读取搜索耗时、heap 变化和 100 次增量 fold 趋势；测试自身明确这些不是跨机器性能门或 GUI 延迟结论。

用户消息窗口的定向命令：

```text
npx vitest run tests/unit/g20ExecutionAssistant.test.tsx -t "keeps a long user history bounded|remembers the independent user-history window" --reporter=verbose --maxWorkers=1
```

首轮 1/2：长会话窗口通过；另一项错误要求切会话也保持 textarea DOM，而现有按会话 key 重建附件接收器用于取消迟到提取。收窄为本任务的会话窗口位置恢复后，2026-09-23 06:02:37 最终 2/2 通过、4 项未命中跳过，1.61 秒；`npx tsc -p tsconfig.json --noEmit` exit 0。最终覆盖最近 20 条有界 DOM、全部 45 条可达、前后/跳最新、按会话恢复窗口，并验证翻页不重建 composer、不新增执行订阅。

源码与测试位置：`src/main/workbench/execution/ExecutionEventStore.ts`、`src/shared/workbench/executionEvents.ts`、`src/renderer/workbench/ExecutionTimeline.tsx`、`src/renderer/workbench/userMessageWindow.ts`、`tests/integration/g20LongExecutionHistory.test.ts`、`tests/unit/g20LongExecutionTimeline.test.tsx`、`tests/unit/g20ExecutionTimeline.test.tsx`、`tests/unit/g20ExecutionAssistant.test.tsx`。

## 剩余正式门

- S05-T05：在 Electron 中用明确不支持能力或已显式配置的视觉路径发起对应操作，核对 UI、实际连接/模型/参数/计费事实；真实供应商场景另按 S05 real-model 用例执行。
- M07：T03/T04 已达到各自工程层；Composer Electron 场景尚未执行，不用于提升 M07-T01/T02/T05。
- M14-T03：运行 `tests/e2e/g20LongWorkspace.spec.ts` 对 10000 事件、10 文档、2 课件和 4 附件做真实工作区切换/搜索/保留与性能趋势记录；其余 M14 用例仍需各自 Windows、manual 或发布范围验收。
