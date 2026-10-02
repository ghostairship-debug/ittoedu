# 果铃工作台｜独立评审结果与修复指令（v2，含 Owner 裁决）

> 受众：负责实施的开发智能体（下称“你”）。评审方：Claude（只读，未改仓库任何文件）。
> 版本：v2，2026-10-03。基线：2026-10-03 00:24 的 `D:\果铃工作台` 工作树（撰写时 `src` 自 22:38 起无新改动，你尚未按 v1 动手）。
> v2 相对 v1：① 吸收 GPT、Gemini 两份独立评估，逐条核实后采纳或驳回（§11）；② 记入 Owner 2026-10-03 的 4 项裁决（§8）；③ 更正 v1 的若干错误（§0）。
> 行号仅作定位，以符号名为准。你在此之后又改过相关文件时，先跑 §10 的脚本确认现状再动手。

## 0. 这份文档是什么

- 你在修「AGENTS.md 新原则违规清单」。清单实际是 **18 项**（A1–A5、B1–B3、C1–C5、D1–D5），v1 误写为 19。本文是独立评审方对这 18 项的逐条裁决，外加读源码、跑探针、做浏览器实验时发现的清单之外的问题。
- 这不是让你“决定修不修”，而是给出**已核实的结论和可执行的修法**。发现与源码不符时，以源码为准，并在回报里写明。
- Owner 已就 4 个产品取舍做出裁决（§8），**按裁决执行，不要自行改动**。
- 证据来源：读源码；`tsx` 直接 import `src` 的只读探针（§10，均已实跑）；真实 Chromium 152 的三个小实验（srcset 优先级、Published 同款 CSP 对 blob 样式表、早期事件）；`npx vitest run tests/integration/g20M27RuntimeTextReplace.test.ts`（2 通过）；`tsx scripts/generate-contracts.ts --check`（通过）。
- 你清单里“已完成的修复”（resume-observation 整套删除、`invalidatedDocuments` 删除、视觉路由、`describeRun` 缓存、`engine.recover()` 异步）：我只核实了“`text.replace` 支持 Runtime/Component 文字”，发现它在真实运行里不可用（见 C2）；`readCoverage` 删得不彻底（见 C3）；其余未复核，请自行保证有对应用例。
- **v1 的更正**（以 v2 为准）：
  1. 项数 19 → 18。
  2. v1 把本地 `modulepreload` 标为“已放行”是错的：我只测了提取层；走完整的 `prepareHtmlCourseCandidate` 仍整份失败（§4.1）。
  3. v1 对 D2 的建议（按实例引用的素材裁剪）不安全，已改（§6）。
  4. v1 的 A5 首选方案（升级 run 的文档可写授权）改为窄方案（§5）。
  5. v1 的“导入后难撤回”不准确：导入是一步可撤销的事务；真正的代价是事后修补很贵（这类资源没有变成课件素材，“点图换图”认不出）。
  6. v1 建议把 `http://`、`blob:`/`file:` 资源降为警告，改为**保持拒绝**（Owner 已裁决，§8-1）。
- 优先级 P0/P1/P2/P3 只表示本批的先后顺序，不是严重度分级。

### TL;DR

1. **C2（最先做）**：流式预览失败会作废整个 `text.replace` 调用。M27 的 Runtime/Component 文字替换在真实运行中根本到不了 Gateway，单测是绿的只因为它绕过了这条路径。
2. **A2/B2（同一人统一集成）**：HTML 导入只修了一半。
   - 普通 AI 课件 JS（`class A{constructor(){}}`、`img.src = 变量`、`opts[i].onclick=…`、本地内联库）仍整页拒绝。
   - 本地 `modulepreload`/`preload`、非受管素材在 prepare 层整份失败。
   - `@import … layer()`、`defer/async` 导入成功但行为不对。
   - 运行时对 `ondrop/ondragover/onload/onerror…` 内联事件直接抛错。
   - 降级后的警告到不了模型；admission 失败只报 “failed”。
3. **回退重做**：A3（回退 `utf-8`，改为 kind 省略时按扩展名推导）、A4（回退“默认保留 srcset”，按 Owner 裁决把备用图改指向新图）。
4. **A5**：窄方案——只对“已批准的工作空间外 + 已打开”这一种情形，经 DocumentSession 一次性提交，不改 run 授权。
5. 小改：A1（`file.patch`）、C3、D3（超限提示）；P3：C1、B3（撤回）、D1（删一处重复）、D2（可选）。
6. 不动：B1、C4、C5、D4、D5。
7. Owner 已裁决 4 点：见 §8。

## 1. 裁决标准（先读）

现行 AGENTS.md（22:34 修改，共 67 行）里检索不到清单和审计报告所引用的“禁止先 read 再改 / 过程层双保险 / not authorized 层层校验”；审计报告说的第 39/46/54 行里并无此内容。**不要拿这句话当依据。** 现行有效的原文是：

- 「非必要不增加核验门。命中现有门时先证明它保护的当前属性和失败方式；仅预防性、格式偏好、无法对应实际错写／数据损坏／运行失败的门应删除或改成不阻断的诊断。」
- 「导入优先让内容成功进入并使用……局部不支持或可修复缺口提供清楚诊断和后续修复入口，不据此拒绝整份可用内容，也不静默静态化。」
- 「导入检查只承担实际解析、正确保存／重开、资源引用和载体运行所必需属性；不要用保守静态猜测拒绝普通数据、答题逻辑或动态效果。真实无法运行、无法保存、目标身份错误、数据会被破坏或当前宿主确实不支持时，才在相应边界明确失败。」
- 「唯一正式 writer、实际权限、最终 CAS、停止屏障、授权根和真实未知副作用查证只因其防止已知错写／重放而保留，不扩成一般防御平台。」
- 「最小充分验证……通过后停止同义重复。」

对每道门问三个问题：

1. 它防的是哪一种具体的错写 / 数据损坏 / 运行失败？
2. 执行端是否已有等价保护（CAS、权限、CSP、沙箱）？
3. 能否改成不阻断的诊断？

第 1 题答不出，或第 2 题已有 → 删；第 3 题可行 → 降级为诊断。

**导入的产品规则（Owner 2026-10-03 裁决，见 §8-1）**：

- 产品自己看不懂、没把握的（静态分析证明不了、宿主暂不支持的写法）→ **放行 + 警告**，不得整份拒绝。
- 输入本身**明确是坏的**，AI 在导入前一轮就能改好、而导入后修补很贵 → **先拒绝**，拒绝信息必须具体到 AI 一轮能改好（哪个文件/地址/脚本、怎么改）。仅限 4 类：脚本语法错误；引用的本地文件不存在；`http://` 资源；本机路径 `file:` 与 `blob:`。
- AI 一轮改不好的外部依赖（网上的脚本/样式/字体、CDN）→ **放行 + 警告**，警告要写准后果和修法。

**降级不等于静默**：被降级的诊断必须能到达模型（见 §4.3(c)），否则等于把“明确失败”换成“静默坏页面”。

**不要动（合法硬化）**：
- 单一正式 writer、最终 CAS、停止屏障、授权根、真实未知副作用查证。
- staging 的 realpath 闭合与沙箱。
- 主进程强制的冻结权限档位（如 `HostToolServices.writableRun`）。
- Provider Secret 不入工程/导出物。
- Published 与预览的 CSP。
- **远程脚本、远程模块、远程 Worker 本轮不开放**（`docs/development-plan/ARCHITECTURE_CONTRACT.md:69`）：降级诊断不得连带放宽 CSP 或新增宿主接口。要开放须单独列项交 Owner。
- `fetch`、EventSource、WebSocket 已是正式能力（同文件 `:68`，精确 `https`/`wss` origin 声明用于预览、发布和 CSP），**不需要再向 Owner 请示**。

**本批禁止**：
- 新增校验门、重试链、缓存、配置项或“平台”（含 D3 的数值配置）。
- 改 `AGENTS.md`（需 Owner 确认）。
- 改 `.agents/skills/**` 里的创作侧建议（例如 `html-draft-contract.md` 的“不加载远程脚本”）。
- 改变“失败不提交半成品”的合同。
- 扩范围。发现新问题只记进回报。

## 2. 总览表（18 项）

| 编号 | 裁决 | 序 | 核查结论与对照 |
|---|---|---|---|
| A1 | 修（工作树已做）；补 `file.patch` | P1 | HEAD 强制成立；`expectedVersion` 已改可选。回滚靠变更回看快照/文档 undo。`file.patch` 同类问题未改。GPT、Gemini 同意 |
| A2 | 修，只修了一半 | P0 | 见 §4。GPT 补的 3 个缺口（layer/defer/模块）与 Gemini 的动态 URL 赋值均已实测成立 |
| A3 | 回退 `utf-8`；kind 省略时按扩展名推导 | P1 | 实测：不传 kind 抛“文件名与markdown格式不符”；`utf-8` 建出 0 字节 `.h5lesson`/`.png`。GPT“已修”不成立；Gemini 的默认 kind 成立 |
| A4 | 回退“默认保留”；按裁决把备用图改指向新图 | P1 | Chromium 实测：保留 srcset 则新图不显示。GPT、Gemini 的“已修”不成立 |
| A5 | 修：窄方案 | P1 | 档位被说错；真实缺口见 §5。GPT 的窄方案经原型验证；Gemini 的“放宽 guard + 改 `file.open.writable`”不采纳 |
| B1 | 不修 | — | 本地 CSS 必须内联（CSP 实测；受管素材不含 CSS）。GPT、Gemini 的“保留 link/当外部素材”不采纳 |
| B2 | 修（并入 A2） | P0 | 增加 `defer/async` 调度语义（GPT）；Gemini 的“保持引用原貌”不可行 |
| B3 | 撤回工作树改动（默认） | P3 | 预览端仍排除 textarea/title；locator 的 `raw-text` 已就绪。title 不做；textarea 两端同做为可选 |
| C1 | 修（方向对）；删 `flushFirst` 为可选 | P3 | 默认复制磁盘版 + 标注正确（GPT 同意：不静默保存） |
| C2 | 修 | P0 | 见 §3。GPT 同意；Gemini 的“扩 EditTarget 做 Runtime 流式预览”不采纳 |
| C3 | 修（小删除） | P2 | 含 `drain()` 与停止语义（GPT） |
| C4 | 不修 | — | 冻结档位的执行端检查，属保留项 |
| C5 | 不修 | — | 生产批量受缓冲限制；自动分批破坏原子语义 |
| D1 | 仅删明确重复的一处 | P3 | Component 包解析后 `syntax()` 再校验（GPT）；不加缓存 |
| D2 | 可选，仅限明确无关的 Component 包变化 | P3 | 不得按 `runtime.assets` 裁剪（`projectUrl`） |
| D3 | 只加超限提示；不改数值、不加配置 | P2 | 400 在两个 registry 里静默截断 |
| D4 | 不修（延后） | — | 指纹是 DOM 目标身份校验；无失败样本 |
| D5 | 不修 | — | editId = toolCallId，单次使用 |

