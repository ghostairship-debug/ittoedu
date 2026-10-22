# 咖啡作品｜素材、生成和许可

本文件描述当前 v0.5/r179 所采用的**素材身份、使用范围和来源**，不列出已经撤下的旧稿与候选。全部实际使用的图片位于本目录的 `assets/`，随正式 GLX／离线 HTML 封闭打包；独立响应式 HTML 通过本目录相对路径读取。

## AI 生成视觉素材

- `cup.webp`：1536×1024，206,718 字节；素色陶杯、日光与石台，用于 U01/U07 的回环（SHA-256 `24bf7fce837f0bfc06237f06e5ee372475d7dcf5740d84a8171255a0c69553c6`）。
- `natural.webp`、`washed.webp`、`honey.webp`：U03 三条路线的物件观察素材。
- `green.webp`、`gold.webp`、`roast.webp`：U05 三幅已配准的关键帧，支持拖动与分段融合。

以上均为 AI 生成的解释性静物，非某一真实批次材料的摄影记录。完整生成图台账、画幅、选择依据在 [GENERATED_ASSETS.json](assets/GENERATED_ASSETS.json)，备选但未选中的旧图已从活动素材树撤下归档。不必再次大量生成同类照片。

三张 `natural-layers.svg`／`washed-layers.svg`／`honey-layers.svg` 是本作原创组织关系示意，由 [build_diagrams.py](build_diagrams.py) 的同一几何规则生成，厚度与颜色不是测量数据。

## 真实照片及许可

| 当前文件 | 原始来源与作者 | 许可 |
| --- | --- | --- |
| `sorting.jpg` | [Kenyan farmers sorting coffee cherries](https://commons.wikimedia.org/wiki/File:Kenyan_farmers_sorting_coffee_cherries.jpg)，Kamweti wa Mutu | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `field.jpg` | [Coffee plantation](https://commons.wikimedia.org/wiki/File:Coffee_plantation.jpg)，Athira96 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `cherry.jpg` | [Open coffee cherry](https://commons.wikimedia.org/wiki/File:Open_coffee_cherry.jpg)，Roger Burger | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `beans.jpg` | [Green Bean Coffee](https://commons.wikimedia.org/wiki/File:Green_Bean_Coffee.jpg)，DeaPeaJay / David Joyce | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| `sacks.jpg` | [NP coffee sacks](https://commons.wikimedia.org/wiki/File:NP_coffee_sacks_(5867722798).jpg)，Neil Palmer / CIAT | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |

页面与正式工程保留作者和许可说明。更细的下载来源及裁切记录参见作品根目录的 [摄影台账](../../assets/photography/LICENSES_AND_SELECTION.md)；这些原图素材是溯源资料，不能因整理历史版本而删除。

## 程序图解和声音

U06 由 `water.js` 的 Canvas 绘制杯、滤器、可溶点、流动和液面。数值由明确的质量模型驱动；视觉表示关系，不执行真实流体模拟。水声通过 WebAudio 本地合成，用户主动开启才触发，无外部音频下载。

**当前改进方向**：增强 U03 SVG 状态区别及 U06 动态图形层次和小屏标注可读性；这属于未完成的作品精修，不应误标为现有资产已经达到更新后的效果。

图像素材、许可记录与原作品工程分属不同职责；只更新这里的源文件不会自动替换已保存 GLX 中的资源，需从当前工程正常提交。
