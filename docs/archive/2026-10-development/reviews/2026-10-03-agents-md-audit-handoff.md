> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../development-plan/CURRENT_STATUS.md)。

# 交接提示词：继续 AGENTS.md 独立审查 v2 的剩余验收

请在 `D:\果铃工作台` 继续下面的工作。三批工程修复已经完成；本次交接的目标是补齐真实 Electron 宿主证据，并仅修复这些验证实际复现出的本批缺陷。不要重新执行三批实现，也不要将可选项自动变成必做任务。

修复提交：`64d97fa2fb4f9c5a1a6f92177eb99d8d768d21c7`，提交标题为 `fix: apply AGENTS audit v2 decisions across import and editing`。该提交已包含审查 v2、实施报告、原始检查证据及直接源码/测试依赖。本交接文档在提交后创建，尚未另行提交。没有 push 或发布。

## 先读并核对

1. 完整阅读 [独立审查 v2](2026-10-02-agents-md-audit-independent-review.md)，尤其 §1、§2、§8、§9、§10。§8 是 Owner 已裁决事项，不得自行更改。
2. 阅读 [实施与实际证据](2026-10-03-agents-md-audit-implementation-results.md) 和 [提交快照检查](agents-md-2026-10-03-implementation-evidence/scoped-commit-checks.txt)。实施报告是事实基线，明确区分已验证与未验证。
3. 按仓库 AGENTS.md 读取当前收敛方案、任务索引、任务板、WORKING_PROTOCOL，以及网络/Runtime/Published/保存相关 ARCHITECTURE_CONTRACT 条目。不要因历史路线名称恢复旧任务。
4. 先查看 `git status --short` 和相关源码。工作树与 index 仍有大量此前既有修改，不能 `git reset --hard`、`git clean`、`git add .` 或把其它暂存内容一并提交。

此次通过临时 index 限定提交范围；其它 staged 内容保持原样。特别注意：ExecutionEngine 的上下文预算、视觉路由、恢复/进展，Gateway 的 describeRun 缓存，toolPorts 的 analyzeImage，以及对应执行器测试中的其它修改仍留在工作树。AGENTS.md、Skills、路线文档、Provider/网络、编辑器/Mermaid 等已有差异不属于本批。`htmlSourceLocator.ts` 留有拒绝名单顺序变化，无行为差异；不要据此重新实现 B3。

§10 开工探针 A–E 已跑，修后 B–E 及页面 F 的实际输出已记录。已有通过证据在相关实现未变时继续有效；换 AI、审查者变化或上下文压缩不是重跑理由。如果后续相关文件又有变化，或证据不能对应当前实现，动产品代码前按审查要求运行受影响脚本确认现状。

## 必须保持的 Owner 边界

- 不改 AGENTS.md 或 `.agents/skills/**`；不新增校验门、配置、缓存、重试链或平台。
- 不放宽预览/Published CSP；远程脚本、远程模块、远程 Worker 继续不开放，不新增宿主接口。
- 脚本语法错误、缺失本地文件、`http://` 资源、`file:`/`blob:` 仍拒绝，信息具体到 AI 一轮能改好。静态不确定及外部 CDN 等依赖放行并给准确警告，警告必须送达模型。
- 加载期 onload/onerror 放行并警告、尽力绑定；其它交互事件直接允许。
- A4 使用 Owner B：所有备用图候选改指向新图，保留描述符和 sizes；不得恢复旧候选。
- 本期不打包本地 ES 模块图；允许导入并明确提醒合并成单文件。
- 保留唯一正式 writer、最终 CAS、停止屏障、授权根、staging realpath 闭合、未知副作用查证和失败零提交。Provider Secret 不进入工程或导出物。
- A5 批准只管一次，不扩大冻结任务授权或已有只读句柄权限；D3 不改变 400 上限，不加数值配置。

## 已完成的实现，直接复用

