> 历史研究快照（2026-10-28）：保留研究事实与当时讨论，不作为现行交互或执行依据。最新方向见[执行方案](../../果铃创作与编辑体系收敛方案-2026-10-28.md)。本次仅为归档位置调整相对链接；原文件SHA-256：`0616f6aa9e298104bf3b4ee8c1ea3657364491c2dd96d2f69c2c8152ee2d41cd`。

# 果铃工作台：创作与编辑体系收敛方案

日期：2026-10-28。状态：**研究方案，已根据本次讨论收敛组合/解组、Flow绕排、尽量可拖拽和自动导航兜底四项产品方向；本轮仍不实施产品修改。**

研究对象：`D:\果铃工作台` 的当前工作树、已有开发结果和真实作品。基线 HEAD 为 `4c34d90c9232c7cf1fc343bb2c6493fae3c04541`，包含接手时已有的未提交成果。源码事实针对这份工作树；历史实机结果按各自记录的构建与范围引用，不混写成本轮新验证。

## 结论先行

**整体方向收敛为：普通内容具有PPT式组合、组内人工调整和解除组合；Flow保持响应式，并支持拖动图片/组件后文字自动绕排；HTML、Source与原生共同兑现尽量直接拖拽的体验；作品内导航优先，遗漏或失效由软件自动补足目录与推进控制。**

AI按任务选择最短表达，软件负责稳定身份、布局、正式应用和兜底。单向HTML/CSS映射继续作为重要创作能力，保身份重排是需要补齐的能力之一；是否原生化不再充当拖拽体验的替代指标。以下保留已核诊断，并按这四项明确方向修订产品和执行部分。

这不是另建一套作者系统。当前已经同时具备 HTML/CSS 测量后自由装配、Flow 持续布局、Source 内部可视编辑，以及同一正式事务和资源体系。应当利用这些成果，补真正缺失的连接，而不是按“原生或 Runtime”“自由或组”重新划分整个产品。

本轮最重要的六个判断如下。

1. **单向映射并未被整体放弃。** 当前装配器已经消除纯布局 wrapper，页面壳也能消除并合并坐标。它至少在 10 月 6 日的可追溯提交中已存在。后来增加 Flow 持续布局，不能据此断言原路线被整体替换。（L1—L3、H1）
2. **普通组的编辑门槛与是否永久 Flex/Grid 是两件事。** 当前命中可以找到可见叶子，随后却按编辑层级提升到祖先组。市场作品的四个组全部是带 frame 的普通自由组，仍有三层嵌套；因此，仅取消 Flex/Grid 或隐藏“进入组”都不对因。（U1、U2、M1）
3. **大重排的关键缺口是保身份、保当前内容的布局应用。** 现有 HTML redo 会为内部草稿重新分配 ID；已有 Flow 分栏则能移动旧对象而不重建。叙事 r23→r27 的真实差分保留了全部 33 个旧 ID，仅新增三个布局组，证明有限重排底座已存在。（L4—L6、M2）
4. **HTML 表达自由与编辑结果一致性之间仍有实质差距。** 500/600 字重、文字 padding、自定义字体、响应式图片等普通设计选择，也可能使内容保留为 Web。不能靠要求模型禁用这些表达来宣称“自由 HTML 已自动得到稳定专业对象”。Source 可视编辑应作为正面候选，与高收益原生映射一起验证。（L7、U3）
5. **能力、Skill与索引已有同源链路，参考沿独立的问题索引链接；缺的是适用性与真实消费闭环。** 不需要新增总索引、RAG 或全局同步平台。新机制交付必须包含实际工具定义、生成目录、必要方法修订，以及内置 AI 和 ACP 的真实消费证据。（C1—C4）
6. **OAuth 401 发生在已有授权的刷新阶段，不能解释成“用户没有登录”。** 已有凭据可解密且身份相符；本轮安全比较发现六个相关 profile 保存相同加密凭据。当前代码只留下 HTTP 状态，丢掉服务端错误分类，尚不能判定到底是失效 grant、客户端配置还是其他服务端拒绝。跨 profile 的刷新互斥缺口已经用真实 store 代码验证，但没有证明它就是本次 401 的根因。（A1—A4）

下一阶段仍沿**三个工作包、B0—B7、ACP薄接入和两件真实作品**推进。先证明组合内调整/解组、Flow拖动绕排、导航自动兜底三条人工消费者，再接AI续改与保身份重排；不先建设通用双向布局、全产品自由化或新Harness。

## 1. 研究范围与证据等级

本轮通过 RDC 读取目标电脑，原生子 Agent 分别研究布局、编辑导航、能力与创作体系，再交叉质疑。DevSpace 工作区打开返回内部错误，子会话远程读取长时无返回；随后由主 Agent 统一只读取证，子 Agent 使用同一源码镜像独立审阅。没有调用本机 Codex、Claude Code 或其他外部 Agent 承担研究。

已经阅读 `AGENTS.md`、`DEVELOPMENT.md`、`CURRENT_STATUS.md`、`NEXT_EXECUTION.md`、架构合同、10 月 10 日与 25 日相关方案、10 月 26 日和 28 日成果，以及四个现用 Skill、能力生成和实际消费者。参考库进一步读到咖啡 METHOD、资产索引、背景组件说明、反馈和 r264 冻结说明。（G1、H1、C1、R1）

证据使用以下边界：

| 等级 | 本轮内容 | 能说明什么 |
|---|---|---|
| 当前源码事实 | 测量、装配、redo、对象布局、命中、Source 作者字段、导航、工具目录、Skill 分发、OAuth | 现有实现的明确分支、责任和缺口；不自动证明当前 GUI 已完成整段旅程 |
| 本轮新执行的隔离验证 | 六份GLX只读统计；正式布局组谓词与reparentFrame内存执行；两组真实作品差分；OAuth store锁作用域实验 | 被直接执行的结构与机制事实；没有真实模型、刷新请求或正式作品写入 |
| 既有真实消费者证据 | continuation、productivity-acp、咖啡冻结、城市夜线结果；本轮复核两张既有产品截图 | 在原记录明确的构建、任务和视口内已成立的效果 |
| 本轮研究判断 | 路线收益、交互取舍、潜在性能成本、下一步实验 | 建议与可证伪假设，不能冒充既有性能成绩 |

本轮没有运行新的整作 A/B/C 创作对照，没有重新启动模型完成付费生产，也没有重新验证全部 GUI/离线矩阵。已经验证的 Source 原生编辑、共享状态修复和 ACP 旅程继续作为依据，不机械重复。Project11、Published4、API5、DocumentSession 唯一作者写入、History/CAS、Source/COW、资源闭包和保存归属均保持。（G1、V1、V2）

## 2. 问题诊断：复杂度来自哪里

### 2.1 历史路线不是一次简单的“从单向改成永久组”

| 可核时间与来源 | 已核事实 | 不能扩大的结论 |
|---|---|---|
| 2026-10-06，`21f28fd09` | `htmlAssembly.ts` 可追溯提交已包含布局 wrapper 消除和测量装配 | 这是本次可追溯的存在时间，不声称绝对最初发明日期 |
| 10-06 至 10-10 后续提交 | 补表单/状态 CSS 关系的保源 scope、stacking/interleaved paint、伪元素与失败时保源、固定画布语义 | 保留结构有明确保真原因，不能统一归为无效实现 |
| 10-10 原始提案 | 曾建议在同一作者树中支持 free 与声明式 flex/grid，并指出旧路径测量后只留 frame | 原始提案不是当前最终默认行为授权 |
| 10-10 收敛 README 与结果 | 最终采用固定设计比例；自由内容由 HTML/CSS 实测装配；Flow 固定逻辑宽度并自然增长；明确未承诺跨比例自动重排 | 历史“响应式”不能一概理解为任意宽度自动重构版式 |
| 10-19，`a8882691e` | 页面壳消除进入可追溯历史 | 不是本轮需要从零新增的能力 |
| 10-22，`761013579`；10-23，`63992093` | native Flow flex/grid 与有限对象分栏先后进入历史 | 说明新增持续关系能力，不证明自由装配被删除 |
| 当前合同与代码 | 自由区域可测量装配，Flow 保阅读与必要持续排版，复杂程序保 Source | 三条路径实际共存；其端到端效率尚未完成同条件裁决 |

对“是否有未经充分验证的产品路线偏移”的准确答复是：**发现了决策与证据范围容易混淆的风险，没有找到足以认定违规切换或整体弃用单向映射的证据。** 历史局部成功、组数变化、首存和 run completed，均不足以证明某一种长期布局表示全面更优。后续应补真实用户编辑与首次合格创作证据，而不是为现状补一个必然正确的历史解释。（H1、V1—V3）

### 2.2 真实作品中的组并不是同一种东西

统计只遍历正式 `instances/childIds` 和根/全局容器，不递归把历史、Source DOM 或任意 JSON 节点都算成对象。布局组使用未改动的正式 `isNativeFlowLayoutGroup`：**无 frame、有效 builtin 为 guoling.group、display 为 flex 或 grid**。本轮实际在内存加载该函数复核；加 frame 或换成 Source override 后，同一个候选不再被判为 native Flow 布局组。

