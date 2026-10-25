# AI修改字号／颜色被已有格式遮蔽：定位与修复方案

日期：2026-10-25。**仅定位与方案，未实施。** 本次按Owner要求核对Root `D:\果铃工作台` 的GUI、core、Gateway、读取、渲染及直接消费者；没有修改产品／测试，没有调用模型、重跑全仓或改用户作品。复用[上一轮只读调查](../20261024-regression-boundary-repair/OWNERSHIP_INVESTIGATION.md)的真实planner／operation／renderer演算，当前直接源码仍与该结果一致，不重复演算或把旧证据说成本次新验收。

## 1. 结论与具体触发

确认同一类用户可见结果错误：**高层`object.update.properties.appearance`只修改默认值，而已有同字段格式优先显示；人工整对象格式会处理这些覆盖值。** AI可得到成功回执，但目标文字部分不变，或独立公式完全不变。它不是整份工程不可用，也不能由“模型已经调用成功”判断视觉目标达成。

| 对象／触发 | 当前人工整对象操作 | 当前Gateway操作及用户影响 |
|---|---|---|
| 独立公式已有`formula.style={fontSize:42,color:'#123456'}`；要求整公式改60／`#abcdef` | GUI识别有效字段，修改已有`formula.style`，实际显示60／新色 | `object.update({target:整对象, properties:{appearance:{fontSize:60,color:'#abcdef'}}})`只改默认`appearance`，renderer仍由`formula.style`显示42／旧色 |
| 文字对象部分inline显式42／`#123456`，其余继承默认；要求整个对象改60／新色 | GUI修改默认值，并仅覆盖inline中已经显式提供的同字段，其他格式保留 | Gateway只改默认值：继承部分变化，显式部分仍旧；产生同一对象内大小／颜色不统一的可见结果 |
| 默认颜色本来已等于请求色，但inline覆盖仍是旧色 | GUI仍可纠正覆盖字段 | 当前默认patch可能判为无变化，不能据此认为整对象的实际外观已经符合意图 |

旧演算已证明实际GUI与Gateway规划在相同正式operation／HTML renderer下的差异，不只是函数名或字符串不同。该演算没有完整Gateway传输、实际AI任务、保存冷开或全GUI证据，本方案也不冒称已有这些验收。

## 2. 必须先锁定的同意图语义

当前公开合同更支持“实际外观”，没有找到把高层`appearance`明确限定为“只改默认值”的依据：

