# 资源与运行时修复：独立结构评审

评审者：`/root/resource_structure_review`（未参与实现）。基准为本轮 `initial-tree.txt` 的 Git tree `031d587c1346460a30ed3d24fc3fb8c99e61a67c`，包括上一轮已经有效的未提交交互修复；不把此前改动计入本轮审查。

## 最终结论

2026-10-24 最终独审通过，已审候选无剩余结构阻断。GLX / 库包内容寻址、单文件资源池、Web 交付、资源 lazy lease、正式树查询 / 导航通知、统一图片衍生及 Editor / Player / iframe 批次几何均已闭合；R01–R11 已整改复核。最后的 Web HTTP opaque Canvas 原失败反例，已用 fresh build 的真实 Source API / nativeData 两路在 HTTP / file 四例证明像素可读，后续 update 仍保 portable bytes。真实总体性能与完整作品可用性由 Root 本轮实际验收报告决定，本结构结论不预填这些结果。

## 必须保留的语义与实际消费者

- `CourseV10Driver` → `create/openCourseProjectV10Archive` → `DocumentResources`：项目资产 ID、组件相对路径、原件、来源及作者数据不因物理去重改变。冷开结果保持独立的可变逻辑字节，不将跨资源可写别名泄漏给现有 consumer。
- `buildComponentPublished` → `buildPublishedCourseV4` → `compileCoursePlayback` → `buildCompiledSingleHtml` / `mountCompiledCourse`：显示需求决定运行衍生，工程原件不覆盖；同内容仍能具有不同逻辑素材身份。编译产物 HTML/CSS/程序字符串内资源也需要覆盖，不能只去重 `course.assets`。
- `createWebResourceUrlLease` 归实际消费 realm 所有；跨 opaque iframe 不能直接复用父 realm Blob URL。相同内容可在同一 realm 共用已解码 Blob，但不同逻辑 ID 保留独立地址以支持精确反查。
- Web 包 HTTP 应直接利用独立二进制文件缓存；现有 `file://` 打开能力仍需要经典脚本的字节准备方式，不能直接删除后误称支持本地离线。两者共享同一份 Published 与运行语义。
- 单文件资源池只属于交付序列化适配，不新增永久工程状态或 Published 作者 schema；编码、Player bootstrap、静态预览 consumer 必须成对接通。

## 已反馈的必要改进

这些编号是独审期间发现的候选问题与 consumer 缺口，包含本轮初始候选引入的回退；不能全部算作原软件已存在的故障。例如字体 CORS、Canvas taint 与图片 demand 欠采样是在资源优化候选中发现并修正。原始 GLX 物理重复、全目录解码、父级全表扫描与无关导航广播的基线证据分别见资源 / 性能报告。

