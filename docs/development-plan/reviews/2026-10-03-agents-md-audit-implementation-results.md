# AGENTS.md 独立审查 v2：实施与实际证据（2026-10-03）

已依审查 §2 完成三批实现，A2/B2 由同一主执行者统一集成。本文是工程修复结果；本轮补充了代表导入页、M17-T04 与 D3 的真实 Electron 宿主证据，但仍不代表 Owner 接受。按 Owner 后续指令提交本批修复及直接依赖；未运行付费/真实模型调用。工作树原有的其它修改未回退。

提交范围：包括原审计中本批直接依赖的 Runtime 文字替换、read-observation 删除、默认磁盘复制等改动；执行器的上下文预算、视觉路由、恢复/进展及 Gateway 缓存等其它工作树改动未纳入。本文既有检查来自当时工作树；为验证拆分后的提交组合，另对临时提交快照检查类型和 C2/导入警告/D3 模型回执链，结果见 [scoped-commit-checks.txt](agents-md-2026-10-03-implementation-evidence/scoped-commit-checks.txt)。

依据：[独立审查 v2](2026-10-02-agents-md-audit-independent-review.md)。开工前已完整阅读；本轮开工前 §10 A–E 的原始输出保存在[证据目录](agents-md-2026-10-03-implementation-evidence/)。恢复工作时又运行了 B–E 确认当前状态。已通过且相关实现未变的证据直接复用，没有以压缩上下文为由重跑矩阵。

**Batch 1：C2 → A2(a)(c)(d)(e)**

1. 已消除：流式预览 begin 失败不再作废完整 text.replace。正式调用仍到 Gateway，正式提交、一次撤销及停止后迟到 complete 不提交有引擎级证据。Runtime/Component 的 c 句柄归属已映射到文档，避免当前 run 的目标误触发工作空间外批准。HTML 静态证明失败改为原脚本保留和警告；逐点失败保留该点，其余明确引用继续处理。非受管相对资源不产生素材占位，非受管加载提示移除并诊断。导入警告进入持久回执、advisories 和下一轮实际 Engine provider 请求。准入失败带最后几条真实 error 日志。
2. 未修：layer/supports、defer、全部事件、模块警告与文件/换图事项留到 Batch 2。C2 回归中已有的 BodyStreamingCapability 失败未修：测试对无改动配置保存假设 revision 增加，但 ExecutionSettingsStore 的 no-op 保存返回原 revision；该例不运行 Engine，相关设置源码未改。
3. 保持边界：预览失败只跳过展示；参数完整性、Gateway 授权、CAS、停止及冲突处理不变。整脚本静态证明失败仍复用既有遍历诊断明确坏输入，不发布资源或半改写。四类坏输入继续拒绝，失败零提交；远程脚本限制和 CSP 不变。
4. 直接验证：选定 C2 引擎/Runtime 用例 6 passed，未选的 38 skipped 不算通过；包含 preview begin 三类异常、正式提交/一次 undo、停止后迟到调用和 c 句柄 run 归属。HTML 正向 React bundle、整脚本保留、动态点保留、坏引用拒绝、日志与回执重放通过。下一轮 Engine 请求实测包含 html-import-warning。代表 HTML 用真实 HtmlImportService/Gateway/DocumentSession 提交、保存、文件回读；真实 Chromium 从回读后的 Runtime source 执行构造函数、连续答题和静态/动态图。
5. 缺证据：初始检查中的代表页 build admission 使用 fixture；续验的正式 UI 导入已通过 ControlledBuildService 与 Electron 独立宿主准入，fixture 仅为历史证据。没有性能测量。四文件 C2 全回归是 54 passed / 1 failed，不能称全绿。
6. 与审查不同：§3.4 的 c 句柄归属问题确实复现并修；Gateway 的 readCoverage 实际有四处调用而非三处（Batch 3 删除）。本轮相关文件起始为 LF，不是文档描述的 CRLF，保持起始行尾。

完整 C2 回归命令及关键输出：

```text
node node_modules/vitest/vitest.mjs run tests/integration/g20ExecutionEngine.test.ts tests/integration/g20EditSession.test.ts tests/integration/g20M27RuntimeTextReplace.test.ts tests/integration/g20BodyStreamingCapability.test.ts
Test Files  1 failed | 3 passed (4)
Tests       1 failed | 54 passed (55)
```

