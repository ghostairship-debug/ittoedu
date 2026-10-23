# 最终资源、字体与 Runtime 交付验证

正式 Main `document.export → HeadlessRenderer` 的最终 HTML 为 **16,389,609 字节**，相对原始 v08 HTML 的 29,529,332 字节减少 **44.497%**；同一 Node gzip level 6 为 10,604,673 字节，相对原始 20,232,982 字节减少 9,628,309 字节。

正式出口收据：`../size-followup/formal-export.json`。主最终文件：`../size-followup/formal-editor-workspace/coffee-v08-final-optimized.html`。工程 revision 247、资产 ID 与 dirty 状态均保持不变。正式 v08 原件没有修改。

## 最终交付物和证据

| 结果 | 位置 | 实测 |
| --- | --- | ---: |
| 正式 Main 离线 HTML | `../size-followup/formal-editor-workspace/coffee-v08-final-optimized.html` | 16,389,609 B |
| 源码 builder 配套 HTML | `export-final-font-runtime.generated/coffee-v08-candidate-offline.html` | 16,393,489 B |
| 最终 Web ZIP | `export-final-font-runtime.generated/coffee-v08-candidate-web.zip` | 20,856,940 B |
| 正式 Main/源码 builder 同口径拆账 | `export-final-font-runtime.generated/delivery-metrics.json` | `formalAfter` 为主最终 HTML |
| 原始导出、编译事件与输入来源 | `export-final-font-runtime.generated/export-results.json` | diagnostics 与 browserEvents 均为空 |
| HTTP/file 字体和基本运行验收 | `export-final-font-runtime.generated/font-followup-acceptance.json` | 两出口通过 |

源码 builder 和正式 Main 分别记录，没有要求二者字节相同。前轮 `export-candidate.generated/` 及其 21,253,952 B HTML 完整保留，继续作为资源去重阶段证据。

## 文件拆账

正式最终 HTML 中的实际外层区段：

| 非重叠区段 | 字节 |
| --- | ---: |
| course-data（含 script 标签） | 9,479,133 |
| course-resource-pool（含 script 标签） | 4,029,159 |
| 字体 CSS（含 style 标签） | 1,719,070 |
| Compiled Player（含 script 标签） | 1,153,408 |
| 诊断与 mount 脚本 | 3,428 |
| 其余 HTML、样式与字体许可 | 5,411 |
| 合计 | 16,389,609 |

正式最终有 84 份物理 Base64 内容、84 份唯一内容，重复二进制存储为 0；80 个逻辑资产保留。字体由 101 个分片、4,516,508 B 缩为 24 个分片、1,265,520 B；CSS 减少 4,402,955 B。Compiled Player 从 1,610,898 B 缩至 1,153,391 B，减少 457,507 B。剩余差异来自必要运行依赖、预编译内容、Base64 与 ZIP 等载体格式。

最终 Web ZIP 比前轮 27,668,927 B 减少 6,811,987 B（24.620%）。它有 55 份独立唯一资源文件、合计 8,921,364 B，独立资源目录的重复二进制为 0；主 HTML 为 2,812,395 B，portable asset 脚本为 11,910,378 B，独立字体合计 1,265,520 B，portable font 脚本为 1,719,316 B。

HTTP 静态消费采用独立可缓存资源。既有同步完整目录、opaque iframe 的 Canvas 与字体能力仍需要 portable 通道；Web ZIP 同时携带的独立资源和 portable 脚本因此有必要传输重复。该限制和原真实 consumer 证据继续有效，没有把最终 Web ZIP 宣称为全部物理内容只存一次。

## 受影响行为验收

在普通无 CORS 头的静态 HTTP 与离线 file 两种环境下，保留七个章节链接、Player ready、一次真实第六章导航和水实验 `+50 → 总量250`。没有重跑旧七章/三个实验完整矩阵和四路 Canvas fixture；相关代码未改变，复用既有有效证据。

字体验证使用实际可见中文文本调用 `document.fonts.load`，要求返回声明过且 `status='loaded'` 的 FontFace，避免单独 `check()` 的系统回退假阳性。主 Flow 声明 24 个 Noto Sans SC 分片，实际 load 返回 2 个 loaded 分片；水实验隔离 realm 声明相同 24 个分片，明确请求 Noto Sans SC 后返回 9 个 loaded 分片。作品原 CSS 的 computed stack 是 Noto Sans CJK SC/系统 sans，保持原样；此项证明隔离 realm 的字体字节通道与覆盖可用，不改变作品选用字体。

两出口均为 font face error、console error、pageerror、failed request、外网请求 **0**。HTTP/file 截图已查看，布局、中文与图像正常。所有导出和验收浏览器、服务器及 Node 进程已退出，CPU 窗口已交还 Root。

最终 HTML 的加载/持续运行性能由性能叶子单独测量；此处没有用导出耗时或文件缩小冒充播放性能改善。
