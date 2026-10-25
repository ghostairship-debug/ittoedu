# 整对象字号／颜色修复结果

日期：2026-10-25。**候选的真实 Gateway／Host 两个完整文件 16/16 通过；GUI 完整文件首轮 23 过、3 个既有失败保留。** 主会话尚需集成、综合类型检查及实际 Chromium 呈现验收；本文不把这些待办或实际模型创作说成已通过。未 commit、push、发布或自行同步回 Root。

本轮 Owner 已授权实施 [APPEARANCE_PLAN](../20261025-targeted-followup/APPEARANCE_PLAN.md) 的高层整对象实际格式口径，覆盖旧文件“仅定位／尚未实施”的阶段状态。没有新增 UI、模式或操作路径，没有改 renderer 优先级、文字范围授权、底层默认值或混合来源复制语义。

## 1. 精确集成白名单（9 个文件）

产品仅 5 个、测试仅 3 个、结果文档 1 个。候选起点叠有 Root 其他未提交成果，不应据整个 worktree 的 git status 集成。

| 文件 | 本轮变化 |
|---|---|
| [componentAppearanceEdits.ts](../../../src/core/course/componentAppearanceEdits.ts) | 原专业外观 owner 共用整对象绝对字号／颜色字段选择。文字默认＋已有同字段 inline；公式已有 style 优先，否则默认。只按原显式提供字段取校验值；默认和覆盖合为一次 componentDataEdits。 |
| [componentDataEdits.ts](../../../src/core/course/componentDataEdits.ts) | 仅将原 changedData 纯 materializer 导出为 componentDataWithFields，算法不变；原专业转换、range remap、最终验证／CAS 保留。 |
| [courseInstanceEdits.ts](../../../src/core/tools/courseInstanceEdits.ts) | 同次 data＋appearance 用正式 data.set 结果计算中间值及新外观字段；已解析 captured state 不重复套旧 override。公式 appearanceFrom 的字号／颜色读取有效 style；混合文字继续既有默认值复制。 |
| [DocumentToolGateway.ts](../../../src/core/tools/DocumentToolGateway.ts) | 本轮仅 import 及 object.update 的 effectWriteScopes 外观规划委托同次 dataAppearancePlan；原授权、冻结目标、投影及 canonical writer 保留。该文件另有起点 Root 的 R1 未提交改动，不能误归为本叶子新增。 |
| [componentProperties.ts](../../../src/renderer/ui/properties/componentProperties.ts) | 原 GUI 绝对字号／颜色委托同一小型字段规划；其他格式、相对 fontSizeStep、控件及交互保持原路径。 |
| [g20TextFormatting.test.ts](../../../tests/integration/g20TextFormatting.test.ts) | 保留 5 条原 fullName／断言，新增 7 条真实 Gateway 格式／省略字段／合并／state／来源／锁验证。 |
| [nativeInsertAppearance.test.ts](../../../tests/integration/nativeInsertAppearance.test.ts) | 保留 2 条原插入完整断言，新增公式插入默认与实际整对象工具＋History＋GLX 冷开 2 条；同一正式结果导出 ignored 模型。原 applied helper 只补失败诊断文本。 |
| [componentPlatformProperties.test.tsx](../../../tests/unit/componentPlatformProperties.test.tsx) | 新增 1 条原 GUI 绝对格式和相对字号步进断言，原用例不改。该文件已有参数化用例，实际为 26 条。 |
| [APPEARANCE_RESULT.md](APPEARANCE_RESULT.md) | 本结果与证据索引。 |

`courseElementInsertPlan.ts` 是起点已改的既有直接消费者，本叶子**没有再修改它**：继续调用同一个专业外观 planner。`SlideLocationWorkspace`、`DocumentFileSession`、`PropertyControls`、其他产品／测试均未写入。原 node_modules Junction 未改。

## 2. 真实修前证据与实现边界

