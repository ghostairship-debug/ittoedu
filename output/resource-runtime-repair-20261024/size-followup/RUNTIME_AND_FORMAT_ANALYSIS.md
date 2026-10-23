# 单文件 HTML 与 GLX 的运行时、格式体积拆账

**最终主制品已更新为 16,389,609 B／gzip 6 为 10,604,673 B。** 下文 21.25 MB 的详细拆账是触发本次追查的第一阶段快照；最终正式 Main 导出、字体消费和比值见文末，不能混用阶段数字。

21,253,952 B 的 HTML 不能全部用“必须自带 Player”解释。本次只读拆账确认两项真实冗余：字体动态输入误判使整套 101 个 Noto 字体分片进入交付；Compiled Player 的两个纯模型函数经完整 Player 模块导入，带入不使用的 KaTeX／Babel 初始化。后者已由实现者迁移依赖边，正式构建从 1,610,898 B 降至 1,153,391 B，减少 457,507 B（28.4%）。字体选择修复也已通过窄独审和作者聚焦验证，同一真实 Published 的选择结果降为 24 个分片；最终真实导出结果单列，不把选择器结果当成运行验收。

这里的 8,434,293 B GLX 已是 ZIP；21,253,952 B HTML 是原始 UTF-8 文本。相同 Node gzip level 6 后，HTML 为 14,036,638 B，GLX ZIP 再 gzip 为 8,430,460 B，比值由 2.520 降为 1.665。这个差距仍包含额外字体、运行库、预编译 DOM／组件实现和 Base64 的编码开销，不能把二者视为同内容、同编码的包。

## 证据与范围

- 原件：`docs/creative-production/works/coffee-journey/design/v08/native/coffee-journey-v08.glx` 与 `coffee-journey-v08-offline.html`，只读。
- 去重 GLX：`output/resource-runtime-repair-20261024/resource/coffee-journey-v08-cas-copy.glx`。
- 此报告的 21.25 MB 测量快照：`delivery/export-candidate.generated/coffee-v08-candidate-offline.html`，及同目录当次 `compiled-player.iife.js`。
- 原始、候选、GLX 的同口径解析与 gzip 6／9 数据：本目录 `runtime-and-format-analysis.json`。MB 在本报告中指十进制字节量，具体结果以 B 为准。
- 未重新构建、重新导出或启动浏览器；复用已有真实运行证据。这里只证明文件结构、编码与依赖，不用文件缩小代替交互、加载时间或内存改善。

## 实际 HTML 的可加和账目

以下直接按外层 `<script>`、字体 `<style>` 和其余 HTML 的原始 UTF-8 区段计数，合计恰为 21,253,952 B。

| 物理区段 | 原始 bytes | 独立 gzip 6 bytes |
| --- | ---: | ---: |
| course-data JSON（带 script 标签） | 9,482,257 | 5,978,947 |
| 去重资源池 JSON（带 script 标签） | 4,029,159 | 3,015,458 |
| 字体 CSS（带 style 标签） | 6,122,025 | 4,591,798 |
| Compiled Player（带 script 标签） | 1,610,915 | 443,541 |
| 错误诊断脚本 | 1,333 | 583 |
| 恢复资源池／mount bootstrap | 2,851 | 1,091 |
| HTML、基础样式、字体许可与其余标签 | 5,412 | — |

分段 gzip 各自有字典与头部，不能相加冒充整个文件的 gzip。

也可按内容本体拆为：交付资源二进制 8,986,515 B、字体二进制 4,516,508 B、二进制变成 Base64 新增 4,501,221 B、共享 Player 1,610,898 B、其余 JSON／程序／DOM／CSS／标签 1,638,810 B。它们同样合计 21,253,952 B。

物理存储已是 **161 份内容、161 份唯一二进制，重复存储 decoded bytes 为 0**。其中字体 101 份，4,516,508 B 原始字节变成 6,022,144 个 Base64 字符；课程载体资源 60 份，8,986,515 B 变成 11,982,100 个 Base64 字符。恢复对象后有 202 次语义引用，不能把这些引用重新计成磁盘上的重复资源。

## GLX 实际包含什么

去重 GLX 有 66 个物理 ZIP 条目：`project.json` 1,239,988 B、`resource-index.json` 14,796 B，以及 64 个唯一资源实体 8,473,630 B。解压总量 9,728,414 B，压缩后为 8,434,293 B。

