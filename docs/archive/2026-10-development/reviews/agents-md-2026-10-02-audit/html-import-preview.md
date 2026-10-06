> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../../development-plan/CURRENT_STATUS.md)。

# HTML导入与preview 审计报告（AGENTS.md 2026-10-02 原则违反）

来源：子智能体只读审计；运行 ID：ad738295a5f3fff6a

I have enough evidence. Here is my audit report.

---

# 过度设计审计报告：`src/main/workbench/tools/` 与 `src/main/workbench/preview/`

注：仓库根下没有 `src/main/workbench/tools/` 子目录；AI 工具实际位于 `src/main/workbench/execution/`、`htmlImport/`、`htmlPreview/`、`observation/`、`build/`。下文按"文档/工具/Preview 边界"的实际目录审计。所有行号与代码片段直接来自源文件。

按 AGENTS.md §"软件职责/不过度设计/一致性的现实边界"对照，按严重度从高到低列出。

---

## A. 完全拒绝用户合理场景（最严重）

### A1. HTML 导入对远程脚本和 modulepreload 一概否决 —— 违反"导入优先让内容成功进入"
**文件**：`src/main/workbench/htmlImport/extractHtmlResources.ts`
- L1063 `addDiagnostic(sink, 'error', 'script-order', '外部脚本 defer/async 顺序无法保持')`
- L1065 `addDiagnostic(sink, 'error', 'remote-script', `远程脚本不可导入: ${...}`)`
- L1066 `addDiagnostic(sink, 'error', 'unsupported-script-source', 'data URI 脚本源暂不支持安全内联')`
- L1031 `addDiagnostic(sink, 'error', 'unsupported-module-graph', '导入暂不支持 modulepreload 依赖图')`
- L780 `addDiagnostic(sink, 'error', 'unsupported-network-sink', `导入暂不支持脚本网络/动态加载: ${name}`)` —— 包括 `fetch`、`importScripts`、`WebSocket`、`EventSource`、`Worker/XMLHttpRequest/sendBeacon`

**违背原则**：AGENTS.md §"导入检查只承担实际解析、正确保存/重开、资源引用和载体运行所必需属性；不要用保守静态猜测拒绝普通数据、答题逻辑或动态效果"。
**用户视角**：AI 写出一份带 Tailwind CDN、Chart.js CDN、Google Fonts、`fetch` 调取题库 JSON、动态小部件（Worker）、或常规 Vite 打包产物（带 modulepreload）的 HTML 讲义，**直接整体导入失败、错误扔回给模型重试**。当前 Runtime 宿主在浏览器/iframe 里跑，这些脚本本身可以保真带入并在宿主中执行；仅以"重写闭包不可静态证明"就拒绝整份可用内容，是诊断门冒充失败门。此类 HTML 是模型生成课件的最常见形态之一。

### A2. CSS @import 的 layer/supports 条件直接报错
**文件**：`extractHtmlResources.ts` L471 / L475 / L483
```
addDiagnostic(sink, 'error', 'unsupported-css-import', 'CSS @import 的 layer()/supports() 条件暂不支持')
addDiagnostic(sink, 'error', 'css-import-cycle', `CSS @import 循环: ${key}`)
```
**违背原则**：同上。@import 是合法 CSS，宿主 iframe 完全支持原地保留 `@import` 让浏览器异步加载（或在导入时按"@media"内联替换）。L489 已经把其它 @import 转写为 `@media{...}` 内联 wrapping，却唯独对 layer()/supports() 报错。
**用户视角**：模型给的 Bootstrap/Tailwind 主题样式（layer 是当今 CSS 标准做法）整页导入失败。

### A3. iframe / object / embed / meta refresh / base 完全拒绝导入
**文件**：`extractHtmlResources.ts` L1007–L1009
```
if (['base', 'iframe', 'object', 'embed'].includes(tag.name)) addDiagnostic(sink, 'error', 'unsupported-html-capability', `导入暂不支持 <${tag.name}>`)
if (tag.name === 'meta' && /refresh/i.test(...)) addDiagnostic(sink, 'error', 'unsupported-html-capability', '导入暂不支持 meta refresh')
```
**违背原则**：§"局部不支持或可修复缺口提供清楚诊断和后续修复入口，不据此拒绝整份可用内容，也不静默静态化"。
**用户视角**：用户做的课件很合理地要在 slide 里嵌个视频/Bilibili 嵌入播放器/Geogebra 嵌入，模型按用户意愿生成 `<iframe>`，整份 HTML 直接入口拒绝。可降级方案（保留 iframe 但禁用其网络）从未尝试——直接给出 `error` 让 service 整票 throw（`prepareHtmlCourseCandidate.ts` L68–70）。

