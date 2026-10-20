# 决定性验收与验证实施说明

2026-10-20。下列保留原验收要求，逐项实现、实际消费者证据与未通过限制以 [IMPLEMENTATION_RESULT.md](IMPLEMENTATION_RESULT.md) 为准；调查基线见 EVIDENCE。要求清单本身不作为通过记录。

## 使用规则

按工作包运行受影响检查，汇合后做必要跨消费者闭环。这里的条目是必须保持的行为断言，多个断言可以由同一 fixture/测试覆盖；不是要求每条都建独立进程、运行完整创作或全矩阵。未经相关修改影响的旧有效证据复用；新验收不能以 skip、零匹配、仅类型通过或模拟数据替签实际消费者。

建议将新增反例并入相邻现有测试；只有缺少清晰归属时新增一个薄测试文件。不要建立“回执测试框架”“布局测试平台”或第二套测试调度器。

## A. 公开回执与上下文

| 编号 | 用例/操作 | 必须证明 |
|---|---|---|
| A01 | 同样1/4/16个写项，源内容分别为1KB、1MB、5MB | 公开写回执不含全文输入、音频/图片字节或全量 changes.value；大小主要随目标数/真实诊断增长，不随源文长度增长 |
| A02 | 四项批量修改，单一正式事务 | 顶层一个操作/版本事实；子项不重复整批事务；准备失败项与已提交项如实区分；现行批语义保持 |
| A03 | Source 正常写、enhance、新生成短入口 | 大正文不回显；小型有用入口可按预算给完整值；片段有明确 complete/preview 标记；实际路径/版本/视口仍足够接续 |
| A04 | 无效HTML/JSON、目标缺失、部分错误，错误输入2MB | 错误消息有精确修复信息和原来源，但不把原始 input/content 整份嵌入；错误严重性与提交事实未被删掉 |
| A05 | committed/unchanged/not_committed/unknown、lookup 后查证 | 内置/PTC/MCP/UI解释同一事实；重复 operationId 不重写；用户自编“commit:committed”JSON不被当真事务 |
| A06 | PTC 值为长字符串、大对象、数组中单个大元素 | execute与read在模型可见层都受预算；目录/字段/范围可继续取回；软件内部原值完整，不能靠模型主动limit才能存活 |
| A07 | job detail=diagnostic、日志、delegate结果、context.read | 诊断仍可看懂，但大ledger/summary不突破出口；记录引用保权限与来源；已取消/未知作业不被变成成功 |
| A08 | project.read默认/full及分页跨版本 | 默认合理，full不伪称完整；后续页仍取同一版本，变更可明确刷新；没有每成功写都强迫重新读全工程 |
| A09 | 最新工具轮、旧工具轮、工具结果被嵌入续接user消息 | 最终实际请求有界；原生调用配对与真实参数保持；不能只压message.content而原生output仍带全文 |
| A10 | ChatCompletions/Responses/Anthropic本地模拟请求 | 各自序列化后检查字段/总量与协议合法性；不篡改签名或思考块，不借兼容转换悄悄发重复工具 |
| A11 | 必要调用参数/用户输入本身确实超窗 | 一次可恢复状态和原来源，不重试同一超窗请求、不重放写、不丢失已完成结果；支持合法恢复时沿原任务继续 |
| A12 | ACK后发生人工并发修改，再调用edits/update | 新人类值未被标成模型已读；只对已知ACK/确实读过的内容继续；CAS冲突仍真实；精简回执不破坏撤销恢复 |

预算测试应检查 JSON 实际编码后的 UTF-8 字节以及实际适配器的 token 估算/上限；不把中文字符数乘固定系数当精确token。写回执采用**尺寸不随源文变化**的相对断言，避免写死4,829这种历史样本值。内部记录/导出允许存大对象，验证公开层不得反向污染内部数据。

**现有落点**：`tests/integration/programmaticToolRunner20261019.test.ts`、`tests/unit/g20ContextProjection.test.ts`、`tests/integration/g20ExecutionEngine.test.ts`、`tests/integration/g20ExternalMcpService.test.ts`、`tests/integration/auditContentApplyTruth.test.ts`、`tests/integration/currentSourceSave20261019.test.ts`；先按实际相邻测试内容复用，别把文件名当作覆盖证明。

## B. 动作、取消与恢复