它没有嵌入 Electron、完整编辑器或通用 Player。9 个 builtin definition 用 `kind: builtin` 与 key 指向软件已有实现；工程打开时由已安装的果铃提供这些运行库。离线 HTML 需要独立提供其实际需要的运行能力，因此增加共享 Player 和按需 builtin factory 有正当用途。

工程也保存作者自己的可编辑源码：4 个 source definition，8 个 instance source override，12 个组件文件 owner。组件文件中 JS／CSS 逻辑总量 119,372 B；JS 独特内容为 9 份、77,920 B。另有一个保留的 `source-guoling.html-program` inline source，原字符串 902,305 B，JSON 表达约 944.5 KB。它是工程里的 source implementation，不等于把宿主整套运行时写入每份 GLX。当前交付按有效实现选择，未把这个未使用 definition 的整个 inline 源码带入 compiled course。

项目资产与组件文件之间的相同二进制已经共用 ZIP 实体，不能把各逻辑分类的唯一量直接相加，误算回跨分类重复。

## HTML 里的课程、程序与预编译 DOM

下面是**恢复语义对象后**的分类，用于定位职责；这些数值存在资源语义重复，不能再次相加作为物理文件大小。

| 分类 | 内容与数量 | 去掉 Base64 本体后的 bytes |
| --- | --- | ---: |
| course | 190 个实例、10 个有效 definition、80 个逻辑资产 ID | 305,850 |
| html | 初始 materialized DOM | 328,505 |
| staticViews | 169 个静态实例的签名和状态更新模板 | 249,650 |
| nativeSources | 11 个实际原生程序编译结果 | 61,996 |
| builtinFactories | 仅 `guoling.image` 一种动态专业实现 | 545,335（JSON 表达） |
| sourceFactories、sourceStyles、webPrograms | 本例为空 | 各 2 |

`nativeSources` 在恢复对象中约 4.34 MB，主要是其中引用的图片／Base64。不是 11 份数 MB 的纯程序代码。精确相同且大于等于 128 B 的非 Base64 leaf 字符串重复量为 19,729 B，主要是视觉槽位和三个局部实验的相同小程序源；没有发现足以解释数 MB 差距的逐实例完整 runtime 复制。

`artifact.html` 是初次装配的 DOM；`staticViews` 由 `compiledPlayer.update()` 在实例状态签名变化时更新相应片段，课程正式数据则继续供 World、导航、交互、布局和作者记录投影消费。三者有内容交叠，但都有实际 consumer。这里不足以据此删掉整个 course、静态模板或运行 owner。

项目与发布物的“资源二进制”也不完全相同。本次 exact-content 集合比较，发布资源比 GLX 实体增加 1,091,097 B、移除 578,212 B，净增 512,885 B。新增包含四份实际 WebP 衍生结果 1,025,946 B 及编译程序里的 JSON carrier；原素材仍可能由独立程序导入使用，源码文件则转为编译代码。不同编码的同一视觉来源不能按哈希视为同一二进制；这不是剩余的重复 Base64。没有证据可以直接删除仍被局部程序消费的原件。

## 共享 runtime 的真实冗余与修复

正式 HTML 只装入 1,610,898 B Compiled Player，没有同时装入 4,866,186 B 普通 Player。静态入口闭包与实际 bundle 未发现 React／ReactDOM、ProseMirror、GrapesJS 编辑器运行库。代码里带 authoring 字样的一些模块负责在播放内容中应用已保存的 DOM／文字／资源修改，有实际 consumer，不能仅凭名字将其视为无用编辑器。

已证实的无用链路是：

`compiledPlayer → ModelPlayer／publishedPlayer（只取两个纯模型函数）→ ComponentPlatformRuntime → defaultBuiltinRuntimeImplementations → text runtime／input index barrel → KaTeX／input authoring → courseV10Operations／references → Babel parser`。

Compiled Player 自己创建 World，并从 `artifact.builtinFactories` 选择按需专业实现，不调用这条完整默认 builtin registry。原 bundle 却保留了 KaTeX 顶层注册和 Babel 初始化；例如可独立定位的 Babel 错误表 11,681 B、KaTeX SVG 字典 15,474 B、数学解析器类 10,389 B。这些是存在下限，不用它们估算整库收益。

