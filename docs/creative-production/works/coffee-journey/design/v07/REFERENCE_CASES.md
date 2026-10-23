# v07 参考案例｜从真实作品提取可复用机制

**检索顺序**：先按创作问题选择案例，再打开少量相关源码、截图和验收证据。正式作者事实是 [r215 GLX](native/coffee-journey-v07.glx)；孤立 HTML/源码是可修改参考，不等于已提交工程。当前版本 183 个原生实例，只有一份 Global Underlay；U03/U05/U06 仍是三个独立局部程序。

| ID | 需要解决的问题 | 可以复用的东西 | 不能机械外推 |
| --- | --- | --- | --- |
| `coffee-photographic-underlay` | 高质量摄影材质如何完成跨章节连续转化？ | 图像分层、同轮廓配准、遮罩、碎片与唯一背景 | 咖啡形变算法不是万能 morph |
| `coffee-motion-reading-bridge` | 背景如何与 Flow 真正同步，且保护长文阅读？ | 只消费宿主阅读/运动事实、阶段位置与纸色分区 | 新布局须重新测量阅读锚点 |
| `coffee-science-material-compare` | 三种科学结构怎样同尺度对比又保留材质可信度？ | 一致框架下的生成材质＋SVG/DOM解释＋状态矩阵 | 概念剖面不是实测标本 |
| `coffee-registered-keyframes` | 局部程序怎样控制多张同物体关键画面？ | U05 的配准、双段融合、进度交互机制 | 材质阶段不是烘焙物理量 |
| `coffee-fixed-solute` | 如何保持演示画面、数值、交互与模型一致？ | U06 的固定溶质稀释状态模型；v06 糖水 GLX 已复用 | 不等于真实咖啡萃取动力学 |
| `coffee-native-hybrid` | 长篇正文与复杂互动怎样仍可持续精确编辑？ | 原生 Flow + 有界程序 + 单背景 + 作者事务/历史 | 不应把整篇包成大 HTML |

## 1. `coffee-photographic-underlay`｜摄影材料与连续形态

**使用条件**：主体存在明确视觉继承关系，需跨章节连续存在；允许少数主题专用绘制算法。

- **源码**：[background-runtime.js](background-runtime.js) 的 `cupToCherry / fruitToSeeds / seedsToGreen / roastedBean / beanToSolution / solutionToCup`；[阶段配置](background-stages.js)；[素材台账](ASSETS.md)。
- **分层与材质**：实物近摄风格主图承载可信材质，蒙版负责果皮与陶瓷的显隐，精细 Canvas 负责可控运动、影子、液面；豆体破碎的小片从母体图像同位置裁剪，每片纹理与缺口对应。
- **形态连续性**：主体素材共用注册坐标和透明边缘混合；阶段边界附近有独立的像素比较和确定性检查，[连续性记录](evidence/material-continuity.json)。
- **真实参考**：[六段完整运动帧](previews/MOTION_REVIEW.html)；[独立材料播放](art-studies-offline.html)。孤立工作台适合查物件本身，正式运动帧适合查遮挡、颜色和阅读。
- **复用等级**：分层图像/蒙版/关键帧/碎裂素材追踪的方法可改写；咖啡皮、种子、杯与豆的确切路径不可盲用。

## 2. `coffee-motion-reading-bridge`｜统一导航与阅读中的背景

**使用条件**：宿主提供统一 `flowMotion` 及 `teacherController` 阅读状态，阅读层和全局背景可同时存在。

- **源码**：[background-runtime.js](background-runtime.js) 中 `phaseForReading / paperForReading / paint`，[background-stages.js](background-stages.js) 中 `READING_KNOTS / READING_HEIGHTS`。
- **职责边界**：宿主唯一拥有滚动、目标定位、运动生命周期；背景只消费公开数据并转为视觉 `phase`，绝不在画布内自造导航/DOM 监听器。
- **阅读保护**：深色 U05/浅色 U06 相邻时按内容坐标画局部纸色；桌面主体按负空间安排，手机用边缘渐隐保护文本；减少动态、空闲停帧和暂停/销毁均受同一组件生命周期管理。
- **复用等级**：状态消费和渲染映射可迁移；章节锚点、布局明暗和移动端裁切因主题而异。实际验证 [VERIFICATION](VERIFICATION.md)。