### A4. remote stylesheet / remote font 一概拒绝（remote media 却给了 pass）
**文件**：`remoteHtmlReferences.ts` L21–L28
```
if (reference.usage === 'image' || reference.usage === 'media') { ... 'remote-media-preserved' ... }
return { level: 'error', code: reference.usage === 'script' ? 'remote-script' : reference.usage === 'stylesheet' ? 'remote-stylesheet' : reference.usage === 'font' ? 'remote-font' : 'remote-resource', message: `导入暂不支持远程${...}: ${reference.url}` }
```
**违背原则**：这里已经亲手承认"远程图片/视频可以给 pass（warning 保留）"，却还是硬把 CSS / font 拒在门外。CSS 之于课件样式与图片之于课件视觉是同一层级。
**用户视角**：一份哪怕只用 Google Fonts 一行 `<link href="https://fonts.googleapis.com/css2?family=...">` 的幻灯片整体导入失败，必须让模型先内联字体（不现实）或者放弃。

### A5. data URI 脚本"暂不支持安全内联"
**文件**：`extractHtmlResources.ts` L1066、L1007
```
if (/^data:/i.test(decoded)) addDiagnostic(sink, 'error', 'unsupported-script-source', 'data URI 脚本源暂不支持安全内联', clip(decoded))
if (embedded && (tag.name === 'script' || tag.attrs.some(attribute => /^on[a-z]/i.test(attribute.name)))) addDiagnostic(sink, 'error', 'unsupported-html-capability', '动态 HTML 中的脚本和内联事件暂不支持')
```
**违背原则**：内联事件 `onClick=` 是 HTML 原生合法属性，宿主 iframe 完整执行；data URI 脚本是单文件 HTML 的常见封装手段。这两个都用"暂不支持"的伪诊断拒绝真实可用内容。
**用户视角**：教师让 AI"做一个单击播放音效的小课堂控件"，模型可能输出 inline `onclick="document.getElementById('a').play()"` —— 这是最简单可靠的课件形态，被一刀切否了。

---

## B. 强制转换格式 / 失去保真性

### B1. HTML 导入强制把外链 stylesheet 内联成 `<style>`
**文件**：`extractHtmlResources.ts` L1038–L1042
```
const css = neutralizeStyleClose(rewriteCss(decodeText(bytes), directoryOf(key), sink, siblings))
parts.push(rebuildStart({ rawName: 'style', name: 'style', attrs: keptStyleAttributes(tag.attrs), end: 0, selfClosing: false }, false))
parts.push(css, '</style>')
```
**违背原则**：§"模型返回内容后，让软件自动完成 ... 精准转换 ... 保真承载"。这里把 `<link rel=stylesheet href="...">` 静默改写为内联 `<style>`，丢失了原文件身份、丢失原 href 引用关系，且 `keptStyleAttributes` 只保留 `media/title/id/class/nonce`，**原 `integrity`/`crossorigin`/`referrerpolicy` 等被静默丢弃**。
**用户视角**：课件如果依赖 audited CSS（CDN + integrity），导入后转为内联大幅膨胀单文件、丢失审计链；任何 stylesheet 的未来的相对路径修复都被破坏。

### B2. 外部 JS 强制内联 + 静态闭包改写
**文件**：`extractHtmlResources.ts` L1074–L1078
```
const source = decodeText(bytes)
body = neutralizeScriptClose(scriptKind === 'other' ? source : rewriteJavaScript(source, scriptKind === 'module' ? 'module' : 'script', base, sink, siblings))
src.drop = true
inlined = true
```
整个 `rewriteJavaScript`（约 280 行）做的就是把所有 `img.src`/`audio.src`/`video.src`/`fetch/XHR` 静态改写。这是把模型的代码段机械式重写。`rewriteJavaScript` 中的 "urlSink / embeddedSink" 在遇到无法静态证明的字符串时直接 `addDiagnostic('error')` —— 又绕回 A1。
**违背原则**：保真转换。模型给的 JS 文本被全文 AST 改写、字符串改写、被 AST 反解析校验，仍是把"软件不判断内容"反过来写了。
**用户视角**：模型给的原本带有 `img.src = window.boxAvatarUrl` 这种动态绑定的代码被 `unsupported-dynamic-url-sink` 拒；连 `setAttribute` 用变量做属性名都被拒：

