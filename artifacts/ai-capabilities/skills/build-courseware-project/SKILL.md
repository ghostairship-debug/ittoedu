---
name: build-courseware-project
description: 从分别确认的 01-teaching-plan.md 与 02-presentation-script.md，在任意课例目录中构建、增量修复和验证可编辑 Course Project V9。自主定位产品，通过同源能力发现与 Builder V2 正式工具完成课件和离线 HTML。
---

# 构建互动课件工程

两份当前 Markdown 分别经教师看过并明确确认后才能构建；缺文件、关键内容、表面选择或逐步操作时返回 `$orchestrate-courseware`。提前授权不能代替当前制品确认。以教学文件为体验真相，以当前正式能力为工程真相。

## 冷启动与能力发现

1. 读取课例目录内两份教学文件、引用材料和本轮约束。课例目录可以不是 Git 仓库，交付物仍写在这里。
2. 运行 `node <skill目录>/scripts/resolve-editor-root.mjs`，取得 `editorRoot`、`capabilityDiscovery`、`capabilityQuery` 与 `semanticVersion`；失败按 [external-case-build.md](references/external-case-build.md) 定位。不要要求教师切到编辑器仓库。
3. 读取小型 `capabilityDiscovery`。用 `node <capabilityQuery> --query <关键词> --surface <slide|flow|spatial-2d> --owner <scene|surface|world|global>` 查询相关能力；用 `--id <能力ID>` 展开完整卡。Native 内容可加 `--operation content --nativeType text`，位置样式查正式对应操作；不能猜测字段。
4. Builder 内同样使用 `api.discover(query)` / `api.readCapability(id, options)`；卡片包含完整 Schema、适用域和依赖。Recipe 与组件卡提供示例和参数。完整协议、组件信息与方法资料按需展开，禁止把全量目录、源码和技能正文塞入首次上下文。明确的小修改直接用相关完整卡，无需额外绕行查询。

缓存仅在 `semanticVersion` 和查询范围均相同时复用；mtime 不代表能力版本。运行 `npm --prefix <editorRoot> run check:ai-capabilities` 检查生成物，不手写平行能力清单。旧 `index.json` 保留兼容读取。仓库没有 `agent-kit/` CLI。

## 构建与编辑

新课例在 `implementation/build.ts` 导出 `apiVersion = 2`。通过 `api.createCourseProject({surfaceType,title})` 创建受管工作会话；以 `observe()` 读取 scope 和分页目标，`activateScope()` 切换位置 / owner / 状态，`createScope()` 获取插入地址，`execute(tool,input,destination)` 写入。会话方法均须 await。

每步检查 receipt；需要历史时用 `readReceipts({after,limit})` 读取增量。修改后重新获取目标和 revision；未知 ID、失效地址或冲突不能猜测合并。`snapshot()` / `activate()` 的旧全量返回仅保留兼容，完整工程或源码确实必要时才读取。最终直接 `return await session.finish()`，不能改写快照或拼装结果。V2 新建会话不能代替打开教师已有工程，增量修改走当前编辑器稳定 `authoringAddress` 与正式事务，不能全量重建覆盖。

课例模块可读取材料和编写独立模块，不得导入编辑器内部源码或自行写最终工程。调用合同、Native/Recipe/Component 示例见 [external-case-build.md](references/external-case-build.md)。

```text
npm --prefix <editorRoot> run --silent build:courseware-case -- --case-dir <caseDir> --builder implementation/build.ts --project <relative.h5lesson> --html <relative.html>
```

输出必须相对课例目录；只有本轮明确替换已有交付物时使用 `--force`。产品负责打包、保存重开、语义检查、Published V2 和离线 HTML，失败不得交付半套文件。

## 必须保留的教学与质量方法

按阶段读取 [build-method.md](references/build-method.md)：载体所有权、资产与任务图、最高风险真实纵切、增量构建、可编辑性和验证交付的完整方法均在其中，不能因为按需读取而省略质量门槛。

稳定图文与简单点击走 Native / 声明式交互；复杂局部互动先匹配组件，允许新建；整页连续机制才用 Runtime，少放教学文字。Flow 保留语义正文，Spatial 保留世界和相机。计划能力不能冒充当前可用；空 catalog 不禁止工程内组件。受管目录先由 `api.componentCatalog()` 获取本轮来源，使用原 `component.insert` 的 catalog 操作；未知受信状态不伪造 sourceId。

- 推进和交互：遵守 [main-progression.md](references/main-progression.md)，先证明控制器隐藏时的正文主路径，再验证教师控制器兜底；每个非终点有可发现动作、反馈和恢复。
- 页面布局与视觉修复：读取 [page-design.md](references/page-design.md)。
- PPT 来源：读取 [ppt-import-review.md](references/ppt-import-review.md)。
- 最终验证：读取 [validation-boundaries.md](references/validation-boundaries.md)，验证本课真实使用的编辑、保存重开、CoursePlayer、离线 HTML 与要求的格式。只补受影响证据，不默认全仓测试。

自动化最多证明 `engineering candidate`；真实视觉与互动决定 `art candidate`，教师明确验收才是 `accepted`。无法实现脚本、无法保持编辑性或缺实际交付证据时，说明最早应返回的阶段和最小缺口。完整停止条件见构建方法，不能用占位图、静态截图或下游代码掩盖失败。