| 编号 | 发现与证据 | 处理状态 |
| --- | --- | --- |
| R01 | Renderer `assetBytesSha256` 原使用异步原生 `crypto.subtle`，初始候选替换为同步 Noble SHA。18 MiB 本机 Node 小探针同步约 65–84 ms、原生异步约 11–15 ms；这仅证明潜在主线程工作回退，不代表 Chromium 性能验收。内容身份统一不要求将 UI 哈希改为同步。 | 已关闭：主树保留 Renderer 异步原生实现，共享 helper 另提供相同内容 identity 的异步实现。 |
| R02 | `createWebResourceUrlLease.update` 原按逻辑 ID 分别执行同一 dataURL 的 `atob` 与 Blob 创建；仅文件序列化去重不会消除重复解码。初期修复直接共享 URL，又会使 Sandbox、ownedDocumentAuthoring、compiledPlayer 的既有 URL→ID 反查把同内容第二个 ID 错认成第一个，影响 image record baseline/initialValue。 | 已关闭：既有 lease 按 source 复用解码后的 Blob，每个逻辑 ID / source version 保留独立 URL；已核反查反例和历史版本 release 语义。 |
| R03 | 单文件池若只处理资产表，会遗漏编译产物中 HTML/CSS/程序字符串里的 dataURL；泛化占位串替换还会碰撞作者原文。 | 已关闭：path + offset 恢复 Base64 本体，保留各 MIME 前缀；bootstrap 与 Main preview 共用 decoder，移除预览 pool 防重复恢复，不在启动后 stringify 巨大 DOM JSON。已核最终交付证据。 |
| R04 | 初期 `buildHtml.ts` 尚未传显示 demand，图片 helper 新增 `original` 也没有普通导入/Main admitted 的直接生产 caller。不能以 helper 的实现宣称导入全链路收敛。 | 已关闭：各来源通过共同 Published consumer 传 display demand 到 encoder；普通导入仍保原始字节，不改无关 factory。报告明确 helper 无生产 caller，不把其 original 返回值夸大为新的导入链。 |
| R05 | `scope.measure` 的 Flow 文档基准依赖 World 正式容器 target。Editor FlowWorkspace 原只登记子对象，未将容器 root 登记为 target，不能据 compiled/iframe 证据宣称 Editor 内容坐标已经联通。 | 已关闭：原 observation effect 登记同一正式容器 content target，清理带 expected root；实际 Editor 浏览器样本覆盖滚动、保存关闭、旧 scope 退休、重开及 390px 重排。 |
| R06 | 发布图片 demand 初版优先使用 image 的 `frame.width`，与 Flow 实际媒体投影不一致。Flow readingWidth=860、image frame=100×100 时，既有 `resolveComponentOuterPresentation` 的媒体 localAssembly 会 scale=8.6，真实显示 860×860；collector 却只给 100×DPR2=200px。另一反例是 anisotropic ancestor + 90° image：实际源 x 轴 400px / y 轴 20px，DPR2 需 800×400 全源，而初版先投影后 contain 误算成 80×40。 | 已关闭：复用正式 Flow outer presentation / lane，local crop+fit 先计算，再按源两轴的实际 affine 密度取必要倍率。reading / wide 得 1720 / 2200px，full/fluid/native CSS 未知保原；anisotropic 得 800×400。Root 五项 producer 用例已通过，原错误的新断言经数学与真实 producer 对照纠正。 |
| R07 | `detail` / `original` 例外初期仅 helper / core options 可传，实际 Renderer HTML/Web 出口不提供需求参数，collector 也未从实际内容表达质量例外。helper 细图通过不能证明用户正式出口已有可用例外。 | 已关闭：正式 Published / HTML / Web 三出口 `imageDemands` 参数与真实 image consumer `quality:original` 已核、用例通过；未知 PNG 无 resize 保原、有 resize 仍 PNG 无损，显式 photo 才转有损 WebP，detail / original 有可用正式入口。不新增分类平台或 UI 面板，不宣称自动识别图片内容。 |
| R08 | Web HTTP 将传给 opaque iframe 的字体从 data URI 改为普通 HTTP 字体 URL，会在普通无 CORS 响应头的静态服务器上加载失败。实际 Chromium `origin=null` 反例为 NetworkError；有 ACAO 的控制组 loaded。仅修改旧字体字符串断言不能证明行为等效。 | 已关闭：cacheable `course-fonts.js` portable 字体 CSS 载体保留 opaque realm 能力，顶层独立字体文件仍可缓存。`font-cors-probe-after.json` 的真实 template→bootstrap→opaque consumer 在 HTTP / file 两路均 loaded，零错误。必要的少量字体传输重复如实报告。 |
| R09 | `resolveModelPlayerPresentation` 在 Model / compiled Player 中逐容器合成当前 state；collector 初版仅 base + 逐容器单 state。外层 state 使内层 scale2、内层 state 使图片 width200→400 时，各单版本最多 800px，但同时态需1600px（DPR2），可能误缩。 | 已关闭：同一几何链出现多个 presentation owner 时保原，不枚举笛卡尔矩阵；普通单状态优化保留。bounded Slide background 共用 local fit→affine 上界，program/custom paint/Flow 背景仍 unknown。七项 producer 证据通过。当前 v08 无此状态组合，不冒称该故障属于 v08。 |
| R10 | Web HTTP 不再加载捕获字节脚本后，nativeResourceUrls 从旧 World bytes/dataURI 路径退为普通 HTTP 地址；opaque iframe 内 Image 虽可显示，Canvas 读像素会 taint。nativeData passive 图片或 nativeSources CSS 资源都可能被程序用于 Canvas，保留 JS 字面 dataURI 不足以保持此能力。 | 已关闭：compiled nativeSources / nativeData 首个真实 consumer 才 await 既有 byte carrier 的共享准备，再用原 World.prepareResources 给 realm 可读目录；静态 / 同文档组件不预载。无递归 sync 环，单 scope 取消不毒化共享准备，player dispose 后不再建资源。fresh build 的实际 Source API / nativeData × HTTP / file 四例均读到 `[255,0,0,255]`，update 后目录仍保 dataURI，零 console / pageerror / failed requests。 |
| R11 | 最后 consumer 核对：嵌套容器的额外 PlaybackView fit / camera 没进入正式 affine 时，不能以小 frame 作为可靠上界；Published 保留的 theme.assets 还可供未知主题 CSS / 程序使用，不能仅因同素材也有小 native image 就缩小。 | 已关闭：未有可靠 viewport / camera 尺度的 nested container / Spatial 与主题资产沿既有 unknown 机制保原；root 容器 frame 不误作 free affine，bounded root Slide 背景仍按设计需求优化。九项最终 producer 用例通过，不建立几何 / CSS 分析系统。 |

