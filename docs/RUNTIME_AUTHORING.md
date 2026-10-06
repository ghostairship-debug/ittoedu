# 局部程序与运行开发指南

当前工作走统一 Component API 5 运行合同。[旧 Runtime API 2/3 指南](archive/README.md#历史原文)记录旧载体与宿主，不能据其内部 reserved 接口声称当前公开能力。

复杂实验、模拟、游戏或连续机制写成独立组件；普通文字、媒体和简单互动优先使用当前专业数据与软件已有状态体系。组件内部自有排版，页面几何与邻居由正式 frame/编组/顺序承担。

生命周期、运行 scope 和实际可用端口以 [runtime.ts](../src/shared/contracts/component-platform/runtime.ts) 为准；Authoring spot 只是瞬态观察，正式身份由宿主注册/捕获。Source 的 project/surface/instance 同步读和跨未访问页目标按现宿主实现保留，不裁剪成仅当前可见页。

默认组件复用预置实现；局部 Source 沿现内存编译/缓存链准备，不逐实例磁盘打包，不静默转成静态 fallback。语法、真实依赖、资源、生命周期和权限的具体问题清楚诊断，不用假设风险拒绝整份可用内容。

观察使用与 Player 同源的运行投影；首次画面等待实际内容 frame 的字体与绘制，零视口隐藏 frame 不加入等待。输入、局部状态和已访问 realm 由原生命周期 owner 保持，不因隐藏就销毁。

开发实现从[组件指南](COMPONENT_AUTHORING.md)、[Player owner](../src/player/components/ComponentPlatformRuntime.ts)、[Sandbox 实现](../src/renderer/components/SandboxComponentImplementation.ts)及直接用例进入；不新建第二套 writer、运行平台或 authoring 几何。
