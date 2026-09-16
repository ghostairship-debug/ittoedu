# 果铃现有能力与 AI 编辑优化报告

**审查日期：2026 年 9 月 16 日**  
**仓库：`ghostairship-debug/ittoedu`**  
**固定基线：`main@c42cef38f5b7a0d0093550b9deb7b9809053ef50`**  
**范围：增强现有原生课件、Component、Runtime 的创作与编辑；暂不涉及外部 HTML 编辑。**

---

## 一、结论：已有基础比上一轮判断更完整，优先打通与补缺，不换底座

**建议保留当前工程模型、三类内容载体、正式 Authoring Tools、候选事务和原生 CLI。下一轮重点是：让 AI 更容易知道具体对象能改什么，更精确地提交复杂修改，并更快知道哪些要求已经满足。**

重新读实现后，上一轮“借 GrapesJS 新建 Capability / Trait 系统”的建议需要明显收缩。果铃已经具备统一工具注册、同源 Schema、按需能力发现、组件公开参数、精确目标身份、实例 / 共享源码作用域、候选预览和实际提交回执。继续建设一套并行注册表，收益小于同步维护的代价。[R01] [R02] [R03] [R07] [R08] [R11]

最值得推进的工作如下。这里的“优先修复 / 首批增强”表示本报告的实施顺序，不是线上事故分级。

| 顺序 | 建议 | 直接改善的体验 | 改动性质 |
|---|---|---|---|
| 1，优先修复 | 多区间文字编辑，保住未修改文字的样式 | 一次改写多处文案，不丢中间的加粗、颜色和强调 | 现有文本逻辑与工具分支扩展 |
| 2，首批增强 | 向 AI 投影当前实例的可编辑字段 | 改互动题、图表组件和参数时，少读源码、少猜字段 | 复用现有参数描述，不新建注册中心 |
| 3，首批增强 | 邻近关系摘要 + 多对象布局操作 | AI 能处理整组排版，而不是逐个猜坐标 | 小型观察投影与正式工具扩展 |
| 4，首批增强 | 对象级改动摘要 + 与任务相关的检查 | 看得懂改了什么；只为真实未完成项继续 | 增强既有预览、观察与回执 |
| 5，按需求补齐 | Runtime 工作副本交付助手 | 改机制时复用当前源码，减少手工封装候选 | 扩展当前组件工作副本模式 |
| 6，后续契约补齐 | 明确列表修改与删项语义 | 缩减题目选项、增删数据时不误解合并规则 | 涉及默认值继承，不能只加一个 remove 按钮 |

**不建议把“简单改色更快”设为本轮主目标。** 更有价值的验收任务是：整段多处改写、互动题参数调整、一组对象重排、既有运行时机制修复，以及保留原风格的成组内容修改。AI 负责内容与设计决策，已有手动入口仍承担简单直接操作。

---

## 二、审查方法与证据边界

本报告通过 GitHub 连接器读取了上述固定提交的工具契约、参数模型、生成快照、CLI 提示投影、候选准备与提交、文字样式处理、Runtime 源码入口、图层动作、观察与计量等关键实现，并查阅 GrapesJS、tldraw、Puck、ProseMirror、Tiptap 的官方资料。

结论按三个层级表述：

- **代码确认**：能从本次读取的具体函数与调用链直接确认。
- **隔离复现**：把已读取的纯函数逻辑转写为独立 JavaScript，验证特定算法行为；不是启动应用后的端到端测试。
- **优化建议**：根据代码与外部方案提出的设计，尚未在果铃中实现或进行真实模型对照测试。

本次没有完整检出仓库并启动 Electron，也没有运行仓库完整测试、真实模型任务或实际项目性能基准。因此，不报告未经测量的提速百分比、token 节省比例、整体通过率；不把函数级复现扩写成“所有实际课件都会失败”。未修改仓库。

### 一项重要核查修正

`generationSnapshot.ts` 会形成较完整的当前页数据，但真正发送给 CLI 前，`profile.ts` 的 `generationInitialRequestForPrompt()` 还会再裁剪一次：选区任务只保留选中对象，缩减相关目标别名及热资产；完整资料留在暂存请求中按需读取。`buildGenerationPrompt()` 使用这个最终投影。[R05] [R06]

所以，**“选区编辑始终把整页对象完整塞进初始提示”不是这版代码的事实**。本报告最终建议是补上少量有用的关系摘要、字段说明和诊断，不重复做已经实现的裁剪。

---

## 三、果铃已经有的能力：不要列成重建任务

