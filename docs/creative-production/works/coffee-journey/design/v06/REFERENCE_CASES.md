# 《一杯咖啡的远行》参考案例索引 · v06

本页供人工与 AI 按具体创作问题选择案例。每次只读取对应源码、配置和必要截图。正式作者事实在 [可编辑 GLX](native/coffee-journey-v06.glx)；[单文件 HTML](native/coffee-journey-v06-offline.html)用于交付验证；源码文件供检索与改写，修改后须沿正式事务重新应用到 GLX。

**定位与验证**：[OBJECT_INDEX](native/OBJECT_INDEX.json)记录本版对象地址；最终文件、revision 和校验值见 `DELIVERY_MANIFEST.json`。最终证据统一查 [VERIFICATION](VERIFICATION.md)，包括真实画面、互动、事务、保存冷开和离线交付。下列 ID 只用于定位本作品，复制到新工程后须通过 `project.read / project.list` 获取当前目标。

## 按问题选择

| ID | 要解决的创作问题 | 复用等级 | 首选入口 |
| --- | --- | --- | --- |
| `coffee-continuous-underlay` | 用一个持续物件与统一底色串联多章阅读 | 配置与绘图机制可改写 | 背景 Source、实例阶段配置 |
| `coffee-alternative-states` | 在相同时点、相同尺度比较不同方案的结构 | 状态机制与图解组织可改写 | U03 SVG、结构矩阵、选择／比较状态 |
| `coffee-keyframes` | 让同一物件在三个关键画面间连续变化 | 关键帧合成机制可改写 | U05 已装配 HTML、三张配准素材 |
| `coffee-fixed-solute` | 一个状态同时驱动画面、数值与反馈，突出不变量 | 固定溶质稀释机制可配置复用 | U06 引擎与配置、糖水正式小样 |
| `coffee-native-hybrid` | 原生图文可持续编辑，同时承载局部复杂互动 | 正式工程装配方法 | Flow 对象索引与三个程序位置 |

## 1. `coffee-continuous-underlay` · 跨章节持续物件

| 字段 | 内容 |
| --- | --- |
| 适用条件 | 连续阅读中需要跨章视觉身份、气氛与材料阶段变化；前景仍由原生图文和局部程序组成。宿主须提供正式阅读目录与 `teacherController.read/subscribe`，允许全局背景 Source 持续存在。 |
| 复用等级 | 一份 Runtime 的状态绑定、短转场和生命周期可复用；主题形态与阶段轨迹需设计。可通过配置和自定义 SVG 改写小型案例，不是任意主题的自动背景生成器。 |
| 必要素材 | 咖啡形态直接使用 Canvas 路径、渐变、分层剥离和确定性颗粒，无外链图片。跨主题可提供 `data.symbols` 的 SVG 字符串。 |
| 修改入口 | 背景实例 `data.chapters`、可选 `originTarget`、`stages`、`durationMs`、`paperDurationMs`、`symbols`；阶段字段包括底色／氛围、桌面与手机位置和尺寸、透明度、形态权重。形态笔触改 `bean / fruit / cup / solution / graphic`。 |
| 实际源码 | [background-runtime.js](background-runtime.js)。配置保存在 GLX 背景实例数据中，具体实例见 [OBJECT_INDEX](native/OBJECT_INDEX.json)。 |
| GLX 位置 | 主工程 `global.underlay` 的唯一背景 Source；七章映射指向 Flow `47415583-2d75-4b72-9c46-dfd29b47d82a` 中的正式阅读锚点。它与前景导航共享宿主阅读事实，不拥有第二套导航状态。 |
| 验证边界 | 七章桌面／手机、正反向及快速跳章、减少动态、单实例检查已通过；`symbols.onload` 帧句柄竞争已修正并通过定向行为验证。最终证据统一查 [VERIFICATION](VERIFICATION.md)。 |

阶段叙事为：杯 → 红果 → 组织剥离／种子 → 生豆 → 烘焙豆 → 粉末与溶质 → 回到杯。章节变化触发从当前画面到新目标的短转场；静止时停止动画。U05 背景采用章节级焙豆状态；滑块进度仍由 U05 局部程序独立持有。

修改时保留一份 Underlay 和透明前景；必要的局部阅读面板可以保留。不要恢复各章独立全幅不透明底色。当前宿主对 viewport-pinned 对象统一扣除至少 18px 的右／底控制器预算，这是已知显示限制；源码不能通过越界访问宿主或另建背景来掩盖。

SVG 配置迁移应按实际阶段验证。当前 `symbols` 使用索引插值，跨过多个离散索引时可能短暂显示中间图形；不可把此机制称为任意 SVG 几何 morph。小型跨主题验证位置为 [solute-study](reuse/solute-study/solute-study.glx)，成立范围以验收文档为准。

## 2. `coffee-alternative-states` · 同尺度结构比较

