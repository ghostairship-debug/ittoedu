# 明确使用外部 Builder V2 的任务

仅保留给明确选择历史 V9 外部案例构建、且当前环境确有产品仓库和 Builder V2 的任务。该历史入口不输出当前 V10 `.glx` 工程；当前 HTML 导入使用主 Skill 的 `course.createFromHtml`，工程内创作使用当前 Gateway。

教师课例目录存放内容和交付物；产品仓库只提供实际安装的构建工具。可运行 `node <skill目录>/scripts/resolve-editor-root.mjs` 定位产品，不改变教师工作目录。该脚本只定位现有入口，不执行导入或保存。

外部模块导出 `apiVersion = 2` 和默认构建函数。使用注入的 `context.api`、`documents`、`readAsset`、`encodeBase64`；从当前 `api.discover()` / `session.discover()` 与具体能力卡取得实际可用的操作。通过受管会话构建并返回 `await session.finish()`。模块不导入产品内部源码或直接写正式工程。

现有命令入口：

```text
npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <relative.h5lesson> --html <relative.html>
```

输出路径相对课例目录；只有用户要求覆盖相应已有交付物时使用该命令的 `--force`。此命令负责它实际提供的打包、保存和离线输出。它不证明其他工具也有相同导出能力。

不要为普通创作新建 Worker 流程、能力索引副本或逐页手写参数。出现具体运行或资源失败时修复对应输入；检查通过后完成交付，不机械扩大验证范围。