## 3. `coffee-science-material-compare`｜高质量科学材料比较

**使用条件**：多路线有明确共同比较时点/维度，需兼顾材料观感与可解释结构。

- **实际源包**：[U03 build_u03.py](programs/u03/build_u03.py)、[U03 装配 HTML](programs/u03/u03.html)、[源包说明](programs/u03/INTEGRATION.md)；正式工程 U03 实例 ID `8bc2720a-0b46-439a-98c1-dc505b1cb456`，实际寻址仍以当前 `project.list` 为准。
- **关键形式**：三张同尺 900px 材料剖面与独立矢量标注层；固定比较维度为外果皮/果肉、黏液、羊皮层、种子。虚线表达去除层的位置，DOM 状态矩阵表达三路线“保留/去除/程度不等”。
- **行为保留**：选择、详情、并排比较、返回恢复选项/详情、键盘；390px 布局图中文字不过度缩小。
- **注意**：生成图是结构解释性合成，虚线与色彩非测量；增设路线必须同时更新三路线信息、组织矩阵和文案，不可只换图。
- **实证**：[U03 两种宽度验证](evidence/u03-material-review.json)、[桌面对比截图](previews/u03-material-1280-compare.png)、[手机对比截图](previews/u03-material-390-compare.png)。

## 4. `coffee-registered-keyframes`｜U05 局部可操纵关键帧

U05 的**局部烘焙实验**沿用 v06/r204 的三个已配准关键帧、控制脚本和进度交互，不要与 v07 背景的新 `green/gold/roast` 图片混淆。宿主 Source 里是有界局部程序；全局 Underlay 只按章节表达烘焙段，不接管局部滑块。修改程序可参照 [v06 的 U05 案例](../v06/REFERENCE_CASES.md)。v07 已重新验证 50% 中间帧、缩放、播放/暂停和返回；证据在 [离线验证](evidence/final-offline-verification.json)。

## 5. `coffee-fixed-solute`｜U06 状态与计算契约

固定溶质的计算与可视化沿用 v06 U06：`溶质质量 / (初始溶液质量 + 加水质量) × 100%`，数值、72 个可视标记、交互和声音由同一局部状态驱动。v07 验收中加入 100g 水后读数仍为 3g/300g=1.00%；保留重置、键盘、返回、声音触发。跨主题参数复用的**实际已保存**样本仍为 [v06 糖水 GLX](../v06/reuse/solute-study/solute-study.glx)，r34，不虚构 v07 糖水新版本。源码与契约见 [v06 固定溶质案例](../v06/REFERENCE_CASES.md)。

## 6. `coffee-native-hybrid`｜正式原生结构与可回退事务

- 正文仍是一个原生 Flow 容器；标题、段落、图片、组合和三个局部互动程序保持各自身份；`global.underlay` 仅有一份背景，既有 `global.overlay` 导航保留。
- 以 `project.read/project.list` 确认**当前工程**的对象和 Source 路径，使用正式作者事务修改，保存得到 r215 GLX，再由正式导出产生单文件 HTML。只改 `background-runtime.js` 或生成后的 `u03.html` 不会修改 GLX。
- v07 保留 183 个实例和原有 ID/definition 身份；原生段落的 Undo/Redo、邻居不变、保存冷开皆有证据。[对象索引](native/OBJECT_INDEX.json)、[保存与编辑回执](evidence/final-author-roundtrip-and-cold.json)。
- 只对实质改变的层次复验，不用重做七章所有文本或搭建大型检索平台。复用是可定位的真实工程案例，不是自动生成一切内容的系统。

## 使用边界

文档记载的是**已存在的技术样本与当轮证据**，并非个人审美签收、真实植物显微观察、跨全部设备认证或可直接商业发行的授权保证。详细见 [验收与限制](VERIFICATION.md)、[素材许可](ASSETS.md)。