| 实际文件 | revision | 实例数 | 普通自由组 | 持续布局组 | 最大组深度 | 结构叶节点 / 位于布局组祖先内 |
|---|---:|---:|---:|---:|---:|---:|
| coffee v07 | 215 | 183 | 0 | 63：60 Flex、3 Grid | 5 | 116 / 114 |
| coffee Runtime-first 基线 | 263 | 76 | 0 | 16 Flex | 2 | 59 / 57 |
| coffee Runtime-first 冻结最终稿 | 264 | 76 | 0 | 16 Flex | 2 | 59 / 57 |
| market | 32 | 38 | 4 | 0 | 3 | 32 / 0 |
| story | 23 | 33 | 0 | 3：2 Flex、1 Grid | 2 | 29 / 2 |
| story-polished | 27 | 36 | 0 | 6：4 Flex、2 Grid | 2 | 29 / 8 |

“组深度”不计 surface；叶节点只是没有 childIds 的结构定义，不等于可见文字块数。六份文件均未发现循环、缺 child、多父或失联实例。市场的 21 个结构叶节点位于普通组内。咖啡 r263→r264 保留全部 76 个 ID、childIds、frame、definitions 和 assets；变化是样式与部分数据，不是零修改。（M1、M2）

**Source 实例数也不等于复杂 Runtime 数。** 市场五个 effective Source 包含两个 table、两个 chart 和一个 HTML-program；其产品语义仍是一个有界 Runtime。咖啡的五个 effective Source 则包括导航、三个局部实验和统一 Scene Runtime。不要用同一数量指标评价编辑深度或程序复杂度。

### 2.3 为什么仍会产生多组、多层

当前有四种来源，应分别处理。

**第一，真正的持续布局。** Flow 分栏创建一个 Grid 和各列 Flex；咖啡正文组服务于阅读、宽度和自然高度。它们不是一次构图结束后必然可丢弃的包装。是否保留，应看改字、换图、窄屏和连续阅读是否需要这些关系。（L6）

**第二，测量后的自由组。** 普通容器可映射成带 frame 的 `guoling.group`，外部 flex/grid 样式已经去掉。它仍可能保留子树，用于局部坐标、语义、底色或变换。市场的嵌套属于这一类。把这些组再次“改成绝对定位”不会自动改善选择策略。（L1、L3、M1）

**第三，保真边界。** section/article/figure 等语义，id/aria-label/title，裁剪、opacity、filter、transform、stacking、伪元素和源代码编辑 scope 都可能阻止消除。部分是合理边界；部分可能只需保留语义锚点而不需要交互屏障。现阶段不能按标签或层数直接批量删除。（L1—L3）

**第四，创作表达自然带来的包装。** AI 常用多层 div 表达卡片、居中、间距和命名。当前给 wrapper 添加 id 反而可能使它获得保留条件。因此，不应为未来复用身份而要求模型给每个 DOM 手工登记 ID。软件应为真正复用的正式对象提供稳定引用，排版容器继续允许是临时的。（L1、L5）

仅从最终 GLX 不能还原每一个组的生成意图；没有完整生成输入与回执时，不应宣称“全部由某一 Skill 强迫产生”。现用 Skill 已允许 HTML/CSS、直接改现有 Source 和按需 Runtime，问题不能全归为提示词落后。（C3）

### 2.4 已确认的体验原因，尚待测量的性能原因

`editingLevelFromAncestry` 默认返回当前编辑层下的祖先；只有 deep 路径才返回叶子。Slides、Spatial 和 Source 字段消费者实际使用这一规则。因此，看见文字却先选中外层组，是明确的产品策略后果。仅隐藏 Flow 的“进入组”按钮没有改变全部命中/编辑路径。（U1、U2）

性能方面，目前只能列出可测假设：额外实例可能增加投影、遍历、事务和选择成本；持续布局可能增加重排；大量 copied computed style 可能增加序列化或读回负担；Source 边界可能增加编译/realm/生命周期成本。市场四个组各有 362 项 style 字段，值得作为后续负载线索，但不等于已证明瓶颈。

不能由咖啡 183→76 直接推出“更快了多少”。浏览器 DOM、布局依赖、组件编译、图像解码、观察等待和模型往返都可能更重要。后续只有计时指出具体 owner，才优化该范围；不先为“树浅”启动全仓扁平化。

## 3. 候选路线比较与推荐边界

下表中的速度与成本是机制判断，除明确指出的事实外，不是已有同条件胜负。

| 路线 | 产品与创作收益 | 编辑与质量边界 | 主要风险、迁移代价 | 本轮判断 |
|---|---|---|---|---|
| 当前持久组/声明布局 | 改字、内容增长、列宽和顺序可持续生效；复用现有 Flow | 若选择仍按组层级，用户负担大；自由拖动需明确语义 | 全部继续保组会留下施工层级；但已有实现可直接修消费者，迁移成本低 | 保留真正承担持续行为的关系，先解除不必要的选择门槛 |
| 一次 HTML/CSS → 全自由对象 | 模型能高层构图；固定画面移动编排直接；不必反推旧 CSS | 仅保一次排版结果；文字增长、断点、动画、合成不能自动保留 | 映射保真、字体和编辑载体变化；旧作品全部转换风险高 | 对固定自由区域值得优先验证；不作为全产品统一默认 |
| 完整双向 HTML/CSS ↔ 原生对象 | 理想上保留源表达与视觉编辑 | 任意拖动无法唯一推导 CSS；动态 DOM/循环/媒体查询更难 | 两份可写事实、同步冲突和长期 CSS 等价维护，成本最高 | 当前不投入通用双向系统；只做有明确 owner 的有限回写 |
| 直接原生语义创作 | 专业文字、数据、图表、导航和现成布局直接落正式模型；少转换 | 复杂构图若要逐对象坐标装配会增加往返；表达受已有专业能力限制 | 不能让模型手算一切；批次/高层能力若足够则成本低 | 小改首选；内容和专业语义主导的新作范围可以直接胜出 |
| Source/Runtime 保持布局权威，字段可视编辑 | 浏览器布局与程序行为可保真承载，运行态沿既有生命周期；已有精确字段编辑成功 | 任意几何编辑仍有语义边界；未绑定动态像素不能伪装可改常量 | 若把整页无作者边界程序当默认，会伤害人工接力；字段合同需兑现 | Flow/持续布局/强动态的重要正面路线，不只作失败退路 |
| 推荐：按持续行为选择表示，共用正式身份和操作 | AI 可临时复杂，用户操作内容；静态构图用测量，持续关系由既有 owner 保留 | 需要把选择、内容写入、几何权威准确接通；不能用多条路径掩盖不一致体验 | 防止演变为三套重复编辑器；优先复用现有实现，禁止新增并行 writer | 作为整体产品方案；各类创作入口由真实任务证据决定优先级 |

### 对单向映射的明确评价

它的真实收益是**把 AI 的高层构图转成软件的确定性执行，且不要求恢复原始 CSS**。在固定 Slides、Spatial 内的局部排版、海报/卡片和明确重做的自由区域，这与用户独立移动、换图和排列的目标一致。

但“HTML 输入”不等于“最终一定原生”。现有 `professionalHtml` 对 500/600 字重、文字非零 padding/border、font-family 名单命中 supportCss 中的 @font-face、srcset/sizes/picture 等保源；Flow 耦合布局还可能整体保持响应式 DOM。相同设计把 padding 放在外层 div 或文字 p 上，可能得到不同编辑载体。这是由源码分支推导的明确边界，本轮未新增浏览器渲染实验，也不把字体名单命中当作逐字形实际字体使用证明。（L7）

因此不推荐两个捷径：要求模型只写便于原生化的狭窄 CSS 子集；或不断追求将浏览器全部能力重做为原生字段。优先比较少量高收益映射补强与 Source 同等可视编辑，哪条能更短地满足用户的修改任务，就采用哪条。

### 什么证据会让推荐转向

1. **转向某类作品以 Source 为主：** 保留任务所需排印、图片和响应式时，编译路线反复保源/返修，却没有带来额外的人工编辑能力；Source 能以更短路径完成同样局改、保存和交付。若在两种不同构图上重复成立，停止扩大该类内容的强制原生提取。
2. **停止把某范围当临时自由布局：** 正常改字、换图比例或任务承诺的尺寸变化后，必须不断重编译/修 frame，而现有持续布局或 Source 自然通过。说明分类错误，应保持续关系，不再发明等价约束语言。
3. **转向某类任务直接原生：** 标题、连续正文、图片、专业表图和导航组成的任务，直接批次表达更快达到同等视觉与编辑标准；HTML 路径反而要求模型修兼容 CSS。此时原生应是该任务的最短入口。

这些是创作表示的局部对照，不重开 Harness 选型，也不要求每项开发前先做完整路线大赛。

## 4. 已收敛的产品行为：组合可手调，Flow可拖动绕排

### 4.1 组合关系与排版方式分开

普通组合负责把对象作为整体移动、缩放和管理；排版方式决定其内部位置如何计算。二者不应绑定成“只要保留组，就只能让AI改布局”。

