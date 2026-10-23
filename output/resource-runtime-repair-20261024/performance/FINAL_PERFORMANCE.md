# 最终正式 HTML 性能与输入验收

2026-10-24 字体子集与 Player 依赖 owner 修复后的最终口径。正式 HTML 为 **16,389,609 bytes**，七章与三个实验共10项真实输入通过。加载与原包相比改善；桌面仍测得150ms长帧，不能签稳定60fps或完整艺术路线无跳变。

## 制品与条件

最终使用正式 Main→worker→HeadlessRenderer 导出的 `../size-followup/formal-editor-workspace/coffee-v08-final-optimized.html`，written / 零warning，原样v08作者工程和80个逻辑资源未改。字体由误选101 faces / 4,516,508 bytes收敛到24 faces / 1,265,520 bytes；compiled Player 1,610,898→1,153,391 bytes。没有修改正式v08、艺术素材或路线。

沿用原 `profile-runtime.cjs`：Chromium149.0.7827.55、headless、DPR1、无CPU throttle、offline；desktop1440×900与mobile390×844各cold一次，各7s连续滚动。cold指新浏览器/上下文、关闭浏览器缓存，未清OS文件缓存。Root冻结其它heavy任务，浏览器串行。原 `check-published.cjs` 的10项真实输入只跑一次。

原包 `baseline-*`、21.25MB中间候选 `after-*` 及其cache/Profiler证据均保留；旧报告全文见 `PHASE1_PERFORMANCE.md`。**最终以 `final-*` / `final-followup.json` 为准；中间cache不是最终制品的cache结果。** 本次不重跑cache、旧包、旧trace或GLX。

## 原包 → 最终正式 HTML

| 指标 | Desktop before → final | Mobile before → final |
|---|---:|---:|
| DOMContentLoaded wall | 5.545 → 2.752s | 6.112 → 2.002s |
| 首屏主IMG LCP | 5.440 → 2.624s | 5.996 → 1.900s |
| actor三份U05材料就绪wall | 12.171 → 5.381s | 19.855 → 4.184s |
| 启动主文档long task数 | 15 → 15 | 25 → 14 |
| 启动主文档long task总量 | 6.382 → 3.761s | 8.638 → 2.702s |
| 启动最长long task | 5.024 → 2.190s | 5.585 → 1.540s |
| 7s主owner RAF间隔数 | 56 → 325 | 35 → 372 |
| RAF mean | 126.8 → 21.6ms | 204.8 → 18.9ms |
| RAF p95 | 166.6 → 50.0ms | 366.7 → 16.8ms |
| RAF max | 166.7 → 150.0ms | 450.0 → 83.4ms |
| RAF >50ms | 50 → 16 | 32 → 12 |
| CDP ScriptDuration增量 | 6.670 → 4.630s | 6.790 → 3.626s |
| CDP TaskDuration增量 | 7.283 → 6.521s | 7.441 → 5.160s |
| pageerror | 0 → 0 | 0 → 0 |

本次桌面DCL、LCP和材料就绪分别减少约50.4%、51.8%、55.8%；移动宽度约67.2%、68.3%、78.9%。滚动ScriptDuration桌面减少约30.6%，移动约46.6%。主owner回调由约8/5次每秒升至46/53次每秒，不冒充GPU呈现FPS或整机CPU百分比。均为单次条件样本，不是统计或普遍时延保证。

中间候选桌面为348帧/mean20.2ms/max116.6ms/Script3.929s；最终单次325帧/21.6ms/150ms/4.630s，不能将字体与bundle减小包装为滚动进一步普遍提速。移动最终更快，同样不能由单次差值断言单一原因。

## 热点与剩余成本

原包已确认 `findInstanceParent` 经 `state.set→navigation.changed→refreshActivity` 和 `canExecute→instanceActive/instanceRange` 反复扫描全表；父索引与状态依赖过滤后，它不再是最终CPU前列。原归属和中间修复闭环见 `BASELINE_ATTRIBUTION.md` / `PHASE1_PERFORMANCE.md`。

最终仍有导航事实通知、可用性几何读取、消息、首次native Source初始化及绘制成本。tracing主滚动通知desktop约2.687s/325次、mobile2.085s/370次；首次native初始化约10次，单次最长132.7/77.1ms。这些成本不自动等于缺陷，也不作为另建调度框架的理由。

作品同步像素算法未改。最终actor `im.onload` 15次desktop累计553ms/最长73.3ms，mobile450ms/最长56.6ms，不能称作品像素处理已缓存或自动优化。宿主与opaque iframe分处不同renderer，跨进程/嵌套trace不可与主页面ScriptDuration相加；Profiler含CDP排队窗口，不用7s RAF分母推CPU百分比。

## 最终真实输入与画面

`final-functional.json` 的10项真实鼠标检查全过：七章导航；u03水洗、明细/比较往返；u05熟豆→生豆；u06加100g水后得到总量300g、溶解物3g、浓度1.00%。13张已挂载图片均解码完成，0页面错误、0HTTP请求，1440px根文档无横向溢出。三实验与390px末章截图已实际查看，未见缺字或主要素材丢失。移动宽度有实际cold/滚动/画面，不冒充物理触屏验收。

检测七个导航按钮、实际点击第二章并收到滚动响应的保守回执为原包22.000s→最终5.515s，点击到响应448→205ms。这不是标准化TTI，不证明检测前所有时刻都不能输入，也不与另一轮材料就绪相减。

本次没有重复phase1有限5s pose观察；它未复现2198px不等于完整艺术路线通过。v08仍使用历史viewport槽位、`.at(-1)`路线和自行定义的艺术交接；正确同批几何用法见 `geometry/CREATIVE_HANDOFF.md`，不把软件接口交付视为作品自动采用。

## 文件体积及边界

正式HTML29,529,332→**16,389,609 bytes**，减少44.50%；gzip6为10,604,673。实际存储Base64段202→84，最终84份内容唯一，重复存储解码字节6,222,390→0；逻辑资源仍80。它携带运行资源、字体和Player，不与外链素材的几十KB主文件类比。

最终HTML物理段：course-data9,479,133 bytes、资源池4,029,159、字体CSS块1,719,070、内联Player1,153,408（含HTML转义），其余启动脚本/HTML壳8,839；互不重叠且合计16,389,609。各段gzip不相加当整包gzip。

最终Web ZIP20,856,940 bytes，assets目录55个内容实体、内部重复0；仍有course-assets.js11,910,378 bytes和字体脚本1,719,316。首个native消费者因file://及opaque Canvas合同仍需共享字节目录，整ZIP保留跨载体重复，不称整包零重复或全部HTTP素材完全按需。最终Web/字体consumer证据见delivery报告。

GLX内容寻址、History、保存/新profile重开复用resource/Editor有效证据。open→首图19.432→9.307s，但总冷开24.544→27.505s、shell4.85→17.90s方差明显，不能签GLX总冷开稳定提速。字体/Player后续只改发布链路，未机械重测GLX。

## 证据

- `final-followup.json`：before/中间/最终指标、体积与输入的可机读汇总。
- `final-desktop.json` / `final-mobile.json`，同名前缀CPU profile / trace / attribution：最终cold与连续滚动。
- `final-functional.json`、`final-functional-u03/u05/u06.png`、`final-mobile-end.png`：最终真实输入与画面。
- `PHASE1_PERFORMANCE.md`、`comparison.json`、`after-*`：中间候选历史证据，缓存数据仅属中间候选。

所有浏览器已退出、heavy窗口已释放。此后仅整理报告；本叶子未改产品、正式作品或执行Git提交。