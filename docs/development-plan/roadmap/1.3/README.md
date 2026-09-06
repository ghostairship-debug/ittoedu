# 1.3：Recipe 与设计生产力

## 结果与边界

教师可以用高频页面 / 互动 Recipe 快速得到普通、可继续编辑的 V9 内容，并能复用参考页骨架、批量替换内容、应用 Design Token 和快速定位问题。Recipe 只是一组产品命令，不成为第二套 DSL，不保留隐藏运行时；容量不足时换档、拆页或切换 Flow，不默认无限缩小文字。

本版交付五种 Chart 的 Flow/Spatial 创作闭环、三 Surface 表格创作，以及复用项目 `designTokens.colors` 的工程色板与范围应用；这些不是 Recipe 的隐含附带工作。1.2 已负责 Slide 图表/表格作者态同步修复、不中断的连续调色、固定常用色和统一图表插入入口。跨 Surface Chart 的独立 strict 合同与 consumer 已落地，当前 reader/能力索引包含 Flow 正文和 Spatial world。

2026-09-06 Owner 补充的 Flow 正文表格与 Spatial 世界表格已完成实现：独立合同提交 `05d54c6` 开放 Spatial world Table；Flow 复用 `FlowTableBlock`，Native Table 复用共享内容操作。统一插入、行列结构编辑、活动文字草稿、保存/恢复/重开、复制身份、Published 与适用导出均已有聚焦证据。Flow DOCX 保持可编辑表格；Spatial PPTX 使用 camera 视口内的静态图表/表格。input、Flow overlay、Spatial shared 和 global 不随本次表格扩域。

2026-09-06 Owner 已明确确认「S1 验收通过，请持续推进至下一个人工门」。下一次人工验收为 1.5 末的 S2，不重复请求 S1 签署。新增 Table 范围和 review 修复仍按下述验收标准完成工程收口；该签署不代替尚未完成的实现与验证，也不表示 accepted 源码标签已经创建。

S1 Owner 验收 1.2–1.3 且工程收口完成后发布 `v1.3.0` accepted 源码标签，不发布 HTML 或安装器。

## 任务 DAG

本轮执行先消除人工依赖，再按实际文件边界并行。Recipe 采用固定布局和明确容量阈值，不建设自动排版求解器；首个配方贯通普通 V9、事务和可见 UI 后复用实现其余配方。参考页限定为当前工程内已有 V9 Slide 页；批量替换限定为正式可编辑文本字段，不处理任意 JSON、代码、资源路径或外部 PPT/截图识别。快速诊断扩展已有 ProjectHealthPanel 与权威 health collector，不新建诊断系统。

