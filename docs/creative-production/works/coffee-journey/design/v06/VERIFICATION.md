# v06 验收记录

日期：2026-10-22。最终作者事实：**主 GLX / r204；糖水 GLX / r34**。验证通过现有生产构建、正式 Session 事务、真实 Electron 编辑器与 Chromium 离线页面进行；未修改产品源码或构建环境。

## 验收矩阵

| 范围 | 实际检查与结果 | 证据 |
| --- | --- | --- |
| 三锚点 PoC | 隔离工程内 2→5→7→5→2、快速切换、鼠标反向滚动；同一挂载、透明 Flow Paper、保存和新进程冷开后离线运行 | `evidence/poc-offline-facts.json`；原 PoC GLX 在 output 归档 |
| 最终七章 | r204，1440×1000 与 390×844 各七章；原生图文、背景和局部互动仍同一 Flow；没有整体水平溢出 | `evidence/final-timing-verification.json`；`previews/coffee-*-u0*.png` |
| 背景阅读状态 | 快速目标以最后一章为准；真实 wheel 反向可回退；同一个 mountId；停稳不再增加 tick；减少动态直接到位 | `evidence/final-timing-verification.json` |
| 浅深转场 | U04→U05 局部衬底保持浅字；U05→U06 的浅色纸面默认 180ms 完成，350ms 时物件仍在移动而纸面已亮；桌面与手机实看 | `evidence/final-timing-verification.json`；`previews/coffee-transition-to-u05.png`、`coffee-transition-to-u06.png`、`coffee-390-transition-to-u06.png` |
| 生命周期 | 编辑→试运行→编辑，suspended 正确切换且同一 mount；独立真实 Source 探针确认 idle/suspend/dispose 无排队帧，解绑只一次 | `evidence/editor-lifecycle.json`、`background-lifecycle-probe.json`、`paper-transition-facts.json` |
| U03 | 两种宽度均三路线可切换；蜜处理→详情→比较→返回保留路线与详情；键盘切换有效；三个 SVG 和矩阵一致；照片解码成功 | `evidence/lab-validation-r193.json`、`coffee-final-offline.json`；`programs/u03/SOURCE_CONSISTENCY.json` |
| U05 | 50% 中间帧、放大、播放／停止与返回代表性检查；最终提取的两个脚本与 r179 逐字相同 | `evidence/lab-validation-r193.json`、`coffee-final-offline.json`、`preservation.json` |
| U06 咖啡 | 萃取播放／暂停／下一步，加入100g后3g/300g=1.00%；72标记不变；重置、End键、声音事件、离开返回、空闲停止、减少动态；最终手机主标注13px、图注12px | `evidence/lab-validation-r193.json`、`coffee-final-offline.json` |
| 原生精确编辑 | 修改指定原生段落；所有邻居实例逐一相等；通过编辑器按钮 Undo→Redo→Undo 恢复原文 | `evidence/author-roundtrip.json` |
| 糖水正式参数修改 | GLX 中300g→360g，30g溶质显示8.33%；Undo→Redo→Undo恢复300g；正式保存 | `evidence/author-roundtrip.json` |
| 糖水正式离线复用 | 桌面／手机初值10%，加300g水后5%，30g与72标记不变；重置、End、离开返回、静止停帧、减少动态；三阶段自定义SVG背景同一挂载 | `evidence/sugar-final-offline.json`（59条记录）；最终 r34 复核见 `final-timing-verification.json` |
| 保存与冷开 | r204、r34 保存后关闭各自进程，以全新独立 profile 启动；新旧 PID 不同；完整 project 深度相等，dirty=false | `evidence/cold-open-and-export.json` |
| 正式单文件导出 | 两份 HTML 均经 `document.export(html-offline)`，exportedRevision=保存版本，warnings=[] | `evidence/cold-open-and-export.json` |
| 断网 | Browser context `offline:true`；最终主作品与小样页面异常0、HTTP请求0；图片有效加载 | `evidence/coffee-final-offline.json`、`sugar-final-offline.json`、`final-timing-verification.json` |
| 原件及原生身份 | r179哈希不变；原182实例ID及definition全部保留；新版仅加一个背景实例；U06两主题嵌入完全相同引擎 | `evidence/preservation.json` |

## 版本与证据继承

全面三段互动矩阵首先在 r193 通过。手机字号／颗粒边界的最后小修进入主 r202、糖水 r32；两种宽度的最终源再次验证，糖水完成59条记录。最后只修改共同背景 Source 的浅色纸面时长，形成 **r204/r34**；U03、U05、U06 的 HTML 和计算脚本均未改变。

因此保留已通过的互动证据，并对最后受影响部分完成新进程冷开、重新正式导出、七章桌面／手机背景、转场中间帧、快速打断、停帧、反向滚动、减少动态和糖水离线复核。`preservation.json` 的实际嵌入哈希证明前景程序未被这次时长调整改变；不把独立 HTML 候选直接当成正式 GLX 验收。

最终背景 Source SHA-256 为 `14d4759019d97ef6e3884d2bfdf062372ebe3a7bbc01669d7c302b4a0339dfb4`。它与 GLX ZIP 中 `components/947ccfd1-0078-4078-b903-304498284ade/underlay-poc.js` 逐字相同。历史入口名 `underlay-poc.js` 不代表当前仍是 PoC 实现。

## 视觉复核与范围

主创作 Agent 实看 U03 手机完整结构矩阵、U06 桌面及手机图解／控件、U04/U05/U06 浅深转场和糖水手机视图；原生子智能体独立复核 U03 源码一致性、U06 图形层次与手机标注，以及背景帧调度。截图索引在 [previews/README.md](previews/README.md)。手机截图使用顶层真实 viewport，避免跨 iframe 长元素截图的空白／裁切假象。

这是 1440px／390px Chromium 页面与 Electron 编辑器验证，不外推为所有浏览器、硬件、屏幕尺寸或屏幕阅读器认证。声音以主动触发的事件与状态核验，未声称在远程扬声器上做听觉评测。

## 不阻断收口的已知项

1. pinned 全局对象被宿主扣除至少18px右／底空间；作品未以宿主DOM访问或第二套背景掩盖，见 [软件交接](SOFTWARE_HANDOFF.md)。
2. U06 导入保留动态字符串时有 `unsupported-dynamic-url-sink` / `dynamic-html-preserved` 静态提示；源码已内联，正式导出无警告，断网无请求。导入回执保存在 `evidence/final-visual-patch-receipt.json`。
3. 曾出现孤立旧Source definition 的编译诊断；当前作品用正式共享Source提交并清除实例override解决，最终没有可见诊断。另一份非预期结构变化阶段稿已隔离，未进入正式交付。

本轮所需创作、正式装配、核心复用和可靠性条件已满足；没有未完成的必要创作步骤。