本次讨论明确以下行为：

- **组合**：用户多选对象后点“组合”，保持当前相对构图，得到一个可整体操作的普通组。这里的“布局固定”是相对构图保留，不是给整组及后代加locked。
- **组内调整**：选组后直接点成员即可调整文字、图片、大小、位置和旋转；可保留明确的直选修饰操作。不要求逐级进入/退出独立编辑界面，也不要求先解组才能挪一个成员。
- **解除组合**：对可安全解除的普通组，提供明确按钮及上下文入口，解除一层，成员保留身份、内容和当前几何，成为可独立拖动的对象；嵌套普通组可继续解除。
- **自动排版组**：用户需要持续等距、排列、分栏时可以建立或保留；必须有可人工操作的顺序、间距、列宽/尺寸与对齐入口。用户想任意摆放时，可以停止自动排版并保留普通组合，或直接解除组合。
- **不可拆组件**：Source、Runtime、图表内部程序、共同合成或行为单元保留完整；外部可组合/拖缩，内部对支持的作者字段提供直接操作。不能拆不等于只能让AI修改。

不再把“普通单击必须永远选最深叶子”作为唯一产品答案。可以接近PPT的“选整体→再点成员”习惯，重要的是组内手调可达、整体操作顺畅且无需模式迷宫。Microsoft对组合的说明同样保留组内成员操作，并说明解除后对象留在当前位置。（W5）

### 4.2 当前已具备什么，真正还缺什么

`freeObjectCommands.ts` 已有 `groupFreeObjects/ungroupFreeObjects`：同父自由对象可以按已有ID移动进新组；解组将直接孩子移回父容器、换算frame后删除组，并要求每个直接孩子已有自由frame。`reparentFrame`保留完整仿射矩阵，不是用旋转后的AABB代替原框。（U4）

本次补充检索只发现这两个函数的定义和barrel导出，没有找到当前UI或领域工具的直接调用；所以它是现成算法与编辑草案，**尚不能当作已经交付的组合/解组按钮**。现有`object.structure`公开分支也未见group/ungroup。应将已有操作收口到人工与AI都能消费的正式owner，补入口、准入和实际消费者，不另写两套解组算法。

本次实际内存执行正式`reparentFrame`，覆盖旋转、非均匀缩放、镜像和shear的三种换父场景，四角最大误差约2.84e-14，奇异新父矩阵按现有实现拒绝。这只证明数学底座；完整UI、效果、绑定、事务和保存仍待验证。（M3）

现有解组函数内部未处理父组的共同opacity/filter/clip/mask和外部行为引用，且以definition实现判定，未在这里解析instance override。调用侧保护尚未证明，不能直接复用宽泛的“普通编辑组”判定。同父但在兄弟顺序中不连续的对象组合后，与夹在其中的未选对象之间的遮挡也可能变化；保持坐标不等于任意情况下像素完全不变。

首个真实样本宜用market的普通自由组。咖啡r264七个正文Flex组则同时具有sticky和Scene Runtime的`chapterCopyIds`引用，不能按普通壳直接删掉；需要保其持续行为，或明确处理解除后的行为转换。是否可拆取决于实际责任，不能只看名字或builtin类型。（M1、U4）

### 4.3 Flow采用Word式对象定位与绕排

Flow继续响应式。用户拖动图片或组件时，软件直接给出落点和文字避让预览；位置、尺寸或前文变化后，文字自动重新排布。普通操作不调用模型、不进入Source、不要求用户理解flex/grid或段落锚点。

需要区分的是以下结果，而不是给用户三个不同的编辑系统：

| 放置结果 | 用户动作与反馈 | 文字如何响应 |
|---|---|---|
| 行内/独占正文行 | 拖到段落间或正文插入位置，显示插入线 | 按阅读顺序排在对象前后 |
| 环绕对象 | 拖向段落附近的左/右位置，显示对象框和真实绕排预览；拖角改大小 | 文字沿对象边界避让，前文增删时对象可随对应段落移动 |
| 前景/背景叠加 | 用户明确选覆盖或底图用途 | 不把它误当作需要文字避让的普通图片 |

“随段落移动、固定纸面、固定视口”是位置锚定方式；“环绕还是覆盖”是文字排版方式，二者不能混为一项。Word的Square与Move with text正是“可定位、随文移动且文字继续绕行”，不是完全脱离正文。（W6）

当前底座比“只能重排”更完整，但尚未统一：

- `SharedDocumentEditor`已有正文对象拖动落点，普通Runtime指针也能转到同一入口；当前提交主要是block move，并不按落点自动写wrap。
- `componentPresentation`把`flowLayout.wrap:left/right`投影为真实float；不仅媒体，有flowLayout的组件也可进入该分支。当前绕排宽度固定48%、左右间距20px，直接处于native Flex/Grid的child不走这条分支，尚不能称为任意拖宽。
- 纸面/视口浮层已有frame、自由变换和段落锚点；它们不因跟随段落就自动对文字形成排斥区。
- 部分绕排快捷UI主要面向图片/视频/音频，普通组件的投影能力与操作入口尚未完全对齐。（D1）

建议把同一拖动入口接到已有`flowPlacementEdits/flowBodyLayoutEdits`：预览临时，放下时一次事务写落点、绕排与必要尺寸；宽度由对应排版owner负责。窄屏空间不足时，对象自然改为整行，恢复宽度后按其作者意图重排，不静默缩小正文。

**自由拖动不能被实现成只有“左48%/右48%”两个按钮。** 需要可拖动缩放、明确段落落点和随文关系。任意中心位置、两侧同时排字则是更强的排版能力：CSS Shapes规范明确`shape-outside`不会让一个float两侧同时绕文，不能用其名称宣称已经具备Word全部行为。（W7）

先把左右/上下避让和组件改宽做成完整消费者，同时用中心放置样本验证更强的行排版机制。如果首版中心放置只能上下避让，应在拖动预览中如实呈现，不静默吸到侧边或覆盖文字。这是实现范围的透明化，不撤回“尽量可拖动、文字自动重排”的目标。

### 4.4 布局组解除后，如何在Flow中真正自由

无frame的Flow布局组不能直接沿普通自由解组删除。需要测量当前子树，将失去原布局owner的对象落实为可保存的几何，再解除组关系。只给最外层加frame会切换childrenPlacement，但原孩子可能仍无frame；仅把孩子提到Flow正文也会继续受到正文排版，均不能冒称已完成自由解组。

产品承诺应是：解除后成员能独立定位，当前构图及内容尽量保全；被解除组负责的自动排版关系停止生效，后代独立组件或布局单元的内部关系按其自身责任保留。Flow的阅读与文字避让仍由明确的承载规则负责。软件必须处理原块占位、段落锚点和邻文，不能让解组瞬间导致正文意外上移，也不能新增一个隐藏普通组假装已拆开。

首个隔离实现必须对比“直接成员转为独立绕排/纸面对象”与“需要保持局部自由排版范围”的实际结果。如果确需一个正文占位/布局区域，它不能继续成为组合、选择或组内拖动的屏障，且不能把仅改变内部布局模式标成已解除组合。实现选择由保当前画面、独立操作、后续绕排与保存结果决定。

### 4.5 共同编辑合同

| 场景 | 应兑现的直接操作 | 必须保留的语义 |
|---|---|---|
| Slides/Spatial普通对象与组 | 内容编辑、组内拖缩旋转、整体变换、组合/解组 | 当前正式身份、父矩阵、专业内容和范围外对象 |
| Flow图片/组件 | 拖放、改宽、随文、绕排、切换覆盖用途 | 阅读顺序、自然高度和响应式；锚点与绕排分开 |
| Source/Runtime整体 | 作为对象拖动、缩放、参与外部组合和绕排 | 运行单元与生命周期，不因拖动任意拆内部DOM |
| Source/Runtime作者字段 | 支持的文字/图片/参数直接改；支持geometry的字段可拖缩旋转 | 使用已有sourceRegion/dataPath/override和当前挂载矩阵；计算值不随意改成常量 |
| 高级效果/复杂组件 | 外框尽量可调，必要字段直接操作，深改局部Source | 不以“能选中”冒称所有内部像素都能自由拖动 |

`runtime.ts`与`useComponentAuthorInteraction`已经有作者geometry增量、拖动预览、键盘微移和正式写回；没有geometry的字段目前也有明确拒绝。重点是让这些能力在真实目标上可达并持续保存，不能仅因为保Source就把手动布局交还给AI。（U3）

共同规则保持：当前内容一份；每项属性有明确写入责任；UI与AI共用target、版本、事务、History和资源；拖动遵循已有组合规则，不同时回写互相竞争的frame与CSS。小改直接改正式对象，大重排才构造临时布局；旧HTML不能覆盖用户新改内容。

## 5. 保身份大重排：可行，但应限制为当前对象的布局应用

### 5.1 当前能力与缺口

现有 `ContentObjectDraft` 是不带作者身份的装配输入；`planContentApply` 的 redo 删除内部旧 children 并为新草稿分配 ID。选定 root 身份及外框可以保留，不等于整棵子树保留。