### B3. setAttribute 字面量属性名校验 —— 对动态性过敏
**文件**：`extractHtmlResources.ts` L786
```
if (!attribute && !closureProof.auditedNode(node)) addDiagnostic(sink, 'error', 'unsupported-dynamic-url-sink', '无法静态确定 setAttribute 的属性')
```
**用户视角**：模型生成 `el.setAttribute(isPreview ? 'src' : 'data-src', url)` 就 fail；`el.setAttribute('data-x-' + name, '')` 也 fail。算"静态不可证明"，但运行起来完全合法。

---

## C. Preview / 编辑 服务的过分 Kleenex 边界

### C1. HTML 预览编辑只放行 text/img，对其它标签整体拒绝
**文件**：`src/main/workbench/htmlPreview/htmlSourceLocator.ts` L93, L122–L124
```
if (report.scriptCreated) return rejection(report.handle, 'script-created')
...
} else {
  if (report.attributeName !== null || ['script', 'style', 'textarea', 'title', 'noscript'].includes(element.name)) {
    return rejection(report.handle, 'unsupported-target')
  }
```
**违背原则**：AGENTS.md 第 12 条"能被当前载体解析并实际使用就先导入"——preview 里的 textarea/title 完全可以编辑纯文本（模型已经在 dom 里看到了它的 raw text），但静态白名单把 `title`、`textarea`、`style` 一律标 `unsupported-target`。
**用户视角**：模型看到预览里有 `<title>错误标题</title>`，工具却告诉它"这个不能 edit"，必须走 `file.patch` 大改；scriptCreated=true 的元素（用户用 JS 渲染出的 UI）连让其提示用户都不能 edit。

### C2. text.replace 强制目标必须是 Native text 或 markdown-range
**文件**：`src/core/tools/DocumentToolGateway.ts` L1112–L1120
```
if (mutation.name === 'text.replace') {
  if (target.kind === 'course-object' && model.kind === 'course-v9') {
    ...
    if (!layer || layer.item.kind !== 'native' || layer.item.content.nativeType !== 'text') throw new Error('纯文本替换需要 Native 文字对象')
    ...
  } else {
    if (target.kind !== 'markdown-range') throw new Error('文本替换需要 Markdown 范围或 Native 文字句柄')
```
**违背原则**：AGENTS.md §"文本 replace / patch 的非必要限制：AI 改了文字，软件是否对'哪种文字能改'加了多余的 category 检查"。这里的 native/markdown 二分把 Runtime/Component 里的可视文字完全排除在 text.replace 之外，强迫模型用 `runtime.source` 全量替换 200 万字符上限的整个 source 才能改一个标题。
**用户视角**：模型在 preview 看到 component 内有"上一页"按钮想改成"下一页"，工具不让 text.replace；模型被迫读全部源码、找出 React `_jsx('button',...)`，改字符串再 `runtime.source` 重写粘贴整个 30 万字符源——慢 + 容易引入新错。

### C3. runtime.source 强制验证 fallback 必须存在 + 真实解码
**文件**：`src/renderer/authoring/tools/dynamicCandidateFallbackAssets.ts` L18–L28
```
if (!entry || entry[1].kind !== 'image') throw new Error('后备素材不是工程图片')
const [key, meta] = entry
let bytes = resources.assetFiles[meta.id] ?? resources.assetFiles[key]
...
if (!bytes?.length || bytes.byteLength !== meta.byteLength) throw new Error('后备图片的实际字节缺失或长度不匹配')
await readImageDimensions(bytes, meta.mimeType)
```
**违背原则**：这是 preview 提示"fallback 必须真实可解码"——很合理——但同一份校验在 *每次* runtime.source 修改都会跑（参见 dynamicCandidateAdmission.ts L208 `await validateDynamicCandidateFallbackAssets(...)` 即使模型只是想改个文字）。即使 fallback 没动，每个 admission 都强制 sharp-decoding fallback 字节。
**用户视角**：模型只改一个 React 字符串，整个 admission 都得真实解码一次图片、跑 12 秒的 Published 宿主 smoke、跑 suspend/resume lifecycle，最终"上次没动过的 fallback 也得通过完整 image-serving 链"。无必要的真实运行时。

