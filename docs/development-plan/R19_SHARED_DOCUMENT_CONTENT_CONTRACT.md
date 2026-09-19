# 1.9 共用正文、源文与数学内容合同

日期：2026-09-15；状态勘误：2026-09-18。状态：**正文合同、codec、数学模块与正式 V9/Published 根及直接 consumer 已切换为 inlines/LaTeX；分项证据见[共用方案第 4 节](R19_SHARED_DOCUMENT_EDITOR_IMPLEMENTATION_PLAN.md#4-剩余范围与滚动批次)，禁止从零重做。** 无 Word 环境则复用 2026-09-15 证据并保持未新实测。Owner 已确认整项纳入 1.9、Word 数学同期交付，并明确“没有兼容需求”。本合同据此采用单一新结构，替代此前旧/新双格式建议；不提供旧工程、旧 Flow 文字/公式结构的读取、转换或双写适配。其他 Surface 当前仍使用的正式能力不因 Flow 改造被删除。

入口：[1.9 完整实施方案](R19_FRONTEND_SPECIAL_IMPLEMENTATION_PLAN.md)、[目录与文件合同](R19_LESSON_DOCUMENT_WORKSPACE_CONTRACT.md)、[架构合同](ARCHITECTURE_CONTRACT.md)。协议名称继续使用 Course Project V9 与 Published V2；本次在对应严格 Schema 中同步改造 Flow 内容，不为这次重构另建 V10、第二工程或第二历史。

## 1. 唯一正文结构

以下为需要落入正式类型与 strict Schema 的约定；是设计规格，不是现有代码：

```ts
type FlowTextContent = { inlines: FlowInline[] }
type InlineLink = { href: string; title?: string }
type FlowInline =
  | { type: 'text'; text: string; style?: TextRunStyle;
      code?: boolean; link?: InlineLink }
  | { type: 'math'; formulaId: string; latex: string;
      accessibleText: string; style?: { fontSize?: number; color?: string };
      link?: InlineLink }
type FlowFormulaBlock = FlowBlockBase & {
  type: 'formula'; formulaId: string; latex: string; accessibleText: string;
  style?: { fontSize?: number; color?: string }
}
```

- 空正文为 `inlines:[]`；相邻且有效样式相同的文字可归并。文字不另造稳定 ID，公式保留稳定 `formulaId`。数学的 `latex` 不包含 Markdown 外层分隔符；独立/行内转换保留公式身份。
- `latex` 是公式唯一可写源；解析树、MathML、OMML 和渲染 DOM 都是派生结果，不持久化为第二份数学内容。Flow 不再保存旧公式 AST，也不将旧 `serializeFormulaAst` 的自定义语法当标准 LaTeX 输入。
- 全部正文承载点统一用 `FlowTextContent`：heading/paragraph/quote 的 `content`，quote 的可见 `citation`；list.items 的 `content`；table.cells 与 column.header、table/media 的 `caption`；callout 的 title/body；section 的 title。可选字段仍可省略，但存在时不再接受 string 或 `text/runs` 变体。表格保持现有行列、合并区域和锚格语义。altText、工程/Surface 名称、包版本与代码源码仍是各自元数据类型。
- `TextRunStyle` 的颜色、字体、字号、基线、粗斜体、下划线、删除线、强调/着重与高亮等有效语义保留；段落级样式仍在对应块。此处替换文字结构，不删减样式工具。
- 行内代码使用文字原子的 `code:true`，链接使用同一原子的 `link`，相邻同地址片段可序列化为一个 Markdown 链接；禁止嵌套链接。代码围栏对应严格的 `FlowCodeBlock = FlowBlockBase & {type:'code'; code:string; language?:string}`，纯文本、不执行，保留换行；作者、Player 和 Word 分别以代码样式呈现。这些是源文既定代码/链接能力的明确存储，不借机增加代码执行平台。
- 图表数据/配置、媒体布局、组件参数/包、章节嵌套、导航、浮层和资源字段沿各自正式 owner；不复制进正文编辑器库私有 JSON。正文中的复杂对象仍是正式 FlowBlock。
- V9 与 Published V2 同步使用新 Flow 定义并 `.strict()`。生产器、命令、保存/恢复、AI 工具/能力说明、Builder、Player、导出和受影响 fixtures 同批接到新结构；遇到旧字段或旧 AST 明确失败，不做猜测或静默剥离。
- 046 先形成独立合同、共用纯类型/codec 与样例；正式 V9/Published 根类型、Schema 和工厂的切换由 048 连同直接 producer/consumer 作为可运行纵切交付，不能先把根 Schema 改坏后等待其他节点。新 consumer 闭合前不开放写入口；内部样例、能力生成物随新合同更新，不为历史 fixture 保留旧模型分支。
- 目录、导航标签、搜索和观察使用唯一只读纯文本投影（文字输出 text、数学输出 accessibleText），不把投影回写为正文。公式改动同步更新默认可访问说明，人工明确编辑说明时保留该结果。

## 2. 选区、操作与身份

选区由 `anchor/head` 两个点及基准 revision 表达。点包含正文位置（块、列表项、表格行列或命名标题/说明字段）、`offset` 和前后亲和性；方向保持。文字 offset 使用 Unicode 码点，数学在外层选区中占一个原子；编辑器 UTF-16/树位置由适配器转换，不能直接当工程位置。

- 文本选区、整个对象选区和表格矩形选区分别处理。跨表格的正文范围可包含完整表格；单元格内编辑与矩形选区不通过 Delete 隐式合并行列。
- 原子公式可与正文一起选择、复制和删除；进入公式编辑后再修改内部表达式。Enter 分段、Backspace 合并、方向键经过公式和对象边界均有确定行为，中文组合输入不被重建 DOM 打断。
- 移动及同文档剪切粘贴保留身份；复制/重复/跨文档粘贴产生新身份，并重写所复制片段内部引用。跨归属复制先准备目标资源，提交失败不留下半份正文。
- 段落拆分保留左侧原 ID，右侧分配新 ID；合并保留目标 ID。删除导航目标需在同一工程事务处理引用，失败零写入。表格单元格仍以表 ID、行 ID、列 ID 定位。
- 普通 Markdown 无身份时由接收方分配；带身份源文未改部分保持 ID。手动制造重复 ID 是明确错误，保留草稿；产品的复制操作在粘贴边界重建身份，不靠解析时随机纠错。

## 3. `cw-markdown-v1` 源文约定

### 3.1 普通正文、样式与公式

采用常见 Markdown 的标题、段落、强调、列表、引用、链接、图片、代码和简单表格。普通未转义换行作为软换行，两个空格或反斜杠结尾表示硬换行。代码区不解析数学或课件扩展。字面 `$`、反斜杠及扩展标记按转义规则输出；排版视图中的普通美元文字不会被保存为新数学节点。

行内数学用 `$…$`，独立数学用单独行的 `$$` 包围；未闭合时定位诊断，不吞掉后续正文。数学中转义字符遵循数学语法；源文中数学后可附下面的白名单属性。有限样式用 `[文字]{cw:字段=值}` 表达，字符串值按 JSON 转义，数值/布尔按 JSON 字面量，不允许任意 CSS 或可执行脚本。

```markdown
<!--cw:block {"id":"p-ohm","textAlign":"left","lineSpacing":1.5}-->
[欧姆定律]{cw:fontSize=20 cw:color="#b91c1c"}：
$I=\frac{U}{R}${cw:formulaId="f-ohm" cw:accessibleText="电流等于电压除以电阻"}。

<!--cw:block {"id":"eq-energy","formulaId":"f-energy","accessibleText":"电能等于功率乘时间"}-->
$$
W=Pt
$$
```

`cw:block` 仅修饰随后一个语义块；属性名与正式该类型字段一一映射，字段缺失使用正式工厂默认值，不另建样式表真相。通用文本样式属性白名单与 `TextRunStyle` 相同。普通文档可省略元数据；首次需要跨重开稳定定位时由文件编辑器写入对应标记，不把身份只藏在当前内存中。

### 3.2 列表与表格

```markdown
<!--cw:block {"id":"steps"}-->
- <!--cw:item {"id":"step-1"}-->测量电压。
- <!--cw:item {"id":"step-2"}-->计算 $I=U/R$。

<!--cw:block {"id":"measurements"}-->
| 电压 <!--cw:column {"id":"c-u"}--> | 电流 <!--cw:column {"id":"c-i"}--> |
| --- | --- |
| <!--cw:row {"id":"r-1"}-->6 V | 0.3 A |
```

行标记位于该行首格，列标记位于相应表头。需要合并格、多行格内容或其他普通表格无法保真的字段时，整个表格使用 `cw-object-v1` 片段，不另保留一份可编辑管道表。片段中的表格正文仍使用第 1 节唯一 `inlines` 结构，多行是同一正文中的硬换行，不在首期另建单元格多段落模型。

### 3.3 复杂对象与资源

代码围栏信息串固定为 `cw-object-v1`，正文为 strict JSON：`{kind:"flow-block", block:<正式 FlowBlock>, resources:<引用映射>}`。`block` 是完整对象，含数据、配置、身份、嵌套正文和包/资源引用，不是库专有文档或占位 ID。支持 table/chart/media/callout/section/component 等无法用普通 Markdown 完整表达的块；简单块也允许完整表达，转换时只有一份正文。

- `resources` 为 strict 对象：`assets:[{assetId,source}]`、`components:[{packageId,version,source}]`，空数组允许；`source` 只允许 `{kind:'project'}` 或 `{kind:'relative',path:string}`。每项均使用正式块中实际引用的 ID/包版本，禁止重复、缺失或未被片段引用的条目。Flow 源文的 project 引用在当前工程归档内解析；真实 `.md` 正式保存必须交付成课例内相对路径，不保留 project 临时引用或嵌入整个工程。源文复制到另一归属必须经资源接入口搬运必要内容；孤立文本粘贴缺资源时给出具体诊断。
- 复杂片段默认折叠，但可以展开修改真实字段。教学文档内互动组件呈现可查看的对象卡片，不在文档中自动取得或执行课件 Runtime 能力；进入课件后走正式 carrier 与准入。
- 未知类型、未知字段、重复身份、缺资源和非法结构保留源文并定位；Flow 不提交不完整对象。真实 Markdown 文件可保存待修源文，但不能将它标成完整可生成/可导出的正文。
- 第 046 节点须将上述每类片段做成具备完整实际字段的 fixtures，以正式 Schema 解析和往返验证；不得用本节的说明占位符作为测试输入。

## 4. 数学支持集合

新公式通过一份显式数学语法表准入，再用于浏览器和 Word。底层 KaTeX 的全部能力不自动成为产品承诺；解析/转换代码不得依赖其私有树作为持久化协议。

| 类别与固定输入样例 | Word 结构与实际编辑验收 |
|---|---|
| `\frac{1+\sqrt{x}}{x^2}` | `m:f` 的分子/分母独立，内部根式/上标保留；在 Word 单独修改分母指数 |
| `\sqrt{x+1}+\sqrt[3]{8}` | `m:rad` 的次数与被开方式独立，平方根不显示次数占位；把 3 改为 4 |
| `x^2+a_i+T_i^{n+1}` | `m:sSup`、`m:sSub`、`m:sSubSup`；分别修改下标和上标 |
| `\Delta U=\alpha\cdot x\pm\beta,\quad x\leq1` | 希腊字母、关系/运算符及数学变量样式正确；修改系数和关系符 |
| `\sum_{i=1}^{n}{i^2}`、`\prod_{i=1}^{n}{a_i}` | `m:nary` 的上下限和操作数独立；修改上限及被求和/乘积项 |
| `\int_0^1{x^2\,\mathrm{d}x}` | `m:nary`，上下限与被积式独立，直立 d 保留；修改上限与被积式 |
| `\begin{aligned}U&=IR\\I&=\frac{U}{R}\end{aligned}` | `m:eqArr` 保留两行等号对齐点与分式；修改第二行分母仍对齐 |
| `f(x)=\begin{cases}x^2&\text{当 }x\geq0\\-x&\text{当 }x<0\end{cases}` | 左括号 `m:d`＋两列左对齐 `m:m`；中文用普通文字 run；分别修改条件与表达式 |
| `\left(\begin{matrix}1&\frac{1}{2}\\\sqrt{x}&a_i\end{matrix}\right)` | `m:m/m:mr/m:e` 各格保持内部数学，外层括号独立；修改右上格分母，其他格不变 |

具体语法界限：

- 支持数字、拉丁字母、分组、上述结构、成对 `\left/\right`、`\text`、`\mathrm`，以及当前产品已提供的希腊字母、关系/运算符和常见函数符号。046 将现有映射展开成显式命令表及测试；这是新语法功能集合的确定输入，不是保留旧 AST 或旧自定义语法。
- 求和/乘积独立公式默认上下排列，行内默认右侧；积分默认右侧；支持 `\limits/\nolimits`，OMML 明确 `limLoc`。带花括号的操作数整体归属 n-ary；省略外层括号时消费一个乘法项（包括相邻因子和积分微分项），在顶层加减号、关系符、单元/行边界或结束处停止。正负号位于项首时作为一元符号；分组内的加减不截断操作数。
- `aligned` 每行一个对齐点，`cases` 每行两列，`matrix` 每行列数相同；格内可嵌套分式/根式/上下标等普通结构。矩阵本身不含括号，环境嵌套、额外环境参数和自定义行距不纳入首期。
- 中文条件放入 `\text{…}`，验证字体回退与非斜体。宏/宏包、用户自定义命令、自动编号、跨公式引用及整篇 LaTeX 不纳入首期；普通正文的人工编号保持可用。

公式派生树至少表达分式、根式、脚标、n-ary及其操作数、对齐行、分段、矩阵、括号和普通文字。Word writer 从此结构生成 OMML，不从截图、渲染 DOM 或线性字符串猜结构。KaTeX 的公开 MathML 可参与转换，但必须先用上述样例证明语义保留。

权威语义参考：[KaTeX 支持表](https://katex.org/docs/supported)、[KaTeX 输出选项](https://katex.org/docs/options)、Microsoft OMML [Fraction](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.fraction?view=openxml-3.0.1)、[Nary](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.nary?view=openxml-3.0.1)、[EquationArray](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.equationarray?view=openxml-3.0.1)、[Matrix](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.math.matrix?view=openxml-3.0.1)。

## 5. 编辑历史、草稿与交付

- 共用核心持有临时选区/组合输入/操作序列；Flow 的已提交内容与撤销仍由唯一工程 History 持有，不能增加库默认历史和工程历史的双重撤销。文件文档连接其文件编辑历史，两种归属不互相嵌套。
- 连续输入、一次粘贴、格式操作、结构操作与一次 AI 改稿分别分组；显式操作边界、选区跳转及输入空闲结束当前输入组。视图切换、自动保存和恢复写盘不单独增加撤销。
- 未闭合、未知命令或无效源文保留可恢复草稿与最后有效结果。Flow 不将残缺解析提交为工程；保存/导出不能把旧有效稿说成当前草稿已保存。显示修复位置，允许明确丢弃草稿返回有效稿；关闭/重启恢复后继续修正。
- 有效新结构的作者端允许保存前，其 Player、两种预览及适用导出必须已接受同一内容域。046 可独立完成合同与转换测试；047 开发核心；048 汇合真实 Flow；禁止在 Player/DOCX 尚不接受时先开放新写入口。
- Word 验收在记录版本的 Windows 桌面 Word 中执行表内修改，保存、关闭、重开且无修复提示。XML 对象检查、实际显示与实际可编辑均需成立；WPS、截图或仅有 `m:oMath` 不能代替。环境无 Word 时保留待验制品，不能将此门计为通过。
- 首个开发验证切片应尽早完成一份含所有数学类别的 DOCX，证伪转换路径；再扩展完整编辑器。正文核心同时用 Flow 接入口与真实 `.md` 接入口验证，文件编辑不等待全部 Flow 专属功能。

## 6. 替换与退出

直接替换本次 Flow 的 `text/runs` writer、旧单块草稿 DOM 提取和旧公式保存分支；新旧 writer 不并存。更新全部直接 producer/consumer 后再删除对应实现，库编辑器不得绕过工程事务。必须覆盖 `flowAuthoringTool.ts` 的正文/公式输入、`materialCitationTool.ts` 的引文段落、`dynamicAdmissionScope.ts` 的空段落工厂，以及 `flowPrintPlan.ts` 的打印中间结构；只改 UI 和 DOCX 末端会遗漏这些实际写入/投影路径。

现有 `FlowWorkspace` 的纸张、媒体、组件、浮层和导航容器保留职责；其他 Surface 仍使用的公式函数与编辑器继续由其 Owner 维护，不能因名称相同顺手删除。完成以新能力及当前功能矩阵通过为准，不承担旧版本工程、旧 fixture 或旧会话迁移。