每批选择直接覆盖新行为的聚焦检查，已有且未受影响的通过证据继续有效。使用 `npx vitest run` 避免无关 Player 构建；真实操作覆盖明确路径，按依赖变化构建必需载体后直接运行 Playwright。集成时检查跨模块路径，只有证据不足或相关回归才扩大范围；不按子智能体数量重复执行。

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r13-000-recipe-contract` | 定义 Recipe 输入、普通 V9 展开结果、槽位与容量策略 | — | 否 | `contracts-schema`, `generated-index` | 六个 recipe ID 与版本在一个正式 registry/catalog 中固定，UI、Builder、Capability 只投影它；同一输入产生可解析的普通 V9 命令结果；展开后删除 Recipe 元数据不改变行为；超容量返回“换档/拆页/Flow”建议而不是继续缩字；禁止第二 recipe registry 或运行时 DSL |
| `r13-001-chart-surface-contract` | 固定 Chart 的 Flow/Spatial 载体、兼容与静态导出合同 | `r12-050-native-closure` | 否 | `contracts-schema` | 先独立交付 Flow 正文图表 strict 分支、Spatial world 有效域及 Published 匹配、旧 V9 可读/旧 reader 明确失败反例；数据 Schema 复用，DOCX 静态图面+可编辑数据及 Spatial 相机导出明确；本节点不扩 Table/input/global，Table 另经 r13-005 独立合同 |
| `r13-002-chart-shared-authoring` | 迁移共享图表属性编辑器与纯数据操作并保持 Slide 等价 | `r13-001-chart-surface-contract` | 否 | `store-slide`, `props-slide`, `props-shared`, `authoring-slide`, `workspace-shell` | 共享无 Store 属性草稿/校验和纯 chart 数据操作，Surface adapter 独占 target/history；Slide 先迁移并删除被替代公共实现，五类数据/类型/颜色/ID/保存/PPTX 等价，无第二 editor/writer |
| `r13-003-flow-chart-delivery` | 交付 Flow 正文图表的创作、保存、Player 与连续 DOCX | `r13-002-chart-shared-authoring` | 否 | `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print` | 可见 UI 创建编辑五类正文图表，随正文增删/重排移动且宽度遵循稿纸；一次操作一笔 Flow 历史，保存重开/Player/HTML 一致；连续 DOCX/打印保留图表与数据，静态后备明示 |
| `r13-004-spatial-chart-delivery` | 交付 Spatial 世界图表的创作、相机播放与静态导出 | `r13-002-chart-shared-authoring` | 否 | `store-spatial`, `authoring-spatial`, `props-spatial`, `published-spatial`, `published-producer`, `export-docx-print` | 可见世界层入口创建编辑五类图表，拖动缩放层级与相机一致；复制/删除处理稳定引用，一次操作一笔 Spatial 历史；保存重开/Player/HTML 与现有静态相机页保留同一数据 |
| `r13-005-table-surface-contract` | 固定三 Surface 表格载体、编辑能力、兼容与导出合同 | `r12-050-native-closure` | 否 | `contracts-schema` | 沿用既有 FlowTableBlock 和 Slide NativeTableContent，独立扩展 Spatial world Table 有效域及 Published 匹配；固定各载体的行列/单元格/样式能力、稳定 ID、草稿和静态导出语义；旧 Flow/V9 无损可读，旧 reader 对新 Spatial 域明确失败；不新增第二正文表格模型，不扩 input/overlay/shared/global |
| `r13-006-table-shared-authoring` | 共享表格内容操作与编辑控件并保持 Slide 等价 | `r13-005-table-surface-contract` | 否 | `store-slide`, `props-slide`, `props-shared`, `authoring-slide`, `workspace-shell` | 共享行列/单元格操作、校验与适用控件，Surface adapter 独占载体转换、target/revision/history；Slide 先迁移并删除被替代公共实现，既有样式/文字/Undo/保存/Player/可编辑 PPTX 等价；合法活动文字草稿纳入脏状态、保存与恢复，取消和 stale 零误写；按能力显示入口，不复制 writer |
| `r13-007-flow-table-delivery` | 交付 Flow 正文表格的插入、结构编辑、保存与可编辑 DOCX | `r13-006-table-shared-authoring` | 否 | `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print` | 可见表格入口插入正文/嵌套 section；表头、标题说明、单元格文字/富文本和行列增删重排可编辑，正文前插/移动后布局正确；复制重建行列 ID，一次操作一笔 Flow 历史；活动草稿保存/恢复、重开、Player/HTML 一致，连续 DOCX 保留可编辑表格，PDF/打印无静默遗漏 |
| `r13-008-spatial-table-delivery` | 交付 Spatial 世界表格的编辑、相机播放与静态导出 | `r13-006-table-shared-authoring` | 否 | `store-spatial`, `authoring-spatial`, `props-spatial`, `published-spatial`, `published-producer`, `export-docx-print` | 可见世界层入口插入表格并编辑行列/单元格/已有 Native 样式；选择、拖动、缩放、层级使用 world 几何，复制/删除清理引用且可 Undo/Redo；活动草稿保存/恢复、重开、Player/HTML 同值；相机静态页保留表格并明示静态结果，shared/global 仍拒绝 |
| `r13-009-authoring-draft-persistence` | 闭合图表与 Component 活动文字草稿的保存和恢复 | `r13-003-flow-chart-delivery`, `r13-004-spatial-chart-delivery` | 否 | `store-kernel`, `store-slide`, `store-flow`, `store-spatial`, `workspace-shell`, `app-save-recovery` | Chart 与 Component 受支持画布文字入口的合法活动草稿接入现有 Surface 生命周期；输入后立即参与脏判定，不失焦的正式保存 preparation/桌面保存入口与恢复快照均取新值；提交一次历史、恢复不改活跃历史，取消/IME/stale 不误写；核对共用文本控件的其他 consumer，保全 Component 属性/正式代码修改的保存重开和 Undo/Redo |
| `r13-010-cover-recipe` | `cover-v1` 生成可编辑封面骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 标题、副标题、署名和视觉槽位可单独编辑；一次应用只产生一个历史事务；保存重开后无 Recipe 专用节点；在固定长短标题输入下不遮挡主操作区 |
| `r13-011-concept-recipe` | `concept-v1` 生成概念讲解骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 概念、解释、例证和视觉槽位展开为普通 V9 内容；删除 / 重排任一对象不破坏其余对象；长内容触发结构化容量建议而非字体小于现有可读下限 |
| `r13-012-worked-example-recipe` | `worked-example-v1` 生成分步例题骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 题干、步骤、结论和提示均可直接编辑；步骤可增删重排并 Undo / Redo；新知识不只存在于答案反馈；保存重开和 Player 保持顺序 |
| `r13-020-step-reveal-recipe` | `step-reveal-v1` 生成声明式逐步揭示互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction` | 至少三步内容可编辑、重排并设置初始状态；Player 逐步操作顺序确定，返回起点可复现；键盘可触发；展开结果不依赖 Recipe 运行时 |
| `r13-021-choice-feedback-recipe` | `choice-feedback-v1` 生成选择与反馈互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction` | 题干、选项、正确性与反馈可编辑；选择后显示对应反馈并可重置；答案一致性诊断能定位缺答案 / 多答案配置；保存重开与 Player 一致 |
| `r13-022-classify-sort-recipe` | `classify-sort-v1` 生成分类 / 排序互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction`, `published-dynamic` | 分类与排序参数均可编辑；分类用“选中项目→选中目标组”的声明式点击/状态路径，排序用当前 Component 载体真实重排并公开项目、正确顺序和反馈参数，不要求本节点先建设通用组件化；指针与键盘得到同一结果，错误/正确反馈与重置确定，保存重开与 Player 一致；缺组、孤立项和重复稳定 ID 被拒绝且零部分写入；不新增拖放/放置触发器或顺序动作 |
| `r13-030-reference-clone` | 从当前工程已有 V9 Slide 页复制可编辑骨架 | — | 否 | `store-slide`, `authoring-slide`, `workspace-shell` | 克隆后对象、资源和交互引用获得无冲突身份；修改副本不改变原页；保存重开、Player 与适用导出无悬空引用；一次克隆可整体撤销 |
| `r13-040-batch-replace` | 在明确范围内预览并批量查找替换正式文本字段 | — | 否 | `store-kernel`, `workspace-shell` | 可选择当前页 / Surface / 整课范围；预览逐项显示 old / new 与 target；确认后仅修改勾选项并产生一个事务；stale 预览拒绝提交；Undo 恢复全部原值 |
| `r13-041-token-apply` | 复用项目色板并将 Design Token 应用于明确对象范围 | `r12-040-background-authoring` | 否 | `store-kernel`, `props-shared`, `store-course` | 同一颜色控件读取既有 designTokens.colors；范围预览逐项报告 old/new/target 和属性，不支持项保留并说明；确认后只写所选范围，一次原子提交、stale 零写入、整体可撤销；保存重开和 Player 保持已应用色值与项目色板；不复制主题状态或默认为同色对象建立自动绑定 |
| `r13-050-fast-diagnostics` | 提供面向教师的快速诊断入口与可定位结果 | — | 否 | `diagnostics`, `workspace-shell` | 从可见入口启动后，结果按严重度和 Surface 分组并能跳转到对象；健康工程显示零错误；构造的悬空资源、答案不一致和容量问题分别被精确定位；诊断不改工程 |
| `r13-051-review-clone-references` | 修复参考页克隆对外部场景状态引用的误重映射 | `r13-030-reference-clone` | 否 | `store-slide`, `authoring-slide` | 两个场景各有 initial 状态时，克隆来源页保留指向另一场景的 scene.go.sceneId/targetStateId；副本内部引用按所属场景重建，原页不变；strict 解析与健康检查无悬空状态，保存重开/Player 导航正确，一次克隆可整体 Undo/Redo |
| `r13-052-review-scene-enter-navigation` | 修复 scene.enter 零延迟导航与导航队列的生命周期冲突 | `r13-000-recipe-contract` | 否 | `published-dynamic`, `published-interaction` | 两个 Slide 的真实 Published 会话中，首场景 scene.enter → scene.next、delayMs=0 能进入第二场景且无 navigation-failed；入场触发位于导航可接受后续动作的生命周期边界，局部/global 触发不重复，失败/销毁不继续调度；保留重复导航及循环防护，Player/单 HTML 同行为 |
| `r13-053-review-flow-chart-preview` | 修复 Flow 正文图表连续调色的画布预览 | `r13-003-flow-chart-delivery` | 否 | `store-flow`, `authoring-flow`, `props-flow`, `props-shared` | 真实鼠标持续拖动颜色通道时，Flow 图表 SVG 即时跟随临时值，canonical 色值和历史在松手前不变；松手只提交一次，Undo 恢复旧色；取消/目标切换/stale 清除预览且零误写，保存重开保留提交色值，Slide/Spatial 相关共享 consumer 不退化 |
| `r13-055-recipe-closure` | 统一收口 Recipe、跨 Surface Chart/Table 与设计生产力的能力及导出 | `r13-010-cover-recipe`, `r13-011-concept-recipe`, `r13-012-worked-example-recipe`, `r13-020-step-reveal-recipe`, `r13-021-choice-feedback-recipe`, `r13-022-classify-sort-recipe`, `r13-030-reference-clone`, `r13-040-batch-replace`, `r13-041-token-apply`, `r13-050-fast-diagnostics`, `r13-003-flow-chart-delivery`, `r13-004-spatial-chart-delivery`, `r13-007-flow-table-delivery`, `r13-008-spatial-table-delivery`, `r13-009-authoring-draft-persistence`, `r13-051-review-clone-references`, `r13-052-review-scene-enter-navigation`, `r13-053-review-flow-chart-preview` | 否 | `generated-index`, `diagnostics`, `published-producer` | 能力索引和现有 Builder Facade 精确覆盖六种 Recipe、四项生产力能力与已通过的 Flow/Spatial Chart/Table；诊断定位悬空引用、答案不一致、容量及图表/表格容器、数据和静态后备问题；Published 与适用导出对普通 V9 无静默遗漏，不含 Recipe 专用运行时节点或第二工程真相；作者编辑必须可保存恢复，既有基线不退化，两个 Chart、两个 Table delivery 与 F1–F5 对应的全部修复节点均为必选前置 |
| `r13-060-release` | Owner 验收 S1 创作力并发布 v1.3.0 accepted 源码标签 | `r13-055-recipe-closure`, `r12-060-release` | 否 | `none` | Owner 在同一固定课例完成 S1 创作力验收：覆盖 1.2 的 Flow 正文及文字/图片/图形浮层、图形属性、连续 DOCX、Slide input 与 PPTX、Table、五种 Chart、Line、六 owner 背景，并检查作者态同步、连续调色、常用色和统一入口；覆盖 1.3 的六种 Recipe、分类、Component 排序、克隆、批量替换、项目色板/Token、快速诊断，以及 Flow 正文和 Spatial 世界的五类 Chart 与 Table；实际修改 Component 内容/参数后检查保存、恢复、重开、Undo/Redo、Player、单 HTML 与适用导出，并验证图表/表格文字仍有焦点时的保存与恢复；晋升 1.2–1.3 已验收行为到保全矩阵，签署 accepted 后创建 `v1.3.0` 源码标签 |