同时，现有系统并不是“redo 一定静默丢人改”：`applyService` 会合并资源与 authoring.records；源作者映射有歧义时拒绝应用、保留原内容。该保护应复用。现有 HTML content 局改也有唯一 DOM id、唯一内容、同树位置的保守映射，但不是任意结构重写的身份算法。（L4、L5）

已有 `prepareCourseFlowColumns` 用 `instance.move` 搬动旧 ID；Flow 源投影已有软件生成的对象路径、`guoling-instance` 引用和 instanceByPath。后者是可复用入口，不代表自由 HTML 几何编译已经支持它。（L6、L8）

### 5.2 推荐的最小应用合同

**输入由当前正式范围生成。** 软件返回本次可排版的对象引用、当前内容与资源、锁定/排除项、允许变化的布局字段及 revision。模型只表达构图关系，不重新抄正文、猜资源地址或给每层 DOM 填永久 ID。可以优先复用现有对象投影/alias；具体 API 名称留给实现验证，不先新增一套工具族。

**测量使用当前内容。** 引用现有原生对象时，应使用正式内容与真实度量条件；引用 Runtime 时按其明确布局边界处理，不能为测量而任意执行整页不受控程序或拆散内部状态。字体、图片、盒模型和源依赖必须按既有资源闭包就绪。测量结果仅是候选，尚不写作者稿。

**候选只包含授权差量。** 允许字段限于本次明确的 frame、parent、order、必要的排版参数，以及单独授权的样式。正文、富文本、数据、资源 ID、裁剪、Source、作者记录、交互绑定和动画引用默认保留。新内容是显式新增，缺少某旧对象引用不是删除授权；重复引用、未解释的漏项、跨范围引用或循环都应拒绝。

**仍由既有 writer 正式应用。** 校验引用唯一、范围、锁、版本和资源闭包后，沿原事务形成可撤销修改。并发人改让候选过期时，拒绝陈旧应用或重新采样；不能覆盖后再恢复。应用回执与观察回执分开，不能因截图失败重复写入。

**无需恢复旧 CSS。** 新构图从当前内容重新构造临时布局即可；旧 HTML 不再承担权威。只有作品确实需要持续排版的关系，才由既有 Flow/Source owner 保存。不要把任意 CSS 选择器、媒体查询和动态约束再序列化成第二套通用 JSON 布局语言。

### 5.3 首个实验应包含什么

用已有市场/叙事副本中的一个真实区域，包含文字、图片、表图和一个有界 Runtime；先人工改正文、裁剪、数值或位置，再用当前引用重排。检查旧对象和内容保全、资源闭包、交互目标、Runtime 生命周期、Undo/Redo、保存冷开及离线。

同时纳入一个普通 600 字重/自定义字体/带 padding 的内容，避免只用最容易原生化的例子制造成功。若保源后仍能满足直接编辑，不算自动失败；若最终没有新增编辑收益却增加转换返工，就收缩该路径。

失败应保留原稿并指出具体不支持的范围。回退可以是原生 `object.layout`、保留持续 Source 布局或局部 Source 深改，不是截图、整页无作者边界 Web 或静默重建对象。

## 6. AI 的实际工作方式、Skill 与能力发现

### 6.1 创作工作流要随底层变化一起交付

| 阶段 | AI 负责 | 软件负责 |
|---|---|---|
| 理解任务 | 内容目标、受众、关键画面、互动后果、人工后续会改什么 | 当前文档、选区、可写范围、已有资源与实际能力 |
| 选择表达 | 静态构图、持续阅读、专业数据或强动态各选适合路径 | 目标适用能力及受支持边界；不把所有工具一次塞进上下文 |
| 生成 | 新自由构图可 HTML/CSS；专业内容可原生批次；强协同动态用局部 Runtime | 当前对象引用、依赖与资源闭包、测量与正式装配 |
| 采用 | 给出内容和设计意图，处理真实诊断 | 身份、差量、版本、权限、事务与回执 |
| 观察返修 | 看代表性画面与实际操作，判断内容、视觉、阅读是否合格 | 聚焦观察、可定位错误；应用成功不因观察失败重放 |
| 局改 | 已知目标直接编辑，必要时读局部 Source；大重排只改授权布局 | 精确 target、slot、当前值与 CAS；保范围外人改 |
| 交付 | 如实说明达到和未达到的要求 | 正式保存/导出状态、revision、dirty 与可复核文件 |

短改不应重新读取整套创作指南和全部工程目录；新作也不该逐对象查询再手工拼装。批次、现有路径、多项事务、软件测量和对象引用才是降低往返的主要手段。只有可独立产出且合并成本低的语义单元才委派；共同定义、文档集成保持单 writer，不把固定数量子 Agent 当创作模板。

### 6.2 最短路径的选择应清楚、有限

| 当前任务 | 优先入口 | 扩展条件 |
|---|---|---|
| 改已选文字、数字、图片或表格数据 | 当前 target 的直接领域操作 | 高层不适用时读取同一对象局部 Source，不先全库搜索 |
| 已有对象组合/解组或重新排列 | 人工与AI共用正式结构/布局操作；普通拖改由软件直接完成 | 只有较大构图才用保身份重排，不以redo冒充layout-only |
| 新的固定自由构图 | HTML/CSS 测量或原生批次，按实际净收益选择 | 保真/编辑失败时明确保持 Source 或换原生，不能用长提示词掩盖 |
| 长篇自然阅读与持续适配 | Flow正文、可拖动绕排组件及必要布局；Source也须暴露可用编辑边界 | 不把日常拖动交给AI重写CSS，不强制全文自由化 |
| 连续模拟、共同材质/镜头、复杂状态 | 有界 Runtime，暴露作者内容与参数 | 不把独立正文全塞入无编辑合同的整页程序 |
| 外来完整可执行 HTML | 复用已有完整程序入口和依赖采用 | 与新原生作品的创作方法分清；不默认拆掉其程序 |

### 6.3 能力、方法和参考分开，但沿现有分发链同步

现有 `ToolCatalog` 注册与 Zod schema、`generate-ai-capabilities`、语义 hash/索引/Skill bundle 已构成同源链路；构建/验证包含生成检查。Engine 会把聚焦后的实际工具传给模型；ExternalMcpService 也经同一 Gateway 提供工具与 load/变更通知。没有必要新增另一个能力真相源。（C1、C2）

分工应保持：

- **能力定义与短说明**：支持什么目标和操作、输入/输出、版本与失败边界；以实际注册源为准。
- **能力发现**：根据当前任务、对象/slot、可写范围披露少量适用工具；未知目标才扩大查询。索引不是权限，最终仍由 Gateway 判断。
- **能力 Skill**：解释少量操作前提和恢复方法，不复制 schema，不承担软件应完成的身份、装配或坐标计算。
- **创作方法**：何时选 HTML、直接原生、持续布局或 Runtime，如何观察与返修；不是强制每次全流程。
- **参考**：可复用视觉方法、局部组件和反例，带适用条件及证据；可以拒用，不以模板数衡量成果。

一个具体改进点是 `inspect` 目前主要按目标 kind 与 writable 筛操作，whole document-block 可能看到实际不适用的 text.format。应让发现消费已有真实编辑 owner 的适用性，而非只增加文字警告。本轮没有 trace 证明叙事那次失败必然由 inspect 导致，不能把二者写成已闭合因果。（C2、V1）

### 6.4 能力更新必须有同一项完成判据

每次新能力/语义修改同时完成：

1. 正式实现、目标合同和直接消费者一致。
2. 从现有源生成工具 schema、能力索引、语义版本和必要 bundle；检查无缺失、过期或额外文件。
3. 定点修订受影响的 Skill 句子、例子和创作选择。保身份布局不得继续被描述为 redo；旧受支持能力也不能无提示失效。
4. 核应用内 Bundled/Scoped Skill，以及实际启用的显式安装路径。仓库 `creative-reference` 当前不自动随独立安装分发，不能只写了链接就宣称外部客户端可读。
5. 内置 AI 检查最终 ModelRequest 中的能力与实际选择；ACP 核对实际 tools/list/load 回执、随后精确工具调用、目标和正式应用回执，再完成用户局改/保存。原生 ACP 未暴露的完整模型请求 schema/token 明确记为不可观测，不以 MCP 回执冒充。只检查生成物一致，或只看到一次调用成功，都不足以验收。

需要改的源位置已有：`orchestrate-courseware`、`material-assembly`、`edit-content`、`workbench-usage/project-files`及`web-composition-examples`。应修正“组内HTML/CSS主要通过源文修改”的过窄方法，补组合/解组、人工拖改及Flow绕排；区分模型不默认插入大控制台与宿主自动兜底；不能再把`controls:none`当成导航已经完整。沿现有四个Skill定点修，不新增“弱模型修复Skill”。显式安装保护和已退役的自动全局安装保持原边界。（C3、C4、N5）

## 7. 参考库应提取什么

当前 `creative-reference/README.md` 已经按问题指向方法、资产和案例。应继续以它为入口，新增的价值是把真实采用/拒用经验写回来源，而不是另复制一套完整作品或新建资产身份。