关键输出保存在 [c2-final.txt](agents-md-2026-10-03-implementation-evidence/c2-final.txt)、[完整失败输出](agents-md-2026-10-03-implementation-evidence/c2-tests.txt)、[模型警告测试](agents-md-2026-10-03-implementation-evidence/model-advisories-test.txt)。

**Batch 2：A2(b)(g)(h)(i)+B2 → A5 → A3 → A4 → A1**

1. 已消除：删除事件白名单，所有 on* 可以挂载；onload/onerror 尽力绑定并警告。CSS @import 递归内联并按 layer/supports/media 嵌套，资源 URL 沿用原改写。只给原本本地外部 classic defer 脚本加软件内部标记，包装为 blob 外链后保留 defer 顺序；真正内联的多余 defer 仍忽略。模块图不打包，但警告写明不能运行与合并单文件修法，明确的坏模块地址沿用既有 URL 诊断。A5 已批准的外部已打开文档经既有 DocumentSession 一次性提交，不扩大任务文档授权。A3 kind 省略由扩展名推导，删除 utf-8；A1 patch 版本可省略，提供则仍校验，唯一匹配/range 和最终 CAS 保留。A4 执行 Owner B：img/picture 所有备用候选指向新图、保留描述符和 sizes、移除不匹配 type；热补丁/撤销一致；回执字段接到实际预览界面提示。
2. 未修：本地 ES 模块图按 Owner 决定不打包；相对 JSON/VTT 等不作为受管素材，已保留引用并诊断后果。远程依赖仍不能加载。不是把这些依赖记成运行成功。
3. 保持边界：四类明确坏输入继续拒绝，包括静态脚本中的明确坏资源/模块引用。脚本语法错误带 script 序号，拒绝按 code 合并、最多列 10 组；warnings 按 code 合并、最多 5 条、每条最多 200 字。CSP/远程脚本/模块/Worker 不开放；权限、单 writer、CAS、停止、授权根、staging 和失败零提交不变。A5 只批准这一次，不升级 file.open 或已挂载只读句柄。
4. 直接验证：5 个 HTML 文件 225 passed，证明资源内联、脚本/模块诊断、准入原因、回执重放与模型可见警告。文件工具 Batch 2 的 37 passed 证明 workspace/ask、先读/不先读、已批准外部写入/一次 undo、后续未批准拒绝、授权不升级、并发 CAS 和停止；Batch 3 相关读取改变后的最终 39 passed 继续覆盖这些属性。A4 完整文件当时 17 passed，包含五种形态、正式与热撤销、type 大小写和脚本冲突。真实 Main 输出在 Chromium 中五种 currentSrc 均选新图。4 个 Chromium carrier e2e 通过，含 body onload 触发及 destroy revoke Blob。代表页正式提交→保存→回读后真实 Chromium 的 head defer、两脚本顺序、layer/supports 样式、drag/drop、body/image load、构造函数、连续答题及图片显示均正常。
5. 缺证据：正式 UI 导入的真实准入、保存、重开和必要互动已补验，详情见下方续验。相对 JSON/VTT、本地 ES 模块图不打包，远程库仍受 CSP 限制，不把它们记成相关依赖运行成功。旧 M17-T04 的 remoteRequests=[] 不能单独证明 CSP 原因；本轮增加实际 violation 断言。没有性能测量或新付费模型结果。
6. 与审查不同：实际行尾为 LF。A4 首次探针错误地要求宽度描述符图片的 naturalWidth 等于文件像素宽度；浏览器会按候选密度修正 intrinsic width。探针已改为图像解码成功和 currentSrc 选中新图，不改产品来满足错误断言。匹配的 IMAGE/PNG type 保留，不匹配的 image/webp 删除。

命令及关键原始输出：

```text
node node_modules/vitest/vitest.mjs run tests/unit/g20HtmlImportCore.test.ts tests/unit/g20HtmlImportClosure.test.ts tests/unit/g20M17BenchmarkClosure.test.ts tests/integration/g20HtmlImport.test.ts tests/integration/g20M24HtmlImport.test.ts
Test Files  5 passed (5)
Tests       225 passed (225)

npx vitest run tests/integration/g20AgentFileTools.test.ts
Tests       37 passed (37)

npx vitest run tests/integration/g20M23HtmlLightEdit.test.ts
Tests       17 passed (17)

node node_modules/@playwright/test/cli.js test tests/e2e/g20HtmlCspCarrier.spec.ts --output <Temp>/playwright-carrier
4 passed (2.1s)

npm run typecheck
退出码 0
```