真实 DocumentToolGateway、actor=agent、已观察整对象句柄调用公开 object.update：公式原 `formula.style={fontSize:42,color:'#123456'}`，要求 60／`#abcdef`。工具返回 applied，实际仍是 42／旧色，正式 renderer 消费该覆盖值。修前红例在候选改生产前运行，真实失败 1、另 5 条跳过，不能把跳过算通过。证据：[before.json](../../../output/test-runs/format-core-repair/appearance/before.json)、[before.log](../../../output/test-runs/format-core-repair/appearance/before.log)。

当前实现保留：未提供的 italic／bold:false／underline／highlight 等字段；link href/title；rangeIds；数学 inline 的 formulaId／LaTeX／accessibleText；正文和邻对象；frame／读序；基础实例和邻展示状态。局部 text.format 的冻结范围及范围外格式原断言保留。低层 properties.data.appearance 继续字面默认值语义。混合文字 appearanceFrom 没有新语义：复制原默认值，不取首片段、不拒绝合法复制、不清局部格式。相对 fontSizeStep 继续按各段原字号步进。

同次 data＋appearance 先由原 componentDataEdits 产正式计划，再仅用其中目标实例的 data.set 字段构造中间数据，因而保留专业转换／range remap 的实际结果；最终仍走原 DocumentSession transaction／CAS／History。effectWriteScopes 使用同一计划，精确对应新内容字段，没有旧 inline 索引或邻对象范围。

## 3. 实际运行与失败分类（原 raw 全保留）

所有命令 cwd 为隔离候选；[focused.config.ts](../../../output/test-runs/format-core-repair/appearance/focused.config.ts) 精确 include 三个文件、globalSetup=[]、maxWorkers=1。没有扩大到全仓、构建、付费模型或全 typecheck。主会话统一负责集成后相关类型检查。

| raw／阶段 | 收集及实际结果 | 真实分类与处理 |
|---|---|---|
| before.json | 6 收集；1 失败、5 跳过 | 原产品公式有效 style 遮蔽默认值。真实红例，非夹具。 |
| [after-first.json](../../../output/test-runs/format-core-repair/appearance/after-first.json) | 42；27 过、15 失败、0 跳过 | 12 条 Gateway／Host 为本轮合并字段增量的局部 const fields 遮蔽导致 TDZ；真实候选生产错误，改名 combinedFields。另 3 条 GUI 既有失败见第 5 节。首轮未粉饰／覆盖。 |
| [after-gateway.json](../../../output/test-runs/format-core-repair/appearance/after-gateway.json) | 两完整文件 16；11 过、5 失败 | 3 条为本轮真实候选省略字段错误：Zod partial 仍补默认字号／颜色，已用原字段 own-property 选择已校验值；2 条新夹具错误为 scope 无合同意义的顺序、冷开误比 Undo/Redo 前 revision。 |
| [diagnostic.json](../../../output/test-runs/format-core-repair/appearance/diagnostic.json) | 16 收集；仅 5 条诊断实际运行，0 过、5 失败、11 跳过 | 为上行 5 个失败增加实际 scope／保存模型差异诊断，未新增验证矩阵；证明 cold 差异仅 revision 2→4、实际 scope 额外未提供字段。 |
| [after-final.json](../../../output/test-runs/format-core-repair/appearance/after-final.json) | 两完整文件 16；16 过、0 失败／跳过 | 显式字段根因修复后，Gateway 12／Host 4 全部通过。 |
| GUI 原完整文件（after-first） | 26；23 过、3 既有失败 | 修后未重复已有效 GUI 证据。其绝对字段 helper 自首轮未变；后续修复仅发生于 Gateway／插入调用的外观函数分支。 |

另一个实施阶段真实候选问题由独审在执行前指出并修复：若 defaults／overrides 分两次从旧数据规划，统一颜色触发正式片段合并时，第二个整数据 edit 会带回旧默认值。现合为一次 componentDataEdits；新增相邻段＋继承段真实 Gateway 反例已在最终通过。没有禁止正常 normalization，也没有改测试保留错误。

新夹具纠正不弱化产品要求：scope 改为完整集合＋精确数量，仍核全部路径及文档／epoch；冷开改比真正保存时的完整模型（revision 4）；邻状态不应要求包含已修改目标 state 记录的整个根容器 metadata 原样，改为核邻状态 a/b 完整实例、邻 state 记录、root childIds/frame，并保留 Undo 全 instances 恢复断言。原有 5＋2 条用例行为断言未弱化。

