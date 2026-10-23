# 软件修改与接口

2026-10-24。本轮软件任务；正式 v08 工程、离线 HTML、艺术素材和路线代码均只读。上一轮交互修复保留在工作树，单独按 initial-tree 基准隔离本轮提交。

## 资源身份与持久化

- `src/shared/resourceContent.ts` 复用现有 SHA-256 依赖，提供同一内容身份的同步/原生异步实现及一次归档的实体索引。Renderer 导入继续使用原生异步 WebCrypto，避免同步哈希占据 UI。
- `src/core/drivers/codecs/courseProjectV10Archive.ts` 将逻辑资源路径与物理 ZIP 实体分离。`project.json`、80 个素材 ID、来源、尺寸、原件、34 个组件相对文件不变；`resource-index.json` 映射到 `resources/sha256/<digest>`。旧路径归档仍可读。对外逻辑字节仍独立可变，不让一个 ID 的修改串到同内容另一 ID。
- `src/core/components/library/archive.ts` 用原有 manifest 映射复用同一实体索引。DocumentSession、canonical transaction、Undo/Redo、资源 COW、保存与恢复 owner 没有替换。

## 发布图片

- `src/shared/imageDerivative.ts` 统一显示需求/裁剪/DPR/编码策略；`encodeDeliveryImage.ts` 沿原文档 epoch/revision 生命周期缓存同源同参数结果。
- `imageDemand.ts` 收集真实 native image 和可知 Slide 背景的最大显示需求。复用 Flow lane/outer presentation；先在本地计算 crop/fit，再按真实 affine 两源轴像素密度选择衍生，避免 Flow 小 frame 或旋转非均匀缩放造成欠采样。
- 流式全宽、未知 CSS/程序/主题用途、嵌套容器 viewport fit、Spatial camera 及多个 presentation owner 的组合没有可靠显示上界，保留分辨率。单 owner 的有效状态逐一合并；不建状态笛卡尔积。未知使用会阻止同一素材其他小图用途把它缩小。根容器由 viewport owner 布局，不误用其 free-object frame。
- 裁剪仍针对完整源图，不物理裁掉载体；不放大。SVG、GIF/APNG/动画 WebP 和 original 保原；已有有损 WebP 仅真实缩小时重编码。未知 PNG 保守无损；photo 可选 WebP，detail 使用 PNG，透明有损载体保 alpha 并采用更保守质量。编码未节省字节时沿用原件。
- `buildPublishedCourseV3.ts` 的 V4 producer 排除 native image 的编辑用 originalAssetId；真实程序另有引用仍保留。同步更新交付素材的编码、字节与 intrinsic 尺寸，不改原工程。
- 三个正式 Renderer builder `buildComponentPublished/Html/WebPackage` 最后可选 `imageDemands` 参数，贯通同一质量/测量例外。普通导入/Main admitted 保完整原字节是正确编辑职责。`prepareGeneratedImage.ts` 虽共用策略，目前无生产 caller，不宣称导入入口已通过该 helper 优化。

## 交付载体

- `serializedResourcePool.ts` 是单文件序列化适配：按精确属性路径和字符串 offset 抽出重复 Base64，各 MIME 前缀和作者原文保留；不使用会与作者文字碰撞的占位 token。
- `buildSingleHtml.ts` 在原 mount 前恢复对象并缓存于现有 course-data 元素，不重写完整大 JSON DOM。Main 静态 preview 与独立 HTML 作者别名读取同一解码事实，覆盖 compiled-v2。
- Web 包按内容与实际 MIME 保存唯一物理资源；普通 HTTP 消费使用独立文件缓存，file 协议沿原经典脚本字节准备。编译后被动媒体 URL 可以外置；程序可能计算的 dataURI 字面量保持语义。
- `course-fonts.js` 提供隔离 iframe 所需的 portable 字体 CSS，HTTP/file 均可用；主文档仍使用独立字体文件。该隔离传输有必要的少量字体重复，不宣称整个包零重复。
- `bundledFontSelection.ts` 复用 HTML scanner 区分有限控件与任意文字输入，递归检查 srcdoc/事件/代码字符串。range/number/button 等不再误带全字库；真正文本、textarea、contenteditable、未知输入、任意文件名和原动态文本来源保全覆盖。不改变字符收集或按当前页面字体请求裁掉后续章节。
- HTTP 的第一个 opaque nativeSources/nativeData 消费者通过既有 async resolver 与同一 script loader 按需准备 captured bytes，仅调用原 World.prepareResources；后续 sync 继续使用捕获目录。纯静态/同文档使用独立 HTTP 文件。现同步动态资源 API 仍需要完整目录，opaque 首消费不是逐图片异步取字节。HTTP/file 四条真实 Canvas 路径均读到正确 RGBA，update 后目录仍保持；资源可显示不能替代 getImageData 可读的证据。

## 运行性能

- `containerScopes.ts` 从当前正式快照派生并复用父索引；新快照/实例映射/相关身份变化失效。没有第二作者树。
- `ComponentRuntimeWorld.setState` 保留精确 state 订阅和 runtime state 事件；仅导航 guard 实际依赖的 key 才发导航变更，停止无关状态→导航→布局测量反馈。
- `resourceUrlLease.ts` 登记目录不解码，读取时才对精确 source 解码 Blob 一次；每逻辑 ID/版本独立 URL，历史 URL 保持到 lease 退出，统一释放。相同 Blob URL 不能替代逻辑身份。
- Sandbox、owned-document、authored parser 和 compiled Player 反查/合并接入非物化 reverse/descriptor，避免反查展开整个 lazy 目录。缓存局限于现有 realm 和挂载生命周期，没有跨隔离区共享 Blob 地址。
- 两个纯投影函数迁入 `publishedProjection.ts`；ModelPlayer、compiledPlayer、publishedPlayer、outputCapture 直接消费同一实现，消除 compiled 入口经 UI/完整 Player 引入的未用 Babel/KaTeX 初始化，无第二实现或兼容转导出。Player 实际构建从 1,610,898 降至 1,153,391 B，普通 Player 保持原体积。

## 坐标与暂态动画

现有 `ComponentRuntimeScope` 增加可选：

```ts
measure?(references: readonly ComponentTarget[]): Promise<ComponentGeometrySnapshot | null>
```

同一次同步 host 观测返回 sampleTime、调用者视口 viewportFrame、Flow 内容 contentFrame、同批 contentToViewport/scroll viewport。跨 iframe 在同批投影到调用者视口；挂载离屏目标可测、未挂载返回 null；退出/替换后结果失效。没有位置缓存、文档事务或新布局树。

World/Host/Sandbox/compiled 共用该事实；FlowWorkspace 补正式 Flow 容器 target 注册及 expected-root 清理。`target.motion.replace` 现有 write/nextFrame/animate、取消与卸载清理继续承担暂态动画，不每帧写作者 frame、opacity 或 History。

正式发现入口：`componentAuthorSourceRuntimeNote` 与 `.agents/skills/workbench-usage/references/project-files.md`。调用约束和作品交接见 CREATIVE_HANDOFF.md。
