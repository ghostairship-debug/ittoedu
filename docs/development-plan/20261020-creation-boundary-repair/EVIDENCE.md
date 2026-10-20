# 事实、反例与源码依据

日期：2026-10-20。此文件为执行方案的证据索引，**不表示修复已经实施**。

## 1. 调查边界

本轮直接读取 `D:\果铃工作台` 的当前源码、AGENTS、开发状态、现有 Skill 和此前原始调查结果；发现中断前已经留下的探针后，重新执行生产函数探针，并另写错误回执/媒体抽取探针。还重跑了三个相关测试文件。

HEAD 为 `a8882691eefd1f24853571296d5a3a90d45f90b5`。2026-10-20 15:35（UTC+8）再次核对：232 个已跟踪文件差异，3635 行新增、14433 行删除，与本轮开始一致。已有差异来自此前多批开发；不能全部记为最后一次 Codex 的新增改动。完整源码基线与证据身份见仓库 `output/repair-plan-deepening-20261020/evidence-baseline.json`。

本轮只在研究输出目录新增/刷新自己的证据文件，随后新增本方案目录。没有修改产品源码、AGENTS、已有开发状态、冻结作品或配置；没有重启应用、做发行构建、调用收费模型或新跑完整作者。下面明确区分：

- **历史真实运行事实**：上一轮已独立读取原始记录，本轮引用并用当前源码追查，未再次完整重演。
- **当前生产函数反例**：本轮运行真实生产函数，但输入为隔离构造；证明函数边界缺口，不冒充真实用户会话再次失败。
- **源码确定路径**：代码明确存在相应分支；实际损害程度仍由具体用例决定。
- **条件风险/设计建议**：需要短故障注入验证；新接口均以执行方案中的“拟议”标注为准。

## 2. 巨型回执的历史组成与当前直接修复

原运行 `19ad560e-b8cf-451a-a93f-8caf89c7df53` 在工具已返回后，因准备下一次模型请求超出窗口而停止。历史记录位置：

```text
output/creation-quality-execution-20261020/verification-prep/author-run-third/
  root-core/context-window-stop/continuation-run-partial.json
```

上一轮直接拆解原记录得到：`programmatic.execute` 结果为 34,371,419 个 JSON 字符，子 `project.apply` 为 34,370,053 字符，仅涉及四项正文修改。每项返回自己的完整输入，同时带上整批事务；顶层再带同一份事务。约 5,727,875 字符的整批事务内容被重复五次，前轮逐份比较相同。

四份 HTML 源文长度分别为 1,565,630 / 1,573,869 / 1,165,421 / 1,420,638 字符，其中音频 Base64 分别占 1,561,892 / 1,561,892 / 1,154,168 / 1,416,368 字符，合计约占 99.45%。这支持把根因分为“媒体进入源码载荷”与“公开回执重复内部载荷”两条链，而非一味扩大模型窗口。

**必须保留的修复事实**：上一轮已经把同一历史回执送进当前 `modelToolResult`，得到 4,829 字符，证明直接的专门投影有效。本轮不是宣布这项修复无效；问题是重结果仍先生成，且其他返回/读取路径可以绕过这种特定处理。

当前生产者与消费者：

| 位置 | 已确认行为 |
|---|---|
| `src/core/contentApply/planning/types.ts` | `ContentApplyResult` 同时携带完整 `input` 与事务 `receipt`。 |
| `src/main/workbench/contentApply/applyService.ts:507–530` | 成功、未提交和未知分支返回完整输入；内部结果有恢复价值，公开回执不必照搬。 |
| `src/core/projectFiles/componentPlatform/coordinator.ts:551–628` | `contentReceipt` 从 `{path,...result}` 构造结果，并可能回传 Source 内容。 |
| 同文件 `633–687` | 合批包含逐项 outcomes，顶层另带共同事务。 |
| 同文件 `972、974、1029` 附近 | 失败结果可以携带 `input:raw`，源输入可能很大。 |
| `src/core/tools/modelToolResult.ts` | 特定成功形状会删源码/变更值，未形成全部公开结果的最小充分生产契约。 |

**方案判断**：内部事务日志、公开写回执、明确内容查询应分别承担职责。保持同一真实事实来源，无需新建另一套数据库或操作台账。

## 3. 本轮重新执行的四类边界探针

位置：`output/repair-plan-deepening-20261020/boundary-probes.ts` 和 `boundary-probes.json`。本轮执行时间为 `2026-10-20T07:17:36.132Z`。

