# U05 三关键帧：实际装配源码

`u05-inline.html` 从最终 r204 GLX 的 U05 程序提取；仅将宿主 `cw-resource:` 地址重定向到本目录 `assets/`，便于直接浏览和改写。HTML/CSS/JS 均来自正式工程，脚本与 r179 完全一致；资源一一映射在 `GLX_RESOURCE_MAP.json`。

修改素材或样式后须用当前工程真实 `.content.html` 路径经 `project.apply` 正式提交，再保存、导出。源码文件不会自动同步到 GLX。三张图像的生成来源和许可沿用 [v05/ASSETS.md](../../../v05/ASSETS.md)。

本轮只为统一背景去除程序自身的深色整块底面及 color-scheme 元标签，保留局部可读性衬底、三关键帧、滑块、自动播放、放大和返回状态。见 ../../REFERENCE_CASES.md 与 ../../VERIFICATION.md。
