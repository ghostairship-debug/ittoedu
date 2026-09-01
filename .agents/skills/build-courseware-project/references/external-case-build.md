# 任意课例目录构建

冷启动定位产品根目录、创建课例实现模块和执行外部案例构建时读取本文件。

## 两个根目录不得混淆

- **课例交付目录 `case-dir`**：教师的当前目录或明确指定目录。两份 Markdown、原始材料、`implementation/` 和最终交付物都留在这里；它不需要是 Git 仓库。
- **编辑器产品根目录 `editor-root`**：只提供 Capability Index、Builder Facade、产品工厂、校验器、Player 与导出器。不要把教学文件或交付物写进这里，也不要要求教师切换当前项目。

## 自主定位 editor-root

按信息成本从低到高执行，找到有效候选即停止：

1. 用户已经明确提供且仍有效的产品根目录；
2. 当前目录或其祖先本身包含 `artifacts/ai-capabilities/index.json` 与 `package.json` 中的 `build:courseware-case`；
3. Codex Desktop 可用时，读取已保存项目，选择同时满足上述两个文件条件的编辑器项目；
4. 在当前已知工作区根、用户 Documents/Desktop 的直接子项目中做有界只读查找，不递归扫描整块磁盘。

候选必须同时满足：能力索引可解析、`package.json` 声明 `build:courseware-case`、`src/renderer/course/coursewareCaseBuilderApi.ts` 存在。多个候选代表不同产品版本且会改变能力时才请用户选择；不要把“请提供编辑器仓库”作为正常第一步。

找不到有效候选时，说明缺少的是本机产品安装或已保存项目，而不是教学材料。停止构建并保留课例目录，不要求教师把交付目录改造成 Git 仓库。

## 课例构建模块合同

默认模块为 `<case-dir>/implementation/build.ts`。它应 `default export` 一个函数，或导出 `buildCoursewareCase` 函数：

```ts
export default async function build(context) {
  const { createBlankCourseProject } = context.api.project
  const courseProject = createBlankCourseProject({
    id: 'course-id', title: '课程标题', now: new Date().toISOString(), controls: 'canvas',
  })
  // 使用真实产品工厂与命令构建；不导入 editor-root 内部路径。
  return { project: courseProject, assetFiles: {}, componentFiles: {} }
}
```

`context` 提供：

- `apiVersion`：当前 Facade 版本；
- `caseDir`：解析后的课例根目录；
- `documents.teachingPlan` 与 `documents.presentationScript`：当前文件路径和内容；
- `capabilityIndex`：当前生成索引；
- `api`：真实产品模块分组，包括工程工厂、课程位置与逻辑命令、Slide/Flow/Spatial 作者命令、组件、归档和 Schema。

模块可以导入 Node 内置模块读取课例内素材，但不得导入编辑器内部路径、修改 editor-root 或自己写最终 `.h5lesson`/HTML。最终打包、校验和事务式写入由产品入口负责。

## 调用与失败边界

从任何工作目录运行：

```text
npm --prefix <editor-root> run --silent build:courseware-case -- \
  --case-dir <case-dir> \
  --builder implementation/build.ts \
  --project <relative-name.h5lesson> \
  --html <relative-name.html>
```

`--plan` 与 `--script` 可覆盖两份 Markdown 的默认相对路径。输入、构建模块和输出都必须留在 `case-dir`，链接逃逸和路径别名会被拒绝。已有输出默认不覆盖；只有当前任务明确要求替换它们时使用 `--force`。

入口失败时先修正构建模块或产品能力；不要绕过它改回脆弱的源码相对导入，也不要在课例目录复制一份编辑器源码。
