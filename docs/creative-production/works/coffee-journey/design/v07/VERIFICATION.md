# v07 验收记录｜Project schema 11 / r215

时间：2026-10-23。**本页是对已发生的 r215 真实工程验收的证据编目，不是本次资料整理重新运行的验证。** 原始记录保留在 `evidence/`；截图放在 `previews/`；正式工程为 [coffee-journey-v07.glx](native/coffee-journey-v07.glx)，正式单文件为 [coffee-journey-v07-offline.html](native/coffee-journey-v07-offline.html)。

## 可核对的验收矩阵

| 项目 | 既有结果与边界 | 主要证据 |
| --- | --- | --- |
| 最终编辑身份 | r215 共 183 个实例，原实例/definition ID 均保留；正式 Flow、Global Underlay、三个局部程序仍分开。较 v06，变化涉及 U03 与两处局部原生阅读编排，不代表整体重建。 | [final-assembly-preservation.json](evidence/final-assembly-preservation.json)、[OBJECT_INDEX](native/OBJECT_INDEX.json) |
| 保存与独立进程冷开 | r215 保存后打开全新进程；完整 project 比较相等，dirty=false，进程 PID 不同，错误为空。 | [final-cold-open.json](evidence/final-cold-open.json) |
| 正式单文件导出 | `document.export(html-offline)` 导出 r215；exportedRevision=currentRevision=215；warnings=[]。 | [final-export.json](evidence/final-export.json)、[final-cold-open.json](evidence/final-cold-open.json) |
| 七章离线 | 1440×1000 与 390×844 两组各七章，资源全部加载；页面异常和 HTTP 请求均为 0，滚动宽度未溢出。 | [final-offline-verification.json](evidence/final-offline-verification.json)、[预览索引](previews/README.md) |
| 六段真实导航运动 | 桌面六段各采 0/25/50/75/100% 共 **30 帧**；手机四段代表性过渡共 **20 帧**。保留真实 `flowMotion`、视觉相位、阅读/滚动记录。 | [final-motion-frames.json](evidence/final-motion-frames.json)、[MOTION_REVIEW.html](previews/MOTION_REVIEW.html) |
| 正反向、快速跳章、手动接管 | 同一背景 mountID；最终目标状态正确，运动取消时相位从当前显示接续；实际手动接管与停帧记录存在。 | [final-motion-frames.json](evidence/final-motion-frames.json) |
| 静止与减少动态 | 空闲时 tick 不再增加；`prefers-reduced-motion` 进入对应状态且稳定；背景组件的 suspend/resume/dispose 有独立探针记录。 | [final-offline-verification.json](evidence/final-offline-verification.json)、[final-reduced-motion.json](evidence/final-reduced-motion.json)、[material-continuity.json](evidence/material-continuity.json) |
| 材料接缝与确定性 | 关键相位 1–5 的相邻边界差异测试中，单通道差异 >10 的像素数均为 0；六个任意相位重复渲染逐像素一致。此项不能替代人工视觉检查。 | [material-continuity.json](evidence/material-continuity.json) |
| 材质视觉审查 | 主创作 Agent 已看六段转场与手机正文，修复透明轮廓叠加、过度裁切、U05/U06 明暗阅读、手机边缘遮罩。六段标为可接受，**非 Owner 个人审美签收**。 | [visual-acceptance.json](evidence/visual-acceptance.json)、[材料审片](previews/material-reference-final.png) |
| U03 科学比较 | 1280/390 的材质图解、三路线矩阵、选择/比较/返回、键盘和图片解码；正式离线 1440/390 复验状态返回和资源加载。 | [u03-material-review.json](evidence/u03-material-review.json)、[final-offline-verification.json](evidence/final-offline-verification.json) |
| U05 局部烘焙 | 50% 中间帧、放大、播放/暂停、返回，继续保留原三关键帧脚本；测试在正式离线工程。 | [final-offline-verification.json](evidence/final-offline-verification.json) |
| U06 局部稀释 | 加水后显示 3g/300g=1.00%，72粒可视标记不变；重置、键盘、返回和音频触发事件通过。听感没有现场判断。 | [final-offline-verification.json](evidence/final-offline-verification.json) |
| 原生修改、History 与编辑预览 | r211 阶段曾精确修改一段原生文字，并经 Undo→Redo→Undo 还原；邻居不变、保存与独立冷开通过，编辑↔试运行同挂载。最终 r215 再验保存冷开和身份保持；不把 r211 的按钮测试写成 r215 又执行了一遍。 | [final-author-roundtrip-and-cold.json](evidence/final-author-roundtrip-and-cold.json)、[final-assembly-preservation.json](evidence/final-assembly-preservation.json) |
| 右侧背景余量与章节起点 | 正式 r215 离线记录的背景/Canvas 尺寸与 1440×1000、390×844 顶层 viewport 一致，未见旧 18px 余量；各章在校准的真实阅读位置停稳。结果仅覆盖这些配置。 | [final-offline-verification.json](evidence/final-offline-verification.json) |
| v05/v06 原件 | 基线文件校验未变：v06 `e4a7e1...25`；v05 `e3303319...a90`；本轮文档也只更新 v07 与作品入口，不覆盖旧 GLX。 | [final-assembly-preservation.json](evidence/final-assembly-preservation.json)、[DELIVERY_MANIFEST](DELIVERY_MANIFEST.json) |

## 三类画面证据不得混用

1. [独立材质工作台](art-studies-offline.html) 能检视 30 个孤立的 `phase` 中间帧、可连续播放。它只证明绘制材料可视，不证明正式导航同步或正文可读。
2. [正式导航逐帧](previews/MOTION_REVIEW.html) 由正式单文件作品的真实滚动/阅读事实产生。桌面六段各五帧；手机只选了四段共二十帧。数值标注包含实际相位和滚动位置，不保证恰好等于理论 25%。
3. [整页真实阅读截图](previews/README.md) 用于 U01–U07 在 1440px/390px 的图片/文字/背景层级，以及 U03/U05/U06 代表性交互；这几组能互相补足，不能用单张最终截图替代中间帧审查。

## 艺术收口仍需明确的边界

- 主创作 Agent 的六段 `accepted` 是该次内部艺术判断，**不代表用户本人已经认可最终参考水准**；可用独立播放页和正式 HTML 主观复看。
- 科学概念剖面及背景部分材质为 AI 生成解释性图像，不可替代真实生物组织证据或物理过程。
- 手机仅为 390px Chromium 浏览器视口；**实体手机、Safari、各种窄屏设备没有认证**。
- U06 音频仅验证用户主动触发的状态/事件，没有设备扬声器主观试听。
- 当前的色带/底色与阅读边界依赖 r215 的具体 Flow 排版和 `READING_KNOTS`；若正文高度、标题或容器位置大改，应重新标定视觉/纸色边界。
- 程序资产打包和离线 HTTP 请求为 0 的结论只适用于当次已经生成的正式 HTML；改源码、图片或导入后须再次导出验证。

## 本次“资料整理”验收

仅核对现有证据、实际文件、路径、修订版本及校验值；没有重新启动果铃编辑器、改动任何 GLX 或执行新的软件测试。文档链接与 manifest 的生成及一致性校验单独由 [authoring/build-document-manifest.cjs](authoring/build-document-manifest.cjs) 完成，结果在该脚本终端输出与 [DELIVERY_MANIFEST.json](DELIVERY_MANIFEST.json)。
