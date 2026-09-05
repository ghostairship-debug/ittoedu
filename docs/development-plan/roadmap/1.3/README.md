# 1.3：Recipe 与设计生产力

## 结果与边界

教师可以用高频页面 / 互动 Recipe 快速得到普通、可继续编辑的 V9 内容，并能复用参考页骨架、批量替换内容、应用 Design Token 和快速定位问题。Recipe 只是一组产品命令，不成为第二套 DSL，不保留隐藏运行时；容量不足时换档、拆页或切换 Flow，不默认无限缩小文字。

本版还必须交付五种 Chart 的 Flow/Spatial 创作闭环，以及复用项目 `designTokens.colors` 的工程色板与范围应用；这些不是 Recipe 的隐含附带工作。1.2 已负责图表/表格作者态同步修复、不中断的连续调色、固定常用色和统一图表插入入口，本版不承接未修好的 1.2 基础可用性。下面跨 Surface 载体与导出方案是待独立合同交付的开发目标，当前 reader/能力索引仍遵循已实现的 1.2 边界。

S1 Owner 验收 1.2–1.3 后发布 `v1.3.0` accepted 源码标签，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r13-000-recipe-contract` | 定义 Recipe 输入、普通 V9 展开结果、槽位与容量策略 | — | 否 | `contracts-schema`, `generated-index` | 六个 recipe ID 与版本在一个正式 registry/catalog 中固定，UI、Builder、Capability 只投影它；同一输入产生可解析的普通 V9 命令结果；展开后删除 Recipe 元数据不改变行为；超容量返回“换档/拆页/Flow”建议而不是继续缩字；禁止第二 recipe registry 或运行时 DSL |
| `r13-001-chart-surface-contract` | 固定 Chart 的 Flow/Spatial 载体、兼容与静态导出合同 | `r12-050-native-closure` | 否 | `contracts-schema` | 先独立交付 Flow 正文图表 strict 分支、Spatial world 有效域及 Published 匹配、旧 V9 可读/旧 reader 明确失败反例；数据 Schema 复用，DOCX 静态图面+可编辑数据及 Spatial 相机导出明确；Table/input/global 不扩域 |
| `r13-002-chart-shared-authoring` | 迁移共享图表属性编辑器与纯数据操作并保持 Slide 等价 | `r13-001-chart-surface-contract` | 否 | `store-slide`, `props-slide`, `props-shared`, `authoring-slide`, `workspace-shell` | 共享无 Store 属性草稿/校验和纯 chart 数据操作，Surface adapter 独占 target/history；Slide 先迁移并删除被替代公共实现，五类数据/类型/颜色/ID/保存/PPTX 等价，无第二 editor/writer |
| `r13-003-flow-chart-delivery` | 交付 Flow 正文图表的创作、保存、Player 与连续 DOCX | `r13-002-chart-shared-authoring` | 否 | `store-flow`, `authoring-flow`, `props-flow`, `published-flow`, `published-producer`, `export-docx-print` | 可见 UI 创建编辑五类正文图表，随正文增删/重排移动且宽度遵循稿纸；一次操作一笔 Flow 历史，保存重开/Player/HTML 一致；连续 DOCX/打印保留图表与数据，静态后备明示 |
| `r13-004-spatial-chart-delivery` | 交付 Spatial 世界图表的创作、相机播放与静态导出 | `r13-002-chart-shared-authoring` | 否 | `store-spatial`, `authoring-spatial`, `props-spatial`, `published-spatial`, `published-producer`, `export-docx-print` | 可见世界层入口创建编辑五类图表，拖动缩放层级与相机一致；复制/删除处理稳定引用，一次操作一笔 Spatial 历史；保存重开/Player/HTML 与现有静态相机页保留同一数据 |
| `r13-010-cover-recipe` | `cover-v1` 生成可编辑封面骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 标题、副标题、署名和视觉槽位可单独编辑；一次应用只产生一个历史事务；保存重开后无 Recipe 专用节点；在固定长短标题输入下不遮挡主操作区 |
| `r13-011-concept-recipe` | `concept-v1` 生成概念讲解骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 概念、解释、例证和视觉槽位展开为普通 V9 内容；删除 / 重排任一对象不破坏其余对象；长内容触发结构化容量建议而非字体小于现有可读下限 |
| `r13-012-worked-example-recipe` | `worked-example-v1` 生成分步例题骨架 | `r13-000-recipe-contract` | 否 | `authoring-recipe` | 题干、步骤、结论和提示均可直接编辑；步骤可增删重排并 Undo / Redo；新知识不只存在于答案反馈；保存重开和 Player 保持顺序 |
| `r13-020-step-reveal-recipe` | `step-reveal-v1` 生成声明式逐步揭示互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction` | 至少三步内容可编辑、重排并设置初始状态；Player 逐步操作顺序确定，返回起点可复现；键盘可触发；展开结果不依赖 Recipe 运行时 |
| `r13-021-choice-feedback-recipe` | `choice-feedback-v1` 生成选择与反馈互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction` | 题干、选项、正确性与反馈可编辑；选择后显示对应反馈并可重置；答案一致性诊断能定位缺答案 / 多答案配置；保存重开与 Player 一致 |
| `r13-022-classify-sort-recipe` | `classify-sort-v1` 生成分类 / 排序互动 | `r13-000-recipe-contract` | 否 | `authoring-recipe`, `authoring-interaction`, `published-dynamic` | 分类与排序参数均可编辑；分类用“选中项目→选中目标组”的声明式点击/状态路径，排序用当前 Component 载体真实重排并公开项目、正确顺序和反馈参数，不要求本节点先建设通用组件化；指针与键盘得到同一结果，错误/正确反馈与重置确定，保存重开与 Player 一致；缺组、孤立项和重复稳定 ID 被拒绝且零部分写入；不新增拖放/放置触发器或顺序动作 |
| `r13-030-reference-clone` | 从参考页复制可编辑骨架而非复制隐藏状态 | `r13-000-recipe-contract` | 否 | `store-slide`, `authoring-slide`, `workspace-shell` | 克隆后对象、资源和交互引用获得无冲突身份；修改副本不改变原页；保存重开、Player 与适用导出无悬空引用；一次克隆可整体撤销 |
| `r13-040-batch-replace` | 在明确范围内预览并批量查找替换 | `r13-000-recipe-contract` | 否 | `store-kernel`, `workspace-shell` | 可选择当前页 / Surface / 整课范围；预览逐项显示 old / new 与 target；确认后仅修改勾选项并产生一个事务；stale 预览拒绝提交；Undo 恢复全部原值 |
| `r13-041-token-apply` | 复用项目色板并将 Design Token 应用于明确对象范围 | `r13-000-recipe-contract`, `r12-040-background-authoring` | 否 | `store-kernel`, `props-shared`, `store-course` | 同一颜色控件读取既有 designTokens.colors；范围预览逐项报告 old/new/target 和属性，不支持项保留并说明；确认后只写所选范围，一次原子提交、stale 零写入、整体可撤销；保存重开和 Player 保持已应用色值与项目色板；不复制主题状态或默认为同色对象建立自动绑定 |
| `r13-050-fast-diagnostics` | 提供面向教师的快速诊断入口与可定位结果 | — | 否 | `diagnostics`, `workspace-shell` | 从可见入口启动后，结果按严重度和 Surface 分组并能跳转到对象；健康工程显示零错误；构造的悬空资源、答案不一致和容量问题分别被精确定位；诊断不改工程 |
| `r13-055-recipe-closure` | 统一收口 Recipe、跨 Surface Chart 与设计生产力的能力及导出 | `r13-010-cover-recipe`, `r13-011-concept-recipe`, `r13-012-worked-example-recipe`, `r13-020-step-reveal-recipe`, `r13-021-choice-feedback-recipe`, `r13-022-classify-sort-recipe`, `r13-030-reference-clone`, `r13-040-batch-replace`, `r13-041-token-apply`, `r13-050-fast-diagnostics`, `r13-003-flow-chart-delivery`, `r13-004-spatial-chart-delivery` | 否 | `generated-index`, `diagnostics`, `published-producer` | 能力索引精确声明六种 Recipe、四项生产力能力与已通过的 Flow/Spatial Chart；诊断定位展开后的悬空引用、答案不一致、容量及图表容器/数据/静态后备问题；Published 与适用导出对普通 V9 展开结果无静默遗漏，不含 Recipe 专用运行时节点或第二工程真相；既有基线不退化，两个 Chart delivery 均为必选前置 |
| `r13-060-release` | Owner 验收 S1 创作力并发布 v1.3.0 accepted 源码标签 | `r13-055-recipe-closure`, `r12-060-release` | 否 | `none` | Owner 在同一固定课例完成 S1 创作力验收：覆盖 1.2 的 Flow 正文及文字/图片/图形浮层、图形属性、连续 DOCX、Slide input 与 PPTX、Table、五种 Chart、Line、六 owner 背景，并检查作者态同步、连续调色、常用色和统一入口；覆盖 1.3 的六种 Recipe、分类、Component 排序、克隆、批量替换、项目色板/Token、快速诊断，以及 Flow 正文和 Spatial 世界五类 Chart；检查保存、重开、Undo/Redo、Player、单 HTML 与适用导出，晋升 1.2–1.3 已验收行为到保全矩阵，签署 accepted 后创建 `v1.3.0` 源码标签 |

并行 frontier：六个 Recipe、参考页克隆、批量替换与快速诊断可在依赖和写锁满足时并行。Chart 先经合同与共享编辑器/纯数据操作节点，再分 Flow/Spatial 两路；两路共享的插入面板、producer 与静态导出文件按锁串行集成，不重复修改公共 UI。Token 应用等待 1.2 共享颜色控件；Chart 合同等待 1.2 Native 闭合证据，均不等待整个 1.2 发布节点。S1 必须同时覆盖两路 Chart 和项目色板。

## Chart 跨 Surface 的独立执行方案

### `r13-001-chart-surface-contract`：先固定载体、兼容与导出

读取当前 V9/Published 类型与 Schema、兼容政策、NativeChartContent、FlowBlock/FlowSurfaceLayerEntry、Spatial world、Chart 数据命令、Flow DOCX 与 Spatial 静态页面导出。交付一份独立可审阅合同变更，固定以下目标；该变更落地前继续拒绝 1.2 越界内容，不能先放开按钮或放宽 `.strict()`。

| 位置 | 计划载体与作者行为 | 保存/运行与静态导出目标 |
| --- | --- | --- |
| Slide scene/surface | 保留现有 Native Chart LayerItem | 继续可编辑 PPTX chart、Player 与单 HTML，不降级 |
| Flow 正文 | 新增严格的正文图表块，持有同一 NativeChartContent，沿用 FlowBlock 稳定 ID、文档顺序及内容宽度语义；前文增删时自然移动 | V9/Published 对等解析；DOCX 按正文顺序保留静态图面及可编辑数据表/摘要，明确图面为静态后备；PDF/打印也保留正文图表 |
| Spatial world | 既有 Native Chart LayerItem，使用 world 坐标、frame、order 与相机裁切 | 工程仍保存可编辑图表数据；Player/HTML 按同一视图绘制，现有静态页面导出保留相机范围内的图表并报告位置，不宣称整世界为可编辑 PPTX |
| Flow 图表浮层、Spatial surface shared、global | 不在本次扩域 | 明确不可用并定位拒绝；Table/input 的既有有效域保持 |

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
- 真实操作：`npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts tests/e2e/stabilizationFlowAuthoring.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts`

各节点只选相关的 1–3 条命令；上述清单不是每次全跑。两个 delivery 全部通过后，`r13-055-recipe-closure` 才统一生成新能力索引、检查容器错误和静态后备；S1 必须用真实 Flow 正文与 Spatial 相机路径完成图表创作/重开/播放/导出。失败按首个错误回到合同、共享编辑器或对应 Surface owner，不通过隐藏入口、截图替换工程或 warning 吞错收尾。

## 1.3 项目色板与 Token 范围应用

`r13-041-token-apply` 复用 1.2 的同一个颜色控件及工程已有 `designTokens.colors`，展示项目色名/值并提供明确范围的批量配色预览。固定常用色仍可直接选；项目色修改、范围应用和取消各有明确事务语义，不另外维护 theme/color registry。

当前对象颜色字段保存实际色值，没有自动 token 引用关系。因此本版明确交付“选择项目色 + 预览指定范围并一次应用”的联动方式；修改 Token 本身不偷偷改写所有同色对象，不把旧颜色相同当成绑定证据。范围应用显示 old/new、target、owner、无法应用项并原子提交，stale 零写入、一次 Undo 恢复。若后续要求持续自动跟随 Token，则先另立引用与解析合同，不能在本节点暗加绑定语义。

## 接口与数据合同

- Recipe 标识固定为 `cover-v1`、`concept-v1`、`worked-example-v1`、`step-reveal-v1`、`choice-feedback-v1`、`classify-sort-v1`；执行结果是一组现有 V9 命令和普通 Native / 声明式交互内容。
- 分类用“选中项目→选中目标组”的声明式路径；排序的可见重排使用当前 Component 载体，并把项目、正确顺序和反馈公开为可编辑参数。本轮不扩充拖放/放置触发器或顺序动作，也不要求先完成通用组件化。
- Recipe 输入包含明确 target、槽位值、设计 token 引用和 revision 前提；执行回执包含创建对象身份、诊断与新 revision。Recipe 名称不进入 Player 必需状态。
- 参考页克隆必须重映射对象、交互和资源引用身份；批量替换与 Token 应用必须先产生可审核 preview，再按 preview revision 原子提交。
- 容量结果固定为成功、建议换档、建议拆页或建议 Flow 四类；自动缩字不得越过现有字体可读性下限。
- 快速诊断只读权威工程并返回可定位 target；不维护第二份健康状态。
- 若现有声明式层或当前 Component 载体不能表达某配方的验收结果，停止该节点并先建立独立追加合同任务；不得在配方实现中私藏状态、放宽 Schema 或把排序降级成分类。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npm run test:product -- tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/unit/designTokens.test.tsx tests/unit/assessmentEvaluators.test.ts tests/unit/courseProjectHealth.test.ts
npm run test:product -- tests/unit/courseProjectRoundTrip.test.ts tests/unit/v9SlideContentCommands.test.ts
npm run test:e2e -- tests/e2e/stabilizationCoreUsability.spec.ts
```

版本候选再执行总路线的统一验证与发布门。视觉、容量与互动结果必须在固定课例中由 Owner 实际观察。
