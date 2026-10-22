# 果铃开发修复独立复核报告

> 阶段复核记录：下列问题及结论对应修复前时点。后续修复、循环探查及最终边界见[修复闭环报告](REPAIR_RESULT.md)；保留原失败，不将本文当作今天仍未修复的清单。

日期：2026-10-22  
对象：D:\果铃工作台 当前工作树与当前生产构建  
结论：**先完成一次范围明确的软件收口，再进入下一步创作。当前不能签“方案全部解决”或“完整交付链已可用”。**

## 1. 决策摘要

本轮开发有实质成果：精确目标、专业输入、连续正文、History 增量、保存与恢复、Runtime 局部消费等已经进入正式实现。本次在真实软件里重新验证的 GLX 编辑、撤销／重做、未失焦保存、冷启动重开以及 Markdown 编辑保存均通过。

同时，本次独立复核确认了以下问题：

| 编号 | 等级与性质 | 现状 | 对下一步的影响 |
|---|---|---|---|
| R1 | P1，创作／交付功能回退 | 内置源码懒加载的生成路径与生产产物不匹配。GUI 新建空白 Web 程序失败；咖啡工程通过 GUI 和公开工具导出单 HTML 均失败 | 必须先修，当前完整创作与交付链未闭合 |
| R2 | P2，Flow 属性消费者接线遗漏 | 从图层选中阅读组里的原生文字后，属性栏显示“流式页面”，没有显示该文字的专业属性 | 建议与 R1 一并收口；直接影响接下来的人工编辑 |
| R3 | 验证维护遗漏 | checkpoint 旧测试要求保持不同对象身份，与本轮等值文本共享编码的新语义冲突 | 本轮实际运行 8 项，7 通过、1 失败；需同步断言，不能宣称相关测试全绿 |
| R4 | 已知体验残余 | 父组间距仍主要通过对象 JSON 调整，没有普通可视间距控件 | 可后置；“能写入且目标正确”不能替代“普通用户方便操作” |
| R5 | 已披露的性能成本 | 约 25.7 MB HTML 样本未失焦保存 ACK 仍为 14.499 秒 | 保留性能债，但不把所有条件优化都前置到创作之前 |
| R6 | 交接文档陈旧 | 咖啡旧 NEXT_PASS 仍指向 r73，现有最新完整候选为 r179 | 进入创作前统一正式作品指针，避免从旧副本重新开始 |

R1 的两个用户症状是同一个共同根因，不按两个独立根因重复计数。R3 是测试维护问题，不是内容损坏。R4、R5 不能包装成本次新发现的程序崩溃。

**建议下一步只处理 R1、R2、R3，并更新作品交接指针。完成当前构建的新建、编辑、保存、离线交付闭环后，进入创作；不再启动无范围的全面优化。**

## 2. 本次核实依据与方法

### 2.1 基线

- 当前 HEAD：1af578e57c120210810d8e2996d072efdc50a365。
- 开始检查时工作树已有约 1002 条 dirty/untracked 状态；实施报告记录其开工前已有 702 项 dirty。差异跨越多轮开发，不能把当前全部差异归为本轮新增。
- 以《果铃统一编辑体验与性能收敛总方案-2026-10-22.md》为覆盖合同，以 docs/development-plan/20261022-unified-edit-performance/IMPLEMENTATION_RESULT.md 为实施方证据索引。
- 中途的 output/final-coverage-draft.md 不能覆盖最终实施报告，也不能据其中旧缺口重新登记已经补齐的问题。
- 使用实际 dist-electron、dist-renderer 生产产物启动 Electron；VITE_DEV_SERVER_URL 为空。没有用开发服务器的成功替代生产构建验证。
- 主产品源码、构建产物和原作品未被本次核实修改。本次写入限于隔离审查脚本、事实记录、工作副本及报告；没有提交、推送或发布。

实际构建指纹保存在 production-lazy-loading-facts.json：