| 来源 | 值得复用的能力或方法 | 采用与编辑入口 | 不应泛化的部分 |
|---|---|---|---|
| 咖啡 Runtime-first METHOD / r264 | 共享 phase 直接求当前画面、反向/跳转不依赖到达历史；正文与连续主体分工；背景唯一归属；按主体做响应式构图 | 正式 Flow 阅读事实、Source、作者参数与原生正文 | 七章、咖啡素材、统一主体和完整场景代码不是通用模板 |
| 连续阶段背景 | 事件驱动绘制、颜色关键点插值、按当前状态恢复、无空闲循环；可只复用小函数 | 既有 asset.search/use/import，或局部 runtime-core | 只画背景，不替作者解决正文对比、布局或章节；页面不透明底色会遮住 underlay |
| 市场运营 | 原生表格保存作者输入；Runtime 维护派生共享状态；图表 get/subscribe；Source 内嵌原生文字 | 现有数据、Source、正式对象与共享状态接口 | 不复制对象 ID、完整看板或默认卡片风格；软件订阅竞态已修，不写成模型手工规避规则 |
| 叙事及本次分栏 | 阅读节奏、段落与主图关系；同一对象改分栏和字号；导航与正文共同观察 | 现有 object.layout、文档块、局部 Source | 不把六对象两栏当通用章节模板；r23/r27 差分不是任意 HTML 重排证明 |
| 城市夜线 | 区分源内容错误与采用损耗；完整程序正式采用；手机可读性和实际控件验用 | 已有完整 HTML 程序入口、局部修改、冷开/离线 | 原始 H/G0 都未首次合格；G1 返工成功不证明首次十分钟或果铃比裸 HTML 更快 |
| 历史测量/字体/交错绘制实验 | affine、border-box、字体就绪、临界换行、source/paint scope 的反例 | 原测量/装配 owner 与实际采用记录 | 不将“95小时”缺失原输入用统一 nowrap、缩字或加宽掩盖 |

咖啡冻结说明已有七章、1440/390 视口、互动、反向、冷开和离线证据；390px 是桌面 Chromium 模拟，不是实体手机认证。局部控件销毁而全局继续运行时的 active 残留仍是通用化边界。连续背景已有跨工程采用，但没有跨主题完整创作速度收益证明。（R1、R2）

参考条目只需回答：解决什么问题、何时不适用、如何发现/采用/修改、验证到哪里。只有真实跨题材采用能支持扩大推荐范围。模型没有相关需要时不读；已知资产只查必要契约；合理拒用也应记录其原因。这样减少认知负担，而不是把所有历史教训塞进主提示词。

## 8. 内容导航优先，软件自动补足目录和推进

### 8.1 自动兜底已是明确产品方向

用户希望导航和推进融入内容；当模型漏做或做错时，软件自动嵌入必要控制台与目录。本次讨论后，不再把“是否自动兜底”列为待决定方向，也不把可靠推进交给模型读更多Skill解决。软件无需判断模型强弱，只根据作品当前实际具备的导航与推进能力工作。

推荐复用同一内置呈现，由宿主在作品的编辑预览、播放与正式离线导出中自动挂载。通常不向作者文档插入大量对象或每章一份文字；目录从正式内容派生，阅读位置沿既有owner。用户要将兜底导航融入视觉设计时，可通过“编辑导航外观/作为作品组件”采用正式可编辑组件。不能让每次打开或播放都悄悄写工程。

| 当前内容导航状态 | 软件行为 |
|---|---|
| 正式目标、动作和作用域可验证，导航实际可用 | 优先展示作者设计；保留轻量可唤起的目录/控制入口 |
| 没有导航，只有装饰按钮，或模型仅设置controls:none/canvas | 自动显示满足当前作品需要的目录与推进控件 |
| 有跳章但缺推进，或有推进但缺必要返回/目录 | 只补当前缺失的操作，避免整套重复 |
| Source导航挂载失败、目标失效或对应范围不可操作 | 自动恢复同一宿主兜底，不等待AI返修 |
| 到最后一步、某动作按合法规则不可执行 | 正确禁用/解释对应动作，不误判成导航缺失，也不越过已有推进条件 |

兜底可以紧凑显示或按需展开，但用户不应先发现“作品被卡住”才能找到它。具体视觉位置沿既有shell和inset设计，不叠加多层安全区，也不遮挡主要内容。

### 8.2 已有服务与实际缺口

`ComponentNavigationOwner`已负责surface observation、目录派生、当前位置、reading/progress/motion和命令；`forContainer/forInstance`复用同一owner。Source也有代理，默认Flow目录按正式heading/section派生。（N1、N2）

`playbackNavigationChrome`已有无作者writer的挂载、订阅、执行和销毁，但当前**只要存在playback设置就直接不挂兜底**。现有`controls:canvas/none`仅说明配置，不能证明内容中真的有可用控件。这是应修复的直接消费者断点。（N5）

现有目录还自行按顶部+80px/scrollHeight算active，正式阅读服务则考虑viewport、scale、scroll-margin、正文结束和显式跳转目标。应让呈现读同一个正确容器的reading snapshot；本次确认源码语义不同，未声称已在真实作品复现错误。（N3）

### 8.3 如何判断“正确生成”，避免再依赖弱模型登记

软件应基于既有正式对象、稳定动作绑定和真实挂载事实判断有限覆盖：目标存在、作用域正确、必要动作绑定可解析、控件可用。不能凭`<nav>`、按钮文案、模型填写hasNavigation或声称完成，就撤掉兜底。

内置导航组件天然使用正式绑定；自定义Source导航尽量使用软件提供的同一动作接口，相关绑定事实由软件获得。任意手写JS的行为无法完全由静态DOM证明，无法确认时保留可唤起的宿主入口。这只需要临时的能力覆盖信息，不能复制章节表、阅读状态或整个Runtime状态。

目标校验必须使用host的正式解析。当前Source代理的canExecute只是部分检查，不能把它报告enabled当作任意target合法。普通作品兜底继续遵守对应导航规则；global的guoling.navigation在当前系统可能被识别为教师控制台，不能为了补一个按钮就无意赋予教师强制跳转语义。（N1、N4、N5）

默认目录目前只认识正式heading/section，不会理解任意Source内部动态HTML。新作采用应机械保留可识别章节语义；局部程序需要暴露稳定章节/步骤。没有这类信息时，软件显示已有根页面与合法位置，不编造目录目标。

### 8.4 导航与推进共用服务，但不是同一动作

软件已有两种推进：页面/章节/软件已知步骤使用导航命令；`presenter.strategy:authored-command`沿现有命令分派进入作品自己的程序。旧fallback按钮只发step.next/previous，单根单步骤时还会隐藏；它不能直接兜底任意Runtime的内部推进。（N5）

因此新控制台应依据当前正式推进策略，使用已有导航或presenter分派。复杂程序未暴露内部步骤时，宿主能保障作品级返回/目录，却不能从“下一步”文案猜出程序状态。这是应在创作与采用合同中明确的最小条件，不要求模型再实现一套导航状态机。

编辑、播放和离线导出共享目标与行为语义，各viewer保留自己的当前位置。阅读、drawer开合和兜底出现不写作者History；用户定制导航组件的内容/外观才进入正式事务。print/DOCX不带运行时抽屉，正式内容目录按对应格式能力处理。

导航的AI方法同步改为：优先设计内容内推进；软件提供正式动作及默认兜底；模型漏做不阻断基本使用。常见按钮和目录优先采用带正式绑定的组件，让AI负责位置、外观和文案，软件完成目标绑定与执行。创建自定义导航仍用现有发现、组件和Source入口，不新建登记平台、总状态owner或专门补救Skill。

## 9. OAuth 401：安全诊断结论与下一步

### 9.1 已确认事实

- 既有失败发生于 2026-10-28 **13:52:50.137 北京时间**，`delegation-ui/profile-current` 在解析模型目录凭据时刷新返回 HTTP401；父/子模型调用尚未发出，modelCalls=0。
- 既有安全 probe 显示凭据可解密、identity 相符、已过期、networkCalls=0。这支持“曾授权且仍有匹配凭据”，不能解释为从未登录。
- 本轮只比较安全元数据：正式默认 profile 与五个相关实验 profile 共六处，连接/凭据 owner 相同、加密凭据字节一致、version=1、revoked=false；检查集合内未发现更新版本。不能扩大为整台电脑绝无其他有效会话。
- 既有准备脚本复制 `Local State` 与 execution settings，产生独立凭据副本。当前刷新 lease/CAS 位于 settings 路径/进程内，不能把多个 profile 的副本视为同一原子凭据 owner。
- `ChatGPTOAuthClient` 在 HTTP 非成功时直接抛出状态错误，未读取和分类服务端错误体；`executionSettingsService` 将400/401/403合并为刷新拒绝并建议重新登录。现有日志不足以区分 invalid_client、invalid_grant 或服务端其他明确原因。（A1—A4）

本轮没有解密/输出令牌，没有发刷新请求，没有重置凭据、切换账号或启动授权。

### 9.2 隔离实验支持什么