实际命令（输出同名 .log，均保留）：

```powershell
node node_modules/vitest/vitest.mjs run --config output/test-runs/format-core-repair/appearance/focused.config.ts --testNamePattern='applies agent whole-formula appearance to its visible override' --reporter=json --outputFile=output/test-runs/format-core-repair/appearance/before.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/format-core-repair/appearance/focused.config.ts --reporter=json --outputFile=output/test-runs/format-core-repair/appearance/after-first.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/format-core-repair/appearance/focused.config.ts tests/integration/g20TextFormatting.test.ts tests/integration/nativeInsertAppearance.test.ts --reporter=json --outputFile=output/test-runs/format-core-repair/appearance/after-gateway.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/format-core-repair/appearance/focused.config.ts tests/integration/g20TextFormatting.test.ts tests/integration/nativeInsertAppearance.test.ts --testNamePattern='applies whole-text|plans combined data|matches only supplied professional color|preserves actual whole-text' --reporter=json --outputFile=output/test-runs/format-core-repair/appearance/diagnostic.json
node node_modules/vitest/vitest.mjs run --config output/test-runs/format-core-repair/appearance/focused.config.ts tests/integration/g20TextFormatting.test.ts tests/integration/nativeInsertAppearance.test.ts --reporter=json --outputFile=output/test-runs/format-core-repair/appearance/after-final.json
```

## 4. 最终直接行为证据

以下 Gateway／Host 原 fullName 均见 after-final.json，全部通过。

| 文件／唯一可查 fullName | 通过属性 |
|---|---|
| g20: applies whole-text 'fontSize' when the default already matches, preserving omitted styles and matching the GUI owner | 默认等请求值仍修已有覆盖；省略颜色、其他 style、link／range／math 身份、邻对象／frame、一 History、GUI 等价。 |
| g20: applies whole-text 'color' when the default already matches, preserving omitted styles and matching the GUI owner | 同上，省略字号不写；预告仅实际同字段 inline。 |
| g20: plans combined data and appearance against the new captured-state content and reports its actual inline fields | 正式 range remap 后的新正文 index；全部实际 scopes；基础／邻状态／读序／frame 保留；一次 History、Undo 全 instances。 |
| g20: sets the new default together with adjacent run overrides when canonical normalization merges those runs | 旧默认黑→绿、相邻红／蓝合并且继承段也绿；link／rangeIds、邻对象、一次 History。 |
| g20: retains literal data.appearance defaults and inherited locks at the canonical writer | 默认 patch 保留显式片段原样；继承锁拒写、revision／History 零变。 |
| g20: copies effective formula size and color while mixed-text appearanceFrom keeps its existing defaults | 公式有效 style 来源；显式请求优先；混合来源复制默认；来源实例不变。 |
| g20: applies agent whole-formula appearance to its visible override instead of only changing a hidden default | 原红例修复；实际 formula.style／正式 HTML 60／新色；默认、公式身份、frame、邻对象不变；一次 History。 |
| g20: matches only supplied professional color and two shadow layers, preserving B body/size/frame through save and Undo | 原 color／多层 shadow、未提供字号、保存与 Undo、精确 scopes 断言保留。 |
| g20: formats a frozen professional text range without modifying unselected text/formula/appearance or widening to object.update | 原冻结范围与范围外保护、公式／默认保留；不能扩大为整对象。 |
| g20: formats ordinary Markdown selected inside existing bold and preserves other styles, formula, CRLF, links and unselected blocks | 原 Markdown 格式、false、链接／公式、CRLF／范围外保留。 |
| g20: does not advertise formatting for a plain text file | 原纯文本能力边界。 |
| g20: keeps explicit style precedence over copied appearance and rejects an unobserved source before writing | 原 style 优先及未观察来源零写入。 |
| native: preserves actual whole-text and formula appearance through agent tools, Undo/Redo and a new GLX Host cold-open | 真实 Host 两次整对象操作，各一次 History；省略其他格式、链接／范围／公式／邻对象；Undo／Redo；保存后新 Host 完整模型等同保存快照。 |
| native: inserts native content, frame and initial appearance in one history entry and preserves them through redo and disk cold-open | 原 text／shape 插入外观、正文、frame／读序、一次 History／Redo／磁盘冷开。 |
| native: keeps formula insertion defaults on the same professional appearance planner without inventing an inline override | 无既有 style 的公式初始字号／颜色继续默认路径；不制造 style；正式 renderer 与一次 History。 |
| native: matches post-insert appearance in a named Slide state, retains Flow reading order and rejects invalid initial appearance without a partial insertion | 原 Slide state、Flow 读序、邻对象和无部分插入保护。 |

