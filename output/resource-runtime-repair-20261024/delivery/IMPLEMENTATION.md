# 交付序列化与 Web 资源修复

本叶子只改软件与 output 验收副本，未修改 v08 正式 GLX、离线 HTML、素材或动画源码，未提交 Git。

## 已实施

- `shared/serializedResourcePool.ts` 是单文件序列化适配。重复 Base64 本体仅写一份，字符串的 MIME 前缀保留，按精确属性路径与 UTF-16 offset 插回原文。普通 authored token 不作为占位符，包含嵌套编译代码、JSON signature、HTML/CSS 的字符串能够原样恢复。Published / compiled 作者模型与逻辑资源 ID 不变，没有新永久资源管理器。
- `buildSingleHtml.ts` 的 Published / compiled 模板共用此适配；调用原 mount 前恢复对象，缓存仅附在既有 `course-data` 元素上，不重新 stringify / textContent 复制完整大 JSON。JSON、池、脚本或 mount 失败继续走可见诊断。
- Main 静态 HTML preview 与运行中的 `htmlFrameAuthoring.readAliases` 接通真实 compiled-v2；静态投影移除已经消费的 pool，避免 bootstrap 重放旧 offset；author aliases 等待异步本地字节准备结束后读取已解码对象。
- `resourceUrl.ts` 复用浏览器 / Node 原生 btoa，按 32 KiB 构造 binary-string，保留无 btoa 主机的原算法。
- Web ZIP 通过既有 `resourceContent` 内容索引共用物理二进制，地址按 hash 与实际 MIME 生成，原逻辑 ID、使用位置、元数据仍分开。必要 MIME 区分保证 CSS / JS 同字节不会被 HTTP 以错误类型交付。
- Web 编译被动 HTML / CSS 的真实媒体 URL 外置为同一物理文件并走既有 `cw-delivery` / consuming-realm 资源接口；脚本、数据和 factory 中的 dataURI literal 保留，因为作者代码可能检查或拆解它，不能靠全局替换改变语义。
- `course-assets.js` 在 file:// 开场准备；普通 HTTP 静态 / 同文档组件不请求此 fallback，使用独立文件缓存。HTTP 首次实际进入 opaque Source / nativeData 时，沿同一脚本 loader 准备捕获字节，再通过既有 World / realm portable 资源通道供给，避免跨 origin Canvas 污染。其按 hash 保存一次 Base64，多个 ID 共用一次 atob 后的 bytes。当前同步动态 `resources.url` 合同仍要求 opaque 首次使用时准备完整授权目录，不能宣称此场景已经逐资源懒加载。
- Web 主 HTML 不嵌字体 Base64。主文档使用独立缓存字体文件；opaque iframe 复用单个可缓存 `course-fonts.js` 里的 portable face CSS。该必要传输保留字体二进制与一份 iframe portable Base64 的小重复，不能据此宣称整个 Web 包无重复。
- 三个 Renderer export builder 的最后可选 `imageDemands` 参数透传到同一 core / 图片衍生 consumer，`original` / `detail` 等例外可通过正式出口使用，不改变现有 caller。
- 实际 compiled authoring consumer 复制 lazy URL property descriptor、按 lease.reverse 反查，避免仅为资源反查或 authoring refresh 就展开并解码整个资源目录。
- compiled 原生资源准备只调用 `world.prepareResources`，不在 resolver 内重入 `world.sync`；捕获目录供后续 resize / navigation 的 sync 持续使用，player 退休后不再准备资源。共享 loader 不随首个 consumer 的取消一起取消。导出的 Published 模板保留原字节 consumer 合同，实际 Web compiled 出口使用新按需回调。

## 聚焦验证

18 项唯一测试通过；R10 修改后，受影响的 packing / compiled resource 6 项再次聚焦通过，其余未受影响的已有证据继续有效。

| 文件 | 项数 | 实际证明 |
| --- | ---: | --- |
| `resourceDeliveryPacking20261024.test.ts` | 4 | 跨 ID / MIME / 嵌套代码一次 Base64；精确恢复和 script closing 安全；损坏池 / 脚本错误可见；v2 静态 preview；真实 Published→ZIP 内容写入、file fallback / HTTP 不加载及正式质量参数传导 |
| `compiledResourceDemand20261024.test.ts` | 2 | 实际 mountCompiledCourse 只物化使用的 1 个资源，保留 1 个未使用资源；HTML author aliases 等待 bootstrap 缓存，避免完整 DOM JSON 复制 |
| `componentDeliveryFormats.test.ts` | 6 | 真实字体与 notices、出口、格式和已有保存 consumer；Web 字体结构断言迁移到主 HTML 独立字体与 portable font script，未删除字体功能断言 |
| `compiledHtmlPreviewAssets20261021.test.ts` | 3 | 既有静态预览、重复 identity、已保存 image record 保留 |
| `browserCompatibility20261020.test.ts` | 3 | 既有实际脚本编译、局部诊断、bundle / JSON / entry 错误可见 |

R10 复核的 packing 用例还证明 HTTP 初始不载 fallback、两个并发按需 callback 只加载一次脚本并返回同一目录；实际 compiled static consumer 不触发 opaque fallback。Root 的相关 Player / Renderer 构建与三套类型检查也已通过，未因本修复机械重建 Main。

最终与质量 / 字体相关 10 项运行：01:33:05 开始，35.73 s，全部通过。该时段与 Editor CPU baseline 重叠，已通知 Root / Editor 验收者排除此重叠性能样本，不能将它作为干净性能基线。

