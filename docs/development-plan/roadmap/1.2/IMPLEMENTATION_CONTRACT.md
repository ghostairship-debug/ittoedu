# 1.2 决策闭合实施合同

> 本文是 1.2 各节点共享的实现真相，与本目录逐节点规格共同组成执行包。它把已经确定的产品边界展开为可直接编码的数据形状、状态转换、导出映射和失败语义。执行者不得在节点内另选 wire、另建状态或用“先做一个能跑的版本”改写本合同。
>
> 权威顺序仍是产品 Owner 的明确决定 → 正式 Schema / [架构合同](../../ARCHITECTURE_CONTRACT.md) → 源码与可复现结果 → 本文 → 单节点规格。若当前源码只是符号或文件位置变化，按同一 Owner 定位后更新规格；只有无法在上级合同内实现时才停止并升级 Owner。

## 1. 固定范围与有效域

| 能力 | 作者工程有效域 | Published / Player | 静态导出 | 明确不做 |
| --- | --- | --- | --- | --- |
| Table | Slide scene、Slide surface layer | Published Slide、单 HTML | 原生可编辑 PPTX 表格 | Flow / Spatial / global、合并单元格、公式、富文本单元格 |
| Chart | Slide scene、Slide surface layer | Published Slide、单 HTML | 五类均映射原生可编辑 PPTX chart | Flow / Spatial / global、组合图、堆叠、双轴、动画 |
| input | 仅 Slide scene | Published Slide、单 HTML；`input.submit` | PPTX 可编辑文本框与边框，明确为静态填写区 | Slide surface、Flow、Spatial、global、PPTX 交互等价、Runtime 替代 |
| Line geometry | Slide scene 中既有 Native shape 的 `line` / `elbow-arrow` | Published Slide、单 HTML | straight 为原生 PPTX line；elbow 为确定性 SVG 后备并告警 | 新 Native 判别器、通用矢量路径、任意多折线 |
| Background | Course、Slide surface、Slide scene、Slide named state、Flow surface、Spatial surface | 三 Surface 与单 HTML使用同一解析器 | Slide→PPTX；Flow→DOCX；Spatial 静态页沿既有导出入口 | 第二套 `backgroundState`、渐变、平铺、混合模式 |
| Flow 浮层 DOCX | Flow surface layer 与可见 global layer | 不改变 Player | 一份连续 DOCX | 把 PDF/打印浮层常量整体打开、按 location 拆成多份 Word |

Table、Chart 只能进入 Slide 的原因是 Flow 已有 `FlowTableBlock` 文档流语义，Spatial 的坐标与静态导出也未在 1.2 建立图表合同；不得因联合类型可解析就在越界容器中接受。所有越界项必须给出包含 `surfaceId`、`layerItemId` 和字段路径的错误，Published producer 不得过滤后继续。

本表是 1.2 的有效域。Chart 跨 Flow/Spatial 的合同与实现已排入 [1.3](../1.3/README.md)，不能把本版修复变成提前扩域。1.2 的颜色控件必须完成固定常用色板与连续调色，项目主题色/Token 范围应用留在 1.3。

## 2. 共同 Schema 规则

1. 所有新增对象都用 `.strict()`；颜色统一为 `#RRGGBB`，数值必须 finite，字符串先做长度上限而不静默截断。
2. LayerItem 继续唯一持有 `layerItemId`、`frame`、`order`、visibility、rotation、opacity 与 hit policy。Native content 不重复保存外层身份或几何框。
3. 子项 ID 使用现有 ID factory 生成，非空、同一父项内唯一；复制生成全新子项 ID，保存、重开、重排和 Undo/Redo 保持已有 ID。
4. 新分支写入 Course Project V9 与 Published Course V2 的 matching strict schema；版本号仍为 9 与 2。旧合法 fixture 必须逐个继续解析。了解旧联合类型的反例 reader 遇到新分支必须 fail loud。
5. `nativeData` presentation override 只允许经对应 Native content schema 验证后的 partial merge；未知键、错分支键和非法子项结构拒绝，不能把任意 JSON bag 合进有效状态。
6. 合同提交只含类型、Schema、生成合同、兼容政策、fixture 与使现有 consumer 穷尽编译所需的显式 unsupported 分支；UI、交互手感和导出实现在后续 delivery 提交。

### 2.1 固定模块落点

为避免每个 consumer 再造投影，1.2 新建的纯共享模块固定如下；不得改成万能 Native service 或跨域 Facade：

