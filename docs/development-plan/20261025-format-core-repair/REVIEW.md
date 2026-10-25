# 格式与核心编辑路径修复独立审查（2026-10-25）

审查者：`/root/baseline_review`。未参与本包产品／测试实现；只读核对候选增量、直接 producer／consumer、正确断言、原始结果和实际截图，仅写本文件。未运行测试、浏览器、构建或类型检查，未修改实现、测试或历史基线。前两轮有效独审继续保留，不由本文件替代。

**最终结论：本包已审产品、测试、直接行为证据及报告边界通过独立审查，最后相关双击例和集成类型记录已补齐，未发现剩余本包阻断。本结论仅覆盖下述实际路径，不签全仓无新增失败、全部旧红例已修或完整 OS／安装包验收。**

## 1. 边界与比较起点

Owner 本轮已授权实施 `APPEARANCE_PLAN` 和 `CORE_PATH_PLAN`。整对象实际字号／颜色、旧 ACK 不抢新选择或输入、真实关闭／保稿／恢复均在该范围内，不重复请求授权；未定义的新 UI、默认操作路径和混合来源复制语义仍不能自行增加。

本轮起点是 Root 已有未提交成果，不能将候选相对 HEAD 的所有差异归为本包。`DocumentToolGateway.ts`、`SlideLocationWorkspace.tsx` 等预叠文件按 `output/test-runs/format-core-repair/start/files/` 逐项比较；起点干净的直接文件按 HEAD 比较。Gateway 的旧 childIds 检查、图片面板及前轮选择修复未被算成本轮新增。

产品增量限于既有专业外观规划／Gateway／GUI 格式消费者，以及 Slide workspace 原输入／手势 owner。未新增 UI、模式、操作步骤、selection store、writer、History 或恢复稿库。关闭与 C2 叶子无生产增量；测试前置修正有真实协议及直接链路依据，未为“必须改产品”重写已正常的 owner。

## 2. 整对象外观

### 实现与直接消费者

- `wholeTextAppearanceFields` 只选择明确给出的绝对 fontSize／color：文字写默认值及已有同字段覆盖；公式已有有效 style 时写该字段，否则写默认。GUI 原其他格式、显式 false、相对 fontSizeStep 和控件入口保留。
- `componentAppearanceEdits` 将默认字段与已有覆盖合成**一次** `componentDataEdits`，保留正式 range remap 和正常片段合并。独审曾指出分两次从旧值规划会在合并时带回旧默认；候选已修，并由相邻可合并片段＋继承段的真实 Gateway 反例验证。
- Zod partial 仍可能补默认值；最终代码从**原请求字段的 own-property** 选择已校验字号／颜色，避免只改颜色时写入省略字号。候选阶段的 TDZ 和该省略字段错误均保留失败 raw，实际修复后再验，没有通过改断言容纳错误。
- `courseInstanceDataAppearancePlan` 基于 captured state 的有效实例规划 data，用实际产生的 data.set 重建中间值；后续局部 stateId=null，不重新套回旧 override。实际写入和 appearance 预告共用该计划，组合请求使用新正文索引。
- materializer 只是导出现有字段赋值算法；最终仍归原 DocumentSession／CAS／History。低层 `properties.data.appearance` 继续字面默认值语义，局部 text.format 不扩为整对象授权。
- 公式来源复制的字号／颜色按已授权有效 style 读取，显式请求仍优先；混合文字来源保留原默认值复制，没有取首片段、清格式或拒绝原合法复制。插入继续复用原 planner，不制造公式 style，也没有扩成其他类型／全部外观字段的新规则。

### 已核证据

[after-final.json](../../../output/test-runs/format-core-repair/appearance/after-final.json)为两个完整文件：Gateway 12、Host 4，共 **16/16，0 skip**。覆盖省略字段、默认已符合而覆盖仍旧、可合并 runs、data＋appearance／captured state／完整预告集合、底层默认值、来源与继承锁、冻结文字范围、插入和原格式保留。

新 scope 断言使用完整集合＋精确长度，不依赖无合同意义的枚举顺序。邻 state 检查没有要求共享根容器中合法变化的目标 state 元数据不变，但仍保留邻对象、邻 state 记录、root frame／childIds 和 Undo 全 instances 断言。保存比较使用真正保存时包含 revision=4 的完整模型，没有忽略 revision。