主 Agent 将当前实际 `ExecutionSettingsStore` 在内存编译加载，使用两个空临时目录和合成 owner；加密/解密方法若被调用即抛错。调用真实 `withOAuthLease`：

| 条件 | 观察到的最大并发 |
|---|---:|
| 同一 profile 路径的两个 store 实例 | 1 |
| 不同 profile 路径、相同合成 owner | 2 |

实际凭据读取0、网络0、settings 写入0，临时目录最终为空并清理。实验只证明锁作用域，不证明真实 refresh token 曾被重用。正常应用还有 single-instance lock；不能把实验多 profile 风险扩写为日常单 profile 必然并发刷新。（A2）

### 9.3 原因排序应保持为待区分假设

| 假设 | 当前支持与缺口 |
|---|---|
| 已过期访问凭据触发刷新 | 已有 probe 和失败阶段支持；这是触发条件，不是刷新401的完整原因 |
| 旧快照/多副本与轮换冲突 | 六处相同密文、复制流程和独立 lease 使它值得优先排查；缺少实际刷新成功/替换/reuse 错误记录 |
| 客户端 ID、grant 合同或配置不一致 | HTTP401不能排除；需在原授权合同下核 client/endpoint/config，现有日志不足 |
| 服务端已撤销或要求重新授权 | 可能；必须取得明确机器错误分类或服务端证据，不能直接假定 |
| 用户从未登录、文件不可解密、一般模型服务故障 | 既有身份与可解密事实、失败发生于刷新且0模型调用，不支持将这些作为当前结论 |

OAuth RFC 将 invalid_client 与 invalid_grant 区分，401本身不能替代错误分类；刷新令牌轮换可能使旧副本失效，但规范机制并不证明本案具体发生过轮换重用。（W3、W4）

### 9.4 后续安全处理顺序

先在当前 owner 补**允许列表式诊断**：阶段、HTTP状态、有限机器错误码、request ID、配置版本与凭据版本；不存原始响应体、token或完整敏感字段。核实实际 profile、连接 owner、同一次授权使用的客户端合同，以及是否存在持续运行的旧快照。

随后只由正式凭据 owner 处理必要刷新并原子保存；测试 profile 不应复制一个仍会独立刷新的生产凭据再并发运行。具体跨进程方案按真实需要决定，不先建凭据代理平台。

只有确认 terminal invalid refresh/授权撤销等不可恢复原因时，才向用户提出保留原连接关系的重新授权方案。不要盲目重试，不改成别的账号，不取用外部原生 Agent 的 token，也不要把较新的 Sign in with ChatGPT 合同直接套到仓库既有 grant 上。

本轮到安全诊断为止。内置 AI 的完整委派消费者仍受这一问题阻断，不能因已有 ACP 授权可用就宣称内置刷新已修复。

## 10. ACP 与内置 AI：共享创作能力，保留各自会话责任

继续既定 ACP 薄 owner、正式 MCP/Gateway、原生渠道授权和可靠性工作。布局编译、精确字段、导航、Source、资源、事务和交付都是果铃领域能力，两个入口应消费同一份实际合同与能力目录。

内置 Engine 的模型历史仍由现有执行器负责；ACP 使用其原生会话历史。UI记录可提供领域事实和展示，但不回写为第二份权威模型历史。恢复会话不恢复旧写权；取消先撤领域写权，迟到结果与未知回执不能自动重放。（C2、V1、V2）

新的创作方法不应在 ACP 中靠一份长 system prompt 重新解释所有工具。按当前目标披露能力、读取必要 Skill、得到短回执，与内置路线保持一致。正式完成条件仍是最终文档、资源、保存和导出，不是 ACP end_turn 或 Engine completed。

最新 continuation 已补精确11/7/9字符消费、活跃取消、人工接力、新进程恢复，以及完成读取后实际 stdio 断连。真正 OS/工作台崩溃、断网和**未决写入回执丢失**仍未全部覆盖；不得把完成读取后的故障替代这些边界。原始 GLX→真实子作者→封存→父采用→冷开的新完整旅程仍待内置凭据问题解除。（V1）

本轮不研究 Pi、Codex App Server 或完整自研 Harness 的路线比较，不新增默认路由或登录 UI，也不以布局方案为理由迁移会话内核。

## 11. 下一阶段执行计划

以下是讨论收敛后的实施建议。本轮没有执行其中的产品修改。

### 11.1 按用户结果推进的顺序

| 顺序 | 最小交付与验证 | 复用内容 | 成功条件与失败回退 |
|---|---|---|---|
| 0. 固定基线与消除诊断盲区 | 记录候选构建；补OAuth安全错误分类与具体target/slot适用性 | 原证据协议、Gateway、store | 不依赖OAuth的工作继续；不换账号绕过，不把不可观测项写成已验 |
| 1. PPT式组合与组内手调 | 用market真实组完成组合→选成员→改字/拖缩→整体移动→解除一层→自由移动→Undo/保存 | 现有freeObjectCommands、父矩阵、hit、专业编辑器与事务 | 操作无AI依赖，ID/内容/范围外保全；不只交按钮或命中修复；复杂组件不强拆 |
| 2. Flow拖动后自动绕排 | 图片和一个互动组件：拖左→改宽→增前文→变窄→拖右→改为覆盖/回正文→保存 | 正文拖动、flowLayout/placement、段落锚点、投影 | 真正文字避让与尺寸反馈、普通组件可用；48%固定宽不足就补有限尺寸表达；中心双侧绕排单独验证，不伪装支持 |
| 3. 导航自动兜底 | 漏控件、错误目标、挂载失败、有效自定义恢复、单根authored-command | 既有导航owner、presenter与宿主呈现 | 预览/离线均可用，无作者snapshot写入、无第二位置状态；不能依赖模型正确登记或越过作品规则 |
| 4. 保身份重排与两题迁移 | 同一人工修改后的区域大重排，AI读当前状态续作；第一题完整交付后再检验第二题 | 测量、wrapper消除、软件对象引用、原生move、正式保存 | 重排和AI续改不重建人改；按T2/T3与人工接力判断净收益，HTML/Source/原生均可胜出 |

以上不是四套新系统，而是同一编辑与导航能力的实际消费者。Skill、索引、方法和参考跟随每项能力交付。导航和安全诊断可与编辑独立并行，共同合同与正式写入由单一负责人集成。Flow布局组解组的几何、正文占位和行为引用先做隔离例子；只要不能保全就拒绝该范围，不用隐藏组伪装解组。

### 11.2 最小的可证伪验收

- **组合与编辑：** 普通组合的组内拖缩/内容编辑、整体变换、解组、再组合完整成立；遮挡/裁剪/变换、重复挂载和锁定不误写。解组明确只解除一层，复杂行为与合成不静默丢失。
- **保身份：** 原有对象不因布局重建；范围外字段差异为0；内容、富文本、资源、裁剪、Source、作者记录与行为引用逐项核对。显式新增/删除单列，不用ID总数掩盖替换。
- **并发与失败：** 陈旧revision、重复/漏引用、越域、取消、应用成功但观察失败都有确定结果；不能重放未知写入。
- **保真与编辑载体：** 覆盖任务实际用到的普通排印与图片能力；记录哪些转原生、哪些保源，以及用户具体能改什么；不以原生百分比验收。
- **持续行为：** Flow中图片与一般组件拖放/改宽后文字自动绕排，前文增长和目标宽度变化不遮挡；Runtime外框与字段拖动分别验生命周期。导航遗漏/故障自动兜底，推进策略正确，作者稿不因兜底变脏。
- **能力消费：** 内置与ACP真正得到合适工具和方法；已知目标不再全目录反复续读；没有要求模型手工维护软件身份/资源。
- **交付：** 正式保存、独立冷开、受影响的离线消费者成立；先前有效证据复用，不为数量重复整仓测试。

性能沿既有 B0 协议：T1 是可操作有效预览；T2 是首次满足共同质量、已保存且离线可运行的交付；T3 从同等人工修改状态后的共同局改要求开始，到修改合格且文件/导出更新。人工编辑/Undo/冷开另列。发现、等待、装配、失败和返修均计入墙钟，不把模型阶段和或首存冒充首次合格。

十分钟首次合格继续是挑战目标；没有新证据前不增加任意倍率门槛，也不采用历史125%诊断值作为硬闸。若主要耗时来自内容/视觉失败，应先改善创作方法和观察，而不是因为布局编译可做就继续扩建。

### 11.3 与既定计划的对应