这里的计量是 `Buffer.byteLength(JSON.stringify(value),'utf8')`；它与上一节的历史字符数口径不同，不能直接当 token 数。

| 隔离输入与路径 | 输出计量 | 所证明的缺口 |
|---|---:|---|
| `project.apply` 合法回执形状中 `files[0].content` 含 200 万个 `x` | 原值 2,000,423 字节；公开投影 2,000,405 字节；最新工具消息仍约 200 万字节 | 专门裁剪 `input/receipt` 没覆盖 Source 回传。 |
| `job.status detail=diagnostic` 的诊断快照含长文本 | 原值与公开投影均 2,000,134 字节；最新工具消息未缩减 | diagnostic 不是模型容量保护的豁免理由。 |
| PTC 值为 `{source:长文本}`，先投影再回读对象 | 初始投影 475 字节；对象回读 2,000,083 字节 | 只对字符串/数组提供可选分页，不能解决对象内大字段；回读和最终交付需要统一。 |
| 两个独立纯读，第一个不返回，第二个完成；随后 Abort | 80ms 后 `finished=false`、`fastFinished=true`、没有 committed 结果；释放第一个后完成并提交两个结果 | 调度的等待结算依赖底层返回，已完成兄弟结果也等待它。 |

重要限制：前三项是**人工构造的生产函数输入**，不是声称真实作者本轮又收到 200 万字节 Source。源码的无界字段使这个形状具有意义，但真实出现频率没有统计。最后一项的“Abort 后仍等待”不是实际 UI Stop 永久挂死的实测；80ms 是检查时间点，不是推荐产品超时。取消后归档真实读结果也不天然错误，需要修的是当前等待和迟到结果的归属/发布语义。

对应源码：

- `coordinator.ts:579–614`：Source 事实保存 `content:source.file.content`，没有输出大小限制；这一段还维护 ACK 与当前人工修改的边界，改短回执时不能删掉这些能力。
- `src/core/tools/HostToolServices.ts:501–524`：显式 diagnostic 会展开完整 view；作业日志是另一条读取路径。
- `src/main/workbench/execution/ProgrammaticToolRunner.ts:133–188`：大 `value` 投影与完整回读分别处理，回读范围可省略；执行末尾还等待已开始子调用。
- `src/main/workbench/execution/ExecutionContextProjection.ts:130–167`：观察结果与最新工具轮有特殊保留；保护调用协议不要求任意大输出全文免预算。
- `src/main/workbench/execution/ReadOnlyToolScheduler.ts`：独立读分组 `Promise.all` 后按工具顺序提交；传入 signal 不保证底层一定响应取消。

其他同类出口也纳入方案：`project.read full`、`context.read`、作业等待/诊断/日志、错误中的原输入、历史回查后插入 user 消息的结果、子运行读取，以及外部 MCP 的最终输出。这里有的是显式完整查询，本身并非 bug；需要保持完整数据访问，同时保证模型实际接收可承载的工作视图。

## 4. 本轮新增错误回执与音频资源探针

位置：`output/repair-plan-deepening-20261020/additional-boundary-probes.ts/json`；执行时间 `2026-10-20T07:19:23.877Z`。

错误回执输入为 `kind:error`，`data.input.content` 含 200 万字符。生产 `modelToolResult('project.apply',...)` 前后均为 **2,000,144 字节**。这补充了只检查成功回执会遗漏错误分支的反例。

媒体探针使用一个 8,044 字节、具有正常 WAV 头的合成文件，不访问网络：

| 源文形状 | 输入 → 输出 HTML 字符数 | 资源采用结果 |
|---|---:|---|
| `<audio src="data:audio/wav;base64,…">` | 10,781 → 107 | 抽出 1 个资源，8,044 字节，无诊断。 |
| `<audio src="voice.wav">`＋同组文件 | 40 → 107 | 抽出 1 个资源，8,044 字节，无诊断。 |
| 将 Base64 存在 JS 变量，再拼接音频地址 | 10,837 → 10,837 | 没有抽出资源；返回 `unsupported-dynamic-url-sink` warning。 |

诊断明确说明：静态分析未覆盖，**不证明运行失败**。因此不能把动态程序一律拒收或执行 JS 来猜资源。优先让正常新创作采用当前已有 source/同组文件/资源引用路径；复杂或外来程序保源并给诊断。大源文合法性和是否应在回执中全文返回是两回事。

