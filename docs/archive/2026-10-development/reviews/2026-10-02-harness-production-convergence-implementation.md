> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../development-plan/CURRENT_STATUS.md)。

# R3 中断续接与工程收口记录

日期：2026-10-02。工作目录：`D:/果铃工作台`。续接基线：`main@28bdd7f5117bb2bd23e9a177b085a4377a91f8a1`；保留中断前全部工作树修改，未提交、未推送。

**结论：R3 的代码续接和已确认根因修复已完成，形成可运行的工程候选。真实数据多文件任务已完成，真实研究压缩后通过修复续接完成；不能据此宣布完整 2.0 验收或 Owner 接受。** 当前方法与范围以 [R3](2026-10-01-harness-production-convergence-plan.md) 和本记录为准。旧日志、旧失败与原件未改写。

## 1. 中断位置与保留的工作

中断时并非从零开发：聊天投影、浏览器惰性初始化、主模型与视觉助手分离、窗口预算、原生搜索、Skill 发布及 Runner 等修改已经存在。`output/g20/r3/final-regression.log` 记录 2026-10-01 21:29 的 34 文件／221 测试通过；真实 Electron、Edge、Podman 和有界 Luna 委派也已有相应证据。

未收口的是实际研究压力下的上下文／来源恢复、部分完成误报、真实数据的完整多文件交付与一次局部修改，以及与源码不一致的旧任务状态。本轮保留有效证据，只针对实际失败扩大检查；没有重跑全仓矩阵或重建执行内核。

## 2. 实施结果与直接消费者

| 范围 | 结果 | 直接证据与限制 |
|---|---|---|
| 聊天与状态 | 自然语言和成果为主体，工具详情可展开；参数阶段显示可读活动，并行只读开始／返回及时显示，回执仍按原生调用顺序进入模型 | `g20R3ConversationProgress`、Timeline／ReplyReadability 等及真实 Electron；保留上滚、焦点和取消语义。不承诺模型每一轮都一定输出文字 |
| 无关依赖隔离 | `beginRun` 冻结授权，受管浏览器首次实际使用才初始化；同服务去重、停止和清理；普通任务无需先准备浏览器代理 | 惰性／故障／停止测试；真实 Edge 同页面登录、接管、继续。内嵌浏览器按 Owner 决定后续处理 |
| D1 视觉 | 提交入口与动态工具图像均保留主模型；需要时由冻结的视觉角色读取真实图像并给主模型文字结论 | 附件与视觉集成、真实 Electron supported／fallback／unknown inherited 三分支；无视觉能力如实报告，没有静默换主模型 |
| D2 搜索 | 复用已有 DeepSeek 官方 API 连接的原生搜索，保留结构化 URL／标题／来源；合法无摘要结果可以开正文 | 原生搜索测试和真实官方搜索→正文→报告；兼容中转凭据不转交官方，无连接明确未配置 |
| D3 Skill | 内置直接引用可达，外部专用脚本与内置环境区分；主 Skill、生成能力与 bundled Skill 同批同步；新增研究／数据短 Skill | Skill 同源与路径测试。持续修改、原生／HTML／Runtime 按目标选择，不要求固定中间稿或整课 HTML 前置 |
| D4 上下文 | 输入预算包含实际序列化工具／系统／消息和输出预留；大附件索引化；动态压缩保留目标、决定、来源范围与正式回执 | 窗口与编译测试、128 次中文读取压力、真实压缩和显式继续。估算不是供应商精确 tokenizer；必要输入仍超窗时明确受限恢复 |
| 成果与终态 | 已声明计算输出通过 `artifact.save` 保存；已解决的私有计算失败保留警告；同源已覆盖范围的确定重读失败不永久污染终态 | 真实数据任务、局部修改与重开；未知副作用、不同来源／版本／未覆盖范围继续不算解决 |
| 单 Runner | 正式原生 CLI 发现与当前 Windows 沙箱配置可用，删除以环境 flag 宣告实际可写的做法 | Codex 0.159.3／gpt-6-luna／priority／ChatGPT，真实有界副本写入和父 JobService 回读成功；完整父模型采用成果并继续的组合尚未运行 |

文档内容、历史、保存仍归唯一 DocumentSession／Gateway；没有第二 writer、双 Runtime、ACP 或 Auto。普通编辑、受控构建与外部未知作用保持各自正式边界。

## 3. 本轮新消除的真实根因

### 3.1 多次较短中文结果累计超窗

旧逻辑按单条 8000 字符界线剪裁；多个低于该线的中文正文仍能共同撑满最近工具轮，而宿主事实摘要逐次累积通用读取记录，压缩后也可能继续增长。

`ExecutionEngine` 现在合并重复读取计数，并按 URL／版本保留来源与实际已读范围、原消息位置。最近结果共同超窗时按剩余输入与传输容量分配单结果片段，保留合法结构、准确 `nextOffset` 和真实截断；选定的收拢边界随检查点保存，后续不把旧大结果弹回请求。原始 RunStore 消息和原生工具配对不改写。