并行 frontier：六个 Recipe、参考页克隆、批量替换与快速诊断可在依赖和写锁满足时并行。Chart 和 Table 各先经独立合同与共享编辑节点，再分 Flow/Spatial 两路；共享的插入面板、producer 与静态导出文件按锁串行集成，不重复修改公共 UI。Token 应用等待 1.2 共享颜色控件；Chart/Table 合同等待 1.2 Native 闭合证据，均不等待整个 1.2 发布节点。S1 必须同时覆盖两路 Chart、两路 Table 和项目色板。

## Chart 跨 Surface 的独立执行方案

### `r13-001-chart-surface-contract`：先固定载体、兼容与导出

读取当前 V9/Published 类型与 Schema、兼容政策、NativeChartContent、FlowBlock/FlowSurfaceLayerEntry、Spatial world、Chart 数据命令、Flow DOCX 与 Spatial 静态页面导出。交付一份独立可审阅合同变更，固定以下目标；该变更落地前继续拒绝 1.2 越界内容，不能先放开按钮或放宽 `.strict()`。

| 位置 | 计划载体与作者行为 | 保存/运行与静态导出目标 |
| --- | --- | --- |
| Slide scene/surface | 保留现有 Native Chart LayerItem | 继续可编辑 PPTX chart、Player 与单 HTML，不降级 |
| Flow 正文 | 新增严格的正文图表块，持有同一 NativeChartContent，沿用 FlowBlock 稳定 ID、文档顺序及内容宽度语义；前文增删时自然移动 | V9/Published 对等解析；DOCX 按正文顺序保留静态图面及可编辑数据表/摘要，明确图面为静态后备；PDF/打印也保留正文图表 |
| Spatial world | 既有 Native Chart LayerItem，使用 world 坐标、frame、order 与相机裁切 | 工程仍保存可编辑图表数据；Player/HTML 按同一视图绘制，现有静态页面导出保留相机范围内的图表并报告位置，不宣称整世界为可编辑 PPTX |
| Flow 图表浮层、Spatial surface shared、global | 不在本次 Chart 扩域 | 明确不可用并定位拒绝；Table 另按下文独立节点交付，input 有效域保持 |

