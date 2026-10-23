# 实际编辑器、History、保存重开及正式导出验收

结论：通过。只修改本轮 `output/editor/` 中的副本与验收脚本，没有修改产品源码、v08 正式作品或旧 output。最终真实 Electron 的 Main、DocumentSession、HeadlessDocumentExportWorker、Renderer 及离线 Chromium 消费链均已走通。

后续字体及 compiled Player 收敛后，又以相同未改名副本完成一次最小正式 Main 导出，新 HTML 为 16,389,609 B，compiled Player 为 1,153,391 B，详见 `../size-followup/FORMAL_EXPORT.md`。下文 21,250,072 B 的 HTML 是此前已经直接消费通过的阶段制品，不冒称最新体积；既有 GLX 身份及 History 证据继续有效。

## 资源和编辑身份

旧 flat GLX 在旧构建中打开后，与新 CAS GLX 在新构建中实际打开后的事实逐项相等：

- 完整项目（仅比较 History 时忽略按合同递增的 project.revision）。
- 80 个逻辑项目资源 ID 各自对应的全部字节；12 个组件资源 owner 下的路径和字节。
- 39 个结构化资产引用，保持原逻辑 ID。
- 同内容多个逻辑 ID 的分组被保留，未因物理去重折叠编辑身份。

最终候选在副本里通过 canonical operation 改一个实例的 name；Undo 精确恢复原项目，Redo 恢复改名结果，过程中资源和组件文件不变。保存后 dirty=false，保存耗时 969.4 ms，文件 8,434,332 B（与未改名 CAS 副本 8,434,293 B 的差异来自测试用 name 标记）。随后关闭整个 Electron，在另一全新 profile 和进程中重开，项目、每个逻辑资产字节、组件文件和引用均与保存前相等。两个进程合计零 pageerror；正式 v08 GLX 摘要保持不变。

证据：`candidate-results.json`、`candidate-before.json`、`candidate-reopened.json`；实际重开截图 `candidate-reopened-editor.png` 已目视检查，首章原生图文正常。

## GLX 打开计时口径

| 同一启动策略的有效样本 | 旧 flat / 旧构建 | 新 CAS / 新构建 |
| --- | ---: | ---: |
| 打开动作到 deep 编辑器容器 | 17.160 s | 9.134 s |
| 打开动作到首个可见已解码图 | 19.432 s | 9.307 s |
| 启动到工作台 shell 可用 | 4.851 s | 17.899 s |

以上是协调独占窗口中的单样本观测，不是分位数或稳定性能保证。新构建 shell 时间有明显方差，不能宣称端到端应用冷启已经稳定改善。编辑器容器出现也不等于全部组件已经可交互。对应证据为 `baseline-results.json` 与 `candidate-harness-failed-results.json` 中独立有效的 open 字段；后者的首次打开及身份比较正确，后续验收脚本参数错误不影响此前的时钟及只读事实。

所谓冷开指新 Electron 进程及全新 profile。输入启动前复制到隔离工作空间，OS 文件缓存没有清除，可能为热。两个有效计时样本截图均为 3120×1984 像素；新候选采样 CSS 1560×992、DPR 2，旧基线未采样 CSS/DPR。请求窗口内容 1600×1100 后的异步最大化会覆盖请求，不能把请求尺寸当实际 CSS 视口。

最终补齐功能样本使用 CSS 1599×1100、DPR 2，打开 6.678 s / 首图 6.785 s，保存后重开 6.164 s / 首图 6.397 s。它具有不同实际窗口尺寸且经历过前次构建加载，只用于功能与生产链验收，不替代上表对照。受 Root 或 delivery Vitest 竞争的两次较早样本已单独保存在 `baseline-overlap-*` 和 `baseline-delivery-overlap-*`，不用于性能百分比。

## 正式导出及直接消费

在改 name 前，从完整未改动作者项目执行正式 `document.export`，format=`html-offline`，workspace 授权和目标目录均为候选副本目录。结果为真实 `written`，revision 247，零 warnings；耗时 6.135 s，文件 `candidate-workspace/candidate-offline.html` 为 21,250,072 B。导出前后项目及 dirty 状态不变。

独立 Chromium 以 offline=true、1440×900、DPR 1 通过 file:// 打开这份正式导出，未运行重复性能分析或完整功能矩阵：

- `coursePlayerReady` 成功，80 个逻辑交付资产和 7 个不同章节导航目标保留。
- 只导航到水章节，点击一次 dilute 按钮，模式变为 dilute，materialStatus=ready。
- 13 张已挂载图片全部完成解码；各 realm 字体 ready，存在真正 loaded 的 FontFace，零字体错误。
- 零 pageerror、外网请求及失败请求。

证据：`candidate-export.json`（包含真实冻结 grant 和 destination）、`formal-html-consumer.json`、`formal-html-water.png`。

首次正式 export 的失败属于验收脚本：ElectronApplication.evaluate 的用户参数应在第二参数，脚本误解构第一参数的 Electron 模块，令 workspaceRoot/destination 为 undefined。正确的产品授权检查拒绝了写盘。错误收据保存在 `candidate-harness-failed-*`，最终只修脚本参数，未放宽产品权限或添加绕过路径。由于导出服务先生成再解析写盘目录，不能把该失败解释为 producer 没有启动或资源修复存在缺陷。
