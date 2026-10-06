# 2026-10-06 剩余问题本批实施结果

实施时承载为 `D:/果铃恢复候选/20261005-v10-migration`；2026-10-06 已归并到 `D:/果铃工作台` 的 main，旧工作树已按[归并记录](20261006-main-consolidation.md)保全并清理。本批沿唯一执行方案完成 L、M、R1–R5 和一批 R6，保留已有成果，不恢复已撤回项。代码 cut 为 `873674f2`；L/M 零模型真实闭环与 R1 原页一次性能对照已完成。没有调用收费产品模型，没有发布。

## 已集成修复

| 包 | 实际提交 | 结果与最小证据 |
|---|---|---|
| L 图层 | `77f3c246`、`027598b6` | 测得的有效 stacking context 保留为正式组，交错装饰进入同父有序项，普通 block background 保持下层；独立文字/专业对象保既有编辑。聚焦 6/6。公开链发现的主题 canvas 重复另在现 Sandbox 修复：framed defaultWeb 的 transport html/body 不重复施加整课背景，作者局部 body CSS、后代 paint 与完整程序 canvas 保留；真实 5 realm 反例 1/1。最终公共观察和真实离线 HTML 画面通过。 |
| M 后台 MCP | `4e8b73e4`、`56d79ac7`、`52703451`、`873674f2` | 同一 Electron Main 启动正式 DocumentHost、文件与 Resident MCP，不挂载工作台主 App；观察/导出按需隐藏 worker。SDK 样例使用真实 flat MCP schema。首次观察等待非零内容 frame 的 fonts ready 与两次 rAF；零 viewport 隐藏 iframe 不加入绘制屏障。后台开/改/保存/导出/正常退出/新 Main 冷开已完成，首次公开观察呈现完整。 |
| R1 targets 成本 | `c5cb4de5` | 静态默认 Web 不构造、传递整课作者 values；Source、HTMLProgram、执行面和未知结构保完整同步读取，同 realm 不降级。纯检查 2/2、真实 native carrier 1/1：静态 mount/update targets 各 394B、target 构造调用 0，跨未访页同步读取、原生表单状态/源码修改正常，释放后 iframe 为 0。[证据](D:/果铃开发归档/evidence/20261006-required-evidence/r1)。 |
| R2 背景预览 | `2b5c3dbf`、`55cb791f` | V10 瞬态投影使用完整目标身份；取消/换选撤预览，确认一次提交、Undo 正确。3 个基础检查加同对象文字草稿、换选取消各 1 个检查均通过；预览 0 正式 dispatch/History，人工 affine frame、邻对象与同对象未提交文字草稿保留。[原始结果](D:/果铃开发归档/evidence/20261006-required-evidence/integration/leaf-checks/r2/output/required-r2-background-preview/result.json)。 |
| R3 健康/导出诊断 | `e6f17f82`、`55cb791f` | 健康面板按需消费当前 V10 collector/resources，健康和导出共用 owningContainer 导航 router；删除、外工程及无归属目标明确不可定位。预检消费现 ComponentDeliveryReport，保 DOCX、warning 与 canExport。3 个直接测试文件 6/6；原工具输出已留存，没有重跑 HTML 导出。[原始结果](D:/果铃开发归档/evidence/20261006-required-evidence/integration/leaf-checks/r3/output/required-r3-checks/result.json)。 |
| R4 样板改写 | `618f6095` | V10 参考页消费现内核槽位，正式提交等待真实 ACK；pending 禁重复提交/切模式/取消，失败保表单和预览。保原 frame、格式、独立可编辑副本、一次 Undo 和内核真实 slot.issue/warning。真实 Host/Bridge/Session 4/4，窄类型检查通过。[结果](D:/果铃开发归档/evidence/20261006-required-evidence/integration/leaf-checks/r4/output/required-r4-remix/vitest-ack-final.txt)。 |
| R5 媒体声明 | `f8eed88f` | 补 required captured 声明，与三 Surface 已有真实捕获和转发一致；复用有效媒体证据，没有重跑全矩阵。 |
| R6 共享测试迁移 | `b89d8937`、`785aaa8f` | 迁 `courseDocumentHost` 及直接 workspace/lifecycle fixture 到真实 V10 Host/Bridge/Session；保正式身份、frame、History/保存断言。迁移揭示的晚到 save ACK 改为仅确认发起文档。三 fixture 18/18，三个维护根历史直接类型诊断 8→0。[类型范围](D:/果铃开发归档/evidence/20261006-required-evidence/r6/type-scope-result.json)。 |

