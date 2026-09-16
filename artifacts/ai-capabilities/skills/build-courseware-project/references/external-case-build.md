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
- `capabilityDiscovery`：当前精简发现入口，携带 `semanticVersion`；`capabilityIndex` 保留旧 consumer 兼容；
- `api.discover(query)` / `api.readCapability(id, options)`：与应用同源的只读查询和完整能力卡；
- `api.componentCatalog()`：本轮受管目录实际可用的包和 sourceId，未知受信来源不能冒充内置；
- `api.createCourseProject({ surfaceType, title })`：创建产品管理的浏览器构建会话，`surfaceType` 按脚本选 `slide` / `flow` / `spatial-2d`。

会话的 `tools` 保留工具名列表；常用 `observe({itemIds?,includeContent?,includeLocations?,offset?,limit?})` 只取当前 scope 和最多 20 个目标（limit 可至 100），返回 total / nextOffset，按需展开具体内容；Runtime 源码不随窄观察返回。 每次返回 surfaceGeometry（Slide canvas / Flow layout / Spatial bounds 与 camera）；includeContent 同时返回 contentMode:"raw" 的 items，以及仅本页当前 owner、同一分页对象的 effectiveLayout 和 componentDefinitions。effectiveLayout 使用当前命名状态后的外框/旋转/透明度/可见性/层序，保留原始 items 供编辑；Flow 正文按语义排版，无虚构固定外框。组件定义只含正式默认/最小尺寸与公开属性描述，不携带包源码或全部资源。其他 owner 的遮挡需切换 owner 分别观察，不能把当前 owner 列表当作整页合成。`activateScope()` 切换位置、owner、状态并返回窄观察；`createScope()` 获取插入地址；`execute()` 返回本次正式 receipt，`readReceipts({after,limit})` 用 cursor 分段取历史。会话的 discover/readCapability 与 api 同源，会话方法及 finish 均须 await。一次成功修改后重新取需要使用的 target/scope，不复用旧 revision；失败先读 diagnostics，不能跳过失败继续组装交付物。

旧 `snapshot()` / `activate()` 的完整快照返回保留兼容，只有确实需要全工程或完整 Runtime 源码时才调用。`snapshot().project` 用于读取；不得直接修改它作为写入。最终原样返回 `await session.finish()` 的结果，不拼装、克隆或篡改输出对象。完整公开 API 示例见 `<editor-root>/tests/fixtures/builder-v2-case/build.mjs`，类型入口为 `<editor-root>/scripts/courseware-builder-v2-host.ts`。

未声明版本或 `apiVersion = 1` 的既有课例仍由兼容入口处理；`context.api.project` 等工厂分组属于 V1，不是 V2 API。新课例不选 V1。V2 当前创建新构建会话，不把它当作打开并修改教师已有工程的 API；既有工程增量编辑须经当前真实编辑器入口与稳定目标完成，不能重建覆盖。

模块可以导入 Node 内置模块读取课例内素材，但不得导入编辑器内部路径、修改 editor-root 或自己写最终 `.h5lesson`/HTML。最终打包、校验和事务式写入由产品入口负责。


## 按需发现与复用示例

先理解两份已确认稿的整体教学目标；以下只取当前片段的技术能力。参数名来自实际卡片，不能把示例当作第二份 Schema。

```ts
const found = api.discover({ kind: 'recipe', surface: 'slide', owner: 'scene', limit: 10 })
const card = api.readCapability(found.entries[0].id)
// 审阅 card.content 的教学用途与 slots 默认值，按已确认片段填入内容。
const view = await session.observe()
const scope = await session.createScope({
  parent: { kind: 'course-locations' },
  insertion: { kind: 'after', siblingId: view.scope.locationId },
})
const receipt = await session.execute('recipe.apply', card.content.input, { kind: 'create', scope })
if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt.diagnostics))
```

组件先查询 `api.discover({kind:'component',surface,owner})` 并阅读卡片的用途、参数和支持域，再查当前宿主目录：

```ts
const catalog = await api.componentCatalog()
const source = catalog.packages.find(entry => entry.packageId === selectedPackageId
  && entry.version === selectedVersion && entry.sourceTrust !== 'prompt')
if (!source) throw new Error('本轮没有所选受信目录包；重新选取能力或按协议构建组件')
const scope = await session.createScope({ parent: { kind: 'owner' }, insertion: { kind: 'append' } })
const receipt = await session.execute('component.insert', {
  operation: 'catalog', sourceId: source.sourceId, packageId: source.packageId,
  version: source.version, sha256: source.sha256,
}, { kind: 'create', scope })
if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt.diagnostics))
const view = await session.observe({ itemIds: [receipt.affected[0].id] })
// 用新 target 和 component.configure 卡片修改已有参数，不先读完整组件源码。
```

Flow 正文组件须改用正式 `parent:{kind:'flow-body',parentBlockId:null}`；其他 owner/Surface 以当前卡和工具验证为准。Generated Component/Runtime 读取相应协议卡的完整 types、共享类型、作者指南和依赖，提交 candidate 后由原工具完成真实宿主准入。目录可读不能替代动态候选准入，也不自动宣布教学体验验收。

缓存键绑定能力 semanticVersion 与查询范围；未变材料、源码和回执可以复用，变化后只刷新对应资源。对明确 Native 修改可直接 `api.readCapability('native.content',{operation:'content',nativeType:'text'})`，无需先查全目录。对“标题/颜色/位置”等新版窄编辑，选择当前 discover 返回的语义操作；不要复制旧字段表。

## 调用与失败边界

从任何工作目录运行：

```text
npm --prefix <editor-root> run --silent build:courseware-case -- --case-dir <case-dir> --builder implementation/build.ts --project <relative-name.h5lesson> --html <relative-name.html>
```

`--plan` 与 `--script` 可覆盖两份 Markdown 的默认相对路径。输入、构建模块和输出都必须留在 `case-dir`，链接逃逸和路径别名会被拒绝。已有输出默认不覆盖；只有当前任务明确要求替换它们时使用 `--force`。

入口失败时先修正构建模块或产品能力；不要绕过它改回脆弱的源码相对导入，也不要在课例目录复制一份编辑器源码。