Flow 正文图表块是新增 discriminator，必须在兼容政策中单独登记窄例外，与 Published 严格分支、类型、生成合同、合法/非法 fixture 和旧 reader 明确失败反例一起交付；复用 chart data 的子项 ID、数值与类型约束，不复制数据 Schema。合同必须固定 block 的字段与尺寸规则、嵌套 section/可见性、图表数据编辑 scope、复制 ID 重建、删除引用、静态后备诊断和格式适用性；不能把 FlowComponentBlock、任意 JSON bag、固定 x/y 浮层或截图伪装成正文图表。

上述静态导出为本轮计划默认：DOCX 图面静态、数据表可编辑，作者工程保持完整图表数据；它不表示已具备原生可编辑 Word chart。独立合同审阅需要改变该结果时，先同步本表、对应 delivery/S1 验收与依赖成本，再实现，不能在导出阶段临时降级。

### `r13-002-chart-shared-authoring`：先迁移现有 Slide consumer

在已有 `SlideChartProperties` 和 `v9ChartCommands` 上分离无 Store 依赖的数据草稿/校验/属性视图与纯 chart 内容操作；target、revision、history 和资源归属仍由各 Surface adapter/command 持有。共享操作输入窄 chart 值和 ID factory，返回经合同校验的结果，不接收完整 Store，也不跨 Surface 调 Slide session。

