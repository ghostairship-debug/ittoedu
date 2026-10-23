# 真实性能与输入验收结果

2026-10-24。本轮主要宿主热点已消除，连续滚动明显改善；启动仍有数秒成本，滚动仍有约 117ms 的长帧，不能签稳定 60fps 或完整艺术路线无跳变。

## 条件与交付物

before 只读正式 `docs/creative-production/works/coffee-journey/design/v08/native/coffee-journey-v08-offline.html`（29,529,332 bytes）。after 为真实 Main compiler + 正式 `buildComponentHtml` + 当前官方 compiled runtime 生成的完整候选 `../delivery/export-candidate.generated/coffee-v08-candidate-offline.html`（21,253,952 bytes），原工程与素材未改。它包括完整字体与相同 v08 作者程序，不是几十 KB 的缺素材主文件。

使用完全相同的 `profile-runtime.cjs`：Playwright Chromium 149.0.7827.55、headless、DPR=1、无 CPU throttle、网络 offline，desktop 1440×900 与 mobile 390×844 串行。cold 指新浏览器进程/上下文且浏览器缓存关闭，不称已清 OS 文件缓存。cache 为同上下文完整打开后再次加载。after 测量期间 Root 已冻结其它 heavy 任务；未并行浏览器压测。单次条件样本保留波动，不推广全部作品或物理设备性能。

随后 Editor 正式 Main→worker→HeadlessRenderer 导出 `../editor/candidate-workspace/candidate-offline.html` 为 21,250,072 bytes。独立解析还原两份资源池后，compiled HTML、staticViews、webPrograms、sourceFactories、nativeSources、样式、builtinFactories、diagnostics 全等；course 定义/实例/导航/布局/逻辑字段全等、80 个逻辑资产及尺寸/MIME 相同、字体 CSS 全等。只有 4 张 WebP 的 `url` 内容和 `byteLength` 存在编码器微差（合计 2,344 bytes），使完整 HTML 差 3,880 bytes。两者不是字节同一制品，但属于相同软件/行为/资源身份口径，不为此重跑同义性能。详见 `artifact-equivalence.json`。

## 同条件结果

| 指标 | desktop before → after | mobile before → after | desktop cache before → after |
|---|---:|---:|---:|
| DOMContentLoaded wall | 5.545 → 5.586s | 6.112 → 2.680s | 5.869 → 2.705s |
| 首屏主 IMG LCP | 5.440 → 5.448s | 5.996 → 2.556s | 5.420 → 2.348s |
| actor 三份 U05 裁剪材料就绪 wall | 12.171 → 8.823s | 19.855 → 5.616s | 13.683 → 5.714s |
| 7s 滚动主 owner RAF 间隔数 | 56 → 348 | 35 → 339 | 未重复滚动 |
| 主 owner RAF mean | 126.8 → 20.2ms | 204.8 → 20.7ms | — |
| 主 owner RAF p95 | 166.6 → 49.9ms | 366.7 → 50.1ms | — |
| 主 owner RAF max | 166.7 → 116.6ms | 450.0 → 116.8ms | — |
| 主 owner RAF >50ms | 50 → 15 | 32 → 17 | — |
| CDP ScriptDuration 增量 | 6.670 → 3.929s | 6.790 → 4.331s | — |
| CDP TaskDuration 增量 | 7.283 → 5.702s | 7.441 → 6.061s | — |
| 启动主文档最长 long task | 5.024 → 1.887s | 5.585 → 2.181s | 见原始 JSON |
| pageerror | 0 → 0 | 0 → 0 | 0 → 0 |

桌面材料就绪减少 27.5%；桌面滚动 ScriptDuration 减少 41.1%，移动宽度减少 36.2%。主 owner RAF 由约 8 / 5 次每秒升至约 50 / 48 次每秒；这是实际滚动驱动回调口径，不冒充 GPU 呈现 FPS。桌面首次 DCL 和首图 LCP 没有改善，不能用 mobile/cache 的较快值替代它。CDP metric 是其采样窗口的线程工作时间，不是整个机器的 CPU 百分比；Profiler 窗口含 CDP 排队，不能与 7s RAF 的分母混用。

## 已验证的软件根因与剩余热点

before 的最大非 idle CPU 自耗时函数为 `findInstanceParent` 全实例扫描；持续滚动 Profiler self 为 desktop 6.020s、mobile 7.016s。它经 `state.set → navigation.changed → refreshActivity` 与 controller `canExecute → instanceActive / instanceRange` 反复触发。after 已不再成为 CPU 前列，正式父索引与状态依赖过滤实际生效。

7 个 sandbox bootstrap onmessage 的 startup tracing 累计 desktop 5.489 → 1.971s，mobile 11.638 → 1.744s；desktop cache 6.565 → 1.794s。单次最长 desktop 692.6 → 401.1ms，mobile 1462.8 → 321.3ms。只有实际取用的资源才解码且相同内容共用解码结果，降低了全目录重复初始化成本。这些同线程 handler 是嵌套包含时间；不与别的进程/事件相加当整机 CPU 总量。

