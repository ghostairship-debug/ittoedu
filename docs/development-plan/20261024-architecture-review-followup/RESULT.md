# 架构审查后续维护结果

2026-10-24。架构基线 `7952cc24`；Owner另已明确要求将原有统一选中、作品等全部未提交成果一并commit并push。原成果保全，不调用付费模型，不打Portable、发布或部署。

| 范围 | 结论与唯一owner |
|---|---|
| 四条回执夹具 | 仅维护 `publicWriteReceipt20261020.test.ts`：按 `instances / object-0 / data / html` 精确路径读取内部字符串值。内部完整值、公开小回执、原操作查证、幂等及Undo断言保留，产品回执不改。 |
| Engine六条失败 | 基线57项／51过／6失败；维护后完整文件57项／55过／2失败。下述两条合同断言未改，失败未隐藏。Engine产品源码未改。 |
| 互动规则 | `componentInteractionData.ts::planComponentRuleChange`成为列表变更owner，复用原复制身份、级联删除、分类移动、规则解析及edits算法。Gateway保留引用解析、授权、replace和提交；AutomationTab保留界面patch与捕获。删除两处生产入口及保留适配器的重复列表操作，缺失规则统一诊断。 |
| 命名状态 | before对照证实实际AutomationTab原本正确；仅测试调用的 `createInteractionAuthoringActions`读取基态错误，现改读已有editingProject。没有把该适配器缺陷称为已复现的生产GUI错写。新增真实AutomationTab回调→Bridge→Session检查覆盖基态／另一状态不变、一次History、Undo和归档重开。 |
| Flow清理 | before的元素／媒体／组件包三条路径均通过切分关系检查，未发现原数据错误。将中间切分不清理的决定收回现有 `prepareFlowBodyInsertion`，删除调用者可选开关；完整插入由Bridge捕获最终批次并清理。保留行内归属、跨段注释、读序、非折叠选区按逻辑末端插入、Undo／Redo及重开；不声称提速。共享错误文案不再出现工具参数名at。 |
| 导航 | README／CURRENT_STATUS各八条架构行合为原批次一行＋本轮一行，统一选中独立保留；原审计README／REPORT／IMPLEMENTATION_PLAN的堆叠前言合为当前入口，§9—§15及锚点原位保留。旧统计不回写，未追加其他工作包、测试声明警告或发布构建改造。 |

Engine逐条定性：

| 原失败 | 本轮事实与裁决 |
|---|---|
| 压缩后的原生工具轮角色 | 宿主当前工作事实已经是user角色；旧过滤器仍只识别旧system快照。更新精确宿主前缀识别，原工具调用配对、授权、一次写入／Undo全部保留，通过。 |
| incomplete参数进入消息 | “未完成”命中系统推进说明；实际工具零执行、revision／Undo均0、残缺参数留在本地请求记录。改查专用残缺JSON及`<article>未完成`载荷，保留不执行／不重放与恢复检查，通过。 |
| M15并发预览 | 夹具误把最后一条宿主user数据当作A/B指令，导致未进入A预览而等待超时。改按精确A/B夹具指令路由；两个实际Session写入、另部位预览存续、两次Undo深度和预览清空均通过。未延长timeout，无并发产品修复。 |
| OAuth完整轮归档 | wire已按投影正常退休旧整轮，无需预算压缩，所以compacted未生成。改验证旧轮来源和结果定位、近期call-2／call-3及原生配对；旧MARKER不重现、近期完整签名载荷与Run中原文保留，通过。 |
| 祖先作业取消 | **合同未决，原例仍红。** 现行owner合同只准接续读成果，禁止取消原run作业；HostToolServices在调用取消服务前拒绝，实际返回invalid-operation及明确消息，旧例期望job-not-authorized。消费者是Gateway／MCP工具结果及模型失败处理；此前§14真实归属／零取消证据复用。建议保持权限与现行为并维护语义断言；若要求稳定授权错误码，则另选原owner错误分类修复和消费者验证。未替Owner作此选择。 |
| programmatic子调用间steer | **合同未决，原例仍红。** 调整已接受，只有read执行；text.replace为not-started／steering，revision／Undo均0，旧programmatic调用cancelled，按新要求报告后的任务completed。旧例期望partial。消费者是ExecutionRunRecord、任务结束摘要与前端任务状态。建议保留“旧调用取消、当前目标完成”的两层状态并维护旧预期；若要把整任务固定partial，则需另行确定对接续／界面含义的影响。未改变任务终态。 |

最低充分验证（原始JSON／日志本机保存在 `output/architecture-review-followup-20261024/`，未以skip／零匹配计通过）：

- 回执文件10／10；完整Engine文件55／57，剩余为上表两条合同断言。
- Flow及直接消费者8文件55／55：flowBodyInsertion、auditGatewayInsertionLayout、nativeInsertAppearance、glxFlowCanonicalOwnerInsert、g20M16FlowMenuComponentInsertion、libraryInsertionRecovery、componentLibraryMetadata、flowTextRelationshipBatch。
- 互动新增3／3；courseV10StoreLifecycle 7／7；componentInteractionExperience 4／6，暂停恢复订阅计数和教师按钮旧夹具两条失败在HEAD源码before覆盖中同点复现，均不属于本轮规则规划变化，原断言未改。before的新反例另确认了适配器基态读取和GUI静默忽略；修后通过。
- `npm run typecheck`原主／Electron／e2e三段通过。新夹具类型错误已修正；已通过的行为证据不因纯类型标注变化重跑。诊断副本首次include继承过宽已停止、改为精确单文件，其输出不计验证。
- 原有统一选中的独审、真实浏览器、保存冷开及构建证据沿[原结果](../20261024-unified-selection-editing/RESULT.md)复用，不扩大为完整Electron或全仓通过。未启动新浏览器矩阵。

集中独审：未参与实现的architecture_review核对本轮实际diff、直接消费者、before与原始验证后通过，无必须修复的阻断项。确认共享决策、命名状态／History、Flow最终清理与Engine夹具等价维护，现有证据充分，无需扩测；原有未变成果的有效独审复用。

Git：Owner授权范围包含本轮全部增量及启动时保留的51份tracked修改、28个untracked文件（含统一选中、咖啡runtime-first制品）。明确路径清单共93文件，按原有统一选中等69文件、原有作品制品8文件、本轮维护16文件分成三个提交；原始作品和已有制品不改写。提交与push完成后以Git日志和同次交付记录为准；发行继续暂停。