| 能力 | 本次确认的实现 | 评估 |
|---|---|---|
| 统一 AI 编辑入口 | `authoringToolFacade.ts` 同时提供执行、Schema 和发现信息 | 保留，扩展实际工具即可 |
| 稳定目标与过期拦截 | `authoringToolContract.ts` 包含工程、修订、Surface、owner、对象身份 | 保留；暂不改成自动并发重基 |
| 按需能力卡 | 查询支持 scope / carrier / operation / nativeType，并裁剪 Schema 引用闭包 | 已有，不新建向量工具库 |
| 初始上下文压缩 | 快照与最终发送投影分离；选区、别名、热资产进一步裁剪 | 已有；需研究补什么，不只研究删什么 |
| 组件参数编辑 | 显式字段 + 自动发现 `props.content` 下字符串，含类型和范围校验 | 与 Traits 已有较大重叠 |
| 实例与共享源码区分 | 组件源码快照公开 instance / shared 目标；实例编辑支持 fork / rebind 语义 | 已有，不从零做 Symbols 或 copy-on-write |
| 组件工作副本 | 提示中已有 `candidate-helper --component-target ... --init`，编辑后自动封装补丁 | 已有，不要求 AI 手抄 hash 或整包 |
| 批量候选 | 多步在私有工程与资源状态中执行，支持前序结果引用，合并为一个正式事务 | 已有，不造第二个 Batch Executor |
| 修改后直接结束 | `afterCommit.action = finish` 不为总结再开一轮 | 已有，不能再当作新增性能方案 |
| 真实观察 | 当前画面、原图、草稿、公开运行态、动态连续帧 | 已有；准入证据和语义效果要继续区分 |
| 分级检查 | Component 外框修改跳过重新执行；公开参数与未知参数走不同检查路径 | 已有；进一步优化需尊重这些分流 |
| 输入计量 | 在 adapter 真实发送边界记录传输字节 | 已有；字节不是 token，也不包含全部原生历史消耗 |

依据：[R01]—[R08]、[R11]、[R12]、[R14]、[R20]、[R21]。

还有一项需要纠正：上一轮把果铃当前交互层直接称为 Moveable，并未经过这次代码核实。当前依赖清单没有声明 Moveable；本轮建议不以替换拖拽、Canvas 或富文本底座为前提。[R23]

---

## 四、优先修复：AI 多处改写应保留未修改区间的格式

### 4.1 代码确认了什么

`native.content` 已有 `edit-text` 窄操作，但其中的文字仍以修改后的整段字符串提交；执行时调用 `remapTextRuns()` 来搬运旧格式。[R09]

`remapTextRuns()` 使用“最长公共前缀 + 最长公共后缀”推断一个连续替换区间。这个算法适合单次连续输入；当一段文字有两处不相邻修改时，两处之间未改的内容也会落入推断的替换区间。[R10]

独立复现使用：

```text
原文：旧标题｜中间重点｜旧结尾
修改：新标题｜中间重点｜新结尾

原格式：第 4～8 个 Unicode code point（中间重点）加粗并设为红色。
```

结果：只修改开头时，格式区间保留；同时修改首尾时，返回的 `runs` 为 `[]`。这是本次隔离脚本运行所得结果，文件为 `isolated_repro.mjs` 和 `isolated_repro_results.json`。它支持“此算法在该输入上丢失中间格式”的结论，不等于已经完成应用回归测试。

`styleRemix.ts` 也调用同一函数，因此修复应落在共同的文字处理能力及 AI 输入语义上，不能仅在聊天面板补一个提示词。[R18]

### 4.2 建议怎样改

在现有 `native.content` 中增加多区间文字操作，复用当前样式区间函数和正式事务。以下是**拟议接口草案，不是当前已存在的 API**：

```ts
interface TextReplacement {
  // 同一次请求全部引用同一份原始文本的 code-point 区间。
  from: number;
  to: number;
  expectedText: string;
  replacement: string;
}

interface NativeTextRangeEdit {
  operation: 'edit-text-ranges';
  replacements: TextReplacement[];
}
```

模型无需自己数长段中文的字符位置。宿主可从所选文字或精确原文匹配中返回范围：唯一命中时直接定位；多次出现时需要选区、上下文或明确命中编号消歧，不能默默选第一个。

内部处理应满足：同一基线上的范围不重叠；`expectedText` 与当前原文一致；按范围建立位置映射，保留未修改字符的 runs；新文字格式继承规则明确。现有 `applyTextRunStyle()`、`toggleTextRunBoolean()` 等已经能做局部样式操作，也可经同一正式入口开放，而不要求回传完整富文本对象。[R10]

完整字符串替换仍可保留。对这一路径，至少增加多段差异映射或明确的格式保留策略；无法判断语义对应关系时，不应宣称完全保真。一次操作大范围改写全部内容时，也不能假设旧格式必然应该原样继承。

### 4.3 借鉴什么，不引入什么

ProseMirror 将修改表示为细粒度 Step，并通过映射追踪修改前后的位置；它启发的是“保留未触及区间”的方法。**不用把果铃 Native 文本改成 ProseMirror 文档，也不用重做工程历史或引入协同编辑协议。** 原生 `text + runs` 与 ProseMirror 节点模型不同，不能直接把后者的 Step 当作现有数据的补丁。[W07] [W08]