### C4. 图片编辑强制 srcset/sizes 移除（强删这是用户的合法属性）
**文件**：`src/main/workbench/htmlPreview/HtmlSourceEditService.ts` L42–L64, L149–L151
```
const removals = imageResponsiveRemovals(source, locator.elementSpan.start)
if (!removals) { await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'not-editable' } }
edits = removals
```
**违背原则**：模型只让替换 `<img src>`，预览编辑服务**强制把相关节点的 srcset/sizes 一并删除**。这是"机械导入"远超自己身份的反向：模型并未请求删 srcset。
**用户视角**：模型只想换图，结果用户原本写好的响应式 `srcset="a.jpg 1x, b.jpg 2x" sizes="(min-width:600px) 50vw"` 被一并抹掉，等于把用户内容破坏性修改而不是最小修改。

### C5. 图片格式白名单：仅 PNG/JPG/GIF/WEBP/SVG
**文件**：`src/main/workbench/htmlPreview/htmlImagePreparation.ts` L9–L22
```
function actualExtension(bytes: Uint8Array, mimeType: string): '.png' | '.jpg' | '.gif' | '.webp' | '.svg' | null {
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png'
  ...
  return null
}
```
**违背原则**：AVIF/BMP/ICO 都被宿主 iframe 完全支持，却被白名单拒。MEDIA_TYPES 表（extractHtmlResources.ts L46-L53）里**已经接受** avif/bmp/ico/apng，preview 编辑却又加了更严一层。
**用户视角**：模型生成了一段 `<img src="x.avif">`，preview edit 走 image edit 流程被 "图片大小不受支持/格式与实际字节不符" 拒绝。

---

## D. 多余 warning/状态门（轻微摩擦）

### D1. resume-observation-required：continuation 必须先 read 才能改
**文件**：`src/core/tools/DocumentToolGateway.ts` L340–L346
```
requireReadObservation(runId: string): void {
  if (this.run(runId).stopped) throw new ToolError('run-stopped', '任务已停止')
  this.observationRuns.add(runId)
}
private assertObserved(runId: string, snapshot: DocumentSnapshot, targets: readonly ToolTarget[]): void {
  if (this.observationRuns.has(runId) && targets.some(target => !this.readCoverage.has(runId, snapshot, target)))
    throw new ToolError('resume-observation-required', '继续修改前需读取该目标的当前内容；可以分段或分页读取，无需读完无关文档。')
}
```
被 `src/main/workbench/execution/ExecutionEngine.ts` L538 触发：`if (continuation) this.options.gateway.requireReadObservation(runId)`。
**违背原则**：AGENTS.md §"禁止额外加'先 read 再改'、'明确授权才允许改'、'not authorized 层层校验'之类的过程层双保险"。这是 Owner 在 2026-10-02 原则里**直接点名禁止**的那一类门。
**用户视角**：用户在中断的 conversation 里继续追问"把上一段第 3 节标题改成 X"，CRDT/CAS 已经足够防覆盖；这里强制模型先 read 该 range 才能 issue write，卡住一轮工具调用、白白多花一回合。

### D2. HTML Action 审计需"先观察再点击"，并附加原 fingerprint
**文件**：`src/main/workbench/observation/HtmlActionService.ts` L198–L226 / `HtmlActionPageScript.ts` L74–L80
```
const result = await this.options.frames.act(session.context, session.frameToken, { ...input, path: target.path, fingerprint: target.fingerprint })
...
if (!element?.isConnected || fingerprint(element) !== input.fingerprint) return { applied: false, reason: 'stale-element' }
```
**违背原则**：fingerprint 包含 `labelOf`，所以**"、"或"→"渲染差异、aria-label/title 改变、innerText 修剪变一个空格**都会判定"stale-element"拒绝。Owned preview 已经做 CAS，再叠一层 isConnected+fingerprint 是双保险。

### D3. file.write 必须 expectedVersion，否则整次拒
**文件**：`src/main/workbench/execution/AgentFileText.ts` L113
```
if (!expectedVersion) throw new Error('覆盖文件必须提供读取时取得的版本')
```
**违背原则**：双保险。已有的 `commit()` 内 (L162, L176) 已经做 `(await this.source(filename)).version !== current.version` 检查 + temp-then-rename 原子写。要求模型预期的 version 只在 file.write 模式下强行要，file.patch 路径不强制（看相对位置），与之不一致。
**用户视角**：模型只凭空生成内容覆盖文件而被拒，必须先 file.read 一回。