after 仍有真实代价：每次滚动导航事实通知、controller 可用性读取会测量目录元素；首次进入局部程序仍有原生 Source 初始化。trace 中主滚动通知约 2.25–2.49s/350 次，首次 native 初始化一组约 10 次、单次最长 91–96.5ms；仍有 GC、消息调度与绘制成本。它们不自动等于缺陷，也不作为新全局调度框架的理由。当前最长约 117ms 的滚动间隔与数秒启动成本需要在结论中保留。

作品 actor 的同步扫像素算法没有被软件改写。desktop `im.onload` 15 次 tracing 累计 before 443ms / after 532ms（最长 54.6 / 68.0ms），mobile 864 / 529ms；不同次采样存在波动。不能把资源包去重收益包装为该作品图像算法已缓存或普遍提速。宿主与 opaque iframe 是不同 renderer 线程，不能用主页面单一 ScriptDuration 覆盖所有工作。

## 真实输入与离线功能

相同 `check-published.cjs` 使用真实鼠标事件。before 与 after 均通过七章导航、u03 水洗/明细/比较往返、u05 熟豆→生豆正反切换、u06 加 100g 水后 300g 总量/3g 溶解物/1.00% 的 10 项检查。after 13 张已挂载图片全部解码完成，0 页面错误、0 HTTP 请求，1440px 根文档无横向溢出；实际三实验截图已逐张查看。390px 冷开与连续滚动有直接性能和末章画面证据；本轮没有把 desktop 实验点击记为物理触屏验收。

首次找到并实际点击第二章、收到页面滚动响应的保守回执为 before 22.000s → after 5.021s，点击到响应 448 → 198ms。该检测结果不是标准化 TTI，不证明之前的每个时刻都不能输入，也不与另一轮材料就绪时间相减。

## 作品路线的保留问题

after 在访问七章并完成三实验后，slotCount 为 9；一次从 scrollTop 400→1900 的 5s 只读 pose 观察经过 `resident → cup-fruit → resident → fruit-sorting → resident`。未在这个有限区间重现旧报告的 2198px 跳变，不能因此签七条路线或所有前进/反向滚动通过。观察到 101/110px 的 pose 变化，但 actor iframe RAF timestamp 有重复（dt=0），这些仅保留为 dataset 观察，不宣称是同等像素的已视觉确认瞬移。

原作仍使用历史 viewport slot fact、`.at(-1)` 路线选取和自行定义的入场/缩放/交接。这些作者程序没有被改，不能把新的同批 `scope.measure` 能力视为作品自动采用。具体使用方式见 geometry 的 `CREATIVE_HANDOFF.md`；旧 2198px 证据仍按旧报告与原始数据保留。

## 资源数字与边界

delivery 的当前完整实测：HTML 29,529,332 → 21,253,952 bytes（减少 28.02%）；实际存储 Base64 段 202→161，唯一内容仍 161，重复存储解码字节 6,222,390→0。逻辑交付资源仍 80 个。GLX 内容寻址与真实保存/冷开由 resource / Editor 报告证明，不把本报告的裸 HTML 测量冒充 GLX 冷开。

Editor 另有真实 GLX 分阶段证据：`open→首图` 19.432→9.307s，但其成对总冷开 24.544→27.505s，shell 阶段 4.85→17.90s 有明显方差。不能据较快的文档阶段声称整体 GLX 总冷开已经稳定提速。History、保存与新 profile 重开通过见 Editor 原始记录；这里不重复该验收或把它与裸 HTML 时序混算。

Web ZIP 为 27,668,927 bytes，asset 文件 55 个且内部实体重复 0。它还包含 file:// / opaque native Canvas 所需 `course-assets.js`（11,910,378 bytes）及字体脚本（6,123,041 bytes），首个原生消费者仍需共享目录。因此整个 ZIP 仍有跨载体重复，不能只引用 assets/ 内 0 重复就称整包零重复或所有 HTTP 资源完全按需。该兼容交付成本已明确保留。

## 原始证据索引

- `comparison.json`；`baseline-*.json` / `after-*.json`：完整时序、long task、CPU、帧结果。
- `*-load.cpuprofile` / `*-scroll.cpuprofile`：真实 CPU 原始采样。
- `*-load.trace.json` / `*-scroll.trace.json`、`*-attribution.json`：跨线程 tracing 与函数归属。
- `baseline-functional.json` / `after-functional.json` 与 `*-u03/u05/u06.png`：真实点击和数据回执。
- `after-mobile-end.png`、`after-functional-journey.png`：实际移动宽度末章与有限路线画面。

没有改产品源码、正式 GLX、正式 HTML、艺术素材或路线代码；本叶子未 commit。after 浏览器均已退出并把 CPU 窗口转交 Editor，之后没有重测。