| 产物 | 时间（UTC） | SHA-256 |
|---|---|---|
| dist-renderer/index.html | 2026-10-21 22:00:55 | 17dbab566fe8e59fab970d66bed0bc2608227750a75c3374890e9519fbf240a8 |
| dist-renderer/assets/formulaLinear-BOns-X0Q.js | 2026-10-21 22:00:55 | 1ada1b1dedcb09642b5d9546be7e6c6cd56074461206e887209cc0d947d5d38c |
| src/shared/generated/componentBuiltinSourceLoaders.ts | 2026-10-21 17:39:11 | d9e60bba81eeb9455bec0301e0c2133c3de22491a821b7983f3ecfd71de043ef |

生成加载器早于被核实的生产构建；实际产物也包含其原始 JSON 路径。本结论不是仅凭“可能没重新构建”作出的猜测。

### 2.2 三个原生子智能体的独立分工

| 原生子智能体 | 实际完成的核查 | 边界 |
|---|---|---|
| editing_coverage | 精确选择、共同命令、Flow T1、图层与属性、专业输入与 rich cell；发现 R2，核实 R4 | 独立读当前源码与测试；真实 GUI 复现由主智能体完成 |
| history_persistence | DocumentSession、effects、分组 History、journal v3、checkpoint、保存与恢复；发现 R3 | 独立执行 codec／source range 小反例；主智能体在 Windows 正式仓库执行聚焦 Vitest |
| runtime_performance | 内置源码生成／加载／导出消费者；Runtime 更新、资源 URL、冻结导出、HTML lease | 独立确认 R1 因果链；其余关键路径源码审查未发现第二个确定阻断点，不代表全域重新实测 |

子智能体开始时的远程连接器读取出现阻塞。主智能体随后抓取带文件哈希的当前源码快照，三者通过共享快照完成独立审查。阻塞期间没有把“已启动子任务”算作“已完成审查”。未调用外部 Codex/Claude CLI 或付费模型服务。

主智能体负责当前生产构建实测、复核子智能体发现、方案与证据分类、最终判断。以下区分“本次重新执行”“源码审查”“复用既有证据”。

## 3. R1：内置源码懒加载分发失配，阻断新建和离线 HTML

### 3.1 用户可见的实际失败

**路径一：当前咖啡工程导出单 HTML。**

使用最新完整咖啡候选的隔离副本，完成编辑和保存至 r183 后：

- 公开 document.export，format=html-offline：返回 delivery-rejected。
- GUI“导出单 HTML”：显示“导出未能生成：当前工程与原文件已保留。请查看具体原因后重试。”
- 未进入目标文件选择，未产生此次 HTML 文件。
- 失败后保存的工程仍保留；没有观察到失败导致内容丢失。

公开回执的关键内容：

~~~json
{
  "kind": "error",
  "code": "delivery-rejected",
  "message": "Failed to fetch dynamically imported module: courseware-editor://app/assets/componentBuiltinSources/image.json",
  "data": {
    "status": "rejected",
    "format": "html-offline",
    "currentRevision": 183
  }
}
~~~

**路径二：GUI“新建空白 Web 程序”。**

实际点击正式新建入口后，请求 courseware-editor://app/assets/componentBuiltinSources/web.json 返回 404，并报告 net::ERR_ABORTED。界面出现同一路径的动态模块加载失败，新工程未创建，原咖啡副本仍为 r183。

两个入口分别覆盖当前作品交付与新作品创建，足以否定“可直接进入完整创作交付”。正常显示内置图片不一定经过这条源码加载链，不能把影响扩大为“所有图片均失效”。

### 3.2 源码与生产产物的共同根因