### D4. textRead 服务在已打开文档上重复：read→attach→issueTarget→execute('read')，再重读 verify
**文件**：`src/main/workbench/execution/AgentFileText.ts` L72–L85
```
await this.host.tools.attachRunDocument(...)
const target = await this.host.tools.issueTarget(...)
const receipt = await this.host.tools.execute(...)
if (receipt.kind !== 'read' || (receipt.data as { text?: unknown }).text !== current.source.slice(offset, end))
  throw new Error('正式文档观察与文件读取不一致，请重新读取')
if ((await this.source(filename)).version !== current.version) throw new Error('读取期间文档已改变，请重新读取')
```
**违背原则**：过度读。模型已经拿到当前 source，这里把同一段文本**再走一次完整的 attachRun/issueTarget/execute('read') 流水线**只为了再校验一次相同字符串，然后又一次 `await this.source(filename)` 比对。三轮 IO + 两次完整 digest。

### D5. EditSessionService 中文目标必须是 4 种窄 type
**文件**：`src/main/workbench/execution/EditSessionService.ts` L30–L44
```
function editable(model: DocumentModel, target: ToolTarget): EditTarget {
  readTarget(model, target)
  if (target.kind === 'markdown-range') return target
  if (model.kind !== 'course-v9') throw new Error('正文目标不属于课程文档')
  if (target.kind === 'course-object') {
    const item = locateCourseLayer(model.project, target.itemId)?.item
    if (!item || item.kind !== 'native' || item.content.nativeType !== 'text' || item.locked) throw new Error('当前对象不是可编辑的 Native 文字')
    ...
  throw new Error('此目标不支持正文生成预览')
}
```
**违背原则**：跟 C2 同源——preview/edit session 也只能对 4 种 target 工作。runtime/component 中可视文字只能走"重写整个 runtime source"通道，跟 §"内容能被当前载体解析并实际使用就先导入"背离。

---

## E. 信息级杂项

- `extractHtmlResources.ts` L1007 静态拒绝任意 `on*` 内联事件，**用户视角**：`onclick="document.title='x'"` 一行就 fail 整个 HTML。
- `splitHtmlSections.ts`、`prepareHtmlCourseCandidate.ts` L36 `assetKind()` 只接受 image/audio/video/font，`throw new Error('HTML 资源类型暂不能作为受管素材导入：${resource.mediaType}')` —— wasm / JSON / wasm 已经在 MEDIA_TYPES 有，仍被拒。这是**与自家 extractor 不一致**的小坑。
- `HtmlImportService.ts` L128：`if (content.length > 24 * 1024 * 1024) throw new Error(\`HTML 素材 ${meta.filename} 超过受控写入单文件上限\`)` —— 24MB 对一张 4K banner 图或短视频是非常常见的边界。素材大小门已经在 `AttachmentService` 有 `MATERIAL_EXTRACTION_LIMITS.sourceBytes`，这里又叠一层独立上限。

---

## 总结：违背 §12"能进入就先导入"的最显眼检查点（按常见用例命中频率排序）

1. **extractHtmlResources.ts L1065/L1063/L1031/L780/L1007/L1008** — 远程脚本 / defer/async / modulepreload / fetch/Worker / onclick / iframe 会拒绝大多数真实世界 AI 生成的课件 HTML
2. **remoteHtmlReferences.ts L25–L28** — Google Fonts / CDN stylesheet 一条即整页失败
3. **DocumentToolGateway.ts L1112–L1120** — 非 native/markdown 目标的 text.replace 一刀切
4. **htmlSourceLocator.ts L93/L122** — preview edit 只放行 image/text，title/textarea/scriptCreated 拒绝
5. **dynamicCandidateFallbackAssets.ts L18–L31 + dynamicCandidateAdmission.ts L208** — 每次 runtime.source 都强制真实解码 fallback 即使没动它
6. **DocumentToolGateway.ts L340/L1081 (`resume-observation-required`)** — 明令禁止的"先 read 再改"过程门
7. **HtmlSourceEditService.ts L149–L151 (imageResponsiveRemovals)** — 替换 img 时未经请求的 srcset/sizes 强删

注：以上每一条的 source 均直接来自源码；只有 A/B 级是"对用户合理场景完全拒绝"，应该最优先重构——它们都源于同一个错误假设："软件必须先证明内容能被完全闭包静态改写，否则就拒绝。" 这与 AGENTS.md 第 12 条"能被当前载体解析、保真承载并实际使用的 AI/用户产物先导入"直接冲突。
