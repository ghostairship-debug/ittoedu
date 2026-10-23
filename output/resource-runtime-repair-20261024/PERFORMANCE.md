# 资源与性能对照

2026-10-24。所有正式作品只读；原始证据、脚本和测试副本位于本目录对应子目录。数值按各自证据边界使用，不把 helper、Node codec、实际 Electron、裸 HTML 和艺术路线验收混为一层。

## 资源体积

| 指标 | 修前 | 修后 | 实际变化 |
| --- | ---: | ---: | --- |
| GLX 文件 | 17,502,438 B | 8,434,293 B | -9,068,145 B / -51.8108% |
| GLX 逻辑资源条目 | 114 | 114 | 80 项目 ID + 34 组件文件，身份保留 |
| GLX 物理资源条目 | 114 | 64 | 同内容共享实体 |
| GLX 唯一资源原始字节 | 8,473,630 B | 8,473,630 B | 无原件损失或降质 |
| GLX 重复实体原始字节 | 9,116,052 B | 0 B | 清除项目/组件及跨 ID 重复 |
| 正式 Main 单文件 HTML | 29,529,332 B | 16,389,609 B | -13,139,723 B / -44.4972% |
| 同算法 gzip HTML（Node level 6） | 20,232,982 B | 10,604,673 B | -9,628,309 B / -47.59% |
| HTML 实际储存 Base64 段 | 202 | 84 | 包括 bare pool，不漏计隐藏池 |
| HTML 唯一二进制内容数 | 161 | 84 | 减少的 77 项全为不需要的字体分片 |
| HTML 重复储存的 decoded 字节 | 6,222,390 B | 0 B | 16 个池条目恢复 57 处使用 |
| HTML 唯一 decoded 字节 | 13,500,679 B | 10,249,691 B | -3,250,988 B，全为误带字体 |
| Noto Sans SC 字体分片/二进制 | 101 / 4,516,508 B | 24 / 1,265,520 B | 保留全作品需要字形与真正动态文字边界 |
| standalone compiled runtime | 第一阶段 1,610,898 B | 1,153,391 B | -457,507 B / -28.40% |

GLX 资源字节统计排除 project.json；旧诊断把 project.json 算入全 ZIP 唯一内容的 9,713,618 B 与此处资源专用口径不同。HTML 的收益主要来自去重复，不能把 GLX 原图→WebP 的既有收益再次算成比旧 HTML 新增的压缩收益，也不能用受控小图实验的 70% 代替整作改善。

资源证据：resource/archive-results.json、cold-open-results.json、RESULT.md；最终 HTML/Web 证据：delivery/export-final-font-runtime.generated/delivery-metrics.json（formalAfter 为正式 Main HTML，after 为 Web 配套 Chromium builder）、size-followup/formal-export.json。前一阶段 21,253,952 B 候选和正式 Main 21,250,072 B 已保留，不能称为最终文件。资源身份的 hash/字节对照只用于本轮明确要求的完整性和原件不变，不代替功能或视觉判断。

## HTML 与 GLX 为什么还有差距

GLX 是 ZIP，存作者源码、项目结构和资源；内置软件 Player 与应用字体由安装提供，并未全部放入 GLX。独立离线 HTML 必须携带运行所需依赖。修前字体误判和依赖入口的冗余属于真实软件缺陷，不能用格式差异解释掉；两者现已修复。

最终 HTML 物理拆账：course-data 9,479,133 B，资源池 4,029,159 B，字体 style 1,719,070 B，Player script 1,153,408 B（含标签；bundle 本体 1,153,391 B），其他 bootstrap/HTML 共 8,839 B。全部资源二进制用 Base64 储存为 13,666,372 字符，因此未压缩 HTML 大于已压缩 ZIP 是明确的载体成本。

同算法 gzip6 后，最终 HTML 为 10.605 MB，GLX 同 gzip 对照 8.430 MB，约 1.258 倍，已经不是三倍。HTML 仍额外携带字体/Player和必要编译输出；其资源集合与原始组件文件编码也不完全相同。这里的 gzip 是对照/HTTP 可用压缩量，实际可双击的 HTML 文件仍是 16.390 MB；没有暗中换成需解压脚本的新 HTML 格式。最终未压缩 HTML 也小于原 17.502 MB GLX。

## 图片：真实出口与受控显示需求分开

真实 v08 出口保留全部 80 个逻辑资源。因源码/主题/布局的未知用途或实际显示需求，主要素材没有自动缩小分辨率。正式 Main 四张 JPEG 相对正式 GLX 原图转换为 WebP，共减少 215,196 B；旧正式 HTML 本来已做 WebP，所以不是本轮旧 HTML 对照的净节省。

