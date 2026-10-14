# A06 字体作用域与样式重复处理

结果：同一作品的 direct Web/Source 复用所在 Document 已安装字体，只对课程主题和作者规则进行局部处理；native 独立 Document 保持必要字体和主题。移除同一软件 style 的二次扫描，不削减作者字体或样式表现。

依据：汇总 F06、T04；原离线 HTML 0 iframe，字体 CSS 6,121,891 字符被注入每个 direct 环境且重复扫描。4.060 秒为带采样的一次就绪观测，不能全部归因字体。

Owner / 写域：Root；`src/player/components/ComponentRuntimeWorld.ts` 的主题供给，`src/player/componentPlatform/compiledPlayer.ts` 的 direct/native 接线，`src/player/componentPlatform/compiledContentEnvironment.ts` 的局部样式准备及对应检查。依赖：无，可独立于作者记录实施。其他包修改这些共享文件时顺序集成。

实施：

1. 使用现有 courseThemeCss 作为 direct 主题供给，themeCss 保留独立文档所需完整字体。核对真实 root 字体安装路径，不建全局缓存/字体平台。
2. 新 style 先接原始 CSS，与作者已有 style 在同一遍遍历处理；保持 :root、引号、注释、资源 URL 与作者顺序语义。
3. 生成受影响 compiled player 制品。原作品与原 HTML 不变，输出另存候选；以同一作品和导出路径做对照。

最小验证：复用现有局部 CSS/隔离行为检查；增加或使用一条 direct Web、direct Source 与 native 字体消费者检查。真实浏览器查看同作品首屏、一次翻页和字体显示；采样只比较同环境同口径原件/候选，记录就绪、长任务及局部字体重复，不预设提速倍率。

完成条件：确认 direct 不再收到全包字体、同 style 只处理一次，课程/作者样式及 native 字体保留；已测性能与尚未测部分分开报告。纯源码或构建通过只能算候选，不能签用户浏览器性能。