**建议执行顺序**：
1. Batch 1：C2 → A2(a)(c)(d)(e)。
2. Batch 2：A2(b)(g)(h)(i) + B2 → A5 → A3 → A4 → A1(patch)。
3. Batch 3：C3 → D3（提示）→ C1、D1、B3（撤回）、D2（可选）。
4. A2 与 B2 共享导入实现，由同一实施者统一集成，避免重复改同一根因。

## 3. P0 · C2：流式预览失败会作废整个 `text.replace`

**结论**：M27「`text.replace` 支持 Runtime/Component 文字」在真实运行里用不了。

### 3.1 事实链（已核实）

1. 两个 provider 都是 `stream: true` 并产出 `tool.delta`：`OpenAIChatProvider.ts:297`、`ChatGPTResponsesProvider.ts:217`。所以真实 DeepSeek/GPT 运行必走流式路径。
2. `ExecutionEngine.preview()`（约 `:1241`）发现 `text.replace` 且 target 可解码，就调 `this.options.edits.begin(...)`（`:1278`）。
3. `EditSessionService.start()`（`EditSessionService.ts:97`）→ `gateway.resolveEditTarget()` → `DocumentToolGateway.handle()`（`:629`）。`handle()` 只查 `this.handles`。
4. Runtime/Component 文字句柄（`content.targets` 发现的 `c…`）在 `this.contentTargets`（`:175`），不在 `handles`，于是抛 `ToolError('invalid-target', '目标句柄不存在或不属于此任务')`。
5. `preview()` 的 catch 只放过 `code === 'document-busy'`（`:1283`），其余 `throw`，外层 catch 置 `stream.invalid`。
6. 完整调用到达时（`:1970–1979`），`invalid` 非空 → 该调用直接标成 `returned` + `invalid-tool-arguments`，**根本不执行，Gateway 看不到它**。
7. 为什么 M27 单测是绿的：`tests/integration/g20M27RuntimeTextReplace.test.ts` 直接调 `gateway.execute('text.replace')`，绕过 `preview()`。
8. 复现见 §10 脚本 A：同一句柄，Gateway 直调 → `document-operation applied`；`edits.begin` → `invalid-target`。
9. 引擎其余前置步骤我也验证过，对 `c…` 句柄不会抛：`gateway.effectTargets` → `undefined`，`documentsOfHandles` → `[]`，`lookup` → `null`。`resolveEditTarget` 会抛，但 `ExecutionEngine.execute()` 的 `beforeEdit` 与 `approvalPreview` 都有 try/catch。**所以只改 `preview()` 就能让调用到达 Gateway。**

### 3.2 修法

- `preview()` 里 `edits.begin` 的 catch：**任何失败都只置 `stream.previewSkipped = true`**，不再 `throw`，不置 `stream.invalid`。流式预览是纯展示层，不是权限/CAS，终判永远在 Gateway。完整参数到齐后进入原正式 Gateway 提交，保留 `active.stopped` 检查、参数完整性（`StreamingEditArguments`）和正式目标冲突处理。
- **不要**为了让预览支持 Runtime 文字而放宽 `EditSessionService.editable()` 或新增预览目标类型（Gemini 的建议不采纳）：Runtime 文字没有编辑器内的流式投影，那是新平台。
- `EditSessionService.begin()` 的 `edit-id-used` / `cancelled` 终态（清单 D5）不动：editId = toolCallId，每次调用唯一。

### 3.3 测试与验收

- 在 `tests/integration/g20ExecutionEngine.test.ts` 现有流式用例（约 L363–392，`tool.delta` + `complete`）旁加一例：
  - `options.edits.begin` 用 stub 抛 `Object.assign(new Error('x'), { code: 'invalid-target' })`，或用真实 `EditSessionService` 加 Runtime fixture 的 `c…` 句柄。
  - provider 流式发 `text.replace` 的 delta 后 complete。
  - 断言：调用**到达** `gateway.execute`，结果**不是** `invalid-tool-arguments`；正式提交成功；**一次撤销**恢复原文；中途**停止**时不提交。
- 不要只跑 Gateway 直测；保留 `document-busy` 跳过预览的用例（`tests/integration/g20EditSession.test.ts:101`）。
- 修后 §10 脚本 A 的 `edits.begin` 仍会被拒，这是预期的（`EditSessionService` 不改），关键证据是上面的引擎测试。

### 3.4 修后顺手核对（仅复现时处理）

`documentsOfHandles` 不认识 `c…` 句柄（返回 `[]`）。`ExecutionEngine.approvalReason()`（约 `:803–806`）在 workspace 档且任务带工作空间外文档时，会把“未知目标”当“可能在外”，为 Runtime 文字替换弹“工作空间外”批准卡。若复现，让 `documentsOfHandles` 识别 `contentTargets` 的 `source` 句柄，取其所属文档。

## 4. P0 · A2 / B2：HTML 导入“只修了一半”

### 4.1 现状矩阵（00:24 工作树，脚本 B 实测；每个输入同时给出提取层 / prepare 层结果）

| 组 | 输入 | 现状 | 目标 |
|---|---|---|---|
| 已放行（保持） | `fetch`/XHR/`new Worker`、`<iframe src=https>`、静态 `onClick`、`setAttribute` 动态属性名、Google Fonts、Tailwind/Chart.js CDN 脚本、`data:` 脚本、AVIF、`<script type=module src=本地>`（被内联） | 提取层 ok，prepare PASS（带 warning） | 保持，且 warning 送达模型 |
| 已放行但行为不对 | `@import … layer()/supports()` 本地 css | 导入成功，HTML 里仍是相对 `@import`，css 没打包；现有警告“由宿主异步加载”是错的 | 内联并包 `@layer`/`@supports`（§4.3(g)） |
| 已放行但行为不对 | `defer`/`async` 本地外部脚本 | 导入器保留 `<script defer>…</script>`，包装层又清掉 `defer/async`，变成就地立即执行 | 保留调度语义（§4.3(h)） |
| 已放行但行为不对 | 本地 ES 模块 `import … from "./mod.js"` | 导入成功，原句保留，运行时（blob 基址）解析不了，该页脚本不运行 | 本期不打包；警告写明“不会运行，请合并成单文件”（§4.3(i)） |
| 已放行但行为不对 | 内联 `ondrop/ondragover/ondragstart/ontouchstart/onwheel/onmouseenter/onmouseleave/oncontextmenu/onscroll/onpointermove/onended/onplay/onerror/onload` | 导入阶段 PASS；运行时包装 `create()` 抛“HTML 页面不支持内联事件”（脚本 C） | 全部可挂载（§4.3(b)） |
| FIX（prepare 层整份失败） | 本地 `<link rel=modulepreload>`、`<link rel=preload as=script>`；`<track src=a.vtt>` 等非受管资源类型 | 提取层 ok，prepare 抛“HTML 资源类型暂不能作为受管素材导入：text/javascript / application/octet-stream”（`prepareHtmlCourseCandidate.ts:36`） | 放行 + 警告（§4.3(e)） |
| FIX（提取层整份拒绝） | `class A{constructor(){}}`（含 extends/super）、`x.constructor`、`el.style[p]=v`、`el.dataset[k]`、`opts[i].onclick=…`（quiz 常见）、`o[k]`（参数）、`eval`、`new Function`、`Object.getOwnPropertyDescriptor`、`Reflect.ownKeys`、`const {style}=el`、本地内联 d3/lodash/dompurify/katex/jszip | REJECT：`unsupported-dynamic-url-sink` | 放行 + 警告（§4.3(a)） |
| FIX（提取层整份拒绝） | **动态 URL 赋值**：`img.src = 变量`、`audio.src = a[i]`、`el.style.backgroundImage = "url("+v+")"` | REJECT：“无法静态解析 src 的资源地址 / backgroundImage 的资源内容”（`extractHtmlResources.ts:700/686` 等） | 该点不改写 + 警告（§4.3(a)） |
| KEEP（Owner 已裁决：仍拒绝） | 脚本语法错误；缺失的本地文件（图片/脚本/样式等）；`http://` 资源（图片/iframe/CSS url）；`file:///…`、`blob:` | REJECT | 保持拒绝，信息要具体（§4.3(j)） |

AVIF 导入端到端通过（清单该项不成立）。

### 4.2 现有每个 error 的处置（行号为 00:24 的 `extractHtmlResources.ts`，另注明处除外）

| 约行号 | code | 处置 |
|---|---|---|
| 220、482、1045 | `missing-relative-resource` | **保持 error**（Owner 裁决） |
| 248 | `unsupported-url-scheme`（`blob:`/`file:` 等） | **保持 error**（Owner 裁决） |
| 550 | `script-parse`（脚本语法错误） | **保持 error**（Owner 裁决） |
| `remoteHtmlReferences.ts:18` | `remote-https-required` / `invalid-remote-url` | **保持 error**（Owner 裁决） |
| 471 | `unsupported-css-import`（无法解析的 `@import`） | 降 warning，保留原样 |
| 483 | `css-import-cycle` | 降 warning，保留原样 |
| 560 | `unsupported-framework-resource-input` | 降 warning；整体失败 → 该脚本原样保留（§4.3(a)） |
| 573 | `unsupported-dynamic-url-sink`（`capabilityErrors`） | 降 warning；整体失败 → 该脚本原样保留 |
| 686、700、715、760、762、768 | `unsupported-dynamic-url-sink`（逐点） | 降 warning；该点不改写，其余照常 |
| 567、727、737、811 | `conflicting-js-rewrite` | 降 warning；本来就 `return code` |
| 817 | `script-rewrite` | 降 warning；本来就 `return code` |

### 4.3 修法

**(a) JS 闭包证明失败：不再整页拒绝，也不做半改写**

- 位置：
  - `javascriptClosureProof.ts` 的 `capabilityErrors`（约 `:659–668`）。它命中：
    - 名字 `eval`/`Function`/`Reflect`/`constructor`/`getOwnPropertyDescriptor(s)`/`__lookupGetter__`/`__lookupSetter__`；
    - `setAttribute`/`setProperty`/`insertRule`/`insertAdjacentHTML` 被当值使用；
    - 对象模式解构出 `style`/setters/networks；
    - computed 成员访问，如 `el.style[p]`、`el.dataset[k]`、`opts[i].onclick`、`o[k]`；
    - `styleReceiver` 的非 alias/member 用法。
  - `extractHtmlResources.ts`：`closureProof.capabilityErrors.length` 处（约 `:573`）一次性报 error；另有 `frameworkError`（`:560`）。
  - 你 22:38 把 `fetch/XHR/Worker…` 拆成 `networkCalls` → warning，这部分是对的。
- **误报根因（高频）**：类方法名 `constructor`、`x.constructor`、`el.style[prop]`、`el.dataset[k]`、`opts[i].onclick=…`。这些都是普通 AI 课件 JS，却被当成“资源能力逃逸”。
- 修法分两类，保持“已证明才改写”的原语义：
  1. **逐点解析失败**（`urlSink`/`embeddedSink` 解不出 URL 或内容、复合写入 `+=`、computed 属性写入等，包括动态 URL 赋值）：该点不改写，其余照常，发 warning。
  2. **整体证明失败**（`capabilityErrors` 非空，或 `frameworkError`）：**该脚本整体不改写**（`rewriteJavaScript` 直接 `return code`），发一条 warning：“无法静态证明该脚本的资源引用闭合，已原样保留；脚本里的本地文件引用不会被打包”。
     - 这样避免“证明失败却仍对该脚本做局部字符串替换”的半改写。降级之前这条路径从未在生产中走通，因为 error 会拦住整份导入，所以半改写的正确性从没被验证过。
     - 原样保留时，内联的 `data:` 资源仍可运行（CSP 允许 `img-src data:`）。