| 文件 | 必须导出的单一职责 symbol | 首个 owner 节点 |
| --- | --- | --- |
| `src/shared/nativeTableLayout.ts` | `buildNativeTableLayout`：合同数据→行列/cell view | r12-011-table-authoring-delivery |
| `src/shared/nativeChartView.ts` | `buildNativeChartView`、`describeNativeChart`：合同数据→确定性绘图/无障碍 view | r12-021-chart-authoring-delivery |
| `src/shared/nativeLineGeometry.ts` | `resolveNativeLinePoints`、`lineHitWidth`：参数几何→points/hit | r12-030-line-authoring |
| `src/shared/effectiveBackground.ts` | `resolveEffectiveBackground`：owner fields→color/asset/sourceOwner | r12-040-background-authoring |
| `src/renderer/interactions/inputRuleFamily.ts` | `buildInputRuleFamily`、`inspectInputRuleFamily`：简洁判题配置↔canonical rules | r12-007-input-response-delivery |
| `src/renderer/export/course/flowDocxProjection.ts` | `buildFlowDocxProjection`：Published payload+surfaceId→连续 DOCX IR+逐项报告 | r12-045-flow-docx-fidelity |

共享模块只能接收窄类型/值，不得 import renderer Store、React、DOM、PptxGenJS 或 Electron。作者、Player 和导出各自在边界把 view 投影到 carrier。

### 2.2 Native 作者态传输有效域

`r12-008-native-authoring-transport` 负责已有内容合同到真实编辑宿主的共同接线。完整路径为 V9 LayerItem → 非持久化 render input → strict authoring patch → Published frame/type guard → transient item → painter → ACK；所有环节必须接受本版合法 Table/Chart/input，同时继续拒绝未知/错分支字段和越界 target。

render input 的几何来自外层 LayerItem，内容严格复用相应 Native content schema；共同 parser、类型判定和 materializer 从同一正式定义派生，不再分散维护六类/九类名单。此处不是新增持久化字段或恢复 legacy SceneNode。不得把 `type:string`/强转视为能力已经覆盖，也不得以跳过初始快照、直接调用 painter 或只走 playback 代替作者态 ACK。

Table 与五类 Chart 必须从真实可见入口插入后仍可选择、改数据/样式、拖动/缩放和 Undo/Redo；input 还必须保留作者态 inert、运行态可提交。数据校验通过与作者态启动成功分别验收；parser 失败不得吞掉为成功或只提示反复重载。保留 request/target/字段路径，正确区分“工程已提交但画布同步失败”与“命令未写入”，不借此另建工程回滚或第二历史。

初始快照与后续增量必须来自同一正式 V9 Native render input。旧编辑投影中的六类 `document.nodes` 不能充当 Table/Chart/input 的增量枚举源；不得通过扩 legacy SceneNode、重挂载整页或切换试运行强制刷新来掩盖漏项。ACK 证明当前目标及 revision 的内容/几何已经同步，不能仅回复成功而继续呈现旧数据。

### 2.3 Table/Chart 的既有 owner/state 写入语义

Table/Chart 的专用命令必须复用 canonical target、effective layer 读取与现有 presentation override 写入边界：scene base 编辑写基础内容；scene named state 编辑写该状态的 `nativeData` override；Slide surface 编辑写对应 `surfaceLayerItems`，不借当前 scene 的 state 改写 surface。candidate 从目标有效内容构造并整体验证，不能绕过 state 直接修改 base 或只放开 scope 检查而仍查 scene 列表。

该要求适用于已支持的数据、样式及结构命令；创建、复制与删除继续按既有 owner、可见性和稳定身份规则执行。普通修改保留子项 ID，复制重建；失败、locked、stale、缺失状态或错误 owner 不改变工程、revision、历史与选区。沿用既有稀疏合并及 override 清理语义，不新增 wire、第二份内容状态或专用历史。共享 History 只读使用，不在本轮重写。

## 3. Table 合同

### 3.1 精确形状