| 编号 | 故障注入 | 必须证明 |
|---|---|---|
| B01 | frames.act返回applied=true，后续observe抛错 | 回执保应用确认，goal未验证/取证失败独立；执行器不会自动再点一次 |
| B02 | 已派发后无ACK，或值不匹配 | unknown与已测mismatch不同；两者都不抹去可能已触发事件；后续安全观察可继续 |
| B03 | 两个纯读，第一个永不返回、第二个迅速完成；随后Abort | 当前工具轮可结束；第二结果已存在的事实不丢；真实用户Stop后无新模型/新未开始工具；没有挂起等底层承诺 |
| B04 | B03在局部超时后释放旧第一个读取 | 晚结果仅入原尝试收尾，不覆盖新run、句柄或已结束工具状态；promise无未处理拒绝 |
| B05 | PTC脚本已返回但有一个未await纯读/未知写 | 纯读可按规则退役；已开始写仍留原身份与未知副作用，不用取消伪造回滚或重发 |
| B06 | 观察窗口销毁、renderer退出、read/select/capture无响应 | 复用现20秒故障/关闭出口，明确返回；关闭后新观察可用；不能回退到URL里传数MB正文 |
| B07 | 旧run结束且旧读句柄失效；新run同文档新句柄观察 | 旧尝试退役；等价验收有证据则承接，无证据则未验证；无关工作不被整局阻塞 |
| B08 | 原run未知写 + 当前rev13已保存导出 | 未知影响仅阻塞有依赖步骤；UI/最终状态分别陈述保存、导出、验收；不擦除unknown或伪称未保存 |

“取消后仍归档已经发生的动作结果”属于必要行为，不应写成测试失败。测试重点是当前等待能结束、停止后不新开工作、晚结果不污染新代际以及不重放副作用。timeout在fake timers/可控promise中验证，避免测试真的等20秒或让真实用户应用挂死。

**现有落点**：`g20ReadOnlyParallel.test.ts`、`programmaticToolRunner20261019.test.ts`、`g20HtmlActions.test.ts`、`g20HtmlActionsTools.test.ts`、`g20ExecutionEngine.test.ts`、`g20ExecutionOutcomeR7.test.ts`；运行期本包相关叶子，不强制每个包跑所有文件。

## C. 混合装配与资源

| 编号 | 实際输入/操作 | 必须证明 |
|---|---|---|
| C01 | 普通标题+正文+图片+正式Next | 普通内容独立可编辑；不会仅为Next把全部正文放进一个程序；不以原生对象数替代可编辑性 |
| C02 | 外层普通HTML/CSS + iframe相对文件或srcdoc局部活动 | 正式装配后外围独立；程序保自己共享状态；相对资源、输入、局部视口和导航都真实工作 |
| C03 | 具有外层DOM跨块依赖的合法程序 | 仍保真整体运行，不移除脚本/复制假按钮/静态化；提示明确实际承载能力 |
| C04 | application/json、form/CSS状态、持久作者记录、measurement失败 | 不把JSON当执行脚本；form owner/样式依赖保持；不能为拆分丢作者记录；测量降级可用但未验证状态正确 |
| C05 | 已有program普通改字；明确container redo | 普通改字保身份/frame/邻居；明确redo才在许可范围重新装配；不可靠映射的记录保留并给诊断 |
| C06 | audio相对引用、直连data URI、JS动态拼接数据 | 前两条走正常资源化；动态情况保源并给真实分析边界，不执行JS猜资源、不整作拒收 |
| C07 | 素材job/source→采用→局改→另存冷开→离线播放 | 模型不搬Base64；临时URL不成为持久事实；资源有效字节/身份保持；无额外网络或新供应商调用 |

一份小型混合工程可同时覆盖多个断言。三个纯分类probe不等同C01/C02实际装配成功；必须读正式结构并操作其运行/编辑消费者。保留整个程序是合法结果的C03必须与可拆案例一起留作防回退。

**现有落点**：`contentApplyCourseTheme.test.ts`、`auditContentApplyTruth.test.ts`、`currentSourceSave20261019.test.ts`、`g20HtmlImportClosure.test.ts`、`nativeDelegation20261019.test.ts`、`uiDocumentSnapshot20261020.test.ts`、资源URL租约现有测试、现有Published/Source编辑相关测试。具体文件按repo搜索确认；不在源码未读时臆造测试覆盖。

## D. 局部空间策略

