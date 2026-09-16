# 状态显隐、结果反馈与查阅成本修正

Owner 在三通道冻结任务讨论后明确“完成这批”。本批只处理旧 Codex 候选已复现的显隐组合错误、候选实际点击反馈、能力文件查阅成本及 OpenCode 已失效的子角色模型配置；050/060 和整课教师验收仍独立保留。旧三通道制品及评分见 [原始自然任务记录](2026-09-16-r19-refg-first-route.md#自然任务结果)，未覆盖或修绿。

## 实现

- `slide.interaction compose` 复用正式图层合成的 mounted 边界：当前状态 `visible:false` 的节点不能先执行 show/hide。返回精确诊断和可行替代：已由呈现状态控制显隐时直接 set-state；动画目标保留挂载，以 playbackInitialVisibility 控制初始隐藏。带运行期条件的规则不擅自按初始状态判死；其余正式 Player 语义保持原样。
- 候选准备期使用真实 Published Player 的私有副本，实际点击新建或修改的受支持 Native 点击规则，检查声明的目的地、呈现状态、显隐和该规则执行诊断。未改交互的文字/颜色候选直接跳过；已有未变的 scene.enter 错误不归因于新候选。失败发生在正式事务前，按生成该规则的候选步骤返回类型化原因，走原有同任务预算、停滞和修复链；失败零工程写入，成功仍只提交一次。
- 这是已声明行为的执行检查，不是自然语言目标评判器。仅覆盖初始可点击、条件满足且动作属检查支持集的 Native 点击；其他触发器、运行期条件、媒体和连续机制明确记录需另行观察。状态切换会再次触发 scene.enter，不能把初始投影当成入场动画终态；此类动画目标另记未覆盖，既有动画不被移除或改写。真实教师要求仍由冻结 R1–R5 检查。
- 磁盘 `discovery-data.json` 改为只含索引及资源路径，query/helper 按需读取正式卡片。应用内打包数据仍保留完整文件且由同一生成器产出，不新建能力真相；helper 不再压成超长单行。能力工作区使用同一生成函数与新语义版本，保持缓存一致。文件编辑提示使用实际 resourceIndex.localPath 和 candidate root，消除错误相对路径建议。
- 本机 `C:/Users/74755/.config/opencode/oh-my-opencode-slim.json` 的 active preset 中，explorer/fixer/librarian 三个不存在的 DeepSeek-free 别名改为实际目录支持的 `openai/gpt-5.6-luna-fast`。原配置备份为 `.bak-r19-20260916`；其他用户角色未改。`opencode models openai --verbose` 确认其实际 api.id 为 Luna，`opencode debug config` 确认三个角色生效。此项为原生配置验证，未冒充三个子角色都已运行真实模型任务。

## 免费证据

- 相关 6 文件 98 项通过：slideInteractionCompose、generationTaskController、generationPreparationFailure、candidateChangeKey、generationRecovery、generationCapabilityWorkspace。之后补强同一真实 Player 用例，证明坏规则准备失败零写入、按原请求修正后仅一次正式提交；该命名用例通过，8 项未选用例不计本次通过数量。
- Chromium 重放旧 Codex 失败制品与旧 Claude 正确制品：前者以 native-interaction-result-mismatch 拒绝；后者两项点击检查通过，入场图片动画显隐明确另需观察。证据 `output/r19-refg-validation/batch-browser-result.json`。检查器最初对入场图片误判，经真实反例修正；调试用 Vite 热更新曾销毁执行上下文，最终关闭该测试服务器的热更新后复核，不计作模型错误。
- 主/Electron/E2E 类型检查与桌面构建通过；最终投影误判修正后重新执行主类型、命名行为用例和桌面构建。能力生成完成 77 个文件，索引 16179 / 16384 字节。已有效的其他 R/E/F/G 证据复用，未再跑三通道矩阵。
- 日志：`output/r19-refg-validation/batch-integration.log`、`batch-zero-write.log`、`batch-build.log`、`batch-types.log`、`batch-opencode-role-fix.json`、`batch-opencode-resolved-roles.json`。

## 新增自然任务

仅一项 Codex/Luna，运行前冻结本批变化及可证伪假设于 `output/r19-refg-validation/codex-2026-09-16T10-47-49-717Z/diagnostic-purpose.json`。输入仍是原课件 revision 1、原教师三处修改请求、原 R1–R5 和保全要求；未追加内部协议、路径或工具提示。三个原生回合均确认 `gpt-5.6-luna` / medium / priority（Fast）。

| 项目 | 结果 |
|---|---|
| 首次路径 | native.content 参数编辑 + slide.interaction compose；helper 只预检，随后直接写正式 staged candidate 文件。 |
| 首次正确 | 否。把标题正文当成对象名称，宿主以 compose-node-not-found 拒绝；正式工程保持 revision 1，未写入前序私有颜色变更。 |
| 自动恢复 | 是。同一原任务修正为对象 id；第二候选通过两项真实点击检查，只提交一次到 revision 2，随后进入观察回合并自然结束。两个候选、三个原生回合（生成、修正、观察），无人工修正或重复同因拒绝。 |
| 实际结果 | 提交后与保存重开后 R1–R5 全通过；基础态蓝色、证据态绿填充/红边框、点击标题显示图片与证据面板、点击标注直达练习页。已有入场规则和未指定内容全部保留。 |
| 时间与工具 | task.startedAt 至最终原生 completed 为 199.721 秒，约 3 分 20 秒，不含独立播放/保存/重开 QA；费用及严格首次正确时间未捕获。一项查阅命令查询了不支持的能力组合并退出 1，保留原记录；超长搜索错误为 0。不能据单项任务外推整体提速。 |

原始事件、两个候选、宿主结果历史、canonical-task-evidence.json、score.json、实际 Player 截图和 saved-result.h5lesson 均保存在该独立运行目录。计分按 turn-ended 加最终 completed 统计三个回合，不能只数任务终态事件误报一个回合。旧 129.855 秒失败结果保留，新结果计为修复后正确，不能把两轮当作速度提升对照。此前“隐藏目标先 show”的失败现由免费正反样本证明可拦截；本次自然任务没有再次产生该错误，不冒称模型实测了该原因的恢复。

本记录不代表 050/060、全部交互语义或 Owner accepted；无提交、标签、发行。
