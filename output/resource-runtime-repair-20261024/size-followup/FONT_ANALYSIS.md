# 字体体积追查与输入类型修复

结论：21,253,952 字节的前轮单 HTML 中，Noto Sans SC 字体 CSS 占 6,121,992 字节（28.804%）。两处 `type="range"` 控件被旧正则误判为任意文字输入，使既有 unicode-range 筛选失效，101 个已安装分片全部嵌入。通用判定已修复；实际选择由 101 个分片、4,516,508 字节变为 24 个分片、1,265,520 字节。随后正式 Main→HeadlessRenderer 导出实测 HTML 为 16,389,609 字节，包含相同 24 个分片，字体 CSS 为 1,719,037 字节；其中还包含独立实施的 Player 依赖瘦身收益。

## 三种载体中的字体账目

以下交付物是本轮资源去重完成、字体误判修复之前的稳定候选；正式 v08 工程只读。

| 载体/观察范围 | 字体情况 | 字节数 |
| --- | --- | ---: |
| 正式 GLX | 未登记字体资产；编辑器复用软件安装的字体 | 0 |
| 单 HTML 整个文件 | 已包括 Player、内容、图片、字体等 | 21,253,952 |
| 单 HTML 字体 CSS | 101 个字体分片的 CSS 与 Base64 | 6,121,992 |
| 单 HTML 字体二进制 | Noto Sans SC 的全部 101 个已安装分片 | 4,516,508 |
| 单 HTML 字体 Base64 本体 | 二进制经 Base64 的文字膨胀 | 6,022,144 |
| Web 独立字体文件 | 同一字体二进制，供主文档按字符加载和缓存 | 4,516,508 |
| Web `course-fonts.js` | 供 origin=null 的隔离组件使用的可缓存字体载体 | 6,123,041 |
| 既有 HTTP 功能验收实际请求 | 首屏加水实验所用 9 个分片 | 493,328 |

GLX 与单 HTML 的体积比还受 ZIP 压缩、Base64、内置运行时和离线字体依赖共同影响。GLX 依赖已安装软件，离线 HTML 需要携带运行依赖。不能直接把两者原始文件大小差额都认作图片压缩不足。运行时与其余载体的拆账见同目录 `RUNTIME_AND_FORMAT_ANALYSIS.md`。

Noto 的最大分片文件编号为 119，实际描述符数量为 101；编号并不连续。全部 101 个已嵌入字体均与已安装分片对应。此前浏览器实际请求的 9 个分片只覆盖那次验收访问的文字；全课静态编译标记本身已需要 20 个分片、1,112,048 字节。最终选择还需要程序字面量、运行状态和控制台文字，因此采用实际选择器得到的 24 个分片。

## 精确根因和作品证据

旧正则的前半段 `[^>]*` 可以吞掉 `type="range"`，后半段的“未指定 type”替代分支又能匹配空串。结果 range、number、button、hidden 等控件都会令 `dynamic=true`。

还原字体选择前 Published 后，只有以下两个路径触发该判定：

| 路径 | 原作者 HTML 行 | 实际控件 |
| --- | ---: | --- |
| `instances["aee929af-3338-409a-a386-bcbef0d0e285"].data.html` | 202 | `id="roast-range" type="range" min="0" max="100"` |
| `instances["8f45751d-9cc3-49dd-ba88-c645759f022c"].data.html` | 94 | `id="water-range" type="range" min="0" max="100"` |

11 份原始 native compiled code 和原作者 workspace 文件均没有命中现有 `fetch`、`String.fromCharCode/CodePoint`、XMLHttpRequest、WebSocket、document.write 动态保护。作品没有原生 `guoling.input` 实例。此次修复直接消除软件的输入类型误判，没有修改作品代码、滑块交互或字体设计。

统计还原使用已导出候选保留的 11 份 native compiled code，并回填正式工程的实现定位元数据；一份 compiled CSS 中的资源 URL 已经变成 `cw-delivery:` 引用，因此还原数据不主张全字段原字节相同。它不影响上述输入控件、动态调用或 CJK 字符统计。全量触发路径和片段见 `font-analysis-before.json`，修后结果见 `font-summary.json`。

## 实施及现有机制复用

修改只涉及 `src/renderer/export/bundledFontSelection.ts` 和对应单元测试。

- 复用已有 `scanHtmlSource`，按真实标签和已解码的 type 属性判定。
- range、number、button、hidden 及其他有限/非文字控件保留字符范围筛选。
- text/search/email/url/tel/password、缺省或未知 type、textarea、显式 contenteditable 保留完整字库。
- file 控件可显示用户任意 Unicode 文件名，继续保留完整字库。
- `guoling.input` 继续保留完整字库：实际 runtime 使用 `input.type='text'`，数字答案只设置 `inputMode='decimal'`。
- HTML 的 script、srcdoc、内联事件，以及现有 source/code/module 字符串中的常见 JS 转义引号沿同一判定处理；普通 HTML 的反斜杠不会被当作合法引号。
- 原有未知动态 I/O 和字符生成调用保护全部保留。