实现者已把原函数逐行移到 `publishedProjection.ts`：只有正式 project 语义的值 import，其余为 type import。Compiled／Published／Model／outputCapture 与直接测试改用同一个 owner，没有另存 projection 状态或兼容重导出。独审通过；作者 3 项直接行为验证通过。Root 的官方 `build:player` 实际输出 **1,153,391 B**，减少 **457,507 B／28.4%**，普通 Player 不变。同 gzip 6 从 443,532 B 减为 316,164 B；原先确认的 Babel／KaTeX dead literal 在新包中均为 0。它关闭了确认的依赖冗余，没有裁减 World、native iframe 或媒体生命周期能力。

另一个独立、已量化的开销是 image factory：原字符串 519,123 B，按真实 esbuild 模块边界有 Zod core／其它 269,478 B、53 个 locales 模块 231,653 B、项目实现 17,571 B、其余 wrapper 421 B。它没有 Babel／KaTeX，也没有逐图片实例复制。本轮不为它建设共享依赖平台；它是后续可单独处理的打包成本，不能当成当前 2.5 倍的主要解释。

## 压缩选择的实际量级

| 同口径 | 原正式 HTML | 21.25 MB 候选 HTML | CAS GLX |
| --- | ---: | ---: | ---: |
| 原始文件 | 29,529,332 | 21,253,952 | 8,434,293 |
| gzip level 6 | 20,232,982 | 14,036,638 | 8,430,460 |
| gzip level 9 | 20,229,621 | 14,033,323 | 8,430,460 |

Level 9 比 6 仅额外省候选 HTML 的 3,315 B，不是有价值的主要方向。Web 服务器的 gzip 可节省传输，直接双击本地 `.html` 不会自动解压 `.html.gz`；两者不能混称为单文件离线交付。

如把整份 14,036,638 B gzip 再变为 HTML 可内嵌的 Base64，仅 carrier 已需 18,715,520 B，约比当前 raw HTML 少 2.54 MB，尚未加入 bootstrap。课程 JSON、pool 与 runtime 分开压缩也需各自 Base64：runtime 1,610,898→gzip 443,532→Base64 591,376 B；pool 4,029,092→gzip 3,015,395→Base64 4,020,528 B，几乎没有净收益；字体 style 压缩再 Base64反而略大。这些是纯 Node 尺寸试算，没有测启动 CPU／峰值内存，不冒充可直接交付的压缩版。