摘要只归纳实际归档内容，沿原模型路由做有界无工具生成。DeepSeek Chat 的摘要助手关闭思考并限制输出，避免仅消耗推理预算却没有交接正文；主模型参数与选择不变。短任务不强制额外摘要。

### 3.2 来源缓存寿命与上下文定位不同

网页临时正文仍在运行结束清理；原回执已持久保留 URL、版本与读过的正文。`context.read` 可把宿主实际返回的网页快照 ID 定位到本运行或明确继续链的原消息；消息位置读的是归档回执，不冒充完整新网页。

需要原回执之外的范围时，`web.open` 可按旧快照解析宿主已知 URL／版本，仍经新运行的权限与版本检查。允许 URL 与 sourceId 同时提供，避免把可恢复重读判为参数错误。页面变化不会冒充原引用；可以明确改用新 URL／版本。

### 3.3 已读来源重读失败误标 partial

实际研究已取得正文、保存引用报告，但末尾重复抓取遇到 DNS 失败，旧结算把整项标为 `partial`。现在仅当同运行已有成功回执覆盖请求的相同来源、所指定版本和范围时，确定失败的重读可视为已解决。未知结果、不同来源、不同版本、未读范围均保持未完成；原失败回执仍保留。

## 4. 真实任务：准确性、速度与首轮区分

### 数据多文件：完整交付及局部修改通过

证据：`output/g20/r3/resumed-real-compute-complete.log`；工作区：

`output/g20/r3/native-live-6284bcde-1074-4375-b06a-12d4c2e97fe4/workspace`

- 实际官方 DeepSeek `deepseek-flash`／API key／既有 Owner 授权计量账号；实际 WSL Ubuntu／Podman 固定 Python 镜像。
- 无 V9 任务，宿主读取原 `sales.csv` 后执行模型生成的标准库 Python。容器只见受管输入，脚本将读到的 20／22／31 以 CSV 文本嵌入再计算，结果如实标记 `FALLBACK_CSV_INLINE`；没有宣称容器直接读取宿主原路径。
- 创建任务 `completed`：71.082 秒、9 请求（含 1 次摘要）；已记录输入 150042／输出 19343 tokens。脚本、JSON、SVG 图表、CSS、HTML 与原始 CSV 六文件齐全，所有本地报告引用实际存在。
- 独立数据检查：总额 73，Jan=20／Feb=22／Mar=31，均值 24.33，最高 Mar／最低 Jan。HTML 从保存的实际文件重开，视觉检查为可读的报告。
- 随后仅修改报告加“复核合计：73”，`completed`：6.770 秒、5 请求；输入 53229／输出 987 tokens。原 CSV、脚本、数据、图表与 CSS 保留，再次保存重开正确。

此为修复后的完整真实样例；不改写 2026-09-29 Luna T1 的停止／缺图失败。71 秒不是整体性能对照，不据此修改产品默认模型或承诺普遍提速。

实际成果：[报告](../../../../output/g20/r3/native-live-6284bcde-1074-4375-b06a-12d4c2e97fe4/workspace/sales_report.html)、[计算结果](../../../../output/g20/r3/native-live-6284bcde-1074-4375-b06a-12d4c2e97fe4/workspace/sales_results.json)、[Python](../../../../output/g20/r3/native-live-6284bcde-1074-4375-b06a-12d4c2e97fe4/workspace/analyze_sales.py)。

### 研究：正常链与压力修复续接分别记录

中断前 `real-native-final.log` 中真实官方数据报告 47.759 秒、研究报告 49.116 秒完成，证明搜索／正文／带来源交付。之后专门以 32k 声明窗口做研究压力样例，曾暴露累计中文结果、空摘要和来源恢复故障，这些失败没有删除。

最后保留的实际压力原运行在：

`output/g20/r3/native-live-7180f3aa-f6cf-4b7e-9525-bf6d9a22d742`

它已读取 Python 官方 CSV／JSON 正文、发生压缩、保存 `research.md`，原终态为 `partial`，25 请求中 11 次摘要；已知输入 227462／输出 19100 tokens。报告明确区分文档事实和项目建议，记录 URL、版本及实际读过的范围。

修复后复制其运行日志到新的隔离证据根，显式继续原任务；没有改写原 journal 或重做研究：

`output/g20/r3/native-live-368e0d01-041e-43ee-914e-11bf2a9866ca`

新运行 `completed`，8 请求（含 2 次摘要），输入 61938／输出 4413 tokens，测试中任务等待 36.78 秒、总耗时 38.85 秒；报告与原 CSV 均保留。这是**修复续接成功，不是干净首轮成功**。未测本轮全部调用的账户实际金额，不能用 tokens 推断费用。