- 大 bundle 会产生成百上千条同类 diag：本地内联 d3/lodash 时 prepare 的错误文本里同一句“无法静态确定计算属性写入是否为资源入口”重复几十次，必须按 `code` 合并（见 (c)(j)）。
- **测试**：
  - `tests/unit/g20M17BenchmarkClosure.test.ts`（约 L123–130 与 L150–210 的拒绝类 `it.each`，其中你已把部分断言写成 `'error'`）和 `g20HtmlImportClosure.test.ts` 里断言 error 的用例，按新契约改成：断言 `level==='warning'`、无 error；整体失败类再加“该脚本输出里无 `cw-resource:` 占位（原样保留）”。
  - **保留所有正向用例**：已证明的 React 基准 bundle 必须仍完整改写（`errors(vendor + app())` 仍为 `[]`，占位仍生成）。

**(b) 内联事件（Owner 裁决 §8-2）**（`src/shared/runtime/htmlDocumentSource.ts:36–44`）

- 现状：只放行 `click dblclick change input submit keydown keyup keypress pointerdown pointerup mousedown mouseup mousemove mouseover mouseout focus blur`，其余 `on*` 在 `create()` 里抛“HTML 页面不支持内联事件：…”。导入阶段通过，挂载/准入阶段失败，拖拽配对题必中（脚本 C）。
- 修：**删除白名单，全部 `on*` 内联事件一律可挂载**。`element['on'+name] = new Function(...)` 对任意事件名有效。
  - 交互类（`drag*`、`drop`、`touch*`、`wheel`、`mouseenter`、`mouseleave`、`pointer*`、`contextmenu`、`scroll`、`ended`、`play`、`pause`、`timeupdate` 等）：无争议，直接放行。
  - **页面加载期事件**（`onload`、`onerror`，含 `<body onload>`、`<img onload/onerror>`）：Owner 已裁决放行，**尽力绑定 + 导入期警告**。
    - 警告在 `extractHtmlResources` 扫描 HTML 属性时发出，如 `early-event-handler`：“`onload/onerror` 等加载期事件在页面组装后绑定，个别时序可能漏触发；关键初始化请改用脚本内 `addEventListener` 或立即执行”。
    - 实验（页面 G，真实 Chromium 152，与产品相同的 blob 脚本绑定方式）：`body.onload`、绑定脚本之前的图片 `onload`、加载失败图片的 `onerror` 均正常触发；只有排在绑定脚本之后才出现的元素可能漏掉（正式包装层另在 body 末尾补一次绑定）。
  - 同步改 `tests/e2e/g20HtmlCspCarrier.spec.ts:134`：原断言“`onload` 被拒”（commit `fba0352f` 的有意设计），改为 `<body onload>` 可挂载且触发，并保留“Blob 脚本在 destroy 时被 revoke”的断言。
- 测试：给 `createHtmlDocumentRuntimeSource` 加 jsdom 单测（把脚本 C 断言化），覆盖上述全部事件 → 可挂载。
- 真实 Electron 的 admission 无法在单测里证明。回报里如实写“未在真实宿主验证”，或用一份小的拖拽页真实导入一次。

**(c) 降级后的警告必须到达模型**

- 现状：
  - `HtmlImportService.notices()`（`HtmlImportService.ts:148`）只被桌面菜单导入用（`HtmlImportDesktopService.ts:54` → `App.tsx:456`，且只显示一句固定文案）。
  - AI 的 `html.import` 回执（`HtmlImportReceipt`，`toolPorts.ts:66`）没有 warnings，`htmlImportReceiptResult`（`HtmlImportTools.ts:20`）也不带。
  - 所以降为 warning 后，模型只看到 applied，永远不知道“CDN 脚本在播放器里不会加载”。HEAD 时它至少能收到具体 error 并自行修正。
- 修：
  - 复用已有通道 `ToolResult` 的 `advisories`（`shared/workbench/tools.ts:44–46`）。`ToolAdvisory.code` 联合类型加一项，如 `'html-import-warning'`，`step` 填 0。
  - `HtmlImportToolService.import` 成功回执里附 `warnings`，来自 `service.notices(ticket)` 的结构化版本（level=warning 的 code + message）；`htmlImportReceiptResult` 映射为 `advisories`。
  - **按 `code` 合并去重，最多 5 条，每条 ≤200 字**，附“共 N 处”。
  - 回执存进 `HtmlImportOperationStore`（无 zod，只有类型），新增可选字段即可；`lookup()` 重放要同样带出。
  - 请核对 ExecutionEngine 序列化给模型的 tool message 含 `advisories` 字段（现在只有 batch 路径产生它）。
- **警告文案要写准**：
  - 导出/Published 的 CSP 是 `default-src 'none'`（`buildCoursePackages.ts:184`、`:235–248`；预览见 `htmlPreviewResponse.ts`）。
  - 远程脚本/样式/字体/`<iframe src>` **一律被拦**（不是“可能”）。
  - `fetch` 仅允许 `project.network.connectOrigins` 声明的精确 https 源。
  - `script-src` 允许 `unsafe-inline`/`unsafe-eval`/`blob:`，`worker-src blob:`。
  - 警告里写明后果和修法（内联该库 / 改本地文件 / 改为链接）。
  - 现有文案“Publisher/Player 在 sandbox 下可能跨域受限”含糊；`remoteHtmlReferences.ts` 里“Publisher/Player 在 Player 里”还有重复措辞；CSS `@import layer()` 那条“由宿主异步加载”是错的（见 (g)）。

**(d) admission 失败要带原因**

- 现状：`HtmlImportService.admit()` 只抛 `HTML 候选未通过受控构建：${status}`（`:180`，status 通常是 “failed”）。`ControlledBuildService.view()`（`:68–71`）不带日志，原因只在 `job.logs`。模型拿到的是不可操作的 “failed”。
- 修：`status !== 'ready'` 时再调一次 `build.logs`（入参见 `ControlledBuildService.ts:397` 与 `buildToolCallSchema`：`job` + `after`/`limit`；返回 `{ entries:[{cursor,time,stage,level,message}], nextCursor }`），取最后几条 `level==='error'` 拼进错误信息，逐条截断。纯诊断，不是新门。

**(e) 非受管素材类型与“提示类” link**

- 不要等到 `prepareHtmlCourseCandidate.assetKind()` 抛错。
- `<link rel="modulepreload">`、`<link rel="preload" as="script|style|fetch…">` 只是性能提示：目标不是受管素材类型时**直接丢弃该标签**并给 info/warning，不登记素材（现状：登记成 `text/javascript` 资源后整份失败）。`preload as=image/font/audio` 且目标是受管素材时，沿用占位改写。
- 其他非 image/audio/video/font 的相对资源（`<track src=a.vtt>` 等）：**不生成 `cw-resource:` 占位**，保留原引用并发 warning：“该类型暂不能作为受管素材，已保留原引用”。
- 若先生成占位再在 prepare 层跳过，`createHtmlDocumentRuntimeSource` 会因“素材绑定缺失”失败。

**(g) CSS `@import … layer()/supports()`：内联并包裹，不要留相对 `@import`**

- 现状（`extractHtmlResources.ts` 约 `:473–480`）：遇到 `layer(…)`/`supports(…)` 后缀就原样保留 `@import`，并警告“由宿主异步加载”。实测导入后 HTML 里仍是 `@import url("a.css") layer(base)`（脚本 B 的“运行时 HTML”输出可见），运行时解析不到本地文件，样式丢失。
- 修：沿用现有 `@media` 包裹的做法，把后缀转成嵌套包裹后内联：`@import <url> [layer | layer(<name>)] [supports(<条件>)] [<媒体查询>]` ≡ `@layer <name>? { @supports (<条件>) { @media <查询> { <被导入 css> } } }`（缺省的部分省略；`supports()` 内是声明时补括号）。被导入 css 里的 `url()` 照常递归改写。
- 改写后删除/改写那条错误的警告文案。

**(h) `defer` / `async` 调度语义**

- 现状：导入器内联本地外部脚本时只去掉 `src`，`defer`/`async` 属性留在内联脚本上（脚本 B 输出：`<script defer>window.__a=1;</script>`）；包装层 `htmlDocumentSource.ts:64` 对非 module 脚本又 `removeAttribute('defer')`/`('async')`。结果：原本“解析完成后按序执行”的脚本变成“就地立即执行”，`<head>` 里的 defer 脚本在 `<body>` 解析前运行。
- 修（机制由实施者定，二选一，**推荐 1**）：
  1. 导入器对“原本是外部 + `defer`”的脚本加内部标记（如 `data-cw-defer`）；包装层对带标记的脚本保留 `defer` 到 blob `src` 脚本上后再摘掉标记（blob 外链脚本遵守 `defer`，顺序保持）。
  2. 导入器把这类脚本在内联时按序挪到 `<body>` 末尾并去掉 `defer`。
  - 不要改变真正内联脚本（本来就没有 `src`）的语义：内联脚本上多余的 `defer` 仍被忽略。`async` 就地执行可接受（原本就无顺序保证）。
- 验收：`<head><script defer src="app.js"></script></head><body><p id="x"></p></body>`，`app.js` 里 `document.getElementById('x').textContent='ok'`，导入并挂载后必须生效。jsdom 跑不了 blob 脚本，请用真实 Chromium/Electron 的 e2e 或页面 G 同款手工页验证。

**(i) 本地 ES 模块依赖图（Owner 裁决 §8-4：本期不做打包）**

- 保持“放行 + 警告”。警告必须直说：“本地模块 `import … from "./x.js"` 在课件里无法解析，该页脚本不会运行；请把脚本合并为单文件”。
- 不实现模块打包，不新增依赖。自包含的 `<script type="module">`（无 import）和 `<script type="module" src=本地>`（被内联）照常工作。
- 远程模块/脚本：CSP 本来就拦，维持“放行 + 警告”，不放宽 CSP。

**(j) 文案规范**

- **拒绝**信息（4 类 KEEP）要具体：哪个文件/地址/脚本、怎么改。现状基本具体（“找不到相对资源 missing.png”“远程资源需要 HTTPS: …”“不支持资源协议 file:///C:/a.png”“脚本无法解析: SyntaxError: Unexpected token (1:9)”）；脚本语法错误建议补“第几个 `<script>`”。多个同类问题按 code 合并，最多列 10 条。
- **警告**文案按 (c) 写准后果与修法。

## 5. P1 项

### A3：回退 `utf-8`；`kind` 省略时按扩展名推导

- 实测（§10 脚本 E）：
  - `file.create {name:"data.json"}` 不传 kind → 抛“文件名与markdown格式不符”（schema 默认 `markdown`，`AgentFileTools.ts:15`）。Gemini 指出的默认 kind 摩擦成立。
  - `kind:"text"` + `data2.json` → 成功（HEAD 的 `text` 本来就够用，`sourceFileKind()` 对非 md/h5lesson/二进制扩展名一律返回 `'text'`）。
  - 工作树新增的 `kind:"utf-8"` + `x.h5lesson` / `pic.png` → **成功建出 0 字节文件**（跳过全部名称/扩展名校验，`AgentFileService.ts:69–72`），磁盘上留下坏文件。GPT 的“已修，保留现有入口”不成立。