```ts
type NativeTableHorizontalAlign = 'left' | 'center' | 'right'
type NativeTableVerticalAlign = 'top' | 'middle' | 'bottom'

interface NativeTableCellStyle {
  fillColor?: string
  fillOpacity?: number
  textColor?: string
  fontFamily?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  horizontalAlign?: NativeTableHorizontalAlign
  verticalAlign?: NativeTableVerticalAlign
}

interface NativeTableStyle {
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  lineStyle: 'solid' | 'dashed' | 'dotted'
  textColor: string
  fontFamily: string
  fontSize: number
  horizontalAlign: NativeTableHorizontalAlign
  verticalAlign: NativeTableVerticalAlign
  cellPadding: number
}

interface NativeTableColumn {
  id: string
  width: number
}

interface NativeTableCell {
  id: string
  columnId: string
  text: string
  style?: NativeTableCellStyle
}

interface NativeTableRow {
  id: string
  height: number
  cells: NativeTableCell[]
}

interface NativeTableContent {
  columns: NativeTableColumn[]
  rows: NativeTableRow[]
  headerRowCount: number
  style: NativeTableStyle
}
```

边界固定如下：columns 1–100；rows 1–1000；column width 24–2000；row height 20–2000；cell text 最长 20000；font size 6–144；border width 0–32；padding 0–64；opacity 0–1；`headerRowCount` 为 0 至 rows.length 的整数。

每行必须恰有一个 cell 对应每列，cell 顺序与 columns 相同，`cell.columnId` 必须等于同位置 column ID；row、column、cell ID 分别唯一，cell ID 在整张表内唯一。单元格局部样式只覆盖提供字段，其余继承 table style。首发不把列宽归一化为比例；它们是表格内容坐标，渲染时按总宽缩放进 LayerItem frame。

### 3.2 Factory 与命令

- 默认工厂创建 3 列 × 3 行，`headerRowCount = 1`，首行粗体并使用轻微填充；所有 ID 来自注入的 ID factory，不读时间和随机全局状态。
- 行/列插入位置是稳定 ID 的 before/after，不用数组下标作为命令外部参数；删除最后一行或最后一列拒绝且零写入。
- 重排命令接收完整、无重复的 ID 顺序；缺失、额外或重复 ID 拒绝。
- 一次 cell 文本提交、一次行列操作、一次宽高拖动或一次样式提交各形成一条历史事务；键盘移动焦点不写历史。
- 编辑末格后 Tab 的“提交文本并追加行”是一次复合 canonical command：先在同一 candidate 中完成两步并完整校验，再提交一次；失败两步都不写入。UI 不能连续调用两个持旧 revision 的独立命令，也不能关闭 stale 检查；一次 Undo 同时恢复文本与结构。
- 复制整个 Table 复制内容与样式，但 table LayerItem 和所有 row/column/cell ID 全部重建。

### 3.3 渲染与导出

作者画布与 Published renderer 共享一个纯 table layout/view model，不能各自推导列宽或 header 样式。PPTX 使用 PptxGenJS 4.0.1 的 table primitive；每个 cell 保持可编辑文字，列宽、行高、边框、填充、对齐与字体从同一 view model 投影。无法表达的 per-cell 细节进入精确 preflight warning，但表格本体不得截图或遗漏。

HTML painter 分别消费 effective cell/table 的填充与边框透明度，覆盖 0、部分透明与 1；不可把 alpha 简化为是否填充，也不可对整个 cell 设置 opacity 使文字一起变透明。PPTX 已支持的填充保持映射，无法表达的边框透明度继续精确提示差异。

## 4. Chart 合同

### 4.1 精确形状

```ts
interface NativeChartCategory {
  id: string
  label: string
}

interface NativeChartPoint {
  id: string
  categoryId: string
  value: number
}

interface NativeChartSeries {
  id: string
  name: string
  color: string
  points: NativeChartPoint[]
}

interface NativeChartCommonStyle {
  backgroundColor: string
  backgroundOpacity: number
  fontFamily: string
  fontSize: number
  textColor: string
  showLegend: boolean
  legendPosition: 'top' | 'right' | 'bottom' | 'left'
  showDataLabels: boolean
}

type NativeChartContent =
  | {
      chartType: 'bar' | 'line' | 'area'
      title: string
      categories: NativeChartCategory[]
      series: NativeChartSeries[]
      style: NativeChartCommonStyle & {
        showCategoryAxis: boolean
        showValueAxis: boolean
        showGridLines: boolean
        valueMin?: number
        valueMax?: number
      }
    }
  | {
      chartType: 'pie'
      title: string
      categories: NativeChartCategory[]
      series: [NativeChartSeries]
      style: NativeChartCommonStyle
    }
  | {
      chartType: 'donut'
      title: string
      categories: NativeChartCategory[]
      series: [NativeChartSeries]
      style: NativeChartCommonStyle & { holeSize: number }
    }
```

