# 050 导航事实与旧记忆误导修正

## 定位

前轮电路任务在 tool-result sequence 133 实际读到 MEMORY.md 的错误结论：相邻 locations 就意味着 step.next 单击进入记录页。随后生成脚本只检查 location-flow 紧接 location-slide，保留 step.next。原始证据见 output/r19-050-navigation/prior-memory-read-evidence.json，来源为前轮 record 445637da-bd8b-44ad-b3be-74d26b74b63f。这是已确认的错误上下文输入和沿用错误判断，不能把本例全部归结为模型能力上限；也不能仅凭相关时序断言它是唯一原因。个人记忆文件未修改。

播放器按正式导航合同先走完呈现步骤；scene.next 才跳过页内步骤进入相邻场景。原能力卡已有正确说明，但模型选择完整文档路径时没有获得紧凑的当前工程导航事实。点击检查验证改变的规则及声明执行，不验证未改规则符合自然语言目标。

## 实现

- generationNavigationContext 直接读取 Player 的 buildCoursePlaybackSequence / playbackNavigationProgress / adjacentPlaybackTarget，提供当前与逐状态的上/下一步、上/下一场景目标，以及已有导航规则；不建立第二套导航算法、状态或持久化字段。
- 初始 generation snapshot 和后续 current-structure 观察共用这份投影；原生 prompt 在多状态或存在导航规则时保留当前目标，完整状态与规则留在本轮 request.json，明确当前事实优先于旧记忆。普通单步页面不增加无用的 wire 内容。
- 提交回执说明点击检查只覆盖已改规则的声明行为，未改规则与完整目标仍须核对。不把合法 step.next 拒绝为错误，不猜测自然语言意图或偷偷修改课件。
- coursePlaybackSequence 只扩展既有只读输入类型以接受作者文档；播放算法、V9/Published/History 合同不变。

## 免费验证

117 项相关 unit 按受影响范围通过，另有一项实际 Published Player 点击用例验证投影与步骤推进/跨场景一致。4 项完整原生 prompt 12 KiB 预算仍满足；主类型、Renderer 与 Electron 构建通过，既有播放器构建复用。

初次出现的新增反馈测试读到 checked 而非 committed 回执，以及无用单状态导航信息造成 wire 超限，均已定位并修正；保留初始失败日志，不扩大预算。证据位于 output/，文件前缀均为 r19-050-navigation-：unit.log、unit-final.log、wire-final.log、player.log、types-final.log、build.log；unit-final 中其余通过项按未变依赖复用。

## 真实复测

使用原 revision 2 副本、原 teacher-correction.txt 和 acceptance.json，未提供人工协议答案或修改候选。证据目录 output/r19-050-navigation/codex-2026-09-16T12-25-41-304Z；任务前冻结 diagnostic-purpose.json，并核对原生 Codex gpt-5.6-luna / medium / priority。首次任务只因上述相关实现变化启动；实际视觉失败后再进行一次普通教师 QA 修正，两份输入与首轮缺陷制品均冻结。


| 任务 | 原生耗时 | 原生回合 / 正式提交 | 结果 |
|---|---:|---:|---|
| 原三处教师修正 | 329.347 秒 | 2 / 1，revision 2→3 | 首候选通过宿主准备，step.next 改为 scene.next，三个起点实际直达 Flow；延后解释通过。但初始/断开仍为紫白圆球，视觉失败，因此不是首次完整正确。 |
| 一条普通视觉 QA 修正 | 366.145 秒 | 3 / 2，revision 3→4→5 | 先把圆球改为可着色的同形灯泡；模型在提交后观察发现颜色落到导线上，在同任务中再修正字符区间。最终灰/黄灯泡、重复操作、延后解释及导航全部通过。 |

两个任务合计 **695.492 秒，约 11 分 35 秒**，不含独立 QA、反馈、保存和重启，不能称精确首次正确时间或整体提速。显式非零命令退出分别 3 / 6 条，保留于 native-record 与 score.json；不称全程无错。只有一条普通教师视觉反馈，没有内部协议答案、人工候选修改或其他付费模型。两任务使用同一 externalSessionId，旧任务保持 completed；视觉任务第二次提交由模型观察后自行修正，没有第二条教师反馈。

### 实际交付证据

- 首任务 actual preview 的 initial / closed / observed 三个起点均单击进入实际 Flow。最终离线 HTML 再覆盖三个起点，全部通过；规则为 scene.next。见 preview-navigation.json、navigation-state-audit.json。
- ROOT 查看真实 Electron 初始/闭合/断开和离线闭合/断开截图：灰色不发光的灯泡与黄色灯泡保持相同外形；初始无观察解释，操作后才解释两种预测，两轮开关可重复。预测为口头活动，不存在正确答案门禁。见 final-behavior.json、restarted-behavior.json、offline-behavior.json 及对应 PNG。
- 首任务保全 projectId、标题、locations、global 和 Flow/Spatial 原页；一次 Undo / Redo 分别恢复原 revision 2 和结果 revision 3。视觉任务只改变 experiment-diagram 及其状态覆盖，其他文档内容全部相同；最终保存 revision 5 并重新打开。见 preservation-history.json、final-preservation.json、saved-result.h5lesson。
- 真实关闭应用后，在同 profile 从工作空间重开原课例，两个原生任务保持 completed，最终画面与两轮互动一致；没有复活任务或重放提交。见 restart-result.json。
- GUI 离线单 HTML 预检 **0 errors / 8 warnings / 17 infos**，实际导出 **8,385,185 字节**。Chromium offline:true 的开关与三起点导航通过，0 console/page error、0 外部请求。警告主要是既有包追溯及建议字号，不宣称教师投影距离与美术验收通过。见 export-preflight.txt、series-circuit.html、offline-runtime.json。

### 保留的问题与完成边界

一次 Undo 后的保存出现“没有权限访问所选文件或目录”。保持同一 Undo 状态仅重试保存一次，成功写回与原基线完全一致的文档，再执行配对 Redo；后续最终保存/重开/导出未再出现。原因未确认，不能当作零保存失败或已修复产品缺陷。原失败与差异保存在 history-save-transient-error.json、history-difference.json。

本批产品导航事实反馈和该课例的原三处修改闭环已完成；这证明当前事实可见性与反馈仍有产品改进空间，也保留模型视觉首轮失败与自主修正的边界。它不是整套成功率统计，也不代替从材料和四稿开始的完整普通教师代表链。**050 完整集成验收、060 和 Owner accepted 仍未完成**；下一批按总方案补真实剩余链路，不再重复已通过的本例导航。所有本轮测试应用已关闭，未提交、建标签或发布。