Playwright 前后 docs 状态一致，未覆盖跟踪的证据图片。B3 新增接受用例在 Batch 3 撤回后，A4 的 16 个相关用例未改，不用新计数冒充一次全文件重跑。

**Batch 3：C3 → D3 → C1/D1/B3/D2**

1. 已消除：C3 已打开文件读取以 drain 后的一份快照生成 text/version/分页，删除 attach→目标句柄→Gateway read→正文/版本二次比对；返回前保留 assertActive。删除无 reader 的 ToolReadCoverage 类和 Gateway 四处调用，保留两个范围映射函数及类型。D3 从 registry、authoring/live/global 聚合、renderer 现有快照、publication、Main 同一观察读取到 content.targets/模型，贯穿截断 metadata。只在第 401 个合格自动目标出现时提示，前 400 个目标不变而 metadata 变动也发布。D1 删 Component 包已解析后的重复协议验证，保留 V8 编译和 Runtime 检查。B3 撤回 title/textarea 的 Main 编辑分支及新增接受测试，保持与预览排除一致。
2. 未修：C1 默认复制磁盘版并返回 disk-version 已正确，保持；可选 flushFirst 清理未实施。D2 没有真实不可接受耗时样本，不实施可选裁剪。B1/C4/C5/D4/D5 按裁决不动。
3. 保持边界：C3 上游路径权限、分页游标、停止和未打开文件最终磁盘 CAS 保留；正式写入仍是 canonical transaction。D3 Runtime 每层 400、Component 每实例 400；声明目标不受此限。metadata 加在已有记录上，没有新缓存、Map 状态、配置或 gate。D1 其它协议检查入口保留。未改 AGENTS.md、Skill 或 CSP。
4. 直接验证：C3 用真实正式队列阻塞/排队修改证明 drain 等待，然后分页的文字与版本来自同一新快照；Gateway read/attach spy 未调用，停止前返回拒绝，最终文件工具 39 passed，C1 磁盘复制也在其中。两个 registry 10 passed 证明 400→401→400 与无效候选不误报。publication/Main 9 passed 证明 metadata-only、targets 不变时诊断仍发布、文档隔离及 clear 消失。上游 3 个选定用例证明 authoring/live/global itemId 聚合与清除；未选 restart 不计通过。实际 Store→Gateway→Engine→下一 provider 请求证明其它对象不误提示、当前对象提示送达、清除后消失，声明目标继续返回；连同既有动态编辑与范围续接，3 文件 14 passed。D1 单个指定 Component 用例通过，源码编辑后的摘要冲突可诊断、修正后继续准入，syntax 仍可编译。locator 12 passed；直接源码探针 title/textarea 返回 unsupported-target。最终三个 tsconfig 类型检查通过。
5. 缺证据：D3 的 Runtime 与 Component 真实 Electron 宿主接线已补齐；模型收到和清除提示由既有及本轮聚焦 Engine provider 用例证明。没有性能测量，不声称读取/构建提速。没有完成全仓库测试矩阵，也不把未选用例算通过。
6. 与审查不同：readCoverage 是四处调用；B3 新接受测试实际在 integration/g20M23HtmlLightEdit.test.ts，不在审查所写 unit 文件，已撤回正确位置的测试。D3 Runtime 限制按层计算，不能写成对象总共只返回 400 项；Main read 返回同一快照的 {targets,truncatedItemIds?}，避免另建缓存或第二次核查。

命令及关键输出：

```text
npx vitest run tests/integration/g20AgentFileTools.test.ts
Test Files  1 passed (1)
Tests       39 passed (39)

npx vitest run tests/unit/runtimeAuthoringTargetRegistry.test.ts tests/unit/componentAuthoringTargetRegistry.test.ts
Test Files  2 passed (2)
Tests       10 passed (10)

npx vitest run tests/unit/dynamicContentTargetPublication.test.ts tests/integration/g20DynamicContentObservationStore.test.ts
Test Files  2 passed (2)
Tests       9 passed (9)

npx vitest run tests/unit/slidePublishedRuntimeTargetTruncation.test.ts tests/unit/publishedGlobalCanvasRuntimeOwnerLifecycleIsolation.test.ts -t 'truncation|isolates lifecycle failure'
Test Files  2 passed (2)
Tests       3 passed | 1 skipped (4)

node node_modules/vitest/vitest.mjs run tests/integration/g20M27RuntimeTextReplace.test.ts tests/integration/g20M27LightEditBatchAcceptance.test.ts tests/integration/g20ContinuationTargets.test.ts
Test Files  3 passed (3)
Tests       14 passed (14)

node node_modules/vitest/vitest.mjs run tests/integration/g20ControlledBuild.test.ts -t 'actual component digest'
Tests       1 passed | 13 skipped (14)

node node_modules/vitest/vitest.mjs run tests/unit/g20M23HtmlSourceLocator.test.ts
Tests       12 passed (12)

npm run typecheck
退出码 0
```