GUI 完整文件原观察为 **23 过／3 失败**；绝对字段 helper 未受后续 Gateway 分支修正影响，已过证据复用。三个失败的 fullName／首错已与冻结终点 initial／retry-161 分别核对，且处于未命中本次格式 helper 的草稿路径；它们仍未通过，不能称全部输入、IME 或目标切换已修。见 [APPEARANCE_RESULT](APPEARANCE_RESULT.md) 与对应原始报告。

实际链路为：真实 DocumentHostService.tools 的两个公开 object.update → 每次一条 History → Undo／Redo → GLX 保存 → 独立新 Host 冷开完整模型；再将该 cold model 载入当前浏览器真实 Runtime／Store／Bridge／Slide，显式激活样本文档。浏览器使用 memory-backed host，不冒充 Electron／Main 原进程或同一 Session。

[appearance-facts.json](../../../output/test-runs/format-core-repair/browser/appearance-facts.json)与[实际截图](../../../output/test-runs/format-core-repair/browser/appearance-after.png)一致：默认、显式、继承文字、inline formula 及独立公式均 60px／rgb(171,205,239)，邻对象 24px 黑；原 italic／highlight／underline、link、rangeIds、formulaId 保留，errors=[]。首次 harness 自动激活 blank 未到目标，之后沿正式 activate 正确载入 cold 样本；该前置修正不被写成产品故障或首次即通过。

## 3. 旧 ACK、精确选择与后续拖动

相对本轮起点的 workspace 产品 diff 只有两处责任：

1. realm start 复用原 `captureInputIntent`；begin 前核 `sameInputContext` 及无新 contentEdit。开始后的 update／end 继续原冻结手势，未用旧 selection 误取消其自身合法选中。
2. 宿主 deferred paint／ACK 的失效分支先核 `deferredPointer.current === pending`，仅退役该记录。旧 ACK 遇后来记录直接退出，不按 pointerId 清掉后来 pending／gesture。该修复对应真实 mouse 复用 id=1 时，旧 ended 记录截走下一次 up、导致拖动无 History 的问题，属于真实产品修复。

正确断言保留：新 Nodes 选择不被抢回；同选择上的新输入不被提交或关闭；同目标合法 ACK 续接；paint 延迟后只拖原对象、实际 up 点、邻对象、一次 History／Undo；旧 hover／菜单不恢复旧目标；后来复用同 mouseId 的 pending 仍可完成。

原 Bridge 定向红例为 2 失败／1 合法续接通过。修后第一轮实际运行 7 项为 6 过／1 失败，S2 终点进入已有 snap 范围，移动 fixture 落点而不改 snap／精确 frame 预期后单例通过。新增同 mouseId 两例修前 1 红／1 保留过，修后 **2 过／18 过滤未跑**，分别保护失效记录退役与后来记录。目标项的分别有效证据不能写成整个 20 例文件通过。

[after-browser-reused-mouse-fixed.json](../../../output/test-runs/format-core-repair/selection/after-browser-reused-mouse-fixed.json)为完整浏览器例 **1/1，0 skip**。真实 Main／Store／Bridge、当前 Source sandbox 和 Nodes UI 支持两条 ACK 链及后续同 mouseId 的物理拖动：每次原输入只入一次 History；新选择保持 neighbor；绿色可见背景拖动 40×30，只改 Source，History 2→3，Undo 恢复原 frame，neighbor 不变，page/runtime errors=[]。见 [facts](../../../output/test-runs/format-core-repair/selection/browser/facts.json)、[ACK 事实](../../../output/test-runs/format-core-repair/selection/browser/ack-facts.json)及[Undo 后截图](../../../output/test-runs/format-core-repair/selection/browser/selection-after-undo.png)。

普通物理点击由现有宿主 hit-plane 接收，realm 事件事实为空；Source realm 分支用真实 Source 内 PointerEvent→sandbox 桥协议验证，不能将它冒充物理鼠标必达 realm。S2 没有隐藏 quickbar、改 History 预期、换 pointerId 或增加 sleep 试绿。早期编译／ACK 前置、quickbar 覆盖及真实 pending 故障的失败 raw 均保留。

最后 DOM 分支修正后，仅重核其相关的既有 `retains the double-click edit intention for a second field while the first input waits for its shared slow ACK`：[最终 raw](../../../output/test-runs/format-core-repair/selection/after-retained-double-click-final.json)为 1 passed／19 过滤未跑，约 315ms。核源码仍断言 ACK 前 A 未提交、第二字段不先开；ACK 后只开原 `source/label` 一次、不重新命中已空的旧坐标，A 正式稿一次 History、唯一 quickbar、无 report。没有改这些正确断言，也没有据过滤条目宣布全文件通过。