实际成果：[带来源研究报告](../../../../output/g20/r3/native-live-7180f3aa-f6cf-4b7e-9525-bf6d9a22d742/workspace/research.md)。它证明搜索与压力续接，不覆盖 T2 的 PDF／DOCX／PPTX＋启用用户 Skill 完整组合。

## 5. 最小充分验证与证据沿用

| 证据 | 结果／证明范围 |
|---|---|
| `final-regression.log` | 中断前 34 文件／221 测试通过；无变化分支沿用，后续变更分支以以下新检查替代，不把 221 称为最新全矩阵 |
| `resumed-aggregate-context.log` | 3 文件／57 测试；执行器、压缩及相关投影／结算 |
| `resumed-gateway-source-fixed.log` | Gateway 1 用例；按需工具族显式加载，URL＋sourceId 合法 |
| `resumed-read-outcome.log` | 2 文件／40 测试；正确结算已覆盖重读与未知／不同版本／范围反例 |
| `resumed-context-final.log` | 最新 3 文件／26 测试；128 次中文读取、决定与来源、明确继续、归档快照／新 URL 重读 |
| `e2e-main-progress.log` | 真实 Electron 可读进展与折叠工具 |
| `e2e-observe-fixed.log` | 真实 Electron 图像进入正确 supported／fallback／unknown inherited 路由 |
| `resumed-e2e-authoring.log` | 2 真实 Electron 用例；课件首次打开直接人工编辑保存重开，Markdown 中文／emoji／换行增量投影与单次正式提交 |
| `managed-browser-real.log` | 2 真实 Edge MCP 用例；同页登录／接管／继续、文件范围、停止清理 |
| `real-podman-final.log` | 真实受限计算与成果保存重开；模型 fixture 单独注明 |
| `runner-exact-live.log` | 真实 Luna Fast 副本内生成精确内容，父 JobService 回读，副本外哨兵不变，14.26 秒；取消／unknown 复用服务近层证据 |
| `resumed-real-compute-complete.log`／`resumed-real-continuation-complete.log` | 上述真实数据及修复研究续接，不是 fixture 或跳过用例 |
| `resumed-closeout-typecheck.log` | 最新 renderer／main／e2e 类型检查通过 |
| `resumed-final-build-renderer.log`／`resumed-final-build-electron.log` | 最新产品源码两端构建通过；renderer 仅既有 chunk／动态导入提示 |

权威JSON、任务页、验收表与阅读器已同步，`refresh_plan.py`保留文件原换行以避免Windows产生整份无关差异；`validate_plan.py`通过，44任务／241总用例／48需求／98阅读器文章。该检查证明计划制品一致性，不能替代产品测试。当前2.0范围236项中223 passed／10 not_run／3 blocked；另4项发行准备与1项媒体后续仍为not_run。完成工程卡已移除，任务板重新生成。

使用 agent-browser 做隔离真实窗口选区／AI 卡检查和实际报告视觉检查，没有发送额外模型请求。真实模型任务使用 `output/g20/r3` 下的测试资料，其余检查使用隔离profile与fixture；审查窗口、报告浏览会话及测试进程已清理，未触碰真实业务资料。

失败记录中 `initial`、`corrected`、`runner-final-live`、`core-integration-matrix` 及早期 `resumed-*` 失败是定位过程，不作为最终通过。阶段统计有重叠，不相加成新的测试总数。

必要的无密钥文本日志随 [R3 证据登记](../../../../GPTpro方案/guoling_2_0_execution_plan/evidence/R3_IMPLEMENTATION_2026_10_02.md) 保存；没有复制凭据或完整用户会话到计划包。

## 6. 权威状态与剩余边界

- **M29-T01、M30-T04 改为 passed**：实际官方搜索与完整真实数据文件／修改重开消除了原阻断／失败，旧日志保留。
- **M29-T04 改为 not_run**：CLI 可写阻断已消除，真实 Runner＋父服务回读已经通过；整项还缺实际父模型采用并继续的组合证据，不把单个服务测试替代它。
- **M30-T05 改为 not_run**：真实搜索和压力续接已可用，旧“未接通搜索”不再是阻断；完整三格式材料与 Skill 的组合仍未运行。
- M25-T03、M27-T03/T04、M28-T04、M30-T01/T02/T03 保留原 not_run；已有分支和局部界面证据不替代其完整定义。M28-T03、M30-T06 的独立图像链和 M30-T07 完整外部异步组合保留 blocked 及具体缺口，不伪装接通。
- **M30-T08 仍 not_run、Owner 必须签收**。任务板只描述当前代码协调；完成工程卡删除不意味着这些验收通过。M25／M27／M28／M29／M30 保持 implemented，M26 维持 verified。
- 音频／视频／音乐的真实生成、内嵌浏览器及安装分发按现行授权单列；没有新增凭据、采购、管理员安装或收费路线。

剩余整版组合验证和 Owner 接受不是已经完成的事实。R3 修复中的用户可见根因已在当前支持环境消除；没有未说明的同因重试、静默静态化或通过数冒充产品完成。