边界固定如下：categories 1–200；series 1–20，pie/donut 恰为 1；label/name 最长 500，title 最长 1000；font size 6–144；opacity 0–1；donut hole size 10–90。所有 point value、valueMin、valueMax 都 finite；两端同时存在时 `valueMin < valueMax`。

每个 series 必须恰有一个 point 对应每个 category，顺序与 categories 相同，`point.categoryId` 匹配；category、series、point ID 分别唯一，point ID 在整个 chart 内唯一。pie/donut 值必须非负且至少一个大于 0；bar/line/area 允许任意 finite 值。`bar` 在 UI 与 PPTX 中固定表示纵向簇状柱形，不因库枚举名称改成横向条形。

### 4.2 Factory、命令与渲染

- 默认工厂创建 3 个分类、1 个系列与可读的非零示例值；复制时重建全部子项 ID。
- 分类/系列插入、删除、重排使用稳定 ID；不得删除最后一个分类或系列。一次表格式数据提交先完整校验 candidate，再原子替换，非法单元格不造成部分写入。
- 类型切换保留 categories、series、point ID 与数值；切入 pie/donut 时若多系列，必须在 UI 要求教师明确选择保留系列，不能静默丢弃。教师未选择则零写入。
- 作者与 Published 共用一个纯 chart view model。Canvas/SVG 绘制必须有确定性；空白、NaN 或长度不一致是诊断，不是“渲染为空”。
- pie/donut 的单分类或多分类中只有一个非零值时必须绘制完整圆/环，零值分类不生成伪扇区；完整圆周不能退化为起终点相同的单段 SVG arc。
- 类型决定几何：bar 只绘制柱体，不叠画折线/点；line/area 保留各自语义。笛卡尔图的可见几何受 plot 约束；自定义轴范围不包含 0 时，柱体/面积基线投影到可见边界并裁切，数据不改写为边界值。
- `showGridLines`、`showCategoryAxis`、`showValueAxis`、`showDataLabels`、`showLegend` 与四种 `legendPosition` 都由实际 painter 消费；数值轴包含可读刻度，图例位置参与布局。关闭开关必须移除对应绘制，不能只保存字段或只改变摘要。
- PPTX 五类都使用原生 chart：bar→clustered column，line→line，area→area，pie→pie，donut→doughnut。若当前库无法表达已承诺的共同样式，只对该样式给 warning，不能把整张图降成图片。

## 5. Slide Native input 与提交语义

### 5.1 精确形状

```ts
interface NativeInputStyle {
  fontFamily: string
  fontSize: number
  textColor: string
  fillColor: string
  fillOpacity: number
  borderColor: string
  borderOpacity: number
  borderWidth: number
  cornerRadius: number
  horizontalAlign: 'left' | 'center' | 'right'
  padding: number
}

interface NativeInputContent {
  answerType: 'text' | 'number'
  stateKey: string
  validityKey: string
  placeholder?: string
  ruleFamilyRuleIds: string[]
  style: NativeInputStyle
}

interface InputSubmitTrigger {
  type: 'input.submit'
  nodeId: string
}
```

`placeholder` 最长 500；font size 6–144；border width 0–32；corner radius 0–200；padding 0–64；opacity 0–1。两个 key 非空、不同，且各自引用已声明的 `string|number` 与 `boolean` course state。`ruleFamilyRuleIds` 唯一、最多 17；空数组只表示教师已显式选择“保留手改并解除简洁判题管理”，不是正常工厂默认。

创建使用不会碰撞的键：`input.<token>.value` 与 `input.<token>.valid`。token 来自注入的 ID factory；与已有声明冲突时重试，不能附加数组下标。text 默认值 `''`，number 默认值 `0`，valid 默认值 `false`。

### 5.2 归一化

- text：NFKC → trim → 连续空白折叠为一个空格 → locale-independent 小写。空结果无效，否则写归一化字符串。`normalizeShortAnswer` 从 assessment evaluator 抽成共享导出，旧 evaluator 必须调用同一函数。
- number：NFKC → trim 后必须完整匹配 `^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$`，随后 `Number(...)` 且 `Number.isFinite`。逗号、十六/二/八进制前缀、下划线、裸正负号、裸小数点、NaN 与 Infinity 均无效。
- 无效提交把 value key 重置为该声明的 defaultValue，并把 validity key 写 `false`；有效提交写归一化值与 `true`。不得保留上一次有效值。

### 5.3 事件端口与原子批量写

Surface port 只增加下列窄接口，不增加任意 DOM 回读：