**本轮真实 Electron 宿主补验（2026-10-03）**

以下是上一轮命令与结果记录，摘要文件不是完整 Playwright stdout。续验的完整输出、准入和回执 JSON 见下一段；当前源码对应的必要制品按变化准备，Electron 串行运行。

```text
node node_modules/@playwright/test/cli.js test tests/e2e/g20AuditV2RepresentativeElectron.spec.ts --output output/g20/audit-v2/representative-electron/playwright-run-20261003c
Raw result: 1 passed (55.4s)

node node_modules/@playwright/test/cli.js test tests/e2e/g20M17HtmlImport.spec.ts -g 'M17-T04' --output output/g20/m17/resource-boundary/playwright-run-20261003
Raw result: 1 passed (1.1m)

node node_modules/@playwright/test/cli.js test tests/e2e/g20AuditV2D3Electron.spec.ts --output output/g20/audit-v2/d3-electron/playwright-run-20261003e
Raw result: 1 passed (11.6s)
```

上一轮代表页证明正式 UI 导入、运行和部分重开行为，且采集实际 CDN `securitypolicyviolation`。源码核对表明此入口已经过 HtmlImportDesktopService → HtmlImportService.admit → Gateway build.check → ControlledBuildService → ElectronBuildAdmission；harness 没有替换 admission。此前写成“ControlledBuild 仍为 fixture”不符合实际，现已更正。原代表页只做 `fetch()`，不能由它宣称 JSON 数据可用或不可用；续验改为实际解析 JSON，补齐重开的样式、动态图、加载和拖拽断言。旧 M17-T04 的零请求仍仅是事实，不单独证明 CSP。

D3 Runtime 的上一轮真实宿主回执为 [run-68Niw6/evidence.json](../../../output/g20/audit-v2/d3-electron/run-68Niw6/evidence.json)：初始当前对象为 1 个声明图片加 400 个自动文字（总数 401），其它对象为 1 个声明图片加 1 个文字（总数 2）；触发第 401 个自动目标后目标仍返回 401 项并产生截断提示，删除后提示清除，其他对象未误报。这份 Runtime 证据不替代 Component 每实例证据，后者见续验。探针控件的事件在真实 renderer 中派发，不据此宣称物理鼠标操作可达性通过。

**本轮续验收口：按审查 §9 六项回报**

1. 已消除：代表页正式导入 → 真实准入 → 受管资源 → 运行互动 → 保存 → 真正关闭/离线重开全部通过；补采的持久构建回执为 `status=ready`、`ok=true`、`processId=31556`、`ownerProcessId=16304`、一项目标真实行为证据，消息为“独立进程中的真实宿主准入通过”。重开后实际验证 head defer 顺序、连续答题、静态/动态图、layer/supports 样式、body/image load、拖拽。相对 JSON 返回 `Not found`，实际解析产生 `SyntaxError`，没有误记为依赖运行成功。M17-T04 已补采 enforce 模式的实际 CSP violation。D3 Runtime 与 Component 宿主 metadata-only 发布、送达当前对象、清除和其它对象隔离均通过；Component 真实验证复现了提示只有“Runtime 按层计”的本批缺陷，唯一新增产品修复是在现有 Gateway 提示中同时说明“Runtime 按层计，Component 按实例计”。
2. 未修及原因：本地 ES 模块图、相对 JSON/VTT 不打包，远程脚本/模块/Worker 不开放，继续按 Owner 裁决提供诊断。C1 可选 flushFirst 清理和 D2 可选性能裁剪没有新依据，未实施。既有 BodyStreamingCapability 的 no-op revision 失败不在本批，仍保留，不能宣称整仓全绿。Component 声明 props 经作者 overlay 编辑，`content.targets` 当前只发布其自动命中；未扩成新的 Component props Gateway 能力。
3. 保持边界及依据：上限仍是 Runtime 每层 400、Component 每实例 400，声明目标不占自动额度。只有正式 DocumentSession writer、最终 CAS、停止屏障、授权根、staging realpath 闭合和失败零提交继续有效。未改 AGENTS.md、Skills、CSP、Schema 或授权；没有新缓存、配置、平台、宿主接口或付费模型调用。
4. 命令、关键原始输出与证明属性：仅准备变化涉及的 Electron 制品一次；renderer/player 未改，复用已有制品。三条 Playwright 命令只选择下述四个相关命名用例，全部实际运行，零匹配与未选用例不算通过。