| 字段 | 内容 |
| --- | --- |
| 适用条件 | 多个方案在同一观察时点存在可直接对应的结构维度；用户需要先看单个方案，再并排比较。适合组织保留、装置结构、材料层次等，不宜把不同时间阶段混成互斥方案。 |
| 复用等级 | “同尺度结构图＋同维度矩阵＋选择／详情／比较状态保持”可改写。路线数量、层次和文案需要按主题重新设计；不是通用比较组件。 |
| 必要素材 | 三张路线照片 `natural.webp / washed.webp / honey.webp`；同尺度的 `natural-layers.svg / washed-layers.svg / honey-layers.svg`。红色外层、琥珀色黏液、浅金色羊皮层、绿色种子有一致语义，虚线表示已去除组织的位置。 |
| 修改入口 | **`build_u03.py` 是生成源**：`methods` 修改路线／组织／步骤，`diagram(mode, prefix)` 修改结构图，`style` 修改排版，`script` 修改状态与交互，`compare / rows / templates / html` 修改矩阵和页面结构。修改对应入口后重新生成，再正式应用到 GLX。 |
| 实际源码 | 生成源 [build_u03.py](programs/u03/build_u03.py)；装配输出 [u03.html](programs/u03/u03.html)。[u03.js](programs/u03/u03.js)、[u03.css](programs/u03/u03.css)、[content.json](programs/u03/content.json) 和 `programs/u03/assets/*-layers.svg` 均为便于检索的生成副本。 |
| GLX 位置 | 主 Flow 的 U03 原生组内，局部程序实例 `8bc2720a-0b46-439a-98c1-dc505b1cb456`。外部标题、正文与图注保持原生身份。 |
| 验证边界 | SVG 已渲染目视；1440/390 正式导出已通过三路线、详情、比较、返回及图片解码。生成源可重现各输出，内联代码与检索副本已核对。最终证据统一查 [VERIFICATION](VERIFICATION.md)。 |

进入比较保留当前选定路线和详情状态；返回恢复它们。手机比较仍能直接看到三幅结构图与对应矩阵，图内不放随图缩小的小字。保留 `coffee:reveal` 与 `coffee:height` 协议，使阅读定位和宿主高度沿原路径工作。U03 使用独立脚本，不修改 U05 的烘焙逻辑。

运行 `python build_u03.py` 会覆盖上述 HTML、CSS、JS、JSON 和 SVG 输出，不读取它们的独立手改；运行前保留需要的修改。只编辑生成副本不会反向更新内联 HTML，也不会修改 GLX。三张照片须另外备齐并由正式资源链闭包，生成脚本不生成或复制照片。

## 3. `coffee-keyframes` · 三关键帧连续变化

| 字段 | 内容 |
| --- | --- |
| 适用条件 | 同一物件在不同阶段有连续外观变化，需要手动观察、自动播放及停留比较；可以准备位置、方向与尺度一致的关键图像。 |
| 复用等级 | 三帧配准、两段融合与进度控制机制可改写。视觉进度是表现参数，不自动等于温度、时间或真实物理过程。 |
| 必要素材 | [green.webp](../v05/assets/green.webp)、[gold.webp](../v05/assets/gold.webp)、[roast.webp](../v05/assets/roast.webp)。新素材必须重新做主体配准，逐段目视中间帧，避免双轮廓和背景矩形。 |
| 修改入口 | 已装配 HTML 中的关键帧资源、滑块范围和呈现样式；机制参考 `lab.js` 的 roast 部分。程序外的原生标题与说明在 GLX 中按其原生对象单独修改。 |
| 实际源码 | [u05-inline.html](programs/u05/u05-inline.html) 是本版实际装配程序；[v05/lab.js](../v05/lab.js) 保留关键帧机制源码；上述三张图片为形态资产。 |
| GLX 位置 | 主 Flow 的 U05 原生组内，局部程序实例 `aee929af-3338-409a-a386-bcbef0d0e285`。 |
| 验证边界 | 三关键帧及正式导出的代表性交互、返回检查已通过。本轮沿用成熟关键帧，调整透明化和背景协调。最终证据统一查 [VERIFICATION](VERIFICATION.md)。 |

本版只针对统一背景做必要透明化及色彩协调，不改变成熟控制逻辑。局部程序的关键帧进度由 U05 自己持有；背景 Runtime 只表达当前章节阶段。迁移到新主题时，先验证新的三张素材融合，再保留或改写操作语义。

## 4. `coffee-fixed-solute` · 同一状态驱动画面、数值与交互

