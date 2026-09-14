# AI 修改流程与 Luna 返工核查

日期：2026-09-14。范围：当前教师控制台四轮真实记录，以及候选解析、组件编辑、动态准入、提交后续行和恢复入口的直接代码路径。主体为只读审计，未再调用模型。按 Owner 明确决定，本轮只实施恢复入口调整；下述流程简化建议尚未实施。

后续修改已整理为 [AI 修改流程简化与正确性修复方案](../AI_EDITING_FLOW_SIMPLIFICATION_PLAN.md)，当前待审阅；方案不改变本报告的已实施范围与原始失败证据。

## 结论

现有流程确有会阻断合理修改的冗余门槛和过宽检查。最直接的是强制填写载体理由、全局单实例按页面/状态重复准入并受到固定总超时、局部修改携带全部工程素材。不能把这些成本归咎于模型。

但也不能把全部生成错误归咎于宿主。Luna 在这些记录中反复读错路径、手抄校验值、拼接转义出错，且没有自行发现两轮纹理无效。最终纹理修复接受了测试者明确给出的 CSS 根因，属于有反馈的修复成功，不能称为原任务首轮自主完成。

必要的校验仍应保留：目标与基线一致性、防止覆盖并发修改、源码可解析和依赖/素材闭包、必要的真实宿主行为、取消与迟到结果零写入、一次文档/资源事务。问题在于部分条件不服务这些目的，以及检查范围和继续条件没有随实际任务收敛。

## 已证实问题与建议

| 发现 | 当前证据与失败方式 | 维度与建议 |
|---|---|---|
| 强制“为什么不用低阶载体” | `src/shared/generationContract.ts:156` 对所有非 native 强制 lowerCarrierReason；`authoringToolCarrier.ts:6-8` 将现有组件 configure 和插入也映射为非 native。相同候选缺理由拒绝，填一个 `x` 就能通过该门。 | 当前可用性 P2。取消文字理由的执行硬门；保留可选创作说明。移动已有组件、改公开参数、用户明确要求源码修改都不需要重新选择载体。 |
| 全局单实例按页面重复验证，必然触发固定截止时间 | `src/renderer/components/componentPackageRevision.ts:94-104,131-134` 展开 location × state；`src/renderer/authoring/tools/dynamicCandidateAdmission.ts:145,199-202,217,221` 串行采样；`src/main/dynamicAdmission.ts:51` 从 loadURL 前起总计 20 秒。合法 20 页 V9 / 1 个全局实例构造得到 20 targets，每目标固定采样至少 1250ms，合计至少 25000ms。 | 当前可用性 P1。按不同宿主类型、有效参数及依赖状态选择必要验证，复用相同证据；截止时间应与必要工作量一致，不能只把 20 秒调大而保留重复验证。此反例是有效目标构造实测加确定时间下限推导，未跑 20 秒浏览器超时测试。 |
| 所有动态证据都强制额外模型回合 | `dynamicCandidateAdmission.ts:164` 一律写 requires-review；`src/shared/dynamicBehaviorObservation.ts:30` 也只允许该值；`generationTaskController.ts:248-250` 因而覆盖 finish 为 observe，`:279-293` 再起 CLI。`componentConfigureTool.ts:76` 的公开参数轻量验证也会产生此证据。 | 额外时延。区分执行成功、证据已采集、尚未证明的语义与实际未完成任务。仅当任务需要进一步判断/操作时续行；对交互或动画的实际观察仍有价值，不能全部删除。 |
| 局部修改受整个工程素材大小影响 | `dynamicCandidateAdmission.ts:105-107` 将全部素材及全部组件文件 base64 化；`src/main/dynamicAdmission.ts:21-22` 整体 JSON 上限 64MiB。工程素材合计 50MiB 时，仅 base64 就约 66.7MiB，未计源码和文档。`:139` 还先检查整个工程 Published 来源。 | 当前可用性 P2。提交受影响对象与真实宿主需要的资源闭包，避免无关素材/既有无关缺陷阻断局部修改。保留实际资源上限。 |
| 便宜的工具输入错误没有在本地预检发现 | `scripts/candidate-helper.ts:25-30` 查工具存在与静态目标条件，但没有使用工具 input Schema。`component.configure` 的 `{props:123}` 可得到 helperDiagnostics=[]，正式 input Schema 却拒绝。 | 反馈效率 P2。helper 使用宿主同源的廉价输入校验，参数对象/字符串投影在明确边界统一；把能立即指出的错误留在本地工具回合，宿主仍复核当前版本与实际运行。 |
| 每次实例编辑都再次 fork | `src/renderer/authoring/tools/componentPackageTool.ts` 的 instanceMode 每次调用 editableComponentPackageId 并 fork。三次实际编辑后包 ID 长度 76→122→168，工程包数量 2→3→4，重复追加 `.editable.UUID`。 | 已发生的维护与资源成本，未证明数据损坏。首次从共享包分离需要 fork；已经独占的可编辑包应评估原位修订、稳定 ID 和无引用资源处理，不能把历史副本无限堆进当前工程。 |

## 四轮真实记录如何解释

以下时间从持久化任务事件计算。外层测试脚本记录的 539 / 313 / 219 秒包含额外等待边界，和表中时间不同；两种数字不混用。