重要结构候选已由未参与实现的 Reviewer 审实际 diff、直接 consumer 和原始证据；不据此宣称完整软件或全部历史类型检查通过。

## 后台入口与真实闭环

后台入口复用已有构建制品，连接不重新构建产品：

```text
npm run --silent mcp:server -- --workspace "<绝对目录>" --port 45888 --user-data-dir="<独立 profile>" --ready-json
npm run --silent mcp:connect -- --connection "<ready JSON文件>" --file "<已有课件绝对路径>" --save
```

[SDK 连接样例](../../scripts/connect-mcp.ts)还支持 `--apply` 参数文件。软件返回实际 endpoint、workspace、permission、profile/mode 与 owned/attached 状态；连接同 profile 复用已有 owner，workspace 不同明确返回实际根与 mismatch，不改 GUI 工作空间或授权。SDK detach 只断开客户端；专用 owned launcher 的停止走 Main drain/flush/worker dispose。协议是 HTTP MCP。

零模型 optics 链使用显式工作空间 `D:/果铃开发归档/evidence/20261006-required-evidence/optics/workspace`。真实 tools.load/apply 后，对同一标题实例局部修改返回 committed/usable、insertedIds 为空；人工 root x=4 在冷开保持。[验证课件](D:/果铃开发归档/evidence/20261006-required-evidence/optics/workspace/光的折射与透镜奇境-本批验证.h5lesson)保存回执 savedRevision=currentRevision=4、dirty=false；`optics-export.html` 返回 written、exportedRevision=4。Main 3876 正常停止后，新 Main 62956 冷开读到标题与 frame，frontendState 为 null。同 profile attach 保同 PID，客户端 detach 后 owner 仍活着；SDK 样例 exit 0，自有宿主 stop exit 0 且进程释放。[闭环原始摘要](D:/果铃开发归档/evidence/20261006-required-evidence/optics/closure-summary.json)。

5dac9f5a 的画面曾显示 opaque fragment canvas 遮挡底图，首次 observation 还缺部分导出已呈现的卡片细节；该失败保留，并促成 `027598b6` 的 canvas 修复和 `52703451`、`873674f2` 的子 frame 首帧绘制屏障修复。没有添加固定 sleep 或新内容预算。

最终 cut `873674f2` 使用新 Main 75084 冷开原已保存 revision 4，只补受影响 observe 和 HTML export，没有重 apply/save/attach。首次公开观察完整显示背景水槽、渐变、四张前景卡片和思考气泡，独立文字黑底盒消失；新[离线 HTML](D:/果铃开发归档/evidence/20261006-required-evidence/optics/workspace/optics-export-fixed.html)在普通浏览器中与同源裸 HTML 呈现相符，保留刻意局部改写的标题与人工 x=4。回执 revision 4、dirty=false。SDK detach 后 owner 仍运行，owned stop exit 0 后 PID 已释放，普通浏览器也已关闭。[最终视觉摘要](D:/果铃开发归档/evidence/20261006-required-evidence/optics/visual-final-summary.json)、[首次公开观察](D:/果铃开发归档/evidence/20261006-required-evidence/optics/raw/visual-final/005-first-observe-fixed.png)、[实际导出画面](D:/果铃开发归档/evidence/20261006-required-evidence/optics/export-fixed-actual.png)。

## R1 原页一次性能对照

使用原 revision 32、268 instances 的 pg4“实验台：读数与揭示”，通过正式公共 view.observe 观察一次，0 模型调用、返回 1 张图片；前后 revision 均 32，没有为了测量改动原课程。复用与旧 baseline 相同的 410,228,606 bytes journal，原件未修改。Main 与源码为 `873674f2`，本轮 Player/Renderer 制品为 `027598b6`，GUI 宿主与旧对照同形，没有以 headless 小链替代大页。[一次对照报告](D:/果铃开发归档/evidence/20261006-required-evidence/r1/probe-result.md)、[完整采样摘要](D:/果铃开发归档/evidence/20261006-required-evidence/r1/probe-summary.json)。

| 指标 | 原有效对照 | 本轮 | 变化 |
|---|---:|---:|---:|
| 同逻辑 targets JSON UTF-8 | 17,487,884 B，277 values | 38,158 B，277 refs / 0 values | 减少约 99.78% |
| 离线单次 snapshot 的 target.read 调用 | 277 | 0 | 静态引用分支不读取作者值 |
| public observe wall | 7,531.7714 ms | 3,423.1058 ms | 减少 54.55% |
| sampled app private 峰值 | 8,229,990,400 B | 4,540,948,480 B | 减少 44.82% |

