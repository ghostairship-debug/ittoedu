# GUI / Gateway 编辑决策只读调查

日期：2026-10-25。范围为 PLAN R5 / 原提示词任务 I 的 `text.format`、`text.replace`、`object.update`、`object.layout`。仅调查，不迁移、不改产品/测试、不改变本批已确认的 UI、模式或操作路径。结论依据当前候选源码和一份纯内存演算，不将历史长函数、同名代码或相似字符串视为缺陷。

**确认 2 项同一类外观语义分歧，均在 `object.update.appearance` 与 GUI 整对象外观之间。** 其余三类本次没有确认应迁移的重复且不一致业务决定。以下不是全面无缺陷声明，也没有证明这两项由本次架构批次首次引入。

## 1. 独立公式：修改默认外观不能覆盖已有公式自身外观

**用户结果：** 一个公式已有 `formula.style={fontSize:42,color:'#123456'}`。GUI 将字号和颜色设为 60 / `#abcdef` 后，公式实际显示新值；Gateway 使用同一整对象 `object.update({appearance:{fontSize:60,color:'#abcdef'}})` 后，默认 appearance 虽改变，实际公式仍显示 42 / `#123456`。

| 路径 | 实际决定与证据 |
|---|---|
| GUI 专业属性 / 整对象快捷格式 | [componentProperties.ts:217](../../../src/renderer/ui/properties/componentProperties.ts#L217) 对已有 `formula.style.fontSize/color` 的字段直接写 `formula.style`；没有覆盖时才写 `appearance` |
| GUI 直接消费者 | [usePropertiesAuthoringBinding.tsx:169](../../../src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx#L169) 的 `patch` 调 `componentPropertiesEdits`，`submit` 在 138—141 行交 `componentDataEdits` 后由 Kernel 正式写入；Flow 属性同样委托此 properties owner |
| Gateway | [DocumentToolGateway.ts:3031](../../../src/core/tools/DocumentToolGateway.ts#L3031) → [courseInstanceEdits.ts:85](../../../src/core/tools/courseInstanceEdits.ts#L85) → [componentAppearanceEdits.ts:16](../../../src/core/course/componentAppearanceEdits.ts#L16)，将文字 / 公式外观统一写入 `data.appearance`，不处理已有 `formula.style` |
| 最终显示 owner | [render.ts:61](../../../src/components/text/render.ts#L61) 的 `formulaComponentHtml` 明确使用 `{...data.appearance,...data.formula.style}`，后者覆盖前者 |

**当前 owner：** 专业公式的有效外观规则分别存在 GUI `componentPropertiesEdits` 和 core `componentAppearanceEdits`；Gateway 负责句柄/授权/事务适配，渲染器负责消费有效值，不应在渲染器另加补偿规则。

**后续建议：** 优先明确 `appearance` 对既有覆盖值的含义，再让 core 专业外观 owner 准备相同的有效字段编辑，GUI 和 Gateway 分别保留自身选区/授权/ACK 包装。若沿 GUI 现有“修改整个公式实际外观”的结果，需同时覆盖该字段的既有 `formula.style`；不要改公式正文、formulaId 或别的格式字段。调查不自动选择新产品语义，也不实施修改。

## 2. 整个文字对象：已有片段格式会遮蔽 Gateway 的外观修改

**用户结果：** 文字对象里有一个片段显式设置 42 / `#123456`，其余文字继承默认。GUI 对整个对象设为 60 / `#abcdef` 后，两部分均显示新值；Gateway 的同字段 `appearance` 修改只影响继承默认的文字，原片段继续显示旧值。

| 路径 | 实际决定与证据 |
|---|---|
| GUI 整对象格式 | [componentProperties.ts:188](../../../src/renderer/ui/properties/componentProperties.ts#L188) 先写 `appearance`，192—202 行再对已经显式设置同字段的 inline style 写新值；不动其他片段字段、链接、公式或身份 |
| GUI 直接消费者 | `usePropertiesAuthoringBinding.patch`（169—172 行）；[TextFormatActions.tsx:24](../../../src/renderer/editing/quickbar/TextFormatActions.tsx#L24) 把“全文”格式操作发给同一 properties patch。轻量字体/行距命令也复用 `componentPropertiesEdits` |
| Gateway | `object.update` → `courseInstancePropertyEdits` → [componentAppearanceEdits.ts:25](../../../src/core/course/componentAppearanceEdits.ts#L25)，经 `componentDataEdits({kind:'patch',data:{appearance:fields}})` 只准备默认外观字段，无同字段 inline 编辑 |
| 最终显示 owner | [render.ts:50](../../../src/components/text/render.ts#L50) 保留 inline 显式值的优先级，`textComponentHtml` 再由正式 `renderDocumentText` 渲染；该消费规则不会替 Gateway 覆盖已有片段样式 |

**当前 owner / 后续建议：** 与第 1 项相同，属于专业外观计划的分歧，应一起核对、分项保留结果证据。不要通过清除所有 inline style 来统一效果；只涉及本次明确提供的字段，范围外样式与链接等必须保留。`text.format` 的局部范围与 `object.update.appearance` 的整对象含义仍需区分，不能混成一个无范围命令。

## 3. 两项演算证据及边界

运行一次 `node --import tsx --input-type=module -e <纯内存演算>`，构造合法空工程、一个专业文字对象和一个专业公式对象；分别调用真实 GUI `componentPropertiesEdits` 与真实 Gateway `courseInstancePropertyEdits`，再经同一 `captureComponentOperation` / `applyComponentOperation`，最后调用正式 HTML 输出函数。没有创建/保存作品，没有文件写入，也没有新增测试。

| 对象 | GUI 准备的路径 | Gateway 准备的路径 | 正式 HTML 是否仍含旧颜色 `#123456` |
|---|---|---|---|
| 文字 | `appearance.color/fontSize` 与已有 `content.inlines[0].style.color/fontSize` | 仅 `appearance.color/fontSize` | GUI 否，Gateway 是 |
| 公式 | 已有 `formula.style.color/fontSize` | 仅 `appearance.color/fontSize` | GUI 否，Gateway 是 |

文字内容、公式 LaTeX 和身份均未改。该证据证明真实 planner 与正式 operation / renderer 的结果差异；未声称本轮另做了完整 GUI 点击、Gateway 传输、保存/冷开或视觉签收。原有 [componentPlatformProperties.test.tsx:462](../../../tests/unit/componentPlatformProperties.test.tsx#L462) 也明确覆盖 GUI 保留公式身份及改变既有公式外观，此次只读取其断言，未因文档调查重跑。

## 4. 其余三类与不应误报的差异

| 类别 | 已核当前 owner / 直接消费者 | 调查结论 |
|---|---|---|
| `text.format` | Gateway [ToolTargets.ts:697](../../../src/core/tools/ToolTargets.ts#L697) → [textFormatting.ts:12](../../../src/core/tools/textFormatting.ts#L12) → `formatTextComponentRange`；Markdown 源范围由 `formatMarkdownSource` 做映射。GUI [SharedDocumentEditor.tsx:1101](../../../src/renderer/document/SharedDocumentEditor.tsx#L1101) 更新 PM mark，再由 [documentAdapter.ts:19](../../../src/renderer/document/documentAdapter.ts#L19) / `readInlines` 回成同一正式文档内容；数学只持久化字号/颜色 | 表示适配各有职责；没有确认应迁移的结果分歧 |
| `text.format` 的空光标 / 源范围 | GUI 空光标设置 PM stored mark，影响随后输入；Gateway 针对已捕获字段/可格式化正文范围，不承担编辑器临时 stored mark | 未确认相同输入产生不同持久化结果。GUI 光标、effective style 与 Gateway 授权句柄/源范围适配是不同职责，不据代码分处两处提出整批迁移 |
| `text.replace` | Gateway [ToolTargets.ts:655](../../../src/core/tools/ToolTargets.ts#L655) 定位原字段，保留范围外内容并使用 `replaceDocumentText`；GUI/Flow 经 `projectDocumentRanges` / `componentDataEdits` / `remapDocumentRanges` 保持正式范围身份，专业文本替换底层也用 `replaceDocumentText` | 未确认新的重复业务分歧。交互输入法草稿、PM typing mark、源文范围映射、AI HTML 表示和权限收敛不能因“都改文字”被当成重复 writer |
| `object.layout` 对齐 / 等距 | GUI [crossSurfaceCommands.ts:228](../../../src/renderer/composition/crossSurfaceCommands.ts#L228) 与 Gateway [DocumentToolGateway.ts:2654](../../../src/core/tools/DocumentToolGateway.ts#L2654) 都调用 `courseGeometryEdits` | 当前核心算法已共享。GUI `mixedGlobalGeometry` 提供真实视口/HUD 投影再调用同算法；Gateway 同页、同状态、整对象及写入权限检查属于协议边界，不算重复对齐算法 |
| `object.layout` Flow 分栏 | GUI [FlowWorkspace.tsx:730](../../../src/renderer/ui/FlowWorkspace.tsx#L730) 与 Gateway [DocumentToolGateway.ts:2650](../../../src/core/tools/DocumentToolGateway.ts#L2650) 都调用 `prepareCourseFlowColumns` | 已共享正式结构计划；GUI 排空输入和更新选中，Gateway 校验授权及句柄到 instanceId 的映射，不是两个分栏业务 owner |

同样未将“`courseInstancePropertyEdits` 只先检查实例自身 locked，而 GUI 常用 `componentIsLocked`”列为越权缺陷：正式 [courseV10Operations.ts:846](../../../src/core/drivers/courseV10Operations.ts#L846) 在实际写入前仍执行包含继承锁的 `requireUnlocked`。忽略最终 operation owner 会造成误报。

## 5. 建议顺序

1. 先处理已有 `formula.style` 遮蔽整对象外观的用户结果问题，再处理文字显式片段同字段覆盖；两项可在同一专业外观 owner 的一批工作内解决，分别验收。它们的依据是实际结果差异，不是函数长度。
2. 专业外观结果统一后，按真实维护需要考虑 GUI 属性 patch 与 Gateway 属性适配的剩余机械映射；当前 rotation 矩阵计算相似但未确认结果不一致，不以去重本身启动修改。
3. 本次不给 `text.format`、`text.replace`、`object.layout` 安排迁移。若以后有同一目标/意图的实际结果差异，再从直接 owner 处理；不把授权、选择、输入生命周期和协议校验迁成新的编辑平台。

这两项调查结果留给后续方案，不包含在本轮已实施修复内；没有借此调整 UI、模式、默认动作、测试预期或发布状态。