### 4.4 验收与改动位置

优先修改：`textRuns.ts`、`nativeAuthoringTool.ts`，并同步同源能力生成；检查 `styleRemix.ts` 是否需要切换新的保真路径。[R02] [R09] [R10] [R18] [R23]

验收包括：两处以上分散替换；中间格式不丢；重复短语不误命中；中文与 emoji 坐标一致；区间重叠拒绝；修订过期拒绝；命名态下未指定样式保留；撤销还原内容和格式。当前文本区间以 Unicode code point 为单位，不能混用 JavaScript UTF-16 下标；组合字符和 emoji 序列还要覆盖实际输入边界。

---

## 五、首批增强：把现成参数系统变成 AI 一眼能用的实例信息

### 5.1 缺口在“最后一段连接”，而不在新建 Trait 系统

果铃已经通过 `resolveComponentEditorProperties()` 汇总显式参数，并发现有效 `props.content` 下的字符串；`component.configure` 会依据这些描述进行类型与范围校验。公开参数变化与未知参数变化也有不同准入路径。[R07] [R08]

但在本次读取的生成快照与初始能力卡中，AI 主要得到对象数据和通用 `component.configure` 合同。并未见把**当前实例已经解析好的字段清单、有效值、限制和修改路径**作为焦点摘要直接附在该对象上的逻辑。[R04] [R05] [R06]

这不代表 AI 读不到 manifest 或不能编辑；而是现有系统知道的事实，还可以用更直接的形式交给 AI。

### 5.2 推荐的最小实现

在生成观察的只读投影中，为焦点实例附加一份从现有 Owner / manifest / resolver 派生的字段表。示例仅说明结构：

```text
实例：当前选中的互动题
正式目标：沿用本轮 target / alias

字段                 有效值          约束             编辑入口
content.question     当前题干        文本             component.configure
content.options.0    当前第一选项    文本             component.configure
timeLimit            60              10～300          component.configure

实例源码：可用 / 不可用及原因
共享源码：修改会影响哪些实例；当前是否具备正式目标
```

不能凭示例为真实组件发明 `timeLimit` 等字段。实际字段、值、限制均来自该组件的正式描述和有效状态；不存在的字段不出现在列表里。

实现第一版时，仅增加一个派生函数及快照字段即可。不要增加第二套 `EditableCapabilityRegistry`、独立参数数据库或重复的 UI / AI 配置表。参数校验仍归原来的 `component.configure`，该摘要不产生写入权限。

### 5.3 进一步增强：让模型理解字段的用途

Puck 的字段 AI 配置支持字段说明、工具结果绑定、生成排除、自定义 Schema 等；动态字段可依据当前组件属性变化。适合借鉴的是**参数的语义说明与当前可用状态**，而非把 Puck 页面编辑器装进果铃。[W05] [W06]

优先做少量由产品维护的说明，例如“此字段是答题限时”“修改此数据应同步答案索引”。既有 type / min / max / options 直接复用，不再写一份。说明用于帮助模型理解，正式约束仍由宿主校验；第三方组件的描述文字不能成为覆盖用户指令的系统提示。

### 5.4 可见子区域与字段的连接

对于已注册的组件文字区域，可在选中内部文字时把“所属实例 + 正式字段键 + 当前值”传入 AI 上下文；没有正式映射的 DOM 区域仍保留为视觉观察，不能仅凭 DOM 文本猜出可写 props 路径。第一版可只覆盖原生文字和已公开的 Component 文案，之后再逐步接入有正式声明的 Runtime 字段。

这项增强同时服务手动属性栏、画布快捷编辑和 AI，但不要求改变这些入口各自的渲染方式。

---

## 六、首批增强：给复杂排版提供关系上下文和成组操作

### 6.1 上下文不是越少越好

当前选区提示裁剪已经存在。进一步优化应关注：选中对象之外，哪些信息是布局判断真正需要的。[R06]

建议在焦点详情旁附一个很小的关系摘要：同 owner 的邻近对象边界、简短文字、遮挡或包含关系、可用留白，以及确实与当前修改有关的绑定对象。数据来自现有有效图层投影和实际观察，不新增“全仓库知识索引”。

tldraw Agent starter kit 区分焦点对象、视口内简化对象以及远处对象簇，并同时提供截图与结构化信息。值得参考的是这种不同精度的表达方式，果铃不需要逐字照搬三类对象名称，也不必加入新的 Agent manager 层。[W02]

选区仍只是用户的关注点。不得为了缩短上下文，删除原来可发现的整课目标，也不得把“只看这组对象”误实现成“永远不能修改其他对象”。如果用户明确限制修改范围，则应依据用户指令与正式目标策略执行，而不能反过来把“selection is focus”当成任意改动的理由。

### 6.2 从坐标零件升级为可组合的排版动作