```ts
interface PublishedInputDescriptor {
  answerType: 'text' | 'number'
  stateKey: string
  validityKey: string
  defaultValue: string | number
}

describeInput(nodeId: string): PublishedInputDescriptor | null
bindInputSubmit(nodeId: string, listener: (rawValue: string) => void): (() => void) | null
```

Slide port 的 descriptor 从当前有效 Published render plan 中的 Native input 读取；DOM `dataset` 只可用于查找 mount，不是业务数据。Flow/Spatial port 不实现这两个成员。Controller 构造时先验证每个 `input.submit` target 能解析为真实 scene-local input，再绑定事件；不存在、类型不符或绑定失败均产生定位诊断并跳过该规则。

`CourseStateStore` 增加仅宿主内部使用的 `setMany(entries)`：先拒绝重复 key，并对所有值完成 pure-data clone/validation；全部成功后才更新 Map，最后只发一次 `{ type: 'batch', entries }` change。空数组无操作。任何一项失败时 Map 与 callback 均不变化。它不加入 Runtime/Component 可见的公共 `CourseStateStore` 接口。

`PublishedInteractionSessionPort` 增加 `setCourseStateBatch(entries)` 并由 whole-course session 接到同一个 store；静态 capture 与编辑画布的 frozen store 必须覆写为零写入。只有真正的 try-run/Player session 使用可变 store。Controller 在任何规则条件求值之前调用一次 batch；成功后才匹配全部规则，失败则本次事件零规则执行并诊断。

### 5.4 规则族

数值族恰为 4 条：invalid、correct、low、high。correct 条件为 valid=true、value>=min、value<=max；low/high 都带 valid=true。`min <= max`，精确答案用相等上下界。

文本族恰为 n+2 条：invalid、每个规范化正确答案一条 correct、一个 error。答案 1–15 个，规范化后唯一。error 是 valid=true 加对每个答案的 `neq`，因此不新增 OR 条件。invalid/普通错误/low/high 复用同一教师错误反馈，教师界面只暴露正确与错误两类反馈。

输入 content 列出的 family IDs 是唯一受简洁 UI 管理的规则。族形状被专业编辑器改变或同 target 出现列表外规则时：

- “保留手改”在一笔事务内只把 `ruleFamilyRuleIds` 设为空，保留全部规则、keys 与节点；
- “按当前配置重建”只删除列表内旧成员并生成新族，不触碰列表外规则；
- 未选择前简洁面板只读并显示冲突，不能静默覆盖。

创建、答案/容差修改、类型切换、复制、删除分别是一笔作者事务。删除先移除节点与 listed family；只有全工程对相应 key 的 input、interaction、navigation guard 引用都为零，且 Runtime/Component source 未出现该 key 的精确字符串，才删除声明；无法证明时保留声明并给 info，不猜测动态代码。

IME 组合期间 Enter 不提交；compositionend 后的 Enter 或显式按钮才提交。Tab 可达、Esc 只放弃当前 DOM draft，输入操作阻止冒泡到画布选择/拖动层。

## 6. Line 几何

`NativeShapeContent` 增加可选且 strict 的 `lineGeometry`，只允许下列两种形状；其他 `shapeType` 携带它必须拒绝：

```ts
type NativeLineGeometry =
  | { kind: 'straight'; start: [number, number]; end: [number, number] }
  | {
      kind: 'elbow'
      start: [number, number]
      end: [number, number]
      axis: 'horizontal' | 'vertical'
      position: number
    }
```

`start`/`end` 是 `[x, y]` 元组；点坐标与 `position` 都在 0–1；start 与 end 不得相同。`shapeType:'line'` 只能匹配 straight，`shapeType:'elbow-arrow'` 只能匹配 elbow。缺字段的旧 line 使用 `(0,.5)→(1,.5)`；旧 elbow 使用 start `(0,.2)`、end `(1,.8)`、axis `horizontal`、position `.55`，读取时不回写工程，首次几何编辑才物化字段。

> 本节点实际交付以元组 `[x,y]` 与 `axis:'horizontal'|'vertical'` 落地（早于本文最终措辞成形），语义与下述算法完全一致，`r12-030-line-authoring` 不再重写已通过 24 项 schema 测试的实现；后续节点引用同一类型时以 `src/shared/contracts/native-v1/types.ts` 的 `NativeLineGeometry` 源码为准。

elbow points 唯一算法：axis `horizontal` 时 `[start,(p,start.y),(p,end.y),end]`；axis `vertical` 时 `[start,(start.x,p),(end.x,p),end]`。因此只有 start、end、elbow 三类语义 handle，不允许实现者引入任意点数组。