- [toolSchemas.ts:182](../../../src/core/tools/toolSchemas.ts#L182)称其为“目标真实专业外观的局部参数”，只应用提供字段、保留正文／位置／省略参数；[ToolCatalog.ts:59](../../../src/core/tools/ToolCatalog.ts#L59)称`object.update`修改授权整对象专业外观，文字范围另用`text.format`。
- 底层`data.appearance`确实是默认外观载体，renderer保留显式inline／formula样式优先级。这不自动证明高层语义字段也只能改默认值。

**建议实施口径：获授权整对象的高层`appearance.fontSize/color`表达“将此对象实际字号／颜色设为给定值”，与现有GUI同意图结果一致；`properties.data.appearance`仍是高级数据路径的默认值修改，保留其现有字面语义。** 局部`text.format`仍只作用冻结的文字范围，不扩大授权或修改对象默认。

这是实施前需要明确采纳的语义口径，本文没有用实现替Owner确认。若Owner／正式API约定另要求高层`appearance`也只修改默认值，应保留其旧行为，并在现有专业语义owner内区分“默认值”与“整对象实际格式”的请求映射／说明；不能偷偷改旧API、改GUI或换renderer优先级来让示例变绿，也不因此新建通用样式平台。本批先处理字号／颜色，不顺带改变粗体、字号步进、其他专业类型或所有外观字段的含义。

## 3. 当前owner和真实断点

| 链路 | 当前事实及准确位置 | 修复职责边界 |
|---|---|---|
| GUI读取 | [componentProperties.ts:81](../../../src/renderer/ui/properties/componentProperties.ts#L81)；公式在118—119行读取`formula.style ?? appearance`；[TextFormatActions.tsx:11](../../../src/renderer/editing/quickbar/TextFormatActions.tsx#L11)解析文字runs与默认值的实际／mixed状态 | 保留现有专业属性与混合格式显示，不新增一套UI读取逻辑 |
| GUI整对象写入 | [componentPropertiesEdits:163](../../../src/renderer/ui/properties/componentProperties.ts#L163)，188—202行文字默认＋已有inline同字段；217—223行公式已有覆盖字段优先 | 这是现有人工作用结果的依据；保留相对`fontSizeStep`逐片段步进，不偷换成绝对设置 |
| GUI直接消费者 | [usePropertiesAuthoringBinding.tsx:169](../../../src/renderer/composition/properties/usePropertiesAuthoringBinding.tsx#L169)的patch→componentPropertiesEdits，138—141行统一进componentDataEdits／Kernel；[TextFormatActions.tsx:28](../../../src/renderer/editing/quickbar/TextFormatActions.tsx#L28)的“全文”调用同一patch；[FlowPropertiesContextBuilder.ts:73](../../../src/renderer/ui/properties/FlowPropertiesContextBuilder.ts#L73)继续委托它 | 选区、预览、输入ACK、捕获、状态与History包装保留在原owner，不迁到Gateway或新协调层 |
| Gateway属性写入 | [DocumentToolGateway.ts:3031](../../../src/core/tools/DocumentToolGateway.ts#L3031)→[courseInstancePropertyEdits:52](../../../src/core/tools/courseInstanceEdits.ts#L52)→[courseInstanceAppearanceEdits:45](../../../src/core/tools/courseInstanceEdits.ts#L45) | Gateway保授权句柄、目标／展示状态、显式字段／来源合并及事务适配 |
| core专业外观 | [componentAppearanceEdits.ts:10](../../../src/core/course/componentAppearanceEdits.ts#L10)，16—26行文字／公式只准备`data.appearance`patch；与GUI有效字段选择不同 | 在此现有专业外观owner收敛同意图字段计划，不能在最终writer或renderer补偿 |
| 默认数据patch | [componentDataEdits.ts:82](../../../src/core/course/componentDataEdits.ts#L82)按实际字段、当前展示状态、关系映射准备正式data.set | 保留其默认值／局部数据字面合同；不得全局拦截每次appearance数据写入并重写正文 |
| 整对象／内容读取 | [ToolTargets.ts:762](../../../src/core/tools/ToolTargets.ts#L762)的readTarget是精确数据投影，809行readSemanticTarget偏正文内容；[Gateway:3292](../../../src/core/tools/DocumentToolGateway.ts#L3292)按`detail:'object'`选择完整读取 | 完整读取包含默认及覆盖字段；普通正文read并不是“最终格式已正确”的证据。不要改变精确readTarget的CAS／footprint语义 |
| 外观复制读取 | [readCourseInstanceAppearance:20](../../../src/core/tools/courseInstanceEdits.ts#L20)当前只读`data.appearance`；[resolvedObjectProperties:1438](../../../src/core/tools/DocumentToolGateway.ts#L1438)保来源只读授权并合并显式字段优先 | 公式已有style时，复制“颜色／字号”也可能拿到默认而非可见值；必须单列语义，不默默扩大读取或随意取混合文字第一片段 |
| 最终显示 | [render.ts:50](../../../src/components/text/render.ts#L50)保留inline样式优先；60行文字HTML、61—63行公式以`{...appearance,...formula.style}`合并；[adapters.ts:23](../../../src/components/text/adapters.ts#L23)／30行专业适配调用这些正式renderer | 现有显示优先级正确，保留它；不能用强制CSS压掉人工局部格式 |
| 预告写入范围 | [Gateway:983](../../../src/core/tools/DocumentToolGateway.ts#L983)的effectWriteScopes已调用外观planner求字段；实际写入另经3031行属性计划 | 增加inline／formula叶子后，预告范围必须与同次实际计划一致，不能漏报或把范围扩大成整工程 |

`courseInstanceContext`在[ToolTargets.ts:437](../../../src/core/tools/ToolTargets.ts#L437)按捕获的surface/state解析有效实例，最终[courseV10Operations.ts:846](../../../src/core/drivers/courseV10Operations.ts#L846)仍核继承锁。不能只看到某个适配层先核自身locked就误报或重写权限。

## 4. 拟定实施方式（尚未执行）

1. **先固定第2节口径，再改现有core语义owner。** 在`componentAppearanceEdits.ts`内抽出／复用小型纯字段规划，供Gateway高层appearance和GUI的同意图绝对字号／颜色操作共用。输入是已解析专业实例、明确提供字段；输出仍是普通正式字段edit，不创建样式store、writer、History、额外工程或兼容层。GUI不要为调用planner伪造一个工程。
2. **文字按现有GUI规则选择实际字段。** 对明确给出的fontSize／color设置默认值，同时更新已有inline.style中的该同字段；不清空style、不替换完整content数组，不给没有该覆盖的片段补全部格式。已有数学inline只处理其真实支持的字号／颜色，保留公式及范围身份。
3. **独立公式沿现有GUI有效字段选择。** 某字段已有`formula.style[field]`时写该字段；没有覆盖时写`appearance[field]`。不额外改LaTeX、formulaId、accessibleText，也不为了数据看起来一致强行重写默认值。省略颜色时不得连颜色一起改，反之亦然。
4. **保留底层默认值与其他类型。** `properties.data.appearance`、文字范围`text.format`、frame／sizing、阴影`style.textShadow`、图形／表格／图表／图片等继续现有路径。本批不把同名appearance全部转换为全文覆盖，不改共享renderer的优先级。
5. **处理真实组合属性顺序。** `courseInstancePropertyEdits`当前先准备`properties.data`，再用原模型准备appearance。新增inline叶子时，同一次合法data／content＋appearance必须基于数据计划后的有效中间结果计算，不能向旧inline索引写入；复用现有计划／operation机制并保持一事务，不新增拒绝门限制原合法调用。effectWriteScopes按同次实际计划提供准确字段，不另保一套旧索引规则。
6. **读取与复制单列。** 若采纳高层“实际外观”口径，公式外观复制的字号／颜色应从相同有效字段读取，显式请求值仍覆盖来源；只读来源、捕获版本与范围授权不变。混合文字没有单一可见字号／颜色，当前来源helper返回默认值；要继续复制默认值、诊断混合，还是提供别的表达，需在现有API语义owner明确，**本方案不偷偷选第一片段、不自动清格式或新增公共mode**。直接指定字号／颜色的目标修复可先完成，该混合来源能力不能冒称同批已解决。

### 必须保留的字段和事实

| 范围 | 保留项 |
|---|---|
| 同对象未提供的格式 | 仅改请求中的fontSize／color；italic、bold显式false、underline、highlightColor、fontFamily、baseline、code等其他style字段不变 |
| 文字与身份 | 原文字／Unicode、inline顺序、link.href／title、rangeIds、数学inline类型／formulaId／LaTeX／accessibleText、附件及引用目标不变；只改同字段覆盖 |
| 空间与结构 | frame、flowLayout、sizing、位置尺寸、父子／读序、definition及implementation、邻对象、未捕获展示状态不变 |
| 局部授权 | 范围句柄仍不能调用整对象更新；局部text.format范围外文字／格式、对象默认及其他公式不变 |
| 生命周期 | 原冻结目标、lease／CAS、继承锁、预览／输入ACK与DocumentSession最终写入、一操作一次History、Undo／Redo、保存重开继续由原owner负责 |

“整对象”格式没有选区外正文，但必须保留未提供的格式字段和邻对象；只有局部`text.format`才按真实范围核范围外保留，不能混淆二者。

## 5. 最小充分验收

复用现有fixture和有效证据，从能直接证明失败的检查开始；不跑全仓或所有Surface／出口矩阵，不用只断言`appearance`数值替代实际显示。

| 属性 | 最小实际检查与成功条件 | 现有直接位置 |
|---|---|---|
| 高层AI工具真实链路 | 通过真实DocumentToolGateway、actor=agent、已观察授权整对象handle执行公开`object.update`，不要仅调内部helper；公式42／旧色改60／新色，实际有效读取与正式renderer一致 | 扩展[tests/integration/g20TextFormatting.test.ts](../../../tests/integration/g20TextFormatting.test.ts)，复用registry／Session／driver；无需收费模型 |
| 文字显式覆盖与省略字段 | 默认＋显式片段＋数学inline混合；分别只改颜色、只改字号。请求字段全部显示新值；未请求字段、link、rangeIds、公式身份及邻对象原样。补“默认已是请求值，覆盖仍旧”的真实no-op陷阱 | 同一fixture内小表驱动，不另建平台 |
| 同次data＋appearance | 一个合法已有content替换与appearance同次请求，确认按新内容计算字段、不写旧索引、不丢其他格式，预告写入范围对应实际计划 | 同一Gateway文件的一个组合例即可 |
| GUI等价及没有UI扩改 | 用同一专业对象分别经原GUI绝对字号／颜色与Gateway执行，实际显示效果相同；原光标／范围、控件名称、默认动作不变 | 复用[componentPlatformProperties.test.tsx:462](../../../tests/unit/componentPlatformProperties.test.tsx#L462)现有公式保护，补最少混合片段检查；不改测试把既有人工行为合理化 |
| 权限／state边界 | 复用现有范围不扩权断言；本批若真实计划命中state／锁定处理，增加一个捕获展示状态下的同字段修改，基础及邻状态不变；已有禁止整对象更新的范围句柄仍零写入 | g20TextFormatting已有`cannot-widen`，复用正式最终CAS／继承锁 |
| History与保存重开 | 真实Gateway一次操作产生一个History条目；Undo整实例恢复、Redo恢复目标结果；GLX保存后由新DocumentHostService冷开，data／身份／frame／关系及显示格式仍正确 | 复用[g20TextFormatting保存／Undo](../../../tests/integration/g20TextFormatting.test.ts#L45)与[nativeInsertAppearance正式冷开装配](../../../tests/integration/nativeInsertAppearance.test.ts#L63)，不只内存序列化 |
| 当前可见结果 | 在一个实际受支持编辑载体挂载共享正式renderer，确认混合文字和公式显示的新字号／颜色，范围外格式和邻对象仍在；足够时一张实际截图／DOM有效样式与正式模型同时核对 | 一份代表性Slide或Flow装配即可，不声称全载体已验 |
| 直接消费者 | `componentAppearanceEdits`被[courseElementInsertPlan.ts:58](../../../src/core/course/courseElementInsertPlan.ts#L58)用于插入；若改变公用planner，复用原nativeInsertAppearance，核显式初始appearance及同次History不回退。初始富文本局部style与高层appearance同字段冲突按第2节口径明确，不暗改优先级 | 仅受影响完整文件及必要增量，最低充分检查过后停止 |

上述是验收计划，不是已通过清单。本次没有新增或执行这些测试。实现完成后对实际语义／字段计划、授权范围和保留断言集中独审一次；类型检查只随实际代码改动按仓库要求执行，不能用它替代Gateway／GUI／保存结果。

## 6. 顺序与实施边界

建议先收敛独立公式的有效字号／颜色，再收敛文字已有同字段覆盖，两项使用同一既有专业owner并分别验收；读复制边界独立列清，不混入通用去重工程。若第2节仍未确定，不实施语义变更；可以继续其他已授权、无依赖的修复。

本文件交付后，仍不因此授权产品／测试写入、commit、push或发布。当前只完成定位和可执行方案；未把API默认值含义、混合来源复制或真实AI效果擅自定为已解决。
