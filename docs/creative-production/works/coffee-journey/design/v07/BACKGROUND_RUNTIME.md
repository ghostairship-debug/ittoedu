# v07 背景 Runtime｜摄影材质驱动的六段物质转化

案例：`coffee-photographic-underlay`。目标是在一份可持续存在的 Global Underlay 中完成视觉串联，保留 Flow 原生排版和三个有界局部程序。**本版已用真实导航事实运行，不再使用 v06 的独立 1350ms 章节切换时钟。**

## 程序及资源入口

| 文件 | 责任 |
| --- | --- |
| [background-entry.js](background-entry.js) | 正式共享 Source 入口；读取封闭 CSS 资源 URL，装饰当前实例并挂载 Runtime |
| [background-assets.css](background-assets.css) | 六张 WebP 在正式资源闭包中的引用；不依赖外链 |
| [background-runtime.js](background-runtime.js) | 素材解码、摄影/遮罩/粒子绘制、全局 Canvas、阅读/导航消费与生命周期 |
| [background-stages.js](background-stages.js) | 7阶段构图、桌面/手机锚点、起点阅读进度、阶段说明 |
| [art-studies-offline.html](art-studies-offline.html) | 可独立连续播放的30帧材料审片，便于诊断形变本身 |
| [previews/MOTION_REVIEW.html](previews/MOTION_REVIEW.html) | 来自正式离线工程的导航中间帧；包含真实滚动与背景相互关系 |

现有实例为唯一 `global.underlay` 背景实例，旧名 Source 入口 `underlay-poc.js` 属历史命名，不代表当前仍是 PoC。真实实例/定义以 [OBJECT_INDEX](native/OBJECT_INDEX.json) 和 `project.list` 为准。源文件编辑完还须用正式作者事务更新共享 Source、保存并导出。

## 六段实际技术与关键视觉逻辑

| 转场 | 技术 | 避免的典型问题 |
| --- | --- | --- |
| U01→U02 杯→果 | 陶瓷向下退场的移动遮罩；液面抬升、扩展成体积；红果皮材质渐次显影 | 不再是“杯淡出，果突然出现” |
| U02→U03 果→剥离 | 注册的双半果皮、移动内表面遮罩与稳定双种子；封闭果实与分离形态以同一格点融合 | 防止果皮变薄或双边缘穿帮 |
| U03→U04 组织→生豆 | 外层组织逐步离开；非主体种子退场；主体种子绕边缘姿态翻转露出绿豆正面 | 组织和单豆不再基于阈值瞬换 |
| U04→U05 生豆→焙豆 | `green→gold→roast` 逐段配准贴图，主体轮廓和裂隙方向基本固定 | 避免不同透明背景叠加形成双轮廓 |
| U05→U06 豆→颗粒／液体 | 从烘焙豆**自身纹理**按确定性 Voronoi 单元裂解；被取走的母体区域同步扣除，碎片移动、衰减，液体显露 | 避免凭空生成无来源粒子 |
| U06→U07 溶质→杯 | 碎片与液面回聚至初始咖啡位置；陶瓷沿径向遮罩向外显影 | 避免粉末骤消、完整杯骤现 |

每段在 `phase∈[0,6]` 上有唯一确定画面。画面在共同注册画布上组合后再应用相机变换；透明边缘使用预乘式素材融合，跨阶段端点连续性与帧确定性测试参见 [material-continuity](evidence/material-continuity.json)。技术可改写，但**不是任意物件一键几何 morph**：剖面、裂解、液体回聚均为咖啡主题量身设计的视觉逻辑。

## 与 Flow 导航共享事实

- **唯一运动事实**来自宿主 `teacherController.read()/subscribe()` 和 `flowMotion` 的 `id/status/progress/targetInstanceId/scrollTop`。本程序只订阅，不发导航或滚动命令，不搜宿主 DOM，不自建第二个定位器。
- 导航中运动进度从当下已呈现的 `visual` 向目标章节连续插值；完成时到达目标终态。被打断或手动接管时记录当前画面作为渲染偏移，后续阅读事实重新建立映射。
- `READING_KNOTS` 提供桌面/手机的起点归一化标定，导航完成时临时校准；`READING_HEIGHTS` 只作阅读距离的回退估算。**大幅重排内容、改变章节位置或换主题必须重测。**
- 深色 U05 和浅色 U06 同屏时，由实际内容坐标 `paperBands` 分区绘制底色；不再使用全屏同时改色的方式牺牲其中一章文字对比度。
- 桌面主体放在当前章节留白；390px 手机主体藏入边缘视觉轨道并施加渐进空间遮罩，保护正文和按钮。手机的局部裁切是主动设计策略，完整摄影物件在独立审片页可见。
- 减少动态偏好下直接到目标状态；静止、暂停/恢复、不可见和销毁时不留独立的动画循环。

## 复用及更改步骤

先确定新主题的七个视觉状态及完整物件资源，再统一光照/视角/轮廓配准。按 `STAGES` 改屏幕位置、明暗、手机裁切；按六个绘制函数修改物质转换。使用作者 Session 更新当前共享 Source 与正式资源后，保存 GLX、冷开、导出正式单文件；至少审看每段 0/25/50/75/100%，并同时看**真实 Flow 运动**与长文阅读对比度。隔离艺术工作台通过，不意味着正式工程必然通过。

验收见 [VERIFICATION](VERIFICATION.md)，具体审美取舍见 [visual-acceptance](evidence/visual-acceptance.json)。独立真实渲染的性能采样为 420×420/DPR1 的局部组件测试，并非整体手机或低端设备 FPS 保证。