```text
node node_modules/@playwright/test/cli.js test tests/e2e/g20AuditV2RepresentativeElectron.spec.ts --output output/g20/audit-v2/representative-electron/playwright-closeout-final
1 passed (1.2m)

node node_modules/@playwright/test/cli.js test tests/e2e/g20AuditV2D3Electron.spec.ts tests/e2e/g20AuditV2D3ComponentElectron.spec.ts --output output/g20/audit-v2/d3-host-closeout
2 passed (22.3s)

node node_modules/@playwright/test/cli.js test tests/e2e/g20M17HtmlImport.spec.ts -g M17-T04 --output output/g20/audit-v2/m17-host-closeout
1 passed (59.4s)

node node_modules/vitest/vitest.mjs run tests/integration/g20M27RuntimeTextReplace.test.ts -t "delivers the current object truncation notice"
Test Files  1 passed (1)
Tests       1 passed | 2 skipped (3)

npm run build:electron
退出码 0

npm run typecheck
退出码 0（renderer、electron、e2e 三个 tsconfig）
```

完整 stdout：[代表页](../../../output/g20/audit-v2/representative-electron/playwright-closeout-final-command-output.txt)、[Runtime/Component](../../../output/g20/audit-v2/d3-host-closeout-command-output.txt)、[M17-T04](../../../output/g20/audit-v2/m17-host-closeout-command-output.txt)、[模型回执](../../../output/g20/audit-v2/d3-electron/notice-provider-closeout-command-output.txt)、[Electron 构建](../../../output/g20/audit-v2/d3-electron/build-electron-closeout-command-output.txt)、[类型检查](../../../output/g20/audit-v2/final-typecheck-command-output.txt)。

真实结果：[代表页准入/重开](../../../output/g20/audit-v2/representative-electron/run-lSGYWy/evidence.json)、[M17 enforce CSP](../../../output/g20/m17/resource-boundary/run-04Q7FJ/csp-evidence.json)、[Runtime](../../../output/g20/audit-v2/d3-electron/run-4mgJa3/evidence.json)、[Component](../../../output/g20/audit-v2/d3-component-electron/run-PUlgED/evidence.json)。Runtime 初始/超限/清除总目标均为 401（另有一个声明图片）；Component 同包两个实例分别返回 400/1 个自动目标，当前实例 DOM 400 → 401 → 400，目标内容始终不变而提示产生/清除，其它实例不误报，两个声明 overlay 保留，当前声明文字能进入正式编辑器后取消，文档 revision 始终为 0。新增/删除及声明编辑探针在真实 renderer 派发事件，不把它作为物理点击可达性证据。HTML 警告到下一模型请求的原 Engine 证据因相关实现未变继续复用；本轮 D3 聚焦 Engine 用例证明更新后的提示产生、送达和消失。

按 [agent-browser Skill](/C:/Users/74755/.agents/skills/agent-browser/SKILL.md) 的独立 Electron/CDP 方式复用现有 harness，本轮只读连接代表页所属端口 52641，留下[实际宿主快照](../../../output/g20/audit-v2/representative-electron/run-lSGYWy/agent-browser-snapshot.txt)；测试只关闭自己的 Electron 实例，之后关闭该命名浏览器连接。仅 Electron runner 串行，两个新派只读/独立写域子任务均已完成。