- 修：
  1. 回退 enum 与 `preflightCreate` 的 `utf-8` 分支，并同步 `tests/integration/g20AgentFileTools.test.ts` 里为 `utf-8` 加的断言。
  2. `kind` 改为可省略（去掉 `.default('markdown')`），省略时由软件按扩展名推导：`.md/.markdown` → markdown；`.html` → html；`.h5lesson` → course-v9；其余 → text（二进制扩展名仍由 `sourceFileKind()` 拒绝）。显式给出的 kind 与扩展名冲突时仍报错（现有行为）。
  3. 说明改为：“kind 可省略，按文件扩展名自动识别；kind=text 适用任意 UTF-8 数据/源文件（.json/.csv/.svg/.xml/.yaml/代码/无后缀…）；.md、.h5lesson、二进制扩展名不可用此 kind”。
- 测试：`{name:'data.json'}` → text；`{name:'a.md'}` → markdown；`{name:'x.png'}` → 拒绝；`{name:'x.h5lesson', kind:'text'}` → 拒绝；不再有 `utf-8`。

### A4：回退“默认保留”；按 Owner 裁决把备用图改指向新图

- 实测（Chromium 152，页面 F）：`<img>` 的 `srcset`/`<picture><source>` 存在时，浏览器优先它们，只改 `src` 新图不显示。

  | 标记 | `currentSrc` |
  |---|---|
  | `<img src=新 srcset="旧1 1x, 旧2 2x">` | 旧1 |
  | `<img src=新 srcset="旧1 400w, 旧2 800w" sizes>` | 旧1 |
  | `<img src=新>`（对照） | 新 |
  | `<picture><source srcset=旧源><img src=新></picture>` | 旧源 |
  | `<img src=新 srcset="旧2 2x">`（srcset 无 1x 候选） | 新 |

- 工作树现改法（默认保留 srcset，`clearResponsive:true` 才清）会让带 srcset 的图“换了没反应”。涉及：
  - `shared/workbench/htmlPreview.ts:109`
  - `HtmlSourceEditService.ts:151`
  - `player/htmlPreview/htmlPreviewAgent.ts:261–312`
  - `tests/integration/g20M23HtmlLightEdit.test.ts:64–79` 与 `:358–387`（把“新 src + 旧 srcset 并存”固化成预期）
- **Owner 裁决：B**——换图时，把 `<img>` 及同 `<picture>` 内 `<source>` 的每个 `srcset` 候选 URL 全部改为指向新图，保留各候选的描述符（`1x/2x/400w…`）和 `sizes`。
  - `<source type="…">` 的 `type` 与新图格式不符时，一并移除该 `type`。
  - 回执加可选字段（如 `patch.rewroteResponsive: true`）让 UI/时间线提示“已把旧备用图指向新图（可撤销）”。
  - 预览热补丁（`htmlPreviewAgent.ts`）同样改写，热撤销用已有的 `imageOriginals` 恢复原值。
  - 整个 `clearResponsive` 参数随之取消（不再需要，API 面更小）。
  - 退而求其次：若 B 改动过大，用 **A**（HEAD 行为：移除 `srcset/sizes` + 同样的提示）。**不得保留旧候选。**
- 测试：改写后的标记断言（上表五种形态）；撤销恢复；可选用页面 F 同款在 Chromium 里验证改写后 `currentSrc` 均为新图。

### A5：窄方案——已批准的工作空间外文件，一次性经 DocumentSession 提交

- **触发条件**：`workspace`（默认档）或 `ask` 档 + 目标在工作空间外 + **文件已在工作台打开** + 用户已在批准卡点了“允许”。`full` 档不触发（清单把档位说错了）。
- 现状（脚本 E 端到端实测）：即使 `approvedOutsidePaths` 含该文件，`AgentFileText.commit()`（`:150–151`）仍抛“已打开的工作空间外文档需取得正式文档写授权…”。前面 `AgentFileService.requireMutationScope()` 已按批准判过，这是第二道不认批准的重复门。
- **只删这道 guard 不够**（Gemini 的建议不采纳）：`DocumentToolGateway.attachRunDocument`（约 `:346–366`）对已挂载文档只返回现有授权、不升级。`file.open` 与 `AgentFileText.read()`（`:73–74`）对工作空间外文件都以 `writable=false` 挂载，典型的“先读后改”里，删了 guard 后续 `text.replace` 仍 `not-authorized`（脚本 D）。**也不要**改 `file.open` 的 `writable`：那会让后续文档级写绕过批准。
- **窄方案**（GPT 提出，我已用原型验证，脚本 E）：在 `commit()` 里，对“已打开 + 工作空间外 + 已批准”这一种情形，不走 `attachRunDocument`/`issueTarget`/Gateway，直接：
  ```ts
  const session = this.host.registry.get(snapshot.documentId)
  context.assertActive?.()
  const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId,
    baseRevision: snapshot.revision, actor: 'agent', runId: context.runId,
    mutation: { type: 'command', command: { type: 'markdown.replace', source: next } } })
  ```
  - 这条路径绕过了 Gateway 的授权，所以必须就地断言该路径属于 `context.approvedOutsidePaths`（这是替代被绕过的授权检查，不是新增过程门）。
  - 停止屏障沿用 `context.assertActive?.()`；CAS 由 `baseRevision` 保证；用同一个 `operationId` 保证变更回看的回滚可用。
  - 返回形状与 Gateway 路径一致（`documentResult`、`beforeVersion`、`afterVersion`、`saved:false`、`dirty:true`）。非 applied 的结果映射成清楚的错误（`conflict` → “文档在批准后又被修改，请重新读取”）。
  - `full` 档与工作空间内文档继续走现有 Gateway 路径。**不改** `attachRunDocument`、不改 `active.outsideDocuments`、不改 `file.open.writable`。
  - 可选：patch 时把 `from/to/newText` 作为 `textChanges` 一并传入，保持续接精度。
- 原型实测（脚本 E）：提交 → `applied`；`undoHead = {operationId, actor:'agent'}`；旧 `baseRevision` 再提交 → `conflict stale-revision`；撤销正常。
- 语义（Owner 沿用 2026-09-24 的“允许 / 本任务都允许 / 拒绝”）：“允许”只管这一次；点“本任务都允许”后，该任务后续的文件写入沿用现有 `approveAll` 行为自动带上批准。不需要新的授权语义。
- 测试（`g20AgentFileTools.test.ts`）：
  1. workspace 档 + 工作空间外 + 已打开 + 已批准，分别**不先读**和**先 `file.read` 再 `file.patch`** → 成功；一次撤销恢复原文。
  2. 同条件但未批准 → 仍被 `requireMutationScope` 拒绝。
  3. 批准的这次写完后，对同一文件再写一次且无批准 → 仍被拒绝；该文档的文档级 `text.replace` 句柄仍是只读（批准不扩大到后续无关写入）。
  4. 批准后、提交前用户又改了文档 → `conflict`，不覆盖。
  5. `read-only` 仍拒绝；`full` 行为不变（复用已有证据）。

### A1：补 `file.patch`（`file.write` 的可选版本已正确，不用再动）

- 现状：`file.patch` 的 `expectedVersion` 仍必填（`AgentFileTools.ts:22`），不匹配抛“文件版本已改变，请重新读取后修改”（`AgentFileText.ts:127`）。
- `oldText` 唯一匹配本身就是内容级前置条件，版本号是第二道。已打开文件的 version = `document:id:epoch:revision`，用户在文件别处敲一个字就变，补丁明明还适用却被拒。
- 修：`expectedVersion` 改可选。缺省时只靠 `matchTextPatch`（唯一匹配/range）；带了仍校验。说明文字同步。
- 为什么放开版本是安全的：
  - 未打开文件在提交前会再核（rename 前比对 version 与 live）。
  - 已打开文件走文档事务（history/undo）。
  - 每次 `file.create/write/patch` 前都有变更回看快照（`ExecutionChangeReviewService.prepareFileMutation`，`ExecutionEngine.ts:1526–1528`）可回滚。不存在“无法恢复的覆盖”。

## 6. P2 / P3 项

**C3（P2，小删除）**
- `AgentFileText.read()` 对已打开文档做 attach → issueTarget → `execute('read')` → 字节比对 → 再取一次 version 比对（`:71–86`）。
- 这条往返原本给 `ToolReadCoverage.record` 喂“已观察”，服务已删除的 `assertObserved`。现在 `readCoverage` 只剩 `record/advance/clear`，`has` 已无调用，没有读者。
- 代价：全在进程内，不是“多轮往返”。用户在窗口期内键入会让读取偶发报“正式文档观察与文件读取不一致 / 读取期间文档已改变，请重新读取”。
- 修：
  - 删这段往返与两处事后比对；取快照前 `await this.host.registry.get(id).drain()`（等正式提交队列前进，与 Gateway 其它读取路径一致），从这一份快照分页切片 + `version`。
  - **保留停止语义**：返回前 `context.assertActive?.()`（原来的 Gateway 往返顺带做了“已停止的任务不能读”）。
  - 顺带可删 `ToolReadCoverage` 类及 Gateway 里三处 `record/advance/clear`。**但 `mapAcknowledgedRange` / `mapAcknowledgedFlowRange` 仍被 `continuationTargets.ts` 和 Gateway 使用，必须保留这两个导出函数。**
  - 与 `file.read` 分页游标无关，不动；保留未打开文件提交前的磁盘 CAS。
  - 没有性能测量支持“30ms”或具体提速比例，不要在说明里写这类数字。

**D3（P2，只加提示）**
- 事实：
  - `MAX_AUTO_TARGETS = 400` 在 `RuntimeAuthoringTargetRegistry.ts:39` 与 `ComponentAuthoringTargetRegistry.ts:21` 两处，超限静默 `break`；`content.targets` 的返回只有 `{ targets }`，没有截断标志。注释依据：听力案例约 70 处文字。
  - `dynamicAdmission.ts`：Main 的 20s 是“启动 / 单目标”看门狗，每个目标有进度就重置；另有 20 分钟绝对上限；renderer 另有每目标 12s（`dynamicCandidateAdmission.ts:395`）。
  - `ControlledBuildService.ts` 的 `DEFAULT_BUDGET`：256MiB / 16384 文件 / 10 分钟是**单次 `build.check`** 的预算，不是任务总时长；调用次数类早已默认不设限；预算入口目前只能下调。
- 修：超过 400 时在两个 registry 的发现结果里带截断提示（如 `truncated: true`），`content.targets` 把它带给模型（“仅列出前 400 项，其余未列出”）。**不改数值，不加配置项**；数值按真实失败样本再调。

**C1（P3）**
- 工作树的“默认复制磁盘版本 + `copied:'disk-version'` 标注”（`AgentFileService.ts:257–284`）正确（不静默保存）。
- `flushFirst` 名不副实：为 true 时并不 flush，只是对脏文件抛错。可选清理：删掉 `flushFirst`（schema、说明、实现）；要草稿的模型先 `file.save`。不是阻断问题。

