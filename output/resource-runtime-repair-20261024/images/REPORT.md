# 图片衍生修复

本目录只写软件与测试副本；v08 正式 GLX、离线 HTML、艺术素材与路线未修改。下列数值来自生产 `encodeDeliveryImage` 的真实 Chromium 编码，不是整作自动导出后收益。

## 已确认根因与责任

- 原 `encodeDeliveryImage` 只尝试原始像素 WebP q0.9，所有已有有损 WebP 直接跳过；即使原图远大于展示像素也不能缩小。
- `prepareGeneratedImage` 原有 512–1024 长边预算且 q1。源码检索确认它没有生产调用方，只有浏览器测试；不能以该文件已有优化证明普通导入、AI 生成或发布已覆盖。
- 普通导入 `assetManager` 和 Main `admittedImageResource` 保留原字节是正确的编辑职责；Main 完整解码仍用于识别实际损坏的输入。本轮没有在这些入口降采样、毁掉编辑原件或另起 Main 资源优化系统。
- 衍生是交付投影。统一纯策略 `src/shared/imageDerivative.ts`；Published 的展示需求收集与生产接线由 Root 完成。HTML/Web 共用 Published producer。

## 接口与行为

`ImageDerivativeDemand` 包含 CSS `width/height`、`dpr`（默认 2）、`fit`、归一化 `crop` 及 `quality: photo | detail | original`。未知程序的资源用途不应猜成小图；没有可靠尺寸需求时不缩分辨率。不存在固定最长边上限，不放大。

`beginDeliveryImageEncoding(...).encode(asset, bytes, signal?, demand?)` / `encodeDeliveryImage(asset,bytes,document,signal?,demand?)` 返回可选 `{ bytes,mimeType,filename,width,height }`。消费者采用衍生时必须同步更新 intrinsic metadata。若候选没有实际字节节省、浏览器不支持目标编码，保留可用原图。

裁剪只决定必要像素密度，不实际截掉载体，归一化 crop 坐标继续解释同一全图，避免二次裁切。contain 取适配倍率，cover/stretch 为需要的两轴倍率上界。

GIF/APNG/动画 WebP/SVG 保原编码。已有有损 WebP 没有实际缩小需求时不再次编码。透明图片保 alpha，颜色质量更保守。未明确分类的 PNG 默认保 PNG 无损，只有显式 `photo` 才允许其有损 WebP；不根据分辨率、大小或文件名猜摄影/图表。显式细图例外输出 PNG 无损（包括 lossless WebP 细图）；转换不划算则保原件。`original` 保全原分辨率和编码。

正式生产接线已核对：`buildComponentPublished`、`buildComponentHtml`、`buildComponentWebPackage` 均有最后可选参数 `imageDemands`，沿同一 Published producer 传给上述 delivery encoder。Published 直接调用需启用其既有 `imageDelivery` 开关。HTML/Web 自动收集可靠的原生展示需求；程序消费者可在这些正式出口显式传需求/质量例外。当前没有新增产品 UI 质量开关；未标明 PNG 采用保守无损规则，未知程序素材保持不缩小。没有把无生产 caller 的 helper 误算为所有导入入口已接线。

沿用现有文档 epoch/revision/存续 owner 的 delivery cache，内容 SHA + 转换参数区分衍生，逻辑 ID/文件名不决定物理工作，关闭/资源删除释放；取消一个导出不污染同源的另一导出。SHA 仍是原生异步 WebCrypto，没有换为主线程同步哈希。

生成图 helper 也使用同一策略并明确返回 `original`（完整字节、原尺寸、原名称）；同源不同字节对象/文件名共用编码结果，单独保留名称。该 helper 没有生产 caller，不能标为新增生成入口已验收。

## 证据

- `tests/unit/imageDerivative20261024.test.ts`：8 项，尺寸/DPR、crop、contain/cover/stretch、未知需求、向量/动画、无损细图、WebP 不重复降质、内容缓存/原件保留。
- `tests/unit/encodeDeliveryImage20261020.test.ts`：原有 11 项 + 新增 2 项的有效证据保留；现有 owner/关闭/epoch/revision/取消/失败重试测试保留，新测试覆盖尺寸/裁剪/DPR cache 与 lossy WebP。默认 PNG 保守规则落盘后，增加第 14 项（unknown PNG 不编码/缩小时 PNG/显式 photo 才 WebP），与对应 policy 断言、通用 JPEG 编码控制合计 3 项针对检查通过，不机械重跑整个组。
- `tests/integration/generatedImagePreparationBrowser.test.ts`：5 项真实 Chromium 完整解码/透明/边缘/格式/原件/损坏输入，按新需求预算更新旧 floor 断言。
- `tests/integration/imageDerivativeDeliveryBrowser20261024.test.ts`：2 项真实 production 编码，v08 JPEG/透明 WebP 与无损图表/向量/动画例外。
- `image-comparisons.json` 和三份 `*-comparison.png/html` 为实际字节、尺寸、显示像素误差和视觉对照。三张截图已读取目检，透明边缘和细图未见明显退化。

| 样本 | 原件 | 交付衍生 | 字节减少 | 同展示 RGB 平均绝对误差 |
| --- | --- | --- | --- | --- |
| v08 摄影 | JPEG 1371×2048，662516 B | WebP 720×1076，195768 B | 70.45% | 5.04/255 |
| v08 透明图 | WebP 1254×1254，487458 B | WebP 640×640，137468 B | 71.80% | 0.957/255 |
| 细图/文本 | PNG 2400×1600，89368 B | PNG 1200×800，61081 B | 31.65% | 0.016/255 |

这些展示尺寸是局部受控实验；整作生产 collector 必须遵循实际使用和未知消费者约束，不能把这三项百分比当整作收益。运行时扫描像素去背景、视觉路线选择不由这里替代。Root 负责 GLX/HTML/Web 实际总体积、启动/滚动、保存冷开与最终集成验收。

## 独立评审

图片策略 leaf 已单独交只读独审；独审发现 `detail` 初版仅保 PNG 无损，lossless WebP 细图仍会转 canvas 有损 WebP。已改为所有 detail 衍生使用 PNG 并增加真实浏览器回归；该修复后的针对性 15 项（8 unit + 5 helper browser + 2 production browser）通过。其余结果以 Root 的最终评审为准。

整体验收 R07 又指出默认 PNG 未分类时不能假定摄影。已按上述保守规则修正，并保持 Owner 指定的 JPEG/WebP 现有策略。此次相关 browser 单 case 的断言首次通过，但并行三 build 窗口清理 `afterAll` 10s 超时，命令 exit 1；首次不计为完整通过。Root 三 build 与三套 typecheck 完成后提供独占短窗口，原命令只重试该单 case，业务断言与清理均完成、exit 0（1 passed / 4 skipped，总 14.85s）；没有提高超时或修改实现来掩盖失败。原有 v08 摄影/透明图/显式 detail 图表样本不受默认 PNG 改动影响，仍是有效证据。