5. 缺失的运行/性能证据：本交接指定的三项宿主补验已完成；没有性能测量，不声称提速；没有新增付费模型或完整 E2E 矩阵，也不需要用它们代替已成立的软件属性证据。当前仍是 engineering candidate，Owner 接受状态不由自动化推定；本轮没有提交、push 或发布。
6. 与审查/前轮报告不一致的实际事实：正式 UI 入口已经走真实 ControlledBuild 准入，原“仍为 fixture”结论已纠正；旧 `fetch()` 成功不能证明 JSON 数据加载，现改为实际解析并捕获 `Not found`；原 D3 Runtime 总数 400 的断言漏算声明图片，正确总数是 401；Component 计数按实例，原统一提示遗漏这点已修正。诊断脚本一度误读 builds/requests、声明按钮物理点击被 canvas 拦截，以及合并正则命令零匹配均未计通过；更正后的实际命名用例输出如上，不修改产品来满足错误探针。

**逐项状态**

| 编号 | 本轮结果 |
|---|---|
| A1 | patch 版本可选；write 沿用已正确实现 |
| A2 | 指定缺口及文案/回执链已修；模块图保留警告，不打包 |
| A3 | 删除 utf-8；省略 kind 识别实际格式 |
| A4 | Owner B：所有候选指向新图，保留 sizes/描述符，撤销/提示 |
| A5 | 单次批准外部已打开文件经既有 Session；不扩任务权限 |
| B1 | 保持本地 CSS 内联，不改 CSP |
| B2 | 外部 defer 时序已恢复；async 就地执行按裁决允许 |
| B3 | 默认撤回；title/textarea 不作为预览编辑目标 |
| C1 | 已正确的默认磁盘复制保持；flushFirst 可选清理未做 |
| C2 | 预览失败不作废调用；Engine 正式提交/undo/停止已证实 |
| C3 | 删除观察往返与无人读取的 coverage；保留映射/停止 |
| C4 | 冻结权限执行检查保留 |
| C5 | 原子批量边界保留 |
| D1 | 仅删除明确重复的 Component 检查 |
| D2 | 未实施；无真实耗时失败证据 |
| D3 | 截断提示完整送达模型并可消失；上限不变 |
| D4 | DOM 目标指纹保护保留 |
| D5 | toolCallId 单次终态保留 |

**§10 修后原始输出**

脚本原样从审查提取到 Temp，以仓库根的 node_modules/.bin/tsx.cmd 运行。B 输出中的 KEEP 原因只截取 70 字是探针自身行为；完整产品拒绝文案包含 script 序号、原因与修法。

**脚本 B**