当前 `layer.edit` 公开的是重排和按相对方向复制；位置和尺寸修改可经已有载体对应命令完成。对多对象排版，模型仍需要组合较低层修改。[R17] [R09] [R08]

建议先扩展少量与真实任务密切相关的操作：多个对象按给定锚点对齐；等距分布；以固定间距堆叠；按参考框统一宽度。模型决定分组、顺序、视觉层级与排版目标；宿主用真实几何计算每个对象的最终 frame，再走既有命令提交。

例如“把三张图和说明改为三列，保留图片比例，说明放在各图下方”，不应要求模型通过数次猜测坐标来达到等距。可以一次提出列关系和间距，再由宿主计算、产生候选，并返回是否越界或溢出的检查结果。

tldraw 的多对象 align / distribute / stack 等操作证明这种高层动作接口是现成可研究的设计，但**没有证明接入后果铃必然达到某个延迟或成功率**。[W02]

### 6.3 保持实现边界

首版覆盖同一 Surface、同一 owner / plane 的图层对象，禁止悄悄跨全局层或正文 / 浮层重排。Flow 正文继续遵守流式排版，不强塞到绝对坐标算法中。旋转、缩放、命名态覆盖、锁定对象、父级坐标应采用现有有效视图的定义。

实现方式是让一个小型纯计算函数输出 frame 变化，交给正式工具规划；不新增布局文档、不把最终屏幕像素写回工程坐标、不引入完整约束求解器。现有多步候选本来就能合并成一个正式事务，不需要为这项能力再建批处理系统。[R11] [R19]

优先把既有 `analyzeTextNodeLayout` 一类检查结果用于受影响文本。`styleRemix` 已调用文本溢出检查，并区分字体实测与确定性估算；这个能力可以复用，不能把估算当成最终浏览器排版真值。[R18]

---

## 七、首批增强：可理解的改动摘要与定向验证

### 7.1 从 JSON 路径差异升级到对象和任务差异

当前 `describeGenerationChanges()` 递归比较属性路径，最多保留 200 项，单项值摘要截断到 500 字符。作为底层审计有用，但对象插入、重排或源码变化可能产生不够直观的路径差异。[R13]

建议保留这个底层明细，再增加只读的语义摘要：按稳定对象身份归并，展示对象名称、所在页、实际改动字段、增删或重排、资产变更、组件实例 / 共享范围。数据必须来自私有候选前后状态和资源变化，不能直接使用模型写的 summary 代替事实。[R11]

用户看到的结果可以是：

```text
第 3 页：2 处文案改写；4 个对象调整位置。
当前互动题：公开参数修改；组件源码未变化。
其他页面：没有记录到对象变更。
检查：1 个文本框可能溢出，待查看实际画面。
```

“其他页面未变”需要确实比较相应状态；“图片颜色正确”“题目教学目标已满足”不能从资产 hash 或 Schema 通过推导出来。

Tiptap 把修改前预览与修改后复核区分开，并能把接受 / 拒绝结果反馈给 AI；果铃可参考这种清晰的反馈设计，复用当前候选预览，不必引入完整修订模式或另一套文档存储。[W09]

首版仍以整个候选的接受 / 撤销为主。暂不做任意单条接受，因为当前候选可能存在创建资源、创建对象、绑定引用等依赖；随意接受半条容易破坏事务闭包。[R11]

### 7.2 不重新发明验证，也不把验证全关掉

代码已经区分 Component 外框修改、公开参数修改和未知参数修改：外框修改无需重新执行组件代码，公开参数执行行为检查，未知参数走完整准入。这些已有分流应保留。[R08]

当前画面观察对动态目标会采三帧，采样点为初帧与后续约 250 / 750 ms。这个分支确实有一段采样等待与截图开销，但它不是“AI 十分钟任务”的根因证据；未测量前不能把它当成主要耗时。[R14] [R15]

建议依据实际修改域选择**补充证据**：

| 修改域 | 优先证据 | 不能据此宣称的事 |
|---|---|---|
| 文案、静态样式 | 字段结果、未触及格式保持、受影响区域实际画面 | 单凭 Schema 判定文字可读性 |
| 成组布局 | 实际几何、文字溢出、相关画面 | 单凭坐标正确判定审美最优 |
| 动画或运动 | 当前动态帧与明确观测项 | 单帧截图证明动画正确 |
| 按钮和机制 | 隔离候选宿主的操作前后文本 / 帧；必要的既有行为检查 | 只挂载成功就判定机制正确 |
| 源码或未知参数 | 既有完整闭包与动态准入，再观察相关行为 | 用缓存的旧运行态代替当前证据 |

静态观察仍需实际宿主身份、字体 / 资源就绪与画面一致性。若要减少不相关的连续帧采集，应先验证调用方确实知道检查目标；任务含义不明或涉及动态内容时保守回退，不能机械按 carrier 一刀切。

### 7.3 复用已有完成机制，只为差距继续