## 证据边界

本记录基于本轮源码增量、直接 producer/consumer、原行为断言，以及明确标注复用的聚焦 / 真实载体证据。评审者未重复运行实现者有效未变检查，也未修改产品源码。真实总体保存冷开、视觉、浏览器加载/滚动数据由本轮相应执行者采集；本评审不将源码结构或 Node 探针当成这些属性已经通过。只创建和维护本文件，没有建立新的审查平台或验证门。

## 已通过的候选范围

### GLX 与组件库资源归档

已核 `courseProjectV10Archive.ts`、`library/archive.ts`、`resourceContent.ts` 与直接 `CourseV10Driver` / `DocumentSession` / module-file consumer。组件库沿原 manifest 的 logical→physical 映射复用物理池；GLX 新索引只改变 ZIP 物理条目，保留逻辑路径与 schema 数据。读入逻辑条目独立缓冲，canonical replacement/COW 与 Undo/Redo 不合并逻辑身份。现有旧归档 reader 保持可用，新索引缺失、内容不符及未归属实体的诊断对应内容寻址自身的实际完整性要求。

复用实现者已通过的归档、真实 worker、闭包、插入/重映射、canonical replacement、Undo/Redo、序列化冷读证据，详见 `resource/RESULT.md`。已检查新用例断言未削弱原有行为。真实 v08 另存副本保留全部逻辑内容和字节并减少物理重复；原件未改。这里的 Node codec 冷进程读入不扩大为 GUI 冷开或用户首次可交互验收。

### 运行时批次几何

已核 `ComponentGeometrySnapshot` / `scope.measure` → World ports → Host alive guard → sandbox request/reply，以及 compiled Player 和 Model 共同使用的 World。测量直接读取当前正式目标的 DOM 与真实 Flow scroll owner，不保留第二位置缓存；采样同一同步 turn，iframe 变换在调用 batch 的同一 turn 捕获，返回时仍检查 mount 存活。`contentFrame` 保持 Flow 内容坐标，`contentToViewport` 与 `viewportFrame` 统一投影到调用者 viewport；跨 iframe 不混用宿主 viewport。

复用 `runtimeGeometry20261024.test.ts` 六项和 `runtimeGeometryBrowser20261024.test.ts` 一项有效证据。已核用例与 `geometry/browser-measurements.json`：覆盖真实 compiled source consumer、离屏已挂载目标、滚动后内容坐标稳定、390px 重排、实际 sandbox iframe 0.75 缩放投影、源码替换后 remount 和 dispose。未挂载目标返回明确 null，Host 退休后样本不可继续使用；没有修改作者数据或每帧持久化事务。本能力不会自动修复作品自己缓存并混用历史 slot fact 的错误。