- Batch 1：C2 预览 begin 失败不再作废完整调用；c 句柄归属映射；A2 静态不确定保留脚本、非受管资源诊断、持久回执/advisories/下一轮模型可见警告、真实准入错误日志。
- Batch 2：A2/B2 全部 on* 挂载、CSS import layer/supports/media 内联、外部 classic defer 调度、模块诊断；A5 单次批准外部已打开文件经原 DocumentSession；A3 删除 utf-8、kind 按扩展名识别；A4 正式/热补丁/撤销/界面提示；A1 patch 版本可省略。
- Batch 3：C3 drain 后同一快照生成读取/版本/分页，删除 Gateway 观察往返及无人读取的 ToolReadCoverage；D3 截断 metadata 贯穿 registry → authoring/live/global → renderer → publication → Main → Gateway → 模型，并可清除；D1 只删 Component 包解析后的重复协议检查；B3 撤回 Main 单侧 title/textarea 编辑和新接受用例。
- C1 默认复制磁盘版已经正确；可选 flushFirst 清理未做。D2 没有真实不可接受耗时样本，未实施可选裁剪。B1/C4/C5/D4/D5 按裁决保留。

## 按此顺序继续未完成部分

### 1. 真实 Electron：代表 HTML 导入、准入、运行、保存、重开

目前有真实 HtmlImportService/Gateway/DocumentSession 提交、保存、文件回读及真实 Chromium 执行证据；ControlledBuild admission 使用 fixture，不能称为真实 Electron 整链完成。

复用已有 E2E harness 和正式产品入口，选一份代表 HTML，覆盖 class/constructor、连续答题 `opts[i].onclick`、动态 img.src、拖拽、加载事件、相对 fetch JSON、CSS `@import layer/supports`、head defer、CDN 脚本。必须证明实际准入后必要受管资源进入、运行/互动正确、保存并真正重开后仍正确。

相对 JSON/VTT 不会被打包，本地 ES 模块图不打包，CDN 库仍受 CSP 阻止；这些需要准确诊断并到达模型，不能记成相关依赖运行成功。不要只检查 error 变 warning，也不要用 fixture admission 或源码快照代替真实宿主。

临时代表页与探针可复用（是否仍存在先核对）：

`C:\Users\74755\AppData\Local\Temp\guoling-audit-v2-16a1494a2c814e2d90bb0e2b2a683b8a\representative.mts`

同目录有 `representative\lesson.html`、`browser-eval.js`、`a4-browser.mts` 及 §10 A–E。它们是准备材料，不是待提交的产品内容；不能把 representative.mts 中的 fixture admission 直接当真实验收。材料丢失时根据审查代表页合同恢复，不重造平台。

### 2. 运行已更新的 M17 Electron 用例

`tests/e2e/g20M17HtmlImport.spec.ts` 的远程脚本断言已改，但本批未运行。优先选现有命名用例：

```powershell
node node_modules/@playwright/test/cli.js test tests/e2e/g20M17HtmlImport.spec.ts -g 'M17-T04' --output <本轮临时结果目录>
```

该用例名称是 `M17-T04: remote script import succeeds while CSP blocks requests; local and inline resources form a saved closure`。确认执行的是当前源码所对应的 Electron/renderer/player 制品；只准备必要制品一次，不运行 `npm test`、`npm run build` 或全 E2E 矩阵。先读实际脚本与 globalSetup，避免触发无关能力索引检查或模型调用。

必须区分“未加载”和“已证明 CSP 阻止”。单靠 CDN 库不存在或 HTTP 服务收到零请求不足以证明 CSP 是原因，应采集实际 CSP violation/blocked reason，结合成功导入及正式宿主结果判断。不能将 skip、零匹配或排除计为通过。

第一条 `M17-T01/T02/T03` 含指定历史 benchmark 及更多已有流程，不机械运行；只有它直接补足剩余属性且成本合理时才选。第 1 项的新代表页宿主检查也不能被不覆盖这些写法的旧用例替代。

### 3. D3 在真实 Electron 宿主接线

单测已证明 400 → 401 → 400、metadata-only 发布、对象隔离/清除，以及真实 Store/Gateway/Engine → 下一 provider 请求中的提示产生和消失；尚缺真实 renderer/Runtime/Component 宿主链证据。

