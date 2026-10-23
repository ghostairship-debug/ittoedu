# 在工程里创作

这些是正式课件内容的工程虚拟文件视图，不是磁盘里的同名文件。用 `project.list/read/apply` 读取和修改；普通策划、HTML 源文件等磁盘/工作区文件用 `file.*`。读取包含教师的当前修改，软件负责身份、资源、事务和撤销；页面顺序变化后路径也可能变化，使用本次 `project.list/read` 返回的路径。

已有精确目标或实际路径时直接读取；需要内容地图时再 `project.list`。目录给正文摘要、类型入口和frame，共享API按单独reference读取，不逐组件重复展开。新作品用 `file.create {name:"四季的成因.glx",kind:"course-v10"}` 新建一次，软件建立空工程，AI新作不默认插入可见完整教师台。已有用户指定课件则继续使用，不创建同名文件重做。仅有一个课件时省略 `project`；多个课件时填写实际文件名或路径。

外部 MCP 使用软件提供的连接配置或可运行样例。相对文件名从宿主工作空间解析；用户指定已有课件时，`file.open` 可使用已授权的绝对路径。源 HTML 或素材所在目录不决定课件的保存位置，以工具返回的实际路径为准。

| 文件视图 | 内容与作用 |
|---|---|
| `pages` | 页面目录与顺序；新增页面的目标 |
| `roots` | 作品根与入口的当前目录；包含完整程序根 |
| `entry.html` | 当前完整 HTML 程序入口；与 roots 下相应对象指向同一正式实例 |
| `theme.css` | 整课主题样式 |
| `pages/01-导入.json` | 页面结构、表面类型与人工位置；可向该页插入内容或明确重做 |
| 页面对应的 `.html` | 软件能提供 HTML 投影时的当前布局内容 |
| 页面目录里的 `.data.json`、`.style.json` | 单个对象的正式专业数据与样式 |
| 已列出的 `.container.json` | 该实例的 Slide、Flow 或 Spatial 容器配置及真实子对象；容器可嵌套 |
| 页面对应的 `.body.html`、`.body.md` | Flow 连续正文；保留专业语义、浮层和人工位置 |
| 页面对应的 `.spatial.json` | Spatial 镜头、停靠点、路径和对象引用 |
| `components/` 中的 `.definition.json`、`.view.ts/js` 或 `.source/…` | 共享定义及其源码；源码修改作用于未独立实现的实例 |
| 页面目录里的 `.view.ts/js` 或 `.source/…` | 当前实例的独立源码与完整文件集 |
| 同一源码入口下的 `.dependencies/…` | 工程内的完整实现依赖；沿该入口深改，软件保留未改共享依赖并隔离其他实例 |
| `global/underlay/`、`global/overlay/` | 全局对象，包括当前教师控制台 |
| 已列出的素材路径 | 工程内图片、声音和其他资源 |

上表路径只是形状示例，名称和序号由软件从当前工程生成，不手工登记或推算。

完整 HTML 程序作品可在同一工程使用 `project.apply {path:"entry.html",intent:"program.set",content:"完整 HTML"}`，或以 `from` 提交已授权来源及其相对资源闭包。软件建立或更新真实 Source 根和作品入口，按实际运行视口显示；已有内容根保留，仅全新未动过的工厂空白页可被替换。已有程序沿 `entry.html`、返回的 `.content.html`、`.data.json` 或源码路径继续修改，不创建第二份作品。三类容器仍可独立作为根或嵌入其他实例，进入容器编辑不会重建作品。

长文本分页规则不同：`file.read` 将回执 `nextCursor` 传给 `cursor`；`project.read` 将回执 `nextOffset` 传给 `offset`，可设 `limit`。工程续页读取固定来源；省略offset新读当前稿，`refresh:true`可在指定offset局部刷新当前稿，按回执basis/revision/currentRevision区分。`project.read {path,query:"字面内容"}`直接搜索当前未保存文件，返回命中附近、行列、offset和版本；此时limit为命中数。`full:true`请求完整来源，超过实际交付容量仍返回 `complete:false/nextOffset`，可续读全部，不表示文件受大小限制或模型已读完整内容。不要混用游标和偏移。写结果只给最小提交/目标/版本事实，已提交 Source 正文不默认回显；`complete:true`才表示所附短入口全文实际交付，元数据不升级未读人工值。内置大结果按 context/programmatic 原引用续读；外部 MCP 大结果可用回执的 `operation.read {ticket,path,offset,limit}` 读取同连接当前授权范围的冻结原值，不重放原调用。