**D1（P3）**
- 事实：`parseComponentPackageFiles` 已调用 `validateComponentRuntimeSource`（`importComponentPackage.ts:240`），`ControlledBuildService.model()` 随后的 `syntax()` 对同一份 Component 源码又校验一次（`:246`、`:260–261`）。
- 修：`syntax()` 在 component 分支去掉重复的 `validateComponentRuntimeSource`（保留 V8 `new Script` 编译）。**不加缓存**（Gemini 的 Map 缓存不采纳：新增共享状态；`validateRuntimeSource` 实测 d3.min.js 273KB 26ms、katex 266KB 12ms、mermaid 3.5MB 162ms，且各调用点分属不同进程）。
- 其余调用点（authoring 命令、准入宿主、Player 挂载）分属不同入口，不要合并。

**B3（P3，默认撤回）**
- 工作树的改动：Main 侧 `htmlSourceLocator.ts` 已对 `title/textarea` 取 `raw-text` token 并从拒绝名单里去掉二者，另加了测试。
- 预览端 agent 在 `htmlPreviewAgent.ts:132` 仍排除 `textarea,title,option,[contenteditable]` 文本节点，真实预览永远不会上报这类目标；`<title>` 在页面里不可见，也点不到。→ 死代码。
- 默认：撤回 locator 的两处改动和新测试。可选（有余力时，GPT 的方案）：只做 textarea——agent 放行 textarea 文本节点 + 真实预览选择的测试，沿用现有源码范围事务；**`title` 不做**，继续用源码修改入口。
- 清单把它写成“`text.replace` 的 target kind”不准确，它是预览编辑定位器；Gemini“扩 `ToolTarget` 联合类型”的建议不采纳（已有 `content.targets` 路径）。

**D2（P3，可选）**
- 事实：`projectDynamicTargets`（`shared/projectDynamicTargets.ts`）里 `resourcesChanged` 是全局标志，任何素材变化让该文档所有 Runtime/Component 实例重新准入；准入超时是“每目标”的；失败后整个 job 失败，模型修后重检（job 级重试是有的）。
- **不得按 `runtime.assets` 绑定裁剪影响范围**：Surface Runtime 公开 `assets.projectUrl(assetId)`（`publishedSurfaceRuntimeMount.ts:593`，`docs/RUNTIME_AUTHORING.md:124`），可访问任意工程素材；布局与共享环境变化也确实改变 Runtime 的可用空间。
- 只可做：把“明确无关的 Component 包变化”限定到引用该包的实例。单目标失败拒绝整个候选是现行“失败不提交半成品”合同，**不加重试链，也不做“降级静态后备”**（Gemini 的建议不采纳）。
- 仅在真实数据显示多页导入的单次 `build.check` 耗时不可接受时才做。

## 7. 不修项及理由（别在这些上花时间）

- **B1**：本地 `<link rel=stylesheet href=a.css integrity=… crossorigin>` 必须内联。
  - 实验（页面 H，Chromium 152）：Published 同款 CSP `style-src 'unsafe-inline'` 下，`<link href=blob:…>` 样式表被拦（`style-src-elem` 违规，link `error`，样式不生效）；加上 `blob:` 才加载。
  - 受管素材类型只有 image/audio/video/font（`assetKind()`），CSS 不在其中；Runtime 载体是 srcdoc/blob，没有可寻址的兄弟文件，CSS 里的 `url()` 也要改写为 `cw-resource:`；内联后 integrity/crossorigin 本就无意义。
  - **远程** `<link>` 原样保留（实测：`https://cdn…/x.css integrity crossorigin` 完整保留，只是会被 CSP 拦）。
  - 要保留本地 `<link>` 必须改 CSP 或素材合同，不在本批。GPT（“保留 link”）与 Gemini（“CSS 当外部素材”）的建议均不采纳。仅警告文案按 §4.3(c) 写准。
- **C4**：`HostToolServices.writableRun()`（`:161`）只是对内存里冻结的 grant 做一次比较，是 Owner 2026-09-24“档位随任务冻结并由主进程强制执行”的执行点。目录过滤只是模型可见性，不等于强制；状态/等待/日志读取走 `builtInRun`，并非每次宿主调用都查写权限。属 AGENTS.md 保留项“实际权限”。
- **C5**：`batchAppend` 的 5000 条上限（`ExecutionEventStore.ts:268`）是“单记录原子写”的有界批。生产唯一批量调用方是 `DisplayEventBuffer`（默认 32KB 上限、相邻同 item 合并，`ExecutionEngine.ts:406`），不可能到 5000；单条 `append` 走 `[input]`。自动分批会破坏单记录原子语义（Gemini 的分批建议不采纳）。
- **D4**：`HtmlActionPageScript.ts:68` 的指纹含 label/value，是防“点错元素”的 UI 版 CAS：已有首尾 trim；标点变化通常是可见内容变化；运行时 DOM 点击目标身份不能由文档 CAS 保护；没有“仅空白变化导致核心流程失败”的样本。弱化成“只看路径 + 标签”会增加点错元素的风险（Gemini 的建议不采纳）。有明确误拒样本时再针对该样本处理。
- **D5**：`EditSessionService` 的 editId 即 toolCallId（`${requestId}:${index}`，`ExecutionEngine.ts:1242`），每次调用唯一；旧编辑组的终态防止迟到分片和回执复活，不是持久化的用户黑名单。清理 `cancelled` 会让迟到分片复活（Gemini 的建议不采纳）；该 Map 的内存增长可忽略，若要治理只能限容量，不能改语义。

## 8. Owner 已裁决（2026-10-03，按评审建议）

1. **导入的拒绝底线**：以下 4 类“输入本身明确是坏的”**仍然拒绝导入**——页面脚本有语法错误；引用的本地文件不存在；图片/资源用了 `http://`；用了本机路径（`file:`）或 `blob:`。拒绝信息必须具体到 AI 一轮能改好。其余一律**放行 + 警告**：产品自己看不懂的写法；AI 一轮改不好的外部依赖（网上的脚本/样式/字体、CDN）。理由：这 4 类 AI 一轮就能改好，放进课件后再发现修补很贵（这类资源没有变成课件素材，“点图换图”认不出，只能重新导入整页或改页面源码）。
2. **页面加载期事件**（`onload`/`onerror`）：**放行 + 警告**（尽力绑定）。拖拽、触摸、悬停、滚轮等交互事件无争议，直接放行。
3. **换图时的多尺寸备用图**：**B**——备用图候选全部改指向新图，保留描述符与 `sizes`；退而求其次 A（移除 + 提示）；不得保留旧候选。
4. **页面程序拆成多个本地文件**（ES 模块依赖图）：**本期不做自动打包**；放行 + 明确提醒“请合并成单文件”。以后真常出现再单独立项。
5. 其它默认（评审建议，未单独请示）：A5 “允许”只管这一次；远程脚本/模块/Worker 继续不开放；B3 默认撤回；D3 不改数值、不加配置。

## 9. 验证与交付

**最小充分验证**（按 AGENTS.md：只跑与本批直接相关、能证伪目标行为的检查，通过后停止；已有有效证据继续复用）：

```bash
npx vitest run tests/integration/g20ExecutionEngine.test.ts tests/integration/g20EditSession.test.ts tests/integration/g20M27RuntimeTextReplace.test.ts tests/integration/g20BodyStreamingCapability.test.ts
npx vitest run tests/unit/g20HtmlImportCore.test.ts tests/unit/g20HtmlImportClosure.test.ts tests/unit/g20M17BenchmarkClosure.test.ts tests/integration/g20HtmlImport.test.ts tests/integration/g20M24HtmlImport.test.ts
npx vitest run tests/integration/g20AgentFileTools.test.ts tests/integration/g20M23HtmlLightEdit.test.ts tests/unit/g20M23HtmlSourceLocator.test.ts
npm run typecheck
```

**按变化给出的验收**（不是新增检查矩阵）：

- **C2**：用一个真实流式 `text.replace` 调用（引擎级测试）证明正式提交、一次撤销和停止行为；不要只跑 Gateway 直测。
- **A5**：证明单次批准能完成该次修改（含“先读后改”）；批准不扩大到后续无关写入；`full` 权限的未变证据继续复用。
- **A2/B2**：选一份代表 HTML，覆盖 `class…constructor`、`opts[i].onclick=…`、`img.src = 变量`、`ondrop`/`ondragover`、本地 `fetch` json、`@import … layer()`、`<head>` 里的 `defer` 脚本、一条 CDN 脚本，证明**导入成功 → 必要资源已进入 → 运行/挂载正常 → 保存 → 重开**。**仅诊断从 error 变 warning 不算通过**；不能以改动数量、检查数量或 warning 数量证明完成。真实 Electron 做不到的，回报里写“未在真实宿主验证”。
- **A3/A4/C3 等小项**：只验证改变的直接属性（对应用例见各节）。
- 不需要新增付费模型调用来证明这些宿主软件行为。

**需要同步改的既有测试**（行为变化所致，先改断言）：`g20M17BenchmarkClosure` / `g20HtmlImportClosure` / `g20HtmlImportCore`（error → warning）、`g20M24HtmlImport`（远程脚本）、`g20M23HtmlLightEdit`（A4）、`g20AgentFileTools`（A3/A5/C1）、`g20M23HtmlSourceLocator`（B3 撤回）；e2e：`tests/e2e/g20HtmlCspCarrier.spec.ts:134`（断言 `onload` 被拒）、`tests/e2e/g20M17HtmlImport.spec.ts:406–430`（断言远程脚本导入被拒并弹 alert）。e2e 先改断言；是否单跑看预算，不能跑就在回报里写“未运行”，不要声称通过。不要跑 `npm test`（`pretest` 会 build player，且是全矩阵）。跑 Playwright 前后用 `git status --short docs` 自查是否覆盖已跟踪证据图。

**已知与本批无关的现状**：
- `npm run check:ai-capabilities` 目前就失败（22:54 实测）：`protocols/component-api4.*`、`runtime-api2.*`、`runtime-api3.*`（各含 `.authoring.md` 与 `.json`）、`discovery.json`、`discovery-data.json` 报“过期”，`skills/data-and-report/SKILL.md`、`skills/research-and-report/SKILL.md` 报“多余”（这两个 SKILL.md 当前已 staged）。不要在本批里处理。
- `file.*` 工具说明不进 AI 能力索引（已核对 `index.json` 不含 `file.write` / `file.copy`）。`check:contracts` 通过。

**行尾**：被改动的源文件是 CRLF（`AgentFileText.ts` 196/196 行、`ExecutionEngine.ts` 2100/2100 行均为 CRLF）。新增/修改行保持 CRLF，避免整文件改行尾。提交前用 `git diff --stat` 自查改动行数是否与实际修改量相当。提交与否听 Owner 指示；本文不要求提交。

**回报格式**（先报告实际结果，每项一段）：
1. 哪些原问题已经消除。
2. 哪些仍未修（及原因）。
3. 哪些保持现有边界（及依据）。
4. 本次直接验证证明了什么（命令 + 原样粘贴关键输出）。
5. 哪些运行或性能结论仍缺证据。
6. 与本文不一致之处（以源码为准并说明）。

