# 随软件分发的内置组件

这里是内置组件源码和组件包的唯一维护位置，属于本软件仓库。四个组件为：语文朗读标注、汉语拼音标注、文字视觉容器、图片装饰容器。

- `components/`：组件源码、Manifest 和缩略图。
- `packages/`：由源码可重现构建的 `.h5component` 包。
- `catalog.json`：内置目录，记录精确版本、包摘要和来源信息。
- `scripts/`：复用软件根目录依赖的构建工具，不需要单独安装依赖。
- `verification/` 与 `catalog.post-verification-attestation.json`：原组件仓库的历史验证材料，不是当前 V9 的验收结论。

在软件仓库根目录执行 `npm run build:built-in-components` 构建，执行 `npm run check:built-in-components` 检查源码、现成包及目录是否一致。修改目录后应同步审核 `src/shared/builtInComponentCatalog.ts` 的发行摘要，并重新生成 AI 能力清单。

打包只携带目录、四个包与所引用的缩略图；源码、构建工具、历史证据及独立依赖目录不进入安装产物。应用从 `app.getAppPath()/resources/built-in-components` 读取，因此开发版和 `app.asar` 内的安装版使用同一相对路径。

`COURSEWARE_COMPONENTS_DIR` 和用户选择的外部目录只提供附加组件，不替换内置目录，也不因内容与内置库相同就被标为内置。外部包及未来在线市场独立管理；组件加入课件后仍嵌入工程，保存、重开和导出使用工程内版本。

迁入来源：本机历史 `courseware-components` 仓库 `e85b65a`（2026-09-22）。本次迁移保留包内容、版本、目录摘要及 [来源记录](PROVENANCE.md)，不改变实验质量状态，也不把历史 V8 验证升级为当前产品签收。