| 环节 | 位置 | 证据 |
|---|---|---|
| 生成源 | scripts/generate-component-builtin-sources.ts:64–76，关键为 69 行 | 生成分文件 JSON 和带 with:type=json 的动态 import |
| 生成加载表 | src/shared/generated/componentBuiltinSourceLoaders.ts:10、16 | image、web 分别指向 ./componentBuiltinSources/image.json 与 web.json |
| 正式加载 owner | src/core/components/source/builtinSources.ts:21–35 | 执行生成 loader，失败清 pending 并抛错 |
| 离线编译消费者 | src/core/publish/componentPlatform/compileCoursePlayback.ts:19、45–55 | image 不在静态白名单，进入 dynamicBuiltin，正式编译等待其源码 |
| 新建 Program 消费者 | src/renderer/App.tsx:894–897 | 创建前等待 guoling.html-program 对应 web 源码 |
| 分发配置 | vite.renderer.config.ts | 未提供这些原始 JSON 相对路径的复制／映射 |
| 实际产物 | dist-renderer/assets/formulaLinear-BOns-X0Q.js | 仍保留原始 image.json、web.json 动态导入 |
| 实际文件 | dist-renderer/assets/componentBuiltinSources/image.json、web.json | 均不存在；实际有 image-5WIX19Pl.js、web-CMX7IvpW.js 等 JS 产物 |

实际产物的 import 仍指向以下路径（引号形式按可读格式展示）：

~~~js
"image.ts": () => e(
  () => import("./componentBuiltinSources/image.json", {
    with: { type: "json" }
  }).then(e => e.default),
  [],
  import.meta.url
)
~~~

**可确认的根因是：懒加载模块的生成与生产分发合同失配。** 本次没有证明是某个特定打包插件造成原始路径未被重写，不把内部原因归咎于未经核实的插件或版本。

### 3.3 为什么已有验证会漏过

- builtinSourceLazy20261022.test.ts:7–9 mock 整个生成 loader，验证缓存、别名和重试。
- componentSourceLazy20261022.test.tsx 从第 7 行起 mock builtinSources，验证输入和加载状态保护。
- 这些断言有价值，但不能证明真实生产模块路径可达。
- 闭包生成成功、生产构建 exit0、旧版本曾导出成功，均不能替代当前构建实际导出。
- 已有冻结导出证据主要是 PPTX 与 Source PNG，未覆盖这里依赖不同的单 HTML 编译路径。

应补“当前生产产物 + 实际消费者”，不用再增加大量围绕 mock 的重复测试。

### 3.4 修复范围与验收

修复生成器及其实际分发方式，保留按需加载目标。不可仅手改 generated 文件或向当前 dist 临时补文件；也不需要因此退回全量 eager 加载或新造资源平台。

最低验收：

1. 当前生产产物实际加载 image、web 及受影响消费集合的内置源码成功。
2. GUI 新建空白 Web 程序成功，可编辑并保存。
3. 同一咖啡候选通过当前 GUI／工具共享的正式导出链产生新 HTML。
4. 真实离线打开新产物，代表性图片与交互正常。
5. 检查 Renderer、隐藏导出 worker、Main 各自实际用到的加载边界；不把 Renderer 成功自动推广到所有环境。

“内置转源码”等其他同 loader 消费者由源码判断可能受影响，本次没有全部实机复现，不能全写成确定失败。

## 4. R2：嵌套原生文字选中后，侧栏退回页面属性

### 4.1 本次真实界面复现

在隔离咖啡副本 r183 中，从“图层”点击原生标题实例：

249472f9-824a-4a16-86fb-ec32edb626f5

它是 guoling.text，位于“U01·开篇文案”→“U01·开篇跨页”→“U01 · 一杯咖啡的远行”的组结构中。

实际结果：

- 图层行被点击，视图定位到该标题；状态栏显示所选文字。
- 属性栏却显示“流式页面”“页面标题”“讲义宽度”“流式布局页背景”等页面控件。
- 所选文字的块类型、对齐与文字格式侧栏入口缺失。
- r183→r183，projectUnchanged=true，errors=[]。

主智能体已按子智能体指出的路径在当前生产软件里复现，截图与事实文件均保留。这次只做选择，没有通过错误面板尝试修改，因此不宣称已经发生误写或数据损坏。

### 4.2 根因