另外把 §10 脚本在修后的输出贴回来：
- 脚本 B：FIX 组应全部变为 PASS（`@import layer()` 的运行时 HTML 应为 `@layer base{…}` 包裹的内联样式）；KEEP 组保持原状；OK 组保持 PASS。
- 脚本 C：全部事件应为“可挂载”。
- 脚本 D：保持原样（它证明“只删 guard 不够”，窄方案不依赖它）。
- 脚本 E：A3 不传 kind 应成功；`utf-8` 不再存在；A5 在你的实现里应 applied。
- 页面 F：改写后各形态的 `currentSrc` 均为新图。

## 10. 附：探针脚本与实验页

脚本均在仓库根目录用 `node_modules/.bin/tsx <文件>` 运行；脚本放在仓库之外（如临时目录），避免污染工作树。路径写死为 `D:/果铃工作台/`，仓库移动时请改。

### 脚本 A：C2（Gateway 直调 vs 引擎流式第一步）

```ts
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
const R = 'D:/果铃工作台/'
const imp = (p: string) => import(pathToFileURL(R + p).href)
const { DocumentRegistry } = await imp('src/core/documents/DocumentRegistry.ts')
const { CourseV9Driver } = await imp('src/core/drivers/CourseV9Driver.ts')
const { MarkdownDriver } = await imp('src/core/drivers/MarkdownDriver.ts')
const { TextDriver } = await imp('src/core/drivers/TextDriver.ts')
const { DocumentToolGateway } = await imp('src/core/tools/DocumentToolGateway.ts')
const { prepareImageResource } = await imp('src/main/workbench/admittedImageResource.ts')
const { EditSessionService } = await imp('src/main/workbench/execution/EditSessionService.ts')

const md = new MarkdownDriver(), text = new TextDriver(), course = new CourseV9Driver()
let sequence = 0
const registry = new DocumentRegistry({ persistence: { async append() {}, async save() { throw new Error('no save') } } as any,
  drivers: [md, course, text], createId: () => `id-${++sequence}`, bindingKey: (b: any) => b.path })
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
let fb = 0
const gateway = new DocumentToolGateway(registry, [md, course, text], () => String(++sequence), {
  prepareImage: prepareImageResource,
  dynamicContentFallback: { async capture() { fb++; const id = `fb-${fb}`
    return { asset: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image', path: `assets/${id}.png`, byteLength: PNG.byteLength, width: 1, height: 1 }, bytes: PNG } } },
})

/** 新建 run，发现 Runtime 对象的 content.targets，返回第一个文字目标的短句柄（形如 c4）。 */
async function freshRuntimeTextHandle(runId: string): Promise<string> {
  const model = course.load(new Uint8Array(readFileSync(R + 'tests/fixtures/course-project-v9/surface-runtime.h5lesson')))
  const created = await registry.create(model, runId + '.h5lesson')
  await gateway.beginRun({ runId, actor: 'agent', documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }] })
  const object = await gateway.issueTarget(runId, created.documentId, { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-surface-runtime' })
  const found = await gateway.execute(runId, 'discover', { name: 'content.targets', input: { target: object } })
  if (found.kind !== 'read') throw new Error('discovery failed ' + JSON.stringify(found))
  return ((found.data as any).targets as Array<{ target: string; kind: string; text?: string }>).find(v => v.kind === 'text' && v.text !== undefined)!.target
}

// A) Gateway 直调——M27 单测走的路径
const a = await freshRuntimeTextHandle('rA')
const direct: any = await gateway.execute('rA', 'replace-title', { name: 'text.replace', input: { target: a, content: '新标题' } })
console.log('[Gateway 直调 text.replace]', direct.kind, direct.result?.status)

// B) 引擎流式回合的第一步：ExecutionEngine.preview() → edits.begin()
const b = await freshRuntimeTextHandle('rB')
try { await new EditSessionService(registry, gateway as any).begin({ editId: 'call-1', toolCallId: 'call-1', runId: 'rB', targetHandle: b }); console.log('[edits.begin] OK') }
catch (e: any) { console.log('[edits.begin] 被拒  code=%s  message=%s', e?.code, e?.message) }
// 实测输出：
//   [Gateway 直调 text.replace] document-operation applied
//   [edits.begin] 被拒  code=invalid-target  message=目标句柄不存在或不属于此任务
```

### 脚本 B：HTML 导入矩阵（提取层 + prepare 层）

```ts
// 每个用例跑两层：extract = 提取层（extractHtmlResources + validateHtmlImport 的 error 码）；
// prepare = 完整 prepareHtmlCourseCandidate（含素材分类、Schema、归档校验）。
import { pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const R = 'D:/果铃工作台/'
const imp = (p: string) => import(pathToFileURL(R + p).href)
const { extractHtmlResources } = await imp('src/main/workbench/htmlImport/extractHtmlResources.ts')
const { validateHtmlImport } = await imp('src/main/workbench/htmlImport/validateHtmlImport.ts')
const { prepareHtmlCourseCandidate } = await imp('src/main/workbench/htmlImport/prepareHtmlCourseCandidate.ts')
const { unpackHtmlDocumentRuntimeSource } = await imp('src/shared/runtime/htmlDocumentSource.ts')
const { DocumentRegistry } = await imp('src/core/documents/DocumentRegistry.ts')
const { CourseV9Driver } = await imp('src/core/drivers/CourseV9Driver.ts')
const { MarkdownDriver } = await imp('src/core/drivers/MarkdownDriver.ts')
const { TextDriver } = await imp('src/core/drivers/TextDriver.ts')

const md = new MarkdownDriver(), text = new TextDriver(), course = new CourseV9Driver()
let sequence = 0
const registry = new DocumentRegistry({ persistence: { async append() {}, async save() { throw new Error('x') } } as any, drivers: [md, course, text], createId: () => `id-${++sequence}`, bindingKey: (b: any) => b.path })
const snapshot = (await registry.create(course.load(new Uint8Array(readFileSync(R + 'tests/fixtures/course-project-v9/surface-runtime.h5lesson'))), 'p.h5lesson')).read()

const dir = mkdtempSync(path.join(tmpdir(), 'html-import-matrix-'))
const lib = (p: string) => existsSync(R + 'node_modules/' + p) ? readFileSync(R + 'node_modules/' + p) : Buffer.from('/*missing*/')
const files: Record<string, Buffer | string> = {
  'a.js': 'window.__a=1;', 'mod.js': 'export const x=1;', 'a.css': 'body{color:red}', 'a.vtt': 'WEBVTT\n',
  'x.avif': Buffer.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0]),
  'd3.js': lib('d3/dist/d3.min.js'), 'lodash.js': lib('lodash/lodash.min.js'),
}
for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(dir, name), bytes)
const siblings = new Map(Object.entries(files).map(([name, bytes]) => [name, new Uint8Array(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)]))

// 分组：OK=现在就应端到端通过（保持）；FIX=应改为“放行 + 警告”；KEEP=Owner 已裁决仍拒绝（须给出具体原因）
type Group = 'OK' | 'FIX' | 'KEEP'
const cases: Array<[Group, string, string, RegExp?]> = [
  ['OK', 'module + 本地 import（仅警告，运行时无法解析）', '<script type="module">import {x} from "./mod.js"; document.title=String(x)</script>'],
  ['OK', '<script type=module src=本地>', '<script type="module" src="mod.js"></script>'],
  ['OK', 'defer 本地外部脚本（语义见 4.3(h)）', '<head><script defer src="a.js"></script></head><body><p id="x">hi</p></body>', /<script[^>]*>[\s\S]*?<\/script>/],
  ['OK', 'async 本地外部脚本', '<script async src="a.js"></script><p>hi</p>'],
  ['OK', 'fetch 相对 json', '<script>fetch("q.json").then(r=>r.json())</script>'],
  ['OK', 'new Worker', '<script>new Worker(URL.createObjectURL(new Blob(["1"])))</script>'],
  ['OK', 'XMLHttpRequest', '<script>var x=new XMLHttpRequest();x.open("GET","q.json");x.send()</script>'],
  ['OK', 'iframe https', '<iframe src="https://www.youtube.com/embed/abc"></iframe>'],
  ['OK', '静态 onClick 属性', '<button onClick="go()">go</button><script>function go(){}</script>'],
  ['OK', 'setAttribute 动态属性名', '<script>["src","x"].forEach(n=>document.body.setAttribute("data-"+n,"u"))</script>'],
  ['OK', 'Google Fonts link', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto"><p>hi</p>'],
  ['OK', 'Tailwind CDN script', '<script src="https://cdn.tailwindcss.com"></script><p class="p-4">hi</p>'],
  ['OK', 'data: 脚本', '<script src="data:text/javascript,window.q=1"></script>'],
  ['OK', 'img avif', '<img src="x.avif">'],
  ['OK', '拖拽等内联事件属性（导入过；挂载失败见脚本 C）', '<div draggable="true" ondragstart="d(event)" ondrop="p(event)" ondragover="event.preventDefault()">x</div><script>function d(){} function p(){}</script>'],
  ['OK', '@import 普通（对照：已内联）', '<style>@import url("a.css"); p{color:blue}</style><p>hi</p>', /<style[^>]*>[\s\S]*?<\/style>/],
  ['OK', 'link stylesheet 本地（对照：已内联）', '<link rel="stylesheet" href="a.css"><p>hi</p>', /<style[^>]*>[\s\S]*?<\/style>/],
  ['FIX', 'modulepreload 本地 js（prepare 层整份失败）', '<link rel="modulepreload" href="mod.js"><p>hi</p>'],
  ['FIX', 'preload as=script 本地 js（prepare 层整份失败）', '<link rel="preload" as="script" href="a.js"><p>hi</p>'],
  ['FIX', '@import layer() 本地 css（导入过但 css 没打包）', '<style>@import url("a.css") layer(base); p{color:blue}</style><p>hi</p>', /<style[^>]*>[\s\S]*?<\/style>/],
  ['FIX', 'track 本地 vtt（非受管素材）', '<video><track src="a.vtt" kind="captions"></video>'],
  ['FIX', 'class + constructor', '<script>class A{constructor(){this.x=1}} new A()</script>'],
  ['FIX', 'class extends + super', '<script>class B{} class A extends B{constructor(){super()}} new A()</script>'],
  ['FIX', 'x.constructor', '<script>var a=[]; if(a.constructor===Array){document.title="x"}</script>'],
  ['FIX', 'el.style[prop]=v', '<script>function s(el,p,v){el.style[p]=v} s(document.body,"color","red")</script>'],
  ['FIX', 'opts[i].onclick=（quiz 常见）', '<script>const o=document.querySelectorAll(".o");for(let i=0;i<o.length;i++){o[i].onclick=()=>{o[i].classList.add("on")}}</script>'],
  ['FIX', 'el.dataset[k]', '<script>function f(el,k){return el.dataset[k]} f(document.body,"a")</script>'],
  ['FIX', 'obj[key]（参数）', '<script>function get(o,k){return o[k]} get({a:1},"a")</script>'],
  ['FIX', 'eval', '<script>eval("1+1")</script>'],
  ['FIX', 'new Function', '<script>const f=new Function("return 1"); f()</script>'],
  ['FIX', 'Object.getOwnPropertyDescriptor', '<script>Object.getOwnPropertyDescriptor({a:1},"a")</script>'],
  ['FIX', 'Reflect.ownKeys', '<script>Reflect.ownKeys({a:1})</script>'],
  ['FIX', '解构 style', '<script>const {style}=document.body; style.color="red"</script>'],
  ['FIX', '动态 URL：img.src = 变量', '<script>function f(img,u){ img.src = u }</script>'],
  ['FIX', '动态 URL：audio.src = 数组项', '<script>const a=["1.mp3","2.mp3"]; const au=new Audio(); let i=0; au.src=a[i]</script>'],
  ['FIX', '动态 URL：style.backgroundImage = url(+变量)', '<script>function f(el,v){ el.style.backgroundImage = "url(" + v + ")" }</script>'],
  ['FIX', '本地内联 d3', '<script src="d3.js"></script>'],
  ['FIX', '本地内联 lodash', '<script src="lodash.js"></script>'],
  ['KEEP', '脚本语法错误', '<script>function (</script>'],
  ['KEEP', '缺失的本地图片', '<img src="missing.png">'],
  ['KEEP', '缺失的本地脚本', '<script src="nope.js"></script>'],
  ['KEEP', 'http:// 图片', '<img src="http://example.com/a.png">'],
  ['KEEP', 'http:// iframe', '<iframe src="http://example.com/embed"></iframe>'],
  ['KEEP', 'CSS background http://', '<style>body{background:url(http://example.com/a.png)}</style>'],
  ['KEEP', 'file:/// 图片', '<img src="file:///C:/a.png">'],
  ['KEEP', 'blob: 图片', '<img src="blob:https://example.com/abc">'],
]
const payloadHtml = (candidate: any): string => {
  let found = ''
  const walk = (v: any) => { if (!v || typeof v !== 'object' || found) return
    if (v.kind === 'runtime' && v.runtime?.source) { found = unpackHtmlDocumentRuntimeSource(v.runtime.source)?.html ?? ''; return }
    for (const x of Object.values(v)) walk(x) }
  walk(candidate.model.project.surfaces)
  return found
}
for (const [group, label, html, show] of cases) {
  const extractErrors = [...new Set((validateHtmlImport(extractHtmlResources({ html, siblingFiles: siblings })) as Array<{ level: string; code: string }>).filter(d => d.level === 'error').map(d => d.code))]
  writeFileSync(path.join(dir, 't.html'), html)
  let prepare = 'PASS', snippet = ''
  try {
    const candidate = await prepareHtmlCourseCandidate({ snapshot, sourcePath: path.join(dir, 't.html'), rootDir: dir, sourceHtml: html, locationId: 'location-scene-1' })
    if (show) snippet = (payloadHtml(candidate).match(show)?.[0] ?? '').replace(/\s+/g, ' ').slice(0, 140)
  } catch (e: any) { prepare = 'FAIL: ' + String(e.message ?? e).replace(/\n/g, ' / ').slice(0, 70) }
  console.log(`${group.padEnd(4)} extract=${extractErrors.length ? 'REJECT[' + extractErrors + ']' : 'ok'}  prepare=${prepare}  | ${label}${snippet ? '\n       运行时 HTML → ' + snippet : ''}`)
}
rmSync(dir, { recursive: true, force: true })
process.exit(0)
// 00:24 实测：OK 组全部 PASS；
//   FIX 组：modulepreload / preload / track 为 prepare FAIL（text/javascript、application/octet-stream）；@import layer() PASS 但运行时 HTML 仍是相对 @import；
//           其余（class constructor、动态 URL、本地内联库等）extract=REJECT[unsupported-dynamic-url-sink]、prepare FAIL；
//   KEEP 组全部 FAIL，信息已具体（找不到相对资源 missing.png / 远程资源需要 HTTPS / 不支持资源协议 file:… / 脚本无法解析: SyntaxError …）。
```