Editor 增量接线另复用 `runtimeGeometryEditor20261024.test.ts` 及 `geometry/editor-measurements.json`。用真实 currentFlowBrowserHarness / DocumentRegistry / Driver / Bridge 观察：Flow scroll 0→200 后 contentFrame 保持，保存关闭后旧 scope.measure 返回 null，重开恢复相同 Flow 基准，390px 下 viewport 1100→390。该项证明 Editor producer 联通；此前 compiled/iframe 有效证据没有重复运行。

### 同一 realm 的资源解码复用

已核修订后的 lease 与实际 authoring URL 反查，复用 `webResourceContentLease20261024.test.ts` 和 `webResourceUrlLease20261020.test.ts` 两文件八项最终 lazy-registration 证据（覆盖此前五项，不能相加计数）。相同 source 只 atob / 构造 Blob 一次，但每个逻辑 ID / source 版本具有独立 URL，防止编辑身份错误收敛；历史 URL 保留到 scope release，逐个只释放一次；多 ID 未带 binding 的原始 source 仍保持旧的 ambiguity 语义。该缓存仅在既有消费 realm lease 内，不跨 iframe storage key，不接管正式资源。

进一步核对实际 lazy consumer：`update` 仅登记 enumerable getters；`reverse` 仅读已物化地址，避免编辑反查枚举全目录触发解码。Sandbox、owned-document、authored bootstrap 两个嵌套 producer 均接 `reverse`；compiled Player 合并地址表保留 descriptors。`compiledResourceDemand20261024.test.ts` 直接通过 compileCoursePlayback → mountCompiledCourse 证明 used=1、unused=1 只解码已用一个。显式 `Object.values` / spread 仍表示请求全表值，不把 getter 实现扩称所有资源处理入口均已按需。

### 正式树查询与导航状态通知

已核 `runtimeInstanceOwner` 索引的根 / global / 第一个实际父级顺序与原 `owningContainer` 相同；缓存按 project snapshot、instances/revision/rootIds/global 两层引用失效，不缓存动态可见性。实际 producer 使用 immutable/COW 工程与状态投影，Undo/Redo 的旧新快照分别可读，不产生第二份可写树。

`setState` 保留 exact-key subscribers、`__runtime.state`、快照隔离与互动规则准入，只过滤与导航守卫无关的导航 changed 广播。导航读取运行状态的实际入口是当前 `navigationGuards[].conditions[].key`；fragment 状态由导航写出，投影直接订阅自己的键；Runtime 能力变化、重启与视图变化原通知保留。复用 `runtimeOwnershipPerformance20261024.test.ts` / `runtimeStateNavigation20261024.test.ts` 与范围明确的 `runtime/INDEPENDENT_REVIEW.md`；后者不替代本报告对资源身份和几何的独审。

### 单文件与 Web 交付

已核 `serializeResourcePool` / closure-free restore、single HTML bootstrap、Main compiled preview 与 HTML author alias reader。池只剥离精确 Base64 本体，记录 JSON path 与原串插入 offset，保持不同 MIME 前缀、脚本及任意作者字面可逆；脚本结束符转义和原诊断 bootstrap 保留。Main 已恢复的 preview 移除 pool 避免二次插入；作者 alias 读取同一 decoded payload 属性，避免再次 stringify 巨大 DOM JSON。旧旧式非 pool 产物继续使用原结构。