| 位置 | 当前行为 |
|---|---|
| src/core/components/document/flowDocumentProjection.ts:91–94 | T1 将自然阅读组投影为带 blocks 的 course-instance |
| src/renderer/ui/NodesTab.tsx:371–393 | 图层树递归 childIds，能够选中真实组内子对象 |
| src/renderer/ui/properties/FlowPropertiesContextBuilder.ts:35–41 | 属性块索引仅在 section 上递归，遗漏新阅读组后代 |
| 同文件 42–45 行 | 嵌套原生文字仍判为 semantic，进入 flow-block 分支 |
| src/renderer/ui/properties/FlowPropertiesPanel.tsx:163–166 | 仅在不完整 view.blocks 中查找子 ID |
| 同文件 375–382 行 | 查找失败后渲染 FlowPageProperties |

共同事实已经变化，属性消费者仍使用旧结构假设。它使 F09“属性与选择一致”、F10“图层入口接入”以及 U1/U2 的端到端完成条件不能签完整通过。

现有 precisePropertiesAndFlowTree20261022.test.tsx 的组内图层用例使用 custom 子对象，只证明子项能够选中，没有覆盖嵌套原生文字进入 flow-block 的分支。

### 4.3 修复范围与验收

复用现有 documentBlockChildren 或统一阅读结构索引，让属性与块定位读取同一语义树；核对依赖该索引的相邻块位置等消费者。不要只在 UI 局部堆叠一个特殊 group 判断。

最低验收：

- 在真实自然阅读组中，从图层选原生标题／段落，显示对应文字属性。
- 修改一个代表性文字属性，仅影响所选对象；Undo 恢复该对象。
- 正文选择、原生图片选择、显式父组选择仍到各自正确属性上下文。
- 聚焦回归用例必须触发上述原生分支。

等级 P2：仍能通过正文直接编辑，但常用侧栏链不完整。建议与 R1 一起完成这次小范围收口。

## 5. R3：checkpoint 旧测试与新共享语义冲突

### 5.1 当前实际测试结果

主智能体在 Windows 当前正式仓库执行以下两个文件的 Vitest：

~~~text
tests/unit/documentCheckpointMaintenance20261022.test.ts
tests/unit/documentCheckpointTextAlias20261022.test.ts
~~~

使用 node node_modules/vitest/vitest.mjs run，JSON 报告写入 output/independent-audit-20261022/root-ui/checkpoint-tests.json。

| 文件 | 结果 |
|---|---|
| documentCheckpointMaintenance20261022.test.ts | 4 项中 3 通过、1 失败 |
| documentCheckpointTextAlias20261022.test.ts | 4 项通过 |
| 合计 | 8 项，7 通过、1 失败，退出码 1 |

失败位置：tests/unit/documentCheckpointMaintenance20261022.test.ts:87:41。

旧用例令 savedModel={...model}，要求解码后 savedModel 与 model 仍不同对象。当前 codec 第 42–47 行明确允许相同 text/markdown kind、source 和 resources identity 的编码 wrapper 共享，因此旧 not.toBe 断言失败。

### 5.2 这说明什么

独立小反例结果：

~~~json
{
  "inputDistinct": true,
  "decodedAliases": true,
  "contentDeepEqual": true,
  "oldAssertionWouldPass": false
}
~~~

新测试中“不同 source/resources/kind 必须分开”“解码后 saved 基线与 Undo 正确”等断言实际通过。证据支持“测试维护遗漏”，不支持“存档丢失或角色混乱”。

应更新旧用例的名称与断言，保留有意义的语义边界，不应为保持旧对象身份断言而撤销共享编码。同步后重跑这组相关测试即可。

旧证据在不受影响时可复用，但后来的 codec 变化触及了这个旧用例，不能把过去通过状态当成当前全绿。

## 6. 本轮重新实测通过的核心用户链

### 6.1 GLX 编辑、History、未失焦保存、冷开

源作品是完整咖啡候选 r179，审查使用独立副本。