| 编号 | 场景 | 必须证明 |
|---|---|---|
| D01 | 固定设计1280×720，实际局部1040×570/590 | 净可用区域来自宿主与真实content box，模型不手算两套；变换/边框/内边距不重复扣除 |
| D02 | 主动作在下方、正文偏多 | 声明的动作区域持续完整可见，body/feedback按合法布局伸缩；无隐藏正文或统一缩字 |
| D03 | 最长正常反馈/辅助原文展开/图片字体迟到 | 软件重新执行已声明策略；主要动作可达；不是仅初态好看；没有无限observer读写循环 |
| D04 | 允许辅助滚动的目录/原文，以及Flow文章 | 合理滚动不被误判为失败；固定舞台和Flow采取不同规则 |
| D05 | hidden/clip、横向溢出、嵌套滚动、按钮被祖先裁切 | 不能因为scrollHeight看似正常/滚动条不显示就签通过；诊断精确到目标与原因 |
| D06 | 人工frame/字号或几何覆盖、locked、未授权外来HTML | 保人工改动与授权范围；运行时不写dirty/History；未声明内容仍可接入 |
| D07 | 运行代际替换、取消、保存冷开、Published/离线 | 旧observer不写新实例；声明穿过正式装配链、派生值不持久；软件helper不回写成作者script导致整页保源；所有实际采用消费者语义一致 |
| D08 | 空间确实不够且所有合法变体均不足 | 返回具体超出、已试策略与所需语义决策；不强行压字、裁切或扩框压邻居 |

第08页副本与一页动态反馈副本是观察基线；技术fixture用于稳定回归。测试不要求全部作品24px字号，也不要求任何情况下无滚动；按当前作品约定、关键操作与实际内容类型验收。

## E. 成果承接和显示/业务一致性

E01：模拟采访填写 → 记录原输入及核对状态 → 正式下一页消费；后页不恢复Sam预置答案，不把错误输入静默修正。覆盖首值、重复订阅和前页返回；不强制满分门。

E02：完整句输入转为短字段显示时转换明确且可追溯；课程运行reset与作者数据分开；复制不意外共享不同尝试的答案，已有明确共享语义保留。

E03：沿一个真实可编辑业务入口改题目/人物数据，显示和判断共同消费当前数据；单纯DOM文字覆盖的边界如实说明。先复现现有路径，未复现不同步不写成已修bug。

## F. 条件风险与总集成

F01：合法制品携一个warning，应展示适当诊断但不报“课件加载失败”；真实fatal仍明显且可追溯。条件路径未触发则记录，不人为制造普遍失败结论。

F02：factory初始化throw、dispose reject，资源租约/监听/剩余实例继续清理；首个真实错误不被后续清理错误覆盖。用短故障注入验证，不以静态可疑代码直接宣称内存泄漏。

F03：能力生成/检查、相关类型检查、必要Main/Renderer/Player构建；隔离profile的小型工程编辑→运行→Undo→保存→冷开→导出闭环。0个真实新作者请求、0个新收费供应方请求；这些事实由实际日志确认。

## 建议命令与命令边界

以下前三文件命令已在本轮执行，24项通过，属于**基线**：

```powershell
Set-Location -LiteralPath 'D:\果铃工作台'
.\node_modules\.bin\vitest.cmd run `
  tests/integration/programmaticToolRunner20261019.test.ts `
  tests/integration/g20ReadOnlyParallel.test.ts `
  tests/unit/g20ContextProjection.test.ts `
  --reporter=json --outputFile=output/repair-plan-deepening-20261020/baseline-focused-tests.json
```

继续实施时新结果写入本次执行目录，别覆盖基线。使用直接vitest可避免 `npm test` 的pretest自动构建；但最终验证Player/导出消费者时必须完成必要构建，不能一直绕过它。

现有脚本可按变化采用：`npm run typecheck`、`npm run generate:ai-capabilities`、`npm run check:ai-capabilities`、`npm run generate:component-sources`、`npm run build:player`、`npm run build:renderer`、`npm run build:electron`。不要默认运行 `npm run verify`、全部e2e、全部示例刷新或dist:win。实际新增测试路径由Codex按实现写入结果报告，不能把规划中的文件名当已存在。

## 最终结果报告必填事实

代码改了哪些owner；每个工作包对应哪些反例；真实consumer是否验证；运行时/手动编辑/保存/导出哪些通过、哪些未验证；原文件与dirty改动如何保护；发生过的失败和修复前结果保留；有无新收费请求；是否修改AGENTS/提交/发布。未做的一律写未做。

不要用软件测试通过替签真实作者的速度、质量或最终用户验收。下一轮参考创作会专门检验“模型实际是否选择了新路径”。