Web writer 共用内容 hash，但物理 HTTP 地址按必要 MIME 区分，防 CSS / JS 同字节被错误类型响应。逻辑 ID 元数据仍独立，同内容同 MIME 复用文件与一次 fallback 编码。passive HTML/CSS/srcset/srcdoc 资源可外置；作者脚本/程序数据字符串保持原文。compiled 静态 / 同文档 HTTP 不预载 `course-assets.js`，opaque consumer 首次需要时才从相同缓存载体准备可读字节；file 用原经典脚本能力预备捕获字节，getter 内容池按读取解码。直接 Published entry 保留其原前置 bytes 合同，不给它添加不消费的新 callback。该格式仍会为 file / opaque 可用性携带二进制文件与一份 Base64 byte carrier，不能将其称为全 ZIP 字节零重复。此处只证明 Published 运行与独立 HTML 精确 DOM 编辑，未将 GLX 的原素材身份证据扩大成 HTML→GLX 原身份 roundtrip。

已复用交付作者最终十八项聚焦证据，包含 pool 可逆、失败可诊断、compiled-v2 preview、真实 Published→ZIP、真实 compiled lazy consumer、原输出与浏览器兼容检查。字体旧字符串断言按等效交付语义更新，并由真实 `font-cors-probe.json` / `font-cors-probe-after.json` 证明 opaque iframe 的必要载体；不把纯字符串检查当成字体已加载。为保普通静态服务器与 file 的实际能力，顶层字体文件与 portable 字体 CSS 有必要小重复；没有因此建立新字体调度或资源系统。

R10 另外复用新增 callback 的六项聚焦证据，以及 `canvas-resource-probe.candidate-regression-before.json` / `canvas-resource-probe.candidate-regression-after.json`。前者明确只是本轮交付优化初始候选回退：无 ACAO HTTP 两条实际 opaque Source API / passive nativeData 路径均出现 getImageData SecurityError，file 旧 fallback 可读；不是旧正式软件的已存 Canvas 故障。修后通过真实 buildComponentWebPackage、fresh official compiled Player 和 Sandbox 两路径，在 HTTP / file 四例均像素 `[255,0,0,255]` 可读，后续 actual player.update 仍使 World 目录保持 data URI（长度166），且没有 console / pageerror / failed request。此反例直接证明 native 首次资源准备保留原能力，未泛化为逐资源异步调度已完成。

### 图片衍生与正式出口

已核 `imageDerivative`、delivery encoder/cache、`imageDemand`、Published 元数据更新及正式 Renderer 三出口。普通导入与 Main admitted 保留原字节继续是正确职责；运行图片衍生在共同 Published producer 执行，GLX 仍保完整原件和编辑身份。相同源内容与转换参数共用编码工作，原 owner 的文档 / epoch / revision / pin 生命周期保留；相同字节不同文件名不决定衍生身份。裁剪只决定必要密度，不实际截掉完整载体，归一化作者裁剪仍指向同一全图。

实际 display 收集复用 `resolveComponentOuterPresentation` / Flow lane：先在局部框做 crop + contain/cover/stretch，再根据源两轴 affine 密度取必要全源分辨率，跨使用位置与有效展示状态取最大需求。未知程序用途、无界 Flow / fluid / 原生 CSS allocation 没有可靠尺寸时保原；不强制全局最长边。只在运行资产集合剔除原图恢复专用引用，其他真实消费者仍可独立使其入交付；工程引用、History 和源码路径不变。

PNG 未明确为 photo 时保持无损；透明、向量、动画及 detail/original 按明确策略处理；已损 WebP 无实际缩图需求时不反复编码。保留质量例外的正式 `imageDemands` 入参不等于自动内容分类，也不声称自动识别 lossless WebP 中的文字/细图。没有生产 caller 的 generated-image helper 只能记共用策略和返回原件能力，不写成所有导入入口已经调用；其同尺寸 lossless WebP 保原与 delivery 的可选重编码差异不影响当前生产出口。

`published-image-demand.json` 最终九项 producer 测试已核，覆盖最大状态 / crop、未知程序、affine、Flow reading/wide/full、逻辑身份和质量例外，以及 nested 同时态 / viewport fit、主题资产与 bounded 背景；原错误的新增 affine 断言经独审修正为 800×400 后通过。编码、原件、透明、detail、向量/动画、真实 v08 摄影与透明图受控视觉结果按 `images/REPORT.md` 复用；最后 unknown-PNG 策略三项直接检查通过，受影响 generated browser 单 case 在独占窗口完整重试退出成功（首次并发清理超时不计通过，未提高 timeout）。本结构结论不将受控图片样本百分比当整件 v08 资源收益。

