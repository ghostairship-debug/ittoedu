# v06 素材、资源与来源

本版以 r179 已有素材为基础，新增程序绘图和结构图解；未重新批量生成摄影风格图片。所有正式依赖随 GLX 与单文件 HTML 封闭打包，最终断网不产生 HTTP 请求。原素材来源与许可沿用 [v05/ASSETS.md](../v05/ASSETS.md) 和 [摄影台账](../../assets/photography/LICENSES_AND_SELECTION.md)。

| 资源 | 本版位置与身份 | 来源及使用边界 |
| --- | --- | --- |
| U01/U07杯、U03三路线静物、U05三关键帧 | 原生图像或局部程序资源，原件在 `../v05/assets/` | 沿用原 AI 生成解释性静物，不表述为真实批次记录 |
| 生长、分拣、果实、生豆、交接照片 | 保留原生图像与既有图注／署名 | 沿用v05记录的作者与CC许可，原摄影台账不删除 |
| U03三张新结构SVG | `programs/u03/assets/*-layers.svg`；内联到U03程序 | 本轮原创代码绘图；同尺度组织关系示意，厚度与颜色非测量数据 |
| U03三张静物照片副本 | `programs/u03/assets/natural.webp`、`washed.webp`、`honey.webp` | 与v05原件一致，用于可执行源码包 |
| U05已装配三帧 | `programs/u05/assets/`；映射见 `GLX_RESOURCE_MAP.json` | 从最终GLX提取；两个脚本与r179相同；仅重定向宿主资源地址为本地相对地址 |
| 全局杯／果／豆／粉末与溶质 | `background-runtime.js` 中Canvas路径、渐变、纹理与颗粒 | 本轮原创程序视觉，无外链图片或外部绘图引擎 |
| 糖水晶体／水滴／杯 | `reuse/solute-study/background.config.json` 中内联SVG | 本轮原创小型主题资产；离散SVG插值不宣称任意几何morph |
| U06杯体、纸滤杯、液面、水流、颗粒 | `programs/u06/water.js` | 本轮程序绘图；科学关系示意，非流体或分子尺度模拟 |
| 水声 | U06 WebAudio运行时合成 | 用户主动开启后触发，无音频文件下载 |

资源和程序的 SHA-256、大小及正式文件身份在 [DELIVERY_MANIFEST.json](DELIVERY_MANIFEST.json)。新源码文件只作为检索与改写入口；替换工程资源仍需正式事务与保存。GLX 中保留部分既有资源记录属于基线继承，不把它们误列为新创作或新增素材。