真实挂载投递中 16 个 GUI、42 个 observer mount 均为 references；JSON 体量和 read 计数来自[离线同输入测量](D:/果铃开发归档/evidence/20261006-required-evidence/r1/targets-offline.json)，不称作 IPC wire bytes、实际 clone 次数或 heap 体量。实时 mount 结果与观测在[本轮原始记录](D:/果铃开发归档/evidence/20261006-required-evidence/r1/raw-actual/result.json)及同目录 measurements、targets-deliveries、lifecycle 中保留。

这是一次同原页对照，环境不同，不能把 wall 与进程私有内存变化全部单变量归因于 R1。GB 为十进制，app private 是自有 Main 后代进程树 private bytes 之和，峰值为周期采样最高值。观察前系统 commit 为 58.426/63.195 GB（92.45%），余量约 4.769 GB；采样峰达 93.74%、余量约 3.953 GB。首次夹具子进程继承 stdout 管道造成记录延迟，实际 SDK 调用和观察均为 0，不计入提速结果。修正夹具后才执行表内唯一实际观察，没有等待 GC 再测。真实运行 Main 72244、launcher 95184 均正常 exit 0、forced=false；观察 worker 正常 destroyed，22 个自有 PID 全部释放，关闭后 app private 为 0。本轮没有异常 Main 消失，历史 native 根因仍未完全验证。

## Skill 同步、类型与剩余问题

Skill 源码 `15c9f962` 和内置资源 `0fa0c76a` 对齐实际创作入口、apply commit/usability 与用户要求保存时的 `project.save`；模型继续负责内容，软件维护身份、层叠包装、连接与资源，不增加 PID、Token 提取、端口发现或编号任务。两个 Skill frontmatter 校验与 9 个本地链接检查通过。用户级安装 exit 0：orchestrate/build/edit 已更新，office 已 current。[安装记录](D:/果铃开发归档/evidence/20261006-required-evidence/integration/skill-install.json)。

Main typed build 通过。当前 App 窄类型闭包共 30 条诊断，其中 3 条是该窄配置未提供 Node ambient globals；27 条源码诊断包含 inactive V9 observation controller 对新 BackgroundPreview 的 4 条类型漂移，该 controller 当前仅有测试调用者。其余源码遗留按记录保留，本批不声称全 source 类型绿色，也未重跑历史全仓 4030。[窄范围记录](D:/果铃开发归档/evidence/20261006-required-evidence/integration/focused-types.log)。

R4 旧 productivity 的 9 个 V9 用例未迁，R6 以外旧测试/脚本仍需另批迁移。无法唯一合法映射格式时的 slot.issue 是现内核正常诊断，不列为未修缺陷。R1 原 rev32 性能样本的历史碎片叠层与布局表现保留，本批没有重做该旧课件，不称其质量已修复，也不据此称新增回归。历史 native crash 根因尚未完全验证；payload 减量、一次正常运行或本次没有复现都不等于根因彻底解决。既有存量类型诊断与这些后续维护不冒充当前用户可用性 P1，也不掩盖本批明确未清零的范围。

## 实际提交清单

以下为正式承载从本批参考 cut `bc4628bd` 到代码 cut `873674f2` 的完整提交，不把独立 worktree 候选 ID 冒称集成结果：

```text
d6f79245 docs(tasks): coordinate remaining required repair batch
f8eed88f fix(media): declare the captured workspace drop target
e6f17f82 fix(diagnostics): connect V10 health and delivery navigation
15c9f962 docs(skills): clarify apply receipts and requested project saves
2b5c3dbf fix(authoring): project V10 color previews and retire target cancellations
55cb791f fix(ui): integrate transient previews and on-demand health routes
c5cb4de5 perf(runtime): omit author values for static Web target snapshots
618f6095 fix(productivity): reconnect style remix to V10 and await commit ACK
785aaa8f fix(save): scope late acknowledgements to the initiating document
b89d8937 test(v10): migrate lifecycle host and direct workspace fixtures
4e8b73e4 feat(mcp): add workspace-bound headless host and isolated export worker
56d79ac7 fix(mcp): call flat resident schema from SDK example
77f3c246 fix(content-apply): preserve measured stacking contexts and interleaved paint
0fa0c76a docs(skills): synchronize bundled authoring and save guidance
5dac9f5a test(content-apply): narrow JSON draft data before HTML access
027598b6 fix(web): keep course canvas paint out of fragment transport documents
52703451 fix(mcp): await content frame painting before observation capture
873674f2 fix(mcp): skip empty hidden viewports in capture paint barrier
```