| 操作 | 实际结果 |
|---|---|
| 标题真实 caret 插入“【复核】”，Esc 完成 | r180；仅标题实例内容变化 |
| Ctrl+Z | r181；标记撤回 |
| Ctrl+Y | r182；标记恢复 |
| 正文输入“【未失焦保存】”后立即 Ctrl+S，不先 blur | r183，dirty=false |
| 检查磁盘 GLX | diskRevision=183，与当前 Session 工程深相等 |
| 关闭后用新 PID、新 profile 重开 | r183，dirty=false，与保存工程完全一致，errors=[] |

相对于 r179，仅预期标题和正文两个实例变化，其余实例、定义等检查保持。审查标记只在隔离副本内，不应把 r183 当作正式创作版本。

本次输入通过真实界面及浏览器输入接口完成，不等于物理操作系统输入法验收。

### 6.2 独立 Markdown

实际打开 Markdown，在富文本正文输入“【MD续改】”，保存、撤销、重做并再次保存：

- 标题、列表和原有粗体语义保留。
- 磁盘 Markdown 含正确新增文本。
- Undo/Redo 成功，errors=[]。

Markdown 本轮没有另签全新进程冷恢复，不将 GLX 冷开结论直接借给它。

### 6.3 History / 保存源码核实

未发现本专项能确证的新增内容丢失或历史错乱反例：

| 要点 | 当前源码证据 |
|---|---|
| 先 durable，后接受正式状态 | DocumentSession.ts:348–434，特别是 427–430 |
| 分组 amend 不原地污染既有 entry | DocumentSession.ts:338–346、391–404 |
| Undo 逆序应用效果，Redo 正序；恢复不重跑业务工具 | DocumentSession.ts:356–388；documentStateEffects.ts:90–162 |
| source hints 校验失败可回保真替换 | sourceMerge.ts:8–51；documentStateEffects.ts:41–50 |
| 保存 r 时允许后续编辑，r+1 仍 dirty | DocumentSession.ts:621–675 |
| checkpoint 发布前核 sequence/epoch/file identity，新后缀可使旧候选放弃 | documentJournal.ts:540–571 |
| 资源编号在 journal 写入并刷盘后才正式复用 | documentJournal.ts:465–538；documentJournalCodec.ts:112–131 |
| binding index 为可重建派生事实 | JournalBindingIndex.ts:30–104 |

文件位于 src/core/documents、src/shared/document 或 src/main/workbench 对应目录。未重新实施真实断电、磁盘写满等整套故障注入，不作全失败场景无损保证。

## 7. 方案覆盖应怎样判定

### 7.1 U1–U8 总体判断

| 承接包 | 本轮核实后的判断 |
|---|---|
| U1 精确目标 | 共同选择与命令有实质落地，未找到字段静默扩大为父对象删除的确定反例；R2 使“所有属性消费者已接通”不成立 |
| U2 专业输入／Flow | T1 连续 PM/contentDOM 和正式往返存在，rich cell 保富内容；本次普通编辑链通过；物理 OS IME仍未签，R2需补消费端 |
| U3 History／保存 | effects、journal、checkpoint、固定 revision 保存已落地；实机保存冷开通过；R3需修正验证 |
| U4 Runtime／资源／手势 | 源码有局部更新、共享编译、单资源 URL 和生命周期收敛；未发现新确定阻断点，不等于所有大规模场景重新通过 |
| U5 HTML／文件 | HTML 多视图、依赖版本、lease 与文件观察已有机制；复用有效既有 UI 证据，Markdown本轮实测通过 |
| U6 AI／工具 | 相关 owner 有实现与离线测试依据；本次没有全面重演供应商流式、长会话各消费者，不能签本次全量通过 |
| U7 启动／媒体／交付 | 冻结和取消机制存在，但 R1 使“首次按需功能成功、离线交付保持”当前明确失败 |
| U8 条件专项 | 原方案明确按实际规模触发，尚未实施的条件项不能统一叫漏修，也不作为创作前置全清单 |

### 7.2 F01–F20 与 T1/T2

以下不是二十项全部新跑一遍，而是将当前源码、本次复测及既有有效证据按原问题反向核对。

