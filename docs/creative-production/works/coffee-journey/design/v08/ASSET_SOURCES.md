# v08 素材来源与加工记录

本记录说明本轮新增或加工的材料。既有 v05／r218 摄影沿用原作者署名、许可记录及 GLX 资源身份；具体摄影出处与使用条件详见作品原有署名和素材清单。

| 范围 | 来源与本轮处理 |
|---|---|
| U01／U07 摄影杯 | 沿用开篇原摄影；运动杯身从同一摄影提取，结尾复用同款杯子身份。正文果实使用已有原生果实素材的透明切出版本。失败的 LaMa 空杯碟修复未进入正式作品。 |
| U02 分选照片 | 沿用原照片。物体进入果堆时，前景遮挡恢复取自同一照片的对应像素，维持原摄影场景。 |
| U04 麻袋与豆堆 | 沿用原照片；麻袋口、豆堆等遮挡恢复同样取自原照片对应像素。 |
| U03 三路线材料 | `cherry-material.webp`、`parchment-material.webp`、`mucilage-material.webp` 为本轮内置 image_gen 生成的解释性材质。红果参考既有果实形象；蜜处理从同一羊皮母版派生。组织切窗、引线由可编辑 SVG 绘制，名称与说明为 DOM 文字。 |
| U05 烘焙 | 正式局部程序沿用原 1254×1254 三关键帧及滑块机制。入位、离位及任意滑块值的交接也采用这三张同源材料；运行时只去除与图像边界连通的暗底，保留豆内沟槽。既有 Runtime 的其他豆图用于加工途中和研磨碎粒，本轮未新增烘焙摄影。 |
| U06 实验容器 | `u06-glass.webp`、`u06-filter.webp` 为纯文字输入生成的玻璃杯、滤杯／滤纸／粉层材质。前后玻璃表现复用同一素材；液体、液面、水流、示意标记和数值由程序控制。 |

## 生成材料与科学示意的边界

U03、U06 的新增图像均为**非纪实、解释性合成材料**。U03 展示开始干燥时的典型组织关系，切窗与厚度不作测量，实际加工存在变型。U06 的液色、水流和示意点用于解释过程；初始饮品 200g、咖啡来源溶解物 3g、加水量及浓度读数保留为可编辑程序与 DOM 内容。静态生成图没有承载固定实验数值，也不作为真实实验或器具性能的证据。

## 科学资料与详细记录

U03 组织与工艺关系参考以下原始机构资料；资料链接提供科学依据，图片权利仍按各自来源判断：

- [Uganda Coffee Development Authority — Primary Processing](https://new.ugandacoffee.go.ug/index.php/primary-processing)：果肉、黏液去除与带羊皮层物料。
- [International Coffee Organization — Coffee Development Report 2022–23](https://icocoffee.org/documents/cy2024-25/coffee-development-report-2022-23.pdf)，Figure B.8，来源为 ITC《The Coffee Guide》第四版：整果、脱皮自然法与水洗的并列处理路径。
- [UC Davis Coffee Center — Coffee Quality 教学资料（2026年2月）](https://konacoffeefarmers.org/wp-content/uploads/2026/02/UCDavis_Coffee-Center_Overview_CoffeeQuality_Kona_February_2026.pdf)：蜜处理黏液保留程度的变型。

具体说明与生成输入：

- U03：[科学边界](programs/u03/SCIENCE_NOTES.md)、[素材生成记录](programs/u03/ASSET_PROMPTS.md)。
- U06：[材料来源](programs/u06/MATERIAL_SOURCES.md)、[完整生成提示词](programs/u06/ASSET_PROMPTS.json)。