直接绘制和 handle 拖动统一走一个 command：把指针用现有 viewport/rotation transform 转到 scene 坐标，计算完整 path 的 axis-aligned bbox，bbox 最小 16×16，原子更新 LayerItem frame 与归一化 geometry。一次 pointerdown→pointerup 只提交一次历史；pointermove 仅本地 preview。吸附只在 8 px screen-space 阈值内作用于画布边缘、中心线和其他可见未锁定 LayerItem 的边/中心，Alt 暂时禁用吸附。

视觉 stroke 与 hit stroke 分离，hit width 固定 `max(12px / viewportScale, borderWidth)`，不得把保存的 borderWidth 放大。Straight PPTX 保持原生 line；elbow 使用由同一 point resolver 生成的 SVG 后备，并产生 `pptx-static-elbow` warning，直到另立可编辑 PowerPoint elbow 合同。

## 7. Background 所有权与解析

### 7.1 additive 字段

不创建独立 background store。只在既有 owner 上增加可选字段：

| Owner | 新增字段 | 缺省与兼容 |
| --- | --- | --- |
| CourseProjectDocument / Published root | `backgroundColor?`, `backgroundAssetId?` | `#ffffff` / null |
| SlideSurfaceDocument / Published Slide | `backgroundMode?: 'inherit'|'own'`, `backgroundColor?`, `backgroundAssetId?` | mode 缺省 inherit |
| SlideSceneDocument / Published scene | `backgroundMode?: 'inherit'|'own'` | 缺省 own；既有 required color 与 asset 保留 |
| FlowSurfaceDocument / Published Flow | `backgroundMode?: 'inherit'|'own'`, `backgroundAssetId?` | mode 缺省 own；既有 color 缺省 `#ffffff` |
| SpatialSurfaceDocument / Published Spatial | `backgroundMode?: 'inherit'|'own'`, `backgroundAssetId?` | mode 缺省 own；既有 color 缺省 `#ffffff` |

所有 asset 字段为 `string | null`。undefined 采用表中缺省；null 明确清除该 owner 的图片。模式切为 inherit 时保留 own 字段但解析器忽略它们，切回 own 可恢复教师先前设置。旧工程没有 Course 背景、Slide surface 背景与 mode，解析结果与 1.1.1 完全相同。

### 7.2 唯一解析算法

先解析 Course：color=`course.backgroundColor ?? '#ffffff'`，asset=`course.backgroundAssetId ?? null`。

- Slide surface：inherit 用 Course；own 用 `surface.backgroundColor ?? '#ffffff'` 与 `surface.backgroundAssetId ?? null`。
- Slide scene：inherit 用已解析 surface；own 用既有 required scene color 与 `scene.backgroundAssetId ?? null`。
- Named state：`backgroundColor` 定义时覆盖 color；`backgroundAssetId` 为 string 或 null 时覆盖 asset；undefined 分别继承 scene 结果。
- Flow/Spatial：inherit 用 Course；own 用 `surface.backgroundColor ?? '#ffffff'` 与 `surface.backgroundAssetId ?? null`。

该算法只实现一次纯函数，作者预览、Published producer、Player、HTML、PPTX、DOCX 与静态 capture 全部调用或消费它的序列化结果。素材缺失不是退回下层背景：保留已解析 color，图片省略并给精确 missing-asset error。

UI 必须显示并可切换当前 owner。Course、Slide surface、Scene、State、Flow surface、Spatial surface 的每次颜色、素材或模式提交只写该 owner，一笔历史；切换查看不写工程。Named state 的“继承”通过删除它的两个 optional override 表达，不增加 state mode。

PPTX 使用页面 background color 加铺满页面的 background image；DOCX 使用 page/section color 与 header-anchored full-page image，表达差异给 warning；不支持平铺、渐变和混合模式。

### 7.3 共享颜色控件与一次操作的边界

`r12-040-background-authoring` 同时承担共享 ColorInput 的基础取色体验。六个背景 owner、文字/图形/表格/图表样式、教师控制器及现有 Token 颜色编辑等实际 ColorInput consumer 统一使用同一控件；保留各字段的透明度与继承语义，不借取色器新增 V9 字段。