修改先读目标，再调用 `project.apply {path,content}`；`content` 是该文件的完整新文本，软件只提交实际改变的正式字段。也可用 `project.apply {path,from}` 读取已授权源文件或本任务成果来源及实际相对资源闭包。当前打开的Source是当前稿，尚未保存或原磁盘文件移动/删除时仍可沿其已绑定来源采用；单独导入新文件以实际文件为准。计算/委派回执的 `source` 可直接用作 `from`，软件采用入口和同组相对依赖，无需先逐文件落盘。读取后若人工修改与本次改动冲突，保留输入并重新读取目标，不覆盖教师的新改。

只改已知的一小段源文时，使用 `project.apply {path,edits:[{old:"当前原文",new:"修改后原文"}]}`，不必重抄整份源码。路径仍须先观察，每处 `old` 在已观察文本中必须唯一；多处按顺序替换，全部成功才一次提交。它处理字面文本，不是正则或模糊查找；未命中或多处命中时按诊断重读并给出准确范围。局部替换用于 `content` 或 `style`，不能借它 `insert`、`redo` 或 `enhance`；`content`、`from`、`edits` 三种输入择一，人工修改保护、源码消费与保存语义保持。

对象 `.content.html` 内的正文、CSS和脚本都是该文件的源文；对它使用 `intent:"style"` 的字面文本修改也按源文更新处理，不要求转写为主题或结构化样式。专业 `.style.json` 等结构化样式仍用其当前格式。应用失败时按具体诊断中的实际文件、当前frame/viewport及可读修复路径续改；可用 `.content.html`、`.data.json`、Source或授权文件入口完成的修正直接处理。结果为 `unknown` 时先查证原操作，不借兜底重复提交未知副作用。

按实际回执判断结果：`commit:"committed"` 表示已提交，`unchanged` 表示内容等价；同时读取 `usability` 和具体诊断。`not_committed` 或 `unknown` 不能宣称已应用，未知结果沿原操作查证，不重新提交同一修改。工具传输成功不代替提交回执，已提交也不代替实际画面或互动检查。

插入、源码定制或定义改名后，回执 `files` 给出实际当前文件路径；可直接使用已回报的 `path` 继续。若返回 `readPaths`，先读相应文件；若返回 `refreshPaths`，说明与旧观察重名，先 `project.list` 刷新目录。`currentPath` 仅说明当前位置，不代表旧句柄或旧内容已经更新。路径读取失败的诊断不撤销已经提交的修改。

已确定页面可通过同一入口批量建立：

```json
{"path":"pages","intent":"surface.add","pages":[{"kind":"slide","title":"观察地轴"},{"kind":"slide","title":"比较两种倾角"}]}
```

新course-v10自带一个空Slide，先计入并复用或改名；示例数组用于其余新增页面。单页或数组中的每页都可携带 `content` 或授权工作区源文件 `from` 首稿，软件先建页再装配内容，一次正式提交和撤销，保留已有空白页。回执`targets[].path`是各页的真实结构路径，可用于`project.read/apply`及 `object.insert {path:页面路径,…}`。已有页面或容器句柄也可继续作为 `object.insert.target`；需要句柄时，一次`listChildren {target:整文档句柄,limit:100}`取得各页`target`，更长目录按回执分页。同一课件多个已授权页面的原生插入/修改可用`batch`，软件维护身份、一次提交与撤销。已有目标沿本任务ACK续用，不逐对象刷新；明确冲突按诊断处理。单页仍可使用`kind/title`形式。现有页面用`surface.move`调整顺序，`before`填已观察的另一页路径，省略即移到末尾；`surface.title`携带`title`改名；`surface.remove`删除该页。

