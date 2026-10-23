# 果铃资源、运行性能与动画基础修复结果

2026-10-24。范围仅果铃软件；v08 正式 GLX、HTML、素材和路线代码均只读。GLX 17,502,438→8,434,293 B（-51.81%），正式 Main HTML 29,529,332→16,389,609 B（-44.50%），同 gzip HTML 20,232,982→10,604,673 B。实际资源、Editor、离线 Player、桌面与移动宽度验收按下列证据判断。发行、push、部署和创作修改未执行。

## 已确认并修复的软件问题

| 用户结果 | 源码/测量根因 | 实施结果与直接证据 |
| --- | --- | --- |
| GLX 重复保存相同素材 | 项目资产与组件包按逻辑路径分别落 ZIP，原局部哈希不能覆盖归档边界 | 原 codec 与组件 manifest 共用内容实体索引；逻辑 ID/文件路径与字节可编辑性保留。真实 v08 114 个逻辑条目只存 64 个实体。`resource/RESULT.md` |
| 单 HTML 重复 Base64 | 资产表、静态输出和程序引用各自内嵌，ZIP 层没有机会去重 | 原序列化出口按精确路径/offset 抽池，Main preview 和 HTML 编辑消费同一恢复结果；不碰作者字面语义。`delivery/IMPLEMENTATION.md` |
| 不同图片来源优化行为不一致 | 衍生需求与编码策略分散，旧 WebP 主要只改编码而无显示尺寸依据 | 普通导入/GLX 保完整原件，共同 Published producer 收集真实布局需求，统一 encoder/cache 供 HTML/Web/Published 使用；未知用途保原。`images/REPORT.md`、`published-image-demand.json` |
| 初始化重复解码资源 | 多个 realm 建目录时全读、同 source 重复 atob/Blob，反向查询又展开 lazy getter | 现 lease 按需解码、同内容共 Blob、逻辑 ID/版本各有独立 URL；实际 consumer 的反查与合并不再物化全目录。`runtime/RUNTIME_CHANGES.md` |
| Flow 连续滚动严重长帧 | trace 确认 findInstanceParent 全实例扫描，及无关 state.set→navigation.changed→布局/可用性查询反馈 | 对当前正式快照派生父索引；精确 state 订阅保留，导航只接其真实 guard 依赖。`performance/FINAL_PERFORMANCE.md` |
| 跨组件动画混用不同位置时刻 | 旧接口主要是独立 viewport/layout/state 报告，作品自行拼接历史坐标；Editor Flow 容器 target 未接正式测量 root | 可选 scope.measure 一批返回同一时刻的调用者视口与 Flow 内容事实；World/Host/Sandbox/compiled 共用，无第二位置缓存，旧 scope 退休返回 null。`geometry/REPORT.md` |
| 字体大幅超带 | 两个 range 被当作任意文字输入，使 selector 包含全部 101 片 Noto Sans SC | 复用 HTML scanner 按真实输入能力判定；range/number/button 等有限控件不触发全字库，文本/未知输入/文件名/动态文本保完整覆盖。实际同一 Published 选择 24 片。`size-followup/FONT_ANALYSIS.md` |
| standalone Player 多打无用依赖 | compiled 入口的两个纯投影函数从 UI/完整 Player 模块导入，带入不被消费的 Babel/KaTeX 初始化 | 函数职责移至 publishedProjection，所有消费者直接引用同一实现，无兼容 re-export；实际 compiled bundle 减少 457,507 B。`size-followup/RUNTIME_AND_FORMAT_ANALYSIS.md` |

没有给 v08 加专属宿主分支，没有重写 Flow/Player 调度平台，没有新增 writer、History 或独立资源管理器。独立结构评审见 `STRUCTURAL_REVIEW.md`，追加字体/打包评审见 size-followup 报告。评审发现的本轮候选回退（共享 Blob URL 导致身份混淆、opaque HTTP 字体/Canvas 跨域）均在交付前修正；不得说成旧正式 v08 的既有故障。

## 实际编辑与运行验收

实际 Electron 通过旧 flat GLX 副本打开、完整逻辑工程/全部资源对照、canonical 修改、Undo/Redo、保存、关闭、新 profile 冷开，以及正式 Main→worker→headless Renderer 导出并消费离线 HTML。原件、revision 247 基线和此前未提交交互成果保留。Editor 总冷启动波动较大，不能签总冷开已提速，具体 stage 时间见 PERFORMANCE.md 和 `editor/RESULT.md`。

裸 HTML 使用相同 Chromium/脚本完成修前修后 cold、cache、持续滚动 trace/CPU 和真实鼠标输入；七章导航及三个局部实验的十项行为通过，0 页面错误/离线网络请求。390px 是浏览器移动宽度、不是物理手机触控签收。字体与包依赖后续收敛后的最终制品另作同条件 cold/真实输入验收，旧 cache/Profiler 数据明确保留为第一阶段候选证据，不混称同一制品。

## 属于作品的剩余问题

v08 的历史视觉槽位与当前滚动事实混用、`.at(-1)` 路线选择、杯子入场、移动 14px 缩放及原生/运动对象艺术交接由作者程序决定，本轮未改。旧约 2198px 跳变保留原诊断证据；本轮有限区间没重现不能签全路线无跳变。新 measure 能力不会自动替换作品原逻辑；正确同批测量、暂态 target.motion 和取消/释放方式见 CREATIVE_HANDOFF.md。

## 支持程度与剩余成本

果铃的通用资源身份、保存冷开、三个交付出口、真实 Flow 几何与暂态动画链路已修复并有直接验收，可继续承载这类复杂作品。完整 v08 跨章节艺术路线仍需创作线采用正确时空事实后验收，不能以七章冒烟等同整作完成。

最终桌面/移动宽度材料就绪12.171→5.381s / 19.855→4.184s；持续滚动平均主owner间隔126.8→21.59ms / 204.8→18.91ms。持续运行仍有导航几何查询、iframe/source 初始化、GC/消息和绘制成本；最终滚动最长150/83.4ms，未达到稳定60fps。作品自身同步像素处理未被改写。Web包的独立资源可缓存，但file/opaque同步资源合同仍需要一次portable字节载体，整个ZIP并非零重复或所有素材逐项异步加载。没有以删素材/字库覆盖或静态化功能换体积。

三套TypeScript检查和相关正式构建通过；隔离候选从HEAD只叠加本轮增量后再次三套类型通过，证明不依赖前一轮交互dirty。测试针对资源身份/History、真实衍生、三个出口、lazy consumer、状态依赖、同批几何与退休生命周期。四项旧glxContainerProjection夹具失败已在只读HEAD变换复现，未改断言洗绿；首次浏览器清理超时与测试harness参数错误也保留失败记录，不作软件故障或通过证据。相关限定见各叶子报告。

准确资源/加载数字、条件和前后变化统一见 PERFORMANCE.md；接口和文件职责见 SOFTWARE_CHANGES.md。本地提交只包含本轮增量，前一轮统一选中/拖动/编辑修改与其他创作工程留在原工作树，不混入提交。