现行正式编译 target 是 Chrome 113。Chrome 官方文档说明 `CompressionStream`／`DecompressionStream` 的 gzip 能力从 Chromium 80 提供，因此使用浏览器原生解压无需把额外 JS 解压库塞进文件。[Chrome 官方依据](https://developer.chrome.com/blog/compression-streams-api?hl=en)。但落地仍会改变 bootstrap、JSON 读取、静态 preview 与轻量 HTML 编辑 consumer，并增加解压工作；在字体错误和实际 dead import 已明确的情况下，未证明需要先加入这样的 wrapper，本轮未实现。

## 字体选择增量独审

原正则的“无 type”分支也能匹配明确写了 `type=range` 的标签，实际 Published 只有两条 range 控件触发 `dynamic=true`，11 份 native compiled code 没有其它动态触发。此处是通用软件判定错误，不是作品必须携带完整字体的需求。

新代码复用既有 HTML scanner，按解码后的 type 属性分类，保留 missing／unknown type、text／search／email／url／tel／password、textarea、可编辑区域以及 `guoling.input` 的完整覆盖。有限 range／number／button 等控件不再把字体覆盖扩大为无限文本；script／source／code／srcdoc／事件属性中的 HTML 仍沿相同 carrier 处理，原有 fetch／String 字符生成等未知输出保护保留。没有新增字体平台或程序数据流分析。

作者 5 项聚焦测试通过，独审检查了大小写、字符实体、缺省与未知类型、伪标签、单双引号和 escaped source、自由输入保 full 的真实反例。同一真实 pre-selection Published 选择结果由 101 份／4,516,508 B 降至 **24 份／1,265,520 B**；对应 Base64 由 6,022,144 减为 **1,687,396** 字符。选择器层减少 3,250,988 B 字体二进制、4,334,748 字符 carrier。来源见本目录 `font-summary.json`。这仍不是最终重新生成 HTML／浏览器实际字体加载后的体积或行为签收，不能直接覆盖前面的 21.25 MB 快照。

## 当前结论

必须保留的是实际交付资源、运行 owner、有效局部程序和独立运行需要的字体覆盖；Base64 4/3 是当前文本载体的直接成本。已经确认可消除的是错误的整字体覆盖，以及两个 pure helper 造成的无用 runtime 依赖。已证实的 457,507 B runtime 减幅和后续字体实际导出数据应分别报告，再重算最终 HTML／GLX 比值。

仍有约 0.52 MB 的 image 实现编译闭包、少量相同小程序代码及 materialized DOM／模板的职责交叠。它们有具体量级与 consumer 边界；当前证据不足以据此全局重写 Player、删 course 元数据或引入一套新交付平台。

## 最终正式主制品（字体与依赖修复后）

主数据来自 `size-followup/formal-editor-workspace/coffee-v08-final-optimized.html`；正式 Main 的 `formal-export.json` 为 written、零 warning / error、80 个资源 ID，projectUnchanged=true、dirty=false→false。`delivery/export-final-font-runtime.generated/delivery-metrics.json` 的 **formalAfter** 是下表主列。相同软件的独立 builder HTML 为 16,393,489 B，比正式主制品大 3,880 B；不把两者互换。

| 同口径 | 原正式 HTML | 第一阶段快照 | 最终正式 Main HTML | CAS GLX |
| --- | ---: | ---: | ---: | ---: |
| 原始 bytes | 29,529,332 | 21,253,952 | **16,389,609** | 8,434,293 |
| gzip level 6 bytes | 20,232,982 | 14,036,638 | **10,604,673** | 8,430,460 |
| 字体分片 | 101 | 101 | **24** | 不携带宿主字体 |
| 字体 binary bytes | 4,516,508 | 4,516,508 | **1,265,520** | 0 |
| 物理 Base64 段／唯一内容 | 202／161 | 161／161 | **84／84** | 二进制 ZIP 实体 |

最终正式 HTML 相对原件减少 **13,139,723 B／44.4972%**；相对第一阶段减少 **4,864,343 B**。其中确认修复的字体 CSS 区段由 6,122,025→1,719,070 B（包含 style 标签），共享 runtime 脚本由 1,610,915→1,153,408 B。正式导出与 builder 的少量 Base64／bootstrap 差异单独保留，未归为新的图片优化收益。

最终可加和物理账目为：course-data 9,479,133 B、pool 4,029,159 B、字体 CSS 区段 1,719,070 B、Compiled runtime 区段 1,153,408 B、诊断 1,333 B、mount 2,095 B、其余 HTML / notices 5,411 B，总计 **16,389,609 B**。84 个唯一二进制共 10,249,691 decoded B，物理重复为 0；80 个资产逻辑身份保持。降低字体覆盖后唯一内容减少，不能把 161→84 说成删除作品素材。

所以最终 HTML／CAS GLX 的 raw 比值为 **1.943**，双方同 gzip 6 为 **1.258**。剩余差异包括独立运行需要的字体和 Player、编译 DOM／实现与编码表达；不存在“HTML 比 GLX 大的全部量都是不可避免”的结论，也没有为了接近 ZIP 尺寸而新增 gzip bootstrap。最终 Web ZIP 为 **20,856,940 B**，仍保留 file / opaque 字节载体与必要字体双消费，不能宣称整包零重复。

实际字体证据复用 `font-followup-acceptance.json`：最终 Web builder 在 HTTP / file 两路均 ready，顶层实际中文按声明 Noto Sans SC 得到 2 个 loaded faces，native water 的实际中文明确请求同一声明字体得到 9 个 loaded faces，各声明 24 片；没有 fontface / console / page / failed / external request 错误。native 的 computed stack 仍是作者原 Noto Sans CJK SC / 系统字体，未改艺术设计。HTTP / file 两路均保留 7 个章节入口，原 water +50→250g；本次 chapter visits 为 0，未重新逐章、三个实验、Canvas 或性能测试。它补足字体 / runtime 增量的真实消费属性，不能代替其他验收。

字体与 pure-helper 两项增量均独审通过，无新增结构阻断。评审者只更新报告与 JSON，没有修改产品、原作品或重新执行有效检查。
