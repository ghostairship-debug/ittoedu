# B24 / M30 独立验收矩阵（2026-09-29）

本记录只陈述本线已执行的测试和直接读到的依赖状态。权威用例状态由 `acceptance_cases.json` 的唯一集成写者更新；工程 fixture、真实 Electron 和真实模型的证明范围分别记录。

| 用例 | 本线新增证据 | 可确认范围 | 尚缺的整项条件 |
|---|---|---|---|
| M30-T01 变更审阅与逐文件回退 | `ExecutionChangeReviewService`、`ExecutionChangeReview.tsx` 与 `g20ChangeReview.test.ts` 已存在；`output/g20/b24/m30-review-fork-electron-r3.log` 是本线真实 Electron 的四文件审阅消费 | 同一真实会话可从菜单打开审阅，列出 4 项写入；测试继续保存、重开 HTML | 本线未执行逐文件回退、用户与 Agent 混合写入的冲突路径，不能登记整项通过 |
| M30-T02 计划、只读并行与回溯 | `ReadOnlyToolScheduler`、`CheckpointForkService` 与对应测试已存在；`m30-review-fork-electron-r3.log` 是用户查看检查点、从原会话分叉的真实 UI 子流程 | 新会话得到待发送草稿，750 ms 内没有自动模型请求或文件变动 | 本线未覆盖真实计划/并行工具轮、长期压缩后回溯、旧授权失效的完整路径 |
| M30-T03 卡片、提问、预设 | 由 M25/U3 线独占的 renderer/Electron 检查 | 本线未写入其文件，也未把旧 M15 通过当新验收 | 该线交付的真实 scroll/resize/重选、问答与配置证据由集成人登记 |
| M30-T04 T1 零文档多文件 | `output/g20/b24/m30-no-document-fixture-r3.log` 与 `m30-review-fork-electron-r3.log` 覆盖真实 Electron；`m30-real-compute-r5.log` 覆盖真实 Podman 计算、成果封存和 HTML 相对资源回读；`m30-real-model-r2-send.json` 记录唯一实际 GPT OAuth Luna 运行 | 无 V9 工作空间读真实 CSV，创建 Python/JSON/HTML/CSS，完全相同的 Python 源在受限 Podman 后端计算 42 并输出 computed.json/chart.svg；`job.wait` 就绪、`artifact.save` 将两份成果封存到工作区，重开 HTML 后预览协议实际返回所引用 SVG 200/image/svg+xml；原 CSV 不变。真实 Luna 在 scratch 中确实读取 CSV、写四份文件，报告在 Electron 干净关闭重开，前 11 次模型响应完成。 | Podman 全链使用本地严格 HTTP 模型 fixture。唯一真实 Luna Run 在 240 秒有界停止，未将 computed.json/chart.svg 保存到工作区，报告虽引用 chart.svg 但资源缺失；T04 实质未完成，不能登记 passed |
| M30-T05 T2 多资料研究 | 现有 A2/A4/A5 局部材料、历史、Skill 证据由集成人复用 | 本线未发真实搜索/模型请求 | C1 已授权实际搜索连接未配置/未验证；真实换源、压缩续接及引用报告仍缺 |
| M30-T06 T3 图像交互 HTML | M23/M25 旧预览与轻编辑证据；本线 `output/g20/b24/m30-html-action-electron-r1.log`：1/1 真实 Electron 通过 | 独立 HTML 载体在用户明确引用后，产品内模型工具实际执行 `html.observe → html.click → html.errors`，点击后 URL 变为 `#done`，回执返回第二代 live 观察及错误数组；同一文件完成轻改保存重开 | 本地 HTTP fixture 驱动工具，无真实视觉模型、图像生成编辑或多轮视觉修正；整项仍未满足 |
| M30-T07 T4 外部工具异步 | M29 浏览器 MCP 服务真实协议与 M28 作业/计算近层证据由对应线登记 | 本线未运行外部写回读与慢作业父任务续接 | 产品共享入口的确权、实际服务写/上传下载、受限计算作业并行及唤醒仍需合并后的综合证据 |
| M30-T08 Owner 签收 | 无 | 工程线无签收权 | 先完成 M25–M29 与 M30 工程用例，Owner 再按真实日常界面签署 |

## 独立验证细节