| 素材（ID 前缀） | GLX 原图 | 本轮实际 HTML | 像素尺寸 |
| --- | --- | --- | --- |
| fed66d 摄影 | JPEG 662,516 B | WebP 596,798 B | 1371×2048，保留 |
| c48a15 摄影 | JPEG 164,465 B | WebP 102,798 B | 1440×1080，保留 |
| 52fcB4 摄影 | JPEG 172,636 B | WebP 123,808 B | 1440×958，保留 |
| d8b7eb 摄影 | JPEG 239,181 B | WebP 200,198 B | 1440×956，保留 |
| 4aa58f 主图 | JPEG 472,853 B | JPEG 472,853 B | 1440×810，保留原件 |
| d9ecde 透明图 | WebP 487,458 B | WebP 487,458 B | 1254×1254，保留 |

下表是实际 production encoder 在已知展示需求下的 Chromium 对照，不是整作自动导出的效果：

| 受控样本 | 原图 → 衍生 | 字节减少 | 同展示 RGB 平均绝对误差 |
| --- | --- | ---: | ---: |
| v08 摄影 | JPEG 1371×2048 / 662,516 B → WebP 720×1076 / 195,768 B | 70.45% | 5.04 / 255 |
| v08 透明素材 | WebP 1254² / 487,458 B → WebP 640² / 137,468 B | 71.80% | 0.957 / 255 |
| 文本/细图 | PNG 2400×1600 / 89,368 B → PNG 1200×800 / 61,081 B | 31.65% | 0.016 / 255 |

图片对照截图已目检，透明边缘/文本线条保留；实际 Editor 首章与 HTTP/file 水洗实验截图保留。尺寸/DPR、crop、Flow reading/wide、非均匀 affine、nested state/fit、Spatial/主题未知用途、动画/向量和质量例外有针对性行为检查。没有通过缩成几十 KB 或丢功能来制造体积结果。

## Web 包的真实成本

最终 Web ZIP 为 20,856,940 B，83 个条目；55 个独立 asset 文件共 8,921,364 B，实体目录重复 0 B。index.html 2,812,395 B；portable asset script 11,910,378 B；portable font script 1,719,316 B；独立字体二进制 1,265,520 B。第一阶段的 27,668,927 B / 160 条目保留为中间候选。

普通 HTTP 静态消费者使用独立缓存资源。本例首次 opaque 程序仍要按原同步目录合同加载一次 portable captured-byte script；file 协议沿相同载体支持双击离线。第一阶段 HTTP 实测请求 7 个独立 asset、9 个字体及 1 次 native portable script；file 载体 1 次、外部请求 0。Canvas 四路实际行为证据仍有效；最终字体改动另以 HTTP/file 的顶层中文、native 水实验实际中文 FontFaceSet.load 及七章就绪验证，均 loaded、0 字体/页面/请求错误。

因此独立资源目录已去重，整个 ZIP 仍有支持 file/opaque 的明确传输重复，不能称为全包零重复或所有图片逐项异步读取。没有旧同款 Web ZIP 基线，不给其虚构压缩百分比。脚本内可能被作者计算的 dataURI 字面量保留。

## 固定环境与基线

裸 HTML：Playwright Chromium 149.0.7827.55，headless、DPR=1、CPU 不限速、offline；desktop 1440×900，mobile 390×844。cold=新浏览器/上下文；没有清 OS 文件缓存。cache=同浏览器/上下文完整加载后重载。before/after 使用同脚本、采样/trace 和输入。单次数据不证明普遍分位数。

滚动以真正设置 scrollTop 的主 owner RAF 为口径，不用 actor iframe 的 RAF 冒充 Flow 帧率；RAF 间隔是调度/长帧代理，不是 GPU 呈现帧认证。CDP Script/Task duration 仅各自窗口增量；多 iframe 累计事件与主线程数字不相加。旧诊断的约 8.2s / 23s 不作为本轮改善分母。

具体加载、持续滚动、cache 和实际输入对照在下节最终实测表；原始 trace/CPU 和脚本保留在 performance/，可以用 Chromium DevTools 打开。首次可点击响应回执不是标准化 TTI，也不以 DCL 代替可交互。

## 最终正式 HTML：同条件 cold 与真实输入

| 指标 | desktop 修前 → 最终 | mobile 修前 → 最终 |
| --- | ---: | ---: |
| DOMContentLoaded | 5.545 → 2.752s | 6.112 → 2.002s |
| 首屏主 IMG LCP | 5.440 → 2.624s | 5.996 → 1.900s |
| actor 三份材料就绪 | 12.171 → 5.381s | 19.855 → 4.184s |
| 启动最长 long task | 5.024 → 2.190s | 5.585 → 1.540s |
| 7s 滚动 owner RAF 间隔数 | 56 → 325 | 35 → 372 |
| mean / p95 | 126.8 / 166.6 → 21.59 / 50.0ms | 204.8 / 366.7 → 18.91 / 16.8ms |
| max / >50ms 数 | 166.7 / 50 → 150 / 16 | 450 / 32 → 83.4 / 12 |
| CDP ScriptDuration 增量 | 6.670 → 4.630s | 6.790 → 3.626s |
| CDP TaskDuration 增量 | 7.283 → 6.521s | 7.441 → 5.160s |
| 页面错误 | 0 → 0 | 0 → 0 |