GUI 已通过的相关原例 `edits formal formula source in the original control without flattening matrices or ignoring inline appearance` 保留实际矩阵源、IME 等待／提交、焦点、一 History 和邻对象断言；新增 `keeps whole-text absolute appearance and relative font stepping on their existing professional paths` 核共同 planner、遗漏格式／数学身份保留和相对步进 24→28／42→46／36→40。其余原通过项及完整 26 条原结果在 after-first.json。

## 5. 三个未通过的既有草稿切换问题

[props-baseline-comparison.json](../../../output/test-runs/format-core-repair/appearance/props-baseline-comparison.json) 包含本次实施前已有的冻结终点样本 `2026-10-24T17-20-02-350Z/initial.json`、其 `retry-161.json` 与本轮 after-first.json 的同 fullName／status／首错共 9 行。三个用例在两份旧样本 raw 和候选首轮均失败；并非凭同名豁免。

| 原 fullName | 精确首错／与本次 helper 的关系 |
|---|---|
| retains a dirty draft when the captured target changes and refuses to retarget save | `expected <input ...> to be <input ...> // Object.is equality`；纯 PropertyDraftBoundary／BufferedInput rerender 身份断言，未进入 componentPropertiesEdits／外观 helper。 |
| preserves a dirty formula source on target change and refuses to save it into the neighbor | `expected true to be false`，flushPropertiesDrafts 的 stale-target 返回值；本例只有 LaTeX 源草稿，无 content.style，不命中绝对字号／颜色 helper。 |
| keeps an IME property draft on target change and cancels its original canvas owner without writing the neighbor | `expected true to be false`，目标变化后 flushPropertiesDrafts 返回值；文字内容／IME 草稿分支，无格式 patch，不命中本次 helper。 |

这些失败仍然未通过，本叶子未修改 PropertyControls、测试断言或把它们改成通过。不得据本报告宣告所有输入／IME／保存场景已修复。

## 6. 供主会话实际浏览器核对的正式模型

[appearance-render-model.json](../../../output/test-runs/format-core-repair/appearance/appearance-render-model.json) 由最终通过的真实 Host 测试生成，固定结构包含 `before: DocumentModel`、`after: DocumentModel`、`cold: DocumentModel`、`surfaceId:'slide'`、`targets:{text:'slide-old',formula:'formula',neighbor:'neighbor'}` 与公开操作意图。assets／components 为空。

生成链路：正式 DocumentHostService 创建工程 → tools.beginRun(actor=agent、document writable) → issueTarget 观察两个整对象 → 各调用一次公开 object.update(appearance={fontSize:60,color:'#abcdef'}) → 逐次核一条 History → Undo 公式、Redo → 读取保存快照 → 正式 GLX 保存 → 独立新 DocumentHostService 冷开。修后模型来自这条真实工具链，不是手工构造的修后值。before revision=0；保存 after／cold revision=4；after 与 cold 完整模型相等，cold dirty=false、undoDepth=0。

混合文字包含显式字号／颜色、bold:false／italic／highlight、原链接／rangeIds、数学 inline，另有继承段；独立公式有原 style 覆盖，邻对象有独立 frame。最终正式 renderer 的 HTML 字号／颜色检查已过；**实际 Chromium 的有效样式／截图仍由主会话集成后补验**。本叶子没有运行浏览器，也没有调用实际付费语言模型，因此不声称模型意图生成、全部编辑载体或全仓验收通过。