- TypeScript `tsconfig.e2e.json`：`output/g20/b24/m30-zero-document-e2e-types-r1.log`，exit 0。
- Renderer 与 Electron 构建：`m30-zero-document-renderer-build-r1.log`、`m30-zero-document-electron-build-r1.log`，均 exit 0；已向集成人释放共享构建锁。
- 集成 fixture r1 是测试加密夹具错误，r2 是对普通 `.html` 源文件 `kind` 的错误预期。r3 修正后 1/1 通过，源文件按既有 `TextDriver`/`kind: text` 打开并由 HTML 视图解释。
- Electron r1 未新建独立会话导致发送禁用；r2–r5 在即时轻编辑交互断言处失败，r6 对实际 iframe 文本目标完成真实编辑。不能将失败历史删除或把 r6 延伸为所有编辑时序的证明。
- r6 native `capturePage` 在后台窗口对中央 OOPIF/文档区域可能不完整；实际预览与重开依赖 Playwright 真实 iframe DOM 和磁盘内容断言，截图只作辅助载体记录。
- `m30-html-mode-ack-unit-r2.log`：11/11 通过。HTML 编辑模式在当前 frame 完成实际切换后回送带请求 ID 的 ACK；旧 load 与旧请求的消息被既有 lease/load/seq 校验及最新请求匹配拒绝。`m30-html-mode-player-build-r1.log`、`m30-html-mode-renderer-build-r1.log`、`m30-html-mode-electron-build-r1.log` 均成功。此改动修复 r6 曾偶然通过但新审阅测试 r1 再次出现的即时双击丢失。
- `m30-review-fork-e2e-types-r1.log`：TypeScript 通过；`m30-review-fork-electron-r3.log`：1/1 真实 Electron 通过，对应 `output/g20/b24/electron-zero-document-urJKlx/evidence.json`。审阅 4 项写入、查看检查点、分叉后草稿保留；分叉后延迟 750 ms 比较模型请求数和工作区完整文件列表及内容，模型请求仍为 3，页面错误 0。此为有限子流程，不替代 T01/T02 全门。
- `m30-html-action-e2e-types-r1.log`、`m30-html-action-electron-build-r1.log`、`m30-html-action-electron-r1.log`：类型、含新共享接线的主进程构建、真实载体 1/1 通过；`output/g20/b24/electron-zero-document-ihZ00h/evidence.json` 记录 7 次模型请求，前 3 次交付 T1 文件，分叉后 750 ms 仍为 3，后 4 次仅在用户再次发送并引用当前 HTML 后执行观察、点击、错误读取、最终回答。`html.click` 后真实 iframe URL 以 `#done` 结尾，页面错误 0。此为本地 fixture 验证，不是实际视觉模型看图修正。
- `m30-real-compute-r1.log` 是未生成图表时的真实 Podman 数值链局部通过；r2–r4 因本线测试断言把含摘要、长度与 MIME 的真实成果记录错误地要求等于只有 `name` 的对象，HTTP fixture 回 400，后续回执随之缺失。这些是测试匹配错误，不能算产品通过或产品失败。修正为 `objectContaining` 后 `m30-real-compute-r5.log` 1/1 通过；`m30-real-compute-types-r4.log` 类型检查通过。r5 核对 Jan=20、Feb=22 的 SVG 柱形位置与文字、总值 42、HTML 保存重开和相对 SVG 真实预览服务读取。对应 `tests/integration/g20M30RealComputeJourney.test.ts`；它验证真实受限后端和文件合同，模型仍是本地 fixture。
- `m30-oauth-preflight-r1.log`：对现有产品 GPT OAuth 配置的隔离副本作零费用预检，实际冻结文本路由为 `openai` / `chatgpt-responses` / `gpt-6-luna`、`reasoning_effort=max`、账号声明计费 `subscription`；隔离 Electron 的原生凭据解密返回 ready、未过期、账号匹配。没有因此推断真实模型请求成功。
- `m30-real-model-once-r1.log` / `.json`：首次真实 scratch 启动在首个 `execution.workspace` IPC 即失败；临时目录未走原生工作空间选择器，`WorkspaceFilesDesktopService` 拒绝未授权根。隔离 profile 没有 conversation、submission、run 记录，workspace 仍只有专门创建的 sales.csv，未进入 Provider 请求。通用 IPC 文案是“会话操作未完成”，诊断仅保存脱敏 unclassified 指纹；此失败不是模型/路由故障。需按正式选择器授权后再执行单次有界真实任务，不能把此记录算 T04 真实模型通过。
- `m30-real-model-r2-preflight.log` / `.json`：修正测试启动顺序，原生工作空间选择器授权 scratch 根，再执行 `execution.workspace` 与 `createConversation`；0 run、0 submission，冻结产品 `openai` / `chatgpt-responses` / `gpt-6-luna`、`reasoning_effort=max`、声明计费 `subscription`，凭据在隔离副本内可用。零费用预检通过。
- `m30-real-model-r2-send.log` / `.json`：仅一次 `execution.send`，真实 GPT OAuth Luna 接受并运行。12 条模型请求记录中前 11 条 `completed`，实际模型均为 `gpt-6-luna`；第 12 条在 240 秒测试上限触发 stop 后为 `chatgpt-aborted` / `unknown`，Run 终态 `stopped`、无终答。工具顺序为 `file.read`、初始四次 `file.write`（其中一次 `invalid-tool-arguments`）、一次 `compute.run` 参数错误、一次修正的 `file.write`、`compute.run→job.wait→job.logs`、再 `file.read→file.write→compute.run→job.wait→job.logs`。读/写及两轮作业工具有 `read` 回执，但测试只保留结果种类，未保留作业状态正文，因此不能据此断言作业 ready。磁盘检查在停止时仅有 chart.py、summary.json、report.css、report.html 和原 sales.csv，没有 computed.json/chart.svg，也没有 `artifact.save` 调用；CSV 字节未改。report.html 在真实 Electron 中是干净的普通文本源，关闭后重新打开内容相同并引用 chart.svg，引用的资源缺失，交付不完整。
- r2 脚本在停止后清理了隔离 profile；预期保留的 scratch 工作区副本未出现在证据目录。这使作业持久记录与源文件正文无法再回读，是本线证据保留不足。零费用复核 Temp 中无该隔离 profile，`wsl -d Ubuntu -- podman ps -a` 未见计算容器，不能回收本次 job 的未封存成果。没有追加模型请求或重复任务；本地 fixture 的 r5 仍单独证明后端与封存机制可用。