用现有 Electron 测试入口构造第 401 个合格自动目标，证明真实宿主发布的状态能送达当前对象的 content.targets，目标不变时提示仍更新，回到 400 后提示消失，其它对象不误报。Runtime 上限按层计算，Component 按实例计算；声明目标不受自动发现限制。可以使用已有脚本化 provider 验证软件回执链，不需要新付费模型调用。

真实浏览器/Electron 操作按可用 agent-browser Skill 执行；复用现有 E2E harness。若需要补测试，只添加能证伪这些未覆盖属性的命名用例，不搭建新诊断平台或生产缓存。

## 已有有效证据及其限度

完整命令、关键输出与原始日志见实施报告。以下用于选证据，不用数量证明完成：

- HTML 五文件 225 passed：证明资源内联、脚本/模块诊断、准入原因、回执重放、模型可见警告。
- AgentFile 最终 39 passed：覆盖 A1/A3/A5/C1/C3，包括正式队列 drain、停止、单次批准、CAS/undo 和授权不升级。
- A4 完整文件当时 17 passed；B3 接受用例随后撤回，剩余 16 个相关用例未改，未声称最终全文件重跑。Main 输出经真实 Chromium，五种 currentSrc 均选新图。
- Chromium carrier 4 passed：包含 body onload、Blob destroy/revoke。代表页 Chromium 证明 defer 顺序、CSS layer/supports、拖拽/加载、构造函数、连续答题、图像显示。
- D3 registry 10 passed，publication/Main 9 passed，上游选定 3 passed/1 skipped；Gateway/动态编辑/续接三文件 14 passed。未选项不是证据。
- D1 选定 1 passed/13 skipped，locator 12 passed；最终工作树三个 tsconfig 类型检查通过。
- 本次提交快照另通过 typecheck 和 C2/HTML advisories/D3 provider receipt 6 个选定用例。该快照排除了无关的上下文、视觉、恢复/进展和 Gateway 缓存改动，证明提交组合自身仍具备这些行为。

没有性能测量，不声称提速，不为可选 D2 启动机械基准。

已知无关失败：`tests/integration/g20BodyStreamingCapability.test.ts:79` 假设 no-op 配置保存增加 revision，而 ExecutionSettingsStore 返回原 revision。C2 四文件回归是 54 passed/1 failed，未修这条既有失败，不能称全绿。`check:ai-capabilities` 的过期/多余产物失败已被审查排除，继续不处理。不扩范围修 Provider、Skills、路线或 Mermaid。

## 证据、协作和结束条件

- 不相关实现、依赖、验证定义和关键环境未变时，复用已有证据。只因明确失败、新假设或上述真实集成属性扩大验证。
- 每轮先按审查 §9 六项报告：已消除；未修及原因；保持边界及依据；命令和原样关键输出及其证明属性；缺失的运行/性能证据；与审查不一致的实际源码事实。若真实 Electron 做不到，明确写“未在真实宿主验证”，不得用工程测试冒充。
- 当前修复是 engineering candidate；自动化通过不能替代 Owner 接受。真实宿主验证失败时，先定位并仅修复本批具体缺陷；新问题记录，不自行扩范围。
- Playwright 前后查看 `git status --short docs`，避免覆盖已跟踪证据图；原始新证据放本轮独立目录。窗口/进程只关闭本轮拥有的实例，不操作真实业务文件。
- 独立测试准备/只读 review 可并行，明确非重叠写域；A2 与 B2 继续由同一主执行者集成，共享源码单 writer。
- PowerShell 含 `|` 的 Vitest `-t` 模式使用 `node node_modules/vitest/vitest.mjs`，避免 .cmd 解释管道。此前真实 Chromium 会话 `guoling-audit-batch1` 已关闭，不能当活会话复用。
- 临时 `commit-checkout\node_modules` 是指向主仓库依赖的 junction；不要递归删除该临时树。无需清理它来完成验收。
- 本交接没有新增提交、push 或发布要求；保留其它已有修改和 staging。完成上述宿主证据后更新实施报告，清楚说明剩余缺口；没有真实证据就不宣告全部任务完成。
