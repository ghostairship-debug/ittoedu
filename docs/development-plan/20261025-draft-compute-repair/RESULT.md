# Python开发测试载体及属性草稿核实修复

状态：2026-10-25已修复并集成，相关检查及实际路径通过。Python开发测试载体已修；3条旧属性失败逐项核实，其中数值／公式无需改产品，文字同链两种真实丢稿已修。新的UI、模式或路径先确认；未commit／push／发布。

前轮定位和未决依据：[Python调查](../20261025-format-core-repair/PYTHON_INVESTIGATION.md)、[三个属性草稿失败](../20261025-format-core-repair/APPEARANCE_RESULT.md#5-三个未通过的既有草稿切换问题)。历史报告与原始失败不回写为当时已通过。

## 已核实的产品影响

| 项目 | 当前事实与处理 |
|---|---|
| Python开发测试载体CA246 | 已修。一次性Vite测试不再启动其不使用的文件监听；原实际Worker、本地Python、四项计算／请求策略断言及60s上限保持。Root原配置、无候选适配，完整1/1通过、0skip、4,815.6ms。[结果](COMPUTE_RESULT.md) |
| 第1条：普通属性草稿切换 | 原例使用非正式first／second key，期待非IME旧DOM一直保留。真实数值输入、切走、返回恢复及取消正常；应保留正式JSON身份、原raw与不误写B的保护，不能恢复冻结旧面板来迎合断言。 |
| 第2条：公式草稿切换 | 真实公式raw停放、返回恢复、取消及Main durable记录正常。停放raw时flush=true不等于把A公式写入B，也不等于丢稿；不需要改公式UI或生产实现。[实际入口证据](DRAFT_PATH_RESULT.md) |
| 第3条及直接关联文字草稿 | 确认两种真实丢稿：真实图层点击导致IME失焦后，A最终中文未被接纳却被标记为已完成，切回仅有原文；无blur切到B、A仍占原编辑会话时，B接收输入但flush虚报成功，Main无变化、History为0、B raw也不再登记。需要修产品。[实际入口证据](DRAFT_PATH_RESULT.md) |

文字问题发生在受支持的属性编辑和对象切换中。触发时序有条件，不是全部编辑阻断；后果是用户输入丢失，应修复。没有频率遥测，不将特定时序冒充普遍高频故障。数值和公式旧例不据红灯抬为产品缺陷；Python属于开发维护／验收可靠性问题，不据此推断正式Python不能运行。

## 修复边界

Python只改CA246自己的Vite装配。文字修复在现有属性命令与TextContentTextarea之间传递真实提交结果，核对捕获对象及本次raw，成功回执到达后才推进baseline；拒绝时保留原稿、原owner及可恢复性。同步本地暂存的专业编辑器仍使用原语义。继续使用现有DocumentSession、草稿登记、恢复与History；没有新建writer或草稿系统。[实现、原三例与精确白名单](DRAFT_RESULT.md)

普通换选立即显示新对象控件、活动IME保留原DOM到compositionend的当前策略保持。没有新增布局、入口、模式或操作步骤；暂不commit、push、打Portable、发布或部署，其他dirty、真实作品和历史证据保全。

## 验证与实际边界

- Python已完成候选独审及Root原环境完整1/1；原历史超时证据保留。
- 两个直接属性测试文件最终44/44通过、0skip，包含原三例的等价保护、真实B拒接纳、提交拒绝／重试、一History保存／新Host冷开及同步专业暂存。原ownership文件14条未修改，完整运行通过。原43/43及独审拦下的迟到ACK问题保留记录；补齐新IME保护和单一反例后才集成。
- Root按3产品＋1属性测试的精确白名单接收，逐路径保护本轮起点已有dirty；原测试增量未丢，未整树回流其他改动。Root `npx tsc -p tsconfig.json --noEmit --incremental --tsBuildInfoFile output/typecheck-cache/main.tsbuildinfo` exit0；相关源码／测试diff检查通过。Electron等未受影响的原有效证据复用。
- 同一真实RightSidebar浏览器链Root修前确认丢A最终中文，修后完整1/1通过、0skip、10.54s、0pageerror。A活IME DOM保持；最终raw停放在A，B拒绝提交时A／B两份raw均保留；返回A恢复并用既有Esc取消，再返回B恢复、原flush／drain后Main正文正确且frame不变。最终History2为公式一次＋B正文一次；没有误写A。[实际入口结果](DRAFT_PATH_RESULT.md)
- [独立审查](REVIEW.md)核实现、原三例保护和原始结果；没有删除正确断言、skip／exclude旧例或抬timeout来洗绿。历史全量基线及修前失败原样保留，不宣称全仓通过。

本包IME证据覆盖真实浏览器DOM composition协议与实际点击／失焦时序，不等同Windows物理输入法验收。没有新增模型或收费请求，没有改真实用户工程，未commit、push、打Portable、发布或部署。