最终桌面材料就绪快55.8%，移动宽度快78.9%；同窗口滚动 ScriptDuration 分别降低30.6%/46.6%。最终桌面滚动这一单次样本比第一阶段略慢，字体/bundle 变小不能包装为持续滚动普遍再加速。主 owner 平均约46/53次回调每秒，并非GPU FPS；最终仍有150/83.4ms长间隔，不能签稳定60fps。

最终正式 Main HTML 又完成原十项真实鼠标检查：七章导航、u03水洗/明细/比较、u05正反切换、u06加100g后300g/3g/1.00%；13张已挂载图片完成、0页面错误/网络请求、1440px无横向溢出。首导航响应回执5.515s、点击到响应205ms，对照修前22.000s/448ms。最终390px有cold/滚动画面证据，未冒充物理触屏。

原脚本/条件未变，最终只补desktop/mobile cold及一次十项输入；未重复旧包、cache或无关矩阵。证据 `performance/final-followup.json`、`FINAL_PERFORMANCE.md` 及 final-desktop/mobile/functional.json，phase1旧全文另存 `PHASE1_PERFORMANCE.md`。

## 第一阶段热点与缓存证据（21.254 MB 中间候选）

| 指标 | desktop 修前 → 第一阶段 | mobile 修前 → 第一阶段 |
| --- | ---: | ---: |
| DOMContentLoaded | 5.545 → 5.586s | 6.112 → 2.680s |
| 首屏主 IMG LCP | 5.440 → 5.448s | 5.996 → 2.556s |
| actor 三份材料就绪 | 12.171 → 8.823s | 19.855 → 5.616s |
| 7s 持续滚动 owner RAF mean / p95 | 126.8 / 166.6 → 20.2 / 49.9ms | 204.8 / 366.7 → 20.7 / 50.1ms |
| 滚动最大间隔 / >50ms 数 | 166.7 / 50 → 116.6 / 15 | 450 / 32 → 116.8 / 17 |
| 同窗口 CDP ScriptDuration 增量 | 6.670 → 3.929s | 6.790 → 4.331s |
| 同窗口 CDP TaskDuration 增量 | 7.283 → 5.702s | 7.441 → 6.061s |
| 启动最长 long task | 5.024 → 1.887s | 5.585 → 2.181s |

原最大 CPU 自耗时 findInstanceParent 全实例扫描在两种宽度分别占约 6.02 / 7.02s，修复后不再居前；桌面持续滚动 ScriptDuration 降低 41.1%、移动宽度 36.2%。这两项为本阶段 Profiler 窗口实际 CPU 工作时间，不是整机 CPU 百分比。7 个 sandbox bootstrap handler tracing 累计 5.489→1.971s / 11.638→1.744s，证明资源初始化的热点下降；多 realm 包含时间不能相加为主文档 wall time。

同上下文桌面 cache：DCL 5.869→2.705s，LCP 5.420→2.348s，材料 13.683→5.714s。缓存结果只适用于这一中间候选；最终字体/纯函数依赖后续改变了首开相关制品，最终 cold 单独测量，不把 cache 复测一整套或将旧 cache 称为最终数值。

第一阶段七章导航/三实验十项真实输入修前修后均通过，13 图已解码、0 error/离线请求。首次实际导航响应回执 22.000→5.021s，点击到滚动响应 448→198ms；这是保守可交互行为，不是标准化 TTI。

## GLX 冷开、编辑与保存

实际 Electron 新进程、新 profile、同未改名 GLX 副本/窗口请求，排除已知并发 CPU 样本后的一组有效对照：

| 阶段 | 修前 | 候选 |
| --- | ---: | ---: |
| shell ready | 4.851s | 17.899s |
| open 请求→完整工程可读 | 17.160s | 9.134s |
| open 请求→首张可见图解码 | 19.432s | 9.307s |
| 从进程启动→首图 | 24.544s | 27.505s |

因此工程 open 阶段较短，但总冷启动没有证实改善，不能隐藏较慢 shell。均为单次无 OS cache 清理样本；请求窗口一致，修前实际 CSS viewport 未直接捕获，不能宣称精准同 CSS 尺寸。另一个功能验收窗口 CSS1599×1100、open 6.678/首图6.785s、fresh reopen6.164/6.397s，条件不同，仅证功能，不拿来替代上表。

实际 canonical name edit、Undo/Redo、保存969.4ms，修改名后的 CAS 8,434,332 B；关闭后新 profile 工程、80 个资产字节/ID、12 组件与39处引用完整相等、dirty false。表首的8,434,293 B为未修改名称的独立CAS副本，不混为同一文件。Node codec cold233.5ms只说明解码层，不当GUI首开。

最终 Main 仅再次正式导出：5.808s、written、0 warnings、r247与dirty状态不变，HTML16,389,609 B。既有GLX保存/History实现未再变化，复用上述实际证据，不重复矩阵。详情 `editor/RESULT.md`、`size-followup/formal-export.json`。