先接回 Slide 并删除被替代的公共逻辑，证明五类数据编辑、多系列转 pie/donut 的保留选择、颜色草稿、复制子项 ID、Undo/Redo、保存/Player/PPTX 与 1.2 等价；随后 Flow/Spatial 只添加自己的 adapter。不复制第二份 chart editor、数据规则、类型列表或 writer。公共插入选择器的 Surface 能力投影在本节点接出窄接口，各 delivery 只在对应能力通过后启用。

### `r13-003-flow-chart-delivery`：正文位置到连续 DOCX

通过可见“图表”入口在当前正文插入位置创建五种图表，选择后使用共享属性编辑器。图表块随前文增删/重排移动，宽度受稿纸规则约束；移动块、删除、复制、数据应用与类型切换各调用 Flow canonical command，一次操作一笔历史。Flow 浮层与 global 不借本节点获得图表入口。

贯通 Flow 作者渲染、真实 FlowSurfaceHost、Published producer、保存重开、单 HTML 与正文静态投影；DOCX 中图表顺序、标题、静态图面、可编辑数据与来源摘要均保留，按合同报告静态后备。测试覆盖嵌套 section、长正文前插、图表变高、复制与撤销；不能以绝对定位图表固定在原屏幕位置充当成功。任何公共模块改动按共享锁回到唯一 writer 集成。

### `r13-004-spatial-chart-delivery`：世界坐标到相机导出

通过世界层的可见入口创建五类 Chart，世界位置、选中/拖动/缩放/层级与相机缩放一致；共享编辑器经 Spatial adapter 写入。图表稳定身份继续用于已支持的 path/relation，删除与复制按现有引用规则处理，不从相机屏幕坐标反写 world frame。

贯通 Spatial 作者渲染、真实 SpatialSurfaceHost、Published producer、保存重开、单 HTML 与现有静态相机页投影。固定用例覆盖不同相机缩放、图表部分出框、多图重叠的层级、复制/删除及引用清理；绘制与导出共用同一图表数据/视图。surface shared/global 继续明确不可插入。

### 共同验证与 S1 门

先用现有测试补精确反例，再做真实 Surface 操作；契约/公共共享变化才扩大到相关 consumer。对应测试入口均为现有文件，在实施时增加命名用例，不预建空测试。

- 合同：`npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/publishedCourseProtocol.test.ts tests/unit/courseProjectRoundTrip.test.ts`
- 共享编辑：`npx vitest run tests/unit/v9ChartCommands.test.ts tests/unit/v9SlideProductIntegration.test.tsx tests/unit/coursePptxExport.test.ts`
- Flow：`npx vitest run tests/unit/flowEditorCommands.test.ts tests/unit/buildPublishedCourseV2.test.ts tests/unit/flowDocxProjection.test.ts tests/unit/coursePrintArtifacts.test.ts`
- Spatial：`npx vitest run tests/unit/spatialEditorCommands.test.ts tests/unit/spatialSurfaceHost.test.ts tests/unit/coursePrintArtifacts.test.ts`
- 真实操作：`npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts`

各节点只选相关的 1–3 条命令；上述清单不是每次全跑。Chart 和下文 Table 的两个 delivery 各自全部通过后，`r13-055-recipe-closure` 才完成能力与导出收口；S1 必须用真实 Flow 正文与 Spatial 相机路径完成图表创作/重开/播放/导出。失败按首个错误回到合同、共享编辑器或对应 Surface owner，不通过隐藏入口、截图替换工程或 warning 吞错收尾。

## Table 跨 Surface 的独立执行方案（2026-09-06 补充，待实现）

### `r13-005-table-surface-contract`：沿用已有模型并固定能力差异

先读取 `FlowTableBlock` / `FlowTableCell`、`NativeTableContent`、V9/Published 容器校验、表格命令、Flow 文字草稿与 DOCX、Spatial 相机投影，再独立交付合同变更。Flow 已有正文表格，不新增 discriminator、不替换旧行列/单元格结构、不要求迁移旧工程；Spatial 扩展既有 Native Table 的 world 有效域。需要增加既有字段不能表达的样式时，只能在本节点明确 additive 可选字段、默认值和匹配 consumer，保持 `.strict()`；不把两种已有载体强制互转或复制成第二表格模型。