相关 owner：`extractHtmlResources.ts`、`readHtmlClosure.ts`、`componentPlatformFileInput.ts`、`documentSourceResources.ts`、`authoredDocumentBootstrap.ts`、`resourceUrlLease.ts`。现有短 URL、局部资源隔离、UI 有效字节快照改进都应保留。

## 5. 大页面承载链：事实与保真边界

上轮原始作者脚本使用统一 `wrap(body,js='')`，每次都附加公共文档查询/点击监听/正式翻页脚本。因此，即使独立说明很简单，送入装配器时已是含脚本完整文档。冻结 13 个正式场景，每页均为两个原生文字对象加一个承载正文的 `guoling.html-program`，另有全局导航。

本轮调用 `prepareMeasurementDocument` 的结果：纯图文无程序标记；增加外层导航脚本后标记 `script`；`application/json` 数据块无程序标记；仅把互动置于独立 iframe 的外层文档无程序标记。**后两项只证明准备阶段分类，不等于最终装配、编辑和离线执行都已通过。** 方案要求实际正式工程 fixture 验证完整路径。

当前源码：

- `measurement/prepareMeasurementDocument.ts:98–103` 扫描脚本/事件属性，设置整体输入的程序原因。
- `measurement/ElectronHtmlDesignMeasurement.ts:41–42` 对文档视口程序走整体保源。
- `contentApply/applyService.ts:220–286` 普通内容续改中，既有程序身份持续保留。
- 同文件 `302–303` 对已有持久 HTML 作者记录保源；`337–346` 测量失败时保源并提示未验证。
- `src/core/contentApply/assembly/htmlAssembly.ts` 与 `measurement/browserCapture.ts` 还保留真实 CSS、表单、层叠与状态耦合关系；不能为了对象数更好看而拆坏它们。

当前 Skill 已写“独立讲解和素材不被脚本吞并”，原作者确实读过。`web-composition-examples.md` 也已有普通图文、专业 JSON、CSS/form、独立 iframe 的局部示范，不能称为“完全没有混合示例”。欠缺的是生产入口稳定采用、真实装配/编辑结果与完整高质量作品的示范。下一轮精品参考正用于后者；本轮只修入口与技术 fixture。

**方案判断**：新作尽早表达普通内容与程序运行的边界，复用 HTML/CSS＋已有分片/iframe/正式动作。保留未知外来 HTML 的完整程序能力；不新增通用 JS 依赖逆向平台。普通改字不触发自动拆散；明确 container/page redo 才在授权范围重新装配。

## 6. 内部空间：现有接口可复用，几何指标不能混用

上轮在冻结作品的 1280×720 视口、通过正式导航查看初始到达态：正文可用高度 570，01/06/07/08/11/13 页实际高度为 588/601/663/667/603/666。06 页下一步下缘 575.86，08 页为 641.53。目录滚动和长辅助原文另行判断；本轮没有新跑这些页面的全动态状态。

现有接口比“完全没有布局能力”更充分：

- `src/shared/contracts/component-platform/runtime.ts:139–170` 已有 `ComponentLayoutInput` 和 per-mount `ComponentLayoutPort.read/subscribe/reportSize`；布局报告是显示派生，不写 History。
- `src/components/web/measuredFragmentBox.ts:20–75` 归一化外框并计算可见溢出；遇到 `auto/scroll/hidden/clip` 停止向外扩展，是合理的外部几何规则。**不能把它直接当内部空间已经合格的证明，也不应为了查内部溢出改坏其外部几何语义。**
- `src/shared/componentPresentation.ts` 已区分 free-frame 与 Flow 的外部布局。
- 正确外框诊断文件是 **`src/main/workbench/contentApply/application/plan.ts:46–70`**。早期报告曾省略/误写为 core 下同路径，本方案以本轮实际定位为准。

因此 D 包复用既有尺寸与生命周期，增加局部、可选的空间声明/执行和内部可用性观察。拟议的 `data-gl-*` 属性在当前仓库中**不是已存在能力**；方案已明确作为拟增的局部输入表达，不能让模型提前假定可以使用。普通第三方内容不因缺声明被拒绝。

## 7. 执行恢复与活动数据

`HtmlActionService.ts:414–464` 目前用一个布尔量横跨“可能已经派发”“已经应用”“目标失败”和“观察失败”。已经 `applied=true` 后的取证异常仍可能被归为动作未知。应保动作确认、业务目标、观察结果分别记录；不能把 ACK 等同目标达成，也不能因截图失败再次点击。

