# 1.9 最终组合验证与工程候选收口

## 当前结论

本轮产品修复及其受影响验证已完成；**050/060仍未完成，不能宣称1.9最终验收通过**。新真实任务暴露并修复了能力推荐遗漏和Published状态按钮不执行，另改善了预检/交付回执。最终模型样例仍有内容错误，一次修正只预检未交付；不把任务失败或局部播放器通过改称整条教师链通过。冻结电路样例 revision23未改动，仍为失败诊断。

## 剩余范围的裁定

原自动与手动两课例已经提供真实四稿、材料读取、阶段确认、首存及后续交付证据。本轮只补当前产品上的普通教师编辑请求：一个有讲解、可重复操作、错误预测仍可实验验证的活动，以及进入已有 Flow 记录页的学生按钮。独立三表面夹具来自正式 V9 工厂，补的是当前编辑消费，不能单独称全新教师整课生成通过。

验收先于模型调用固定在 `output/r19-final-closeout/2026-09-16T00-49-15-788Z/acceptance.json`；实际自然语言保存在同目录 `teacher-request.txt`。只用 Codex / Luna / medium / Fast，先读原生目录和保存的请求配置，再核对实际会话确认。首个默认 20 分钟任务自然结束后，真实QA发现产品与内容缺陷；产品修复后才发送一次普通教师修正，未补内部协议或手写候选。所有续轮和启动失败单列。

合法 `afterCommit.finish` 在正式提交、持久化回执与任务 completed 后可以结束；随后由独立 GUI/保存重开/HTML 检查证明实际结果。不得强迫模型额外 observe。若自然走 observe，才另行核对该分支实际消费。

## 复用的版本证据