| 原编号 | 状态与证据判断 |
|---|---|
| F01 语义命中 | 精确作者字段、原生输入与当前 caret 实测有支持；未重新覆盖任意 Source |
| F02 后续拖缩 | 共同目标／手势实现，复用既有 native 拖缩与嵌套 Spatial 证据 |
| F03 父子抢选 | 源码核查与既有 V1 文字→图→父→文字链支持主要修复 |
| F04 组内正文不可达 | 连续阅读组与专业输入落地；属性消费端仍有 R2 |
| F05 编辑器竞争 | 专业 scope、唯一输入接管及 Esc 有证据；不推广到未测物理 IME |
| F06 内部图文入口不对称 | 既有 V1 换图／回文字支持；本次标题／正文输入通过 |
| F07 Spatial/Program 断线 | 复用既有 Program 与 nested-scale-overlap；本次新建 Program 因 R1 失败 |
| F08 字段退为整体 | interactionSelection 与命令拒绝已核；未见本次确定扩大目标 |
| F09 属性／高亮不一致 | **未完全解决：R2 当前实机失败** |
| F10 Flow 图层无入口 | 子树入口已补；进入嵌套原生文字属性仍有 R2，不能只按树可点击签全链 |
| F11 plain/rich/caret 分叉 | 共享专业宿主存在，本次 caret 与 Markdown 实测通过 |
| F12 撤销分组 | Session 分组/effects存在；本次 UndoRedo通过，冷恢复分组测试代码已审 |
| F13 Esc 丢普通草稿 | 本次标题 Esc通过；既有 rich cell final run支持完成键与冷开 |
| F14 菜单／键盘精度 | 共同命令最后覆盖旧 surface入口，非objects不能静默执行对象删除／复制 |
| F15 AI 粗回选 | 冻结目标与主动定位已有证据；本次没有重跑真实provider |
| F16 容器路径与祖先 | 源码及既有容器进出证据；本次未重复全矩阵 |
| F17 字段 A/B key | 稳定作者地址决定身份，旧命令失效保护已独立核查 |
| F18 rich cell | 保rich inlines、公式与格身份；复用run-Wy3dMU |
| F19 realm 业务抢先 | 复用Program/T2编辑业务0、运行1的实测证据 |
| F20 延迟 ACK 后误选 | 捕获作者地址后重新解析的实现及相关证据；本次未重新施加延迟冲突 |
| T1 连续正文 | 有真实带blocks投影、单contentDOM、正式编辑与源码往返；R2暴露后续消费者漏接 |
| T2 早期手势接管 | 既有按钮/链接、嵌套遮挡与缩放证据有效；不承诺任意跨源realm |

A01–A14 沿总方案 §9.2 对应上述 V1–V9：

- A01/A02 的内容—图—整体和字段切换有证据，但不能忽略 R2。
- A03/A04/A13/A14 的命令、四工作区和基线以源码与既有用例为主，本次没有全面重签。
- A05/A06/A07 的普通保存、History、Esc有本次支持；物理输入法仍未签。
- A08/A09/A10 的T2、多视图、连续正文/rich cell有对应证据。
- A11 的AI冻结以既有离线与owner证据为主。
- **A12 的最终交付当前因 R1 不通过。**

### 7.3 性能127项的归属与真实含义

总方案 §9.3 的127是定位清单，分主线、专项、条件及必须保留成本。数量只证明没有规划遗漏，不能推出“127个bug全部修复”。