| 位置 | 载体与创作目标 | 保存/运行与导出目标 |
| --- | --- | --- |
| Slide scene/surface | 保留 Native Table，继续支持已有行列、单元格文字和样式编辑 | 保存恢复、Undo/Redo、Player/HTML 与原生可编辑 PPTX 表格不退化 |
| Flow 正文/嵌套 section | 沿用 FlowTableBlock；统一插入、表头/标题说明/单元格编辑、行列增删重排、块复制/移动/删除；宽度跟随正文布局 | 保留既有字符串和富文本单元格；Player/HTML 同值；DOCX 输出可编辑 Word 表格，PDF/打印保留内容和正文顺序，不用截图替代 DOCX 表格 |
| Spatial world | 既有 Native Table LayerItem；行列/单元格/样式编辑和 world frame、order、相机布局 | 作者工程保留完整可编辑数据；Player/HTML 同值；既有静态相机页保留裁切范围内的表格，明确静态导出不等于可编辑整世界 PPTX |
| Flow overlay、Spatial surface shared、global | 本次不扩域；Slide 已有 surface Table 仍保留 | 入口和非法容器诊断一致；input 有效域保持 |

明确行列 ID 唯一性、每行每列的单元格覆盖、删除最后一列等边界、复制 ID 重建、引用清理和能力差异。当前 Flow Schema 没有 Native Table 的全部样式字段；未建合同的合并/样式控制不得显示为可用或静默丢弃。合法/非法 fixture、旧 V9/Flow 归档往返、旧 reader 明确拒绝新 Spatial 域与 Published 对等接受域一并交付；在合同和相应 consumer 通过前保留现有入口限制。

### `r13-006-table-shared-authoring`：公共内容操作，Surface 持有写入

复用已有纯表格布局和行列/单元格操作，提取实际共同的编辑控件与校验；Flow 与 Native 的值转换由窄 adapter 明确处理，不能丢掉 Flow 富文本或把正文块当成 Slide 图层。Slide 先接回并验证既有能力等价，删除被替代的重复实现。各 Surface 自己解析 canonical target、revision、身份、草稿和事务；共用 UI 不能直接调用 Slide Store 写 Flow/Spatial。

同一次结构修改或完成的编辑只产生一条历史；活动合法文字草稿参与脏判定、保存前提交和恢复快照物化。取消、IME、目标切换和迟到提交沿用正式生命周期；不能依赖先点击空白区域触发 blur 才保存新值。连续样式预览需反映在当前 Surface 画布上，最终才提交一次。

### `r13-007-flow-table-delivery` 与 `r13-008-spatial-table-delivery`：完成真实作者闭环

Flow 从可见“表格”入口插入当前正文位置或嵌套 section，编辑表头、标题说明、单元格与行列结构；前文插入、长文本换行、宽表、移动/复制后仍按稿纸排版。复制重建 block、row、column ID 并更新 cell key，删除按既有引用规则处理。保存和恢复必须收集当前单元格草稿，重开后行列、文字、富文本和顺序一致；验证连续 DOCX 中仍可编辑单元格及表格前后正文，PDF/打印无遗漏。

Spatial 从世界层入口插入 Table，经同一 Native 表格编辑能力修改，选择/拖动/缩放/层级与不同相机缩放一致。覆盖部分出框、表格重叠、复制/删除、引用清理与 Undo/Redo；保存、恢复、重开、真实 Spatial host 和单 HTML 保留内容、样式及 world 几何，相机静态输出不丢表格。

两路交付完成后，同步现有 Builder Facade、能力索引和诊断；1.4 的 Flow/Spatial tools 分别显式依赖对应 Table delivery，避免工具仍按旧范围遗漏表格。不能以只有 Schema 或插入按钮来宣称完成。

### 聚焦验证与 S1 验收

按待证属性选择已有文件中的相关用例：合同使用 `courseProjectCoreContract.test.ts`、`publishedCourseProtocol.test.ts`、`courseProjectRoundTrip.test.ts`；共享编辑使用 `v9TableCommands.test.ts`、`nativeTableLayout.test.ts`、`courseDraftPersistence.test.ts`；Flow 使用 `flowEditorCommands.test.ts`、`flowDocxProjection.test.ts`、`coursePrintArtifacts.test.ts`；Spatial 使用 `spatialEditorCommands.test.ts`、`spatialSurfaceHost.test.ts`、`coursePrintArtifacts.test.ts`（均位于 `tests/unit/`）。真实交互在现有 `tests/e2e/stabilizationCoreUsability.spec.ts`、`tests/e2e/stabilizationFlowAuthoring.spec.ts`、`tests/e2e/stabilizationOwnershipController.spec.ts` 增加对应路径，实施时补具体用例，不预建空测试。

