# v07 素材、处理、来源与许可

以**可以追溯的具体文件**区分原创生成素材、源图处理、旧版继承摄影与程序图形。资源闭包实际纳入正式 GLX/单文件 HTML；单独替换本目录素材，不会自动更新已保存工程。文件大小、SHA-256 及交付身份在 [DELIVERY_MANIFEST](DELIVERY_MANIFEST.json)。

## 六张新摄影级主体（原创 AI 生成视觉）

| 物件 key | 未处理源（透明 PNG） | 正式渲染资源（WebP） | 说明 |
| --- | --- | --- | --- |
| `cup` | `assets/source/cup.png` | `assets/runtime/cup.webp` | 暖白陶瓷杯与咖啡液面；U01/U07 回环 |
| `cherry` | `assets/source/cherry.png` | `assets/runtime/cherry.webp` | 成熟红色果实、表面高光和果柄 |
| `section` | `assets/source/section.png` | `assets/runtime/section.webp` | 果实双籽纵向概念剖面，不是实测样本 |
| `green` | `assets/source/green.png` | `assets/runtime/green.webp` | 未烘焙生豆，焙色统一轮廓的主参考 |
| `gold` | `assets/source/gold.png` | `assets/runtime/gold.webp` | 早焙金黄色过渡材质 |
| `roast` | `assets/source/roast.png` | `assets/runtime/roast.webp` | 中深烘焙棕色豆体、纹理及裂隙 |

- 来源：本次 ImageGen 生成的**解释性视觉素材**。制作说明及原提示词归档 [ASSET_PROMPTS.json](ASSET_PROMPTS.json)；每张的尺寸、透明通道、源/运行时文件与变换参数归档 [assets/manifest.json](assets/manifest.json)。
- 统一规格：近正面略俯视，主体完整，柔和暖光从左上，保留自然微观材质；透明边缘。实际源为 1254×1254 PNG；运行时优化为约 900px WebP，原件未覆盖。
- 处理：透明边缘清理；`gold` 和 `roast` 以 `green` 的 alpha bounding box 为参考进行小幅仿射配准；过渡中使用注册画布与预乘式融合，原源图作为可重新处理的参考。
- 这些图片不能被当作咖啡工艺真实批次、植物组织测量或实际摄影证据。发布前仍应核对图中文字、来源声明与目标发行用途。

## U03 三路线精修资源

`programs/u03/assets/natural-section.webp`、`washed-section.webp`、`honey-section.webp` 是**同画布、同尺度**的三种材料概念剖面；`natural-layers.svg`、`washed-layers.svg`、`honey-layers.svg` 负责矢量描线、已去除组织的虚线和指示。另保留三张原有路线静物 `natural.webp`、`washed.webp`、`honey.webp`。图像显示材质，SVG/DOM 说明组织；组织厚度和颜色仅供讲解。确切修改及生成关系见 [U03 INTEGRATION](programs/u03/INTEGRATION.md)。

## 继承的纪实摄影与其他资产

- Flow 中原有咖啡园、人工分拣、果实、生豆与搬运等真实照片：未在 v07 重新生成。作者、Wikimedia 文件页与各张 CC0 / CC BY-SA 许可见 [v05/ASSETS](../v05/ASSETS.md) 和 [摄影授权台账](../../assets/photography/LICENSES_AND_SELECTION.md)。
- **涉及 CC BY-SA 的照片**如有裁切、调色或再传播，应保留适当署名、来源与许可链接，注明变更，并按具体许可核对署名及相同方式共享义务；不能用“全部图片 AI 生成”覆盖这些原有照片。
- U05 局部三关键帧沿用 v05 的 `green/gold/roast` 资源与已验证机制，**不同于 v07 背景 Runtime 新生成的同名物件**。
- U06 画面仍由 Canvas/DOM 绘制，水声由 WebAudio 在用户触发后合成，没有新外链声音文件。
- 背景裂解碎片、杯中液面、组织遮罩、局部阴影等由 [background-runtime.js](background-runtime.js) 从上述图像或参数图形生成，不宣称为科学级流体/破碎模拟。

## 打包与继续创作

素材源文件和运行时资源各有用途：原 PNG 便于处理与再配准；WebP 用于实际渲染；新主题可改配置及绘制算法，但需重新完成配准、5点中间帧审片、资源闭包与正式 GLX 保存/离线检查。独立艺术审片页只是研究资料，**不能取代正式主 GLX 或离线 HTML**。