| 范围 | 当前证据 |
|---|---|
| 040–045 / 双流程与连续性 | [总实施方案 §4.2–4.3](../R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#42-当前实现有效证据与剩余缺口)：原自动/手动课例、三格式材料、首存/复制移动、043 压缩与跨 CLI 接续、记录与范围删除 |
| 046–049 / 正文与交付 | 同方案中的完整 Wave C、九类/实际 Flow Word 数学结构编辑、真实 Markdown 共编、外部冲突及选择性撤回 |
| 051 | 真实 WebM/WAV 导入、canonical/Undo、保存重开、离线 HTML 播放与跨页停播，PPTX 结构编辑 |
| 专项行为 | [产品可用性实施结果](2026-09-16-r19-product-usability.md)：预算/纠正/候选竞态、静态预检、正式 Spatial 取景事务与真实宿主、真实 Component 导航、工作台实际操作 |
| 能力生成 | 前批 77 文件 / 15,753 字节为历史有效证据；本轮 Published 支持说明改变，已重新生成，见 `output/r19-final-closeout/capability-generation.log` |
| 类型与构建 | 本轮改变 Player 和请求入口，受影响构建与类型已重新执行；见 `output/r19-final-closeout/typecheck.log`、`player-build.log`、`renderer-build.log`、`electron-build.log` |
| 单元/集成 | 历史完整红轮原样保留，14 条 Windows timeout/清理失败经有据聚焦验证及 Builder 修复闭合；专项各 Owner 检查与 ROOT 3 文件 60 项聊天检查复用 |
| 真实 carrier | 既有 Flow、Spatial、跨页观察、PPTX、工作台命名结果按未改变的依赖范围复用；136 条 no-matched-current-log 不当作失败或自动重跑指令 |

`npm run verify` 的能力/类型/单元/E2E 四段通过有效命名证据组合核对。没有裸跑历史付费矩阵，不把历史红轮、条件跳过或未执行项改称全绿。新的缺陷或实现变化才使相应证据失效。

## 本轮真实结果

### 首任务及失败归因

首任务 `b059b32f-b331-47d3-adcd-b5927321f015` 用时 436.306 秒（7.27 分钟），同一任务三个原生回合。第一次没有提交修改而宣称缺乏互动能力，宿主拒绝提前结束并续接；随后 canonical commit revision1→2、receipt delivered、afterCommit.observe 和自然 completed。原始证据为运行目录 `native-record-first-task.json`。不记 clean first pass。

- **产品入口问题：**请求已有合法 create destinations/carriers，却没有把组件/Runtime创建入口推荐给模型；模型也未完成全部能力发现。现通过正式能力query提供紧凑推荐，仍须完整卡和正式candidate准入。聚焦7项通过，含无create/native-only/非法carrier反例。
- **产品播放问题：**合法保存的 `presentation.set` 被 Published Player 跳过。修复复用既有scene/state导航Owner；仅支持当前Slide、无transition、末动作独占末执行组，全局规则需scene.in，拒绝会引起同位置激活重入的scene.enter触发。其他组合整规则拒绝并同步health/能力说明，未修改V9终止动作定义。原样保存rev2、未编辑课件即可在最终重建后实际Electron反复切换两轮，证据 `same-artifact-state-switch.json`。完整限制写入同源conditionalActions，不声称完整动作家族支持。
- **模型内容问题：**两状态灯泡emoji相同、记录按钮误用逐步前进而需点两次、解释提前显示且未联系预测。口头预测是允许形式，不额外要求选择按钮或判分。修复产品后发送 `teacher-correction.txt`，只描述这三处教师可观察结果。
- **纠正GUI误判：**第一次即时读取/截图未证明开关成功，后续改变文字实际由记录按钮推进演示状态触发。等待可见状态的正式点击检查确认原缺陷；这些旧截图与失败记录不改写为通过。

### 修正启动与当前结果

续接原线程时 native `thread/resume` 返回 active writer，记录 `2e3f0b0c-3a0f-45b8-9b5c-0d65ee57294c` 仅2事件、0模型回合、0commit。只读核对正常任务/退出均等待adapter关闭，现场没有课件残留app-server；占用来自哪个外部应用未证实，不归咎Mirasim，也未终止外部进程。选择同课例的新会话后，以同一教师修正开始任务 `5df8a3a7-7f99-4b61-b02e-1948d8480b48`；不把新线程称为原线程续接通过。

新线程实际Luna/medium/priority确认；修正任务用时260.118秒（4.34分钟），terminal failed、0commit，保存工程仍revision2。seq193→199生成staging resources/result.json；seq203→204把候选草稿写在课例cwd；seq210→211正式helper仅以 `--check` 运行，明确candidateFile:null；此后没有正式交付，seq230却发edit标记，seq231宿主据实拒绝。没有候选入口被宿主误清理的证据。seq9读取的记忆也明确预检不交付，不能归因错误记忆。

产品改善：helper保留原status合同，新增delivery=not-delivered/ready-for-host，并在dry-run回执明确“未生成交付文件，不能声明已交付；交付须去掉 --check 再运行”。真实打包helper验证预检不产生文件、去掉选项后正式写当前root，未扫描课例目录自动摄取、未降低staging/事务边界。没有为这个提示改善再开付费样例重试，因此不能声称已证明模型漏交付率下降。

### 最终验证与保留缺口

| 范围 | 结果与证据 |
|---|---|
| 入口推荐 | generationSnapshotFocus 7项通过，`capability-tests.log` |
| 最终Player/回执/诊断 | 命名检查10项通过，`final-focused-tests.log`；新增全局health用例1项通过，`global-health-test-passed.log`。合计本轮18个不同用例，未选中项不计通过 |
| 类型与生成 | 三套TSC通过 `typecheck-final.log`；77能力文件、15,948/16,384字节 `capability-generation-final.log` |
| 当前构建 | Player/Renderer/Main三端通过，`player-build-final.log`、`renderer-build-final.log`、`electron-build-final.log` |
| 保存重开/保全 | 原正式保存revision2、原标题/其余Surface/location/global保全见 `saved-artifact-check.json`；最终再次实际重开同工程、两轮按钮检查通过。修正失败没有新revision |
| 离线HTML | 实际GUI导出8,382,964字节，浏览器offline:true，按钮两轮状态切换通过；`offline-behavior.json`、`offline-runtime.json`为0error/0external；截图offline-open/closed/flow.png |
| 样例内容 | 灯泡emoji仍相同；记录按钮第一次仍停留Slide、第二次才到Flow；结论仍提前可见。`wholeTeacherAcceptance:failed`，不称新教师闭环完成 |

上述日志除运行目录内部JSON/图片外均在 `output/r19-final-closeout/`。原完整Vitest红轮保留。本轮global健康夹具追加动作引起presenter策略与重复scene引用计数两次断言失败，调整夹具为真实点击并按两条规则保留重复ID提示后通过；不是产品逻辑被改来迎合测试。离线QA首次误用包括隐藏预挂载Flow的textContent断言，改为实际可见innerText后确认一步导航仍失败；这次driver失败不记产品故障。

**剩余项：**050的新教师编辑结果尚未形成符合原acceptance.json的最终成功链，060因此不晋升。已定位的模型内容错误与一次漏交付均保留；后续不能无新假设反复付费修样例，也不能自行降低既定质量门。独立教学行为QA仍属2.0；本轮没有把它提前实现或以此取消050。

## 发布与限制

1.9 目标为工程候选；Owner S4 和 2.0 全软件内 QA/修复尚未启动。本轮不创建发布标签、安装器或对外发布制品。原 57.4 分钟课例没有达到 30 分钟目标的事实保留；有限任务不能推出任意机制可靠或普遍速度指标。