| 域 | 项数 | 原承接 | 当前判断 |
|---|---:|---|---|
| DOC | 10 | U3/U7 | effects/journal/checkpoint/归档主线落地；保真实全量与fsync/CAS；R3是测试问题 |
| FLOW | 10 | U2 | 增量与连续正文实现；R2是相邻属性消费遗漏 |
| UI | 8 | U1/U4/U8 | 目标/手势改善；大树/大型Spatial窗口化按条件 |
| HTML | 11 | U5 | 分析、轻消息、lease有实现；大文件端到端等待仍明显 |
| RUN | 11 | U4 | Source保序、资源/targets分流等已核；opaque动态fallback有保留必要 |
| FILE | 9 | U5/U8 | 目录/观察/恢复列表有证据；复制锁等按规模，保完整性 |
| AI | 12 | U6 | 有流式、记录与窗口证据；本次未完整重签长会话各消费者 |
| MEDIA | 12 | U4/U7 | PDF/图片/字体与URL生命周期有证据；保原图和首次准入 |
| IO | 10 | U7/U8 | Office/导出执行器改善；单HTML当前R1失败；离线fallback不能擅删 |
| BOOT | 8 | U7/U8 | 按需依赖已改，但首次内置源码消费者失败；Main bundle等仍条件性 |
| LIFE | 7 | U5/U6/U8 | consumer退出收敛；大作业/输出/制品按规模 |
| TOOL | 11 | U6 | 复用执行/捕获owner，不宣称此次全工具链重测 |
| SYS | 8 | U7/U8 | 取消等有证据；网络/日志/永久pending依现场触发 |
| 合计 | 127 | — | 不能简化为“127项全部消除” |

## 8. 可复用证据与尚未签收的边界

### 8.1 主要既有证据

根目录均为 output/unified-edit-performance-20261022/ui。

| 既有运行 | 可支持的属性 | 不能替代 |
|---|---|---|
| flow-image-return/run-ZbYMIc | 换图、父组选择/间距、回文字且目标保持 | 普通间距可视控件、当前导出 |
| program/run-j4zUrM | 既有Program编辑/运行/保存/冷开 | 本次空白Program新建 |
| view-roundtrip/run-wrXwii | HTML预览→GJS→源码→预览 | GJS选框完整签收、任意巨大HTML |
| flow/run-2026-10-21T20-01-21-089Z | T1 Enter/Backspace、跨段、CDP composition、源码往返和冷开 | 物理OS输入法 |
| native/run-Wy3dMU | rich cell Tab/Enter/Esc、合并、公式和冷开 | 每种内容×所有表面 |
| large-html/v6-unblur-cFQ2eR | focused textarea直接CtrlS、warm UndoRedo、冷开 | 普遍低延迟或全部失败情形 |
| large-html/v6-cold-continue-VpCcei | 新会话冷开继续改和UndoRedo | 旧会话全部History恢复 |
| delivery/run-ZFMqp0 | PDF两页IPC/worker与PPTX/Driver链 | 全GUI/全Office矩阵 |
| frozen-export/run-xt71Tl | 固定revision PPTX/Source PNG和在途取消 | 当前单HTML源码加载、发布文件原子性 |
| nested-scale-overlap/run-AN205M | .75缩放、遮挡、编辑/运行业务对照 | 任意动态iframe身份与nested冷开 |

本次没有删除或改写历史失败，也没有将脚本退出码替代用户结果。

### 8.2 性能仍须如实保留

实施报告中的实际样本为25,709,739字节：

| 指标 | 已有测量 |
|---|---:|
| 打开 | 14.737秒 |
| 未失焦保存ACK | 14.499秒 |
| 冷开 | 12.073秒 |
| 另一冷开续改Apply | 2.521秒 |

这些是既有采样，本次没有重新测量，也不能混用不同场景推出稳定加速倍数。原大跨度效果膨胀已有逐帧证据消除；checkpoint等值共享减少表示重复，不能据此宣称保存已普遍流畅。

后置范围包括大型树/Spatial窗口化、外部大库/Main require、长源码与HTML首次纯分析进一步搬worker、DOCX纯解析、特定日志/网络/大输出等。若下一作品实际触发，再按该现场缩小处理范围。

### 8.3 父组可视布局控件

componentProperties.ts:114 将组投为composition；SlideNativePropertiesPanel.tsx:851–855只给组合内容提示；FlowPropertiesPanel.tsx:776–807有版式、环绕、阅读顺序等，没有普通group gap/padding控件。

既有V1通过对象JSON调父组间距，证明正式写入和目标保持，没有证明低门槛操作已完善。可单列后续体验任务，尤其大量人工排版时有价值，不宜成为无限延期创作的门槛。

### 8.4 咖啡交接指针