`afterCommit.finish` 已有；`observe` 也已有。当前提示甚至明确要求不要为总结续轮，且提醒 smoke 不等于效果正确。[R06] [R12]

因此优化目标应是：用明确的、来自宿主的结果和诊断帮助模型选择现有分支。合格的静态批量编辑一次提交后可以结束；需要看动画 / 交互效果的任务走观察，下一轮只修已发现差距。不要增加固定的“规划—执行—审计—复审”链条。

缓存也不能泛化。可先复用不变 Schema、同一资源身份的静态分析和重复基线读取；动态状态、实际交互、字体或 viewport 变化后的画面必须重新观察。现有能力资料已经有按语义版本的缓存，不需要再复制一份。[R22]

---

## 八、按需补齐：Runtime 的工作副本交付流程

### 8.1 必须区分“工具收完整源码”与“模型必须重写完整源码”

`runtime.source` 当前接收完整 `source`，并保持实例身份、位置、绑定和未指定字段；它还能在隔离候选宿主中对明确按钮执行一次观察。[R16]

但这**不意味着模型每次都必须在最终回复里重新生成全部源码**。CLI 可以读取已有资源文件、在本地做局部修改，再由程序组装完整 source；当前原生工具和文件通道并没有被关闭。组件已经提供工作副本 helper，自动包装基线与补丁。[R05] [R06]

### 8.2 最小方案优先于新增源码协议

建议先把现有组件的工作副本模式延伸到 Runtime：初始化当前实例源码的可编辑副本；让 CLI 修改副本；helper 核对实例和当前基线、生成 `runtime.source` 候选；由现有入口完成正式准入与提交。

第一版不一定需要改变 `runtime.source` Schema 或工程格式。收益主要来自减少让模型手写候选封装、手抄身份、把源码塞入嵌套 JSON 的操作，而不是一个未经证明的 token 降幅。

只有量到整文件封装 / 传输确实造成明显开销后，再考虑增加带基线身份的文本编辑补丁：非重叠区间、精确旧文本校验、不自动模糊修复、未触及字节保持、完整源码回退。原文件含多个重复片段时，拒绝不明确的替换目标。

### 8.3 明确不做的事

不在这轮引入语言服务器集群、通用 AST 重写引擎或另一套代码编辑器；不把解析通过当成运行正确；不修改教师正在授课的 live session 来做按钮测试。现有 `observeButton` 能力要先用好，再根据真实失败样本决定是否需要多步交互回放。[R16]

接入位置以 `profile.ts` 中已有 helper 指引、能力生成来源和 `runtimeSourceTool.ts` 为主。`candidate-helper.mjs` 是生成后的运行资料，应修改它的生成来源并重新生成，不能只手改暂存目录中的副本。[R06] [R22] [R23]

---

## 九、后续契约补齐：列表删项不能靠“少传几个值”实现

### 9.1 已确认的语义

Component API 4 的 `props.content` 会递归合并；数组按索引合并并保留没有覆盖的尾部。独立脚本复现：

```text
原数组： [A, B, C]
补丁：   [A, B]
结果：   [A, B, C]
```

这符合当前“保留未指定文案”的设计，不能直接叫作错误。它意味着 AI 提交一个更短的数组，不能表达删除尾项。[R07]

### 9.2 为什么不能只给工具加 remove

`mergeComponentProps()` 还会把默认值与实例值按同一规则合并。即使在实例数组里删了尾项，默认数组里的尾项也可能在有效值合并时重新出现。只在工具层加 `splice`，不能保证完整的持久化与继承语义。[R07]

因此把这项放到后续契约补齐，而不列成“几行代码即可全面增强”。先在实例摘要明确暴露：哪些数组仅能改已有字段，哪些组件提供正式增删 / 重排能力。

当高频组件确实需要动态列表时，给该字段或组件定义明确的列表替换 / 项目删除语义，并覆盖默认值、实例覆写、命名态、答案索引与引用更新。老组件继续保持原合并规则；不要全局把数组合并突然改为替换，否则可能破坏已有课件。

首批可以选择一个真实高频组件做专用的列表结构能力，而不是先推出任意 props 路径的通用 JSON Patch。修改最后仍经该组件的正式 Owner、校验与资源事务。

---

## 十、外部方案筛选：学哪些能力，哪些不要接

| 方案 | 本次核实的可参考点 | 放到果铃的方式 | 不建议的方式 |
|---|---|---|---|
| GrapesJS | 参数声明、动态 traits、属性绑定 | 完善已有实例参数向 AI 的投影 | 重建参数注册中心，替换画布 / 文本编辑 |
| tldraw Agent starter kit | 焦点 / 简化 / 远处信息分层；多对象高层动作 | 关系摘要与布局操作接口 | 嵌入第二个画布，照搬全部 Agent manager |
| Puck | 字段级 AI 说明和生成控制；动态字段 | 为正式参数补用途说明和可用状态 | 将果铃改成页面 Builder，另建字段真相源 |
| ProseMirror | 小步修改和位置映射 | 原生 text + runs 的范围编辑与格式保真 | 为了一个文本缺陷迁移整个文档模型 |
| Tiptap AI Toolkit | 修改预览、复核和接受 / 拒绝反馈 | 对象级差异摘要和既有候选反馈 | 换掉现有 History，强上永久修订模式 |

