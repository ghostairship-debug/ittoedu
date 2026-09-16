# 050 电路课例接续验收：部分通过，导航仍失败

本轮推进了真实教师编辑、重启接续、保存与导出检查，但 **050 仍未通过，060 不晋升**。最终课例中的灯泡灰/黄变化、操作后解释、保存重开和离线运行已验证；“进入实验记录”仍是 step.next，初始/闭合状态点击只前进一个呈现状态，未直接进入 Flow。此前只在观察后状态验证成功的结论不得扩大为任意状态都成功。

## 范围与输入

- 使用 `output/r19-final-closeout/2026-09-16T00-49-15-788Z/` 已保存 revision 2 的独立副本，沿用原 teacher-correction.txt 和 acceptance.json；旧失败文件未修改。输入只描述灯泡颜色、延后解释、单击进入记录及保全要求，没有补内部工具、字段或协议答案。
- 新证据目录为 `output/r19-050-resume/codex-2026-09-16T11-32-07-994Z/`。调用前记录本版能力/恢复/点击检查变化及可证伪假设于 diagnostic-purpose.json。已有双流程、三格式材料、文档共编、Flow/Word、051 等有效证据按 [总实施方案](../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md) 复用；这份保存副本不能单独证明从材料开始的整课生成。
- 本轮只写驱动、证据与进度文档，未修改产品源码、手写课件候选或更换模型。未重复构建和已有工程检查。

## 原生任务与实际结果

两个任务均由原生会话确认 `gpt-5.6-luna` / medium / priority（Fast），只有一条普通教师 QA 修正，没有内部协议提示或人工修改候选。

| 任务 | 原生耗时 / 回合 / 提交 | 事实 |
|---|---|---|
| 原三处修正 | 525.716 秒 / 3 / 1，revision 2→3 | 首回合错误声称没有可用工具，零候选；宿主 missing-candidate-delivery 后同任务恢复，随后实际读取工程与能力文件，以 project.document 交付。灯泡、延后解释通过；初始状态直达 Flow 未实现，两段解释另有真实导出裁切错误。不是首次正确，也不是最终完整通过。 |
| 重启后修正导出裁切 | 125.358 秒 / 2 / 1，revision 3→4 | GUI 预检发现两项 text-content-overflow，作为新的具体失败先冻结首任务制品，再发送普通教师修正。新任务只改变解释区域，文本框从 1080×50 调整为 1120×84，字号从 20 改为 18；裁切错误消除，保留字号低于建议下限的警告。 |

两任务原生耗时合计 **651.074 秒（约 10 分 51 秒）**，不含独立 QA、重启与反馈间隔，不是精确首次正确耗时；费用未知。第一任务另有 3 条原生命令失败，见 first-task-score.json。原始失败、工具记录及耗时保留，不称全程无错误。

重启后旧 record `445637da-bd8b-44ad-b3be-74d26b74b63f` 保持 completed；新任务使用新 record `2f61dc77-610b-45bc-8238-a7eafb2e2b59`，两者 externalSessionId 都是 `01a0a9fe-5713-70a3-8ec5-c14014e94112`。这是原生会话的真实恢复接续，未复活旧任务或重放旧提交。两次提交后均自然选择 observe，模型如实说明其观察没有完整动态播放证据；后续实际操作由独立 QA 完成。

## 真实检查

- 实际 Electron 与导出 HTML：初始显示讲解、口头预测而不出现观察解释；预测没有答案门禁，两种口头预测均可继续操作。闭合显示两只黄色发光灯泡，断开显示灰色灯泡，状态文字同步；反复两轮后解释联系实际与两种预测。ROOT 已查看实际初始/闭合/断开截图。
- 标题、project identity、locations、global 内容与 Flow/Spatial 原页面保留。首任务一次 Undo 回到原 revision 2 文档，配对 Redo 恢复 revision 3；第二任务经解析比对只有解释项及其状态覆盖变化。
- 保存并真实关闭应用、重启恢复原课例后，初始/闭合/断开内容及两轮操作一致。最终 revision 4 再保存并打开验证。证据为 preservation-history.json、restart-result.json、final-preservation.json、各阶段 behavior.json 和 saved-result.h5lesson。
- GUI 离线单 HTML 预检由 2 errors 降到 0 errors，保留 10 warnings/18 infos；实际生成 series-circuit.html（8,385,066 字节）。Chromium offline:true 下两轮灯泡/解释通过，0 page/console error、0 外部请求。字号与灰色对比度警告属于可读性提醒，不改称导出阻断或教师美术验收通过。

## 未通过的导航与停止依据

最终保存的 `interaction-go-record` 仍为 `step.next`。三个不同起点的真实离线点击结果如下：

| 起点 | 点击一次后 | 直达记录页 |
|---|---|---|
| 初始：state-closed | state-open，仍在 Slide | 失败 |
| 闭合：state-open | state-closed-observed，仍在 Slide | 失败 |
| 观察后：state-closed-observed | 实际 Flow 实验记录 | 通过 |

证据为 navigation-state-audit.json 及三个起点的截图。Player 按声明的逐步推进执行；模型没有把原教师要求落实为跨场景导航。不是保存丢失、导出独有错误或新宿主导航失效。本版已存在 scene.next 的跨 Surface 能力，之前的正式 consumer 证据仍有效。

新 Native 点击检查只验证改变的规则及其声明行为；这条未被修改的规则不会被检查器替自然语言目标重新解释。宿主的一项点击检查通过和“观察后点击通过”，都不能证明“任意起点直达 Flow”。同一已知导航原因仍在，依工作协议停止追加付费尝试，不改冻结要求、不人工修制品追绿。后续需先形成能改变该失败的具体实现或可证伪假设，再续接；本记录不启动第二套自然语言判分或通用 QA 平台。

## 驱动纠正与交付边界

Undo 驱动最初错误假设 revision 必须递增；真实历史恢复 revision 2，已改为解析文档的语义比对，保留已执行的单次 Undo，只补配对 Redo。导航探针最初只读元素自身 display，未计祖先隐藏，随后按真实祖先显隐复核。两个原驱动记录分别保存在 harness-history-revision-assumption.json、harness-navigation-visibility.json，不能记为模型或产品故障。

当前 .h5lesson 与 HTML 都是保留缺陷的检查制品，不是通过验收的课例。所有本轮测试应用已关闭；无提交、标签或发布。050 仍缺符合原要求的完整结果，060 与 Owner accepted 均保持未完成。