旧 docs/creative-production/works/coffee-journey/handoff/NEXT_PASS.md 指向 design/v05/native/coffee-journey-v05.glx（r73），部分旧问题已过时。

本次使用的完整候选源：

D:\果铃工作台\output\structured-coffee-fidelity-20261021\full-final-20261021\workspace\coffee-journey-v05-delivery.glx

源revision为179。后续应从正式确认的这个候选继续，不从本次带审查标记的r183副本开始，也不因旧交接说明重造整篇作品。旧DELIVERY_FACTS的revision/hash对应此前版本，应更新绑定，不能当成当前文件损坏证据。

## 9. 下一轮最小充分收口

| 顺序 | 工作 | 完成条件 |
|---|---|---|
| 1 | 修内置源码生成与生产分发 | 新Web真实创建；所需内置源码在生产Renderer/相关worker可达；咖啡新HTML实际生成并离线验证 |
| 2 | 修Flow阅读树到属性的接线 | 图层选嵌套原生文字出现对应属性；改一项只改所选对象；Undo正确；父组/图片入口保持 |
| 3 | 同步checkpoint旧测试 | 维护与alias测试语义一致，相关8项通过；保不同内容/资源及恢复基线断言 |
| 4 | 更新简短交接记录 | 正式作品路径/revision/hash清楚，记录已修状态与未签边界 |
| 5 | 进入创作 | 推进内容、视觉、互动与整体质量，不以127项条件清零为门槛 |

本轮发现不支持更换编辑器、重建History、重写全部资源系统或再拆巨型统一平台。根因落在两个具体接线边界与一个受影响测试：生产模块分发、阅读语义树消费者、checkpoint语义验收。

若第1、2项修复后再出现新确定失败，则围绕新失败的正式入口处理；没有失败或明确热点时停止扩面。

## 10. 本次证据目录

以下均位于：

D:\果铃工作台\output\independent-audit-20261022\root-ui\

| 证据 | 内容 |
|---|---|
| ui-facts.json | r179→183、UndoRedo、未失焦保存、冷开深等及导出失败 |
| initial.json/png、title-edited.json/png | 初始与编辑后快照 |
| saved-before-cold.json/png、cold-reopened.json/png | 保存与新会话冷开事实 |
| markdown-facts.json、markdown-edited.png | Markdown保格式与UndoRedo |
| coffee-audit-offline.html.receipt.json | 公开工具HTML导出正式拒绝回执 |
| gui-export-result.json/png | GUI导出失败提示及未产生保存选择 |
| new-program-result.json/png | 新建Web请求404与用户可见失败 |
| production-lazy-loading-facts.json | 产物哈希、原始import片段、JSON缺失与JS存在 |
| nested-native-properties-facts.json/png | R2界面、实例、父链、属性回退、工程未变 |
| checkpoint-tests.json | 当前正式仓库8项聚焦Vitest结果 |
| open.cjs、new-program-probe.cjs、nested-native-properties.cjs | 隔离实测脚本 |

源码快照及哈希清单位于：

D:\果铃工作台\output\independent-audit-20261022\source-snapshot\

截图和JSON是复核证据，不是正式作品。自有QA应用均在探针结束时关闭；未结束其他用户会话。

## 11. 最终判断

- **所有问题是否已解决：没有。** 方案层覆盖完整与当前软件完全正确是不同判断；R1、R2已在当前生产构建复现。
- **有没有新bug或回退：有。** 一个共同懒加载分发故障造成两条核心功能失败，另有真实属性消费缺口；还有确定的陈旧测试失败。
- **是否需要继续优化：需要一次短范围修复收口，无需无边界全面优化。**
- **能否进入创作：先完成上述收口和实际交付验收，然后进入。** 核心编辑和持久化已有正面事实，不应因条件性能项尚存无限延后。

本报告不声称全仓绝无其他bug。未签范围包括物理OS输入法、任意动态iframe身份、全部Office/表面组合，以及真实断电/磁盘写满等完整故障矩阵。它们不影响已复现的失败，也不抵消本次实际通过的编辑保存结果。