| 既定范围 | 本方案纳入的正式工作 |
|---|---|
| 工作包1：最短可靠创作/修改闭环 | 组合/组内手调/解组；Flow拖动绕排；自动导航兜底；layout-only保身份应用；适用性与当前稿保全 |
| 工作包2：ACP与复杂任务可靠性 | 共用更新后的工具/Skill合同；保原生授权边界；继续未决写入与故障恢复；内置OAuth诊断 |
| 工作包3：两件真实作品与人工接力 | 同一题承载构图、局改、导航和参考复用；首次合格与用户接手；第二题检验方法迁移 |
| B0 | 沿既有计时/证据，不新建评分平台 |
| B1 | 聚焦观察与应用/观察结果分离，保留已验修复 |
| B2 | 当前目标、slot适用性、按需披露和同目标Source恢复 |
| B3 | 测量/映射边界、组合解组与保身份重排、Flow绕排、Source字段拖动 |
| B4 | 每项能力同步必要Skill与示例，实际消费；不扩成长提示词 |
| B5 | 减少逐对象查询、重复目录、装配及模型往返；净收益才增加并行 |
| B6 | 按真实首开/编译/导出热点优化，避免“组多”直接触发重构 |
| B7 | 按问题的参考采用/拒用、人工接力与新经验回写 |

### 11.4 迁移与兼容边界

旧作品不自动扁平化、不批量改组、不重写Source。先在副本和用户明确新建/重排的范围验证。尽量保持 Project11/Published4/API5，现有字段可表达就不升级格式；确需新持久语义时，另交具体兼容方案。

保留现有自由frame、Flow布局、用户主动组和Runtime语义。本次已经确定组合/解组、尽量可拖拽、Flow响应式绕排及自动导航兜底方向；具体实现进入后续开发轮次，不再重复询问是否要这些能力。失败回退到既有可用入口，保留已合法提交的人改；不靠第二writer、双份正文或shadow history维持兼容。

## 12. 已收敛的方向与剩余实现判断

以下四项已经由本次讨论明确，不再保留为待批准产品分歧：

| 已确定方向 | 本方案的落实 |
|---|---|
| 可以保留普通组，用户必须能手调 | PPT式组合、组内操作、解除一层后自由布局；固定相对构图与locked区分；不可拆组件保整体 |
| Flow响应式且接近Word | 图片和组件可拖，文字按位置/大小避让；锚点与绕排独立；不再把普通拖动限制为重排或无绕排overlay |
| HTML/Source/原生都可以，尽量可拖拽 | 载体按任务选，主要验手动修改范围、成本和保存；Source有作者geometry也直接操作，不为拖动强拆程序 |
| 内容内导航优先，弱模型失败自动兜底 | 宿主自动补目录与推进，预览/离线一致；不依赖模型声称完整，不自动制造大量作者对象 |

剩余需要用具体原型或隔离样本判断的范围只有三类：

1. **Flow布局组解除的承载与占位。** 保当前画面、独立拖动和邻文关系需要哪项最小持久表达；不能用隐藏普通组回避。
2. **任意中心双侧绕排。** 现有左右float不足，需要证明行排版、文本选区、中文输入、多个对象和窄屏的可行机制。先有完整左右/上下绕排，不将未验部分包装成全部Word能力。
3. **复杂组件可拖字段与不可拆边界。** 按真实Source/effect/绑定责任判定，避免普通布局一律不能拆，也避免有程序关系却静默删除父owner。未暴露任意内部步骤的程序，导航兜底明确只覆盖宿主实际知道的范围。

这些是实现与验收问题，不是重新比较整个产品路线。OAuth的下一步仍需明确服务端错误事实；不以重新登录替代诊断。

## 13. 证据索引与复核说明

### 13.1 仓库源码与记录

下列路径均相对仓库；函数名用于在当前 dirty 工作树中定位，避免固定行号在后续开发中失效。正文中的证据编号对应本表。

| 编号 | 来源与定位 | 支撑内容 |
|---|---|---|
| G1 | [DEVELOPMENT](../../../DEVELOPMENT.md)、[架构合同](../../development-plan/ARCHITECTURE_CONTRACT.md)、[CURRENT_STATUS](../../development-plan/CURRENT_STATUS.md)、[NEXT_EXECUTION](../../development-plan/NEXT_EXECUTION.md)；根AGENTS | 唯一writer、当前路线、三包/B0—B7、禁止本轮扩展Harness与默认行为 |
| H1 | [10-10原始提案](../../development-plan/20261010-workbench-consolidated/evidence/ORIGINAL_GPT_PRO_PLAN.md)、[最终README](../../development-plan/20261010-workbench-consolidated/README.md)、[实现结果](../../development-plan/20261010-workbench-consolidated/IMPLEMENTATION_RESULT.md)、根目录《果铃创作体系收敛方案-2026-10-25.md》；正文所列git commits | 历史建议、最终固定设计语义、单向/持续布局的共存 |
| L1 | [htmlAssembly.ts](../../../src/core/contentApply/assembly/htmlAssembly.ts)：assembleMeasuredHtml、htmlObjectStyle、flowCoupled、sourcePath | wrapper消除、frame权威、保源/保组条件 |
| L2 | [browserCapture.ts](../../../src/main/workbench/contentApply/measurement/browserCapture.ts)：ResizeObserver、linearOf、geometryIssue | 真实border-box、二维affine、非仿射拒绝边界 |
| L3 | [pageHtmlAssembly.ts](../../../src/main/workbench/contentApply/application/pageHtmlAssembly.ts)、[professionalGraphics.ts](../../../src/main/workbench/contentApply/application/professionalGraphics.ts) | 页面壳消除、普通frame组、绘制保真 |
| L4 | [types.ts](../../../src/core/contentApply/planning/types.ts)：ContentObjectDraft；[plan.ts](../../../src/main/workbench/contentApply/application/plan.ts)：planContentApply、allocate | identity-free草稿与redo的身份行为 |
| L5 | [html.ts](../../../src/main/workbench/contentApply/application/html.ts)：projectedHtmlElements；[applyService.ts](../../../src/main/workbench/contentApply/applyService.ts)：reconcileSourceAuthoring、作者记录与资源保护 | content局改映射、redo保源保护与拒绝歧义 |
| L6 | [courseFlowLayoutEdits.ts](../../../src/core/course/courseFlowLayoutEdits.ts)：prepareCourseFlowColumns；[flowNativeLayout.ts](../../../src/shared/flowNativeLayout.ts) | 有限保身份布局、正式布局组分类 |
| L7 | [professionalHtml.ts](../../../src/main/workbench/contentApply/application/professionalHtml.ts)：professionalHtmlDraft及文字/图片回退判断 | 常规排印、字体、图片映射边界 |
| L8 | [coordinator.ts](../../../src/core/projectFiles/componentPlatform/coordinator.ts)、[projection.ts](../../../src/core/projectFiles/componentPlatform/projection.ts)：instanceByPath、guoling-instance | 现有软件对象引用与Flow源投影 |
| U1 | [containerEditingContext.ts](../../../src/renderer/documents/containerEditingContext.ts)、[componentAuthorHit.ts](../../../src/renderer/components/componentAuthorHit.ts) | 真实前景命中与祖先提升策略 |
| U2 | [SlideLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SlideLocationWorkspace.tsx)、[SpatialLocationWorkspace.tsx](../../../src/renderer/ui/workspaces/SpatialLocationWorkspace.tsx)、[Workspace.tsx](../../../src/renderer/ui/Workspace.tsx)、[nativeInlineAuthoring.ts](../../../src/renderer/authoring/nativeInlineAuthoring.ts) | 实际UI消费者、进入组、inline编辑层级 |
| U3 | [runtime.ts](../../../src/shared/contracts/component-platform/runtime.ts)、[SandboxComponentRuntime.ts](../../../src/player/components/runtime/SandboxComponentRuntime.ts)、[SelectionContextController.ts](../../../src/renderer/workbench/SelectionContextController.ts)、[useComponentAuthorInteraction.tsx](../../../src/renderer/ui/workspaces/useComponentAuthorInteraction.tsx) | author字段、源region/override、几何增量、正式写回 |
| U4 | [freeObjectCommands.ts](../../../src/renderer/componentPlatform/surfaces/slide/freeObjectCommands.ts)、[geometry/index.ts](../../../src/core/components/geometry/index.ts)；当前src/tests调用检索 | 已有有限自由组合/解组草案、frame要求及未找到真实消费者的边界 |
| D1 | [courseFlowEdits.ts](../../../src/core/course/courseFlowEdits.ts)、[componentPresentation.ts](../../../src/shared/componentPresentation.ts)、[flowMediaLayout.ts](../../../src/shared/flowMediaLayout.ts)、[SharedDocumentEditor.tsx](../../../src/renderer/document/SharedDocumentEditor.tsx)、[flowParagraphLayout.ts](../../../src/renderer/ui/flow/flowParagraphLayout.ts)、[flowParagraphAnchors.ts](../../../src/shared/flowParagraphAnchors.ts) | 正文拖动、48%左右绕排、浮层、段落锚点与组件入口边界 |
| N1 | [ComponentNavigationOwner.ts](../../../src/renderer/components/ComponentNavigationOwner.ts) | observation、目录派生、bound端口、target准入 |
| N2 | [teacherController.ts](../../../src/shared/contracts/component-platform/teacherController.ts)、[modelProjection.ts](../../../src/player/componentPlatform/modelProjection.ts)、[compiledPlayer.ts](../../../src/player/componentPlatform/compiledPlayer.ts) | 阅读/导航会话与多消费者 |
| N3 | [flowToc.ts](../../../src/player/componentPlatform/flowToc.ts)、[flowReading.ts](../../../src/shared/flowReading.ts)、[FlowWorkspace.tsx](../../../src/renderer/ui/FlowWorkspace.tsx) | 重复active算法、正式reading、容器绑定 |
| N4 | [flowRuntimeToc.ts](../../../src/player/surfaces/flow/flowRuntimeToc.ts)、[teacherControllerViewportGeometry.ts](../../../src/shared/teacherControllerViewportGeometry.ts) | drawer、正文/paper/viewport inset、非作者状态 |
| N5 | [playbackNavigationChrome.ts](../../../src/player/componentPlatform/playbackNavigationChrome.ts)、[playback-v1/types.ts](../../../src/shared/contracts/playback-v1/types.ts)、compiledPlayer/publishedPlayer的presenter分派；[courseElementInsertion.ts](../../../src/core/course/courseElementInsertion.ts) | playback存在即退出的旧兜底、导航与authored-command差别、正式控制组件入口与宿主兜底分工 |
| C1 | [ToolCatalog.ts](../../../src/core/tools/ToolCatalog.ts)、[generate-ai-capabilities.ts](../../../scripts/generate-ai-capabilities.ts)、[courseAgentCapabilities.ts](../../../src/shared/courseAgentCapabilities.ts)、package.json | 同源schema、语义索引、生成/检查与构建链 |
| C2 | [DocumentToolGateway.ts](../../../src/core/tools/DocumentToolGateway.ts)：inspect/load/catalog；[ExecutionEngine.ts](../../../src/main/workbench/execution/ExecutionEngine.ts)、[ExternalMcpService.ts](../../../src/main/workbench/external/ExternalMcpService.ts) | 真实模型工具披露、缓存/变更、适用性缺口 |
| C3 | [.agents/skills](../../../.agents/skills/) 中 orchestrate-courseware、edit-content、build-courseware-project、workbench-usage 及其references | 现有方法已按需、HTML/Source/原生并存；需要定点更新的说明 |
| C4 | [BundledSkillService.ts](../../../src/main/workbench/skills/BundledSkillService.ts)、[ScopedSkillService.ts](../../../src/main/workbench/skills/ScopedSkillService.ts)、[install-courseware-skills.ps1](../../../scripts/install-courseware-skills.ps1)、tests/unit/aiCapabilities.test.ts | 内置/工作区/显式安装与一致性检查边界 |
| R1 | [创作参考入口](../../../creative-reference/README.md)、[METHOD](../../creative-production/works/coffee-journey/runtime-first-system-20261025/METHOD.md)、[ASSET_INDEX](../../creative-production/works/coffee-journey/runtime-first-system-20261025/ASSET_INDEX.md)、[FEEDBACK](../../creative-production/works/coffee-journey/runtime-first-system-20261025/FEEDBACK.md) | 方法、资产、可拒用、已验与未验范围 |
| R2 | [背景组件](../../creative-production/works/coffee-journey/runtime-first-system-20261025/assets/continuous-background/README.md)、[咖啡r264冻结说明](../../creative-production/works/coffee-journey/design/v08-runtime-first/final-20261025/README.md) | 连续视觉/生命周期/采用反例及冻结验证 |
| V1 | [20261028-continuation/RESULT](../../development-plan/20261028-continuation/RESULT.md) | 最新精确编辑、ACP、市场/叙事、分栏/导航与剩余缺口 |
| V2 | [20261028-productivity-acp/RESULT](../../development-plan/20261028-productivity-acp/RESULT.md) | Source原生编辑、共享状态、真实ACP与历史计量纠正 |
| V3 | [20261026-product-execution/RESULT](../../development-plan/20261026-product-execution/RESULT.md) | 城市夜线原稿/返工、完整HTML采用、参考真实读取 |
| A1 | src/main/workbench/providers/ChatGPTOAuthClient.ts、OAuthSecurePersistence.ts、executionSettingsService.ts | 刷新阶段、丢失错误分类、现有提示 |
| A2 | ExecutionSettingsStore.ts 的 withOAuthLease/readOAuthCredential/writeOAuthCredential；src/main/applicationIdentity.ts、src/main/index.ts | 路径/进程锁与CAS、默认profile、单实例保护；本轮合成owner实验 |
| A3 | output/continuation-20261028/delegation-ui/host.json、credential-metadata-probe.json 与准备profile脚本 | 既有401、零模型调用、可解密/匹配/过期和复制流程 |
| A4 | 本轮六profile只读元数据比较 | 相同凭据owner、密文字节、version1、revoked=false；未展示密钥材料 |

