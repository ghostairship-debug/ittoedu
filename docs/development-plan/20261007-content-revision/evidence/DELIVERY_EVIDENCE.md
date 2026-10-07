# A02–A05 / S09 与 O09–O11 交付证据摘录

只读汇总，日期 2026-10-07。实现观察点为 integration `c26146e1f42d30c3066d30f91caba7656efe00e2`；没有修改产品、测试或 Root 的结果文档，没有执行新的测试、构建、模型调用或 GUI 操作。下表复用相关实现未变的原证据；测试、结构 review、真实像素和 Owner accepted 分别记录。发行继续暂停。

## 逐包结果

| 包 | 当前已实现及集成 commit | 最低有效证据 | 未测、条件及报告边界 |
|---|---|---|---|
| A02 HTML 实测装配与源码保真 | `9f81f752` 保 measured pseudo/support CSS，测量失败回现有 program carrier，主动取消不提交；`abeab33b` 保共同 paint/compositing/source scope，Flow 整页纯色归既有 paper owner；`814e1451` 保专业文字精确 alpha 与 Flow fixed viewport；`9fefeaed` 在浏览器规则不可读时保 authored CSS；`9be93b75` 以当前 canonical 图片字节复核修复。 | T08 `measurementRecovery.test.ts` **2/2**，cut `d50653cf`，原日志 L2：真实 ContentApply → V10 Session，worker failure 保 HTML 并保存/冷开，user abort 零 commit/History。R0/R3 对原算法、source scope、Flow paint owner 的结构结论可复用。`alphaTextRoundTrip.test.ts` **1/1**，cut `434a148f`、L3，证明真实 V10 archive/专业 Player DOM alpha（见“证据解释”）。 | pseudo、跨父 z、整体 opacity/filter、outline/clip/mask、Flow root/fixed 的真实 GUI 像素仍待 E 的 `paintAndFlow.spec.ts`；DOM/style/字符串结果不替代像素。Office 真实打开与全部 alpha 呈现未在这些记录中证明。 |
| A03 资源用途及可修复原件 | `062a5979` 从 extractor → prepared resources → measurement/preview 区分 image/media/stylesheet/font，保 URL/source；`781d3477` 局部 HTML 改字继续保实际 CSS 资源用途。当前 shared schema/bootstrap 接线已在 integration，可见 Web 原程序继续保留。 | T08 `resourcePurpose.test.ts` **1/1**，cut `c2dbcd1f`，L4：实际声明进入 preview 响应，CSP 对应各真实 sink；不把所有来源放进所有网络指令。离线 sink 的当前源码证据另见 S09 的 4/4。 | 这是声明/许可 consumer 证据，不是公网可达性、全媒体播放或所有内容离线承诺。坏媒体原件保存/修复的完整真实 GUI 链未从本次 E 日志映射确认，不另称通过。 |
| A04 Published 实际使用资源 | `29b50d64` + `43efc795` 删除全资产启动等待；原生资源按实际 resolve 获取，程序/Web 持 URL 按真实浏览器使用请求。`36a0f9e2` + `2260cfb6` 修复 R3-F1/F2：无可选 bindings 的 source 也获得完整只读 URL map；capture 等已请求 fetch、当前 update、图像解码；等待先于 Office local isolation。pending 不误报 missing，dispose abort、晚结果不更新。 | `publishedAssetUse.test.ts` **2/2**，cut `c234c618`，L1；`nativeCaptureReadiness.test.ts` **2/2**，cut `d50653cf`，L2；`sourceResourceConsumer.test.ts` **1/1**，cut `434a148f`，L3，真实 compiler/Published/Electron source realm + `ctx.resources.url(instance.data.assetId)` + 实际 img 解码，无 bindings、不 fetch unused。R3 追加补审独立关闭 F1/F2 的接口/时序反例。 | native capture 的两个最近层用例替代了网络/解码时序，不是像素基准。source 单例证明真实 realm 资源访问与 img 解码，不证明全课 GUI 视觉/互动。真实 GUI paint/capture 仍由待执行 T08/E 提供；真实网络耗时、长期泄漏及无界容量未测。 |
| A05 工具导出活性与取消 | `058009d7`：120 秒仅无活性检测；同 sender/完整 identity/递增 sequence 刷新，abort/idle/dispose 通知 producer，晚回复不结算。`fbba61de` 接 GUI controller/progress/cancel；`5b16a093` + `fe5b827d` 接实际 hidden worker progress/cancel/compile/capture，并复用 Main observation owner。 | `exportLiveness.test.ts` **2/2**，cut `c234c618`，L1：fake clock 跨旧总 deadline 仍有活性可成功，foreign/stale progress 无效；主动 abort 对应 producer 一次，晚成功忽略。R4 最终增量对真实 headless sender/identity、共享 signal 与释放的结构补审无新阻断。 | fake clock 不证明真实课程超过 120 秒的频率/耗时。`headlessExportWorker.spec.ts` 已在 `02e017a3` 准备真实 hidden entry、PPTX/PDF capture/progress/cancel，用例尚无本次可复用成功 E 日志；GUI/headless 组合不能由端口绿代替。 |
| S09 共同格式输出/导入 consumer | `f49cc505` 令人工与工具汇入同一 `buildComponentDelivery`，公共六格式为 html-offline/html-online/web-package/pptx/pdf/docx；PDF printHtml 交 Main 打印，DOCX 仅 Flow、多文件由软件命名；`effcbfd7` 保部分写入及写后 unknown。`933925fd` 从当前 HTML/CSS/程序中实际可证 sink 计算离线依赖，普通 URL 数据不误标、旧可选登记不覆盖新源码。PPTX 导入 `629fb62c`/`63bf1af2`/`7718380f` 复用原 converter、授权字节与现文件 owner。 | `currentSourceDeliveryFacts.test.ts` **4/4**，cut `d50653cf`，L2：无登记的真实 img 外链有诊断；文本/程序普通 URL 数据两个反例保持 local；当前源文取代 stale metadata。R3-F3 原反例有对应实现及独立 T 的原失败回放。R4 对 PPTX converter、File owner、headless capture 的结构范围可复用。 | 六格式的完整真实产物、PDF/Office 打开与写盘不能由 format union/producer 分支当通过。本次未取得 `x1MixedDelivery`/PPTX table-chart/DOCX 语义最近层成功原日志，不机械重跑。公共 PPTX 实际转换→编辑→save/cold reopen 用例 `5e2a0946` 已准备，尚待对应 E 原记录。PPTX 冷启动在创建后、Engine ACK 前的 unknown 查询仍是 R4 明示条件。 |
| O09 wrapper paint 候选 | A02 的实际 capture 保 computed outline；clip/mask/effects 进入原共同 source scope，避免 flatten 后丢绘制语义（`abeab33b` 及相关 assembly）。原候选被按当前具体属性处理，没有通用 CSS 引擎。 | R0/R3 对共同 scope、原 orderedChildren/专业映射的结构补审。当前真实 GUI specimen 的 `.clipped` 等观察已定义。 | 没有 E 的 wrapper 独立像素绿；不能把“保住源码/结构”写成 outline/clip/mask 的全部实际呈现已通过。 |
| O10 fixed source 边界候选 | capture 的实际 fixed 保 body viewport-layout/source scope；`814e1451` 令 Flow viewport 依据真实 Web source/容器选择。Slide/Spatial 的已批准 free frame 语义保留，未把所有 fixed 内容定为缺陷。 | R3 静态补审认可 source-scope/Flow 保留边界；真实 Flow fixed/resize consumer 已进入 `paintAndFlow.spec.ts` 的源与工程链。 | Flow 滚动、resize、真实像素尚无对应 E 绿记录。仅源码谓词不能证明所有 carrier 等价。 |
| O11 局部解析复用 | `814e1451` 的 `flowViewportSources` 为同一 live instance、未变 html/css 复用 `webUsesFixedViewport` 结果，实际 consumer 为 `componentLayoutInput`，不是跨工程 cache/hash 平台。 | 当前源代码可确认 WeakMap 输入比较、内容变化失效及现 consumer；本次没有 parser-count 聚焦执行日志。 | 只记该直接重复计算已收敛。`applyService` 的局部 HTML 分支仍调用 `prepareMeasurementDocument(...).documentProgramReason`；不能声称所有局部 HTML parse/serialize 均只一次。无实测耗时提升、不以未测性能建立新门。 |