S1 固定课例必须实际在三种模式各插入、修改、撤销/重做一张表格；单元格仍有焦点时保存并重开，以及从恢复快照恢复；再运行 Player/HTML，并检查 Slide 可编辑 PPTX、Flow 可编辑 DOCX、Spatial 静态相机页。发现未提交草稿丢失属于作者数据缺陷，不能解释成“组件局部状态所以无需保存”。

## 2026-09-06 Review 问题全量收尾（均待修复）

下表的 F1–F4 对应 `8ad3b6a..ff65aff` 的 1.3 review，F5 是用户追问后补查确认的既有 Component 缺陷。它们按修复任务而非原功能已合并状态收口；四个修复节点全部是 `r13-055-recipe-closure` 的必选前置，继而阻断未完成时的 S1 accepted。新增 Table 的四个交付节点是另一组必选范围，不能替代 review 修复。

| Review | 已确认问题 | 修复节点 | 验收反例 |
| --- | --- | --- | --- |
| F1 · P1 | Flow/Spatial Chart 画布文字草稿漏存、漏恢复 | `r13-009-authoring-draft-persistence` | 工程基线已保存，输入新分类仍保持焦点；dirty、正式保存准备的归档重开及恢复快照都必须包含新值 |
| F2 · P2 | 克隆误改其他场景的 targetStateId | `r13-051-review-clone-references` | 来源和目标场景都使用 initial，克隆后外部 scene.go 仍指向目标场景的 initial；副本内引用另行重建 |
| F3 · P2 | scene.enter 的零延迟 scene.next 被导航队列拒绝 | `r13-052-review-scene-enter-navigation` | 两场景真实 Published 会话挂载后，首场景的入场导航进入第二场景，不停留原页或产生 navigation-failed |
| F4 · P2 | Flow 图表调色时 HEX 变化而画布不预览 | `r13-053-review-flow-chart-preview` | 拖动中 HEX 与 SVG 色值同步，工程仍是旧色；松手一次提交，取消和切目标不误写 |
| F5 · P1（既有缺陷） | Component 画布文字活动草稿漏脏判定、保存准备和恢复 | `r13-009-authoring-draft-persistence` | 保持组件文字焦点时覆盖正式保存准备与恢复；同时保全已正常的属性、Enter 提交及正式应用源码的持久化 |

### F2：引用重建必须带所属场景

`src/renderer/authoring/productivity/referenceClone.ts` 当前按字符串全局 remap，导致合法同名状态被当成副本内部身份。修复按引用类型和 owner/scene 解析身份；分别覆盖指向副本内部、来源页自身及外部场景的引用，不仅绕过 initial 特例。源工程、副本工程均 strict 可解析，健康检查无 interaction-state-reference-missing；真实 Player 跳转、归档重开、克隆 Undo/Redo 保持正确。聚焦现有 `tests/unit/designProductionIntegration.test.ts` 和 `tests/unit/courseProjectHealth.test.ts`，补入这个同名状态反例。

### F3：入场事件与导航完成时序一致

`src/player/surfaces/publishedDynamicHosts.ts` 在导航 onNavigate 内调用 enterScene 时，当前导航仍被计为 pending；合法零延迟动作因此遭拒。修复应明确导航完成与入场分发边界，不能关掉导航保护或用任意延时碰运气。用真实 Published 会话检查首次入场、后续导航、局部/global 入场触发与销毁/失败边界，并保留循环/重复导航防护。聚焦 `tests/unit/publishedCourseNavigation.test.ts` 与 `tests/integration/publishedInteractionSlideHostIntegration.test.ts`；仅单测 controller 回调成功不足以证明队列时序正确，S1 检查 Player/单 HTML 同一入口。

### F4：Flow 正文预览由 Flow adapter 持有

`src/renderer/ui/properties/FlowPropertiesPanel.tsx` 给正文 Chart 使用要求 Native LayerItem 选区的 previewSelectedNative，而 `FlowWorkspace.tsx` 只消费 canonical block.chart。将临时 Chart 预览按 Flow block 身份与生命周期接入正文渲染，复用共享颜色控件，保留最终提交和预览分离。聚焦现有 `tests/unit/crossSurfaceChartDelivery.test.tsx` 与 `tests/unit/colorInputHistory.test.tsx`；真实连续鼠标拖动需检查 SVG 的中间色，而不是只看 HEX 或松手后的最终色。目标切换/stale/取消清除临时值，不污染别的块或增加历史。

## `r13-009-authoring-draft-persistence`：作者文字草稿补漏（已实现）