后续仍由原来的 `unicodeRangeIntersects`、`resolveEmbeddedBundledFonts`、Fetch 字体字节缓存和字体 CSS 写入链路负责选片、读取与交付；没有添加字体资源管理器或新的字体状态。

## 最低成本验证和量化结果

`npx vitest run tests/unit/bundledFontSelection.test.ts --reporter=verbose`：5/5 通过，日志 `font-selection-tests.txt`。覆盖有限控件、真自由输入、未知 type、实体解码、contenteditable、嵌套 HTML/脚本、JS 转义引号、原生数字输入和既有动态保护。

| 同一 pre-selection Published 输入 | 修前 | 修后 |
| --- | ---: | ---: |
| `dynamic` | true | false |
| 统计码点 / CJK 码点 | 744 / 623 | 744 / 623 |
| 实际选中分片 | 101 | 24 |
| 选中字体二进制字节 | 4,516,508 | 1,265,520 |
| 对应 Base64 本体字符 | 6,022,144 | 1,687,396 |

选择器层面减少 3,250,988 字节字体二进制（71.98%）与 4,334,748 个 Base64 字符。本轮没有重跑既有性能矩阵。

## 正式出口后的实测

正式 Main 导出收据为 `formal-export.json`，输出 `formal-editor-workspace/coffee-v08-final-optimized.html`；只读正式作品的已验收副本，revision 247，未改变 dirty 状态或资产身份。静态量化结果在 `../delivery/export-final-font-runtime.generated/delivery-metrics.json` 的 `formalAfter`，同目录 `after` 是源码 builder 的 Web 配套 HTML，两者分别记录。

| 实测项目 | 前轮资源去重候选 | 本轮最终 |
| --- | ---: | ---: |
| 单 HTML（正式 Main 最终） | 21,253,952 | 16,389,609 |
| 同一 Node 默认 gzip level 6 | 14,036,638 | 10,604,673 |
| 字体分片 / 二进制字节 | 101 / 4,516,508 | 24 / 1,265,520 |
| 字体 CSS 字节（不含 style 标签） | 6,121,992 | 1,719,037 |
| Compiled Player 源码字节 | 1,610,898 | 1,153,391 |
| Web ZIP | 27,668,927 | 20,856,940 |

正式最终 HTML 相比原始 v08 的 29,529,332 字节减少 44.497%；同 gzip 从原始 20,232,982 降到 10,604,673。最终 HTML 中物理 Base64 为 84 份、84 份唯一内容，重复二进制存储为 0。CAS GLX 为 8,434,293 字节（它已经 ZIP 压缩），同 gzip 为 8,430,460 字节；最终 HTML 的原始体积比为 1.943，同 gzip 体积比为 1.258。

最终 HTML 外层可加和区段：course-data 9,479,133 字节、资源池 4,029,159 字节、字体 CSS 含标签 1,719,070 字节、Player 含标签 1,153,408 字节、诊断脚本 1,333 字节、mount 脚本 2,095 字节、其余 HTML/样式/许可 5,411 字节，合计 16,389,609。字体减少、Player 依赖修复和资源去重分别有实际来源，文件比值仍包含载体格式与运行依赖差异。

新 Web ZIP 保留 HTTP 独立缓存文件以及 file/opaque realm 所需 portable 脚本。字体独立文件合计 1,265,520 字节，portable 字体脚本为 1,719,316 字节；资源独立文件仍为 55 份唯一内容、8,921,364 字节。资源/字体 portable 通道的必要重复已经在既有实际 consumer 证据中说明。

## 文字范围合同和剩余边界

既有机制按已知文字及 unicode-range 选择分片；一个分片也包含当前文字之外的许多字形。全部章节/源码字符串都进入扫描，程序中暂未显示的已知文字也能保留。真实自由输入和被现有规则识别为未知动态输出的项目保留全家族。

任意 JavaScript 拼接或外部状态的文字集合并不能从这些启发式规则完整证明。本轮没有删除动态保护，也没有宣称已完成 JavaScript 文字数据流分析。常见 JS 引号处理只服务于实际源码载体中的 HTML 属性解析。

GLX 编辑后再次导出会按新内容重新选择字体。独立 HTML 的轻文字编辑目前不会在线扩充其内嵌字体集合；用户增加超出交付物覆盖的新字形时，可能采用系统回退字体。这是既有静态导出/轻编辑的能力边界，应单独描述，不能把删去任意未来可用字形当作无代价优化。当前 v08 的已知内容和交互由正式出口后的最窄字体/实验验收确认。