| output/playwright 下目录 | 真实确认配置 | 事件时长 | 正式宿主拒绝 | 结果 |
|---|---|---:|---:|---|
| teacher-controller-luna | Luna / medium / default | 602.4 秒 | 1 | 理由为 null，后续校验成功但末尾约 221.6 秒无输出，取消，未提交 |
| teacher-controller-luna-rerun | Luna / medium / default | 534.7 秒 | 2 | 缺理由、baseContentIdentity 长度错误；自动反馈后提交并 completed |
| teacher-controller-luna-fast-repair | Luna / medium / priority | 308.7 秒 | 1 | input 仍为字符串；反馈后提交并 completed，目录修好而背景仍为 none |
| teacher-controller-luna-fast-texture | Luna / medium / priority | 215.3 秒 | 0 | 本地 helper 另拒绝一次理由为 null；测试者给出精确 CSS 根因，随后提交并 completed |

合计 4 次正式拒绝，另 1 次本地预检拒绝。正式拒绝均发生在格式/元数据层，不能算四次不可运行源码。两次理由拒绝是冗余流程；错误 hash 的拒绝具有防覆盖价值，但让模型手抄 64 位值没有价值，应由可信快照和 helper 提供；input 包装错误是双格式传输负担，需要与真正非法的工具输入区分。

普通重跑第一次拒绝后约 89 秒才交下一候选，hash 错误又约 82 秒；这些时间包括重新读取和生成，不能全当宿主检查耗时。三次成功候选从 candidateParsed 到 hostCommitRecorded 约 2.3 / 3.0 / 2.7 秒。四轮完成原生命令累计耗时分别约 7.6 / 5.2 / 6.5 / 5.6 秒；主要等待发生在模型读取、生成及返工之间。最初末尾的 221.6 秒静默原因仍未证实，不能归因于动态准入，也不能凭空宣称某个模型服务故障。

四轮都曾把 cwd 当成 candidate root，尽管 `src/main/localAgent/profile.ts:176` 已说明 COURSEWARE_CANDIDATE_ROOT。模型确有执行疏漏；保留原生 cwd 有其目的，但当前路径发现方式没有很好地帮助模型一次找到工作副本。日志还包含整份 memory 148240 字符，以及近百万字符能力/历史搜索聚合输出；这是原始记录量，不能直接当成模型实际收到的 token 数，但说明读取方式有明显浪费。候选辅助工具应让路径、基线和输出文件直接可用，减少手工协议拼接，不应再新增一套交付协议。

## 实际质量与自动检测的缺口

Fast repair 的 `verification/result.json` 记录三枚书签 `background:"none"`，同时该轮有正式 committed 回执。动态准入检查能挂载、生命周期和静态后备，不等于证明用户要求的纹理出现。没有发现具体问题的 requires-review 也不应自动解释成整项任务必须再开一个模型回合。

Fast texture 的 `input.json` 已明确给出“encodeURIComponent 不编码单引号，CSS url 必须正确加引号”的修法。最终画面和控件位置检查通过，但这是测试者发现原因后的窄修复。四轮是同一课例的一次生成、一次重跑和两次反馈修复，提示与实现也在变化；不能用它们估算 Luna 整体可靠性或 Fast 提速比例。当前证据足以说：此流程下首轮自主完成表现不理想，宿主摩擦与模型执行/自检不足同时存在。

## 本轮已实施：恢复只在属性管理

删除 `TeacherControllerComponentHost` 的播放恢复按钮、Ctrl+Alt+Home 入口、临时默认控制台、DOM 按钮探测及其定时检查；保留原有错误诊断、生命周期和导航端口。此前的恢复按钮不是课件作者设计的一部分，而且还因 resume 早于布局显示产生过误报，确实不应注入授课画面。

属性路径为：全局层 → 教师控制台 → 控制台维护（默认折叠）→ 恢复默认控制台源码。操作明确说明会替换定制源码、可以撤销；继续走一次文档/资源事务，无新的 writer。

验证：教师控制台 9 项单测通过，含空控件及原快捷键不注入恢复 UI、默认控制与下一步；真实 Electron 属性操作确认默认折叠、显式恢复一次事务、撤销还原原源码，证据 `output/playwright/teacher-controller-maintenance/result.json`。类型检查、Player 与 Renderer 构建通过。真实重开最终课件确认播放中没有恢复入口，缩放/折叠/目录及独立定位仍通过，见 `teacher-controller-luna-fast-texture/verification/result.json`。其他审计项尚未修改，不能把建议当作已实现。

## 建议执行顺序

1. 去掉理由文字硬门，统一现有传输投影和本地同源预检，基线元数据由确定性代码承接。
2. 收窄动态准入目标与资源闭包，修复合法多页/大素材工程无法完成小修改的问题。
3. 按实际未完成任务决定观察和续行；把视觉/交互验证对准用户要求的属性。
4. 整理已有独占组件的重复 fork，控制包 ID 和资源增长。

这些是同一原生 CLI、同一工程真相、同一事务中的收敛，不需要重建 Agent 平台或取消必要的防覆盖/资源检查。

后续执行：上述“尚未修改”为本审计时点的历史状态。Owner 批准方案后，相关实现与验证已完成，见 [2026-09-14 实施记录](2026-09-14-ai-editing-flow-implementation.md)。其中理由字段按追加决定从正式协议删除，而非仅取消必填。