- 打开控件首先可直接选固定常用色块，至少包含黑、白、灰阶和常用彩色；各色块有可读名称/HEX 与当前选中提示，不仅靠颜色区分。保留“自定义颜色”连续面板和合法 `#RRGGBB` 输入。常用色定义只有一个来源；1.2 不创建工程主题、自动 token 绑定或第二配色表。最近使用色不是本版交付前置条件。
- 颜色控件的 React 身份按稳定编辑目标绑定；revision 用来判定提交是否仍有效，不得直接用作正在操作控件的 key。切换真实目标取消旧草稿并清除临时预览，迟到事件不得写入新目标。
- 共享 preview 回调必须接通真实 owner adapter/画布，不以可选回调存在或 mock 被调用代替交付。取消先阻止后续 blur/迟到事件提交旧草稿，再恢复当前目标的展示；合法 HEX 的 focus→Esc→blur 也必须零工程/revision/历史写入。
- 连续拖动只更新局部草稿及必要的只读临时预览；该预览不进入工程、恢复副本、Published 或历史。一次按下到释放形成一次 commit，一次色块选择形成一次 commit，合法 HEX 由 Enter/失焦提交一次；重复同值零历史，Esc 取消零工程写入。自定义面板的关闭、取消和失焦必须有确定行为，不依赖浏览器原生色板的模糊关闭时机。
- 若某 consumer 本来具有整表“应用”草稿（如 Chart 数据系列颜色），取色结束只更新该草稿；仍由“应用数据”形成一条 canonical 事务，不能提前把系列颜色写入工程。
- 修改工程对象只经该 owner 现有 typed command/history。连续操作的结束与取消要在真实 Renderer/Electron 中验证，单次 `fireEvent.change` 写值通过不能替代色板持续操作证据。

### 7.4 图表插入入口

由 `r12-021-chart-authoring-delivery` 在“常用”保留一个“图表”入口，打开后选择五种类型；名称和类型示意清晰，Esc 关闭且不插入，键盘可完整操作。选择类型一次创建一个对象，随后可立即选中编辑；已支持的按类型拖入定位保持可达，搜索具体类型仍可直达。

Flow、Spatial 和 global 在 1.2 不显示五张重复禁用卡；保留一个可发现的“图表仅支持演示页”说明入口，明确禁用原因，操作不产生工程/history 写入。不为整理入口重新排列无关功能或删除表格、媒体、图形等现有入口。

## 8. Flow 作者能力边界

正文 paragraph/heading/quote 与正文 image 继续是 FlowBlock 文档流；不得增加 x/y/rotation/z-order。自由文字、图片、公式、视频和 shape 是 `surfaceLayerItems` 浮层，继续用既有 LayerItem、visibility、bodyPlane 与 canonical Flow command。

Shape 属性编辑器从 Slide 提升到 shared properties owner，Slide 与 Flow 通过各自 adapter 写回；不能复制第二套控件或默认值。至少 rectangle 与 line 覆盖 shape type、fill color/opacity、border color/opacity/width/style、corner radius 与适用 arrow。Flow 画布、Player 和 HTML 使用同一 shape view；如果 UI 写入正确但画布仍只显示轮廓，本节点继续修共享渲染映射，不能把问题推给 DOCX。

## 9. Flow DOCX 专用投影

### 9.1 文档与锚点

DOCX 构建入口接收完整 `PublishedCourseV2Payload` 与目标 Flow surface ID，先解析 locations、global layers、surface layers 与 assets，再生成一份连续 Word 文档。它不得改变 PDF/print 使用的 `FLOW_PRINT_INCLUDES_FLOATING_LAYERS = false` 语义。

正文按 Flow blocks 原顺序写入。每个可见 surface 浮层只落一次：include 取 surface location 顺序中的第一个匹配 location；exclude/all 取第一个 Flow location；空 Flow 创建一个锚点段落。普通 global 项不论覆盖多少 location 也只落一次并锚到文档首段。

`paperSpace:'paper'` 的 y 通过当前 Flow layout 的 block top 选择不大于该 y 的最近 block；没有可用 layout 则首段并 warning。viewport 项默认首段且只出现一次，并报告坐标语义转换。唯一可重复例外是 global `teacher-controller` 同时满足 visibility.mode=`all` 与 `includeInStaticExports=true`；它进入 footer，其余 global 内容不得进入 header/footer。

像素到 Word 使用 96 DPI：`EMU = round(px * 9525)`；x/y/width/height 相对 page content box，越过可打印区时等比缩小并 clamp，记录原 frame 与实际 frame。rotation 转为 1/60000 degree。underlay 使用 `behindDoc=true`；surface overlay 的 relativeHeight 从 1 递增；global overlay 从 100000 递增，稳定次序为 plane、order、layerItemId。