官方依据：[W01] [W02] [W05] [W06] [W07] [W08] [W09]。

### 采用与许可边界

tldraw starter kits 的公开说明与 SDK 许可需要分开看：其 starter kits 有 MIT 许可说明，但 SDK 的商业生产使用需要相应许可，不能把“代码可见”理解成“整个 SDK 可免费商用”。本报告建议研究方案并在现有系统实现，不依赖引入该 SDK。[W03] [W04]

Puck 文档中的 AI 功能属于其 AI / Cloud 产品域；Tiptap 的 Tracked Changes 与 AI Toolkit 也是不同产品，前者单独销售。参考设计不等于已获得这些商业能力的免费使用权。[W05] [W09]

Tiptap 的 Schema-awareness 某些接口面向 HTML 输出，不能推导为自动理解果铃的 V9 工程 JSON。ProseMirror 的变换也依赖其文档模型；本轮以算法和交互参考为主。[W10] [W07]

**当前不建议为了本报告先增加一个重型编辑器依赖。** 大部分首批收益可由现有 TypeScript、Zod、正式命令和事务机制实现。[R02] [R11] [R23]

---

## 十一、建议拆成四个主 PR，加两个后续独立项

以下是开发顺序与最小验收边界，不是工期承诺。每一项都应可独立回退。

### PR 1：文本多区间保真

**目标**：一次复杂改写不破坏未改内容。

修改 `textRuns.ts` 与 `nativeAuthoringTool.ts`；补全字符串替换路径的格式保留测试；同步能力生成；检查 styleRemix 调用。先把本报告复现转换成仓库原生单测，再覆盖多段 / 重复短语 / emoji / 样式继承。禁止引入第二个富文本模型。

**合并条件**：新增范围修改通过；旧窄编辑行为回归通过；内容与 runs 可一次撤销恢复；修订过期不提交。

### PR 2：实例编辑信息与关系观察

**目标**：AI 在第一步能得到正确参数和必要关系，而无需从源码猜测。

修改 `generationSnapshot.ts`、`generationCapabilities.ts`、`profile.ts`，只读调用 `resolveComponentEditorProperties()`。直接复用正式字段限制，给焦点对象附参数与少量邻近摘要；仍保留完整请求按需读取。先覆盖已有 Component 文案 / 明确公开参数与 Native 对象。

**合并条件**：相同对象在手动属性栏和 AI 投影中字段一致；锁定与不支持理由一致；选择范围不变成隐式权限；初始消息包含有用摘要但不恢复整页详情；完整 Schema 引用闭包仍可用。

### PR 3：成组布局动作与诊断

**目标**：一个候选完成对象组的确定性布局调整，模型专注设计决策。

扩展 `layer.edit` 或在同一正式 Facade 下增加小范围布局工具；用有效几何计算 frame 变化，复用原命令与单事务提交。第一版只覆盖同 owner / plane；将受影响文本的溢出结果附在准备结果里。

**合并条件**：混合 Native / Component 的合法同层对象组可布局；内容与资源不丢；锁定、命名态、Flow 正文边界不被绕过；整组一次撤销。

### PR 4：语义改动摘要与定向反馈

**目标**：减少模型与用户理解结果的成本，避免无意义续轮。

增强 `generationPreview.ts`，利用 `prepareGenerationCandidate.ts` 的前后状态与资源变化形成对象级摘要；在既有观察和任务控制器中使用任务相关诊断。保留 `finish / observe` 协议、真实回执、资源闭包与已有分级准入。

**合并条件**：列表重排不误报为大量无关对象内容改写；共享组件影响范围能说明；实际提交与候选预览严格区分；静态检查不冒充动态成功；已完成步骤不重复执行。

### 后续 A：Runtime 工作副本助手

沿用当前组件 helper 的交付思想，优先减少封装错误。只有实测证明必要，才引入新的源码补丁传输格式。

### 后续 B：一个高频组件的列表结构契约

选一个真实内容场景，完成默认值、实例、持久化与引用语义后，再扩到其他组件。禁止全局改变老组件数组合并规则。

---

## 十二、用真实复杂任务验收，而不是只跑“改一个颜色”

建议建立一个小型固定任务集，和改动同时入库。首批不需要做大型评测平台。