### 13.2 本轮实际作品证据（M1/M2）

| 样本 | 仓库路径 | GLX SHA-256 |
|---|---|---|
| coffee-v07 | docs/creative-production/works/coffee-journey/design/v07/native/coffee-journey-v07.glx | 2a4511903738bacdaf78c20e68858f6ff766d26a34f83b354c5c21925aca6d9f |
| coffee-r263 | docs/creative-production/works/coffee-journey/design/v08-runtime-first/native/coffee-journey-v08-runtime-first.glx | 8250d760ba3dfd50503952d99680974ae99067dd1053a2125a445d53ddf606d0 |
| coffee-r264 | docs/creative-production/works/coffee-journey/design/v08-runtime-first/final-20261025/coffee-journey-v08-runtime-first-final.glx | 326a2f313155e0ed3fcd4f9e34d5ff6be7acced9d02d002732789aeb5a04eade |
| market-r32 | output/continuation-20261028/product-ui/workspace/market.glx | c4caa3937442781a34f8ad964dc66f8199ba690986a6daef276672d81b26eeb2 |
| story-r23 | output/continuation-20261028/product-ui/workspace/story.glx | d94f180fb1f625fa9e14a5a5a59592e4c73056db69fe73b99e377c290960a1ac |
| story-r27 | output/continuation-20261028/product-ui/workspace/story-polished.glx | 9f0c01be5f4140a6f94efe2b9022079f488c7c15de365126c183168b4b4816f3 |

复核方法：读取GLX ZIP中的project.json；以正式instances/childIds/rootIds/global检查结构；用正式effective implementation与布局组谓词分类；差分逐一比较旧ID、字段、assets、definitions。story差分为33/33旧ID保留、3新增/0删除、32/33旧data相同，唯一data变化为标题字号62→48且正文不变；另有根childIds变化。咖啡差分为76/76 ID和结构保留，42个实例的style/data发生变化，不将其说成内容完全未变。

本轮复核的既有截图：`output/continuation-20261028/story-polish/01-native-hero-editor.png` 和 `output/continuation-20261028/market-offline/qa-delivery/06-compact-default.png`。这属于现存画面审阅，不是重新执行截图中的操作。

M3补充：本次按未改动的正式reparentFrame执行旋转/缩放/镜像/shear换父的内存实验，检查四角、尺寸和奇异矩阵拒绝；未运行新的组合解组GUI。本轮试图做隔离浏览器绕排样本，但本地Playwright缺少浏览器可执行文件，未安装也未得到运行结果；CSS边界以W7规范及实际源码为依据，不称浏览器实验通过。

### 13.3 外部一手资料

- **W1**：[W3C CSS Positioned Layout Level 3](https://www.w3.org/TR/css-position-3/)，定位方案中 absolute 的脱流与兄弟/祖先尺寸关系。作为现行规范草案说明机制。
- **W2**：[W3C CSSOM View](https://www.w3.org/TR/cssom-view/)、[CSS Transforms Level 1](https://www.w3.org/TR/css-transforms-1/)，几何与变换测量边界；不据此宣称任意CSS可逆。
- **W3**：[RFC 6749，5.2与6节](https://datatracker.ietf.org/doc/html/rfc6749)，token错误分类和刷新行为。
- **W4**：[RFC 9700](https://datatracker.ietf.org/doc/html/rfc9700)，刷新令牌保护/轮换机制；这里只用于解释可能风险，不替代本案服务端证据。

- **W5**：[Microsoft：Group or ungroup shapes, pictures, or other objects](https://support.microsoft.com/en-gb/office/graphics-visuals/group-or-ungroup-shapes-pictures-or-other-objects)，组内成员操作与解除后位置保留。
- **W6**：[Microsoft：Wrap text and move pictures in Word](https://support.microsoft.com/en-gb/word/wrap-text-and-move-pictures-in-word)，绕排、随文移动与段落锚点。
- **W7**：[W3C CSS Shapes Level 1](https://www.w3.org/TR/css-shapes-1/)，float的shape-outside不能提供同一对象两侧同时绕文；不据草案推断任意运行端完整支持。

### 13.4 本轮保护与交付

本轮研究产物为本文件。没有修改产品源码、Skill、能力生成物、CURRENT_STATUS/NEXT_EXECUTION、默认行为或作品；没有执行迁移、commit/push/发布、凭据重置或新的授权。研究开始时已有29份tracked dirty文件记录SHA-256，交付时复核其未被本轮改变；HEAD保持基线。已有未跟踪成果保留。

本次四项产品方向已经收敛，正式开发仍在后续轮次开展。本轮仅更新这一份方案；源码、Skill、作品和运行默认未变化，报告更新不等于实现已经落地。