`content` 修改已观察对象的内容，保留其他对象、顺序和人工位置；它不是向已有页面追加内容。向页面结构路径添加内容用 `intent:"insert"`，用户明确整页重做时用 `intent:"redo"`。普通局部修改用对象文件或已有 HTML 投影，不用重做覆盖人工位置。页面内容可以使用普通 HTML/CSS；简单示意图可内联 SVG，实际图片和组件引用沿用读取内容与当前工具返回的路径。

同一工程已观察路径的多项内容、样式、HTML插入/重做或Source修改，可用 `project.apply {operations:[{path:"实际路径",content:"本项内容"},…]}`。各项沿用单项 content/from/edits/intent，软件逐项准备并汇总为一次正式提交和撤销，回传逐项诊断及路径。此批引用已有路径；新页面的已确定首稿随 `surface.add` 提交，后续需要新页路径的部分沿建页回执接续。

新片段可选 `region:{width,height,transform:[1,0,0,1,x,y]}` 表达设计区域，单项、`operations` 中各项和 `surface.add` 的页首稿均可携带。软件以width/height建立局部测量视口，将transform交给新内容的正式frame；区域不另存为一套布局。委派时在target中声明一次明确区域，冻结事实贯穿子任务、候选预览和同目标成果采用，采用时无须重复填尺寸，显式新region可覆盖本次选择。区域未确定时按回执澄清实际范围，不能把默认预览大小当成已决定的构图。内容可使用百分比和 `vw/vh`，无须固定像素根。省略区域仍可采用整页内容及有意重叠；按实际诊断判断结果。已有对象的 `content/redo` 保留当前frame，即使传入不同区域也不会顺带重排；明确移动和缩放使用 `object.update`。

插入普通专业元素可直接用 `object.insert`，指定已观察的页面 `path`，或页面/容器句柄 `target`、类型和正文，以及用户需要的位置尺寸；路径入口可选实际 `project`。软件沿用人工插入默认，准备专业数据、容器与身份。Flow 的 `destination:"document"` 表示正文，`"paper"` 表示纸张浮层，无需先创建内部专业对象。

新表在插入时可带 `kind:"table",table:{rows:[["项目","数量"],["甲类","20"]],headerRowCount:1}`；省略 `table` 保留默认。明确替换已有整表内容时，`object.update.properties.data` 或当前 `.data.json` 接受 `{rows:[[...]],headerRowCount?}` 完整可见文字矩阵。软件维护行列/单元格身份，保留对应外观、未变富文与有效合并，也处理已有合成列头；输入覆盖格新正文时只解除相关合并，保内容可见。局部改格继续用 `object.author` 的专业单元格操作或已读专业数据，已有显式身份格式保持有效。

需要现有配方时用 `course.recipes` 取得配方及正文槽位，再用 `surface.recipe` 提供选定配方和文案；参考页改写用 `surface.remix.inspect` 取得可替换槽位，再由 `surface.remix` 完整复制并改文案。用户决定内容、项目正确顺序和设计，软件保留或装配布局、规则、展示状态与内部引用；这两类新页操作需要整课授权。批量查找替换或项目颜色调整使用 `course.productivity` 的普通意图，选择本页、含全局层的表面或整课范围，不逐字段拼补丁；后两种范围需要整课授权。具体输入取当前工具定义，不另外维护模板或对象登记表。

移动或缩放已有自由对象，使用 `object.update` 的路径入口，不改整页 HTML 来重新排版。`path` 使用本次 `project.list/read` 返回的对象 `.data.json`、`.style.json`、`.content.html` 或实例源码路径；页面结构、主题、共享定义和连续正文路径不代表单个自由对象。例如：

```json
{"path":"本次读取的对象文件路径","properties":{"frame":{"x":120,"y":80}}}
```

这段参数传给 `object.update`；多个课件时另填实际 `project`。`frame` 可只改 `x`、`y`、`width`、`height`，保留未改的属性与其他对象；需要旋转时用同层 `rotation`。正文中没有自由 frame 的对象不能这样移动，锁定对象按实际锁定回执处理。正式身份由软件从已观察路径解析，不填写内部编号。