```text
OK   extract=ok  prepare=PASS  | module + 本地 import（仅警告，运行时无法解析）
OK   extract=ok  prepare=PASS  | <script type=module src=本地>
OK   extract=ok  prepare=PASS  | defer 本地外部脚本（语义见 4.3(h)）
       运行时 HTML → <script defer data-cw-defer="">window.__a=1;</script>
OK   extract=ok  prepare=PASS  | async 本地外部脚本
OK   extract=ok  prepare=PASS  | fetch 相对 json
OK   extract=ok  prepare=PASS  | new Worker
OK   extract=ok  prepare=PASS  | XMLHttpRequest
OK   extract=ok  prepare=PASS  | iframe https
OK   extract=ok  prepare=PASS  | 静态 onClick 属性
OK   extract=ok  prepare=PASS  | setAttribute 动态属性名
OK   extract=ok  prepare=PASS  | Google Fonts link
OK   extract=ok  prepare=PASS  | Tailwind CDN script
OK   extract=ok  prepare=PASS  | data: 脚本
OK   extract=ok  prepare=PASS  | img avif
OK   extract=ok  prepare=PASS  | 拖拽等内联事件属性（导入过；挂载失败见脚本 C）
OK   extract=ok  prepare=PASS  | @import 普通（对照：已内联）
       运行时 HTML → <style>body{color:red} p{color:blue}</style>
OK   extract=ok  prepare=PASS  | link stylesheet 本地（对照：已内联）
       运行时 HTML → <style>body{color:red}</style>
FIX  extract=ok  prepare=PASS  | modulepreload 本地 js（prepare 层整份失败）
FIX  extract=ok  prepare=PASS  | preload as=script 本地 js（prepare 层整份失败）
FIX  extract=ok  prepare=PASS  | @import layer() 本地 css（导入过但 css 没打包）
       运行时 HTML → <style>@layer base{body{color:red}} p{color:blue}</style>
FIX  extract=ok  prepare=PASS  | track 本地 vtt（非受管素材）
FIX  extract=ok  prepare=PASS  | class + constructor
FIX  extract=ok  prepare=PASS  | class extends + super
FIX  extract=ok  prepare=PASS  | x.constructor
FIX  extract=ok  prepare=PASS  | el.style[prop]=v
FIX  extract=ok  prepare=PASS  | opts[i].onclick=（quiz 常见）
FIX  extract=ok  prepare=PASS  | el.dataset[k]
FIX  extract=ok  prepare=PASS  | obj[key]（参数）
FIX  extract=ok  prepare=PASS  | eval
FIX  extract=ok  prepare=PASS  | new Function
FIX  extract=ok  prepare=PASS  | Object.getOwnPropertyDescriptor
FIX  extract=ok  prepare=PASS  | Reflect.ownKeys
FIX  extract=ok  prepare=PASS  | 解构 style
FIX  extract=ok  prepare=PASS  | 动态 URL：img.src = 变量
FIX  extract=ok  prepare=PASS  | 动态 URL：audio.src = 数组项
FIX  extract=ok  prepare=PASS  | 动态 URL：style.backgroundImage = url(+变量)
FIX  extract=ok  prepare=PASS  | 本地内联 d3
FIX  extract=ok  prepare=PASS  | 本地内联 lodash
KEEP extract=REJECT[script-parse]  prepare=FAIL: [script-parse] 第 1 个 <script> 无法解析: SyntaxError: Unexpected token (1:9  | 脚本语法错误
KEEP extract=REJECT[missing-relative-resource]  prepare=FAIL: [missing-relative-resource] 找不到相对资源 missing.png（共 1 处）  | 缺失的本地图片
KEEP extract=REJECT[missing-relative-resource]  prepare=FAIL: [missing-relative-resource] 找不到相对资源 nope.js（共 1 处）  | 缺失的本地脚本
KEEP extract=REJECT[remote-https-required]  prepare=FAIL: [remote-https-required] 远程资源需要 HTTPS: http://example.com/a.png（共 1 处）  | http:// 图片
KEEP extract=REJECT[remote-https-required]  prepare=FAIL: [remote-https-required] 远程资源需要 HTTPS: http://example.com/embed（共 1 处）  | http:// iframe
KEEP extract=REJECT[remote-https-required]  prepare=FAIL: [remote-https-required] 远程资源需要 HTTPS: http://example.com/a.png（共 1 处）  | CSS background http://
KEEP extract=REJECT[unsupported-url-scheme]  prepare=FAIL: [unsupported-url-scheme] 不支持资源协议 file:///C:/a.png（共 1 处）  | file:/// 图片
KEEP extract=REJECT[unsupported-url-scheme]  prepare=FAIL: [unsupported-url-scheme] 不支持资源协议 blob:https://example.com/abc（共 1 处）  | blob: 图片
```

**脚本 C**

```text
onclick       可挂载
onkeydown     可挂载
ondrop        可挂载
ondragover    可挂载
ondragstart   可挂载
ontouchstart  可挂载
onwheel       可挂载
onmouseenter  可挂载
onmouseleave  可挂载
oncontextmenu 可挂载
onscroll      可挂载
onpointermove 可挂载
onended       可挂载
onplay        可挂载
onerror       可挂载
onload        可挂载
```

**脚本 D（预期保持原样）**

```text
先 file.read=false  attach(true) 返回=true  text.replace -> document-operation applied
先 file.read=true  attach(true) 返回=false  text.replace -> error not-authorized: 目标不在本次任务的可写范围
```

**脚本 E**

```text
===== A3：file.create =====
不传 kind：{name:"data.json"} -> OK
kind:"text"：{name:"data2.json"} -> OK
kind:"utf-8"：{name:"x.h5lesson"} -> 抛错： [
  {
    "code": "invalid_value",
    "values": [
      "markdown",
      "text",
      "html",
      "course-v9"
    ]
   磁盘上 x.h5lesson 字节数 = undefined （0 字节 = 坏的课件文件）
kind:"utf-8"：{name:"pic.png"} -> 抛错： [
  {
    "code": "invalid_value",
    "values": [
      "markdown",
      "text",
      "html",
      "course-v9"
    ]
   磁盘上 pic.png 字节数 = undefined
===== A5：workspace 档 + 工作空间外 + 已打开 + 已批准 =====
现状 file.write replace -> OK
===== 窄方案原型：经 DocumentSession 一次性提交（不改 run 授权）=====
提交 -> applied | source = "NEW-DIRECT" | undoHead = {"operationId":"direct-1","actor":"agent"}
旧 baseRevision 再提交 -> conflict stale-revision
撤销 -> applied | source = "NEW"
```