## 4. 关闭／保稿、菜单与 PPT

C1 已完成独审且实现未再变，复用其证据：真实 Main＋临时磁盘＋mounted Shell 两条组合链分别通过。标签关闭与 closeAll 冲突拒绝、preserveAll 保留 canonical／History／未应用 hunk raw 且不覆盖磁盘；取消后同 PM 可继续输入并一次 Undo；新 Host 从 journal restore→focus 后，在当前 hunk／新 epoch 持久 ACK 就绪时核恢复内容。

`markdownRendererHost.observeFile` 的 baseSource 来自真实 Session.readSavedSource，与 Main observeDisk 同源，未把 dirty 或新磁盘稿冒充基线。旧 Shell 修改仅收敛当前创建区域与真实多个 hunk 的存在查询，原数据、无 CLI、同 PM、History、close=false 和磁盘保护断言保留。旧三个例分别有有效通过；末次为 2 过／1 过滤，不能写成末次完整文件绿。

C2 菜单两例在首轮通过，PPT 两目标在末次通过／另三例过滤。完整菜单保留 10 月 14 日已有的重命名、单一 menu、禁用理由和精确关闭 ID；reveal 核真实 documents.reveal 的准确 documentId。PPT 核三参协议、唯一正式 Slide 根、原页名／尺寸、文字“知识 😀”和椭圆；原损失取消／确认、Main archive 和原字节断言未删。

新增 late-success fixture 刻意在取消后仍返回 true，未复制 App 守卫；实际 controller 保留后来 workspace 与资源区导航。此证据不覆盖完整 App 工程应用、Worker 或 OS 原生选择器；reveal 不签 OS 资源管理器实际打开，重命名仅核既有能力存在。C1 的 Electron dialog 选择及 IPC 输送也为局部离线适配，不签物理 OS 对话框。完整分级及初始 fixture 失败见 [CLOSE_RESULT](CLOSE_RESULT.md)，没有把未运行记通过或重跑有效 C1。

## 5. Python／Vite 调查

[PYTHON_INVESTIGATION](PYTHON_INVESTIGATION.md)的更正成立：前轮 inline watch:null 被当前 Vite merge 丢弃，旧反事实不能排除 watcher。新实验在 post configResolved 设置 null，并在服务创建后及 listen 后实际记录 NoopWatcher／getWatched={}，确实生效。

新 raw 为 1/1、4,833ms、真实 Worker／Python stdout42、exit0、原四处结果／策略断言抵达；outputs=[]，不能据此声称生成新图表。旧控制 probe 47,400ms 失败、业务 Worker 未开始及诊断清理事实保留。缓存、插件配置身份、运行时点等差别已明确，因此支持 watcher 相关启动压力，不是唯一根因或普遍速度倍率。

正式 Main 本地映射路径已有实际班级统计、CSV／中文 PNG written 及停止样本，版本边界独立记录，不能以新开发 probe 冒充正式产品重验。原正式 CA246 本轮未改／未复跑，历史失败仍保留；当前定位属开发维护／验证可靠性，不证明整个编辑器或正式 Python 核心不可用。使用频率无遥测，未擅称影响很小。没有要求追加探针、全局关 HMR、扩网络策略或重跑生产链。

## 6. 最终集成与收口

Root 集成全部已审产品／测试后，提供的本轮执行记录为三套相关类型检查均 exit 0；已核对应日志均无诊断输出。本审查者未自行重复运行，不以空日志本身冒充退出码证据：

| 类型范围 | 原记录 |
|---|---|
| tsconfig.json：renderer／core 及相关 tests | [typecheck-renderer-core.log](../../../output/test-runs/format-core-repair/typecheck-renderer-core.log) |
| Electron：Main／Gateway 直接消费者 | [typecheck-electron.log](../../../output/test-runs/format-core-repair/typecheck-electron.log) |
| component-platform：正式 Runtime／Driver 边界 | [typecheck-component-platform.log](../../../output/test-runs/format-core-repair/typecheck-component-platform.log) |

上述检查后没有产品／测试改动，浏览器及自有服务已停止；最后相关双击行为亦已核通过。该包独审收口，不再增加重复验证。Root 综合结果仍须保留三个旧 GUI 草稿失败、所有过滤未运行、初始候选／夹具失败、原全量 baseline 与 reportComplete=false；不得宣称全仓无新增失败。

未 commit、push、发布或修改用户工程。本轮其他已审未变实现和证据不重复审查／验证。