| 测试任务 | 首要成功条件 | 重点观察 |
|---|---|---|
| 一段文案改首尾两处，保留中间强调 | 内容正确且未改区间 runs 保留 | 整段重写造成的格式丢失 |
| 含重复短语与 emoji 的局部改写 | 命中正确、坐标不混用、歧义可见 | 静默替换错误位置 |
| 互动组件题干 + 一个数值参数 | 使用正式参数，保留其他实例与源码 | 多读源码或走错工具 |
| 三张图和各自说明改为三列 | 比例保持、分布一致、不溢出 | 多次猜坐标与载体误用 |
| 一组 Native / Component 同层排版 | 正确 owner / 状态，一次事务 | 跨层混排或内容丢失 |
| 修改一个组件实例的机制 | 其他共享实例保持原样 | 错用 shared 源码目标 |
| Runtime 按钮计分修复 | 隔离操作证据支持行为，未改 teacher live 状态 | 只通过挂载但机制仍错误 |
| 改写原生样板页 | 文字和格式保持，超容量明确反馈 | 自动缩到不可读或样式漂移 |
| AI 工作期间手动修改同一工程 | 旧候选拒绝，已提交成果保留 | 陈旧覆盖或重复提交 |
| 提交成功但回执保存失败后恢复 | 只补记实际结果，不再次执行 | 同一相对修改累计两次 |
| 具有默认选项的列表删项 | 有正式删项能力则生效，否则明确不支持 | 尾项在默认值合并时复活 |

已有回执与输入计量接着用。`localAgentInputMetrics.ts` 明确统计 JSON / UTF-8 传输字节，不能直接折算为某家模型的 token 或订阅额度。应同时记录实际 provider 返回的用量（如可用），并单独区分原生 CLI 历史、工具读取和图片输入。[R20]

建议跟踪：第一份正确候选之前的模型回合数；能力 / 源码读取次数；候选被拒原因；无关字段改动；格式保真；宿主检查耗时；提交后为真实差距续轮的次数；最终任务成功与人工修正次数。

做对照时固定模型、思考强度、项目、输入、会话起点和缓存条件，初始执行与复用会话分开；同一任务重复运行并记录中位数、范围和失败样本。小样本阶段不把 P95 当成可靠结论，也不要把更换模型带来的收益归因给编辑器改动。

---

## 十三、本轮明确不做

不做外部 HTML 自动识别 / 导入编辑；不做 CSS Selector / Cascade 系统；不替换 Canvas、富文本或工程模型；不新建与现有 Facade 并行的 Capability、History 或事务系统；不把所有修改改为源码编辑；不追加固定多 Agent 审批链；不要求所有任务先读所有 Skill 或全仓库。

现有组件共享机制不等于通用页面 Symbols，但目前没有必要为借鉴 GrapesJS 而补一套通用母版继承系统。现有样板改写明确限制动态载体和复杂交互 / 状态，不能把它包装成“任意互动课件都能保真套模板”。[R05] [R18]

**本轮最合适的技术路线，是保留已完成的架构整合，在真实编辑任务上补齐精确修改、实例信息、高层组合动作和清晰反馈。** 这些工作可以让现有强模型少绕路，也给较弱模型提供更清楚的操作条件；是否提高其最终质量，仍须用上述实际任务验证。

---

## 附录 A：隔离复现说明

附带 `isolated_repro.mjs`，运行方式：

```bash
node isolated_repro.mjs
```

脚本移除了 TypeScript 类型注解及不相关函数，转写本次读取的 `remapTextRuns` 与 `mergeContentValue` 核心逻辑，包含三条断言：单段编辑保留中间格式、多段编辑触发格式丢失、较短数组补丁保留尾部。三条断言均通过。

**断言通过表示复现了当前行为，不表示修复已经完成。** 本脚本不依赖本地完整仓库，也未运行正式 UI、Provider 或性能测试。

## 附录 B：源码证据索引

所有仓库链接固定到同一个提交；源代码事实与本报告建议应分开阅读。