### 脚本 C：运行时包装的内联事件（jsdom）

```ts
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const { JSDOM } = createRequire('D:/果铃工作台/package.json')('jsdom')
const { createHtmlDocumentRuntimeSource } = await import(pathToFileURL('D:/果铃工作台/src/shared/runtime/htmlDocumentSource.ts').href)
const w = new JSDOM('<!doctype html><body></body>').window as any
;(globalThis as any).DOMParser = w.DOMParser
const events = ['click', 'keydown', 'drop', 'dragover', 'dragstart', 'touchstart', 'wheel', 'mouseenter', 'mouseleave',
  'contextmenu', 'scroll', 'pointermove', 'ended', 'play', 'error', 'load']
for (const name of events) {
  const source = createHtmlDocumentRuntimeSource({ html: `<!doctype html><html><body><div id="a" on${name}="x()">t</div></body></html>`, resourceKeys: [] })
  let definition: any
  new Function('CoursewareRuntime', source)({ define: (d: any) => { definition = d } })
  const root = w.document.body
  try {
    const lifecycle = definition.create({ dom: { root }, assets: { url: () => '' }, capture: { waitUntil: (p: Promise<unknown>) => { p?.catch?.(() => {}) } } })
    lifecycle.destroy()
    console.log(`on${name.padEnd(11)} 可挂载`)
  } catch (e: any) { console.log(`on${name.padEnd(11)} create() 抛错：${e.message}`) }
  root.innerHTML = ''
}
process.exit(0)
// 00:24 实测：仅 click、keydown 可挂载；其余 14 个全部抛“HTML 页面不支持内联事件：…”。修后应全部可挂载。
```

### 脚本 D：A5——只删 guard 不够（已只读挂载的文档不能被 `attachRunDocument(true)` 升级）

```ts
import { pathToFileURL } from 'node:url'
const R = 'D:/果铃工作台/'
const imp = (p: string) => import(pathToFileURL(R + p).href)
const { DocumentRegistry } = await imp('src/core/documents/DocumentRegistry.ts')
const { CourseV9Driver } = await imp('src/core/drivers/CourseV9Driver.ts')
const { MarkdownDriver } = await imp('src/core/drivers/MarkdownDriver.ts')
const { TextDriver } = await imp('src/core/drivers/TextDriver.ts')
const { DocumentToolGateway } = await imp('src/core/tools/DocumentToolGateway.ts')
const md = new MarkdownDriver(), text = new TextDriver(), course = new CourseV9Driver()
let sequence = 0
const registry = new DocumentRegistry({ persistence: { async append() {}, async save() { throw new Error('no save') } } as any,
  drivers: [md, course, text], createId: () => `id-${++sequence}`, bindingKey: (b: any) => b.path })
const gateway = new DocumentToolGateway(registry, [md, course, text], () => String(++sequence), {})
for (const readFirst of [false, true]) {
  const runId = readFirst ? 'rRead' : 'rNoRead'
  const created = await registry.create({ kind: 'text', source: 'hello world', resources: { assets: {}, components: {} } }, `${runId}.txt`)
  await gateway.beginRun({ runId, actor: 'agent', documents: [] } as any)
  if (readFirst) await gateway.attachRunDocument(runId, created.documentId, false)   // file.read / file.open 对工作空间外已打开文件的挂载
  const upgraded = await gateway.attachRunDocument(runId, created.documentId, true)   // AgentFileText.commit() 的挂载
  const target = await gateway.issueTarget(runId, created.documentId, { kind: 'markdown-range', from: 0, to: 5 })
  const result: any = await gateway.execute(runId, 'op-' + runId, { name: 'text.replace', input: { target, content: 'HELLO' } })
  console.log(`先 file.read=${readFirst}  attach(true) 返回=${upgraded}  text.replace ->`, result.kind, result.kind === 'error' ? `${result.code}: ${result.message}` : result.result?.status)
}
process.exit(0)
// 实测：
//   先 file.read=false  attach(true) 返回=true   text.replace -> document-operation applied
//   先 file.read=true   attach(true) 返回=false  text.replace -> error not-authorized: 目标不在本次任务的可写范围
```

### 脚本 E：A3（`file.create` 的 kind）+ A5（窄方案原型）

```ts
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, stat, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
const R = 'D:/果铃工作台/'
const imp = (p: string) => import(pathToFileURL(R + p).href)
const { DocumentHostService } = await imp('src/main/workbench/DocumentHostService.ts')
const { AgentFileService } = await imp('src/main/workbench/execution/AgentFileService.ts')

const root = await mkdtemp(path.join(tmpdir(), 'probe-a3a5-'))
const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
await mkdir(workspace); await mkdir(outside)
await writeFile(path.join(outside, 'external.md'), '外部正文 hello')
const host = new DocumentHostService(path.join(root, 'journal'))
const files = new AgentFileService(host)
const context: any = { runId: 'run', workspaceRoot: workspace, permission: 'workspace' }
const attempt = async (label: string, fn: () => Promise<any>) => {
  try { const r = await fn(); console.log(label, '-> OK'); return r }
  catch (e: any) { console.log(label, '-> 抛错：', String(e.message ?? e).slice(0, 120)) }
}
const size = async (p: string) => (await stat(p).catch(() => null))?.size

console.log('===== A3：file.create =====')
await attempt('不传 kind：{name:"data.json"}', () => files.execute(context, 'file.create', { name: 'data.json' }, 'c1'))
await attempt('kind:"text"：{name:"data2.json"}', () => files.execute(context, 'file.create', { name: 'data2.json', kind: 'text' }, 'c2'))
await attempt('kind:"utf-8"：{name:"x.h5lesson"}', () => files.execute(context, 'file.create', { name: 'x.h5lesson', kind: 'utf-8' }, 'c3'))
console.log('   磁盘上 x.h5lesson 字节数 =', await size(path.join(workspace, 'x.h5lesson')), '（0 字节 = 坏的课件文件）')
await attempt('kind:"utf-8"：{name:"pic.png"}', () => files.execute(context, 'file.create', { name: 'pic.png', kind: 'utf-8' }, 'c4'))
console.log('   磁盘上 pic.png 字节数 =', await size(path.join(workspace, 'pic.png')))

console.log('===== A5：workspace 档 + 工作空间外 + 已打开 + 已批准 =====')
const external = path.join(outside, 'external.md')
const snap = await host.open(external)                       // 文件“已在工作台打开”
await host.tools.beginRun({ runId: 'run', actor: 'agent', documents: [] } as any)
const approved: any = { ...context, approvedOutsidePaths: [external] }
await attempt('现状 file.write replace', () => files.execute(approved, 'file.write', { mode: 'replace', path: external, content: 'NEW' }, 'w1'))

console.log('===== 窄方案原型：经 DocumentSession 一次性提交（不改 run 授权）=====')
const session = host.registry.get(snap.documentId)
const cur = session.read()
const base = { documentId: cur.documentId, epoch: cur.epoch, actor: 'agent' as const, runId: 'run' }
const ok: any = await session.execute({ ...base, operationId: 'direct-1', baseRevision: cur.revision,
  mutation: { type: 'command', command: { type: 'markdown.replace', source: 'NEW-DIRECT' } } })
const after: any = session.read()
console.log('提交 ->', ok.status, '| source =', JSON.stringify(after.model.source), '| undoHead =', JSON.stringify(after.undoHead))
const stale: any = await session.execute({ ...base, operationId: 'direct-2', baseRevision: cur.revision,
  mutation: { type: 'command', command: { type: 'markdown.replace', source: 'STALE' } } })
console.log('旧 baseRevision 再提交 ->', stale.status, stale.code ?? '')
const undone: any = await session.execute({ documentId: cur.documentId, epoch: cur.epoch, operationId: 'undo-1', baseRevision: after.revision, actor: 'human',
  mutation: { type: 'undo', expectedTopOperationId: 'direct-1' } })
console.log('撤销 ->', undone.status, '| source =', JSON.stringify((session.read().model as any).source))
await rm(root, { recursive: true, force: true, maxRetries: 5 }).catch(() => {})
process.exit(0)
// 00:24 实测：
//   不传 kind -> 抛错：文件名与markdown格式不符；kind:"text" -> OK；kind:"utf-8" 的 x.h5lesson / pic.png -> OK 且磁盘 0 字节
//   现状 file.write replace -> 抛错：已打开的工作空间外文档需取得正式文档写授权，单次文件批准不会扩大后续文档权限
//   提交 -> applied | undoHead = {"operationId":"direct-1","actor":"agent"}；旧 baseRevision -> conflict stale-revision；撤销 -> applied
```