| 字段 | 内容 |
| --- | --- |
| 适用条件 | 已知初始溶液质量和固定溶质质量，通过加入纯水观察质量分数变化；忽略蒸发、洒出与化学反应。可附加解释性萃取阶段，但本引擎不求解真实萃取动力学或流体运动。 |
| 复用等级 | 固定溶质稀释可按配置复用。咖啡与糖水共享绘图／计算引擎，糖水已在正式 GLX 中验证参数修改与 Undo/Redo；完整交付范围以验收文档为准。 |
| 必要素材 | 杯体、滤杯、液体、水流和颗粒由 Canvas 绘制，无需图片资产。文字、数值、图例和主要标注在 DOM 中，手机不会因整幅 Canvas 缩放而缩小文字。 |
| 修改入口 | `water.config.js` 中的初始质量、溶质质量、加水上限、配色、文字和可选萃取步骤；视觉在 `water.js / water.css`，结构在 `u06.html`；`build-inline.py` 生成实际装配 HTML。 |
| 实际源码 | [water.js](programs/u06/water.js)、[water.css](programs/u06/water.css)、[water.config.js](programs/u06/water.config.js)、[u06.html](programs/u06/u06.html)、[u06-inline.html](programs/u06/u06-inline.html)、[build-inline.py](programs/u06/build-inline.py)；糖水只替换 [sugar/water.config.js](programs/u06/sugar/water.config.js)。 |
| GLX 位置 | 主 Flow 的 U06 原生组内，实例 `8f45751d-9cc3-49dd-ba88-c645759f022c`。正式糖水小样见 [solute-study.glx](reuse/solute-study/solute-study.glx)，程序实例 `39ce1c9c-0ae0-486f-9c41-c1497158a594`；对应交付为 [solute-study-offline.html](reuse/solute-study/solute-study-offline.html)。 |
| 验证边界 | 咖啡已通过 1440/390 的代表性萃取／稀释、数值、固定标记数、声音、重置、返回及空闲检查，并完成独立目视。糖水正式 GLX 已验证 `baseMass: 300 → 360` 后读数为 8.33%，以及 Undo/Redo 与原值恢复。最终证据统一查 [VERIFICATION](VERIFICATION.md)。 |

唯一计算关系：`质量分数 = 溶质质量 ÷ (初始溶液质量 + 加水质量) × 100%`。咖啡配置为 200g 饮品含 3g 可溶物、最多加入 100g 水；糖水配置为 300g 溶液含 30g 糖、最多加入 300g 水。视觉中的 72 个标记保持数量不变，用于解释不变量，不代表真实分子数量、尺寸或速度。

保留原 `data-*` 选择器、`coffee:height` 高度回执、状态字段及用户主动触发声音的机制。正式修改只替换 U06 局部程序，原生标题和段落继续可编辑。调整手机标注或图解尺寸后，重点复核实际文字与宿主高度；计算、状态和交互未变时复用有效行为证据。

## 5. `coffee-native-hybrid` · 原生 Flow 与局部程序混合装配

| 字段 | 内容 |
| --- | --- |
| 适用条件 | 作品以长篇阅读和图文组织为主，同时只有少数段落需要多状态交互、Canvas 或复杂动画；要求后续能够精确改字、换图和调整组合。 |
| 复用等级 | 工程组织、对象边界和正式操作路径可复用。需要按新内容选择局部程序边界，不能把整个章节或整篇自动包装成 Web。 |
| 必要素材 | 原生文字、标题、图片资源与有界组合；三个局部互动程序；一份全局背景与现有导航。图像及程序依赖由正式资源链闭包。 |
| 修改入口 | 从当前 `project.read / project.list` 取得目标；普通文字、图片、组样式沿原生对象事务修改；局部程序沿其 Source／HTML 修改入口提交；所有正式改动共用 Session、History 和保存链。 |
| 实际源码 | 主 [GLX](native/coffee-journey-v06.glx)、[OBJECT_INDEX](native/OBJECT_INDEX.json)、`programs/u03`、`programs/u05`、`programs/u06` 与 [background-runtime.js](background-runtime.js)。既有装配方法参考 [ASSEMBLY_GUIDE](../v05/native/ASSEMBLY_GUIDE.md)，对象地址必须以本版为准。 |
| GLX 位置 | 唯一正文 Flow `47415583-2d75-4b72-9c46-dfd29b47d82a`，内部七章保留原生组、标题、正文与图片；U03/U05/U06 实例见上表；背景位于 `global.underlay`，导航位于 `global.overlay`。 |
| 验证边界 | 已通过正式原生段落精确修改、Undo/Redo、恢复原文及邻居不变检查；七章图文与三段局部互动已完成代表性复核。最终证据统一查 [VERIFICATION](VERIFICATION.md)。 |

源文件的变化不会自动进入 GLX。候选 HTML 可以用于局部设计与生成，正式修改必须在当前工程精确应用，并确认目标及邻居没有意外变化。背景单实例当前使用共享 definition Source；正式更新共享源码并清空旧实例 override 可避免本轮已遇到的孤立 definition 编译诊断。此处记录有效作者路径，不要求复制历史对象 ID，也不将作者绕行措施宣传为通用软件保证。

## 使用与更新规则

1. 先按问题选一个案例，再读取它的源码、配置和必要图示；无需加载整篇作品。
2. 区分“设计参考”“可改写机制”“已通过特定条件的配置复用”，不外推到未验证主题或载体。
3. 新主题保留适合的机制，重写主题语义、资产和参数；涉及固定量、比较维度或物理含义时重新核对模型前提。
4. 正式装配后只针对受影响的画面、互动、事务／保存和交付环节验证；把实测结果写入对应 `VERIFICATION.md`，再更新案例状态。

本索引不建立 RAG 服务、组件注册平台或另一份工程状态；它提供可以定位、阅读、修改和实测的具体参考样本。
