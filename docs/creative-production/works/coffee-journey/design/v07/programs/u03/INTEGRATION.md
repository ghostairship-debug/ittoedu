# v07 U03｜材料剖面、矢量标注与三路线对比

本目录是**正式作品 U03 局部程序**的检索和改写源包；最终作者事实在 [v07/r215 GLX](../../native/coffee-journey-v07.glx)，正式 HTML 在 [native](../../native/coffee-journey-v07-offline.html)。本目录的独立 HTML 不能替代整篇正式离线作品，也不应写回整篇大 Web 对象。

## 三种材料层与现有照片

| 路线 | 剖面材质 | 标注 SVG | 沿用的物件照片 |
| --- | --- | --- | --- |
| 日晒（natural） | `assets/natural-section.webp` | `assets/natural-layers.svg` | `assets/natural.webp` |
| 水洗（washed） | `assets/washed-section.webp` | `assets/washed-layers.svg` | `assets/washed.webp` |
| 蜜处理（honey） | `assets/honey-section.webp` | `assets/honey-layers.svg` | `assets/honey.webp` |

上述九份文件**现在均在本目录实际存在**。三张剖面同为 900px 视觉概念图，同尺度演示不同的组织保留状态；矢量和 DOM 解释外层果皮/果肉、黏液、羊皮层与种子。虚线代表已去除结构的位置，厚度、颜色和差异范围不是实测数据。历史 [SOURCE_CONSISTENCY.json](SOURCE_CONSISTENCY.json) 的 `missingLocalPhotoDependencies` 记录来自早期检查快照，**不是当前资产缺失状态**；不要据此误判可执行源包仍缺照片。

## 实际修改入口和生成关系

- [build_u03.py](build_u03.py) 是此源包的主生成脚本：修改 `methods` 的路线内容、组织状态、步骤与说明；`annotations` 改精确 SVG 标注；`diagram` 组合 `*-section.webp` 材质与矢量标注；`style` 改大/小屏；`script` 改选择/详情/比较/返回及键盘。
- 执行 `python build_u03.py` 会覆盖 [u03.html](u03.html)、[u03.css](u03.css)、[u03.js](u03.js)、[content.json](content.json) 和 `assets/*-layers.svg`，不会生成 `*-section.webp` 或三张旧照片，也**不会修改 GLX**。
- `u03.html` 为局部程序装配入口，CSS/脚本/矢量标注由构建脚本合并，图片保持相对资源引用；提交 GLX 时通过正式资源封闭机制处理这些图片，避免网络外链或断图。
- U03 在正式工程的原生局部程序实例 ID 为 `8bc2720a-0b46-439a-98c1-dc505b1cb456`。源包身份仅供查找，操作前必须在目标工程使用 `project.list/read` 重新解析当前对象路径并通过正式作者事务提交，不触碰 U05/U06 和周围的原生正文。

## 状态契约与复用

- `natural/washed/honey` 单选，详情可单独展开；进入比较保存当前选项和详情，返回时恢复。
- 三列同尺度结构图结合四层状态矩阵，手机不把关键信息藏在缩放后的小字里；详情有 DOM 文字说明。
- 保留 `coffee:reveal` 与 `coffee:height` 等和宿主的已有局部协议；键盘箭头、Home、End 等操作保持。
- 局部背景透明，必要的图解卡片和矩阵采用独立浅色衬底，以免遮挡全局背景。

## 已有验收和局限

[v07 两种宽度图解验证](../../evidence/u03-material-review.json)：1280px/390px 图像解码、比较矩阵、状态返回与键盘均成功，错误为空。正式 1440px/390px 断网 U03 返回状态、物件资源解码见 [最终离线记录](../../evidence/final-offline-verification.json)。画面见 [桌面并排](../../previews/u03-material-1280-compare.png) 与 [手机并排](../../previews/u03-material-390-compare.png)。

本案可复用的是“同尺度材质层＋独立精准矢量说明＋状态矩阵”的编辑设计，不表示任意科学图像都可由生图直接作为证据；应用到另一门学科须独立核对事实、对象与量纲。