## 最终体积追查增量签收（2026-10-24）

结论：字体选择与 Compiled Player 依赖两项增量均通过独立评审，无新增结构阻断。前述资源、几何、运行生命周期与 Canvas 的有效证据继续保留；本次没有因审查增量重新跑完整矩阵。

- **纯模型函数依赖收敛**：`publishedComponentModel` / `resolveModelPlayerPresentation` 从完整 Published / Model Player 移到唯一 `publishedProjection.ts`，函数逻辑逐行平移，只保正式 project 值 import，其余是 type import。Compiled / Model / Published / outputCapture 与直接测试改用同一 owner，无双轨状态、兼容重导出或默认 builtin fallback。独审核实际消费者与新 bundle，World、native iframe、媒体和互动执行路径保留；不使用的 Babel / KaTeX 顶层初始化特征已消失。复用作者三项直接测试与 Root 正式 `build:player`：Compiled runtime **1,610,898→1,153,391 B（−457,507 B／28.4%）**；同 gzip 6 为 443,532→316,164 B，普通 Player 4,866,186 B 不变。
- **字体动态输入判定**：原正则把两个明确的 range 控件当成无限文本输入。新实现复用既有 HTML scanner 读取真实属性，有限控件不再触发全覆盖；缺省 / 未知类型、自由文字输入、file 文件名、textarea、contenteditable、`guoling.input` 及原动态输出保护仍保 full。源码、script、事件属性与 srcdoc carrier 保留正确识别。复用作者五项聚焦测试与实际 Published 选择证据，101→24 个 Noto Sans SC 分片，字体二进制 **4,516,508→1,265,520 B**；没有为作品新增字体平台或改艺术 CSS。
- **正式 Main 导出闭合**：主制品为 `size-followup/formal-editor-workspace/coffee-v08-final-optimized.html`，不是前阶段 21.25 MB builder 副本。`size-followup/formal-export.json` 显示 status=written、零 warning / error、80 个逻辑资产 ID、projectUnchanged=true、dirty=false→false，实际嵌入新 Compiled runtime 1,153,391 B。
- **最终数据**：上述正式 HTML **16,389,609 B**，同 gzip 6 **10,604,673 B**；24 个字体分片，84 段物理 Base64 全为唯一内容、重复存储 decoded bytes=0。原正式 HTML 29,529,332 B，减少 **13,139,723 B／44.4972%**。与 CAS GLX 8,434,293 B 比原始文件为 **1.943 倍**；双方同 gzip 6（GLX 已为 ZIP，再 gzip 8,430,460 B）为 **1.258 倍**。不把 ZIP 与 raw HTML 的差异全归于运行库，也未实现新的压缩 wrapper。
- **字体实际消费与证据界限**：`delivery/export-final-font-runtime.generated/font-followup-acceptance.json` 记录最终 Web builder 的 HTTP / file 两路均 coursePlayerReady、均保留 7 个章节入口，原 water +50 得到 250g，零 page / console / failed / external request。顶层实际中文按 Noto Sans SC 加载返回 2 个 loaded faces；native water 的实际中文明确请求声明 Noto Sans SC 返回 9 个 loaded faces，两处各声明 24 片，全部已挂载 realm 无字体错误。native 作品 computed stack 仍是作者原 Noto Sans CJK SC / 系统字体，没有改作品设计。此窄验收的 chapter visits 为空，仅证明入口保留，并非重新逐章、完整三个实验或性能采样；这些属性沿本轮相应先前有效证据报告。

物理分账与剩余约 0.52 MB image factory 的 Zod 闭包成本见 `size-followup/RUNTIME_AND_FORMAT_ANALYSIS.md` 及 JSON。旧 21,253,952 B / 101 字体数据只作为第一阶段测量保留，不能再作最终制品数字。
