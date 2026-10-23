# 一份糖的去向 · 正式GLX复用验证

**本案例已完成正式GLX / r34 的配置复用、保存、新进程冷开和单文件离线验证。** 它只验证两个机制，不扩展成第二件完整作品。

| 入口 | 用途 |
| --- | --- |
| [solute-study.glx](solute-study.glx) | 含三个原生章节、局部糖水程序、导航和全局背景的可编辑工程 |
| [solute-study-offline.html](solute-study-offline.html) | 正式单文件离线交付 |
| [water.config.js](water.config.js) | 300g溶液、30g糖、最多加入300g水；文字和配色 |
| [sugar-inline.html](sugar-inline.html) | 与GLX局部程序逐字一致的装配源 |
| [background-runtime.js](background-runtime.js) | 与咖啡作品相同的背景Runtime |
| [background.config.json](background.config.json) | 三个原生阅读锚点、晶体／水滴／杯的内联SVG及轨迹配置 |

## 可复用与实测范围

U06保持相同绘图、计算、输入、声音和生命周期引擎，只替换主题配置。已在GLX内把`baseMass:300`改为360，观察30/360=8.33%，经Undo/Redo/Undo恢复。最终离线版两种宽度均验证30/300=10%，加入300g纯水后30/600=5%；溶质质量和72个解释性标记保持不变，重置、键盘End、离开返回与减少动态正常。

背景只替换阶段配置及内联SVG，使用相同`teacherController`阅读事实和既有导航。三个阶段按阅读改变位置与图形，静止停帧；图形间为离散SVG插值，不声称任意形状几何morph。浅色纸面优先稳定，保证原生说明的对比度。

原生Flow为 `eec78b8e-0324-4c04-8dbf-fdd50b1de6a7`；局部程序为 `39ce1c9c-0ae0-486f-9c41-c1497158a594`；Underlay为 `e9c23420-7b9e-40b0-8a1d-561b2aec2ff2`。复制到新工程后重新获取ID和虚拟路径，不硬编码旧地址。

本例适用于固定溶质、加入纯水且忽略损失／反应的解释性模型，不计算溶解动力学。数值、质量单位、视觉图例和文案必须一起改写。最终证据查 [VERIFICATION](../../VERIFICATION.md)、`../../evidence/sugar-final-offline.json`、`../../evidence/final-timing-verification.json`。