## 原日志与 cut

E 已按原执行命令确认下列目标文件的 pass 映射。日志使用聚焦组合 reporter，含其他领域的失败；整组总数不能直接当成本表各包全部绿。

| 索引 | 原始日志（绝对路径） | cut / 本表复用范围 |
|---|---|---|
| L1 | [e-focused-c234c618.txt](D:/果铃并行/20261007-content-revision/e/output/e-focused-c234c618.txt) | `c234c618`；整组 31 cases：26 passed / 5 failed。本表只复用 publishedAssetUse 2、exportLiveness 2。 |
| L2 | [e-focus-d506.txt](D:/果铃并行/20261007-content-revision/e/output/e-focus-d506.txt) | `d50653cf2520c3d83cfe1eed41b37274d061131e`；整组 29 cases：22 passed / 7 failed，另有一个 fixture 收集错误。本表只复用 measurementRecovery 2、nativeCaptureReadiness 2、currentSourceDeliveryFacts 4。sourceResource/alpha 当时红，不能沿用为绿。 |
| L3 | [e-repair-434.txt](D:/果铃并行/20261007-content-revision/e/output/e-repair-434.txt) | `434a148f83645eae260aadf13db51e69deabd773`；整组 18 cases：13 passed / 5 failed。本表复用 sourceResourceConsumer 1/1、alphaTextRoundTrip 1/1；其余 domains 的红不冒充已关闭。 |
| L4 | [e-resource-c2dbcd1f.txt](D:/果铃并行/20261007-content-revision/e/output/e-resource-c2dbcd1f.txt) | `c2dbcd1f`；整组 4 cases：3 passed / 1 failed。resourcePurpose 1/1 green；当时 alpha payload 混入作者 definition.dataSchema 的 fixture 红保留原记录。 |