2026-09-06 复现：Flow Chart 的 `EditableChartView` 与 Slide Component 的 `CanvasPlainTextEditor` 在画布输入新文字、保持焦点时，脏状态仍为 false；正式保存 preparation 经归档 writer/reader 重开和恢复快照均保留旧值。Component 按 Enter 提交后，归档/恢复与 Undo/Redo 均保留新值；组件属性面板直接修改文字、正式应用可编辑副本源码后也能归档重开与恢复。Component 问题在 1.3 diff 之前已存在，本次因用户追问补查确认，不能归为本版新引入，也不能被“组件修改本来就不保存”的解释掩盖。

将这两个画布入口接入现有、由 Surface 持有的正式内容草稿，复用唯一 dirty、保存前提交与恢复物化流程。不要另建遍历 DOM 输入框的保存机制、第二作者 Store 或仅补某个快捷键；Component 控件虽已监听 Ctrl+S 提交，也必须覆盖不经过该键盘事件的保存入口和自动恢复。共享 `CanvasPlainTextEditor` 的 Native/Runtime consumer 按实际受影响路径补证据，不把仅执行 Enter/blur 的测试当成活动草稿保存证明。

验收用例覆盖：工程基线已保存；通过真实画布输入；保持焦点调用正式保存与恢复；归档重开检查新值；恢复快照不改变活跃历史，保存只提交一次；取消与 IME/stale 保留现有正确语义。聚焦 `tests/unit/courseDraftPersistence.test.ts`、`tests/unit/componentTextEditSession.test.ts` 及已有 Chart 测试，真实 Component 入口复用 `tests/e2e/editor.spec.ts` 的组件导入/文字编辑路径，Chart 复用 Flow/Spatial 稳定性用例。保留已验证的属性和代码提交路径，S1 必须覆盖 Component 活动文字草稿，不只覆盖表格/图表。

## 1.3 项目色板与 Token 范围应用

`r13-041-token-apply` 复用 1.2 的同一个颜色控件及工程已有 `designTokens.colors`，展示项目色名/值并提供明确范围的批量配色预览。固定常用色仍可直接选；项目色修改、范围应用和取消各有明确事务语义，不另外维护 theme/color registry。

当前对象颜色字段保存实际色值，没有自动 token 引用关系。因此本版明确交付“选择项目色 + 预览指定范围并一次应用”的联动方式；修改 Token 本身不偷偷改写所有同色对象，不把旧颜色相同当成绑定证据。范围应用显示 old/new、target、owner、无法应用项并原子提交，stale 零写入、一次 Undo 恢复。若后续要求持续自动跟随 Token，则先另立引用与解析合同，不能在本节点暗加绑定语义。

## 接口与数据合同

- Recipe 标识固定为 `cover-v1`、`concept-v1`、`worked-example-v1`、`step-reveal-v1`、`choice-feedback-v1`、`classify-sort-v1`；执行结果是一组现有 V9 命令和普通 Native / 声明式交互内容。
- 分类用“选中项目→选中目标组”的声明式路径；排序的可见重排使用当前 Component 载体，并把项目、正确顺序和反馈公开为可编辑参数。本轮不扩充拖放/放置触发器或顺序动作，也不要求先完成通用组件化。
- Component 的作者内容、参数及正式应用的包源码/资源变更属于工程数据，必须可编辑、可 Undo/Redo、可保存/恢复/重开，并被 Player/HTML 使用；采用 Component 实现不是持久化例外。React 编辑控件的局部文字草稿必须接入正式作者生命周期，合法活动草稿不能因未 blur 而被保存或恢复遗漏。播放中的临时交互会话不自动写回作者工程，不能据此排除教师的作者修改。
- Recipe 输入包含明确 target、槽位值、设计 token 引用和 revision 前提；执行回执包含创建对象身份、诊断与新 revision。Recipe 名称不进入 Player 必需状态。
- 参考页克隆必须重映射对象、交互和资源引用身份；批量替换与 Token 应用必须先产生可审核 preview，再按 preview revision 原子提交。
- 容量结果固定为成功、建议换档、建议拆页或建议 Flow 四类；自动缩字不得越过现有字体可读性下限。
- 快速诊断只读权威工程并返回可定位 target；不维护第二份健康状态。
- 若现有声明式层或当前 Component 载体不能表达某配方的验收结果，停止该节点并先建立独立追加合同任务；不得在配方实现中私藏状态、放宽 Schema 或把排序降级成分类。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npx vitest run tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts
npx vitest run tests/unit/designTokens.test.tsx tests/unit/assessmentEvaluators.test.ts tests/unit/courseProjectHealth.test.ts
npx vitest run tests/unit/courseProjectRoundTrip.test.ts tests/unit/v9SlideContentCommands.test.ts
npx playwright test tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线的统一验证与发布门。视觉、容量与互动结果必须在固定课例中由 Owner 实际观察。