多对象对齐或等距分布用 `object.layout`，`targets` 沿用已观察对象句柄，`intent` 表达对齐方向或水平/垂直分布，例如 `{kind:"align",alignment:"left"}`。对象须在同页同展示状态；软件复用人工布局算法，计算世界坐标、父变换和 frame，并保留锁定对象，一次事务可撤销，不手算每个对象的坐标。

Flow 正文使用其 `.body.html` 或 `.body.md`，保留源文中软件生成的专业对象引用。两者是同一正式正文的不同表示，选一种完成本次修改即可，不再向另一表示重复提交同一改动；还要继续修改时读取当前内容。Spatial 用 `.spatial.json` 修改镜头与路径：`stops` 表示顺序停靠点，`target`、`objects` 引用已观察对象路径；保留已读 `ref` 可重排现项，新项省略 `ref`。`paths.stops` 使用已读镜头 `ref`，新镜头也可用本文件从 1 开始的镜头序号；对象路径用 `objects` 表达成员并置 `stops:[]`，镜头路径不填 `objects`。`defaultRoute:"frames"` 按镜头顺序播放，也可填已读路径 `ref` 或本文件从 1 开始的新路径序号。省略 `defaultRoute` 保留既有默认；尚无正式默认时按镜头顺序，读取不会补写。删除默认路径会明确提示并回到镜头顺序。编辑时临时选中的路径不改变正式默认；试运行与 Published 消费同一默认路线，明确指定镜头的跳转仍尊重目标。软件维护稳定身份，修改镜头不重排世界对象。

复杂实验、模拟和游戏可以作为独立内容程序插入；需要继续改源码时读取对象实际的源码文件。共享定义源码与实例独立源码是两种明确范围，按用户意图选择。默认实现、专业数据与外部资源保持可编辑；局部无法处理的内容保留原文并报告诊断，不把静态截图当成功。

内置组件默认给出短作者入口，通过普通 import 引用工程内的真实 Source 依赖；读取不会把内置对象改成源码，首次应用时软件一并保存所需实现。局部增强可向当前实例主 `.view.js/.view.ts` 或 workspace 入口用 `project.apply {path,intent:"enhance",content}`，也可沿授权 `from` 提供业务模块。模块导出 default 函数或具名 `enhance(context)`；软件等待原实现挂载并组合其更新、销毁生命周期。回执 `enhancementPath` 给实际业务模块，后续沿该路径以普通 `content` 或局部 `edits` 修改业务。确需完整深改时，主入口的普通 `content` 编辑与 `.dependencies/` 继续有效。实例入口的依赖修改只影响当前实例；`components/` 共享定义入口影响使用该定义的实例。HTML、专业数据、作者记录和资源仍沿原文件继续修改。

增强的 `context` 提供当前 `root/instance/scope`，`listen(type,selector,listener)` 在局部根委托监听并自动清理；`observe(key,render)` 以同一函数呈现首值及后续运行状态。显式别名通过 `object.update.properties.stateBindings` 映射到已声明的标量 `courseState.key`：仅合并提供项，单个 `null` 删除该别名，整体 `null` 清空。增强的 `bindings.get/set/observe(alias)` 消费这些映射，`bindings.observe` 同样立即给首值并自动清理订阅。同课普通复制保持共享；已有托管输入键复制映射时同步重绑，任意 JS 字符串不扫描改写。需要 JSON 结构的运行状态仍由业务显式使用 `scope.state`，不自动写入作者工程。

`scope.state/events.subscribe` 与 `teacherController.subscribe` 已自动随挂载清理，无需重复登记 `scope.cleanup`；原始 state/tc 订阅不回放首值，首次显示另读 `get/read`，或对状态使用增强的 `observe`。`listen` 管理局部 DOM 监听，自行建立的其他监听、定时器或 Observer 等资源按需交给 `scope.cleanup`。普通暂停、跨页保留挂载，销毁、取消或重置时清理。完整 `.view.*` 仍是 API5 实现入口；独立替换完整 `mount` 需返回含 `update/dispose` 的有效实例。普通正文、样式和页内脚本继续修改 `.content.html`，由成熟 Web 实现负责更新与清理。