**正式导入 / 保存 / 文件回读**

```text
{
  "commit": "applied",
  "saveClean": true,
  "reopened": true,
  "scriptPreserved": true,
  "managedImage": 1,
  "warnings": [
    {
      "code": "resource-hint-omitted",
      "message": "[resource-hint-omitted] 已移除非受管素材的加载提示 hint.js；不影响页面正文，脚本或样式请内联（共 1 处）"
    },
    {
      "code": "early-event-handler",
      "message": "[early-event-handler] onload/onerror 等加载期事件尽力绑定，个别时序可能漏触发；关键初始化请改用脚本内 addEventListener 或立即执行（共 2 处）"
    },
    {
      "code": "unmanaged-relative-resource",
      "message": "[unmanaged-relative-resource] 本地资源 a.vtt 的类型暂不能作为受管素材，已保留原引用；课件中无法解析该引用，请内联内容或改用受支持媒体（共 1 处）"
    },
    {
      "code": "unsupported-network-sink",
      "message": "[unsupported-network-sink] 脚本网络调用已保留；fetch/EventSource/WebSocket 仅可连接工程声明的精确 HTTPS/WSS 源，本地相对数据不会打包，远程脚本/模块/Worker 被 CSP 阻止；请内联本地数据或使用已声明的连接源（共 1 处）"
    },
    {
      "code": "unsupported-dynamic-url-sink",
      "message": "[unsupported-dynamic-url-sink] 无法静态证明该脚本的资源引用闭合，已原样保留；脚本里的本地文件引用不会被打包，请内联资源或改为可解析的静态媒体引用（共 1 处）"
    }
  ],
  "admission": "fixture; Electron admission not tested"
}
```

**真实 Chromium 执行回读后的 Runtime**

```text
{
  "bodyLoad": true,
  "constructor": true,
  "defer": "ok",
  "deferOrder": [
    "first",
    "second"
  ],
  "drag": true,
  "drop": true,
  "dynamicImage": 1,
  "first": "answer 1",
  "imageLoad": true,
  "initial": "answer",
  "layerColor": "rgb(17, 34, 51)",
  "localFetchUnpacked": true,
  "ready": true,
  "remoteLibraryLoaded": false,
  "second": "answer 2",
  "staticImage": 1,
  "violations": []
}
```

**页面 F 同款：实际 Main 输出的五种换图形态**

```text
{
  "allShowNew": true,
  "cases": [
    {
      "commit": "applied",
      "currentSrcIsNew": true,
      "imgSrcset": "<new> 1x, <new> 2x",
      "name": "density",
      "naturalWidth": 24,
      "sizes": "80vw",
      "sources": []
    },
    {
      "commit": "applied",
      "currentSrcIsNew": true,
      "imgSrcset": "<new> 400w, <new> 800w",
      "name": "width",
      "naturalWidth": 30,
      "sizes": "(max-width: 600px) 100vw, 80vw",
      "sources": []
    },
    {
      "commit": "applied",
      "currentSrcIsNew": true,
      "imgSrcset": null,
      "name": "src only",
      "naturalWidth": 24,
      "sizes": null,
      "sources": []
    },
    {
      "commit": "applied",
      "currentSrcIsNew": true,
      "imgSrcset": "<new>",
      "name": "picture",
      "naturalWidth": 24,
      "sizes": "80vw",
      "sources": [
        {
          "sizes": "90vw",
          "srcset": "<new> 1x, <new> 2x",
          "type": null
        },
        {
          "sizes": null,
          "srcset": "<new>",
          "type": "IMAGE/PNG"
        }
      ]
    },
    {
      "commit": "applied",
      "currentSrcIsNew": true,
      "imgSrcset": "<new> 2x",
      "name": "density without 1x",
      "naturalWidth": 24,
      "sizes": null,
      "sources": []
    }
  ]
}
```

**B3 撤回后的直接源码探针**

```text
title -> {"handle":"title","status":"not-editable","reason":"unsupported-target"}
textarea -> {"handle":"textarea","status":"not-editable","reason":"unsupported-target"}
```

原始检查记录集中于[证据目录](agents-md-2026-10-03-implementation-evidence/)。子代理工具输出的关键行在 [delegated-checks.txt](agents-md-2026-10-03-implementation-evidence/delegated-checks.txt)，没有为了誊录重跑测试。已有 check:ai-capabilities 失败按审查列为本批无关，未处理或宣称通过。