### 9.2 内容转换矩阵

| 内容 | disposition | Word carrier |
| --- | --- | --- |
| Flow paragraph/heading/quote/list/table/image/formula/code/callout/section | `preserved` | 沿用正文语义映射 |
| Native text 浮层 | `editable-shape` | anchored DrawingML text box |
| Native rectangle/rounded rectangle/ellipse/triangle/diamond/line/elbow | `editable-shape` | Word preset geometry / connector；无法表达精确 elbow 时 SVG + `static-fallback` |
| 其他 Native shape | `editable-shape` 或 `static-fallback` | 有明确 preset 才可 editable，否则同一 renderer 的 SVG/image |
| Native image | `image` | anchored picture，保留 crop/fit 的确定性结果 |
| Native formula | `preserved` 或 `static-fallback` | OMML；无法转换时图片并带 accessibleText alt |
| Native video | `static-fallback` 或 `placeholder` | poster/static fallback；缺失则可见占位 |
| Component / Runtime | `static-fallback` 或 `placeholder` | 声明的 fallback；缺失则可见身份占位 |
| teacher-controller | `excluded`、`editable-shape` 或 footer repeat | 服从 includeInStaticExports 与上节唯一重复条件 |
| Native input/Table/Chart | `rejected` | 它们在 Flow 非法；导出前 health/preflight 阻断并定位 |
| Flow/Course background | `preserved` 或 `approximation` | page/section color、full-page header picture；差异必须诊断 |
| 运行期目录/会话 UI | `excluded` | 明确标记 intentional-session-ui，不计作者内容丢失 |

每个作者浮层必须有一条报告，不允许只写“省略 N 个”。报告项固定包含：`surfaceId`、`layerItemId`、`scope`（surface/global）、`locationId|null`、`fieldPath`、`disposition`（preserved/editable-shape/image/static-fallback/placeholder/excluded/rejected/approximation）、`reasonCode`、`message`、`sourceFrame`、`outputFrame?`。

自动化工程门：解压 DOCX，解析 document/header/footer XML、relationships 和 content types；断言 text box/shape/picture 是 DrawingML 对象、普通 global 只出现一次、显式 controller 只在 footer、诊断逐 item 完整，并用现有渲染器或 LibreOffice（若环境已有）打开生成物。Word 内选择、修改、另存是 S1 的 Owner accepted 证据，不阻断 1.2 engineering candidate，也不得在 1.2 报告中宣称已由自动化证明。

## 10. 诊断、能力索引与无障碍

- Schema error 保留精确 field path；语义 error 至少含 surface/location/layerItem identity。任何 unsupported export 都在 preflight 与结果报告中出现，不能只写控制台。
- Table：重复/悬空子项 ID、行列不对齐、非法尺寸。Chart：ID、长度、非法数值、pie/donut 约束。Input：容器越界、key/类型、target、族完整性。Line：kind/shape 不匹配、退化路径。Background：missing asset、非法 owner/mode。DOCX：逐项 disposition。
- 可见 UI 的 Table、Chart、input、Line 与 Background 入口均可由键盘到达；Table 支持 Tab/Shift+Tab 移格，input 的运行控件有 label/placeholder 可读名称，图表提供 title 与数据摘要 accessible text。
- 只有 `r12-007-input-response-delivery` 在其实现完成后生成一次能力索引；`r12-050-native-closure` 在所有上游合入后重新生成最终索引并检查 source evidence 已覆盖 `src/shared/contracts/**`。并行节点不得手改 generated JSON。

## 11. 共同停止条件

以下不是实现选择，而是越界；命中时保留零部分写入证据并升级 Owner：

- 必须改变既有 V9 字段语义、放宽 strict、创建 V10/Published V3，或恢复 V8 consumer；
- 必须给 Table/Chart/input 扩大本合同的有效域，或以 Component/Runtime/截图替代作者真相；
- 必须新增交互条件类型、修改 `course-state.set` wire、让 `InteractionEngine` 复制 Published course-state 语义；
- 必须建立第二 Store、History、Published session、background state、table/chart UI data mirror 或第二 shape style owner；
- 必须改变 Flow 正文流语义或 PDF/打印当前行为才能交付 DOCX；
- 必须静默丢弃作者内容、未知字段、越界 Native、缺素材或不支持的导出；
- 目标符号已迁移且无法由正式 Owner/consumer 关系唯一定位，或目标测试显示当前产品决定与本文冲突。