## 独立 review 与证据解释

- [R0_REVIEW.md](D:/果铃并行/20261007-content-revision/r0/R0_REVIEW.md)：A02 使用既有 sourceScopes/Flow paper owner 的依据，以及最低实际绘制要求。
- [R3_REVIEW.md](D:/果铃并行/20261007-content-revision/r0/R3_REVIEW.md)：首轮 `13f27033` 找到 A04 source URL/capture 时序和 X offline 漏报。追加补审按原反例关闭 A04 F1/F2（叶 `ed99f2f9` + `47e75e28`，集成 `36a0f9e2` + `2260cfb6`）；仅接口/时序，不声明真实像素。其顶部 F3 “仍开放”属于该报告上次补审状态；后续 `933925fd` + L2 的 4/4 是新证据，尚未从该报告读到 F3 的追加正式关闭，不能替 reviewer 改判。
- [R4_REVIEW.md](D:/果铃并行/20261007-content-revision/r0/R4_REVIEW.md)：最新相关增量观察 cut `0b016835`，公共 PPTX/headless capture 的结构结论可复用，明确真实 Electron/GUI/Office/cold-open 仍待证。该 cut Player/Renderer/component build 成功，Electron build 失败；不据前三者称整个构建通过，本摘录不推断后来 build 状态。
- sourceResource 在 L2 的红来自 parent 读取 opaque iframe，alpha 红来自期待完整句子的单 span。独立 fixture 改为实际 frame locator 和实际逐字符 DOM 后，L3 相关文件通过；没有为测试撤掉 sandbox 或改弱产品颜色语义。Alpha 的证据是当前 DOM/computed color 与 V10 archive，不是截图像素。

## 当前剩余执行范围

只保留与这些实现有关的两个现成真实载体：`tests/e2e/productFollowup/T08/paintAndFlow.spec.ts`（`3c29f730`/`abc147d0`）与 `headlessExportWorker.spec.ts`（`02e017a3`）。它们已经定义，尚未从本次可复用 E 原日志确认执行成功；不新增矩阵，不重跑上表无变化绿证据。

maxHTML 没有独立运行设施或实际大 HTML spec。生产直连是 `useCourseDelivery` 的 50 MiB 提示及 `continueLargeHtml → write`，不是 hard maximum；旧 `exportMenuUi` 的 72/300 MiB 仅数值提示/按钮 callback。原 rev32 V10 raw（11,511,151 bytes、8 surfaces、268 instances）和光学工程 archive（2,488,824 bytes）在主目录绝对路径可读，可复用为现 source 代表样本，但不声称生成的单 HTML 已跨过 50 MiB 或无界容量。原 rev32 观察日志明确 exports=0，不能改写成现输出已验证。

全部结论最多支持相应 engineering candidate；未完成真实像素/完整 carrier 的项目和 Owner accepted 单独保留。发行暂停。