### 页面 F：A4（`src` 与 `srcset` 并存时到底显示哪张图）

存成 `srcset-test.html`，用任意静态服务器打开（如 `python -m http.server`），页面自己把结果写进 `<pre>`。图片地址是占位域名，无需真的加载：`currentSrc` 在选图时就已确定。

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>srcset vs src</title></head>
<body>
<img id="a" src="https://example.test/new.png" srcset="https://example.test/old1.png 1x, https://example.test/old2.png 2x" sizes="80vw">
<img id="b" src="https://example.test/new.png" srcset="https://example.test/old1.png 400w, https://example.test/old2.png 800w" sizes="80vw">
<img id="c" src="https://example.test/new.png">
<picture><source srcset="https://example.test/old-source.webp"><img id="d" src="https://example.test/new.png"></picture>
<img id="e" src="https://example.test/new.png" srcset="https://example.test/old2.png 2x">
<pre id="out"></pre>
<script>setTimeout(() => { document.getElementById('out').textContent = [...document.images].map(i => i.id + ' -> ' + (i.currentSrc || '(空)')).join('\n') }, 600)</script>
</body></html>
<!-- Chromium 152 实测：a -> old1.png；b -> old1.png；c -> new.png；d -> old-source.webp；e -> new.png。
     按裁决 B 改写后（把 srcset/source 候选 URL 全换成新图），a、b、d 应均为新图。 -->
```

### 页面 G：早期事件（`body onload`、图片 `onload`/`onerror`）在产品的 blob 脚本绑定方式下是否触发

同样用静态服务器打开。它模拟包装层：内联事件属性被摘掉，改由一个 blob 脚本在解析期绑定。

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>early events</title></head>
<body>
<pre id="out"></pre>
<script>
const log = window.__log = [];
const handlerCode = `
  document.body.onload = function () { parent.__log.push('body.onload 触发'); };
  var bad = document.getElementById('bad'); if (bad) bad.onerror = function () { parent.__log.push('img(加载失败的图).onerror 触发'); };
  var ok = document.getElementById('ok'); if (ok) ok.onload = function () { parent.__log.push('img(脚本之前的图).onload 触发'); };
  var ok2 = document.getElementById('ok2'); if (ok2) ok2.onload = function () { parent.__log.push('img(脚本之后的图).onload 触发'); };
  parent.__log.push('处理器已绑定');
`;
const url = URL.createObjectURL(new Blob([handlerCode], { type: 'text/javascript' }));
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const html = `<!doctype html><html><head></head><body>
<img id="ok" src="${gif}">
<img id="bad" src="https://example.invalid/missing.png">
<p>hello</p>
<script src="${url}"><\/script>
<img id="ok2" src="${gif}">
</body></html>`;
const frame = document.createElement('iframe');
frame.srcdoc = html;
document.body.appendChild(frame);
setTimeout(() => { document.getElementById('out').textContent = log.join('\n') }, 3000);
</script>
</body></html>
<!-- Chromium 152 实测日志：处理器已绑定 / img(脚本之前的图).onload 触发 / img(加载失败的图).onerror 触发 / body.onload 触发。
     “脚本之后的图”未绑定是本测试只绑一次所致（该元素在绑定脚本执行时还不存在）；正式包装层会在 body 末尾再补一次绑定。 -->
```

### 页面 H：B1（Published 同款 CSP 下，本地 CSS 变成 `blob:` 样式表还能不能生效）

同样用静态服务器打开。页面里的 CSP 与 Published 单 HTML 的 `style-src 'unsafe-inline'` 相同。

```html
<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'">
<title>blob 样式表 vs Published CSP</title></head>
<body><p id="p">hello</p><pre id="out"></pre>
<script>
const results = {};
document.addEventListener('securitypolicyviolation', e => { (results.violations ||= []).push(e.violatedDirective + ' <- ' + e.blockedURI.slice(0, 24)) });
const url = URL.createObjectURL(new Blob(['p#p{color:rgb(255,0,0)}'], { type: 'text/css' }));
const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url;
link.onload = () => { results.linkEvent = 'load' }; link.onerror = () => { results.linkEvent = 'error' };
document.head.appendChild(link);
setTimeout(() => { results.color = getComputedStyle(document.getElementById('p')).color; document.getElementById('out').textContent = JSON.stringify(results, null, 1) }, 600);
</script></body></html>
<!-- Chromium 152 实测：style-src 'unsafe-inline' → violations ["style-src-elem <- blob"]，linkEvent "error"，color rgb(0, 0, 0)（样式被拦）；
     把 style-src 改成 'unsafe-inline' blob: 后 → linkEvent "load"，color rgb(255, 0, 0)。 -->
```

## 11. 附录：GPT / Gemini 两份评估的采纳与驳回（避免重复争论）

**采纳（已核实并写入正文）**

| 来源 | 内容 | 我的核实 |
|---|---|---|
| GPT | 清单是 18 项，不是 19 | A5+B3+C5+D5 = 18 |
| GPT | 本地 `modulepreload` 的衔接缺口 | 提取层 ok，prepare 抛“HTML 资源类型暂不能作为受管素材导入：text/javascript”（§4.1、§4.3(e)） |
| GPT | `@import … layer()/supports()` 本地依赖没进资源闭包 | 实测运行时 HTML 仍是相对 `@import`；警告文案“由宿主异步加载”是错的（§4.3(g)） |
| GPT | `defer/async` 调度语义丢失 | 导入器保留属性 + 包装层 `:64` 清除（§4.3(h)） |
| GPT | 本地模块依赖保留后不会运行 | 实测原句保留，blob 基址解析不了（§4.3(i)） |
| GPT | 远程脚本/模块/Worker 本轮不开放；fetch/WebSocket 已是正式能力 | `ARCHITECTURE_CONTRACT.md:68–69`（§1） |
| GPT | A5 窄方案：一次批准只管这一次，经 DocumentSession 完成，不转成 run 的永久写权限 | 原型验证：applied、可撤销、CAS 有效（§5） |
| GPT | C3 取快照前等正式提交队列、保留读取权限与停止语义 | §6 |
| GPT | D1 只有一处明确重复（Component 包解析后 `syntax()` 再校验） | `importComponentPackage.ts:240` 与 `ControlledBuildService.ts:246/260` |
| GPT | D2 不能按 `runtime.assets` 裁剪（`projectUrl`） | `publishedSurfaceRuntimeMount.ts:593` |
| GPT | D3 数值需说明；超 400 要明确提示；20s 是看门狗、另有绝对上限 | `dynamicAdmission.ts`；两个 registry 的静默 `break` |
| GPT | C1 默认磁盘复制不静默保存；`flushFirst` 仅是清理项 | §6 |
| GPT | 验收不以 warning 数量为准；C2 验收含一次撤销与停止；不需新增付费调用 | §9 |
| Gemini | A3：schema 默认 kind 仍是 markdown，不传 kind 建 `.json` 仍失败 | 实测抛“文件名与markdown格式不符”（§5） |
| Gemini | A2：动态 URL 赋值（`extractHtmlResources.ts:700`）仍整份拒绝 | 实测 `img.src = u`、`audio.src = a[i]`、`style.backgroundImage` 均 prepare 失败；但只改这一处不够（§4.3(a)） |

**不采纳（附依据）**

| 来源 | 建议 | 依据 |
|---|---|---|
| GPT | A3、A4“已修，不重复派工” | A3：`utf-8` 建出 0 字节 `.h5lesson`/`.png`，且不传 kind 仍失败；A4：Chromium 实测保留 srcset 则新图不显示（§5） |
| GPT | B1“保留本地 CSS 的 link” | Published 同款 CSP 下 blob 样式表被拦；CSS 不是受管素材类型（§7） |
| GPT | A2 引用的 `networks` 仍进 `capabilityErrors` | 已过时：22:38 已拆成 `networkCalls`，fetch/Worker/XHR 实测放行；但“下游仍整份拒绝”成立 |
| GPT | B3“locator 只收普通 text token” | 已过时：工作树的 `directTextTokens` 已按 `raw-text` 取 title/textarea；真正缺的是预览 agent 端（§6） |
| GPT | 优先级全是 P1/P2（“没有证据支持 P0”） | C2 已复现；但同意 P 档仅表示顺序（§0） |
| Gemini | A5：放宽 `commit()` 的 guard，并改 `file.open` 的 `writable` | 先读后改时仍 `not-authorized`（脚本 D）；改 `writable` 会让后续文档级写绕过批准 |
| Gemini | B1：废除内联，CSS 当外部素材；B2：外部 JS 保持引用原貌 | 运行时没有兄弟文件；CSP 拦 blob 样式表；受管素材不含 CSS/JS |
| Gemini | B3：扩 `ToolTarget` 联合类型；C2：扩 `EditTarget` 做 Runtime 流式预览 | 已有 `content.targets` 路径；缺口在预览旁路，不在目标类型；Runtime 文字没有流式投影，那是新平台 |
| Gemini | C5：`batchAppend` 内部自动分批 | 破坏单记录原子语义；生产批量受 32KB 缓冲限制 |
| Gemini | D1：`validateRuntimeSource` 加 Hash/Map 缓存 | 新增共享状态；实测 12–26ms/270KB，且分属不同进程 |
| Gemini | D2：单实例失败降级静态后备、不杀 BuildJob | 违反“失败不提交半成品”合同 |
| Gemini | D3：视口按需收集、超时弹“是否继续等待/降级导入” | 新能力；只需超限提示（§6） |
| Gemini | D4：弱化指纹，路径命中即放行 | 指纹是 DOM 目标身份校验；无失败样本（§7） |
| Gemini | D5：清理 `cancelled`，允许复用 editId | 会让迟到分片/回执复活；editId 单次使用（§7） |
| Gemini | C3“1ms 拖长到上百毫秒”、D1“严重拖慢”等数字 | 未测量，不得写进说明；我的实测见各节 |
| Gemini | 把 C2 放到第二批 | C2 阻断已宣布完成的 M27 能力，应最先做 |