`ExecutionEngine.ts:586–616` 对历史纯读的退役仍依赖后来同工具、同 JSON 输入的成功结果。句柄变化时可能不匹配。旧执行实例的读取等待可退休，必要验收未完成的事实仍保留；未知修改按真实影响阻塞相关依赖，不擦掉也不无差别阻塞交付。

已有观察宿主的 20 秒故障出口、关闭/取消/渲染退出处理、短 URL/POST 承载已实现并有历史实测，不能重开成“没有超时”。长素材任务和子任务沿已有 job 管理，不需要新建通用作业平台。

上轮作品第09页采访记录保存在局部变量，完成动作只翻页；第10页使用自己的默认人物资料。宿主已有 scalar `stateBindings` 与 JSON `scope.state`，可直接消费真实记录。拟修的是合适数据契约与成果采用，不新增全局状态系统。第07页公开人物信息削弱后面对应的信息差，是内容目标取舍，不要求开发学生知识追踪系统。

## 8. 条件风险，不冒充真实损害

- `src/core/publish/componentPlatform/buildSingleHtml.ts:8、18` 将 report 统一显示成加载失败；`compiledPlayer.ts` 会报告非致命制品诊断。属于需要短例验证的严重性映射路径，不称本轮成品已失败。
- `src/player/componentPlatform/compiledPlayer.ts:54–71` 创建资源租约后还有工厂/挂载可能抛错，销毁链也要检查异常后的后续清理。没有实测内存泄漏结论。
- 部分活动 DOM 文案与判断数据分开维护，视觉编辑未必同步业务。验证一个具体可编辑字段，区分“显示修改”与“业务数据修改”，不声称软件能从任意 JS 自动推断业务语义。
- 外部 MCP 同时返回 text 和 structuredContent 属于协议适配选择。本方案要求内容与容量一致，**没有要求一刀切删掉其中之一**。

## 9. 本轮测试结果与复用方式

实际执行以下三个文件，共 **24 项通过、0 失败、0 pending**：

```powershell
.\node_modules\.bin\vitest.cmd run `
  tests/integration/programmaticToolRunner20261019.test.ts `
  tests/integration/g20ReadOnlyParallel.test.ts `
  tests/unit/g20ContextProjection.test.ts `
  --reporter=json --outputFile=output/repair-plan-deepening-20261020/baseline-focused-tests.json
```

直接运行 vitest，不触发 `npm test` 的 pretest 构建。既有测试通过与上述新反例成立并不矛盾，它们验证不同性质。将必要反例并入相应真实消费者测试，不能通过删除已有协议/安全断言获得绿灯。

完整原始证据在仓库 `output/repair-plan-deepening-20261020/`；本包 `evidence/` 内为同次调查的摘要/身份说明。执行者不必重复整轮探索。若需重跑原 probe，请把 `.ts` 副本放在仓库 `output/<新的探针目录>/`，使其 `../../src` 相对导入保持有效，并使用新输出目录保存新 JSON；不要覆盖旧反例。新回归应以正式 tests 中的语义断言为主，不把这些调查脚本当产品代码。

## 10. 证据与施工验收的对应

| 证据 | 工作包 | 实施后应改变的事实 |
|---|---|---|
| 重复原件、Source/错误回显 | A1 | 公开写回执在生产时有明确结构，不随正文/媒体字节线性放大，批量事务只返回一次。 |
| job diagnostic、对象回读和最新轮免预算 | A2 | 完整数据可取，模型工作视图有界，实际模型协议能形成下一轮合法请求。 |
| 纯读挂起、应用/观察混淆、历史句柄 | B | 安全等待可结算，迟到结果归属正确，不重放未知写，不伪造验收。 |
| 无条件外层 script＋整体保源＋普通续改 | C1 | 混合内容有低成本合法写法，实际装配/编辑证明合理边界；合法整体程序保留。 |
| 普通音频抽取成功、动态拼接保源 | C2 | 新作资源沿现 owner 采用，不靠模型复制媒体字节；外来动态程序如实保真。 |
| 内部溢出与已有 layout port | D | 软件执行局部空间策略，关键动作可用；无法容纳时说明具体缺口。 |
| 09→10 成果没有消费 | E | 后页围绕本次实际对象/记录展开，保留未核对事实。 |
| 诊断与清理条件路径 | F | 短反例明确成立才修，真实消费者不混淆 warning/fatal，失败后清理完整。 |

上述目标都是本方案要求 Codex 实施和验证的内容，不能把本次“计划完成”写成“修复完成”。