跨对象、跨 iframe 的位置用 `await context.scope.measure?.([{kind:'instance',instanceId:实际目标ID}, ...])` 一次批量读取；`sampleTime` 是宿主 `performance.timeOrigin + performance.now()` 毫秒，同批条目来自同一次同步布局观测。每项 `viewportFrame` 将目标边框内像素映射到调用者视口，未挂载或不可测为 `null`，已挂载离屏目标仍可测。Flow 的 `contentFrame` 位于实际滚动 owner 的未缩放内容坐标，`contentToViewport` 把该内容坐标映射到同一调用者视口；`flow.viewport` 是内容空间内的可见滚动窗口，其 `x/y` 为同批 `scrollLeft/scrollTop`。矩阵 `[a,b,c,d,e,f]` 作用于点是 `{x:a*x+c*y+e,y:b*x+d*y+f}`。一次动画计算只用同一批样本，不能混用历史视口坐标与后来读取的阅读进度；布局变化后重测，挂载退出后不再采用旧样本。高频视觉更新复用 `scope.target(...).motion.replace` 的 `write/nextFrame/animate` 或程序自己的 Canvas 绘制；这是暂态呈现，不把每帧几何写入工程或全局 `scope.state` 广播。

成熟 Web 实现导出 `document:'web'`，短入口用 `...implementation` 继承该声明后可继续使用完整/嵌套 HTML、模块和资源。宿主实际载入一次 Source，再按声明准备浏览器文档，真实 `DOMContentLoaded` 后调用原 `mount`；DOM 和监听在 `mount` 中建立。准备采用浏览器 `document.open` 语义，其 `readyState` 与首次导航可能不同。完整替换为没有此声明的实现时，宿主不会因为保留了 `data.html` 就执行它。普通 HTML `<script>` 仍没有 API5 的全局上下文。

正式导航、快捷键和可选教师控制台复用同一运行状态。AI 新作不自动插入可见完整教师台。独立对象点击跳页可用 `interaction.update {target:"已观察的独立对象句柄",change:{kind:"click",action:"location-go",value:"已观察的目的页面句柄"}}`，无需为此读取完整实现或改为 Source；一个 HTML 实例内部多个按钮的不同动作及程序共享状态，可按实际源码入口添加局部增强并使用宿主端口。按需读取创作方法的导航与控制参考。旧工程已有界面按用户要求保留或修改。程序自己处理的按键应阻止重复处理；未处理的翻页键交给宿主。

新作沿自身内容提供导航和非键盘推进入口，不依赖宿主外底栏。需要明确关闭外底栏时，`course.configure {target:整文档句柄,settings:{playback:{controls:"none"}}}` 使用已有播放设置，保留作品内导航与其他播放设置。局部程序的完成动作需要跨页时，通过实际Source入口的 `context.teacherController.execute` 执行正式动作；普通HTML脚本没有这个全局变量，不能自造全局桥。`project.read`与内容应用回执的`frame/viewport`直接给出当前对象的正式几何和内部可用尺寸，素材按此接力；替换沿当前对象进行，软件保持未修改的外框，不为换内容另建同位置对象或重复补尺寸。

需要准备教师控制台时用 `teacher.ensure {target:"已观察的演示页句柄"}`，已有控制台直接复用；缺失时软件按人工插入默认创建全局控制台，真实插入需要整课授权。普通使用不要求模型查内部控制器身份或预先组装它。

检查关键页用 `view.observe {path:"本次读取的页面路径"}`，多个课件时另填 `project`。观察不改变教师当前页面或文档；需要确认互动时执行对应操作并查看结果。观察失败、超时或没有返回图片时，报告该回执和缺少的证据，不把代码、应用成功或保存成功当成已看见画面；按具体诊断处理，不重复同因调用。

修改进入正式工程与恢复稿。用户要求保存或交付已保存文件时使用本任务引用或 `file.open` 返回的整文档 target 调用 `file.save`，依据保存回执的实际路径与状态，再说明已保存；恢复稿提交本身不表示正式文件已更新。策划 MD 是普通工作区文件，通过 `file.write` 保存；策划与工程的保存状态分别说明。