首次新 Web 用例失败是测试主机 jsdom 28 已移除旧 ResourceLoader API；改为明确拦截本地 classic-script 的 fixture 后通过，未掩盖生产失败。

## 真实字体反例与修复

- `font-cors-probe.json`：普通无 ACAO 的 HTTP 字体 URL 传入 sandbox `allow-scripts`、origin=null 的文档，实际 Noto Sans SC 25,240 字节字体 `document.fonts.load()` 拒绝 NetworkError，face.status=error；有 ACAO 的控制组 loaded。
- `font-cors-probe-after.json`：当前正式 `buildCompiledSingleHtml` 的 `preparedFontScriptUrl` / bootstrap / fontOption 真实执行，course-fonts.js 由浏览器 script 加载，再向最小 opaque consumer 传 options.fontFaceCss。HTTP 与 file:// 均 loaded=1、face.status=loaded，零 console error / failed request。只将 mount 回调缩为最小字体 consumer，没有把硬塞 dataURI 冒充模板验收。

## HTTP opaque Canvas 读像素

这是独审发现并关闭的**初版 HTTP 外置候选回归**，并非声称原版 v08 已有此故障。原实现开场加载全量 captured bytes，原来的像素可读能力必须保留。

- `canvas-resource-probe.candidate-regression-before.json`：实际 `buildComponentWebPackage` → 正式 compiled Player → 真 sandbox，确认 nativeSources=1、同文档 sourceFactories=0、nativeData=1。无 ACAO 的 HTTP 下，Source 的 `ctx.resources.url('sample')` 与 nativeData 的被动 img 两条路径均能 decode / draw，却在 getImageData 抛 SecurityError；file:// 原 fallback 两路径 RGB `[255,0,0,255]` 可读。
- `canvas-resource-probe.candidate-regression-after.json`：相同生产链路、相同无 ACAO / file 条件，4 个实际路径全部可读相同 RGBA，零 console / pageerror / failed request。实际调用 `coursePlayer.update()` 重新走 World sync 后，两个出口的 `runtime.resourceUrls().sample` 仍是长度 166 的 portable dataURI，捕获目录未被下一次更新清掉。
- 前后 generated、源 fixture、正式编译结果和 after 截图均保留。没有改 v08 正式作品，也没有为其写特殊 Canvas 或资源逻辑。

## 证据界限

- 以上不代替正式 v08 完整编译、7 章 / 3 实验、HTML / Web 真运行、加载与连续滚动对比。它们由 `export-candidate.*` 和本轮独立性能 / Editor 验收继续采集。
- Web 逻辑 ID 仍在 payload 中独立保存，共享 HTTP URL 不能唯一反推原 GLX 资源 ID。独立 HTML 编辑依赖精确 DOM / record handle；没有宣称 HTML→GLX 身份 roundtrip 全覆盖。
- 脚本 literal 不能无条件外置；单文件池会去重其重复 Base64，Web 被动 URL 会外置，其余保留作者可计算的 dataURI 语义。
- 本轮候选输出、测试日志和字体 probe 保存在本目录；正式作品保持只读。

## v08 真实交付副本

`export-candidate.generated/` 来自正式 `buildComponentHtml` / `buildComponentWebPackage`、真实 Chromium Canvas、Main 同源编译器和实际字体字节。复用 Root 完成集成后生成的正式 compiled Player；未改源工程 / 模块 / 动画。首轮因 harness 字体 RPC Buffer.toJSON 传输失败的 HTML 不作为证据，以下为完整字节修正后的稳定候选。

| 相同条件测量 | 原正式离线 HTML | 本轮软件副本 |
| --- | ---: | ---: |
| HTML bytes | 29,529,332 | 21,253,952 |
| 同次 Node 默认 gzip bytes | 20,232,982 | 14,036,638 |
| 物理 Base64 存储段（包含池里的裸 Base64） | 202 | 161 |
| 唯一二进制内容 | 161 | 161 |
| 重复存储 decoded bytes | 6,222,390 | 0 |
| 唯一 decoded bytes | 13,500,679 | 13,503,023 |
| 逻辑资产 ID | 80 | 80 |

HTML 减少 8,275,380 bytes / **28.024%**；主要是删除重复内嵌。唯一 decoded 内容实际 **增加 2,344 bytes**，不能把本轮结果表述为 v08 的大幅图片降分辨率。`imageChanges` 中四 JPEG→WebP 共减少 212,852 bytes 是相对 GLX 原图，旧 HTML 本来已经优化为 WebP，因此不是相对旧 HTML 的新增净收益；尺寸保留。

Web ZIP 是 27,668,927 bytes。独立资产目录 55 个物理条目、8,921,364 bytes、重复 0；`index.html` 3,339,361 bytes。另保留 11,910,378-byte asset portable script、6,123,041-byte font portable script 和 4,516,508-byte 实际主文档字体文件。它同时支持静态 HTTP 缓存、file:// 与 opaque 同步动态资源目录，不能宣称整个 ZIP 无重复或所有复杂 native 场景已经逐资源按需准备。

`transport-acceptance.json` 的 HTTP / file 两组均 coursePlayerReady，七章入口保留，原 water+50 按钮得到 250g；字体无 error、无 pageerror / failed request，截图已实际检查中文、图片和实验排版。HTTP 观察到独立 assets 7、font files 9，首次 opaque consumer 的 portable script 1 次；file fallback 1 次、external requests 0。此处没有重复完整七章 / 三实验矩阵或连续滚动性能测试，后续正式 Main 导出、Editor 与性能叶子另有真实证据。