| 编号 | 源码 | 本次用途 |
|---|---|---|
| R01 | [`src/shared/authoringToolContract.ts`][R01] | 版本化目标、修订号、修改回执 |
| R02 | [`src/renderer/authoring/tools/authoringToolFacade.ts`][R02] | 正式工具注册与同源 Schema / 发现信息 |
| R03 | [`src/shared/courseAgentCapabilities.ts`][R03] | 按需能力查询、Schema 分支裁剪、版本缓存 |
| R04 | [`src/renderer/authoring/generation/generationCapabilities.ts`][R04] | 焦点优先能力卡与初始字节预算 |
| R05 | [`src/renderer/authoring/generation/generationSnapshot.ts`][R05] | 完整快照、选区引用、组件实例 / 共享源码目标 |
| R06 | [`src/main/localAgent/profile.ts`][R06] | 最终提示裁剪、组件工作副本 helper、finish / observe |
| R07 | [`src/shared/componentProps.ts`][R07] | 公开属性发现、内容递归合并、数组按索引合并 |
| R08 | [`src/renderer/authoring/tools/componentConfigureTool.ts`][R08] | 参数编辑、公开域校验、分级准入 |
| R09 | [`src/renderer/authoring/tools/nativeAuthoringTool.ts`][R09] | 原生窄编辑与全内容编辑分支 |
| R10 | [`src/shared/textRuns.ts`][R10] | 字符范围样式操作、单替换区间格式重映射 |
| R11 | [`src/renderer/authoring/generation/prepareGenerationCandidate.ts`][R11] | 私有候选、多步依赖、资源折叠与单次提交 |
| R12 | [`src/renderer/authoring/generation/generationTaskController.ts`][R12] | 任务状态、实际回执、观察续轮与直接结束 |
| R13 | [`src/renderer/authoring/generation/generationPreview.ts`][R13] | 当前属性路径型差异摘要 |
| R14 | [`src/renderer/authoring/generation/authoringObservation.ts`][R14] | 实际宿主、草稿、截图、运行态证据 |
| R15 | [`src/renderer/authoring/generation/currentHostMotionObservation.ts`][R15] | 0 / 250 / 750 ms 连续画面采样 |
| R16 | [`src/renderer/authoring/tools/runtimeSourceTool.ts`][R16] | Runtime 完整 source 提交与隔离按钮观察 |
| R17 | [`src/renderer/authoring/tools/layerEditTool.ts`][R17] | 图层重排、相对位置复制 |
| R18 | [`src/renderer/authoring/productivity/styleRemix.ts`][R18] | 原生样板改写、文本溢出检查与现有边界 |
| R19 | [`src/renderer/course/v9SlideActionCommands.ts`][R19] | 多选命令、身份与引用维护、现有动作入口 |
| R20 | [`src/shared/localAgentInputMetrics.ts`][R20] | 真实发送边界的字节计量，不等于 token |
| R21 | [`src/main/localAgent/harness.ts`][R21] | CLI 会话、回执保存、输入与阶段计量接入 |
| R22 | [`src/main/localAgent/capabilityWorkspace.ts`][R22] | 同源生成能力文件、按语义版本缓存 |
| R23 | [`package.json`][R23] | 既有依赖和测试、能力生成 / 检查脚本 |

## 附录 C：外部一手资料

访问与核查日期：2026 年 9 月 16 日。以下用于技术思路与采用边界参考，不代表已完成对相应产品的端到端试用。

- [GrapesJS：Trait Manager][W01]（W01）
- [tldraw：Agent starter kit][W02]（W02）
- [tldraw：SDK 许可证][W03]（W03）
- [tldraw：starter kits 与 SDK 的许可区别][W04]（W04）
- [Puck：字段级 AI 配置][W05]（W05）
- [Puck：动态字段][W06]（W06）
- [ProseMirror：Steps / Mapping][W07]（W07）
- [ProseMirror：transform 官方源码说明][W08]（W08）
- [Tiptap：AI 修改预览与复核][W09]（W09）
- [Tiptap：Schema awareness 的适用范围][W10]（W10）

[R01]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/shared/authoringToolContract.ts
[R02]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/tools/authoringToolFacade.ts
[R03]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/shared/courseAgentCapabilities.ts
[R04]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/generationCapabilities.ts
[R05]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/generationSnapshot.ts
[R06]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/main/localAgent/profile.ts
[R07]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/shared/componentProps.ts
[R08]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/tools/componentConfigureTool.ts
[R09]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/tools/nativeAuthoringTool.ts
[R10]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/shared/textRuns.ts
[R11]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/prepareGenerationCandidate.ts
[R12]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/generationTaskController.ts
[R13]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/generationPreview.ts
[R14]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/authoringObservation.ts
[R15]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/generation/currentHostMotionObservation.ts
[R16]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/tools/runtimeSourceTool.ts
[R17]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/tools/layerEditTool.ts
[R18]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/authoring/productivity/styleRemix.ts
[R19]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/renderer/course/v9SlideActionCommands.ts
[R20]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/shared/localAgentInputMetrics.ts
[R21]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/main/localAgent/harness.ts
[R22]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/src/main/localAgent/capabilityWorkspace.ts
[R23]: https://github.com/ghostairship-debug/ittoedu/blob/c42cef38f5b7a0d0093550b9deb7b9809053ef50/package.json
[W01]: https://grapesjs.com/docs/modules/Traits.html
[W02]: https://tldraw.dev/starter-kits/agent
[W03]: https://tldraw.dev/community/license
[W04]: https://tldraw.dev/blog/tldraw-sdk-4-0
[W05]: https://puckeditor.com/docs/api-reference/ai/configuration/fields
[W06]: https://puckeditor.com/docs/integrating-puck/dynamic-fields
[W07]: https://prosemirror.net/docs/guide/
[W08]: https://github.com/ProseMirror/prosemirror-transform/blob/master/src/README.md
[W09]: https://tiptap.dev/docs/ai/ai-toolkit/client/agents/review-changes
[W10]: https://tiptap.dev/docs/ai/ai-toolkit/client/api-reference/schema-awareness
