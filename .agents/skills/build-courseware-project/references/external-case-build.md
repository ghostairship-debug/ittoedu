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

候选必须同时满足：能力索引可解析、`package.json` 声明 `build:courseware-case`、`scripts/courseware-builder-v2-host.ts` 存在。多个候选代表不同产品版本且会改变能力时才请用户选择；不要把“请提供编辑器仓库”作为正常第一步。

找不到有效候选时，说明缺少的是本机产品安装或已保存项目，而不是教学材料。停止构建并保留课例目录，不要求教师把交付目录改造成 Git 仓库。

## 课例构建模块合同

新课例使用 Builder V2。默认模块为 `<case-dir>/implementation/build.ts`，显式导出 `apiVersion = 2`，并 `default export` 一个函数，或导出 `buildCoursewareCase` 函数。下面只展示调用形态；正文必须换成已确认脚本的内容：

```ts
export const apiVersion = 2

export default async function build({ api }) {
  const session = await api.createCourseProject({
    surfaceType: 'slide', title: '课程标题',
  })
  const scope = await session.createScope({
    parent: { kind: 'owner' }, insertion: { kind: 'append' },
  })
  const receipt = await session.execute('native.content', {
    operation: 'insert',
    template: { nativeType: 'text', text: '已确认的正文', x: 60, y: 70, width: 1100, height: 130 },
  }, { kind: 'create', scope })
  if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt.diagnostics))
  return await session.finish()
}
```

`context` 提供：

- `apiVersion`：本模块使用的 Facade 版本，当前新课例为 `2`；
- `caseDir`：解析后的课例根目录；
- `documents.teachingPlan` 与 `documents.presentationScript`：当前文件路径和内容；
- `capabilityIndex`：当前生成索引；
- `api.createCourseProject({ surfaceType, title })`：创建产品管理的浏览器构建会话，`surfaceType` 按脚本选 `slide` / `flow` / `spatial-2d`。

会话的 `tools` 是可调用工具名列表；`snapshot()` 返回工程快照、当前 scope 与 canonical targets；`activate()` 切换位置、owner 和状态；`createScope()` 获取插入地址；`execute()` 返回正式 receipt。除 `tools` 外，上述方法及 `finish()` 均须 await。一次成功修改后重新取需要使用的 target/scope，不复用旧 revision；失败先读 diagnostics，不能跳过失败继续组装交付物。

`snapshot().project` 用于读取；不得直接修改它作为写入。最终原样返回 `await session.finish()` 的结果，不拼装、克隆或篡改输出对象。完整公开 API 示例见 `<editor-root>/tests/fixtures/builder-v2-case/build.mjs`，类型入口为 `<editor-root>/scripts/courseware-builder-v2-host.ts`。

未声明版本或 `apiVersion = 1` 的既有课例仍由兼容入口处理；`context.api.project` 等工厂分组属于 V1，不是 V2 API。新课例不选 V1。V2 当前创建新构建会话，不把它当作打开并修改教师已有工程的 API；既有工程增量编辑须经当前真实编辑器入口与稳定目标完成，不能重建覆盖。

模块可以导入 Node 内置模块读取课例内素材，但不得导入编辑器内部路径、修改 editor-root 或自己写最终 `.h5lesson`/HTML。最终打包、校验和事务式写入由产品入口负责。

## 调用与失败边界

从任何工作目录运行：

```text
npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <relative-name.h5lesson> --html <relative-name.html>
```

`--plan` 与 `--script` 可覆盖两份 Markdown 的默认相对路径。输入、构建模块和输出都必须留在 `case-dir`，链接逃逸和路径别名会被拒绝。已有输出默认不覆盖；只有当前任务明确要求替换它们时使用 `--force`。

入口失败时先修正构建模块或产品能力；不要绕过它改回脆弱的源码相对导入，也不要在课例目录复制一份编辑器源码。
